/** @module task-run-completion — Completes scheduled, on-demand, and triggered task runs with result posting and file uploads */
import crypto from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { AppContext } from '../context/app-context.js';
import { appendTriggerContext, parseTriggerContext } from '../event/trigger-context.js';
import { type InstructionSource, resolveInstruction } from '../instructions/builder.js';
import { getInstructionFilePath } from '../orchestrator/engine-utils.js';
import type { Job } from '../queue/types.js';
import type { ArchivedFile } from '../shared/file-attachment.js';
import { MAX_FILE_UPLOADS } from '../shared/file-attachment.js';
export { cleanupStandaloneSessionResources } from '../shared/standalone-session-cleanup.js';
import { formatMention } from '../shared/text-utils.js';
import type { SkillRef } from '../skills/catalog.js';
import { errorMessage } from '../utils/error.js';
import type { Logger } from '../utils/logger.js';
import type { JobRunOutcome } from './job-runtime-types.js';
import { buildTaskCompletionBlocks, exceedsFileUploadThreshold } from './markdown-blocks.js';

interface FilesUploadV2Args {
  channel_id: string;
  thread_ts: string;
  file: Buffer;
  filename: string;
  title: string;
}

type FilesUploadV2 = (args: FilesUploadV2Args) => Promise<unknown>;

export function requiresStandaloneSessionCleanup(source: Job['source'] | undefined): boolean {
  return (
    source === 'schedule' ||
    source === 'ondemand-task' ||
    source === 'triggered-task' ||
    source === 'orchestrator-summary'
  );
}

export async function uploadArchivedFilesToThread(
  filesUploadV2: FilesUploadV2,
  channel: string,
  threadTs: string,
  files: ArchivedFile[],
  logPrefix: string,
  jlog: Logger,
): Promise<void> {
  let uploaded = 0;
  let attempted = 0;
  const failed: string[] = [];
  for (const file of files) {
    if (attempted >= MAX_FILE_UPLOADS) {
      jlog.warn(`${logPrefix}_file_upload_limit_reached`, {
        limit: MAX_FILE_UPLOADS,
        total: files.length,
      });
      break;
    }
    attempted++;
    try {
      const data = readFileSync(file.localPath);
      await filesUploadV2({
        channel_id: channel,
        thread_ts: threadTs,
        file: data,
        filename: file.filename,
        title: file.filename,
      });
      uploaded++;
    } catch (uploadErr) {
      failed.push(file.filename);
      jlog.warn(`${logPrefix}_file_upload_failed`, {
        file: file.filename,
        error: errorMessage(uploadErr),
      });
    }
  }
  if (uploaded > 0) {
    jlog.info(`${logPrefix}_files_uploaded`, { count: uploaded });
  }
  if (failed.length > 0) {
    jlog.warn(`${logPrefix}_files_upload_partial_failure`, { uploaded, failed });
  }
}

interface RetryPreparationInput {
  tool: Job['tool'];
  userId: string;
  workdir: string | null | undefined;
  instructionFile: string | null | undefined;
  enabledSkills: SkillRef[] | null | undefined;
  allowMcp: boolean;
  instructionSource: InstructionSource;
}

interface RetryPreparationResult {
  retrySession: ReturnType<AppContext['sessionManager']['createStandaloneSession']>;
  retryEffectiveWorkdir: string;
}

function prepareRetryExecution(
  ctx: AppContext,
  input: RetryPreparationInput,
): RetryPreparationResult {
  const retrySession = ctx.sessionManager.createStandaloneSession(input.tool, input.userId);
  const retryEffectiveWorkdir = input.workdir || retrySession.workdir;
  mkdirSync(retryEffectiveWorkdir, { recursive: true });
  const retryInstruction = resolveInstruction(
    {
      tool: input.tool,
      source: input.instructionSource,
      autoApprove: true,
      allowMcp: input.allowMcp,
    },
    input.instructionFile,
    ctx.defaultInstructionStore.getWithEnabled(input.tool),
  );
  writeFileSync(
    getInstructionFilePath(retryEffectiveWorkdir, input.tool),
    retryInstruction,
    'utf-8',
  );
  ctx.workdirManager.prepareWorkdirSkillsOnly(
    retryEffectiveWorkdir,
    input.tool,
    input.enabledSkills,
  );
  ctx.sessionManager.updateMode(retrySession.sessionKey, 'write', null);
  return { retrySession, retryEffectiveWorkdir };
}

