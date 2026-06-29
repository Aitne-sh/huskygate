/**
 * Coverage tests for store/schedule — covers recoverStaleClaims, softDelete, stale update, and run operations.
 */
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { ScheduleStore } from './schedule.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE scheduled_tasks (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      description     TEXT,
      user_id         TEXT NOT NULL,
      tool            TEXT NOT NULL DEFAULT 'claude',
      model           TEXT,
      mode            TEXT NOT NULL DEFAULT 'readonly',
      prompt          TEXT NOT NULL,
      workdir         TEXT,
      schedule_type   TEXT NOT NULL,
      run_at          TEXT,
      cron_expr       TEXT,
      timezone        TEXT NOT NULL DEFAULT 'default',
      notify_channel  TEXT,
      notify_thread   TEXT,
      status          TEXT NOT NULL DEFAULT 'active',
      last_run_at     TEXT,
      next_run_at     TEXT,
      run_count       INTEGER NOT NULL DEFAULT 0,
      max_runs        INTEGER,
      max_retries     INTEGER DEFAULT 0,
      allow_mcp       INTEGER NOT NULL DEFAULT 1,
      enabled_skills_json TEXT,
      instruction_file TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      claimed_at      TEXT,
      agent_id        TEXT
    );

    CREATE TABLE scheduled_task_runs (
      id              TEXT PRIMARY KEY,
      task_id         TEXT NOT NULL,
      session_key     TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      exit_code       INTEGER,
      output_summary  TEXT,
      error_message   TEXT,
      started_at      TEXT NOT NULL,
      ended_at        TEXT,
      artifacts       TEXT,
      retry_count     INTEGER NOT NULL DEFAULT 0,
      source          TEXT NOT NULL DEFAULT 'schedule'
    );
  `);
  return db;
}

describe('ScheduleStore coverage', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('softDelete marks task as deleted and clears claim', () => {
    db = createDb();
    const store = new ScheduleStore(db);
    const task = store.create({
      name: 'test',
      userId: 'U1',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'test',
      scheduleType: 'once',
    });

    // Claim it first
    store.claimTask(task.id, new Date().toISOString());
    let current = store.getById(task.id);
    expect(current?.status).toBe('active');

    store.softDelete(task.id);
    current = store.getById(task.id);
    expect(current?.status).toBe('deleted');
  });

  it('recoverStaleClaims resets old claims', () => {
    db = createDb();
    const store = new ScheduleStore(db);
    const task = store.create({
      name: 'test',
      userId: 'U1',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'test',
      scheduleType: 'once',
    });

    // Set a stale claim (far in the past)
    const pastDate = new Date(Date.now() - 120 * 60_000).toISOString();
    db?.prepare('UPDATE scheduled_tasks SET claimed_at = ? WHERE id = ?').run(pastDate, task.id);

    const recovered = store.recoverStaleClaims(60);
    expect(recovered).toBe(1);

    store.getById(task.id);
    // claimed_at should be null now (from the raw row, not the mapped object)
    const row = db?.prepare('SELECT claimed_at FROM scheduled_tasks WHERE id = ?').get(task.id) as {
      claimed_at: string | null;
    };
    expect(row.claimed_at).toBeNull();
  });

  it('recoverStaleClaims returns 0 when no stale claims', () => {
    db = createDb();
    const store = new ScheduleStore(db);
    const recovered = store.recoverStaleClaims(60);
    expect(recovered).toBe(0);
  });

  it('update with expectedUpdatedAt throws StaleUpdateError on mismatch', () => {
    db = createDb();
    const store = new ScheduleStore(db);
    const task = store.create({
      name: 'test',
      userId: 'U1',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'test',
      scheduleType: 'once',
    });

    expect(() => {
      store.update(task.id, { name: 'new name' }, '2020-01-01T00:00:00Z');
    }).toThrow('modified by another request');
  });

  it('update with status change clears claimed_at', () => {
    db = createDb();
    const store = new ScheduleStore(db);
    const task = store.create({
      name: 'test',
      userId: 'U1',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'test',
      scheduleType: 'once',
    });

    store.claimTask(task.id, new Date().toISOString());
    store.update(task.id, { status: 'completed' });

    const row = db?.prepare('SELECT claimed_at FROM scheduled_tasks WHERE id = ?').get(task.id) as {
      claimed_at: string | null;
    };
    expect(row.claimed_at).toBeNull();
  });

  it('recordRun and getRunById work together', () => {
    db = createDb();
    const store = new ScheduleStore(db);
    const task = store.create({
      name: 'test',
      userId: 'U1',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'test',
      scheduleType: 'once',
    });

    store.recordRun({
      id: 'run-1',
      taskId: task.id,
      sessionKey: 'sess-1',
      status: 'running',
      startedAt: new Date().toISOString(),
      source: 'schedule',
    });

    const run = store.getRunById('run-1');
    expect(run).toBeTruthy();
    expect(run?.status).toBe('running');
    expect(run?.source).toBe('schedule');
  });

  it('getRunById returns null for nonexistent run', () => {
    db = createDb();
    const store = new ScheduleStore(db);
    expect(store.getRunById('nonexistent')).toBeNull();
  });

  it('updateRun modifies fields', () => {
    db = createDb();
    const store = new ScheduleStore(db);
    const task = store.create({
      name: 'test',
      userId: 'U1',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'test',
      scheduleType: 'once',
    });

    store.recordRun({
      id: 'run-1',
      taskId: task.id,
      sessionKey: 'sess-1',
      status: 'running',
      startedAt: new Date().toISOString(),
      source: 'schedule',
    });

    store.updateRun('run-1', {
      status: 'completed',
      exitCode: 0,
      outputSummary: 'Done',
      endedAt: new Date().toISOString(),
    });

    const run = store.getRunById('run-1');
    expect(run?.status).toBe('completed');
    expect(run?.exitCode).toBe(0);
  });

  it('updateRun with empty patch is a no-op', () => {
    db = createDb();
    const store = new ScheduleStore(db);
    const task = store.create({
      name: 'test',
      userId: 'U1',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'test',
      scheduleType: 'once',
    });

    store.recordRun({
      id: 'run-1',
      taskId: task.id,
      sessionKey: 'sess-1',
      status: 'running',
      startedAt: new Date().toISOString(),
      source: 'schedule',
    });

    store.updateRun('run-1', {});
    const run = store.getRunById('run-1');
    expect(run?.status).toBe('running');
  });

  it('releaseClaim explicitly called sets claimed_at to null', () => {
    db = createDb();
    const store = new ScheduleStore(db);
    const task = store.create({
      name: 'test',
      userId: 'U1',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'test',
      scheduleType: 'once',
    });

    const now = new Date().toISOString();
    store.claimTask(task.id, now);

    // Verify claim is set
    const row1 = db
      ?.prepare('SELECT claimed_at FROM scheduled_tasks WHERE id = ?')
      .get(task.id) as { claimed_at: string | null };
    expect(row1.claimed_at).toBeTruthy();

    store.releaseClaim(task.id);

    const row2 = db
      ?.prepare('SELECT claimed_at FROM scheduled_tasks WHERE id = ?')
      .get(task.id) as { claimed_at: string | null };
    expect(row2.claimed_at).toBeNull();
  });

  it('list with userId filter', () => {
    db = createDb();
    const store = new ScheduleStore(db);
    store.create({
      name: 'test-U1',
      userId: 'U1',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'test',
      scheduleType: 'once',
    });
    store.create({
      name: 'test-U2',
      userId: 'U2',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'test',
      scheduleType: 'once',
    });

    const u1Tasks = store.list({ userId: 'U1' });
    expect(u1Tasks).toHaveLength(1);
    expect(u1Tasks[0]?.name).toBe('test-U1');
  });
});
