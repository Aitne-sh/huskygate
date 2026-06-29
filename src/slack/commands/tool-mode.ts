/** @module commands/tool-mode — Tool switch, model, mode, and confirm handlers */
import {
  CHALLENGE_TIMEOUT_MS,
  generateChallengeCode,
  getDefaultModelForTool,
  postMessageWithContext,
  scheduleExpiry,
} from '../app-helpers.js';
import type { HandlerContext } from '../handler-context.js';
import { getActiveSessionRef } from '../handler-context.js';
import { maybeRunSwitchPreflight } from '../mcp-preflight.js';
import type { CommandType } from '../parser.js';

export async function handleToolSwitch(
  hctx: HandlerContext,
  command: Extract<CommandType, { kind: 'tool_switch' }>,
): Promise<void> {
  const active = getActiveSessionRef(hctx.ctx, hctx.threadKey, hctx.userId);
  if (active && active.session.tool !== command.tool) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Cannot switch to \`${command.tool}\` while \`${active.session.tool}\` is active. Run \`!exit\` first.`,
      { sessionKey: active.sessionKey, tool: active.session.tool },
    );
    return;
  }

  let selectedSession = active?.session ?? null;
  if (!selectedSession) {
    selectedSession = hctx.ctx.sessionManager.findLatestSessionByToolOwned(
      hctx.threadKey,
      hctx.userId,
      command.tool,
    );
    if (selectedSession) {
      hctx.ctx.sessionManager.setActiveSessionKey(hctx.threadKey, selectedSession.sessionKey);
    } else {
      selectedSession = hctx.ctx.sessionManager.createSessionForThread(
        hctx.threadKey,
        hctx.userId,
        command.tool,
      );
    }
  }
  hctx.ctx.workdirManager.prepareWorkdirSkillsOnly(selectedSession.workdir, selectedSession.tool);
  const selectedSessionKey = selectedSession.sessionKey;
  const switchSummary = hctx.ctx.sessionManager.getSessionSummary(selectedSessionKey);
  const switchText =
    active && active.session.tool === command.tool
      ? `Already using \`${command.tool}\` (session: \`${switchSummary?.sessionId ?? 'unknown'}\`).`
      : `Tool switched to \`${command.tool}\` (session: \`${switchSummary?.sessionId ?? 'unknown'}\`).`;
  await postMessageWithContext(hctx.ctx, hctx.client, hctx.channelId, hctx.threadTs, switchText, {
    sessionKey: selectedSessionKey,
    tool: command.tool,
  });
  await maybeRunSwitchPreflight(
    hctx.ctx,
    hctx.client,
    command.tool,
    hctx.threadKey,
    hctx.channelId,
    hctx.threadTs,
    hctx.userId,
    selectedSessionKey,
  );
}

export async function handleModelQuery(
  hctx: HandlerContext,
  _command: Extract<CommandType, { kind: 'model_query' }>,
): Promise<void> {
  const active = getActiveSessionRef(hctx.ctx, hctx.threadKey, hctx.userId);
  if (!active) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'No active session. Select one first with `!gemini`, `!claude`, or `!codex`.',
    );
    return;
  }
  const sessionModel =
    typeof active.session.toolState.model === 'string' && active.session.toolState.model.trim()
      ? active.session.toolState.model.trim()
      : null;
  const envModel = getDefaultModelForTool(hctx.ctx.config, active.session.tool);

  let display: string;
  if (sessionModel) {
    display = `Model: \`${sessionModel}\` (session override)`;
  } else if (envModel) {
    display = `Model: \`${envModel}\` (env default)`;
  } else {
    display = 'Model: default (CLI built-in)';
  }
  await postMessageWithContext(hctx.ctx, hctx.client, hctx.channelId, hctx.threadTs, display, {
    sessionKey: active.sessionKey,
    tool: active.session.tool,
  });
}

export async function handleModelChange(
  hctx: HandlerContext,
  command: Extract<CommandType, { kind: 'model_change' }>,
): Promise<void> {
  const active = getActiveSessionRef(hctx.ctx, hctx.threadKey, hctx.userId);
  if (!active) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'No active session. Select one first with `!gemini`, `!claude`, or `!codex`.',
    );
    return;
  }

  const isReset = command.model.toLowerCase() === 'default';
  const currentToolState = { ...active.session.toolState };
  const nextToolState = isReset
    ? (({ model: _model, ...rest }) => rest)(currentToolState)
    : { ...currentToolState, model: command.model };
  hctx.ctx.sessionManager.updateToolState(active.sessionKey, nextToolState);

  const message = isReset
    ? 'Model reset to default.'
    : `Model set to \`${command.model}\` for this session.`;
  await postMessageWithContext(hctx.ctx, hctx.client, hctx.channelId, hctx.threadTs, message, {
    sessionKey: active.sessionKey,
    tool: active.session.tool,
  });
}

