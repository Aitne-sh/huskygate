/** @module platform — Cross-platform abstractions for process, path, and CLI resolution. */

import { type SpawnOptions, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TIMEOUTS } from '../shared/constants.js';

// ── Platform flags ──

export const isWindows = process.platform === 'win32';
export const isMacOS = process.platform === 'darwin';
/** @internal Exported for unit testing. */
export const isLinux = process.platform === 'linux';

// ── Process tree kill ──

/**
 * Kill an entire process tree.
 *
 * - Unix: sends the signal to the negative PID (process group).
 * - Windows: `taskkill /T` (tree kill). SIGINT → graceful, SIGKILL → forced (/F).
 */
export function killProcessTree(pid: number, signal: 'SIGINT' | 'SIGKILL'): void {
  if (isWindows) {
    const args = ['/T', '/PID', String(pid)];
    if (signal === 'SIGKILL') args.push('/F');
    try {
      execFileSync('taskkill', args, { stdio: 'ignore', timeout: TIMEOUTS.taskkill });
    } catch {
      // Process may already be gone — acceptable.
    }
  } else {
    process.kill(-pid, signal);
  }
}

/**
 * Terminate a single process gracefully.
 *
 * - Unix: SIGTERM.
 * - Windows: `process.kill(pid)` which calls TerminateProcess.
 */
export function terminateProcess(pid: number): void {
  if (isWindows) {
    // On Windows, process.kill(pid) calls TerminateProcess (hard kill).
    // We use taskkill without /F for a slightly cleaner shutdown.
    try {
      execFileSync('taskkill', ['/PID', String(pid)], {
        stdio: 'ignore',
        timeout: TIMEOUTS.taskkill,
      });
    } catch {
      // Process may already be gone.
    }
  } else {
    process.kill(pid, 'SIGTERM');
  }
}

// ── TCP port to PID ──

/**
 * Find the PID of a process listening on a given TCP port.
 *
 * - Windows: `netstat -ano` parsed with regex.
 * - Unix: `lsof -ti :<port> -sTCP:LISTEN`, with `ss` fallback for minimal
 *   Linux environments (Alpine, Docker) where `lsof` is not installed.
 */
