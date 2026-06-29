/**
 * Coverage tests for job-finishers.ts — targets:
 * - Line 75-76: completeTriggeredTaskRun call path
 * - Lines 141-145: orchestrator_summary_block_post_failed for failure summary multi-block
 * - Lines 204-208: orchestrator_summary_block_post_failed for raw output multi-block
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  recordJobComplete: vi.fn(),
  cleanupGeminiRuntimeHome: vi.fn().mockResolvedValue(undefined),
  extractSummaryContent: vi.fn(),
  buildMarkdownMessage: vi.fn((opts: { header?: string; body: string }) => [
    {
      blocks: [
        ...(opts.header ? [{ type: 'section', text: { type: 'mrkdwn', text: opts.header } }] : []),
        { type: 'markdown', text: opts.body || 'Completed.' },
      ],
      text: [opts.header, (opts.body || 'Completed.').slice(0, 300)].filter(Boolean).join('\n\n'),
    },
  ]),
  buildSummaryBlocks: vi.fn((body: string) => [
    {
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: ':clipboard: *Execution Summary*' } },
        { type: 'markdown', text: body || 'Completed.' },
      ],
      text: `:clipboard: *Execution Summary*\n\n${(body || 'Completed.').slice(0, 300)}`,
    },
  ]),
  exceedsFileUploadThreshold: vi.fn(() => false),
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  uploadArchivedFilesToThread: vi.fn().mockResolvedValue(undefined),
  completeScheduleRun: vi.fn().mockResolvedValue(undefined),
  completeOndemandTaskRun: vi.fn().mockResolvedValue(undefined),
  completeTriggeredTaskRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/metrics.js', () => ({
  recordJobComplete: mocked.recordJobComplete,
}));

vi.mock('../runner/gemini-runtime-home.js', () => ({
  cleanupGeminiRuntimeHome: mocked.cleanupGeminiRuntimeHome,
}));

vi.mock('../orchestrator/engine-summary.js', () => ({
  extractSummaryContent: mocked.extractSummaryContent,
}));

vi.mock('./markdown-blocks.js', () => ({
  buildMarkdownMessage: mocked.buildMarkdownMessage,
  buildSummaryBlocks: mocked.buildSummaryBlocks,
  exceedsFileUploadThreshold: mocked.exceedsFileUploadThreshold,
}));

vi.mock('../utils/error.js', () => ({
  errorMessage: mocked.errorMessage,
}));

vi.mock('./task-run-completion.js', () => ({
  uploadArchivedFilesToThread: mocked.uploadArchivedFilesToThread,
  completeScheduleRun: mocked.completeScheduleRun,
  completeOndemandTaskRun: mocked.completeOndemandTaskRun,
  completeTriggeredTaskRun: mocked.completeTriggeredTaskRun,
}));

import { finishJobExecution } from './job-finishers.js';

function makeCtx() {
  return {
    webClient: {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: '2.2' }),
      },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    },
    activeRunners: new Map(),
    sessionManager: {
      get: vi.fn().mockReturnValue({ toolState: {} }),
      setRunningJob: vi.fn(),
    },
    scheduleStore: {},
    ondemandTaskStore: {},
    triggeredTaskStore: {},
    orchestratorEngine: {
      onNodeJobComplete: vi.fn().mockResolvedValue(undefined),
    },
    jobEventStreams: new Map(),
  };
}

function makePrepared(overrides: Record<string, unknown> = {}) {
  const { job: jobOv, flags: flagsOv, ...rest } = overrides;
  return {
    job: {
      id: 'job-1',
      sessionKey: 'sess-1',
      channelId: 'C1',
      threadTs: '1.1',
      userId: 'U1',
      tool: 'claude',
      mode: 'write',
      workdir: '/tmp/work',
      source: undefined as string | undefined,
      scheduleRunId: undefined as string | undefined,
      ondemandTaskRunId: undefined as string | undefined,
      triggeredTaskRunId: undefined as string | undefined,
      orchestrationRunId: undefined as string | undefined,
      orchestrationNodeId: undefined as string | undefined,
      summaryNotifyChannel: undefined as string | undefined,
      summaryNotifyThreadTs: undefined as string | undefined,
      ...((jobOv as Record<string, unknown>) ?? {}),
    },
    flags: {
      isDashboard: false,
      isSchedule: false,
      isAssistant: false,
      isOndemandTask: false,
      isTriggeredTask: false,
      isOrchestrator: false,
      isOrchestratorSummary: false,
      ...((flagsOv as Record<string, unknown>) ?? {}),
    },
    jobStream: (rest.jobStream ?? null) as null | { onDone: ReturnType<typeof vi.fn> },
    jlog: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    messenger: {},
  };
}

function makeOutcome(overrides: Record<string, unknown> = {}) {
  return {
    jobFailed: false,
    taskOutputSummary: '',
    taskOutputRaw: '',
    taskExitCode: 0 as number | null,
    taskErrorKind: null as string | null,
    archivedFiles: [] as Array<{
      localPath: string;
      filename: string;
      size: number;
      mimeType: string;
    }>,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.extractSummaryContent.mockReturnValue(null);
  mocked.exceedsFileUploadThreshold.mockReturnValue(false);
});

describe('finishJobExecution — triggered task coverage (lines 75-76)', () => {
  it('calls completeTriggeredTaskRun when isTriggeredTask flag is set', async () => {
    const ctx = makeCtx();
    const prepared = makePrepared({
      flags: { isTriggeredTask: true },
      job: {
        source: 'triggered-task',
        triggeredTaskRunId: 'tr-run-1',
      },
    });
    await finishJobExecution({
      ctx: ctx as never,
      prepared: prepared as never,
      outcome: makeOutcome() as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    expect(mocked.completeTriggeredTaskRun).toHaveBeenCalledWith(
      ctx,
      prepared.job,
      expect.objectContaining({ jobFailed: false }),
      prepared.jlog,
      expect.any(Function),
    );
  });
});

describe('finishOrchestratorSummary — multi-block post failure for failure summary (lines 141-145)', () => {
  it('warns on individual failure-summary block post failure', async () => {
    mocked.buildMarkdownMessage.mockReturnValueOnce([
      {
        blocks: [{ type: 'markdown', text: 'chunk1' }],
        text: 'chunk1',
      },
      {
        blocks: [{ type: 'markdown', text: 'chunk2' }],
        text: 'chunk2',
      },
    ]);
    const ctx = makeCtx();
    // Second postMessage call fails
    ctx.webClient.chat.postMessage
      .mockResolvedValueOnce({ ts: '2.2' })
      .mockRejectedValueOnce(new Error('slack rate limit'));
    const prepared = makePrepared({
      flags: { isOrchestratorSummary: true },
      job: {
        summaryNotifyChannel: 'C_SUM',
        summaryNotifyThreadTs: '5.5',
        source: 'orchestrator-summary',
      },
    });
    await finishJobExecution({
      ctx: ctx as never,
      prepared: prepared as never,
      outcome: makeOutcome({
        jobFailed: true,
        taskErrorKind: 'timeout',
        taskOutputSummary: 'timed out',
      }) as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    expect(prepared.jlog.warn).toHaveBeenCalledWith(
      'orchestrator_summary_block_post_failed',
      expect.objectContaining({ index: 1 }),
    );
  });
});

describe('finishOrchestratorSummary — multi-block post failure for raw output (lines 204-208)', () => {
  it('warns on individual raw-output block post failure when extractSummaryContent returns null', async () => {
    mocked.extractSummaryContent.mockReturnValue(null);
    mocked.buildMarkdownMessage.mockReturnValueOnce([
      {
        blocks: [{ type: 'markdown', text: 'raw chunk1' }],
        text: 'raw chunk1',
      },
      {
        blocks: [{ type: 'markdown', text: 'raw chunk2' }],
        text: 'raw chunk2',
      },
    ]);
    const ctx = makeCtx();
    // First succeeds, second fails
    ctx.webClient.chat.postMessage
      .mockResolvedValueOnce({ ts: '2.2' })
      .mockRejectedValueOnce(new Error('slack fail'));
    const prepared = makePrepared({
      flags: { isOrchestratorSummary: true },
      job: {
        summaryNotifyChannel: 'C_SUM',
        summaryNotifyThreadTs: '5.5',
        source: 'orchestrator-summary',
      },
    });
    await finishJobExecution({
      ctx: ctx as never,
      prepared: prepared as never,
      outcome: makeOutcome({ taskOutputRaw: 'some raw output' }) as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    expect(prepared.jlog.warn).toHaveBeenCalledWith(
      'orchestrator_summary_block_post_failed',
      expect.objectContaining({ index: 1 }),
    );
  });
});
