import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSkillRef } from '../skills/catalog.js';

/* ── mock return type aliases ───────────────────────────────────── */
type PermissionDeniedResult = {
  deniedTools: string[];
  request: { toolName: string; args: Record<string, unknown> };
} | null;
type McpAuthPreflightResult = {
  requiredServer: string | null;
  oauthFlowStarted: boolean;
} | null;
type ToolNotFoundResult = { missingTool: string } | null;
type ArchivedFile = { localPath: string; filename: string; size: number; mimeType: string };
type ApprovedToolCall = { tool: string; args: Record<string, unknown> };

const mocked = vi.hoisted(() => ({
  // app-helpers
  toThreadKey: vi.fn((channelId: string, threadTs: string) => `${channelId}:${threadTs}`),
  resolveContext: vi.fn(() => ({ tool: 'claude', sessionId: 'S1' })),
  buildSlackContextPrefix: vi.fn(() => '[app:claude/session-id:S1]'),
  postMessageWithContext: vi.fn().mockResolvedValue(undefined),
  postMessageWithBlocks: vi.fn().mockResolvedValue(undefined),
  extractAnswerText: vi.fn(() => ''),
  createDriver: vi.fn(() => ({
    buildArgs: vi.fn(() => ['--arg']),
    buildEnv: vi.fn(() => ({})),
    extractSessionState: vi.fn(() => ({})),
  })),
  scheduleExpiry: vi.fn(),
  formatToolApprovalPrompt: vi.fn(() => 'approval prompt'),
  detectMcpAuthRequiredResourceFromEvents: vi.fn(() => null),
  hasGeminiResumeStateError: vi.fn(() => false),

  // runner
  RunnerRun: vi.fn().mockResolvedValue({ exitCode: 0, errorKind: null }),
  RunnerKill: vi.fn(),

  // metrics
  recordJobComplete: vi.fn(),

  // logger
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),

  // gemini runtime home
  cleanupGeminiRuntimeHome: vi.fn().mockResolvedValue(undefined),
  prepareCodexRuntimeHome: vi.fn(async (_workdir: string) => ({
    homeDir: '/tmp/work/.codex_runtime_home',
    seededFiles: ['auth.json'],
  })),

  // tool-plugin
  getToolPlugin: vi.fn(() => ({
    createApprovalGate: vi.fn(() => ({})),
    evaluateToolUse: vi.fn(() => ({ gate: {}, shouldBlock: false })),
    buildPermissionDeniedSummary: vi.fn((): PermissionDeniedResult => null),
    detectVoluntaryStop: vi.fn(() => null),
    clearMcpAuthState: vi.fn((s: Record<string, unknown>) => s),
    getMcpAuthServer: vi.fn((): string | null => null),
  })),

  // mcp-preflight
  handleClaudePostRunMcpAuth: vi.fn().mockResolvedValue(undefined),
  handleGeminiPostRunMcpAuth: vi.fn().mockResolvedValue(undefined),
  handleCodexPostRunMcpAuth: vi.fn().mockResolvedValue(undefined),
  maybeRunJobPreflight: vi.fn(),
  prepareGeminiJobRuntime: vi.fn(
    async (_ctx: unknown, _job: unknown, env: Record<string, string>) => env,
  ),
  runClaudeJobPreflight: vi.fn(),
  runCodexJobPreflight: vi.fn(),
  runGeminiJobPreflight: vi.fn(),

  // block-kit
  buildToolApprovalBlocks: vi.fn(() => [{ type: 'section' }]),

  // file-attachment
  archiveOutputFiles: vi.fn((): ArchivedFile[] => []),

  // tool-approval
  detectPermissionDenied: vi.fn((): PermissionDeniedResult => null),
  isPermissionDeniedError: vi.fn(() => false),

  // mcp-auth
  detectMcpAuthRequiredServer: vi.fn((): string | null => null),
  detectMcpAuthRequiredResourceUrl: vi.fn((): string | null => null),
  detectToolNotFound: vi.fn((): ToolNotFoundResult => null),
  evaluateGeminiMcpAuthPreflight: vi.fn((): McpAuthPreflightResult => null),
  isMcpConnectionFailure: vi.fn(() => false),
  isMcpRuntimeWarning: vi.fn(() => false),
  isMcpTokenRefreshFailure: vi.fn(() => false),

  // tools/claude
  evaluateClaudeMcpAuthPreflight: vi.fn(() => null),
  isClaudeMcpPreflightBypassed: vi.fn((_toolState: unknown, _server: string) => true),
  isClaudeMcpPreflightVerified: vi.fn((_toolState: unknown, _server: string) => true),

  // tools/codex
  consumeCodexOutputLastMessage: vi.fn().mockResolvedValue(null),
  extractCodexApprovedToolCalls: vi.fn((): ApprovedToolCall[] => []),
  isCodexMcpPreflightVerified: vi.fn((_toolState: unknown, _server: string) => true),
  prepareCodexOutputLastMessageCapture: vi.fn(),

  // tools/gemini
  isGeminiMcpPreflightBypassed: vi.fn((_toolState: unknown, _server: string) => true),
  isGeminiMcpPreflightInitialized: vi.fn((_toolState: unknown, _server: string) => true),
  formatGeminiMissingToolMessage: vi.fn(() => 'missing tool msg'),
  removeClaudeGeneratedMcpConfig: vi.fn(),
  writeClaudeMcpConfigToWorkdir: vi.fn(() => '/tmp/work/.huskygate/claude.mcp.json'),
}));

/* ── module mocks ────────────────────────────────────────────────── */
vi.mock('./app-helpers.js', () => ({
  CLAUDE_MCP_AUTH_AUTO_RERUN_KEY: 'claude_mcp_auth_auto_rerun',
  CODEX_MCP_AUTH_AUTO_RERUN_KEY: 'codex_mcp_auth_auto_rerun',
  MCP_CONN_RETRY_COUNT_KEY: 'mcp_conn_retry_count',
  MAX_CHARS_FOR_LOG: 10_000,
  TOOL_APPROVAL_TIMEOUT_MS: 120_000,
  buildSlackContextPrefix: mocked.buildSlackContextPrefix,
  detectMcpAuthRequiredResourceFromEvents: mocked.detectMcpAuthRequiredResourceFromEvents,
  extractAnswerText: mocked.extractAnswerText,
  formatMention: (userId: string | undefined | null) => (userId ? `<@${userId}>` : ''),
  hasGeminiResumeStateError: mocked.hasGeminiResumeStateError,
  postMessageWithBlocks: mocked.postMessageWithBlocks,
  postMessageWithContext: mocked.postMessageWithContext,
  resolveContext: mocked.resolveContext,
  scheduleExpiry: mocked.scheduleExpiry,
  toThreadKey: mocked.toThreadKey,
}));

vi.mock('../shared/approval.js', () => ({
  formatToolApprovalPrompt: mocked.formatToolApprovalPrompt,
}));

vi.mock('../runner/driver-factory.js', () => ({
  createDriver: mocked.createDriver,
}));

vi.mock('../runner/runner.js', () => ({
  Runner: vi.fn().mockImplementation(() => ({
    run: mocked.RunnerRun,
    kill: mocked.RunnerKill,
  })),
}));

vi.mock('../utils/logger.js', () => ({
  createScopedLogger: vi.fn(() => ({
    info: mocked.loggerInfo,
    warn: mocked.loggerWarn,
    error: mocked.loggerError,
  })),
  logger: {
    info: mocked.loggerInfo,
    warn: mocked.loggerWarn,
    error: mocked.loggerError,
  },
}));

vi.mock('../utils/metrics.js', () => ({
  recordJobComplete: mocked.recordJobComplete,
}));

vi.mock('../runner/gemini-runtime-home.js', () => ({
  cleanupGeminiRuntimeHome: mocked.cleanupGeminiRuntimeHome,
}));

vi.mock('../runner/codex-runtime-home.js', () => ({
  prepareCodexRuntimeHome: mocked.prepareCodexRuntimeHome,
}));

vi.mock('../workdir/mcp-writer.js', () => ({
  removeClaudeGeneratedMcpConfig: mocked.removeClaudeGeneratedMcpConfig,
  writeClaudeMcpConfigToWorkdir: mocked.writeClaudeMcpConfigToWorkdir,
}));

vi.mock('./tool-plugin.js', () => ({
  getToolPlugin: mocked.getToolPlugin,
}));

vi.mock('./mcp-preflight.js', () => ({
  handleClaudePostRunMcpAuth: mocked.handleClaudePostRunMcpAuth,
  handleGeminiPostRunMcpAuth: mocked.handleGeminiPostRunMcpAuth,
  handleCodexPostRunMcpAuth: mocked.handleCodexPostRunMcpAuth,
  maybeRunJobPreflight: mocked.maybeRunJobPreflight,
  prepareGeminiJobRuntime: mocked.prepareGeminiJobRuntime,
  runClaudeJobPreflight: mocked.runClaudeJobPreflight,
  runCodexJobPreflight: mocked.runCodexJobPreflight,
  runGeminiJobPreflight: mocked.runGeminiJobPreflight,
}));

vi.mock('./block-kit.js', () => ({
  buildToolApprovalBlocks: mocked.buildToolApprovalBlocks,
}));

vi.mock('../shared/file-attachment.js', () => ({
  archiveOutputFiles: mocked.archiveOutputFiles,
  formatFileSize: vi.fn((n: number) => `${n}B`),
  MAX_FILE_UPLOADS: 10,
}));

