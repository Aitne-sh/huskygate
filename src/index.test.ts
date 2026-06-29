import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = '0.1.0-test';
});

const mocked = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({
    slack: { botToken: 'xoxb-test', appToken: 'xapp-test' },
    allowedUserIds: ['U1'],
    allowedTeamId: null,
    defaultTool: 'claude',
    maxConcurrency: 2,
    maxRuntimeSec: 900,
    noOutputTimeoutSec: 60,
    claudeMcpAuthServer: null,
    geminiMcpAuthServer: null,
    codexMcpAuthServer: null,
    workdirRoot: '/tmp/workdir',
    allowedWorkdirRoots: ['/tmp/workdir'],
    serverApiPort: 3738,
    serverApiSecret: 'test-api-secret',
    dashboardSecret: 'test-dashboard-secret',
    sessionCleanupEnabled: true,
    scheduleEnabled: false,
    schedulePollIntervalSec: 30,
    scheduleMaxConcurrent: 1,
    scheduleDefaultNotifyChannel: null,
    logLevel: 'info',
  })),
  setLogLevel: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  initDatabase: vi.fn(() => ({})),
  closeDatabase: vi.fn(),
  dedupeCleanup: vi.fn(),
  listAllSessions: vi.fn(() => []),
  ensureSessionWorkdirs: vi.fn(),
  archiveLegacyDefaultWorkdirIfUnused: vi.fn(),
  cleanupUnusedSessionWorkdirs: vi.fn(),
  cleanupStaleSessions: vi.fn(),
  ensureWorkdir: vi.fn(),
  appStart: vi.fn().mockResolvedValue(undefined),
  appStop: vi.fn().mockResolvedValue(undefined),
  shutdownRunningJobs: vi.fn().mockResolvedValue(0),
  startMetricsReporter: vi.fn(),
  stopMetricsReporter: vi.fn(),
  recoverDurableQueue: vi.fn(() => ({
    restoredQueued: 0,
    interruptedRunning: 0,
    failedRunning: 0,
    retriedRunning: 0,
    handedOffOrchestrator: 0,
    discardedQueued: 0,
  })),
  recoverActiveRuns: vi.fn(async () => undefined),
}));

vi.mock('./config.js', () => ({
  loadConfig: mocked.loadConfig,
  SENSITIVE_KEYS: new Set<string>(),
  createConfigResolver: vi.fn(() => ({
    get: vi.fn(() => ({ value: null, source: 'default', storage: null })),
    getEditableSettings: vi.fn(() => []),
  })),
  syncProcessEnvFromResolver: vi.fn(() => {
    // Simulate derived key sync for schedule-manager env seeding test
    process.env.HUSKYGATE_API_BASE = 'http://127.0.0.1:3738';
    process.env.HUSKYGATE_API_SECRET = 'mock-synced-secret';
  }),
}));

vi.mock('./store/config-store.js', () => ({
  ConfigStore: class ConfigStoreMock {},
}));

vi.mock('./utils/keychain.js', () => ({
  loadKeychainSecrets: vi.fn(async () => new Map()),
  getKeychainProvider: vi.fn(() => ({
    isAvailable: vi.fn(() => false),
    getPassword: vi.fn(),
    setPassword: vi.fn(),
    deletePassword: vi.fn(),
  })),
}));

vi.mock('./queue/job-queue.js', () => ({
  JobQueue: class JobQueueMock {
    stopAccepting = vi.fn();
    getStatus = vi.fn(() => ({ running: 0, pending: 0 }));
  },
}));

vi.mock('./session/manager.js', () => ({
  SessionManager: class SessionManagerMock {
    listAllSessions = mocked.listAllSessions;
  },
}));

vi.mock('./slack/app.js', () => ({
  createApp: vi.fn(() => ({
    app: {
      start: mocked.appStart,
      stop: mocked.appStop,
    },
    ctx: {},
    shutdownRunningJobs: mocked.shutdownRunningJobs,
  })),
}));

vi.mock('./server/api.js', () => ({
  startApiServer: vi.fn(() => ({
    close: vi.fn(),
  })),
}));

