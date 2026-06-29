/** @module mcp-preflight-codex — Codex-specific MCP authentication preflight and switch-preflight logic */
import type { AppContext } from '../context/app-context.js';
import { prepareCodexRuntimeHome } from '../runner/codex-runtime-home.js';
import { getDriverEnv } from '../runner/driver-factory.js';
import { Runner } from '../runner/runner.js';
import { errorMessage } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import { postMessageWithContext } from './app-helpers.js';
import type { ChatClient } from './app-types.js';
import { createCodexPreflightDriver, runUnifiedJobPreflight } from './mcp-preflight-driver.js';
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
  CODEX_MCP_AUTH_VERIFIED_SERVER_KEY,
  formatCodexMcpAuthGenericFailureMessage,
  formatCodexMcpAuthRequiredMessage,
  isCodexMcpPreflightVerified,
  isCodexMcpServerAuthUnsupported,
  markCodexMcpPreflightVerified,
  runCodexMcpAuthPreflight,
  runCodexMcpList,
  selectCodexMcpAuthServer,
} from './tools/codex.js';

// ---------------------------------------------------------------------------
// Switch-preflight: Codex
// ---------------------------------------------------------------------------

async function applyCodexRuntimeHome(
  baseEnv: Record<string, string>,
  workdir: string,
  servers: ReadonlyArray<import('../store/mcp-server.js').McpServerRecord>,
  logMeta: Record<string, unknown>,
): Promise<Record<string, string>> {
  try {
    const runtimeHome = await prepareCodexRuntimeHome(workdir, servers);
    return { ...baseEnv, CODEX_HOME: runtimeHome.homeDir };
  } catch (err) {
    logger.warn('codex_runtime_home_prepare_failed', {
      ...logMeta,
      error: errorMessage(err),
    });
    return baseEnv;
  }
}

export async function runCodexSwitchPreflight(
  ctx: AppContext,
  slackClient: ChatClient,
  channelId: string,
  threadTs: string,
  sessionKey: string,
): Promise<void> {
  const ready = checkSwitchPreflightNeeded(
    ctx,
    sessionKey,
    ctx.config.codexMcpAuthServer,
    (ts, s) => isCodexMcpPreflightVerified(ts, s),
  );
  if (!ready) return;
  const { authServer, session, selectedMcpServers } = ready;

  ctx.workdirManager.prepareWorkdirSkillsOnly(session.workdir, 'codex');
  await postMessageWithContext(
    ctx,
    slackClient,
    channelId,
    threadTs,
    `Checking MCP auth for \`${authServer}\`...`,
    { sessionKey, tool: 'codex' },
  );

  const preflightRunner = new Runner(ctx.config);
  const preflightEnv = await applyCodexRuntimeHome(
    getDriverEnv('codex'),
    session.workdir,
    selectedMcpServers,
    {
      session_key: sessionKey,
      workdir: session.workdir,
      auth_server: authServer,
    },
  );
  const preflight = await runCodexMcpAuthPreflight(
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
      'codex',
      { [CODEX_MCP_AUTH_VERIFIED_SERVER_KEY]: authServer },
      `Codex MCP auth check for \`${authServer}\` completed for this session.`,
    );
    return;
  }

  const failureMessage =
    preflight.requiredServer || preflight.requiredResourceUrl
      ? formatCodexMcpAuthRequiredMessage(
          preflight.requiredServer ?? authServer,
          preflight.requiredResourceUrl,
        )
      : formatCodexMcpAuthGenericFailureMessage(
          authServer,
          preflight.exitCode,
          preflight.errorKind,
        );
  await postMessageWithContext(
    ctx,
    slackClient,
    channelId,
    threadTs,
    `*Error:* ${failureMessage}`,
    {
      sessionKey,
      tool: 'codex',
    },
  );
}

// ---------------------------------------------------------------------------
// Job-executor preflight: Codex
// ---------------------------------------------------------------------------

export async function runCodexJobPreflight(
  ctx: AppContext,
  jpc: JobPreflightContext,
  _threadKey: string,
): Promise<JobPreflightResult> {
  return runUnifiedJobPreflight(ctx, jpc, _threadKey, false, createCodexPreflightDriver());
}

// ---------------------------------------------------------------------------
// Post-run MCP auth recovery: Codex
// ---------------------------------------------------------------------------

