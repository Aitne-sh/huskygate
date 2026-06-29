/** @module keychain — Cross-platform credential storage via OS-native secret stores. */
import { execFile } from 'node:child_process';
import { TIMEOUTS } from '../shared/constants.js';
import { logger } from './logger.js';
import { getPowerShell, isLinux, isMacOS, isWindows } from './platform.js';

const SERVICE_NAME = 'huskygate';

/** Uniform interface for OS credential store operations. */
export interface KeychainProvider {
  readonly platform: string;
  isAvailable(): Promise<boolean>;
  getPassword(key: string): Promise<string | null>;
  setPassword(key: string, value: string): Promise<void>;
  deletePassword(key: string): Promise<boolean>;
  listKeys(): Promise<string[]>;
}

// ── helpers ──

function execFileAsync(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: TIMEOUTS.keychainOp }, (err, stdout, stderr) => {
      const exitCode = err && 'code' in err ? (err.code as number) : err ? 1 : 0;
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode });
    });
  });
}

function execFileWithStdinAsync(
  cmd: string,
  args: string[],
  input: string,
  options?: { appendNewline?: boolean },
): Promise<{ exitCode: number }> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout: TIMEOUTS.keychainOp }, (err) => {
      const exitCode = err && 'code' in err ? (err.code as number) : err ? 1 : 0;
      resolve({ exitCode });
    });
    const payload = options?.appendNewline ? `${input}\n` : input;
    child.stdin?.write(payload);
    child.stdin?.end();
  });
}

// ── macOS: security CLI ──

class MacOSKeychainProvider implements KeychainProvider {
  readonly platform = 'macos';

  async isAvailable(): Promise<boolean> {
    try {
      // Quick probe — `security list-keychains` always succeeds if Keychain is available
      const { exitCode } = await execFileAsync('security', ['list-keychains']);
      return exitCode === 0;
    } catch {
      return false;
    }
  }

  async getPassword(key: string): Promise<string | null> {
    const { stdout, exitCode } = await execFileAsync('security', [
      'find-generic-password',
      '-s',
      SERVICE_NAME,
      '-a',
      key,
      '-w',
    ]);
    if (exitCode !== 0) return null;
    return stdout.trim() || null;
  }

  async setPassword(key: string, value: string): Promise<void> {
    // `-w <password>` passes the password as a command-line argument.
    // macOS `security` does NOT support reading from stdin for `-w` — when
    // `-w` has no trailing value it prompts interactively on /dev/tty, which
    // silently fails in non-interactive contexts (stores an empty password).
    // execFile does not go through a shell, so the value is not exposed in
    // shell history. Brief exposure in process listing is acceptable for the
    // millisecond-level runtime of this command.
    const { exitCode } = await execFileAsync('security', [
      'add-generic-password',
      '-s',
      SERVICE_NAME,
      '-a',
      key,
      '-U',
      '-w',
      value,
    ]);
    if (exitCode !== 0) {
      // Do not include stderr — it may echo the secret value
      throw new Error(`Failed to store key "${key}" in macOS keychain (exit ${exitCode})`);
    }
  }

  async deletePassword(key: string): Promise<boolean> {
    const { exitCode } = await execFileAsync('security', [
      'delete-generic-password',
      '-s',
      SERVICE_NAME,
      '-a',
      key,
    ]);
    return exitCode === 0;
  }

  async listKeys(): Promise<string[]> {
    const { stdout, exitCode } = await execFileAsync('security', ['dump-keychain']);
    if (exitCode !== 0) return [];
    const keys: string[] = [];
    const lines = stdout.split('\n');
    let inHuskygate = false;
    for (const line of lines) {
      if (line.includes(`"svce"<blob>="${SERVICE_NAME}"`)) {
        inHuskygate = true;
      }
      if (inHuskygate && line.includes('"acct"<blob>="')) {
        const match = /"acct"<blob>="([^"]*)"/.exec(line);
        if (match?.[1]) {
          keys.push(match[1]);
          inHuskygate = false;
        }
      }
    }
    return keys;
  }
}

// ── Linux: secret-tool CLI ──

class LinuxKeychainProvider implements KeychainProvider {
  readonly platform = 'linux';

  async isAvailable(): Promise<boolean> {
    try {
      const { exitCode } = await execFileAsync('secret-tool', ['--version']);
      return exitCode === 0;
    } catch {
      return false;
    }
  }

  async getPassword(key: string): Promise<string | null> {
    const { stdout, exitCode } = await execFileAsync('secret-tool', [
      'lookup',
      'service',
      SERVICE_NAME,
      'key',
      key,
    ]);
    if (exitCode !== 0) return null;
    return stdout.trim() || null;
  }