export async function handleModeNetDisabled(
  hctx: HandlerContext,
  _command: Extract<CommandType, { kind: 'mode_net_disabled' }>,
): Promise<void> {
  await postMessageWithContext(
    hctx.ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    '`!mode=net` is disabled in Phase 1. Use `!mode=readonly` or `!mode=write`.',
  );
}

export async function handleModeChange(
  hctx: HandlerContext,
  command: Extract<CommandType, { kind: 'mode_change' }>,
): Promise<void> {
  const active = getActiveSessionRef(hctx.ctx, hctx.threadKey, hctx.userId);
  if (!active) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'No active session. Select one first with `!gemini`, `!claude`, or `!codex`.',
    );
    return;
  }

  if (command.mode === 'readonly') {
    if (active.session.mode !== 'readonly') {
      hctx.ctx.auditStore.logModeChange({
        sessionKey: active.sessionKey,
        userId: hctx.userId,
        fromMode: active.session.mode,
        toMode: 'readonly',
        expiresAt: null,
      });
      hctx.ctx.sessionManager.updateMode(active.sessionKey, 'readonly', null);
    }
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'Mode set to readonly.',
      {
        sessionKey: active.sessionKey,
        tool: active.session.tool,
      },
    );
  } else {
    const code = generateChallengeCode();
    hctx.ctx.pendingConfirmations.set(
      hctx.threadKey,
      {
        kind: 'mode',
        mode: command.mode,
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
      `Write permission requested. To confirm, reply:\n\`!confirm ${code}\`\n(30 seconds to respond)`,
      { sessionKey: active.sessionKey, tool: active.session.tool },
    );
    scheduleExpiry(
      hctx.ctx.pendingConfirmations,
      hctx.threadKey,
      (p) => p.code === code,
      CHALLENGE_TIMEOUT_MS,
      'confirmation',
    );
  }
}

export async function handleConfirm(
  hctx: HandlerContext,
  command: Extract<CommandType, { kind: 'confirm' }>,
): Promise<void> {
  const pending = hctx.ctx.pendingConfirmations.get(hctx.threadKey);
  if (!pending) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'No pending confirmation.',
    );
    return;
  }

  const pendingSession = hctx.ctx.sessionManager.get(pending.sessionKey);
  const pendingTool = pendingSession?.tool ?? 'none';
  if (Date.now() > pending.expiresAt) {
    hctx.ctx.pendingConfirmations.delete(hctx.threadKey);
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'Confirmation expired. Please try again.',
      { sessionKey: pending.sessionKey, tool: pendingTool },
    );
    return;
  }

  if (command.code !== pending.code) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'Invalid confirmation code.',
      { sessionKey: pending.sessionKey, tool: pendingTool },
    );
    return;
  }

  hctx.ctx.pendingConfirmations.delete(hctx.threadKey);
  if (pending.kind === 'mode') {
    const session = hctx.ctx.sessionManager.get(pending.sessionKey);
    if (!session) {
      await postMessageWithContext(
        hctx.ctx,
        hctx.client,
        hctx.channelId,
        hctx.threadTs,
        'Cannot apply mode change: session no longer exists.',
      );
      return;
    }
    hctx.ctx.auditStore.logModeChange({
      sessionKey: pending.sessionKey,
      userId: hctx.userId,
      fromMode: session.mode,
      toMode: pending.mode,
      expiresAt: null,
    });
    hctx.ctx.sessionManager.updateMode(pending.sessionKey, pending.mode, null);

    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Mode set to \`${pending.mode}\`.`,
      { sessionKey: pending.sessionKey, tool: session.tool },
    );
  } else {
    const session = hctx.ctx.sessionManager.get(pending.sessionKey);
    if (!session) {
      await postMessageWithContext(
        hctx.ctx,
        hctx.client,
        hctx.channelId,
        hctx.threadTs,
        'Cannot apply workdir change: session no longer exists.',
      );
      return;
    }
    hctx.ctx.sessionManager.updateWorkdir(pending.sessionKey, pending.workdir);
    hctx.ctx.workdirManager.prepareWorkdirSkillsOnly(pending.workdir, session.tool);
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Workdir changed to: \`${pending.workdir}\``,
      { sessionKey: pending.sessionKey, tool: session.tool },
    );
  }
}
