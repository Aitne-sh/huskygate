/** Coverage2 tests for index.ts: uncovered branches for tunnel, GitHub IP allowlist,
 * scheduler, uncaughtException/unhandledRejection, outputFullCleanup errors, welcome DM */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    serverApiHost: '127.0.0.1',
    serverApiSecret: 'test-api-secret',
    dashboardSecret: 'test-dashboard-secret',
    webhookPublicBaseUrl: null,
    sessionCleanupEnabled: true,
    scheduleEnabled: true,
    schedulePollIntervalSec: 30,
    scheduleMaxConcurrent: 1,
    scheduleDefaultNotifyChannel: 'C123',
    logLevel: 'info',
    logStacks: false,
    toolAutoApproveMode: false,
    claudeDefaultMode: 'write',
    codexDefaultSandboxMode: 'write',
    geminiDefaultMode: 'write',
    cloudflareTunnelEnabled: true,
    cloudflareTunnelToken: 'cf-tok',
    githubWebhookIpAllowlist: true,
    dashboardCookieSecure: true,
    skillTemplateDir: null,
  })),
  setLogLevel: vi.fn(),
  setShowStacks: vi.fn(),
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
  tunnelStart: vi.fn(async () => 'https://tunnel.example.com'),
  tunnelStop: vi.fn(),
  ghIpStart: vi.fn(async () => undefined),
  ghIpStop: vi.fn(),
  schedulerStart: vi.fn(),
  schedulerStop: vi.fn(),
  archiveAndPruneOutputFull: vi.fn(() => ({ archivedCount: 2, errors: ['err1'] })),
  postMessage: vi.fn(async () => ({ ok: true, ts: '1.1', channel: 'C1' })),
  filesUploadV2: vi.fn(async () => ({ ok: true })),
  sendWelcomeDmIfFirstRun: vi.fn(async () => undefined),
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

