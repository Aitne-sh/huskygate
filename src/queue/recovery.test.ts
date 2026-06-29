import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config.js';
import { setLogLevel } from '../utils/logger.js';
import { JobQueue } from './job-queue.js';
import type { PersistedJobState, PersistedQueueJob, QueueStore } from './queue-store.js';
import { buildRestartRetryJob, recoverDurableQueue } from './recovery.js';
import type { Job } from './types.js';

class FakeQueueStore implements QueueStore {
  private nextOrder = 1;

  constructor(private rows: PersistedQueueJob[] = []) {
    const maxOrder = rows.reduce((max, row) => Math.max(max, row.order), 0);
    this.nextOrder = maxOrder + 1;
  }

  save(job: Job, state: PersistedJobState): number {
    this.rows.push({
      order: this.nextOrder++,
      state,
      leasedAt: state === 'running' ? new Date().toISOString() : null,
      job,
    });
    return state === 'queued' ? this.rows.filter((row) => row.state === 'queued').length : 0;
  }

  markRunning(jobId: string): void {
    const row = this.rows.find((entry) => entry.job.id === jobId);
    if (!row) throw new Error(`missing job ${jobId}`);
    row.state = 'running';
    row.leasedAt = new Date().toISOString();
  }

  replace(jobId: string, job: Job, state: PersistedJobState): void {
    const row = this.rows.find((entry) => entry.job.id === jobId);
    if (!row) throw new Error(`missing job ${jobId}`);
    row.job = job;
    row.state = state;
    row.leasedAt = state === 'running' ? new Date().toISOString() : null;
  }

  remove(jobId: string): void {
    this.rows = this.rows.filter((row) => row.job.id !== jobId);
  }

  removeQueuedBySession(sessionKey: string): number {
    const before = this.rows.length;
    this.rows = this.rows.filter(
      (row) => !(row.job.sessionKey === sessionKey && row.state === 'queued'),
    );
    return before - this.rows.length;
  }

