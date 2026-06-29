/**
 * Coverage tests for src/slack/mcp-preflight-gemini.ts
 * Targets: line 265 — conditional branch in prepareGeminiJobRuntime
 *   resolvedServers = servers ?? ((job.executionPolicy?.allowMcp ?? true) ? ctx.mcpServerStore.listByTool('gemini') : [])
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../context/app-context.js';
import type { Job } from '../queue/types.js';
import type { McpServerRecord } from '../store/mcp-server.js';

const mocked = vi.hoisted(() => ({
  prepareGeminiRuntimeHome: vi.fn().mockResolvedValue({
    homeDir: '/tmp/gemini-home',
    tokenAliasRepaired: false,
    tokenUrlNormalized: false,
    oauthDisabledForServer: false,
  }),
  getDriverEnv: vi.fn().mockReturnValue({ PATH: '/usr/bin' }),
  Runner: vi.fn().mockImplementation(() => ({})),
  postMessageWithContext: vi.fn().mockResolvedValue(undefined),
  checkSwitchPreflightNeeded: vi.fn().mockReturnValue(null),
  handleSwitchPreflightSuccess: vi.fn().mockResolvedValue(undefined),
  runUnifiedJobPreflight: vi.fn(),
  createGeminiPreflightDriver: vi.fn().mockReturnValue({}),
  createRetryJob: vi.fn().mockReturnValue({ id: 'retry-1' }),
  diffToolStatePatch: vi.fn().mockReturnValue({}),
  postRetryEnqueueMessages: vi.fn().mockResolvedValue(undefined),
  isGeminiMcpPreflightBypassed: vi.fn().mockReturnValue(false),
  isGeminiMcpPreflightInitialized: vi.fn().mockReturnValue(false),
  markGeminiMcpPreflightInitialized: vi.fn((ts: Record<string, unknown>) => ts),
  markGeminiMcpPreflightVerified: vi.fn((ts: Record<string, unknown>) => ts),
  runGeminiMcpAuthPreflight: vi.fn().mockResolvedValue({ ok: true, events: [], exitCode: 0 }),
  runGeminiInteractiveMcpAuth: vi
    .fn()
    .mockResolvedValue({ ok: false, exitCode: 1, errorKind: null, oauthUrl: null }),
  formatGeminiMcpAuthOAuthUrlMessage: vi.fn().mockReturnValue('oauth url'),
  formatGeminiMcpAuthWaitingMessage: vi.fn().mockReturnValue('waiting'),
  mcpServerStoreListByTool: vi.fn().mockReturnValue([]),
}));

vi.mock('../runner/driver-factory.js', () => ({
  getDriverEnv: mocked.getDriverEnv,
}));

vi.mock('../runner/gemini-runtime-home.js', () => ({
  prepareGeminiRuntimeHome: mocked.prepareGeminiRuntimeHome,
}));

vi.mock('../runner/runner.js', () => ({
  Runner: mocked.Runner,
}));

vi.mock('../utils/error.js', () => ({
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('./app-helpers.js', () => ({
  postMessageWithContext: mocked.postMessageWithContext,
}));

vi.mock('./mcp-preflight-driver.js', () => ({
  createGeminiPreflightDriver: mocked.createGeminiPreflightDriver,
  runUnifiedJobPreflight: mocked.runUnifiedJobPreflight,
}));

vi.mock('./mcp-preflight-utils.js', () => ({
  createRetryJob: mocked.createRetryJob,
  diffToolStatePatch: mocked.diffToolStatePatch,
  postRetryEnqueueMessages: mocked.postRetryEnqueueMessages,
}));

vi.mock('./mcp-preflight.js', () => ({
  checkSwitchPreflightNeeded: mocked.checkSwitchPreflightNeeded,
  handleSwitchPreflightSuccess: mocked.handleSwitchPreflightSuccess,
}));

vi.mock('./tools/gemini.js', () => ({
  GEMINI_MCP_AUTH_APPROVAL_RERUN_KEY: 'gemini_mcp_auth_approval_rerun',
  GEMINI_MCP_AUTH_BYPASS_SERVER_KEY: 'gemini_mcp_auth_bypass_server',
  formatGeminiMcpAuthOAuthUrlMessage: mocked.formatGeminiMcpAuthOAuthUrlMessage,
  formatGeminiMcpAuthWaitingMessage: mocked.formatGeminiMcpAuthWaitingMessage,
  isGeminiMcpPreflightBypassed: mocked.isGeminiMcpPreflightBypassed,
  isGeminiMcpPreflightInitialized: mocked.isGeminiMcpPreflightInitialized,
  markGeminiMcpPreflightInitialized: mocked.markGeminiMcpPreflightInitialized,
  markGeminiMcpPreflightVerified: mocked.markGeminiMcpPreflightVerified,
  runGeminiMcpAuthPreflight: mocked.runGeminiMcpAuthPreflight,
  runGeminiInteractiveMcpAuth: mocked.runGeminiInteractiveMcpAuth,
}));

import { prepareGeminiJobRuntime } from './mcp-preflight-gemini.js';

function makeCtx(overrides: Record<string, unknown> = {}): AppContext {
  return {
    config: { geminiMcpAuthServer: 'aws-api' },
    mcpServerStore: { listByTool: mocked.mcpServerStoreListByTool },
    ...overrides,
  } as unknown as AppContext;
}

function makeJob(overrides: Record<string, unknown> = {}): Job {
  return {
    id: 'job-1',
    sessionKey: 'sess-1',
    workdir: '/tmp/wd',
    executionPolicy: undefined,
    ...overrides,
  } as unknown as Job;
}

describe('mcp-preflight-gemini: prepareGeminiJobRuntime line 265 branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.prepareGeminiRuntimeHome.mockResolvedValue({
      homeDir: '/tmp/gemini-home',
      tokenAliasRepaired: false,
      tokenUrlNormalized: false,
      oauthDisabledForServer: false,
    });
  });

  it('uses provided servers array when servers param is given', async () => {
    const ctx = makeCtx();
    const job = makeJob();
    const servers = [{ name: 'custom-server', id: 's1' }] as McpServerRecord[];

    await prepareGeminiJobRuntime(ctx, job, { PATH: '/usr/bin' }, servers);

    expect(mocked.prepareGeminiRuntimeHome).toHaveBeenCalledWith('/tmp/wd', 'aws-api', servers);
    expect(mocked.mcpServerStoreListByTool).not.toHaveBeenCalled();
  });

  it('falls back to mcpServerStore.listByTool when servers is undefined and allowMcp is true (default)', async () => {
    const ctx = makeCtx();
    const job = makeJob(); // executionPolicy is undefined => allowMcp defaults to true
    mocked.mcpServerStoreListByTool.mockReturnValue([{ name: 'store-server' }]);

    await prepareGeminiJobRuntime(ctx, job, { PATH: '/usr/bin' });

    expect(mocked.mcpServerStoreListByTool).toHaveBeenCalledWith('gemini');
    expect(mocked.prepareGeminiRuntimeHome).toHaveBeenCalledWith('/tmp/wd', 'aws-api', [
      { name: 'store-server' },
    ]);
  });

  it('uses empty array when servers is undefined and allowMcp is explicitly false', async () => {
    const ctx = makeCtx();
    const job = makeJob({ executionPolicy: { allowMcp: false } });

    await prepareGeminiJobRuntime(ctx, job, { PATH: '/usr/bin' });

    expect(mocked.mcpServerStoreListByTool).not.toHaveBeenCalled();
    expect(mocked.prepareGeminiRuntimeHome).toHaveBeenCalledWith('/tmp/wd', 'aws-api', []);
  });

  it('uses empty array when servers is undefined and allowMcp is explicitly true', async () => {
    const ctx = makeCtx();
    const job = makeJob({ executionPolicy: { allowMcp: true } });
    mocked.mcpServerStoreListByTool.mockReturnValue([{ name: 'srv' }]);

    await prepareGeminiJobRuntime(ctx, job, { PATH: '/usr/bin' });

    expect(mocked.mcpServerStoreListByTool).toHaveBeenCalledWith('gemini');
  });

  it('uses ctx.config.geminiMcpAuthServer when authServer param is undefined', async () => {
    const ctx = makeCtx({ config: { geminiMcpAuthServer: 'my-auth-server' } });
    const job = makeJob();

    await prepareGeminiJobRuntime(ctx, job, { PATH: '/usr/bin' });

    expect(mocked.prepareGeminiRuntimeHome).toHaveBeenCalledWith(
      '/tmp/wd',
      'my-auth-server',
      expect.anything(),
    );
  });

  it('uses explicit null authServer when provided', async () => {
    const ctx = makeCtx({ config: { geminiMcpAuthServer: 'should-not-use' } });
    const job = makeJob();

    await prepareGeminiJobRuntime(ctx, job, { PATH: '/usr/bin' }, undefined, null);

    expect(mocked.prepareGeminiRuntimeHome).toHaveBeenCalledWith(
      '/tmp/wd',
      null,
      expect.anything(),
    );
  });
});
