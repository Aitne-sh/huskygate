/** @module metrics — Lightweight in-memory job counters with periodic log reporting. */
import { INTERVALS } from '../shared/constants.js';
import { logger } from './logger.js';

const counters = {
  jobs_total: 0,
  jobs_failed: 0,
  jobs_duration_sum_ms: 0,
};

let lastReportedAt = Date.now();
let reportTimer: ReturnType<typeof setInterval> | null = null;

export function recordJobComplete(durationMs: number, failed: boolean): void {
  counters.jobs_total++;
  if (failed) counters.jobs_failed++;
  counters.jobs_duration_sum_ms += durationMs;
}

export interface MetricsSnapshot {
  jobs_total: number;
  jobs_failed: number;
  jobs_avg_duration_ms: number | null;
  queue_running: number;
  queue_pending: number;
}

/** @internal Exported for unit testing. */
export function getSnapshot(queueStatus: { running: number; pending: number }): MetricsSnapshot {
  return {
    jobs_total: counters.jobs_total,
    jobs_failed: counters.jobs_failed,
    jobs_avg_duration_ms:
      counters.jobs_total > 0
        ? Math.round(counters.jobs_duration_sum_ms / counters.jobs_total)
        : null,
    queue_running: queueStatus.running,
    queue_pending: queueStatus.pending,
  };
}

/**
 * Emit a metrics log line and reset the reporting timer.
 */
function emitReport(queueStatusFn: () => { running: number; pending: number }): void {
  const snapshot = getSnapshot(queueStatusFn());
  const elapsed = Date.now() - lastReportedAt;
  logger.info('metrics', { ...snapshot, interval_ms: elapsed });
  lastReportedAt = Date.now();
}

const REPORT_INTERVAL_MS = INTERVALS.metricsReport;

/**
 * Start periodic metrics reporting. Call once at startup.
 */
export function startMetricsReporter(
  queueStatusFn: () => { running: number; pending: number },
): void {
  if (reportTimer) return;
  reportTimer = setInterval(() => emitReport(queueStatusFn), REPORT_INTERVAL_MS);
  // Don't keep the process alive just for metrics
  reportTimer.unref();
}

/**
 * Stop the periodic reporter and emit a final report.
 */
export function stopMetricsReporter(
  queueStatusFn: () => { running: number; pending: number },
): void {
  if (reportTimer) {
    clearInterval(reportTimer);
    reportTimer = null;
  }
  emitReport(queueStatusFn);
}
