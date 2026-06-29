import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * Coverage tests for job-runtime.ts — targets uncovered branches:
 * codex runtime home failure, MCP connection failure/retry,
 * grace timer, events dropped, job stream fallback.
 */
import type { AppContext } from '../context/app-context.js';
import type { PreparedJobExecution } from './job-runtime-types.js';

const mocked = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  prepareCodexRuntimeHome: vi.fn().mockResolvedValue({
    homeDir: '/tmp/.codex',
    seededFiles: [],
  }),
  RunnerRun: vi
    .fn()
    .mockResolvedValue({ exitCode: 0, errorKind: null, events: [], eventsDropped: false }),
  RunnerKill: vi.fn(),
  RunnerIsRunning: vi.fn(() => true),
  maybeRunJobPreflight: vi.fn().mockResolvedValue({
    shouldReturn: false,
    env: {},
    sessionToolState: {},
    effectiveToolState: {},
  }),
  prepareGeminiJobRuntime: vi.fn(
    async (_ctx: unknown, _job: unknown, env: Record<string, string>) => env,
  ),
  isMcpConnectionFailure: vi.fn(() => false),
  isMcpRuntimeWarning: vi.fn(() => false),
  isMcpTokenRefreshFailure: vi.fn(() => false),
  detectMcpAuthRequiredServer: vi.fn(() => null),
  detectMcpAuthRequiredResourceUrl: vi.fn(() => null),
  detectToolNotFound: vi.fn(() => null),
  evaluateGeminiMcpAuthPreflight: vi.fn(() => null),
  getToolPlugin: vi.fn(() => ({
    createApprovalGate: vi.fn(() => ({})),
    evaluateToolUse: vi.fn(() => ({ gate: {}, shouldBlock: false })),
    buildPermissionDeniedSummary: vi.fn(() => null),
    detectVoluntaryStop: vi.fn(() => null),
    clearMcpAuthState: vi.fn((s: Record<string, unknown>) => s),
    getMcpAuthServer: vi.fn(() => null),
    buildAutoAuthRerunOverrides: vi.fn(() => null),
    extractMcpAuthPreflight: vi.fn(() => null),
    detectMcpAuthRequired: vi.fn(() => false),
    detectToolNotFound: vi.fn(() => null),
    evaluateMcpAuthPreflight: vi.fn(() => ({})),
    filterApprovedToolCalls: vi.fn(() => []),
  })),
  isPermissionDeniedError: vi.fn(() => false),
  detectPermissionDenied: vi.fn(() => null),
  evaluateClaudeMcpAuthPreflight: vi.fn(() => null),
  consumeCodexOutputLastMessage: vi.fn(() => null),
  extractAnswerText: vi.fn(() => ''),
  wrapForMrkdwn: vi.fn((s: string) => s),
  isAggregateTextEvent: vi.fn(() => false),
  driverEventToChatEvent: vi.fn(() => null),
  saveMessage: vi.fn(),
  enqueue: vi.fn(),
  handlePostRunActions: vi.fn().mockResolvedValue(undefined),
  createInitialJobRunOutcome: vi.fn(() => ({
    jobFailed: false,
    taskOutputSummary: '',
    taskOutputRaw: '',
    taskExitCode: 0,
    taskErrorKind: null,
    archivedFiles: [],
  })),
  hasGeminiResumeStateError: vi.fn(() => false),
  detectMcpAuthRequiredResourceFromEvents: vi.fn(() => null),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: mocked.loggerInfo, warn: mocked.loggerWarn, error: mocked.loggerError },
  createScopedLogger: vi.fn(() => ({
    info: mocked.loggerInfo,
    warn: mocked.loggerWarn,
    error: mocked.loggerError,
  })),
}));

