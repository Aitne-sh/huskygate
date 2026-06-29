/** @module mcp-preflight-gemini — Gemini-specific MCP authentication preflight, OAuth flow, and switch-preflight logic */
import type { AppContext } from '../context/app-context.js';
import type { Job } from '../queue/types.js';
import { getDriverEnv } from '../runner/driver-factory.js';
import { prepareGeminiRuntimeHome } from '../runner/gemini-runtime-home.js';
import { Runner } from '../runner/runner.js';
import type { McpServerRecord } from '../store/mcp-server.js';
import { errorMessage } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import { postMessageWithContext } from './app-helpers.js';
import type { ChatClient } from './app-types.js';
import { createGeminiPreflightDriver, runUnifiedJobPreflight } from './mcp-preflight-driver.js';
import {
  createRetryJob,
  diffToolStatePatch,
  postRetryEnqueueMessages,
} from './mcp-preflight-utils.js';
import {
  type JobPreflightContext,
  type JobPreflightResult,
  type PostRunMcpAuthContext,
  checkSwitchPreflightNeeded,
  handleSwitchPreflightSuccess,
} from './mcp-preflight.js';
import {
  GEMINI_MCP_AUTH_APPROVAL_RERUN_KEY,
  GEMINI_MCP_AUTH_BYPASS_SERVER_KEY,
  formatGeminiMcpAuthOAuthUrlMessage,
  formatGeminiMcpAuthWaitingMessage,
  isGeminiMcpPreflightBypassed,
  isGeminiMcpPreflightInitialized,
  markGeminiMcpPreflightInitialized,
  markGeminiMcpPreflightVerified,
  runGeminiInteractiveMcpAuth,
  runGeminiMcpAuthPreflight,
} from './tools/gemini.js';

// ---------------------------------------------------------------------------
// Shared: prepare Gemini runtime home + merge GEMINI_CLI_HOME into env
// ---------------------------------------------------------------------------

async function applyGeminiRuntimeHome(
  baseEnv: Record<string, string>,
  workdir: string,
  authServer: string | null,
  servers: ReadonlyArray<McpServerRecord>,
  logMeta: Record<string, unknown>,
): Promise<Record<string, string>> {
  try {
    const runtimeHome = await prepareGeminiRuntimeHome(workdir, authServer, servers);
    const env = { ...baseEnv, GEMINI_CLI_HOME: runtimeHome.homeDir };
    if (
      runtimeHome.tokenAliasRepaired ||
      runtimeHome.tokenUrlNormalized ||
      runtimeHome.oauthDisabledForServer
    ) {
      logger.info('gemini_runtime_home_prepared', {
        ...logMeta,
        token_alias_repaired: runtimeHome.tokenAliasRepaired,
        token_url_normalized: runtimeHome.tokenUrlNormalized,
        oauth_disabled_for_server: runtimeHome.oauthDisabledForServer,
      });
    }
    return env;
  } catch (err) {
    logger.warn('gemini_runtime_home_prepare_failed', {
      ...logMeta,
      error: errorMessage(err),
    });
    return baseEnv;
  }
}

// ---------------------------------------------------------------------------
// Switch-preflight: Gemini
// ---------------------------------------------------------------------------

