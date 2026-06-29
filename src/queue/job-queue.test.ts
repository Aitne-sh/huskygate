import Database from 'better-sqlite3';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { JobQueueStore } from '../store/job-queue-store.js';
import { setLogLevel } from '../utils/logger.js';
import { JobQueue } from './job-queue.js';
import type { Job } from './types.js';

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function createConfig(maxConcurrency: number): Config {
  return {
    slack: { botToken: 'xoxb-test', appToken: 'xapp-test' },
    allowedUserIds: ['U1'],
    allowedTeamId: null,
    defaultTool: 'claude',
    maxConcurrency,
    maxRuntimeSec: 900,
    noOutputTimeoutSec: 90,
    claudeModel: null,
    codexModel: null,
    geminiModel: null,
    claudeMcpAuthServer: null,
    geminiMcpAuthServer: 'aws-api',
    codexMcpAuthServer: 'aws-api',
    workdirRoot: '/tmp/workdir',
    allowedWorkdirRoots: ['/tmp/workdir'],
    serverApiPort: 3738,
    serverApiSecret: 'test-api-secret',
    dashboardSecret: 'test-dashboard-secret',
    sessionIdleTimeoutSec: 86400,
    sessionCleanupEnabled: true,
    scheduleEnabled: false,
    schedulePollIntervalSec: 30,
    scheduleMaxConcurrent: 1,
    scheduleDefaultNotifyChannel: null,
    logLevel: 'info',
    toolAutoApproveMode: false,
    codexDefaultSandboxMode: 'write' as const,
    claudeDefaultMode: 'write' as const,
    geminiDefaultMode: 'write' as const,
    cloudflareTunnelEnabled: false,
    cloudflareTunnelToken: null,
    githubWebhookIpAllowlist: true,
    dashboardCookieSecure: true,
    logStacks: false,
    skillTemplateDir: null,
  };
}

