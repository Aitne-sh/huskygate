/** @module ondemand-task — CRUD and run tracking for manually-triggered on-demand tasks. */
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ToolName } from '../config.js';
import type { Mode } from '../session/types.js';
import {
  mapOndemandTaskRun as toRun,
  mapOndemandTask as toTask,
} from '../shared/mappers/ondemand-task.js';
import type { SkillRef } from '../skills/catalog.js';
import { logger } from '../utils/logger.js';
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

export type { OndemandTaskStatus, OndemandRunStatus } from '../shared/status.js';
import type { OndemandRunStatus, OndemandTaskStatus } from '../shared/status.js';

export interface OndemandTask {
  id: string;
  name: string;
  alias: string | null;
  description: string | null;
  userId: string;
  tool: ToolName;
  model: string | null;
  mode: Mode;
  prompt: string;
  workdir: string | null;
  maxRetries: number;
  allowMcp: boolean;
  enabledSkills: SkillRef[] | null;
  instructionFile: string | null;
  agentId: string | null;
  notifyChannel: string | null;
  notifyThread: string | null;
  status: OndemandTaskStatus;
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOndemandTask {
  name: string;
  alias?: string | null;
  description?: string | null;
  userId?: string;
  tool: ToolName;
  model?: string | null;
  mode: Mode;
  prompt: string;
  workdir?: string | null;
  maxRetries?: number;
  allowMcp?: boolean;
  enabledSkills?: SkillRef[] | null;
  instructionFile?: string | null;
  agentId?: string | null;
  notifyChannel?: string | null;
  notifyThread?: string | null;
}

export interface OndemandTaskRun {
  id: string;
  taskId: string;
  sessionKey: string;
  status: OndemandRunStatus;
  exitCode: number | null;
  outputSummary: string | null;
  errorMessage: string | null;
  startedAt: string;
  endedAt: string | null;
  retryCount: number;
  source: string;
}

/* ── Row types (snake_case from SQLite) ── */

interface TaskRow {
  id: string;
  name: string;
  alias: string | null;
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
  status: string;
  run_count: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
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
  retry_count: number;
  source: string;
}

/* ── Store ── */

/** On-demand task CRUD with alias-based uniqueness and run history. */
export class OndemandTaskStore {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateOndemandTask): OndemandTask {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Validate effective key uniqueness
    const effectiveKey = input.alias?.trim() || input.name.trim();
    if (!this.isKeyAvailable(effectiveKey)) {
      throw new Error(`On-demand task key "${effectiveKey}" is already in use`);
    }

    this.db
      .prepare(
        `INSERT INTO ondemand_tasks
           (id, name, alias, description, user_id, tool, model, mode, prompt, workdir,
            max_retries, allow_mcp, enabled_skills_json, instruction_file, agent_id,
            notify_channel, notify_thread, status, run_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)`,
      )
      .run(
        id,
        input.name.trim(),
        input.alias?.trim() || null,
        input.description?.trim() || null,
        input.userId ?? 'dashboard',
        input.tool,
        input.model ?? null,
        input.mode,
        input.prompt,
        input.workdir ?? null,
        input.maxRetries ?? 0,
        boolToDb(input.allowMcp ?? true),
        skillsToDb(input.enabledSkills),
        input.instructionFile ?? null,
        input.agentId ?? null,
        input.notifyChannel ?? null,
        input.notifyThread ?? null,
        now,
        now,
      );

    logger.info('ondemand_task_created', { id, name: input.name });
    const created = this.getById(id);
    if (created === null) {
      throw new Error(`Failed to load created on-demand task: ${id}`);
    }
    return created;
  }

  getById(id: string): OndemandTask | null {
    const row = this.db.prepare('SELECT * FROM ondemand_tasks WHERE id = ?').get(id) as
      | TaskRow
      | undefined;
    return row ? toTask(row) : null;
  }