export async function runGeminiSwitchPreflight(
  ctx: AppContext,
  slackClient: ChatClient,
  _threadKey: string,
  channelId: string,
  threadTs: string,
  _userId: string,
  sessionKey: string,
): Promise<void> {
  const ready = checkSwitchPreflightNeeded(
    ctx,
    sessionKey,
    ctx.config.geminiMcpAuthServer,
    (ts, s) => isGeminiMcpPreflightBypassed(ts, s),
  );
  if (!ready) return;
  const { authServer, session, selectedMcpServers } = ready;
  if (!isGeminiMcpPreflightInitialized(session.toolState, authServer)) {
    ctx.workdirManager.prepareWorkdirSkillsOnly(session.workdir, 'gemini');
    await postMessageWithContext(
      ctx,
      slackClient,
      channelId,
      threadTs,
      `Initializing MCP auth for \`${authServer}\`...`,
      { sessionKey, tool: 'gemini' },
    );

    const preflightEnv = await applyGeminiRuntimeHome(
      getDriverEnv('gemini'),
      session.workdir,
      authServer,
      selectedMcpServers,
      { session_key: sessionKey, workdir: session.workdir, auth_server: authServer },
    );

    const preflightRunner = new Runner(ctx.config);
    const preflight = await runGeminiMcpAuthPreflight(
      preflightRunner,
      preflightEnv,
      session.workdir,
      authServer,
    );

    if (preflight.ok) {
      await handleSwitchPreflightSuccess(
        ctx,
        slackClient,
        channelId,
        threadTs,
        sessionKey,
        'gemini',
        {
          gemini_mcp_auth_initialized_server: authServer,
          gemini_mcp_auth_verified_server: authServer,
        },
        `MCP auth for \`${authServer}\` ready.`,
      );
      return;
    }

    // Fast preflight failed — try interactive auth if this looks like an OAuth issue.
    const shouldTryInteractive =
      preflight.oauthFlowStarted ||
      preflight.interactiveFailure ||
      preflight.requiredServer !== null;

    if (shouldTryInteractive) {
      logger.info('gemini_switch_preflight_interactive_attempt', {
        session_key: sessionKey,
        server: authServer,
        oauth_flow_started: preflight.oauthFlowStarted,
        interactive_failure: preflight.interactiveFailure,
        required_server: preflight.requiredServer,
      });

      const interactiveRunner = new Runner({
        ...ctx.config,
        noOutputTimeoutSec: 120,
      });
      const interactive = await runGeminiInteractiveMcpAuth(
        interactiveRunner,
        preflightEnv,
        session.workdir,
        authServer,
        (url) => {
          // Fire-and-forget: post OAuth URL + waiting message to Slack
          postMessageWithContext(
            ctx,
            slackClient,
            channelId,
            threadTs,
            formatGeminiMcpAuthOAuthUrlMessage(authServer, url),
            { sessionKey, tool: 'gemini' },
          ).catch((err) => {
            logger.error('gemini_switch_preflight_oauth_url_post_failed', {
              session_key: sessionKey,
              server: authServer,
              error: errorMessage(err),
            });
          });
          postMessageWithContext(
            ctx,
            slackClient,
            channelId,
            threadTs,
            formatGeminiMcpAuthWaitingMessage(authServer),
            { sessionKey, tool: 'gemini' },
          ).catch((err) => {
            logger.error('gemini_switch_preflight_waiting_post_failed', {
              session_key: sessionKey,
              server: authServer,
              error: errorMessage(err),
            });
          });
        },
      );

      if (interactive.ok) {
        await handleSwitchPreflightSuccess(
          ctx,
          slackClient,
          channelId,
          threadTs,
          sessionKey,
          'gemini',
          {
            gemini_mcp_auth_initialized_server: authServer,
            gemini_mcp_auth_verified_server: authServer,
          },
          `MCP auth for \`${authServer}\` ready.`,
        );
        return;
      }

      // Interactive auth also failed — fall through to auto-bypass
      logger.warn('gemini_switch_preflight_interactive_failed', {
        session_key: sessionKey,
        server: authServer,
        exit_code: interactive.exitCode,
        error_kind: interactive.errorKind,
        oauth_url: interactive.oauthUrl,
      });
    }

    // Auto-bypass: skip job preflight so the user can proceed immediately.
    // MCP tools may still fail at runtime if local auth is incomplete.
    ctx.sessionManager.mergeToolState(sessionKey, {
      [GEMINI_MCP_AUTH_BYPASS_SERVER_KEY]: authServer,
    });

    logger.warn('gemini_switch_preflight_auto_bypass', {
      session_key: sessionKey,
      server: authServer,
      exit_code: preflight.exitCode,
      error_kind: preflight.errorKind,
      interactive_failure: preflight.interactiveFailure,
    });
    await postMessageWithContext(
      ctx,
      slackClient,
      channelId,
      threadTs,
      `MCP auth for \`${authServer}\` initialized.`,
      { sessionKey, tool: 'gemini' },
    );
  }
}

// ---------------------------------------------------------------------------
// Job runtime preparation: Gemini
// ---------------------------------------------------------------------------

/**
 * Prepares Gemini runtime home directory for job execution.
 * Called from job executor before preflight and main run.
 */
export async function prepareGeminiJobRuntime(
  ctx: AppContext,
  job: Job,
  baseEnv: Record<string, string>,
  servers?: ReadonlyArray<McpServerRecord>,
  authServer?: string | null,
): Promise<Record<string, string>> {
  const resolvedAuthServer = authServer !== undefined ? authServer : ctx.config.geminiMcpAuthServer;
  const resolvedServers =
    servers ??
    ((job.executionPolicy?.allowMcp ?? true) ? ctx.mcpServerStore.listByTool('gemini') : []);
  return applyGeminiRuntimeHome(baseEnv, job.workdir, resolvedAuthServer, resolvedServers, {
    session_key: job.sessionKey,
    job_id: job.id,
    workdir: job.workdir,
    auth_server: resolvedAuthServer,
  });
}

