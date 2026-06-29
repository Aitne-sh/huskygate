import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSkillRef } from '../skills/catalog.js';
import { TriggeredTaskStore } from './triggered-task.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE triggered_tasks (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      description         TEXT,
      user_id             TEXT NOT NULL DEFAULT 'dashboard',
      tool                TEXT NOT NULL DEFAULT 'claude',
      model               TEXT,
      mode                TEXT NOT NULL DEFAULT 'write',
      prompt              TEXT NOT NULL,
      workdir             TEXT,
      max_retries         INTEGER NOT NULL DEFAULT 0,
      allow_mcp           INTEGER NOT NULL DEFAULT 1,
      enabled_skills_json TEXT,
      instruction_file    TEXT,
      agent_id            TEXT,
      notify_channel      TEXT,
      notify_thread       TEXT,
      enabled             INTEGER NOT NULL DEFAULT 1,
      run_count           INTEGER NOT NULL DEFAULT 0,
      last_run_at         TEXT,
      concurrency_policy  TEXT NOT NULL DEFAULT 'skip_if_running',
      claimed_at          TEXT,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );
    CREATE TABLE triggered_task_runs (
      id                   TEXT PRIMARY KEY,
      triggered_task_id    TEXT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'pending',
      triggered_by         TEXT NOT NULL DEFAULT 'webhook',
      trigger_context_json TEXT,
      session_key          TEXT,
      job_id               TEXT,
      exit_code            INTEGER,
      output_summary       TEXT,
      error_message        TEXT,
      retry_count          INTEGER NOT NULL DEFAULT 0,
      started_at           TEXT NOT NULL,
      ended_at             TEXT
    );
    CREATE TABLE event_subscriptions (triggered_task_id TEXT);
  `);
  return db;
}

describe('TriggeredTaskStore', () => {
  let db: Database.Database | null = null;
  afterEach(() => {
    db?.close();
    db = null;
  });

  it('crud and claim', () => {
    db = createDb();
    const store = new TriggeredTaskStore(db);

    expect(store.transaction(() => 1)).toBe(1);

    const task = store.create({
      name: 'task1',
      prompt: 'prompt1',
      tool: 'claude',
      description: 'd',
      workdir: '/a',
      instructionFile: 'b',
      notifyChannel: 'c',
      maxRetries: 1,
    });
    // Also a barebones creation
    const task2 = store.create({
      name: 'task2',
      prompt: 'prompt2',
      tool: 'gemini',
      enabledSkills: null,
    });
    // Task with valid array of skills
    const task3 = store.create({
      name: 'task3',
      prompt: 'prompt3',
      tool: 'gemini',
      enabledSkills: [buildSkillRef('builtin', 'aws-cli')],
    });
    expect(store.getById(task3.id)?.enabledSkills).toEqual([buildSkillRef('builtin', 'aws-cli')]);

    db.exec(
      `UPDATE triggered_tasks
       SET enabled_skills_json = '["aws-cli"]'
       WHERE id = '${task2.id}'`,
    );
    // Bare "aws-cli" without "builtin:" prefix is not a valid SkillRef, so parseStoredSkillRefs returns null
    expect(store.getById(task2.id)?.enabledSkills).toBeNull();

    // Malformed JSON parsing
    db.exec(`UPDATE triggered_tasks SET enabled_skills_json = 'bad' WHERE id = '${task.id}'`);
    expect(store.getById(task.id)?.enabledSkills).toBeNull();
    db.exec(`UPDATE triggered_tasks SET enabled_skills_json = '{"a": 1}' WHERE id = '${task.id}'`);
    expect(store.getById(task.id)?.enabledSkills).toBeNull();

    expect(store.getById('missing')).toBeNull();

    expect(store.list().length).toBe(3);

    store.update(task2.id, { description: 'desc' });
    expect(store.getById(task2.id)?.description).toBe('desc');

    // blank
    store.update(task2.id, {});

    // Stale update
    expect(() => store.update(task2.id, { description: 'desc2' }, 'bad')).toThrow(
      /was modified by another request/,
    );

    store.incrementRunCount(task2.id, 'today');
    expect(store.getById(task2.id)?.runCount).toBe(1);

    // claim
    const claimed = store.claimTask(task2.id, '2020-01-01T00:00:00.000Z');
    expect(claimed).toBeDefined();
    expect(store.claimTask(task2.id, '2020-01-02T00:00:00.000Z')).toBeNull(); // already claimed

    // release
    store.releaseClaim(task2.id);
    expect(store.claimTask(task2.id, '2020-01-03T00:00:00.000Z')).toBeDefined();

    // recover
    // time in JS is Date.now() => around 2026.
    // if timeout is negative e.g. -1 min, cutoff is 1 min in future,
    // so 2020 is definitely < cutoff
    store.recoverStaleClaims(-1);
    expect(store.getById(task2.id)?.claimedAt).toBeNull();
  });

  it('runs', () => {
    db = createDb();
    const store = new TriggeredTaskStore(db);
    const task = store.create({ name: 'task1', prompt: 'prompt1', tool: 'claude' });

    store.recordRun({
      id: 'run1',
      triggeredTaskId: task.id,
      status: 'running',
      triggeredBy: 'webhook',
      startedAt: 'time1',
      exitCode: 0,
      outputSummary: 'out',
      errorMessage: 'err',
      endedAt: 'time2',
      retryCount: 1,
      triggerContextJson: '{}',
      sessionKey: 'ses',
      jobId: 'job',
    });
    store.recordRun({
      id: 'run2',
      triggeredTaskId: task.id,
      status: 'running',
      triggeredBy: 'webhook',
      startedAt: 'time3',
      triggerContextJson: null,
      sessionKey: null,
      jobId: null,
    });
    expect(store.getRunsByTask(task.id).length).toBe(2);
    expect(store.getRunById('run1')).toBeDefined();

    store.updateRun('run1', { status: 'completed' });
    expect(store.getRunById('run1')?.status).toBe('completed');

    // blank
    store.updateRun('run1', {});

    expect(store.getRunByJobId('missing')).toBeNull();
    expect(store.getRunByJobId('job')?.id).toBe('run1');
    expect(store.getRunById('missing')).toBeNull();

    store.delete(task.id);
    expect(store.list().length).toBe(0);
  });

  it('creates a task with model and updates it', () => {
    db = createDb();
    const store = new TriggeredTaskStore(db);

    const withModel = store.create({
      name: 'model-triggered',
      prompt: 'handle event',
      tool: 'claude',
      model: 'claude-opus-4-6',
    });
    expect(withModel.model).toBe('claude-opus-4-6');

    const noModel = store.create({
      name: 'no-model-triggered',
      prompt: 'handle event default',
      tool: 'gemini',
    });
    expect(noModel.model).toBeNull();

    // Update model
    store.update(withModel.id, { model: 'claude-sonnet-4-6' });
    expect(store.getById(withModel.id)?.model).toBe('claude-sonnet-4-6');

    // Clear model
    store.update(withModel.id, { model: '  ' });
    expect(store.getById(withModel.id)?.model).toBeNull();
  });

  it('create throws if getById fails to find created task', () => {
    db = createDb();
    const store = new TriggeredTaskStore(db);
    vi.spyOn(store, 'getById').mockReturnValue(null);
    expect(() => store.create({ name: 'task', prompt: 'prompt', tool: 'claude' })).toThrow(
      /Failed to load created triggered task/,
    );
  });
});
