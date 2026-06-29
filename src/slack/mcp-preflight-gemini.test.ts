import { describe, expect, it, vi } from 'vitest';
import { handleGeminiPostRunMcpAuth, runGeminiSwitchPreflight } from './mcp-preflight-gemini.js';

// Mock gemini tools module to control runGeminiMcpAuthPreflight and runGeminiInteractiveMcpAuth
vi.mock('./tools/gemini.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tools/gemini.js')>();
  return {
    ...actual,
    runGeminiMcpAuthPreflight: vi.fn(),
    runGeminiInteractiveMcpAuth: vi.fn(),
  };
});

// Mock Runner constructor
vi.mock('../runner/runner.js', () => ({
  Runner: vi.fn().mockImplementation((config: unknown) => ({
    config,
    run: vi.fn(),
  })),
}));

// Mock GeminiDriver
vi.mock('../runner/driver-gemini.js', () => ({
  GeminiDriver: vi.fn().mockImplementation(() => ({
    buildEnv: () => ({ PATH: '/usr/bin' }),
    getCommandPrefixArgs: () => [],
  })),
}));

// Mock prepareGeminiRuntimeHome
vi.mock('../runner/gemini-runtime-home.js', () => ({
  prepareGeminiRuntimeHome: vi.fn().mockResolvedValue({
    homeDir: '/tmp/gemini-home',
    tokenAliasRepaired: false,
    tokenUrlNormalized: false,
    oauthDisabledForServer: false,
  }),
}));

import { runGeminiInteractiveMcpAuth, runGeminiMcpAuthPreflight } from './tools/gemini.js';

const mockedRunPreflight = vi.mocked(runGeminiMcpAuthPreflight);
const mockedRunInteractive = vi.mocked(runGeminiInteractiveMcpAuth);
const GEMINI_SERVER = {
  id: 'srv_aws',
  name: 'aws-api',
  tool: 'gemini',
  transport: 'stdio',
  definition: { command: 'aws' },
  createdAt: '2026-03-11T00:00:00.000Z',
  updatedAt: '2026-03-11T00:00:00.000Z',
} as const;