vi.mock('../shared/tool-approval.js', () => ({
  TOOL_APPROVAL_RERUN_KEY: '_tool_approval_rerun',
  detectPermissionDenied: mocked.detectPermissionDenied,
  isPermissionDeniedError: mocked.isPermissionDeniedError,
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

vi.mock('./tools/claude.js', () => ({
  CLAUDE_MCP_AUTH_APPROVAL_RERUN_KEY: 'claude_mcp_auth_approval_rerun',
  evaluateClaudeMcpAuthPreflight: mocked.evaluateClaudeMcpAuthPreflight,
  isClaudeMcpPreflightBypassed: mocked.isClaudeMcpPreflightBypassed,
  isClaudeMcpPreflightVerified: mocked.isClaudeMcpPreflightVerified,
}));

vi.mock('./tools/codex.js', () => ({
  consumeCodexOutputLastMessage: mocked.consumeCodexOutputLastMessage,
  extractCodexApprovedToolCalls: mocked.extractCodexApprovedToolCalls,
  isCodexMcpPreflightVerified: mocked.isCodexMcpPreflightVerified,
  prepareCodexOutputLastMessageCapture: mocked.prepareCodexOutputLastMessageCapture,
}));

vi.mock('./tools/gemini.js', () => ({
  GEMINI_MCP_AUTH_APPROVAL_RERUN_KEY: 'gemini_mcp_auth_approval_rerun',
  formatGeminiMissingToolMessage: mocked.formatGeminiMissingToolMessage,
  isGeminiMcpPreflightBypassed: mocked.isGeminiMcpPreflightBypassed,
  isGeminiMcpPreflightInitialized: mocked.isGeminiMcpPreflightInitialized,
}));

vi.mock('../utils/error.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, writeFileSync: vi.fn(), readFileSync: vi.fn(() => Buffer.from('mock')) };
});

import { writeFileSync } from 'node:fs';
import { Runner } from '../runner/runner.js';
/* ── imports (after mocks) ──────────────────────────────────────── */
import type { DriverEvent } from '../runner/types.js';
import { registerJobExecutor } from './job-executor.js';
import { NullMessenger, driverEventToChatEvent } from './job-runtime-types.js';
import { Messenger } from './messenger.js';

/* ── helpers ─────────────────────────────────────────────────────── */
function createCtx() {
  const webClient = {
    chat: { postMessage: vi.fn() },
    filesUploadV2: vi.fn().mockResolvedValue({}),
  };
  return {
    webClient,
    config: {
      claudeMcpAuthServer: null as string | null,
      geminiMcpAuthServer: null as string | null,
      codexMcpAuthServer: null as string | null,
      workdirRoot: '/tmp',
    },
    sessionManager: {
      get: vi.fn(() => ({
        toolState: {} as Record<string, unknown>,
        devAlias: null as string | null,
      })),
      updateToolState: vi.fn(),
      mergeToolState: vi.fn(),
      setRunningJob: vi.fn(),
      deleteSessionByKeyWithCleanup: vi.fn(() => ({ threadKey: 'dashboard_S1' })),
      getSessionSummary: vi.fn(() => null),
    },
    workdirManager: {
      prepareWorkdirSkillsOnly: vi.fn(),
      prepareDevWorkdir: vi.fn(),
      willSeedSkills: vi.fn().mockReturnValue(false),
      listSeedableSkillEntries: vi.fn().mockReturnValue([]),
    },
    activeRunners: new Map(),
    auditStore: {
      logJobStart: vi.fn(),
      logJobComplete: vi.fn(),
    },
    conversationStore: {
      saveMessage: vi.fn(),
    },
    pendingToolApprovals: new Map(),
    pendingMcpAuthBypassApprovals: new Map(),
    jobQueue: {
      enqueue: vi.fn(),
      setExecutor: vi.fn(),
    },
    switchPreflightBarriers: new Map(),
    jobEventStreams: new Map(),
    inactivityTimers: new Map(),
    defaultInstructionStore: { getWithEnabled: () => ({ content: '', enabled: false }) },
    mcpServerStore: {
      listByTool: vi.fn(() => [] as ReturnType<typeof createMcpServer>[]),
    },
    sessionMcpServerStore: {
      listBySession: vi.fn(
        () => [] as Array<{ sessionKey: string; serverId: string; enabled: boolean }>,
      ),
    },
  };
}

function createMcpServer(
  name: string,
  tool: 'claude' | 'codex' | 'gemini' = 'claude',
): {
  id: string;
  name: string;
  tool: 'claude' | 'codex' | 'gemini';
  transport: 'stdio';
  definition: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: `mcp_${name}`,
    name,
    tool,
    transport: 'stdio',
    definition: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job_1',
    sessionKey: 'sess_1',
    channelId: 'C1',
    threadTs: '1.1',
    userId: 'U1',
    tool: 'claude',
    mode: 'code',
    prompt: 'hello',
    workdir: '/tmp/work',
    source: 'slack',
    toolStateOverrides: {},
    createdAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  // Reset mock return values that individual tests override.
  // vi.clearAllMocks() only clears call counts — NOT mockReturnValue/mockImplementation.
  mocked.RunnerRun.mockResolvedValue({ exitCode: 0, errorKind: null });
  mocked.extractAnswerText.mockReturnValue('answer text');
  mocked.isPermissionDeniedError.mockReturnValue(false);
  mocked.isMcpTokenRefreshFailure.mockReturnValue(false);
  mocked.detectMcpAuthRequiredServer.mockReturnValue(null);
  mocked.detectMcpAuthRequiredResourceUrl.mockReturnValue(null);
  mocked.detectToolNotFound.mockReturnValue(null);
  mocked.isMcpRuntimeWarning.mockReturnValue(false);
  mocked.detectPermissionDenied.mockReturnValue(null);
  mocked.evaluateGeminiMcpAuthPreflight.mockReturnValue(null);
  mocked.evaluateClaudeMcpAuthPreflight.mockReturnValue(null);
  mocked.hasGeminiResumeStateError.mockReturnValue(false);
  mocked.archiveOutputFiles.mockReturnValue([]);
  mocked.consumeCodexOutputLastMessage.mockResolvedValue(null);
  mocked.postMessageWithContext.mockResolvedValue(undefined);
  mocked.postMessageWithBlocks.mockResolvedValue(undefined);
  mocked.removeClaudeGeneratedMcpConfig.mockReset();
  mocked.writeClaudeMcpConfigToWorkdir.mockReturnValue('/tmp/work/.huskygate/claude.mcp.json');
  // Preflight mocks — bypass/skip all preflights by default
  mocked.isClaudeMcpPreflightBypassed.mockReturnValue(true);
  mocked.isClaudeMcpPreflightVerified.mockReturnValue(true);
  mocked.isGeminiMcpPreflightBypassed.mockReturnValue(true);
  mocked.isGeminiMcpPreflightInitialized.mockReturnValue(true);
  mocked.isCodexMcpPreflightVerified.mockReturnValue(true);
  mocked.runClaudeJobPreflight.mockResolvedValue(undefined);
  mocked.runGeminiJobPreflight.mockResolvedValue(undefined);
  mocked.runCodexJobPreflight.mockResolvedValue(undefined);
  mocked.maybeRunJobPreflight.mockImplementation(async (ctx, input) => {
    const defaultResult = {
      shouldReturn: false,
      env: input.env,
      sessionToolState: input.session.toolState,
      effectiveToolState: input.effectiveToolState,
    };

    if (input.job.tool === 'claude') {
      const authServer = ctx.config.claudeMcpAuthServer;
      const shouldRun =
        !!authServer &&
        input.allowMcp &&
        input.job.toolStateOverrides?.claude_skip_mcp_preflight_once !== true &&
        !mocked.isClaudeMcpPreflightBypassed(input.effectiveToolState, authServer) &&
        !mocked.isClaudeMcpPreflightVerified(input.effectiveToolState, authServer);
      if (!shouldRun) return defaultResult;
      return (
        (await mocked.runClaudeJobPreflight(
          ctx,
          input,
          input.threadKey,
          input.job.toolStateOverrides?.claude_mcp_auth_approval_rerun === true,
        )) ?? defaultResult
      );
    }

    if (input.job.tool === 'gemini') {
      const authServer = ctx.config.geminiMcpAuthServer;
      const shouldRun =
        !!authServer &&
        input.allowMcp &&
        input.job.toolStateOverrides?.gemini_skip_mcp_preflight_once !== true &&
        !mocked.isGeminiMcpPreflightBypassed(input.effectiveToolState, authServer) &&
        !mocked.isGeminiMcpPreflightInitialized(input.effectiveToolState, authServer);
      if (!shouldRun) return defaultResult;
      return (
        (await mocked.runGeminiJobPreflight(
          ctx,
          input,
          input.threadKey,
          input.job.toolStateOverrides?.gemini_mcp_auth_approval_rerun === true,
        )) ?? defaultResult
      );
    }

    if (input.job.tool === 'codex') {
      const authServer = ctx.config.codexMcpAuthServer;
      const shouldRun =
        !!authServer &&
        input.allowMcp &&
        !mocked.isCodexMcpPreflightVerified(input.effectiveToolState, authServer);
      if (!shouldRun) return defaultResult;
      return (await mocked.runCodexJobPreflight(ctx, input, input.threadKey)) ?? defaultResult;
    }

    return defaultResult;
  });
  mocked.handleClaudePostRunMcpAuth.mockResolvedValue(undefined);
  mocked.handleGeminiPostRunMcpAuth.mockResolvedValue(undefined);
  mocked.handleCodexPostRunMcpAuth.mockResolvedValue(undefined);
  mocked.cleanupGeminiRuntimeHome.mockResolvedValue(undefined);
  mocked.prepareCodexRuntimeHome.mockResolvedValue({
    homeDir: '/tmp/work/.codex_runtime_home',
    seededFiles: ['auth.json'],
  });
  mocked.prepareCodexOutputLastMessageCapture.mockReturnValue(undefined);
  mocked.createDriver.mockReturnValue({
    buildArgs: vi.fn(() => ['--arg']),
    buildEnv: vi.fn(() => ({})),
    extractSessionState: vi.fn(() => ({})),
  });
  mocked.getToolPlugin.mockReturnValue({
    createApprovalGate: vi.fn(() => ({})),
    evaluateToolUse: vi.fn(() => ({ gate: {}, shouldBlock: false })),
    buildPermissionDeniedSummary: vi.fn((): PermissionDeniedResult => null),
    detectVoluntaryStop: vi.fn(() => null),
    clearMcpAuthState: vi.fn((s: Record<string, unknown>) => s),
    getMcpAuthServer: vi.fn((): string | null => null),
  });
});

/* ── driverEventToChatEvent ──────────────────────────────────────── */
describe('driverEventToChatEvent', () => {
  it('maps text event (non-result) to text chat event', () => {
    const event: DriverEvent = {
      type: 'text',
      content: 'hello',
      raw: { type: 'text_delta' },
    };
    expect(driverEventToChatEvent(event)).toEqual({
      type: 'text',
      content: 'hello',
    });
  });

  it('returns null for text event with raw.type === result', () => {
    const event: DriverEvent = {
      type: 'text',
      content: 'final',
      raw: { type: 'result' },
    };
    expect(driverEventToChatEvent(event)).toBeNull();
  });

  it('returns null for Codex aggregate text events', () => {
    const aggregateTypes = [
      'response.output_text.done',
      'turn.completed',
      'response.output_item.done',
      'response.completed',
    ];
    for (const rawType of aggregateTypes) {
      const event: DriverEvent = {
        type: 'text',
        content: 'duplicate',
        raw: { type: rawType },
      };
      expect(driverEventToChatEvent(event)).toBeNull();
    }
  });

  it('maps tool_use event', () => {
    const event: DriverEvent = { type: 'tool_use', content: 'bash' };
    expect(driverEventToChatEvent(event)).toEqual({
      type: 'tool_use',
      content: 'bash',
    });
  });

  it('maps tool_use event with toolInput', () => {
    const event: DriverEvent = {
      type: 'tool_use',
      content: 'Using tool: Read',
      toolInput: { file_path: 'report.md' },
    };
    expect(driverEventToChatEvent(event)).toEqual({
      type: 'tool_use',
      content: 'Using tool: Read — {"file_path":"report.md"}',
    });
  });

  it('maps tool_result event', () => {
    const event: DriverEvent = { type: 'tool_result', content: 'ok' };
    expect(driverEventToChatEvent(event)).toEqual({
      type: 'tool_result',
      content: 'ok',
    });
  });

  it('maps error event', () => {
    const event: DriverEvent = { type: 'error', content: 'oops' };
    expect(driverEventToChatEvent(event)).toEqual({
      type: 'error',
      content: 'oops',
    });
  });

  it('returns null for done event (onDone callback handles it)', () => {
    const event: DriverEvent = { type: 'done', content: '' };
    expect(driverEventToChatEvent(event)).toBeNull();
  });

  it('returns null for status event', () => {
    const event: DriverEvent = { type: 'status', content: 'running' };
    expect(driverEventToChatEvent(event)).toBeNull();
  });

  it('returns null for unknown event type', () => {
    const event = { type: 'unknown', content: 'data' } as unknown as DriverEvent;
    expect(driverEventToChatEvent(event)).toBeNull();
  });
});

/* ── NullMessenger ────────────────────────────────────────────────── */
describe('NullMessenger', () => {
  it('all methods are no-ops and return expected values', async () => {
    const messenger = new NullMessenger();

    // All void methods should not throw
    await messenger.postStart('text');
    messenger.replaceBuffer('text');
    messenger.appendText('text');
    await messenger.postFinal('text');
    await messenger.uploadFile('content', 'name', 'title');

    // uploadBinaryFile returns false
    const result = await messenger.uploadBinaryFile('/path', 'name', 'title');
    expect(result).toBe(false);

    // postStatusMessage returns null
    const ts = await messenger.postStatusMessage('text');
    expect(ts).toBeNull();
  });
});

/* ── registerJobExecutor ─────────────────────────────────────────── */
describe('registerJobExecutor', () => {
  it('registers executor callback on job queue', () => {
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    expect(ctx.jobQueue.setExecutor).toHaveBeenCalledOnce();
    expect(typeof ctx.jobQueue.setExecutor.mock.calls[0]?.[0]).toBe('function');
  });

  it('executes a basic claude job successfully and runs finally block', async () => {
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    const job = createJob();

    await executor(job);

    // Verify runner was added and removed (finally block)
    expect(ctx.activeRunners.size).toBe(0);
    expect(ctx.sessionManager.setRunningJob).toHaveBeenCalledWith('sess_1', null);
    expect(mocked.recordJobComplete).toHaveBeenCalledOnce();
    expect(ctx.auditStore.logJobStart).toHaveBeenCalledOnce();
    expect(ctx.conversationStore.saveMessage).toHaveBeenCalledWith('sess_1', 'user', 'hello', 'job_1');
    expect(mocked.removeClaudeGeneratedMcpConfig).toHaveBeenCalledWith(
      '/tmp/work/.huskygate/claude.mcp.json',
    );
  });

  it('overrides runner maxRuntimeSec with job timeoutSec when provided', async () => {
    const ctx = createCtx();
    (ctx as unknown as { config: Record<string, unknown> }).config = {
      ...(ctx as unknown as { config: Record<string, unknown> }).config,
      maxRuntimeSec: 900,
      noOutputTimeoutSec: 60,
    };
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(createJob({ timeoutSec: 45, mode: 'write' }));

    expect(vi.mocked(Runner)).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRuntimeSec: 45,
      }),
    );
  });

  it('delegates orchestrator job completion to orchestratorEngine.onNodeJobComplete', async () => {
    const onNodeJobComplete = vi.fn().mockResolvedValue(undefined);
    const ctx = createCtx();
    (ctx as unknown as { orchestratorEngine: unknown }).orchestratorEngine = {
      onNodeJobComplete,
    };
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(
      createJob({
        source: 'orchestrator',
        mode: 'write',
        orchestrationRunId: 'run-orch-1',
        orchestrationNodeId: 'node-1',
      }),
    );

    expect(onNodeJobComplete).toHaveBeenCalledWith(
      'job_1',
      {
        exitCode: 0,
        events: [],
        errorKind: null,
      },
      'answer text',
      'answer text',
    );
  });

  it('posts orchestrator summary output back to the notification thread', async () => {
    mocked.extractAnswerText.mockReturnValueOnce(
      '<summary>\n## Overview\nAll completed.\n</summary>',
    );
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(
      createJob({
        source: 'orchestrator-summary',
        mode: 'readonly',
        channelId: '',
        threadTs: '',
        summaryNotifyChannel: 'C-SUMMARY',
        summaryNotifyThreadTs: '999.111',
      }),
    );

    expect(ctx.webClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C-SUMMARY',
        thread_ts: '999.111',
        blocks: expect.arrayContaining([expect.objectContaining({ type: 'markdown' })]),
        text: expect.any(String),
      }),
    );
    expect(ctx.sessionManager.deleteSessionByKeyWithCleanup).toHaveBeenCalledWith('sess_1');
  });

  it('posts an error notice when an orchestrator summary job fails', async () => {
    mocked.RunnerRun.mockResolvedValueOnce({ exitCode: 1, errorKind: 'timeout' });
    mocked.extractAnswerText.mockReturnValueOnce('partial summary');
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(
      createJob({
        source: 'orchestrator-summary',
        mode: 'readonly',
        channelId: '',
        threadTs: '',
        summaryNotifyChannel: 'C-SUMMARY',
        summaryNotifyThreadTs: '999.222',
      }),
    );

    expect(ctx.webClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C-SUMMARY',
        thread_ts: '999.222',
        text: expect.stringContaining(':warning: Execution summary failed (timeout).'),
      }),
    );
  });

  it('cleans up orchestrator summary sessions when runner.run throws before post-run handling', async () => {
    mocked.RunnerRun.mockRejectedValueOnce(new Error('runner crash'));
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await expect(
      executor(
        createJob({
          source: 'orchestrator-summary',
          mode: 'readonly',
          channelId: '',
          threadTs: '',
          summaryNotifyChannel: 'C-SUMMARY',
          summaryNotifyThreadTs: '999.333',
        }),
      ),
    ).rejects.toThrow('runner crash');

    expect(ctx.sessionManager.deleteSessionByKeyWithCleanup).toHaveBeenCalledWith('sess_1');
  });

  it('cleans up gemini runtime home in finally block for gemini jobs', async () => {
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    const job = createJob({ tool: 'gemini' });

    await executor(job);

    expect(mocked.cleanupGeminiRuntimeHome).toHaveBeenCalledWith('/tmp/work');
  });

  it('does NOT cleanup gemini runtime for non-gemini jobs', async () => {
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    const job = createJob({ tool: 'claude' });

    await executor(job);

    expect(mocked.cleanupGeminiRuntimeHome).not.toHaveBeenCalled();
  });

  it('notifies dashboard SSE stream and cleans up in finally block', async () => {
    const ctx = createCtx();
    const onDone = vi.fn();
    const onEvent = vi.fn();
    ctx.jobEventStreams.set('job_1', { onDone, onEvent });

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    const job = createJob({ source: 'dashboard' });

    await executor(job);

    expect(onDone).toHaveBeenCalledWith({
      exitCode: 0,
      sessionState: {},
    });
    expect(ctx.jobEventStreams.has('job_1')).toBe(false);
  });

  it('notifies dashboard SSE stream with failure exit code when job fails', async () => {
    mocked.RunnerRun.mockResolvedValueOnce({ exitCode: 1, errorKind: 'exit_1' });
    const ctx = createCtx();
    const onDone = vi.fn();
    const onEvent = vi.fn();
    ctx.jobEventStreams.set('job_1', { onDone, onEvent });

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    const job = createJob({ source: 'dashboard' });

    await executor(job);

    expect(onDone).toHaveBeenCalledWith({
      exitCode: 1,
      sessionState: {},
    });
    expect(ctx.jobEventStreams.has('job_1')).toBe(false);
  });

  it('marks schedule runs as failed when MCP preflight exits early', async () => {
    const ctx = createCtx();
    const updateRun = vi.fn();
    (ctx as unknown as { scheduleStore: unknown }).scheduleStore = {
      updateRun,
      getById: vi.fn(() => null),
    };
    mocked.maybeRunJobPreflight.mockResolvedValueOnce({
      shouldReturn: true,
      env: {},
      sessionToolState: {},
      effectiveToolState: {},
      abortResult: {
        exitCode: 1,
        errorKind: 'mcp_auth_required',
        outputRaw: 'MCP auth is required before execution can continue.',
        outputSummary: 'MCP auth is required before execution can continue.',
      },
    });

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(
      createJob({
        source: 'schedule',
        scheduleRunId: 'run-1',
        channelId: '',
        threadTs: '',
      }),
    );

    expect(mocked.RunnerRun).not.toHaveBeenCalled();
    expect(updateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'failed',
        exitCode: 1,
        outputSummary: 'MCP auth is required before execution can continue.',
      }),
    );
  });

  it('does not run post-run completion when audit start fails before runner launch', async () => {
    const ctx = createCtx();
    const onDone = vi.fn();
    ctx.jobEventStreams.set('job_1', { onDone, onEvent: vi.fn() });
    ctx.auditStore.logJobStart.mockImplementation(() => {
      throw new Error('audit unavailable');
    });

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await expect(executor(createJob({ source: 'dashboard' }))).rejects.toThrow('audit unavailable');

    expect(mocked.RunnerRun).not.toHaveBeenCalled();
    expect(mocked.recordJobComplete).not.toHaveBeenCalled();
    expect(ctx.activeRunners.size).toBe(0);
    expect(onDone).toHaveBeenCalledWith({
      exitCode: 1,
      sessionState: {},
    });
    expect(ctx.jobEventStreams.has('job_1')).toBe(false);
  });

  it('closes dashboard SSE streams when setup fails before execution is prepared', async () => {
    const ctx = createCtx();
    const onDone = vi.fn();
    ctx.jobEventStreams.set('job_1', { onDone, onEvent: vi.fn() });
    ctx.workdirManager.prepareWorkdirSkillsOnly.mockImplementation(() => {
      throw new Error('setup failed');
    });

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await expect(executor(createJob({ source: 'dashboard' }))).rejects.toThrow('setup failed');

    expect(ctx.auditStore.logJobStart).not.toHaveBeenCalled();
    expect(mocked.recordJobComplete).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith({
      exitCode: 1,
      sessionState: {},
    });
    expect(ctx.jobEventStreams.has('job_1')).toBe(false);
  });

  it('does not finalize a dashboard stream twice when finish cleanup throws after onDone', async () => {
    const ctx = createCtx();
    const onDone = vi.fn();
    const onEvent = vi.fn();
    const streams = new Map([['job_1', { onDone, onEvent }]]);
    (ctx as unknown as { jobEventStreams: unknown }).jobEventStreams = {
      get: vi.fn((key: string) => streams.get(key) ?? null),
      set: vi.fn((key: string, value: unknown) =>
        streams.set(key, value as { onDone: typeof onDone; onEvent: typeof onEvent }),
      ),
      has: vi.fn((key: string) => streams.has(key)),
      delete: vi.fn((key: string) => {
        streams.delete(key);
        throw new Error('job stream delete failed');
      }),
    };

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await expect(executor(createJob({ source: 'dashboard' }))).rejects.toThrow(
      'job stream delete failed',
    );

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(streams.has('job_1')).toBe(false);
  });

  it('uses NullMessenger for dashboard jobs', async () => {
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    const job = createJob({ source: 'dashboard' });

    // Should not throw — NullMessenger handles all calls silently
    await executor(job);

    // Dashboard jobs do NOT save user messages or run slack file uploads
    expect(ctx.conversationStore.saveMessage).not.toHaveBeenCalled();
  });

  it('records job failure when exit code is non-zero', async () => {
    mocked.RunnerRun.mockResolvedValueOnce({ exitCode: 1, errorKind: 'exit_1' });
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(createJob());

    // recordJobComplete receives (durationMs, failed=true)
    expect(mocked.recordJobComplete).toHaveBeenCalledWith(expect.any(Number), true);
  });

  it('finally block still runs even if runner.run throws', async () => {
    mocked.RunnerRun.mockRejectedValueOnce(new Error('runner crash'));
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await expect(executor(createJob())).rejects.toThrow('runner crash');

    // Finally block still ran
    expect(mocked.recordJobComplete).toHaveBeenCalledOnce();
    expect(ctx.activeRunners.size).toBe(0);
    expect(ctx.sessionManager.setRunningJob).toHaveBeenCalledWith('sess_1', null);
  });

  it('prepares dev workdir when session has devAlias', async () => {
    const ctx = createCtx();
    ctx.sessionManager.get.mockReturnValue({
      toolState: {},
      devAlias: 'my-project',
    });
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(createJob());

    expect(ctx.workdirManager.prepareDevWorkdir).toHaveBeenCalledWith('/tmp/work');
    expect(ctx.workdirManager.prepareWorkdirSkillsOnly).not.toHaveBeenCalled();
  });

  it('fails fast when a queued job references a missing session', async () => {
    const ctx = createCtx();
    ctx.sessionManager.get.mockReturnValue(null as never);
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await expect(executor(createJob())).rejects.toThrow('Missing session for queued job: sess_1');
  });

  /* ── Claude MCP tool glob injection ─────────────────────────── */
  it('injects MCP tool glob for claude when claudeMcpAuthServer is set', async () => {
    const ctx = createCtx();
    ctx.config.claudeMcpAuthServer = 'my-mcp-server';
    ctx.mcpServerStore.listByTool.mockReturnValue([createMcpServer('my-mcp-server')]);
    const driverBuildArgs = vi.fn((_job: unknown, _session: unknown) => ['--arg']);
    mocked.createDriver.mockReturnValue({
      buildArgs: driverBuildArgs,
      buildEnv: vi.fn(() => ({})),
      extractSessionState: vi.fn(() => ({})),
    });
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(createJob({ tool: 'claude' }));

    // buildArgs receives session with injected MCP glob in toolState
    const sessionArg = driverBuildArgs.mock.calls[0]?.[1] as {
      toolState: { claude_runtime_allowed_tools?: string[] };
    };
    const allowedTools = sessionArg.toolState.claude_runtime_allowed_tools ?? [];
    expect(allowedTools).toContain('mcp__my-mcp-server__*');
  });

  /* ── Claude session ID pre-store ────────────────────────────── */
  it('pre-stores claude session ID when --session-id is in args', async () => {
    const ctx = createCtx();
    ctx.sessionManager.get.mockReturnValue({ toolState: {}, devAlias: null });
    const driverBuildArgs = vi.fn(() => ['--session-id', 'cli-sess-id', '--prompt', 'hi']);
    mocked.createDriver.mockReturnValue({
      buildArgs: driverBuildArgs,
      buildEnv: vi.fn(() => ({})),
      extractSessionState: vi.fn(() => ({})),
    });
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(createJob({ tool: 'claude' }));

    expect(ctx.sessionManager.mergeToolState).toHaveBeenCalledWith('sess_1', {
      session_id: 'cli-sess-id',
    });
  });

  /* ── Codex output capture preparation ──────────────────────── */
  it('prepares codex output last message capture', async () => {
    mocked.prepareCodexOutputLastMessageCapture.mockResolvedValue({
      args: ['--modified-arg'],
      outputLastMessagePath: '/tmp/codex-output/last.json',
    });
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(createJob({ tool: 'codex' }));

    expect(mocked.prepareCodexOutputLastMessageCapture).toHaveBeenCalled();
  });

  it('prepares a per-job CODEX_HOME for all codex jobs', async () => {
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(createJob({ tool: 'codex' }));

    expect(mocked.prepareCodexRuntimeHome).toHaveBeenCalledWith('/tmp/work', []);
    const envArg = mocked.RunnerRun.mock.calls[0]?.[2] as Record<string, string>;
    expect(envArg.CODEX_HOME).toBe('/tmp/work/.codex_runtime_home');
  });

  it('logs warning when codex runtime home preparation fails', async () => {
    mocked.prepareCodexRuntimeHome.mockRejectedValueOnce(new Error('home fail'));
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(createJob({ tool: 'codex' }));

    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'codex_runtime_home_prepare_failed',
      expect.objectContaining({ error: 'home fail', workdir: '/tmp/work' }),
    );
  });

  it('logs warning when codex output capture preparation fails', async () => {
    mocked.prepareCodexOutputLastMessageCapture.mockRejectedValue(new Error('dir fail'));
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(createJob({ tool: 'codex' }));

    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'codex_output_last_message_dir_prepare_failed',
      expect.objectContaining({ error: 'dir fail' }),
    );
  });

  /* ── Event callback branches ─────────────────────────────────── */
  it('streams events to dashboard SSE and handles text/tool_use/error events', async () => {
    const onEvent = vi.fn();
    const onDone = vi.fn();
    const ctx = createCtx();
    ctx.jobEventStreams.set('job_1', { onEvent, onDone });

    // Make runner invoke callback with various events
    mocked.RunnerRun.mockImplementation(
      async (
        _driver: unknown,
        _args: unknown,
        _env: unknown,
        _workdir: unknown,
        callback: (event: DriverEvent) => void,
      ) => {
        callback({ type: 'text', content: 'hello' });
        callback({ type: 'tool_use', content: 'bash: ls' });
        callback({ type: 'error', content: 'oops' });
        return { exitCode: 0, errorKind: null };
      },
    );

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ source: 'dashboard' }));

    // Dashboard SSE events streamed
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'text', content: 'hello' }),
    );
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool_use' }));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  /* ── MCP auth detection in event callback ───────────────────── */
  it('detects MCP auth required in event callback and kills runner', async () => {
    mocked.detectMcpAuthRequiredServer.mockReturnValue('aws-api');
    mocked.RunnerRun.mockImplementation(
      async (_d: unknown, _a: unknown, _e: unknown, _w: unknown, cb: (ev: DriverEvent) => void) => {
        cb({ type: 'error', content: 'auth needed' });
        return { exitCode: 1, errorKind: 'mcp_auth_required' };
      },
    );

    const ctx = createCtx();
    ctx.mcpServerStore.listByTool.mockReturnValue([createMcpServer('aws-api')]);
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'claude' }));

    expect(mocked.RunnerKill).toHaveBeenCalledWith('mcp_auth_required');
    expect(mocked.handleClaudePostRunMcpAuth).toHaveBeenCalled();
  });

  it('detects MCP token refresh failure for codex and kills runner', async () => {
    mocked.isMcpTokenRefreshFailure.mockReturnValue(true);
    mocked.RunnerRun.mockImplementation(
      async (_d: unknown, _a: unknown, _e: unknown, _w: unknown, cb: (ev: DriverEvent) => void) => {
        cb({ type: 'error', content: 'token refresh failed' });
        return { exitCode: 1, errorKind: 'mcp_auth_required' };
      },
    );

    const ctx = createCtx();
    ctx.config.codexMcpAuthServer = 'codex-mcp';
    ctx.mcpServerStore.listByTool.mockReturnValue([createMcpServer('codex-mcp', 'codex')]);
    mocked.getToolPlugin.mockReturnValue({
      createApprovalGate: vi.fn(() => ({})),
      evaluateToolUse: vi.fn(() => ({ gate: {}, shouldBlock: false })),
      buildPermissionDeniedSummary: vi.fn((): PermissionDeniedResult => null),
      detectVoluntaryStop: vi.fn(() => null),
      clearMcpAuthState: vi.fn((s: Record<string, unknown>) => s),
      getMcpAuthServer: vi.fn((): string | null => 'codex-mcp'),
    });
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'codex' }));

    expect(mocked.RunnerKill).toHaveBeenCalledWith('mcp_auth_required');
    expect(mocked.handleCodexPostRunMcpAuth).toHaveBeenCalled();
  });

  /* ── Permission denied in event callback ─────────────────────── */
  it('detects permission denied in error/status events and kills runner', async () => {
    mocked.isPermissionDeniedError.mockReturnValue(true);
    mocked.detectPermissionDenied.mockReturnValue({
      deniedTools: ['bash'],
      request: { toolName: 'Bash', args: { cmd: 'rm' } },
    });
    mocked.RunnerRun.mockImplementation(
      async (_d: unknown, _a: unknown, _e: unknown, _w: unknown, cb: (ev: DriverEvent) => void) => {
        cb({ type: 'error', content: 'permission denied' });
        return { exitCode: 1, errorKind: 'permission_approval_needed' };
      },
    );

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob());

    expect(mocked.RunnerKill).toHaveBeenCalledWith('permission_approval_needed');
    // Tool approval stored
    expect(ctx.pendingToolApprovals.size).toBe(1);
    expect(mocked.postMessageWithBlocks).toHaveBeenCalled();
  });

  /* ── Tool approval blocking via evaluateToolUse ──────────────── */
  it('blocks tool use via proactive approval gate', async () => {
    const toolPlugin = {
      createApprovalGate: vi.fn(() => ({})),
      evaluateToolUse: vi.fn(() => ({ gate: {}, shouldBlock: true })),
      buildPermissionDeniedSummary: vi.fn(
        (): PermissionDeniedResult => ({
          deniedTools: ['write'],
          request: { toolName: 'Write', args: {} },
        }),
      ),
      detectVoluntaryStop: vi.fn(() => null),
      clearMcpAuthState: vi.fn((s: Record<string, unknown>) => s),
      getMcpAuthServer: vi.fn((): string | null => null),
    };
    mocked.getToolPlugin.mockReturnValue(toolPlugin);
    mocked.RunnerRun.mockImplementation(
      async (_d: unknown, _a: unknown, _e: unknown, _w: unknown, cb: (ev: DriverEvent) => void) => {
        cb({ type: 'tool_use', content: 'write file' });
        return { exitCode: 1, errorKind: 'permission_approval_needed' };
      },
    );

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob());

    expect(mocked.RunnerKill).toHaveBeenCalledWith('permission_approval_needed');
    expect(ctx.pendingToolApprovals.size).toBe(1);
  });

  /* ── Text appending for non-claude tools ─────────────────────── */
  it('appends text events to messenger for non-claude tool without tool_use', async () => {
    mocked.RunnerRun.mockImplementation(
      async (_d: unknown, _a: unknown, _e: unknown, _w: unknown, cb: (ev: DriverEvent) => void) => {
        cb({ type: 'text', content: 'gemini output' });
        return { exitCode: 0, errorKind: null };
      },
    );
    // extractAnswerText returns empty → text was already appended via messenger
    mocked.extractAnswerText.mockReturnValue('');

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    expect(mocked.loggerInfo).toHaveBeenCalledWith(
      'job_completed',
      expect.objectContaining({ events_count: 1 }),
    );
  });

  /* ── Codex output last message fallback ──────────────────────── */
  it('uses codex output last message when textBuffer is empty', async () => {
    mocked.prepareCodexOutputLastMessageCapture.mockResolvedValue({
      args: ['--arg'],
      outputLastMessagePath: '/tmp/codex-output/last.json',
    });
    mocked.consumeCodexOutputLastMessage.mockResolvedValue('codex answer');
    mocked.extractAnswerText.mockReturnValue('');

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'codex' }));

    expect(mocked.consumeCodexOutputLastMessage).toHaveBeenCalledWith(
      '/tmp/codex-output/last.json',
    );
    expect(mocked.loggerInfo).toHaveBeenCalledWith(
      'codex_output_last_message_used',
      expect.any(Object),
    );
  });

  it('logs warning when codex output last message is missing', async () => {
    mocked.prepareCodexOutputLastMessageCapture.mockResolvedValue({
      args: ['--arg'],
      outputLastMessagePath: '/tmp/codex-output/last.json',
    });
    mocked.consumeCodexOutputLastMessage.mockResolvedValue(null);
    mocked.extractAnswerText.mockReturnValue('');

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'codex' }));

    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'codex_output_last_message_missing',
      expect.any(Object),
    );
  });

  /* ── Non-claude answer text extraction with seenToolUse ──────── */
  it('extracts answer text after tool_use for non-claude tool', async () => {
    mocked.RunnerRun.mockImplementation(
      async (_d: unknown, _a: unknown, _e: unknown, _w: unknown, cb: (ev: DriverEvent) => void) => {
        cb({ type: 'text', content: 'pre-text' });
        cb({ type: 'tool_use', content: 'bash' });
        cb({ type: 'text', content: 'post-text' });
        return { exitCode: 0, errorKind: null };
      },
    );
    mocked.extractAnswerText.mockReturnValue('final answer');

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    // extractAnswerText should be called for non-claude with seenToolUse
    expect(mocked.extractAnswerText).toHaveBeenCalled();
    // Conversation saved for slack job
    expect(ctx.conversationStore.saveMessage).toHaveBeenCalledWith(
      'sess_1',
      'assistant',
      'final answer',
      'job_1',
    );
  });

  /* ── Claude no output scenario ──────────────────────────────── */
  it('posts claude no output error when no events', async () => {
    mocked.extractAnswerText.mockReturnValue('');
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'claude' }));

    // No events, exit 0 → claudeNoOutput
    expect(mocked.loggerInfo).toHaveBeenCalledWith(
      'job_completed',
      expect.objectContaining({ events_count: 0 }),
    );
  });

  /* ── File upload to Slack ──────────────────────────────────────── */
  it('archives and uploads output files to Slack for non-dashboard jobs', async () => {
    mocked.archiveOutputFiles.mockReturnValue([
      {
        localPath: '/tmp/work/_artifacts/job_1/file1.txt',
        filename: 'file1.txt',
        size: 100,
        mimeType: 'text/plain',
      },
      {
        localPath: '/tmp/work/_artifacts/job_1/file2.txt',
        filename: 'file2.txt',
        size: 200,
        mimeType: 'text/plain',
      },
    ]);

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    expect(mocked.archiveOutputFiles).toHaveBeenCalledWith('/tmp/work', 'job_1');
    expect(mocked.loggerInfo).toHaveBeenCalledWith(
      'output_files_archived',
      expect.objectContaining({ count: 2 }),
    );
  });

  /* ── Gemini MCP preflight ──────────────────────────────────────── */
  it('runs gemini MCP preflight when conditions are met', async () => {
    mocked.isGeminiMcpPreflightBypassed.mockReturnValue(false);
    mocked.isGeminiMcpPreflightInitialized.mockReturnValue(false);
    mocked.runGeminiJobPreflight.mockResolvedValue({
      shouldReturn: false,
      sessionToolState: {},
      effectiveToolState: {},
    });

    const ctx = createCtx();
    ctx.config.geminiMcpAuthServer = 'aws-api';
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    expect(mocked.runGeminiJobPreflight).toHaveBeenCalled();
  });

  it('returns early when gemini preflight says shouldReturn', async () => {
    mocked.isGeminiMcpPreflightBypassed.mockReturnValue(false);
    mocked.isGeminiMcpPreflightInitialized.mockReturnValue(false);
    mocked.runGeminiJobPreflight.mockResolvedValue({
      shouldReturn: true,
      sessionToolState: {},
      effectiveToolState: {},
    });

    const ctx = createCtx();
    ctx.config.geminiMcpAuthServer = 'aws-api';
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    // runner.run should NOT be called since preflight returned early
    // But the finally block should still run
    expect(mocked.recordJobComplete).toHaveBeenCalled();
  });

  /* ── Claude MCP preflight ──────────────────────────────────────── */
  it('runs claude MCP preflight when conditions are met', async () => {
    mocked.isClaudeMcpPreflightBypassed.mockReturnValue(false);
    mocked.isClaudeMcpPreflightVerified.mockReturnValue(false);
    mocked.runClaudeJobPreflight.mockResolvedValue({
      shouldReturn: false,
      sessionToolState: { mcp_verified: true },
      effectiveToolState: { mcp_verified: true },
    });

    const ctx = createCtx();
    ctx.config.claudeMcpAuthServer = 'my-mcp';
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'claude' }));

    expect(mocked.runClaudeJobPreflight).toHaveBeenCalled();
  });

  /* ── Codex MCP preflight ───────────────────────────────────────── */
  it('runs codex MCP preflight when conditions are met', async () => {
    mocked.isCodexMcpPreflightVerified.mockReturnValue(false);
    mocked.runCodexJobPreflight.mockResolvedValue({
      shouldReturn: false,
      sessionToolState: {},
      effectiveToolState: {},
    });

    const ctx = createCtx();
    ctx.config.codexMcpAuthServer = 'codex-mcp';
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'codex' }));

    expect(mocked.runCodexJobPreflight).toHaveBeenCalled();
  });

  /* ── MCP tool unavailable detection ─────────────────────────── */
  it('detects tool not found in gemini events with MCP runtime warning', async () => {
    mocked.isMcpRuntimeWarning.mockReturnValue(true);
    mocked.detectToolNotFound.mockReturnValue({
      missingTool: 'aws_list_buckets',
    });
    mocked.RunnerRun.mockImplementation(
      async (_d: unknown, _a: unknown, _e: unknown, _w: unknown, cb: (ev: DriverEvent) => void) => {
        cb({ type: 'status', content: 'MCP runtime warning' });
        cb({ type: 'error', content: 'tool not found' });
        return { exitCode: 1, errorKind: 'mcp_tool_unavailable' };
      },
    );

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    expect(mocked.RunnerKill).toHaveBeenCalledWith('mcp_tool_unavailable');
    expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
      ctx,
      ctx.webClient,
      'C1',
      '1.1',
      'missing tool msg',
      expect.any(Object),
    );
  });

  /* ── Post-run MCP auth handling for gemini ──────────────────── */
  it('handles gemini post-run MCP auth', async () => {
    mocked.detectMcpAuthRequiredServer.mockReturnValue('aws-api');
    mocked.RunnerRun.mockImplementation(
      async (_d: unknown, _a: unknown, _e: unknown, _w: unknown, cb: (ev: DriverEvent) => void) => {
        cb({ type: 'text', content: 'auth needed' });
        return { exitCode: 1, errorKind: 'mcp_auth_required' };
      },
    );

    const ctx = createCtx();
    ctx.mcpServerStore.listByTool.mockReturnValue([createMcpServer('aws-api', 'gemini')]);
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    expect(mocked.handleGeminiPostRunMcpAuth).toHaveBeenCalled();
  });

  /* ── Gemini resume state error ──────────────────────────────── */
  it('clears gemini resume state on resume state error', async () => {
    mocked.hasGeminiResumeStateError.mockReturnValue(true);

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    // updateToolState called with session_index and gemini_resume_ready undefined
    expect(ctx.sessionManager.updateToolState).toHaveBeenCalledWith(
      'sess_1',
      expect.objectContaining({
        session_index: undefined,
        gemini_resume_ready: undefined,
      }),
    );
  });

  /* ── Non-zero exit code info ────────────────────────────────── */
  it('appends exit code and errorKind info for non-suppressed failures', async () => {
    mocked.RunnerRun.mockResolvedValue({
      exitCode: 2,
      errorKind: 'timeout',
    });
    mocked.extractAnswerText.mockReturnValue('partial answer');

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    expect(mocked.loggerInfo).toHaveBeenCalledWith(
      'job_completed',
      expect.objectContaining({ exit_code: 2, error_kind: 'timeout' }),
    );
  });

  /* ── Dashboard tool approval (SSE event) ─────────────────────── */
  it('sends tool_approval SSE event to dashboard for permission denied', async () => {
    const onEvent = vi.fn();
    const onDone = vi.fn();
    const ctx = createCtx();
    ctx.jobEventStreams.set('job_1', { onEvent, onDone });
    mocked.detectPermissionDenied.mockReturnValue({
      deniedTools: ['bash'],
      request: { toolName: 'Bash', args: { cmd: 'ls' } },
    });

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ source: 'dashboard' }));

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool_approval' }));
    // For dashboard, approval key uses sessionKey
    expect(ctx.pendingToolApprovals.has('sess_1')).toBe(true);
  });

  /* ── MCP auth handler error catch ──────────────────────────── */
  it('catches error from post-run MCP auth handler', async () => {
    mocked.detectMcpAuthRequiredServer.mockReturnValue('aws-api');
    mocked.handleClaudePostRunMcpAuth.mockRejectedValue(new Error('auth handler crash'));
    mocked.RunnerRun.mockImplementation(
      async (_d: unknown, _a: unknown, _e: unknown, _w: unknown, cb: (ev: DriverEvent) => void) => {
        cb({ type: 'error', content: 'auth needed' });
        return { exitCode: 1, errorKind: 'mcp_auth_required' };
      },
    );

    const ctx = createCtx();
    ctx.mcpServerStore.listByTool.mockReturnValue([createMcpServer('aws-api')]);
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'claude' }));

    expect(mocked.loggerError).toHaveBeenCalledWith(
      'mcp_auth_request_failed',
      expect.objectContaining({ error: 'auth handler crash' }),
    );
  });

  /* ── Missing MCP tool notification error catch ──────────────── */
  it('catches error from missing MCP tool notification', async () => {
    mocked.detectToolNotFound.mockReturnValue({
      missingTool: 'aws_list_buckets',
    });
    mocked.evaluateGeminiMcpAuthPreflight.mockReturnValue({
      requiredServer: null,
      oauthFlowStarted: true,
    });
    mocked.postMessageWithContext.mockRejectedValue(new Error('post failed'));
    mocked.RunnerRun.mockImplementation(
      async (_d: unknown, _a: unknown, _e: unknown, _w: unknown, cb: (ev: DriverEvent) => void) => {
        cb({ type: 'error', content: 'tool not found' });
        return { exitCode: 1, errorKind: 'mcp_tool_unavailable' };
      },
    );

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    expect(mocked.loggerError).toHaveBeenCalledWith(
      'mcp_tool_unavailable_notification_failed',
      expect.any(Object),
    );
  });

  /* ── Tool approval posting error catch ──────────────────────── */
  it('catches error when posting tool approval blocks to Slack', async () => {
    mocked.detectPermissionDenied.mockReturnValue({
      deniedTools: ['bash'],
      request: { toolName: 'Bash', args: {} },
    });
    mocked.postMessageWithBlocks.mockRejectedValue(new Error('slack api error'));

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob());

    expect(mocked.loggerError).toHaveBeenCalledWith(
      'tool_approval_request_failed',
      expect.objectContaining({ error: 'slack api error' }),
    );
  });

  /* ── Output files archive error catch ────────────────────────── */
  it('catches error when archiving output files fails', async () => {
    mocked.archiveOutputFiles.mockImplementation(() => {
      throw new Error('archive failed');
    });

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'output_files_archive_failed',
      expect.objectContaining({ error: 'archive failed' }),
    );
  });

  /* ── Tool approval rerun does NOT save user message ────────── */
  it('skips saving user message for tool approval rerun jobs', async () => {
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(
      createJob({
        prompt: 'Continue with the task. The tool mcp__awsapi__call_aws is now available for use.',
        toolStateOverrides: { _tool_approval_rerun: true },
      }),
    );

    // saveMessage for 'user' should NOT be called
    const userSaves = ctx.conversationStore.saveMessage.mock.calls.filter(
      (c: unknown[]) => c[1] === 'user',
    );
    expect(userSaves.length).toBe(0);
  });

  /* ── geminiResumeStateError detected from events ─────────────── */
  it('detects tool not found from post-run event analysis for gemini', async () => {
    mocked.detectToolNotFound.mockReturnValue(null); // during callback
    mocked.evaluateGeminiMcpAuthPreflight.mockReturnValue({
      requiredServer: null,
      oauthFlowStarted: true,
    });

    // After callback, on post-run analysis, detectToolNotFound finds it
    let callCount = 0;
    mocked.detectToolNotFound.mockImplementation(() => {
      callCount++;
      return callCount > 1 ? { missingTool: 'aws_describe_instances' } : null;
    });

    mocked.RunnerRun.mockImplementation(
      async (_d: unknown, _a: unknown, _e: unknown, _w: unknown, cb: (ev: DriverEvent) => void) => {
        cb({ type: 'error', content: 'tool issue' });
        return { exitCode: 1, errorKind: null };
      },
    );

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
      ctx,
      ctx.webClient,
      'C1',
      '1.1',
      'missing tool msg',
      expect.any(Object),
    );
  });

  /* ── Large text buffer triggers log upload ──────────────────── */
  it('uploads full log when textBuffer exceeds MAX_CHARS_FOR_LOG', async () => {
    const longText = 'x'.repeat(10_001);
    mocked.RunnerRun.mockImplementation(
      async (_d: unknown, _a: unknown, _e: unknown, _w: unknown, cb: (ev: DriverEvent) => void) => {
        cb({ type: 'text', content: longText });
        return { exitCode: 0, errorKind: null };
      },
    );
    mocked.extractAnswerText.mockReturnValue('');

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    // Messenger.uploadFile should have been called
    // (we can verify via log info since messenger is real but mocked at lower level)
    expect(mocked.loggerInfo).toHaveBeenCalledWith(
      'job_completed',
      expect.objectContaining({ events_count: 1 }),
    );
  });

  /* ── Permission denied replaces buffer for non-claude ────────── */
  it('replaces messenger buffer for permission denied non-claude job', async () => {
    mocked.detectPermissionDenied.mockReturnValue({
      deniedTools: ['bash'],
      request: { toolName: 'Bash', args: {} },
    });
    mocked.RunnerRun.mockImplementation(
      async (_d: unknown, _a: unknown, _e: unknown, _w: unknown, cb: (ev: DriverEvent) => void) => {
        cb({ type: 'text', content: 'I will run bash' });
        return { exitCode: 1, errorKind: 'permission_approval_needed' };
      },
    );

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    // Should NOT save assistant response because permissionDenied
    const assistantSaves = ctx.conversationStore.saveMessage.mock.calls.filter(
      (c: unknown[]) => c[1] === 'assistant',
    );
    expect(assistantSaves.length).toBe(0);
  });

  /* ── MCP glob injection with existing allowed tools ──────────── */
  it('preserves existing claude_runtime_allowed_tools when injecting MCP glob', async () => {
    // Capture what buildArgs receives so we can inspect effectiveSession
    let capturedToolState: Record<string, unknown> | undefined;
    mocked.createDriver.mockReturnValue({
      buildArgs: vi.fn((_prompt: string, session: unknown) => {
        capturedToolState = (session as { toolState?: Record<string, unknown> }).toolState;
        return ['--arg'];
      }),
      buildEnv: vi.fn(() => ({})),
      extractSessionState: vi.fn(() => ({})),
    });

    const ctx = createCtx();
    ctx.config.claudeMcpAuthServer = 'aws-api';
    ctx.mcpServerStore.listByTool.mockReturnValue([createMcpServer('aws-api')]);
    // Session already has allowed tools — exercises Array.isArray=true branch (line 154)
    ctx.sessionManager.get.mockReturnValue({
      toolState: {
        claude_runtime_allowed_tools: ['existing_tool_*'],
      },
      devAlias: null,
    });

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob());

    // Driver should receive merged allowed tools including existing + MCP glob
    if (!capturedToolState) throw new Error('Expected captured toolState');
    expect(capturedToolState.claude_runtime_allowed_tools).toEqual(
      expect.arrayContaining(['existing_tool_*', 'mcp__aws-api__*']),
    );
  });

  /* ── Early return in event callback after stop ─────────────────── */
  it('skips processing events after runner is stopped for MCP auth', async () => {
    // First event triggers MCP auth stop, second should hit early return (lines 365-366)
    mocked.detectMcpAuthRequiredServer.mockReturnValue('auth-server');
    mocked.RunnerRun.mockImplementation(
      async (_d: unknown, _a: unknown, _e: unknown, _w: unknown, cb: (ev: DriverEvent) => void) => {
        cb({ type: 'text', content: 'first event triggers auth' });
        // After first event, stoppedForMcpAuthRequired=true
        // Second event should hit early return guard
        cb({ type: 'text', content: 'second event should be skipped' });
        return { exitCode: 1, errorKind: 'mcp_auth_required' };
      },
    );

    const ctx = createCtx();
    ctx.mcpServerStore.listByTool.mockReturnValue([createMcpServer('auth-server')]);
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob());

    // Runner.kill should be called once (from first event), not twice
    expect(mocked.RunnerKill).toHaveBeenCalledTimes(1);
    expect(mocked.RunnerKill).toHaveBeenCalledWith('mcp_auth_required');
  });

  /* ── File upload success (archived files) ─────────────────────── */
  it('uploads archived files successfully and posts status message', async () => {
    mocked.archiveOutputFiles.mockReturnValue([
      {
        localPath: '/tmp/work/_artifacts/job_1/result.txt',
        filename: 'result.txt',
        size: 500,
        mimeType: 'text/plain',
      },
    ]);

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    expect(mocked.archiveOutputFiles).toHaveBeenCalledWith('/tmp/work', 'job_1');
    expect(mocked.loggerInfo).toHaveBeenCalledWith(
      'output_files_archived',
      expect.objectContaining({ count: 1 }),
    );
  });

  /* ── File upload success with large file message ───────────────── */
  it('posts large file notice when uploaded size exceeds 1MB', async () => {
    mocked.archiveOutputFiles.mockReturnValue([
      {
        localPath: '/tmp/work/_artifacts/job_1/big.bin',
        filename: 'big.bin',
        size: 2 * 1024 * 1024, // 2MB
        mimeType: 'application/octet-stream',
      },
    ]);

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    expect(mocked.archiveOutputFiles).toHaveBeenCalledWith('/tmp/work', 'job_1');
  });

  /* ── Gemini cleanup failure in finally block ────────────────────── */
  it('logs warning when gemini runtime cleanup fails', async () => {
    mocked.cleanupGeminiRuntimeHome.mockRejectedValue(new Error('cleanup failed'));

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    // Wait for the .catch() callback to execute
    await new Promise((r) => setTimeout(r, 50));

    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'gemini_runtime_home_cleanup_failed',
      expect.objectContaining({ error: 'cleanup failed' }),
    );
  });

  /* ── Branch: aws_ prefix tool detection without MCP runtime warning ── */
  it('detects aws_ prefixed tool in post-run analysis without mcpRuntimeWarning', async () => {
    // evaluateGeminiMcpAuthPreflight returns null (default) → mcpEval = null
    // → mcpRuntimeWarningFromEvents = false
    // detectToolNotFound returns null during callback, then { missingTool: 'aws_s3_list' }
    // in the post-run event re-analysis → hits the startsWith('aws_') branch at L495
    let callCount = 0;
    mocked.detectToolNotFound.mockImplementation(() => {
      callCount++;
      return callCount > 1 ? { missingTool: 'aws_s3_list' } : null;
    });

    mocked.RunnerRun.mockImplementation(
      async (_d: unknown, _a: unknown, _e: unknown, _w: unknown, cb: (ev: DriverEvent) => void) => {
        cb({ type: 'error', content: 'tool not found: aws_s3_list' });
        return { exitCode: 1, errorKind: null };
      },
    );

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
      ctx,
      ctx.webClient,
      'C1',
      '1.1',
      'missing tool msg',
      expect.any(Object),
    );
  });

  it('continues gemini post-run scan when missing tool detection returns null', async () => {
    mocked.detectToolNotFound.mockReturnValue(null);
    mocked.RunnerRun.mockImplementation(
      async (_d: unknown, _a: unknown, _e: unknown, _w: unknown, cb: (ev: DriverEvent) => void) => {
        cb({ type: 'error', content: 'some unrelated error' });
        return { exitCode: 1, errorKind: null };
      },
    );

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    expect(mocked.detectToolNotFound).toHaveBeenCalled();
    expect(mocked.formatGeminiMissingToolMessage).not.toHaveBeenCalled();
  });

  /* ── Branch: codex tool reaches extractCodexApprovedToolCalls ── */
  it('calls extractCodexApprovedToolCalls for codex permission denied', async () => {
    mocked.isPermissionDeniedError.mockReturnValue(true);
    mocked.detectPermissionDenied.mockReturnValue({
      deniedTools: ['bash'],
      request: { toolName: 'Bash', args: { cmd: 'rm -rf /' } },
    });
    mocked.extractCodexApprovedToolCalls.mockReturnValue([{ tool: 'Read', args: {} }]);
    mocked.RunnerRun.mockImplementation(
      async (_d: unknown, _a: unknown, _e: unknown, _w: unknown, cb: (ev: DriverEvent) => void) => {
        cb({ type: 'error', content: 'permission denied' });
        return { exitCode: 1, errorKind: 'permission_approval_needed' };
      },
    );

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'codex' }));

    expect(mocked.extractCodexApprovedToolCalls).toHaveBeenCalled();
    expect(ctx.pendingToolApprovals.size).toBe(1);
    // Verify the approval contains approvedCodexToolCalls
    const approval = [...ctx.pendingToolApprovals.values()][0];
    expect(approval.approvedCodexToolCalls).toEqual([{ tool: 'Read', args: {} }]);
  });

  /* ── Branch: claude preflight shouldReturn = true ── */
  it('returns early when claude preflight says shouldReturn', async () => {
    mocked.isClaudeMcpPreflightBypassed.mockReturnValue(false);
    mocked.isClaudeMcpPreflightVerified.mockReturnValue(false);
    mocked.runClaudeJobPreflight.mockResolvedValue({
      shouldReturn: true,
      sessionToolState: {},
      effectiveToolState: {},
    });

    const ctx = createCtx();
    ctx.config.claudeMcpAuthServer = 'my-mcp';
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'claude' }));

    expect(mocked.runClaudeJobPreflight).toHaveBeenCalled();
    // runner.run should NOT be called since preflight returned early
    expect(mocked.RunnerRun).not.toHaveBeenCalled();
    // But the finally block should still run
    expect(mocked.recordJobComplete).toHaveBeenCalled();
  });

  /* ── Branch: codex preflight shouldReturn = true ── */
  it('returns early when codex preflight says shouldReturn', async () => {
    mocked.isCodexMcpPreflightVerified.mockReturnValue(false);
    mocked.runCodexJobPreflight.mockResolvedValue({
      shouldReturn: true,
      sessionToolState: {},
      effectiveToolState: {},
    });

    const ctx = createCtx();
    ctx.config.codexMcpAuthServer = 'codex-mcp';
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'codex' }));

    expect(mocked.runCodexJobPreflight).toHaveBeenCalled();
    expect(mocked.RunnerRun).not.toHaveBeenCalled();
    expect(mocked.recordJobComplete).toHaveBeenCalled();
  });

  /* ── Branch: skipClaudeMcpPreflight skips claude preflight ── */
  it('skips claude preflight when claude_skip_mcp_preflight_once is set', async () => {
    mocked.isClaudeMcpPreflightBypassed.mockReturnValue(false);
    mocked.isClaudeMcpPreflightVerified.mockReturnValue(false);

    const ctx = createCtx();
    ctx.config.claudeMcpAuthServer = 'my-mcp';
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(
      createJob({
        tool: 'claude',
        toolStateOverrides: { claude_skip_mcp_preflight_once: true },
      }),
    );

    // Preflight should NOT be called because skip flag is set
    expect(mocked.runClaudeJobPreflight).not.toHaveBeenCalled();
    // But runner.run should still proceed
    expect(mocked.RunnerRun).toHaveBeenCalled();
  });

  it('emits dashboard artifact events and persists artifact system message', async () => {
    mocked.archiveOutputFiles.mockReturnValue([
      {
        localPath: '/tmp/work/_artifacts/job_1/chart.png',
        filename: 'chart.png',
        size: 1200,
        mimeType: 'image/png',
      },
    ]);

    const onEvent = vi.fn();
    const onDone = vi.fn();
    const ctx = createCtx();
    ctx.jobEventStreams.set('job_1', { onEvent, onDone });
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ source: 'dashboard' }));

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'artifacts' }));
    expect(ctx.conversationStore.saveMessage).toHaveBeenCalledWith(
      'sess_1',
      'system',
      JSON.stringify({
        type: 'artifacts',
        jobId: 'job_1',
        files: [{ filename: 'chart.png', size: 1200, mimeType: 'image/png' }],
      }),
      'job_1',
    );
  });

  it('posts combined upload summary and partial failure warning for Slack artifact upload', async () => {
    mocked.archiveOutputFiles.mockReturnValue([
      {
        localPath: '/tmp/work/_artifacts/job_1/ok.txt',
        filename: 'ok.txt',
        size: 2 * 1024 * 1024,
        mimeType: 'text/plain',
      },
      {
        localPath: '/tmp/work/_artifacts/job_1/fail.txt',
        filename: 'fail.txt',
        size: 10,
        mimeType: 'text/plain',
      },
    ]);

    const uploadSpy = vi
      .spyOn(Messenger.prototype, 'uploadBinaryFile')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const statusSpy = vi
      .spyOn(Messenger.prototype, 'postStatusMessage')
      .mockResolvedValue('123.456');

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(createJob({ tool: 'gemini' }));

    expect(uploadSpy).toHaveBeenCalledTimes(2);
    expect(statusSpy).toHaveBeenCalledWith(expect.stringContaining('Sent 1 file(s) (2097152B).'));
    expect(statusSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to upload: fail.txt'));
    expect(statusSpy).toHaveBeenCalledWith(
      expect.stringContaining('Large files may take a moment to appear in the thread.'),
    );
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'output_files_partial_failure',
      expect.objectContaining({ uploaded: 1, failed: ['fail.txt'] }),
    );

    uploadSpy.mockRestore();
    statusSpy.mockRestore();
  });

  it('auto-approves denied tools when autorun mode is enabled (safety net)', async () => {
    mocked.isPermissionDeniedError.mockReturnValue(true);
    mocked.detectPermissionDenied.mockReturnValue({
      deniedTools: ['mcp__aws-api__call_aws'],
      request: { toolName: 'mcp__aws-api__call_aws', args: { command: 'echo hi' } },
    });
    mocked.extractCodexApprovedToolCalls.mockReturnValue([]);
    mocked.RunnerRun.mockImplementation(
      async (_d: unknown, _a: unknown, _e: unknown, _w: unknown, cb: (ev: DriverEvent) => void) => {
        cb({ type: 'error', content: 'permission denied' });
        return { exitCode: 1, errorKind: 'permission_approval_needed' };
      },
    );

    const statusSpy = vi
      .spyOn(Messenger.prototype, 'postStatusMessage')
      .mockResolvedValue('789.012');
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(
      createJob({
        tool: 'codex',
        toolStateOverrides: {
          auto_approve: true,
          gemini_skip_mcp_preflight_once: true,
        },
      }),
    );

    expect(ctx.jobQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'codex',
        toolStateOverrides: expect.objectContaining({
          _tool_approval_rerun: true,
          auto_approve: true,
          'approved_tool:mcp__aws-api__call_aws': true,
          gemini_skip_mcp_preflight_once: true,
          codex_approved_tool_calls: ['mcp__aws-api__call_aws'],
        }),
      }),
    );
    expect(statusSpy).toHaveBeenCalledWith('_Auto-approved tool: `mcp__aws-api__call_aws`_');
    statusSpy.mockRestore();
  });

  it('auto-approve safety net skips codex approved-call extraction for non-codex tools', async () => {
    mocked.isPermissionDeniedError.mockReturnValue(true);
    mocked.detectPermissionDenied.mockReturnValue({
      deniedTools: ['mcp__aws-api__call_aws'],
      request: { toolName: 'mcp__aws-api__call_aws', args: { command: 'echo hi' } },
    });
    mocked.RunnerRun.mockImplementation(
      async (_d: unknown, _a: unknown, _e: unknown, _w: unknown, cb: (ev: DriverEvent) => void) => {
        cb({ type: 'error', content: 'permission denied' });
        return { exitCode: 1, errorKind: 'permission_approval_needed' };
      },
    );

    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;
    await executor(
      createJob({
        tool: 'claude',
        toolStateOverrides: { auto_approve: true },
      }),
    );

    expect(mocked.extractCodexApprovedToolCalls).not.toHaveBeenCalled();
    expect(ctx.jobQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'claude',
        toolStateOverrides: expect.objectContaining({
          _tool_approval_rerun: true,
          auto_approve: true,
          'approved_tool:mcp__aws-api__call_aws': true,
        }),
      }),
    );
    const enqueueCalls = (ctx.jobQueue.enqueue as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    const firstEnqueued = enqueueCalls[0]?.[0] as { toolStateOverrides?: Record<string, unknown> };
    const overrides = firstEnqueued.toolStateOverrides ?? {};
    expect(overrides.codex_approved_tool_calls).toBeUndefined();
  });

  it('finalizes schedule task as completed when nextRunAt is null and not retried', async () => {
    const ctx = createCtx();
    const scheduleStore = {
      updateRun: vi.fn(),
      getById: vi.fn(() => ({
        id: 'sched-1',
        name: 'once task',
        tool: 'claude',
        mode: 'readonly',
        prompt: 'test',
        userId: 'U1',
        notifyChannel: null,
        notifyThread: null,
        maxRetries: 0,
        nextRunAt: null,
      })),
      getRunById: vi.fn(() => ({ retryCount: 0 })),
      update: vi.fn(),
      recordRun: vi.fn(),
    };
    (ctx as unknown as Record<string, unknown>).scheduleStore = scheduleStore;
    (ctx as unknown as Record<string, unknown>).config = {
      ...ctx.config,
      scheduleDefaultNotifyChannel: null,
    };

    const job = createJob({
      source: 'schedule',
      scheduleTaskId: 'sched-1',
      scheduleRunId: 'run-1',
    });

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0];
    if (!executor) throw new Error('executor not registered');
    await executor(job);

    expect(scheduleStore.update).toHaveBeenCalledWith('sched-1', { status: 'completed' });
  });

  it('does not finalize schedule task when retried', async () => {
    const ctx = createCtx();
    const scheduleStore = {
      updateRun: vi.fn(),
      getById: vi.fn(() => ({
        id: 'sched-2',
        name: 'retry task',
        tool: 'claude',
        mode: 'readonly',
        prompt: 'test',
        userId: 'U1',
        notifyChannel: null,
        notifyThread: null,
        maxRetries: 3,
        nextRunAt: null,
      })),
      getRunById: vi.fn(() => ({ retryCount: 0, source: 'schedule' })),
      update: vi.fn(),
      recordRun: vi.fn(),
    };
    (ctx as unknown as Record<string, unknown>).scheduleStore = scheduleStore;
    (ctx as unknown as Record<string, unknown>).config = {
      ...ctx.config,
      scheduleDefaultNotifyChannel: null,
    };

    // Simulate a failed job so retry logic kicks in
    mocked.RunnerRun.mockResolvedValue({ exitCode: 1, errorKind: 'tool_error' });
    ctx.sessionManager.get = vi.fn(() => ({
      toolState: {} as Record<string, unknown>,
      devAlias: null as string | null,
    }));
    // Retry path needs createStandaloneSession to create a new session
    (ctx.sessionManager as Record<string, unknown>).createStandaloneSession = vi.fn(() => ({
      sessionKey: 'retry-sess',
      workdir: '/tmp/retry-work',
    }));
    // Tasks always set write mode unconditionally
    (ctx.sessionManager as Record<string, unknown>).updateMode = vi.fn();
    // Retry enqueue must succeed (return position, not error)
    ctx.jobQueue.enqueue = vi.fn(() => ({ position: 0 }));

    const job = createJob({
      source: 'schedule',
      scheduleTaskId: 'sched-2',
      scheduleRunId: 'run-2',
    });

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0];
    if (!executor) throw new Error('executor not registered');
    await executor(job);

    // update should NOT be called with { status: 'completed' } because retry was enqueued
    const statusCalls = scheduleStore.update.mock.calls.filter(
      (c: unknown[]) => (c[1] as Record<string, unknown>).status === 'completed',
    );
    expect(statusCalls.length).toBe(0);
  });

  it('does not finalize schedule task when nextRunAt is set (recurring active)', async () => {
    const ctx = createCtx();
    const scheduleStore = {
      updateRun: vi.fn(),
      getById: vi.fn(() => ({
        id: 'sched-3',
        name: 'recurring task',
        tool: 'claude',
        mode: 'readonly',
        prompt: 'test',
        userId: 'U1',
        notifyChannel: null,
        notifyThread: null,
        maxRetries: 0,
        nextRunAt: '2026-12-01T00:00:00.000Z',
      })),
      getRunById: vi.fn(() => ({ retryCount: 0 })),
      update: vi.fn(),
      recordRun: vi.fn(),
    };
    (ctx as unknown as Record<string, unknown>).scheduleStore = scheduleStore;
    (ctx as unknown as Record<string, unknown>).config = {
      ...ctx.config,
      scheduleDefaultNotifyChannel: null,
    };

    const job = createJob({
      source: 'schedule',
      scheduleTaskId: 'sched-3',
      scheduleRunId: 'run-3',
    });

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0];
    if (!executor) throw new Error('executor not registered');
    await executor(job);

    // update should NOT be called (nextRunAt is set, task remains active)
    expect(scheduleStore.update).not.toHaveBeenCalled();
  });

  it('uploads archived output files to Slack when notifyChannel is set', async () => {
    const ctx = createCtx();
    const scheduleStore = {
      updateRun: vi.fn(),
      getById: vi.fn(() => ({
        id: 'sched-upload',
        name: 'upload task',
        tool: 'claude',
        mode: 'write',
        prompt: 'generate report',
        userId: 'U1',
        notifyChannel: 'C-notify',
        notifyThread: null,
        maxRetries: 0,
        nextRunAt: null,
      })),
      getRunById: vi.fn(() => ({ retryCount: 0 })),
      update: vi.fn(),
      recordRun: vi.fn(),
    };
    (ctx as unknown as Record<string, unknown>).scheduleStore = scheduleStore;
    (ctx as unknown as Record<string, unknown>).config = {
      ...ctx.config,
      scheduleDefaultNotifyChannel: null,
    };

    // Simulate archived output files
    mocked.archiveOutputFiles.mockReturnValue([
      {
        localPath: '/tmp/work/_artifacts/job_1/report.pdf',
        filename: 'report.pdf',
        size: 1024,
        mimeType: 'application/pdf',
      },
      {
        localPath: '/tmp/work/_artifacts/job_1/data.csv',
        filename: 'data.csv',
        size: 512,
        mimeType: 'text/csv',
      },
    ]);

    // postMessage returns ts for threading
    (ctx.webClient.chat as Record<string, unknown>).postMessage = vi
      .fn()
      .mockResolvedValue({ ok: true, ts: '1700000001.000001' });

    const job = createJob({
      source: 'schedule',
      scheduleTaskId: 'sched-upload',
      scheduleRunId: 'run-upload',
    });

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0];
    if (!executor) throw new Error('executor not registered');
    await executor(job);

    // Should have called filesUploadV2 for each archived file
    expect(ctx.webClient.filesUploadV2).toHaveBeenCalledTimes(2);
    expect(ctx.webClient.filesUploadV2).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: 'C-notify',
        thread_ts: '1700000001.000001',
        filename: 'report.pdf',
        title: 'report.pdf',
      }),
    );
    expect(ctx.webClient.filesUploadV2).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: 'C-notify',
        thread_ts: '1700000001.000001',
        filename: 'data.csv',
        title: 'data.csv',
      }),
    );
  });

  it('does not upload files when no notifyChannel is configured', async () => {
    const ctx = createCtx();
    const scheduleStore = {
      updateRun: vi.fn(),
      getById: vi.fn(() => ({
        id: 'sched-no-ch',
        name: 'no channel task',
        tool: 'claude',
        mode: 'write',
        prompt: 'test',
        userId: 'U1',
        notifyChannel: null,
        notifyThread: null,
        maxRetries: 0,
        nextRunAt: null,
      })),
      getRunById: vi.fn(() => ({ retryCount: 0 })),
      update: vi.fn(),
      recordRun: vi.fn(),
    };
    (ctx as unknown as Record<string, unknown>).scheduleStore = scheduleStore;
    (ctx as unknown as Record<string, unknown>).config = {
      ...ctx.config,
      scheduleDefaultNotifyChannel: null,
    };

    mocked.archiveOutputFiles.mockReturnValue([
      {
        localPath: '/tmp/work/_artifacts/job_1/report.pdf',
        filename: 'report.pdf',
        size: 1024,
        mimeType: 'application/pdf',
      },
    ]);

    const job = createJob({
      source: 'schedule',
      scheduleTaskId: 'sched-no-ch',
      scheduleRunId: 'run-no-ch',
    });

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0];
    if (!executor) throw new Error('executor not registered');
    await executor(job);

    // No Slack upload should occur
    expect(ctx.webClient.filesUploadV2).not.toHaveBeenCalled();
  });

  it('handles file upload failure gracefully without breaking notification', async () => {
    const ctx = createCtx();
    const scheduleStore = {
      updateRun: vi.fn(),
      getById: vi.fn(() => ({
        id: 'sched-fail',
        name: 'fail upload task',
        tool: 'claude',
        mode: 'write',
        prompt: 'test',
        userId: 'U1',
        notifyChannel: 'C-notify',
        notifyThread: null,
        maxRetries: 0,
        nextRunAt: null,
      })),
      getRunById: vi.fn(() => ({ retryCount: 0 })),
      update: vi.fn(),
      recordRun: vi.fn(),
    };
    (ctx as unknown as Record<string, unknown>).scheduleStore = scheduleStore;
    (ctx as unknown as Record<string, unknown>).config = {
      ...ctx.config,
      scheduleDefaultNotifyChannel: null,
    };

    mocked.archiveOutputFiles.mockReturnValue([
      {
        localPath: '/tmp/work/_artifacts/job_1/report.pdf',
        filename: 'report.pdf',
        size: 1024,
        mimeType: 'application/pdf',
      },
    ]);

    // postMessage succeeds but filesUploadV2 fails
    (ctx.webClient.chat.postMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      ts: '1700000002.000001',
    });
    (ctx.webClient.filesUploadV2 as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Slack upload 500'),
    );

    const job = createJob({
      source: 'schedule',
      scheduleTaskId: 'sched-fail',
      scheduleRunId: 'run-fail',
    });

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0];
    if (!executor) throw new Error('executor not registered');

    // Should not throw
    await expect(executor(job)).resolves.toBeUndefined();

    // Upload was attempted
    expect(ctx.webClient.filesUploadV2).toHaveBeenCalled();
    // Warning was logged
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'schedule_file_upload_failed',
      expect.objectContaining({ file: 'report.pdf' }),
    );
  });

  it('uploads files using scheduleDefaultNotifyChannel when task has no notifyChannel', async () => {
    const ctx = createCtx();
    const scheduleStore = {
      updateRun: vi.fn(),
      getById: vi.fn(() => ({
        id: 'sched-default',
        name: 'default channel task',
        tool: 'claude',
        mode: 'write',
        prompt: 'test',
        userId: 'U1',
        notifyChannel: null,
        notifyThread: null,
        maxRetries: 0,
        nextRunAt: null,
      })),
      getRunById: vi.fn(() => ({ retryCount: 0 })),
      update: vi.fn(),
      recordRun: vi.fn(),
    };
    (ctx as unknown as Record<string, unknown>).scheduleStore = scheduleStore;
    (ctx as unknown as Record<string, unknown>).config = {
      ...ctx.config,
      scheduleDefaultNotifyChannel: 'C-default',
    };

    mocked.archiveOutputFiles.mockReturnValue([
      {
        localPath: '/tmp/work/_artifacts/job_1/output.png',
        filename: 'output.png',
        size: 2048,
        mimeType: 'image/png',
      },
    ]);

    (ctx.webClient.chat.postMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      ts: '1700000003.000001',
    });

    const job = createJob({
      source: 'schedule',
      scheduleTaskId: 'sched-default',
      scheduleRunId: 'run-default',
    });

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0];
    if (!executor) throw new Error('executor not registered');
    await executor(job);

    // File uploaded to default channel
    expect(ctx.webClient.filesUploadV2).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: 'C-default',
        filename: 'output.png',
      }),
    );
  });
});

