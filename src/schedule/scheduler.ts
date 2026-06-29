/** @module schedule/scheduler — Interval-based scheduler for cron tasks and orchestrator polling. */
import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { Config } from '../config.js';
import type { OrchestratorEngine } from '../orchestrator/engine.js';
import type { Orchestrator } from '../orchestrator/types.js';
import type { JobQueue } from '../queue/job-queue.js';
import type { Job } from '../queue/types.js';
import { getNextCronRun } from '../schedule/cron-utils.js';
import type { SessionManager } from '../session/manager.js';
import { INTERVALS, TTLS } from '../shared/constants.js';
import { resolveTaskAgent } from '../shared/task-agent-resolver.js';
import type { AgentStore } from '../store/agent-store.js';
import type { OrchestratorStore } from '../store/orchestrator.js';
import type { ScheduleStore, ScheduledTask } from '../store/schedule.js';
import type { TriggeredTaskStore } from '../store/triggered-task.js';
import { logger } from '../utils/logger.js';
import type { WorkdirManager } from '../workdir/manager.js';

export interface SchedulerDeps {
  scheduleStore: ScheduleStore;
  sessionManager: SessionManager;
  jobQueue: JobQueue;
  workdirManager: WorkdirManager;
  config: Config;
  /** Optional callback after a schedule job finishes (for Slack notification). */
  onScheduleJobComplete?: (
    task: ScheduledTask,
    runId: string,
    exitCode: number | null,
    outputSummary: string,
  ) => void;
  /** Optional: orchestrator store for scheduled orchestrator polling. */
  orchestratorStore?: OrchestratorStore;
  /** Optional: orchestrator engine for scheduled orchestrator execution. */
  orchestratorEngine?: OrchestratorEngine;
  /** Optional: triggered task store for stale claim recovery. */
  triggeredTaskStore?: TriggeredTaskStore;
  /** Optional: agent store for runtime agent resolution. */
  agentStore?: AgentStore;
}

const DEFAULT_POLL_INTERVAL_MS = INTERVALS.schedulePoll;
const STALE_CLAIM_TIMEOUT_MINUTES = TTLS.staleClaimMinutes;

/**
 * Scheduled tasks always run with auto-approve enabled because they execute
 * unattended (no user present to approve tool calls interactively).
 */
const SCHEDULE_AUTO_APPROVE = true as const;

