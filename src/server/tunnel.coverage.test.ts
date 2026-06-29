/**
 * Coverage tests for tunnel.ts — targets uncovered lines:
 * 72 (stop catch block when terminateProcess throws),
 * 158-162 (URL timeout when cloudflared never outputs URL),
 * 201 (restart spawnAndWait failure logging).
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter, Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudflareTunnel } from './tunnel.js';

const terminateProcessMock = vi.fn();
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../utils/platform.js', () => ({
  resolveCommand: vi.fn((name: string) => (name === 'cloudflared' ? '/usr/bin/cloudflared' : null)),
  terminateProcess: (...args: unknown[]) => terminateProcessMock(...args),
}));
vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function createMockProcess(): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new Readable({ read() {} });
  proc.kill = vi.fn();
  Object.defineProperty(proc, 'pid', { value: 12345, writable: true });
  return proc;
}

describe('CloudflareTunnel coverage', () => {
  let mockProc: ChildProcess;

  beforeEach(() => {
    mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc);
    terminateProcessMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Line 72: stop() when terminateProcess throws (catch block with comment "Process may already be gone")
  it('stop() handles terminateProcess throwing gracefully', async () => {
    const tunnel = new CloudflareTunnel({ localPort: 3738 });
    const startPromise = tunnel.start();
    mockProc.stderr?.emit('data', Buffer.from('https://test-stop.trycloudflare.com'));
    await startPromise;

    terminateProcessMock.mockImplementation(() => {
      throw new Error('ESRCH: no such process');
    });

    // Should not throw
    tunnel.stop();
    expect(terminateProcessMock).toHaveBeenCalledWith(12345);
  });

  // Lines 158-162: URL timeout fires when cloudflared never outputs the URL
  it('rejects with timeout when cloudflared does not output URL in time', async () => {
    vi.useFakeTimers();
    const tunnel = new CloudflareTunnel({ localPort: 3738 });
    const startPromise = tunnel.start().catch((err: Error) => err);

    // Advance past the URL timeout (30s default from TIMEOUTS.tunnelUrl)
    await vi.advanceTimersByTimeAsync(31_000);

    const result = await startPromise;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/Timed out waiting for cloudflared URL/);
    // The process kill is called via proc.kill('SIGTERM')
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');

    tunnel.stop();
    vi.useRealTimers();
  });

  // Line 201: restart failed — spawnAndWait rejects during auto-restart
  it('logs error when restart spawnAndWait fails', async () => {
    vi.useFakeTimers();
    const { logger } = await import('../utils/logger.js');
    const tunnel = new CloudflareTunnel({ localPort: 3738 });
    const startPromise = tunnel.start();
    mockProc.stderr?.emit('data', Buffer.from('https://restart-fail.trycloudflare.com'));
    await startPromise;

    // Prepare a second mock process that will fail on start (emits error immediately)
    const failProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(failProc);

    // Simulate crash of original process
    mockProc.emit('exit', 1);

    // Advance past RESTART_DELAY_MS to trigger restart
    await vi.advanceTimersByTimeAsync(5_000);

    // The restart spawns a new process; simulate it failing immediately with error
    failProc.emit('error', new Error('spawn ENOENT'));

    // Wait a tick for the catch handler to run
    await vi.advanceTimersByTimeAsync(100);

    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      'tunnel_restart_failed',
      expect.objectContaining({ error: expect.stringContaining('ENOENT') }),
    );

    tunnel.stop();
    vi.useRealTimers();
  });
});
