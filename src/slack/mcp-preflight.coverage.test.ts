/**
 * Coverage tests for src/slack/mcp-preflight.ts
 * Targets:
 *   - line 61: checkSwitchPreflightNeeded — branch where enabledServerNames does not contain authServer
 *   - line 208: maybeRunJobPreflight — enabledServerNames from selectedMcpServers, switchBarrier await
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../context/app-context.js';
import type { JobPreflightOrchestrationInput } from './mcp-preflight.js';

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
    enabledServerIds: new Set(),
    filterActive: false,
  }),
  postMessageWithContext: vi.fn().mockResolvedValue(undefined),
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

vi.mock('./app-helpers.js', () => ({
  postMessageWithContext: mocked.postMessageWithContext,
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

import { checkSwitchPreflightNeeded, maybeRunJobPreflight } from './mcp-preflight.js';

describe('mcp-preflight: checkSwitchPreflightNeeded line 61 — authServer not in enabledServerNames', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when authServer is not in enabledServerNames', () => {
    const ctx = {
      sessionManager: {
        get: vi.fn().mockReturnValue({
          tool: 'claude',
          toolState: {},
          workdir: '/tmp/wd',
        }),
      },
    } as unknown as AppContext;

    // resolveSessionMcpSelection returns a set that does NOT contain the authServer
    mocked.resolveSessionMcpSelection.mockReturnValue({
      enabledServers: [{ name: 'other-server' }],
      enabledServerNames: new Set(['other-server']),
      enabledServerIds: new Set(),
      filterActive: false,
    });

    const result = checkSwitchPreflightNeeded(
      ctx,
      'sess-1',
      'aws-api',
      () => false, // shouldSkip returns false, so we proceed to the enabledServerNames check
    );

    expect(result).toBeNull();
  });

  it('returns SwitchPreflightReady when authServer IS in enabledServerNames', () => {
    const session = {
      tool: 'claude',
      toolState: {},
      workdir: '/tmp/wd',
    };
    const ctx = {
      sessionManager: {
        get: vi.fn().mockReturnValue(session),
      },
    } as unknown as AppContext;

    mocked.resolveSessionMcpSelection.mockReturnValue({
      enabledServers: [{ name: 'aws-api' }],
      enabledServerNames: new Set(['aws-api']),
      enabledServerIds: new Set(),
      filterActive: false,
    });

    const result = checkSwitchPreflightNeeded(ctx, 'sess-1', 'aws-api', () => false);

    expect(result).not.toBeNull();
    expect(result?.authServer).toBe('aws-api');
    expect(result?.session).toBe(session);
  });
});

describe('mcp-preflight: maybeRunJobPreflight line 208 — selectedMcpServers and switchBarrier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
      messenger: { appendText: vi.fn() },
      runner: {},
      claudeSessionIdPreStored: false,
      selectedMcpServers: overrides.selectedMcpServers ?? [],
      ...overrides,
    } as unknown as JobPreflightOrchestrationInput;
  }

  function makeCtx(overrides: Record<string, unknown> = {}) {
    return {
      switchPreflightBarriers: new Map(),
      sessionManager: { get: vi.fn().mockReturnValue(null) },
      config: {
        claudeMcpAuthServer: 'aws-api',
        geminiMcpAuthServer: null,
        codexMcpAuthServer: null,
      },
      ...overrides,
    } as unknown as AppContext;
  }

  it('builds enabledServerNames from selectedMcpServers and proceeds when authServer is present', async () => {
    const driver = {
      tool: 'claude',
      getAuthServer: vi.fn().mockReturnValue('aws-api'),
      getStateKeys: vi.fn().mockReturnValue({ verified: 'key' }),
    };
    mocked.getPreflightDriver.mockReturnValue(driver);
    mocked.runUnifiedJobPreflight.mockResolvedValue({
      shouldReturn: false,
      env: {},
      sessionToolState: {},
      effectiveToolState: {},
    });

    const input = makeInput({
      selectedMcpServers: [
        { name: 'aws-api', id: '1' },
        { name: 'other', id: '2' },
      ],
    });
    const ctx = makeCtx();

    await maybeRunJobPreflight(ctx, input);

    // Should have called runUnifiedJobPreflight because aws-api is in enabledServerNames
    expect(mocked.runUnifiedJobPreflight).toHaveBeenCalled();
  });

  it('skips preflight when authServer not in enabledServerNames (selectedMcpServers empty)', async () => {
    const driver = {
      tool: 'claude',
      getAuthServer: vi.fn().mockReturnValue('aws-api'),
    };
    mocked.getPreflightDriver.mockReturnValue(driver);

    const input = makeInput({ selectedMcpServers: [] });
    const ctx = makeCtx();

    const result = await maybeRunJobPreflight(ctx, input);

    expect(mocked.runUnifiedJobPreflight).not.toHaveBeenCalled();
    expect(result.shouldReturn).toBe(false);
  });

  it('awaits switchBarrier before proceeding', async () => {
    mocked.getPreflightDriver.mockReturnValue(null);

    let barrierResolved = false;
    const barrierPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        barrierResolved = true;
        resolve();
      }, 10);
    });

    const ctx = makeCtx();
    ctx.switchPreflightBarriers.set('sess-1', barrierPromise);

    const input = makeInput();
    await maybeRunJobPreflight(ctx, input);

    expect(barrierResolved).toBe(true);
  });

  it('returns no-op result when driver is null', async () => {
    mocked.getPreflightDriver.mockReturnValue(null);

    const input = makeInput();
    const ctx = makeCtx();

    const result = await maybeRunJobPreflight(ctx, input);

    expect(result.shouldReturn).toBe(false);
    expect(result.env).toEqual({ PATH: '/usr/bin' });
  });
});
