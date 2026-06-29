import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We need to mock child_process & fs BEFORE importing the module under test.
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

const mockedExecFileSync = execFileSync as unknown as Mock;
const mockedExistsSync = existsSync as unknown as Mock;

/* ── Helpers to load module with a specific platform ── */

/**
 * Dynamically import platform.ts after overriding process.platform.
 * Each call gets a fresh module (vi.resetModules() + import).
 */
async function loadPlatform(platform: string) {
  vi.resetModules();
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, writable: true });

  const mod = await import('./platform.js');

  // Restore so later tests aren't affected.
  Object.defineProperty(process, 'platform', { value: original, writable: true });
  return mod;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ── Platform flags ── */

describe('platform flags', () => {
  it('isWindows is true on win32', async () => {
    const m = await loadPlatform('win32');
    expect(m.isWindows).toBe(true);
    expect(m.isMacOS).toBe(false);
    expect(m.isLinux).toBe(false);
  });

  it('isMacOS is true on darwin', async () => {
    const m = await loadPlatform('darwin');
    expect(m.isMacOS).toBe(true);
    expect(m.isWindows).toBe(false);
  });

  it('isLinux is true on linux', async () => {
    const m = await loadPlatform('linux');
    expect(m.isLinux).toBe(true);
    expect(m.isWindows).toBe(false);
  });
});

/* ── killProcessTree ── */

describe('killProcessTree', () => {
  it('sends negative PID signal on Unix', async () => {
    const m = await loadPlatform('linux');
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    m.killProcessTree(1234, 'SIGINT');
    expect(spy).toHaveBeenCalledWith(-1234, 'SIGINT');
    spy.mockRestore();
  });

  it('uses taskkill on Windows (SIGINT → no /F)', async () => {
    const m = await loadPlatform('win32');
    mockedExecFileSync.mockReturnValue('');
    m.killProcessTree(1234, 'SIGINT');
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'taskkill',
      ['/T', '/PID', '1234'],
      expect.objectContaining({ stdio: 'ignore' }),
    );
  });

  it('uses taskkill /F on Windows for SIGKILL', async () => {
    const m = await loadPlatform('win32');
    mockedExecFileSync.mockReturnValue('');
    m.killProcessTree(1234, 'SIGKILL');
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'taskkill',
      ['/T', '/PID', '1234', '/F'],
      expect.objectContaining({ stdio: 'ignore' }),
    );
  });

  it('does not throw if taskkill fails (process already gone)', async () => {
    const m = await loadPlatform('win32');
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('process not found');
    });
    expect(() => m.killProcessTree(9999, 'SIGKILL')).not.toThrow();
  });
});

/* ── terminateProcess ── */

describe('terminateProcess', () => {
  it('sends SIGTERM on Unix', async () => {
    const m = await loadPlatform('darwin');
    const spy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    m.terminateProcess(42);
    expect(spy).toHaveBeenCalledWith(42, 'SIGTERM');
    spy.mockRestore();
  });

  it('uses taskkill on Windows', async () => {
    const m = await loadPlatform('win32');
    mockedExecFileSync.mockReturnValue('');
    m.terminateProcess(42);
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'taskkill',
      ['/PID', '42'],
      expect.objectContaining({ stdio: 'ignore' }),
    );
  });

  it('does not throw if taskkill fails on Windows', async () => {
    const m = await loadPlatform('win32');
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('already gone');
    });
    expect(() => m.terminateProcess(42)).not.toThrow();
  });
});

/* ── findPidOnPort ── */

