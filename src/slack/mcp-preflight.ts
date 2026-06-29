/** @module mcp-preflight — Coordinates driver-specific MCP preflight checks and switch-preflight orchestration */
import type { ToolName } from '../config.js';
import type { AppContext } from '../context/app-context.js';
import type { Job } from '../queue/types.js';
import type { Runner } from '../runner/runner.js';
import type { Session, ToolState } from '../session/types.js';
import type { McpServerRecord } from '../store/mcp-server.js';
import { postMessageWithContext } from './app-helpers.js';
import type { ChatClient } from './app-types.js';
import { runClaudeSwitchPreflight } from './mcp-preflight-claude.js';
import { runCodexSwitchPreflight } from './mcp-preflight-codex.js';
import { getPreflightDriver, runUnifiedJobPreflight } from './mcp-preflight-driver.js';
import { runGeminiSwitchPreflight } from './mcp-preflight-gemini.js';
import { resolveSessionMcpSelection } from './mcp-selection.js';
import type { Messenger } from './messenger.js';
import {
  CLAUDE_MCP_AUTH_APPROVAL_RERUN_KEY,
  isClaudeMcpPreflightBypassed,
  isClaudeMcpPreflightVerified,
} from './tools/claude.js';
import { isCodexMcpPreflightVerified } from './tools/codex.js';
import {
  GEMINI_MCP_AUTH_APPROVAL_RERUN_KEY,
  isGeminiMcpPreflightBypassed,
  isGeminiMcpPreflightInitialized,
} from './tools/gemini.js';

// ---------------------------------------------------------------------------
// Shared switch-preflight helpers
// ---------------------------------------------------------------------------

/**
 * Context returned by `checkSwitchPreflightNeeded` when preflight should run.
 * Contains everything the tool-specific logic needs after the common checks pass.
 */
export interface SwitchPreflightReady {
  authServer: string;
  session: Session;
  selectedMcpServers: ReadonlyArray<McpServerRecord>;
}

/**
 * Common early-return checks for all switch-preflight implementations:
 * 1. Is the auth server configured?
 * 2. Does the session exist?
 * 3. Is preflight already done (verified or bypassed)?
 *
 * Returns the setup context if preflight should proceed, or null to skip.
 */
export function checkSwitchPreflightNeeded(
  ctx: AppContext,
  sessionKey: string,
  authServer: string | null | undefined,
  shouldSkip: (toolState: ToolState, server: string) => boolean,
): SwitchPreflightReady | null {
  if (!authServer) return null;
  const session = ctx.sessionManager.get(sessionKey);
  if (!session) return null;
  if (shouldSkip(session.toolState, authServer)) return null;
  const selection = resolveSessionMcpSelection(ctx, sessionKey, session.tool);
  if (!selection.enabledServerNames.has(authServer)) return null;
  return { authServer, session, selectedMcpServers: selection.enabledServers };
}

/**
 * Common success path for switch-preflight: merge tool state and post a success message.
 */
export async function handleSwitchPreflightSuccess(
  ctx: AppContext,
  slackClient: ChatClient,
  channelId: string,
  threadTs: string,
  sessionKey: string,
  tool: ToolName,
  stateUpdate: Record<string, unknown>,
  successMessage: string,
): Promise<void> {
  ctx.sessionManager.mergeToolState(sessionKey, stateUpdate);
  await postMessageWithContext(ctx, slackClient, channelId, threadTs, successMessage, {
    sessionKey,
    tool,
  });
}

// ---------------------------------------------------------------------------
// Shared types used by tool-specific preflight modules and job-executor
// ---------------------------------------------------------------------------

export interface JobPreflightContext {
  job: Job;
  messenger: Messenger;
  runner: Runner;
  env: Record<string, string>;
  session: { toolState: ToolState };
  effectiveToolState: ToolState;
  claudeSessionIdPreStored: boolean;
  selectedMcpServers?: ReadonlyArray<McpServerRecord>;
}

export interface JobPreflightAbortResult {
  exitCode: number;
  errorKind: string;
  outputSummary: string;
  outputRaw: string;
}

export interface JobPreflightResult {
  shouldReturn: boolean;
  env: Record<string, string>;
  sessionToolState: ToolState;
  effectiveToolState: ToolState;
  abortResult?: JobPreflightAbortResult;
}

export interface JobPreflightOrchestrationInput extends JobPreflightContext {
  threadKey: string;
  allowMcp: boolean;
}

