/** @module job-finishers — Finalizes job execution by recording metrics, posting results, and completing task runs */
import type { AppContext } from '../context/app-context.js';
import { extractSummaryContent } from '../orchestrator/engine-summary.js';
import { cleanupGeminiRuntimeHome } from '../runner/gemini-runtime-home.js';
import { errorMessage } from '../utils/error.js';
import { recordJobComplete } from '../utils/metrics.js';
import type { JobRunOutcome, PreparedJobExecution } from './job-runtime-types.js';
import {
  buildMarkdownMessage,
  buildSummaryBlocks,
  exceedsFileUploadThreshold,
} from './markdown-blocks.js';
import {
  completeOndemandTaskRun,
  completeScheduleRun,
  completeTriggeredTaskRun,
  uploadArchivedFilesToThread,
} from './task-run-completion.js';

export interface FinishJobExecutionInput {
  ctx: AppContext;
  prepared: PreparedJobExecution;
  outcome: JobRunOutcome;
  jobStartedAt: number;
  cleanupStandaloneSessionResourcesOnce: () => void;
}

export interface FinishJobExecutionResult {
  orchestratorCallbackDone: boolean;
}

export async function finishJobExecution(
  input: FinishJobExecutionInput,
): Promise<FinishJobExecutionResult> {
  const { ctx, prepared, outcome, jobStartedAt, cleanupStandaloneSessionResourcesOnce } = input;
  const { job, flags, jobStream, jlog } = prepared;
  let orchestratorCallbackDone = false;

  recordJobComplete(Date.now() - jobStartedAt, outcome.jobFailed);
  ctx.activeRunners.delete(job.sessionKey);
  ctx.sessionManager.setRunningJob(job.sessionKey, null);

  if (job.tool === 'gemini') {
    try {
      await cleanupGeminiRuntimeHome(job.workdir);
    } catch (err) {
      jlog.warn('gemini_runtime_home_cleanup_failed', {
        error: errorMessage(err),
      });
    }
  }

  if (jobStream) {
    try {
      const finalSession = ctx.sessionManager.get(job.sessionKey);
      jobStream.onDone({
        exitCode: outcome.jobFailed ? 1 : 0,
        sessionState: finalSession?.toolState ?? {},
      });
    } catch (err) {
      jlog.warn('job_stream_done_failed', { error: errorMessage(err) });
    }
    ctx.jobEventStreams.delete(job.id);
  }

  if (flags.isSchedule && job.scheduleRunId && ctx.scheduleStore) {
    await completeScheduleRun(ctx, job, outcome, jlog, cleanupStandaloneSessionResourcesOnce);
  }

  if (flags.isOndemandTask && job.ondemandTaskRunId && ctx.ondemandTaskStore) {
    await completeOndemandTaskRun(ctx, job, outcome, jlog, cleanupStandaloneSessionResourcesOnce);
  }

  if (flags.isTriggeredTask && job.triggeredTaskRunId && ctx.triggeredTaskStore) {
    await completeTriggeredTaskRun(ctx, job, outcome, jlog, cleanupStandaloneSessionResourcesOnce);
  }

  if (
    flags.isOrchestrator &&
    job.orchestrationRunId &&
    job.orchestrationNodeId &&
    ctx.orchestratorEngine
  ) {
    orchestratorCallbackDone = true;
    try {
      await ctx.orchestratorEngine.onNodeJobComplete(
        job.id,
        {
          exitCode: outcome.taskExitCode,
          events: [],
          errorKind: outcome.taskErrorKind ?? (outcome.jobFailed ? 'exit_error' : null),
        },
        outcome.taskOutputSummary,
        outcome.taskOutputRaw,
      );
    } catch (orchErr) {
      jlog.error('orchestrator_post_run_failed', { error: errorMessage(orchErr) });
    }
  }

  if (flags.isOrchestratorSummary) {
    await finishOrchestratorSummary(ctx, prepared, outcome, cleanupStandaloneSessionResourcesOnce);
  }

  return { orchestratorCallbackDone };
}

