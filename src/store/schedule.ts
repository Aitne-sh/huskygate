/** @module schedule — CRUD and scheduler support for time-based scheduled tasks. */
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ToolName } from '../config.js';
import type { Mode } from '../session/types.js';
import {
  mapScheduledTaskRun as toRun,
  mapScheduledTask as toTask,
} from '../shared/mappers/scheduled-task.js';
import type { SkillRef } from '../skills/catalog.js';
import { logger } from '../utils/logger.js';
import { resolveTimezone } from '../utils/timezone.js';
import {
  BOOL_TRANSFORM,
  SKILLS_TRANSFORM,
  TRIM_OR_NULL_TRANSFORM,
  StaleUpdateError,
  boolToDb,
  buildDynamicUpdate,
  skillsToDb,
} from './store-utils.js';

/* ── Types ── */

/** Re-exported from orchestrator/types (canonical source) to avoid duplicate definitions. */
export type { ScheduleType } from '../orchestrator/types.js';
import type { ScheduleType } from '../orchestrator/types.js';
export type { ScheduledTaskStatus, ScheduledRunStatus } from '../shared/status.js';
import type { ScheduledRunStatus, ScheduledTaskStatus } from '../shared/status.js';

export interface ScheduledTask {
  id: string;
  name: string;
  description: string | null;
  userId: string;
  tool: ToolName;
  model: string | null;
  mode: Mode;
  prompt: string;
  workdir: string | null;
  scheduleType: ScheduleType;
  runAt: string | null;
  cronExpr: string | null;
  timezone: string;
  notifyChannel: string | null;
  notifyThread: string | null;
  status: ScheduledTaskStatus;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  maxRuns: number | null;
  maxRetries: number;
  allowMcp: boolean;
  enabledSkills: SkillRef[] | null;
  instructionFile: string | null;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduledTask {
  name: string;
  description?: string | null;
  userId: string;
  tool: ToolName;
  model?: string | null;
  mode: Mode;
  prompt: string;
  workdir?: string | null;
  scheduleType: ScheduleType;
  runAt?: string | null;
  cronExpr?: string | null;
  timezone?: string;
  notifyChannel?: string | null;
  notifyThread?: string | null;
  maxRuns?: number | null;
  maxRetries?: number;
  allowMcp?: boolean;
  enabledSkills?: SkillRef[] | null;
  instructionFile?: string | null;
  agentId?: string | null;
  nextRunAt?: string | null;
}

export interface ScheduledTaskRun {
  id: string;
  taskId: string;
  sessionKey: string;
  status: ScheduledRunStatus;
  exitCode: number | null;
  outputSummary: string | null;
  errorMessage: string | null;
  startedAt: string;
  endedAt: string | null;
  artifacts: string | null;
  retryCount: number;
  source: string;
}

/* ── Row types (snake_case from SQLite) ── */

interface TaskRow {
  id: string;
  name: string;
  description: string | null;
  user_id: string;
  tool: string;
  model: string | null;
  mode: string;
  prompt: string;
  workdir: string | null;
  schedule_type: string;
  run_at: string | null;
  cron_expr: string | null;
  timezone: string;
  notify_channel: string | null;
  notify_thread: string | null;
  status: string;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
  max_runs: number | null;
  max_retries: number;
  allow_mcp: number;
  enabled_skills_json: string | null;
  instruction_file: string | null;
  agent_id: string | null;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
}

interface RunRow {
  id: string;
  task_id: string;
  session_key: string;
  status: string;
  exit_code: number | null;
  output_summary: string | null;
  error_message: string | null;
  started_at: string;
  ended_at: string | null;
  artifacts: string | null;
  retry_count: number;
  source: string;
}

/* ── Store ── */

/** Scheduled task CRUD, claim-based execution, and run history. */
export class ScheduleStore {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateScheduledTask): ScheduledTask {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO scheduled_tasks
           (id, name, description, user_id, tool, model, mode, prompt, workdir,
            schedule_type, run_at, cron_expr, timezone,
            notify_channel, notify_thread,
            status, next_run_at, run_count, max_runs, max_retries,
            allow_mcp, enabled_skills_json, instruction_file, agent_id,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.description ?? null,
        input.userId,
        input.tool,
        input.model ?? null,
        input.mode,
        input.prompt,
        input.workdir ?? null,
        input.scheduleType,
        input.runAt ?? null,
        input.cronExpr ?? null,
        resolveTimezone(input.timezone),
        input.notifyChannel ?? null,
        input.notifyThread ?? null,
        input.nextRunAt ?? null,
        input.maxRuns ?? null,
        input.maxRetries ?? 0,
        boolToDb(input.allowMcp ?? true),
        skillsToDb(input.enabledSkills),
        input.instructionFile ?? null,
        input.agentId ?? null,
        now,
        now,
      );

