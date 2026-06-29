import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OndemandTaskStore } from './ondemand-task.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE ondemand_tasks (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      alias           TEXT,
      description     TEXT,
      user_id         TEXT NOT NULL DEFAULT 'dashboard',
      tool            TEXT NOT NULL DEFAULT 'claude',
      model           TEXT,
      mode            TEXT NOT NULL DEFAULT 'write',
      prompt          TEXT NOT NULL,
      workdir         TEXT,
      max_retries     INTEGER DEFAULT 0,
      allow_mcp       INTEGER NOT NULL DEFAULT 1,
      enabled_skills_json TEXT,
      instruction_file TEXT,
      notify_channel  TEXT,
      notify_thread   TEXT,
      status          TEXT NOT NULL DEFAULT 'active',
      run_count       INTEGER NOT NULL DEFAULT 0,
      last_run_at     TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      agent_id        TEXT
    );

    CREATE UNIQUE INDEX idx_ondemand_task_key
      ON ondemand_tasks(COALESCE(alias, name)) WHERE status != 'deleted';

    CREATE TABLE ondemand_task_runs (
      id              TEXT PRIMARY KEY,
      task_id         TEXT NOT NULL,
      session_key     TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      exit_code       INTEGER,
      output_summary  TEXT,
      error_message   TEXT,
      started_at      TEXT NOT NULL,
      ended_at        TEXT,
      retry_count     INTEGER DEFAULT 0,
      source          TEXT DEFAULT 'dashboard'
    );

    CREATE INDEX idx_ondemand_runs_task ON ondemand_task_runs(task_id, started_at DESC);
  `);
  return db;
}

describe('OndemandTaskStore', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('creates, fetches, lists, and soft-deletes tasks', () => {
    db = createDb();
    const store = new OndemandTaskStore(db);

    const first = store.create({
      name: '  daily-report  ',
      alias: '  report  ',
      description: '  summarize errors  ',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'summarize logs',
      maxRetries: 2,
      notifyChannel: 'C123',
    });
    expect(first.name).toBe('daily-report');
    expect(first.alias).toBe('report');
    expect(first.description).toBe('summarize errors');
    expect(first.userId).toBe('dashboard');
    expect(first.maxRetries).toBe(2);
    expect(first.notifyChannel).toBe('C123');

    const second = store.create({
      name: 'no-alias',
      tool: 'gemini',
      mode: 'write',
      prompt: 'do it',
    });

    expect(store.getById(first.id)?.id).toBe(first.id);
    expect(store.getById('missing')).toBeNull();

    db.prepare(
      `INSERT INTO ondemand_tasks
         (id, name, alias, description, user_id, tool, mode, prompt, max_retries, notify_channel, status, run_count, last_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'legacy-null-max-retries',
      'legacy',
      null,
      null,
      'U-legacy',
      'claude',
      'readonly',
      'legacy prompt',
      null,
      null,
      'active',
      0,
      null,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );
    expect(store.getById('legacy-null-max-retries')?.maxRetries).toBe(0);

    expect(store.findByKey('report')?.id).toBe(first.id);
    expect(store.findByKey('daily-report')).toBeNull();
    expect(store.findByKey('no-alias')?.id).toBe(second.id);
    expect(store.findByKey('not-found')).toBeNull();
    expect(store.list()).toHaveLength(3);
    expect(store.list({ status: 'active' })).toHaveLength(3);

    expect(() =>
      store.create({
        name: 'duplicate',
        alias: 'report',
        tool: 'codex',
        mode: 'readonly',
        prompt: 'x',
      }),
    ).toThrow('On-demand task key "report" is already in use');

    store.softDelete(first.id);
    expect(store.list()).toHaveLength(2);
    expect(store.list({ status: 'deleted' })).toHaveLength(1);

    expect(store.isKeyAvailable('report')).toBe(true);
    expect(store.isKeyAvailable('no-alias')).toBe(false);
    expect(store.isKeyAvailable('no-alias', second.id)).toBe(true);
  });

  it('updates fields, validates key uniqueness, and increments run count', () => {
    db = createDb();
    const store = new OndemandTaskStore(db);

    const first = store.create({
      name: 'task-a',
      alias: 'alpha',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'a',
    });
    store.create({
      name: 'task-b',
      alias: 'beta',
      tool: 'gemini',
      mode: 'write',
      prompt: 'b',
    });

    const beforeUpdatedAt = store.getById(first.id)?.updatedAt;
    store.update(first.id, {});
    expect(store.getById(first.id)?.updatedAt).toBe(beforeUpdatedAt);

    store.update(first.id, {
      name: 'task-a2',
      alias: null,
      description: 'updated',
      tool: 'codex',
      mode: 'write',
      prompt: 'updated prompt',
      maxRetries: 4,
      notifyChannel: null,
      status: 'active',
      runCount: 7,
      lastRunAt: '2026-01-03T00:00:00.000Z',
    });

    const updated = store.getById(first.id);
    expect(updated?.name).toBe('task-a2');
    expect(updated?.alias).toBeNull();
    expect(updated?.description).toBe('updated');
    expect(updated?.tool).toBe('codex');
    expect(updated?.mode).toBe('write');
    expect(updated?.prompt).toBe('updated prompt');
    expect(updated?.maxRetries).toBe(4);
    expect(updated?.runCount).toBe(7);
    expect(updated?.lastRunAt).toBe('2026-01-03T00:00:00.000Z');

    store.update(first.id, { name: 'task-a3' });
    expect(store.getById(first.id)?.name).toBe('task-a3');

    expect(() => store.update(first.id, { alias: undefined, name: undefined })).toThrow(
      'NOT NULL constraint failed',
    );

    expect(() => store.update(first.id, { alias: 'beta' })).toThrow(
      'On-demand task key "beta" is already in use',
    );

    expect(() => store.update(first.id, { name: 'stale' }, '2000-01-01T00:00:00.000Z')).toThrow(
      /was modified by another request/,
    );

    store.update('missing-id', { name: 'still-missing' });
    store.incrementRunCount(first.id, '2026-02-01T00:00:00.000Z');
    expect(store.getById(first.id)?.runCount).toBe(8);
    expect(store.getById(first.id)?.lastRunAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('records, updates, and lists run history', () => {
    db = createDb();
    const store = new OndemandTaskStore(db);

    const task = store.create({
      name: 'runner',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'run',
    });

    store.recordRun({
      id: 'run-1',
      taskId: task.id,
      sessionKey: 'sess-1',
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
      source: 'dashboard',
    });
    store.updateRun('run-1', {});
    store.updateRun('run-1', {
      status: 'completed',
      exitCode: 0,
      outputSummary: 'ok',
      errorMessage: null,
      endedAt: '2026-01-01T00:01:00.000Z',
    });

    const run1 = store.getRunById('run-1');
    expect(run1?.status).toBe('completed');
    expect(run1?.exitCode).toBe(0);
    expect(run1?.outputSummary).toBe('ok');
    expect(run1?.retryCount).toBe(0);
    expect(run1?.source).toBe('dashboard');

    store.recordRun({
      id: 'run-2',
      taskId: task.id,
      sessionKey: 'sess-2',
      status: 'failed',
      startedAt: '2026-01-02T00:00:00.000Z',
      endedAt: '2026-01-02T00:01:00.000Z',
      errorMessage: 'boom',
      retryCount: 2,
      source: 'slack',
    });

    const latestOnly = store.getRunsByTask(task.id, 1);
    expect(latestOnly).toHaveLength(1);
    expect(latestOnly[0]?.id).toBe('run-2');
    expect(latestOnly[0]?.retryCount).toBe(2);
    expect(latestOnly[0]?.source).toBe('slack');

    db.prepare(
      `INSERT INTO ondemand_task_runs
         (id, task_id, session_key, status, exit_code, output_summary, error_message, started_at, ended_at, retry_count, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'run-nulls',
      task.id,
      'sess-null',
      'failed',
      null,
      null,
      null,
      '2026-01-03T00:00:00.000Z',
      null,
      null,
      null,
    );
    const nullRun = store.getRunById('run-nulls');
    expect(nullRun?.retryCount).toBe(0);
    expect(nullRun?.source).toBe('dashboard');

    expect(store.getRunById('missing')).toBeNull();
  });

  it('creates a task with model and updates it', () => {
    db = createDb();
    const store = new OndemandTaskStore(db);

    // Create with explicit model
    const withModel = store.create({
      name: 'model-task',
      tool: 'claude',
      mode: 'write',
      prompt: 'run with model',
      model: 'claude-opus-4-6',
    });
    expect(withModel.model).toBe('claude-opus-4-6');

    // Create without model → defaults to null
    const noModel = store.create({
      name: 'no-model-task',
      tool: 'gemini',
      mode: 'readonly',
      prompt: 'run default',
    });
    expect(noModel.model).toBeNull();

    // Update model
    store.update(withModel.id, { model: 'claude-sonnet-4-6' });
    expect(store.getById(withModel.id)?.model).toBe('claude-sonnet-4-6');

    // Clear model → null (via whitespace-only)
    store.update(withModel.id, { model: '   ' });
    expect(store.getById(withModel.id)?.model).toBeNull();

    // Set model on previously null-model task
    store.update(noModel.id, { model: 'gemini-2.5-pro' });
    expect(store.getById(noModel.id)?.model).toBe('gemini-2.5-pro');
  });

  it('throws when the created task cannot be reloaded', () => {
    db = createDb();
    const store = new OndemandTaskStore(db);
    const getByIdSpy = vi.spyOn(store, 'getById').mockReturnValue(null);

    expect(() =>
      store.create({
        name: 'cannot-reload',
        tool: 'claude',
        mode: 'readonly',
        prompt: 'x',
      }),
    ).toThrow('Failed to load created on-demand task');

    getByIdSpy.mockRestore();
  });
});
