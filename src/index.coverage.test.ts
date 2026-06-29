import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = '0.1.0-test';
});

const mocked = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({
    slack: { botToken: 'xoxb-test', appToken: 'xapp-test' },
    allowedUserIds: ['U1', 'U2'],
    allowedTeamId: null,
    defaultTool: 'claude',
    maxConcurrency: 3,
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
  listAllSessions: vi.fn((): Record<string, unknown>[] => []),
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
  apiServerClose: vi.fn(),
  queueStopAccepting: vi.fn(),
  queueGetStatus: vi.fn(() => ({ running: 0, pending: 0 })),
}));

vi.mock('./config.js', () => ({
  loadConfig: mocked.loadConfig,
  SENSITIVE_KEYS: new Set<string>(),
  createConfigResolver: vi.fn(() => ({
    get: vi.fn(() => ({ value: null, source: 'default', storage: null })),
    getEditableSettings: vi.fn(() => []),
  })),
  syncProcessEnvFromResolver: vi.fn(),
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
    stopAccepting = mocked.queueStopAccepting;
    getStatus = mocked.queueGetStatus;
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
    close: mocked.apiServerClose,
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

vi.mock('./store/schedule.js', () => ({
  ScheduleStore: class ScheduleStoreMock {},
}));

vi.mock('./store/mcp-server.js', () => ({
  McpServerStore: class McpServerStoreMock {
    importFromGlobalConfigs = vi.fn(() => ({ imported: 0, skipped: 0, alreadyImported: true }));
  },
}));

vi.mock('./store/session-mcp-server.js', () => ({
  SessionMcpServerStore: class SessionMcpServerStoreMock {},
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
  recoverDurableQueue: vi.fn(() => ({
    restoredQueued: 0,
    interruptedRunning: 0,
    failedRunning: 0,
    retriedRunning: 0,
    handedOffOrchestrator: 0,
    discardedQueued: 0,
  })),
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
    recoverActiveRuns = vi.fn(async () => undefined);
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

describe('index coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listAllSessions.mockReturnValue([]);
    mocked.shutdownRunningJobs.mockResolvedValue(0);
    mocked.appStart.mockResolvedValue(undefined);
    mocked.appStop.mockResolvedValue(undefined);
    mocked.apiServerClose.mockImplementation(() => undefined);
    mocked.closeDatabase.mockImplementation(() => undefined);
  });

  it('runs startup intervals and graceful shutdown once per signal', async () => {
    const handlers = new Map<string, () => Promise<void>>();
    const intervalCallbacks: Array<() => void> = [];

    const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation(((cb: () => void) => {
      intervalCallbacks.push(cb);
      return { unref: vi.fn() } as never;
    }) as never);
    const clearIntervalSpy = vi
      .spyOn(global, 'clearInterval')
      .mockImplementation((() => undefined) as never);
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(((
      cb: () => void,
      ms?: number,
    ) => {
      if (ms === 5500) cb();
      return { unref: vi.fn() } as never;
    }) as never);
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      signal: string,
      cb: () => Promise<void>,
    ) => {
      handlers.set(signal, cb);
      return process;
    }) as never);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const memorySpy = vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 12 * 1024 * 1024,
      heapTotal: 0,
      heapUsed: 6 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0,
    });

    mocked.listAllSessions.mockReturnValue([
      { workdir: '/tmp/workdir/s1', tool: 'claude' },
      { workdir: '/tmp/workdir/s2', tool: 'codex' },
    ]);
    mocked.shutdownRunningJobs.mockResolvedValue(2);

    const { main } = await import('./index.js');
    await main();

    for (const callback of intervalCallbacks) {
      callback();
    }

    expect(mocked.dedupeCleanup).toHaveBeenCalledTimes(2);
    expect(mocked.startMetricsReporter).toHaveBeenCalled();
    expect(processOnSpy).toHaveBeenCalled();
    expect(setIntervalSpy).toHaveBeenCalledTimes(4);

    await handlers.get('SIGINT')?.();
    await handlers.get('SIGINT')?.();

    expect(mocked.queueStopAccepting).toHaveBeenCalledTimes(1);
    expect(mocked.stopMetricsReporter).toHaveBeenCalled();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(4);
    expect(mocked.apiServerClose).toHaveBeenCalled();
    expect(mocked.appStop).toHaveBeenCalled();
    expect(mocked.closeDatabase).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(0);
    expect(setTimeoutSpy).toHaveBeenCalled();

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    setTimeoutSpy.mockRestore();
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
    memorySpy.mockRestore();
  });

  it('logs shutdown errors when cleanup steps fail', async () => {
    const handlers = new Map<string, () => Promise<void>>();
    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockImplementation((() => ({ unref: vi.fn() }) as never) as never);
    const clearIntervalSpy = vi
      .spyOn(global, 'clearInterval')
      .mockImplementation((() => undefined) as never);
    const setTimeoutSpy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation((() => ({ unref: vi.fn() }) as never) as never);
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      signal: string,
      cb: () => Promise<void>,
    ) => {
      handlers.set(signal, cb);
      return process;
    }) as never);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    mocked.shutdownRunningJobs.mockRejectedValue(new Error('shutdown jobs failed'));
    mocked.apiServerClose.mockImplementation(() => {
      throw new Error('api close failed');
    });
    mocked.appStop.mockRejectedValue(new Error('app stop failed'));
    mocked.closeDatabase.mockImplementation(() => {
      throw new Error('db close failed');
    });

    const { main } = await import('./index.js');
    await main();
    await handlers.get('SIGTERM')?.();

    expect(mocked.loggerError).toHaveBeenCalledWith(
      'shutdown_jobs_error',
      expect.objectContaining({ error: 'shutdown jobs failed' }),
    );
    expect(mocked.loggerError).toHaveBeenCalledWith(
      'api_server_close_error',
      expect.objectContaining({ error: 'api close failed' }),
    );
    expect(mocked.loggerError).toHaveBeenCalledWith(
      'app_stop_error',
      expect.objectContaining({ error: 'app stop failed' }),
    );
    expect(mocked.loggerError).toHaveBeenCalledWith(
      'database_close_error',
      expect.objectContaining({ error: 'db close failed' }),
    );
    expect(clearIntervalSpy).toHaveBeenCalledTimes(4);
    expect(processExitSpy).toHaveBeenCalledWith(0);

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    setTimeoutSpy.mockRestore();
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
  });
});
