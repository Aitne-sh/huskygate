/**
 * Coverage tests for task-run-completion.ts — targets:
 * - Lines 194-197: postTaskRunNotification output file upload failure
 * - Lines 344-345: schedule_slack_notify_failed
 * - Lines 462: ondemand task notification block
 * - Lines 483-484: ondemand_slack_notify_failed
 * - Lines 518: triggered task incrementRunCount
 * - Lines 612: triggered task notification status/label
 * - Lines 633-634: triggered_task_slack_notify_failed
 */
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
// postTaskRunNotification output file upload failure (lines 194-197)
// ---------------------------------------------------------------------------
describe('postTaskRunNotification output file upload failure', () => {
  it('warns when output file upload fails during schedule notification', async () => {
    mocked.exceedsFileUploadThreshold.mockReturnValue(true);
    const ctx = makeCtx();
    const filesUploadV2 = ctx.webClient.filesUploadV2 as ReturnType<typeof vi.fn>;
    filesUploadV2.mockRejectedValueOnce(new Error('upload fail'));
    ctx.scheduleStore.getById.mockReturnValue({
      id: 'task-1',
      name: 'Test Task',
      tool: 'claude',
      notifyChannel: 'C_NOTIFY',
      notifyThread: null,
      maxRetries: 0,
      nextRunAt: null,
    });
    ctx.scheduleStore.getRunById.mockReturnValue({
      retryCount: 0,
    });
    const jlog = makeLogger();
    await completeScheduleRun(
      ctx as never,
      makeJob(),
      makeOutcome({ taskOutputRaw: 'x'.repeat(50000) }),
      jlog as never,
      vi.fn(),
    );
    expect(jlog.warn).toHaveBeenCalledWith(
      'schedule_output_file_upload_failed',
      expect.objectContaining({ error: 'upload fail' }),
    );
  });
});

// ---------------------------------------------------------------------------
// schedule_slack_notify_failed (lines 344-345)
// ---------------------------------------------------------------------------
describe('schedule_slack_notify_failed', () => {
  it('logs error when postTaskRunNotification throws during schedule completion', async () => {
    const ctx = makeCtx();
    // Make buildTaskCompletionBlocks throw to cause postTaskRunNotification to throw
    mocked.buildTaskCompletionBlocks.mockImplementation(() => {
      throw new Error('slack api fail');
    });
    ctx.scheduleStore.getById.mockReturnValue({
      id: 'task-1',
      name: 'Test Task',
      tool: 'claude',
      notifyChannel: 'C_NOTIFY',
      notifyThread: null,
      maxRetries: 0,
      nextRunAt: null,
    });
    ctx.scheduleStore.getRunById.mockReturnValue({
      retryCount: 0,
    });
    const jlog = makeLogger();
    await completeScheduleRun(
      ctx as never,
      makeJob(),
      makeOutcome(),
      jlog as never,
      vi.fn(),
    );
    expect(jlog.error).toHaveBeenCalledWith(
      'schedule_slack_notify_failed',
      expect.objectContaining({ error: 'slack api fail' }),
    );
  });
});

