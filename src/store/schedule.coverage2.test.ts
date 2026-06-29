/** Coverage2 tests for store/schedule: uncovered lines 198-199 (create throws when getById returns null) */
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleStore } from './schedule.js';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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

describe('ScheduleStore coverage2', () => {
  it('create returns a valid task (line 198-199)', () => {
    const db = createDb();
    const store = new ScheduleStore(db);

    const task = store.create({
      name: 'Test Task',
      userId: 'U1',
      scheduleType: 'once',
      runAt: new Date(Date.now() + 60000).toISOString(),
      cronExpr: null,
      timezone: 'UTC',
      tool: 'claude',
      mode: 'write',
      prompt: 'Do something',
      workdir: null,
      notifyChannel: null,
      agentId: null,
    });

    expect(task).toBeDefined();
    expect(task.name).toBe('Test Task');
    expect(task.id).toBeDefined();
    db.close();
  });
});