function createJob(id: string, sessionKey: string): Job {
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
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createQueueStore() {
  const db = new Database(':memory:');
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
  return { db, store: new JobQueueStore(db) };
}

describe('JobQueue', () => {
  beforeAll(() => {
    setLogLevel('error');
  });

  it('serializes jobs in the same session', async () => {
    const queue = new JobQueue(createConfig(2));
    const started: string[] = [];
    const deferredByJob = new Map<string, Deferred>();

    queue.setExecutor(async (job) => {
      started.push(job.id);
      const deferred = deferredByJob.get(job.id);
      if (!deferred) throw new Error(`missing deferred for ${job.id}`);
      await deferred.promise;
    });

    const job1 = createJob('job1', 'D1:T1');
    const job2 = createJob('job2', 'D1:T1');
    deferredByJob.set(job1.id, createDeferred());
    deferredByJob.set(job2.id, createDeferred());

    expect(queue.enqueue(job1)).toEqual({ position: 0 });
    expect(queue.enqueue(job2)).toEqual({ position: 1 });
    expect(started).toEqual(['job1']);

    deferredByJob.get('job1')?.resolve();
    await tick();
    expect(started).toEqual(['job1', 'job2']);

    deferredByJob.get('job2')?.resolve();
    await tick();
    expect(queue.getStatus()).toEqual({ running: 0, pending: 0, sessions: [] });
  });

  it('respects global max concurrency across sessions', async () => {
    const queue = new JobQueue(createConfig(1));
    const started: string[] = [];
    const deferredByJob = new Map<string, Deferred>();

    queue.setExecutor(async (job) => {
      started.push(job.id);
      const deferred = deferredByJob.get(job.id);
      if (!deferred) throw new Error(`missing deferred for ${job.id}`);
      await deferred.promise;
    });

    const job1 = createJob('job1', 'D1:T1');
    const job2 = createJob('job2', 'D1:T2');
    deferredByJob.set(job1.id, createDeferred());
    deferredByJob.set(job2.id, createDeferred());

    expect(queue.enqueue(job1)).toEqual({ position: 0 });
    expect(queue.enqueue(job2)).toEqual({ position: 1 });
    expect(started).toEqual(['job1']);

    deferredByJob.get('job1')?.resolve();
    await tick();
    expect(started).toEqual(['job1', 'job2']);

    deferredByJob.get('job2')?.resolve();
    await tick();
    expect(queue.getStatus()).toEqual({ running: 0, pending: 0, sessions: [] });
  });

  it('rejects jobs after stopAccepting is called', () => {
    const queue = new JobQueue(createConfig(2));
    queue.setExecutor(async () => {});
    queue.stopAccepting();

    const result = queue.enqueue(createJob('job1', 'D1:T1'));
    expect(result).toEqual({ error: 'Queue is not accepting new jobs (shutting down).' });
  });

  it('does not start job when no executor is set', () => {
    const queue = new JobQueue(createConfig(2));
    // No setExecutor call
    const result = queue.enqueue(createJob('job1', 'D1:T1'));
    expect(result).toEqual({ position: 0 });
    // Job should not be running since executor is missing
    expect(queue.runningCount).toBe(0);
  });

  it('handles executor error without crashing', async () => {
    const queue = new JobQueue(createConfig(2));
    queue.setExecutor(async () => {
      throw new Error('executor boom');
    });

    const result = queue.enqueue(createJob('job1', 'D1:T1'));
    expect(result).toEqual({ position: 0 });
    await tick();

    // Job should be cleaned up despite error
    expect(queue.runningCount).toBe(0);
    expect(queue.getStatus()).toEqual({ running: 0, pending: 0, sessions: [] });
  });

  it('cancelSession removes pending jobs and reports running state', async () => {
    const queue = new JobQueue(createConfig(2));
    const deferredByJob = new Map<string, Deferred>();

    queue.setExecutor(async (job) => {
      const deferred = deferredByJob.get(job.id);
      if (!deferred) throw new Error(`missing deferred for ${job.id}`);
      await deferred.promise;
    });

    const job1 = createJob('job1', 'D1:T1');
    const job2 = createJob('job2', 'D1:T1');
    deferredByJob.set(job1.id, createDeferred());
    deferredByJob.set(job2.id, createDeferred());

    queue.enqueue(job1); // runs immediately
    queue.enqueue(job2); // queued

    const hasRunning = queue.cancelSession('D1:T1');
    expect(hasRunning).toBe(true);
    expect(queue.queueDepth).toBe(0); // pending jobs cleared

    // Complete the running job — job2 should NOT start
    deferredByJob.get('job1')?.resolve();
    await tick();
    expect(queue.runningCount).toBe(0);
  });

  it('cancelSession returns false when no running job exists', () => {
    const queue = new JobQueue(createConfig(2));
    queue.setExecutor(async () => {});
    expect(queue.cancelSession('nonexistent')).toBe(false);
  });

  it('getRunningJob and getAllRunningJobs work correctly', async () => {
    const queue = new JobQueue(createConfig(3));
    const deferredByJob = new Map<string, Deferred>();

    queue.setExecutor(async (job) => {
      const deferred = deferredByJob.get(job.id);
      if (!deferred) throw new Error(`missing deferred for ${job.id}`);
      await deferred.promise;
    });

    const jobA = createJob('jobA', 'D1:T1');
    const jobB = createJob('jobB', 'D1:T2');
    deferredByJob.set(jobA.id, createDeferred());
    deferredByJob.set(jobB.id, createDeferred());

    queue.enqueue(jobA);
    queue.enqueue(jobB);

    expect(queue.getRunningJob('D1:T1')?.id).toBe('jobA');
    expect(queue.getRunningJob('D1:T2')?.id).toBe('jobB');
    expect(queue.getRunningJob('D1:T3')).toBeUndefined();
    expect(queue.getAllRunningJobs()).toHaveLength(2);

    deferredByJob.get('jobA')?.resolve();
    deferredByJob.get('jobB')?.resolve();
    await tick();
  });

  it('drainGlobal starts queued jobs from other sessions after one finishes', async () => {
    const queue = new JobQueue(createConfig(1));
    const started: string[] = [];
    const deferredByJob = new Map<string, Deferred>();

    queue.setExecutor(async (job) => {
      started.push(job.id);
      const deferred = deferredByJob.get(job.id);
      if (!deferred) throw new Error(`missing deferred for ${job.id}`);
      await deferred.promise;
    });

    const job1 = createJob('job1', 'D1:T1');
    const job2 = createJob('job2', 'D1:T2');
    const job3 = createJob('job3', 'D1:T3');
    deferredByJob.set(job1.id, createDeferred());
    deferredByJob.set(job2.id, createDeferred());
    deferredByJob.set(job3.id, createDeferred());

    queue.enqueue(job1); // runs (concurrency=1)
    queue.enqueue(job2); // queued
    queue.enqueue(job3); // queued
    expect(started).toEqual(['job1']);

    // Finish job1 — drainGlobal should pick up job2 from a different session
    deferredByJob.get('job1')?.resolve();
    await tick();
    expect(started).toEqual(['job1', 'job2']);

    deferredByJob.get('job2')?.resolve();
    await tick();
    expect(started).toEqual(['job1', 'job2', 'job3']);

    deferredByJob.get('job3')?.resolve();
    await tick();
    expect(queue.getStatus()).toEqual({ running: 0, pending: 0, sessions: [] });
  });

  it('dequeues queued jobs in FIFO order across sessions', async () => {
    const queue = new JobQueue(createConfig(1));
    const started: string[] = [];
    const deferredByJob = new Map<string, Deferred>();

    queue.setExecutor(async (job) => {
      started.push(job.id);
      const deferred = deferredByJob.get(job.id);
      if (!deferred) throw new Error(`missing deferred for ${job.id}`);
      await deferred.promise;
    });

    const a1 = createJob('a1', 'D1:A');
    const b1 = createJob('b1', 'D1:B');
    const c1 = createJob('c1', 'D1:C');
    const b2 = createJob('b2', 'D1:B');
    deferredByJob.set(a1.id, createDeferred());
    deferredByJob.set(b1.id, createDeferred());
    deferredByJob.set(c1.id, createDeferred());
    deferredByJob.set(b2.id, createDeferred());

    queue.enqueue(a1); // running
    queue.enqueue(b1); // queued (1st)
    queue.enqueue(c1); // queued (2nd)
    queue.enqueue(b2); // queued (3rd)
    expect(started).toEqual(['a1']);

    deferredByJob.get('a1')?.resolve();
    await tick();
    expect(started).toEqual(['a1', 'b1']);

    // FIFO expected: c1 (queued earlier) should run before b2
    deferredByJob.get('b1')?.resolve();
    await tick();
    expect(started).toEqual(['a1', 'b1', 'c1']);

    deferredByJob.get('c1')?.resolve();
    await tick();
    expect(started).toEqual(['a1', 'b1', 'c1', 'b2']);

    deferredByJob.get('b2')?.resolve();
    await tick();
    expect(queue.getStatus()).toEqual({ running: 0, pending: 0, sessions: [] });
  });

  it('queueDepth counts pending jobs across all sessions', () => {
    const queue = new JobQueue(createConfig(1));
    const deferred = createDeferred();
    queue.setExecutor(async () => {
      await deferred.promise;
    });

    queue.enqueue(createJob('j1', 'D1:T1')); // runs
    queue.enqueue(createJob('j2', 'D1:T1')); // queued under T1
    queue.enqueue(createJob('j3', 'D1:T2')); // queued under T2

    expect(queue.queueDepth).toBe(2);
    expect(queue.runningCount).toBe(1);
    deferred.resolve();
  });

  it('covers internal scheduling guard branches', () => {
    const queue = new JobQueue(createConfig(2));
    const deferred = createDeferred();
    queue.setExecutor(async () => {
      await deferred.promise;
    });
    const internal = queue as unknown as {
      pending: Job[];
      running: Map<string, Job>;
      drainGlobal: () => void;
    };

    internal.pending.push(createJob('queued-1', 'S1'));
    internal.running.set('S-run-a', createJob('run-a', 'S-run-a'));
    internal.running.set('S-run-b', createJob('run-b', 'S-run-b'));
    internal.drainGlobal();
    expect(internal.pending).toHaveLength(1);

    internal.pending = [];
    internal.running.clear();
    internal.running.set('S-running', createJob('run-main', 'S-running'));
    internal.pending.push(createJob('queued-running', 'S-running'));
    internal.pending.push(createJob('queued-next', 'S-next'));
    internal.drainGlobal();

    expect(internal.pending).toHaveLength(1);
    expect(internal.pending[0]?.id).toBe('queued-running');
    expect(queue.getRunningJob('S-next')?.id).toBe('queued-next');

    deferred.resolve();
  });

  it('persists queue state and removes rows after completion', async () => {
    const { db, store } = createQueueStore();
    const queue = new JobQueue(createConfig(1), store);
    const started: string[] = [];
    const deferredByJob = new Map<string, Deferred>();

    queue.setExecutor(async (job) => {
      started.push(job.id);
      const deferred = deferredByJob.get(job.id);
      if (!deferred) throw new Error(`missing deferred for ${job.id}`);
      await deferred.promise;
    });

    const job1 = createJob('job1', 'D1:T1');
    const job2 = createJob('job2', 'D1:T2');
    deferredByJob.set(job1.id, createDeferred());
    deferredByJob.set(job2.id, createDeferred());

    expect(queue.enqueue(job1)).toEqual({ position: 0 });
    expect(queue.enqueue(job2)).toEqual({ position: 1 });
    expect(store.listActive().map((row) => [row.job.id, row.state])).toEqual([
      ['job1', 'running'],
      ['job2', 'queued'],
    ]);

    deferredByJob.get('job1')?.resolve();
    await tick();
    expect(started).toEqual(['job1', 'job2']);
    expect(store.listActive().map((row) => [row.job.id, row.state])).toEqual([['job2', 'running']]);

    deferredByJob.get('job2')?.resolve();
    await tick();
    expect(store.listActive()).toEqual([]);
    db.close();
  });

  it('does not drain pending jobs after stopAccepting is called', async () => {
    const queue = new JobQueue(createConfig(1));
    const started: string[] = [];
    const deferredByJob = new Map<string, Deferred>();

    queue.setExecutor(async (job) => {
      started.push(job.id);
      const deferred = deferredByJob.get(job.id);
      if (!deferred) throw new Error(`missing deferred for ${job.id}`);
      await deferred.promise;
    });

    const job1 = createJob('job1', 'D1:T1');
    const job2 = createJob('job2', 'D1:T2');
    deferredByJob.set(job1.id, createDeferred());
    deferredByJob.set(job2.id, createDeferred());

    queue.enqueue(job1); // runs immediately
    queue.enqueue(job2); // queued (concurrency=1)
    expect(started).toEqual(['job1']);

    queue.stopAccepting();

    // Complete running job — pending job2 should NOT start because we stopped accepting
    deferredByJob.get('job1')?.resolve();
    await tick();
    expect(started).toEqual(['job1']);
    expect(queue.queueDepth).toBe(1);
  });

  it('restores persisted queued jobs in FIFO order', async () => {
    const { db, store } = createQueueStore();
    const queue = new JobQueue(createConfig(1), store);
    const started: string[] = [];
    const deferredByJob = new Map<string, Deferred>();

    queue.setExecutor(async (job) => {
      started.push(job.id);
      const deferred = deferredByJob.get(job.id);
      if (!deferred) throw new Error(`missing deferred for ${job.id}`);
      await deferred.promise;
    });

    const job1 = createJob('job1', 'D1:T1');
    const job2 = createJob('job2', 'D1:T2');
    deferredByJob.set(job1.id, createDeferred());
    deferredByJob.set(job2.id, createDeferred());
    store.save(job1, 'queued');
    store.save(job2, 'queued');

    queue.restoreQueuedJobs(store.listActive().map((row) => row.job));
    expect(started).toEqual(['job1']);

    deferredByJob.get('job1')?.resolve();
    await tick();
    expect(started).toEqual(['job1', 'job2']);

    deferredByJob.get('job2')?.resolve();
    await tick();
    expect(store.listActive()).toEqual([]);
    db.close();
  });
});
