import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  postMessageWithContext: vi.fn().mockResolvedValue(undefined),
  postMessageWithBlocks: vi.fn().mockResolvedValue(undefined),
  scheduleExpiry: vi.fn(),
  runClaudeMcpAuthPreflight: vi.fn(),
  isClaudeMcpPreflightBypassed: vi.fn(() => false),
  isClaudeMcpPreflightVerified: vi.fn(() => false),
  markClaudeMcpPreflightVerified: vi.fn((state: Record<string, unknown>, server: string) => ({
    ...state,
    claude_mcp_auth_verified_server: server,
  })),
  formatClaudeMcpApprovalPrompt: vi.fn(() => 'approval prompt'),
  formatClaudeMcpAuthRequiredMessage: vi.fn((server: string) => `required:${server}`),
  formatClaudeMcpAuthGenericFailureMessage: vi.fn(() => 'generic failure'),
  formatClaudeMcpAuthLoopPreventionMessage: vi.fn(() => 'loop prevention'),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  buildEnv: vi.fn(() => ({ CLAUDE: '1' })),
  RunnerCtor: vi.fn(() => ({ tag: 'runner' })),
  removeClaudeGeneratedMcpConfig: vi.fn(),
  writeClaudeMcpConfigToWorkdir: vi.fn(() => '/tmp/workdir/.huskygate/claude.mcp.json'),
}));

vi.mock('./app-helpers.js', () => ({
  MCP_AUTH_BYPASS_TIMEOUT_MS: 120_000,
  postMessageWithContext: mocked.postMessageWithContext,
  postMessageWithBlocks: mocked.postMessageWithBlocks,
  scheduleExpiry: mocked.scheduleExpiry,
}));

vi.mock('./tools/claude.js', () => ({
  CLAUDE_MCP_AUTH_BYPASS_SERVER_KEY: 'claude_mcp_auth_bypass_server',
  CLAUDE_MCP_AUTH_VERIFIED_SERVER_KEY: 'claude_mcp_auth_verified_server',
  formatClaudeMcpApprovalPrompt: mocked.formatClaudeMcpApprovalPrompt,
  formatClaudeMcpAuthGenericFailureMessage: mocked.formatClaudeMcpAuthGenericFailureMessage,
  formatClaudeMcpAuthLoopPreventionMessage: mocked.formatClaudeMcpAuthLoopPreventionMessage,
  formatClaudeMcpAuthRequiredMessage: mocked.formatClaudeMcpAuthRequiredMessage,
  isClaudeMcpPreflightBypassed: mocked.isClaudeMcpPreflightBypassed,
  isClaudeMcpPreflightVerified: mocked.isClaudeMcpPreflightVerified,
  markClaudeMcpPreflightVerified: mocked.markClaudeMcpPreflightVerified,
  runClaudeMcpAuthPreflight: mocked.runClaudeMcpAuthPreflight,
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: mocked.loggerInfo,
    error: mocked.loggerError,
    warn: vi.fn(),
  },
}));

vi.mock('../runner/driver-claude.js', () => ({
  ClaudeDriver: vi.fn().mockImplementation(() => ({
    buildEnv: mocked.buildEnv,
  })),
}));

vi.mock('../runner/runner.js', () => ({
  Runner: mocked.RunnerCtor,
}));

vi.mock('../workdir/mcp-writer.js', () => ({
  removeClaudeGeneratedMcpConfig: mocked.removeClaudeGeneratedMcpConfig,
  writeClaudeMcpConfigToWorkdir: mocked.writeClaudeMcpConfigToWorkdir,
}));

import {
  handleClaudePostRunMcpAuth,
  runClaudeJobPreflight,
  runClaudeSwitchPreflight,
} from './mcp-preflight-claude.js';

type MockFn = ReturnType<typeof vi.fn>;
const CLAUDE_SERVER = {
  id: 'srv_aws',
  name: 'aws-api',
  tool: 'claude',
  transport: 'stdio',
  definition: { command: 'aws' },
  createdAt: '2026-03-11T00:00:00.000Z',
  updatedAt: '2026-03-11T00:00:00.000Z',
} as const;

