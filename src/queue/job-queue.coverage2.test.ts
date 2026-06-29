/** Coverage2 tests for queue/job-queue: uncovered lines 154-158 (removePersistedJob error),
 * 188 (cancelSession filter) */
import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../config.js';
import type { PersistedJobState, QueueStore } from './queue-store.js';
import type { Job } from './types.js';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  setLogLevel: vi.fn(),
}));

vi.mock('../utils/error.js', () => ({
  errorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));

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
    geminiMcpAuthServer: null,
    codexMcpAuthServer: null,
    workdirRoot: '/tmp/workdir',
    allowedWorkdirRoots: ['/tmp/workdir'],
    serverApiPort: 3738,
    serverApiHost: '127.0.0.1',
    serverApiSecret: 'test-api-secret',
    dashboardSecret: 'test-dashboard-secret',
    sessionCleanupEnabled: true,
    scheduleEnabled: false,
    schedulePollIntervalSec: 30,
    scheduleMaxConcurrent: 1,
    scheduleDefaultNotifyChannel: null,
    logLevel: 'info',
    toolAutoApproveMode: false,
    claudeDefaultMode: 'write',
    codexDefaultSandboxMode: 'write',
    geminiDefaultMode: 'write',
    cloudflareTunnelEnabled: false,
    cloudflareTunnelToken: null,
    githubWebhookIpAllowlist: true,
    dashboardCookieSecure: true,
    logStacks: false,
    skillTemplateDir: null,
  } as Config;
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
    source: 'dashboard',
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('JobQueue coverage2', () => {
  it('removePersistedJob catches store.remove error (lines 154-158)', async () => {
    const failingStore: QueueStore = {
      save: vi.fn(() => 0),
      markRunning: vi.fn(),
      replace: vi.fn(),
      remove: vi.fn(() => {
        throw new Error('DB locked');
      }),
      removeQueuedBySession: vi.fn(() => 0),
      listActive: vi.fn(() => []),
    };

    const { JobQueue } = await import('./job-queue.js');
    const queue = new JobQueue(createConfig(2), failingStore);
    let completed = false;
    queue.setExecutor(async () => {
      completed = true;
    });

    queue.enqueue(createJob('job1', 'sess-1'));
    await tick();
    await tick();
    // Job should have been executed; remove failure logged but not thrown
    expect(completed).toBe(true);
  });

  it('cancelSession filters pending jobs and returns hasRunning correctly (line 188)', async () => {
    const { JobQueue } = await import('./job-queue.js');
    const queue = new JobQueue(createConfig(1));
    let blockResolve: (() => void) | undefined;
    const blockPromise = new Promise<void>((r) => {
      blockResolve = r;
    });

    queue.setExecutor(async (job) => {
      if (job.id === 'running-job') await blockPromise;
    });

    // First job starts running (maxConcurrency=1)
    queue.enqueue(createJob('running-job', 'sess-target'));
    await tick();

    // Second job goes to pending (same session, but session already running)
    queue.enqueue(createJob('pending-job', 'sess-target'));

    // Cancel should remove pending and report hasRunning=true
    const hasRunning = queue.cancelSession('sess-target');
    expect(hasRunning).toBe(true);
    expect(queue.queueDepth).toBe(0);

    blockResolve?.();
    await tick();
  });
});
