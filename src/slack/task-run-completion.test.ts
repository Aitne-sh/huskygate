import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  readFileSync: vi.fn(() => Buffer.from('file-data')),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  randomUUID: vi.fn(() => 'uuid-1234'),
  resolveInstruction: vi.fn(() => 'instruction-content'),
  getInstructionFilePath: vi.fn(() => '/tmp/work/.instructions'),
  formatMention: vi.fn((userId: string | null | undefined) => (userId ? `<@${userId}>` : '')),
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  appendTriggerContext: vi.fn(
    (_prompt: string, _header: string, _ctx: unknown) => 'prompt+trigger',
  ),
  parseTriggerContext: vi.fn(() => ({ key: 'value' })),
  buildTaskCompletionBlocks: vi.fn((_opts: Record<string, unknown>) => [
    {
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: 'header' } },
        { type: 'markdown', text: 'body' },
        { type: 'context', elements: [{ type: 'mrkdwn', text: 'footer' }] },
      ],
      text: 'fallback',
    },
  ]),
  exceedsFileUploadThreshold: vi.fn((_body: string) => false),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: mocked.readFileSync,
    mkdirSync: mocked.mkdirSync,
    writeFileSync: mocked.writeFileSync,
  };
});

vi.mock('node:crypto', () => ({
  default: { randomUUID: mocked.randomUUID },
}));

vi.mock('../instructions/builder.js', () => ({
  resolveInstruction: mocked.resolveInstruction,
}));

vi.mock('../orchestrator/engine-utils.js', () => ({
  getInstructionFilePath: mocked.getInstructionFilePath,
}));

vi.mock('../shared/text-utils.js', () => ({
  formatMention: mocked.formatMention,
}));

vi.mock('./markdown-blocks.js', () => ({
  buildTaskCompletionBlocks: mocked.buildTaskCompletionBlocks,
  exceedsFileUploadThreshold: mocked.exceedsFileUploadThreshold,
}));

vi.mock('../utils/error.js', () => ({
  errorMessage: mocked.errorMessage,
}));

vi.mock('../shared/file-attachment.js', () => ({
  MAX_FILE_UPLOADS: 3,
}));

vi.mock('../event/trigger-context.js', () => ({
  appendTriggerContext: mocked.appendTriggerContext,
  parseTriggerContext: mocked.parseTriggerContext,
}));

vi.mock('../shared/standalone-session-cleanup.js', () => ({
  cleanupStandaloneSessionResources: vi.fn(),
}));

import {
  completeOndemandTaskRun,
  completeScheduleRun,
  completeTriggeredTaskRun,
  requiresStandaloneSessionCleanup,
  uploadArchivedFilesToThread,
} from './task-run-completion.js';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeOutcome(overrides: Record<string, unknown> = {}) {
  return {
    jobFailed: false,
    taskExitCode: 0,
    taskOutputSummary: 'done',
    taskOutputRaw: 'raw output',
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

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    sessionKey: 'sess-1',
    channelId: 'C1',
    threadTs: '1.1',
    userId: 'U1',
    tool: 'claude' as const,
    mode: 'write',
    prompt: 'do stuff',
    workdir: '/tmp/work',
    toolState: {},
    createdAt: Date.now(),
    source: 'schedule' as const,
    scheduleTaskId: 'task-1',
    scheduleRunId: 'run-1',
    ...overrides,
  };
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    webClient: {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: '2.2' }),
      },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    },
    scheduleStore: {
      updateRun: vi.fn(),
      getById: vi.fn().mockReturnValue(null),
      getRunById: vi.fn().mockReturnValue(null),
      recordRun: vi.fn(),
      update: vi.fn(),
    },
    ondemandTaskStore: {
      updateRun: vi.fn(),
      getById: vi.fn().mockReturnValue(null),
      getRunById: vi.fn().mockReturnValue(null),
      recordRun: vi.fn(),
      incrementRunCount: vi.fn(),
    },
    triggeredTaskStore: {
      updateRun: vi.fn(),
      getById: vi.fn().mockReturnValue(null),
      getRunById: vi.fn().mockReturnValue(null),
      recordRun: vi.fn(),
      incrementRunCount: vi.fn(),
      releaseClaim: vi.fn(),
    },
    sessionManager: {
      createStandaloneSession: vi.fn(() => ({
        sessionKey: 'retry-sess',
        workdir: '/tmp/retry-work',
      })),
      updateMode: vi.fn(),
    },
    workdirManager: {
      prepareWorkdirSkillsOnly: vi.fn(),
    },
    defaultInstructionStore: {
      getWithEnabled: vi.fn(() => ({ content: '', enabled: false })),
    },
    jobQueue: {
      enqueue: vi.fn().mockReturnValue({ position: 0 }),
    },
    config: {
      scheduleDefaultNotifyChannel: null as string | null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.readFileSync.mockReturnValue(Buffer.from('file-data'));
  mocked.buildTaskCompletionBlocks.mockReturnValue([
    {
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: 'header' } },
        { type: 'markdown', text: 'body' },
        { type: 'context', elements: [{ type: 'mrkdwn', text: 'footer' }] },
      ],
      text: 'fallback',
    },
  ]);
  mocked.exceedsFileUploadThreshold.mockReturnValue(false);
});

