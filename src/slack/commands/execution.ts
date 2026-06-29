/** @module commands/execution — Exit, stop, status, and reset handlers */
import { getDefaultModelForTool, postMessageWithContext } from '../app-helpers.js';
import type { HandlerContext } from '../handler-context.js';
import { getActiveSessionRef } from '../handler-context.js';
import type { CommandType } from '../parser.js';
import { CLAUDE_MCP_AUTH_BYPASS_SERVER_KEY } from '../tools/claude.js';
import { GEMINI_MCP_AUTH_BYPASS_SERVER_KEY } from '../tools/gemini.js';

export async function handleExit(
  hctx: HandlerContext,
  _command: Extract<CommandType, { kind: 'exit' }>,
): Promise<void> {
  const active = getActiveSessionRef(hctx.ctx, hctx.threadKey, hctx.userId);
  if (active) {
    const activeRunner = hctx.ctx.activeRunners.get(active.sessionKey);
    if (activeRunner?.runner.isRunning()) {
      activeRunner.runner.kill('user_exit');
      hctx.ctx.jobQueue.cancelSession(active.sessionKey);
    }
    if (active.session.tool === 'claude') {
      hctx.ctx.sessionManager.updateToolState(active.sessionKey, {
        ...active.session.toolState,
        claude_mcp_auth_approval_completed: undefined,
        [CLAUDE_MCP_AUTH_BYPASS_SERVER_KEY]: undefined,
      });
    } else if (active.session.tool === 'gemini') {
      hctx.ctx.sessionManager.updateToolState(active.sessionKey, {
        ...active.session.toolState,
        [GEMINI_MCP_AUTH_BYPASS_SERVER_KEY]: undefined,
      });
    }
    hctx.ctx.sessionManager.clearActiveSession(hctx.threadKey);
  }
  hctx.ctx.pendingConfirmations.delete(hctx.threadKey);
  hctx.ctx.pendingToolApprovals.delete(hctx.threadKey);
  hctx.ctx.pendingMcpAuthBypassApprovals.delete(hctx.threadKey);
  await postMessageWithContext(
    hctx.ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    'Exited current session.',
    {
      sessionKey: active?.sessionKey,
      tool: active?.session.tool,
    },
  );
}

export async function handleStop(
  hctx: HandlerContext,
  _command: Extract<CommandType, { kind: 'stop' }>,
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
  const activeRunner = hctx.ctx.activeRunners.get(active.sessionKey);
  if (activeRunner?.runner.isRunning()) {
    activeRunner.runner.kill('user_stop');
    hctx.ctx.jobQueue.cancelSession(active.sessionKey);
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'Stopping current job...',
      {
        sessionKey: active.sessionKey,
        tool: active.session.tool,
      },
    );
  } else {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'No running job to stop.',
      {
        sessionKey: active.sessionKey,
        tool: active.session.tool,
      },
    );
  }
}

export async function handleStatus(
  hctx: HandlerContext,
  _command: Extract<CommandType, { kind: 'status' }>,
): Promise<void> {
  const active = getActiveSessionRef(hctx.ctx, hctx.threadKey, hctx.userId);
  const queueStatus = hctx.ctx.jobQueue.getStatus();
  const runningJob = active ? hctx.ctx.jobQueue.getRunningJob(active.sessionKey) : undefined;

  let modelDisplay = 'Model: n/a';
  if (active) {
    const sessionModel =
      typeof active.session.toolState.model === 'string' && active.session.toolState.model.trim()
        ? active.session.toolState.model.trim()
        : null;
    const envModel = getDefaultModelForTool(hctx.ctx.config, active.session.tool);
    modelDisplay = sessionModel
      ? `Model: ${sessionModel} (session)`
      : envModel
        ? `Model: ${envModel} (env)`
        : 'Model: default';
  }

  const lines = [
    `Active session: ${active ? active.session.tool : 'none'}`,
    active ? `Workdir: ${active.session.workdir}` : 'Workdir: n/a',
    active
      ? `Mode: ${active.session.mode}${active.session.modeExpiresAt ? ` (expires: ${active.session.modeExpiresAt})` : ''}`
      : 'Mode: n/a',
    modelDisplay,
    runningJob
      ? `Running: ${runningJob.id} (elapsed: ${Math.round((Date.now() - runningJob.createdAt) / 1000)}s)`
      : 'Running: none',
    `Queue: ${queueStatus.pending} pending`,
  ];

  await postMessageWithContext(
    hctx.ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    lines.join('\n'),
    {
      sessionKey: active?.sessionKey,
      tool: active?.session.tool ?? 'none',
    },
  );
}

export async function handleReset(
  hctx: HandlerContext,
  _command: Extract<CommandType, { kind: 'reset' }>,
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
  const activeRunner = hctx.ctx.activeRunners.get(active.sessionKey);
  if (activeRunner?.runner.isRunning()) {
    activeRunner.runner.kill('reset');
  }
  hctx.ctx.jobQueue.cancelSession(active.sessionKey);
  hctx.ctx.sessionManager.reset(active.sessionKey);
  hctx.ctx.pendingConfirmations.delete(hctx.threadKey);
  hctx.ctx.pendingToolApprovals.delete(hctx.threadKey);
  hctx.ctx.pendingMcpAuthBypassApprovals.delete(hctx.threadKey);

  await postMessageWithContext(
    hctx.ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    'Session reset.',
    {
      sessionKey: active.sessionKey,
      tool: active.session.tool,
    },
  );
}
