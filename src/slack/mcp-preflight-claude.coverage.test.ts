/**
 * Coverage tests for mcp-preflight-claude.ts — targets:
 * - cleanupClaudeGeneratedMcpConfig error path (lines 43-48)
 * - writeClaudeMcpConfigToWorkdir failure in runClaudeSwitchPreflight (lines 78-87)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../context/app-context.js';
import type { ChatClient } from './app-types.js';

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
  formatClaudeMcpApprovalPrompt: vi.fn(() => 'prompt'),
  formatClaudeMcpAuthRequiredMessage: vi.fn((s: string) => `required:${s}`),
  formatClaudeMcpAuthGenericFailureMessage: vi.fn(() => 'generic'),
  formatClaudeMcpAuthLoopPreventionMessage: vi.fn(() => 'loop'),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  buildEnv: vi.fn(() => ({})),
  RunnerCtor: vi.fn(() => ({ tag: 'runner' })),
  removeClaudeGeneratedMcpConfig: vi.fn(),
  writeClaudeMcpConfigToWorkdir: vi.fn(() => '/tmp/mcp.json'),
  prepareWorkdirSkillsOnly: vi.fn(),
  checkSwitchPreflightNeeded: vi.fn(),
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
  evaluateClaudeMcpAuthPreflight: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: mocked.loggerInfo,
    error: mocked.loggerError,
    warn: mocked.loggerWarn,
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

vi.mock('./mcp-preflight.js', () => ({
  checkSwitchPreflightNeeded: mocked.checkSwitchPreflightNeeded,
  handleSwitchPreflightSuccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./mcp-preflight-utils.js', () => ({
  getDriverEnv: vi.fn(() => ({})),
}));

import { runClaudeSwitchPreflight } from './mcp-preflight-claude.js';

describe('mcp-preflight-claude coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeCtx = () =>
    ({
      config: { claudeMcpAuthServer: 'auth-server' },
      sessionManager: {
        get: vi.fn(() => ({ workdir: '/tmp/w', toolState: {} })),
        mergeToolState: vi.fn(),
      },
      workdirManager: {
        prepareWorkdirSkillsOnly: mocked.prepareWorkdirSkillsOnly,
      },
      switchPreflightBarriers: new Map(),
    }) as unknown as AppContext;

  it('returns early when checkSwitchPreflightNeeded returns falsy', async () => {
    mocked.checkSwitchPreflightNeeded.mockReturnValue(null);
    const ctx = makeCtx();
    await runClaudeSwitchPreflight(ctx, {} as ChatClient, 'tk', 'C1', 'T1', 'U1', 'sk');
    expect(mocked.writeClaudeMcpConfigToWorkdir).not.toHaveBeenCalled();
  });

  it('posts error message when writeClaudeMcpConfigToWorkdir throws', async () => {
    mocked.checkSwitchPreflightNeeded.mockReturnValue({
      authServer: 'auth-server',
      session: { workdir: '/tmp/w', toolState: {} },
      selectedMcpServers: [],
    });
    mocked.writeClaudeMcpConfigToWorkdir.mockImplementation(() => {
      throw new Error('write fail');
    });

    const ctx = makeCtx();
    await runClaudeSwitchPreflight(ctx, {} as ChatClient, 'tk', 'C1', 'T1', 'U1', 'sk');
    expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
      ctx,
      expect.anything(),
      'C1',
      'T1',
      expect.stringContaining('write fail'),
      expect.any(Object),
    );
  });

  it('logs warning when cleanupClaudeGeneratedMcpConfig fails in finally (lines 43-48)', async () => {
    mocked.checkSwitchPreflightNeeded.mockReturnValue({
      authServer: 'auth-server',
      session: { workdir: '/tmp/w', toolState: {} },
      selectedMcpServers: [],
    });
    // writeClaudeMcpConfigToWorkdir succeeds
    mocked.writeClaudeMcpConfigToWorkdir.mockReturnValue('/tmp/mcp.json');
    // runClaudeMcpAuthPreflight succeeds
    mocked.runClaudeMcpAuthPreflight.mockResolvedValue({
      ok: true,
      exitCode: 0,
      events: [],
    });
    // removeClaudeGeneratedMcpConfig throws — triggers the catch in cleanupClaudeGeneratedMcpConfig
    mocked.removeClaudeGeneratedMcpConfig.mockImplementation(() => {
      throw new Error('rm cleanup fail');
    });

    const ctx = makeCtx();
    await runClaudeSwitchPreflight(ctx, {} as ChatClient, 'tk', 'C1', 'T1', 'U1', 'sk');
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'claude_generated_mcp_cleanup_failed',
      expect.objectContaining({
        path: '/tmp/mcp.json',
        error: expect.stringContaining('rm cleanup fail'),
      }),
    );
  });
});
