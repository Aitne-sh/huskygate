/** @module commands/workdir — Working directory handlers */
import path from 'node:path';
import { errorMessage } from '../../utils/error.js';
import {
  CHALLENGE_TIMEOUT_MS,
  generateChallengeCode,
  postMessageWithContext,
  scheduleExpiry,
} from '../app-helpers.js';
import type { HandlerContext } from '../handler-context.js';
import { getActiveSessionRef } from '../handler-context.js';
import type { CommandType } from '../parser.js';

export async function handleWorkdirQuery(
  hctx: HandlerContext,
  _command: Extract<CommandType, { kind: 'workdir_query' }>,
): Promise<void> {
  const active = getActiveSessionRef(hctx.ctx, hctx.threadKey, hctx.userId);
  if (!active) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'No active session.',
    );
    return;
  }
  await postMessageWithContext(
    hctx.ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    `Current workdir: \`${active.session.workdir}\``,
    { sessionKey: active.sessionKey, tool: active.session.tool },
  );
}

export async function handleWorkdirReset(
  hctx: HandlerContext,
  _command: Extract<CommandType, { kind: 'workdir_reset' }>,
): Promise<void> {
  const active = getActiveSessionRef(hctx.ctx, hctx.threadKey, hctx.userId);
  if (!active) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'No active session.',
    );
    return;
  }
  const activeSummary = hctx.ctx.sessionManager.getSessionSummary(active.sessionKey);
  const defaultDir = activeSummary
    ? path.join(hctx.ctx.config.workdirRoot, activeSummary.sessionId)
    : hctx.ctx.workdirManager.getSessionWorkdir(active.sessionKey);
  hctx.ctx.sessionManager.updateWorkdir(active.sessionKey, defaultDir);
  hctx.ctx.workdirManager.prepareWorkdirSkillsOnly(defaultDir, active.session.tool);
  await postMessageWithContext(
    hctx.ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    `Workdir reset to: \`${defaultDir}\``,
    { sessionKey: active.sessionKey, tool: active.session.tool },
  );
}

export async function handleWorkdirChange(
  hctx: HandlerContext,
  command: Extract<CommandType, { kind: 'workdir_change' }>,
): Promise<void> {
  const active = getActiveSessionRef(hctx.ctx, hctx.threadKey, hctx.userId);
  if (!active) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'No active session.',
    );
    return;
  }
  try {
    const validated = hctx.ctx.workdirManager.validateCustomWorkdir(command.path);
    const code = generateChallengeCode();
    hctx.ctx.pendingConfirmations.set(
      hctx.threadKey,
      {
        kind: 'workdir',
        workdir: validated,
        code,
        expiresAt: Date.now() + CHALLENGE_TIMEOUT_MS,
        sessionKey: active.sessionKey,
      },
      CHALLENGE_TIMEOUT_MS,
    );

    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Workdir change requested for:\n\`${validated}\`\nTo confirm, reply:\n\`!confirm ${code}\`\n(30 seconds to respond)`,
      { sessionKey: active.sessionKey, tool: active.session.tool },
    );
    scheduleExpiry(
      hctx.ctx.pendingConfirmations,
      hctx.threadKey,
      (p) => p.code === code,
      CHALLENGE_TIMEOUT_MS,
      'confirmation',
    );
  } catch (err) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Workdir error: ${errorMessage(err)}`,
      { sessionKey: active.sessionKey, tool: active.session.tool },
    );
  }
}
