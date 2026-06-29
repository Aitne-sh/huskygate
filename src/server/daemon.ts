/** @module server/daemon — Daemon lifecycle helpers (start, stop, status, PID management). */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  ensurePrivateDirectory,
  ensurePrivateFile,
  openPrivateAppendFile,
  writePrivateFile,
} from '../utils/fs-security.js';
import {
  getDetachedSpawnOptions,
  findPidOnPort as platformFindPidOnPort,
  terminateProcess,
} from '../utils/platform.js';

const PID_FILE = 'huskygate.pid';
const LOG_FILE = 'huskygate.log';
export const HEALTH_CHECK_MS = 1500;

function getDataDir(): string {
  return (
    process.env.HUSKYGATE_DATA_DIR ||
    process.env.HUSKYGATE_TEST_DATA_DIR ||
    resolve(process.cwd(), 'data')
  );
}

export function getPidFilePath(): string {
  return resolve(getDataDir(), PID_FILE);
}

export function getLogFilePath(): string {
  return resolve(getDataDir(), LOG_FILE);
}

export function readPidFile(pidPath: string): number | null {
  try {
    const content = readFileSync(pidPath, 'utf-8').trim();
    const pid = Number.parseInt(content, 10);
    if (Number.isNaN(pid) || pid <= 0) return null;
    return pid;
  } catch {
    return null;
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface ServerStatus {
  running: boolean;
  pid: number | null;
  pidFile: string;
  logFile: string;
}

export function getServerStatus(pidPath: string): ServerStatus {
  const logFile = getLogFilePath();
  const pid = readPidFile(pidPath);
  if (pid === null) {
    return { running: false, pid: null, pidFile: pidPath, logFile };
  }
  const running = isProcessRunning(pid);
  return { running, pid: running ? pid : null, pidFile: pidPath, logFile };
}

export function writePidFile(pidPath: string, pid: number): void {
  ensurePrivateDirectory(dirname(pidPath));
  writePrivateFile(pidPath, String(pid), { encoding: 'utf-8' });
}

export function removePidFile(pidPath: string): void {
  try {
    unlinkSync(pidPath);
  } catch {
    // ignore if already removed
  }
}

/** Find the PID of a process listening on a given TCP port. Returns null if none found. */
export const findPidOnPort = platformFindPidOnPort;

function readLogTail(logPath: string, lines: number): string {
  try {
    const content = readFileSync(logPath, 'utf-8');
    const allLines = content.split('\n').filter(Boolean);
    return allLines.slice(-lines).join('\n');
  } catch {
    return '';
  }
}

/** Wait for a process to be alive after a brief delay. Returns true if alive. */
export async function waitForProcessAlive(
  pid: number,
  delayMs = HEALTH_CHECK_MS,
): Promise<boolean> {
  await new Promise((r) => setTimeout(r, delayMs));
  return isProcessRunning(pid);
}

/** Delay to allow port release after stopping a process. Exported for mocking in tests. */
export async function portReleaseDelay(ms = 500): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function startDaemon(opts?: { force?: boolean }): Promise<
  { pid: number; restarted?: boolean } | { alreadyRunning: true; pid: number } | { error: string }
> {
  const pidPath = getPidFilePath();
  const status = getServerStatus(pidPath);

  if (status.running && status.pid !== null) {
    if (!opts?.force) {
      return { alreadyRunning: true, pid: status.pid };
    }
    // Force mode: stop existing process first
    stopDaemon();
    await portReleaseDelay();
  }

  // Clean up stale PID file
  if (existsSync(pidPath)) {
    removePidFile(pidPath);
  }

  const logPath = getLogFilePath();
  const logDir = dirname(logPath);
  ensurePrivateDirectory(logDir);

  const logFd = openPrivateAppendFile(logPath);

  const child = spawn(
    process.execPath,
    [process.argv[1] ?? '', 'dev'],
    getDetachedSpawnOptions({
      detached: true,
      stdio: ['ignore', logFd, logFd],
      cwd: process.cwd(),
    }),
  );

  closeSync(logFd);
  ensurePrivateFile(logPath);

  if (child.pid === undefined) {
    return { error: 'Failed to spawn daemon process' };
  }

  writePidFile(pidPath, child.pid);
  child.unref();

  // Health check: wait briefly and verify the process didn't crash immediately
  const alive = await waitForProcessAlive(child.pid);
  if (!alive) {
    removePidFile(pidPath);
    const tail = readLogTail(logPath, 10);
    return { error: `Daemon exited immediately after start.${tail ? `\n${tail}` : ''}` };
  }

  const restarted = opts?.force && status.running;
  return restarted ? { pid: child.pid, restarted: true } : { pid: child.pid };
}

export function stopDaemon(
  fallbackPort?: number,
): { stopped: true; pid: number } | { error: string } {
  const pidPath = getPidFilePath();
  const status = getServerStatus(pidPath);

  if (!status.running || status.pid === null) {
    // PID file stale/missing — try port-based detection as fallback
    if (fallbackPort) {
      const portPid = findPidOnPort(fallbackPort);
      if (portPid !== null) {
        try {
          terminateProcess(portPid);
        } catch {
          // Process may have already exited
        }
        if (existsSync(pidPath)) {
          removePidFile(pidPath);
        }
        return { stopped: true, pid: portPid };
      }
    }

    // Idempotent: clean up stale PID file if present
    if (existsSync(pidPath)) {
      removePidFile(pidPath);
    }
    return { error: 'Server is not running' };
  }

  const pid = status.pid;
  try {
    terminateProcess(pid);
  } catch {
    // Process may have already exited
  }

  removePidFile(pidPath);
  return { stopped: true, pid };
}
