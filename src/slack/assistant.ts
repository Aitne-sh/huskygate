/** @module slack/assistant — Slack Agents API integration for the assistant side-panel. */
import crypto from 'node:crypto';
import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import type { AppContext } from '../context/app-context.js';
import type { SlackClientSurface } from '../context/slack-client-surface.js';
import type { Job } from '../queue/types.js';
import { RETRY_LIMITS, TTLS } from '../shared/constants.js';
import { errorMessage } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import { toThreadKey } from './app-helpers.js';
import { isUserAllowed } from './auth.js';
import { buildMarkdownMessage, exceedsFileUploadThreshold } from './markdown-blocks.js';

// ── Assistant (Slack Agents API) ──
//
// Uses `app.event()` to listen for assistant lifecycle events instead of
// Bolt's `app.assistant()`, which registers global middleware that consumes
// all threaded DM messages and prevents `app.message()` from receiving them.
//
// By registering as standard event listeners, assistant threads and normal
// DM threads can coexist -- routing is based on a tracked set of assistant
// thread IDs populated by `assistant_thread_started` events.
//
// Lifecycle:
//   1. thread_started  -- user opens the assistant side-panel
//   2. context_changed -- user navigates to a different channel/resource
//   3. user message    -- routed from message handler via `handleAssistantMessage()`
//
// Jobs are routed through the existing JobQueue pipeline with
// `source: 'assistant'` and streamed back via `client.chat.postMessage()`.

const SUGGESTED_PROMPTS = [
  { title: 'Run a task', message: 'Run a Claude task: summarize the current project status' },
  { title: 'Code review', message: 'Review the latest changes in the repository' },
  { title: 'Status check', message: 'Show the current session status' },
  { title: 'Help', message: 'What commands are available?' },
];

/** 24-hour TTL for tracked assistant threads (Slack has no thread closure event). */
const ASSISTANT_THREAD_TTL_MS = TTLS.assistantThread;

/** Build a unique session key for an assistant thread (namespaced to avoid DM collisions). */
function assistantThreadKey(channelId: string, threadTs: string): string {
  return `assistant:${channelId}:${threadTs}`;
}

/** Check if a message belongs to a tracked assistant thread. */
export function isAssistantThread(ctx: AppContext, channelId: string, threadTs: string): boolean {
  return ctx.assistantThreads.has(toThreadKey(channelId, threadTs));
}

/**
 * Register event handlers for Slack Agents API lifecycle events.
 *
 * Uses `app.event()` instead of `app.assistant()` to avoid consuming
 * threaded DM messages in global middleware.
 */
