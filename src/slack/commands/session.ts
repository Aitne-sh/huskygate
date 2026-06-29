/** @module commands/session — Session management handlers */
import {
  clearInactivityTimer,
  formatSessionListMessage,
  getDefaultModelForTool,
  postMessageWithBlocks,
  postMessageWithContext,
} from '../app-helpers.js';
import { buildSessionListBlocks } from '../block-kit.js';
import type { HandlerContext } from '../handler-context.js';
import {
  clearPendingStateForSession,
  formatSessionClearAllSummary,
  formatSessionClearedMessage,
  getActiveSessionRef,
  removeSessionWorkdir,
  stopSessionExecution,
} from '../handler-context.js';
import { maybeRunSwitchPreflight } from '../mcp-preflight.js';
import type { CommandType } from '../parser.js';

export async function handleSessions(
  hctx: HandlerContext,
  _command: Extract<CommandType, { kind: 'sessions' }>,
): Promise<void> {
  const sessions = hctx.ctx.sessionManager.listSessionsForThreadOwned(hctx.threadKey, hctx.userId);
  const blocks = buildSessionListBlocks(sessions, hctx.threadKey);
  await postMessageWithBlocks(
    hctx.ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    blocks,
    formatSessionListMessage(sessions),
  );
}

export async function handleSessionClear(
  hctx: HandlerContext,
  command: Extract<CommandType, { kind: 'session_clear' }>,
): Promise<void> {
  const sanitizedId = command.sessionId.slice(0, 200).replaceAll('`', '\uFF40');
  const targetSummary = hctx.ctx.sessionManager.getSessionSummaryByIdForThreadOwned(
    hctx.threadKey,
    hctx.userId,
    command.sessionId,
  );
  if (!targetSummary) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Session id \`${sanitizedId}\` was not found in this thread.`,
    );
    return;
  }

  stopSessionExecution(hctx.ctx, targetSummary.sessionKey, 'session_clear');
  clearPendingStateForSession(hctx.ctx, targetSummary.sessionKey);
  if (targetSummary.active) {
    clearInactivityTimer(hctx.ctx, targetSummary.threadKey);
  }

  const deleted = hctx.ctx.sessionManager.deleteSessionById(command.sessionId);
  if (!deleted) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Session id \`${sanitizedId}\` no longer exists.`,
    );
    return;
  }

  await postMessageWithContext(
    hctx.ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    formatSessionClearedMessage(
      sanitizedId,
      deleted.tool,
      deleted.workdir,
      removeSessionWorkdir(hctx.ctx, deleted.workdir),
    ),
  );
}

export async function handleSessionClearAll(
  hctx: HandlerContext,
  _command: Extract<CommandType, { kind: 'session_clear_all' }>,
): Promise<void> {
  const threadSessions = hctx.ctx.sessionManager.listSessionsForThreadOwned(
    hctx.threadKey,
    hctx.userId,
  );
  for (const session of threadSessions) {
    stopSessionExecution(hctx.ctx, session.sessionKey, 'session_clear_all');
    clearPendingStateForSession(hctx.ctx, session.sessionKey);
  }
  if (threadSessions.some((session) => session.active)) {
    clearInactivityTimer(hctx.ctx, hctx.threadKey);
  }

  const cleared = hctx.ctx.sessionManager.deleteSessionsByIds(
    threadSessions.map((s) => s.sessionId),
  );
  hctx.ctx.pendingConfirmations.delete(hctx.threadKey);
  hctx.ctx.pendingToolApprovals.delete(hctx.threadKey);
  hctx.ctx.pendingMcpAuthBypassApprovals.delete(hctx.threadKey);
  await postMessageWithContext(
    hctx.ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    formatSessionClearAllSummary(hctx.ctx, cleared),
  );
}