describe('mcp-preflight-gemini', () => {
  it('switch preflight returns immediately when auth server is not configured', async () => {
    const ctx = { config: { geminiMcpAuthServer: null } };
    await expect(
      runGeminiSwitchPreflight(ctx as never, {} as never, 'thread', 'C1', '1.1', 'U1', 'sess-1'),
    ).resolves.toBeUndefined();
  });

  it('switch preflight attempts interactive auth on OAuth failure and posts URL to Slack', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    const slackClient = { chat: { postMessage } };
    const toolState: Record<string, unknown> = {};
    const ctx = {
      config: {
        geminiMcpAuthServer: 'aws-api',
        noOutputTimeoutSec: 30,
        maxRuntimeSec: 600,
        maxConcurrency: 1,
      },
      sessionManager: {
        get: vi.fn().mockReturnValue({ tool: 'gemini', workdir: '/tmp/workdir', toolState }),
        updateToolState: vi.fn(),
        mergeToolState: vi.fn(),
        getSessionSummary: vi.fn().mockReturnValue({ tool: 'gemini', sessionId: 'S1' }),
        getActiveSessionSummary: vi.fn().mockReturnValue(null),
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
    };

    // Fast preflight fails with interactive auth required
    mockedRunPreflight.mockResolvedValueOnce({
      ok: false,
      events: [],
      exitCode: 42,
      errorKind: 'exit_42',
      requiredServer: null,
      interactiveFailure: true,
      oauthFlowStarted: true,
    });

    // Interactive auth succeeds and fires the onOAuthUrl callback
    const oauthUrl = 'https://auth.example.com/authorize?client_id=abc&response_type=code';
    mockedRunInteractive.mockImplementationOnce(
      async (_runner, _env, _cwd, _server, onOAuthUrl) => {
        onOAuthUrl?.(oauthUrl);
        return {
          ok: true,
          events: [],
          exitCode: 0,
          errorKind: null,
          requiredServer: null,
          interactiveFailure: false,
          oauthFlowStarted: true,
          oauthUrl,
        };
      },
    );

    await runGeminiSwitchPreflight(
      ctx as never,
      slackClient as never,
      'thread',
      'C1',
      '1.1',
      'U1',
      'sess-1',
    );

    // Verify interactive auth was attempted
    expect(mockedRunInteractive).toHaveBeenCalledOnce();

    // Verify OAuth URL was posted to Slack (fire-and-forget, so it should show up in postMessage calls)
    const messages = postMessage.mock.calls.map((c: unknown[]) => (c[0] as { text: string }).text);
    expect(messages.some((m: string) => m.includes('Initializing MCP auth'))).toBe(true);
    expect(messages.some((m: string) => m.includes('OAuth consent'))).toBe(true);
    expect(messages.some((m: string) => m.includes(oauthUrl))).toBe(true);
    expect(messages.some((m: string) => m.includes('Waiting for OAuth'))).toBe(true);

    // Verify session state is marked as verified via atomic merge
    expect(ctx.sessionManager.mergeToolState).toHaveBeenCalled();
    const lastMergePatch = ctx.sessionManager.mergeToolState.mock.calls.at(-1)?.[1] as Record<
      string,
      unknown
    >;
    expect(lastMergePatch.gemini_mcp_auth_verified_server).toBe('aws-api');
  });

  it('switch preflight falls back to auto-bypass when interactive auth also fails', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    const slackClient = { chat: { postMessage } };
    const toolState: Record<string, unknown> = {};
    const ctx = {
      config: {
        geminiMcpAuthServer: 'aws-api',
        noOutputTimeoutSec: 30,
        maxRuntimeSec: 600,
        maxConcurrency: 1,
      },
      sessionManager: {
        get: vi.fn().mockReturnValue({ tool: 'gemini', workdir: '/tmp/workdir', toolState }),
        updateToolState: vi.fn(),
        mergeToolState: vi.fn(),
        getSessionSummary: vi.fn().mockReturnValue({ tool: 'gemini', sessionId: 'S1' }),
        getActiveSessionSummary: vi.fn().mockReturnValue(null),
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
    };

    // Fast preflight fails
    mockedRunPreflight.mockResolvedValueOnce({
      ok: false,
      events: [],
      exitCode: 42,
      errorKind: 'exit_42',
      requiredServer: 'aws-api',
      interactiveFailure: true,
      oauthFlowStarted: true,
    });

    // Interactive auth also fails
    mockedRunInteractive.mockResolvedValueOnce({
      ok: false,
      events: [],
      exitCode: 42,
      errorKind: 'exit_42',
      requiredServer: 'aws-api',
      interactiveFailure: true,
      oauthFlowStarted: true,
      oauthUrl: null,
    });

    await runGeminiSwitchPreflight(
      ctx as never,
      slackClient as never,
      'thread',
      'C1',
      '1.1',
      'U1',
      'sess-1',
    );

    // Should fall back to auto-bypass via atomic merge
    expect(ctx.sessionManager.mergeToolState).toHaveBeenCalled();
    const lastMergePatch = ctx.sessionManager.mergeToolState.mock.calls.at(-1)?.[1] as Record<
      string,
      unknown
    >;
    expect(lastMergePatch.gemini_mcp_auth_bypass_server).toBe('aws-api');

    // Final message should be "initialized" (bypass)
    const messages = postMessage.mock.calls.map((c: unknown[]) => (c[0] as { text: string }).text);
    expect(messages.at(-1)).toContain('initialized');
  });

  it('post-run handler emits brief message on approval rerun (loop prevention)', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    const webClient = { chat: { postMessage } };
    const ctx = {
      config: { geminiMcpAuthServer: null },
      webClient,
      mcpServerStore: {
        listByTool: vi.fn(() => [GEMINI_SERVER]),
      },
      sessionManager: {
        getSessionSummary: vi.fn().mockReturnValue({ tool: 'gemini', sessionId: 'S1' }),
        getActiveSessionSummary: vi.fn().mockReturnValue(null),
      },
      pendingMcpAuthBypassApprovals: new Map(),
    };

    await handleGeminiPostRunMcpAuth(
      ctx as never,
      {
        job: {
          id: 'job-1',
          sessionKey: 'sess-1',
          channelId: 'C1',
          threadTs: '1.1',
          userId: 'U1',
          tool: 'gemini',
          mode: 'readonly',
          prompt: 'p',
          workdir: '/tmp/workdir',
          toolState: {},
          createdAt: Date.now(),
        },
        threadKey: 'C1:1.1',
        mcpAuthRequiredServer: 'aws-api',
        mcpAuthRequiredResourceUrl: null,
        selectedMcpServers: [],
      },
      true,
    );

    // Should post exactly one brief message (no verbose error + approval prompt).
    expect(postMessage).toHaveBeenCalledTimes(1);
    const msgText = postMessage.mock.calls[0]?.[0]?.text as string;
    expect(msgText).toContain('could not be completed automatically');
  });

  it('post-run handler uses interactive auth and posts OAuth URL to Slack', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    const oauthUrl = 'https://auth.example.com/authorize?client_id=xyz&response_type=code';
    const webClient = { chat: { postMessage } };
    const ctx = {
      config: {
        geminiMcpAuthServer: 'aws-api',
        noOutputTimeoutSec: 30,
        maxRuntimeSec: 600,
        maxConcurrency: 1,
      },
      webClient,
      mcpServerStore: {
        listByTool: vi.fn(() => [GEMINI_SERVER]),
      },
      sessionManager: {
        get: vi.fn().mockReturnValue({ toolState: {} }),
        updateToolState: vi.fn(),
        mergeToolState: vi.fn(),
        getSessionSummary: vi.fn().mockReturnValue({ tool: 'gemini', sessionId: 'S1' }),
        getActiveSessionSummary: vi.fn().mockReturnValue(null),
      },
      jobQueue: {
        enqueue: vi.fn().mockReturnValue({ position: 0 }),
      },
    };

    // Interactive auth succeeds and fires callback
    mockedRunInteractive.mockImplementationOnce(
      async (_runner, _env, _cwd, _server, onOAuthUrl) => {
        onOAuthUrl?.(oauthUrl);
        return {
          ok: true,
          events: [],
          exitCode: 0,
          errorKind: null,
          requiredServer: null,
          interactiveFailure: false,
          oauthFlowStarted: true,
          oauthUrl,
        };
      },
    );

    await handleGeminiPostRunMcpAuth(
      ctx as never,
      {
        job: {
          id: 'job-1',
          sessionKey: 'sess-1',
          channelId: 'C1',
          threadTs: '1.1',
          userId: 'U1',
          tool: 'gemini',
          mode: 'readonly',
          prompt: 'p',
          workdir: '/tmp/workdir',
          toolState: {},
          createdAt: Date.now(),
        },
        threadKey: 'C1:1.1',
        mcpAuthRequiredServer: 'aws-api',
        mcpAuthRequiredResourceUrl: null,
        selectedMcpServers: [GEMINI_SERVER],
      },
      false,
    );

    // Verify interactive auth was used
    expect(mockedRunInteractive).toHaveBeenCalled();

    // Verify OAuth URL posted to Slack
    const messages = postMessage.mock.calls.map((c: unknown[]) => (c[0] as { text: string }).text);
    expect(messages.some((m: string) => m.includes(oauthUrl))).toBe(true);

    // Verify job re-enqueued on success
    expect(ctx.jobQueue.enqueue).toHaveBeenCalledOnce();
  });
});