  async setPassword(key: string, value: string): Promise<void> {
    // secret-tool store reads from stdin
    const { exitCode } = await execFileWithStdinAsync(
      'secret-tool',
      ['store', '--label', `${SERVICE_NAME}:${key}`, 'service', SERVICE_NAME, 'key', key],
      value,
    );
    if (exitCode !== 0) {
      // Do not include stderr — it may echo the secret value
      throw new Error(`Failed to store key "${key}" in Linux keychain (exit ${exitCode})`);
    }
  }

  async deletePassword(key: string): Promise<boolean> {
    const { exitCode } = await execFileAsync('secret-tool', [
      'clear',
      'service',
      SERVICE_NAME,
      'key',
      key,
    ]);
    return exitCode === 0;
  }

  async listKeys(): Promise<string[]> {
    const { stdout, exitCode } = await execFileAsync('secret-tool', [
      'search',
      '--all',
      'service',
      SERVICE_NAME,
    ]);
    if (exitCode !== 0) return [];
    const keys: string[] = [];
    for (const line of stdout.split('\n')) {
      const match = /attribute\.key\s*=\s*(.+)/.exec(line);
      if (match?.[1]) keys.push(match[1].trim());
    }
    return keys;
  }
}

// ── Windows: cmdkey + PowerShell .NET interop ──

class WindowsKeychainProvider implements KeychainProvider {
  readonly platform = 'windows';

  async isAvailable(): Promise<boolean> {
    try {
      // cmdkey is available on all Windows 10+ systems
      const { exitCode } = await execFileAsync('cmdkey', ['/list']);
      return exitCode === 0;
    } catch {
      return false;
    }
  }