interface TaskNotificationInput {
  notifyChannel: string;
  notifyThread?: string;
  emoji: string;
  taskType: string;
  taskName: string;
  tool: string;
  status: string;
  exitCode: number | string | null;
  mention?: string;
  taskOutputRaw: string;
  archivedFiles: ArchivedFile[];
  logPrefix: string;
  jlog: Logger;
}

async function postTaskRunNotification(
  ctx: AppContext,
  input: TaskNotificationInput,
): Promise<void> {
  const messages = buildTaskCompletionBlocks({
    emoji: input.emoji,
    taskType: input.taskType,
    taskName: input.taskName,
    tool: input.tool,
    status: input.status,
    exitCode: input.exitCode,
    mention: input.mention,
    body: input.taskOutputRaw,
  });

  let firstTs: string | undefined;
  for (const [index, msg] of messages.entries()) {
    try {
      const result = await ctx.webClient.chat.postMessage({
        channel: input.notifyChannel,
        thread_ts: index === 0 ? input.notifyThread : (firstTs ?? input.notifyThread),
        blocks: msg.blocks,
        text: msg.text,
      });
      if (index === 0) {
        firstTs = (result?.ts as string | undefined) ?? input.notifyThread;
      }
    } catch (postErr) {
      input.jlog.warn(`${input.logPrefix}_block_post_failed`, {
        index,
        error: errorMessage(postErr),
      });
    }
  }

  const replyTs = firstTs ?? input.notifyThread;

  // Upload full output as .md file when exceeding 40K threshold
  if (exceedsFileUploadThreshold(input.taskOutputRaw) && replyTs) {
    try {
      await ctx.webClient.filesUploadV2({
        channel_id: input.notifyChannel,
        thread_ts: replyTs,
        file: Buffer.from(input.taskOutputRaw, 'utf-8'),
        filename: 'output.md',
        title: 'Full Output',
      });
    } catch (uploadErr) {
      input.jlog.warn(`${input.logPrefix}_output_file_upload_failed`, {
        error: errorMessage(uploadErr),
      });
    }
  }

  if (input.archivedFiles.length > 0 && replyTs) {
    await uploadArchivedFilesToThread(
      ctx.webClient.filesUploadV2.bind(ctx.webClient),
      input.notifyChannel,
      replyTs,
      input.archivedFiles,
      input.logPrefix,
      input.jlog,
    );
  }
}