// ---------------------------------------------------------------------------
// ondemand task notification (lines 462, 483-484)
// ---------------------------------------------------------------------------
describe('completeOndemandTaskRun notification', () => {
  it('posts notification and catches failure (lines 462, 483-484)', async () => {
    const ctx = makeCtx();
    ctx.ondemandTaskStore.getById.mockReturnValue({
      id: 'od-task-1',
      name: 'OD Task',
      tool: 'claude',
      notifyChannel: 'C_OD',
      notifyThread: null,
      maxRetries: 0,
    });
    ctx.ondemandTaskStore.getRunById.mockReturnValue({
      retryCount: 0,
    });
    // Make buildTaskCompletionBlocks throw to cause postTaskRunNotification to throw
    mocked.buildTaskCompletionBlocks.mockImplementation(() => {
      throw new Error('od notify fail');
    });
    const jlog = makeLogger();
    const job = makeJob({
      source: 'ondemand-task',
      ondemandTaskRunId: 'od-run-1',
      ondemandTaskId: 'od-task-1',
    });
    await completeOndemandTaskRun(
      ctx as never,
      job,
      makeOutcome(),
      jlog as never,
      vi.fn(),
    );
    expect(jlog.error).toHaveBeenCalledWith(
      'ondemand_slack_notify_failed',
      expect.objectContaining({ error: 'od notify fail' }),
    );
  });

  it('posts successful notification for ondemand task', async () => {
    const ctx = makeCtx();
    ctx.ondemandTaskStore.getById.mockReturnValue({
      id: 'od-task-1',
      name: 'OD Task',
      tool: 'claude',
      notifyChannel: 'C_OD',
      notifyThread: null,
      maxRetries: 0,
    });
    ctx.ondemandTaskStore.getRunById.mockReturnValue({
      retryCount: 0,
    });
    const jlog = makeLogger();
    const job = makeJob({
      source: 'ondemand-task',
      ondemandTaskRunId: 'od-run-1',
      ondemandTaskId: 'od-task-1',
    });
    await completeOndemandTaskRun(
      ctx as never,
      job,
      makeOutcome(),
      jlog as never,
      vi.fn(),
    );
    expect(ctx.webClient.chat.postMessage).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// triggered task (lines 518, 612, 633-634)
// ---------------------------------------------------------------------------
describe('completeTriggeredTaskRun', () => {
  it('increments run count and posts notification (lines 518, 612)', async () => {
    const ctx = makeCtx();
    ctx.triggeredTaskStore.getById.mockReturnValue({
      id: 'tt-1',
      name: 'Triggered Task',
      tool: 'claude',
      notifyChannel: 'C_TT',
      notifyThread: null,
      maxRetries: 0,
      concurrencyPolicy: 'allow',
      workdir: '/tmp/tt',
      instructionFile: null,
      enabledSkills: null,
      allowMcp: false,
    });
    ctx.triggeredTaskStore.getRunById.mockReturnValue({
      retryCount: 0,
    });
    const jlog = makeLogger();
    const job = makeJob({
      source: 'triggered-task',
      triggeredTaskRunId: 'tt-run-1',
      triggeredTaskId: 'tt-1',
    });
    await completeTriggeredTaskRun(
      ctx as never,
      job,
      makeOutcome(),
      jlog as never,
      vi.fn(),
    );
    expect(ctx.triggeredTaskStore.incrementRunCount).toHaveBeenCalledWith(
      'tt-1',
      expect.any(String),
    );
    expect(ctx.webClient.chat.postMessage).toHaveBeenCalled();
  });

  it('catches notification failure (lines 633-634)', async () => {
    const ctx = makeCtx();
    ctx.triggeredTaskStore.getById.mockReturnValue({
      id: 'tt-1',
      name: 'Triggered Task',
      tool: 'claude',
      notifyChannel: 'C_TT',
      notifyThread: null,
      maxRetries: 0,
      concurrencyPolicy: 'allow',
      workdir: '/tmp/tt',
      instructionFile: null,
      enabledSkills: null,
      allowMcp: false,
    });
    ctx.triggeredTaskStore.getRunById.mockReturnValue({
      retryCount: 0,
    });
    // Make buildTaskCompletionBlocks throw to cause postTaskRunNotification to throw
    mocked.buildTaskCompletionBlocks.mockImplementation(() => {
      throw new Error('tt notify fail');
    });
    const jlog = makeLogger();
    const job = makeJob({
      source: 'triggered-task',
      triggeredTaskRunId: 'tt-run-1',
      triggeredTaskId: 'tt-1',
    });
    await completeTriggeredTaskRun(
      ctx as never,
      job,
      makeOutcome(),
      jlog as never,
      vi.fn(),
    );
    expect(jlog.error).toHaveBeenCalledWith(
      'triggered_task_slack_notify_failed',
      expect.objectContaining({ error: 'tt notify fail' }),
    );
  });

  it('handles failed outcome with notification', async () => {
    const ctx = makeCtx();
    ctx.triggeredTaskStore.getById.mockReturnValue({
      id: 'tt-1',
      name: 'Triggered Task',
      tool: 'gemini',
      notifyChannel: 'C_TT',
      notifyThread: 'T_TT',
      maxRetries: 0,
      concurrencyPolicy: 'skip_if_running',
      workdir: '/tmp/tt',
      instructionFile: null,
      enabledSkills: null,
      allowMcp: false,
    });
    ctx.triggeredTaskStore.getRunById.mockReturnValue({
      retryCount: 0,
    });
    const jlog = makeLogger();
    const job = makeJob({
      source: 'triggered-task',
      triggeredTaskRunId: 'tt-run-1',
      triggeredTaskId: 'tt-1',
    });
    await completeTriggeredTaskRun(
      ctx as never,
      job,
      makeOutcome({ jobFailed: true }),
      jlog as never,
      vi.fn(),
    );
    // Should release claim for skip_if_running policy
    expect(ctx.triggeredTaskStore.releaseClaim).toHaveBeenCalledWith('tt-1');
    expect(ctx.webClient.chat.postMessage).toHaveBeenCalled();
  });
});