describe('findPidOnPort', () => {
  it('parses lsof output on Unix', async () => {
    const m = await loadPlatform('linux');
    mockedExecFileSync.mockReturnValue('12345\n');
    expect(m.findPidOnPort(3738)).toBe(12345);
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'lsof',
      ['-ti', ':3738', '-sTCP:LISTEN'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('returns null when lsof returns empty', async () => {
    const m = await loadPlatform('linux');
    mockedExecFileSync.mockReturnValue('');
    expect(m.findPidOnPort(3738)).toBeNull();
  });

  it('parses netstat output on Windows', async () => {
    const m = await loadPlatform('win32');
    mockedExecFileSync.mockReturnValue(
      '  TCP    0.0.0.0:3738           0.0.0.0:0              LISTENING       5678\r\n',
    );
    expect(m.findPidOnPort(3738)).toBe(5678);
  });

  it('returns null when netstat has no match', async () => {
    const m = await loadPlatform('win32');
    mockedExecFileSync.mockReturnValue(
      '  TCP    0.0.0.0:80           0.0.0.0:0              LISTENING       100\r\n',
    );
    expect(m.findPidOnPort(3738)).toBeNull();
  });

  it('returns null when matched PID cannot be parsed', async () => {
    const m = await loadPlatform('win32');
    mockedExecFileSync.mockReturnValue(
      '  TCP    0.0.0.0:3738           0.0.0.0:0              LISTENING       5678\r\n',
    );
    const parseIntSpy = vi.spyOn(Number, 'parseInt').mockReturnValueOnce(Number.NaN);
    expect(m.findPidOnPort(3738)).toBeNull();
    parseIntSpy.mockRestore();
  });

  it('returns null on error', async () => {
    const m = await loadPlatform('linux');
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('command not found');
    });
    expect(m.findPidOnPort(3738)).toBeNull();
  });
});

/* ── findPidOnPortWithSs (Linux ss fallback) ── */

describe('findPidOnPortWithSs', () => {
  it('parses ss output with pid= field', async () => {
    const m = await loadPlatform('linux');
    mockedExecFileSync.mockReturnValue(
      'LISTEN  0  128  0.0.0.0:3738  0.0.0.0:*  users:(("node",pid=12345,fd=18))\n',
    );
    expect(m.findPidOnPortWithSs(3738)).toBe(12345);
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'ss',
      ['-tlnp', 'sport = :3738'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('returns null when ss output has no pid', async () => {
    const m = await loadPlatform('linux');
    mockedExecFileSync.mockReturnValue('LISTEN  0  128  0.0.0.0:3738  0.0.0.0:*\n');
    expect(m.findPidOnPortWithSs(3738)).toBeNull();
  });

  it('returns null when ss is not installed', async () => {
    const m = await loadPlatform('linux');
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('command not found');
    });
    expect(m.findPidOnPortWithSs(3738)).toBeNull();
  });

  it('returns null for empty output', async () => {
    const m = await loadPlatform('linux');
    mockedExecFileSync.mockReturnValue('');
    expect(m.findPidOnPortWithSs(3738)).toBeNull();
  });
});

/* ── findPidOnPort with lsof→ss fallback chain ── */

describe('findPidOnPort lsof→ss fallback', () => {
  it('falls back to ss when lsof is not available', async () => {
    const m = await loadPlatform('linux');
    let callCount = 0;
    mockedExecFileSync.mockImplementation((cmd: string) => {
      callCount++;
      if (cmd === 'lsof') throw new Error('command not found');
      if (cmd === 'ss')
        return 'LISTEN  0  128  0.0.0.0:3738  0.0.0.0:*  users:(("node",pid=99999,fd=3))\n';
      return '';
    });
    expect(m.findPidOnPort(3738)).toBe(99999);
  });

  it('uses lsof result when lsof succeeds', async () => {
    const m = await loadPlatform('linux');
    mockedExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'lsof') return '11111\n';
      if (cmd === 'ss') return 'users:(("node",pid=22222,fd=3))\n';
      return '';
    });
    expect(m.findPidOnPort(3738)).toBe(11111);
  });

  it('falls back to ss when lsof returns empty (command not found)', async () => {
    const m = await loadPlatform('linux');
    mockedExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'lsof') return '';
      if (cmd === 'ss')
        return 'LISTEN  0  128  0.0.0.0:3738  0.0.0.0:*  users:(("node",pid=77777,fd=3))\n';
      return '';
    });
    expect(m.findPidOnPort(3738)).toBe(77777);
  });
});

/* ── resolveCommand ── */

