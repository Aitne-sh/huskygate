/** @module commands/prompt — Prompt and autorun handlers */
import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolveInstruction } from '../../instructions/builder.js';
import { getInstructionFilePath } from '../../orchestrator/engine-utils.js';
import type { Job } from '../../queue/types.js';
import { sanitizeStickyApprovalState } from '../../shared/approval.js';
import { buildFileReferenceBlock, downloadFiles } from '../../shared/file-attachment.js';
import { errorMessage } from '../../utils/error.js';
import { logger } from '../../utils/logger.js';
import { postMessageWithBlocks, postMessageWithContext } from '../app-helpers.js';
import { buildMenuNoSessionBlocks } from '../block-kit.js';
import type { HandlerContext } from '../handler-context.js';
import { getActiveSessionRef } from '../handler-context.js';
import type { CommandType } from '../parser.js';

export async function handlePrompt(
  hctx: HandlerContext,
  command: Extract<CommandType, { kind: 'prompt' }>,
): Promise<void> {
  const active = getActiveSessionRef(hctx.ctx, hctx.threadKey, hctx.userId);
  let targetSessionKey: string | null = active?.sessionKey ?? null;
  let targetSession = active?.session ?? null;

  if (command.tool) {
    if (active && active.session.tool !== command.tool) {
      await postMessageWithContext(
        hctx.ctx,
        hctx.client,
        hctx.channelId,
        hctx.threadTs,
        `Cannot run \`${command.tool}\` while \`${active.session.tool}\` is active. Run \`!exit\` first.`,
        { sessionKey: active.sessionKey, tool: active.session.tool },
      );
      return;
    }

    if (!targetSession) {
      const latest = hctx.ctx.sessionManager.findLatestSessionByToolOwned(
        hctx.threadKey,
        hctx.userId,
        command.tool,
      );
      if (latest) {
        targetSession = latest;
        targetSessionKey = latest.sessionKey;
        hctx.ctx.sessionManager.setActiveSessionKey(hctx.threadKey, latest.sessionKey);
      } else {
        const created = hctx.ctx.sessionManager.createSessionForThread(
          hctx.threadKey,
          hctx.userId,
          command.tool,
        );
        targetSession = created;
        targetSessionKey = created.sessionKey;
      }
    }
  } else if (!targetSession) {
    // Auto-show dashboard when no active session (Method A)
    const sessions = hctx.ctx.sessionManager.listSessionsForThreadOwned(
      hctx.threadKey,
      hctx.userId,
    );
    const devAliases = hctx.ctx.devAliasStore.list();
    const blocks = buildMenuNoSessionBlocks(sessions, hctx.threadKey, devAliases);
    await postMessageWithBlocks(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      blocks,
      'No active session. Select a tool to get started.',
    );
    return;
  }

  if (!targetSession || !targetSessionKey) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'Session resolution failed.',
    );
    return;
  }

  const sanitizedState = sanitizeStickyApprovalState(targetSession.toolState);
  if (sanitizedState.changed) {
    hctx.ctx.sessionManager.updateToolState(targetSessionKey, sanitizedState.toolState);
    targetSession.toolState = sanitizedState.toolState;
  }

  if (targetSession.devAlias) {
    hctx.ctx.workdirManager.prepareDevWorkdir(targetSession.workdir);
  } else {
    hctx.ctx.workdirManager.prepareWorkdirSkillsOnly(targetSession.workdir, targetSession.tool);
  }

  // --- File attachment handling ---
  const jobId = crypto.randomUUID();
  let finalPrompt = command.prompt;

  if (hctx.slackFiles && hctx.slackFiles.length > 0) {
    try {
      const result = await downloadFiles(
        hctx.slackFiles,
        targetSession.workdir,
        jobId,
        hctx.ctx.config.slack.botToken,
      );

      if (result.errors.length > 0) {
        const warningLines = result.errors.map(
          (e) => `- ${e.fileName}: ${e.userReason ?? e.reason}`,
        );
        await postMessageWithContext(
          hctx.ctx,
          hctx.client,
          hctx.channelId,
          hctx.threadTs,
          `Some files could not be attached:\n${warningLines.join('\n')}`,
          { sessionKey: targetSessionKey, tool: targetSession.tool },
        );
      }

      if (result.downloaded.length > 0) {
        finalPrompt = command.prompt + buildFileReferenceBlock(result.downloaded);
      }
    } catch (err) {
      logger.warn('file_attachment_failed', {
        error: errorMessage(err),
      });
    }
  }

  const promptJob: Job = {
    id: jobId,
    sessionKey: targetSessionKey,
    channelId: hctx.channelId,
    threadTs: hctx.threadTs,
    userId: hctx.userId,
    tool: targetSession.tool,
    mode: targetSession.mode,
    prompt: finalPrompt,
    workdir: targetSession.workdir,
    toolState: targetSession.toolState,
    createdAt: Date.now(),
    source: 'slack' as const,
  };

  const enqueueResult = hctx.ctx.jobQueue.enqueue(promptJob);

  if ('error' in enqueueResult) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      enqueueResult.error,
      {
        sessionKey: targetSessionKey,
        tool: targetSession.tool,
      },
    );
  } else if (enqueueResult.position > 0) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Queued (position: ${enqueueResult.position}).`,
      { sessionKey: targetSessionKey, tool: targetSession.tool },
    );
  }
}

// ---------------------------------------------------------------------------
export async function handleAutorun(
  hctx: HandlerContext,
  command: Extract<CommandType, { kind: 'autorun' }>,
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

  // P1: readonly mode → auto-approve must never be enabled
  if (active.session.mode === 'readonly') {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'Auto-approve is not available in readonly mode. Switch to write mode first with `!mode write`.',
      { sessionKey: active.sessionKey, tool: active.session.tool },
    );
    return;
  }

  const currentValue = active.session.toolState.auto_approve === true;
  const newValue = command.enabled ?? !currentValue; // toggle if no explicit value

  hctx.ctx.sessionManager.updateToolState(active.sessionKey, {
    ...active.session.toolState,
    auto_approve: newValue,
  });

  // Rebuild instruction file to match the new policy
  const instruction = resolveInstruction(
    { tool: active.session.tool, source: 'chat', autoApprove: newValue, allowMcp: true },
    null,
    hctx.ctx.defaultInstructionStore.getWithEnabled(active.session.tool),
  );
  writeFileSync(
    getInstructionFilePath(active.session.workdir, active.session.tool),
    instruction,
    'utf-8',
  );

  const statusText = newValue
    ? 'Auto-approve mode *enabled*. MCP tools will execute without approval prompts.'
    : 'Auto-approve mode *disabled*. MCP tools will require `!y` approval.';

  await postMessageWithContext(hctx.ctx, hctx.client, hctx.channelId, hctx.threadTs, statusText, {
    sessionKey: active.sessionKey,
    tool: active.session.tool,
  });
}
