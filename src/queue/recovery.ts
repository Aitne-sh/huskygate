/** @module queue/recovery — Restart recovery for durable queue state. */
import crypto from 'node:crypto';
import type { AppContext } from '../context/app-context.js';
import type { Session } from '../session/types.js';
import { cleanupStandaloneSessionResources } from '../shared/standalone-session-cleanup.js';
import { errorMessage } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import type { JobQueue } from './job-queue.js';
import type { PersistedQueueJob, QueueStore } from './queue-store.js';
import type { Job } from './types.js';

const RESTART_INTERRUPT_MESSAGE = 'Interrupted by process restart';
const RESTART_INTERRUPT_ERROR_KIND = 'process_restart';
const RECOVERY_REJECT_PREFIX = 'Skipped during restart recovery';

type QueueRecoveryContext = Pick<
  AppContext,
  | 'auditStore'
  | 'config'
  | 'ondemandTaskStore'
  | 'scheduleStore'
  | 'sessionManager'
  | 'triggeredTaskStore'
  | 'workdirManager'
>;

export interface DurableQueueRecoveryResult {
  restoredQueued: number;
  interruptedRunning: number;
  retriedRunning: number;
  failedRunning: number;
  handedOffOrchestrator: number;
  discardedQueued: number;
}

export function isRestartSafeRetryJob(job: Job): boolean {
  return (
    job.source === 'orchestrator-summary' &&
    job.mode === 'readonly' &&
    job.executionPolicy?.allowMcp === false
  );
}

export function buildRestartRetryJob(job: Job): Job {
  return {
    ...job,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };
}

function cleanupStandaloneJob(ctx: QueueRecoveryContext, job: Job): void {
  cleanupStandaloneSessionResources(ctx, {
    sessionKey: job.sessionKey,
    jobWorkdir: job.workdir,
  });
}

function cleanupSessionOnly(ctx: QueueRecoveryContext, sessionKey: string): void {
  cleanupStandaloneSessionResources(ctx, {
    sessionKey,
    sessionWorkdir: ctx.sessionManager.get(sessionKey)?.workdir ?? null,
  });
}

function markStandaloneJobFailed(
  ctx: QueueRecoveryContext,
  job: Job,
  errorMessageText: string,
): void {
  const endedAt = new Date().toISOString();
  switch (job.source) {
    case 'schedule':
      if (job.scheduleRunId) {
        ctx.scheduleStore.updateRun(job.scheduleRunId, {
          status: 'failed',
          exitCode: 1,
          errorMessage: errorMessageText,
          endedAt,
        });
      }
      if (job.scheduleTaskId) {
        ctx.scheduleStore.releaseClaim(job.scheduleTaskId);
      }
      cleanupStandaloneJob(ctx, job);
      break;
    case 'ondemand-task':
      if (job.ondemandTaskRunId) {
        ctx.ondemandTaskStore.updateRun(job.ondemandTaskRunId, {
          status: 'failed',
          exitCode: 1,
          errorMessage: errorMessageText,
          endedAt,
        });
      }
      cleanupStandaloneJob(ctx, job);
      break;
    case 'triggered-task':
      if (job.triggeredTaskRunId) {
        ctx.triggeredTaskStore.updateRun(job.triggeredTaskRunId, {
          status: 'failed',
          exitCode: 1,
          errorMessage: errorMessageText,
          endedAt,
        });
      }
      if (job.triggeredTaskId) {
        ctx.triggeredTaskStore.releaseClaim(job.triggeredTaskId);
      }
      cleanupStandaloneJob(ctx, job);
      break;
    case 'orchestrator-summary':
      cleanupStandaloneJob(ctx, job);
      break;
    default:
      break;
  }
}

function failInterruptedRunningJob(ctx: QueueRecoveryContext, job: Job): void {
  markStandaloneJobFailed(ctx, job, RESTART_INTERRUPT_MESSAGE);
}