export async function completeScheduleRun(
  ctx: AppContext,
  job: Job,
  outcome: JobRunOutcome,
  jlog: Logger,
  cleanupStandaloneSessionResourcesOnce: () => void,
): Promise<void> {
  const scheduleStore = ctx.scheduleStore;
  if (!job.scheduleRunId || !scheduleStore) return;

  try {
    scheduleStore.updateRun(job.scheduleRunId, {
      status: outcome.jobFailed ? 'failed' : 'completed',
      exitCode: outcome.taskExitCode,
      outputSummary: outcome.taskOutputSummary || null,
      endedAt: new Date().toISOString(),
    });

    const schedTask = job.scheduleTaskId ? scheduleStore.getById(job.scheduleTaskId) : null;

    let retried = false;
    let failedRunRetryCount = 0;
    if (outcome.jobFailed && schedTask && schedTask.maxRetries > 0) {
      const currentRun = scheduleStore.getRunById(job.scheduleRunId);
      failedRunRetryCount = currentRun?.retryCount ?? 0;
      if (currentRun && currentRun.retryCount < schedTask.maxRetries) {
        try {
          const { retrySession, retryEffectiveWorkdir } = prepareRetryExecution(ctx, {
            tool: schedTask.tool,
            userId: schedTask.userId,
            workdir: schedTask.workdir,
            instructionFile: schedTask.instructionFile,
            enabledSkills: schedTask.enabledSkills,
            allowMcp: schedTask.allowMcp,
            instructionSource: 'schedule',
          });

          const retryRunId = crypto.randomUUID();
          const retryStartedAt = new Date().toISOString();
          scheduleStore.recordRun({
            id: retryRunId,
            taskId: schedTask.id,
            sessionKey: retrySession.sessionKey,
            status: 'running',
            startedAt: retryStartedAt,
            retryCount: currentRun.retryCount + 1,
            source: currentRun.source,
          });

          const retryJob: Job = {
            id: retryRunId,
            sessionKey: retrySession.sessionKey,
            channelId: '',
            threadTs: '',
            userId: schedTask.userId,
            tool: schedTask.tool,
            mode: 'write',
            prompt: schedTask.prompt,
            workdir: retryEffectiveWorkdir,
            toolState: {},
            createdAt: Date.now(),
            source: 'schedule',
            scheduleTaskId: schedTask.id,
            scheduleRunId: retryRunId,
            autoApprove: true,
            executionPolicy: {
              allowMcp: schedTask.allowMcp,
              enabledSkills: schedTask.enabledSkills,
            },
          };

          const enqResult = ctx.jobQueue.enqueue(retryJob);
          if (!('error' in enqResult)) {
            retried = true;
            jlog.info('schedule_retry_enqueued', {
              taskId: schedTask.id,
              retryRunId,
              attempt: currentRun.retryCount + 1,
              maxRetries: schedTask.maxRetries,
            });
          } else {
            scheduleStore.updateRun(retryRunId, {
              status: 'failed',
              errorMessage: `Retry enqueue failed: ${enqResult.error}`,
              endedAt: new Date().toISOString(),
            });
          }
        } catch (retryErr) {
          jlog.error('schedule_retry_failed', { error: errorMessage(retryErr) });
        }
      }
    }

    if (!retried && schedTask && schedTask.nextRunAt === null) {
      try {
        scheduleStore.update(schedTask.id, { status: 'completed' });
      } catch (finalizeErr) {
        jlog.error('schedule_task_finalize_failed', {
          taskId: schedTask.id,
          error: errorMessage(finalizeErr),
        });
      }
    }

    const notifyChannel = schedTask?.notifyChannel || ctx.config.scheduleDefaultNotifyChannel;
    if (notifyChannel && schedTask) {
      const toolName = schedTask.tool ?? job.tool;
      const statusEmoji = retried ? ':repeat:' : outcome.jobFailed ? ':x:' : ':white_check_mark:';
      const statusLabel = retried
        ? `retrying (${failedRunRetryCount + 1}/${schedTask.maxRetries})`
        : outcome.jobFailed
          ? 'failed'
          : 'completed';
      const scheduleMention = formatMention(job.userId) || formatMention(schedTask.notifyChannel);

      try {
        await postTaskRunNotification(ctx, {
          notifyChannel,
          notifyThread: schedTask.notifyThread ?? undefined,
          emoji: statusEmoji,
          taskType: 'Schedule Task',
          taskName: schedTask.name,
          tool: toolName,
          status: statusLabel,
          exitCode: outcome.taskExitCode,
          mention: scheduleMention || undefined,
          taskOutputRaw: outcome.taskOutputRaw,
          archivedFiles: outcome.archivedFiles,
          logPrefix: 'schedule',
          jlog,
        });
      } catch (notifyErr) {
        jlog.error('schedule_slack_notify_failed', { error: errorMessage(notifyErr) });
      }
    }
  } catch (err) {
    jlog.error('schedule_run_update_failed', { error: errorMessage(err) });
  }

  try {
    cleanupStandaloneSessionResourcesOnce();
    jlog.info('schedule_session_cleaned', { sessionKey: job.sessionKey });
  } catch (cleanupErr) {
    jlog.warn('schedule_session_cleanup_failed', { error: errorMessage(cleanupErr) });
  }
}

