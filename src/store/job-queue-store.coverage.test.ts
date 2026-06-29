/**
 * Coverage tests for job-queue-store — covers replace() failure, markRunning failure, invalid status rows.
 */
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { Job } from '../queue/types.js';
import { JobQueueStore } from './job-queue-store.js';

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE job_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL UNIQUE,
      session_key TEXT NOT NULL,
      source TEXT,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running')),
      payload TEXT NOT NULL,
      leased_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_job_queue_status_id ON job_queue(status, id);
    CREATE INDEX idx_job_queue_session_status ON job_queue(session_key, status);
  `);
}

/** Schema without CHECK constraint to allow inserting invalid status rows. */
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

function createJob(id: string, sessionKey: string, source?: Job['source']): Job {
  return {
    id,
    sessionKey,
    channelId: 'D1',
    threadTs: '123.456',
    userId: 'U1',
    tool: 'claude',
    mode: 'readonly',
    prompt: 'test',
    workdir: '/tmp/workdir',
    toolState: {},
    createdAt: Date.now(),
    source,
  };
}

describe('JobQueueStore — coverage', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('markRunning throws when no queued row found', () => {
    db = new Database(':memory:');
    createSchema(db);
    const store = new JobQueueStore(db);

    expect(() => store.markRunning('nonexistent-job')).toThrow('no queued row found');
  });

  it('replace throws when no row found for given jobId', () => {
    db = new Database(':memory:');
    createSchema(db);
    const store = new JobQueueStore(db);

    const replacement = createJob('new-job', 'sess-1');
    expect(() => store.replace('nonexistent-job', replacement, 'queued')).toThrow(
      'no row found for job nonexistent-job',
    );
  });

  it('listActive discards rows with invalid status', () => {
    db = new Database(':memory:');
    createSchemaNoCheck(db);
    const store = new JobQueueStore(db);

    const now = new Date().toISOString();
    const validJob = createJob('job-ok', 'sess-ok', 'dashboard');
    db.prepare(
      `INSERT INTO job_queue (job_id, session_key, source, status, payload, leased_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('job-ok', 'sess-ok', 'dashboard', 'queued', JSON.stringify(validJob), null, now, now);

    // Insert a row with invalid status
    const badJob = createJob('job-bad', 'sess-bad', 'dashboard');
    db.prepare(
      `INSERT INTO job_queue (job_id, session_key, source, status, payload, leased_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('job-bad', 'sess-bad', 'dashboard', 'completed', JSON.stringify(badJob), null, now, now);

    const rows = store.listActive();
    expect(rows.map((r) => r.job.id)).toEqual(['job-ok']);
    // Bad row should have been removed
    const badRow = db.prepare('SELECT job_id FROM job_queue WHERE job_id = ?').get('job-bad');
    expect(badRow).toBeUndefined();
  });

  it('parsePersistedJob validates all required fields', () => {
    db = new Database(':memory:');
    createSchemaNoCheck(db);
    const store = new JobQueueStore(db);
    const now = new Date().toISOString();

    // Missing id
    db.prepare(
      `INSERT INTO job_queue (job_id, session_key, source, status, payload, leased_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('j1', 's1', null, 'queued', JSON.stringify({ notAnObject: true }), null, now, now);

    // The job payload is NOT an object with id matching => will fail and be discarded
    const rows = store.listActive();
    expect(rows).toHaveLength(0);
  });

  it('parsePersistedJob rejects non-object payloads', () => {
    db = new Database(':memory:');
    createSchemaNoCheck(db);
    const store = new JobQueueStore(db);
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO job_queue (job_id, session_key, source, status, payload, leased_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('j1', 's1', null, 'queued', '"just a string"', null, now, now);

    const rows = store.listActive();
    expect(rows).toHaveLength(0);
  });

  it('parsePersistedJob validates toolState as object', () => {
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
      toolState: 'not-an-object',
      createdAt: Date.now(),
    };
    db.prepare(
      `INSERT INTO job_queue (job_id, session_key, source, status, payload, leased_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('j1', 's1', null, 'queued', JSON.stringify(badJob), null, now, now);

    const rows = store.listActive();
    expect(rows).toHaveLength(0);
  });

  it('parsePersistedJob validates createdAt as finite number', () => {
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
      createdAt: 'not-a-number',
    };
    db.prepare(
      `INSERT INTO job_queue (job_id, session_key, source, status, payload, leased_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('j1', 's1', null, 'queued', JSON.stringify(badJob), null, now, now);

    const rows = store.listActive();
    expect(rows).toHaveLength(0);
  });

  it('parsePersistedJob validates toolStateOverrides as object', () => {
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
      toolStateOverrides: 'not-an-object',
    };
    db.prepare(
      `INSERT INTO job_queue (job_id, session_key, source, status, payload, leased_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('j1', 's1', null, 'queued', JSON.stringify(badJob), null, now, now);

    const rows = store.listActive();
    expect(rows).toHaveLength(0);
  });

  it('parsePersistedJob validates executionPolicy as object', () => {
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
      executionPolicy: 'not-an-object',
    };
    db.prepare(
      `INSERT INTO job_queue (job_id, session_key, source, status, payload, leased_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('j1', 's1', null, 'queued', JSON.stringify(badJob), null, now, now);

    const rows = store.listActive();
    expect(rows).toHaveLength(0);
  });

  it('parsePersistedJob rejects non-string optional ID fields', () => {
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
      scheduleTaskId: 123,
    };
    db.prepare(
      `INSERT INTO job_queue (job_id, session_key, source, status, payload, leased_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('j1', 's1', null, 'queued', JSON.stringify(badJob), null, now, now);

    const rows = store.listActive();
    expect(rows).toHaveLength(0);
  });

  it('parsePersistedJob rejects invalid tool', () => {
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
      tool: 'invalid-tool',
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

  it('parsePersistedJob rejects invalid mode', () => {
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
      mode: 'invalid-mode',
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

  it('parsePersistedJob rejects invalid prompt/workdir', () => {
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
      prompt: 123,
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

  it('parsePersistedJob rejects invalid routing metadata', () => {
    db = new Database(':memory:');
    createSchemaNoCheck(db);
    const store = new JobQueueStore(db);
    const now = new Date().toISOString();

    const badJob = {
      id: 'j1',
      sessionKey: 's1',
      channelId: 123,
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

  it('replace with running state sets leased_at', () => {
    db = new Database(':memory:');
    createSchema(db);
    const store = new JobQueueStore(db);

    store.save(createJob('job-a', 'sess-a'), 'queued');
    const replacement = createJob('job-a-v2', 'sess-a', 'dashboard');
    store.replace('job-a', replacement, 'running');

    const rows = store.listActive();
    expect(rows[0]?.state).toBe('running');
    expect(rows[0]?.leasedAt).toBeTruthy();
  });
});