describe('resolveCommand', () => {
  it('returns null for unsafe command names', async () => {
    const m = await loadPlatform('linux');
    expect(m.resolveCommand('claude; rm -rf /')).toBeNull();
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it('uses where.exe on Windows', async () => {
    const m = await loadPlatform('win32');
    mockedExecFileSync.mockReturnValue('C:\\Users\\test\\bin\\claude.exe\r\n');
    expect(m.resolveCommand('claude')).toBe('C:\\Users\\test\\bin\\claude.exe');
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'where.exe',
      ['claude'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('returns null on Windows when where.exe fails', async () => {
    const m = await loadPlatform('win32');
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(m.resolveCommand('nosuchcmd')).toBeNull();
  });

  it('returns null on Windows when where.exe output is blank', async () => {
    const m = await loadPlatform('win32');
    mockedExecFileSync.mockReturnValue('\r\n');
    expect(m.resolveCommand('claude')).toBeNull();
  });

  it('uses login shell on Unix', async () => {
    const m = await loadPlatform('linux');
    const origShell = process.env.SHELL;
    process.env.SHELL = '/bin/bash';
    mockedExecFileSync.mockReturnValue('/usr/local/bin/claude\n');
    expect(m.resolveCommand('claude')).toBe('/usr/local/bin/claude');
    process.env.SHELL = origShell;
  });

  it('returns null on Unix when shell fails', async () => {
    const m = await loadPlatform('linux');
    const origShell = process.env.SHELL;
    process.env.SHELL = '/bin/bash';
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('command not found');
    });
    expect(m.resolveCommand('nosuchcmd')).toBeNull();
    process.env.SHELL = origShell;
  });

  it('does NOT fall through to /bin/sh when $SHELL is set but shell fails', async () => {
    const m = await loadPlatform('linux');
    const origShell = process.env.SHELL;
    process.env.SHELL = '/bin/bash';
    const calls: string[] = [];
    mockedExecFileSync.mockImplementation((cmd: string) => {
      calls.push(cmd);
      if (cmd === '/bin/bash') throw new Error('command not found');
      // /bin/sh and which would succeed if called
      return '/usr/local/bin/claude\n';
    });
    expect(m.resolveCommand('claude')).toBeNull();
    expect(calls).toEqual(['/bin/bash']);
    expect(calls).not.toContain('/bin/sh');
    expect(calls).not.toContain('which');
    process.env.SHELL = origShell;
  });

  it('falls back to /bin/sh when $SHELL is not set', async () => {
    const m = await loadPlatform('linux');
    const origShell = process.env.SHELL;
    delete process.env.SHELL;
    mockedExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === '/bin/sh') return '/usr/local/bin/claude\n';
      throw new Error('not found');
    });
    expect(m.resolveCommand('claude')).toBe('/usr/local/bin/claude');
    process.env.SHELL = origShell;
  });

  it('falls back to which when $SHELL and /bin/sh both fail', async () => {
    const m = await loadPlatform('linux');
    const origShell = process.env.SHELL;
    delete process.env.SHELL;
    mockedExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'which') return '/usr/bin/cloudflared\n';
      throw new Error('not found');
    });
    expect(m.resolveCommand('cloudflared')).toBe('/usr/bin/cloudflared');
    process.env.SHELL = origShell;
  });

  it('returns null when all Unix fallbacks fail', async () => {
    const m = await loadPlatform('linux');
    const origShell = process.env.SHELL;
    delete process.env.SHELL;
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(m.resolveCommand('nosuchcmd')).toBeNull();
    process.env.SHELL = origShell;
  });
});

/* ── resolvePython ── */

describe('resolvePython', () => {
  it('returns python3 as first preference on Unix', async () => {
    const m = await loadPlatform('linux');
    mockedExecFileSync.mockReturnValue('Python 3.12.0\n');
    const result = m.resolvePython();
    expect(result).toEqual({ command: 'python3', args: [] });
  });

  it('falls back to python on Unix', async () => {
    const m = await loadPlatform('linux');
    let callCount = 0;
    mockedExecFileSync.mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw new Error('not found'); // python3 fails
      return 'Python 3.12.0\n'; // python succeeds
    });
    const result = m.resolvePython();
    expect(result).toEqual({ command: 'python', args: [] });
  });

  it('tries py -3 on Windows as third option', async () => {
    const m = await loadPlatform('win32');
    let callCount = 0;
    mockedExecFileSync.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) throw new Error('not found'); // python3, python fail
      return 'Python 3.12.0\n'; // py -3 succeeds
    });
    const result = m.resolvePython();
    expect(result).toEqual({ command: 'py', args: ['-3'] });
  });

  it('returns null when no Python is found', async () => {
    const m = await loadPlatform('linux');
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(m.resolvePython()).toBeNull();
  });
});

/* ── getVenvPython / getVenvPip ── */