export async function completeOndemandTaskRun(
  ctx: AppContext,
  job: Job,
  outcome: JobRunOutcome,
  jlog: Logger,
  cleanupStandaloneSessionResourcesOnce: () => void,
): Promise<void> {
  const ondemandTaskStore = ctx.ondemandTaskStore;
  if (!job.ondemandTaskRunId || !ondemandTaskStore) return;

  try {
    ondemandTaskStore.updateRun(job.ondemandTaskRunId, {
      status: outcome.jobFailed ? 'failed' : 'completed',
      exitCode: outcome.taskExitCode,
      outputSummary: outcome.taskOutputSummary || null,
      endedAt: new Date().toISOString(),
    });

    const odTask = job.ondemandTaskId ? ondemandTaskStore.getById(job.ondemandTaskId) : null;
    if (odTask) {
      ondemandTaskStore.incrementRunCount(odTask.id, new Date().toISOString());
    }

    let retried = false;
    let failedRunRetryCount = 0;
    if (outcome.jobFailed && odTask && odTask.maxRetries > 0) {
      const currentRun = ondemandTaskStore.getRunById(job.ondemandTaskRunId);
      failedRunRetryCount = currentRun?.retryCount ?? 0;
      if (currentRun && currentRun.retryCount < odTask.maxRetries) {
        try {
          const { retrySession, retryEffectiveWorkdir } = prepareRetryExecution(ctx, {
            tool: odTask.tool,
            userId: odTask.userId,
            workdir: odTask.workdir,
            instructionFile: odTask.instructionFile,
            enabledSkills: odTask.enabledSkills,
            allowMcp: odTask.allowMcp,
            instructionSource: 'standalone-task',
          });

          const retryRunId = crypto.randomUUID();
          const retryStartedAt = new Date().toISOString();
          ondemandTaskStore.recordRun({
            id: retryRunId,
            taskId: odTask.id,
            sessionKey: retrySession.sessionKey,
            status: 'running',
            startedAt: retryStartedAt,
            retryCount: currentRun.retryCount + 1,
            source: currentRun.source,
          });

          const retryJob: Job = {
            id: retryRunId,
            sessionKey: retrySession.sessionKey,
            channelId: '',
            threadTs: '',
            userId: odTask.userId,
            tool: odTask.tool,
            mode: 'write',
            prompt: odTask.prompt,
            workdir: retryEffectiveWorkdir,
            toolState: {},
            createdAt: Date.now(),
            source: 'ondemand-task',
            ondemandTaskId: odTask.id,
            ondemandTaskRunId: retryRunId,
            autoApprove: true,
            executionPolicy: {
              allowMcp: odTask.allowMcp,
              enabledSkills: odTask.enabledSkills,
            },
          };

          const enqResult = ctx.jobQueue.enqueue(retryJob);
          if (!('error' in enqResult)) {
            retried = true;
            jlog.info('ondemand_retry_enqueued', {
              taskId: odTask.id,
              retryRunId,
              attempt: currentRun.retryCount + 1,
              maxRetries: odTask.maxRetries,
            });
          } else {
            ondemandTaskStore.updateRun(retryRunId, {
              status: 'failed',
              errorMessage: `Retry enqueue failed: ${enqResult.error}`,
              endedAt: new Date().toISOString(),
            });
          }
        } catch (retryErr) {
          jlog.error('ondemand_retry_failed', { error: errorMessage(retryErr) });
        }
      }
    }

    const notifyChannel = odTask?.notifyChannel;
    if (notifyChannel && odTask) {
      const toolName = odTask.tool ?? job.tool;
      const statusEmoji = retried ? ':repeat:' : outcome.jobFailed ? ':x:' : ':white_check_mark:';
      const statusLabel = retried
        ? `retrying (${failedRunRetryCount + 1}/${odTask.maxRetries})`
        : outcome.jobFailed
          ? 'failed'
          : 'completed';
      const ondemandMention = formatMention(job.userId) || formatMention(odTask.notifyChannel);

      try {
        await postTaskRunNotification(ctx, {
          notifyChannel,
          notifyThread: odTask.notifyThread ?? undefined,
          emoji: statusEmoji,
          taskType: 'On-Demand Task',
          taskName: odTask.name,
          tool: toolName,
          status: statusLabel,
          exitCode: outcome.taskExitCode,
          mention: ondemandMention || undefined,
          taskOutputRaw: outcome.taskOutputRaw,
          archivedFiles: outcome.archivedFiles,
          logPrefix: 'ondemand',
          jlog,
        });
      } catch (notifyErr) {
        jlog.error('ondemand_slack_notify_failed', { error: errorMessage(notifyErr) });
      }
    }
  } catch (err) {
    jlog.error('ondemand_run_update_failed', { error: errorMessage(err) });
  }

  try {
    cleanupStandaloneSessionResourcesOnce();
    jlog.info('ondemand_session_cleaned', { sessionKey: job.sessionKey });
  } catch (cleanupErr) {
    jlog.warn('ondemand_session_cleanup_failed', { error: errorMessage(cleanupErr) });
  }
}

