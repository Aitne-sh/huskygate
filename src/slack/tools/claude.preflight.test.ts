import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Driver, DriverEvent, RunResult } from '../../runner/types.js';
import { runClaudeMcpAuthPreflight } from './claude.js';

const { refreshMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
}));

vi.mock('../../runner/claude-mcp-token-refresh.js', () => ({
  refreshClaudeMcpOAuthToken: refreshMock,
}));

interface FakeRun {
  events: DriverEvent[];
  exitCode: number | null;
  errorKind: string | null;
}

/**
 * Creates a fake runner that returns different results based on call sequence.
 * Tracks which args were passed to each call for assertion purposes.
 */
function createFakeRunner(sequence: FakeRun[]): {
  run: (
    driver: Driver,
    args: string[],
    env: Record<string, string>,
    cwd: string,
    onEvent: (event: DriverEvent) => void,
  ) => Promise<RunResult>;
  calls: Array<{ args: string[] }>;
} {
  let idx = 0;
  const calls: Array<{ args: string[] }> = [];
  return {
    calls,
    async run(_driver, args, _env, _cwd, onEvent) {
      calls.push({ args: [...args] });
      const current = sequence[Math.min(idx, sequence.length - 1)] ?? {
        events: [],
        exitCode: null,
        errorKind: 'missing_fake_run',
      };
      idx += 1;
      for (const event of current.events) {
        onEvent(event);
      }
      return {
        exitCode: current.exitCode,
        events: current.events,
        errorKind: current.errorKind,
      };
    },
  };
}

// Helpers for creating common fake run results
function mcpListConnected(server: string): FakeRun {
  return {
    events: [
      { type: 'text', content: `${server}: http://localhost:8000/mcp (HTTP) - ✓ Connected` },
    ],
    exitCode: 0,
    errorKind: null,
  };
}

function mcpListNeedsAuth(server: string): FakeRun {
  return {
    events: [
      {
        type: 'text',
        content: `${server}: http://localhost:8000/mcp (HTTP) - ! Needs authentication`,
      },
    ],
    exitCode: 0,
    errorKind: null,
  };
}

function mcpListDisconnected(server: string): FakeRun {
  return {
    events: [
      { type: 'text', content: `${server}: http://localhost:8000/mcp (HTTP) - ✗ Disconnected` },
    ],
    exitCode: 0,
    errorKind: null,
  };
}

function mcpListError(server: string): FakeRun {
  return {
    events: [{ type: 'text', content: `${server}: http://localhost:8000/mcp (HTTP) - ✗ Error` }],
    exitCode: 0,
    errorKind: null,
  };
}

function mcpAuthCommandSuccess(): FakeRun {
  return {
    events: [{ type: 'text', content: 'MCP authentication successful.' }],
    exitCode: 0,
    errorKind: null,
  };
}

function mcpAuthCommandFailed(): FakeRun {
  return {
    events: [{ type: 'error', content: 'Authentication failed' }],
    exitCode: 1,
    errorKind: 'exit_1',
  };
}