describe('venv paths', () => {
  it('returns bin/python on Unix', async () => {
    const m = await loadPlatform('linux');
    expect(m.getVenvPython('/project/.venv')).toBe('/project/.venv/bin/python');
    expect(m.getVenvPip('/project/.venv')).toBe('/project/.venv/bin/pip');
  });

  it('returns Scripts/python.exe on Windows', async () => {
    const m = await loadPlatform('win32');
    expect(m.getVenvPython('C:\\project\\.venv')).toBe(
      path.join('C:\\project\\.venv', 'Scripts', 'python.exe'),
    );
    expect(m.getVenvPip('C:\\project\\.venv')).toBe(
      path.join('C:\\project\\.venv', 'Scripts', 'pip.exe'),
    );
  });
});

/* ── getDetachedSpawnOptions ── */

describe('getDetachedSpawnOptions', () => {
  it('adds windowsHide on Windows', async () => {
    const m = await loadPlatform('win32');
    const result = m.getDetachedSpawnOptions({ detached: true, stdio: 'ignore' });
    expect(result.windowsHide).toBe(true);
    expect(result.detached).toBe(true);
  });

  it('passes through unchanged on Unix', async () => {
    const m = await loadPlatform('linux');
    const base = { detached: true, stdio: 'ignore' as const };
    const result = m.getDetachedSpawnOptions(base);
    expect(result).toEqual(base);
    expect(result.windowsHide).toBeUndefined();
  });
});

/* ── resolvePowerShell ── */

describe('resolvePowerShell', () => {
  it('returns powershell when powershell probe succeeds', async () => {
    const m = await loadPlatform('win32');
    mockedExecFileSync.mockReturnValue('ok\n');
    m.resetPowerShellCache();
    expect(m.resolvePowerShell()).toBe('powershell');
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'powershell',
      ['-NoProfile', '-Command', 'echo ok'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('returns pwsh when powershell fails but pwsh succeeds', async () => {
    const m = await loadPlatform('win32');
    mockedExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'powershell') throw new Error('not found');
      return 'ok\n';
    });
    m.resetPowerShellCache();
    expect(m.resolvePowerShell()).toBe('pwsh');
  });

  it('returns powershell as default when both fail', async () => {
    const m = await loadPlatform('win32');
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    m.resetPowerShellCache();
    expect(m.resolvePowerShell()).toBe('powershell');
  });

  it('caches result across getPowerShell calls', async () => {
    const m = await loadPlatform('win32');
    mockedExecFileSync.mockReturnValue('ok\n');
    m.resetPowerShellCache();
    const first = m.getPowerShell();
    const second = m.getPowerShell();
    expect(first).toBe(second);
    // execFileSync should only be called once (for the first probe)
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
  });

  it('resets cache with resetPowerShellCache', async () => {
    const m = await loadPlatform('win32');
    mockedExecFileSync.mockReturnValue('ok\n');
    m.resetPowerShellCache();
    m.getPowerShell();
    m.resetPowerShellCache();
    m.getPowerShell();
    // Called twice because cache was reset
    expect(mockedExecFileSync).toHaveBeenCalledTimes(2);
  });
});

/* ── findInFallbackDirs ── */

describe('findInFallbackDirs', () => {
  it('checks .local/bin on Unix', async () => {
    const m = await loadPlatform('linux');
    mockedExistsSync.mockImplementation((p: string) => p.includes('.local/bin/claude'));
    const result = m.findInFallbackDirs('claude');
    expect(result).toContain('.local/bin/claude');
  });

  it('checks LOCALAPPDATA and APPDATA on Windows', async () => {
    const m = await loadPlatform('win32');
    const origLocal = process.env.LOCALAPPDATA;
    const origApp = process.env.APPDATA;
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';

    // path.join on macOS uses '/' even for Windows-style segments,
    // so match loosely on the segments we care about.
    mockedExistsSync.mockImplementation((p: string) => {
      const normalized = p.replace(/\\/g, '/');
      return normalized.includes('npm/claude.cmd');
    });
    const result = m.findInFallbackDirs('claude');
    expect(result).not.toBeNull();
    expect(result ?? '').toMatch(/npm/);
    expect(result ?? '').toMatch(/claude\.cmd/);

    process.env.LOCALAPPDATA = origLocal;
    process.env.APPDATA = origApp;
  });

  it('returns null when not found', async () => {
    const m = await loadPlatform('linux');
    mockedExistsSync.mockReturnValue(false);
    expect(m.findInFallbackDirs('nosuchcmd')).toBeNull();
  });
});
