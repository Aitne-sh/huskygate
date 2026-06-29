/** @module triggered-task — CRUD and claim-based execution for webhook-triggered tasks. */
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ToolName } from '../config.js';
import type {
  CreateTriggeredTask,
  TriggeredTask,
  TriggeredTaskConcurrencyPolicy,
  TriggeredTaskRun,
} from '../event/types.js';
import { parseStoredSkillRefs } from '../skills/skill-refs.js';
import {
  BOOL_TRANSFORM,
  SKILLS_TRANSFORM,
  TRIM_OR_NULL_TRANSFORM,
  StaleUpdateError,
  boolToDb,
  buildDynamicUpdate,
  skillsToDb,
} from './store-utils.js';

interface TriggeredTaskRow {
  id: string;
  name: string;
  description: string | null;
  user_id: string;
  tool: string;
  model: string | null;
  mode: string;
  prompt: string;
  workdir: string | null;
  max_retries: number;
  allow_mcp: number;
  enabled_skills_json: string | null;
  instruction_file: string | null;
  agent_id: string | null;
  notify_channel: string | null;
  notify_thread: string | null;
  enabled: number;
  run_count: number;
  last_run_at: string | null;
  concurrency_policy: string;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TriggeredTaskRunRow {
  id: string;
  triggered_task_id: string;
  status: string;
  triggered_by: string;
  trigger_context_json: string | null;
  session_key: string | null;
  job_id: string | null;
  exit_code: number | null;
  output_summary: string | null;
  error_message: string | null;
  retry_count: number;
  started_at: string;
  ended_at: string | null;
}

function mapTask(row: TriggeredTaskRow): TriggeredTask {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    userId: row.user_id,
    tool: row.tool as ToolName,
    model: row.model ?? null,
    mode: row.mode as 'readonly' | 'write',
    prompt: row.prompt,
    workdir: row.workdir,
    maxRetries: row.max_retries,
    allowMcp: row.allow_mcp !== 0,
    enabledSkills: parseStoredSkillRefs(row.enabled_skills_json).skillRefs,
    instructionFile: row.instruction_file,
    agentId: row.agent_id,
    notifyChannel: row.notify_channel,
    notifyThread: row.notify_thread,
    enabled: row.enabled !== 0,
    runCount: row.run_count,
    lastRunAt: row.last_run_at,
    concurrencyPolicy: row.concurrency_policy as TriggeredTaskConcurrencyPolicy,
    claimedAt: row.claimed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRun(row: TriggeredTaskRunRow): TriggeredTaskRun {
  return {
    id: row.id,
    triggeredTaskId: row.triggered_task_id,
    status: row.status as TriggeredTaskRun['status'],
    triggeredBy: row.triggered_by as TriggeredTaskRun['triggeredBy'],
    triggerContextJson: row.trigger_context_json,
    sessionKey: row.session_key,
    jobId: row.job_id,
    exitCode: row.exit_code,
    outputSummary: row.output_summary,
    errorMessage: row.error_message,
    retryCount: row.retry_count,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

/** Triggered task CRUD with optimistic-lock claiming and run history. */
export class TriggeredTaskStore {
  constructor(private readonly db: Database.Database) {}

  /** Run a synchronous callback inside a single DB transaction. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  create(input: CreateTriggeredTask): TriggeredTask {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO triggered_tasks (
          id, name, description, user_id, tool, model, mode, prompt, workdir,
          max_retries, allow_mcp, enabled_skills_json, instruction_file, agent_id,
          notify_channel, notify_thread, enabled, run_count, last_run_at,
          concurrency_policy, claimed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        input.name.trim(),
        input.description?.trim() || null,
        input.userId ?? 'dashboard',
        input.tool,
        input.model ?? null,
        input.mode ?? 'write',
        input.prompt,
        input.workdir ?? null,
        input.maxRetries ?? 0,
        boolToDb(input.allowMcp ?? true),
        skillsToDb(input.enabledSkills),
        input.instructionFile ?? null,
        input.agentId ?? null,
        input.notifyChannel ?? null,
        input.notifyThread ?? null,
        boolToDb(input.enabled ?? true),
        input.concurrencyPolicy ?? 'skip_if_running',
        now,
        now,
      );
    const created = this.getById(id);
    if (!created) {
      throw new Error(`Failed to load created triggered task: ${id}`);
    }
    return created;
  }

  getById(id: string): TriggeredTask | null {
    const row = this.db.prepare('SELECT * FROM triggered_tasks WHERE id = ?').get(id) as
      | TriggeredTaskRow
      | undefined;
    return row ? mapTask(row) : null;
  }

  list(): TriggeredTask[] {
    const rows = this.db
      .prepare('SELECT * FROM triggered_tasks ORDER BY created_at DESC')
      .all() as TriggeredTaskRow[];
    return rows.map(mapTask);
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        TriggeredTask,
        | 'name'
        | 'description'
        | 'userId'
        | 'tool'
        | 'model'
        | 'mode'
        | 'prompt'
        | 'workdir'
        | 'maxRetries'
        | 'allowMcp'
        | 'enabledSkills'
        | 'instructionFile'
        | 'agentId'
        | 'notifyChannel'
        | 'notifyThread'
        | 'enabled'
        | 'runCount'
        | 'lastRunAt'
        | 'concurrencyPolicy'
        | 'claimedAt'
      >
    >,
    expectedUpdatedAt?: string,
  ): void {
    const result = buildDynamicUpdate(patch as Record<string, unknown>, {
      fieldMap: {
        name: 'name',
        description: 'description',
        userId: 'user_id',
        tool: 'tool',
        model: 'model',
        mode: 'mode',
        prompt: 'prompt',
        workdir: 'workdir',
        maxRetries: 'max_retries',
        allowMcp: 'allow_mcp',
        enabledSkills: 'enabled_skills_json',
        instructionFile: 'instruction_file',
        agentId: 'agent_id',
        notifyChannel: 'notify_channel',
        notifyThread: 'notify_thread',
        enabled: 'enabled',
        runCount: 'run_count',
        lastRunAt: 'last_run_at',
        concurrencyPolicy: 'concurrency_policy',
        claimedAt: 'claimed_at',
      },
      transforms: {
        model: TRIM_OR_NULL_TRANSFORM,
        allowMcp: BOOL_TRANSFORM,
        enabled: BOOL_TRANSFORM,
        enabledSkills: SKILLS_TRANSFORM,
      },
      expectedUpdatedAt,
    });
    if (!result) return;
    const whereClause = result.extraWhere ? `WHERE id = ? ${result.extraWhere}` : 'WHERE id = ?';
    result.params.push(id);
    if (result.extraWhereParams) result.params.push(...result.extraWhereParams);
    const info = this.db
      .prepare(`UPDATE triggered_tasks SET ${result.sets.join(', ')} ${whereClause}`)
      .run(...result.params);
    const isStale = expectedUpdatedAt && info.changes === 0;
    if (isStale) {
      throw new StaleUpdateError('Triggered task', id);
    }
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM event_subscriptions WHERE triggered_task_id = ?').run(id);
    this.db.prepare('DELETE FROM triggered_task_runs WHERE triggered_task_id = ?').run(id);
    this.db.prepare('DELETE FROM triggered_tasks WHERE id = ?').run(id);
  }

  incrementRunCount(id: string, lastRunAt: string): void {
    this.db
      .prepare(
        `UPDATE triggered_tasks
         SET run_count = run_count + 1, last_run_at = ?
         WHERE id = ?`,
      )
      .run(lastRunAt, id);
  }

  claimTask(id: string, now: string): TriggeredTask | null {
    const row = this.db
      .prepare(
        `UPDATE triggered_tasks
         SET claimed_at = ?
         WHERE id = ? AND enabled = 1 AND claimed_at IS NULL
         RETURNING *`,
      )
      .get(now, id) as TriggeredTaskRow | undefined;
    return row ? mapTask(row) : null;
  }

  releaseClaim(id: string): void {
    this.db.prepare('UPDATE triggered_tasks SET claimed_at = NULL WHERE id = ?').run(id);
  }

  recoverStaleClaims(timeoutMinutes: number): number {
    const now = Date.now();
    const cutoff = new Date(now - timeoutMinutes * 60_000).toISOString();
    const result = this.db
      .prepare(
        `UPDATE triggered_tasks
         SET claimed_at = NULL
         WHERE enabled = 1 AND claimed_at IS NOT NULL AND claimed_at < ?`,
      )
      .run(cutoff);
    return result.changes;
  }

  recordRun(
    run: Omit<
      TriggeredTaskRun,
      'exitCode' | 'outputSummary' | 'errorMessage' | 'endedAt' | 'retryCount'
    > & {
      exitCode?: number | null;
      outputSummary?: string | null;
      errorMessage?: string | null;
      endedAt?: string | null;
      retryCount?: number;
    },
  ): void {
    this.db
      .prepare(
        `INSERT INTO triggered_task_runs (
          id, triggered_task_id, status, triggered_by, trigger_context_json,
          session_key, job_id, exit_code, output_summary, error_message,
          retry_count, started_at, ended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.triggeredTaskId,
        run.status,
        run.triggeredBy,
        run.triggerContextJson ?? null,
        run.sessionKey ?? null,
        run.jobId ?? null,
        run.exitCode ?? null,
        run.outputSummary ?? null,
        run.errorMessage ?? null,
        run.retryCount ?? 0,
        run.startedAt,
        run.endedAt ?? null,
      );
  }

  updateRun(
    runId: string,
    patch: Partial<
      Pick<
        TriggeredTaskRun,
        | 'status'
        | 'triggerContextJson'
        | 'sessionKey'
        | 'jobId'
        | 'exitCode'
        | 'outputSummary'
        | 'errorMessage'
        | 'endedAt'
      >
    >,
  ): void {
    const result = buildDynamicUpdate(patch as Record<string, unknown>, {
      fieldMap: {
        status: 'status',
        triggerContextJson: 'trigger_context_json',
        sessionKey: 'session_key',
        jobId: 'job_id',
        exitCode: 'exit_code',
        outputSummary: 'output_summary',
        errorMessage: 'error_message',
        endedAt: 'ended_at',
      },
      autoTimestamp: false,
    });
    if (!result) return;
    result.params.push(runId);
    this.db
      .prepare(`UPDATE triggered_task_runs SET ${result.sets.join(', ')} WHERE id = ?`)
      .run(...result.params);
  }

  getRunsByTask(taskId: string, limit = 20): TriggeredTaskRun[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM triggered_task_runs
         WHERE triggered_task_id = ?
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(taskId, limit) as TriggeredTaskRunRow[];
    return rows.map(mapRun);
  }

  getRunById(runId: string): TriggeredTaskRun | null {
    const row = this.db.prepare('SELECT * FROM triggered_task_runs WHERE id = ?').get(runId) as
      | TriggeredTaskRunRow
      | undefined;
    return row ? mapRun(row) : null;
  }

  getRunByJobId(jobId: string): TriggeredTaskRun | null {
    const row = this.db.prepare('SELECT * FROM triggered_task_runs WHERE job_id = ?').get(jobId) as
      | TriggeredTaskRunRow
      | undefined;
    return row ? mapRun(row) : null;
  }
}
