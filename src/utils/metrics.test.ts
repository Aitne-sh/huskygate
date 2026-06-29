import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadMetricsModule() {
  vi.resetModules();
  const info = vi.fn();
  vi.doMock('./logger.js', () => ({
    logger: { info },
  }));
  const metrics = await import('./metrics.js');
  return { metrics, info };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-02-17T00:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('metrics', () => {
  it('returns empty snapshot before any jobs are recorded', async () => {
    const { metrics } = await loadMetricsModule();
    expect(metrics.getSnapshot({ running: 1, pending: 2 })).toEqual({
      jobs_total: 0,
      jobs_failed: 0,
      jobs_avg_duration_ms: null,
      queue_running: 1,
      queue_pending: 2,
    });
  });

  it('tracks total/failed counts and average duration', async () => {
    const { metrics } = await loadMetricsModule();

    metrics.recordJobComplete(100, false);
    metrics.recordJobComplete(200, true);
    metrics.recordJobComplete(300, false);

    expect(metrics.getSnapshot({ running: 0, pending: 0 })).toEqual({
      jobs_total: 3,
      jobs_failed: 1,
      jobs_avg_duration_ms: 200,
      queue_running: 0,
      queue_pending: 0,
    });
  });

  it('starts periodic reporter once and emits periodic + final reports', async () => {
    const { metrics, info } = await loadMetricsModule();
    const queueStatus = () => ({ running: 2, pending: 3 });

    metrics.startMetricsReporter(queueStatus);
    metrics.startMetricsReporter(queueStatus);

    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(info).toHaveBeenCalledTimes(1);

    metrics.stopMetricsReporter(queueStatus);
    expect(info).toHaveBeenCalledTimes(2);

    const firstCall = info.mock.calls[0];
    expect(firstCall?.[0]).toBe('metrics');
    expect(firstCall?.[1]).toMatchObject({
      queue_running: 2,
      queue_pending: 3,
      jobs_total: 0,
      jobs_failed: 0,
    });
  });

  it('stopMetricsReporter emits final report even when reporter was never started', async () => {
    const { metrics, info } = await loadMetricsModule();
    metrics.stopMetricsReporter(() => ({ running: 0, pending: 1 }));
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[1]).toMatchObject({
      queue_running: 0,
      queue_pending: 1,
    });
  });
});
