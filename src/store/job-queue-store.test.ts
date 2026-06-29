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

describe('JobQueueStore', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('persists queued and running jobs with stable FIFO order', () => {
    db = new Database(':memory:');
    createSchema(db);
    const store = new JobQueueStore(db);

    const queuedA = createJob('job-a', 'sess-a', 'dashboard');
    const running = createJob('job-b', 'sess-b', 'schedule');
    const queuedC = createJob('job-c', 'sess-c', 'slack');

    expect(store.save(queuedA, 'queued')).toBe(1);
    expect(store.save(running, 'running')).toBe(0);
    expect(store.save(queuedC, 'queued')).toBe(2);

    const rows = store.listActive();
    expect(rows.map((row) => [row.job.id, row.state])).toEqual([
      ['job-a', 'queued'],
      ['job-b', 'running'],
      ['job-c', 'queued'],
    ]);
    expect(rows[1]?.leasedAt).toBeTruthy();
  });

  it('transitions queued jobs to running and removes queued jobs by session', () => {
    db = new Database(':memory:');
    createSchema(db);
    const store = new JobQueueStore(db);

    store.save(createJob('job-a', 'sess-a'), 'queued');
    store.save(createJob('job-b', 'sess-a'), 'queued');
    store.save(createJob('job-c', 'sess-b'), 'queued');

    expect(store.removeQueuedBySession('sess-a')).toBe(2);
    expect(store.listActive().map((row) => row.job.id)).toEqual(['job-c']);

    store.markRunning('job-c');
    const rows = store.listActive();
    expect(rows[0]?.state).toBe('running');
    expect(rows[0]?.leasedAt).toBeTruthy();

    store.remove('job-c');
    expect(store.listActive()).toEqual([]);
  });

  it('replaces a persisted row while preserving queue order', () => {
    db = new Database(':memory:');
    createSchema(db);
    const store = new JobQueueStore(db);

    store.save(createJob('job-a', 'sess-a'), 'running');
    store.save(createJob('job-b', 'sess-b'), 'queued');

    const replacement = createJob('job-a-retry', 'sess-a', 'orchestrator-summary');
    store.replace('job-a', replacement, 'queued');

    const rows = store.listActive();
    expect(rows.map((row) => [row.order, row.job.id, row.state])).toEqual([
      [1, 'job-a-retry', 'queued'],
      [2, 'job-b', 'queued'],
    ]);
  });

  it('drops rows with invalid source during recovery', () => {
    db = new Database(':memory:');
    createSchema(db);
    const store = new JobQueueStore(db);

    const now = new Date().toISOString();
    const badJob = {
      ...createJob('job-bad-src', 'sess-bad'),
      source: 'not-a-valid-source',
    };
    db.prepare(
      `INSERT INTO job_queue (
         job_id, session_key, source, status, payload, leased_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'job-bad-src',
      'sess-bad',
      'not-a-valid-source',
      'queued',
      JSON.stringify(badJob),
      null,
      now,
      now,
    );
    store.save(createJob('job-ok', 'sess-ok', 'dashboard'), 'queued');

    const rows = store.listActive();
    expect(rows.map((row) => row.job.id)).toEqual(['job-ok']);
    const discarded = db
      .prepare('SELECT job_id FROM job_queue WHERE job_id = ?')
      .get('job-bad-src');
    expect(discarded).toBeUndefined();
  });

  it('drops malformed persisted rows without aborting recovery of valid jobs', () => {
    db = new Database(':memory:');
    createSchema(db);
    const store = new JobQueueStore(db);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO job_queue (
         job_id, session_key, source, status, payload, leased_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'job-bad',
      'sess-bad',
      'dashboard',
      'queued',
      JSON.stringify({ sessionKey: 'sess-bad' }),
      null,
      now,
      now,
    );
    store.save(createJob('job-good', 'sess-good', 'dashboard'), 'queued');

    const rows = store.listActive();

    expect(rows.map((row) => row.job.id)).toEqual(['job-good']);
    const badRow = db.prepare('SELECT job_id FROM job_queue WHERE job_id = ?').get('job-bad');
    expect(badRow).toBeUndefined();
  });
});