vi.mock('../utils/error.js', () => ({
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('../utils/sanitize.js', () => ({
  wrapForMrkdwn: mocked.wrapForMrkdwn,
}));

vi.mock('../runner/codex-runtime-home.js', () => ({
  prepareCodexRuntimeHome: mocked.prepareCodexRuntimeHome,
}));

vi.mock('../runner/types.js', () => ({
  isAggregateTextEvent: mocked.isAggregateTextEvent,
}));

vi.mock('./mcp-preflight.js', () => ({
  maybeRunJobPreflight: mocked.maybeRunJobPreflight,
  prepareGeminiJobRuntime: mocked.prepareGeminiJobRuntime,
}));

vi.mock('./mcp-auth.js', () => ({
  detectMcpAuthRequiredServer: mocked.detectMcpAuthRequiredServer,
  detectMcpAuthRequiredResourceUrl: mocked.detectMcpAuthRequiredResourceUrl,
  detectToolNotFound: mocked.detectToolNotFound,
  evaluateGeminiMcpAuthPreflight: mocked.evaluateGeminiMcpAuthPreflight,
  isMcpConnectionFailure: mocked.isMcpConnectionFailure,
  isMcpRuntimeWarning: mocked.isMcpRuntimeWarning,
  isMcpTokenRefreshFailure: mocked.isMcpTokenRefreshFailure,
}));

vi.mock('./tool-plugin.js', () => ({
  getToolPlugin: mocked.getToolPlugin,
}));

vi.mock('./app-helpers.js', () => ({
  CLAUDE_MCP_AUTH_AUTO_RERUN_KEY: 'claude_mcp_auth_auto_rerun',
  CODEX_MCP_AUTH_AUTO_RERUN_KEY: 'codex_mcp_auth_auto_rerun',
  MCP_CONN_RETRY_COUNT_KEY: 'mcp_conn_retry_count',
  extractAnswerText: mocked.extractAnswerText,
  detectMcpAuthRequiredResourceFromEvents: mocked.detectMcpAuthRequiredResourceFromEvents,
  hasGeminiResumeStateError: mocked.hasGeminiResumeStateError,
}));

vi.mock('../shared/tool-approval.js', () => ({
  TOOL_APPROVAL_RERUN_KEY: 'tool_approval_rerun',
  detectPermissionDenied: mocked.detectPermissionDenied,
  isPermissionDeniedError: mocked.isPermissionDeniedError,
}));

vi.mock('./tools/claude.js', () => ({
  evaluateClaudeMcpAuthPreflight: mocked.evaluateClaudeMcpAuthPreflight,
}));

vi.mock('./tools/codex.js', () => ({
  consumeCodexOutputLastMessage: mocked.consumeCodexOutputLastMessage,
}));

vi.mock('./tools/gemini.js', () => ({
  GEMINI_MCP_AUTH_APPROVAL_RERUN_KEY: 'gemini_mcp_auth_approval_rerun',
}));

vi.mock('./job-post-run.js', () => ({
  handlePostRunActions: mocked.handlePostRunActions,
}));

vi.mock('../shared/constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/constants.js')>();
  return {
    ...actual,
    TIMEOUTS: { ...actual.TIMEOUTS, mcpConnFailureGrace: 10 },
    RETRY_LIMITS: { ...actual.RETRY_LIMITS, mcpConn: 3 },
    SIZE_LIMITS: { ...actual.SIZE_LIMITS, maxEventsPerRun: 50000 },
  };
});

vi.mock('./job-runtime-types.js', () => ({
  createInitialJobRunOutcome: mocked.createInitialJobRunOutcome,
  driverEventToChatEvent: mocked.driverEventToChatEvent,
  getJobSourceFlags: vi.fn(() => ({
    isDashboard: false,
    isSchedule: false,
    isAssistant: false,
    isOndemandTask: false,
    isTriggeredTask: false,
    isOrchestrator: false,
    isOrchestratorSummary: false,
  })),
}));

import { runJobRuntime } from './job-runtime.js';

type RunnerRunArgs = Parameters<PreparedJobExecution['runner']['run']>;

function setRunnerRunImplementation(
  implementation: (cb: RunnerRunArgs[4]) => ReturnType<PreparedJobExecution['runner']['run']>,
): void {
  mocked.RunnerRun.mockImplementation(async (...args: RunnerRunArgs) => implementation(args[4]));
}

function makePrepared(overrides: Record<string, unknown> = {}): PreparedJobExecution {
  const jobDefaults = {
    id: 'j1',
    sessionKey: 'sk1',
    tool: 'claude' as const,
    prompt: 'hi',
    mode: 'normal',
    workdir: '/tmp/w',
    source: 'chat',
    channelId: 'C1',
    threadTs: 'T1',
    userId: 'U1',
    toolStateOverrides: null,
    executionPolicy: null,
  };
  const job = { ...jobDefaults, ...((overrides.job as Record<string, unknown>) ?? {}) };
  return {
    job,
    flags: {
      isDashboard: false,
      isSchedule: false,
      isAssistant: false,
      isOndemandTask: false,
      isTriggeredTask: false,
      isOrchestrator: false,
      isOrchestratorSummary: false,
      ...((overrides.flags as Record<string, unknown>) ?? {}),
    },
    jobStream: overrides.jobStream ?? null,
    threadKey: 'C1:T1',
    messenger: {
      appendText: vi.fn(),
      postStart: vi.fn().mockResolvedValue(undefined),
      postFinal: vi.fn().mockResolvedValue(undefined),
      postStatusMessage: vi.fn().mockResolvedValue(null),
      replaceBuffer: vi.fn(),
      uploadFile: vi.fn().mockResolvedValue(undefined),
    },
    jlog: {
      info: mocked.loggerInfo,
      warn: mocked.loggerWarn,
      error: mocked.loggerError,
    },
    driver: {
      buildArgs: vi.fn(() => []),
      buildEnv: vi.fn(() => ({})),
      extractSessionState: vi.fn(() => ({})),
    },
    session: { toolState: {}, mode: 'normal' },
    runner: {
      run: mocked.RunnerRun,
      kill: mocked.RunnerKill,
      isRunning: mocked.RunnerIsRunning,
    },
    effectiveToolState: {},
    env: {},
    allowMcp: true,
    selectedMcpServers: [],
    autoApproveEnabled: false,
    args: [],
    claudeSessionIdPreStored: false,
    codexOutputLastMessagePath: null,
    ...overrides,
  } as unknown as PreparedJobExecution;
}

function makeCtx(overrides: Record<string, unknown> = {}): AppContext {
  return {
    config: {
      claudeMcpAuthServer: null,
      codexMcpAuthServer: null,
      geminiMcpAuthServer: null,
    },
    conversationStore: { saveMessage: mocked.saveMessage },
    sessionManager: {
      get: vi.fn(() => ({ toolState: {} })),
      updateToolState: vi.fn(),
      mergeToolState: vi.fn(),
    },
    auditStore: { logJobComplete: vi.fn() },
    jobQueue: { enqueue: mocked.enqueue },
    switchPreflightBarriers: new Map(),
    jobEventStreams: new Map(),
    ...overrides,
  } as unknown as AppContext;
}

describe('runJobRuntime coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handles codex runtime home prepare failure', async () => {
    mocked.prepareCodexRuntimeHome.mockRejectedValueOnce(new Error('boom'));
    const prepared = makePrepared({ job: { tool: 'codex' } });
    const ctx = makeCtx();
    await runJobRuntime(ctx, prepared);
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'codex_runtime_home_prepare_failed',
      expect.objectContaining({ error: 'boom' }),
    );
  });

  it('handles gemini tool with prepareGeminiJobRuntime', async () => {
    const prepared = makePrepared({ job: { tool: 'gemini' } });
    const ctx = makeCtx();
    await runJobRuntime(ctx, prepared);
    expect(mocked.prepareGeminiJobRuntime).toHaveBeenCalled();
  });

  it('handles MCP connection failure for gemini (grace timer)', async () => {
    mocked.isMcpConnectionFailure.mockReturnValue(true);
    setRunnerRunImplementation(async (cb) => {
      cb({ type: 'status', content: 'Connection closed -32000' });
      await vi.advanceTimersByTimeAsync(50);
      return { exitCode: 1, errorKind: 'mcp_connection_failure', events: [], eventsDropped: false };
    });

    const prepared = makePrepared({ job: { tool: 'gemini' } });
    const ctx = makeCtx();
    await runJobRuntime(ctx, prepared);
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'mcp_connection_failure_detected',
      expect.any(Object),
    );
  });

  it('recovers from MCP connection failure when text event arrives', async () => {
    mocked.isMcpConnectionFailure.mockReturnValueOnce(true);
    setRunnerRunImplementation(async (cb) => {
      cb({ type: 'status', content: 'Connection closed -32000' });
      cb({ type: 'text', content: 'actual output' });
      return { exitCode: 0, errorKind: null, events: [], eventsDropped: false };
    });

    const prepared = makePrepared({ job: { tool: 'gemini' } });
    const ctx = makeCtx();
    await runJobRuntime(ctx, prepared);
    expect(mocked.loggerInfo).toHaveBeenCalledWith(
      'mcp_connection_failure_recovered',
      expect.objectContaining({ event_type: 'text' }),
    );
  });

  it('handles events dropped warning', async () => {
    mocked.RunnerRun.mockResolvedValue({
      exitCode: 0,
      errorKind: null,
      events: [],
      eventsDropped: true,
    });
    const prepared = makePrepared();
    const ctx = makeCtx();
    await runJobRuntime(ctx, prepared);
    expect(mocked.loggerWarn).toHaveBeenCalledWith('events_dropped', expect.any(Object));
  });

  it('MCP connection auto-retry when under max retries', async () => {
    mocked.isMcpConnectionFailure.mockReturnValue(true);
    mocked.RunnerIsRunning.mockReturnValue(true);
    setRunnerRunImplementation(async (cb) => {
      cb({ type: 'status', content: 'Connection closed' });
      await vi.advanceTimersByTimeAsync(50);
      return { exitCode: 1, errorKind: 'mcp_connection_failure', events: [], eventsDropped: false };
    });

    const prepared = makePrepared({
      job: { tool: 'gemini' },
      effectiveToolState: { mcp_conn_retry_count: 0 },
    });
    const ctx = makeCtx();
    const result = await runJobRuntime(ctx, prepared);
    expect(result.taskErrorKind).toBe('mcp_connection_retry_pending');
    expect(mocked.enqueue).toHaveBeenCalled();
  });

  it('sends dashboard text fallback when jobStream has no text emitted', async () => {
    const onEvent = vi.fn();
    const jobStream = { onEvent, onDone: vi.fn() };
    mocked.extractAnswerText.mockReturnValue('fallback text');
    mocked.RunnerRun.mockResolvedValue({
      exitCode: 0,
      errorKind: null,
      events: [],
      eventsDropped: false,
    });
    const prepared = makePrepared({ jobStream });
    const ctx = makeCtx();
    await runJobRuntime(ctx, prepared);
    expect(onEvent).toHaveBeenCalledWith({ type: 'text', content: 'fallback text' });
  });

  it('handles jobStream fallback event error', async () => {
    const onEvent = vi.fn().mockImplementation(() => {
      throw new Error('stream error');
    });
    const jobStream = { onEvent, onDone: vi.fn() };
    mocked.extractAnswerText.mockReturnValue('fallback');
    mocked.RunnerRun.mockResolvedValue({
      exitCode: 0,
      errorKind: null,
      events: [],
      eventsDropped: false,
    });
    const prepared = makePrepared({ jobStream });
    const ctx = makeCtx();
    await runJobRuntime(ctx, prepared);
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'job_stream_fallback_event_failed',
      expect.any(Object),
    );
  });

  it('appends text for non-claude/gemini tools', async () => {
    setRunnerRunImplementation(async (cb) => {
      cb({ type: 'text', content: 'codex output' });
      return { exitCode: 0, errorKind: null, events: [], eventsDropped: false };
    });
    const prepared = makePrepared({ job: { tool: 'codex' } });
    const ctx = makeCtx();
    await runJobRuntime(ctx, prepared);
    expect(prepared.messenger.appendText).toHaveBeenCalledWith('codex output');
  });

  it('forwards tool_use announcement with toolInput to messenger', async () => {
    setRunnerRunImplementation(async (cb) => {
      cb({
        type: 'tool_use',
        content: 'Using tool: Read',
        toolInput: { file_path: 'report.md' },
      });
      return { exitCode: 0, errorKind: null, events: [], eventsDropped: false };
    });
    const prepared = makePrepared();
    const ctx = makeCtx();
    await runJobRuntime(ctx, prepared);
    // messenger.appendText should have been called with a formatted tool-use line
    const calls = vi.mocked(prepared.messenger.appendText).mock.calls.map(([text]) => text);
    expect(
      calls.some((c: string) => c.includes('Using tool: Read') && c.includes('file_path')),
    ).toBe(true);
  });

  it('forwards tool_use announcement without toolInput to messenger', async () => {
    setRunnerRunImplementation(async (cb) => {
      cb({ type: 'tool_use', content: 'Using tool: Bash' });
      return { exitCode: 0, errorKind: null, events: [], eventsDropped: false };
    });
    const prepared = makePrepared();
    const ctx = makeCtx();
    await runJobRuntime(ctx, prepared);
    const calls = vi.mocked(prepared.messenger.appendText).mock.calls.map(([text]) => text);
    expect(calls.some((c: string) => c.includes('*Using tool: Bash*'))).toBe(true);
  });

  it('suppresses tool_use announcements when autoApproveEnabled is true', async () => {
    setRunnerRunImplementation(async (cb) => {
      cb({ type: 'tool_use', content: 'Using tool: Bash', toolInput: { command: 'ls' } });
      cb({ type: 'tool_use', content: 'Using tool: Read', toolInput: { file_path: 'a.ts' } });
      return { exitCode: 0, errorKind: null, events: [], eventsDropped: false };
    });
    const prepared = makePrepared({ autoApproveEnabled: true });
    const ctx = makeCtx();
    await runJobRuntime(ctx, prepared);
    // No tool announcement lines should reach messenger in auto-approve mode
    expect(prepared.messenger.appendText).not.toHaveBeenCalled();
  });

  it('does not forward streaming delta tool_use events to messenger', async () => {
    setRunnerRunImplementation(async (cb) => {
      // Delta events have partial JSON content, not "Using tool:" pattern
      cb({ type: 'tool_use', content: '{"file_path":"rep' });
      return { exitCode: 0, errorKind: null, events: [], eventsDropped: false };
    });
    const prepared = makePrepared();
    const ctx = makeCtx();
    await runJobRuntime(ctx, prepared);
    // messenger.appendText should NOT have been called for delta events
    expect(prepared.messenger.appendText).not.toHaveBeenCalled();
  });

  it('passes geminiMcpAuthServer when it is in selectedMcpServerNames (line 108)', async () => {
    const prepared = makePrepared({
      job: { tool: 'gemini' },
      selectedMcpServers: [{ name: 'auth-srv', url: 'http://mcp' }],
    });
    const ctx = makeCtx({
      config: {
        claudeMcpAuthServer: null,
        codexMcpAuthServer: null,
        geminiMcpAuthServer: 'auth-srv',
      },
    });
    await runJobRuntime(ctx, prepared);
    expect(mocked.prepareGeminiJobRuntime).toHaveBeenCalledWith(
      ctx,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'auth-srv',
    );
  });

  it('awaits switchBarrier when present (lines 132-133)', async () => {
    const barrier = Promise.resolve();
    const ctx = makeCtx();
    ctx.switchPreflightBarriers.set('sk1', barrier);
    const prepared = makePrepared();
    await runJobRuntime(ctx, prepared);
    expect(mocked.loggerInfo).toHaveBeenCalledWith(
      'awaiting_switch_preflight',
      expect.objectContaining({ session_key: 'sk1' }),
    );
  });

  it('logs error when jobStream.onEvent throws (lines 189-190)', async () => {
    const onEvent = vi.fn().mockImplementation((event: { type: string }) => {
      if (event.type === 'text') throw new Error('stream event fail');
    });
    const jobStream = { onEvent, onDone: vi.fn() };
    mocked.driverEventToChatEvent.mockReturnValue({ type: 'text', content: 'hello' });
    setRunnerRunImplementation(async (cb) => {
      cb({ type: 'text', content: 'hello' });
      return { exitCode: 0, errorKind: null, events: [], eventsDropped: false };
    });
    const prepared = makePrepared({ jobStream });
    const ctx = makeCtx();
    await runJobRuntime(ctx, prepared);
    expect(mocked.loggerError).toHaveBeenCalledWith(
      'job_stream_event_failed',
      expect.objectContaining({ error: 'stream event fail' }),
    );
  });

  it('blocks mcp_ tool when allowMcp=false and extracts name from content (line 207)', async () => {
    setRunnerRunImplementation(async (cb) => {
      cb({ type: 'tool_use', content: 'Using tool: mcp__server__tool' });
      return { exitCode: 1, errorKind: null, events: [], eventsDropped: false };
    });
    const prepared = makePrepared({ allowMcp: false });
    const ctx = makeCtx();
    await runJobRuntime(ctx, prepared);
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'mcp_tool_blocked_by_policy',
      expect.objectContaining({ tool: 'mcp__server__tool' }),
    );
    // runner.kill is called with 'mcp_blocked_by_policy' to stop the process
    expect(mocked.RunnerKill).toHaveBeenCalledWith('mcp_blocked_by_policy');
  });

  it('returns preflight abort outcome when shouldReturn is true', async () => {
    mocked.maybeRunJobPreflight.mockResolvedValueOnce({
      shouldReturn: true,
      env: {},
      sessionToolState: {},
      effectiveToolState: {},
      abortResult: {
        exitCode: 1,
        errorKind: 'mcp_preflight_aborted',
        outputSummary: 'aborted',
        outputRaw: 'aborted',
      },
    });
    const prepared = makePrepared();
    const ctx = makeCtx();
    const result = await runJobRuntime(ctx, prepared);
    expect(result.jobFailed).toBe(true);
    expect(result.taskErrorKind).toBe('mcp_preflight_aborted');
  });

  it('uses default abort result when abortResult is missing', async () => {
    mocked.maybeRunJobPreflight.mockResolvedValueOnce({
      shouldReturn: true,
      env: {},
      sessionToolState: {},
      effectiveToolState: {},
    });
    const prepared = makePrepared();
    const ctx = makeCtx();
    const result = await runJobRuntime(ctx, prepared);
    expect(result.jobFailed).toBe(true);
    expect(result.taskErrorKind).toBe('mcp_preflight_aborted');
  });
});
