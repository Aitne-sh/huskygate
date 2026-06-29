import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  postMessageWithContext: vi.fn().mockResolvedValue(undefined),
  scheduleExpiry: vi.fn(),
  runGeminiMcpAuthPreflight: vi.fn(),
  runGeminiInteractiveMcpAuth: vi.fn(),
  isGeminiMcpPreflightBypassed: vi.fn(() => false),
  isGeminiMcpPreflightInitialized: vi.fn(() => false),
  markGeminiMcpPreflightInitialized: vi.fn((state: Record<string, unknown>, server: string) => ({
    ...state,
    gemini_mcp_auth_initialized_server: server,
  })),
  markGeminiMcpPreflightVerified: vi.fn((state: Record<string, unknown>, server: string) => ({
    ...state,
    gemini_mcp_auth_verified_server: server,
  })),
  formatGeminiMcpAuthBypassPrompt: vi.fn(() => 'gemini bypass prompt'),
  formatGeminiMcpAuthGenericFailureMessage: vi.fn(() => 'gemini generic failure'),
  formatGeminiMcpAuthInteractiveFailureMessage: vi.fn(() => 'gemini interactive failure'),
  formatGeminiMcpAuthLoopPreventionMessage: vi.fn(() => 'gemini loop prevention'),
  formatGeminiMcpAuthOAuthUrlMessage: vi.fn((_server: string, url: string) => `oauth:${url}`),
  formatGeminiMcpAuthRequiredMessage: vi.fn((server: string) => `required:${server}`),
  formatGeminiMcpAuthWaitingMessage: vi.fn((server: string) => `waiting:${server}`),
  prepareGeminiRuntimeHome: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  buildEnv: vi.fn(() => ({ GEMINI: '1' })),
  RunnerCtor: vi.fn(() => ({ tag: 'runner' })),
}));

vi.mock('./app-helpers.js', () => ({
  MCP_AUTH_BYPASS_TIMEOUT_MS: 120_000,
  postMessageWithBlocks: mocked.postMessageWithContext,
  postMessageWithContext: mocked.postMessageWithContext,
  scheduleExpiry: mocked.scheduleExpiry,
}));

vi.mock('./block-kit.js', () => ({
  buildMcpAuthApprovalBlocks: vi.fn(() => [
    { type: 'section', text: { type: 'mrkdwn', text: 'auth blocks' } },
  ]),
}));

vi.mock('./tools/gemini.js', () => ({
  GEMINI_MCP_AUTH_APPROVAL_RERUN_KEY: 'gemini_mcp_auth_approval_rerun',
  GEMINI_MCP_AUTH_BYPASS_SERVER_KEY: 'gemini_mcp_auth_bypass_server',
  GEMINI_MCP_AUTH_INITIALIZED_SERVER_KEY: 'gemini_mcp_auth_initialized_server',
  GEMINI_MCP_AUTH_VERIFIED_SERVER_KEY: 'gemini_mcp_auth_verified_server',
  formatGeminiMcpAuthBypassPrompt: mocked.formatGeminiMcpAuthBypassPrompt,
  formatGeminiMcpAuthGenericFailureMessage: mocked.formatGeminiMcpAuthGenericFailureMessage,
  formatGeminiMcpAuthInteractiveFailureMessage: mocked.formatGeminiMcpAuthInteractiveFailureMessage,
  formatGeminiMcpAuthLoopPreventionMessage: mocked.formatGeminiMcpAuthLoopPreventionMessage,
  formatGeminiMcpAuthOAuthUrlMessage: mocked.formatGeminiMcpAuthOAuthUrlMessage,
  formatGeminiMcpAuthRequiredMessage: mocked.formatGeminiMcpAuthRequiredMessage,
  formatGeminiMcpAuthWaitingMessage: mocked.formatGeminiMcpAuthWaitingMessage,
  isGeminiMcpPreflightBypassed: mocked.isGeminiMcpPreflightBypassed,
  isGeminiMcpPreflightInitialized: mocked.isGeminiMcpPreflightInitialized,
  markGeminiMcpPreflightInitialized: mocked.markGeminiMcpPreflightInitialized,
  markGeminiMcpPreflightVerified: mocked.markGeminiMcpPreflightVerified,
  runGeminiInteractiveMcpAuth: mocked.runGeminiInteractiveMcpAuth,
  runGeminiMcpAuthPreflight: mocked.runGeminiMcpAuthPreflight,
}));