function createCtx() {
  const webClient = {};
  return {
    config: {
      claudeMcpAuthServer: 'aws-api',
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
      listByTool: vi.fn(() => [CLAUDE_SERVER]),
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
    app: {
      client: webClient,
    },
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
    tool: 'claude',
    mode: 'readonly',
    prompt: 'run this',
    workdir: '/tmp/workdir',
    toolState: {},
    toolStateOverrides: {},
    createdAt: Date.now(),
  };
}

function createJobPreflightContext() {
  return {
    job: createJob(),
    runner: { id: 'runner' },
    env: { BASE: '1' },
    session: {
      toolState: {},
    },
    effectiveToolState: {},
    selectedMcpServers: [CLAUDE_SERVER],
    messenger: {
      appendText: vi.fn(),
      postFinal: vi.fn().mockResolvedValue(undefined),
    },
    claudeSessionIdPreStored: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.postMessageWithContext.mockReset();
  mocked.postMessageWithContext.mockResolvedValue(undefined);
  mocked.postMessageWithBlocks.mockReset();
  mocked.postMessageWithBlocks.mockResolvedValue(undefined);
  mocked.removeClaudeGeneratedMcpConfig.mockReset();
  mocked.writeClaudeMcpConfigToWorkdir.mockReturnValue('/tmp/workdir/.huskygate/claude.mcp.json');
  mocked.isClaudeMcpPreflightBypassed.mockReturnValue(false);
  mocked.isClaudeMcpPreflightVerified.mockReturnValue(false);
  mocked.runClaudeMcpAuthPreflight.mockResolvedValue({
    ok: true,
    exitCode: 0,
    errorKind: null,
    events: [],
    requiredServer: null,
    interactiveFailure: false,
    tokenRefreshFailed: false,
  });
});

describe('mcp-preflight-claude additional coverage', () => {
  it('handles switch preflight early exits and success', async () => {
    const ctx = createCtx();
    await runClaudeSwitchPreflight(
      ctx as never,
      {} as never,
      'thread',
      'C1',
      '1.1',
      'U1',
      'sess_1',
    );

    (ctx.sessionManager.get as MockFn).mockReturnValue({
      tool: 'claude',
      toolState: {},
      workdir: '/tmp/workdir',
    });
    mocked.isClaudeMcpPreflightBypassed.mockReturnValue(true);
    await runClaudeSwitchPreflight(
      ctx as never,
      {} as never,
      'thread',
      'C1',
      '1.1',
      'U1',
      'sess_1',
    );

    mocked.isClaudeMcpPreflightBypassed.mockReturnValue(false);
    mocked.isClaudeMcpPreflightVerified.mockReturnValue(true);
    await runClaudeSwitchPreflight(
      ctx as never,
      {} as never,
      'thread',
      'C1',
      '1.1',
      'U1',
      'sess_1',
    );

    mocked.isClaudeMcpPreflightVerified.mockReturnValue(false);
    await runClaudeSwitchPreflight(
      ctx as never,
      {} as never,
      'thread',
      'C1',
      '1.1',
      'U1',
      'sess_1',
    );

    expect(ctx.workdirManager.prepareWorkdirSkillsOnly).toHaveBeenCalled();
    expect(ctx.sessionManager.mergeToolState).toHaveBeenCalled();
    expect(mocked.postMessageWithContext).toHaveBeenCalled();
    expect(mocked.removeClaudeGeneratedMcpConfig).toHaveBeenCalledWith(
      '/tmp/workdir/.huskygate/claude.mcp.json',
    );
  });

  it('handles switch preflight failure paths (required and generic)', async () => {
    const ctx = createCtx();
    (ctx.sessionManager.get as MockFn).mockReturnValue({
      tool: 'claude',
      toolState: {},
      workdir: '/tmp/workdir',
    });

    mocked.runClaudeMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 1,
      errorKind: 'exit_1',
      events: [],
      requiredServer: 'aws-api',
      interactiveFailure: false,
      tokenRefreshFailed: false,
    });
    await runClaudeSwitchPreflight(
      ctx as never,
      {} as never,
      'thread',
      'C1',
      '1.1',
      'U1',
      'sess_1',
    );
    expect(ctx.pendingMcpAuthBypassApprovals.size).toBe(1);

    mocked.runClaudeMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 2,
      errorKind: 'exit_2',
      events: [],
      requiredServer: null,
      interactiveFailure: false,
      tokenRefreshFailed: false,
    });
    await runClaudeSwitchPreflight(
      ctx as never,
      {} as never,
      'thread',
      'C1',
      '1.1',
      'U1',
      'sess_1',
    );
    expect(String(mocked.postMessageWithContext.mock.calls.at(-1)?.[4] ?? '')).toContain(
      'generic failure',
    );
  });

  it('uses configured server in required message and fallback prompt when pending approval is missing', async () => {
    const ctx = createCtx();
    (ctx.sessionManager.get as MockFn).mockReturnValue({
      tool: 'claude',
      toolState: {},
      workdir: '/tmp/workdir',
    });
    const pendingStore = {
      set: vi.fn(),
      get: vi.fn(() => undefined),
      delete: vi.fn(),
    };
    (ctx as unknown as { pendingMcpAuthBypassApprovals: unknown }).pendingMcpAuthBypassApprovals =
      pendingStore as never;

    mocked.runClaudeMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 1,
      errorKind: 'exit_1',
      events: [],
      requiredServer: null,
      interactiveFailure: true,
      tokenRefreshFailed: false,
    });

    await runClaudeSwitchPreflight(
      ctx as never,
      {} as never,
      'thread',
      'C1',
      '1.1',
      'U1',
      'sess_1',
    );
    const posted = mocked.postMessageWithContext.mock.calls.map((call) => String(call[4] ?? ''));
    expect(posted.some((text) => text.includes('required:aws-api'))).toBe(true);
    expect(posted.some((text) => text.includes('approval request failed to initialize'))).toBe(
      true,
    );
  });

  it('handles job preflight no-auth and success paths', async () => {
    const ctx = createCtx();
    (ctx.config as { claudeMcpAuthServer: string | null }).claudeMcpAuthServer = null;
    const jpc = createJobPreflightContext();

    const noAuth = await runClaudeJobPreflight(ctx as never, jpc as never, 'thread', false);
    expect(noAuth.shouldReturn).toBe(false);

    (ctx.config as { claudeMcpAuthServer: string | null }).claudeMcpAuthServer = 'aws-api';
    const ok = await runClaudeJobPreflight(ctx as never, jpc as never, 'thread', false);
    expect(ok.shouldReturn).toBe(false);
    expect(jpc.messenger.appendText).toHaveBeenCalled();
    expect(ctx.sessionManager.mergeToolState).toHaveBeenCalledWith(
      'sess_1',
      expect.objectContaining({
        claude_mcp_auth_verified_server: 'aws-api',
      }),
    );
    expect(ctx.sessionManager.updateToolState).not.toHaveBeenCalled();
    expect(mocked.removeClaudeGeneratedMcpConfig).toHaveBeenCalledWith(
      '/tmp/workdir/.huskygate/claude.mcp.json',
    );
  });

  it('handles job preflight failure with approval rerun loop prevention', async () => {
    const ctx = createCtx();
    const jpc = createJobPreflightContext();

    mocked.runClaudeMcpAuthPreflight.mockResolvedValue({
      ok: false,
      exitCode: 1,
      errorKind: 'exit_1',
      events: [],
      requiredServer: 'aws-api',
      interactiveFailure: true,
      tokenRefreshFailed: false,
    });

    const out = await runClaudeJobPreflight(ctx as never, jpc as never, 'thread', true);
    expect(out.shouldReturn).toBe(true);
    expect(out.abortResult).toEqual(
      expect.objectContaining({
        exitCode: 1,
        errorKind: 'mcp_auth_required',
      }),
    );
    expect(mocked.formatClaudeMcpAuthLoopPreventionMessage).toHaveBeenCalled();
  });

  it('suppresses repeated Claude approval prompts after session approval completed', async () => {
    const ctx = createCtx();
    const jpc = createJobPreflightContext();
    jpc.session.toolState = { claude_mcp_auth_approval_completed: true };

    mocked.runClaudeMcpAuthPreflight.mockResolvedValue({
      ok: false,
      exitCode: 1,
      errorKind: 'exit_1',
      events: [],
      requiredServer: 'aws-api',
      interactiveFailure: true,
      tokenRefreshFailed: false,
    });

    const out = await runClaudeJobPreflight(ctx as never, jpc as never, 'thread', false);
    expect(out.shouldReturn).toBe(true);
    expect(mocked.formatClaudeMcpAuthLoopPreventionMessage).toHaveBeenCalled();
    expect(ctx.pendingMcpAuthBypassApprovals.size).toBe(0);
  });

  it('logs loop-prevention post failure on approval rerun', async () => {
    const ctx = createCtx();
    const jpc = createJobPreflightContext();
    mocked.runClaudeMcpAuthPreflight.mockResolvedValue({
      ok: false,
      exitCode: 1,
      errorKind: 'exit_1',
      events: [],
      requiredServer: 'aws-api',
      interactiveFailure: true,
      tokenRefreshFailed: false,
    });
    mocked.postMessageWithContext.mockRejectedValueOnce(new Error('post failed'));

    const out = await runClaudeJobPreflight(ctx as never, jpc as never, 'thread', true);
    expect(out.shouldReturn).toBe(true);
    expect(mocked.loggerError).toHaveBeenCalled();
  });

  it('handles job preflight failure with bypass approval request and post failure logging', async () => {
    const ctx = createCtx();
    const jpc = createJobPreflightContext();

    mocked.runClaudeMcpAuthPreflight.mockResolvedValue({
      ok: false,
      exitCode: 1,
      errorKind: 'exit_1',
      events: [],
      requiredServer: 'aws-api',
      interactiveFailure: false,
      tokenRefreshFailed: true,
    });
    mocked.postMessageWithBlocks.mockRejectedValueOnce(new Error('post failed'));

    const out = await runClaudeJobPreflight(ctx as never, jpc as never, 'thread', false);
    expect(out.shouldReturn).toBe(true);
    expect(ctx.pendingMcpAuthBypassApprovals.size).toBe(1);
    expect(mocked.loggerError).toHaveBeenCalled();
  });

  it('posts approval blocks when bypass approval entry is available', async () => {
    const ctx = createCtx();
    const jpc = createJobPreflightContext();

    mocked.runClaudeMcpAuthPreflight.mockResolvedValue({
      ok: false,
      exitCode: 1,
      errorKind: 'exit_1',
      events: [],
      requiredServer: 'aws-api',
      interactiveFailure: false,
      tokenRefreshFailed: false,
    });

    const out = await runClaudeJobPreflight(ctx as never, jpc as never, 'thread', false);
    expect(out.shouldReturn).toBe(true);
    expect(mocked.postMessageWithBlocks).toHaveBeenCalled();
  });

  it('uses fallback approval text when pending bypass approval lookup returns undefined', async () => {
    const ctx = createCtx();
    const jpc = createJobPreflightContext();
    const pendingStore = {
      set: vi.fn(),
      get: vi.fn(() => undefined),
      delete: vi.fn(),
    };
    (ctx as unknown as { pendingMcpAuthBypassApprovals: unknown }).pendingMcpAuthBypassApprovals =
      pendingStore as never;

    mocked.runClaudeMcpAuthPreflight.mockResolvedValue({
      ok: false,
      exitCode: 1,
      errorKind: 'exit_1',
      events: [],
      requiredServer: 'aws-api',
      interactiveFailure: false,
      tokenRefreshFailed: true,
    });

    const out = await runClaudeJobPreflight(ctx as never, jpc as never, 'thread', false);
    expect(out.shouldReturn).toBe(true);
    const posted = mocked.postMessageWithContext.mock.calls.map((call) => String(call[4] ?? ''));
    expect(posted.some((text) => text.includes('approval request failed to initialize'))).toBe(
      true,
    );
  });

  it('posts fallback text when pending approval cannot be retrieved after set', async () => {
    const ctx = createCtx();
    const jpc = createJobPreflightContext();
    const pendingStore = {
      set: vi.fn().mockImplementation(() => pendingStore),
      get: vi.fn(() => undefined),
      delete: vi.fn(),
    };
    (ctx as unknown as { pendingMcpAuthBypassApprovals: unknown }).pendingMcpAuthBypassApprovals =
      pendingStore as never;

    mocked.runClaudeMcpAuthPreflight.mockResolvedValue({
      ok: false,
      exitCode: 1,
      errorKind: 'exit_1',
      events: [],
      requiredServer: 'aws-api',
      interactiveFailure: false,
      tokenRefreshFailed: false,
    });

    const out = await runClaudeJobPreflight(ctx as never, jpc as never, 'thread', false);
    expect(out.shouldReturn).toBe(true);

    const posted = mocked.postMessageWithContext.mock.calls.map((call) => String(call[4] ?? ''));
    expect(posted).toContain('Claude MCP auth approval request failed to initialize.');
  });

  it('handles job preflight generic failure without bypass prompt', async () => {
    const ctx = createCtx();
    const jpc = createJobPreflightContext();

    mocked.runClaudeMcpAuthPreflight.mockResolvedValue({
      ok: false,
      exitCode: 2,
      errorKind: 'exit_2',
      events: [],
      requiredServer: null,
      interactiveFailure: false,
      tokenRefreshFailed: false,
    });

    const out = await runClaudeJobPreflight(ctx as never, jpc as never, 'thread', false);
    expect(out.shouldReturn).toBe(true);
    expect(ctx.pendingMcpAuthBypassApprovals.size).toBe(0);
  });

  it('handles post-run path for auto-rerun success and enqueue branches', async () => {
    const ctx = createCtx();
    (ctx.sessionManager.get as MockFn).mockReturnValue({ toolState: {} });
    (ctx.jobQueue.enqueue as MockFn)
      .mockReturnValueOnce({ error: 'queue down' })
      .mockReturnValueOnce({ position: 2 })
      .mockReturnValueOnce({ position: 0 });

    for (let i = 0; i < 3; i++) {
      mocked.runClaudeMcpAuthPreflight.mockResolvedValueOnce({
        ok: true,
        exitCode: 0,
        errorKind: null,
        events: [],
        requiredServer: null,
        interactiveFailure: false,
        tokenRefreshFailed: false,
      });
      const out = await handleClaudePostRunMcpAuth(
        ctx as never,
        {
          job: createJob(),
          threadKey: 'thread',
          mcpAuthRequiredServer: 'aws-api',
          mcpAuthRequiredResourceUrl: null,
        } as never,
        false,
      );
      expect(out.autoRerunScheduled).toBe(true);
    }
  });

  it('handles post-run failure and rerun-shortcircuit message', async () => {
    const ctx = createCtx();

    mocked.runClaudeMcpAuthPreflight.mockResolvedValue({
      ok: false,
      exitCode: 3,
      errorKind: 'exit_3',
      events: [],
      requiredServer: null,
      interactiveFailure: false,
      tokenRefreshFailed: false,
    });

    const failed = await handleClaudePostRunMcpAuth(
      ctx as never,
      {
        job: createJob(),
        threadKey: 'thread',
        mcpAuthRequiredServer: 'aws-api',
        mcpAuthRequiredResourceUrl: null,
      } as never,
      false,
    );
    expect(failed).toEqual({ autoRerunScheduled: false, autoAuthFailureReported: true });

    const rerun = await handleClaudePostRunMcpAuth(
      ctx as never,
      {
        job: createJob(),
        threadKey: 'thread',
        mcpAuthRequiredServer: 'aws-api',
        mcpAuthRequiredResourceUrl: null,
      } as never,
      true,
    );
    expect(rerun).toEqual({ autoRerunScheduled: false, autoAuthFailureReported: false });
    expect(mocked.formatClaudeMcpAuthRequiredMessage).toHaveBeenCalled();
  });

  it('uses authServer fallback in required failure message when preflight server is missing', async () => {
    const ctx = createCtx();
    const jpc = createJobPreflightContext();
    mocked.runClaudeMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 9,
      errorKind: 'exit_9',
      events: [],
      requiredServer: null,
      interactiveFailure: true,
      tokenRefreshFailed: false,
    });

    const out = await runClaudeJobPreflight(ctx as never, jpc as never, 'thread', false);
    expect(out.shouldReturn).toBe(true);
    expect(mocked.formatClaudeMcpAuthRequiredMessage).toHaveBeenCalledWith('aws-api');
  });

  it('uses hardcoded aws-api default when both required and configured auth server are null', async () => {
    const ctx = createCtx();
    (ctx.config as { claudeMcpAuthServer: string | null }).claudeMcpAuthServer = null;

    await handleClaudePostRunMcpAuth(
      ctx as never,
      {
        job: createJob(),
        threadKey: 'thread',
        mcpAuthRequiredServer: null,
        mcpAuthRequiredResourceUrl: null,
      } as never,
      true,
    );

    expect(mocked.formatClaudeMcpAuthRequiredMessage).toHaveBeenCalledWith('aws-api');
  });

  it('creates auto-rerun overrides when original job has no toolStateOverrides', async () => {
    const ctx = createCtx();
    (ctx.sessionManager.get as MockFn).mockReturnValue({ toolState: {} });
    mocked.runClaudeMcpAuthPreflight.mockResolvedValueOnce({
      ok: true,
      exitCode: 0,
      errorKind: null,
      events: [],
      requiredServer: null,
      interactiveFailure: false,
      tokenRefreshFailed: false,
    });

    const job = { ...createJob(), toolStateOverrides: undefined };
    const out = await handleClaudePostRunMcpAuth(
      ctx as never,
      {
        job,
        threadKey: 'thread',
        mcpAuthRequiredServer: 'aws-api',
        mcpAuthRequiredResourceUrl: null,
      } as never,
      false,
    );

    expect(out.autoRerunScheduled).toBe(true);
    const retryJob = (ctx.jobQueue.enqueue as MockFn).mock.calls.at(-1)?.[0] as {
      toolStateOverrides?: Record<string, unknown>;
    };
    expect(retryJob.toolStateOverrides?.claude_mcp_auth_auto_rerun).toBe(true);
    expect(retryJob.toolStateOverrides?.claude_skip_mcp_preflight_once).toBe(true);
  });
});