// ---------------------------------------------------------------------------
// requiresStandaloneSessionCleanup
// ---------------------------------------------------------------------------

describe('requiresStandaloneSessionCleanup', () => {
  it('returns true for schedule', () => {
    expect(requiresStandaloneSessionCleanup('schedule')).toBe(true);
  });
  it('returns true for ondemand-task', () => {
    expect(requiresStandaloneSessionCleanup('ondemand-task')).toBe(true);
  });
  it('returns true for triggered-task', () => {
    expect(requiresStandaloneSessionCleanup('triggered-task')).toBe(true);
  });
  it('returns true for orchestrator-summary', () => {
    expect(requiresStandaloneSessionCleanup('orchestrator-summary')).toBe(true);
  });
  it('returns false for slack source', () => {
    expect(requiresStandaloneSessionCleanup('slack' as never)).toBe(false);
  });
  it('returns false for undefined', () => {
    expect(requiresStandaloneSessionCleanup(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// uploadArchivedFilesToThread
// ---------------------------------------------------------------------------

describe('uploadArchivedFilesToThread', () => {
  it('uploads files to thread', async () => {
    const upload = vi.fn().mockResolvedValue({});
    const jlog = makeLogger();
    const files = [
      { localPath: '/tmp/a.txt', filename: 'a.txt', size: 100, mimeType: 'text/plain' },
    ];
    await uploadArchivedFilesToThread(upload, 'C1', '1.1', files, 'test', jlog as never);
    expect(upload).toHaveBeenCalledOnce();
    expect(jlog.info).toHaveBeenCalledWith('test_files_uploaded', { count: 1 });
  });

  it('logs warning on upload failure', async () => {
    const upload = vi.fn().mockRejectedValue(new Error('fail'));
    const jlog = makeLogger();
    const files = [
      { localPath: '/tmp/a.txt', filename: 'a.txt', size: 100, mimeType: 'text/plain' },
    ];
    await uploadArchivedFilesToThread(upload, 'C1', '1.1', files, 'test', jlog as never);
    expect(jlog.warn).toHaveBeenCalledWith('test_file_upload_failed', expect.any(Object));
    expect(jlog.warn).toHaveBeenCalledWith('test_files_upload_partial_failure', expect.any(Object));
  });

  it('respects MAX_FILE_UPLOADS limit', async () => {
    const upload = vi.fn().mockResolvedValue({});
    const jlog = makeLogger();
    const files = Array.from({ length: 5 }, (_, i) => ({
      localPath: `/tmp/${i}.txt`,
      filename: `${i}.txt`,
      size: 100,
      mimeType: 'text/plain',
    }));
    // MAX_FILE_UPLOADS is mocked to 3
    await uploadArchivedFilesToThread(upload, 'C1', '1.1', files, 'test', jlog as never);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(jlog.warn).toHaveBeenCalledWith('test_file_upload_limit_reached', {
      limit: 3,
      total: 5,
    });
  });

  it('does not log when no files uploaded and none failed', async () => {
    const upload = vi.fn().mockResolvedValue({});
    const jlog = makeLogger();
    await uploadArchivedFilesToThread(upload, 'C1', '1.1', [], 'test', jlog as never);
    expect(jlog.info).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// completeScheduleRun
// ---------------------------------------------------------------------------

describe('completeScheduleRun', () => {
  it('early-returns when scheduleRunId is missing', async () => {
    const ctx = makeCtx();
    const jlog = makeLogger();
    const job = makeJob({ scheduleRunId: null });
    const cleanup = vi.fn();
    await completeScheduleRun(
      ctx as never,
      job as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );
    expect(ctx.scheduleStore.updateRun).not.toHaveBeenCalled();
  });

  it('early-returns when scheduleStore is null', async () => {
    const ctx = makeCtx({ scheduleStore: null });
    const jlog = makeLogger();
    const cleanup = vi.fn();
    await completeScheduleRun(
      ctx as never,
      makeJob() as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('completes a successful schedule run with notification using Block Kit', async () => {
    const ctx = makeCtx();
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'task-1',
      name: 'My Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: 'C2',
      notifyThread: '3.3',
      maxRetries: 0,
      nextRunAt: null,
    };
    ctx.scheduleStore.getById.mockReturnValue(task);

    await completeScheduleRun(
      ctx as never,
      makeJob() as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );

    expect(ctx.scheduleStore.updateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'completed',
        exitCode: 0,
      }),
    );
    // Verify Block Kit blocks and text fallback are passed
    expect(ctx.webClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C2',
        thread_ts: '3.3',
        blocks: expect.any(Array),
        text: expect.any(String),
      }),
    );
    // Verify buildTaskCompletionBlocks was called with correct task metadata
    expect(mocked.buildTaskCompletionBlocks).toHaveBeenCalledWith(
      expect.objectContaining({
        emoji: ':white_check_mark:',
        taskType: 'Schedule Task',
        taskName: 'My Task',
        tool: 'claude',
        status: 'completed',
        exitCode: 0,
      }),
    );
    expect(cleanup).toHaveBeenCalledOnce();
    expect(jlog.info).toHaveBeenCalledWith('schedule_session_cleaned', expect.any(Object));
  });

  it('marks task as completed when nextRunAt is null and not retried', async () => {
    const ctx = makeCtx();
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'task-1',
      name: 'My Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: null,
      notifyThread: null,
      maxRetries: 0,
      nextRunAt: null,
    };
    ctx.scheduleStore.getById.mockReturnValue(task);

    await completeScheduleRun(
      ctx as never,
      makeJob() as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );

    expect(ctx.scheduleStore.update).toHaveBeenCalledWith('task-1', { status: 'completed' });
  });

  it('retries on failure when maxRetries > 0 and retryCount < maxRetries', async () => {
    const ctx = makeCtx();
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'task-1',
      name: 'My Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: 'C2',
      notifyThread: null,
      maxRetries: 3,
      nextRunAt: '2026-01-01',
    };
    ctx.scheduleStore.getById.mockReturnValue(task);
    ctx.scheduleStore.getRunById.mockReturnValue({ retryCount: 0, source: 'cron' });

    await completeScheduleRun(
      ctx as never,
      makeJob() as never,
      makeOutcome({ jobFailed: true, taskExitCode: 1 }) as never,
      jlog as never,
      cleanup,
    );

    expect(ctx.scheduleStore.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        retryCount: 1,
        status: 'running',
      }),
    );
    expect(ctx.jobQueue.enqueue).toHaveBeenCalled();
    expect(jlog.info).toHaveBeenCalledWith('schedule_retry_enqueued', expect.any(Object));
  });

  it('handles retry enqueue failure', async () => {
    const ctx = makeCtx();
    ctx.jobQueue.enqueue.mockReturnValue({ error: 'queue full' });
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'task-1',
      name: 'My Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: 'C2',
      notifyThread: null,
      maxRetries: 3,
      nextRunAt: '2026-01-01',
    };
    ctx.scheduleStore.getById.mockReturnValue(task);
    ctx.scheduleStore.getRunById.mockReturnValue({ retryCount: 0, source: 'cron' });

    await completeScheduleRun(
      ctx as never,
      makeJob() as never,
      makeOutcome({ jobFailed: true, taskExitCode: 1 }) as never,
      jlog as never,
      cleanup,
    );

    expect(ctx.scheduleStore.updateRun).toHaveBeenCalledWith(
      'uuid-1234',
      expect.objectContaining({
        status: 'failed',
      }),
    );
  });

  it('handles retry preparation error', async () => {
    const ctx = makeCtx();
    ctx.sessionManager.createStandaloneSession.mockImplementation(() => {
      throw new Error('session fail');
    });
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'task-1',
      name: 'My Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: null,
      notifyThread: null,
      maxRetries: 3,
      nextRunAt: '2026-01-01',
    };
    ctx.scheduleStore.getById.mockReturnValue(task);
    ctx.scheduleStore.getRunById.mockReturnValue({ retryCount: 0, source: 'cron' });

    await completeScheduleRun(
      ctx as never,
      makeJob() as never,
      makeOutcome({ jobFailed: true, taskExitCode: 1 }) as never,
      jlog as never,
      cleanup,
    );

    expect(jlog.error).toHaveBeenCalledWith('schedule_retry_failed', expect.any(Object));
  });

  it('handles task finalize error', async () => {
    const ctx = makeCtx();
    ctx.scheduleStore.update.mockImplementation(() => {
      throw new Error('finalize error');
    });
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'task-1',
      name: 'My Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: null,
      notifyThread: null,
      maxRetries: 0,
      nextRunAt: null,
    };
    ctx.scheduleStore.getById.mockReturnValue(task);

    await completeScheduleRun(
      ctx as never,
      makeJob() as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );

    expect(jlog.error).toHaveBeenCalledWith('schedule_task_finalize_failed', expect.any(Object));
  });

  it('uses scheduleDefaultNotifyChannel when task has no notifyChannel', async () => {
    const ctx = makeCtx({ config: { scheduleDefaultNotifyChannel: 'C_DEFAULT' } });
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'task-1',
      name: 'My Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: null,
      notifyThread: null,
      maxRetries: 0,
      nextRunAt: '2026-01-01',
    };
    ctx.scheduleStore.getById.mockReturnValue(task);

    await completeScheduleRun(
      ctx as never,
      makeJob() as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );

    expect(ctx.webClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C_DEFAULT', blocks: expect.any(Array) }),
    );
  });

  it('handles notification error gracefully (per-message catch)', async () => {
    const ctx = makeCtx();
    ctx.webClient.chat.postMessage.mockRejectedValueOnce(new Error('slack fail'));
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'task-1',
      name: 'My Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: 'C2',
      notifyThread: null,
      maxRetries: 0,
      nextRunAt: '2026-01-01',
    };
    ctx.scheduleStore.getById.mockReturnValue(task);

    await completeScheduleRun(
      ctx as never,
      makeJob() as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );

    // Individual message failures are caught inside postTaskRunNotification
    expect(jlog.warn).toHaveBeenCalledWith('schedule_block_post_failed', expect.any(Object));
  });

  it('handles updateRun error at the top level', async () => {
    const ctx = makeCtx();
    ctx.scheduleStore.updateRun.mockImplementation(() => {
      throw new Error('db fail');
    });
    const jlog = makeLogger();
    const cleanup = vi.fn();

    await completeScheduleRun(
      ctx as never,
      makeJob() as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );

    expect(jlog.error).toHaveBeenCalledWith('schedule_run_update_failed', expect.any(Object));
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('handles cleanup failure', async () => {
    const ctx = makeCtx({ scheduleStore: null });
    const jlog = makeLogger();
    const cleanup = vi.fn(() => {
      throw new Error('cleanup fail');
    });

    // scheduleStore null + scheduleRunId missing => early return, then cleanup
    await completeScheduleRun(
      ctx as never,
      makeJob({ scheduleRunId: 'run-1', scheduleStore: null }) as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );

    // cleanup is not called when scheduleStore is null (early return)
  });

  it('posts multiple messages for multi-chunk output', async () => {
    mocked.buildTaskCompletionBlocks.mockReturnValue([
      {
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: 'h' } },
          { type: 'markdown', text: 'c1' },
        ],
        text: 'f1',
      },
      { blocks: [{ type: 'markdown', text: 'c2' }], text: 'f2' },
    ]);
    const ctx = makeCtx();
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'task-1',
      name: 'My Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: 'C2',
      notifyThread: null,
      maxRetries: 0,
      nextRunAt: '2026-01-01',
    };
    ctx.scheduleStore.getById.mockReturnValue(task);

    await completeScheduleRun(
      ctx as never,
      makeJob() as never,
      makeOutcome({ taskOutputRaw: 'long output text' }) as never,
      jlog as never,
      cleanup,
    );

    // 2 messages (one per chunk)
    expect(ctx.webClient.chat.postMessage).toHaveBeenCalledTimes(2);
    // Both calls include blocks
    for (const call of ctx.webClient.chat.postMessage.mock.calls) {
      expect(call[0]).toHaveProperty('blocks');
      expect(call[0]).toHaveProperty('text');
    }
  });

  it('handles block post error gracefully', async () => {
    const ctx = makeCtx();
    ctx.webClient.chat.postMessage.mockRejectedValueOnce(new Error('block fail'));
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'task-1',
      name: 'My Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: 'C2',
      notifyThread: null,
      maxRetries: 0,
      nextRunAt: '2026-01-01',
    };
    ctx.scheduleStore.getById.mockReturnValue(task);

    await completeScheduleRun(
      ctx as never,
      makeJob() as never,
      makeOutcome({ taskOutputRaw: 'some output' }) as never,
      jlog as never,
      cleanup,
    );

    expect(jlog.warn).toHaveBeenCalledWith('schedule_block_post_failed', expect.any(Object));
  });

  it('uploads full output as .md when exceeding file upload threshold', async () => {
    mocked.exceedsFileUploadThreshold.mockReturnValue(true);
    const ctx = makeCtx();
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'task-1',
      name: 'My Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: 'C2',
      notifyThread: null,
      maxRetries: 0,
      nextRunAt: '2026-01-01',
    };
    ctx.scheduleStore.getById.mockReturnValue(task);

    await completeScheduleRun(
      ctx as never,
      makeJob() as never,
      makeOutcome({ taskOutputRaw: 'huge output' }) as never,
      jlog as never,
      cleanup,
    );

    expect(ctx.webClient.filesUploadV2).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'output.md',
        title: 'Full Output',
      }),
    );
  });

  it('uploads files when archivedFiles are present', async () => {
    const ctx = makeCtx();
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'task-1',
      name: 'My Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: 'C2',
      notifyThread: null,
      maxRetries: 0,
      nextRunAt: '2026-01-01',
    };
    ctx.scheduleStore.getById.mockReturnValue(task);

    const outcome = makeOutcome({
      taskOutputRaw: '',
      archivedFiles: [
        { localPath: '/tmp/file.png', filename: 'file.png', size: 1000, mimeType: 'image/png' },
      ],
    });

    await completeScheduleRun(
      ctx as never,
      makeJob() as never,
      outcome as never,
      jlog as never,
      cleanup,
    );

    expect(ctx.webClient.filesUploadV2).toHaveBeenCalled();
  });

  it('handles schedule cleanup failure after successful run', async () => {
    const ctx = makeCtx();
    const jlog = makeLogger();
    const cleanup = vi.fn(() => {
      throw new Error('cleanup oops');
    });
    const task = {
      id: 'task-1',
      name: 'My Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: null,
      notifyThread: null,
      maxRetries: 0,
      nextRunAt: '2026-01-01',
    };
    ctx.scheduleStore.getById.mockReturnValue(task);

    await completeScheduleRun(
      ctx as never,
      makeJob() as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );

    expect(jlog.warn).toHaveBeenCalledWith('schedule_session_cleanup_failed', expect.any(Object));
  });
});

