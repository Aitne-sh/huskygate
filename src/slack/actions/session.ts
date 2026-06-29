/** @module slack/actions/session — Session resume, mode select, and tool select actions. */
import type { App } from '@slack/bolt';
import type { ToolName } from '../../config.js';
import type { AppContext } from '../../context/app-context.js';
import { errorMessage } from '../../utils/error.js';
import { logger } from '../../utils/logger.js';
import {
  CHALLENGE_TIMEOUT_MS,
  generateChallengeCode,
  postMessageWithContext,
  scheduleExpiry,
} from '../app-helpers.js';
import {
  ACTION_MENU_TOOL_SELECT,
  ACTION_MODE_SELECT,
  ACTION_SESSION_RESUME,
  decodeActionValue,
} from '../block-kit.js';
import { getActiveSessionRef } from '../handler-context.js';
import { maybeRunSwitchPreflight } from '../mcp-preflight.js';
import { VALID_TOOLS, parseMenuPayload, parseThreadKey } from './helpers.js';

export function registerSessionActions(ctx: AppContext, app: App): void {
  // ── Session Resume Button ──

  app.action(ACTION_SESSION_RESUME, async ({ action, body, ack }) => {
    await ack();
    try {
      if (action.type !== 'button') return;
      const { tk: threadKey, rid: sessionId } = decodeActionValue(action.value ?? '');
      const parsed = parseThreadKey(threadKey);
      if (!parsed) return;

      const { channelId, threadTs } = parsed;

      const target = ctx.sessionManager.getSessionByIdForThreadOwned(
        threadKey,
        body.user.id,
        sessionId,
      );
      if (!target) {
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          channelId,
          threadTs,
          `Session id \`${sessionId.slice(0, 200)}\` was not found in this thread.`,
        );
        return;
      }

      const active = getActiveSessionRef(ctx, threadKey, body.user.id);
      if (active && active.sessionKey !== target.sessionKey) {
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          channelId,
          threadTs,
          `Cannot switch sessions while \`${active.session.tool}\` is active. Run \`!exit\` first.`,
          { sessionKey: active.sessionKey, tool: active.session.tool },
        );
        return;
      }

      ctx.sessionManager.setActiveSessionKey(threadKey, target.sessionKey);
      ctx.workdirManager.prepareWorkdirSkillsOnly(target.workdir, target.tool);
      const summary = ctx.sessionManager.getSessionSummary(target.sessionKey);

      await postMessageWithContext(
        ctx,
        ctx.webClient,
        channelId,
        threadTs,
        `Session resumed: \`${summary?.sessionId ?? sessionId}\` (${target.tool}).`,
        { sessionKey: target.sessionKey, tool: target.tool },
      );

      await maybeRunSwitchPreflight(
        ctx,
        ctx.webClient,
        target.tool,
        threadKey,
        channelId,
        threadTs,
        body.user.id,
        target.sessionKey,
      );
    } catch (err) {
      logger.error('action_session_resume_error', { error: errorMessage(err) });
    }
  });

  // ── Mode Select Dropdown ──

  app.action(ACTION_MODE_SELECT, async ({ action, body, ack }) => {
    await ack();
    try {
      if (action.type !== 'static_select') return;
      const selectedValue = JSON.parse(action.selected_option?.value ?? '{}') as {
        tk: string;
        mode: string;
      };
      const { tk: threadKey, mode } = selectedValue;
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
          'No active session. Select one first with `!gemini`, `!claude`, or `!codex`.',
        );
        return;
      }

      if (mode === 'readonly') {
        if (active.session.mode !== 'readonly') {
          ctx.auditStore.logModeChange({
            sessionKey: active.sessionKey,
            userId: body.user.id,
            fromMode: active.session.mode,
            toMode: 'readonly',
            expiresAt: null,
          });
          ctx.sessionManager.updateMode(active.sessionKey, 'readonly', null);
        }
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          channelId,
          threadTs,
          'Mode set to readonly.',
          { sessionKey: active.sessionKey, tool: active.session.tool },
        );
      } else if (mode === 'write') {
        // Write mode requires challenge code — cannot bypass via button
        const code = generateChallengeCode();
        ctx.pendingConfirmations.set(
          threadKey,
          {
            kind: 'mode',
            mode: 'write',
            code,
            expiresAt: Date.now() + CHALLENGE_TIMEOUT_MS,
            sessionKey: active.sessionKey,
          },
          CHALLENGE_TIMEOUT_MS,
        );

        await postMessageWithContext(
          ctx,
          ctx.webClient,
          channelId,
          threadTs,
          `Write permission requested. To confirm, reply:\n\`!confirm ${code}\`\n(30 seconds to respond)`,
          { sessionKey: active.sessionKey, tool: active.session.tool },
        );
        scheduleExpiry(
          ctx.pendingConfirmations,
          threadKey,
          (p) => p.code === code,
          CHALLENGE_TIMEOUT_MS,
          'confirmation',
        );
      }
    } catch (err) {
      logger.error('action_mode_select_error', { error: errorMessage(err) });
    }
  });

  // ── Dashboard: Tool Select Buttons ──

  app.action(new RegExp(`^${ACTION_MENU_TOOL_SELECT}_`), async ({ action, body, ack }) => {
    await ack();
    try {
      if (action.type !== 'button') return;
      const payload = parseMenuPayload<{ tool: string }>(action.value);
      if (!payload || typeof payload.tool !== 'string') {
        logger.warn('action_menu_tool_select_invalid_payload', {
          value: action.value?.slice(0, 200),
        });
        return;
      }
      const { tk: threadKey, tool } = payload;
      const parsed = parseThreadKey(threadKey);
      if (!parsed) return;
      const { channelId, threadTs } = parsed;
      const userId = body.user.id;

      if (!VALID_TOOLS.has(tool)) {
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          channelId,
          threadTs,
          `Invalid tool: \`${tool.slice(0, 50)}\``,
        );
        return;
      }
      const validTool = tool as ToolName;

      const active = getActiveSessionRef(ctx, threadKey, userId);
      if (active && active.session.tool !== validTool) {
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          channelId,
          threadTs,
          `Cannot switch to \`${validTool}\` while \`${active.session.tool}\` is active. Run \`!exit\` first.`,
          { sessionKey: active.sessionKey, tool: active.session.tool },
        );
        return;
      }

      if (!active) {
        const latest = ctx.sessionManager.findLatestSessionByToolOwned(
          threadKey,
          userId,
          validTool,
        );
        if (latest) {
          ctx.sessionManager.setActiveSessionKey(threadKey, latest.sessionKey);
          ctx.workdirManager.prepareWorkdirSkillsOnly(latest.workdir, latest.tool);
          const summary = ctx.sessionManager.getSessionSummary(latest.sessionKey);
          await postMessageWithContext(
            ctx,
            ctx.webClient,
            channelId,
            threadTs,
            `Session resumed: \`${summary?.sessionId ?? 'unknown'}\` (${validTool}).`,
            { sessionKey: latest.sessionKey, tool: latest.tool },
          );
          await maybeRunSwitchPreflight(
            ctx,
            ctx.webClient,
            validTool,
            threadKey,
            channelId,
            threadTs,
            userId,
            latest.sessionKey,
          );
        } else {
          const created = ctx.sessionManager.createSessionForThread(threadKey, userId, validTool);
          ctx.workdirManager.prepareWorkdirSkillsOnly(created.workdir, created.tool);
          const summary = ctx.sessionManager.getSessionSummary(created.sessionKey);
          await postMessageWithContext(
            ctx,
            ctx.webClient,
            channelId,
            threadTs,
            `New session started: \`${summary?.sessionId ?? 'unknown'}\` (${validTool}).`,
            { sessionKey: created.sessionKey, tool: created.tool },
          );
          await maybeRunSwitchPreflight(
            ctx,
            ctx.webClient,
            validTool,
            threadKey,
            channelId,
            threadTs,
            userId,
            created.sessionKey,
          );
        }
      } else {
        const summary = ctx.sessionManager.getSessionSummary(active.sessionKey);
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          channelId,
          threadTs,
          `Already on \`${validTool}\` session: \`${summary?.sessionId ?? 'unknown'}\`.`,
          { sessionKey: active.sessionKey, tool: active.session.tool },
        );
      }
    } catch (err) {
      logger.error('action_menu_tool_select_error', { error: errorMessage(err) });
    }
  });
}