function sameStringArray(
  left: readonly string[] | null | undefined,
  right: readonly string[] | null,
): boolean {
  if (left == null || right == null) return left == null && right == null;
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function validateTaskPolicy(
  job: Job,
  expected: {
    allowMcp: boolean;
    enabledSkills: readonly string[] | null;
    instructionFile: string | null;
  },
): string | null {
  const actualAllowMcp = job.executionPolicy?.allowMcp ?? true;
  if (actualAllowMcp !== expected.allowMcp) {
    return 'execution policy allowMcp changed';
  }
  const actualSkills = job.executionPolicy?.enabledSkills ?? null;
  if (!sameStringArray(actualSkills, expected.enabledSkills)) {
    return 'execution policy enabledSkills changed';
  }
  if ((job.instructionFile ?? null) !== expected.instructionFile) {
    return 'instruction file changed';
  }
  return null;
}

function validateScheduleJob(ctx: QueueRecoveryContext, job: Job, session: Session): string | null {
  if (!job.scheduleTaskId || !job.scheduleRunId) {
    return 'schedule linkage missing';
  }
  const task = ctx.scheduleStore.getById(job.scheduleTaskId);
  if (!task) {
    return `scheduled task missing: ${job.scheduleTaskId}`;
  }
  if (task.status !== 'active') {
    return `scheduled task is ${task.status}`;
  }
  const run = ctx.scheduleStore.getRunById(job.scheduleRunId);
  if (!run) {
    return `scheduled run missing: ${job.scheduleRunId}`;
  }
  if (run.status !== 'running') {
    return `scheduled run is ${run.status}`;
  }
  if (job.tool !== task.tool) {
    return 'scheduled task tool changed';
  }
  if (job.mode !== 'write') {
    return 'scheduled task mode must remain write';
  }
  const expectedWorkdir = task.workdir ?? session.workdir;
  if (job.workdir !== expectedWorkdir) {
    return 'scheduled task workdir changed';
  }
  return validateTaskPolicy(job, {
    allowMcp: task.allowMcp,
    enabledSkills: task.enabledSkills,
    instructionFile: task.instructionFile,
  });
}

function validateOndemandJob(ctx: QueueRecoveryContext, job: Job, session: Session): string | null {
  if (!job.ondemandTaskId || !job.ondemandTaskRunId) {
    return 'on-demand task linkage missing';
  }
  const task = ctx.ondemandTaskStore.getById(job.ondemandTaskId);
  if (!task) {
    return `on-demand task missing: ${job.ondemandTaskId}`;
  }
  if (task.status !== 'active') {
    return `on-demand task is ${task.status}`;
  }
  const run = ctx.ondemandTaskStore.getRunById(job.ondemandTaskRunId);
  if (!run) {
    return `on-demand run missing: ${job.ondemandTaskRunId}`;
  }
  if (run.status !== 'running') {
    return `on-demand run is ${run.status}`;
  }
  if (job.tool !== task.tool) {
    return 'on-demand task tool changed';
  }
  if (job.mode !== 'write') {
    return 'on-demand task mode must remain write';
  }
  const expectedWorkdir = task.workdir ?? session.workdir;
  if (job.workdir !== expectedWorkdir) {
    return 'on-demand task workdir changed';
  }
  return validateTaskPolicy(job, {
    allowMcp: task.allowMcp,
    enabledSkills: task.enabledSkills,
    instructionFile: task.instructionFile,
  });
}

function validateTriggeredJob(
  ctx: QueueRecoveryContext,
  job: Job,
  session: Session,
): string | null {
  if (!job.triggeredTaskId || !job.triggeredTaskRunId) {
    return 'triggered task linkage missing';
  }
  const task = ctx.triggeredTaskStore.getById(job.triggeredTaskId);
  if (!task) {
    return `triggered task missing: ${job.triggeredTaskId}`;
  }
  if (!task.enabled) {
    return 'triggered task is disabled';
  }
  const run = ctx.triggeredTaskStore.getRunById(job.triggeredTaskRunId);
  if (!run) {
    return `triggered run missing: ${job.triggeredTaskRunId}`;
  }
  if (run.status !== 'running') {
    return `triggered run is ${run.status}`;
  }
  if (job.tool !== task.tool) {
    return 'triggered task tool changed';
  }
  if (job.mode !== 'write') {
    return 'triggered task mode must remain write';
  }
  const expectedWorkdir = task.workdir ?? session.workdir;
  if (job.workdir !== expectedWorkdir) {
    return 'triggered task workdir changed';
  }
  return validateTaskPolicy(job, {
    allowMcp: task.allowMcp,
    enabledSkills: task.enabledSkills,
    instructionFile: task.instructionFile,
  });
}

function validateQueuedJob(ctx: QueueRecoveryContext, job: Job): string | null {
  const session = ctx.sessionManager.get(job.sessionKey);
  if (!session) {
    return 'session missing';
  }
  if (session.tool !== job.tool) {
    return `session tool changed to ${session.tool}`;
  }
  if (!session.devAlias) {
    try {
      ctx.workdirManager.validateCustomWorkdir(job.workdir);
    } catch (err) {
      return `workdir rejected by current policy: ${errorMessage(err)}`;
    }
  }

  switch (job.source) {
    case 'schedule':
      return validateScheduleJob(ctx, job, session);
    case 'ondemand-task':
      return validateOndemandJob(ctx, job, session);
    case 'triggered-task':
      return validateTriggeredJob(ctx, job, session);
    case 'orchestrator-summary':
      if (job.mode !== 'readonly') {
        return 'orchestrator summary mode changed';
      }
      if (job.executionPolicy?.allowMcp !== false) {
        return 'orchestrator summary MCP policy changed';
      }
      return null;
    default:
      return null;
  }
}

function discardQueuedJob(
  ctx: QueueRecoveryContext,
  queueStore: QueueStore,
  job: Job,
  reason: string,
): void {
  queueStore.remove(job.id);
  markStandaloneJobFailed(ctx, job, `${RECOVERY_REJECT_PREFIX}: ${reason}`);
  logger.warn('job_dropped_after_restart', {
    job_id: job.id,
    session_key: job.sessionKey,
    source: job.source ?? null,
    reason,
  });
}

function handoffOrchestratorJob(
  ctx: QueueRecoveryContext,
  queueStore: QueueStore,
  entry: PersistedQueueJob,
): boolean {
  if (entry.job.source !== 'orchestrator') return false;
  if (entry.state === 'running') {
    ctx.sessionManager.setRunningJob(entry.job.sessionKey, null);
    ctx.auditStore.logJobComplete(entry.job.id, 1, RESTART_INTERRUPT_ERROR_KIND);
  }
  queueStore.remove(entry.job.id);
  cleanupSessionOnly(ctx, entry.job.sessionKey);
  logger.warn('orchestrator_job_handed_to_engine_recovery', {
    job_id: entry.job.id,
    session_key: entry.job.sessionKey,
    state: entry.state,
    orchestration_run_id: entry.job.orchestrationRunId ?? null,
    orchestration_node_id: entry.job.orchestrationNodeId ?? null,
  });
  return true;
}

/** Recover persisted queue rows from the previous process and drain restored queued work. */
export function recoverDurableQueue(
  ctx: QueueRecoveryContext,
  jobQueue: JobQueue,
  queueStore: QueueStore,
): DurableQueueRecoveryResult {
  const persisted = queueStore.listActive();
  let interruptedRunning = 0;
  let retriedRunning = 0;
  let failedRunning = 0;
  let handedOffOrchestrator = 0;
  let discardedQueued = 0;

  for (const entry of persisted) {
    if (handoffOrchestratorJob(ctx, queueStore, entry)) {
      handedOffOrchestrator += 1;
      if (entry.state === 'running') {
        interruptedRunning += 1;
      }
      continue;
    }
    if (entry.state !== 'running') continue;

    interruptedRunning += 1;
    ctx.sessionManager.setRunningJob(entry.job.sessionKey, null);
    ctx.auditStore.logJobComplete(entry.job.id, 1, RESTART_INTERRUPT_ERROR_KIND);

    if (isRestartSafeRetryJob(entry.job)) {
      const retryJob = buildRestartRetryJob(entry.job);
      try {
        queueStore.replace(entry.job.id, retryJob, 'queued');
      } catch (err) {
        logger.error('job_queue_replace_failed', {
          job_id: entry.job.id,
          error: errorMessage(err),
        });
        queueStore.remove(entry.job.id);
        failInterruptedRunningJob(ctx, entry.job);
        failedRunning += 1;
        continue;
      }
      retriedRunning += 1;
      logger.warn('job_requeued_after_restart', {
        previous_job_id: entry.job.id,
        new_job_id: retryJob.id,
        session_key: retryJob.sessionKey,
        source: retryJob.source ?? null,
      });
      continue;
    }

    queueStore.remove(entry.job.id);
    failInterruptedRunningJob(ctx, entry.job);
    failedRunning += 1;
    logger.warn('job_failed_after_restart', {
      job_id: entry.job.id,
      session_key: entry.job.sessionKey,
      source: entry.job.source ?? null,
    });
  }

  const queuedJobs = queueStore
    .listActive()
    .filter((entry) => entry.state === 'queued')
    .flatMap((entry) => {
      const reason = validateQueuedJob(ctx, entry.job);
      if (!reason) return [entry.job];
      discardQueuedJob(ctx, queueStore, entry.job, reason);
      discardedQueued += 1;
      return [];
    });
  jobQueue.restoreQueuedJobs(queuedJobs);

  return {
    restoredQueued: queuedJobs.length,
    interruptedRunning,
    retriedRunning,
    failedRunning,
    handedOffOrchestrator,
    discardedQueued,
  };
}