    logger.info('schedule_task_created', { id, name: input.name, type: input.scheduleType });
    const created = this.getById(id);
    if (created === null) {
      throw new Error(`Failed to load created scheduled task: ${id}`);
    }
    return created;
  }

  getById(id: string): ScheduledTask | null {
    const row = this.db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
      | TaskRow
      | undefined;
    return row ? toTask(row) : null;
  }

  list(filter?: { userId?: string; status?: ScheduledTaskStatus }): ScheduledTask[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    } else {
      conditions.push("status != 'deleted'");
    }
    if (filter?.userId) {
      conditions.push('user_id = ?');
      params.push(filter.userId);
    }

    const sql = `SELECT * FROM scheduled_tasks WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`;
    const rows = this.db.prepare(sql).all(...params) as TaskRow[];
    return rows.map(toTask);
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        ScheduledTask,
        | 'name'
        | 'description'
        | 'userId'
        | 'tool'
        | 'model'
        | 'mode'
        | 'prompt'
        | 'scheduleType'
        | 'runAt'
        | 'cronExpr'
        | 'timezone'
        | 'notifyChannel'
        | 'notifyThread'
        | 'status'
        | 'lastRunAt'
        | 'nextRunAt'
        | 'runCount'
        | 'maxRuns'
        | 'maxRetries'
        | 'allowMcp'
        | 'enabledSkills'
        | 'instructionFile'
        | 'agentId'
        | 'workdir'
      >
    >,
    expectedUpdatedAt?: string,
  ): void {
    // Auto-clear claimed_at when status changes away from 'active'.
    const appendSets: string[] = [];
    if (patch.status && patch.status !== 'active') {
      appendSets.push('claimed_at = NULL');
    }

    const result = buildDynamicUpdate(patch as Record<string, unknown>, {
      fieldMap: {
        name: 'name',
        description: 'description',
        userId: 'user_id',
        tool: 'tool',
        model: 'model',
        mode: 'mode',
        prompt: 'prompt',
        scheduleType: 'schedule_type',
        runAt: 'run_at',
        cronExpr: 'cron_expr',
        timezone: 'timezone',
        notifyChannel: 'notify_channel',
        notifyThread: 'notify_thread',
        status: 'status',
        lastRunAt: 'last_run_at',
        nextRunAt: 'next_run_at',
        runCount: 'run_count',
        maxRuns: 'max_runs',
        maxRetries: 'max_retries',
        allowMcp: 'allow_mcp',
        enabledSkills: 'enabled_skills_json',
        instructionFile: 'instruction_file',
        agentId: 'agent_id',
        workdir: 'workdir',
      },
      transforms: {
        model: TRIM_OR_NULL_TRANSFORM,
        allowMcp: BOOL_TRANSFORM,
        enabledSkills: SKILLS_TRANSFORM,
      },
      appendSets: appendSets.length > 0 ? appendSets : undefined,
      expectedUpdatedAt,
    });
    if (!result) return;

    const whereClause = result.extraWhere ? `WHERE id = ? ${result.extraWhere}` : 'WHERE id = ?';
    result.params.push(id);
    if (result.extraWhereParams) result.params.push(...result.extraWhereParams);
    const info = this.db
      .prepare(`UPDATE scheduled_tasks SET ${result.sets.join(', ')} ${whereClause}`)
      .run(...result.params);
    if (expectedUpdatedAt && info.changes === 0) {
      throw new StaleUpdateError('Scheduled task', id);
    }
  }

  softDelete(id: string): void {
    this.update(id, { status: 'deleted' });
    logger.info('schedule_task_deleted', { id });
  }

  /**
   * Get all tasks whose next_run_at has passed and are active (unclaimed).
   */
  getDueTasks(now: string): ScheduledTask[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM scheduled_tasks
         WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ?
           AND claimed_at IS NULL
         ORDER BY next_run_at ASC`,
      )
      .all(now) as TaskRow[];
    return rows.map(toTask);
  }

  /**
   * Atomically claim a task for execution.
   *
   * Uses UPDATE ... WHERE claimed_at IS NULL RETURNING to prevent two
   * processes from claiming the same task (optimistic locking).
   * Returns the claimed task, or null if already claimed by another process.
   */
  claimTask(taskId: string, now: string): ScheduledTask | null {
    const row = this.db
      .prepare(
        `UPDATE scheduled_tasks
         SET claimed_at = ?
         WHERE id = ? AND status = 'active' AND claimed_at IS NULL
         RETURNING *`,
      )
      .get(now, taskId) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  /**
   * Release the claim on a task (e.g. after execution completes for recurring tasks).
   */
  releaseClaim(taskId: string): void {
    this.db.prepare('UPDATE scheduled_tasks SET claimed_at = NULL WHERE id = ?').run(taskId);
  }

  /**
   * Recover stale claims from crashed processes.
   *
   * If a daemon crashes after claiming a task but before completing it,
   * the claimed_at timestamp will be stale. This method resets claims
   * older than the specified timeout so the task can be re-claimed.
   */
  recoverStaleClaims(timeoutMinutes: number): number {
    const now = Date.now();
    const cutoff = new Date(now - timeoutMinutes * 60_000).toISOString();
    const result = this.db
      .prepare(
        `UPDATE scheduled_tasks
         SET claimed_at = NULL
         WHERE status = 'active' AND claimed_at IS NOT NULL AND claimed_at < ?`,
      )
      .run(cutoff);
    if (result.changes > 0) {
      logger.warn('scheduler_stale_claims_recovered', { count: result.changes, cutoff });
    }
    return result.changes;
  }

  /* ── Run records ── */

  recordRun(
    run: Omit<
      ScheduledTaskRun,
      'endedAt' | 'exitCode' | 'outputSummary' | 'errorMessage' | 'artifacts' | 'retryCount'
    > & {
      endedAt?: string | null;
      exitCode?: number | null;
      outputSummary?: string | null;
      errorMessage?: string | null;
      artifacts?: string | null;
      retryCount?: number;
    },
  ): void {
    this.db
      .prepare(
        `INSERT INTO scheduled_task_runs
           (id, task_id, session_key, status, exit_code, output_summary, error_message, started_at, ended_at, artifacts, retry_count, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.taskId,
        run.sessionKey,
        run.status,
        run.exitCode ?? null,
        run.outputSummary ?? null,
        run.errorMessage ?? null,
        run.startedAt,
        run.endedAt ?? null,
        run.artifacts ?? null,
        run.retryCount ?? 0,
        run.source,
      );
  }

  updateRun(
    runId: string,
    patch: Partial<
      Pick<
        ScheduledTaskRun,
        'status' | 'exitCode' | 'outputSummary' | 'errorMessage' | 'endedAt' | 'artifacts'
      >
    >,
  ): void {
    const result = buildDynamicUpdate(patch as Record<string, unknown>, {
      fieldMap: {
        status: 'status',
        exitCode: 'exit_code',
        outputSummary: 'output_summary',
        errorMessage: 'error_message',
        endedAt: 'ended_at',
        artifacts: 'artifacts',
      },
      autoTimestamp: false,
    });
    if (!result) return;
    result.params.push(runId);
    this.db
      .prepare(`UPDATE scheduled_task_runs SET ${result.sets.join(', ')} WHERE id = ?`)
      .run(...result.params);
  }

  getRunsByTask(taskId: string, limit = 20): ScheduledTaskRun[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM scheduled_task_runs
         WHERE task_id = ?
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(taskId, limit) as RunRow[];
    return rows.map(toRun);
  }

  getRunById(runId: string): ScheduledTaskRun | null {
    const row = this.db.prepare('SELECT * FROM scheduled_task_runs WHERE id = ?').get(runId) as
      | RunRow
      | undefined;
    return row ? toRun(row) : null;
  }
}