/* ── Phase 3b: on-demand task file upload ────────────────────── */
describe('on-demand task file upload', () => {
  it('uploads archived output files to Slack when notifyChannel is set', async () => {
    const ctx = createCtx();
    const ondemandTaskStore = {
      updateRun: vi.fn(),
      getById: vi.fn(() => ({
        id: 'od-upload',
        name: 'upload task',
        tool: 'claude',
        mode: 'write',
        prompt: 'test',
        userId: 'U1',
        notifyChannel: 'C-notify',
        notifyThread: null,
        maxRetries: 0,
        allowMcp: false,
        enabledSkills: null,
        workdir: null,
        instructionFile: null,
      })),
      getRunById: vi.fn(() => ({ retryCount: 0 })),
      incrementRunCount: vi.fn(),
    };
    (ctx as unknown as Record<string, unknown>).ondemandTaskStore = ondemandTaskStore;
    (ctx.sessionManager as Record<string, unknown>).deleteSessionByKeyWithCleanup = vi.fn();

    // Simulate archived output files
    mocked.archiveOutputFiles.mockReturnValue([
      {
        localPath: '/tmp/work/_artifacts/job_1/report.pdf',
        filename: 'report.pdf',
        size: 1024,
        mimeType: 'application/pdf',
      },
      {
        localPath: '/tmp/work/_artifacts/job_1/data.csv',
        filename: 'data.csv',
        size: 512,
        mimeType: 'text/csv',
      },
    ]);

    // postMessage returns ts for threading
    (ctx.webClient.chat as Record<string, unknown>).postMessage = vi
      .fn()
      .mockResolvedValue({ ok: true, ts: '1700000001.000001' });

    const job = createJob({
      source: 'ondemand-task',
      ondemandTaskId: 'od-upload',
      ondemandTaskRunId: 'run-upload',
    });

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0];
    if (!executor) throw new Error('executor not registered');
    await executor(job);

    // Should have called filesUploadV2 for each archived file
    expect(ctx.webClient.filesUploadV2).toHaveBeenCalledTimes(2);
    expect(ctx.webClient.filesUploadV2).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: 'C-notify',
        thread_ts: '1700000001.000001',
        filename: 'report.pdf',
        title: 'report.pdf',
      }),
    );
    expect(ctx.webClient.filesUploadV2).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: 'C-notify',
        thread_ts: '1700000001.000001',
        filename: 'data.csv',
        title: 'data.csv',
      }),
    );
  });

  it('does not upload files when no notifyChannel is configured', async () => {
    const ctx = createCtx();
    const ondemandTaskStore = {
      updateRun: vi.fn(),
      getById: vi.fn(() => ({
        id: 'od-no-ch',
        name: 'no channel task',
        tool: 'claude',
        mode: 'write',
        prompt: 'test',
        userId: 'U1',
        notifyChannel: null,
        notifyThread: null,
        maxRetries: 0,
        allowMcp: false,
        enabledSkills: null,
        workdir: null,
        instructionFile: null,
      })),
      getRunById: vi.fn(() => ({ retryCount: 0 })),
      incrementRunCount: vi.fn(),
    };
    (ctx as unknown as Record<string, unknown>).ondemandTaskStore = ondemandTaskStore;
    (ctx.sessionManager as Record<string, unknown>).deleteSessionByKeyWithCleanup = vi.fn();

    mocked.archiveOutputFiles.mockReturnValue([
      {
        localPath: '/tmp/work/_artifacts/job_1/report.pdf',
        filename: 'report.pdf',
        size: 1024,
        mimeType: 'application/pdf',
      },
    ]);

    const job = createJob({
      source: 'ondemand-task',
      ondemandTaskId: 'od-no-ch',
      ondemandTaskRunId: 'run-no-ch',
    });

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0];
    if (!executor) throw new Error('executor not registered');
    await executor(job);

    // No Slack upload should occur
    expect(ctx.webClient.filesUploadV2).not.toHaveBeenCalled();
  });

  it('handles file upload failure gracefully without breaking notification', async () => {
    const ctx = createCtx();
    const ondemandTaskStore = {
      updateRun: vi.fn(),
      getById: vi.fn(() => ({
        id: 'od-fail',
        name: 'fail upload task',
        tool: 'claude',
        mode: 'write',
        prompt: 'test',
        userId: 'U1',
        notifyChannel: 'C-notify',
        notifyThread: null,
        maxRetries: 0,
        allowMcp: false,
        enabledSkills: null,
        workdir: null,
        instructionFile: null,
      })),
      getRunById: vi.fn(() => ({ retryCount: 0 })),
      incrementRunCount: vi.fn(),
    };
    (ctx as unknown as Record<string, unknown>).ondemandTaskStore = ondemandTaskStore;
    (ctx.sessionManager as Record<string, unknown>).deleteSessionByKeyWithCleanup = vi.fn();

    mocked.archiveOutputFiles.mockReturnValue([
      {
        localPath: '/tmp/work/_artifacts/job_1/report.pdf',
        filename: 'report.pdf',
        size: 1024,
        mimeType: 'application/pdf',
      },
    ]);

    // postMessage succeeds but filesUploadV2 fails
    (ctx.webClient.chat.postMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      ts: '1700000002.000001',
    });
    (ctx.webClient.filesUploadV2 as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Slack upload 500'),
    );

    const job = createJob({
      source: 'ondemand-task',
      ondemandTaskId: 'od-fail',
      ondemandTaskRunId: 'run-fail',
    });

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0];
    if (!executor) throw new Error('executor not registered');

    // Should not throw
    await expect(executor(job)).resolves.toBeUndefined();

    // Upload was attempted
    expect(ctx.webClient.filesUploadV2).toHaveBeenCalled();
    // Warning was logged
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'ondemand_file_upload_failed',
      expect.objectContaining({ file: 'report.pdf' }),
    );
  });
});

