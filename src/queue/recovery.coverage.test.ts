/**
 * Coverage tests for queue/recovery — covers uncovered branches and code paths.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config.js';
import { buildSkillRef } from '../skills/catalog.js';
import { setLogLevel } from '../utils/logger.js';
import { JobQueue } from './job-queue.js';
import type { PersistedJobState, PersistedQueueJob, QueueStore } from './queue-store.js';
import { buildRestartRetryJob, isRestartSafeRetryJob, recoverDurableQueue } from './recovery.js';
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
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeCtx(overrides?: Record<string, unknown>) {
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
    ondemandTaskStore: {
      updateRun: vi.fn(),
      getById: vi.fn(() => null),
      getRunById: vi.fn(() => null),
    },
    triggeredTaskStore: {
      updateRun: vi.fn(),
      releaseClaim: vi.fn(),
      getById: vi.fn(() => null),
      getRunById: vi.fn(() => null),
    },
    workdirManager: { validateCustomWorkdir: vi.fn((workdir: string) => workdir) },
    ...overrides,
  };
}

describe('recovery.ts coverage', () => {
  beforeAll(() => {
    setLogLevel('error');
  });

  describe('isRestartSafeRetryJob', () => {
    it('returns true for orchestrator-summary readonly with allowMcp=false', () => {
      const job = createJob('j1', 'sess-1', 'orchestrator-summary');
      expect(isRestartSafeRetryJob(job)).toBe(true);
    });

    it('returns false for non-summary source', () => {
      const job = createJob('j1', 'sess-1', 'schedule');
      expect(isRestartSafeRetryJob(job)).toBe(false);
    });

    it('returns false when mode is not readonly', () => {
      const job = createJob('j1', 'sess-1', 'orchestrator-summary');
      job.mode = 'write';
      expect(isRestartSafeRetryJob(job)).toBe(false);
    });

    it('returns false when allowMcp is true', () => {
      const job = createJob('j1', 'sess-1', 'orchestrator-summary');
      job.executionPolicy = { allowMcp: true, enabledSkills: [] };
      expect(isRestartSafeRetryJob(job)).toBe(false);
    });

    it('returns false when executionPolicy is undefined', () => {
      const job = createJob('j1', 'sess-1', 'orchestrator-summary');
      job.executionPolicy = undefined;
      expect(isRestartSafeRetryJob(job)).toBe(false);
    });
  });

  describe('buildRestartRetryJob', () => {
    it('creates a new job with fresh id and createdAt', () => {
      const orig = createJob('old-id', 'sess-1', 'orchestrator-summary');
      const retry = buildRestartRetryJob(orig);
      expect(retry.id).not.toBe(orig.id);
      expect(retry.createdAt).toBeGreaterThanOrEqual(orig.createdAt);
      expect(retry.sessionKey).toBe(orig.sessionKey);
      expect(retry.source).toBe(orig.source);
    });
  });

  describe('recoverDurableQueue — ondemand-task running job', () => {
    it('fails interrupted ondemand-task running jobs', async () => {
      const job = createJob('ondemand-run', 'sess-ondemand', 'ondemand-task');
      const store = new FakeQueueStore([
        { order: 1, state: 'running', leasedAt: new Date().toISOString(), job },
      ]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeCtx();
      const result = recoverDurableQueue(ctx as never, queue, store);

      expect(result.interruptedRunning).toBe(1);
      expect(result.failedRunning).toBe(1);
      expect(ctx.ondemandTaskStore.updateRun).toHaveBeenCalledWith('ondemand-run', {
        status: 'failed',
        exitCode: 1,
        errorMessage: 'Interrupted by process restart',
        endedAt: expect.any(String),
      });
    });
  });

  describe('recoverDurableQueue — triggered-task running job', () => {
    it('fails interrupted triggered-task running jobs and releases claim', async () => {
      const job = createJob('triggered-run', 'sess-triggered', 'triggered-task');
      const store = new FakeQueueStore([
        { order: 1, state: 'running', leasedAt: new Date().toISOString(), job },
      ]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeCtx();
      const result = recoverDurableQueue(ctx as never, queue, store);

      expect(result.failedRunning).toBe(1);
      expect(ctx.triggeredTaskStore.updateRun).toHaveBeenCalledWith('triggered-run', {
        status: 'failed',
        exitCode: 1,
        errorMessage: 'Interrupted by process restart',
        endedAt: expect.any(String),
      });
      expect(ctx.triggeredTaskStore.releaseClaim).toHaveBeenCalledWith('triggered-1');
    });
  });

  describe('recoverDurableQueue — replace failure on retry', () => {
    it('falls back to fail when store.replace throws', async () => {
      const job = createJob('summary-fail', 'sess-summary', 'orchestrator-summary');
      const store = new FakeQueueStore([
        { order: 1, state: 'running', leasedAt: new Date().toISOString(), job },
      ]);
      // Override replace to throw
      store.replace = () => {
        throw new Error('DB full');
      };
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeCtx();
      const result = recoverDurableQueue(ctx as never, queue, store);

      expect(result.retriedRunning).toBe(0);
      expect(result.failedRunning).toBe(1);
    });
  });

  describe('recoverDurableQueue — validate queued jobs', () => {
    it('discards queued job when session is missing', () => {
      const job = createJob('q1', 'sess-missing', 'dashboard');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeCtx({
        sessionManager: {
          setRunningJob: vi.fn(),
          deleteSessionByKeyWithCleanup: vi.fn(() => ({ threadKey: 'dashboard_1' })),
          get: vi.fn(() => null),
        },
      });
      const result = recoverDurableQueue(ctx as never, queue, store);

      expect(result.discardedQueued).toBe(1);
      expect(result.restoredQueued).toBe(0);
    });

    it('discards queued job when session tool changed', () => {
      const job = createJob('q1', 'sess-1', 'dashboard');
      job.tool = 'claude';
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeCtx({
        sessionManager: {
          setRunningJob: vi.fn(),
          deleteSessionByKeyWithCleanup: vi.fn(() => ({ threadKey: 'dashboard_1' })),
          get: vi.fn(() => ({
            tool: 'gemini',
            mode: 'write',
            toolState: {},
            workdir: '/tmp/workdir/job',
            runningJobId: null,
            updatedAt: new Date().toISOString(),
            devAlias: null,
          })),
        },
      });
      const result = recoverDurableQueue(ctx as never, queue, store);

      expect(result.discardedQueued).toBe(1);
    });

    it('discards queued job when workdir policy rejects it', () => {
      const job = createJob('q1', 'sess-1', 'dashboard');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeCtx({
        workdirManager: {
          validateCustomWorkdir: vi.fn(() => {
            throw new Error('workdir not allowed');
          }),
        },
      });
      const result = recoverDurableQueue(ctx as never, queue, store);

      expect(result.discardedQueued).toBe(1);
    });

    it('passes devAlias sessions without workdir validation', async () => {
      const job = createJob('q1', 'sess-1', 'dashboard');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      const started: string[] = [];
      queue.setExecutor(async (j) => {
        started.push(j.id);
      });

      const ctx = makeCtx({
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
            devAlias: 'my-alias',
          })),
        },
      });
      const result = recoverDurableQueue(ctx as never, queue, store);
      await tick();

      expect(result.restoredQueued).toBe(1);
      expect(result.discardedQueued).toBe(0);
      expect(started).toEqual(['q1']);
    });
  });

  describe('validateScheduleJob', () => {
    function makeScheduleCtx(
      taskOverrides: Record<string, unknown> = {},
      runOverrides: Record<string, unknown> = {},
    ) {
      return makeCtx({
        scheduleStore: {
          updateRun: vi.fn(),
          releaseClaim: vi.fn(),
          getById: vi.fn(() => ({
            id: 'task-1',
            status: 'active',
            tool: 'claude',
            mode: 'write',
            workdir: '/tmp/workdir/job',
            allowMcp: true,
            enabledSkills: null,
            instructionFile: null,
            ...taskOverrides,
          })),
          getRunById: vi.fn(() => ({
            id: 'sched-q1',
            status: 'running',
            ...runOverrides,
          })),
        },
      });
    }

    it('discards when schedule linkage missing', () => {
      const job = createJob('q1', 'sess-1', 'schedule');
      job.scheduleTaskId = undefined;
      job.scheduleRunId = undefined;
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeScheduleCtx();
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when scheduled task is missing', () => {
      const job = createJob('q1', 'sess-1', 'schedule');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeCtx();
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when scheduled task is paused', () => {
      const job = createJob('q1', 'sess-1', 'schedule');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeScheduleCtx({ status: 'paused' });
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when scheduled run is missing', () => {
      const job = createJob('q1', 'sess-1', 'schedule');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeScheduleCtx({}, {});
      ctx.scheduleStore.getRunById = vi.fn(() => null);
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when scheduled run is completed', () => {
      const job = createJob('q1', 'sess-1', 'schedule');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeScheduleCtx({}, { status: 'completed' });
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when scheduled task tool changed', () => {
      const job = createJob('q1', 'sess-1', 'schedule');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeScheduleCtx({ tool: 'gemini' });
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when scheduled task mode is not write', () => {
      const job = createJob('q1', 'sess-1', 'schedule');
      job.mode = 'readonly';
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeScheduleCtx();
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when scheduled task workdir changed', () => {
      const job = createJob('q1', 'sess-1', 'schedule');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeScheduleCtx({ workdir: '/different/workdir' });
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when enabledSkills changed', () => {
      const job = createJob('q1', 'sess-1', 'schedule');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeScheduleCtx({ enabledSkills: ['playwright-runner'] });
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when instructionFile changed', () => {
      const job = createJob('q1', 'sess-1', 'schedule');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeScheduleCtx({ instructionFile: 'new-instruction.md' });
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });
  });

  describe('validateOndemandJob', () => {
    function makeOndemandCtx(
      taskOverrides: Record<string, unknown> = {},
      runOverrides: Record<string, unknown> = {},
    ) {
      return makeCtx({
        ondemandTaskStore: {
          updateRun: vi.fn(),
          getById: vi.fn(() => ({
            id: 'ondemand-1',
            status: 'active',
            tool: 'claude',
            mode: 'write',
            workdir: '/tmp/workdir/job',
            allowMcp: true,
            enabledSkills: null,
            instructionFile: null,
            ...taskOverrides,
          })),
          getRunById: vi.fn(() => ({
            id: 'ondemand-q1',
            status: 'running',
            ...runOverrides,
          })),
        },
      });
    }

    it('discards when ondemand linkage missing', () => {
      const job = createJob('q1', 'sess-1', 'ondemand-task');
      job.ondemandTaskId = undefined;
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeOndemandCtx();
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when ondemand task is missing', () => {
      const job = createJob('q1', 'sess-1', 'ondemand-task');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeCtx();
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when ondemand task is paused', () => {
      const job = createJob('q1', 'sess-1', 'ondemand-task');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeOndemandCtx({ status: 'paused' });
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when ondemand run is missing', () => {
      const job = createJob('q1', 'sess-1', 'ondemand-task');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeOndemandCtx();
      ctx.ondemandTaskStore.getRunById = vi.fn(() => null);
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when ondemand run is completed', () => {
      const job = createJob('q1', 'sess-1', 'ondemand-task');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeOndemandCtx({}, { status: 'completed' });
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when ondemand task tool changed', () => {
      const job = createJob('q1', 'sess-1', 'ondemand-task');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeOndemandCtx({ tool: 'gemini' });
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when ondemand mode is not write', () => {
      const job = createJob('q1', 'sess-1', 'ondemand-task');
      job.mode = 'readonly';
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeOndemandCtx();
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when ondemand workdir changed', () => {
      const job = createJob('q1', 'sess-1', 'ondemand-task');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeOndemandCtx({ workdir: '/different' });
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });
  });

  describe('validateTriggeredJob', () => {
    function makeTriggeredCtx(
      taskOverrides: Record<string, unknown> = {},
      runOverrides: Record<string, unknown> = {},
    ) {
      return makeCtx({
        triggeredTaskStore: {
          updateRun: vi.fn(),
          releaseClaim: vi.fn(),
          getById: vi.fn(() => ({
            id: 'triggered-1',
            enabled: true,
            tool: 'claude',
            mode: 'write',
            workdir: '/tmp/workdir/job',
            allowMcp: true,
            enabledSkills: null,
            instructionFile: null,
            ...taskOverrides,
          })),
          getRunById: vi.fn(() => ({
            id: 'triggered-q1',
            status: 'running',
            ...runOverrides,
          })),
        },
      });
    }

    it('discards when triggered linkage missing', () => {
      const job = createJob('q1', 'sess-1', 'triggered-task');
      job.triggeredTaskId = undefined;
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeTriggeredCtx();
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when triggered task is missing', () => {
      const job = createJob('q1', 'sess-1', 'triggered-task');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeCtx();
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when triggered task is disabled', () => {
      const job = createJob('q1', 'sess-1', 'triggered-task');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeTriggeredCtx({ enabled: false });
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when triggered run is missing', () => {
      const job = createJob('q1', 'sess-1', 'triggered-task');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeTriggeredCtx();
      ctx.triggeredTaskStore.getRunById = vi.fn(() => null);
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when triggered run is completed', () => {
      const job = createJob('q1', 'sess-1', 'triggered-task');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeTriggeredCtx({}, { status: 'completed' });
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when triggered task tool changed', () => {
      const job = createJob('q1', 'sess-1', 'triggered-task');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeTriggeredCtx({ tool: 'gemini' });
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when triggered mode is not write', () => {
      const job = createJob('q1', 'sess-1', 'triggered-task');
      job.mode = 'readonly';
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeTriggeredCtx();
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when triggered workdir changed', () => {
      const job = createJob('q1', 'sess-1', 'triggered-task');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeTriggeredCtx({ workdir: '/different' });
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });
  });

  describe('validateQueuedJob — orchestrator-summary', () => {
    it('discards when orchestrator-summary mode changed to non-readonly', () => {
      const job = createJob('q1', 'sess-1', 'orchestrator-summary');
      job.mode = 'write';
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeCtx();
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('discards when orchestrator-summary MCP policy changed', () => {
      const job = createJob('q1', 'sess-1', 'orchestrator-summary');
      job.executionPolicy = { allowMcp: true, enabledSkills: [] };
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeCtx();
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result.discardedQueued).toBe(1);
    });

    it('accepts valid orchestrator-summary queued job', async () => {
      const job = createJob('q1', 'sess-1', 'orchestrator-summary');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      const started: string[] = [];
      queue.setExecutor(async (j) => {
        started.push(j.id);
      });

      const ctx = makeCtx();
      const result = recoverDurableQueue(ctx as never, queue, store);
      await tick();

      expect(result.restoredQueued).toBe(1);
      expect(result.discardedQueued).toBe(0);
    });
  });

  describe('sameStringArray edge cases', () => {
    it('handles both arrays with same content in different order', async () => {
      const job = createJob('q1', 'sess-1', 'schedule');
      job.executionPolicy = {
        allowMcp: true,
        enabledSkills: [buildSkillRef('builtin', 'aws-cli'), buildSkillRef('builtin', 'gcp-cli')],
      };
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      const started: string[] = [];
      queue.setExecutor(async (j) => {
        started.push(j.id);
      });

      const ctx = makeCtx({
        scheduleStore: {
          updateRun: vi.fn(),
          releaseClaim: vi.fn(),
          getById: vi.fn(() => ({
            id: 'task-1',
            status: 'active',
            tool: 'claude',
            mode: 'write',
            workdir: '/tmp/workdir/job',
            allowMcp: true,
            enabledSkills: [
              buildSkillRef('builtin', 'gcp-cli'),
              buildSkillRef('builtin', 'aws-cli'),
            ],
            instructionFile: null,
          })),
          getRunById: vi.fn(() => ({
            id: 'q1',
            status: 'running',
          })),
        },
      });
      const result = recoverDurableQueue(ctx as never, queue, store);
      await tick();

      expect(result.restoredQueued).toBe(1);
      expect(result.discardedQueued).toBe(0);
    });

    it('rejects when arrays have different lengths', () => {
      const job = createJob('q1', 'sess-1', 'schedule');
      job.executionPolicy = {
        allowMcp: true,
        enabledSkills: [buildSkillRef('builtin', 'aws-cli')],
      };
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeCtx({
        scheduleStore: {
          updateRun: vi.fn(),
          releaseClaim: vi.fn(),
          getById: vi.fn(() => ({
            id: 'task-1',
            status: 'active',
            tool: 'claude',
            mode: 'write',
            workdir: '/tmp/workdir/job',
            allowMcp: true,
            enabledSkills: [
              buildSkillRef('builtin', 'aws-cli'),
              buildSkillRef('builtin', 'gcp-cli'),
            ],
            instructionFile: null,
          })),
          getRunById: vi.fn(() => ({
            id: 'q1',
            status: 'running',
          })),
        },
      });
      const result = recoverDurableQueue(ctx as never, queue, store);

      expect(result.discardedQueued).toBe(1);
    });
  });

  describe('handoffOrchestratorJob — queued state', () => {
    it('hands off queued orchestrator job without logging audit', () => {
      const job = createJob('orch-q1', 'sess-orch', 'orchestrator');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeCtx();
      const result = recoverDurableQueue(ctx as never, queue, store);

      expect(result.handedOffOrchestrator).toBe(1);
      expect(result.interruptedRunning).toBe(0);
      expect(ctx.auditStore.logJobComplete).not.toHaveBeenCalled();
      expect(ctx.sessionManager.deleteSessionByKeyWithCleanup).toHaveBeenCalledWith('sess-orch');
    });
  });

  describe('cleanupSessionOnly path', () => {
    it('calls deleteSessionByKeyWithCleanup with session workdir from manager', () => {
      const job = createJob('orch-r1', 'sess-orch', 'orchestrator');
      const store = new FakeQueueStore([
        { order: 1, state: 'running', leasedAt: new Date().toISOString(), job },
      ]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeCtx({
        sessionManager: {
          setRunningJob: vi.fn(),
          deleteSessionByKeyWithCleanup: vi.fn(() => ({ threadKey: null })),
          get: vi.fn(() => ({
            tool: 'claude',
            mode: 'write',
            toolState: {},
            workdir: '/tmp/workdir/sess-orch',
            runningJobId: null,
            updatedAt: new Date().toISOString(),
            devAlias: null,
          })),
        },
      });
      recoverDurableQueue(ctx as never, queue, store);
      expect(ctx.sessionManager.deleteSessionByKeyWithCleanup).toHaveBeenCalledWith('sess-orch');
    });
  });

  describe('empty persisted list', () => {
    it('returns zero counts with no persisted jobs', () => {
      const store = new FakeQueueStore([]);
      const queue = new JobQueue(createConfig(1), store);
      queue.setExecutor(async () => {});

      const ctx = makeCtx();
      const result = recoverDurableQueue(ctx as never, queue, store);
      expect(result).toEqual({
        restoredQueued: 0,
        interruptedRunning: 0,
        retriedRunning: 0,
        failedRunning: 0,
        handedOffOrchestrator: 0,
        discardedQueued: 0,
      });
    });
  });

  describe('validateOndemandJob — full happy path (reaches validateTaskPolicy)', () => {
    it('accepts valid ondemand queued job that passes all validation', async () => {
      const job = createJob('q1', 'sess-1', 'ondemand-task');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      const started: string[] = [];
      queue.setExecutor(async (j) => {
        started.push(j.id);
      });

      const ctx = makeCtx({
        ondemandTaskStore: {
          updateRun: vi.fn(),
          getById: vi.fn(() => ({
            id: 'ondemand-1',
            status: 'active',
            tool: 'claude',
            mode: 'write',
            workdir: '/tmp/workdir/job',
            allowMcp: true,
            enabledSkills: null,
            instructionFile: null,
          })),
          getRunById: vi.fn(() => ({
            id: 'q1',
            status: 'running',
          })),
        },
      });
      const result = recoverDurableQueue(ctx as never, queue, store);
      await tick();

      expect(result.restoredQueued).toBe(1);
      expect(result.discardedQueued).toBe(0);
    });
  });

  describe('validateTriggeredJob — full happy path (reaches validateTaskPolicy)', () => {
    it('accepts valid triggered queued job that passes all validation', async () => {
      const job = createJob('q1', 'sess-1', 'triggered-task');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      const started: string[] = [];
      queue.setExecutor(async (j) => {
        started.push(j.id);
      });

      const ctx = makeCtx({
        triggeredTaskStore: {
          updateRun: vi.fn(),
          releaseClaim: vi.fn(),
          getById: vi.fn(() => ({
            id: 'triggered-1',
            enabled: true,
            tool: 'claude',
            mode: 'write',
            workdir: '/tmp/workdir/job',
            allowMcp: true,
            enabledSkills: null,
            instructionFile: null,
          })),
          getRunById: vi.fn(() => ({
            id: 'q1',
            status: 'running',
          })),
        },
      });
      const result = recoverDurableQueue(ctx as never, queue, store);
      await tick();

      expect(result.restoredQueued).toBe(1);
      expect(result.discardedQueued).toBe(0);
    });
  });

  describe('default source handling', () => {
    it('does not discard unknown/default source jobs (validates to null)', async () => {
      const job = createJob('q1', 'sess-1', 'dashboard');
      const store = new FakeQueueStore([{ order: 1, state: 'queued', leasedAt: null, job }]);
      const queue = new JobQueue(createConfig(1), store);
      const started: string[] = [];
      queue.setExecutor(async (j) => {
        started.push(j.id);
      });

      const ctx = makeCtx();
      const result = recoverDurableQueue(ctx as never, queue, store);
      await tick();

      expect(result.restoredQueued).toBe(1);
      expect(result.discardedQueued).toBe(0);
    });
  });
});
