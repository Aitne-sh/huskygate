/**
 * Coverage tests for src/slack/tools/claude.ts
 * Targets:
 *   - line 100: buildClaudeMcpConfigArgs(options?.mcpConfigPath) — when options is undefined
 *   - line 248: buildClaudeMcpConfigArgs(options?.mcpConfigPath) in runClaudeMcpAuthCommand — when options is undefined
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Runner } from '../../runner/runner.js';
import type { DriverEvent } from '../../runner/types.js';

const mocked = vi.hoisted(() => ({
  ClaudeDriver: vi.fn().mockImplementation(() => ({})),
  buildClaudeMcpConfigArgs: vi.fn().mockReturnValue([]),
  refreshClaudeMcpOAuthToken: vi.fn().mockResolvedValue({ refreshed: false, reason: 'n/a' }),
  detectMcpAuthRequiredServer: vi.fn().mockReturnValue(null),
  isMcpInteractiveAuthFailure: vi.fn().mockReturnValue(false),
  isMcpRuntimeWarning: vi.fn().mockReturnValue(false),
  isMcpTokenRefreshFailure: vi.fn().mockReturnValue(false),
  isMcpPreflightMarker: vi.fn().mockReturnValue(false),
  setMcpPreflightMarker: vi.fn((ts: Record<string, unknown>, _k: string, _s: string) => ({
    ...ts,
  })),
  formatMcpAuthGenericFailure: vi.fn().mockReturnValue('generic failure'),
  runnerRun: vi.fn().mockResolvedValue({ exitCode: 0, errorKind: null }),
}));

vi.mock('../../runner/driver-claude.js', () => ({
  ClaudeDriver: mocked.ClaudeDriver,
  buildClaudeMcpConfigArgs: mocked.buildClaudeMcpConfigArgs,
}));

vi.mock('../../runner/claude-mcp-token-refresh.js', () => ({
  refreshClaudeMcpOAuthToken: mocked.refreshClaudeMcpOAuthToken,
}));

vi.mock('../mcp-auth.js', () => ({
  detectMcpAuthRequiredServer: mocked.detectMcpAuthRequiredServer,
  isMcpInteractiveAuthFailure: mocked.isMcpInteractiveAuthFailure,
  isMcpRuntimeWarning: mocked.isMcpRuntimeWarning,
  isMcpTokenRefreshFailure: mocked.isMcpTokenRefreshFailure,
}));

vi.mock('./tool-state-utils.js', () => ({
  isMcpPreflightMarker: mocked.isMcpPreflightMarker,
  setMcpPreflightMarker: mocked.setMcpPreflightMarker,
  formatMcpAuthGenericFailure: mocked.formatMcpAuthGenericFailure,
}));

vi.mock('../../shared/sticky-tool-state.js', () => ({
  CLAUDE_MCP_AUTH_APPROVAL_ACTION_KEY: 'claude_mcp_auth_approval_action',
  CLAUDE_MCP_AUTH_APPROVAL_RERUN_KEY: 'claude_mcp_auth_approval_rerun',
  CLAUDE_STICKY_TOOL_STATE_KEYS: [],
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runClaudeMcpAuthCommand, runClaudeMcpList } from './claude.js';

type ClaudeRunnerArgs = Parameters<Runner['run']>;

function makeRunner(): Runner {
  return {
    run: mocked.runnerRun,
  } as unknown as Runner;
}

describe('tools/claude: runClaudeMcpList options branch (line 100)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.buildClaudeMcpConfigArgs.mockReturnValue([]);
    mocked.runnerRun.mockResolvedValue({ exitCode: 0, errorKind: null });
  });

  it('calls buildClaudeMcpConfigArgs with undefined when no options provided', async () => {
    const runner = makeRunner();
    await runClaudeMcpList(runner, { PATH: '/usr/bin' }, '/tmp');

    expect(mocked.buildClaudeMcpConfigArgs).toHaveBeenCalledWith(undefined);
  });

  it('calls buildClaudeMcpConfigArgs with mcpConfigPath when options provided', async () => {
    const runner = makeRunner();
    await runClaudeMcpList(runner, { PATH: '/usr/bin' }, '/tmp', {
      mcpConfigPath: '/tmp/mcp.json',
    });

    expect(mocked.buildClaudeMcpConfigArgs).toHaveBeenCalledWith('/tmp/mcp.json');
  });
});

describe('tools/claude: runClaudeMcpAuthCommand options branch (line 248)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.buildClaudeMcpConfigArgs.mockReturnValue([]);
    mocked.runnerRun.mockResolvedValue({ exitCode: 0, errorKind: null });
  });

  it('calls buildClaudeMcpConfigArgs with undefined when no options provided', async () => {
    const runner = makeRunner();
    await runClaudeMcpAuthCommand(runner, { PATH: '/usr/bin' }, '/tmp', 'aws-api');

    expect(mocked.buildClaudeMcpConfigArgs).toHaveBeenCalledWith(undefined);
  });

  it('calls buildClaudeMcpConfigArgs with mcpConfigPath when options provided', async () => {
    const runner = makeRunner();
    await runClaudeMcpAuthCommand(runner, { PATH: '/usr/bin' }, '/tmp', 'aws-api', {
      mcpConfigPath: '/tmp/mcp.json',
    });

    expect(mocked.buildClaudeMcpConfigArgs).toHaveBeenCalledWith('/tmp/mcp.json');
  });

  it('returns ok=true when exit code is 0 and no auth failures detected', async () => {
    mocked.runnerRun.mockResolvedValue({ exitCode: 0, errorKind: null });
    mocked.detectMcpAuthRequiredServer.mockReturnValue(null);
    mocked.isMcpInteractiveAuthFailure.mockReturnValue(false);
    mocked.isMcpTokenRefreshFailure.mockReturnValue(false);

    const runner = makeRunner();
    const result = await runClaudeMcpAuthCommand(runner, {}, '/tmp', 'aws-api');

    expect(result.ok).toBe(true);
    expect(result.interactiveFailure).toBe(false);
  });

  it('returns ok=false when interactiveFailure is detected', async () => {
    // The runner.run callback pushes events; evaluateClaudeMcpAuthPreflight iterates them.
    // We need events to exist so the detection functions are called on event content.
    mocked.runnerRun.mockImplementation(
      async (
        _driver: ClaudeRunnerArgs[0],
        _args: ClaudeRunnerArgs[1],
        _env: ClaudeRunnerArgs[2],
        _cwd: ClaudeRunnerArgs[3],
        cb: (event: DriverEvent) => void,
      ) => {
        cb({ type: 'error', content: 'FatalAuthenticationError' });
        return { exitCode: 0, errorKind: null };
      },
    );
    mocked.isMcpInteractiveAuthFailure.mockReturnValue(true);

    const runner = makeRunner();
    const result = await runClaudeMcpAuthCommand(runner, {}, '/tmp', 'aws-api');

    expect(result.ok).toBe(false);
    expect(result.interactiveFailure).toBe(true);
  });
});
