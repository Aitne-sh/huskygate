/** Coverage2 tests for job-queue-store: uncovered lines 68-69, 109-112 (enabledSkills normalization in parsePersistedJob) */
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { JobQueueStore } from './job-queue-store.js';

function createSchemaNoCheck(db: Database.Database): void {
  db.exec(`
    CREATE TABLE job_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL UNIQUE,
      session_key TEXT NOT NULL,
      source TEXT,
      status TEXT NOT NULL,
      payload TEXT NOT NULL,
      leased_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_job_queue_status_id ON job_queue(status, id);
    CREATE INDEX idx_job_queue_session_status ON job_queue(session_key, status);
  `);
}

describe('JobQueueStore — coverage2', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('parsePersistedJob rejects mismatched sessionKey (line 68-69)', () => {
    db = new Database(':memory:');
    createSchemaNoCheck(db);
    const store = new JobQueueStore(db);
    const now = new Date().toISOString();

    const badJob = {
      id: 'j1',
      sessionKey: '', // empty sessionKey
      channelId: 'C1',
      threadTs: '123',
      userId: 'U1',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'test',
      workdir: '/tmp',
      toolState: {},
      createdAt: Date.now(),
    };
    db.prepare(
      `INSERT INTO job_queue (job_id, session_key, source, status, payload, leased_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('j1', 's1', null, 'queued', JSON.stringify(badJob), null, now, now);

    const rows = store.listActive();
    expect(rows).toHaveLength(0);
  });

  it('parsePersistedJob rejects invalid executionPolicy.enabledSkills (lines 109-112)', () => {
    db = new Database(':memory:');
    createSchemaNoCheck(db);
    const store = new JobQueueStore(db);
    const now = new Date().toISOString();

    const badJob = {
      id: 'j1',
      sessionKey: 's1',
      channelId: 'C1',
      threadTs: '123',
      userId: 'U1',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'test',
      workdir: '/tmp',
      toolState: {},
      createdAt: Date.now(),
      executionPolicy: {
        enabledSkills: 'not-an-array', // invalid
      },
    };
    db.prepare(
      `INSERT INTO job_queue (job_id, session_key, source, status, payload, leased_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('j1', 's1', null, 'queued', JSON.stringify(badJob), null, now, now);

    const rows = store.listActive();
    expect(rows).toHaveLength(0);
  });

  it('parsePersistedJob normalizes valid executionPolicy.enabledSkills (line 113)', () => {
    db = new Database(':memory:');
    createSchemaNoCheck(db);
    const store = new JobQueueStore(db);
    const now = new Date().toISOString();

    const goodJob = {
      id: 'j1',
      sessionKey: 's1',
      channelId: 'C1',
      threadTs: '123',
      userId: 'U1',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'test',
      workdir: '/tmp',
      toolState: {},
      createdAt: Date.now(),
      executionPolicy: {
        enabledSkills: ['builtin:playwright-runner'],
      },
    };
    db.prepare(
      `INSERT INTO job_queue (job_id, session_key, source, status, payload, leased_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('j1', 's1', null, 'queued', JSON.stringify(goodJob), null, now, now);

    const rows = store.listActive();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.job.executionPolicy?.enabledSkills).toEqual(['builtin:playwright-runner']);
  });

  it('parsePersistedJob rejects invalid source (lines 88-95)', () => {
    db = new Database(':memory:');
    createSchemaNoCheck(db);
    const store = new JobQueueStore(db);
    const now = new Date().toISOString();

    const badJob = {
      id: 'j1',
      sessionKey: 's1',
      channelId: 'C1',
      threadTs: '123',
      userId: 'U1',
      tool: 'claude',
      mode: 'readonly',
      prompt: 'test',
      workdir: '/tmp',
      toolState: {},
      createdAt: Date.now(),
      source: 'invalid_source',
    };
    db.prepare(
      `INSERT INTO job_queue (job_id, session_key, source, status, payload, leased_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('j1', 's1', null, 'queued', JSON.stringify(badJob), null, now, now);

    const rows = store.listActive();
    expect(rows).toHaveLength(0);
  });
});
