import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  spawn: vi.fn(),
  readlineCloses: [] as Array<ReturnType<typeof vi.fn>>,
  isMacOS: false,
}));

vi.mock('node:child_process', () => ({
  spawn: mocked.spawn,
}));

vi.mock('node:readline', () => ({
  createInterface: ({ input }: { input: EventEmitter }) => ({
    on: (event: string, cb: (line: string) => void) => {
      input.on(event, cb);
      return undefined;
    },
    close: (() => {
      const close = vi.fn();
      mocked.readlineCloses.push(close);
      return close;
    })(),
  }),
}));

vi.mock('../utils/platform.js', () => ({
  get isMacOS() {
    return mocked.isMacOS;
  },
  getDetachedSpawnOptions: (base: Record<string, unknown>) => base,
  killProcessTree: (pid: number, signal: string) => {
    process.kill(-pid, signal);
  },
}));

import { Runner } from './runner.js';

interface FakeProc extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
}

function createFakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.pid = 1234;
  return proc;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocked.readlineCloses.length = 0;
  mocked.isMacOS = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Runner', () => {
  it('spawns process, parses stdout/stderr events, and resolves on close', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);

    const onEvent = vi.fn();
    const driver = {
      buildCommand: () => 'tool',
      parseEvent: (line: string) => ({ type: 'text', content: line }),
      parseStderr: (line: string) => ({ type: 'status', content: `stderr:${line}` }),
      extractSessionState: () => ({}),
    };

    const runner = new Runner({
      maxRuntimeSec: 10,
      noOutputTimeoutSec: 10,
    } as never);

    const promise = runner.run(driver as never, ['--x'], {}, '/tmp', onEvent);

    proc.stdout.emit('line', 'hello');
    proc.stderr.emit('line', 'warn');
    proc.emit('close', 0);
    const result = await promise;

    expect(mocked.spawn).toHaveBeenCalledWith(
      'tool',
      ['--x'],
      expect.objectContaining({ cwd: '/tmp', detached: true }),
    );
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(result.exitCode).toBe(0);
    expect(result.errorKind).toBeNull();
    expect(result.events).toEqual([
      { type: 'text', content: 'hello' },
      { type: 'status', content: 'stderr:warn' },
    ]);
    expect(runner.isRunning()).toBe(false);
  });

  it('supports args with exec subcommand and pre-exec sandbox flags', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);

    const runner = new Runner({
      maxRuntimeSec: 10,
      noOutputTimeoutSec: 10,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        extractSessionState: () => ({}),
      } as never,
      ['--sandbox', 'workspace-write', 'exec', 'hello'],
      {},
      '/tmp',
      () => undefined,
    );

    proc.emit('close', 0);
    const result = await promise;

    expect(mocked.spawn).toHaveBeenCalledWith(
      'tool',
      ['--sandbox', 'workspace-write', 'exec', 'hello'],
      expect.objectContaining({ cwd: '/tmp', detached: true }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.errorKind).toBeNull();
  });

  it('returns spawn_error when child process emits error', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);
    const runner = new Runner({
      maxRuntimeSec: 10,
      noOutputTimeoutSec: 10,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    proc.emit('error', new Error('ENOENT'));
    const result = await promise;
    expect(result.errorKind).toBe('spawn_error: ENOENT');
    expect(result.exitCode).toBeNull();
  });

  it('runs cleanup only once when both error and close fire', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);
    const runner = new Runner({
      maxRuntimeSec: 10,
      noOutputTimeoutSec: 10,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    expect(mocked.readlineCloses).toHaveLength(2);

    proc.emit('error', new Error('ENOENT'));
    proc.emit('close', 1);
    const result = await promise;

    expect(result.errorKind).toBe('spawn_error: ENOENT');
    expect(mocked.readlineCloses[0]).toHaveBeenCalledTimes(1);
    expect(mocked.readlineCloses[1]).toHaveBeenCalledTimes(1);
    expect(runner.isRunning()).toBe(false);
  });

  it('does not re-arm no-output timers from late stdout after close', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);

    const runner = new Runner({
      maxRuntimeSec: 10,
      noOutputTimeoutSec: 10,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: (line: string) => ({ type: 'text', content: line }),
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    proc.emit('close', 0);
    await promise;
    expect(vi.getTimerCount()).toBe(0);

    proc.stdout.emit('line', 'late output');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends SIGINT then SIGKILL when kill is requested', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const runner = new Runner({
      maxRuntimeSec: 30,
      noOutputTimeoutSec: 30,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    runner.kill('permission_approval_needed');
    expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGINT');

    vi.advanceTimersByTime(2000);
    expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGKILL');

    proc.emit('close', 130);
    const result = await promise;
    expect(result.errorKind).toBe('permission_approval_needed');
    killSpy.mockRestore();
  });

  it('kills process on max_runtime_timeout', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const runner = new Runner({
      maxRuntimeSec: 5,
      noOutputTimeoutSec: 60,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: (line: string) => ({ type: 'text', content: line }),
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    // Keep sending output to prevent no-output timeout
    proc.stdout.emit('line', 'alive');

    // Advance past max runtime
    vi.advanceTimersByTime(5000);
    expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGINT');

    proc.emit('close', 137);
    const result = await promise;
    expect(result.errorKind).toBe('max_runtime_timeout');
    killSpy.mockRestore();
  });

  it('retries on no_output_timeout before killing', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const runner = new Runner({
      maxRuntimeSec: 600,
      noOutputTimeoutSec: 2,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    // First 2 timeouts should retry (not kill)
    vi.advanceTimersByTime(2000);
    expect(killSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(killSpy).not.toHaveBeenCalled();

    // Third timeout should kill
    vi.advanceTimersByTime(2000);
    expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGINT');

    proc.emit('close', 137);
    const result = await promise;
    expect(result.errorKind).toBe('no_output_timeout');
    killSpy.mockRestore();
  });

  it('resets no-output retry count when output is received', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const runner = new Runner({
      maxRuntimeSec: 600,
      noOutputTimeoutSec: 2,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: (line: string) => ({ type: 'text', content: line }),
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    // Two retries
    vi.advanceTimersByTime(2000);
    vi.advanceTimersByTime(2000);

    // Output arrives — should reset retry count
    proc.stdout.emit('line', 'data');

    // Now it should take 3 more timeouts to kill
    vi.advanceTimersByTime(2000);
    expect(killSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(killSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(killSpy).toHaveBeenCalled();

    proc.emit('close', 137);
    await promise;
    killSpy.mockRestore();
  });

  it('reports non-zero exit code as errorKind', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);

    const runner = new Runner({
      maxRuntimeSec: 10,
      noOutputTimeoutSec: 10,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    proc.emit('close', 1);
    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(result.errorKind).toBe('exit_1');
  });

  it('falls back to default stderr error when parseStderr returns null', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);

    const onEvent = vi.fn();
    const runner = new Runner({
      maxRuntimeSec: 10,
      noOutputTimeoutSec: 10,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        parseStderr: () => null,
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      onEvent,
    );

    proc.stderr.emit('line', 'fatal error');
    proc.emit('close', 1);
    const result = await promise;

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', content: 'fatal error' }),
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.type).toBe('error');
  });

  it('ignores empty stderr lines after sanitization', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);

    const parseStderr = vi.fn();
    const onEvent = vi.fn();
    const runner = new Runner({
      maxRuntimeSec: 10,
      noOutputTimeoutSec: 10,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        parseStderr,
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      onEvent,
    );

    proc.stderr.emit('line', '   ');
    proc.emit('close', 0);
    const result = await promise;

    expect(parseStderr).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
    expect(result.events).toEqual([]);
  });

  it('isRunning returns true while process is active', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);

    const runner = new Runner({
      maxRuntimeSec: 10,
      noOutputTimeoutSec: 10,
    } as never);

    expect(runner.isRunning()).toBe(false);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    expect(runner.isRunning()).toBe(true);

    proc.emit('close', 0);
    await promise;
    expect(runner.isRunning()).toBe(false);
  });

  it('kill is a no-op when no process is running', () => {
    const runner = new Runner({
      maxRuntimeSec: 10,
      noOutputTimeoutSec: 10,
    } as never);

    // Should not throw
    runner.kill('test');
    expect(runner.isRunning()).toBe(false);
  });

  it('second kill call is a no-op', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const runner = new Runner({
      maxRuntimeSec: 30,
      noOutputTimeoutSec: 30,
    } as never);

    runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    runner.kill('first');
    runner.kill('second'); // should be no-op
    expect(killSpy).toHaveBeenCalledTimes(1);

    proc.emit('close', 130);
    killSpy.mockRestore();
  });

  it('sets eventsDropped when events exceed MAX_EVENTS', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);

    const runner = new Runner({
      maxRuntimeSec: 600,
      noOutputTimeoutSec: 600,
    } as never);

    const onEvent = vi.fn();
    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: (line: string) => ({ type: 'text', content: line }),
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      onEvent,
    );

    // Emit 50001 lines to exceed MAX_EVENTS (50000)
    for (let i = 0; i < 50_001; i++) {
      proc.stdout.emit('line', `line-${i}`);
    }

    proc.emit('close', 0);
    const result = await promise;
    expect(result.events).toHaveLength(50_000);
    expect(result.eventsDropped).toBe(true);
    // onEvent is called for every line regardless of storage limit
    expect(onEvent).toHaveBeenCalledTimes(50_001);
  });

  it('sets eventsDropped when stderr arrives after MAX_EVENTS is reached', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);

    const runner = new Runner({
      maxRuntimeSec: 600,
      noOutputTimeoutSec: 600,
    } as never);

    const onEvent = vi.fn();
    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: (line: string) => ({ type: 'text', content: line }),
        parseStderr: (line: string) => ({ type: 'status', content: line }),
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      onEvent,
    );

    for (let i = 0; i < 50_000; i++) {
      proc.stdout.emit('line', `stdout-${i}`);
    }
    proc.stderr.emit('line', 'after-limit');

    proc.emit('close', 1);
    const result = await promise;
    expect(result.events).toHaveLength(50_000);
    expect(result.eventsDropped).toBe(true);
    expect(onEvent).toHaveBeenCalledTimes(50_001);
  });

  it('clears pending SIGKILL timer when process emits error after kill', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const runner = new Runner({
      maxRuntimeSec: 10,
      noOutputTimeoutSec: 10,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    runner.kill('manual');
    expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGINT');

    proc.emit('error', new Error('crashed early'));
    vi.advanceTimersByTime(6000);
    expect(killSpy).toHaveBeenCalledTimes(1);

    const result = await promise;
    expect(result.errorKind).toBe('spawn_error: crashed early');
    killSpy.mockRestore();
  });

  it('swallows process.kill errors during SIGINT and SIGKILL', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('kill failed');
    });

    const runner = new Runner({
      maxRuntimeSec: 10,
      noOutputTimeoutSec: 10,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    expect(() => runner.kill('manual')).not.toThrow();
    vi.advanceTimersByTime(5000);
    expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGINT');
    expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGKILL');

    proc.emit('close', 130);
    await promise;
    killSpy.mockRestore();
  });

  it('uses default kill reason when kill is called without a reason', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);

    const runner = new Runner({
      maxRuntimeSec: 10,
      noOutputTimeoutSec: 10,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    runner.kill();
    proc.emit('close', 130);

    const result = await promise;
    expect(result.errorKind).toBe('killed');
  });

  it('does not reset no-output timer on stderr status events', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const runner = new Runner({
      maxRuntimeSec: 600,
      noOutputTimeoutSec: 2,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        parseStderr: () => ({ type: 'status', content: 'retrying...' }),
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    // Advance 1.5s, emit status stderr (should NOT reset timer)
    vi.advanceTimersByTime(1500);
    proc.stderr.emit('line', 'Attempt 1 failed: Retrying after 30s');

    // Advance another 1s → total 2.5s from start: first timeout fires
    vi.advanceTimersByTime(1000);
    // Should have entered retry (timer fired at 2s, not reset by status stderr)
    // Two more retries needed for kill
    vi.advanceTimersByTime(2000);
    vi.advanceTimersByTime(2000);
    expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGINT');

    proc.emit('close', 137);
    await promise;
    killSpy.mockRestore();
  });

  it('resets no-output timer on stderr error events', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const runner = new Runner({
      maxRuntimeSec: 600,
      noOutputTimeoutSec: 2,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        parseStderr: (line: string) =>
          line.includes('retry')
            ? { type: 'status', content: line }
            : { type: 'error', content: line },
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    // At 1.5s, emit error stderr (SHOULD reset timer)
    vi.advanceTimersByTime(1500);
    proc.stderr.emit('line', 'fatal error');

    // Timer was reset, so another 2s without output → first timeout (retry)
    vi.advanceTimersByTime(2000);
    expect(killSpy).not.toHaveBeenCalled(); // first retry, not killed yet

    // Two more retries
    vi.advanceTimersByTime(2000);
    vi.advanceTimersByTime(2000);
    expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGINT');

    proc.emit('close', 137);
    await promise;
    killSpy.mockRestore();
  });

  it('falls back to default kill reason when internal killReason is null', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);

    const runner = new Runner({
      maxRuntimeSec: 10,
      noOutputTimeoutSec: 10,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    (runner as unknown as { killed: boolean; killReason: string | null }).killed = true;
    (runner as unknown as { killed: boolean; killReason: string | null }).killReason = null;
    proc.emit('close', 130);

    const result = await promise;
    expect(result.errorKind).toBe('killed');
  });

  // ── Sleep detection tests ──

  it('detects system sleep on no-output timer and resets instead of killing', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const runner = new Runner({
      maxRuntimeSec: 600,
      noOutputTimeoutSec: 2,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    // Simulate system sleep: jump Date.now() 30s ahead without firing timers,
    // then advance timers by 2s to trigger the no-output callback.
    const now = Date.now();
    vi.setSystemTime(new Date(now + 30_000));
    vi.advanceTimersByTime(2000);

    // Sleep detected → timer reset, process NOT killed
    expect(killSpy).not.toHaveBeenCalled();

    proc.emit('close', 0);
    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.errorKind).toBeNull();
    killSpy.mockRestore();
  });

  it('detects system sleep on max-runtime timer and extends', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const runner = new Runner({
      maxRuntimeSec: 5,
      noOutputTimeoutSec: 60,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: (line: string) => ({ type: 'text', content: line }),
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    // Keep sending output to prevent no-output timeout
    proc.stdout.emit('line', 'alive');

    // Simulate system sleep: jump Date.now() 20s ahead
    const now = Date.now();
    vi.setSystemTime(new Date(now + 20_000));

    // Fire the max-runtime timer (set for 5000ms)
    vi.advanceTimersByTime(5000);

    // Sleep detected → timer extended, NOT killed
    expect(killSpy).not.toHaveBeenCalled();

    proc.emit('close', 0);
    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.errorKind).toBeNull();
    killSpy.mockRestore();
  });

  it('enforces MAX_SLEEP_RESETS limit on no-output timer', async () => {
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const runner = new Runner({
      maxRuntimeSec: 600,
      noOutputTimeoutSec: 2,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    // Trigger sleep detection 5 times (MAX_SLEEP_RESETS = 5)
    for (let i = 0; i < 5; i++) {
      const now = Date.now();
      vi.setSystemTime(new Date(now + 30_000));
      vi.advanceTimersByTime(2000);
      expect(killSpy).not.toHaveBeenCalled();
    }

    // 6th sleep: resets exhausted → falls through to retry logic
    // Need 3 retries (MAX_NO_OUTPUT_RETRIES) to actually kill
    const now6 = Date.now();
    vi.setSystemTime(new Date(now6 + 30_000));
    vi.advanceTimersByTime(2000); // retry 1
    expect(killSpy).not.toHaveBeenCalled();

    const now7 = Date.now();
    vi.setSystemTime(new Date(now7 + 30_000));
    vi.advanceTimersByTime(2000); // retry 2
    expect(killSpy).not.toHaveBeenCalled();

    const now8 = Date.now();
    vi.setSystemTime(new Date(now8 + 30_000));
    vi.advanceTimersByTime(2000); // retry 3 → kill
    expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGINT');

    proc.emit('close', 137);
    const result = await promise;
    expect(result.errorKind).toBe('no_output_timeout');
    killSpy.mockRestore();
  });

  // ── Caffeinate tests ──

  it('spawns caffeinate on macOS when preventSleep is true', async () => {
    mocked.isMacOS = true;
    const proc = createFakeProc();
    const caffeinateProc = new EventEmitter() as EventEmitter & {
      pid: number;
      unref: ReturnType<typeof vi.fn>;
      kill: ReturnType<typeof vi.fn>;
    };
    caffeinateProc.pid = 5678;
    caffeinateProc.unref = vi.fn();
    caffeinateProc.kill = vi.fn();

    mocked.spawn.mockReturnValueOnce(proc).mockReturnValueOnce(caffeinateProc);

    const runner = new Runner({
      maxRuntimeSec: 10,
      noOutputTimeoutSec: 10,
      preventSleep: true,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    expect(mocked.spawn).toHaveBeenCalledTimes(2);
    expect(mocked.spawn).toHaveBeenNthCalledWith(
      2,
      'caffeinate',
      ['-i', '-w', '1234'],
      expect.objectContaining({ stdio: 'ignore', detached: true }),
    );
    expect(caffeinateProc.unref).toHaveBeenCalled();

    proc.emit('close', 0);
    await promise;

    // caffeinate killed during cleanup
    expect(caffeinateProc.kill).toHaveBeenCalled();
  });

  it('does not spawn caffeinate when preventSleep is not set', async () => {
    mocked.isMacOS = true;
    const proc = createFakeProc();
    mocked.spawn.mockReturnValue(proc);

    const runner = new Runner({
      maxRuntimeSec: 10,
      noOutputTimeoutSec: 10,
    } as never);

    const promise = runner.run(
      {
        buildCommand: () => 'tool',
        parseEvent: () => null,
        extractSessionState: () => ({}),
      } as never,
      [],
      {},
      '/tmp',
      () => undefined,
    );

    // Only the main process spawn, no caffeinate
    expect(mocked.spawn).toHaveBeenCalledTimes(1);

    proc.emit('close', 0);
    await promise;
  });
});