  /**
   * Lookup by effective key (alias ?? name) for Slack !task dispatch.
   * Only matches active tasks.
   */
  findByKey(nameOrAlias: string): OndemandTask | null {
    const row = this.db
      .prepare(
        `SELECT * FROM ondemand_tasks
         WHERE status = 'active'
           AND (alias = ? OR (alias IS NULL AND name = ?))`,
      )
      .get(nameOrAlias, nameOrAlias) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  list(filter?: { status?: OndemandTaskStatus }): OndemandTask[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    } else {
      conditions.push("status != 'deleted'");
    }

    const sql = `SELECT * FROM ondemand_tasks WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`;
    const rows = this.db.prepare(sql).all(...params) as TaskRow[];
    return rows.map(toTask);
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        OndemandTask,
        | 'name'
        | 'alias'
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
        | 'status'
        | 'runCount'
        | 'lastRunAt'
      >
    >,
    expectedUpdatedAt?: string,
  ): void {
    // Wrap uniqueness check + UPDATE in a transaction to prevent race conditions
    const doUpdate = this.db.transaction(() => {
      // If name or alias is changing, validate uniqueness
      if ('name' in patch || 'alias' in patch) {
        const existing = this.getById(id);
        if (existing) {
          const newAlias = 'alias' in patch ? (patch.alias ?? null) : existing.alias;
          const newName = 'name' in patch ? (patch.name ?? existing.name) : existing.name;
          const effectiveKey = newAlias?.trim() || newName.trim();
          if (!this.isKeyAvailable(effectiveKey, id)) {
            throw new Error(`On-demand task key "${effectiveKey}" is already in use`);
          }
        }
      }

      const result = buildDynamicUpdate(patch as Record<string, unknown>, {
        fieldMap: {
          name: 'name',
          alias: 'alias',
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
          status: 'status',
          runCount: 'run_count',
          lastRunAt: 'last_run_at',
        },
        transforms: {
          model: TRIM_OR_NULL_TRANSFORM,
          allowMcp: BOOL_TRANSFORM,
          enabledSkills: SKILLS_TRANSFORM,
        },
        expectedUpdatedAt,
      });
      if (!result) return;

      const whereClause = result.extraWhere ? `WHERE id = ? ${result.extraWhere}` : 'WHERE id = ?';
      result.params.push(id);
      if (result.extraWhereParams) result.params.push(...result.extraWhereParams);
      const info = this.db
        .prepare(`UPDATE ondemand_tasks SET ${result.sets.join(', ')} ${whereClause}`)
        .run(...result.params);
      if (expectedUpdatedAt && info.changes === 0) {
        throw new StaleUpdateError('On-demand task', id);
      }
    });
    doUpdate();
  }

  /**
   * Atomically increment run_count and set last_run_at.
   * Uses SQL `run_count = run_count + 1` to avoid read-modify-write races.
   */
  incrementRunCount(id: string, lastRunAt: string): void {
    this.db
      .prepare(
        `UPDATE ondemand_tasks
         SET run_count = run_count + 1, last_run_at = ?
         WHERE id = ?`,
      )
      .run(lastRunAt, id);
  }

  softDelete(id: string): void {
    this.update(id, { status: 'deleted' });
    logger.info('ondemand_task_deleted', { id });
  }

  /* ── Run records ── */

  recordRun(
    run: Omit<
      OndemandTaskRun,
      'endedAt' | 'exitCode' | 'outputSummary' | 'errorMessage' | 'retryCount'
    > & {
      endedAt?: string | null;
      exitCode?: number | null;
      outputSummary?: string | null;
      errorMessage?: string | null;
      retryCount?: number;
    },
  ): void {
    this.db
      .prepare(
        `INSERT INTO ondemand_task_runs
           (id, task_id, session_key, status, exit_code, output_summary,
            error_message, started_at, ended_at, retry_count, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        run.retryCount ?? 0,
        run.source,
      );
  }

  updateRun(
    runId: string,
    patch: Partial<
      Pick<OndemandTaskRun, 'status' | 'exitCode' | 'outputSummary' | 'errorMessage' | 'endedAt'>
    >,
  ): void {
    const result = buildDynamicUpdate(patch as Record<string, unknown>, {
      fieldMap: {
        status: 'status',
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
      .prepare(`UPDATE ondemand_task_runs SET ${result.sets.join(', ')} WHERE id = ?`)
      .run(...result.params);
  }

  getRunsByTask(taskId: string, limit = 20): OndemandTaskRun[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM ondemand_task_runs
         WHERE task_id = ?
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(taskId, limit) as RunRow[];
    return rows.map(toRun);
  }

  getRunById(runId: string): OndemandTaskRun | null {
    const row = this.db.prepare('SELECT * FROM ondemand_task_runs WHERE id = ?').get(runId) as
      | RunRow
      | undefined;
    return row ? toRun(row) : null;
  }

  /**
   * Check if an effective key (alias ?? name) is available.
   * Used for uniqueness validation at create/update time.
   */
  isKeyAvailable(key: string, excludeId?: string): boolean {
    const sql = excludeId
      ? `SELECT id FROM ondemand_tasks
         WHERE status != 'deleted'
           AND COALESCE(alias, name) = ?
           AND id != ?`
      : `SELECT id FROM ondemand_tasks
         WHERE status != 'deleted'
           AND COALESCE(alias, name) = ?`;
    const params = excludeId ? [key, excludeId] : [key];
    const row = this.db.prepare(sql).get(...params);
    return !row;
  }
}
