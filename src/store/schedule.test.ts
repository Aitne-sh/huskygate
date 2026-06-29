import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { getOsTimezone } from '../utils/timezone.js';
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
      dev_alias       TEXT,
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

describe('ScheduleStore', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('creates a task and applies defaults', () => {
    db = createDb();
    const store = new ScheduleStore(db);

    const created = store.create({
      name: 'daily report',
      userId: 'U1',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'summarize errors',
      scheduleType: 'recurring',
      cronExpr: '0 9 * * *',
      nextRunAt: '2026-01-02T00:00:00.000Z',
    });

    expect(created.id).toBeTruthy();
    expect(created.timezone).toBe(getOsTimezone());
    expect(created.status).toBe('active');
    expect(created.runCount).toBe(0);

    const fetched = store.getById(created.id);
    expect(fetched?.name).toBe('daily report');
    expect(fetched?.cronExpr).toBe('0 9 * * *');
  });

  it('lists, updates, and soft-deletes tasks', () => {
    db = createDb();
    const store = new ScheduleStore(db);
    const created = store.create({
      name: 'one-shot',
      userId: 'U2',
      tool: 'codex',
      mode: 'write',
      prompt: 'run migration',
      scheduleType: 'once',
      runAt: '2026-01-05T10:00:00.000Z',
      nextRunAt: '2026-01-05T10:00:00.000Z',
    });

    const before = store.getById(created.id);
    store.update(created.id, {});
    const after = store.getById(created.id);
    expect(after?.updatedAt).toBe(before?.updatedAt);

    store.update(created.id, {
      status: 'paused',
      runCount: 3,
      maxRuns: 5,
    });
    const updated = store.getById(created.id);
    expect(updated?.status).toBe('paused');
    expect(updated?.runCount).toBe(3);
    expect(updated?.maxRuns).toBe(5);

    expect(store.list({ userId: 'U2', status: 'paused' })).toHaveLength(1);

    store.softDelete(created.id);
    expect(store.list({ userId: 'U2' })).toHaveLength(0);
    expect(store.list({ userId: 'U2', status: 'deleted' })).toHaveLength(1);
  });

  it('returns only active due tasks ordered by next_run_at', () => {
    db = createDb();
    const store = new ScheduleStore(db);

    const first = store.create({
      name: 'first',
      userId: 'U1',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'a',
      scheduleType: 'recurring',
      cronExpr: '0 9 * * *',
      nextRunAt: '2026-01-10T09:00:00.000Z',
    });
    const second = store.create({
      name: 'second',
      userId: 'U1',
      tool: 'gemini',
      mode: 'readonly',
      prompt: 'b',
      scheduleType: 'recurring',
      cronExpr: '0 10 * * *',
      nextRunAt: '2026-01-10T09:30:00.000Z',
    });
    const paused = store.create({
      name: 'paused',
      userId: 'U1',
      tool: 'codex',
      mode: 'readonly',
      prompt: 'c',
      scheduleType: 'recurring',
      cronExpr: '0 11 * * *',
      nextRunAt: '2026-01-10T08:30:00.000Z',
    });
    store.update(paused.id, { status: 'paused' });

    const due = store.getDueTasks('2026-01-10T09:30:00.000Z');
    expect(due.map((task) => task.id)).toEqual([first.id, second.id]);
  });

  it('records and updates task runs', () => {
    db = createDb();
    const store = new ScheduleStore(db);
    const task = store.create({
      name: 'runs',
      userId: 'U9',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'collect',
      scheduleType: 'once',
      runAt: '2026-01-01T00:00:00.000Z',
      nextRunAt: '2026-01-01T00:00:00.000Z',
    });

    store.recordRun({
      id: 'run-1',
      taskId: task.id,
      sessionKey: 'sess-1',
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
      source: 'schedule',
    });
    store.updateRun('run-1', {
      status: 'completed',
      exitCode: 0,
      outputSummary: 'ok',
      endedAt: '2026-01-01T00:02:00.000Z',
    });

    const run1 = store.getRunById('run-1');
    expect(run1?.status).toBe('completed');
    expect(run1?.exitCode).toBe(0);
    expect(run1?.outputSummary).toBe('ok');

    store.recordRun({
      id: 'run-2',
      taskId: task.id,
      sessionKey: 'sess-2',
      status: 'failed',
      errorMessage: 'timeout',
      startedAt: '2026-01-02T00:00:00.000Z',
      endedAt: '2026-01-02T00:01:00.000Z',
      source: 'schedule',
    });
    store.updateRun('run-2', {});

    const latestOnly = store.getRunsByTask(task.id, 1);
    expect(latestOnly).toHaveLength(1);
    expect(latestOnly[0]?.id).toBe('run-2');
    expect(store.getRunById('missing')).toBeNull();
  });

  it('creates a task with model and updates it', () => {
    db = createDb();
    const store = new ScheduleStore(db);

    const withModel = store.create({
      name: 'model schedule',
      userId: 'U1',
      tool: 'codex',
      mode: 'write',
      prompt: 'run with model',
      scheduleType: 'once',
      runAt: '2026-02-01T00:00:00.000Z',
      nextRunAt: '2026-02-01T00:00:00.000Z',
      model: 'o3',
    });
    expect(withModel.model).toBe('o3');

    const noModel = store.create({
      name: 'no model schedule',
      userId: 'U1',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'default model',
      scheduleType: 'once',
      runAt: '2026-02-01T00:00:00.000Z',
      nextRunAt: '2026-02-01T00:00:00.000Z',
    });
    expect(noModel.model).toBeNull();

    // Update model
    store.update(withModel.id, { model: 'gpt-4.1' });
    expect(store.getById(withModel.id)?.model).toBe('gpt-4.1');

    // Clear model
    store.update(withModel.id, { model: '  ' });
    expect(store.getById(withModel.id)?.model).toBeNull();

    // Model preserved in getDueTasks
    store.update(noModel.id, { model: 'claude-sonnet-4-6' });
    const due = store.getDueTasks('2026-02-01T00:01:00.000Z');
    const found = due.find((t) => t.id === noModel.id);
    expect(found?.model).toBe('claude-sonnet-4-6');
  });

  it('clears claimed_at when status changes away from active', () => {
    db = createDb();
    const store = new ScheduleStore(db);
    const task = store.create({
      name: 'claim-clear',
      userId: 'U1',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'test',
      scheduleType: 'recurring',
      cronExpr: '0 9 * * *',
      nextRunAt: '2026-01-10T09:00:00.000Z',
    });

    // Claim the task
    const claimed = store.claimTask(task.id, '2026-01-10T09:00:00.000Z');
    expect(claimed).not.toBeNull();

    // Verify claimed — task should NOT appear in getDueTasks
    const dueBefore = store.getDueTasks('2026-01-10T09:30:00.000Z');
    expect(dueBefore.map((t) => t.id)).not.toContain(task.id);

    // Transition to 'completed' — claimed_at should auto-clear
    store.update(task.id, { status: 'completed' });

    // Re-activate the task
    store.update(task.id, { status: 'active', nextRunAt: '2026-01-11T09:00:00.000Z' });

    // Task should now appear in getDueTasks (claimed_at was cleared)
    const dueAfter = store.getDueTasks('2026-01-11T09:30:00.000Z');
    expect(dueAfter.map((t) => t.id)).toContain(task.id);
  });
});
