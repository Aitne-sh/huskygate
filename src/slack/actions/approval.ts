/** @module slack/actions/approval — Tool approval and MCP auth approval/rejection actions. */
import type { App } from '@slack/bolt';
import type { AppContext } from '../../context/app-context.js';
import { errorMessage } from '../../utils/error.js';
import { logger } from '../../utils/logger.js';
import { postMessageWithContext, updateMessageBlocks } from '../app-helpers.js';
import {
  processMcpAuthApprove,
  processMcpAuthReject,
  processToolApprove,
  processToolReject,
} from '../approval-handler.js';
import {
  ACTION_MCP_AUTH_APPROVE,
  ACTION_MCP_AUTH_REJECT,
  ACTION_TOOL_APPROVE,
  ACTION_TOOL_REJECT,
  buildApprovalResolvedBlocks,
  decodeActionValue,
} from '../block-kit.js';
import { extractOriginalMessage, parseThreadKey } from './helpers.js';

export function registerApprovalActions(ctx: AppContext, app: App): void {
  // ── Tool Approval Buttons ──

  app.action(ACTION_TOOL_APPROVE, async ({ action, body, ack }) => {
    await ack();
    try {
      if (action.type !== 'button') return;
      const { tk: threadKey, rid: requestId } = decodeActionValue(action.value ?? '');
      const userId = body.user.id;
      const pending = ctx.pendingToolApprovals.get(threadKey);

      if (!pending || pending.requestId !== requestId) {
        logger.info('action_tool_approve_no_pending', { threadKey, requestId });
        return;
      }

      if (Date.now() > pending.expiresAt) {
        ctx.pendingToolApprovals.delete(threadKey);
        return;
      }

      if (userId !== pending.userId) {
        const parsed = parseThreadKey(threadKey);
        if (parsed) {
          await postMessageWithContext(
            ctx,
            ctx.webClient,
            parsed.channelId,
            parsed.threadTs,
            'Only the user who requested the previous run can approve this tool execution.',
            { sessionKey: pending.sessionKey, tool: pending.tool },
          );
        }
        return;
      }

      const parsed = parseThreadKey(threadKey);
      if (!parsed) return;

      const outcome = await processToolApprove(
        ctx,
        pending,
        threadKey,
        parsed.channelId,
        parsed.threadTs,
        userId,
      );

      const resolvedBlocks = buildApprovalResolvedBlocks('approved', outcome.target, userId);
      const original = extractOriginalMessage(body);
      if (original) {
        await updateMessageBlocks(
          ctx.webClient,
          original.channelId,
          original.messageTs,
          resolvedBlocks,
          outcome.message,
        );
      }

      await postMessageWithContext(
        ctx,
        ctx.webClient,
        parsed.channelId,
        parsed.threadTs,
        outcome.message,
        { sessionKey: pending.sessionKey, tool: pending.tool },
      );
    } catch (err) {
      logger.error('action_tool_approve_error', { error: errorMessage(err) });
    }
  });

  app.action(ACTION_TOOL_REJECT, async ({ action, body, ack }) => {
    await ack();
    try {
      if (action.type !== 'button') return;
      const { tk: threadKey, rid: requestId } = decodeActionValue(action.value ?? '');
      const userId = body.user.id;
      const pending = ctx.pendingToolApprovals.get(threadKey);

      if (!pending || pending.requestId !== requestId) return;
      if (Date.now() > pending.expiresAt) {
        ctx.pendingToolApprovals.delete(threadKey);
        return;
      }
      if (userId !== pending.userId) {
        const parsed = parseThreadKey(threadKey);
        if (parsed) {
          await postMessageWithContext(
            ctx,
            ctx.webClient,
            parsed.channelId,
            parsed.threadTs,
            'Only the user who requested the previous run can approve this tool execution.',
            { sessionKey: pending.sessionKey, tool: pending.tool },
          );
        }
        return;
      }

      const outcome = processToolReject(ctx, pending, threadKey);

      const resolvedBlocks = buildApprovalResolvedBlocks('rejected', outcome.target, userId);
      const original = extractOriginalMessage(body);
      if (original) {
        await updateMessageBlocks(
          ctx.webClient,
          original.channelId,
          original.messageTs,
          resolvedBlocks,
          outcome.message,
        );
      }

      const parsed = parseThreadKey(threadKey);
      if (parsed) {
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          parsed.channelId,
          parsed.threadTs,
          outcome.message,
          { sessionKey: pending.sessionKey, tool: pending.tool },
        );
      }
    } catch (err) {
      logger.error('action_tool_reject_error', { error: errorMessage(err) });
    }
  });

  // ── MCP Auth Approval Buttons ──

  app.action(ACTION_MCP_AUTH_APPROVE, async ({ action, body, ack }) => {
    await ack();
    try {
      if (action.type !== 'button') return;
      const { tk: threadKey, rid: requestId } = decodeActionValue(action.value ?? '');
      const userId = body.user.id;
      const pending = ctx.pendingMcpAuthBypassApprovals.get(threadKey);

      if (!pending || pending.requestId !== requestId) return;
      if (Date.now() > pending.expiresAt) {
        ctx.pendingMcpAuthBypassApprovals.delete(threadKey);
        return;
      }
      if (userId !== pending.userId) {
        const parsed = parseThreadKey(threadKey);
        if (parsed) {
          await postMessageWithContext(
            ctx,
            ctx.webClient,
            parsed.channelId,
            parsed.threadTs,
            'Only the user who requested the previous run can approve this MCP auth action.',
            { sessionKey: pending.sessionKey, tool: pending.tool },
          );
        }
        return;
      }

      const parsed = parseThreadKey(threadKey);
      if (!parsed) return;

      const outcome = await processMcpAuthApprove(
        ctx,
        pending,
        threadKey,
        parsed.channelId,
        parsed.threadTs,
        userId,
      );

      const resolvedBlocks = buildApprovalResolvedBlocks('approved', outcome.target, userId);
      const original = extractOriginalMessage(body);
      if (original) {
        await updateMessageBlocks(
          ctx.webClient,
          original.channelId,
          original.messageTs,
          resolvedBlocks,
          outcome.message,
        );
      }

      await postMessageWithContext(
        ctx,
        ctx.webClient,
        parsed.channelId,
        parsed.threadTs,
        outcome.message,
        { sessionKey: pending.sessionKey, tool: pending.tool },
      );
    } catch (err) {
      logger.error('action_mcp_auth_approve_error', { error: errorMessage(err) });
    }
  });

  app.action(ACTION_MCP_AUTH_REJECT, async ({ action, body, ack }) => {
    await ack();
    try {
      if (action.type !== 'button') return;
      const { tk: threadKey, rid: requestId } = decodeActionValue(action.value ?? '');
      const userId = body.user.id;
      const pending = ctx.pendingMcpAuthBypassApprovals.get(threadKey);

      if (!pending || pending.requestId !== requestId) return;
      if (Date.now() > pending.expiresAt) {
        ctx.pendingMcpAuthBypassApprovals.delete(threadKey);
        return;
      }
      if (userId !== pending.userId) {
        const parsed = parseThreadKey(threadKey);
        if (parsed) {
          await postMessageWithContext(
            ctx,
            ctx.webClient,
            parsed.channelId,
            parsed.threadTs,
            'Only the user who requested the previous run can approve this MCP auth action.',
            { sessionKey: pending.sessionKey, tool: pending.tool },
          );
        }
        return;
      }

      const outcome = processMcpAuthReject(ctx, pending, threadKey);

      const resolvedBlocks = buildApprovalResolvedBlocks('rejected', outcome.target, userId);
      const original = extractOriginalMessage(body);
      if (original) {
        await updateMessageBlocks(
          ctx.webClient,
          original.channelId,
          original.messageTs,
          resolvedBlocks,
          outcome.message,
        );
      }

      const parsed = parseThreadKey(threadKey);
      if (parsed) {
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          parsed.channelId,
          parsed.threadTs,
          outcome.message,
          { sessionKey: pending.sessionKey, tool: pending.tool },
        );
      }
    } catch (err) {
      logger.error('action_mcp_auth_reject_error', { error: errorMessage(err) });
    }
  });
}
