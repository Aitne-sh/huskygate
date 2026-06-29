import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter, Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudflareTunnel } from './tunnel.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const terminateProcessMock = vi.fn();
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

describe('CloudflareTunnel', () => {
  let mockProc: ChildProcess;

  beforeEach(() => {
    mockProc = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc);
    terminateProcessMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('quick tunnel (no token)', () => {
    it('extracts URL from stderr output', async () => {
      const tunnel = new CloudflareTunnel({ localPort: 3738 });
      const startPromise = tunnel.start();

      // Simulate cloudflared outputting the URL to stderr.
      mockProc.stderr?.emit('data', Buffer.from('INF |  https://random-slug.trycloudflare.com\n'));

      const url = await startPromise;
      expect(url).toBe('https://random-slug.trycloudflare.com');
      expect(tunnel.getPublicUrl()).toBe('https://random-slug.trycloudflare.com');
      expect(spawn).toHaveBeenCalledWith(
        '/usr/bin/cloudflared',
        ['tunnel', '--url', 'http://127.0.0.1:3738'],
        expect.any(Object),
      );

      tunnel.stop();
    });

    it('extracts URL from stdout output', async () => {
      const tunnel = new CloudflareTunnel({ localPort: 3738 });
      const startPromise = tunnel.start();

      mockProc.stdout?.emit('data', Buffer.from('https://another-slug.trycloudflare.com'));

      const url = await startPromise;
      expect(url).toBe('https://another-slug.trycloudflare.com');
      tunnel.stop();
    });

    it('rejects on process exit before URL', async () => {
      const tunnel = new CloudflareTunnel({ localPort: 3738 });
      const startPromise = tunnel.start();

      mockProc.emit('exit', 1);

      await expect(startPromise).rejects.toThrow('cloudflared exited with code 1');
      tunnel.stop();
    });

    it('rejects on process error', async () => {
      const tunnel = new CloudflareTunnel({ localPort: 3738 });
      const startPromise = tunnel.start();

      mockProc.emit('error', new Error('ENOENT'));

      await expect(startPromise).rejects.toThrow('Failed to start cloudflared: ENOENT');
      tunnel.stop();
    });
  });

  describe('named tunnel (with token)', () => {
    it('resolves immediately with null URL', async () => {
      const tunnel = new CloudflareTunnel({
        localPort: 3738,
        token: 'my-tunnel-token',
      });
      const url = await tunnel.start();

      expect(url).toBeNull();
      expect(tunnel.getPublicUrl()).toBeNull();
      expect(spawn).toHaveBeenCalledWith(
        '/usr/bin/cloudflared',
        ['tunnel', 'run'],
        expect.objectContaining({
          env: expect.objectContaining({ TUNNEL_TOKEN: 'my-tunnel-token' }),
        }),
      );

      tunnel.stop();
    });
  });

  describe('stop', () => {
    it('terminates the process via platform utility', async () => {
      const tunnel = new CloudflareTunnel({ localPort: 3738 });
      const startPromise = tunnel.start();

      mockProc.stderr?.emit('data', Buffer.from('https://test.trycloudflare.com'));
      await startPromise;

      tunnel.stop();
      expect(terminateProcessMock).toHaveBeenCalledWith(12345);
    });
  });

  describe('binary not found', () => {
    it('throws when cloudflared is not in PATH', async () => {
      const { resolveCommand } = await import('../utils/platform.js');
      vi.mocked(resolveCommand).mockReturnValue(null);

      const tunnel = new CloudflareTunnel({ localPort: 3738 });
      await expect(tunnel.start()).rejects.toThrow('cloudflared binary not found');
    });
  });

  describe('custom localHost', () => {
    it('uses the provided host in the URL', async () => {
      const tunnel = new CloudflareTunnel({ localPort: 8080, localHost: '0.0.0.0' });
      const startPromise = tunnel.start();

      mockProc.stderr?.emit('data', Buffer.from('https://host-test.trycloudflare.com'));
      await startPromise;

      expect(spawn).toHaveBeenCalledWith(
        '/usr/bin/cloudflared',
        ['tunnel', '--url', 'http://0.0.0.0:8080'],
        expect.any(Object),
      );
      tunnel.stop();
    });
  });

  describe('auto-restart', () => {
    it('schedules a restart when the process exits after URL is ready', async () => {
      vi.useFakeTimers();
      const tunnel = new CloudflareTunnel({ localPort: 3738 });
      const startPromise = tunnel.start();

      mockProc.stderr?.emit('data', Buffer.from('https://restart-test.trycloudflare.com'));
      await startPromise;

      // Prepare a second mock process for the restart.
      const secondProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(secondProc);

      // Simulate crash after successful start.
      mockProc.emit('exit', 1);

      expect(spawn).toHaveBeenCalledTimes(1); // Not yet restarted.

      // Advance past RESTART_DELAY_MS (5000ms).
      await vi.advanceTimersByTimeAsync(5_000);

      expect(spawn).toHaveBeenCalledTimes(2); // Restarted.

      tunnel.stop();
      vi.useRealTimers();
    });

    it('does not restart after stop() is called', async () => {
      vi.useFakeTimers();
      const tunnel = new CloudflareTunnel({ localPort: 3738 });
      const startPromise = tunnel.start();

      mockProc.stderr?.emit('data', Buffer.from('https://no-restart.trycloudflare.com'));
      await startPromise;

      tunnel.stop();
      mockProc.emit('exit', 1);

      await vi.advanceTimersByTimeAsync(10_000);

      // Only the initial spawn — no restart after stop.
      expect(spawn).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('stops restarting after MAX_RESTART_ATTEMPTS (5) exhausted for named tunnels', async () => {
      vi.useFakeTimers();
      const { logger } = await import('../utils/logger.js');
      // Named tunnels: exit handler always calls handleProcessExit (no URL-based
      // counter reset), so the consecutive failure counter increments reliably.
      const tunnel = new CloudflareTunnel({ localPort: 3738, token: 'tok' });
      await tunnel.start();

      // Simulate 6 consecutive crashes.
      for (let i = 0; i < 6; i++) {
        const nextProc = createMockProcess();
        vi.mocked(spawn).mockReturnValue(nextProc);

        mockProc.emit('exit', 1);
        await vi.advanceTimersByTimeAsync(5_000);

        mockProc = nextProc;
      }

      // Attempt counter reaches 6 > MAX_RESTART_ATTEMPTS (5) → gives up.
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'tunnel_restart_exhausted',
        expect.objectContaining({ attempts: 6 }),
      );

      tunnel.stop();
      vi.useRealTimers();
    });
  });

  describe('token security', () => {
    it('passes token via TUNNEL_TOKEN env var, not CLI args', async () => {
      const tunnel = new CloudflareTunnel({
        localPort: 3738,
        token: 'secret-token-value',
      });
      await tunnel.start();

      const spawnArgs = vi.mocked(spawn).mock.calls[0] ?? [];
      const cliArgs = spawnArgs[1] ?? [];
      const spawnOpts = spawnArgs[2] as { env?: Record<string, string> };

      // Token must NOT appear in CLI args (visible via `ps`).
      expect(cliArgs).not.toContain('secret-token-value');
      expect(cliArgs).not.toContain('--token');

      // Token must be in env.
      expect(spawnOpts.env?.TUNNEL_TOKEN).toBe('secret-token-value');

      tunnel.stop();
    });
  });
});