export interface PostRunMcpAuthContext {
  job: Job;
  threadKey: string;
  mcpAuthRequiredServer: string | null;
  mcpAuthRequiredResourceUrl: string | null;
  selectedMcpServers: ReadonlyArray<McpServerRecord>;
}

// ---------------------------------------------------------------------------
// Re-exports from tool-specific modules
// ---------------------------------------------------------------------------

export {
  runClaudeSwitchPreflight,
  runClaudeJobPreflight,
  handleClaudePostRunMcpAuth,
} from './mcp-preflight-claude.js';
export {
  runGeminiSwitchPreflight,
  prepareGeminiJobRuntime,
  runGeminiJobPreflight,
  handleGeminiPostRunMcpAuth,
} from './mcp-preflight-gemini.js';
export {
  runCodexSwitchPreflight,
  runCodexJobPreflight,
  handleCodexPostRunMcpAuth,
} from './mcp-preflight-codex.js';

// ---------------------------------------------------------------------------
// Switch-preflight dispatcher
// ---------------------------------------------------------------------------

export async function maybeRunSwitchPreflight(
  ctx: AppContext,
  slackClient: ChatClient,
  tool: ToolName,
  threadKey: string,
  channelId: string,
  threadTs: string,
  userId: string,
  sessionKey: string,
): Promise<void> {
  let run: Promise<void>;
  switch (tool) {
    case 'claude':
      run = runClaudeSwitchPreflight(
        ctx,
        slackClient,
        threadKey,
        channelId,
        threadTs,
        userId,
        sessionKey,
      );
      break;
    case 'gemini':
      run = runGeminiSwitchPreflight(
        ctx,
        slackClient,
        threadKey,
        channelId,
        threadTs,
        userId,
        sessionKey,
      );
      break;
    case 'codex':
      run = runCodexSwitchPreflight(ctx, slackClient, channelId, threadTs, sessionKey);
      break;
    default:
      return;
  }

  // Publish the barrier so concurrent job executors can wait for it.
  ctx.switchPreflightBarriers.set(sessionKey, run);
  try {
    await run;
  } finally {
    ctx.switchPreflightBarriers.delete(sessionKey);
  }
}

export async function maybeRunJobPreflight(
  ctx: AppContext,
  input: JobPreflightOrchestrationInput,
): Promise<JobPreflightResult> {
  const { job, threadKey, allowMcp } = input;
  const enabledServerNames = new Set((input.selectedMcpServers ?? []).map((server) => server.name));
  const switchBarrier = ctx.switchPreflightBarriers.get(job.sessionKey);
  if (switchBarrier) {
    await switchBarrier;
  }

  const driver = getPreflightDriver(job.tool);
  if (driver) {
    const authServer = driver.getAuthServer(ctx.config);
    if (authServer && allowMcp && enabledServerNames.has(authServer)) {
      const freshSession = ctx.sessionManager.get(job.sessionKey);
      const freshState = freshSession?.toolState ?? input.effectiveToolState;
      const skipOverrideKey = `${job.tool}_skip_mcp_preflight_once`;
      const skipPreflight = job.toolStateOverrides?.[skipOverrideKey] === true;

      let shouldSkip = skipPreflight;
      if (!shouldSkip) {
        if (job.tool === 'claude') {
          shouldSkip =
            isClaudeMcpPreflightBypassed(freshState, authServer) ||
            isClaudeMcpPreflightVerified(freshState, authServer);
        } else if (job.tool === 'gemini') {
          shouldSkip =
            isGeminiMcpPreflightBypassed(freshState, authServer) ||
            isGeminiMcpPreflightInitialized(freshState, authServer);
        } else if (job.tool === 'codex') {
          shouldSkip = isCodexMcpPreflightVerified(freshState, authServer);
        }
      }

      if (!shouldSkip) {
        const isApprovalRerun =
          job.tool === 'claude'
            ? job.toolStateOverrides?.[CLAUDE_MCP_AUTH_APPROVAL_RERUN_KEY] === true
            : job.tool === 'gemini'
              ? job.toolStateOverrides?.[GEMINI_MCP_AUTH_APPROVAL_RERUN_KEY] === true
              : false;
        return runUnifiedJobPreflight(ctx, input, threadKey, isApprovalRerun, driver);
      }
    }
  }

  return {
    shouldReturn: false,
    env: input.env,
    sessionToolState: input.session.toolState,
    effectiveToolState: input.effectiveToolState,
  };
}
