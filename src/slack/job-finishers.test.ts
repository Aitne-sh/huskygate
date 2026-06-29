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

describe('finishJobExecution', () => {
  it('cleans up gemini runtime home', async () => {
    const ctx = makeCtx();
    const job = { tool: 'gemini' };
    const prepared = makePrepared({ job });
    // Ensure the tool is set on the actual job object
    expect(prepared.job.tool).toBe('gemini');
    await finishJobExecution({
      ctx: ctx as never,
      prepared: prepared as never,
      outcome: makeOutcome() as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    expect(mocked.cleanupGeminiRuntimeHome).toHaveBeenCalledWith('/tmp/work');
  });

  it('handles gemini cleanup failure', async () => {
    mocked.cleanupGeminiRuntimeHome.mockRejectedValueOnce(new Error('cleanup fail'));
    const ctx = makeCtx();
    const prepared = makePrepared({ job: { tool: 'gemini' } });
    await finishJobExecution({
      ctx: ctx as never,
      prepared: prepared as never,
      outcome: makeOutcome() as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    expect(prepared.jlog.warn).toHaveBeenCalledWith(
      'gemini_runtime_home_cleanup_failed',
      expect.any(Object),
    );
  });

  it('calls jobStream.onDone and deletes from jobEventStreams', async () => {
    const ctx = makeCtx();
    const onDone = vi.fn();
    const jobStream = { onDone };
    ctx.jobEventStreams.set('job-1', jobStream);
    const prepared = makePrepared({ jobStream });
    await finishJobExecution({
      ctx: ctx as never,
      prepared: prepared as never,
      outcome: makeOutcome() as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ exitCode: 0 }));
    expect(ctx.jobEventStreams.has('job-1')).toBe(false);
  });

  it('handles jobStream.onDone failure', async () => {
    const ctx = makeCtx();
    const onDone = vi.fn(() => {
      throw new Error('stream fail');
    });
    const jobStream = { onDone };
    const prepared = makePrepared({ jobStream });
    await finishJobExecution({
      ctx: ctx as never,
      prepared: prepared as never,
      outcome: makeOutcome() as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    expect(prepared.jlog.warn).toHaveBeenCalledWith('job_stream_done_failed', expect.any(Object));
  });

  it('calls orchestrator onNodeJobComplete', async () => {
    const ctx = makeCtx();
    const prepared = makePrepared({
      flags: { isOrchestrator: true },
      job: {
        orchestrationRunId: 'run-1',
        orchestrationNodeId: 'node-1',
      },
    });
    const result = await finishJobExecution({
      ctx: ctx as never,
      prepared: prepared as never,
      outcome: makeOutcome() as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    expect(ctx.orchestratorEngine.onNodeJobComplete).toHaveBeenCalled();
    expect(result.orchestratorCallbackDone).toBe(true);
  });

  it('handles orchestrator callback failure', async () => {
    const ctx = makeCtx();
    ctx.orchestratorEngine.onNodeJobComplete.mockRejectedValueOnce(new Error('orch fail'));
    const prepared = makePrepared({
      flags: { isOrchestrator: true },
      job: {
        orchestrationRunId: 'run-1',
        orchestrationNodeId: 'node-1',
      },
    });
    await finishJobExecution({
      ctx: ctx as never,
      prepared: prepared as never,
      outcome: makeOutcome() as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    expect(prepared.jlog.error).toHaveBeenCalledWith(
      'orchestrator_post_run_failed',
      expect.any(Object),
    );
  });
});

describe('finishOrchestratorSummary', () => {
  it('posts summary failed message when outcome has error', async () => {
    const ctx = makeCtx();
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
    expect(mocked.buildMarkdownMessage).toHaveBeenCalledWith({
      header: expect.stringContaining('summary failed (timeout)'),
      body: 'timed out',
    });
    expect(ctx.webClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C_SUM',
        thread_ts: '5.5',
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('summary failed (timeout)'),
            }),
          }),
          expect.objectContaining({ type: 'markdown', text: 'timed out' }),
        ]),
        text: expect.stringContaining('summary failed (timeout)'),
      }),
    );
  });

  it('posts summary with exit code when no taskErrorKind', async () => {
    const ctx = makeCtx();
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
      outcome: makeOutcome({ jobFailed: true, taskExitCode: 42, taskOutputSummary: '' }) as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    expect(ctx.webClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('exit code 42'),
      }),
    );
  });

  it('posts summary with unknown error when no exit code and no error kind', async () => {
    const ctx = makeCtx();
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
      outcome: makeOutcome({ jobFailed: true, taskExitCode: null, taskOutputSummary: '' }) as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    expect(ctx.webClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('unknown error'),
      }),
    );
  });

  it('posts extracted summary content with markdown blocks', async () => {
    mocked.extractSummaryContent.mockReturnValue('Summary body here');
    const ctx = makeCtx();
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
      outcome: makeOutcome({ taskOutputRaw: 'raw output' }) as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    expect(mocked.buildSummaryBlocks).toHaveBeenCalledWith('Summary body here');
    expect(ctx.webClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C_SUM',
        thread_ts: '5.5',
        blocks: expect.arrayContaining([expect.objectContaining({ type: 'markdown' })]),
        text: expect.stringContaining('Execution Summary'),
      }),
    );
  });

  it('posts warning when extractSummaryContent returns null', async () => {
    mocked.extractSummaryContent.mockReturnValue(null);
    const ctx = makeCtx();
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
      outcome: makeOutcome({ taskOutputRaw: 'bad format output' }) as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    expect(mocked.buildMarkdownMessage).toHaveBeenCalledWith({
      header: expect.stringContaining('did not produce the expected format'),
      body: 'bad format output',
    });
    expect(ctx.webClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({ type: 'markdown', text: 'bad format output' }),
        ]),
        text: expect.stringContaining('did not produce the expected format'),
      }),
    );
  });

  it('posts warning when no text output', async () => {
    const ctx = makeCtx();
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
      outcome: makeOutcome({ taskOutputRaw: '' }) as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    expect(ctx.webClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('returned no text'),
      }),
    );
  });

  it('uploads archived files for orchestrator summary', async () => {
    mocked.extractSummaryContent.mockReturnValue(null);
    const ctx = makeCtx();
    const prepared = makePrepared({
      flags: { isOrchestratorSummary: true },
      job: {
        summaryNotifyChannel: 'C_SUM',
        summaryNotifyThreadTs: '5.5',
        source: 'orchestrator-summary',
      },
    });
    const archivedFiles = [
      { localPath: '/tmp/file.png', filename: 'file.png', size: 1000, mimeType: 'image/png' },
    ];
    await finishJobExecution({
      ctx: ctx as never,
      prepared: prepared as never,
      outcome: makeOutcome({ taskOutputRaw: 'output', archivedFiles }) as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    expect(mocked.uploadArchivedFilesToThread).toHaveBeenCalledWith(
      expect.any(Function),
      'C_SUM',
      '5.5',
      archivedFiles,
      'orchestrator_summary',
      expect.any(Object),
    );
  });

  it('handles summary post error', async () => {
    const ctx = makeCtx();
    ctx.webClient.chat.postMessage.mockRejectedValueOnce(new Error('slack fail'));
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
      outcome: makeOutcome({ taskOutputRaw: '' }) as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    expect(prepared.jlog.error).toHaveBeenCalledWith(
      'orchestrator_summary_post_failed',
      expect.any(Object),
    );
  });

  it('handles cleanup failure for orchestrator summary', async () => {
    const ctx = makeCtx();
    const cleanup = vi.fn(() => {
      throw new Error('cleanup fail');
    });
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
      outcome: makeOutcome({ taskOutputRaw: '' }) as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: cleanup,
    });
    expect(prepared.jlog.warn).toHaveBeenCalledWith(
      'orchestrator_summary_session_cleanup_failed',
      expect.any(Object),
    );
  });

  it('skips summary posting when no channel/thread', async () => {
    const ctx = makeCtx();
    const prepared = makePrepared({
      flags: { isOrchestratorSummary: true },
      job: {
        summaryNotifyChannel: null,
        summaryNotifyThreadTs: null,
        source: 'orchestrator-summary',
      },
    });
    const cleanup = vi.fn();
    await finishJobExecution({
      ctx: ctx as never,
      prepared: prepared as never,
      outcome: makeOutcome() as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: cleanup,
    });
    expect(ctx.webClient.chat.postMessage).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('posts multi-chunk summary with markdown blocks', async () => {
    mocked.extractSummaryContent.mockReturnValue('Summary body');
    mocked.buildSummaryBlocks.mockReturnValueOnce([
      {
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: ':clipboard: *Execution Summary*' } },
          { type: 'markdown', text: 'chunk1' },
        ],
        text: ':clipboard: *Execution Summary*\n\nchunk1',
      },
      {
        blocks: [{ type: 'markdown', text: 'chunk2' }],
        text: '(continued 2/2)',
      },
    ]);
    const ctx = makeCtx();
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
      outcome: makeOutcome({ taskOutputRaw: 'raw output' }) as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    expect(ctx.webClient.chat.postMessage).toHaveBeenCalledTimes(2);
    expect(ctx.webClient.chat.postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({ type: 'markdown', text: 'chunk1' }),
        ]),
        text: expect.stringContaining('Execution Summary'),
      }),
    );
    expect(ctx.webClient.chat.postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({ type: 'markdown', text: 'chunk2' }),
        ]),
        text: '(continued 2/2)',
      }),
    );
  });

  it('warns on individual summary block post failure', async () => {
    mocked.extractSummaryContent.mockReturnValue('Summary body');
    const ctx = makeCtx();
    ctx.webClient.chat.postMessage.mockRejectedValueOnce(new Error('rate limited'));
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
      outcome: makeOutcome({ taskOutputRaw: 'raw output' }) as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    expect(prepared.jlog.warn).toHaveBeenCalledWith(
      'orchestrator_summary_block_post_failed',
      expect.objectContaining({ index: 0 }),
    );
  });

  it('uploads summary as .md file when exceeding threshold', async () => {
    mocked.extractSummaryContent.mockReturnValue('Very long summary content');
    mocked.exceedsFileUploadThreshold.mockReturnValueOnce(true);
    const ctx = makeCtx();
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
      outcome: makeOutcome({ taskOutputRaw: 'raw output' }) as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    expect(ctx.webClient.filesUploadV2).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: 'C_SUM',
        thread_ts: '5.5',
        filename: 'summary.md',
        title: 'Full Execution Summary',
      }),
    );
  });

  it('warns when summary file upload fails', async () => {
    mocked.extractSummaryContent.mockReturnValue('Very long summary content');
    mocked.exceedsFileUploadThreshold.mockReturnValueOnce(true);
    const ctx = makeCtx();
    ctx.webClient.filesUploadV2.mockRejectedValueOnce(new Error('upload quota exceeded'));
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
      outcome: makeOutcome({ taskOutputRaw: 'raw output' }) as never,
      jobStartedAt: Date.now(),
      cleanupStandaloneSessionResourcesOnce: vi.fn(),
    });
    // Block message should still have been posted successfully
    expect(ctx.webClient.chat.postMessage).toHaveBeenCalledOnce();
    expect(prepared.jlog.warn).toHaveBeenCalledWith(
      'orchestrator_summary_file_upload_failed',
      expect.objectContaining({ error: 'upload quota exceeded' }),
    );
  });
});