  async getPassword(key: string): Promise<string | null> {
    // cmdkey /list doesn't expose the password value.
    // Use PowerShell .NET interop to read the credential via CredentialManager DPAPI.
    const target = `${SERVICE_NAME}:${key}`;
    // Escape the target for safe embedding in a PowerShell double-quoted string:
    // backtick-escape backticks, double-quotes, and dollar signs.
    const psTarget = target.replace(/`/g, '``').replace(/"/g, '`"').replace(/\$/g, '`$');
    const script = [
      '$ErrorActionPreference="Stop"',
      // Use Add-Type + P/Invoke to call CredRead
      'Add-Type -Namespace Win32 -Name Cred -MemberDefinition @"',
      '[DllImport("advapi32.dll",SetLastError=true,CharSet=CharSet.Unicode)]',
      'public static extern bool CredRead(string target,int type,int flags,out IntPtr cred);',
      '[DllImport("advapi32.dll")]',
      'public static extern void CredFree(IntPtr cred);',
      '[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]',
      'public struct CREDENTIAL{public int Flags;public int Type;public string TargetName;',
      'public string Comment;public long LastWritten;public int CredentialBlobSize;',
      'public IntPtr CredentialBlob;public int Persist;public int AttributeCount;',
      'public IntPtr Attributes;public string TargetAlias;public string UserName;}',
      '"@',
      '$ptr=[IntPtr]::Zero',
      `if([Win32.Cred]::CredRead("${psTarget}",1,0,[ref]$ptr)){`,
      '$c=[Runtime.InteropServices.Marshal]::PtrToStructure($ptr,[type][Win32.Cred+CREDENTIAL])',
      'if($c.CredentialBlobSize -gt 0){',
      '[Runtime.InteropServices.Marshal]::PtrToStringUni($c.CredentialBlob,$c.CredentialBlobSize/2)',
      '}',
      '[Win32.Cred]::CredFree($ptr)',
      '}',
    ].join(';');

    const psExe = getPowerShell();
    const { stdout, exitCode } = await execFileAsync(psExe, [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ]);
    if (exitCode !== 0) return null;
    return stdout.trim() || null;
  }

  async setPassword(key: string, value: string): Promise<void> {
    // Use PowerShell .NET CredWrite P/Invoke instead of cmdkey.
    // cmdkey passes the secret as a CLI argument visible in process listings.
    const target = `${SERVICE_NAME}:${key}`;
    const psTarget = target.replace(/`/g, '``').replace(/"/g, '`"').replace(/\$/g, '`$');
    // The secret is passed via stdin to avoid process listing exposure.
    const script = [
      '$ErrorActionPreference="Stop"',
      '$secret = [Console]::In.ReadToEnd()',
      'Add-Type -Namespace Win32 -Name CredW -MemberDefinition @"',
      '[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]',
      'public struct CREDENTIAL{public int Flags;public int Type;public string TargetName;',
      'public string Comment;public long LastWritten;public int CredentialBlobSize;',
      'public IntPtr CredentialBlob;public int Persist;public int AttributeCount;',
      'public IntPtr Attributes;public string TargetAlias;public string UserName;}',
      '[DllImport("advapi32.dll",SetLastError=true,CharSet=CharSet.Unicode)]',
      'public static extern bool CredWrite(ref CREDENTIAL cred,int flags);',
      '"@',
      '$bytes=[Text.Encoding]::Unicode.GetBytes($secret)',
      '$cred=New-Object Win32.CredW+CREDENTIAL',
      `$cred.TargetName="${psTarget}"`,
      '$cred.UserName="huskygate"',
      '$cred.Type=1', // CRED_TYPE_GENERIC
      '$cred.Persist=2', // CRED_PERSIST_LOCAL_MACHINE
      '$cred.CredentialBlobSize=$bytes.Length',
      '$cred.CredentialBlob=[Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)',
      '[Runtime.InteropServices.Marshal]::Copy($bytes,0,$cred.CredentialBlob,$bytes.Length)',
      'try{if(-not [Win32.CredW]::CredWrite([ref]$cred,0)){exit 1}}finally{',
      '[Runtime.InteropServices.Marshal]::FreeHGlobal($cred.CredentialBlob)}',
    ].join(';');

    const psExe = getPowerShell();
    const { exitCode } = await execFileWithStdinAsync(
      psExe,
      ['-NoProfile', '-NonInteractive', '-Command', script],
      value,
    );
    if (exitCode !== 0) {
      throw new Error(
        `Failed to store key "${key}" in Windows Credential Manager (exit ${exitCode})`,
      );
    }
  }

  async deletePassword(key: string): Promise<boolean> {
    const target = `${SERVICE_NAME}:${key}`;
    const { exitCode } = await execFileAsync('cmdkey', [`/delete:${target}`]);
    return exitCode === 0;
  }

  async listKeys(): Promise<string[]> {
    const { stdout, exitCode } = await execFileAsync('cmdkey', ['/list']);
    if (exitCode !== 0) return [];
    const keys: string[] = [];
    const prefix = `${SERVICE_NAME}:`;
    for (const line of stdout.split('\n')) {
      // cmdkey output format: "    Target: LegacyGeneric:target=huskygate:KEY_NAME"
      const match = /Target:\s*(?:LegacyGeneric:target=)?(.+)/i.exec(line);
      if (match?.[1]) {
        const target = match[1].trim();
        if (target.startsWith(prefix)) {
          keys.push(target.slice(prefix.length));
        }
      }
    }
    return keys;
  }
}

// ── Fallback (no-op) ──

class FallbackKeychainProvider implements KeychainProvider {
  readonly platform = 'fallback';

  async isAvailable(): Promise<boolean> {
    return false;
  }
  async getPassword(_key: string): Promise<string | null> {
    return null;
  }
  async setPassword(_key: string, _value: string): Promise<void> {
    throw new Error('Keychain is not available on this platform');
  }
  async deletePassword(_key: string): Promise<boolean> {
    return false;
  }
  async listKeys(): Promise<string[]> {
    return [];
  }
}

// ── Factory ──

let cachedProvider: KeychainProvider | null = null;

/** Get the appropriate keychain provider for the current platform. */
export function getKeychainProvider(): KeychainProvider {
  if (cachedProvider) return cachedProvider;
  if (isMacOS) {
    cachedProvider = new MacOSKeychainProvider();
  } else if (isLinux) {
    cachedProvider = new LinuxKeychainProvider();
  } else if (isWindows) {
    cachedProvider = new WindowsKeychainProvider();
  } else {
    cachedProvider = new FallbackKeychainProvider();
  }
  return cachedProvider;
}

/** @internal Reset the cached provider (for testing). */
export function resetKeychainProvider(): void {
  cachedProvider = null;
}

/** @internal Set a custom provider (for testing / DI). */
export function setKeychainProvider(provider: KeychainProvider): void {
  cachedProvider = provider;
}

// ── High-level helpers ──

/** Load sensitive env keys from keychain into a map. */
export async function loadKeychainSecrets(
  sensitiveKeys: ReadonlySet<string>,
): Promise<Map<string, string>> {
  const provider = getKeychainProvider();
  const values = new Map<string, string>();
  const fallbackKeys: string[] = [];

  const available = await provider.isAvailable();
  if (!available) {
    logger.debug('keychain_not_available', { platform: provider.platform });
    return values;
  }

  for (const key of sensitiveKeys) {
    try {
      const val = await provider.getPassword(key);
      if (val) values.set(key, val);
    } catch (err) {
      if (process.env[key]) {
        fallbackKeys.push(key);
      }
      logger.warn('keychain_get_failed', {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (values.size > 0) {
    logger.debug('keychain_loaded', { count: values.size });
  }
  if (fallbackKeys.length > 0) {
    logger.warn('keychain_env_fallback', {
      count: fallbackKeys.length,
      keys: fallbackKeys.slice(0, 10),
    });
  }
  return values;
}
