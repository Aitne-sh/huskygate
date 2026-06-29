/**
 * Integration test for durable queue restart recovery.
 *
 * Unlike the unit tests in recovery.test.ts (which use FakeQueueStore),
 * this test exercises the full SQLite persistence path:
 *   real SQLite DB → JobQueueStore → JobQueue → recoverDurableQueue
 *
 * It validates that queue state written by one "process" can be recovered
 * by a fresh JobQueue instance reading from the same database — the core
 * guarantee of Phase 3.
 */
import Database from 'better-sqlite3';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config.js';
import { JobQueueStore } from '../store/job-queue-store.js';
import { setLogLevel } from '../utils/logger.js';
import { JobQueue } from './job-queue.js';
import { recoverDurableQueue } from './recovery.js';
import type { Job } from './types.js';

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

function makeConfig(maxConcurrency = 2): Config {
  return {
    slack: { botToken: 'xoxb-test', appToken: 'xapp-test' },
    allowedUserIds: ['U1'],
    allowedTeamId: null,
    defaultTool: 'claude' as const,
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
    serverApiHost: '127.0.0.1',
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
    codexDefaultSandboxMode: 'write',
    claudeDefaultMode: 'write',
    geminiDefaultMode: 'write',
    cloudflareTunnelEnabled: false,
    cloudflareTunnelToken: null,
    githubWebhookIpAllowlist: true,
    dashboardCookieSecure: true,
    logStacks: false,
    skillTemplateDir: null,
  };
}

function createJob(id: string, sessionKey: string, source?: Job['source']): Job {
  return {
    id,
    sessionKey,
    channelId: 'D1',
    threadTs: '123.456',
    userId: 'U1',
    tool: 'claude',
    mode: source === 'orchestrator-summary' ? 'readonly' : 'write',
    prompt: 'test prompt',
    workdir: '/tmp/workdir/job',
    toolState: {},
    createdAt: Date.now(),
    source,
    executionPolicy:
      source === 'orchestrator-summary'
        ? { allowMcp: false, enabledSkills: [] }
        : { allowMcp: true, enabledSkills: null },
    scheduleTaskId: source === 'schedule' ? 'task-1' : undefined,
    scheduleRunId: source === 'schedule' ? id : undefined,
    ondemandTaskId: source === 'ondemand-task' ? 'ondemand-1' : undefined,
    ondemandTaskRunId: source === 'ondemand-task' ? id : undefined,
    triggeredTaskId: source === 'triggered-task' ? 'triggered-1' : undefined,
    triggeredTaskRunId: source === 'triggered-task' ? id : undefined,
    orchestrationRunId:
      source === 'orchestrator' || source === 'orchestrator-summary' ? 'orch-run-1' : undefined,
    orchestrationNodeId: source === 'orchestrator' ? 'node-1' : undefined,
    summaryNotifyChannel: source === 'orchestrator-summary' ? 'C123' : undefined,
    summaryNotifyThreadTs: source === 'orchestrator-summary' ? '999.111' : undefined,
  };
}