async function finishOrchestratorSummary(
  ctx: AppContext,
  prepared: PreparedJobExecution,
  outcome: JobRunOutcome,
  cleanupStandaloneSessionResourcesOnce: () => void,
): Promise<void> {
  const { job, jlog } = prepared;
  const summaryChannel = job.summaryNotifyChannel;
  const summaryThreadTs = job.summaryNotifyThreadTs;

  try {
    if (summaryChannel && summaryThreadTs) {
      const summaryFailed = outcome.jobFailed || !!outcome.taskErrorKind;

      if (summaryFailed) {
        const failureReason =
          outcome.taskErrorKind ??
          (outcome.taskExitCode != null ? `exit code ${outcome.taskExitCode}` : 'unknown error');
        const warningHeader = `:warning: Execution summary failed (${failureReason}).`;
        if (outcome.taskOutputSummary.trim()) {
          const messages = buildMarkdownMessage({
            header: warningHeader,
            body: outcome.taskOutputSummary,
          });
          for (const [index, msg] of messages.entries()) {
            try {
              await ctx.webClient.chat.postMessage({
                channel: summaryChannel,
                thread_ts: summaryThreadTs,
                blocks: msg.blocks,
                text: msg.text,
              });
            } catch (postErr) {
              jlog.warn('orchestrator_summary_block_post_failed', {
                index,
                error: errorMessage(postErr),
              });
            }
          }
        } else {
          await ctx.webClient.chat.postMessage({
            channel: summaryChannel,
            text: warningHeader,
            thread_ts: summaryThreadTs,
          });
        }
      } else if (outcome.taskOutputRaw.trim()) {
        const summaryBody = extractSummaryContent(outcome.taskOutputRaw);
        if (summaryBody) {
          const messages = buildSummaryBlocks(summaryBody);
          for (const [index, msg] of messages.entries()) {
            try {
              await ctx.webClient.chat.postMessage({
                channel: summaryChannel,
                thread_ts: summaryThreadTs,
                blocks: msg.blocks,
                text: msg.text,
              });
            } catch (postErr) {
              jlog.warn('orchestrator_summary_block_post_failed', {
                index,
                error: errorMessage(postErr),
              });
            }
          }

          if (exceedsFileUploadThreshold(summaryBody)) {
            try {
              await ctx.webClient.filesUploadV2({
                channel_id: summaryChannel,
                thread_ts: summaryThreadTs,
                file: Buffer.from(summaryBody, 'utf-8'),
                filename: 'summary.md',
                title: 'Full Execution Summary',
              });
            } catch (uploadErr) {
              jlog.warn('orchestrator_summary_file_upload_failed', {
                error: errorMessage(uploadErr),
              });
            }
          }
        } else {
          const warningHeader = ':warning: Execution summary did not produce the expected format.';
          const messages = buildMarkdownMessage({
            header: warningHeader,
            body: outcome.taskOutputRaw,
          });
          for (const [index, msg] of messages.entries()) {
            try {
              await ctx.webClient.chat.postMessage({
                channel: summaryChannel,
                thread_ts: summaryThreadTs,
                blocks: msg.blocks,
                text: msg.text,
              });
            } catch (postErr) {
              jlog.warn('orchestrator_summary_block_post_failed', {
                index,
                error: errorMessage(postErr),
              });
            }
          }
        }
      } else {
        await ctx.webClient.chat.postMessage({
          channel: summaryChannel,
          text: ':warning: Execution summary completed but returned no text.',
          thread_ts: summaryThreadTs,
        });
      }

      if (outcome.archivedFiles.length > 0) {
        await uploadArchivedFilesToThread(
          ctx.webClient.filesUploadV2.bind(ctx.webClient),
          summaryChannel,
          summaryThreadTs,
          outcome.archivedFiles,
          'orchestrator_summary',
          jlog,
        );
      }
    }
  } catch (summaryErr) {
    jlog.error('orchestrator_summary_post_failed', {
      error: errorMessage(summaryErr),
    });
  }

  try {
    cleanupStandaloneSessionResourcesOnce();
  } catch (cleanupErr) {
    jlog.warn('orchestrator_summary_session_cleanup_failed', {
      error: errorMessage(cleanupErr),
    });
  }
}
