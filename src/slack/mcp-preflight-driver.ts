/** @module mcp-preflight-driver — Strategy pattern for tool-specific MCP job preflight */
import type { Config, ToolName } from '../config.js';
import type { AppContext } from '../context/app-context.js';
import { getDriverEnv } from '../runner/driver-factory.js';
import type { Runner } from '../runner/runner.js';
import type { ToolState } from '../session/types.js';
import { errorMessage } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import {
  removeClaudeGeneratedMcpConfig,
  writeClaudeMcpConfigToWorkdir,
} from '../workdir/mcp-writer.js';
import {
  type ApprovalFlowConfig,
  type PreflightStateKeys,
  buildPreflightAbortResult,
  diffToolStatePatch,
  handleApprovalFlow,
  handlePreflightFailure,
  logPreflightCompletion,
  mergePreflightToolState,
  noAuthServerResult,
} from './mcp-preflight-utils.js';
import type { JobPreflightContext, JobPreflightResult } from './mcp-preflight.js';
import {
  CLAUDE_MCP_AUTH_BYPASS_SERVER_KEY,
  CLAUDE_MCP_AUTH_VERIFIED_SERVER_KEY,
  formatClaudeMcpApprovalPrompt,
  formatClaudeMcpAuthGenericFailureMessage,
  formatClaudeMcpAuthLoopPreventionMessage,
  formatClaudeMcpAuthRequiredMessage,
  markClaudeMcpPreflightVerified,
  runClaudeMcpAuthPreflight,
} from './tools/claude.js';
import {
  CODEX_MCP_AUTH_VERIFIED_SERVER_KEY,
  formatCodexMcpAuthGenericFailureMessage,
  formatCodexMcpAuthRequiredMessage,
  runCodexMcpAuthPreflight,
} from './tools/codex.js';
import {
  GEMINI_MCP_AUTH_BYPASS_SERVER_KEY,
  GEMINI_MCP_AUTH_INITIALIZED_SERVER_KEY,
  GEMINI_MCP_AUTH_VERIFIED_SERVER_KEY,
  formatGeminiMcpAuthBypassPrompt,
  formatGeminiMcpAuthGenericFailureMessage,
  formatGeminiMcpAuthInteractiveFailureMessage,
  formatGeminiMcpAuthLoopPreventionMessage,
  formatGeminiMcpAuthRequiredMessage,
  runGeminiMcpAuthPreflight,
} from './tools/gemini.js';

// ── Types ──

export interface DriverSetupData {
  /** Override env for the preflight run (Claude uses getDriverEnv instead of jpc.env) */
  env?: Record<string, string>;
}

export interface DriverPreflightResult {
  ok: boolean;
  exitCode: number | null;
  eventsCount: number;
  /** Pre-classified failure info. Only populated when ok === false. */
  failure?: {
    kind: string;
    message: string;
    needsApproval: boolean;
  };
}

export interface McpPreflightDriver {
  readonly tool: ToolName;
  getAuthServer(config: Config): string | null | undefined;
  getStateKeys(authServer: string): PreflightStateKeys;
  setup?(jpc: JobPreflightContext, authServer: string): Promise<DriverSetupData>;
  markSuccess?(toolState: ToolState, authServer: string): ToolState;
  markFailure?(toolState: ToolState, jpc: JobPreflightContext): ToolState;
  runPreflight(
    runner: Runner,
    env: Record<string, string>,
    workdir: string,
    authServer: string,
  ): Promise<DriverPreflightResult>;
  readonly approvalConfig?: ApprovalFlowConfig;
  isApprovalRerun?(isExplicit: boolean, toolState: ToolState): boolean;
  cleanup?(logMeta: Record<string, unknown>): void;
}

// ── Claude Driver ──

const CLAUDE_APPROVAL_CONFIG: ApprovalFlowConfig = {
  tool: 'claude',
  action: 'retry_with_preauth',
  formatLoopMessage: formatClaudeMcpAuthLoopPreventionMessage,
  formatApprovalText: (pending, sec) => formatClaudeMcpApprovalPrompt(pending, sec),
  formatFallbackText: (_server, _timeoutSec) =>
    'Claude MCP auth approval request failed to initialize.',
};