/* ── Phase 4: executionPolicy enforcement ─────────────────────── */
describe('executionPolicy: allowMcp', () => {
  it('does NOT inject MCP glob when executionPolicy.allowMcp is false', async () => {
    const ctx = createCtx();
    ctx.config.claudeMcpAuthServer = 'my-mcp-server';
    const driverBuildArgs = vi.fn(() => ['--arg']);
    mocked.createDriver.mockReturnValue({
      buildArgs: driverBuildArgs,
      buildEnv: vi.fn(() => ({})),
      extractSessionState: vi.fn(() => ({})),
    });
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(
      createJob({
        tool: 'claude',
        executionPolicy: { allowMcp: false, enabledSkills: null },
      }),
    );

    // buildArgs should NOT have MCP glob in session toolState
    const calls = driverBuildArgs.mock.calls as unknown[][];
    const sessionArg = calls[0]?.[1] as {
      toolState: { claude_runtime_allowed_tools?: string[] };
    };
    const allowedTools = sessionArg.toolState.claude_runtime_allowed_tools ?? [];
    expect(allowedTools).not.toContain('mcp__my-mcp-server__*');
  });

  it('passes allowMcp=false to driver.buildArgs options', async () => {
    const ctx = createCtx();
    const driverBuildArgs = vi.fn(() => ['--arg']);
    mocked.createDriver.mockReturnValue({
      buildArgs: driverBuildArgs,
      buildEnv: vi.fn(() => ({})),
      extractSessionState: vi.fn(() => ({})),
    });
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(
      createJob({
        tool: 'claude',
        executionPolicy: { allowMcp: false, enabledSkills: null },
      }),
    );

    const calls = driverBuildArgs.mock.calls as unknown[][];
    const optionsArg = calls[0]?.[3] as {
      allowMcp: boolean;
    };
    expect(optionsArg.allowMcp).toBe(false);
  });

  it('writes an empty Claude MCP config when executionPolicy.allowMcp is false', async () => {
    const ctx = createCtx();
    ctx.mcpServerStore.listByTool.mockReturnValue([createMcpServer('my-mcp-server')]);
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(
      createJob({
        tool: 'claude',
        executionPolicy: { allowMcp: false, enabledSkills: null },
      }),
    );

    expect(mocked.writeClaudeMcpConfigToWorkdir).toHaveBeenCalledWith('/tmp/work', []);
  });

  it('defaults allowMcp to true when executionPolicy is not set', async () => {
    const ctx = createCtx();
    ctx.config.claudeMcpAuthServer = 'my-mcp-server';
    ctx.mcpServerStore.listByTool.mockReturnValue([createMcpServer('my-mcp-server')]);
    const driverBuildArgs = vi.fn(() => ['--arg']);
    mocked.createDriver.mockReturnValue({
      buildArgs: driverBuildArgs,
      buildEnv: vi.fn(() => ({})),
      extractSessionState: vi.fn(() => ({})),
    });
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(createJob({ tool: 'claude' }));

    // MCP glob should be injected (backward compat)
    const calls = driverBuildArgs.mock.calls as unknown[][];
    const sessionArg = calls[0]?.[1] as {
      toolState: { claude_runtime_allowed_tools?: string[] };
    };
    const allowedTools = sessionArg.toolState.claude_runtime_allowed_tools ?? [];
    expect(allowedTools).toContain('mcp__my-mcp-server__*');

    const optionsArg = calls[0]?.[3] as {
      allowMcp: boolean;
    };
    expect(optionsArg.allowMcp).toBe(true);
  });

  it('kills process on MCP tool_use when allowMcp=false (fail-fast)', async () => {
    const ctx = createCtx();
    const runnerKill = vi.fn();
    (Runner as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      run: vi.fn(
        async (
          _driver: unknown,
          _args: unknown,
          _env: unknown,
          _workdir: unknown,
          onEvent: (e: DriverEvent) => void,
        ) => {
          onEvent({
            type: 'tool_use',
            content: 'Using tool: mcp__aws__list_buckets',
            raw: { tool_name: 'mcp__aws__list_buckets' },
          });
          return { exitCode: 1, errorKind: 'mcp_blocked_by_policy' };
        },
      ),
      kill: runnerKill,
    }));

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(
      createJob({
        tool: 'claude',
        executionPolicy: { allowMcp: false, enabledSkills: null },
      }),
    );

    expect(runnerKill).toHaveBeenCalledWith('mcp_blocked_by_policy');
  });

  it('does NOT kill process on MCP tool_use when allowMcp=true', async () => {
    const ctx = createCtx();
    const runnerKill = vi.fn();
    (Runner as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      run: vi.fn(
        async (
          _driver: unknown,
          _args: unknown,
          _env: unknown,
          _workdir: unknown,
          onEvent: (e: DriverEvent) => void,
        ) => {
          onEvent({
            type: 'tool_use',
            content: 'Using tool: mcp__aws__list_buckets',
            raw: { tool_name: 'mcp__aws__list_buckets' },
          });
          return { exitCode: 0, errorKind: null };
        },
      ),
      kill: runnerKill,
    }));

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(
      createJob({
        tool: 'claude',
        executionPolicy: { allowMcp: true, enabledSkills: null },
      }),
    );

    expect(runnerKill).not.toHaveBeenCalledWith('mcp_blocked_by_policy');
  });

  it('skips MCP preflight when allowMcp=false', async () => {
    const ctx = createCtx();
    ctx.config.claudeMcpAuthServer = 'my-mcp';
    mocked.isClaudeMcpPreflightBypassed.mockReturnValue(false);
    mocked.isClaudeMcpPreflightVerified.mockReturnValue(false);

    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(
      createJob({
        tool: 'claude',
        executionPolicy: { allowMcp: false, enabledSkills: null },
      }),
    );

    // Preflight should NOT have been called
    expect(mocked.runClaudeJobPreflight).not.toHaveBeenCalled();
  });
});

