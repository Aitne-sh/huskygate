import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockedChild = vi.hoisted(() => ({
  execFileSync: vi.fn<(...args: unknown[]) => string>(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFileSync: mockedChild.execFileSync,
  };
});

import {
  findPidOnPort,
  getLogFilePath,
  getPidFilePath,
  getServerStatus,
  isProcessRunning,
  readPidFile,
  removePidFile,
  stopDaemon,
  writePidFile,
} from './daemon.js';

describe('daemon', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `daemon-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    process.env.HUSKYGATE_TEST_DATA_DIR = tempDir;
    // Default: execFileSync throws (no process on port)
    mockedChild.execFileSync.mockImplementation(() => {
      throw new Error('lsof: no matching');
    });
  });

  afterEach(() => {
    delete process.env.HUSKYGATE_TEST_DATA_DIR;
    rmSync(tempDir, { recursive: true, force: true });
    removePidFile(getPidFilePath());
    removePidFile(getLogFilePath());
    vi.restoreAllMocks();
    mockedChild.execFileSync.mockReset();
  });

  describe('readPidFile', () => {
    it('returns null when file does not exist', () => {
      const result = readPidFile(join(tempDir, 'nonexistent.pid'));
      expect(result).toBeNull();
    });

    it('returns pid for valid file', () => {
      const pidPath = join(tempDir, 'test.pid');
      writeFileSync(pidPath, '12345', 'utf-8');
      expect(readPidFile(pidPath)).toBe(12345);
    });

    it('returns null for invalid content', () => {
      const pidPath = join(tempDir, 'test.pid');
      writeFileSync(pidPath, 'not-a-number', 'utf-8');
      expect(readPidFile(pidPath)).toBeNull();
    });

    it('returns null for negative number', () => {
      const pidPath = join(tempDir, 'test.pid');
      writeFileSync(pidPath, '-1', 'utf-8');
      expect(readPidFile(pidPath)).toBeNull();
    });

    it('returns null for zero', () => {
      const pidPath = join(tempDir, 'test.pid');
      writeFileSync(pidPath, '0', 'utf-8');
      expect(readPidFile(pidPath)).toBeNull();
    });

    it('handles whitespace around pid', () => {
      const pidPath = join(tempDir, 'test.pid');
      writeFileSync(pidPath, '  42  \n', 'utf-8');
      expect(readPidFile(pidPath)).toBe(42);
    });
  });

  describe('isProcessRunning', () => {
    it('returns true for current process', () => {
      expect(isProcessRunning(process.pid)).toBe(true);
    });

    it('returns false for non-existent pid', () => {
      // Use a very high PID unlikely to exist
      expect(isProcessRunning(999999999)).toBe(false);
    });
  });

  describe('getServerStatus', () => {
    it('returns not running when pid file does not exist', () => {
      const pidPath = join(tempDir, 'nonexistent.pid');
      const status = getServerStatus(pidPath);
      expect(status.running).toBe(false);
      expect(status.pid).toBeNull();
      expect(status.pidFile).toBe(pidPath);
    });

    it('returns running for current process pid', () => {
      const pidPath = join(tempDir, 'test.pid');
      writeFileSync(pidPath, String(process.pid), 'utf-8');
      const status = getServerStatus(pidPath);
      expect(status.running).toBe(true);
      expect(status.pid).toBe(process.pid);
    });

    it('returns not running for stale pid', () => {
      const pidPath = join(tempDir, 'test.pid');
      writeFileSync(pidPath, '999999999', 'utf-8');
      const status = getServerStatus(pidPath);
      expect(status.running).toBe(false);
      expect(status.pid).toBeNull();
    });

    it('returns not running for invalid pid file', () => {
      const pidPath = join(tempDir, 'test.pid');
      writeFileSync(pidPath, 'garbage', 'utf-8');
      const status = getServerStatus(pidPath);
      expect(status.running).toBe(false);
      expect(status.pid).toBeNull();
    });
  });

  describe('pid file utilities', () => {
    it('returns daemon file paths under data directory', () => {
      const orig = process.env.HUSKYGATE_TEST_DATA_DIR;
      delete process.env.HUSKYGATE_TEST_DATA_DIR;
      expect(getPidFilePath()).toContain('data');
      expect(getPidFilePath()).toContain('huskygate.pid');
      expect(getLogFilePath()).toContain('data');
      expect(getLogFilePath()).toContain('huskygate.log');
      process.env.HUSKYGATE_TEST_DATA_DIR = orig;
    });

    it('writePidFile creates parent directory and removePidFile handles both existing and missing file', () => {
      const nestedPidPath = join(tempDir, 'a', 'b', 'test.pid');
      writePidFile(nestedPidPath, 777);
      expect(existsSync(nestedPidPath)).toBe(true);
      expect(readFileSync(nestedPidPath, 'utf-8')).toBe('777');
      if (process.platform !== 'win32') {
        expect(statSync(nestedPidPath).mode & 0o777).toBe(0o600);
        expect(statSync(join(tempDir, 'a', 'b')).mode & 0o777).toBe(0o700);
      }

      expect(() => removePidFile(nestedPidPath)).not.toThrow();
      expect(existsSync(nestedPidPath)).toBe(false);

      expect(() => removePidFile(nestedPidPath)).not.toThrow();
    });
  });

  describe('stopDaemon', () => {
    it('is idempotent and removes stale pid file when server is not running', () => {
      writePidFile(getPidFilePath(), 999_999_999);
      vi.spyOn(process, 'kill').mockImplementation(((_pid: number, signal?: string | number) => {
        if (signal === 0) {
          throw new Error('ESRCH');
        }
        return true;
      }) as typeof process.kill);

      const result = stopDaemon();
      expect(result).toEqual({ error: 'Server is not running' });
      expect(existsSync(getPidFilePath())).toBe(false);
    });

    it('sends SIGTERM to running pid and removes pid file', () => {
      writePidFile(getPidFilePath(), 22222);
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(((
        _pid: number,
        signal?: string | number,
      ) => {
        if (signal === 0) return true;
        if (signal === 'SIGTERM') return true;
        return true;
      }) as typeof process.kill);

      const result = stopDaemon();
      expect(result).toEqual({ stopped: true, pid: 22222 });
      expect(killSpy).toHaveBeenCalledWith(22222, 'SIGTERM');
      expect(existsSync(getPidFilePath())).toBe(false);
    });

    it('still removes pid file when SIGTERM throws', () => {
      writePidFile(getPidFilePath(), 33333);
      vi.spyOn(process, 'kill').mockImplementation(((_pid: number, signal?: string | number) => {
        if (signal === 0) return true;
        if (signal === 'SIGTERM') {
          throw new Error('already exited');
        }
        return true;
      }) as typeof process.kill);

      const result = stopDaemon();
      expect(result).toEqual({ stopped: true, pid: 33333 });
      expect(existsSync(getPidFilePath())).toBe(false);
    });

    it('falls back to port-based detection when pid file is stale', () => {
      writePidFile(getPidFilePath(), 999_999_999);
      vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
        if (signal === 0) {
          if (pid === 44444) return true;
          throw new Error('ESRCH');
        }
        return true;
      }) as typeof process.kill);

      mockedChild.execFileSync.mockReturnValue('44444\n');

      const result = stopDaemon(3738);
      expect(result).toEqual({ stopped: true, pid: 44444 });
      expect(existsSync(getPidFilePath())).toBe(false);
    });

    it('still succeeds when SIGTERM throws in port fallback path', () => {
      writePidFile(getPidFilePath(), 999_999_999);
      vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
        if (signal === 0) {
          if (pid === 44444) return true;
          throw new Error('ESRCH');
        }
        if (signal === 'SIGTERM') {
          throw new Error('already exited');
        }
        return true;
      }) as typeof process.kill);

      mockedChild.execFileSync.mockReturnValue('44444\n');

      const result = stopDaemon(3738);
      expect(result).toEqual({ stopped: true, pid: 44444 });
      expect(existsSync(getPidFilePath())).toBe(false);
    });

    it('returns not running when port fallback also finds nothing', () => {
      writePidFile(getPidFilePath(), 999_999_999);
      vi.spyOn(process, 'kill').mockImplementation(((_pid: number, signal?: string | number) => {
        if (signal === 0) {
          throw new Error('ESRCH');
        }
        return true;
      }) as typeof process.kill);

      const result = stopDaemon(3738);
      expect(result).toEqual({ error: 'Server is not running' });
      expect(existsSync(getPidFilePath())).toBe(false);
    });
  });

  describe('findPidOnPort', () => {
    it('returns null when no process on port', () => {
      expect(findPidOnPort(59123)).toBeNull();
    });

    it('returns null when lsof output is empty', () => {
      mockedChild.execFileSync.mockReturnValue('');
      expect(findPidOnPort(3737)).toBeNull();
    });

    it('returns pid when process found on port', () => {
      mockedChild.execFileSync.mockReturnValue('12345\n');
      expect(findPidOnPort(3737)).toBe(12345);
    });

    it('returns first pid when multiple processes on port', () => {
      mockedChild.execFileSync.mockReturnValue('11111\n22222\n');
      expect(findPidOnPort(3737)).toBe(11111);
    });

    it('returns null when lsof output is not a number', () => {
      mockedChild.execFileSync.mockReturnValue('not-a-pid\n');
      expect(findPidOnPort(3737)).toBeNull();
    });
  });
});