export function createClaudePreflightDriver(): McpPreflightDriver {
  let mcpConfigPath: string | undefined;

  return {
    tool: 'claude',

    getAuthServer(config: Config) {
      return config.claudeMcpAuthServer;
    },

    getStateKeys(_authServer: string): PreflightStateKeys {
      return {
        verified: CLAUDE_MCP_AUTH_VERIFIED_SERVER_KEY,
        onSuccess: { [CLAUDE_MCP_AUTH_BYPASS_SERVER_KEY]: undefined },
      };
    },

    async setup(jpc: JobPreflightContext, _authServer: string): Promise<DriverSetupData> {
      const selectedMcpServers = jpc.selectedMcpServers ?? [];
      mcpConfigPath = writeClaudeMcpConfigToWorkdir(jpc.job.workdir, selectedMcpServers);
      return {
        env: getDriverEnv('claude'),
      };
    },

    markSuccess(toolState: ToolState, authServer: string): ToolState {
      return markClaudeMcpPreflightVerified(toolState, authServer);
    },

    markFailure(toolState: ToolState, jpc: JobPreflightContext): ToolState {
      if (jpc.claudeSessionIdPreStored) {
        return { ...toolState, session_id: undefined };
      }
      return toolState;
    },

    async runPreflight(
      runner: Runner,
      env: Record<string, string>,
      workdir: string,
      authServer: string,
    ): Promise<DriverPreflightResult> {
      const result = await runClaudeMcpAuthPreflight(runner, env, workdir, authServer, {
        mcpConfigPath,
      });

      if (result.ok) {
        return { ok: true, exitCode: result.exitCode, eventsCount: result.events.length };
      }

      const authRequired =
        result.requiredServer || result.interactiveFailure || result.tokenRefreshFailed;

      return {
        ok: false,
        exitCode: result.exitCode,
        eventsCount: result.events.length,
        failure: {
          kind: authRequired ? 'mcp_auth_required' : 'claude_mcp_auth_preflight_failed',
          message: authRequired
            ? formatClaudeMcpAuthRequiredMessage(result.requiredServer ?? authServer)
            : formatClaudeMcpAuthGenericFailureMessage(
                authServer,
                result.exitCode,
                result.errorKind,
              ),
          needsApproval: !!authRequired,
        },
      };
    },

    approvalConfig: CLAUDE_APPROVAL_CONFIG,

    isApprovalRerun(isExplicit: boolean, toolState: ToolState): boolean {
      return isExplicit || toolState.claude_mcp_auth_approval_completed === true;
    },

    cleanup(logMeta: Record<string, unknown>): void {
      if (!mcpConfigPath) return;
      try {
        removeClaudeGeneratedMcpConfig(mcpConfigPath);
      } catch (err) {
        logger.warn('claude_generated_mcp_cleanup_failed', {
          ...logMeta,
          path: mcpConfigPath,
          error: errorMessage(err),
        });
      }
    },
  };
}

// ── Codex Driver ──

export function createCodexPreflightDriver(): McpPreflightDriver {
  return {
    tool: 'codex',

    getAuthServer(config: Config) {
      return config.codexMcpAuthServer;
    },

    getStateKeys(_authServer: string): PreflightStateKeys {
      return {
        verified: CODEX_MCP_AUTH_VERIFIED_SERVER_KEY,
      };
    },

    async runPreflight(
      runner: Runner,
      env: Record<string, string>,
      workdir: string,
      authServer: string,
    ): Promise<DriverPreflightResult> {
      const result = await runCodexMcpAuthPreflight(runner, env, workdir, authServer);

      if (result.ok) {
        return { ok: true, exitCode: result.exitCode, eventsCount: result.events.length };
      }

      const authRequired = !!result.requiredServer;

      return {
        ok: false,
        exitCode: result.exitCode,
        eventsCount: result.events.length,
        failure: {
          kind: authRequired ? 'mcp_auth_required' : 'codex_mcp_auth_preflight_failed',
          message:
            result.requiredServer || result.requiredResourceUrl
              ? formatCodexMcpAuthRequiredMessage(
                  result.requiredServer ?? authServer,
                  result.requiredResourceUrl,
                )
              : formatCodexMcpAuthGenericFailureMessage(
                  authServer,
                  result.exitCode,
                  result.errorKind,
                ),
          needsApproval: false,
        },
      };
    },
  };
}

// ── Gemini Driver ──

const GEMINI_APPROVAL_CONFIG: ApprovalFlowConfig = {
  tool: 'gemini',
  action: 'skip_preflight_once',
  formatLoopMessage: formatGeminiMcpAuthLoopPreventionMessage,
  formatApprovalText: (pending, sec) => formatGeminiMcpAuthBypassPrompt(pending.server, sec),
  formatFallbackText: (server, sec) => formatGeminiMcpAuthBypassPrompt(server, sec),
};

