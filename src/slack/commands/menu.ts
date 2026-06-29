/** @module commands/menu — Menu and command-list handlers */
import {
  formatCommandListMessage,
  formatUnknownBangCommandError,
  postMessageWithBlocks,
  postMessageWithContext,
} from '../app-helpers.js';
import type { ActiveSessionInfo } from '../block-kit.js';
import { buildMenuActiveSessionBlocks, buildMenuNoSessionBlocks } from '../block-kit.js';
import type { HandlerContext } from '../handler-context.js';
import { getActiveSessionRef } from '../handler-context.js';
import type { CommandType } from '../parser.js';

export async function handleUnknownBang(
  hctx: HandlerContext,
  command: Extract<CommandType, { kind: 'unknown_bang' }>,
): Promise<void> {
  await postMessageWithContext(
    hctx.ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    formatUnknownBangCommandError(command.input),
  );
}

export async function handleListCommands(
  hctx: HandlerContext,
  _command: Extract<CommandType, { kind: 'list_commands' }>,
): Promise<void> {
  await postMessageWithContext(
    hctx.ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    formatCommandListMessage(),
  );
}

export async function handleMenu(
  hctx: HandlerContext,
  _command: Extract<CommandType, { kind: 'menu' }>,
): Promise<void> {
  const active = getActiveSessionRef(hctx.ctx, hctx.threadKey, hctx.userId);
  const sessions = hctx.ctx.sessionManager.listSessionsForThreadOwned(hctx.threadKey, hctx.userId);

  if (active) {
    const sessionModel =
      typeof active.session.toolState.model === 'string' && active.session.toolState.model.trim()
        ? active.session.toolState.model.trim()
        : null;
    const summary = hctx.ctx.sessionManager.getSessionSummary(active.sessionKey);
    const runningJob = hctx.ctx.jobQueue.getRunningJob(active.sessionKey);

    const info: ActiveSessionInfo = {
      sessionId: summary?.sessionId ?? 'unknown',
      tool: active.session.tool,
      mode: active.session.mode,
      modeExpiresAt: active.session.modeExpiresAt,
      model: sessionModel,
      workdir: active.session.workdir,
      runningJobId: runningJob?.id ?? null,
    };

    const devAliases = hctx.ctx.devAliasStore.list();
    const blocks = buildMenuActiveSessionBlocks(info, sessions, hctx.threadKey, devAliases);
    await postMessageWithBlocks(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      blocks,
      `HuskyGate — Active: ${info.tool} (${info.sessionId})`,
      { sessionKey: active.sessionKey, tool: active.session.tool },
    );
  } else {
    const devAliases = hctx.ctx.devAliasStore.list();
    const blocks = buildMenuNoSessionBlocks(sessions, hctx.threadKey, devAliases);
    await postMessageWithBlocks(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      blocks,
      'HuskyGate — No active session. Select a tool to get started.',
    );
  }
}
