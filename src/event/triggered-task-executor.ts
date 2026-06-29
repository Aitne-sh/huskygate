/** @module event/triggered-task-executor — Claims and enqueues event-triggered standalone tasks. */
import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { RunTrigger } from '../orchestrator/types.js';
import type { JobQueue } from '../queue/job-queue.js';
import type { Job } from '../queue/types.js';
import type { SessionManager } from '../session/manager.js';
import { cleanupStandaloneSessionResources } from '../shared/standalone-session-cleanup.js';
import { resolveTaskAgent } from '../shared/task-agent-resolver.js';
import type { AgentStore } from '../store/agent-store.js';
import type { TriggeredTaskStore } from '../store/triggered-task.js';
import { errorMessage } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import type { WorkdirManager } from '../workdir/manager.js';
import { appendTriggerContext, serializeTriggerContext } from './trigger-context.js';

export interface TriggeredTaskExecuteResult {
  dispatched: boolean;
  runId?: string;
  sessionKey?: string;
  reason?:
    | 'task_not_found'
    | 'task_disabled'
    | 'task_already_running'
    | 'setup_failed'
    | 'enqueue_failed';
}

export interface TriggeredTaskExecutorDeps {
  triggeredTaskStore: TriggeredTaskStore;
  sessionManager: SessionManager;
  jobQueue: JobQueue;
  workdirManager: WorkdirManager;
  workdirRoot: string;
  /** Optional: agent store for runtime agent resolution. */
  agentStore?: AgentStore;
}

/** Executes a triggered task by creating a session, preparing a workdir, and enqueuing a job. */
export class TriggeredTaskExecutor {
  constructor(private readonly deps: TriggeredTaskExecutorDeps) {}

  private cleanupFailedSession(
    session: ReturnType<SessionManager['createStandaloneSession']>,
  ): void {
    cleanupStandaloneSessionResources(
      {
        config: { workdirRoot: this.deps.workdirRoot },
        sessionManager: this.deps.sessionManager,
      },
      {
        sessionKey: session.sessionKey,
        sessionWorkdir: session.workdir,
      },
    );
  }

  async execute(
    taskId: string,
    triggeredBy: RunTrigger,
    triggerContext: Record<string, unknown> | null,
  ): Promise<TriggeredTaskExecuteResult> {
    const task = this.deps.triggeredTaskStore.getById(taskId);
    if (!task) return { dispatched: false, reason: 'task_not_found' };
    if (!task.enabled) return { dispatched: false, reason: 'task_disabled' };

    const now = new Date().toISOString();
    const claimed =
      task.concurrencyPolicy === 'skip_if_running'
        ? this.deps.triggeredTaskStore.claimTask(task.id, now)
        : task;
    if (task.concurrencyPolicy === 'skip_if_running' && !claimed) {
      return { dispatched: false, reason: 'task_already_running' };
    }

    let session: ReturnType<SessionManager['createStandaloneSession']> | null = null;
    let effectiveWorkdir: string | null = null;
    const runId = crypto.randomUUID();
    try {
      // Resolve agent config before session/workdir setup so the agent's
      // current tool and skills are used for workdir preparation.
      const resolved = resolveTaskAgent(this.deps.agentStore, task.agentId, {
        tool: task.tool,
        model: task.model,
        allowMcp: task.allowMcp,
        enabledSkills: task.enabledSkills,
        instructionFile: task.instructionFile,
      });

      session = this.deps.sessionManager.createStandaloneSession(resolved.tool, task.userId);
      effectiveWorkdir = task.workdir || session.workdir;
      mkdirSync(effectiveWorkdir, { recursive: true });
      this.deps.workdirManager.prepareWorkdirSkillsOnly(
        effectiveWorkdir,
        resolved.tool,
        resolved.enabledSkills,
      );
      this.deps.sessionManager.updateMode(session.sessionKey, 'write', null);

      this.deps.triggeredTaskStore.recordRun({
        id: runId,
        triggeredTaskId: task.id,
        status: 'running',
        triggeredBy,
        triggerContextJson: serializeTriggerContext(triggerContext),
        sessionKey: session.sessionKey,
        jobId: runId,
        startedAt: now,
      });

      const job: Job = {
        id: runId,
        sessionKey: session.sessionKey,
        channelId: '',
        threadTs: '',
        userId: task.userId,
        tool: resolved.tool,
        mode: 'write',
        prompt: appendTriggerContext(task.prompt, 'Trigger Event Context', triggerContext),
        workdir: effectiveWorkdir,
        toolState: {},
        ...(resolved.model ? { toolStateOverrides: { model: resolved.model } } : {}),
        createdAt: Date.now(),
        source: 'triggered-task',
        triggeredTaskId: task.id,
        triggeredTaskRunId: runId,
        autoApprove: true,
        executionPolicy: {
          allowMcp: resolved.allowMcp,
          enabledSkills: resolved.enabledSkills,
          enabledMcpServerIds: resolved.enabledMcpServerIds,
        },
        instructionFile: resolved.instructionFile,
      };

      const enq = this.deps.jobQueue.enqueue(job);
      if ('error' in enq) {
        this.deps.triggeredTaskStore.updateRun(runId, {
          status: 'failed',
          errorMessage: `Enqueue failed: ${enq.error}`,
          endedAt: new Date().toISOString(),
        });
        if (task.concurrencyPolicy === 'skip_if_running') {
          this.deps.triggeredTaskStore.releaseClaim(task.id);
        }
        this.cleanupFailedSession(session);
        return { dispatched: false, reason: 'enqueue_failed' };
      }

      return { dispatched: true, runId, sessionKey: session.sessionKey };
    } catch (err) {
      logger.error('triggered_task_execute_failed', {
        taskId,
        runId,
        error: errorMessage(err),
      });
      if (session) {
        try {
          this.deps.triggeredTaskStore.recordRun({
            id: runId,
            triggeredTaskId: task.id,
            status: 'failed',
            triggeredBy,
            triggerContextJson: serializeTriggerContext(triggerContext),
            sessionKey: session.sessionKey,
            jobId: null,
            errorMessage: 'Workdir preparation failed',
            startedAt: now,
            endedAt: new Date().toISOString(),
          });
        } catch (recordErr) {
          logger.error('triggered_task_record_run_failed', {
            taskId,
            runId,
            error: errorMessage(recordErr),
          });
        }
      }
      if (task.concurrencyPolicy === 'skip_if_running') {
        this.deps.triggeredTaskStore.releaseClaim(task.id);
      }
      if (session) {
        this.cleanupFailedSession(session);
      }
      return { dispatched: false, reason: 'setup_failed' };
    }
  }
}