export async function completeTriggeredTaskRun(
  ctx: AppContext,
  job: Job,
  outcome: JobRunOutcome,
  jlog: Logger,
  cleanupStandaloneSessionResourcesOnce: () => void,
): Promise<void> {
  const triggeredTaskStore = ctx.triggeredTaskStore;
  if (!job.triggeredTaskRunId || !triggeredTaskStore) return;

  try {
    triggeredTaskStore.updateRun(job.triggeredTaskRunId, {
      status: outcome.jobFailed ? 'failed' : 'completed',
      exitCode: outcome.taskExitCode,
      outputSummary: outcome.taskOutputSummary || null,
      endedAt: new Date().toISOString(),
    });

    const triggeredTask = job.triggeredTaskId
      ? triggeredTaskStore.getById(job.triggeredTaskId)
      : null;

    if (triggeredTask) {
      triggeredTaskStore.incrementRunCount(triggeredTask.id, new Date().toISOString());
    }

    let retried = false;
    let failedRunRetryCount = 0;
    if (outcome.jobFailed && triggeredTask && triggeredTask.maxRetries > 0) {
      const currentRun = triggeredTaskStore.getRunById(job.triggeredTaskRunId);
      failedRunRetryCount = currentRun?.retryCount ?? 0;
      if (currentRun && currentRun.retryCount < triggeredTask.maxRetries) {
        try {
          const { retrySession, retryEffectiveWorkdir } = prepareRetryExecution(ctx, {
            tool: triggeredTask.tool,
            userId: triggeredTask.userId,
            workdir: triggeredTask.workdir,
            instructionFile: triggeredTask.instructionFile,
            enabledSkills: triggeredTask.enabledSkills,
            allowMcp: triggeredTask.allowMcp,
            instructionSource: 'standalone-task',
          });

          const retryRunId = crypto.randomUUID();
          const retryStartedAt = new Date().toISOString();
          triggeredTaskStore.recordRun({
            id: retryRunId,
            triggeredTaskId: triggeredTask.id,
            status: 'running',
            triggeredBy: currentRun.triggeredBy,
            triggerContextJson: currentRun.triggerContextJson,
            sessionKey: retrySession.sessionKey,
            jobId: retryRunId,
            startedAt: retryStartedAt,
            retryCount: currentRun.retryCount + 1,
          });

          const retryTriggerContext = parseTriggerContext(currentRun.triggerContextJson);
          const retryJob: Job = {
            id: retryRunId,
            sessionKey: retrySession.sessionKey,
            channelId: '',
            threadTs: '',
            userId: triggeredTask.userId,
            tool: triggeredTask.tool,
            mode: 'write',
            prompt: appendTriggerContext(
              triggeredTask.prompt,
              'Trigger Event Context',
              retryTriggerContext,
            ),
            workdir: retryEffectiveWorkdir,
            toolState: {},
            createdAt: Date.now(),
            source: 'triggered-task',
            triggeredTaskId: triggeredTask.id,
            triggeredTaskRunId: retryRunId,
            autoApprove: true,
            executionPolicy: {
              allowMcp: triggeredTask.allowMcp,
              enabledSkills: triggeredTask.enabledSkills,
            },
            instructionFile: triggeredTask.instructionFile,
          };

          const enqResult = ctx.jobQueue.enqueue(retryJob);
          if (!('error' in enqResult)) {
            retried = true;
            jlog.info('triggered_task_retry_enqueued', {
              taskId: triggeredTask.id,
              retryRunId,
              attempt: currentRun.retryCount + 1,
              maxRetries: triggeredTask.maxRetries,
            });
          } else {
            triggeredTaskStore.updateRun(retryRunId, {
              status: 'failed',
              errorMessage: `Retry enqueue failed: ${enqResult.error}`,
              endedAt: new Date().toISOString(),
            });
          }
        } catch (retryErr) {
          jlog.error('triggered_task_retry_failed', { error: errorMessage(retryErr) });
        }
      }
    }

    const notifyChannel = triggeredTask?.notifyChannel;
    if (notifyChannel && triggeredTask) {
      const toolName = triggeredTask.tool ?? job.tool;
      const statusEmoji = retried ? ':repeat:' : outcome.jobFailed ? ':x:' : ':white_check_mark:';
      const statusLabel = retried
        ? `retrying (${failedRunRetryCount + 1}/${triggeredTask.maxRetries})`
        : outcome.jobFailed
          ? 'failed'
          : 'completed';
      const mention = formatMention(job.userId) || formatMention(triggeredTask.notifyChannel);

      try {
        await postTaskRunNotification(ctx, {
          notifyChannel,
          notifyThread: triggeredTask.notifyThread ?? undefined,
          emoji: statusEmoji,
          taskType: 'Triggered Task',
          taskName: triggeredTask.name,
          tool: toolName,
          status: statusLabel,
          exitCode: outcome.taskExitCode,
          mention: mention || undefined,
          taskOutputRaw: outcome.taskOutputRaw,
          archivedFiles: outcome.archivedFiles,
          logPrefix: 'triggered_task',
          jlog,
        });
      } catch (notifyErr) {
        jlog.error('triggered_task_slack_notify_failed', { error: errorMessage(notifyErr) });
      }
    }

    if (triggeredTask && triggeredTask.concurrencyPolicy === 'skip_if_running' && !retried) {
      triggeredTaskStore.releaseClaim(triggeredTask.id);
    }
  } catch (err) {
    jlog.error('triggered_task_run_update_failed', { error: errorMessage(err) });
    if (job.triggeredTaskId) {
      const task = triggeredTaskStore.getById(job.triggeredTaskId);
      if (task?.concurrencyPolicy === 'skip_if_running') {
        triggeredTaskStore.releaseClaim(task.id);
      }
    }
  }

  try {
    cleanupStandaloneSessionResourcesOnce();
    jlog.info('triggered_task_session_cleaned', { sessionKey: job.sessionKey });
  } catch (cleanupErr) {
    jlog.warn('triggered_task_session_cleanup_failed', { error: errorMessage(cleanupErr) });
  }
}