export function registerAssistantHandlers(ctx: AppContext, app: App): void {
  app.event('assistant_thread_started', async ({ event, client }) => {
    const thread = event.assistant_thread;
    const userId = thread.user_id;
    const channelId = thread.channel_id;
    const threadTs = thread.thread_ts;

    logger.info('assistant_thread_started', { userId, channelId, threadTs });

    // TTL-based: auto-evicted after 24h since Slack has no thread closure event.
    ctx.assistantThreads.set(toThreadKey(channelId, threadTs), true, ASSISTANT_THREAD_TTL_MS);

    try {
      await client.assistant.threads.setSuggestedPrompts({
        channel_id: channelId,
        thread_ts: threadTs,
        prompts: SUGGESTED_PROMPTS,
      });
    } catch (err) {
      logger.debug('assistant_set_prompts_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'How can I help? I can run Claude, Codex, or Gemini tasks for you.',
      });
    } catch (err) {
      logger.warn('assistant_greeting_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const asstKey = assistantThreadKey(channelId, threadTs);
    ctx.sessionManager.createSessionForThread(asstKey, userId, ctx.config.defaultTool);
  });

  // No-op: context changes (e.g. user navigates to a different channel) are
  // logged for diagnostics but do not alter session state. The handler must
  // be present to receive the event subscription.
  app.event('assistant_thread_context_changed', async ({ event }) => {
    logger.debug('assistant_context_changed', {
      channelId: event.assistant_thread?.channel_id,
    });
  });
}

// ── Message handling (called from message-handler.ts) ──

interface AssistantMessageEvent {
  channel: string;
  threadTs: string;
  ts: string;
  userId: string;
  text: string;
  teamId?: string;
}

/**
 * Handle a user message in an assistant thread.
 *
 * Called from the message handler when the message is detected
 * in a tracked assistant thread.
 */
export async function handleAssistantMessage(
  ctx: AppContext,
  client: SlackClientSurface,
  event: AssistantMessageEvent,
): Promise<void> {
  const { channel: channelId, threadTs, userId, text, teamId } = event;

  if (!text) return;

  logger.info('assistant_user_message', { userId, channelId, text: text.slice(0, 50) });

  // Authorization check — assistant threads use user/team allowlist only
  // (channel type check is skipped since assistant threads are not standard DMs).
  const authorized = isUserAllowed({ userId, teamId }, ctx.config);
  if (!authorized) {
    await postInThread(
      client,
      channelId,
      threadTs,
      'Sorry, you are not authorized to use this assistant.',
    );
    return;
  }

  try {
    await client.assistant.threads.setStatus({
      channel_id: channelId,
      thread_ts: threadTs,
      status: 'Processing...',
    });
  } catch (err) {
    logger.debug('assistant_set_status_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const asstKey = assistantThreadKey(channelId, threadTs);
  const existingSession = ctx.sessionManager.getActiveSession(asstKey);
  const session =
    existingSession ??
    ctx.sessionManager.createSessionForThread(asstKey, userId, ctx.config.defaultTool);

  const tool = session.tool;
  ctx.workdirManager.prepareWorkdirSkillsOnly(session.workdir, tool);

  const jobId = crypto.randomUUID();
  ctx.conversationStore.saveMessage(session.sessionKey, 'user', text, jobId);
  const job: Job = {
    id: jobId,
    sessionKey: session.sessionKey,
    channelId,
    threadTs,
    userId,
    tool,
    mode: session.mode,
    prompt: text,
    workdir: session.workdir,
    toolState: session.toolState,
    createdAt: Date.now(),
    source: 'assistant',
  };

  // Collect streamed chunks and post the assembled reply when done
  const chunks: string[] = [];

  ctx.jobEventStreams.set(jobId, {
    onEvent: (ev) => {
      if (ev.type === 'text' && ev.content) {
        chunks.push(ev.content);
      }
    },
    onDone: async (result) => {
      const fullResponse = chunks.join('');

      if (fullResponse) {
        ctx.conversationStore.saveMessage(session.sessionKey, 'assistant', fullResponse, jobId);
      }

      try {
        if (!fullResponse) {
          await postInThread(client, channelId, threadTs, 'Task completed with no text output.');
        } else {
          const messages = buildMarkdownMessage({ body: fullResponse });
          const needsFileUpload = exceedsFileUploadThreshold(fullResponse);

          for (const msg of messages) {
            await postInThread(client, channelId, threadTs, msg.text, msg.blocks);
          }

          if (needsFileUpload) {
            try {
              await client.filesUploadV2({
                channel_id: channelId,
                thread_ts: threadTs,
                content: fullResponse,
                filename: 'output.md',
                title: 'Full output',
              });
            } catch (uploadErr) {
              logger.warn('assistant_file_upload_failed', {
                error: errorMessage(uploadErr),
              });
            }
          }
        }
      } catch (err) {
        logger.warn('assistant_reply_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        try {
          await postInThread(
            client,
            channelId,
            threadTs,
            'An error occurred while sending the response.',
          );
        } catch {
          /* give up */
        }
      }

      ctx.jobEventStreams.delete(jobId);

      logger.info('assistant_job_done', {
        jobId,
        sessionKey: session.sessionKey,
        tool,
        exitCode: result.exitCode,
        responseLength: fullResponse.length,
      });
    },
  });

  const enqueueResult = ctx.jobQueue.enqueue(job);
  if ('error' in enqueueResult) {
    ctx.jobEventStreams.delete(jobId);
    await postInThread(client, channelId, threadTs, `Failed to start task: ${enqueueResult.error}`);
    return;
  }
}

// ── Helpers ──

const POST_RETRIES = RETRY_LIMITS.slackMessenger;
const POST_RETRY_BASE_MS = 500;

async function postInThread(
  client: SlackClientSurface,
  channel: string,
  threadTs: string,
  text: string,
  blocks?: KnownBlock[],
): Promise<void> {
  const payload = blocks
    ? { channel, thread_ts: threadTs, blocks, text }
    : { channel, thread_ts: threadTs, text };

  for (let attempt = 0; attempt <= POST_RETRIES; attempt++) {
    try {
      await client.chat.postMessage(payload);
      return;
    } catch (err) {
      if (attempt >= POST_RETRIES) throw err;
      const isRateLimit =
        err != null &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'slack_webapi_rate_limited';
      const delay = isRateLimit
        ? POST_RETRY_BASE_MS * 2 ** (attempt + 1)
        : POST_RETRY_BASE_MS * 2 ** attempt;
      logger.warn('assistant_post_retry', {
        attempt: attempt + 1,
        delay_ms: delay,
        rate_limited: isRateLimit,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
