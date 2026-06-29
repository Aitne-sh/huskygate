import { vi } from 'vitest';
import type { Config } from '../config.js';
import { type AppContext, type AppContextSeed, createAppContext } from '../context/app-context.js';
import type { SlackClientSurface } from '../context/slack-client-surface.js';
import type { SessionSummary } from '../session/manager.js';
import type { Session } from '../session/types.js';

const FIXED_ISO = '2026-03-11T00:00:00.000Z';

export interface TestAppContextSeedOverrides
  extends Partial<Omit<AppContextSeed, 'config' | 'webClient'>> {
  config?: Partial<Config>;
  webClient?: Partial<SlackClientSurface>;
}

export interface TestAppContextOverrides extends Partial<Omit<AppContext, 'config' | 'webClient'>> {
  config?: Partial<Config>;
  webClient?: Partial<SlackClientSurface>;
}

export function makeTestConfig(overrides: Partial<Config> = {}): Config {
  const defaultConfig: Config = {
    slack: { botToken: 'xoxb-test', appToken: 'xapp-test' },
    allowedUserIds: ['U1'],
    allowedTeamId: null,
    defaultTool: 'claude',
    maxConcurrency: 2,
    maxRuntimeSec: 900,
    noOutputTimeoutSec: 90,
    claudeModel: null,
    codexModel: null,
    geminiModel: null,
    claudeMcpAuthServer: null,
    geminiMcpAuthServer: null,
    codexMcpAuthServer: null,
    workdirRoot: '/tmp/test-workdir',
    allowedWorkdirRoots: ['/tmp/test-workdir'],
    sessionIdleTimeoutSec: 86400,
    sessionCleanupEnabled: true,
    scheduleEnabled: false,
    schedulePollIntervalSec: 30,
    scheduleMaxConcurrent: 1,
    scheduleDefaultNotifyChannel: null,
    claudeDefaultMode: 'write',
    codexDefaultSandboxMode: 'write',
    geminiDefaultMode: 'write',
    toolAutoApproveMode: false,
    logLevel: 'info',
    serverApiPort: 3738,
    serverApiHost: '127.0.0.1',
    serverApiSecret: 'test-api-secret',
    dashboardSecret: 'test-dashboard-secret',
    webhookPublicBaseUrl: null,
    cloudflareTunnelEnabled: false,
    cloudflareTunnelToken: null,
    githubWebhookIpAllowlist: true,
    dashboardCookieSecure: true,
    logStacks: false,
    skillTemplateDir: null,
  };

  return {
    ...defaultConfig,
    ...overrides,
    slack: {
      ...defaultConfig.slack,
      ...overrides.slack,
    },
  };
}

export function makeTestSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionKey: 'sess_test',
    tool: 'claude',
    mode: 'write',
    modeExpiresAt: null,
    toolState: {},
    workdir: '/tmp/test-workdir/default',
    runningJobId: null,
    updatedAt: FIXED_ISO,
    devAlias: null,
    ...overrides,
  };
}

export function makeTestSessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionKey: 'sess_test',
    sessionId: 'testsid1',
    threadKey: 'C1:1.1',
    userId: 'U1',
    tool: 'claude',
    mode: 'write',
    modeExpiresAt: null,
    workdir: '/tmp/test-workdir/default',
    runningJobId: null,
    startedAt: FIXED_ISO,
    updatedAt: FIXED_ISO,
    active: true,
    devAlias: null,
    ...overrides,
  };
}

export function makeTestWebClient(overrides: Partial<SlackClientSurface> = {}): SlackClientSurface {
  const defaultChat = {
    postMessage: vi.fn().mockResolvedValue({ ok: true, ts: '1.1' }),
    update: vi.fn().mockResolvedValue({ ok: true }),
  };

  return {
    chat: {
      ...defaultChat,
      ...(overrides.chat as object | undefined),
    } as unknown as SlackClientSurface['chat'],
    users: (overrides.users ?? {}) as unknown as SlackClientSurface['users'],
    conversations: (overrides.conversations ??
      {}) as unknown as SlackClientSurface['conversations'],
    assistant: (overrides.assistant ?? {}) as unknown as SlackClientSurface['assistant'],
    filesUploadV2: (overrides.filesUploadV2 ??
      vi.fn().mockResolvedValue({ ok: true })) as unknown as SlackClientSurface['filesUploadV2'],
  };
}

