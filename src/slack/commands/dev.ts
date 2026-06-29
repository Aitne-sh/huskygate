/** @module commands/dev — Dev alias handlers */
import { postMessageWithContext } from '../app-helpers.js';
import type { HandlerContext } from '../handler-context.js';
import {
  clearPendingStateForSession,
  getActiveSessionRef,
  stopSessionExecution,
} from '../handler-context.js';
import type { CommandType } from '../parser.js';

export async function handleDevList(
  hctx: HandlerContext,
  _command: Extract<CommandType, { kind: 'dev_list' }>,
): Promise<void> {
  const aliases = hctx.ctx.devAliasStore.list();
  if (aliases.length === 0) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'No dev aliases configured. Add them from the Dashboard Dev tab.',
    );
    return;
  }
  const lines = ['*Dev Aliases*'];
  for (const alias of aliases) {
    lines.push(`- \`${alias.name}\` | ${alias.tool} | \`${alias.path}\``);
  }
  await postMessageWithContext(
    hctx.ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    lines.join('\n'),
  );
}

export async function handleDev(
  hctx: HandlerContext,
  command: Extract<CommandType, { kind: 'dev' }>,
): Promise<void> {
  const aliasObj = hctx.ctx.devAliasStore.get(command.alias);
  if (!aliasObj) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Dev alias \`${command.alias}\` not found. Run \`!dev\` to list aliases.`,
    );
    return;
  }

  // Check for active session conflict
  const active = getActiveSessionRef(hctx.ctx, hctx.threadKey, hctx.userId);
  const existing = hctx.ctx.sessionManager.findDevSession(command.alias);
  if (active && (!existing || active.sessionKey !== existing.sessionKey)) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Cannot start dev session while \`${active.session.tool}\` is active. Run \`!exit\` first.`,
      { sessionKey: active.sessionKey, tool: active.session.tool },
    );
    return;
  }

  // Resume existing dev session for this alias
  if (existing) {
    hctx.ctx.sessionManager.setActiveSessionKey(hctx.threadKey, existing.sessionKey);
    hctx.ctx.workdirManager.prepareDevWorkdir(existing.workdir);
    const summary = hctx.ctx.sessionManager.getSessionSummary(existing.sessionKey);
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Dev session resumed: \`${command.alias}\` (${aliasObj.tool}, session: \`${summary?.sessionId ?? 'unknown'}\`).`,
      { sessionKey: existing.sessionKey, tool: existing.tool },
    );
    return;
  }

  // Create new dev session
  const session = hctx.ctx.sessionManager.createDevSession(hctx.threadKey, hctx.userId, aliasObj);
  hctx.ctx.workdirManager.prepareDevWorkdir(session.workdir);
  if (aliasObj.instructionContent) {
    hctx.ctx.workdirManager.seedDevInstructionFile(
      session.workdir,
      aliasObj.tool,
      aliasObj.instructionContent,
    );
  }
  const summary = hctx.ctx.sessionManager.getSessionSummary(session.sessionKey);
  await postMessageWithContext(
    hctx.ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    `Dev session started: \`${command.alias}\` (${aliasObj.tool}, session: \`${summary?.sessionId ?? 'unknown'}\`).`,
    { sessionKey: session.sessionKey, tool: session.tool },
  );
}

export async function handleDevNew(
  hctx: HandlerContext,
  command: Extract<CommandType, { kind: 'dev_new' }>,
): Promise<void> {
  const aliasObj = hctx.ctx.devAliasStore.get(command.alias);
  if (!aliasObj) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Dev alias \`${command.alias}\` not found. Run \`!dev\` to list aliases.`,
    );
    return;
  }

  // Check for active session conflict
  const active = getActiveSessionRef(hctx.ctx, hctx.threadKey, hctx.userId);
  const existing = hctx.ctx.sessionManager.findDevSession(command.alias);
  if (active && (!existing || active.sessionKey !== existing.sessionKey)) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Cannot start dev session while \`${active.session.tool}\` is active. Run \`!exit\` first.`,
      { sessionKey: active.sessionKey, tool: active.session.tool },
    );
    return;
  }

  // Clear existing dev session if any (keep workdir — it's the user's project dir)
  if (existing) {
    stopSessionExecution(hctx.ctx, existing.sessionKey, 'dev_new');
    clearPendingStateForSession(hctx.ctx, existing.sessionKey);
    hctx.ctx.sessionManager.deleteSessionByKeyWithCleanup(existing.sessionKey);
  }

  // Create fresh dev session
  const session = hctx.ctx.sessionManager.createDevSession(hctx.threadKey, hctx.userId, aliasObj);
  hctx.ctx.workdirManager.prepareDevWorkdir(session.workdir);
  if (aliasObj.instructionContent) {
    hctx.ctx.workdirManager.seedDevInstructionFile(
      session.workdir,
      aliasObj.tool,
      aliasObj.instructionContent,
    );
  }
  const summary = hctx.ctx.sessionManager.getSessionSummary(session.sessionKey);
  await postMessageWithContext(
    hctx.ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    `New dev session started: \`${command.alias}\` (${aliasObj.tool}, session: \`${summary?.sessionId ?? 'unknown'}\`).`,
    { sessionKey: session.sessionKey, tool: session.tool },
  );
}