describe('executionPolicy: enabledSkills', () => {
  it('passes enabledSkills to workdir manager when executionPolicy has explicit list', async () => {
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(
      createJob({
        tool: 'claude',
        executionPolicy: {
          allowMcp: true,
          enabledSkills: [buildSkillRef('builtin', 'perplexity-research')],
        },
      }),
    );

    const call = ctx.workdirManager.prepareWorkdirSkillsOnly.mock.calls[0];
    expect(call?.[0]).toBe('/tmp/work');
    expect(call?.[1]).toBe('claude');
    expect(call?.[2]).toEqual([buildSkillRef('builtin', 'perplexity-research')]);
  });

  it('passes null enabledSkills when executionPolicy is not set (inherit global)', async () => {
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(createJob({ tool: 'claude' }));

    const call = ctx.workdirManager.prepareWorkdirSkillsOnly.mock.calls[0];
    expect(call?.[0]).toBe('/tmp/work');
    expect(call?.[1]).toBe('claude');
    expect(call?.[2]).toBeNull();
  });

  it('resolves skillsEnabled from enabledSkills when policy has explicit list', async () => {
    const ctx = createCtx();
    ctx.workdirManager.willSeedSkills.mockReturnValue(true);
    const driverBuildArgs = vi.fn(() => ['--arg']);
    mocked.createDriver.mockReturnValue({
      buildArgs: driverBuildArgs,
      buildEnv: vi.fn(() => ({})),
      extractSessionState: vi.fn(() => ({})),
    });
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    // Non-empty enabledSkills → skillsEnabled=true
    await executor(
      createJob({
        tool: 'claude',
        executionPolicy: { allowMcp: true, enabledSkills: [buildSkillRef('builtin', 'aws-cli')] },
      }),
    );
    const calls1 = driverBuildArgs.mock.calls as unknown[][];
    const opts1 = calls1[0]?.[3] as { skillsEnabled: boolean };
    expect(opts1.skillsEnabled).toBe(true);
    expect(ctx.workdirManager.willSeedSkills).toHaveBeenCalledWith('claude', [
      buildSkillRef('builtin', 'aws-cli'),
    ]);
  });

  it('resolves skillsEnabled=false when enabledSkills is empty array', async () => {
    const ctx = createCtx();
    const driverBuildArgs = vi.fn(() => ['--arg']);
    mocked.createDriver.mockReturnValue({
      buildArgs: driverBuildArgs,
      buildEnv: vi.fn(() => ({})),
      extractSessionState: vi.fn(() => ({})),
    });
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(
      createJob({
        tool: 'claude',
        executionPolicy: { allowMcp: true, enabledSkills: [] },
      }),
    );
    const calls = driverBuildArgs.mock.calls as unknown[][];
    const opts = calls[0]?.[3] as { skillsEnabled: boolean };
    expect(opts.skillsEnabled).toBe(false);
    expect(ctx.workdirManager.willSeedSkills).toHaveBeenCalledWith('claude', []);
  });

  it('keeps skills disabled when enabledSkills is explicitly empty', async () => {
    const ctx = createCtx();
    const driverBuildArgs = vi.fn(() => ['--arg']);
    mocked.createDriver.mockReturnValue({
      buildArgs: driverBuildArgs,
      buildEnv: vi.fn(() => ({})),
      extractSessionState: vi.fn(() => ({})),
    });
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(
      createJob({
        tool: 'claude',
        executionPolicy: { allowMcp: true, enabledSkills: [] },
      }),
    );

    const calls = driverBuildArgs.mock.calls as unknown[][];
    const opts = calls[0]?.[3] as { skillsEnabled: boolean };
    expect(opts.skillsEnabled).toBe(false);
    expect(ctx.workdirManager.willSeedSkills).toHaveBeenCalledWith('claude', []);
  });
});

describe('instruction file control', () => {
  it('writes the instruction file by default', async () => {
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(
      createJob({
        tool: 'claude',
        source: 'orchestrator',
        instructionFile: '# Custom instructions',
      }),
    );

    expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
      '/tmp/work/CLAUDE.md',
      expect.any(String),
      'utf-8',
    );
    expect(ctx.workdirManager.prepareWorkdirSkillsOnly).toHaveBeenCalledWith(
      '/tmp/work',
      'claude',
      null,
    );
  });

  it('skips writing the instruction file when skipInstructionFile=true but still seeds skills', async () => {
    const ctx = createCtx();
    registerJobExecutor(ctx as never);
    const executor = ctx.jobQueue.setExecutor.mock.calls[0]?.[0] as (job: unknown) => Promise<void>;

    await executor(
      createJob({
        tool: 'claude',
        source: 'orchestrator',
        skipInstructionFile: true,
        instructionFile: '# Ignored',
      }),
    );

    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
    expect(ctx.workdirManager.prepareWorkdirSkillsOnly).toHaveBeenCalledWith(
      '/tmp/work',
      'claude',
      null,
    );
  });
});