  listActive(): PersistedQueueJob[] {
    return [...this.rows].sort((a, b) => a.order - b.order);
  }
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
    prompt: 'test',
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

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('recoverDurableQueue', () => {
  beforeAll(() => {
    setLogLevel('error');
  });

  it('retries only restart-safe orchestrator summary jobs with a fresh job id', async () => {
    const runningSummary = createJob('summary-old', 'sess-summary', 'orchestrator-summary');
    const store = new FakeQueueStore([
      { order: 1, state: 'running', leasedAt: new Date().toISOString(), job: runningSummary },
    ]);
    const queue = new JobQueue(createConfig(1), store);
    const started: string[] = [];

    queue.setExecutor(async (job) => {
      started.push(job.id);
    });

    const ctx = {
      config: { workdirRoot: '/tmp/workdir' },
      auditStore: { logJobComplete: vi.fn() },
      sessionManager: {
        setRunningJob: vi.fn(),
        deleteSessionByKeyWithCleanup: vi.fn(() => ({ threadKey: 'dashboard_1' })),
        get: vi.fn(() => ({
          tool: 'claude',
          mode: 'readonly',
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
        getById: vi.fn(),
        getRunById: vi.fn(),
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

    const result = recoverDurableQueue(ctx as never, queue, store);
    await tick();

    expect(result).toMatchObject({
      restoredQueued: 1,
      interruptedRunning: 1,
      retriedRunning: 1,
      failedRunning: 0,
      handedOffOrchestrator: 0,
      discardedQueued: 0,
    });
    expect(ctx.auditStore.logJobComplete).toHaveBeenCalledWith('summary-old', 1, 'process_restart');
    expect(ctx.sessionManager.setRunningJob).toHaveBeenCalledWith('sess-summary', null);
    expect(started).toHaveLength(1);
    expect(started[0]).not.toBe('summary-old');
    expect(store.listActive()).toEqual([]);
  });

  it('fails interrupted schedule jobs, releases claims, and restores queued work', async () => {
    const runningSchedule = createJob('sched-run', 'sess-schedule', 'schedule');
    const queuedDashboard = createJob('dash-queued', 'sess-dashboard', 'dashboard');
    const store = new FakeQueueStore([
      { order: 1, state: 'running', leasedAt: new Date().toISOString(), job: runningSchedule },
      { order: 2, state: 'queued', leasedAt: null, job: queuedDashboard },
    ]);
    const queue = new JobQueue(createConfig(1), store);
    const started: string[] = [];

    queue.setExecutor(async (job) => {
      started.push(job.id);
    });

    const ctx = {
      config: { workdirRoot: '/tmp/workdir' },
      auditStore: { logJobComplete: vi.fn() },
      sessionManager: {
        setRunningJob: vi.fn(),
        deleteSessionByKeyWithCleanup: vi.fn(() => ({ threadKey: 'dashboard_1' })),
        get: vi.fn((sessionKey: string) => ({
          tool: 'claude',
          mode: 'write',
          toolState: {},
          workdir:
            sessionKey === 'sess-schedule' ? '/tmp/workdir/sess-schedule' : '/tmp/workdir/job',
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

    const result = recoverDurableQueue(ctx as never, queue, store);
    await tick();

    expect(result).toMatchObject({
      restoredQueued: 1,
      interruptedRunning: 1,
      retriedRunning: 0,
      failedRunning: 1,
      handedOffOrchestrator: 0,
      discardedQueued: 0,
    });
    expect(ctx.scheduleStore.updateRun).toHaveBeenCalledWith('sched-run', {
      status: 'failed',
      exitCode: 1,
      errorMessage: 'Interrupted by process restart',
      endedAt: expect.any(String),
    });
    expect(ctx.scheduleStore.releaseClaim).toHaveBeenCalledWith('task-1');
    expect(ctx.sessionManager.deleteSessionByKeyWithCleanup).toHaveBeenCalledWith('sess-schedule');
    expect(started).toEqual(['dash-queued']);
    expect(store.listActive()).toEqual([]);
  });

  it('drops queued schedule jobs when current execution policy no longer matches', () => {
    const queuedSchedule = createJob('sched-queued', 'sess-schedule', 'schedule');
    const store = new FakeQueueStore([
      { order: 1, state: 'queued', leasedAt: null, job: queuedSchedule },
    ]);
    const queue = new JobQueue(createConfig(1), store);
    const started: string[] = [];

    queue.setExecutor(async (job) => {
      started.push(job.id);
    });

    const ctx = {
      config: { workdirRoot: '/tmp/workdir' },
      auditStore: { logJobComplete: vi.fn() },
      sessionManager: {
        get: vi.fn(() => ({
          tool: 'claude',
          mode: 'write',
          toolState: {},
          workdir: '/tmp/workdir/job',
          runningJobId: null,
          updatedAt: new Date().toISOString(),
          devAlias: null,
        })),
        setRunningJob: vi.fn(),
        deleteSessionByKeyWithCleanup: vi.fn(() => ({ threadKey: 'dashboard_1' })),
      },
      scheduleStore: {
        getById: vi.fn(() => ({
          id: 'task-1',
          name: 'Task',
          description: null,
          userId: 'U1',
          tool: 'claude',
          mode: 'write',
          prompt: 'changed prompt',
          workdir: '/tmp/workdir/job',
          scheduleType: 'recurring',
          runAt: null,
          cronExpr: '* * * * *',
          timezone: 'UTC',
          notifyChannel: null,
          notifyThread: null,
          status: 'active',
          lastRunAt: null,
          nextRunAt: null,
          runCount: 0,
          maxRuns: null,
          maxRetries: 0,
          allowMcp: false,
          enabledSkills: null,
          instructionFile: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
        getRunById: vi.fn(() => ({
          id: 'sched-queued',
          taskId: 'task-1',
          sessionKey: 'sess-schedule',
          status: 'running',
          exitCode: null,
          outputSummary: null,
          errorMessage: null,
          startedAt: new Date().toISOString(),
          endedAt: null,
          artifacts: null,
          retryCount: 0,
          source: 'schedule',
        })),
        updateRun: vi.fn(),
        releaseClaim: vi.fn(),
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

    const result = recoverDurableQueue(ctx as never, queue, store);

    expect(result).toMatchObject({
      restoredQueued: 0,
      discardedQueued: 1,
    });
    expect(ctx.scheduleStore.updateRun).toHaveBeenCalledWith('sched-queued', {
      status: 'failed',
      exitCode: 1,
      errorMessage: 'Skipped during restart recovery: execution policy allowMcp changed',
      endedAt: expect.any(String),
    });
    expect(ctx.scheduleStore.releaseClaim).toHaveBeenCalledWith('task-1');
    expect(ctx.sessionManager.deleteSessionByKeyWithCleanup).toHaveBeenCalledWith('sess-schedule');
    expect(started).toEqual([]);
    expect(store.listActive()).toEqual([]);
  });

  it('hands stale orchestrator jobs off to engine recovery instead of replaying them', () => {
    const queuedOrchestrator = createJob('orch-queued', 'sess-orch-queued', 'orchestrator');
    const runningOrchestrator = createJob('orch-running', 'sess-orch-running', 'orchestrator');
    const store = new FakeQueueStore([
      { order: 1, state: 'queued', leasedAt: null, job: queuedOrchestrator },
      { order: 2, state: 'running', leasedAt: new Date().toISOString(), job: runningOrchestrator },
    ]);
    const queue = new JobQueue(createConfig(1), store);
    const started: string[] = [];

    queue.setExecutor(async (job) => {
      started.push(job.id);
    });

    const ctx = {
      config: { workdirRoot: '/tmp/workdir' },
      auditStore: { logJobComplete: vi.fn() },
      sessionManager: {
        get: vi.fn((sessionKey: string) => ({
          tool: 'claude',
          mode: 'write',
          toolState: {},
          workdir: `/tmp/workdir/${sessionKey}`,
          runningJobId: null,
          updatedAt: new Date().toISOString(),
          devAlias: null,
        })),
        setRunningJob: vi.fn(),
        deleteSessionByKeyWithCleanup: vi.fn(() => ({ threadKey: 'dashboard_1' })),
      },
      scheduleStore: {
        updateRun: vi.fn(),
        releaseClaim: vi.fn(),
        getById: vi.fn(),
        getRunById: vi.fn(),
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

    const result = recoverDurableQueue(ctx as never, queue, store);

    expect(result).toMatchObject({
      restoredQueued: 0,
      interruptedRunning: 1,
      handedOffOrchestrator: 2,
      retriedRunning: 0,
      failedRunning: 0,
      discardedQueued: 0,
    });
    expect(ctx.auditStore.logJobComplete).toHaveBeenCalledWith(
      'orch-running',
      1,
      'process_restart',
    );
    expect(ctx.sessionManager.setRunningJob).toHaveBeenCalledWith('sess-orch-running', null);
    expect(ctx.sessionManager.deleteSessionByKeyWithCleanup).toHaveBeenCalledWith(
      'sess-orch-queued',
    );
    expect(ctx.sessionManager.deleteSessionByKeyWithCleanup).toHaveBeenCalledWith(
      'sess-orch-running',
    );
    expect(started).toEqual([]);
    expect(store.listActive()).toEqual([]);
  });

  it('builds a fresh retry job id for restart-safe work', () => {
    const original = createJob('job-old', 'sess-1', 'orchestrator-summary');
    const retry = buildRestartRetryJob(original);
    expect(retry.id).not.toBe(original.id);
    expect(retry.sessionKey).toBe(original.sessionKey);
    expect(retry.createdAt).toBeGreaterThanOrEqual(original.createdAt);
  });
});
