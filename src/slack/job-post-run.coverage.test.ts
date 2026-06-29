/**
 * Coverage tests for src/slack/job-post-run.ts
 * Targets: lines 220-228 (logOrchestratorSummaryDebug — event counting and lastEvents mapping)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  archiveOutputFiles: vi.fn().mockReturnValue([]),
  formatFileSize: vi.fn().mockReturnValue('0 B'),
  postMessageWithContext: vi.fn().mockResolvedValue(undefined),
  postMessageWithBlocks: vi.fn().mockResolvedValue(undefined),
  scheduleExpiry: vi.fn(),
  formatToolApprovalPrompt: vi.fn().mockReturnValue('approval text'),
  buildToolApprovalBlocks: vi.fn().mockReturnValue([]),
  handleClaudePostRunMcpAuth: vi.fn().mockResolvedValue(undefined),
  handleCodexPostRunMcpAuth: vi.fn().mockResolvedValue(undefined),
  handleGeminiPostRunMcpAuth: vi.fn().mockResolvedValue(undefined),
  extractCodexApprovedToolCalls: vi.fn().mockReturnValue([]),
  formatGeminiMissingToolMessage: vi.fn().mockReturnValue('missing tool'),
  sanitizeStickyApprovalState: vi.fn().mockReturnValue({ changed: false, toolState: {} }),
}));

vi.mock('../shared/file-attachment.js', () => ({
  archiveOutputFiles: mocked.archiveOutputFiles,
  formatFileSize: mocked.formatFileSize,
  buildFileReferenceBlock: vi.fn(),
}));

vi.mock('../shared/tool-approval.js', () => ({
  TOOL_APPROVAL_RERUN_KEY: 'tool_approval_rerun',
}));

vi.mock('./app-helpers.js', () => ({
  MAX_CHARS_FOR_LOG: 50000,
  TOOL_APPROVAL_TIMEOUT_MS: 60000,
  postMessageWithContext: mocked.postMessageWithContext,
  postMessageWithBlocks: mocked.postMessageWithBlocks,
  scheduleExpiry: mocked.scheduleExpiry,
}));

vi.mock('./block-kit.js', () => ({
  buildToolApprovalBlocks: mocked.buildToolApprovalBlocks,
}));

vi.mock('../shared/approval.js', () => ({
  formatToolApprovalPrompt: mocked.formatToolApprovalPrompt,
}));

vi.mock('./mcp-preflight.js', () => ({
  handleClaudePostRunMcpAuth: mocked.handleClaudePostRunMcpAuth,
  handleCodexPostRunMcpAuth: mocked.handleCodexPostRunMcpAuth,
  handleGeminiPostRunMcpAuth: mocked.handleGeminiPostRunMcpAuth,
}));

vi.mock('./tools/codex.js', () => ({
  extractCodexApprovedToolCalls: mocked.extractCodexApprovedToolCalls,
}));

vi.mock('./tools/gemini.js', () => ({
  formatGeminiMissingToolMessage: mocked.formatGeminiMissingToolMessage,
}));

vi.mock('../utils/error.js', () => ({
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import type { DriverEvent } from '../runner/types.js';
import { type PostRunContext, handlePostRunActions } from './job-post-run.js';
import type { JobRunOutcome, PreparedJobExecution } from './job-runtime-types.js';

function makeMessenger() {
  return {
    appendText: vi.fn(),
    replaceBuffer: vi.fn(),
    postFinal: vi.fn().mockResolvedValue(undefined),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    uploadBinaryFile: vi.fn().mockResolvedValue(true),
    postStatusMessage: vi.fn().mockResolvedValue(null),
  };
}

function makeMinimalPrepared(overrides: Record<string, unknown> = {}): PreparedJobExecution {
  return {
    job: {
      id: 'job-1',
      sessionKey: 'sess-1',
      channelId: 'C1',
      threadTs: '1.1',
      userId: 'U1',
      tool: 'claude',
      mode: 'write',
      prompt: 'test',
      workdir: '/tmp/wd',
      toolState: {},
      createdAt: Date.now(),
      source: 'orchestrator-summary',
    },
    flags: {
      isDashboard: false,
      isSchedule: false,
      isAssistant: false,
      isOndemandTask: false,
      isTriggeredTask: false,
      isOrchestrator: false,
      isOrchestratorSummary: true,
    },
    jobStream: null,
    threadKey: 'C1:1.1',
    messenger: makeMessenger() as unknown as PreparedJobExecution['messenger'],
    jlog: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as PreparedJobExecution['jlog'],
    driver: {} as PreparedJobExecution['driver'],
    session: {
      sessionKey: 'sess-1',
      tool: 'claude',
      mode: 'write',
      toolState: {},
      workdir: '/tmp/wd',
      modeExpiresAt: null,
      runningJobId: null,
      updatedAt: '',
      devAlias: null,
    },
    effectiveToolState: {},
    allowMcp: true,
    selectedMcpServers: [],
    autoApproveEnabled: false,
    runner: {} as PreparedJobExecution['runner'],
    args: [],
    env: {},
    mcpConfigPath: null,
    claudeSessionIdPreStored: false,
    codexOutputLastMessagePath: null,
    ...overrides,
  } as PreparedJobExecution;
}

function makePostRun(overrides: Partial<PostRunContext> = {}): PostRunContext {
  return {
    allEvents: [],
    textBuffer: '',
    result: { exitCode: 0, errorKind: null, events: [] },
    getAnswerText: () => 'answer',
    effectiveToolState: {},
    seenToolUse: false,
    permissionDenied: null,
    hasMcpAuthRequired: false,
    mcpAuthRequiredServer: null,
    mcpAuthRequiredResourceUrl: null,
    missingMcpToolName: null,
    mcpRuntimeWarningFromEvents: false,
    stoppedForMcpBlocked: false,
    isClaudeMcpAutoAuthRerun: false,
    isGeminiMcpApprovalRerun: false,
    isCodexMcpAutoAuthRerun: false,
    codexOutputLastMessageUsed: false,
    claudeNoOutput: false,
    suppressedFailureInfo: false,
    ...overrides,
  };
}

function makeOutcome(overrides: Partial<JobRunOutcome> = {}): JobRunOutcome {
  return {
    jobFailed: false,
    taskOutputSummary: '',
    taskOutputRaw: '',
    taskExitCode: null,
    taskErrorKind: null,
    archivedFiles: [],
    ...overrides,
  };
}

function makeCtx() {
  return {
    conversationStore: { saveMessage: vi.fn() },
    jobQueue: { enqueue: vi.fn().mockReturnValue({ position: 0 }) },
    webClient: { chat: { postMessage: vi.fn().mockResolvedValue({ ok: true }) } },
    config: { geminiMcpAuthServer: null },
    pendingToolApprovals: { set: vi.fn(), get: vi.fn() },
    scheduleStore: { updateRun: vi.fn() },
  } as unknown as Parameters<typeof handlePostRunActions>[0];
}

vi.mock('../utils/sanitize.js', () => ({
  sanitizeStickyApprovalState: mocked.sanitizeStickyApprovalState,
}));

describe('job-post-run: schedule_artifact_update_failed (lines 129-130)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('warns when scheduleStore.updateRun throws during artifact update', async () => {
    // archiveOutputFiles is called internally by handlePostRunActions to populate outcome.archivedFiles.
    // We must make it return files so the schedule artifact update branch is reached.
    mocked.archiveOutputFiles.mockReturnValueOnce([
      { localPath: '/tmp/out.txt', filename: 'out.txt', size: 100, mimeType: 'text/plain' },
    ]);

    const prepared = makeMinimalPrepared({
      job: {
        id: 'job-1',
        sessionKey: 'sess-1',
        channelId: 'C1',
        threadTs: '1.1',
        userId: 'U1',
        tool: 'claude',
        mode: 'write',
        prompt: 'test',
        workdir: '/tmp/wd',
        toolState: {},
        createdAt: Date.now(),
        source: 'schedule',
        scheduleRunId: 'sched-run-1',
      },
      flags: {
        isDashboard: false,
        isSchedule: true,
        isAssistant: false,
        isOndemandTask: false,
        isTriggeredTask: false,
        isOrchestrator: false,
        isOrchestratorSummary: false,
      },
    });

    const postRun = makePostRun({
      allEvents: [],
    });
    const outcome = makeOutcome();
    const ctx = makeCtx();
    (ctx as Record<string, unknown>).scheduleStore = {
      updateRun: vi.fn(() => {
        throw new Error('db fail');
      }),
    };

    await handlePostRunActions(ctx, prepared, outcome, postRun);

    expect(vi.mocked(prepared.jlog.warn)).toHaveBeenCalledWith(
      'schedule_artifact_update_failed',
      expect.objectContaining({ error: 'db fail' }),
    );
  });
});

describe('job-post-run: logOrchestratorSummaryDebug (lines 220-228)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collects event counts and maps last events when isOrchestratorSummary', async () => {
    const events: DriverEvent[] = [
      { type: 'text', content: 'hello', raw: { type: 'text_chunk' } },
      { type: 'tool_use', content: 'call()', raw: undefined },
      { type: 'tool_result', content: 'ok', raw: { type: 'tool_output' } },
      { type: 'text', content: 'world', raw: undefined },
    ];

    const prepared = makeMinimalPrepared();
    const postRun = makePostRun({ allEvents: events });
    const outcome = makeOutcome();
    const ctx = makeCtx();

    await handlePostRunActions(ctx, prepared, outcome, postRun);

    expect(vi.mocked(prepared.jlog.info)).toHaveBeenCalledWith(
      'summary_output_debug',
      expect.objectContaining({
        totalEvents: 4,
        eventCounts: { text: 2, tool_use: 1, tool_result: 1 },
        lastEvents: expect.arrayContaining([
          expect.objectContaining({ type: 'text', rawType: 'text_chunk' }),
          expect.objectContaining({ type: 'tool_use', rawType: null }),
          expect.objectContaining({ type: 'tool_result', rawType: 'tool_output' }),
          expect.objectContaining({ type: 'text', rawType: null }),
        ]),
      }),
    );
  });

  it('handles empty allEvents array', async () => {
    const prepared = makeMinimalPrepared();
    const postRun = makePostRun({ allEvents: [] });
    const outcome = makeOutcome();
    const ctx = makeCtx();

    await handlePostRunActions(ctx, prepared, outcome, postRun);

    expect(vi.mocked(prepared.jlog.info)).toHaveBeenCalledWith(
      'summary_output_debug',
      expect.objectContaining({
        totalEvents: 0,
        eventCounts: {},
        lastEvents: [],
      }),
    );
  });

  it('maps rawType to null when event.raw is undefined', async () => {
    const events: DriverEvent[] = [{ type: 'status', content: 'info', raw: undefined }];

    const prepared = makeMinimalPrepared();
    const postRun = makePostRun({ allEvents: events });
    const outcome = makeOutcome();
    const ctx = makeCtx();

    await handlePostRunActions(ctx, prepared, outcome, postRun);

    const call = vi
      .mocked(prepared.jlog.info)
      .mock.calls.find(([eventName]) => eventName === 'summary_output_debug');
    expect(call).toBeTruthy();
    const payload = call?.[1] as Record<string, unknown> | undefined;
    expect(payload).toBeTruthy();
    if (payload) {
      const lastEvents = payload.lastEvents as Array<{ rawType: unknown }>;
      const firstEvent = lastEvents[0];
      if (!firstEvent) throw new Error('Expected at least one lastEvent');
      expect(firstEvent.rawType).toBeNull();
    }
  });
});

describe('job-post-run: schedule_artifact_update_failed (lines 129-130)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('warns when scheduleStore.updateRun throws during artifact update', async () => {
    mocked.archiveOutputFiles.mockReturnValue([
      { localPath: '/tmp/out.txt', filename: 'out.txt', size: 100, mimeType: 'text/plain' },
    ]);
    const prepared = makeMinimalPrepared({
      job: {
        id: 'job-1',
        sessionKey: 'sess-1',
        channelId: 'C1',
        threadTs: '1.1',
        userId: 'U1',
        tool: 'claude',
        mode: 'write',
        prompt: 'test',
        workdir: '/tmp/wd',
        toolState: {},
        createdAt: Date.now(),
        source: 'schedule',
        scheduleRunId: 'sched-run-1',
      },
      flags: {
        isDashboard: false,
        isSchedule: true,
        isAssistant: false,
        isOndemandTask: false,
        isTriggeredTask: false,
        isOrchestrator: false,
        isOrchestratorSummary: false,
      },
    });
    const postRun = makePostRun();
    const outcome = makeOutcome();
    const ctx = makeCtx();
    (ctx as Record<string, unknown>).scheduleStore = {
      updateRun: vi.fn(() => {
        throw new Error('db fail');
      }),
    };

    await handlePostRunActions(ctx, prepared, outcome, postRun);

    expect(vi.mocked(prepared.jlog.warn)).toHaveBeenCalledWith(
      'schedule_artifact_update_failed',
      expect.objectContaining({ error: 'db fail' }),
    );
  });
});
