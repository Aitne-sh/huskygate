import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  postMessageWithContext: vi.fn().mockResolvedValue(undefined),
  prepareCodexRuntimeHome: vi.fn().mockResolvedValue({
    homeDir: '/tmp/workdir/.codex_runtime_home',
    seededFiles: ['config.toml'],
  }),
  runCodexMcpAuthPreflight: vi.fn(),
  runCodexMcpList: vi.fn(),
  selectCodexMcpAuthServer: vi.fn((): string | null => 'aws-api'),
  isCodexMcpServerAuthUnsupported: vi.fn(() => false),
  isCodexMcpPreflightVerified: vi.fn(() => false),
  markCodexMcpPreflightVerified: vi.fn((state: Record<string, unknown>, server: string) => ({
    ...state,
    codex_mcp_auth_verified_server: server,
  })),
  formatCodexMcpAuthRequiredMessage: vi.fn((server: string, url?: string | null) =>
    url ? `required:${server}:${url}` : `required:${server}`,
  ),
  formatCodexMcpAuthGenericFailureMessage: vi.fn(() => 'codex generic failure'),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  buildEnv: vi.fn(() => ({ CODEX: '1' })),
  RunnerCtor: vi.fn(() => ({ tag: 'runner' })),
}));

vi.mock('./app-helpers.js', () => ({
  postMessageWithContext: mocked.postMessageWithContext,
}));

vi.mock('./tools/codex.js', () => ({
  CODEX_MCP_AUTH_VERIFIED_SERVER_KEY: 'codex_mcp_auth_verified_server',
  formatCodexMcpAuthGenericFailureMessage: mocked.formatCodexMcpAuthGenericFailureMessage,
  formatCodexMcpAuthRequiredMessage: mocked.formatCodexMcpAuthRequiredMessage,
  isCodexMcpPreflightVerified: mocked.isCodexMcpPreflightVerified,
  isCodexMcpServerAuthUnsupported: mocked.isCodexMcpServerAuthUnsupported,
  markCodexMcpPreflightVerified: mocked.markCodexMcpPreflightVerified,
  runCodexMcpAuthPreflight: mocked.runCodexMcpAuthPreflight,
  runCodexMcpList: mocked.runCodexMcpList,
  selectCodexMcpAuthServer: mocked.selectCodexMcpAuthServer,
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: mocked.loggerInfo,
    error: mocked.loggerError,
    warn: vi.fn(),
  },
}));

vi.mock('../runner/driver-codex.js', () => ({
  CodexDriver: vi.fn().mockImplementation(() => ({
    buildEnv: mocked.buildEnv,
  })),
}));

vi.mock('../runner/codex-runtime-home.js', () => ({
  prepareCodexRuntimeHome: mocked.prepareCodexRuntimeHome,
}));

vi.mock('../runner/runner.js', () => ({
  Runner: mocked.RunnerCtor,
}));

import {
  handleCodexPostRunMcpAuth,
  runCodexJobPreflight,
  runCodexSwitchPreflight,
} from './mcp-preflight-codex.js';

type MockFn = ReturnType<typeof vi.fn>;
const CODEX_SERVER = {
  id: 'srv_aws',
  name: 'aws-api',
  tool: 'codex',
  transport: 'http',
  definition: { url: 'https://example.test/mcp' },
  createdAt: '2026-03-11T00:00:00.000Z',
  updatedAt: '2026-03-11T00:00:00.000Z',
} as const;