export async function handleCodexPostRunMcpAuth(
  ctx: AppContext,
  prc: PostRunMcpAuthContext,
  isAutoAuthRerun: boolean,
): Promise<{ autoRerunScheduled: boolean; autoAuthFailureReported: boolean }> {
  let autoRerunScheduled = false;
  let autoAuthFailureReported = false;
  const { job, mcpAuthRequiredServer, mcpAuthRequiredResourceUrl } = prc;
  const codexEnv = await applyCodexRuntimeHome(
    getDriverEnv('codex'),
    job.workdir,
    prc.selectedMcpServers,
    {
      session_key: job.sessionKey,
      workdir: job.workdir,
      auth_server: mcpAuthRequiredServer ?? ctx.config.codexMcpAuthServer,
    },
  );
  const preferredServer = mcpAuthRequiredServer ?? ctx.config.codexMcpAuthServer;

  if (!isAutoAuthRerun) {
    const listRunner = new Runner(ctx.config);
    const listResult = await runCodexMcpList(listRunner, codexEnv, job.workdir);
    let selectedServer = selectCodexMcpAuthServer(listResult, preferredServer);
    if (!selectedServer) {
      const discovered =
        listResult.serverNames.length > 0 ? listResult.serverNames.join(', ') : 'none';
      autoAuthFailureReported = true;
      await postMessageWithContext(
        ctx,
        ctx.webClient,
        job.channelId,
        job.threadTs,
        `*Error:* Codex MCP auto-auth could not determine a single server from \`codex mcp list\` (discovered: ${discovered}). Configure \`CODEX_MCP_AUTH_SERVER\` explicitly (for example \`aws-api\`) and retry.`,
        { sessionKey: job.sessionKey, tool: job.tool },
      );
    }
    if (selectedServer && isCodexMcpServerAuthUnsupported(listResult, selectedServer)) {
      autoAuthFailureReported = true;
      await postMessageWithContext(
        ctx,
        ctx.webClient,
        job.channelId,
        job.threadTs,
        `*Error:* Codex MCP server \`${selectedServer}\` reports \`Auth=Unsupported\` in \`codex mcp list\`. OAuth login is not supported in this configuration. Configure MCP server auth via bearer token (for example \`bearer_token_env_var\`) or use another execution path.`,
        { sessionKey: job.sessionKey, tool: job.tool },
      );
      selectedServer = null;
    }

    if (selectedServer) {
      const preflightRunner = new Runner(ctx.config);
      const preflight = await runCodexMcpAuthPreflight(
        preflightRunner,
        codexEnv,
        job.workdir,
        selectedServer,
      );
      if (preflight.ok) {
        const existing = ctx.sessionManager.get(job.sessionKey);
        if (existing) {
          const nextToolState = markCodexMcpPreflightVerified(existing.toolState, selectedServer);
          ctx.sessionManager.mergeToolState(
            job.sessionKey,
            diffToolStatePatch(existing.toolState, nextToolState),
          );
        }
        const retryJob = createRetryJob(job, { codex_mcp_auth_auto_rerun: true });
        const enqueueResult = ctx.jobQueue.enqueue(retryJob);
        await postRetryEnqueueMessages(ctx, job, selectedServer, 'Codex', enqueueResult);
        autoRerunScheduled = true;
      } else {
        autoAuthFailureReported = true;
        const latestError =
          preflight.events
            .filter((event) => event.type === 'error')
            .at(-1)
            ?.content.trim() ?? null;
        const failure = formatCodexMcpAuthGenericFailureMessage(
          selectedServer,
          preflight.exitCode,
          preflight.errorKind,
        );
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          job.channelId,
          job.threadTs,
          latestError ? `*Error:* ${failure}\nDetail: ${latestError}` : `*Error:* ${failure}`,
          { sessionKey: job.sessionKey, tool: job.tool },
        );
      }
    }
  }

  if (!autoRerunScheduled && !autoAuthFailureReported) {
    await postMessageWithContext(
      ctx,
      ctx.webClient,
      job.channelId,
      job.threadTs,
      formatCodexMcpAuthRequiredMessage(mcpAuthRequiredServer, mcpAuthRequiredResourceUrl),
      { sessionKey: job.sessionKey, tool: job.tool },
    );
  }
  return { autoRerunScheduled, autoAuthFailureReported };
}