vi.mock('../runner/gemini-runtime-home.js', () => ({
  prepareGeminiRuntimeHome: mocked.prepareGeminiRuntimeHome,
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: mocked.loggerInfo,
    warn: mocked.loggerWarn,
    error: mocked.loggerError,
  },
}));

vi.mock('../runner/driver-gemini.js', () => ({
  GeminiDriver: vi.fn().mockImplementation(() => ({
    buildEnv: mocked.buildEnv,
  })),
}));

vi.mock('../runner/runner.js', () => ({
  Runner: mocked.RunnerCtor,
}));

import {
  handleGeminiPostRunMcpAuth,
  prepareGeminiJobRuntime,
  runGeminiJobPreflight,
  runGeminiSwitchPreflight,
} from './mcp-preflight-gemini.js';

type MockFn = ReturnType<typeof vi.fn>;
const GEMINI_SERVER = {
  id: 'srv_aws',
  name: 'aws-api',
  tool: 'gemini',
  transport: 'stdio',
  definition: { command: 'aws' },
  createdAt: '2026-03-11T00:00:00.000Z',
  updatedAt: '2026-03-11T00:00:00.000Z',
} as const;

function createCtx() {
  const webClient = {};
  return {
    config: {
      geminiMcpAuthServer: 'aws-api',
      noOutputTimeoutSec: 30,
      maxRuntimeSec: 600,
      maxConcurrency: 1,
    },
    sessionManager: {
      get: vi.fn(() => null),
      updateToolState: vi.fn(),
      mergeToolState: vi.fn(),
      setRunningJob: vi.fn(),
    },
    workdirManager: {
      prepareWorkdirForTool: vi.fn(),
      prepareWorkdirForToolWithPolicy: vi.fn(),
      prepareWorkdirSkillsOnly: vi.fn(),
    },
    mcpServerStore: {
      listByTool: vi.fn(() => [GEMINI_SERVER]),
    },
    sessionMcpServerStore: {
      listBySession: vi.fn(() => []),
    },
    pendingMcpAuthBypassApprovals: new Map(),
    auditStore: {
      logJobComplete: vi.fn(),
    },
    activeRunners: new Map(),
    switchPreflightBarriers: new Map(),
    webClient,
    app: { client: webClient },
    jobQueue: {
      enqueue: vi.fn(() => ({ position: 0 })),
    },
  } as const;
}

function createJob() {
  return {
    id: 'job_1',
    sessionKey: 'sess_1',
    channelId: 'C1',
    threadTs: '1.1',
    userId: 'U1',
    tool: 'gemini',
    mode: 'readonly',
    prompt: 'run this',
    workdir: '/tmp/workdir',
    toolState: {},
    toolStateOverrides: {},
    createdAt: Date.now(),
  };
}