function createCtx() {
  const webClient = {};
  return {
    config: {
      codexMcpAuthServer: 'aws-api',
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
      listByTool: vi.fn(() => [CODEX_SERVER]),
    },
    sessionMcpServerStore: {
      listBySession: vi.fn(() => []),
    },
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
    tool: 'codex',
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
    selectedMcpServers: [CODEX_SERVER],
    messenger: {
      appendText: vi.fn(),
      postFinal: vi.fn().mockResolvedValue(undefined),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.isCodexMcpPreflightVerified.mockReturnValue(false);
  mocked.selectCodexMcpAuthServer.mockReturnValue('aws-api');
  mocked.isCodexMcpServerAuthUnsupported.mockReturnValue(false);
  mocked.runCodexMcpList.mockResolvedValue({ serverNames: ['aws-api'] });
  mocked.runCodexMcpAuthPreflight.mockResolvedValue({
    ok: true,
    exitCode: 0,
    errorKind: null,
    events: [],
    requiredServer: null,
    requiredResourceUrl: null,
  });
});

describe('mcp-preflight-codex additional coverage', () => {
  it('handles switch preflight early exits and success', async () => {
    const ctx = createCtx();

    await runCodexSwitchPreflight(ctx as never, {} as never, 'C1', '1.1', 'sess_1');

    (ctx.sessionManager.get as MockFn).mockReturnValue({
      tool: 'codex',
      toolState: {},
      workdir: '/tmp/workdir',
    });
    mocked.isCodexMcpPreflightVerified.mockReturnValue(true);
    await runCodexSwitchPreflight(ctx as never, {} as never, 'C1', '1.1', 'sess_1');

    mocked.isCodexMcpPreflightVerified.mockReturnValue(false);
    await runCodexSwitchPreflight(ctx as never, {} as never, 'C1', '1.1', 'sess_1');

    expect(ctx.sessionManager.mergeToolState).toHaveBeenCalled();
    expect(mocked.postMessageWithContext).toHaveBeenCalled();
  });

  it('handles switch preflight failure required and generic messages', async () => {
    const ctx = createCtx();
    (ctx.sessionManager.get as MockFn).mockReturnValue({
      tool: 'codex',
      toolState: {},
      workdir: '/tmp/workdir',
    });

    mocked.runCodexMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 1,
      errorKind: 'exit_1',
      events: [],
      requiredServer: 'aws-api',
      requiredResourceUrl: 'https://auth',
    });
    await runCodexSwitchPreflight(ctx as never, {} as never, 'C1', '1.1', 'sess_1');
    expect(String(mocked.postMessageWithContext.mock.calls.at(-1)?.[4] ?? '')).toContain(
      'required',
    );

    mocked.runCodexMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 2,
      errorKind: 'exit_2',
      events: [],
      requiredServer: null,
      requiredResourceUrl: null,
    });
    await runCodexSwitchPreflight(ctx as never, {} as never, 'C1', '1.1', 'sess_1');
    expect(String(mocked.postMessageWithContext.mock.calls.at(-1)?.[4] ?? '')).toContain(
      'codex generic failure',
    );
  });

  it('uses configured authServer when requiredResourceUrl exists but requiredServer is null', async () => {
    const ctx = createCtx();
    (ctx.sessionManager.get as MockFn).mockReturnValue({
      tool: 'codex',
      toolState: {},
      workdir: '/tmp/workdir',
    });
    mocked.runCodexMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 9,
      errorKind: 'exit_9',
      events: [],
      requiredServer: null,
      requiredResourceUrl: 'https://auth.example/resource',
    });

    await runCodexSwitchPreflight(ctx as never, {} as never, 'C1', '1.1', 'sess_1');
    expect(mocked.formatCodexMcpAuthRequiredMessage).toHaveBeenCalledWith(
      'aws-api',
      'https://auth.example/resource',
    );
  });

  it('handles job preflight no-auth, success, and failure branches', async () => {
    const ctx = createCtx();
    const jpc = createJobPreflightContext();

    (ctx.config as { codexMcpAuthServer: string | null }).codexMcpAuthServer = null;
    const noAuth = await runCodexJobPreflight(ctx as never, jpc as never, 'thread');
    expect(noAuth.shouldReturn).toBe(false);

    (ctx.config as { codexMcpAuthServer: string | null }).codexMcpAuthServer = 'aws-api';
    const ok = await runCodexJobPreflight(ctx as never, jpc as never, 'thread');
    expect(ok.shouldReturn).toBe(false);

    mocked.runCodexMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 1,
      errorKind: 'exit_1',
      events: [],
      requiredServer: 'aws-api',
      requiredResourceUrl: null,
    });
    const requiredFail = await runCodexJobPreflight(ctx as never, jpc as never, 'thread');
    expect(requiredFail.shouldReturn).toBe(true);
    expect(requiredFail.abortResult).toEqual(
      expect.objectContaining({
        exitCode: 1,
        errorKind: 'mcp_auth_required',
      }),
    );

    mocked.runCodexMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 2,
      errorKind: 'exit_2',
      events: [],
      requiredServer: null,
      requiredResourceUrl: null,
    });
    const genericFail = await runCodexJobPreflight(ctx as never, jpc as never, 'thread');
    expect(genericFail.shouldReturn).toBe(true);
    expect(genericFail.abortResult).toEqual(
      expect.objectContaining({
        exitCode: 2,
        errorKind: 'codex_mcp_auth_preflight_failed',
      }),
    );
  });

  it('uses configured authServer in job preflight required message when requiredServer is null', async () => {
    const ctx = createCtx();
    const jpc = createJobPreflightContext();
    mocked.runCodexMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 7,
      errorKind: 'exit_7',
      events: [],
      requiredServer: null,
      requiredResourceUrl: 'https://auth.example/resource',
    });

    const out = await runCodexJobPreflight(ctx as never, jpc as never, 'thread');
    expect(out.shouldReturn).toBe(true);
    expect(mocked.formatCodexMcpAuthRequiredMessage).toHaveBeenCalledWith(
      'aws-api',
      'https://auth.example/resource',
    );
  });

  it('handles post-run list ambiguity and unsupported auth server', async () => {
    const ctx = createCtx();

    mocked.selectCodexMcpAuthServer.mockReturnValueOnce(null);
    let out = await handleCodexPostRunMcpAuth(
      ctx as never,
      {
        job: createJob(),
        threadKey: 'thread',
        mcpAuthRequiredServer: null,
        mcpAuthRequiredResourceUrl: null,
      } as never,
      false,
    );
    expect(out).toEqual({ autoRerunScheduled: false, autoAuthFailureReported: true });

    mocked.selectCodexMcpAuthServer.mockReturnValueOnce('aws-api');
    mocked.isCodexMcpServerAuthUnsupported.mockReturnValueOnce(true);
    out = await handleCodexPostRunMcpAuth(
      ctx as never,
      {
        job: createJob(),
        threadKey: 'thread',
        mcpAuthRequiredServer: null,
        mcpAuthRequiredResourceUrl: null,
      } as never,
      false,
    );
    expect(out).toEqual({ autoRerunScheduled: false, autoAuthFailureReported: true });
  });

  it('does not widen post-run auth when the resolved selection is empty', async () => {
    const ctx = createCtx();
    mocked.selectCodexMcpAuthServer.mockReturnValueOnce(null);

    await handleCodexPostRunMcpAuth(
      ctx as never,
      {
        job: createJob(),
        threadKey: 'thread',
        mcpAuthRequiredServer: null,
        mcpAuthRequiredResourceUrl: null,
        selectedMcpServers: [],
      } as never,
      false,
    );

    expect(mocked.prepareCodexRuntimeHome).toHaveBeenCalledWith('/tmp/workdir', []);
  });

  it('reports discovered "none" when codex mcp list returns no servers', async () => {
    const ctx = createCtx();
    mocked.runCodexMcpList.mockResolvedValueOnce({ serverNames: [] });
    mocked.selectCodexMcpAuthServer.mockReturnValueOnce(null);

    const out = await handleCodexPostRunMcpAuth(
      ctx as never,
      {
        job: createJob(),
        threadKey: 'thread',
        mcpAuthRequiredServer: null,
        mcpAuthRequiredResourceUrl: null,
      } as never,
      false,
    );
    expect(out).toEqual({ autoRerunScheduled: false, autoAuthFailureReported: true });
    expect(String(mocked.postMessageWithContext.mock.calls.at(-1)?.[4] ?? '')).toContain(
      'discovered: none',
    );
  });

  it('handles post-run auto-auth success enqueue outcomes and failure details', async () => {
    const ctx = createCtx();
    (ctx.sessionManager.get as MockFn).mockReturnValue({ toolState: {} });
    (ctx.jobQueue.enqueue as MockFn)
      .mockReturnValueOnce({ error: 'queue down' })
      .mockReturnValueOnce({ position: 2 })
      .mockReturnValueOnce({ position: 0 });

    for (let i = 0; i < 3; i++) {
      mocked.runCodexMcpAuthPreflight.mockResolvedValueOnce({
        ok: true,
        exitCode: 0,
        errorKind: null,
        events: [],
        requiredServer: null,
        requiredResourceUrl: null,
      });
      const out = await handleCodexPostRunMcpAuth(
        ctx as never,
        {
          job: createJob(),
          threadKey: 'thread',
          mcpAuthRequiredServer: null,
          mcpAuthRequiredResourceUrl: null,
        } as never,
        false,
      );
      expect(out.autoRerunScheduled).toBe(true);
    }

    mocked.runCodexMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 3,
      errorKind: 'exit_3',
      events: [{ type: 'error', content: 'latest detail' }],
      requiredServer: null,
      requiredResourceUrl: null,
    });
    const fail = await handleCodexPostRunMcpAuth(
      ctx as never,
      {
        job: createJob(),
        threadKey: 'thread',
        mcpAuthRequiredServer: null,
        mcpAuthRequiredResourceUrl: null,
      } as never,
      false,
    );
    expect(fail).toEqual({ autoRerunScheduled: false, autoAuthFailureReported: true });
  });

  it('creates codex auto-rerun overrides when original overrides are undefined', async () => {
    const ctx = createCtx();
    (ctx.sessionManager.get as MockFn).mockReturnValue({ toolState: {} });
    mocked.runCodexMcpAuthPreflight.mockResolvedValueOnce({
      ok: true,
      exitCode: 0,
      errorKind: null,
      events: [],
      requiredServer: null,
      requiredResourceUrl: null,
    });

    const job = { ...createJob(), toolStateOverrides: undefined };
    const out = await handleCodexPostRunMcpAuth(
      ctx as never,
      {
        job,
        threadKey: 'thread',
        mcpAuthRequiredServer: null,
        mcpAuthRequiredResourceUrl: null,
      } as never,
      false,
    );

    expect(out.autoRerunScheduled).toBe(true);
    const retryJob = (ctx.jobQueue.enqueue as MockFn).mock.calls.at(-1)?.[0] as {
      toolStateOverrides?: Record<string, unknown>;
    };
    expect(retryJob.toolStateOverrides?.codex_mcp_auth_auto_rerun).toBe(true);
  });

  it('posts codex generic failure without detail when latest error content is missing', async () => {
    const ctx = createCtx();
    mocked.runCodexMcpAuthPreflight.mockResolvedValueOnce({
      ok: false,
      exitCode: 5,
      errorKind: 'exit_5',
      events: [{ type: 'status', content: 'still failing' }],
      requiredServer: null,
      requiredResourceUrl: null,
    });

    const out = await handleCodexPostRunMcpAuth(
      ctx as never,
      {
        job: createJob(),
        threadKey: 'thread',
        mcpAuthRequiredServer: null,
        mcpAuthRequiredResourceUrl: null,
      } as never,
      false,
    );
    expect(out).toEqual({ autoRerunScheduled: false, autoAuthFailureReported: true });
    expect(String(mocked.postMessageWithContext.mock.calls.at(-1)?.[4] ?? '')).toBe(
      '*Error:* codex generic failure',
    );
  });

  it('handles rerun-shortcircuit required message path', async () => {
    const ctx = createCtx();
    const out = await handleCodexPostRunMcpAuth(
      ctx as never,
      {
        job: createJob(),
        threadKey: 'thread',
        mcpAuthRequiredServer: 'aws-api',
        mcpAuthRequiredResourceUrl: 'https://auth.example',
      } as never,
      true,
    );
    expect(out).toEqual({ autoRerunScheduled: false, autoAuthFailureReported: false });
    expect(mocked.formatCodexMcpAuthRequiredMessage).toHaveBeenCalled();
  });
});
