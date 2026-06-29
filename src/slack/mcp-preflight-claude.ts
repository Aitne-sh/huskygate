/** @module mcp-preflight-claude — Claude-specific MCP authentication preflight and switch-preflight logic */
import type { AppContext } from '../context/app-context.js';
import { getDriverEnv } from '../runner/driver-factory.js';
import { Runner } from '../runner/runner.js';
import { errorMessage } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import {
  removeClaudeGeneratedMcpConfig,
  writeClaudeMcpConfigToWorkdir,
} from '../workdir/mcp-writer.js';
import { MCP_AUTH_BYPASS_TIMEOUT_MS, postMessageWithContext } from './app-helpers.js';
import type { ChatClient } from './app-types.js';
import { createClaudePreflightDriver } from './mcp-preflight-driver.js';
import { runUnifiedJobPreflight } from './mcp-preflight-driver.js';
import {
  createRetryJob,
  diffToolStatePatch,
  postRetryEnqueueMessages,
  registerMcpAuthApproval,
} from './mcp-preflight-utils.js';
import {
  type JobPreflightContext,
  type JobPreflightResult,
  type PostRunMcpAuthContext,
  checkSwitchPreflightNeeded,
  handleSwitchPreflightSuccess,
} from './mcp-preflight.js';
import {
  CLAUDE_MCP_AUTH_VERIFIED_SERVER_KEY,
  formatClaudeMcpApprovalPrompt,
  formatClaudeMcpAuthGenericFailureMessage,
  formatClaudeMcpAuthRequiredMessage,
  isClaudeMcpPreflightBypassed,
  isClaudeMcpPreflightVerified,
  markClaudeMcpPreflightVerified,
  runClaudeMcpAuthPreflight,
} from './tools/claude.js';

