/** @module slack/actions/dev-selection — Dev alias selection action. */
import type { App } from '@slack/bolt';
import type { AppContext } from '../../context/app-context.js';
import { errorMessage } from '../../utils/error.js';
import { logger } from '../../utils/logger.js';
import { postMessageWithContext } from '../app-helpers.js';
import { ACTION_MENU_DEV_SELECT } from '../block-kit.js';
import { getActiveSessionRef } from '../handler-context.js';
import { parseMenuPayload, parseThreadKey } from './helpers.js';

export function registerDevSelectionActions(ctx: AppContext, app: App): void {
  app.action(new RegExp(`^${ACTION_MENU_DEV_SELECT}_`), async ({ action, body, ack }) => {
    await ack();
    try {
      if (action.type !== 'button') return;
      const payload = parseMenuPayload<{ alias: string }>(action.value);
      if (!payload || typeof payload.alias !== 'string') {
        logger.warn('action_menu_dev_select_invalid_payload', {
          value: action.value?.slice(0, 200),
        });
        return;
      }
      const { tk: threadKey, alias } = payload;
      const parsed = parseThreadKey(threadKey);
      if (!parsed) return;
      const { channelId, threadTs } = parsed;
      const userId = body.user.id;

      const aliasObj = ctx.devAliasStore.get(alias);
      if (!aliasObj) {
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          channelId,
          threadTs,
          `Dev alias \`${alias.slice(0, 50)}\` not found.`,
        );
        return;
      }

      const active = getActiveSessionRef(ctx, threadKey, userId);
      const existing = ctx.sessionManager.findDevSession(alias);
      if (active && (!existing || active.sessionKey !== existing.sessionKey)) {
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          channelId,
          threadTs,
          `Cannot start dev session while \`${active.session.tool}\` is active. Run \`!exit\` first.`,
          { sessionKey: active.sessionKey, tool: active.session.tool },
        );
        return;
      }

      if (existing) {
        ctx.sessionManager.setActiveSessionKey(threadKey, existing.sessionKey);
        ctx.workdirManager.prepareDevWorkdir(existing.workdir);
        const summary = ctx.sessionManager.getSessionSummary(existing.sessionKey);
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          channelId,
          threadTs,
          `Dev session resumed: \`${alias}\` (${aliasObj.tool}, session: \`${summary?.sessionId ?? 'unknown'}\`).`,
          { sessionKey: existing.sessionKey, tool: existing.tool },
        );
        return;
      }

      const session = ctx.sessionManager.createDevSession(threadKey, userId, aliasObj);
      ctx.workdirManager.prepareDevWorkdir(session.workdir);
      if (aliasObj.instructionContent) {
        ctx.workdirManager.seedDevInstructionFile(
          session.workdir,
          aliasObj.tool,
          aliasObj.instructionContent,
        );
      }
      const summary = ctx.sessionManager.getSessionSummary(session.sessionKey);
      await postMessageWithContext(
        ctx,
        ctx.webClient,
        channelId,
        threadTs,
        `Dev session started: \`${alias}\` (${aliasObj.tool}, session: \`${summary?.sessionId ?? 'unknown'}\`).`,
        { sessionKey: session.sessionKey, tool: session.tool },
      );
    } catch (err) {
      logger.error('action_menu_dev_select_error', { error: errorMessage(err) });
    }
  });
}
