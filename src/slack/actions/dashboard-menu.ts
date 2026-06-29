/** @module slack/actions/dashboard-menu — Dashboard menu button actions (exit, stop, new, reset, session list/clear/delete). */
import type { App } from '@slack/bolt';
import type { AppContext } from '../../context/app-context.js';
import { errorMessage } from '../../utils/error.js';
import { logger } from '../../utils/logger.js';
import {
  clearInactivityTimer,
  postMessageWithBlocks,
  postMessageWithContext,
} from '../app-helpers.js';
import {
  ACTION_MENU_EXIT,
  ACTION_MENU_NEW_SESSION,
  ACTION_MENU_RESET,
  ACTION_MENU_SESSION_CLEAR,
  ACTION_MENU_SESSION_CLEAR_ALL,
  ACTION_MENU_SESSION_DELETE,
  ACTION_MENU_SESSION_LIST,
  ACTION_MENU_STOP,
  buildSessionClearBlocks,
  buildSessionListBlocks,
  decodeActionValue,
} from '../block-kit.js';
import {
  clearPendingStateForSession,
  formatSessionClearAllSummary,
  formatSessionClearedMessage,
  getActiveSessionRef,
  removeSessionWorkdir,
  stopSessionExecution,
} from '../handler-context.js';
import { maybeRunSwitchPreflight } from '../mcp-preflight.js';
import { CLAUDE_MCP_AUTH_BYPASS_SERVER_KEY } from '../tools/claude.js';
import { GEMINI_MCP_AUTH_BYPASS_SERVER_KEY } from '../tools/gemini.js';
import { parseMenuPayload, parseThreadKey } from './helpers.js';

