/**
 * Additional coverage tests for src/slack/mcp-preflight.ts
 * Covers maybeRunJobPreflight (lines 203-256)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  getPreflightDriver: vi.fn().mockReturnValue(null),
  runUnifiedJobPreflight: vi.fn(),
  isClaudeMcpPreflightBypassed: vi.fn().mockReturnValue(false),
  isClaudeMcpPreflightVerified: vi.fn().mockReturnValue(false),
  isGeminiMcpPreflightBypassed: vi.fn().mockReturnValue(false),
  isGeminiMcpPreflightInitialized: vi.fn().mockReturnValue(false),
  isCodexMcpPreflightVerified: vi.fn().mockReturnValue(false),
  runClaudeSwitchPreflight: vi.fn(),
  runGeminiSwitchPreflight: vi.fn(),
  runCodexSwitchPreflight: vi.fn(),
  resolveSessionMcpSelection: vi.fn().mockReturnValue({
    enabledServers: [],
    enabledServerNames: new Set(),
  }),
}));

vi.mock('./mcp-preflight-driver.js', () => ({
  getPreflightDriver: mocked.getPreflightDriver,
  runUnifiedJobPreflight: mocked.runUnifiedJobPreflight,
}));

vi.mock('./mcp-preflight-claude.js', () => ({
  runClaudeSwitchPreflight: mocked.runClaudeSwitchPreflight,
  runClaudeJobPreflight: vi.fn(),
  handleClaudePostRunMcpAuth: vi.fn(),
}));

vi.mock('./mcp-preflight-gemini.js', () => ({
  runGeminiSwitchPreflight: mocked.runGeminiSwitchPreflight,
  prepareGeminiJobRuntime: vi.fn(),
  runGeminiJobPreflight: vi.fn(),
  handleGeminiPostRunMcpAuth: vi.fn(),
}));

vi.mock('./mcp-preflight-codex.js', () => ({
  runCodexSwitchPreflight: mocked.runCodexSwitchPreflight,
  runCodexJobPreflight: vi.fn(),
  handleCodexPostRunMcpAuth: vi.fn(),
}));

vi.mock('./mcp-selection.js', () => ({
  resolveSessionMcpSelection: mocked.resolveSessionMcpSelection,
}));

vi.mock('./tools/claude.js', () => ({
  CLAUDE_MCP_AUTH_APPROVAL_RERUN_KEY: 'claude_mcp_auth_approval_rerun',
  isClaudeMcpPreflightBypassed: mocked.isClaudeMcpPreflightBypassed,
  isClaudeMcpPreflightVerified: mocked.isClaudeMcpPreflightVerified,
}));

vi.mock('./tools/codex.js', () => ({
  isCodexMcpPreflightVerified: mocked.isCodexMcpPreflightVerified,
}));

vi.mock('./tools/gemini.js', () => ({
  GEMINI_MCP_AUTH_APPROVAL_RERUN_KEY: 'gemini_mcp_auth_approval_rerun',
  isGeminiMcpPreflightBypassed: mocked.isGeminiMcpPreflightBypassed,
  isGeminiMcpPreflightInitialized: mocked.isGeminiMcpPreflightInitialized,
}));

import { maybeRunJobPreflight } from './mcp-preflight.js';

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    job: {
      sessionKey: 'sess-1',
      tool: 'claude' as string,
      toolStateOverrides: {} as Record<string, unknown>,
      ...((overrides.job as Record<string, unknown>) ?? {}),
    },
    threadKey: 'C1:1.1',
    allowMcp: true,
    env: { PATH: '/usr/bin' },
    session: { toolState: {} },
    effectiveToolState: {},
    selectedMcpServers: (overrides.selectedMcpServers ?? []) as Array<{ name: string }>,
    messenger: {},
    runner: {},
    claudeSessionIdPreStored: false,
    ...overrides,
  };
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    switchPreflightBarriers: new Map() as Map<string, Promise<void>>,
    sessionManager: {
      get: vi.fn().mockReturnValue({ toolState: {} }),
    },
    config: {
      claudeMcpAuthServer: null as string | null,
      geminiMcpAuthServer: null as string | null,
      codexMcpAuthServer: null as string | null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getPreflightDriver.mockReturnValue(null);
  mocked.isClaudeMcpPreflightBypassed.mockReturnValue(false);
  mocked.isClaudeMcpPreflightVerified.mockReturnValue(false);
  mocked.isGeminiMcpPreflightBypassed.mockReturnValue(false);
  mocked.isGeminiMcpPreflightInitialized.mockReturnValue(false);
  mocked.isCodexMcpPreflightVerified.mockReturnValue(false);
});

describe('maybeRunJobPreflight', () => {
  it('returns skip result when no driver found', async () => {
    mocked.getPreflightDriver.mockReturnValue(null);
    const result = await maybeRunJobPreflight(makeCtx() as never, makeInput() as never);
    expect(result.shouldReturn).toBe(false);
  });

  it('awaits switch barrier before checking preflight', async () => {
    let barrierResolved = false;
    const barrier = new Promise<void>((resolve) => {
      setTimeout(() => {
        barrierResolved = true;
        resolve();
      }, 10);
    });
    const ctx = makeCtx();
    ctx.switchPreflightBarriers.set('sess-1', barrier);

    mocked.getPreflightDriver.mockReturnValue(null);
    await maybeRunJobPreflight(ctx as never, makeInput() as never);
    expect(barrierResolved).toBe(true);
  });

  it('runs claude preflight when conditions met', async () => {
    const driver = {
      tool: 'claude',
      getAuthServer: vi.fn(() => 'aws-api'),
    };
    mocked.getPreflightDriver.mockReturnValue(driver);
    mocked.runUnifiedJobPreflight.mockResolvedValue({
      shouldReturn: false,
      env: {},
      sessionToolState: {},
      effectiveToolState: {},
    });

    const ctx = makeCtx({ config: { claudeMcpAuthServer: 'aws-api' } });
    const input = makeInput({
      job: { tool: 'claude' },
      selectedMcpServers: [{ name: 'aws-api' }],
    });

    await maybeRunJobPreflight(ctx as never, input as never);
    expect(mocked.runUnifiedJobPreflight).toHaveBeenCalledWith(ctx, input, 'C1:1.1', false, driver);
  });

  it('skips claude preflight when bypassed', async () => {
    const driver = {
      tool: 'claude',
      getAuthServer: vi.fn(() => 'aws-api'),
    };
    mocked.getPreflightDriver.mockReturnValue(driver);
    mocked.isClaudeMcpPreflightBypassed.mockReturnValue(true);

    const ctx = makeCtx();
    const input = makeInput({
      job: { tool: 'claude' },
      selectedMcpServers: [{ name: 'aws-api' }],
    });

    const result = await maybeRunJobPreflight(ctx as never, input as never);
    expect(result.shouldReturn).toBe(false);
    expect(mocked.runUnifiedJobPreflight).not.toHaveBeenCalled();
  });

  it('skips claude preflight when verified', async () => {
    const driver = {
      tool: 'claude',
      getAuthServer: vi.fn(() => 'aws-api'),
    };
    mocked.getPreflightDriver.mockReturnValue(driver);
    mocked.isClaudeMcpPreflightVerified.mockReturnValue(true);

    const ctx = makeCtx();
    const input = makeInput({
      job: { tool: 'claude' },
      selectedMcpServers: [{ name: 'aws-api' }],
    });

    const result = await maybeRunJobPreflight(ctx as never, input as never);
    expect(result.shouldReturn).toBe(false);
    expect(mocked.runUnifiedJobPreflight).not.toHaveBeenCalled();
  });

  it('skips preflight via toolStateOverrides skip flag', async () => {
    const driver = {
      tool: 'claude',
      getAuthServer: vi.fn(() => 'aws-api'),
    };
    mocked.getPreflightDriver.mockReturnValue(driver);

    const ctx = makeCtx();
    const input = makeInput({
      job: { tool: 'claude', toolStateOverrides: { claude_skip_mcp_preflight_once: true } },
      selectedMcpServers: [{ name: 'aws-api' }],
    });

    const result = await maybeRunJobPreflight(ctx as never, input as never);
    expect(result.shouldReturn).toBe(false);
    expect(mocked.runUnifiedJobPreflight).not.toHaveBeenCalled();
  });

  it('runs gemini preflight when conditions met', async () => {
    const driver = {
      tool: 'gemini',
      getAuthServer: vi.fn(() => 'aws-api'),
    };
    mocked.getPreflightDriver.mockReturnValue(driver);
    mocked.runUnifiedJobPreflight.mockResolvedValue({
      shouldReturn: false,
      env: {},
      sessionToolState: {},
      effectiveToolState: {},
    });

    const ctx = makeCtx({ config: { geminiMcpAuthServer: 'aws-api' } });
    const input = makeInput({
      job: { tool: 'gemini' },
      selectedMcpServers: [{ name: 'aws-api' }],
    });

    await maybeRunJobPreflight(ctx as never, input as never);
    expect(mocked.runUnifiedJobPreflight).toHaveBeenCalled();
  });

  it('skips gemini preflight when bypassed', async () => {
    const driver = {
      tool: 'gemini',
      getAuthServer: vi.fn(() => 'aws-api'),
    };
    mocked.getPreflightDriver.mockReturnValue(driver);
    mocked.isGeminiMcpPreflightBypassed.mockReturnValue(true);

    const ctx = makeCtx();
    const input = makeInput({
      job: { tool: 'gemini' },
      selectedMcpServers: [{ name: 'aws-api' }],
    });

    const result = await maybeRunJobPreflight(ctx as never, input as never);
    expect(mocked.runUnifiedJobPreflight).not.toHaveBeenCalled();
    expect(result.shouldReturn).toBe(false);
  });

  it('runs codex preflight when conditions met', async () => {
    const driver = {
      tool: 'codex',
      getAuthServer: vi.fn(() => 'aws-api'),
    };
    mocked.getPreflightDriver.mockReturnValue(driver);
    mocked.runUnifiedJobPreflight.mockResolvedValue({
      shouldReturn: false,
      env: {},
      sessionToolState: {},
      effectiveToolState: {},
    });

    const ctx = makeCtx({ config: { codexMcpAuthServer: 'aws-api' } });
    const input = makeInput({
      job: { tool: 'codex' },
      selectedMcpServers: [{ name: 'aws-api' }],
    });

    await maybeRunJobPreflight(ctx as never, input as never);
    expect(mocked.runUnifiedJobPreflight).toHaveBeenCalled();
  });

  it('skips codex preflight when verified', async () => {
    const driver = {
      tool: 'codex',
      getAuthServer: vi.fn(() => 'aws-api'),
    };
    mocked.getPreflightDriver.mockReturnValue(driver);
    mocked.isCodexMcpPreflightVerified.mockReturnValue(true);

    const ctx = makeCtx();
    const input = makeInput({
      job: { tool: 'codex' },
      selectedMcpServers: [{ name: 'aws-api' }],
    });

    const result = await maybeRunJobPreflight(ctx as never, input as never);
    expect(mocked.runUnifiedJobPreflight).not.toHaveBeenCalled();
    expect(result.shouldReturn).toBe(false);
  });

  it('skips preflight when allowMcp is false', async () => {
    const driver = {
      tool: 'claude',
      getAuthServer: vi.fn(() => 'aws-api'),
    };
    mocked.getPreflightDriver.mockReturnValue(driver);

    const ctx = makeCtx();
    const input = makeInput({
      job: { tool: 'claude' },
      allowMcp: false,
      selectedMcpServers: [{ name: 'aws-api' }],
    });

    const result = await maybeRunJobPreflight(ctx as never, input as never);
    expect(mocked.runUnifiedJobPreflight).not.toHaveBeenCalled();
    expect(result.shouldReturn).toBe(false);
  });

  it('skips preflight when auth server not in selected servers', async () => {
    const driver = {
      tool: 'claude',
      getAuthServer: vi.fn(() => 'aws-api'),
    };
    mocked.getPreflightDriver.mockReturnValue(driver);

    const ctx = makeCtx();
    const input = makeInput({
      job: { tool: 'claude' },
      selectedMcpServers: [{ name: 'other-server' }],
    });

    const result = await maybeRunJobPreflight(ctx as never, input as never);
    expect(mocked.runUnifiedJobPreflight).not.toHaveBeenCalled();
    expect(result.shouldReturn).toBe(false);
  });

  it('passes isApprovalRerun=true for claude approval rerun', async () => {
    const driver = {
      tool: 'claude',
      getAuthServer: vi.fn(() => 'aws-api'),
    };
    mocked.getPreflightDriver.mockReturnValue(driver);
    mocked.runUnifiedJobPreflight.mockResolvedValue({
      shouldReturn: false,
      env: {},
      sessionToolState: {},
      effectiveToolState: {},
    });

    const ctx = makeCtx();
    const input = makeInput({
      job: {
        tool: 'claude',
        toolStateOverrides: { claude_mcp_auth_approval_rerun: true },
      },
      selectedMcpServers: [{ name: 'aws-api' }],
    });

    await maybeRunJobPreflight(ctx as never, input as never);
    expect(mocked.runUnifiedJobPreflight).toHaveBeenCalledWith(ctx, input, 'C1:1.1', true, driver);
  });

  it('passes isApprovalRerun=true for gemini approval rerun', async () => {
    const driver = {
      tool: 'gemini',
      getAuthServer: vi.fn(() => 'aws-api'),
    };
    mocked.getPreflightDriver.mockReturnValue(driver);
    mocked.runUnifiedJobPreflight.mockResolvedValue({
      shouldReturn: false,
      env: {},
      sessionToolState: {},
      effectiveToolState: {},
    });

    const ctx = makeCtx();
    const input = makeInput({
      job: {
        tool: 'gemini',
        toolStateOverrides: { gemini_mcp_auth_approval_rerun: true },
      },
      selectedMcpServers: [{ name: 'aws-api' }],
    });

    await maybeRunJobPreflight(ctx as never, input as never);
    expect(mocked.runUnifiedJobPreflight).toHaveBeenCalledWith(ctx, input, 'C1:1.1', true, driver);
  });

  it('uses freshState from session when available', async () => {
    const driver = {
      tool: 'claude',
      getAuthServer: vi.fn(() => 'aws-api'),
    };
    mocked.getPreflightDriver.mockReturnValue(driver);
    mocked.runUnifiedJobPreflight.mockResolvedValue({
      shouldReturn: false,
      env: {},
      sessionToolState: {},
      effectiveToolState: {},
    });

    const freshToolState = { session_id: 'fresh' };
    const ctx = makeCtx();
    (ctx.sessionManager.get as ReturnType<typeof vi.fn>).mockReturnValue({
      toolState: freshToolState,
    });

    const input = makeInput({
      job: { tool: 'claude' },
      selectedMcpServers: [{ name: 'aws-api' }],
    });

    await maybeRunJobPreflight(ctx as never, input as never);
    expect(mocked.isClaudeMcpPreflightBypassed).toHaveBeenCalledWith(freshToolState, 'aws-api');
  });

  it('falls back to effectiveToolState when session not found', async () => {
    const driver = {
      tool: 'claude',
      getAuthServer: vi.fn(() => 'aws-api'),
    };
    mocked.getPreflightDriver.mockReturnValue(driver);

    const ctx = makeCtx();
    (ctx.sessionManager.get as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const effectiveToolState = { some_key: 'value' };
    const input = makeInput({
      job: { tool: 'claude' },
      selectedMcpServers: [{ name: 'aws-api' }],
      effectiveToolState,
    });

    mocked.isClaudeMcpPreflightBypassed.mockReturnValue(true);
    await maybeRunJobPreflight(ctx as never, input as never);
    expect(mocked.isClaudeMcpPreflightBypassed).toHaveBeenCalledWith(effectiveToolState, 'aws-api');
  });
});