// ---------------------------------------------------------------------------
// Job preflight: Gemini
// ---------------------------------------------------------------------------

/**
 * Run Gemini MCP auth preflight in job executor context.
 */
export async function runGeminiJobPreflight(
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
    createGeminiPreflightDriver(),
  );
}

// ---------------------------------------------------------------------------
// Post-run MCP auth recovery: Gemini
// ---------------------------------------------------------------------------

export async function handleGeminiPostRunMcpAuth(
  ctx: AppContext,
  prc: PostRunMcpAuthContext,
  isApprovalRerun: boolean,
): Promise<void> {
  const { job, mcpAuthRequiredServer } = prc;
  const authServer = mcpAuthRequiredServer ?? ctx.config.geminiMcpAuthServer ?? 'aws-api';

  // Prevent infinite retry loops: if this is already an auto-retry, just show a brief message.
  if (isApprovalRerun) {
    logger.warn('gemini_post_run_auth_loop_prevented', {
      session_key: job.sessionKey,
      server: authServer,
    });
    await postMessageWithContext(
      ctx,
      ctx.webClient,
      job.channelId,
      job.threadTs,
      `MCP auth for \`${authServer}\` could not be completed automatically. Run \`gemini -i "/mcp auth ${authServer}"\` locally, then retry.`,
      { sessionKey: job.sessionKey, tool: job.tool },
    );
    return;
  }

  // Auto-attempt MCP auth with interactive OAuth URL capture.
  let geminiEnv = getDriverEnv('gemini');
  try {
    const runtimeHome = await prepareGeminiRuntimeHome(
      job.workdir,
      authServer,
      prc.selectedMcpServers,
    );
    geminiEnv = { ...geminiEnv, GEMINI_CLI_HOME: runtimeHome.homeDir };
  } catch (err) {
    logger.warn('gemini_post_run_auth_runtime_home_failed', {
      session_key: job.sessionKey,
      server: authServer,
      error: errorMessage(err),
    });
  }

  const interactiveRunner = new Runner({
    ...ctx.config,
    noOutputTimeoutSec: 120,
  });
  const preflight = await runGeminiInteractiveMcpAuth(
    interactiveRunner,
    geminiEnv,
    job.workdir,
    authServer,
    (url) => {
      // Fire-and-forget: post OAuth URL + waiting message to Slack
      postMessageWithContext(
        ctx,
        ctx.webClient,
        job.channelId,
        job.threadTs,
        formatGeminiMcpAuthOAuthUrlMessage(authServer, url),
        { sessionKey: job.sessionKey, tool: job.tool },
      ).catch((err) => {
        logger.error('gemini_post_run_oauth_url_post_failed', {
          session_key: job.sessionKey,
          server: authServer,
          error: errorMessage(err),
        });
      });
      postMessageWithContext(
        ctx,
        ctx.webClient,
        job.channelId,
        job.threadTs,
        formatGeminiMcpAuthWaitingMessage(authServer),
        { sessionKey: job.sessionKey, tool: job.tool },
      ).catch((err) => {
        logger.error('gemini_post_run_waiting_post_failed', {
          session_key: job.sessionKey,
          server: authServer,
          error: errorMessage(err),
        });
      });
    },
  );

  if (preflight.ok) {
    // Auth succeeded — update session state and auto-retry.
    const existing = ctx.sessionManager.get(job.sessionKey);
    if (existing) {
      const marked = markGeminiMcpPreflightInitialized(existing.toolState, authServer);
      const nextToolState = markGeminiMcpPreflightVerified(marked, authServer);
      ctx.sessionManager.mergeToolState(
        job.sessionKey,
        diffToolStatePatch(existing.toolState, nextToolState),
      );
    }

    const retryJob = createRetryJob(job, {
      gemini_skip_mcp_preflight_once: true,
      [GEMINI_MCP_AUTH_APPROVAL_RERUN_KEY]: true,
    });
    const enqueueResult = ctx.jobQueue.enqueue(retryJob);
    await postRetryEnqueueMessages(ctx, job, authServer, 'Gemini', enqueueResult);
    return;
  }

  // Auth failed — show a brief message (no approval prompt).
  logger.warn('gemini_post_run_auto_auth_failed', {
    session_key: job.sessionKey,
    server: authServer,
    exit_code: preflight.exitCode,
    error_kind: preflight.errorKind,
  });
  await postMessageWithContext(
    ctx,
    ctx.webClient,
    job.channelId,
    job.threadTs,
    `MCP auth for \`${authServer}\` could not be completed automatically. Run \`gemini -i "/mcp auth ${authServer}"\` locally, then retry.`,
    { sessionKey: job.sessionKey, tool: job.tool },
  );
}
