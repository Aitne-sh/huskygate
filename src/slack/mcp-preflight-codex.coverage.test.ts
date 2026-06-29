/**
 * Coverage tests for mcp-preflight-codex.ts — targets:
 * - applyCodexRuntimeHome error path (lines 49-54) via runCodexSwitchPreflight
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../context/app-context.js';

const mocked = vi.hoisted(() => ({
  prepareCodexRuntimeHome: vi.fn().mockResolvedValue({
    homeDir: '/tmp/.codex',
    seededFiles: [],
  }),
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  checkSwitchPreflightNeeded: vi.fn((): unknown => null),
  handleSwitchPreflightSuccess: vi.fn().mockResolvedValue(undefined),
  postMessageWithContext: vi.fn().mockResolvedValue(undefined),
  isCodexMcpPreflightVerified: vi.fn(() => false),
  runCodexMcpAuthPreflight: vi.fn().mockResolvedValue({ ok: true, events: [] }),
  formatCodexMcpAuthRequiredMessage: vi.fn(() => 'required'),
  formatCodexMcpAuthGenericFailureMessage: vi.fn(() => 'generic'),
  getDriverEnv: vi.fn(() => ({ KEY: 'val' })),
  prepareWorkdirSkillsOnly: vi.fn(),
}));

vi.mock('../runner/codex-runtime-home.js', () => ({
  prepareCodexRuntimeHome: mocked.prepareCodexRuntimeHome,
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: mocked.loggerInfo, warn: mocked.loggerWarn, error: mocked.loggerError },
}));

vi.mock('../utils/error.js', () => ({
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('./mcp-preflight.js', () => ({
  checkSwitchPreflightNeeded: mocked.checkSwitchPreflightNeeded,
  handleSwitchPreflightSuccess: mocked.handleSwitchPreflightSuccess,
}));

vi.mock('./app-helpers.js', () => ({
  MCP_AUTH_BYPASS_TIMEOUT_MS: 120_000,
  postMessageWithContext: mocked.postMessageWithContext,
}));

vi.mock('./tools/codex.js', () => ({
  CODEX_MCP_AUTH_VERIFIED_SERVER_KEY: 'codex_mcp_auth_verified_server',
  isCodexMcpPreflightVerified: mocked.isCodexMcpPreflightVerified,
  runCodexMcpAuthPreflight: mocked.runCodexMcpAuthPreflight,
  formatCodexMcpAuthRequiredMessage: mocked.formatCodexMcpAuthRequiredMessage,
  formatCodexMcpAuthGenericFailureMessage: mocked.formatCodexMcpAuthGenericFailureMessage,
  isCodexMcpServerAuthUnsupported: vi.fn(() => false),
  markCodexMcpPreflightVerified: vi.fn((s: Record<string, unknown>) => s),
  runCodexMcpList: vi.fn(),
  selectCodexMcpAuthServer: vi.fn(),
}));

vi.mock('../runner/driver-factory.js', () => ({
  getDriverEnv: mocked.getDriverEnv,
}));

vi.mock('../runner/runner.js', () => ({
  Runner: vi.fn().mockImplementation(() => ({ tag: 'runner' })),
}));

vi.mock('./mcp-preflight-driver.js', () => ({
  createCodexPreflightDriver: vi.fn(() => ({ tool: 'codex' })),
  runUnifiedJobPreflight: vi.fn(),
}));

vi.mock('./mcp-preflight-utils.js', () => ({
  createRetryJob: vi.fn(),
  diffToolStatePatch: vi.fn(() => ({})),
  postRetryEnqueueMessages: vi.fn(),
}));

import { runCodexSwitchPreflight } from './mcp-preflight-codex.js';

describe('mcp-preflight-codex coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeCtx = () =>
    ({
      config: { codexMcpAuthServer: 'auth-srv' },
      sessionManager: {
        get: vi.fn(() => ({ workdir: '/tmp/w', toolState: {} })),
        mergeToolState: vi.fn(),
      },
      workdirManager: { prepareWorkdirSkillsOnly: mocked.prepareWorkdirSkillsOnly },
      switchPreflightBarriers: new Map(),
    }) as unknown as AppContext;

  it('returns early when checkSwitchPreflightNeeded returns null', async () => {
    mocked.checkSwitchPreflightNeeded.mockReturnValue(null);
    await runCodexSwitchPreflight(makeCtx(), {} as never, 'C1', 'T1', 'sk');
    expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
  });

  it('proceeds with runtime home and warns on prepare failure (covers lines 49-54)', async () => {
    mocked.checkSwitchPreflightNeeded.mockReturnValue({
      authServer: 'auth-srv',
      session: { workdir: '/tmp/w', toolState: {} },
      selectedMcpServers: [],
    });
    mocked.prepareCodexRuntimeHome.mockRejectedValueOnce(new Error('codex fail'));
    mocked.runCodexMcpAuthPreflight.mockResolvedValue({ ok: true, events: [] });

    await runCodexSwitchPreflight(makeCtx(), {} as never, 'C1', 'T1', 'sk');
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'codex_runtime_home_prepare_failed',
      expect.objectContaining({ error: 'codex fail' }),
    );
    expect(mocked.handleSwitchPreflightSuccess).toHaveBeenCalled();
  });

  it('handles preflight failure with generic message', async () => {
    mocked.checkSwitchPreflightNeeded.mockReturnValue({
      authServer: 'auth-srv',
      session: { workdir: '/tmp/w', toolState: {} },
      selectedMcpServers: [],
    });
    mocked.runCodexMcpAuthPreflight.mockResolvedValue({
      ok: false,
      exitCode: 1,
      errorKind: 'other',
      events: [],
      requiredServer: null,
      requiredResourceUrl: null,
    });

    await runCodexSwitchPreflight(makeCtx(), {} as never, 'C1', 'T1', 'sk');
    expect(mocked.formatCodexMcpAuthGenericFailureMessage).toHaveBeenCalled();
  });
});
