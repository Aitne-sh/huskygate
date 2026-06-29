/**
 * Coverage tests for orchestrator-shared — targets uncovered lines 195-200:
 * startHeartbeat interval body: writableEnded check and write error handling.
 */
import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_INTERVAL_MS, startHeartbeat } from './orchestrator-shared.js';

describe('orchestrator-shared coverage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('heartbeat writes when response is open', () => {
    vi.useFakeTimers();
    const writeFn = vi.fn();
    const res = { writableEnded: false, write: writeFn };
    const timer = startHeartbeat(res as unknown as ServerResponse);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(writeFn).toHaveBeenCalledWith(': heartbeat\n\n');

    clearInterval(timer);
  });

  it('heartbeat skips when writableEnded is true (line 195)', () => {
    vi.useFakeTimers();
    const writeFn = vi.fn();
    const res = { writableEnded: true, write: writeFn };
    const timer = startHeartbeat(res as unknown as ServerResponse);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(writeFn).not.toHaveBeenCalled();

    clearInterval(timer);
  });

  it('heartbeat catches write errors gracefully (lines 198-199)', () => {
    vi.useFakeTimers();
    const res = {
      writableEnded: false,
      write: vi.fn(() => {
        throw new Error('connection reset');
      }),
    };
    const timer = startHeartbeat(res as unknown as ServerResponse);

    // Should not throw
    expect(() => vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)).not.toThrow();

    clearInterval(timer);
  });

  it('heartbeat writes multiple times across intervals', () => {
    vi.useFakeTimers();
    const writeFn = vi.fn();
    const res = { writableEnded: false, write: writeFn };
    const timer = startHeartbeat(res as unknown as ServerResponse);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);
    expect(writeFn).toHaveBeenCalledTimes(3);

    clearInterval(timer);
  });
});
