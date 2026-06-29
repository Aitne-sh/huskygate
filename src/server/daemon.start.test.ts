import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: mocked.spawn,
  };
});

import {
  getLogFilePath,
  getPidFilePath,
  removePidFile,
  startDaemon,
  writePidFile,
} from './daemon.js';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempDir: string;

beforeEach(() => {
  tempDir = join(
    tmpdir(),
    `daemon-start-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(tempDir, { recursive: true });
  process.env.HUSKYGATE_TEST_DATA_DIR = tempDir;
});

afterEach(() => {
  delete process.env.HUSKYGATE_TEST_DATA_DIR;
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  removePidFile(getPidFilePath());
  removePidFile(getLogFilePath());
  vi.restoreAllMocks();
  vi.useRealTimers();
  mocked.spawn.mockReset();
});

describe('startDaemon', () => {
  it('returns alreadyRunning when daemon is already running (no force)', async () => {
    writePidFile(getPidFilePath(), process.pid);
    vi.spyOn(process, 'kill').mockImplementation(((_pid: number, signal?: string | number) => {
      if (signal === 0) {
        return true;
      }
      return true;
    }) as typeof process.kill);

    const result = await startDaemon();

    expect(result).toEqual({ alreadyRunning: true, pid: process.pid });
    expect(mocked.spawn).not.toHaveBeenCalled();
  });

  it('force-stops and restarts when daemon is already running with force flag', async () => {
    vi.useFakeTimers();
    writePidFile(getPidFilePath(), process.pid);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(((
      pid: number,
      signal?: string | number,
    ) => {
      if (signal === 0) {
        if (pid === 4322) return true; // spawned child alive
        if (pid === process.pid) return true; // existing process alive
        throw new Error('ESRCH');
      }
      return true; // SIGTERM succeeds
    }) as typeof process.kill);

    const unref = vi.fn();
    mocked.spawn.mockReturnValue({
      pid: 4322,
      unref,
    } as unknown as ChildProcess);

    const resultPromise = startDaemon({ force: true });
    // 500ms portReleaseDelay + 1500ms healthCheck
    await vi.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;

    expect(result).toEqual({ pid: 4322, restarted: true });
    expect(mocked.spawn).toHaveBeenCalled();
    expect(unref).toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it('removes stale pid, spawns daemon, and writes new pid', async () => {
    vi.useFakeTimers();
    writePidFile(getPidFilePath(), 999_999_999);
    vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
      if (signal === 0) {
        if (pid === 4321) return true; // Health check: spawned child is alive
        throw new Error('ESRCH');
      }
      return true;
    }) as typeof process.kill);

    const unref = vi.fn();
    mocked.spawn.mockReturnValue({
      pid: 4321,
      unref,
    } as unknown as ChildProcess);

    const resultPromise = startDaemon();
    await vi.advanceTimersByTimeAsync(1500);
    const result = await resultPromise;

    expect(result).toEqual({ pid: 4321 });
    expect(mocked.spawn).toHaveBeenCalledWith(
      process.execPath,
      [process.argv[1], 'dev'],
      expect.objectContaining({ detached: true, cwd: process.cwd() }),
    );
    expect(unref).toHaveBeenCalled();
  });

  it('returns error when spawn has no child pid', async () => {
    removePidFile(getPidFilePath());
    vi.spyOn(process, 'kill').mockImplementation(((_pid: number, signal?: string | number) => {
      if (signal === 0) {
        throw new Error('ESRCH');
      }
      return true;
    }) as typeof process.kill);

    mocked.spawn.mockReturnValue({
      pid: undefined,
      unref: vi.fn(),
    } as unknown as ChildProcess);

    const result = await startDaemon();
    expect(result).toEqual({ error: 'Failed to spawn daemon process' });
  });

  it('creates log directory when it does not exist', async () => {
    vi.useFakeTimers();
    const originalCwd = process.cwd();
    const tempCwd = fs.mkdtempSync('/tmp/daemon-logdir-');
    process.chdir(tempCwd);

    try {
      removePidFile(getPidFilePath());
      vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
        if (signal === 0) {
          if (pid === 6789) return true;
          throw new Error('ESRCH');
        }
        return true;
      }) as typeof process.kill);

      const logDir = dirname(getLogFilePath());
      fs.rmSync(logDir, { recursive: true, force: true });

      mocked.spawn.mockReturnValue({
        pid: 6789,
        unref: vi.fn(),
      } as unknown as ChildProcess);

      const resultPromise = startDaemon();
      await vi.advanceTimersByTimeAsync(1500);
      const result = await resultPromise;

      expect(result).toEqual({ pid: 6789 });
      expect(fs.existsSync(logDir)).toBe(true);
      if (process.platform !== 'win32') {
        expect(fs.statSync(logDir).mode & 0o777).toBe(0o700);
        expect(fs.statSync(getLogFilePath()).mode & 0o777).toBe(0o600);
      }
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempCwd, { recursive: true, force: true });
    }
  });

  it('uses empty entrypoint arg when process.argv[1] is undefined', async () => {
    vi.useFakeTimers();
    const originalArgv1 = process.argv[1];
    const argv = process.argv as unknown as Array<string | undefined>;
    argv[1] = undefined;

    try {
      removePidFile(getPidFilePath());
      vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
        if (signal === 0) {
          if (pid === 6790) return true;
          throw new Error('ESRCH');
        }
        return true;
      }) as typeof process.kill);

      mocked.spawn.mockReturnValue({
        pid: 6790,
        unref: vi.fn(),
      } as unknown as ChildProcess);

      const resultPromise = startDaemon();
      await vi.advanceTimersByTimeAsync(1500);
      const result = await resultPromise;

      expect(result).toEqual({ pid: 6790 });
      expect(mocked.spawn).toHaveBeenCalledWith(
        process.execPath,
        ['', 'dev'],
        expect.objectContaining({ detached: true, cwd: process.cwd() }),
      );
    } finally {
      argv[1] = originalArgv1;
    }
  });

  it('returns error when daemon crashes immediately after start', async () => {
    vi.useFakeTimers();
    removePidFile(getPidFilePath());
    vi.spyOn(process, 'kill').mockImplementation(((_pid: number, signal?: string | number) => {
      if (signal === 0) {
        throw new Error('ESRCH'); // All PIDs "dead" including spawned child
      }
      return true;
    }) as typeof process.kill);

    const unref = vi.fn();
    mocked.spawn.mockReturnValue({
      pid: 5555,
      unref,
    } as unknown as ChildProcess);

    const resultPromise = startDaemon();
    await vi.advanceTimersByTimeAsync(1500);
    const result = await resultPromise;

    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('Daemon exited immediately');
    expect(fs.existsSync(getPidFilePath())).toBe(false);
  });

  it('includes log tail when daemon crashes immediately after start', async () => {
    vi.useFakeTimers();
    const originalCwd = process.cwd();
    const tempCwd = fs.mkdtempSync('/tmp/daemon-logtail-');
    process.chdir(tempCwd);
    try {
      removePidFile(getPidFilePath());
      const logPath = getLogFilePath();
      fs.mkdirSync(dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, 'line-1\nline-2\n', 'utf-8');

      vi.spyOn(process, 'kill').mockImplementation(((_pid: number, signal?: string | number) => {
        if (signal === 0) {
          throw new Error('ESRCH');
        }
        return true;
      }) as typeof process.kill);

      mocked.spawn.mockReturnValue({
        pid: 7777,
        unref: vi.fn(),
      } as unknown as ChildProcess);

      const resultPromise = startDaemon();
      await vi.advanceTimersByTimeAsync(1500);
      const result = await resultPromise;

      expect((result as { error: string }).error).toContain(
        'Daemon exited immediately after start.',
      );
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempCwd, { recursive: true, force: true });
    }
  });

  it('returns immediate-exit error even when log tail read fails', async () => {
    vi.useFakeTimers();
    removePidFile(getPidFilePath());
    const logPath = getLogFilePath();
    fs.rmSync(logPath, { recursive: true, force: true });
    vi.spyOn(process, 'kill').mockImplementation(((_pid: number, signal?: string | number) => {
      if (signal === 0) {
        throw new Error('ESRCH');
      }
      return true;
    }) as typeof process.kill);

    mocked.spawn.mockReturnValue({
      pid: 8888,
      unref: vi.fn(),
    } as unknown as ChildProcess);

    const resultPromise = startDaemon();
    fs.rmSync(logPath, { recursive: true, force: true });
    fs.mkdirSync(logPath, { recursive: true });
    await vi.advanceTimersByTimeAsync(1500);
    const result = await resultPromise;

    expect(result).toEqual({ error: 'Daemon exited immediately after start.' });
    expect(fs.existsSync(getPidFilePath())).toBe(false);
    fs.rmSync(logPath, { recursive: true, force: true });
  });
});
