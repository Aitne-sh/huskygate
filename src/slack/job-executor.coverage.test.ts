/**
 * Coverage tests for job-executor.ts — targets uncovered branches in
 * registerJobExecutor: fatal error path, orchestrator safety net,
 * standalone session cleanup, MCP config cleanup.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../context/app-context.js';
import type { Job } from '../queue/types.js';

type PermissionDeniedResult = {
  deniedTools: string[];
  request: { toolName: string; args: Record<string, unknown> };
} | null;
type McpAuthPreflightResult = {
  requiredServer: string | null;
  oauthFlowStarted: boolean;
} | null;
type ToolNotFoundResult = { missingTool: string } | null;
type ApprovedToolCall = { tool: string; args: Record<string, unknown> };

const mocked = vi.hoisted(() => ({
  toThreadKey: vi.fn((_c: string, _t: string) => 'C1:T1'),
  resolveContext: vi.fn(() => ({ tool: 'claude', sessionId: 'S1' })),
  buildSlackContextPrefix: vi.fn(() => '[ctx]'),
  postMessageWithContext: vi.fn().mockResolvedValue(undefined),
  postMessageWithBlocks: vi.fn().mockResolvedValue(undefined),
  extractAnswerText: vi.fn(() => ''),
  createDriver: vi.fn(() => ({
    buildArgs: vi.fn(() => ['--arg']),
    buildEnv: vi.fn(() => ({})),
    extractSessionState: vi.fn(() => ({})),
  })),
  scheduleExpiry: vi.fn(),
  formatToolApprovalPrompt: vi.fn(() => 'prompt'),
  detectMcpAuthRequiredResourceFromEvents: vi.fn(() => null),
  hasGeminiResumeStateError: vi.fn(() => false),
  RunnerRun: vi.fn().mockResolvedValue({ exitCode: 0, errorKind: null }),
  RunnerKill: vi.fn(),
  RunnerIsRunning: vi.fn(() => false),
  recordJobComplete: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  prepareCodexRuntimeHome: vi.fn(async () => ({
    homeDir: '/tmp/.codex',
    seededFiles: [],
  })),
  getToolPlugin: vi.fn(() => ({
    createApprovalGate: vi.fn(() => ({})),
    evaluateToolUse: vi.fn(() => ({ gate: {}, shouldBlock: false })),
    buildPermissionDeniedSummary: vi.fn((): PermissionDeniedResult => null),
    detectVoluntaryStop: vi.fn(() => null),
    clearMcpAuthState: vi.fn((s: Record<string, unknown>) => s),
    getMcpAuthServer: vi.fn((): string | null => null),
    buildAutoAuthRerunOverrides: vi.fn(() => null),
    extractMcpAuthPreflight: vi.fn((): McpAuthPreflightResult => null),
    detectMcpAuthRequired: vi.fn(() => false),
    detectToolNotFound: vi.fn((): ToolNotFoundResult => null),
    evaluateMcpAuthPreflight: vi.fn(() => ({})),
    filterApprovedToolCalls: vi.fn((): ApprovedToolCall[] => []),
  })),
  runJobRuntime: vi.fn().mockResolvedValue({
    jobFailed: false,
    taskOutputSummary: '',
    taskOutputRaw: '',
    taskExitCode: 0,
    taskErrorKind: null,
    archivedFiles: [],
  }),
  finishJobExecution: vi.fn().mockResolvedValue({ orchestratorCallbackDone: false }),
  resolveAutoApprove: vi.fn(() => false),
  resolveJobMcpSelection: vi.fn(() => ({
    enabledServers: [],
    enabledServerNames: new Set<string>(),
  })),
  resolveInstruction: vi.fn(() => 'instruction'),
  writeFileSync: vi.fn(),
  getInstructionFilePath: vi.fn(() => '/tmp/inst'),
  removeClaudeGeneratedMcpConfig: vi.fn(),
  writeClaudeMcpConfigToWorkdir: vi.fn(() => '/tmp/mcp.json'),
  prepareWorkdirSkillsOnly: vi.fn(),
  prepareDevWorkdir: vi.fn(),
  willSeedSkills: vi.fn().mockReturnValue(false),
  cleanupStandaloneSessionResources: vi.fn(),
  requiresStandaloneSessionCleanup: vi.fn(() => false),
  collectCloudProviderEnv: vi.fn(() => ({})),
  collectSkillEnv: vi.fn(() => ({})),
  prepareCodexOutputLastMessageCapture: vi.fn(async () => ({
    args: ['--arg'],
    outputLastMessagePath: null,
  })),
  logJobStart: vi.fn(),
  logJobComplete: vi.fn(),
  setRunningJob: vi.fn(),
  onNodeJobComplete: vi.fn().mockResolvedValue(undefined),
  getJobSourceFlags: vi.fn(() => ({
    isDashboard: false,
    isSchedule: false,
    isAssistant: false,
    isOndemandTask: false,
    isTriggeredTask: false,
    isOrchestrator: false,
    isOrchestratorSummary: false,
  })),
  driverEventToChatEvent: vi.fn(() => null),
  wrapForMrkdwn: vi.fn((s: string) => s),
}));

// ── Mocks ──
vi.mock('./app-helpers.js', () => ({
  toThreadKey: mocked.toThreadKey,
  resolveContext: mocked.resolveContext,
  buildSlackContextPrefix: mocked.buildSlackContextPrefix,
  postMessageWithContext: mocked.postMessageWithContext,
  postMessageWithBlocks: mocked.postMessageWithBlocks,
  extractAnswerText: mocked.extractAnswerText,
  scheduleExpiry: mocked.scheduleExpiry,
}));

vi.mock('../runner/driver-factory.js', () => ({
  createDriver: mocked.createDriver,
}));

vi.mock('../runner/runner.js', () => ({
  Runner: vi.fn().mockImplementation(() => ({
    run: mocked.RunnerRun,
    kill: mocked.RunnerKill,
    isRunning: mocked.RunnerIsRunning,
  })),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: mocked.loggerInfo,
    warn: mocked.loggerWarn,
    error: mocked.loggerError,
  },
  createScopedLogger: vi.fn(() => ({
    info: mocked.loggerInfo,
    warn: mocked.loggerWarn,
    error: mocked.loggerError,
  })),
}));

vi.mock('../utils/metrics.js', () => ({
  recordJobComplete: mocked.recordJobComplete,
}));

vi.mock('./job-runtime.js', () => ({
  runJobRuntime: mocked.runJobRuntime,
}));

vi.mock('./job-finishers.js', () => ({
  finishJobExecution: mocked.finishJobExecution,
}));

vi.mock('./auto-approve.js', () => ({
  resolveAutoApprove: mocked.resolveAutoApprove,
}));

vi.mock('./mcp-selection.js', () => ({
  resolveJobMcpSelection: mocked.resolveJobMcpSelection,
}));

vi.mock('../instructions/builder.js', () => ({
  resolveInstruction: mocked.resolveInstruction,
}));

vi.mock('node:fs', () => ({
  writeFileSync: mocked.writeFileSync,
}));

vi.mock('../orchestrator/engine-utils.js', () => ({
  getInstructionFilePath: mocked.getInstructionFilePath,
}));

vi.mock('../workdir/mcp-writer.js', () => ({
  removeClaudeGeneratedMcpConfig: mocked.removeClaudeGeneratedMcpConfig,
  writeClaudeMcpConfigToWorkdir: mocked.writeClaudeMcpConfigToWorkdir,
}));

vi.mock('./task-run-completion.js', () => ({
  cleanupStandaloneSessionResources: mocked.cleanupStandaloneSessionResources,
  requiresStandaloneSessionCleanup: mocked.requiresStandaloneSessionCleanup,
}));

vi.mock('../runner/driver-utils.js', () => ({
  CLOUD_SKILL_IDS: new Set(),
  collectCloudProviderEnv: mocked.collectCloudProviderEnv,
  collectSkillEnv: mocked.collectSkillEnv,
}));

vi.mock('./tools/codex.js', () => ({
  prepareCodexOutputLastMessageCapture: mocked.prepareCodexOutputLastMessageCapture,
  consumeCodexOutputLastMessage: vi.fn(() => null),
}));

vi.mock('../runner/codex-runtime-home.js', () => ({
  prepareCodexRuntimeHome: mocked.prepareCodexRuntimeHome,
}));

vi.mock('./tool-plugin.js', () => ({
  getToolPlugin: mocked.getToolPlugin,
}));

vi.mock('./job-runtime-types.js', () => ({
  NullMessenger: vi.fn().mockImplementation(() => ({
    postStart: vi.fn().mockResolvedValue(undefined),
    appendText: vi.fn(),
    postFinal: vi.fn().mockResolvedValue(undefined),
    postStatusMessage: vi.fn().mockResolvedValue(null),
    replaceBuffer: vi.fn(),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    uploadBinaryFile: vi.fn().mockResolvedValue(false),
  })),
  getJobSourceFlags: mocked.getJobSourceFlags,
  createInitialJobRunOutcome: vi.fn(() => ({
    jobFailed: false,
    taskOutputSummary: '',
    taskOutputRaw: '',
    taskExitCode: 0,
    taskErrorKind: null,
    archivedFiles: [],
  })),
}));

vi.mock('./messenger.js', () => ({
  Messenger: vi.fn().mockImplementation(() => ({
    postStart: vi.fn().mockResolvedValue(undefined),
    appendText: vi.fn(),
    postFinal: vi.fn().mockResolvedValue(undefined),
    postStatusMessage: vi.fn().mockResolvedValue(null),
    replaceBuffer: vi.fn(),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    uploadBinaryFile: vi.fn().mockResolvedValue(false),
  })),
}));

import { registerJobExecutor } from './job-executor.js';

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    sessionKey: 'sess-1',
    channelId: 'C1',
    threadTs: 'T1',
    userId: 'U1',
    tool: 'claude' as const,
    mode: 'normal',
    workdir: '/tmp/work',
    prompt: 'hello',
    source: 'chat',
    autoApprove: false,
    toolState: {},
    createdAt: Date.now(),
    toolStateOverrides: undefined,
    orchestrationRunId: undefined,
    orchestrationNodeId: undefined,
    executionPolicy: undefined,
    skipInstructionFile: false,
    instructionOverride: undefined,
    instructionFile: undefined,
    timeoutSec: undefined,
    ...overrides,
  } as unknown as Job;
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    config: {
      claudeMcpAuthServer: null,
      codexMcpAuthServer: null,
      geminiMcpAuthServer: null,
    },
    webClient: {
      chat: { postMessage: vi.fn().mockResolvedValue({ ts: '1.0' }), update: vi.fn() },
      filesUploadV2: vi.fn(),
    },
    sessionManager: {
      get: vi.fn(() => ({
        workdir: '/tmp/work',
        toolState: {},
        mode: 'normal',
        tool: 'claude',
        devAlias: null,
      })),
      setRunningJob: mocked.setRunningJob,
      updateToolState: vi.fn(),
      mergeToolState: vi.fn(),
    },
    jobQueue: { setExecutor: vi.fn(), enqueue: vi.fn() },
    auditStore: { logJobStart: mocked.logJobStart, logJobComplete: mocked.logJobComplete },
    activeRunners: new Map(),
    jobEventStreams: new Map(),
    workdirManager: {
      listSeedableSkillEntries: vi.fn().mockReturnValue([]),
      prepareWorkdirSkillsOnly: mocked.prepareWorkdirSkillsOnly,
      prepareDevWorkdir: mocked.prepareDevWorkdir,
      willSeedSkills: mocked.willSeedSkills,
    },
    orchestratorEngine: {
      onNodeJobComplete: mocked.onNodeJobComplete,
    },
    conversationStore: { saveMessage: vi.fn() },
    defaultInstructionStore: { getWithEnabled: vi.fn(() => ({ instruction: '', enabled: false })) },
    switchPreflightBarriers: new Map(),
    ...overrides,
  } as unknown as AppContext;
}

describe('registerJobExecutor — coverage', () => {
  let executor: (job: Job) => Promise<void>;
  let ctx: AppContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = makeCtx();
    registerJobExecutor(ctx);
    executor = vi.mocked(ctx.jobQueue.setExecutor).mock.calls[0]?.[0] as (
      job: Job,
    ) => Promise<void>;
  });

  it('runs happy path successfully', async () => {
    await executor(makeJob());
    expect(mocked.runJobRuntime).toHaveBeenCalled();
    expect(mocked.finishJobExecution).toHaveBeenCalled();
  });

  describe('fatal error catch block', () => {
    it('handles pending job stream on fatal error', async () => {
      mocked.runJobRuntime.mockRejectedValueOnce(new Error('boom'));
      const job = makeJob();
      ctx.jobEventStreams.set('job-1', { onEvent: vi.fn(), onDone: vi.fn() });

      await expect(executor(job)).rejects.toThrow('boom');
    });

    it('handles unresolved job stream for dashboard source', async () => {
      mocked.getJobSourceFlags.mockReturnValue({
        isDashboard: true,
        isSchedule: false,
        isAssistant: false,
        isOndemandTask: false,
        isTriggeredTask: false,
        isOrchestrator: false,
        isOrchestratorSummary: false,
      });
      // Make prepareJobExecution fail by removing session
      (ctx.sessionManager.get as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const job = makeJob();
      ctx.jobEventStreams.set('job-1', { onEvent: vi.fn(), onDone: vi.fn() });

      await expect(executor(job)).rejects.toThrow('Missing session');
    });

    it('calls orchestrator safety net on fatal error with orchestrator source', async () => {
      mocked.runJobRuntime.mockRejectedValueOnce(new Error('fatal'));
      const job = makeJob({
        source: 'orchestrator',
        orchestrationRunId: 'run-1',
        orchestrationNodeId: 'node-1',
      });

      await expect(executor(job)).rejects.toThrow('fatal');
      expect(mocked.onNodeJobComplete).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ exitCode: 1, errorKind: 'executor_setup_error' }),
        '',
        expect.stringContaining('fatal'),
      );
    });

    it('logs error when orchestrator safety net callback itself fails', async () => {
      mocked.runJobRuntime.mockRejectedValueOnce(new Error('fatal'));
      mocked.onNodeJobComplete.mockRejectedValueOnce(new Error('callback fail'));
      const job = makeJob({
        source: 'orchestrator',
        orchestrationRunId: 'run-1',
        orchestrationNodeId: 'node-1',
      });

      await expect(executor(job)).rejects.toThrow('fatal');
      expect(mocked.loggerError).toHaveBeenCalledWith(
        'orchestrator_safety_net_callback_failed',
        expect.objectContaining({ jobId: 'job-1', runId: 'run-1' }),
      );
    });

    it('performs standalone session cleanup on fatal error', async () => {
      mocked.requiresStandaloneSessionCleanup.mockReturnValue(true);
      mocked.runJobRuntime.mockRejectedValueOnce(new Error('fatal'));
      const job = makeJob({ source: 'ondemand-task' });

      await expect(executor(job)).rejects.toThrow('fatal');
      expect(mocked.cleanupStandaloneSessionResources).toHaveBeenCalled();
    });

    it('handles standalone cleanup error gracefully', async () => {
      mocked.requiresStandaloneSessionCleanup.mockReturnValue(true);
      mocked.cleanupStandaloneSessionResources.mockImplementation(() => {
        throw new Error('cleanup fail');
      });
      mocked.runJobRuntime.mockRejectedValueOnce(new Error('fatal'));
      const job = makeJob({ source: 'ondemand-task' });

      await expect(executor(job)).rejects.toThrow('fatal');
      expect(mocked.loggerWarn).toHaveBeenCalledWith(
        'standalone_session_cleanup_failed_after_executor_throw',
        expect.objectContaining({ sessionKey: 'sess-1' }),
      );
    });
  });

  describe('MCP config cleanup in finally', () => {
    it('cleans up MCP config on success for claude jobs', async () => {
      const job = makeJob({ tool: 'claude' });
      await executor(job);
      expect(mocked.removeClaudeGeneratedMcpConfig).toHaveBeenCalledWith('/tmp/mcp.json');
    });

    it('logs warning when MCP config cleanup fails', async () => {
      mocked.removeClaudeGeneratedMcpConfig.mockImplementation(() => {
        throw new Error('rm fail');
      });
      const job = makeJob({ tool: 'claude' });
      await executor(job);
      expect(mocked.loggerWarn).toHaveBeenCalledWith(
        'claude_generated_mcp_cleanup_failed',
        expect.objectContaining({
          jobId: 'job-1',
          path: '/tmp/mcp.json',
        }),
      );
    });
  });

  describe('denied_tools injection (lines 153-199)', () => {
    it('injects named denied tools into prompt and runtime allowlist for claude', async () => {
      (ctx.sessionManager.get as ReturnType<typeof vi.fn>).mockReturnValue({
        workdir: '/tmp/work',
        toolState: { denied_tools: ['ToolA', 'ToolB'] },
        mode: 'normal',
        tool: 'claude',
        devAlias: null,
      });
      const job = makeJob({ tool: 'claude' });
      await executor(job);
      expect(mocked.runJobRuntime).toHaveBeenCalled();
      // Verify mergeToolState was called to clear denied_tools
      expect(ctx.sessionManager.mergeToolState).toHaveBeenCalledWith('sess-1', {
        denied_tools: undefined,
      });
    });

    it('injects generic denial note when only _previous_request_ sentinel present', async () => {
      (ctx.sessionManager.get as ReturnType<typeof vi.fn>).mockReturnValue({
        workdir: '/tmp/work',
        toolState: { denied_tools: ['_previous_request_'] },
        mode: 'normal',
        tool: 'claude',
        devAlias: null,
      });
      const job = makeJob({ tool: 'claude' });
      await executor(job);
      expect(mocked.runJobRuntime).toHaveBeenCalled();
      expect(ctx.sessionManager.mergeToolState).toHaveBeenCalledWith('sess-1', {
        denied_tools: undefined,
      });
    });

    it('injects denied tools for gemini allowlist', async () => {
      (ctx.sessionManager.get as ReturnType<typeof vi.fn>).mockReturnValue({
        workdir: '/tmp/work',
        toolState: { denied_tools: ['ToolX'] },
        mode: 'normal',
        tool: 'gemini',
        devAlias: null,
      });
      const job = makeJob({ tool: 'gemini' });
      await executor(job);
      expect(mocked.runJobRuntime).toHaveBeenCalled();
      expect(ctx.sessionManager.mergeToolState).toHaveBeenCalledWith('sess-1', {
        denied_tools: undefined,
      });
    });

    it('clears denied_tools for codex (no allowlist key)', async () => {
      (ctx.sessionManager.get as ReturnType<typeof vi.fn>).mockReturnValue({
        workdir: '/tmp/work',
        toolState: { denied_tools: ['ToolZ'] },
        mode: 'normal',
        tool: 'codex',
        devAlias: null,
      });
      const job = makeJob({ tool: 'codex' });
      await executor(job);
      expect(mocked.runJobRuntime).toHaveBeenCalled();
      expect(ctx.sessionManager.mergeToolState).toHaveBeenCalledWith('sess-1', {
        denied_tools: undefined,
      });
    });

    it('skips injection when denied_tools is empty array', async () => {
      (ctx.sessionManager.get as ReturnType<typeof vi.fn>).mockReturnValue({
        workdir: '/tmp/work',
        toolState: { denied_tools: [] },
        mode: 'normal',
        tool: 'claude',
        devAlias: null,
      });
      const job = makeJob({ tool: 'claude' });
      await executor(job);
      expect(mocked.runJobRuntime).toHaveBeenCalled();
      // mergeToolState should NOT be called with denied_tools: undefined
      expect(ctx.sessionManager.mergeToolState).not.toHaveBeenCalledWith('sess-1', {
        denied_tools: undefined,
      });
    });
  });

  describe('CLOUD_SKILL_IDS check (line 226)', () => {
    it('collects cloud env when a seedable skill is in CLOUD_SKILL_IDS', async () => {
      // Override CLOUD_SKILL_IDS to include a skill ref
      const { CLOUD_SKILL_IDS } = await import('../runner/driver-utils.js');
      CLOUD_SKILL_IDS.add('builtin:aws-cli');
      (ctx.workdirManager.listSeedableSkillEntries as ReturnType<typeof vi.fn>).mockReturnValue([
        { skillRef: 'builtin:aws-cli' },
      ]);
      const job = makeJob({
        executionPolicy: { enabledSkills: ['builtin:aws-cli'], allowMcp: false },
      });
      await executor(job);
      expect(mocked.collectCloudProviderEnv).toHaveBeenCalled();
      CLOUD_SKILL_IDS.delete('builtin:aws-cli');
    });
  });

  describe('prepareJobExecution finally cleanup (lines 307-316)', () => {
    it('cleans up mcp config when setup fails after mcp config was written', async () => {
      // Make the build step fail after writeClaudeMcpConfigToWorkdir succeeds
      mocked.prepareCodexOutputLastMessageCapture.mockRejectedValueOnce(
        new Error('capture fail'),
      );
      // Actually, let's make the entire prepareJobExecution fail after mcpConfigPath is set
      // by having createDriver throw after writeClaudeMcpConfigToWorkdir returns
      const originalCreateDriver = mocked.createDriver.getMockImplementation();
      let callCount = 0;
      mocked.createDriver.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            buildArgs: vi.fn(() => {
              throw new Error('buildArgs fail');
            }),
            buildEnv: vi.fn(() => ({})),
            extractSessionState: vi.fn(() => ({})),
          };
        }
        return originalCreateDriver?.() ?? {
          buildArgs: vi.fn(() => ['--arg']),
          buildEnv: vi.fn(() => ({})),
          extractSessionState: vi.fn(() => ({})),
        };
      });
      const job = makeJob({ tool: 'claude' });
      await expect(executor(job)).rejects.toThrow('buildArgs fail');
      // The finally block in prepareJobExecution should have tried to clean up
      expect(mocked.removeClaudeGeneratedMcpConfig).toHaveBeenCalledWith('/tmp/mcp.json');
    });
  });

  describe('finalizeUnfinishedJobStream (lines 346-351)', () => {
    it('logs warning when jobStream.onDone throws in finalizeUnfinishedJobStream', async () => {
      mocked.runJobRuntime.mockRejectedValueOnce(new Error('runtime boom'));
      const job = makeJob();
      const onDone = vi.fn(() => {
        throw new Error('stream onDone fail');
      });
      ctx.jobEventStreams.set('job-1', { onEvent: vi.fn(), onDone });
      mocked.getJobSourceFlags.mockReturnValue({
        isDashboard: true,
        isSchedule: false,
        isAssistant: false,
        isOndemandTask: false,
        isTriggeredTask: false,
        isOrchestrator: false,
        isOrchestratorSummary: false,
      });

      await expect(executor(job)).rejects.toThrow('runtime boom');
      expect(mocked.loggerWarn).toHaveBeenCalledWith(
        'job_stream_done_failed_after_executor_throw',
        expect.objectContaining({
          jobId: 'job-1',
          sessionKey: 'sess-1',
        }),
      );
    });
  });
});