// ---------------------------------------------------------------------------
// completeOndemandTaskRun
// ---------------------------------------------------------------------------

describe('completeOndemandTaskRun', () => {
  it('early-returns when ondemandTaskRunId is missing', async () => {
    const ctx = makeCtx();
    const jlog = makeLogger();
    const cleanup = vi.fn();
    await completeOndemandTaskRun(
      ctx as never,
      makeJob({ ondemandTaskRunId: null, source: 'ondemand-task' }) as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );
    expect(ctx.ondemandTaskStore.updateRun).not.toHaveBeenCalled();
  });

  it('early-returns when ondemandTaskStore is null', async () => {
    const ctx = makeCtx({ ondemandTaskStore: null });
    const jlog = makeLogger();
    const cleanup = vi.fn();
    await completeOndemandTaskRun(
      ctx as never,
      makeJob({ ondemandTaskRunId: 'odr-1', source: 'ondemand-task' }) as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('completes a successful ondemand run with Block Kit notification', async () => {
    const ctx = makeCtx();
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'od-1',
      name: 'OD Task',
      tool: 'gemini',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: 'C3',
      notifyThread: '4.4',
      maxRetries: 0,
    };
    ctx.ondemandTaskStore.getById.mockReturnValue(task);

    await completeOndemandTaskRun(
      ctx as never,
      makeJob({
        ondemandTaskRunId: 'odr-1',
        ondemandTaskId: 'od-1',
        source: 'ondemand-task',
      }) as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );

    expect(ctx.ondemandTaskStore.updateRun).toHaveBeenCalledWith(
      'odr-1',
      expect.objectContaining({
        status: 'completed',
      }),
    );
    expect(ctx.ondemandTaskStore.incrementRunCount).toHaveBeenCalled();
    expect(ctx.webClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C3',
        thread_ts: '4.4',
        blocks: expect.any(Array),
        text: expect.any(String),
      }),
    );
    expect(mocked.buildTaskCompletionBlocks).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'On-Demand Task',
        taskName: 'OD Task',
        tool: 'gemini',
      }),
    );
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('retries on failure when maxRetries > 0', async () => {
    const ctx = makeCtx();
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'od-1',
      name: 'OD Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: 'C3',
      notifyThread: null,
      maxRetries: 2,
    };
    ctx.ondemandTaskStore.getById.mockReturnValue(task);
    ctx.ondemandTaskStore.getRunById.mockReturnValue({ retryCount: 0, source: 'api' });

    await completeOndemandTaskRun(
      ctx as never,
      makeJob({
        ondemandTaskRunId: 'odr-1',
        ondemandTaskId: 'od-1',
        source: 'ondemand-task',
      }) as never,
      makeOutcome({ jobFailed: true, taskExitCode: 1 }) as never,
      jlog as never,
      cleanup,
    );

    expect(ctx.ondemandTaskStore.recordRun).toHaveBeenCalled();
    expect(ctx.jobQueue.enqueue).toHaveBeenCalled();
    expect(jlog.info).toHaveBeenCalledWith('ondemand_retry_enqueued', expect.any(Object));
  });

  it('handles retry enqueue failure for ondemand', async () => {
    const ctx = makeCtx();
    ctx.jobQueue.enqueue.mockReturnValue({ error: 'full' });
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'od-1',
      name: 'OD Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: null,
      notifyThread: null,
      maxRetries: 2,
    };
    ctx.ondemandTaskStore.getById.mockReturnValue(task);
    ctx.ondemandTaskStore.getRunById.mockReturnValue({ retryCount: 0, source: 'api' });

    await completeOndemandTaskRun(
      ctx as never,
      makeJob({
        ondemandTaskRunId: 'odr-1',
        ondemandTaskId: 'od-1',
        source: 'ondemand-task',
      }) as never,
      makeOutcome({ jobFailed: true, taskExitCode: 1 }) as never,
      jlog as never,
      cleanup,
    );

    expect(ctx.ondemandTaskStore.updateRun).toHaveBeenCalledWith(
      'uuid-1234',
      expect.objectContaining({
        status: 'failed',
      }),
    );
  });

  it('handles ondemand retry preparation error', async () => {
    const ctx = makeCtx();
    ctx.sessionManager.createStandaloneSession.mockImplementation(() => {
      throw new Error('session fail');
    });
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'od-1',
      name: 'OD Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: null,
      notifyThread: null,
      maxRetries: 2,
    };
    ctx.ondemandTaskStore.getById.mockReturnValue(task);
    ctx.ondemandTaskStore.getRunById.mockReturnValue({ retryCount: 0, source: 'api' });

    await completeOndemandTaskRun(
      ctx as never,
      makeJob({
        ondemandTaskRunId: 'odr-1',
        ondemandTaskId: 'od-1',
        source: 'ondemand-task',
      }) as never,
      makeOutcome({ jobFailed: true, taskExitCode: 1 }) as never,
      jlog as never,
      cleanup,
    );

    expect(jlog.error).toHaveBeenCalledWith('ondemand_retry_failed', expect.any(Object));
  });

  it('handles notification error for ondemand (per-message catch)', async () => {
    const ctx = makeCtx();
    ctx.webClient.chat.postMessage.mockRejectedValueOnce(new Error('notify fail'));
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'od-1',
      name: 'OD Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: 'C3',
      notifyThread: null,
      maxRetries: 0,
    };
    ctx.ondemandTaskStore.getById.mockReturnValue(task);

    await completeOndemandTaskRun(
      ctx as never,
      makeJob({
        ondemandTaskRunId: 'odr-1',
        ondemandTaskId: 'od-1',
        source: 'ondemand-task',
      }) as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );

    // Individual message failures are caught inside postTaskRunNotification
    expect(jlog.warn).toHaveBeenCalledWith('ondemand_block_post_failed', expect.any(Object));
  });

  it('handles top-level updateRun error for ondemand', async () => {
    const ctx = makeCtx();
    ctx.ondemandTaskStore.updateRun.mockImplementation(() => {
      throw new Error('db fail');
    });
    const jlog = makeLogger();
    const cleanup = vi.fn();

    await completeOndemandTaskRun(
      ctx as never,
      makeJob({
        ondemandTaskRunId: 'odr-1',
        ondemandTaskId: 'od-1',
        source: 'ondemand-task',
      }) as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );

    expect(jlog.error).toHaveBeenCalledWith('ondemand_run_update_failed', expect.any(Object));
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('handles ondemand cleanup failure', async () => {
    const ctx = makeCtx();
    const jlog = makeLogger();
    const cleanup = vi.fn(() => {
      throw new Error('cleanup oops');
    });
    const task = {
      id: 'od-1',
      name: 'OD Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: null,
      notifyThread: null,
      maxRetries: 0,
    };
    ctx.ondemandTaskStore.getById.mockReturnValue(task);

    await completeOndemandTaskRun(
      ctx as never,
      makeJob({
        ondemandTaskRunId: 'odr-1',
        ondemandTaskId: 'od-1',
        source: 'ondemand-task',
      }) as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );

    expect(jlog.warn).toHaveBeenCalledWith('ondemand_session_cleanup_failed', expect.any(Object));
  });
});