export function createGeminiPreflightDriver(): McpPreflightDriver {
  return {
    tool: 'gemini',

    getAuthServer(config: Config) {
      return config.geminiMcpAuthServer;
    },

    getStateKeys(authServer: string): PreflightStateKeys {
      return {
        verified: GEMINI_MCP_AUTH_VERIFIED_SERVER_KEY,
        onSuccess: {
          [GEMINI_MCP_AUTH_INITIALIZED_SERVER_KEY]: authServer,
          [GEMINI_MCP_AUTH_BYPASS_SERVER_KEY]: undefined,
        },
        clearOnFailure: [GEMINI_MCP_AUTH_INITIALIZED_SERVER_KEY],
      };
    },

    async runPreflight(
      runner: Runner,
      env: Record<string, string>,
      workdir: string,
      authServer: string,
    ): Promise<DriverPreflightResult> {
      const result = await runGeminiMcpAuthPreflight(runner, env, workdir, authServer);

      if (result.ok) {
        return { ok: true, exitCode: result.exitCode, eventsCount: result.events.length };
      }

      let kind: string;
      let message: string;
      let needsApproval: boolean;

      if (result.requiredServer !== null) {
        kind = 'mcp_auth_required';
        message = formatGeminiMcpAuthRequiredMessage(result.requiredServer);
        needsApproval = true;
      } else if (result.interactiveFailure || (result.oauthFlowStarted && result.exitCode !== 0)) {
        kind = 'mcp_auth_interactive_required';
        message = formatGeminiMcpAuthInteractiveFailureMessage(authServer);
        needsApproval = true;
      } else {
        kind = 'gemini_mcp_auth_preflight_failed';
        message = formatGeminiMcpAuthGenericFailureMessage(
          authServer,
          result.exitCode,
          result.errorKind,
        );
        needsApproval = false;
      }

      return {
        ok: false,
        exitCode: result.exitCode,
        eventsCount: result.events.length,
        failure: { kind, message, needsApproval },
      };
    },

    approvalConfig: GEMINI_APPROVAL_CONFIG,

    isApprovalRerun(isExplicit: boolean, _toolState: ToolState): boolean {
      return isExplicit;
    },
  };
}

// ── Factory ──

export function getPreflightDriver(tool: ToolName): McpPreflightDriver | null {
  switch (tool) {
    case 'claude':
      return createClaudePreflightDriver();
    case 'codex':
      return createCodexPreflightDriver();
    case 'gemini':
      return createGeminiPreflightDriver();
    default:
      return null;
  }
}

// ── Unified Orchestration ──

export async function runUnifiedJobPreflight(
  ctx: AppContext,
  jpc: JobPreflightContext,
  threadKey: string,
  isApprovalRerun: boolean,
  driver: McpPreflightDriver,
): Promise<JobPreflightResult> {
  const authServer = driver.getAuthServer(ctx.config);
  if (!authServer) return noAuthServerResult(jpc);

  const { job, messenger, session } = jpc;
  const previousToolState = session.toolState;

  logger.info(`${driver.tool}_mcp_auth_preflight_started`, {
    job_id: job.id,
    session_key: job.sessionKey,
    server: authServer,
  });
  messenger.appendText(`Checking MCP auth for \`${authServer}\`...\n`);

  const setupData = driver.setup ? await driver.setup(jpc, authServer) : undefined;
  const env = setupData?.env ?? jpc.env;

  try {
    const result = await driver.runPreflight(jpc.runner, env, job.workdir, authServer);

    let { sessionToolState, effectiveToolState } = mergePreflightToolState(
      previousToolState,
      jpc.effectiveToolState,
      result.ok,
      authServer,
      driver.getStateKeys(authServer),
    );

    if (result.ok && driver.markSuccess) {
      sessionToolState = driver.markSuccess(sessionToolState, authServer);
    }

    if (!result.ok && driver.markFailure) {
      sessionToolState = driver.markFailure(sessionToolState, jpc);
    }

    ctx.sessionManager.mergeToolState(
      job.sessionKey,
      diffToolStatePatch(previousToolState, sessionToolState),
    );
    session.toolState = sessionToolState;

    if (!result.ok && result.failure) {
      const failure = result.failure;
      await handlePreflightFailure(
        ctx,
        job,
        messenger,
        result.exitCode,
        failure.kind,
        failure.message,
      );

      if (failure.needsApproval && driver.approvalConfig) {
        const rerunFlag = driver.isApprovalRerun
          ? driver.isApprovalRerun(isApprovalRerun, sessionToolState)
          : isApprovalRerun;
        await handleApprovalFlow(ctx, job, threadKey, authServer, rerunFlag, driver.approvalConfig);
      }

      logger.info('job_completed', {
        job_id: job.id,
        exit_code: result.exitCode,
        error_kind: failure.kind,
        events_count: result.eventsCount,
      });
      return {
        shouldReturn: true,
        env: jpc.env,
        sessionToolState,
        effectiveToolState,
        abortResult: buildPreflightAbortResult(result.exitCode, failure.kind, failure.message),
      };
    }

    logPreflightCompletion(driver.tool, job, authServer, result.eventsCount, messenger);
    return { shouldReturn: false, env: jpc.env, sessionToolState, effectiveToolState };
  } finally {
    if (driver.cleanup) {
      driver.cleanup({
        phase: 'job_preflight',
        jobId: job.id,
        sessionKey: job.sessionKey,
        workdir: job.workdir,
      });
    }
  }
}
