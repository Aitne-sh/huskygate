/** @module slack/message-handler — Routes incoming Slack messages to commands, approvals, or the assistant. */
import type { App } from '@slack/bolt';
import type { AppContext } from '../context/app-context.js';
import { extractSlackFiles } from '../shared/file-attachment.js';
import { logger } from '../utils/logger.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import {
  logSlackCommandError,
  postMessageWithContext,
  scheduleInactivityAutoExit,
  toThreadKey,
} from './app-helpers.js';
import { handleMcpAuthBypassApproval, handleToolApproval } from './approval-handler.js';
import { parseApprovalDecision } from './approval.js';
import { handleAssistantMessage, isAssistantThread } from './assistant.js';
import { isAuthorized } from './auth.js';
import { dispatchCommand } from './commands/dispatch.js';
import type { HandlerContext } from './handler-context.js';
import { parseCommand } from './parser.js';

const userRateLimiter = new RateLimiter(5, 10_000); // 5 messages per 10s

export function evictUserRateLimiter(): void {
  userRateLimiter.evict();
}

/** Listen for Slack message events and dispatch to the appropriate handler pipeline. */
export function registerMessageHandler(ctx: AppContext, app: App): void {
  app.event('message', async ({ event, body, client }) => {
    // Ignore bot messages and message edits (allow file_share for file attachments)
    if ('bot_id' in event) return;
    if ('subtype' in event && event.subtype !== undefined && event.subtype !== 'file_share') return;

    const eventId = body.event_id;
    if (ctx.dedupeStore.isDuplicateAndRegister(eventId)) return;

    const userId = 'user' in event ? (event.user as string) : '';
    const channelId = event.channel;
    const channelType = event.channel_type;
    const threadTs = ('thread_ts' in event ? event.thread_ts : event.ts) as string;
    const text = 'text' in event ? (event.text as string) : '';

    if (!isAuthorized({ userId, channelId, channelType, teamId: body.team_id }, ctx.config)) {
      return;
    }

    if (!userRateLimiter.allow(userId)) {
      logger.warn('user_rate_limited', { user_id: userId });
      return;
    }

    // Route assistant thread messages separately to avoid interference with DM commands.
    if (isAssistantThread(ctx, channelId, threadTs)) {
      await handleAssistantMessage(ctx, client, {
        channel: channelId,
        threadTs,
        ts: event.ts,
        userId,
        text,
        teamId: body.team_id,
      });
      return;
    }

    const rawFiles = 'files' in event ? (event.files as unknown) : undefined;
    const slackFiles = Array.isArray(rawFiles) ? extractSlackFiles(rawFiles) : [];

    const threadKey = toThreadKey(channelId, threadTs);
    try {
      ctx.sessionManager.touchThreadActivity(threadKey);
      scheduleInactivityAutoExit(ctx, threadKey, channelId, threadTs);
      const hctx: HandlerContext = {
        ctx,
        client,
        channelId,
        threadTs,
        userId,
        threadKey,
        ...(slackFiles.length > 0 ? { slackFiles } : {}),
      };

      if (await handleMcpAuthBypassApproval(hctx, text)) return;
      if (await handleToolApproval(hctx, text)) return;

      // !yes / !no without pending approval
      if (parseApprovalDecision(text) !== null) {
        await postMessageWithContext(
          ctx,
          client,
          channelId,
          threadTs,
          'No pending approval request.',
        );
        return;
      }

      let command = parseCommand(text);
      // File-only messages (no text): treat as a prompt so file attachment logic runs
      if (!command && slackFiles.length > 0) {
        command = { kind: 'prompt', prompt: 'See attached files.' };
      }
      if (!command) return;

      try {
        await dispatchCommand(hctx, command);
      } catch (err) {
        logSlackCommandError(err, { command: command.kind, sessionKey: threadKey });
      }
    } catch (err) {
      logSlackCommandError(err, { command: 'message_handler', sessionKey: threadKey });
    }
  });
}
