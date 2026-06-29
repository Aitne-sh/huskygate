/** Coverage3 tests for index.ts: uncovered callbacks and error handlers —
 * dbHousekeeping error, orchestratorEngine callbacks (createSession, prepareWorkdir,
 * cleanupSession, cleanupRunWorkdir), postNotification, uploadFile,
 * uncaughtException, unhandledRejection. */
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
    scheduleEnabled: false,
    schedulePollIntervalSec: 30,
    scheduleMaxConcurrent: 1,
    scheduleDefaultNotifyChannel: null,
    logLevel: 'info',
    logStacks: false,
    toolAutoApproveMode: false,
    claudeDefaultMode: 'write',
    codexDefaultSandboxMode: 'write',
    geminiDefaultMode: 'write',
    cloudflareTunnelEnabled: false,
    cloudflareTunnelToken: null,
    githubWebhookIpAllowlist: false,
    dashboardCookieSecure: true,
    skillTemplateDir: null,
    sessionIdleTimeoutSec: 3600,
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
  prepareWorkdirSkillsOnly: vi.fn(),
  validateCustomWorkdir: vi.fn(),
  appStart: vi.fn().mockResolvedValue(undefined),
  appStop: vi.fn().mockResolvedValue(undefined),
  shutdownRunningJobs: vi.fn().mockResolvedValue(0),
  startMetricsReporter: vi.fn(),
  stopMetricsReporter: vi.fn(),
  apiServerClose: vi.fn(),
  queueStopAccepting: vi.fn(),
  queueGetStatus: vi.fn(() => ({ running: 0, pending: 0 })),
  queueEnqueue: vi.fn(() => ({ position: 0 })),
  archiveAndPruneOutputFull: vi.fn(() => ({ archivedCount: 0, errors: [] })),
  postMessage: vi.fn(async () => ({ ok: true, ts: '1.1', channel: 'C1' })),
  filesUploadV2: vi.fn(async () => ({ ok: true })),
  sendWelcomeDmIfFirstRun: vi.fn(async () => undefined),
  // Capture orchestrator engine callbacks
  setPostNotification: vi.fn(),
  setUploadFile: vi.fn(),
  setDefaultNotifyChannel: vi.fn(),
  setEventRouter: vi.fn(),
  recoverActiveRuns: vi.fn(async () => undefined),
  orchestratorConstructorArgs: null as Record<string, unknown> | null,
  // Session manager
  createStandaloneSession: vi.fn(() => ({ sessionKey: 'sk-123', workdir: '/tmp/w/s1' })),
  sessionGet: vi.fn(() => ({ workdir: '/tmp/w/s1' })),
  deleteSessionByKeyWithCleanup: vi.fn(),
  // Housekeeping
  runHousekeeping: vi.fn(() => {
    throw new Error('housekeeping boom');
  }),
  cleanupWorkdir: vi.fn(),
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
    enqueue = mocked.queueEnqueue;
  },
}));
vi.mock('./session/manager.js', () => ({
  SessionManager: class {
    listAllSessions = mocked.listAllSessions;
    createStandaloneSession = mocked.createStandaloneSession;
    get = mocked.sessionGet;
    deleteSessionByKeyWithCleanup = mocked.deleteSessionByKeyWithCleanup;
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
    prepareWorkdirSkillsOnly = mocked.prepareWorkdirSkillsOnly;
    validateCustomWorkdir = mocked.validateCustomWorkdir;
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
    restoredQueued: 0,
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
    constructor(args: Record<string, unknown>) {
      mocked.orchestratorConstructorArgs = args;
    }
    setEventRouter = mocked.setEventRouter;
    recoverActiveRuns = mocked.recoverActiveRuns;
    setPostNotification = mocked.setPostNotification;
    setUploadFile = mocked.setUploadFile;
    setDefaultNotifyChannel = mocked.setDefaultNotifyChannel;
  },
}));
vi.mock('./schedule/scheduler.js', () => ({
  Scheduler: class {
    start = vi.fn();
    stop = vi.fn();
  },
}));
vi.mock('./store/housekeeping.js', () => ({
  runHousekeeping: mocked.runHousekeeping,
}));
vi.mock('./utils/workdir.js', () => ({
  cleanupWorkdir: mocked.cleanupWorkdir,
}));
vi.mock('./utils/error.js', () => ({
  errorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));
vi.mock('./setup/welcome.js', () => ({
  sendWelcomeDmIfFirstRun: mocked.sendWelcomeDmIfFirstRun,
}));
vi.mock('@slack/bolt', () => ({
  App: class MockApp {
    client = {
      chat: { postMessage: mocked.postMessage },
      filesUploadV2: mocked.filesUploadV2,
    };
  },
}));
vi.mock('./context/app-context.js', () => ({
  createAppContext: vi.fn((opts: Record<string, unknown>) => opts),
}));
vi.mock('./server/slack-notification-service.js', () => ({
  SlackNotificationService: class {},
}));

describe('index coverage3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listAllSessions.mockReturnValue([]);
    mocked.appStart.mockResolvedValue(undefined);
    mocked.appStop.mockResolvedValue(undefined);
    mocked.shutdownRunningJobs.mockResolvedValue(0);
    // Reset housekeeping to throw for dbHousekeeping error coverage
    mocked.runHousekeeping.mockImplementation(() => {
      throw new Error('housekeeping boom');
    });
  });

  it('logs error when dbHousekeeping fails (lines 174-175)', async () => {
    const intervalCallbacks: Array<() => void> = [];
    const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation(((cb: () => void) => {
      intervalCallbacks.push(cb);
      return { unref: vi.fn() } as never;
    }) as never);
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation((() => process) as never);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const { main } = await import('./index.js');
    await main();

    // Fire interval callbacks — the dbHousekeeping callback should log error
    for (const cb of intervalCallbacks) {
      cb();
    }

    expect(mocked.loggerError).toHaveBeenCalledWith(
      'db_housekeeping_failed',
      expect.objectContaining({ error: 'housekeeping boom' }),
    );

    setIntervalSpy.mockRestore();
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('exercises OrchestratorEngine constructor callbacks (lines 185-204)', async () => {
    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockImplementation((() => ({ unref: vi.fn() }) as never) as never);
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation((() => process) as never);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const { main } = await import('./index.js');
    await main();

    const args = mocked.orchestratorConstructorArgs!;
    expect(args).not.toBeNull();

    // Test createSession callback (lines 185-191)
    const createSession = args.createSession as (
      tool: string,
      userId: string,
      mode: string | null,
      options?: { skipWorkdir?: boolean },
    ) => { sessionKey: string; workdir: string };

    // With mode and no skipWorkdir
    const session1 = createSession('claude', 'U1', 'write', undefined);
    expect(mocked.createStandaloneSession).toHaveBeenCalledWith('claude', 'U1', 'write');
    expect(mocked.ensureWorkdir).toHaveBeenCalledWith('/tmp/w/s1');
    expect(session1).toEqual({ sessionKey: 'sk-123', workdir: '/tmp/w/s1' });

    // With null mode (defaults to 'write')
    vi.clearAllMocks();
    mocked.createStandaloneSession.mockReturnValueOnce({ sessionKey: 'sk-456', workdir: '/tmp/w/s2' });
    const session2 = createSession('codex', 'U2', null);
    expect(mocked.createStandaloneSession).toHaveBeenCalledWith('codex', 'U2', 'write');
    expect(mocked.ensureWorkdir).toHaveBeenCalledWith('/tmp/w/s2');

    // With skipWorkdir
    vi.clearAllMocks();
    mocked.createStandaloneSession.mockReturnValueOnce({ sessionKey: 'sk-789', workdir: '/tmp/w/s3' });
    createSession('gemini', 'U3', 'readonly', { skipWorkdir: true });
    expect(mocked.createStandaloneSession).toHaveBeenCalledWith('gemini', 'U3', 'readonly');
    expect(mocked.ensureWorkdir).not.toHaveBeenCalled();

    // Test prepareWorkdir callback (lines 192-194)
    const prepareWorkdir = args.prepareWorkdir as (
      workdir: string,
      tool: string,
      enabledSkills: string[],
    ) => void;
    prepareWorkdir('/tmp/w/s1', 'claude', ['skill1']);
    expect(mocked.prepareWorkdirSkillsOnly).toHaveBeenCalledWith('/tmp/w/s1', 'claude', ['skill1']);

    // Test cleanupSession callback (lines 196-200)
    const cleanupSession = args.cleanupSession as (sessionKey: string) => void;
    vi.clearAllMocks();
    mocked.sessionGet.mockReturnValueOnce({ workdir: '/tmp/w/cleanup-s' });
    cleanupSession('sk-to-cleanup');
    expect(mocked.sessionGet).toHaveBeenCalledWith('sk-to-cleanup');
    expect(mocked.deleteSessionByKeyWithCleanup).toHaveBeenCalledWith('sk-to-cleanup');
    expect(mocked.cleanupWorkdir).toHaveBeenCalledWith('/tmp/workdir', '/tmp/w/cleanup-s');

    // Test cleanupSession with null session (workdir becomes null)
    vi.clearAllMocks();
    mocked.sessionGet.mockReturnValueOnce(null);
    cleanupSession('sk-nonexistent');
    expect(mocked.deleteSessionByKeyWithCleanup).toHaveBeenCalledWith('sk-nonexistent');
    expect(mocked.cleanupWorkdir).toHaveBeenCalledWith('/tmp/workdir', null);

    // Test cleanupRunWorkdir callback (lines 201-204)
    const cleanupRunWorkdir = args.cleanupRunWorkdir as (runId: string) => void;
    vi.clearAllMocks();
    cleanupRunWorkdir('abcdef1234567890');
    expect(mocked.cleanupWorkdir).toHaveBeenCalledWith(
      '/tmp/workdir',
      expect.stringContaining('orch_abcdef12'),
    );

    setIntervalSpy.mockRestore();
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('captures orchestratorEngine callbacks and they work correctly', async () => {
    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockImplementation((() => ({ unref: vi.fn() }) as never) as never);
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation((() => process) as never);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const { main } = await import('./index.js');
    await main();

    // setPostNotification was called with a callback (lines 299-309)
    expect(mocked.setPostNotification).toHaveBeenCalledOnce();
    const postNotifCb = mocked.setPostNotification.mock.calls[0][0] as (
      channel: string,
      text: string,
      threadTs?: string,
    ) => Promise<{ channelId: string; ts: string } | null>;

    // Test postNotification callback — success
    mocked.postMessage.mockResolvedValueOnce({ ok: true, ts: '123.456', channel: 'C99' });
    const result = await postNotifCb('C99', 'hello', 'thread-ts');
    expect(mocked.postMessage).toHaveBeenCalledWith({
      channel: 'C99',
      text: 'hello',
      thread_ts: 'thread-ts',
    });
    expect(result).toEqual({ channelId: 'C99', ts: '123.456' });

    // Test postNotification callback — without threadTs
    mocked.postMessage.mockResolvedValueOnce({ ok: true, ts: '789.0', channel: 'C50' });
    const result2 = await postNotifCb('C50', 'world');
    expect(mocked.postMessage).toHaveBeenLastCalledWith({
      channel: 'C50',
      text: 'world',
    });
    expect(result2).toEqual({ channelId: 'C50', ts: '789.0' });

    // Test postNotification callback — no ts returns null
    mocked.postMessage.mockResolvedValueOnce({ ok: true });
    const result3 = await postNotifCb('C1', 'test');
    expect(result3).toBeNull();

    // setUploadFile was called with a callback (lines 311-320)
    expect(mocked.setUploadFile).toHaveBeenCalledOnce();
    const uploadCb = mocked.setUploadFile.mock.calls[0][0] as (
      channel: string,
      filePath: string,
      filename: string,
      threadTs?: string,
    ) => Promise<void>;

    // Create temp file for uploadFile test
    const { writeFileSync, unlinkSync } = await import('node:fs');
    const uploadTmpPath = '/tmp/hg-test-upload.txt';
    writeFileSync(uploadTmpPath, 'test-content');

    // Test uploadFile callback — with threadTs
    await uploadCb('C99', uploadTmpPath, 'file.txt', 'thread-ts');
    expect(mocked.filesUploadV2).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: 'C99',
        filename: 'file.txt',
        title: 'file.txt',
        thread_ts: 'thread-ts',
      }),
    );

    // Test uploadFile callback — without threadTs
    await uploadCb('C50', uploadTmpPath, 'file2.txt');
    expect(mocked.filesUploadV2).toHaveBeenLastCalledWith(
      expect.objectContaining({
        channel_id: 'C50',
        filename: 'file2.txt',
        title: 'file2.txt',
      }),
    );

    // Cleanup temp file
    try { unlinkSync(uploadTmpPath); } catch { /* ignore */ }

    setIntervalSpy.mockRestore();
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('uncaughtException handler logs and exits (lines 412-418)', async () => {
    const processHandlers = new Map<string, (...args: unknown[]) => void>();
    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockImplementation((() => ({ unref: vi.fn() }) as never) as never);
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      cb: (...args: unknown[]) => void,
    ) => {
      processHandlers.set(event, cb);
      return process;
    }) as never);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const { main } = await import('./index.js');
    await main();

    // Trigger uncaughtException handler
    const err = new Error('test uncaught');
    processHandlers.get('uncaughtException')?.(err);

    expect(mocked.loggerError).toHaveBeenCalledWith(
      'uncaught_exception',
      expect.objectContaining({ error: 'test uncaught' }),
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);

    setIntervalSpy.mockRestore();
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('uncaughtException handler falls back to stderr when logger throws (lines 415-417)', async () => {
    const processHandlers = new Map<string, (...args: unknown[]) => void>();
    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockImplementation((() => ({ unref: vi.fn() }) as never) as never);
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      cb: (...args: unknown[]) => void,
    ) => {
      processHandlers.set(event, cb);
      return process;
    }) as never);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const { main } = await import('./index.js');
    await main();

    // Make logger throw on next call
    mocked.loggerError.mockImplementationOnce(() => {
      throw new Error('logger broken');
    });

    const err = new Error('crash');
    processHandlers.get('uncaughtException')?.(err);

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('FATAL uncaught_exception'));
    expect(processExitSpy).toHaveBeenCalledWith(1);

    setIntervalSpy.mockRestore();
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('unhandledRejection handler logs and exits (lines 420-427)', async () => {
    const processHandlers = new Map<string, (...args: unknown[]) => void>();
    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockImplementation((() => ({ unref: vi.fn() }) as never) as never);
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      cb: (...args: unknown[]) => void,
    ) => {
      processHandlers.set(event, cb);
      return process;
    }) as never);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const { main } = await import('./index.js');
    await main();

    // Trigger with Error
    processHandlers.get('unhandledRejection')?.(new Error('promise rejected'));
    expect(mocked.loggerError).toHaveBeenCalledWith(
      'unhandled_rejection',
      expect.objectContaining({ error: 'promise rejected' }),
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);

    setIntervalSpy.mockRestore();
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('unhandledRejection handler handles non-Error reason (line 422)', async () => {
    const processHandlers = new Map<string, (...args: unknown[]) => void>();
    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockImplementation((() => ({ unref: vi.fn() }) as never) as never);
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      cb: (...args: unknown[]) => void,
    ) => {
      processHandlers.set(event, cb);
      return process;
    }) as never);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const { main } = await import('./index.js');
    await main();

    // Trigger with non-Error reason
    processHandlers.get('unhandledRejection')?.('string reason');
    expect(mocked.loggerError).toHaveBeenCalledWith(
      'unhandled_rejection',
      expect.objectContaining({ error: 'string reason' }),
    );

    setIntervalSpy.mockRestore();
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('unhandledRejection handler falls back to stderr when logger throws (lines 424-426)', async () => {
    const processHandlers = new Map<string, (...args: unknown[]) => void>();
    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockImplementation((() => ({ unref: vi.fn() }) as never) as never);
    const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      cb: (...args: unknown[]) => void,
    ) => {
      processHandlers.set(event, cb);
      return process;
    }) as never);
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const { main } = await import('./index.js');
    await main();

    // Make logger throw on next call
    mocked.loggerError.mockImplementationOnce(() => {
      throw new Error('logger broken');
    });

    processHandlers.get('unhandledRejection')?.('reason string');

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('FATAL unhandled_rejection'));
    expect(processExitSpy).toHaveBeenCalledWith(1);

    setIntervalSpy.mockRestore();
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