export function registerDashboardMenuActions(ctx: AppContext, app: App): void {
  // ── Dashboard: Exit Button ──

  app.action(ACTION_MENU_EXIT, async ({ action, body, ack }) => {
    await ack();
    try {
      if (action.type !== 'button') return;
      const payload = parseMenuPayload(action.value);
      if (!payload) {
        logger.warn('action_menu_exit_invalid_payload', { value: action.value?.slice(0, 200) });
        return;
      }
      const { tk: threadKey } = payload;
      const parsed = parseThreadKey(threadKey);
      if (!parsed) return;
      const { channelId, threadTs } = parsed;

      const active = getActiveSessionRef(ctx, threadKey, body.user.id);
      if (!active) {
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          channelId,
          threadTs,
          'No active session to exit.',
        );
        return;
      }

      stopSessionExecution(ctx, active.sessionKey, 'exit_button');
      clearPendingStateForSession(ctx, active.sessionKey);
      clearInactivityTimer(ctx, threadKey);

      // Clear MCP auth bypass state (matches text-based handleExit behavior)
      if (active.session.tool === 'claude') {
        ctx.sessionManager.updateToolState(active.sessionKey, {
          ...active.session.toolState,
          claude_mcp_auth_approval_completed: undefined,
          [CLAUDE_MCP_AUTH_BYPASS_SERVER_KEY]: undefined,
        });
      } else if (active.session.tool === 'gemini') {
        ctx.sessionManager.updateToolState(active.sessionKey, {
          ...active.session.toolState,
          [GEMINI_MCP_AUTH_BYPASS_SERVER_KEY]: undefined,
        });
      }

      ctx.sessionManager.clearActiveSession(threadKey);
      const summary = ctx.sessionManager.getSessionSummary(active.sessionKey);

      await postMessageWithContext(
        ctx,
        ctx.webClient,
        channelId,
        threadTs,
        `Session exited: \`${summary?.sessionId ?? 'unknown'}\` (${active.session.tool}).`,
        { sessionKey: active.sessionKey, tool: active.session.tool },
      );
    } catch (err) {
      logger.error('action_menu_exit_error', { error: errorMessage(err) });
    }
  });

  // ── Dashboard: Stop Button ──

  app.action(ACTION_MENU_STOP, async ({ action, body, ack }) => {
    await ack();
    try {
      if (action.type !== 'button') return;
      const payload = parseMenuPayload(action.value);
      if (!payload) {
        logger.warn('action_menu_stop_invalid_payload', { value: action.value?.slice(0, 200) });
        return;
      }
      const { tk: threadKey } = payload;
      const parsed = parseThreadKey(threadKey);
      if (!parsed) return;
      const { channelId, threadTs } = parsed;

      const active = getActiveSessionRef(ctx, threadKey, body.user.id);
      if (!active) {
        await postMessageWithContext(ctx, ctx.webClient, channelId, threadTs, 'No active session.');
        return;
      }

      const activeRunner = ctx.activeRunners.get(active.sessionKey);
      if (!activeRunner?.runner.isRunning()) {
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          channelId,
          threadTs,
          'No running job to stop.',
          { sessionKey: active.sessionKey, tool: active.session.tool },
        );
        return;
      }

      stopSessionExecution(ctx, active.sessionKey, 'stop_button');

      await postMessageWithContext(
        ctx,
        ctx.webClient,
        channelId,
        threadTs,
        `Job stopped for session \`${ctx.sessionManager.getSessionSummary(active.sessionKey)?.sessionId ?? 'unknown'}\`.`,
        { sessionKey: active.sessionKey, tool: active.session.tool },
      );
    } catch (err) {
      logger.error('action_menu_stop_error', { error: errorMessage(err) });
    }
  });

  // ── Dashboard: New Session Button ──

  app.action(ACTION_MENU_NEW_SESSION, async ({ action, body, ack }) => {
    await ack();
    try {
      if (action.type !== 'button') return;
      const payload = parseMenuPayload(action.value);
      if (!payload) {
        logger.warn('action_menu_new_session_invalid_payload', {
          value: action.value?.slice(0, 200),
        });
        return;
      }
      const { tk: threadKey } = payload;
      const parsed = parseThreadKey(threadKey);
      if (!parsed) return;
      const { channelId, threadTs } = parsed;
      const userId = body.user.id;

      const active = getActiveSessionRef(ctx, threadKey, userId);
      if (!active) {
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          channelId,
          threadTs,
          'No active session. Select a tool first with `!gemini`, `!claude`, or `!codex`.',
        );
        return;
      }

      const tool = active.session.tool;
      const created = ctx.sessionManager.createSessionForThread(threadKey, userId, tool);
      ctx.workdirManager.prepareWorkdirSkillsOnly(created.workdir, created.tool);
      const summary = ctx.sessionManager.getSessionSummary(created.sessionKey);

      await postMessageWithContext(
        ctx,
        ctx.webClient,
        channelId,
        threadTs,
        `New session started: \`${summary?.sessionId ?? 'unknown'}\` (${tool}).`,
        { sessionKey: created.sessionKey, tool },
      );
      await maybeRunSwitchPreflight(
        ctx,
        ctx.webClient,
        tool,
        threadKey,
        channelId,
        threadTs,
        userId,
        created.sessionKey,
      );
    } catch (err) {
      logger.error('action_menu_new_session_error', { error: errorMessage(err) });
    }
  });

  // ── Dashboard: Reset Button ──

  app.action(ACTION_MENU_RESET, async ({ action, body, ack }) => {
    await ack();
    try {
      if (action.type !== 'button') return;
      const payload = parseMenuPayload(action.value);
      if (!payload) {
        logger.warn('action_menu_reset_invalid_payload', { value: action.value?.slice(0, 200) });
        return;
      }
      const { tk: threadKey } = payload;
      const parsed = parseThreadKey(threadKey);
      if (!parsed) return;
      const { channelId, threadTs } = parsed;

      const active = getActiveSessionRef(ctx, threadKey, body.user.id);
      if (!active) {
        await postMessageWithContext(ctx, ctx.webClient, channelId, threadTs, 'No active session.');
        return;
      }

      // Kill running job, cancel queue, reset session, clear pending state
      const activeRunner = ctx.activeRunners.get(active.sessionKey);
      if (activeRunner?.runner.isRunning()) {
        activeRunner.runner.kill('reset');
      }
      ctx.jobQueue.cancelSession(active.sessionKey);
      ctx.sessionManager.reset(active.sessionKey);
      ctx.pendingConfirmations.delete(threadKey);
      ctx.pendingToolApprovals.delete(threadKey);
      ctx.pendingMcpAuthBypassApprovals.delete(threadKey);

      await postMessageWithContext(ctx, ctx.webClient, channelId, threadTs, 'Session reset.', {
        sessionKey: active.sessionKey,
        tool: active.session.tool,
      });
    } catch (err) {
      logger.error('action_menu_reset_error', { error: errorMessage(err) });
    }
  });

  // ── Dashboard: Session List Button ──

  app.action(ACTION_MENU_SESSION_LIST, async ({ action, body, ack }) => {
    await ack();
    try {
      if (action.type !== 'button') return;
      const payload = parseMenuPayload(action.value);
      if (!payload) {
        logger.warn('action_menu_session_list_invalid_payload', {
          value: action.value?.slice(0, 200),
        });
        return;
      }
      const { tk: threadKey } = payload;
      const parsed = parseThreadKey(threadKey);
      if (!parsed) return;
      const { channelId, threadTs } = parsed;

      const sessions = ctx.sessionManager.listSessionsForThreadOwned(threadKey, body.user.id);
      const blocks = buildSessionListBlocks(sessions, threadKey);
      await postMessageWithBlocks(
        ctx,
        ctx.webClient,
        channelId,
        threadTs,
        blocks,
        sessions.length > 0 ? `Sessions: ${sessions.length} found` : 'No sessions found.',
      );
    } catch (err) {
      logger.error('action_menu_session_list_error', { error: errorMessage(err) });
    }
  });

  // ── Dashboard: Session Clear View Button ──

  app.action(ACTION_MENU_SESSION_CLEAR, async ({ action, body, ack }) => {
    await ack();
    try {
      if (action.type !== 'button') return;
      const payload = parseMenuPayload(action.value);
      if (!payload) {
        logger.warn('action_menu_session_clear_invalid_payload', {
          value: action.value?.slice(0, 200),
        });
        return;
      }
      const { tk: threadKey } = payload;
      const parsed = parseThreadKey(threadKey);
      if (!parsed) return;
      const { channelId, threadTs } = parsed;

      const sessions = ctx.sessionManager.listSessionsForThreadOwned(threadKey, body.user.id);
      const blocks = buildSessionClearBlocks(sessions, threadKey);
      await postMessageWithBlocks(
        ctx,
        ctx.webClient,
        channelId,
        threadTs,
        blocks,
        sessions.length > 0
          ? `Session cleanup: ${sessions.length} sessions`
          : 'No sessions to clear.',
      );
    } catch (err) {
      logger.error('action_menu_session_clear_error', { error: errorMessage(err) });
    }
  });

  // ── Dashboard: Session Delete Button (per-session) ──

  app.action(ACTION_MENU_SESSION_DELETE, async ({ action, body, ack }) => {
    await ack();
    try {
      if (action.type !== 'button') return;
      const { tk: threadKey, rid: sessionId } = decodeActionValue(action.value ?? '');
      const parsed = parseThreadKey(threadKey);
      if (!parsed) return;
      const { channelId, threadTs } = parsed;

      const sanitizedId = sessionId.slice(0, 200).replaceAll('`', '\uFF40');
      const targetSummary = ctx.sessionManager.getSessionSummaryByIdForThreadOwned(
        threadKey,
        body.user.id,
        sessionId,
      );
      if (!targetSummary) {
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          channelId,
          threadTs,
          `Session id \`${sanitizedId}\` was not found in this thread.`,
        );
        return;
      }

      stopSessionExecution(ctx, targetSummary.sessionKey, 'session_delete_button');
      clearPendingStateForSession(ctx, targetSummary.sessionKey);
      if (targetSummary.active) {
        clearInactivityTimer(ctx, threadKey);
      }

      const deleted = ctx.sessionManager.deleteSessionById(sessionId);
      if (!deleted) {
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          channelId,
          threadTs,
          `Session id \`${sanitizedId}\` no longer exists.`,
        );
        return;
      }

      await postMessageWithContext(
        ctx,
        ctx.webClient,
        channelId,
        threadTs,
        formatSessionClearedMessage(
          sanitizedId,
          deleted.tool,
          deleted.workdir,
          removeSessionWorkdir(ctx, deleted.workdir),
        ),
      );
    } catch (err) {
      logger.error('action_menu_session_delete_error', { error: errorMessage(err) });
    }
  });

  // ── Dashboard: Session Clear All Button ──

  app.action(ACTION_MENU_SESSION_CLEAR_ALL, async ({ action, body, ack }) => {
    await ack();
    try {
      if (action.type !== 'button') return;
      const payload = parseMenuPayload(action.value);
      if (!payload) {
        logger.warn('action_menu_session_clear_all_invalid_payload', {
          value: action.value?.slice(0, 200),
        });
        return;
      }
      const { tk: threadKey } = payload;
      const parsed = parseThreadKey(threadKey);
      if (!parsed) return;
      const { channelId, threadTs } = parsed;

      const threadSessions = ctx.sessionManager.listSessionsForThreadOwned(threadKey, body.user.id);
      for (const session of threadSessions) {
        stopSessionExecution(ctx, session.sessionKey, 'session_clear_all_button');
        clearPendingStateForSession(ctx, session.sessionKey);
      }
      if (threadSessions.some((session) => session.active)) {
        clearInactivityTimer(ctx, threadKey);
      }

      const cleared = ctx.sessionManager.deleteSessionsByIds(
        threadSessions.map((s) => s.sessionId),
      );
      await postMessageWithContext(
        ctx,
        ctx.webClient,
        channelId,
        threadTs,
        formatSessionClearAllSummary(ctx, cleared),
      );
    } catch (err) {
      logger.error('action_menu_session_clear_all_error', { error: errorMessage(err) });
    }
  });
}
