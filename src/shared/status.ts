/** @module status — Unified status types for all domain entities and their run/execution states. */

// ── Base Status Types ────────────────────────────────────────

/** Common base for all execution/run statuses. */
export type BaseRunStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Common base for all entity (resource) statuses. */
export type BaseEntityStatus = 'active' | 'deleted';

// ── Run Statuses (BaseRunStatus extensions) ──────────────────

/** Orchestration run lifecycle. */
export type OrchestrationRunStatus = BaseRunStatus | 'cancelled';

/** Individual node execution within an orchestration run. */
export type NodeRunStatus = BaseRunStatus | 'waiting' | 'skipped' | 'cancelled';

/** Scheduled task run lifecycle. */
export type ScheduledRunStatus = BaseRunStatus | 'timeout';

/** On-demand task run — uses base statuses only. */
export type OndemandRunStatus = BaseRunStatus;

/** Triggered (webhook-driven) task run lifecycle. */
export type TriggeredTaskRunStatus = BaseRunStatus | 'cancelled';

/** Webhook delivery lifecycle (non-standard — does not extend BaseRunStatus). */
export type DeliveryStatus = 'dispatching' | 'completed' | 'partial';

// ── Entity Statuses (BaseEntityStatus extensions) ────────────

/** Orchestrator resource status. */
export type OrchestratorStatus = BaseEntityStatus | 'paused';

/** On-demand task resource — uses base entity statuses only. */
export type OndemandTaskStatus = BaseEntityStatus;

/** Scheduled task resource status. */
export type ScheduledTaskStatus = BaseEntityStatus | 'paused' | 'completed';

// ── Status Constants (for string comparisons) ────────────────

export const RUN_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  SKIPPED: 'skipped',
  WAITING: 'waiting',
  TIMEOUT: 'timeout',
} as const;

// ── Utilities ────────────────────────────────────────────────

/** Whether a run status represents a terminal (no further transitions) state. */
export function isTerminalRunStatus(status: BaseRunStatus | string): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'timeout' ||
    status === 'skipped'
  );
}