function createJpc() {
  return {
    job: createJob(),
    runner: { id: 'runner' },
    env: { BASE: '1' },
    session: {
      toolState: {},
    },
    effectiveToolState: {},
    selectedMcpServers: [GEMINI_SERVER],
    messenger: {
      appendText: vi.fn(),
      postFinal: vi.fn().mockResolvedValue(undefined),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.isGeminiMcpPreflightBypassed.mockReturnValue(false);
  mocked.isGeminiMcpPreflightInitialized.mockReturnValue(false);
  mocked.prepareGeminiRuntimeHome.mockResolvedValue({
    homeDir: '/tmp/gemini-home',
    tokenAliasRepaired: false,
    tokenUrlNormalized: false,
    oauthDisabledForServer: false,
  });
  mocked.runGeminiMcpAuthPreflight.mockResolvedValue({
    ok: true,
    exitCode: 0,
    errorKind: null,
    events: [],
    requiredServer: null,
    interactiveFailure: false,
    oauthFlowStarted: false,
  });
  mocked.runGeminiInteractiveMcpAuth.mockResolvedValue({
    ok: true,
    exitCode: 0,
    errorKind: null,
    events: [],
    requiredServer: null,
    interactiveFailure: false,
    oauthFlowStarted: false,
    oauthUrl: null,
  });
});

describe('mcp-preflight-gemini additional coverage', () => {
  it('handles switch preflight early exits, success, and interactive fallback', async () => {
    const ctx = createCtx();

    await runGeminiSwitchPreflight(
      ctx as never,
      {} as never,
      'thread',
      'C1',
      '1.1',
      'U1',
      'sess_1',
    );

    (ctx.sessionManager.get as MockFn).mockReturnValue({
      tool: 'gemini',
      toolState: {},
      workdir: '/tmp/workdir',
    });
    mocked.isGeminiMcpPreflightBypassed.mockReturnValue(true);
    await runGeminiSwitchPreflight(
      ctx as never,
      {} as never,
      'thread',
      'C1',
      '1.1',
      'U1',
      'sess_1',
    );

    mocked.isGeminiMcpPreflightBypassed.mockReturnValue(false);
    await runGeminiSwitchPreflight(
      ctx as never,
      {} as never,
      'thread',
      'C1',
      '1.1',
      'U1',
      'sess_1',
    );

    mocked.runGeminiMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 42,
      errorKind: 'exit_42',
      events: [],
      requiredServer: 'aws-api',
      interactiveFailure: true,
      oauthFlowStarted: true,
    });
    mocked.runGeminiInteractiveMcpAuth.mockImplementationOnce(
      async (_runner, _env, _cwd, _server, onOAuthUrl) => {
        onOAuthUrl?.('https://oauth');
        return {
          ok: false,
          exitCode: 42,
          errorKind: 'exit_42',
          events: [],
          requiredServer: 'aws-api',
          interactiveFailure: true,
          oauthFlowStarted: true,
          oauthUrl: 'https://oauth',
        };
      },
    );
    await runGeminiSwitchPreflight(
      ctx as never,
      {} as never,
      'thread',
      'C1',
      '1.1',
      'U1',
      'sess_1',
    );

    expect(ctx.sessionManager.mergeToolState).toHaveBeenCalled();
    expect(mocked.postMessageWithContext).toHaveBeenCalled();
  });

  it('handles prepareGeminiJobRuntime success and failure', async () => {
    const ctx = createCtx();
    const job = createJob();

    const okEnv = await prepareGeminiJobRuntime(ctx as never, job as never, { BASE: '1' });
    expect(okEnv.GEMINI_CLI_HOME).toBe('/tmp/gemini-home');

    mocked.prepareGeminiRuntimeHome.mockRejectedValueOnce(new Error('home failed'));
    const failEnv = await prepareGeminiJobRuntime(ctx as never, job as never, { BASE: '2' });
    expect(failEnv).toEqual({ BASE: '2' });
    expect(mocked.loggerWarn).toHaveBeenCalled();
  });

  it('handles job preflight no-auth, success, and failure branches', async () => {
    const ctx = createCtx();
    const jpc = createJpc();

    (ctx.config as { geminiMcpAuthServer: string | null }).geminiMcpAuthServer = null;
    const noAuth = await runGeminiJobPreflight(ctx as never, jpc as never, 'thread', false);
    expect(noAuth.shouldReturn).toBe(false);

    (ctx.config as { geminiMcpAuthServer: string | null }).geminiMcpAuthServer = 'aws-api';
    const ok = await runGeminiJobPreflight(ctx as never, jpc as never, 'thread', false);
    expect(ok.shouldReturn).toBe(false);

    mocked.runGeminiMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 1,
      errorKind: 'exit_1',
      events: [],
      requiredServer: 'aws-api',
      interactiveFailure: true,
      oauthFlowStarted: true,
    });
    const rerunFail = await runGeminiJobPreflight(ctx as never, jpc as never, 'thread', true);
    expect(rerunFail.shouldReturn).toBe(true);
    expect(rerunFail.abortResult).toEqual(
      expect.objectContaining({
        exitCode: 1,
        errorKind: 'mcp_auth_required',
      }),
    );
    expect(mocked.formatGeminiMcpAuthLoopPreventionMessage).toHaveBeenCalled();

    mocked.runGeminiMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 2,
      errorKind: 'exit_2',
      events: [],
      requiredServer: 'aws-api',
      interactiveFailure: false,
      oauthFlowStarted: false,
    });
    mocked.postMessageWithContext.mockRejectedValueOnce(new Error('post failed'));
    const withApproval = await runGeminiJobPreflight(ctx as never, jpc as never, 'thread', false);
    expect(withApproval.shouldReturn).toBe(true);
    expect(ctx.pendingMcpAuthBypassApprovals.size).toBe(1);

    mocked.runGeminiMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 3,
      errorKind: 'exit_3',
      events: [],
      requiredServer: null,
      interactiveFailure: false,
      oauthFlowStarted: false,
    });
    const generic = await runGeminiJobPreflight(ctx as never, jpc as never, 'thread', false);
    expect(generic.shouldReturn).toBe(true);
    expect(generic.abortResult).toEqual(
      expect.objectContaining({
        exitCode: 3,
        errorKind: 'gemini_mcp_auth_preflight_failed',
      }),
    );
  });

  it('handles post-run loop prevention and interactive auth outcomes', async () => {
    const ctx = createCtx();

    await handleGeminiPostRunMcpAuth(
      ctx as never,
      {
        job: createJob(),
        threadKey: 'thread',
        mcpAuthRequiredServer: 'aws-api',
        mcpAuthRequiredResourceUrl: null,
      } as never,
      true,
    );
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'gemini_post_run_auth_loop_prevented',
      expect.any(Object),
    );

    mocked.prepareGeminiRuntimeHome.mockRejectedValueOnce(new Error('runtime home failed'));
    mocked.runGeminiInteractiveMcpAuth.mockImplementationOnce(
      async (_runner, _env, _cwd, _server, onOAuthUrl) => {
        onOAuthUrl?.('https://oauth-url');
        return {
          ok: true,
          exitCode: 0,
          errorKind: null,
          events: [],
          requiredServer: null,
          interactiveFailure: false,
          oauthFlowStarted: true,
          oauthUrl: 'https://oauth-url',
        };
      },
    );
    (ctx.sessionManager.get as MockFn).mockReturnValue({ tool: 'gemini', toolState: {} });
    (ctx.jobQueue.enqueue as MockFn)
      .mockReturnValueOnce({ error: 'queue down' })
      .mockReturnValueOnce({
        position: 2,
      });

    await handleGeminiPostRunMcpAuth(
      ctx as never,
      {
        job: createJob(),
        threadKey: 'thread',
        mcpAuthRequiredServer: 'aws-api',
        mcpAuthRequiredResourceUrl: null,
      } as never,
      false,
    );

    await handleGeminiPostRunMcpAuth(
      ctx as never,
      {
        job: createJob(),
        threadKey: 'thread',
        mcpAuthRequiredServer: 'aws-api',
        mcpAuthRequiredResourceUrl: null,
      } as never,
      false,
    );

    mocked.runGeminiInteractiveMcpAuth.mockResolvedValueOnce({
      ok: false,
      exitCode: 4,
      errorKind: 'exit_4',
      events: [],
      requiredServer: null,
      interactiveFailure: true,
      oauthFlowStarted: false,
      oauthUrl: null,
    });
    await handleGeminiPostRunMcpAuth(
      ctx as never,
      {
        job: createJob(),
        threadKey: 'thread',
        mcpAuthRequiredServer: 'aws-api',
        mcpAuthRequiredResourceUrl: null,
      } as never,
      false,
    );

    expect(mocked.postMessageWithContext).toHaveBeenCalled();
  });

  it('logs runtime-home details and runtime-home preparation failures in switch preflight', async () => {
    const ctx = createCtx();
    (ctx.sessionManager.get as MockFn).mockReturnValue({
      tool: 'gemini',
      toolState: {},
      workdir: '/tmp/workdir',
    });

    mocked.prepareGeminiRuntimeHome.mockResolvedValueOnce({
      homeDir: '/tmp/gemini-home',
      tokenAliasRepaired: true,
      tokenUrlNormalized: true,
      oauthDisabledForServer: true,
    });
    mocked.runGeminiMcpAuthPreflight.mockResolvedValueOnce({
      ok: true,
      exitCode: 0,
      errorKind: null,
      events: [],
      requiredServer: null,
      interactiveFailure: false,
      oauthFlowStarted: false,
    });

    await runGeminiSwitchPreflight(
      ctx as never,
      {} as never,
      'thread',
      'C1',
      '1.1',
      'U1',
      'sess_1',
    );
    expect(mocked.loggerInfo).toHaveBeenCalledWith(
      'gemini_runtime_home_prepared',
      expect.objectContaining({ session_key: 'sess_1' }),
    );

    mocked.prepareGeminiRuntimeHome.mockRejectedValueOnce(new Error('runtime-home-boom'));
    mocked.runGeminiMcpAuthPreflight.mockResolvedValueOnce({
      ok: true,
      exitCode: 0,
      errorKind: null,
      events: [],
      requiredServer: null,
      interactiveFailure: false,
      oauthFlowStarted: false,
    });

    await runGeminiSwitchPreflight(
      ctx as never,
      {} as never,
      'thread',
      'C1',
      '1.1',
      'U1',
      'sess_1',
    );
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'gemini_runtime_home_prepare_failed',
      expect.objectContaining({ session_key: 'sess_1' }),
    );
  });

  it('handles switch-preflight OAuth callback posting failures and requiredServer-only interactive trigger', async () => {
    const ctx = createCtx();
    (ctx.sessionManager.get as MockFn).mockReturnValue({
      tool: 'gemini',
      toolState: {},
      workdir: '/tmp/workdir',
    });

    mocked.runGeminiMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 11,
      errorKind: 'exit_11',
      events: [],
      requiredServer: 'aws-api',
      interactiveFailure: false,
      oauthFlowStarted: false,
    });
    mocked.runGeminiInteractiveMcpAuth.mockImplementationOnce(
      async (_runner, _env, _cwd, _server, onOAuthUrl) => {
        onOAuthUrl?.('https://oauth-switch');
        return {
          ok: false,
          exitCode: 11,
          errorKind: 'exit_11',
          events: [],
          requiredServer: 'aws-api',
          interactiveFailure: false,
          oauthFlowStarted: false,
          oauthUrl: null,
        };
      },
    );
    mocked.postMessageWithContext.mockImplementation(async (...args: unknown[]) => {
      const text = String(args[4] ?? '');
      if (text.startsWith('oauth:') || text.startsWith('waiting:')) {
        throw new Error('callback post failed');
      }
      return undefined;
    });

    await runGeminiSwitchPreflight(
      ctx as never,
      {} as never,
      'thread',
      'C1',
      '1.1',
      'U1',
      'sess_1',
    );

    expect(mocked.loggerError).toHaveBeenCalledWith(
      'gemini_switch_preflight_oauth_url_post_failed',
      expect.any(Object),
    );
    expect(mocked.loggerError).toHaveBeenCalledWith(
      'gemini_switch_preflight_waiting_post_failed',
      expect.any(Object),
    );
  });

  it('logs preflight runtime-home preparation details when aliases/url are changed', async () => {
    const ctx = createCtx();
    mocked.prepareGeminiRuntimeHome.mockResolvedValueOnce({
      homeDir: '/tmp/gemini-home',
      tokenAliasRepaired: true,
      tokenUrlNormalized: false,
      oauthDisabledForServer: false,
    });

    const env = await prepareGeminiJobRuntime(ctx as never, createJob() as never, { BASE: '1' });
    expect(env.GEMINI_CLI_HOME).toBe('/tmp/gemini-home');
    expect(mocked.loggerInfo).toHaveBeenCalledWith(
      'gemini_runtime_home_prepared',
      expect.objectContaining({ job_id: 'job_1' }),
    );
  });

  it('uses interactive failure message and logs loop-prevention post failures', async () => {
    const ctx = createCtx();
    const jpc = createJpc();

    mocked.runGeminiMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 12,
      errorKind: 'exit_12',
      events: [],
      requiredServer: null,
      interactiveFailure: true,
      oauthFlowStarted: false,
    });
    mocked.postMessageWithContext.mockRejectedValueOnce(new Error('loop message failed'));

    const result = await runGeminiJobPreflight(ctx as never, jpc as never, 'thread', true);
    expect(result.shouldReturn).toBe(true);
    expect(mocked.formatGeminiMcpAuthInteractiveFailureMessage).toHaveBeenCalledWith('aws-api');
    expect(mocked.loggerError).toHaveBeenCalledWith(
      'mcp_auth_loop_prevention_notice_failed',
      expect.any(Object),
    );
  });

  it('treats oauth-started non-zero exits as interactive auth required', async () => {
    const ctx = createCtx();
    const jpc = createJpc();
    mocked.runGeminiMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 17,
      errorKind: 'exit_17',
      events: [],
      requiredServer: null,
      interactiveFailure: false,
      oauthFlowStarted: true,
    });

    const result = await runGeminiJobPreflight(ctx as never, jpc as never, 'thread', false);
    expect(result.shouldReturn).toBe(true);
    expect(mocked.formatGeminiMcpAuthInteractiveFailureMessage).toHaveBeenCalledWith('aws-api');
  });

  it('posts bypass prompt successfully for interactive-required failures', async () => {
    const ctx = createCtx();
    const jpc = createJpc();
    mocked.runGeminiMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 18,
      errorKind: 'exit_18',
      events: [],
      requiredServer: 'aws-api',
      interactiveFailure: false,
      oauthFlowStarted: false,
    });
    mocked.postMessageWithContext.mockResolvedValueOnce(undefined);

    const result = await runGeminiJobPreflight(ctx as never, jpc as never, 'thread', false);
    expect(result.shouldReturn).toBe(true);
    expect(mocked.formatGeminiMcpAuthBypassPrompt).toHaveBeenCalled();
  });

  it('logs post-run OAuth callback posting failures', async () => {
    const ctx = createCtx();
    (ctx.sessionManager.get as MockFn).mockReturnValue({ tool: 'gemini', toolState: {} });
    (ctx.jobQueue.enqueue as MockFn).mockReturnValue({ position: 0 });

    mocked.runGeminiInteractiveMcpAuth.mockImplementationOnce(
      async (_runner, _env, _cwd, _server, onOAuthUrl) => {
        onOAuthUrl?.('https://oauth-postrun');
        return {
          ok: true,
          exitCode: 0,
          errorKind: null,
          events: [],
          requiredServer: null,
          interactiveFailure: false,
          oauthFlowStarted: true,
          oauthUrl: 'https://oauth-postrun',
        };
      },
    );
    mocked.postMessageWithContext.mockImplementation(async (...args: unknown[]) => {
      const text = String(args[4] ?? '');
      if (text.startsWith('oauth:') || text.startsWith('waiting:')) {
        throw new Error('postrun callback fail');
      }
      return undefined;
    });

    await handleGeminiPostRunMcpAuth(
      ctx as never,
      {
        job: createJob(),
        threadKey: 'thread',
        mcpAuthRequiredServer: 'aws-api',
        mcpAuthRequiredResourceUrl: null,
      } as never,
      false,
    );

    expect(mocked.loggerError).toHaveBeenCalledWith(
      'gemini_post_run_oauth_url_post_failed',
      expect.any(Object),
    );
    expect(mocked.loggerError).toHaveBeenCalledWith(
      'gemini_post_run_waiting_post_failed',
      expect.any(Object),
    );
  });

  it('falls back to postMessageWithContext when pendingApproval is not found after set', async () => {
    const ctx = createCtx();
    const jpc = createJpc();

    // Replace pendingMcpAuthBypassApprovals with a Map whose get() always returns undefined
    // This simulates an ExpiringMap that evicts the entry immediately after set
    const fakeMap = new Map();
    const originalSet = fakeMap.set.bind(fakeMap);
    fakeMap.set = (...args: [string, unknown]) => {
      originalSet(...args);
      // Immediately delete so that .get() returns undefined
      fakeMap.delete(args[0]);
      return fakeMap;
    };
    (ctx as Record<string, unknown>).pendingMcpAuthBypassApprovals = fakeMap;

    mocked.runGeminiMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 20,
      errorKind: 'exit_20',
      events: [],
      requiredServer: 'aws-api',
      interactiveFailure: false,
      oauthFlowStarted: false,
    });
    mocked.postMessageWithContext.mockResolvedValueOnce(undefined);

    const result = await runGeminiJobPreflight(ctx as never, jpc as never, 'thread', false);
    expect(result.shouldReturn).toBe(true);
    // The else branch calls postMessageWithContext directly (not postMessageWithBlocks)
    expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
      ctx,
      ctx.webClient,
      jpc.job.channelId,
      jpc.job.threadTs,
      'gemini bypass prompt',
      expect.objectContaining({ sessionKey: jpc.job.sessionKey }),
    );
  });

  it('uses aws-api default when both required and configured auth server are null', async () => {
    const ctx = createCtx();
    (ctx.config as { geminiMcpAuthServer: string | null }).geminiMcpAuthServer = null;

    await handleGeminiPostRunMcpAuth(
      ctx as never,
      {
        job: createJob(),
        threadKey: 'thread',
        mcpAuthRequiredServer: null,
        mcpAuthRequiredResourceUrl: null,
      } as never,
      true,
    );

    expect(String(mocked.postMessageWithContext.mock.calls.at(-1)?.[4] ?? '')).toContain(
      '/mcp auth aws-api',
    );
  });
});