function cleanupClaudeGeneratedMcpConfig(filePath: string, context: Record<string, unknown>): void {
  try {
    removeClaudeGeneratedMcpConfig(filePath);
  } catch (err) {
    logger.warn('claude_generated_mcp_cleanup_failed', {
      ...context,
      path: filePath,
      error: errorMessage(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Claude switch-preflight
// ---------------------------------------------------------------------------

export async function runClaudeSwitchPreflight(
  ctx: AppContext,
  slackClient: ChatClient,
  threadKey: string,
  channelId: string,
  threadTs: string,
  userId: string,
  sessionKey: string,
): Promise<void> {
  const ready = checkSwitchPreflightNeeded(
    ctx,
    sessionKey,
    ctx.config.claudeMcpAuthServer,
    (ts, s) => isClaudeMcpPreflightBypassed(ts, s) || isClaudeMcpPreflightVerified(ts, s),
  );
  if (!ready) return;
  const { authServer, session, selectedMcpServers } = ready;

  ctx.workdirManager.prepareWorkdirSkillsOnly(session.workdir, 'claude');
  let mcpConfigPath: string;
  try {
    mcpConfigPath = writeClaudeMcpConfigToWorkdir(session.workdir, selectedMcpServers);
  } catch (err) {
    await postMessageWithContext(
      ctx,
      slackClient,
      channelId,
      threadTs,
      `*Error:* Failed to prepare Claude MCP config: ${errorMessage(err)}`,
      { sessionKey, tool: 'claude' },
    );
    return;
  }
  await postMessageWithContext(
    ctx,
    slackClient,
    channelId,
    threadTs,
    `Initializing Claude MCP connection for \`${authServer}\`...\nRunning authentication check.`,
    { sessionKey, tool: 'claude' },
  );

  try {
    const preflightRunner = new Runner(ctx.config);
    const preflightEnv = getDriverEnv('claude');
    const preflight = await runClaudeMcpAuthPreflight(
      preflightRunner,
      preflightEnv,
      session.workdir,
      authServer,
      { mcpConfigPath },
    );

    if (preflight.ok) {
      await handleSwitchPreflightSuccess(
        ctx,
        slackClient,
        channelId,
        threadTs,
        sessionKey,
        'claude',
        { [CLAUDE_MCP_AUTH_VERIFIED_SERVER_KEY]: authServer },
        `Claude MCP auth for \`${authServer}\` succeeded. Ready to use.`,
      );
    } else if (
      preflight.requiredServer ||
      preflight.interactiveFailure ||
      preflight.tokenRefreshFailed
    ) {
      const errorText = preflight.requiredServer
        ? formatClaudeMcpAuthRequiredMessage(preflight.requiredServer)
        : formatClaudeMcpAuthRequiredMessage(authServer);
      await postMessageWithContext(ctx, slackClient, channelId, threadTs, `*Error:* ${errorText}`, {
        sessionKey,
        tool: 'claude',
      });
      const pending = registerMcpAuthApproval(ctx, threadKey, {
        sessionKey,
        tool: 'claude',
        server: authServer,
        action: 'retry_with_preauth',
        prompt: null,
        userId,
      });
      await postMessageWithContext(
        ctx,
        slackClient,
        channelId,
        threadTs,
        pending
          ? formatClaudeMcpApprovalPrompt(pending, Math.round(MCP_AUTH_BYPASS_TIMEOUT_MS / 1000))
          : 'Claude MCP auth approval request failed to initialize.',
        { sessionKey, tool: 'claude' },
      );
    } else {
      await postMessageWithContext(
        ctx,
        slackClient,
        channelId,
        threadTs,
        `*Error:* ${formatClaudeMcpAuthGenericFailureMessage(authServer, preflight.exitCode, preflight.errorKind)}`,
        { sessionKey, tool: 'claude' },
      );
    }
  } finally {
    cleanupClaudeGeneratedMcpConfig(mcpConfigPath, {
      phase: 'switch_preflight',
      sessionKey,
      workdir: session.workdir,
    });
  }
}

// ---------------------------------------------------------------------------
// Claude job-executor preflight
// ---------------------------------------------------------------------------

export async function runClaudeJobPreflight(
  ctx: AppContext,
  jpc: JobPreflightContext,
  threadKey: string,
  isApprovalRerun: boolean,
): Promise<JobPreflightResult> {
  return runUnifiedJobPreflight(
    ctx,
    jpc,
    threadKey,
    isApprovalRerun,
    createClaudePreflightDriver(),
  );
}

// ---------------------------------------------------------------------------
// Claude post-run MCP auth recovery
// ---------------------------------------------------------------------------

export async function handleClaudePostRunMcpAuth(
  ctx: AppContext,
  prc: PostRunMcpAuthContext,
  isAutoAuthRerun: boolean,
): Promise<{ autoRerunScheduled: boolean; autoAuthFailureReported: boolean }> {
  let autoRerunScheduled = false;
  let autoAuthFailureReported = false;
  const { job, mcpAuthRequiredServer } = prc;
  const authServer = mcpAuthRequiredServer ?? ctx.config.claudeMcpAuthServer ?? 'aws-api';

  if (!isAutoAuthRerun) {
    logger.info('claude_mcp_auto_auth_started', {
      job_id: job.id,
      session_key: job.sessionKey,
      server: authServer,
    });
    await postMessageWithContext(
      ctx,
      ctx.webClient,
      job.channelId,
      job.threadTs,
      `Claude MCP auth expired. Re-authenticating \`${authServer}\`...`,
      { sessionKey: job.sessionKey, tool: job.tool },
    );

    const preflightRunner = new Runner(ctx.config);
    const preflightEnv = getDriverEnv('claude');
    const mcpConfigPath = writeClaudeMcpConfigToWorkdir(job.workdir, prc.selectedMcpServers);
    try {
      const preflight = await runClaudeMcpAuthPreflight(
        preflightRunner,
        preflightEnv,
        job.workdir,
        authServer,
        { mcpConfigPath },
      );

      if (preflight.ok) {
        const existing = ctx.sessionManager.get(job.sessionKey);
        if (existing) {
          const nextToolState = markClaudeMcpPreflightVerified(existing.toolState, authServer);
          ctx.sessionManager.mergeToolState(
            job.sessionKey,
            diffToolStatePatch(existing.toolState, nextToolState),
          );
        }
        const retryJob = createRetryJob(job, {
          claude_mcp_auth_auto_rerun: true,
          claude_skip_mcp_preflight_once: true,
        });
        const enqueueResult = ctx.jobQueue.enqueue(retryJob);
        await postRetryEnqueueMessages(ctx, job, authServer, 'Claude', enqueueResult);
        autoRerunScheduled = true;
      } else {
        autoAuthFailureReported = true;
        const failure = formatClaudeMcpAuthGenericFailureMessage(
          authServer,
          preflight.exitCode,
          preflight.errorKind,
        );
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          job.channelId,
          job.threadTs,
          `*Error:* ${failure}`,
          { sessionKey: job.sessionKey, tool: job.tool },
        );
      }
    } finally {
      cleanupClaudeGeneratedMcpConfig(mcpConfigPath, {
        phase: 'post_run_auth',
        jobId: job.id,
        sessionKey: job.sessionKey,
        workdir: job.workdir,
      });
    }
  }

  if (!autoRerunScheduled && !autoAuthFailureReported) {
    await postMessageWithContext(
      ctx,
      ctx.webClient,
      job.channelId,
      job.threadTs,
      formatClaudeMcpAuthRequiredMessage(authServer),
      { sessionKey: job.sessionKey, tool: job.tool },
    );
  }
  return { autoRerunScheduled, autoAuthFailureReported };
}