describe('runClaudeMcpAuthPreflight', () => {
  beforeEach(() => {
    refreshMock.mockReset();
  });

  it('returns ok when server is already connected', async () => {
    const runner = createFakeRunner([mcpListConnected('aws-api')]);

    const result = await runClaudeMcpAuthPreflight(runner as never, {}, '/tmp/workdir', 'aws-api');

    expect(result.ok).toBe(true);
    expect(result.requiredServer).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
    // Should only call `claude mcp list` once
    expect(runner.calls).toHaveLength(1);
  });

  it('returns server_not_found without auth-required marker', async () => {
    const runner = createFakeRunner([
      {
        events: [{ type: 'text', content: 'Checking MCP server health...' }],
        exitCode: 0,
        errorKind: null,
      },
    ]);

    const result = await runClaudeMcpAuthPreflight(runner as never, {}, '/tmp/workdir', 'aws-api');

    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('server_not_found');
    expect(result.requiredServer).toBeNull();
    expect(result.tokenRefreshFailed).toBe(false);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('does not treat generic connection failure as auth-required', async () => {
    const runner = createFakeRunner([
      {
        events: [
          {
            type: 'error',
            content: 'MCP connection error for server aws-api: connection refused',
          },
        ],
        exitCode: 1,
        errorKind: 'exit_1',
      },
    ]);

    const result = await runClaudeMcpAuthPreflight(runner as never, {}, '/tmp/workdir', 'aws-api');

    expect(result.ok).toBe(false);
    expect(result.requiredServer).toBeNull();
    expect(result.errorKind).toBe('exit_1');
    expect(result.tokenRefreshFailed).toBe(false);
  });

  // --- /mcp auth command succeeds ---

  it('runs /mcp auth command when server needs auth and succeeds', async () => {
    // Sequence: mcp list (needs auth) → /mcp auth (ok) → mcp list (connected)
    const runner = createFakeRunner([
      mcpListNeedsAuth('aws-api'),
      mcpAuthCommandSuccess(),
      mcpListConnected('aws-api'),
    ]);

    const result = await runClaudeMcpAuthPreflight(runner as never, {}, '/tmp/workdir', 'aws-api');

    expect(result.ok).toBe(true);
    expect(result.requiredServer).toBeNull();
    expect(result.interactiveFailure).toBe(false);
    expect(result.tokenRefreshFailed).toBe(false);
    // /mcp auth succeeded so token refresh should NOT be called
    expect(refreshMock).not.toHaveBeenCalled();
    // 3 runner calls: mcp list, /mcp auth, mcp list re-check
    expect(runner.calls).toHaveLength(3);
  });

  it('runs /mcp auth command when server is disconnected and succeeds', async () => {
    // Sequence: mcp list (disconnected) → /mcp auth (ok) → mcp list (connected)
    const runner = createFakeRunner([
      mcpListDisconnected('aws-api'),
      mcpAuthCommandSuccess(),
      mcpListConnected('aws-api'),
    ]);

    const result = await runClaudeMcpAuthPreflight(runner as never, {}, '/tmp/workdir', 'aws-api');

    expect(result.ok).toBe(true);
    expect(result.requiredServer).toBeNull();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // --- /mcp auth fails, token refresh fallback succeeds ---

  it('falls back to token refresh when /mcp auth command fails', async () => {
    refreshMock.mockResolvedValue({ refreshed: true, reason: 'success' });
    // Sequence: mcp list (needs auth) → /mcp auth (fail) → mcp list (connected after refresh)
    const runner = createFakeRunner([
      mcpListNeedsAuth('aws-api'),
      mcpAuthCommandFailed(),
      mcpListConnected('aws-api'),
    ]);

    const result = await runClaudeMcpAuthPreflight(runner as never, {}, '/tmp/workdir', 'aws-api');

    expect(result.ok).toBe(true);
    expect(result.requiredServer).toBeNull();
    expect(result.tokenRefreshFailed).toBe(false);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  // --- Both /mcp auth and token refresh fail ---

  it('returns auth-required when both /mcp auth and token refresh fail', async () => {
    refreshMock.mockResolvedValue({ refreshed: false, reason: 'no_credentials_file' });
    // Sequence: mcp list (needs auth) → /mcp auth (fail)
    // Token refresh also fails — no re-check call
    const runner = createFakeRunner([mcpListNeedsAuth('aws-api'), mcpAuthCommandFailed()]);

    const result = await runClaudeMcpAuthPreflight(runner as never, {}, '/tmp/workdir', 'aws-api');

    expect(result.ok).toBe(false);
    expect(result.requiredServer).toBe('aws-api');
    expect(result.tokenRefreshFailed).toBe(true);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('detects "Authentication required" status as needsAuth', async () => {
    refreshMock.mockResolvedValue({ refreshed: false, reason: 'no_credentials_file' });
    const runner = createFakeRunner([
      {
        events: [
          {
            type: 'text',
            content: 'aws-api: http://localhost:8000/mcp (HTTP) - ! Authentication required',
          },
        ],
        exitCode: 0,
        errorKind: null,
      },
      mcpAuthCommandFailed(),
    ]);

    const result = await runClaudeMcpAuthPreflight(runner as never, {}, '/tmp/workdir', 'aws-api');

    expect(result.ok).toBe(false);
    expect(result.requiredServer).toBe('aws-api');
    expect(result.tokenRefreshFailed).toBe(true);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('attempts /mcp auth when server is found but not connected (✗ status)', async () => {
    refreshMock.mockResolvedValue({ refreshed: false, reason: 'no_credentials_file' });
    const runner = createFakeRunner([mcpListError('aws-api'), mcpAuthCommandFailed()]);

    const result = await runClaudeMcpAuthPreflight(runner as never, {}, '/tmp/workdir', 'aws-api');

    expect(result.ok).toBe(false);
    expect(result.requiredServer).toBe('aws-api');
    expect(result.tokenRefreshFailed).toBe(true);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('retries with delay after token refresh when first recheck fails', async () => {
    vi.useFakeTimers();
    refreshMock.mockResolvedValue({ refreshed: true, reason: 'success' });
    // Sequence: mcp list (needs auth) → /mcp auth (fail) → mcp list (still disconnected) → mcp list (connected after delay)
    const runner = createFakeRunner([
      mcpListNeedsAuth('aws-api'),
      mcpAuthCommandFailed(),
      mcpListNeedsAuth('aws-api'),
      mcpListConnected('aws-api'),
    ]);

    const promise = runClaudeMcpAuthPreflight(runner as never, {}, '/tmp/workdir', 'aws-api');
    // Advance past the 2s retry delay
    await vi.advanceTimersByTimeAsync(2500);
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(result.requiredServer).toBeNull();
    expect(result.tokenRefreshFailed).toBe(false);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    // 4 runner calls: mcp list, /mcp auth, mcp list (fail), mcp list (success after delay)
    expect(runner.calls).toHaveLength(4);
    vi.useRealTimers();
  });

  it('retries with delay after /mcp auth command when first recheck fails', async () => {
    vi.useFakeTimers();
    // Sequence: mcp list (needs auth) → /mcp auth (ok) → mcp list (still disconnected) → mcp list (connected after delay)
    const runner = createFakeRunner([
      mcpListNeedsAuth('aws-api'),
      mcpAuthCommandSuccess(),
      mcpListNeedsAuth('aws-api'),
      mcpListConnected('aws-api'),
    ]);

    const promise = runClaudeMcpAuthPreflight(runner as never, {}, '/tmp/workdir', 'aws-api');
    await vi.advanceTimersByTimeAsync(2500);
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(result.requiredServer).toBeNull();
    expect(result.interactiveFailure).toBe(false);
    // Token refresh should NOT be called since /mcp auth succeeded on retry
    expect(refreshMock).not.toHaveBeenCalled();
    // 4 runner calls: mcp list, /mcp auth, mcp list (fail), mcp list (success after delay)
    expect(runner.calls).toHaveLength(4);
    vi.useRealTimers();
  });

  it('recovers when /mcp auth fails but token refresh succeeds for disconnected server', async () => {
    refreshMock.mockResolvedValue({ refreshed: true, reason: 'success' });
    // Sequence: mcp list (disconnected) → /mcp auth (fail) → mcp list (connected after refresh)
    const runner = createFakeRunner([
      mcpListDisconnected('aws-api'),
      mcpAuthCommandFailed(),
      mcpListConnected('aws-api'),
    ]);

    const result = await runClaudeMcpAuthPreflight(runner as never, {}, '/tmp/workdir', 'aws-api');

    expect(result.ok).toBe(true);
    expect(result.requiredServer).toBeNull();
    expect(result.tokenRefreshFailed).toBe(false);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('handles auth-command success without connectivity and refresh still not connected', async () => {
    vi.useFakeTimers();
    refreshMock.mockResolvedValue({ refreshed: true, reason: 'success' });
    // Sequence:
    // 1) initial mcp list -> needs auth
    // 2) /mcp auth -> success
    // 3) recheck #1 -> still needs auth
    // 4) recheck #2 after delay -> still needs auth
    // 5) recheck after token refresh #1 -> still needs auth
    // 6) recheck after token refresh #2 -> still needs auth
    const runner = createFakeRunner([
      mcpListNeedsAuth('aws-api'),
      mcpAuthCommandSuccess(),
      mcpListNeedsAuth('aws-api'),
      mcpListNeedsAuth('aws-api'),
      mcpListNeedsAuth('aws-api'),
      mcpListNeedsAuth('aws-api'),
    ]);

    const promise = runClaudeMcpAuthPreflight(runner as never, {}, '/tmp/workdir', 'aws-api');
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.requiredServer).toBe('aws-api');
    expect(result.tokenRefreshFailed).toBe(false);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(runner.calls).toHaveLength(6);
    vi.useRealTimers();
  });
});