vi.mock('./store/config-store.js', () => ({ ConfigStore: class {} }));
vi.mock('./utils/keychain.js', () => ({
  loadKeychainSecrets: vi.fn(async () => new Map()),
}));
vi.mock('./queue/job-queue.js', () => ({
  JobQueue: class {
    stopAccepting = mocked.queueStopAccepting;
    getStatus = mocked.queueGetStatus;
    enqueue = vi.fn(() => ({ position: 0 }));
  },
}));
vi.mock('./session/manager.js', () => ({
  SessionManager: class {
    listAllSessions = mocked.listAllSessions;
    createStandaloneSession = vi.fn(() => ({ sessionKey: 'sk', workdir: '/tmp/w' }));
    get = vi.fn(() => ({ workdir: '/tmp/w' }));
    deleteSessionByKeyWithCleanup = vi.fn();
  },
}));
vi.mock('./slack/app.js', () => ({
  createApp: vi.fn(() => ({
    app: { start: mocked.appStart, stop: mocked.appStop },
    ctx: {
      tunnel: null,
      webClient: {
        chat: { postMessage: mocked.postMessage },
        filesUploadV2: mocked.filesUploadV2,
      },
    },
    shutdownRunningJobs: mocked.shutdownRunningJobs,
  })),
}));
vi.mock('./server/api.js', () => ({
  startApiServer: vi.fn(() => ({ close: mocked.apiServerClose })),
}));
vi.mock('./store/agent-store.js', () => ({ AgentStore: class {} }));
vi.mock('./store/audit.js', () => ({ AuditStore: class {} }));
vi.mock('./store/database.js', () => ({
  initDatabase: mocked.initDatabase,
  closeDatabase: mocked.closeDatabase,
}));
vi.mock('./store/conversation.js', () => ({ ConversationStore: class {} }));
vi.mock('./store/dev-alias.js', () => ({ DevAliasStore: class {} }));
vi.mock('./store/dedupe.js', () => ({
  DedupeStore: class {
    cleanup = mocked.dedupeCleanup;
  },
}));
vi.mock('./utils/logger.js', () => ({
  setLogLevel: mocked.setLogLevel,
  setShowStacks: mocked.setShowStacks,
  logger: { info: mocked.loggerInfo, warn: mocked.loggerWarn, error: mocked.loggerError },
}));
vi.mock('./utils/metrics.js', () => ({
  startMetricsReporter: mocked.startMetricsReporter,
  stopMetricsReporter: mocked.stopMetricsReporter,
}));
vi.mock('./workdir/manager.js', () => ({
  WorkdirManager: class {
    ensureSessionWorkdirs = mocked.ensureSessionWorkdirs;
    archiveLegacyDefaultWorkdirIfUnused = mocked.archiveLegacyDefaultWorkdirIfUnused;
    cleanupUnusedSessionWorkdirs = mocked.cleanupUnusedSessionWorkdirs;
    cleanupStaleSessions = mocked.cleanupStaleSessions;
    ensureWorkdir = mocked.ensureWorkdir;
    prepareWorkdirSkillsOnly = vi.fn();
    validateCustomWorkdir = vi.fn();
  },
}));
vi.mock('./store/default-instruction.js', () => ({ DefaultInstructionStore: class {} }));
vi.mock('./store/mcp-server.js', () => ({
  McpServerStore: class {
    importFromGlobalConfigs = vi.fn(() => ({ imported: 0 }));
  },
}));
vi.mock('./store/session-mcp-server.js', () => ({ SessionMcpServerStore: class {} }));
vi.mock('./store/schedule.js', () => ({ ScheduleStore: class {} }));
vi.mock('./store/ondemand-task.js', () => ({ OndemandTaskStore: class {} }));
vi.mock('./store/orchestrator.js', () => ({
  OrchestratorStore: class {
    archiveAndPruneOutputFull = mocked.archiveAndPruneOutputFull;
  },
}));
vi.mock('./store/webhook-endpoint.js', () => ({ WebhookEndpointStore: class {} }));
vi.mock('./store/event-subscription.js', () => ({ EventSubscriptionStore: class {} }));
vi.mock('./store/triggered-task.js', () => ({ TriggeredTaskStore: class {} }));
vi.mock('./store/webhook-delivery.js', () => ({ WebhookDeliveryStore: class {} }));
vi.mock('./store/job-queue-store.js', () => ({
  JobQueueStore: class {
    listActive = vi.fn(() => []);
  },
}));
vi.mock('./queue/recovery.js', () => ({
  recoverDurableQueue: vi.fn(() => ({
    restoredQueued: 1,
    interruptedRunning: 0,
    failedRunning: 0,
    retriedRunning: 0,
    handedOffOrchestrator: 0,
    discardedQueued: 0,
  })),
}));
vi.mock('./event/webhook-secret-store.js', () => ({ WebhookSecretStore: class {} }));
vi.mock('./event/event-router.js', () => ({
  EventRouter: class {
    reload = vi.fn(async () => undefined);
  },
}));
vi.mock('./event/triggered-task-executor.js', () => ({ TriggeredTaskExecutor: class {} }));
vi.mock('./orchestrator/engine.js', () => ({
  OrchestratorEngine: class {
    setEventRouter = vi.fn();
    recoverActiveRuns = vi.fn(async () => undefined);
    setPostNotification = vi.fn();
    setUploadFile = vi.fn();
    setDefaultNotifyChannel = vi.fn();
  },
}));
vi.mock('./schedule/scheduler.js', () => ({
  Scheduler: class {
    start = mocked.schedulerStart;
    stop = mocked.schedulerStop;
  },
}));
vi.mock('./server/tunnel.js', () => ({
  CloudflareTunnel: class {
    start = mocked.tunnelStart;
    stop = mocked.tunnelStop;
  },
}));
vi.mock('./server/github-ip-allowlist.js', () => ({
  GitHubIpAllowlist: class {
    start = mocked.ghIpStart;
    stop = mocked.ghIpStop;
  },
}));
vi.mock('./store/housekeeping.js', () => ({
  runHousekeeping: vi.fn(() => ({
    retention: [{ table: 'audit', deletedCount: 5 }],
    orphanedThreadContextsCleared: 1,
    orphanedSessionMcpRows: 2,
    cleanedSessionKeys: ['sess_old'],
    jobLogsCleaned: 1,
    orphanJobLogsCleaned: 1,
    orchestratorsPurged: 1,
    orchestratorRunsPurged: 3,
    orchestratorWorkdirsCleaned: 2,
    orphanRunWorkdirsCleaned: 1,
    logsRotated: 1,
    backup: { path: '/tmp/backup.db' },
    backupsPruned: 1,
    durationMs: 100,
  })),
}));
vi.mock('./utils/workdir.js', () => ({ cleanupWorkdir: vi.fn() }));
vi.mock('./utils/error.js', () => ({
  errorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));
vi.mock('./setup/welcome.js', () => ({
  sendWelcomeDmIfFirstRun: mocked.sendWelcomeDmIfFirstRun,
}));

describe('index coverage2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listAllSessions.mockReturnValue([]);
    mocked.appStart.mockResolvedValue(undefined);
    mocked.appStop.mockResolvedValue(undefined);
    mocked.shutdownRunningJobs.mockResolvedValue(0);
  });

  it('boots with tunnel, scheduler, github IP allowlist, and recovery logging', async () => {
    const intervalCallbacks: Array<() => void> = [];
    const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation(((cb: () => void) => {
      intervalCallbacks.push(cb);
      return { unref: vi.fn() } as never;
    }) as never);
    const clearIntervalSpy = vi
      .spyOn(global, 'clearInterval')
      .mockImplementation((() => undefined) as never);
    const setTimeoutSpy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation((() => ({ unref: vi.fn() }) as never) as never);
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation((() => process) as never);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const memorySpy = vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 10 * 1024 * 1024,
      heapTotal: 0,
      heapUsed: 5 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0,
    });

    const { main } = await import('./index.js');
    await main();

    // Tunnel should have started
    expect(mocked.tunnelStart).toHaveBeenCalled();
    // GitHub IP allowlist should have started
    expect(mocked.ghIpStart).toHaveBeenCalled();
    // Scheduler should have started
    expect(mocked.schedulerStart).toHaveBeenCalled();
    // Recovery should have been logged
    expect(mocked.loggerInfo).toHaveBeenCalledWith('durable_queue_recovered', expect.any(Object));

    // Fire interval callbacks to cover outputFullCleanup and housekeeping
    for (const cb of intervalCallbacks) {
      cb();
    }
    // outputFullCleanup with errors should log warning
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'output_full_cleanup_errors',
      expect.any(Object),
    );
    // housekeeping with activity should log
    expect(mocked.loggerInfo).toHaveBeenCalledWith('db_housekeeping', expect.any(Object));

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    setTimeoutSpy.mockRestore();
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
    memorySpy.mockRestore();
  });

  it('handles tunnel start failure gracefully', async () => {
    mocked.tunnelStart.mockRejectedValueOnce(new Error('tunnel failed'));

    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockImplementation((() => ({ unref: vi.fn() }) as never) as never);
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation((() => process) as never);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const { main } = await import('./index.js');
    await main();

    expect(mocked.loggerError).toHaveBeenCalledWith('tunnel_start_failed', expect.any(Object));

    setIntervalSpy.mockRestore();
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('handles welcome DM failure gracefully', async () => {
    mocked.sendWelcomeDmIfFirstRun.mockRejectedValueOnce(new Error('DM failed'));

    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockImplementation((() => ({ unref: vi.fn() }) as never) as never);
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation((() => process) as never);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const { main } = await import('./index.js');
    await main();

    expect(mocked.loggerWarn).toHaveBeenCalledWith('welcome_dm_failed', expect.any(Object));

    setIntervalSpy.mockRestore();
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('handles outputFullCleanup total failure', async () => {
    mocked.archiveAndPruneOutputFull.mockImplementationOnce(() => {
      throw new Error('archive boom');
    });

    const intervalCallbacks: Array<() => void> = [];
    const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation(((cb: () => void) => {
      intervalCallbacks.push(cb);
      return { unref: vi.fn() } as never;
    }) as never);
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation((() => process) as never);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const { main } = await import('./index.js');
    await main();

    // Call the outputFullCleanup interval — first one fires on startup but second should throw
    mocked.archiveAndPruneOutputFull.mockImplementationOnce(() => {
      throw new Error('archive boom2');
    });
    for (const cb of intervalCallbacks) {
      cb();
    }

    expect(mocked.loggerError).toHaveBeenCalledWith(
      'output_full_cleanup_failed',
      expect.any(Object),
    );

    setIntervalSpy.mockRestore();
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
  });
});