/** Polls for due scheduled tasks and orchestrators, claiming and dispatching them to the job queue. */
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly deps: SchedulerDeps;
  private readonly pollIntervalMs: number;
  private running = false;

  constructor(deps: SchedulerDeps, pollIntervalMs?: number) {
    this.deps = deps;
    this.pollIntervalMs = pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  start(): void {
    if (this.timer) return;
    logger.info('scheduler_started', { pollIntervalMs: this.pollIntervalMs });
    // Run first tick immediately, then on interval
    this.tick().catch((err) => {
      logger.error('scheduler_initial_tick_error', { error: String(err) });
    });
    this.timer = setInterval(() => {
      try {
        this.tick().catch((err) => {
          logger.error('scheduler_tick_error', { error: String(err) });
        });
      } catch (err) {
        logger.error('scheduler_tick_sync_error', { error: String(err) });
      }
    }, this.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('scheduler_stopped');
    }
  }

  async tick(): Promise<void> {
    if (this.running) return; // Prevent concurrent ticks
    this.running = true;
    try {
      // Recover stale claims from crashed processes before fetching due tasks.
      this.deps.scheduleStore.recoverStaleClaims(STALE_CLAIM_TIMEOUT_MINUTES);

      const now = new Date().toISOString();
      const dueTasks = this.deps.scheduleStore.getDueTasks(now);

      if (dueTasks.length > 0) {
        const maxConcurrent = this.deps.config.scheduleMaxConcurrent;
        logger.info('scheduler_tick', { dueCount: dueTasks.length, maxConcurrent });

        let scheduledThisTick = 0;
        for (const task of dueTasks) {
          if (scheduledThisTick >= maxConcurrent) {
            logger.info('scheduler_max_concurrent_reached', {
              maxConcurrent,
              remaining: dueTasks.length - scheduledThisTick,
            });
            break;
          }
          try {
            const claimed = this.executeTask(task);
            if (claimed) scheduledThisTick++;
          } catch (err) {
            logger.error('scheduler_task_error', {
              taskId: task.id,
              taskName: task.name,
              error: String(err),
            });
          }
        }
      }

      // ── Triggered task stale claim recovery ──
      if (this.deps.triggeredTaskStore) {
        this.deps.triggeredTaskStore.recoverStaleClaims(STALE_CLAIM_TIMEOUT_MINUTES);
      }

      // ── Orchestrator polling ──
      if (this.deps.orchestratorStore && this.deps.orchestratorEngine) {
        this.deps.orchestratorStore.recoverStaleClaims(STALE_CLAIM_TIMEOUT_MINUTES);
        const dueOrchestrators = this.deps.orchestratorStore.getDueOrchestrators(now);
        for (const orch of dueOrchestrators) {
          try {
            await this.executeOrchestrator(orch, now);
          } catch (err) {
            logger.error('scheduler_orchestrator_error', {
              orchId: orch.id,
              orchName: orch.name,
              error: String(err),
            });
          }
        }
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Attempt to claim and execute a scheduled task.
   * Returns true if the task was claimed and enqueued, false if already claimed by another process.
   */
  private executeTask(task: ScheduledTask): boolean {
    const { scheduleStore, sessionManager, jobQueue, workdirManager } = this.deps;

    // Atomically claim the task. If another process already claimed it, skip.
    const now = new Date().toISOString();
    const claimed = scheduleStore.claimTask(task.id, now);
    if (!claimed) {
      logger.info('scheduler_task_already_claimed', { taskId: task.id, taskName: task.name });
      return false;
    }

    // Resolve agent config before session/workdir setup so the agent's
    // current tool and skills are used for workdir preparation.
    const resolved = resolveTaskAgent(this.deps.agentStore, claimed.agentId, {
      tool: claimed.tool,
      model: claimed.model,
      allowMcp: claimed.allowMcp,
      enabledSkills: claimed.enabledSkills,
      instructionFile: claimed.instructionFile,
    });

    // All post-claim operations are wrapped in try-catch to guarantee
    // the claim is released on failure, preventing stale claims.
    let session: { sessionKey: string; workdir: string };
    let effectiveWorkdir: string;
    try {
      session = sessionManager.createStandaloneSession(resolved.tool, claimed.userId);
      // Use task.workdir if explicitly configured; otherwise auto-generated session.workdir
      effectiveWorkdir = claimed.workdir || session.workdir;
      mkdirSync(effectiveWorkdir, { recursive: true });
      // Instruction file is written by job-executor using job.instructionFile
      workdirManager.prepareWorkdirSkillsOnly(
        effectiveWorkdir,
        resolved.tool,
        resolved.enabledSkills,
      );
      // Tasks always run in write mode (P3: non-interactive jobs are write-fixed)
      sessionManager.updateMode(session.sessionKey, 'write', null);
    } catch (err) {
      logger.error('scheduler_setup_failed', {
        taskId: claimed.id,
        taskName: claimed.name,
        error: String(err),
      });
      scheduleStore.releaseClaim(claimed.id);
      return false;
    }

    // 2. Create run record
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    scheduleStore.recordRun({
      id: runId,
      taskId: claimed.id,
      sessionKey: session.sessionKey,
      status: 'running',
      startedAt,
      source: 'schedule',
    });

    // 3. Build and enqueue job
    const job: Job = {
      id: runId,
      sessionKey: session.sessionKey,
      channelId: '',
      threadTs: '',
      userId: claimed.userId,
      tool: resolved.tool,
      mode: 'write',
      prompt: claimed.prompt,
      workdir: effectiveWorkdir,
      toolState: {},
      ...(resolved.model ? { toolStateOverrides: { model: resolved.model } } : {}),
      createdAt: Date.now(),
      source: 'schedule',
      scheduleTaskId: claimed.id,
      scheduleRunId: runId,
      autoApprove: SCHEDULE_AUTO_APPROVE,
      executionPolicy: {
        allowMcp: resolved.allowMcp,
        enabledSkills: resolved.enabledSkills,
        enabledMcpServerIds: resolved.enabledMcpServerIds,
      },
      instructionFile: resolved.instructionFile,
    };

    const enqueueResult = jobQueue.enqueue(job);
    if ('error' in enqueueResult) {
      logger.error('scheduler_enqueue_failed', {
        taskId: claimed.id,
        runId,
        error: enqueueResult.error,
      });
      scheduleStore.updateRun(runId, {
        status: 'failed',
        errorMessage: `Enqueue failed: ${enqueueResult.error}`,
        endedAt: new Date().toISOString(),
      });
      scheduleStore.releaseClaim(claimed.id);
      return false;
    }

    // 4. Update task: next_run_at, handle once vs recurring
    //    Status is NOT set here — the job-executor sets 'completed' after the
    //    job actually finishes (prevents premature status while the run is in-flight).
    if (claimed.scheduleType === 'once') {
      scheduleStore.update(claimed.id, {
        lastRunAt: startedAt,
        nextRunAt: null,
        runCount: claimed.runCount + 1,
      });
      // Claim stays set — prevents stale-claim recovery from interfering
      // while the job runs. Job-executor clears it via update({ status: 'completed' }).
    } else {
      const nextRun = claimed.cronExpr ? getNextCronRun(claimed.cronExpr, claimed.timezone) : null;
      const newRunCount = claimed.runCount + 1;
      const reachedMax = claimed.maxRuns !== null && newRunCount >= claimed.maxRuns;
      const noFutureRuns = !reachedMax && nextRun === null;
      const isTerminal = reachedMax || noFutureRuns;

      if (noFutureRuns) {
        logger.warn('scheduler_no_future_runs', {
          taskId: claimed.id,
          taskName: claimed.name,
          cronExpr: claimed.cronExpr,
        });
      }

      scheduleStore.update(claimed.id, {
        lastRunAt: startedAt,
        nextRunAt: isTerminal ? null : nextRun,
        runCount: newRunCount,
      });
      if (!isTerminal) {
        // Non-terminal recurring: release claim so the next tick can re-claim
        scheduleStore.releaseClaim(claimed.id);
      }
      // Terminal recurring: keep claim (same pattern as once-tasks)
    }

    logger.info('scheduler_task_enqueued', {
      taskId: claimed.id,
      taskName: claimed.name,
      runId,
      sessionKey: session.sessionKey,
    });
    return true;
  }

  /**
   * Claim and execute a due orchestrator.
   * The engine handles session creation, job enqueuing, and DAG execution.
   */
  private async executeOrchestrator(orch: Orchestrator, now: string): Promise<void> {
    const store = this.deps.orchestratorStore;
    const engine = this.deps.orchestratorEngine;
    if (!store || !engine) return;

    // Atomically claim
    const claimed = store.claimOrchestrator(orch.id, now);
    if (!claimed) {
      logger.info('scheduler_orch_already_claimed', { orchId: orch.id, orchName: orch.name });
      return;
    }

    try {
      await engine.startRun(claimed.id, 'schedule');

      // Update run tracking
      const newRunCount = claimed.runCount + 1;

      if (claimed.scheduleType === 'once') {
        store.update(claimed.id, {
          lastRunAt: now,
          nextRunAt: null,
          runCount: newRunCount,
        });
        // Claim stays set for once-tasks (prevents re-trigger)
      } else {
        // Recurring: compute next run
        const nextRun = claimed.cronExpr
          ? getNextCronRun(claimed.cronExpr, claimed.timezone)
          : null;
        const isTerminal = !nextRun;

        store.update(claimed.id, {
          lastRunAt: now,
          nextRunAt: isTerminal ? null : nextRun,
          runCount: newRunCount,
        });

        if (!isTerminal) {
          store.releaseClaim(claimed.id);
        }
      }

      logger.info('scheduler_orch_started', {
        orchId: claimed.id,
        orchName: claimed.name,
        scheduleType: claimed.scheduleType,
      });
    } catch (err) {
      // Release claim on failure so it can be retried
      store.releaseClaim(claimed.id);
      throw err;
    }
  }
}
