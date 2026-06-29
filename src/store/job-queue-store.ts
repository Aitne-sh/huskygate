/** @module job-queue-store — SQLite-backed QueueStore for durable active job state. */
import type Database from 'better-sqlite3';
import { isToolName } from '../config.js';
import type { PersistedJobState, PersistedQueueJob, QueueStore } from '../queue/queue-store.js';
import type { Job } from '../queue/types.js';
import { isMode } from '../session/types.js';
import { normalizeStoredSkillRefs } from '../skills/skill-refs.js';
import { errorMessage } from '../utils/error.js';
import { logger } from '../utils/logger.js';

interface QueueRow {
  id: number;
  job_id: string;
  status: string;
  payload: string;
  leased_at: string | null;
}

interface CountRow {
  count: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Compile-time: satisfies ensures this array stays in sync with Job['source'].
// Runtime: Set<string> so .has() accepts unknown strings from deserialized payloads.
const VALID_SOURCES = new Set<string>([
  'slack',
  'dashboard',
  'schedule',
  'assistant',
  'ondemand-task',
  'triggered-task',
  'orchestrator',
  'orchestrator-summary',
] as const satisfies readonly NonNullable<Job['source']>[]);

function assertOptionalString(parsed: Record<string, unknown>, field: string, jobId: string): void {
  if (parsed[field] !== undefined && parsed[field] !== null && typeof parsed[field] !== 'string') {
    throw new Error(`Persisted queue job ${jobId} has invalid ${field}: expected string`);
  }
}

function parsePersistedJob(payload: string, expectedJobId: string): Job {
  const parsed = JSON.parse(payload) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Persisted queue payload for ${expectedJobId} is not an object`);
  }

  const id = parsed.id;
  const sessionKey = parsed.sessionKey;
  const channelId = parsed.channelId;
  const threadTs = parsed.threadTs;
  const userId = parsed.userId;
  const tool = parsed.tool;
  const mode = parsed.mode;
  const prompt = parsed.prompt;
  const workdir = parsed.workdir;
  const toolState = parsed.toolState;
  const createdAt = parsed.createdAt;

  if (typeof id !== 'string' || id !== expectedJobId) {
    throw new Error(`Persisted queue job ID mismatch for ${expectedJobId}`);
  }
  if (typeof sessionKey !== 'string' || sessionKey.length === 0) {
    throw new Error(`Persisted queue job ${expectedJobId} is missing sessionKey`);
  }
  if (typeof channelId !== 'string' || typeof threadTs !== 'string' || typeof userId !== 'string') {
    throw new Error(`Persisted queue job ${expectedJobId} has invalid routing metadata`);
  }
  if (typeof tool !== 'string' || !isToolName(tool)) {
    throw new Error(`Persisted queue job ${expectedJobId} has invalid tool`);
  }
  if (typeof mode !== 'string' || !isMode(mode)) {
    throw new Error(`Persisted queue job ${expectedJobId} has invalid mode`);
  }
  if (typeof prompt !== 'string' || typeof workdir !== 'string') {
    throw new Error(`Persisted queue job ${expectedJobId} has invalid prompt/workdir`);
  }
  if (!isRecord(toolState)) {
    throw new Error(`Persisted queue job ${expectedJobId} has invalid toolState`);
  }
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) {
    throw new Error(`Persisted queue job ${expectedJobId} has invalid createdAt`);
  }
  if (
    parsed.source !== undefined &&
    (typeof parsed.source !== 'string' || !VALID_SOURCES.has(parsed.source))
  ) {
    throw new Error(
      `Persisted queue job ${expectedJobId} has invalid source: ${String(parsed.source)}`,
    );
  }
  if (parsed.toolStateOverrides !== undefined && !isRecord(parsed.toolStateOverrides)) {
    throw new Error(`Persisted queue job ${expectedJobId} has invalid toolStateOverrides`);
  }
  if (
    parsed.executionPolicy !== undefined &&
    parsed.executionPolicy !== null &&
    !isRecord(parsed.executionPolicy)
  ) {
    throw new Error(`Persisted queue job ${expectedJobId} has invalid executionPolicy`);
  }
  if (isRecord(parsed.executionPolicy) && 'enabledSkills' in parsed.executionPolicy) {
    const normalized = normalizeStoredSkillRefs(parsed.executionPolicy.enabledSkills);
    if (!normalized.valid) {
      throw new Error(
        `Persisted queue job ${expectedJobId} has invalid executionPolicy.enabledSkills`,
      );
    }
    parsed.executionPolicy.enabledSkills = normalized.skillRefs;
  }

  // Validate optional ID fields consumed by recovery validation
  for (const field of [
    'scheduleTaskId',
    'scheduleRunId',
    'ondemandTaskId',
    'ondemandTaskRunId',
    'triggeredTaskId',
    'triggeredTaskRunId',
    'orchestrationRunId',
    'orchestrationNodeId',
    'instructionFile',
  ]) {
    assertOptionalString(parsed, field, expectedJobId);
  }

  return parsed as unknown as Job;
}

/** SQLite-backed implementation of durable queue persistence. */
export class JobQueueStore implements QueueStore {
  private readonly insertStmt: Database.Statement;
  private readonly queuedCountStmt: Database.Statement;
  private readonly markRunningStmt: Database.Statement;
  private readonly replaceStmt: Database.Statement;
  private readonly removeStmt: Database.Statement;
  private readonly removeQueuedBySessionStmt: Database.Statement;
  private readonly listActiveStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.insertStmt = db.prepare(
      `INSERT INTO job_queue (
         job_id, session_key, source, status, payload, leased_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.queuedCountStmt = db.prepare(
      `SELECT COUNT(*) AS count
         FROM job_queue
        WHERE status = 'queued'`,
    );
    this.markRunningStmt = db.prepare(
      `UPDATE job_queue
          SET status = 'running',
              leased_at = ?,
              updated_at = ?
        WHERE job_id = ?
          AND status = 'queued'`,
    );
    this.replaceStmt = db.prepare(
      `UPDATE job_queue
          SET job_id = ?,
              session_key = ?,
              source = ?,
              status = ?,
              payload = ?,
              leased_at = ?,
              updated_at = ?
        WHERE job_id = ?`,
    );
    this.removeStmt = db.prepare('DELETE FROM job_queue WHERE job_id = ?');
    this.removeQueuedBySessionStmt = db.prepare(
      `DELETE FROM job_queue
        WHERE session_key = ?
          AND status = 'queued'`,
    );
    this.listActiveStmt = db.prepare(
      `SELECT id, job_id, status, payload, leased_at
         FROM job_queue
        ORDER BY id ASC`,
    );
  }

  save(job: Job, state: PersistedJobState): number {
    const now = new Date().toISOString();
    this.insertStmt.run(
      job.id,
      job.sessionKey,
      job.source ?? null,
      state,
      JSON.stringify(job),
      state === 'running' ? now : null,
      now,
      now,
    );
    if (state === 'running') return 0;
    const row = this.queuedCountStmt.get() as CountRow | undefined;
    return row?.count ?? 0;
  }

  markRunning(jobId: string): void {
    const now = new Date().toISOString();
    const result = this.markRunningStmt.run(now, now, jobId);
    if (result.changes === 0) {
      throw new Error(`markRunning: no queued row found for job ${jobId}`);
    }
  }

  replace(jobId: string, job: Job, state: PersistedJobState): void {
    const now = new Date().toISOString();
    const result = this.replaceStmt.run(
      job.id,
      job.sessionKey,
      job.source ?? null,
      state,
      JSON.stringify(job),
      state === 'running' ? now : null,
      now,
      jobId,
    );
    if (result.changes === 0) {
      throw new Error(`replace: no row found for job ${jobId}`);
    }
  }

  remove(jobId: string): void {
    this.removeStmt.run(jobId);
  }

  removeQueuedBySession(sessionKey: string): number {
    return this.removeQueuedBySessionStmt.run(sessionKey).changes;
  }

  listActive(): PersistedQueueJob[] {
    const rows = this.listActiveStmt.all() as QueueRow[];
    const active: PersistedQueueJob[] = [];
    for (const row of rows) {
      try {
        if (row.status !== 'queued' && row.status !== 'running') {
          throw new Error(`Persisted queue row ${row.job_id} has invalid status: ${row.status}`);
        }
        active.push({
          order: row.id,
          state: row.status,
          leasedAt: row.leased_at,
          job: parsePersistedJob(row.payload, row.job_id),
        });
      } catch (err) {
        this.removeStmt.run(row.job_id);
        logger.error('job_queue_row_discarded', {
          job_id: row.job_id,
          order: row.id,
          error: errorMessage(err),
        });
      }
    }
    return active;
  }
}