export async function handleCurrentSession(
  hctx: HandlerContext,
  _command: Extract<CommandType, { kind: 'current_session' }>,
): Promise<void> {
  const activeRef = getActiveSessionRef(hctx.ctx, hctx.threadKey, hctx.userId);
  if (!activeRef) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'No active session. Select one with `!gemini`, `!claude`, `!codex`, or `!session <sessionId>`.',
    );
    return;
  }
  const activeSummary = hctx.ctx.sessionManager.getSessionSummary(activeRef.sessionKey);
  if (!activeSummary) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'No active session. Select one with `!gemini`, `!claude`, `!codex`, or `!session <sessionId>`.',
    );
    return;
  }
  const sessionModel =
    activeRef &&
    typeof activeRef.session.toolState.model === 'string' &&
    activeRef.session.toolState.model.trim()
      ? activeRef.session.toolState.model.trim()
      : null;
  const envModel = getDefaultModelForTool(hctx.ctx.config, activeSummary.tool);
  const modelLine = sessionModel
    ? `model=${sessionModel} (session)`
    : envModel
      ? `model=${envModel} (env)`
      : 'model=default';

  const lines = [
    '*Current Session*',
    `id=${activeSummary.sessionId}`,
    `app=${activeSummary.tool}`,
    `started=${activeSummary.startedAt}`,
    `updated=${activeSummary.updatedAt}`,
    `mode=${activeSummary.mode}${activeSummary.modeExpiresAt ? ` (expires: ${activeSummary.modeExpiresAt})` : ''}`,
    modelLine,
    `workdir=${activeSummary.workdir}`,
  ];
  await postMessageWithContext(
    hctx.ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    lines.join('\n'),
    {
      sessionKey: activeSummary.sessionKey,
      tool: activeSummary.tool,
    },
  );
}

export async function handleStartSession(
  hctx: HandlerContext,
  command: Extract<CommandType, { kind: 'start_session' }>,
): Promise<void> {
  const sanitizedStartId = command.sessionId.slice(0, 200).replaceAll('`', '\uFF40');
  const target = hctx.ctx.sessionManager.getSessionByIdForThreadOwned(
    hctx.threadKey,
    hctx.userId,
    command.sessionId,
  );
  if (!target) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Session id \`${sanitizedStartId}\` was not found in this thread.`,
    );
    return;
  }
  const active = getActiveSessionRef(hctx.ctx, hctx.threadKey, hctx.userId);
  if (active && active.sessionKey !== target.sessionKey) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Cannot switch sessions while \`${active.session.tool}\` is active. Run \`!exit\` first.`,
      { sessionKey: active.sessionKey, tool: active.session.tool },
    );
    return;
  }
  hctx.ctx.sessionManager.setActiveSessionKey(hctx.threadKey, target.sessionKey);
  hctx.ctx.workdirManager.prepareWorkdirSkillsOnly(target.workdir, target.tool);
  const summary = hctx.ctx.sessionManager.getSessionSummary(target.sessionKey);
  await postMessageWithContext(
    hctx.ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    `Session resumed: \`${summary?.sessionId ?? command.sessionId}\` (${target.tool}).`,
    { sessionKey: target.sessionKey, tool: target.tool },
  );
  await maybeRunSwitchPreflight(
    hctx.ctx,
    hctx.client,
    target.tool,
    hctx.threadKey,
    hctx.channelId,
    hctx.threadTs,
    hctx.userId,
    target.sessionKey,
  );
}

export async function handleNewSession(
  hctx: HandlerContext,
  command: Extract<CommandType, { kind: 'new_session' }>,
): Promise<void> {
  const active = getActiveSessionRef(hctx.ctx, hctx.threadKey, hctx.userId);
  if (active && active.session.tool !== command.tool) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Cannot start \`${command.tool}\` while \`${active.session.tool}\` is active. Run \`!exit\` first.`,
      { sessionKey: active.sessionKey, tool: active.session.tool },
    );
    return;
  }

  const created = hctx.ctx.sessionManager.createSessionForThread(
    hctx.threadKey,
    hctx.userId,
    command.tool,
  );
  hctx.ctx.workdirManager.prepareWorkdirSkillsOnly(created.workdir, created.tool);
  const newSummary = hctx.ctx.sessionManager.getSessionSummary(created.sessionKey);
  await postMessageWithContext(
    hctx.ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    `New session started: \`${newSummary?.sessionId ?? 'unknown'}\` (${command.tool}).`,
    { sessionKey: created.sessionKey, tool: command.tool },
  );
  await maybeRunSwitchPreflight(
    hctx.ctx,
    hctx.client,
    command.tool,
    hctx.threadKey,
    hctx.channelId,
    hctx.threadTs,
    hctx.userId,
    created.sessionKey,
  );
}