vi.mock('./store/agent-store.js', () => ({
  AgentStore: class AgentStoreMock {},
}));

vi.mock('./store/audit.js', () => ({
  AuditStore: class AuditStoreMock {},
}));

vi.mock('./store/database.js', () => ({
  initDatabase: mocked.initDatabase,
  closeDatabase: mocked.closeDatabase,
}));

vi.mock('./store/conversation.js', () => ({
  ConversationStore: class ConversationStoreMock {},
}));

vi.mock('./store/dev-alias.js', () => ({
  DevAliasStore: class DevAliasStoreMock {},
}));

vi.mock('./store/dedupe.js', () => ({
  DedupeStore: class DedupeStoreMock {
    cleanup = mocked.dedupeCleanup;
  },
}));

vi.mock('./utils/logger.js', () => ({
  setLogLevel: mocked.setLogLevel,
  setShowStacks: vi.fn(),
  logger: {
    info: mocked.loggerInfo,
    warn: mocked.loggerWarn,
    error: mocked.loggerError,
  },
}));

vi.mock('./utils/metrics.js', () => ({
  startMetricsReporter: mocked.startMetricsReporter,
  stopMetricsReporter: mocked.stopMetricsReporter,
}));

vi.mock('./workdir/manager.js', () => ({
  WorkdirManager: class WorkdirManagerMock {
    ensureSessionWorkdirs = mocked.ensureSessionWorkdirs;
    archiveLegacyDefaultWorkdirIfUnused = mocked.archiveLegacyDefaultWorkdirIfUnused;
    cleanupUnusedSessionWorkdirs = mocked.cleanupUnusedSessionWorkdirs;
    cleanupStaleSessions = mocked.cleanupStaleSessions;
    ensureWorkdir = mocked.ensureWorkdir;
    prepareWorkdirSkillsOnly = vi.fn();
    validateCustomWorkdir = vi.fn();
  },
}));

vi.mock('./store/default-instruction.js', () => ({
  DefaultInstructionStore: class DefaultInstructionStoreMock {},
}));

vi.mock('./store/mcp-server.js', () => ({
  McpServerStore: class McpServerStoreMock {
    importFromGlobalConfigs = vi.fn(() => ({ imported: 0, skipped: 0, alreadyImported: true }));
  },
}));

vi.mock('./store/session-mcp-server.js', () => ({
  SessionMcpServerStore: class SessionMcpServerStoreMock {},
}));

vi.mock('./store/schedule.js', () => ({
  ScheduleStore: class ScheduleStoreMock {},
}));

vi.mock('./store/ondemand-task.js', () => ({
  OndemandTaskStore: class OndemandTaskStoreMock {},
}));

vi.mock('./store/orchestrator.js', () => ({
  OrchestratorStore: class OrchestratorStoreMock {
    archiveAndPruneOutputFull = vi.fn(() => ({ archivedCount: 0, errors: [] }));
  },
}));

vi.mock('./store/webhook-endpoint.js', () => ({
  WebhookEndpointStore: class WebhookEndpointStoreMock {},
}));

vi.mock('./store/event-subscription.js', () => ({
  EventSubscriptionStore: class EventSubscriptionStoreMock {},
}));

vi.mock('./store/triggered-task.js', () => ({
  TriggeredTaskStore: class TriggeredTaskStoreMock {},
}));

vi.mock('./store/webhook-delivery.js', () => ({
  WebhookDeliveryStore: class WebhookDeliveryStoreMock {},
}));

vi.mock('./store/job-queue-store.js', () => ({
  JobQueueStore: class JobQueueStoreMock {
    listActive = vi.fn(() => []);
  },
}));

vi.mock('./queue/recovery.js', () => ({
  recoverDurableQueue: mocked.recoverDurableQueue,
}));

vi.mock('./event/webhook-secret-store.js', () => ({
  WebhookSecretStore: class WebhookSecretStoreMock {},
}));

vi.mock('./event/event-router.js', () => ({
  EventRouter: class EventRouterMock {
    reload = vi.fn(async () => undefined);
  },
}));