export function findPidOnPort(port: number): number | null {
  if (isWindows) {
    try {
      const output = execFileSync('netstat', ['-ano'], {
        encoding: 'utf-8',
        timeout: TIMEOUTS.platformProbeWindows,
      });
      // Match lines like:  TCP    0.0.0.0:3738    0.0.0.0:0    LISTENING    12345
      const re = new RegExp(`TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, 'im');
      const match = re.exec(output);
      if (!match?.[1]) return null;
      const pid = Number.parseInt(match[1], 10);
      return Number.isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  // Unix: try lsof first (works on macOS and most Linux distros),
  // fall back to ss (iproute2) for minimal Linux environments.
  return findPidOnPortWithLsof(port) ?? findPidOnPortWithSs(port);
}

function findPidOnPortWithLsof(port: number): number | null {
  try {
    const output = execFileSync('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf-8',
      timeout: TIMEOUTS.platformProbe,
    }).trim();
    if (!output) return null;
    const [firstLine = ''] = output.split('\n');
    const pid = Number.parseInt(firstLine, 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Fallback for minimal Linux environments where `lsof` is not installed.
 * Uses `ss` (from iproute2, available on virtually all Linux distros including Alpine).
 * @internal Exported for testing.
 */
export function findPidOnPortWithSs(port: number): number | null {
  try {
    // ss -tlnp: TCP, listening, numeric, show process info
    const output = execFileSync('ss', ['-tlnp', `sport = :${port}`], {
      encoding: 'utf-8',
      timeout: TIMEOUTS.platformProbe,
    }).trim();
    if (!output) return null;
    // ss output: LISTEN  0  128  0.0.0.0:3738  0.0.0.0:*  users:(("node",pid=12345,fd=18))
    const pidMatch = /pid=(\d+)/.exec(output);
    if (!pidMatch?.[1]) return null;
    const pid = Number.parseInt(pidMatch[1], 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

// ── CLI command resolution ──

/** Only allow simple alphanumeric command names (with hyphens/dots) to prevent shell injection. */
const SAFE_COMMAND_NAME = /^[a-zA-Z0-9._-]+$/;

/**
 * Resolve a CLI command name to its absolute path.
 *
 * - Windows: uses `where.exe <name>`.
 * - Unix: uses `$SHELL -lic 'command -v <name>'` (login shell for nvm/brew/etc.).
 *   Falls back to `/bin/sh -c 'command -v <name>'` when `$SHELL` is not set
 *   (common in Docker containers, CI runners, and cron jobs).
 *   Final fallback: `which <name>` for minimal environments.
 *
 * Returns `null` if the command cannot be found.
 */
export function resolveCommand(name: string): string | null {
  if (!SAFE_COMMAND_NAME.test(name)) return null;
  if (isWindows) {
    try {
      const resolved = execFileSync('where.exe', [name], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: TIMEOUTS.platformProbe,
      }).trim();
      // where.exe may return multiple lines; take the first.
      const [firstLine = ''] = resolved.split('\n');
      return firstLine.trim() || null;
    } catch {
      return null;
    }
  }

  // Unix: try login shell first for PATH set in .bashrc/.zshrc
  const shell = process.env.SHELL;
  if (shell) {
    try {
      const resolved = execFileSync(shell, ['-lic', `command -v ${name}`], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: TIMEOUTS.shellResolve,
      }).trim();
      if (resolved.length > 0) return resolved;
    } catch {
      // Login shell failed — fall through.
      // NOTE: we do NOT try /bin/sh or which here because $SHELL is set,
      // meaning we're on a standard system and the command genuinely isn't found.
    }
    return null;
  }

  // $SHELL is unset — typical in Docker containers, CI runners, and cron jobs.
  // Fallback: /bin/sh (POSIX-guaranteed)
  try {
    const resolved = execFileSync('/bin/sh', ['-c', `command -v ${name}`], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: TIMEOUTS.shellResolve,
    }).trim();
    if (resolved.length > 0) return resolved;
  } catch {
    // Fall through to which fallback.
  }

  // Final fallback: `which` (widely available, even on minimal distros)
  try {
    const resolved = execFileSync('which', [name], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: TIMEOUTS.shellResolve,
    }).trim();
    if (resolved.length > 0) return resolved;
  } catch {
    // Exhausted all resolution strategies.
  }

  return null;
}

// ── Python interpreter resolution ──

/**
 * Find a working Python 3 interpreter.
 *
 * Search order:
 *   1. `python3` (Unix default)
 *   2. `python`  (Windows default, also works on some Unix)
 *   3. `py -3`   (Windows Python launcher)
 *
 * Returns the command and its args (e.g. `{ command: 'py', args: ['-3'] }`),
 * or `null` if no Python 3 is found.
 */
export function resolvePython(): { command: string; args: string[] } | null {
  const candidates: Array<{ command: string; args: string[] }> = isWindows
    ? [
        { command: 'python3', args: [] },
        { command: 'python', args: [] },
        { command: 'py', args: ['-3'] },
      ]
    : [
        { command: 'python3', args: [] },
        { command: 'python', args: [] },
      ];

  for (const candidate of candidates) {
    try {
      execFileSync(candidate.command, [...candidate.args, '--version'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: TIMEOUTS.platformProbe,
      });
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

// ── venv paths ──

/**
 * Get the python executable path inside a venv.
 *
 * - Unix:    `<venvDir>/bin/python`
 * - Windows: `<venvDir>/Scripts/python.exe`
 */
export function getVenvPython(venvDir: string): string {
  return isWindows
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
}

/**
 * Get the pip executable path inside a venv.
 *
 * - Unix:    `<venvDir>/bin/pip`
 * - Windows: `<venvDir>/Scripts/pip.exe`
 */
export function getVenvPip(venvDir: string): string {
  return isWindows ? path.join(venvDir, 'Scripts', 'pip.exe') : path.join(venvDir, 'bin', 'pip');
}

// ── spawn options ──

/**
 * Augment spawn options for detached background processes.
 *
 * - Windows: adds `windowsHide: true` to prevent console window flash,
 *   and keeps `detached: true` (creates a new process group).
 * - Unix: passes through as-is.
 */
export function getDetachedSpawnOptions(base: SpawnOptions): SpawnOptions {
  if (isWindows) {
    return { ...base, windowsHide: true };
  }
  return base;
}

// ── PowerShell resolution ──

/**
 * Resolve the PowerShell executable name.
 * Tries `powershell` (Windows PowerShell, pre-installed) first,
 * then `pwsh` (PowerShell Core, cross-platform successor).
 * On Windows Server Core or newer installations, only `pwsh` may be available.
 * @internal Exported for testing.
 */
export function resolvePowerShell(): string {
  // Try powershell (Windows PowerShell — pre-installed on Windows 10+)
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', 'echo ok'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    });
    return 'powershell';
  } catch {
    // Fall through to pwsh.
  }
  // Try pwsh (PowerShell Core — cross-platform, newer Windows Server Core)
  try {
    execFileSync('pwsh', ['-NoProfile', '-Command', 'echo ok'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    });
    return 'pwsh';
  } catch {
    // Default to powershell — will fail at call site with a clear error.
    return 'powershell';
  }
}

let cachedPsExe: string | null = null;

/** Get the cached PowerShell executable name, resolving on first call. */
export function getPowerShell(): string {
  if (!cachedPsExe) cachedPsExe = resolvePowerShell();
  return cachedPsExe;
}

/** @internal Reset cached PowerShell exe (for testing). */
export function resetPowerShellCache(): void {
  cachedPsExe = null;
}

// ── Browser launch ──

/**
 * Open a URL in the default browser (platform-aware, fire-and-forget).
 *
 * - macOS: `open`
 * - Windows: `cmd.exe /c start`
 * - Linux: `$BROWSER` env var → `xdg-open` → `sensible-browser` (Debian/Ubuntu)
 */
export async function openBrowser(url: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  if (isWindows) {
    execFile('cmd.exe', ['/c', 'start', '', url]);
  } else if (isMacOS) {
    execFile('open', [url]);
  } else {
    // Linux: respect $BROWSER (freedesktop.org convention), fall back to xdg-open,
    // then sensible-browser (Debian/Ubuntu default).
    const browser = process.env.BROWSER;
    if (browser) {
      execFile(browser, [url]);
    } else {
      execFile('xdg-open', [url], (err) => {
        if (err) execFile('sensible-browser', [url]);
      });
    }
  }
}

// ── Fallback path candidates ──

/**
 * Get platform-specific fallback directories where CLI tools may be installed.
 *
 * On Unix: `~/.local/bin`
 * On Windows: `%LOCALAPPDATA%\Programs`, `%APPDATA%\npm`, `~\.local\bin`
 */
function getFallbackBinDirs(): string[] {
  const home = os.homedir();
  if (isWindows) {
    const dirs: string[] = [];
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) dirs.push(path.join(localAppData, 'Programs'));
    const appData = process.env.APPDATA;
    if (appData) dirs.push(path.join(appData, 'npm'));
    dirs.push(path.join(home, '.local', 'bin'));
    return dirs;
  }
  return [path.join(home, '.local', 'bin')];
}

/**
 * Search for an executable in fallback directories.
 * On Windows, also checks with `.exe` and `.cmd` extensions.
 */
export function findInFallbackDirs(name: string): string | null {
  const dirs = getFallbackBinDirs();
  const suffixes = isWindows ? ['', '.exe', '.cmd'] : [''];
  for (const dir of dirs) {
    for (const suffix of suffixes) {
      const candidate = path.join(dir, name + suffix);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}
