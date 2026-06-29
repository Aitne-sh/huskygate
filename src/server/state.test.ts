import { afterEach, describe, expect, it, vi } from 'vitest';
import { jobStreamBuffers, startJobStreamBufferCleanup } from './state.js';

describe('server state', () => {
  afterEach(() => {
    jobStreamBuffers.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('removes expired completed buffers and clears the interval on server close', () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const listeners = new Map<string, () => void>();
    const server = {
      on: vi.fn((event: string, handler: () => void) => {
        listeners.set(event, handler);
        return server;
      }),
    };

    const now = Date.now();
    jobStreamBuffers.set('expired', {
      events: [],
      sseRes: null,
      done: true,
      doneAt: now - 61_000,
      assistantChunks: [],
      toolApprovalReceived: false,
      lastToolCharOffset: 0,
      currentCharOffset: 0,
      sawToolEvent: false,
    });
    jobStreamBuffers.set('recent', {
      events: [],
      sseRes: null,
      done: true,
      doneAt: now + 1_000,
      assistantChunks: [],
      toolApprovalReceived: false,
      lastToolCharOffset: 0,
      currentCharOffset: 0,
      sawToolEvent: false,
    });
    jobStreamBuffers.set('running', {
      events: [],
      sseRes: null,
      done: false,
      doneAt: now - 120_000,
      assistantChunks: [],
      toolApprovalReceived: false,
      lastToolCharOffset: 0,
      currentCharOffset: 0,
      sawToolEvent: false,
    });

    startJobStreamBufferCleanup(server as never);
    vi.advanceTimersByTime(60_000);

    expect(jobStreamBuffers.has('expired')).toBe(false);
    expect(jobStreamBuffers.has('recent')).toBe(true);
    expect(jobStreamBuffers.has('running')).toBe(true);

    listeners.get('close')?.();
    expect(clearIntervalSpy).toHaveBeenCalledOnce();
  });
});