vi.mock('./event/triggered-task-executor.js', () => ({
  TriggeredTaskExecutor: class TriggeredTaskExecutorMock {},
}));

vi.mock('./orchestrator/engine.js', () => ({
  OrchestratorEngine: class OrchestratorEngineMock {
    setEventRouter = vi.fn();
    recoverActiveRuns = mocked.recoverActiveRuns;
    setPostNotification = vi.fn();
    setUploadFile = vi.fn();
    setDefaultNotifyChannel = vi.fn();
  },
}));

vi.mock('./schedule/scheduler.js', () => ({
  Scheduler: class SchedulerMock {
    start = vi.fn();
    stop = vi.fn();
  },
}));

vi.mock('./store/housekeeping.js', () => ({
  runHousekeeping: vi.fn(() => ({
    retention: [],
    orphanedThreadContextsCleared: 0,
    orphanedSessionMcpRows: 0,
    jobLogsCleaned: 0,
    orphanJobLogsCleaned: 0,
    orchestratorsPurged: 0,
    orchestratorRunsPurged: 0,
    orchestratorWorkdirsCleaned: 0,
    orphanRunWorkdirsCleaned: 0,
    logsRotated: 0,
    backup: null,
    backupsPruned: 0,
    durationMs: 0,
  })),
}));

vi.mock('./utils/workdir.js', () => ({
  cleanupWorkdir: vi.fn(),
}));

vi.mock('./utils/error.js', () => ({
  errorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));

describe('index bootstrap', () => {
  it('boots orchestrator, starts app, and starts metrics reporter', async () => {
    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockImplementation(() => ({ unref: vi.fn() }) as never);
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation((() => process) as never);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const { main } = await import('./index.js');
    await main();

    expect(mocked.loadConfig).toHaveBeenCalledOnce();
    expect(mocked.setLogLevel).toHaveBeenCalledWith('info');
    expect(mocked.initDatabase).toHaveBeenCalledOnce();
    expect(mocked.appStart).toHaveBeenCalledOnce();
    expect(mocked.startMetricsReporter).toHaveBeenCalledOnce();
    expect(processOnSpy).toHaveBeenCalled();
    expect(setIntervalSpy).toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalledWith(1);

    setIntervalSpy.mockRestore();
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('seeds schedule-manager env with a schedule-scoped secret', async () => {
    const originalApiBase = process.env.HUSKYGATE_API_BASE;
    const originalApiSecret = process.env.HUSKYGATE_API_SECRET;
    delete process.env.HUSKYGATE_API_SECRET;

    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockImplementation(() => ({ unref: vi.fn() }) as never);
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation((() => process) as never);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    try {
      const { main } = await import('./index.js');
      await main();

      expect(process.env.HUSKYGATE_API_BASE).toBe('http://127.0.0.1:3738');
      expect(process.env.HUSKYGATE_API_SECRET).toBeTruthy();
      expect(process.env.HUSKYGATE_API_SECRET).not.toBe('test-api-secret');
    } finally {
      if (originalApiBase === undefined) {
        delete process.env.HUSKYGATE_API_BASE;
      } else {
        process.env.HUSKYGATE_API_BASE = originalApiBase;
      }
      if (originalApiSecret === undefined) {
        delete process.env.HUSKYGATE_API_SECRET;
      } else {
        process.env.HUSKYGATE_API_SECRET = originalApiSecret;
      }
      setIntervalSpy.mockRestore();
      processOnSpy.mockRestore();
      processExitSpy.mockRestore();
    }
  });

  it('recovers durable queue before orchestrator runs', async () => {
    mocked.recoverDurableQueue.mockClear();
    mocked.recoverActiveRuns.mockClear();

    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockImplementation(() => ({ unref: vi.fn() }) as never);
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation((() => process) as never);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const { main } = await import('./index.js');
    await main();

    expect(mocked.recoverDurableQueue).toHaveBeenCalledOnce();
    expect(mocked.recoverActiveRuns).toHaveBeenCalledOnce();
    expect(mocked.recoverDurableQueue.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.recoverActiveRuns.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );

    setIntervalSpy.mockRestore();
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
  });
});