function makeDefaultSeed(): AppContextSeed {
  const baseSession = makeTestSession();

  return {
    config: makeTestConfig(),
    webClient: makeTestWebClient(),
    sessionManager: {
      get: vi.fn().mockReturnValue(null),
      getActiveSessionKey: vi.fn().mockReturnValue(null),
      getActiveSessionForThread: vi.fn().mockReturnValue(null),
      getActiveSessionSummary: vi.fn().mockReturnValue(null),
      getSessionSummary: vi.fn().mockReturnValue(null),
      getSessionSummaryById: vi.fn().mockReturnValue(null),
      getSessionByIdForThread: vi.fn().mockReturnValue(null),
      getActiveSession: vi.fn().mockReturnValue(null),
      getThreadContext: vi.fn().mockReturnValue(null),
      getSessionId: vi.fn().mockReturnValue(null),
      clearActiveSession: vi.fn(),
      setActiveSessionKey: vi.fn(),
      createSessionForThread: vi.fn((threadKey: string, userId: string, tool: Session['tool']) =>
        makeTestSession({ sessionKey: `${threadKey}:${userId}:${tool}`, tool }),
      ),
      createStandaloneSession: vi.fn(
        (tool: Session['tool'], userId = 'dashboard', mode: Session['mode'] = 'write') =>
          makeTestSessionSummary({ tool, userId, mode }),
      ),
      createDevSession: vi.fn().mockReturnValue(baseSession),
      findLatestSessionByTool: vi.fn().mockReturnValue(null),
      findLatestSessionByToolOwned: vi.fn().mockReturnValue(null),
      findDevSession: vi.fn().mockReturnValue(null),
      listSessionsForThread: vi.fn().mockReturnValue([]),
      listSessionsForThreadOwned: vi.fn().mockReturnValue([]),
      listAllSessions: vi.fn().mockReturnValue([]),
      deleteSessionById: vi.fn().mockReturnValue(null),
      deleteSessionsByIds: vi.fn().mockReturnValue([]),
      deleteSessionByIdWithCleanup: vi.fn().mockReturnValue(null),
      deleteSessionByKeyWithCleanup: vi.fn().mockReturnValue(null),
      clearAllSessions: vi.fn().mockReturnValue([]),
      clearAllSessionsWithCleanup: vi.fn().mockReturnValue([]),
      getSessionByIdForThreadOwned: vi.fn().mockReturnValue(null),
      getSessionSummaryByIdForThreadOwned: vi.fn().mockReturnValue(null),
      updateToolState: vi.fn(),
      mergeToolState: vi.fn(),
      updateTool: vi.fn(),
      updateMode: vi.fn(),
      updateWorkdir: vi.fn(),
      reset: vi.fn(),
      setRunningJob: vi.fn(),
      touchThreadActivity: vi.fn(),
    } as unknown as AppContextSeed['sessionManager'],
    jobQueue: {
      enqueue: vi.fn().mockReturnValue({ position: 0 }),
      cancelSession: vi.fn().mockReturnValue(false),
      getStatus: vi.fn().mockReturnValue({ pending: 0 }),
      getRunningJob: vi.fn().mockReturnValue(null),
      setExecutor: vi.fn(),
    } as unknown as AppContextSeed['jobQueue'],
    workdirManager: {
      prepareWorkdirSkillsOnly: vi.fn(),
      prepareDevWorkdir: vi.fn(),
      willSeedSkills: vi.fn().mockReturnValue(false),
      listSeedableSkillEntries: vi.fn().mockReturnValue([]),
      listSeedableSkillRefs: vi.fn().mockReturnValue([]),
      seedDevInstructionFile: vi.fn(),
      getSessionWorkdir: vi.fn().mockReturnValue('/tmp/test-workdir/default'),
      validateCustomWorkdir: vi.fn((value: string) => value),
      cleanupUnusedSessionWorkdirs: vi.fn().mockReturnValue(0),
      archiveLegacyDefaultWorkdirIfUnused: vi.fn().mockReturnValue(null),
    } as unknown as AppContextSeed['workdirManager'],
    agentStore: {
      list: vi.fn().mockReturnValue([]),
      getById: vi.fn().mockReturnValue(null),
      getByName: vi.fn().mockReturnValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getUsage: vi.fn().mockReturnValue({
        count: 0,
        nodes: [],
        tasks: { scheduled: 0, ondemand: 0, triggered: 0 },
      }),
    } as unknown as AppContextSeed['agentStore'],
    dedupeStore: {
      isDuplicate: vi.fn().mockReturnValue(false),
      register: vi.fn(),
    } as unknown as AppContextSeed['dedupeStore'],
    auditStore: {
      logModeChange: vi.fn(),
      logJobStart: vi.fn(),
      logJobComplete: vi.fn(),
    } as unknown as AppContextSeed['auditStore'],
    conversationStore: {
      saveMessage: vi.fn(),
      listBySessionKey: vi.fn().mockReturnValue([]),
      clearSession: vi.fn(),
    } as unknown as AppContextSeed['conversationStore'],
    defaultInstructionStore: {
      getWithEnabled: vi.fn().mockReturnValue({ content: '', enabled: false }),
      get: vi.fn().mockReturnValue(''),
      set: vi.fn(),
      setEnabled: vi.fn(),
    } as unknown as AppContextSeed['defaultInstructionStore'],
    devAliasStore: {
      list: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
    } as unknown as AppContextSeed['devAliasStore'],
    mcpServerStore: {
      listByTool: vi.fn().mockReturnValue([]),
      listAll: vi.fn().mockReturnValue([]),
      getById: vi.fn().mockReturnValue(null),
    } as unknown as AppContextSeed['mcpServerStore'],
    sessionMcpServerStore: {
      listBySession: vi.fn().mockReturnValue([]),
    } as unknown as AppContextSeed['sessionMcpServerStore'],
    scheduleStore: {} as unknown as AppContextSeed['scheduleStore'],
    ondemandTaskStore: {} as unknown as AppContextSeed['ondemandTaskStore'],
    triggeredTaskStore: {
      getById: vi.fn().mockReturnValue(null),
      list: vi.fn().mockReturnValue([]),
      getRunsByTask: vi.fn().mockReturnValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      transaction: vi.fn(<T>(fn: () => T) => fn()),
    } as unknown as AppContextSeed['triggeredTaskStore'],
    orchestratorStore: {
      getById: vi.fn().mockReturnValue(null),
      getNodeById: vi.fn().mockReturnValue(null),
      list: vi.fn().mockReturnValue([]),
    } as unknown as AppContextSeed['orchestratorStore'],
    webhookEndpointStore: {
      list: vi.fn().mockReturnValue([]),
      getById: vi.fn().mockReturnValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as AppContextSeed['webhookEndpointStore'],
    eventSubscriptionStore: {
      list: vi.fn().mockReturnValue([]),
      getById: vi.fn().mockReturnValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as AppContextSeed['eventSubscriptionStore'],
    webhookSecretStore: {
      isAvailable: vi.fn(async () => true),
      generateSecret: vi.fn().mockReturnValue('generated-secret'),
      buildSecretRef: vi.fn((id: string) => `secret:${id}`),
      setSecret: vi.fn(async () => true),
      deleteSecret: vi.fn(async () => true),
    } as unknown as AppContextSeed['webhookSecretStore'],
    webhookDeliveryStore: {
      tryClaimDelivery: vi.fn().mockReturnValue({ claimed: true }),
      markPartial: vi.fn(),
      markCompleted: vi.fn(),
      markFailed: vi.fn(),
    } as unknown as AppContextSeed['webhookDeliveryStore'],
    orchestratorEngine: {} as unknown as AppContextSeed['orchestratorEngine'],
    triggeredTaskExecutor: {
      execute: vi.fn(),
    } as unknown as AppContextSeed['triggeredTaskExecutor'],
    eventRouter: {
      reload: vi.fn(async () => undefined),
      dispatchWebhook: vi.fn(async () => ({ deliveryId: 'delivery-1', triggeredCount: 0 })),
    } as unknown as AppContextSeed['eventRouter'],
    githubIpAllowlist: null,
    tunnelEnabled: false,
    tunnel: null,
  };
}

export function makeTestAppContextSeed(
  overrides: TestAppContextSeedOverrides = {},
): AppContextSeed {
  const { config, webClient, ...rest } = overrides;
  return {
    ...makeDefaultSeed(),
    ...rest,
    config: makeTestConfig(config),
    webClient: makeTestWebClient(webClient),
  };
}

export function makeTestAppContext(overrides: TestAppContextOverrides = {}): AppContext {
  const {
    config,
    webClient,
    pendingConfirmations,
    pendingToolApprovals,
    pendingMcpAuthBypassApprovals,
    activeRunners,
    inactivityTimers,
    assistantThreads,
    switchPreflightBarriers,
    jobEventStreams,
    ...seedOverrides
  } = overrides;

  const ctx = createAppContext(
    makeTestAppContextSeed({
      ...(seedOverrides as Partial<AppContextSeed>),
      config,
      webClient,
    }),
  );

  return {
    ...ctx,
    pendingConfirmations: pendingConfirmations ?? ctx.pendingConfirmations,
    pendingToolApprovals: pendingToolApprovals ?? ctx.pendingToolApprovals,
    pendingMcpAuthBypassApprovals:
      pendingMcpAuthBypassApprovals ?? ctx.pendingMcpAuthBypassApprovals,
    activeRunners: activeRunners ?? ctx.activeRunners,
    inactivityTimers: inactivityTimers ?? ctx.inactivityTimers,
    assistantThreads: assistantThreads ?? ctx.assistantThreads,
    switchPreflightBarriers: switchPreflightBarriers ?? ctx.switchPreflightBarriers,
    jobEventStreams: jobEventStreams ?? ctx.jobEventStreams,
  };
}