// ---------------------------------------------------------------------------
// completeTriggeredTaskRun
// ---------------------------------------------------------------------------

describe('completeTriggeredTaskRun', () => {
  it('early-returns when triggeredTaskRunId is missing', async () => {
    const ctx = makeCtx();
    const jlog = makeLogger();
    const cleanup = vi.fn();
    await completeTriggeredTaskRun(
      ctx as never,
      makeJob({ triggeredTaskRunId: null, source: 'triggered-task' }) as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );
    expect(ctx.triggeredTaskStore.updateRun).not.toHaveBeenCalled();
  });

  it('early-returns when triggeredTaskStore is null', async () => {
    const ctx = makeCtx({ triggeredTaskStore: null });
    const jlog = makeLogger();
    const cleanup = vi.fn();
    await completeTriggeredTaskRun(
      ctx as never,
      makeJob({ triggeredTaskRunId: 'tr-1', source: 'triggered-task' }) as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('completes a successful triggered task run with Block Kit notification', async () => {
    const ctx = makeCtx();
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'tt-1',
      name: 'TT Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: 'C4',
      notifyThread: null,
      maxRetries: 0,
      prompt: 'do it',
      concurrencyPolicy: 'skip_if_running',
    };
    ctx.triggeredTaskStore.getById.mockReturnValue(task);

    await completeTriggeredTaskRun(
      ctx as never,
      makeJob({
        triggeredTaskRunId: 'tr-1',
        triggeredTaskId: 'tt-1',
        source: 'triggered-task',
      }) as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );

    expect(ctx.triggeredTaskStore.updateRun).toHaveBeenCalledWith(
      'tr-1',
      expect.objectContaining({
        status: 'completed',
      }),
    );
    expect(ctx.triggeredTaskStore.incrementRunCount).toHaveBeenCalled();
    expect(ctx.webClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C4',
        blocks: expect.any(Array),
        text: expect.any(String),
      }),
    );
    expect(mocked.buildTaskCompletionBlocks).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'Triggered Task',
        taskName: 'TT Task',
        tool: 'claude',
      }),
    );
    expect(ctx.triggeredTaskStore.releaseClaim).toHaveBeenCalledWith('tt-1');
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('retries triggered task on failure', async () => {
    const ctx = makeCtx();
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'tt-1',
      name: 'TT Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: 'C4',
      notifyThread: null,
      maxRetries: 2,
      prompt: 'do it',
      concurrencyPolicy: 'allow_concurrent',
    };
    ctx.triggeredTaskStore.getById.mockReturnValue(task);
    ctx.triggeredTaskStore.getRunById.mockReturnValue({
      retryCount: 0,
      triggeredBy: 'webhook',
      triggerContextJson: '{"key":"value"}',
    });

    await completeTriggeredTaskRun(
      ctx as never,
      makeJob({
        triggeredTaskRunId: 'tr-1',
        triggeredTaskId: 'tt-1',
        source: 'triggered-task',
      }) as never,
      makeOutcome({ jobFailed: true, taskExitCode: 1 }) as never,
      jlog as never,
      cleanup,
    );

    expect(ctx.triggeredTaskStore.recordRun).toHaveBeenCalled();
    expect(ctx.jobQueue.enqueue).toHaveBeenCalled();
    expect(jlog.info).toHaveBeenCalledWith('triggered_task_retry_enqueued', expect.any(Object));
  });

  it('handles retry enqueue failure for triggered task', async () => {
    const ctx = makeCtx();
    ctx.jobQueue.enqueue.mockReturnValue({ error: 'full' });
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'tt-1',
      name: 'TT Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: null,
      notifyThread: null,
      maxRetries: 2,
      prompt: 'do it',
      concurrencyPolicy: 'allow_concurrent',
    };
    ctx.triggeredTaskStore.getById.mockReturnValue(task);
    ctx.triggeredTaskStore.getRunById.mockReturnValue({
      retryCount: 0,
      triggeredBy: 'webhook',
      triggerContextJson: '{}',
    });

    await completeTriggeredTaskRun(
      ctx as never,
      makeJob({
        triggeredTaskRunId: 'tr-1',
        triggeredTaskId: 'tt-1',
        source: 'triggered-task',
      }) as never,
      makeOutcome({ jobFailed: true, taskExitCode: 1 }) as never,
      jlog as never,
      cleanup,
    );

    expect(ctx.triggeredTaskStore.updateRun).toHaveBeenCalledWith(
      'uuid-1234',
      expect.objectContaining({
        status: 'failed',
      }),
    );
  });

  it('handles retry preparation error for triggered task', async () => {
    const ctx = makeCtx();
    ctx.sessionManager.createStandaloneSession.mockImplementation(() => {
      throw new Error('session fail');
    });
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'tt-1',
      name: 'TT Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: null,
      notifyThread: null,
      maxRetries: 2,
      prompt: 'do it',
      concurrencyPolicy: 'allow_concurrent',
    };
    ctx.triggeredTaskStore.getById.mockReturnValue(task);
    ctx.triggeredTaskStore.getRunById.mockReturnValue({
      retryCount: 0,
      triggeredBy: 'webhook',
      triggerContextJson: '{}',
    });

    await completeTriggeredTaskRun(
      ctx as never,
      makeJob({
        triggeredTaskRunId: 'tr-1',
        triggeredTaskId: 'tt-1',
        source: 'triggered-task',
      }) as never,
      makeOutcome({ jobFailed: true, taskExitCode: 1 }) as never,
      jlog as never,
      cleanup,
    );

    expect(jlog.error).toHaveBeenCalledWith('triggered_task_retry_failed', expect.any(Object));
  });

  it('handles notification error for triggered task (per-message catch)', async () => {
    const ctx = makeCtx();
    ctx.webClient.chat.postMessage.mockRejectedValueOnce(new Error('fail'));
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'tt-1',
      name: 'TT Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: 'C4',
      notifyThread: null,
      maxRetries: 0,
      prompt: 'do it',
      concurrencyPolicy: 'allow_concurrent',
    };
    ctx.triggeredTaskStore.getById.mockReturnValue(task);

    await completeTriggeredTaskRun(
      ctx as never,
      makeJob({
        triggeredTaskRunId: 'tr-1',
        triggeredTaskId: 'tt-1',
        source: 'triggered-task',
      }) as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );

    // Individual message failures are caught inside postTaskRunNotification
    expect(jlog.warn).toHaveBeenCalledWith('triggered_task_block_post_failed', expect.any(Object));
  });

  it('handles top-level error and releases claim for skip_if_running', async () => {
    const ctx = makeCtx();
    ctx.triggeredTaskStore.updateRun.mockImplementation(() => {
      throw new Error('db fail');
    });
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'tt-1',
      name: 'TT Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: null,
      notifyThread: null,
      maxRetries: 0,
      prompt: 'do it',
      concurrencyPolicy: 'skip_if_running',
    };
    ctx.triggeredTaskStore.getById.mockReturnValue(task);

    await completeTriggeredTaskRun(
      ctx as never,
      makeJob({
        triggeredTaskRunId: 'tr-1',
        triggeredTaskId: 'tt-1',
        source: 'triggered-task',
      }) as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );

    expect(jlog.error).toHaveBeenCalledWith('triggered_task_run_update_failed', expect.any(Object));
    expect(ctx.triggeredTaskStore.releaseClaim).toHaveBeenCalledWith('tt-1');
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('handles triggered task cleanup failure', async () => {
    const ctx = makeCtx();
    const jlog = makeLogger();
    const cleanup = vi.fn(() => {
      throw new Error('cleanup fail');
    });
    const task = {
      id: 'tt-1',
      name: 'TT Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: null,
      notifyThread: null,
      maxRetries: 0,
      prompt: 'do it',
      concurrencyPolicy: 'allow_concurrent',
    };
    ctx.triggeredTaskStore.getById.mockReturnValue(task);

    await completeTriggeredTaskRun(
      ctx as never,
      makeJob({
        triggeredTaskRunId: 'tr-1',
        triggeredTaskId: 'tt-1',
        source: 'triggered-task',
      }) as never,
      makeOutcome() as never,
      jlog as never,
      cleanup,
    );

    expect(jlog.warn).toHaveBeenCalledWith(
      'triggered_task_session_cleanup_failed',
      expect.any(Object),
    );
  });

  it('does not release claim when retried with skip_if_running', async () => {
    const ctx = makeCtx();
    const jlog = makeLogger();
    const cleanup = vi.fn();
    const task = {
      id: 'tt-1',
      name: 'TT Task',
      tool: 'claude',
      userId: 'U1',
      workdir: null,
      instructionFile: null,
      enabledSkills: null,
      allowMcp: true,
      notifyChannel: null,
      notifyThread: null,
      maxRetries: 2,
      prompt: 'do it',
      concurrencyPolicy: 'skip_if_running',
    };
    ctx.triggeredTaskStore.getById.mockReturnValue(task);
    ctx.triggeredTaskStore.getRunById.mockReturnValue({
      retryCount: 0,
      triggeredBy: 'webhook',
      triggerContextJson: '{}',
    });

    await completeTriggeredTaskRun(
      ctx as never,
      makeJob({
        triggeredTaskRunId: 'tr-1',
        triggeredTaskId: 'tt-1',
        source: 'triggered-task',
      }) as never,
      makeOutcome({ jobFailed: true, taskExitCode: 1 }) as never,
      jlog as never,
      cleanup,
    );

    // retried = true, so releaseClaim should NOT be called
    expect(ctx.triggeredTaskStore.releaseClaim).not.toHaveBeenCalled();
  });
});