function makeRecoveryCtx() {
  return {
    config: { workdirRoot: '/tmp/workdir' },
    auditStore: { logJobComplete: vi.fn() },
    sessionManager: {
      setRunningJob: vi.fn(),
      deleteSessionByKeyWithCleanup: vi.fn(() => ({ threadKey: 'dashboard_1' })),
      get: vi.fn(() => ({
        tool: 'claude',
        mode: 'write',
        toolState: {},
        workdir: '/tmp/workdir/job',
        runningJobId: null,
        updatedAt: new Date().toISOString(),
        devAlias: null,
      })),
    },
    scheduleStore: {
      updateRun: vi.fn(),
      releaseClaim: vi.fn(),
      getById: vi.fn(() => null),
      getRunById: vi.fn(() => null),
    },
    ondemandTaskStore: { updateRun: vi.fn(), getById: vi.fn(), getRunById: vi.fn() },
    triggeredTaskStore: {
      updateRun: vi.fn(),
      releaseClaim: vi.fn(),
      getById: vi.fn(),
      getRunById: vi.fn(),
    },
    workdirManager: { validateCustomWorkdir: vi.fn((workdir: string) => workdir) },
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('recovery-integration: SQLite → JobQueue → recoverDurableQueue', () => {
  let db: Database.Database | null = null;

  beforeAll(() => {
    setLogLevel('error');
  });

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('enqueued jobs survive simulated restart and drain correctly', async () => {
    // --- "Process 1": enqueue jobs, simulate crash ---
    db = new Database(':memory:');
    createSchema(db);
    const store1 = new JobQueueStore(db);
    const config = makeConfig(1);
    const queue1 = new JobQueue(config, store1);

    // Block execution so jobs remain in queue
    const blockGate = { resolve: (): void => {} };
    const blockPromise = new Promise<void>((resolve) => {
      blockGate.resolve = resolve;
    });
    queue1.setExecutor(async () => {
      await blockPromise;
    });

    // First job starts immediately (concurrency 1), second queues
    const result1 = queue1.enqueue(createJob('job-1', 'sess-a', 'dashboard'));
    const result2 = queue1.enqueue(createJob('job-2', 'sess-b', 'dashboard'));

    expect(result1).toEqual({ position: 0 });
    expect(result2).toMatchObject({ position: expect.any(Number) });
    expect(queue1.runningCount).toBe(1);
    expect(queue1.queueDepth).toBe(1);

    // Verify SQLite has both rows persisted
    const rows = store1.listActive();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.job.id, r.state])).toEqual([
      ['job-1', 'running'],
      ['job-2', 'queued'],
    ]);

    // --- "Process 2": fresh queue reads from same DB ---
    const store2 = new JobQueueStore(db);
    const queue2 = new JobQueue(config, store2);
    const started: string[] = [];

    queue2.setExecutor(async (job) => {
      started.push(job.id);
    });

    const ctx = makeRecoveryCtx();
    const recovery = recoverDurableQueue(ctx as never, queue2, store2);
    await tick();

    // running job-1 should be failed (non-summary running job)
    expect(recovery.interruptedRunning).toBe(1);
    expect(recovery.failedRunning).toBe(1);
    // queued job-2 should be restored and drained
    expect(recovery.restoredQueued).toBe(1);
    expect(started).toEqual(['job-2']);

    // After drain completes, DB should be clean
    await tick();
    expect(store2.listActive()).toEqual([]);

    // Unblock process-1 executor so afterEach cleanup doesn't hang
    blockGate.resolve();
  });

  it('restart-safe summary job is retried with new ID through real SQLite', async () => {
    db = new Database(':memory:');
    createSchema(db);
    const store = new JobQueueStore(db);
    const config = makeConfig(1);

    // Directly persist a "running" summary job (simulates crash mid-execution)
    const summaryJob = createJob('summary-old', 'sess-summary', 'orchestrator-summary');
    store.save(summaryJob, 'running');

    // Verify it's in SQLite
    const persisted = store.listActive();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.state).toBe('running');

    // Fresh queue for recovery
    const queue = new JobQueue(config, store);
    const started: string[] = [];
    queue.setExecutor(async (job) => {
      started.push(job.id);
    });

    const ctx = makeRecoveryCtx();
    const recovery = recoverDurableQueue(ctx as never, queue, store);
    await tick();

    expect(recovery.retriedRunning).toBe(1);
    expect(recovery.failedRunning).toBe(0);
    expect(started).toHaveLength(1);
    expect(started[0]).not.toBe('summary-old');

    // Old audit recorded
    expect(ctx.auditStore.logJobComplete).toHaveBeenCalledWith('summary-old', 1, 'process_restart');

    // DB clean after execution
    await tick();
    expect(store.listActive()).toEqual([]);
  });

  it('FIFO order is preserved across persist → recover cycle', async () => {
    db = new Database(':memory:');
    createSchema(db);
    const store = new JobQueueStore(db);
    const config = makeConfig(1);

    // Persist multiple queued jobs in order
    store.save(createJob('q1', 'sess-a', 'dashboard'), 'queued');
    store.save(createJob('q2', 'sess-b', 'dashboard'), 'queued');
    store.save(createJob('q3', 'sess-c', 'dashboard'), 'queued');

    // Verify insertion order in SQLite
    const rows = store.listActive();
    expect(rows.map((r) => r.job.id)).toEqual(['q1', 'q2', 'q3']);

    // Recover into a fresh queue
    const queue = new JobQueue(config, store);
    const executionOrder: string[] = [];

    // Executor finishes instantly to test drain ordering
    queue.setExecutor(async (job) => {
      executionOrder.push(job.id);
    });

    const ctx = makeRecoveryCtx();
    recoverDurableQueue(ctx as never, queue, store);

    // Allow multiple drain cycles
    await tick();
    await tick();
    await tick();

    // All three should execute in FIFO order (concurrency=1, different sessions)
    expect(executionOrder).toEqual(['q1', 'q2', 'q3']);
    expect(store.listActive()).toEqual([]);
  });

  it('mixed running + queued recovery with real persistence layer', async () => {
    db = new Database(':memory:');
    createSchema(db);
    const store = new JobQueueStore(db);
    const config = makeConfig(2);

    // Simulate: 1 running schedule job, 1 running summary, 2 queued dashboard
    store.save(createJob('sched-run', 'sess-sched', 'schedule'), 'running');
    store.save(createJob('summary-run', 'sess-summary', 'orchestrator-summary'), 'running');
    store.save(createJob('dash-q1', 'sess-d1', 'dashboard'), 'queued');
    store.save(createJob('dash-q2', 'sess-d2', 'dashboard'), 'queued');

    expect(store.listActive()).toHaveLength(4);

    const queue = new JobQueue(config, store);
    const started: string[] = [];
    queue.setExecutor(async (job) => {
      started.push(job.id);
    });

    const ctx = makeRecoveryCtx();
    const recovery = recoverDurableQueue(ctx as never, queue, store);
    await tick();
    await tick();

    // schedule job: failed (not restart-safe)
    // summary job: retried with new ID (replace() transitions it to 'queued')
    // both queued dashboard jobs: restored and drained
    // restoredQueued = 3 because the retried summary also becomes a 'queued' row
    expect(recovery.interruptedRunning).toBe(2);
    expect(recovery.failedRunning).toBe(1);
    expect(recovery.retriedRunning).toBe(1);
    expect(recovery.restoredQueued).toBe(3);

    // 3 jobs started: retried summary + 2 dashboard
    expect(started).toHaveLength(3);
    expect(started).not.toContain('sched-run');
    expect(started).not.toContain('summary-run');
    expect(started).toContain('dash-q1');
    expect(started).toContain('dash-q2');

    // DB clean
    await tick();
    expect(store.listActive()).toEqual([]);
  });

  it('enqueue → complete → verify DB row lifecycle', async () => {
    db = new Database(':memory:');
    createSchema(db);
    const store = new JobQueueStore(db);
    const config = makeConfig(1);
    const queue = new JobQueue(config, store);

    const gate = { resolve: (): void => {} };
    const barrier = new Promise<void>((resolve) => {
      gate.resolve = resolve;
    });
    queue.setExecutor(async () => {
      await barrier;
    });

    // Enqueue — should start immediately
    queue.enqueue(createJob('lifecycle-1', 'sess-lc', 'dashboard'));

    // While running: row exists as 'running'
    const duringRun = store.listActive();
    expect(duringRun).toHaveLength(1);
    expect(duringRun[0]?.state).toBe('running');
    expect(duringRun[0]?.leasedAt).toBeTruthy();

    // Complete the job
    gate.resolve();
    await tick();

    // After completion: row removed
    expect(store.listActive()).toEqual([]);
  });
});
