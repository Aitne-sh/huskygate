/** @module tools/claude — Claude driver helpers: MCP list parsing, auth preflight evaluation, and token refresh */
import { refreshClaudeMcpOAuthToken } from '../../runner/claude-mcp-token-refresh.js';
import { ClaudeDriver, buildClaudeMcpConfigArgs } from '../../runner/driver-claude.js';
import type { Runner } from '../../runner/runner.js';
import type { DriverEvent } from '../../runner/types.js';
import type { ToolState } from '../../session/types.js';
import { logger } from '../../utils/logger.js';
export {
  CLAUDE_MCP_AUTH_APPROVAL_ACTION_KEY,
  CLAUDE_MCP_AUTH_APPROVAL_RERUN_KEY,
  CLAUDE_STICKY_TOOL_STATE_KEYS,
} from '../../shared/sticky-tool-state.js';
import {
  detectMcpAuthRequiredServer,
  isMcpInteractiveAuthFailure,
  isMcpRuntimeWarning,
  isMcpTokenRefreshFailure,
} from '../mcp-auth.js';
import {
  formatMcpAuthGenericFailure,
  isMcpPreflightMarker,
  setMcpPreflightMarker,
} from './tool-state-utils.js';

// --- claude mcp list parsing ---

export interface ClaudeMcpServerInfo {
  name: string;
  url: string | null;
  connected: boolean;
  needsAuth: boolean;
  statusText: string | null;
}

export interface ClaudeMcpListResult {
  events: DriverEvent[];
  exitCode: number | null;
  errorKind: string | null;
  servers: ClaudeMcpServerInfo[];
}

export interface ClaudeMcpCliOptions {
  mcpConfigPath?: string | null;
}

/**
 * Parse a single line from `claude mcp list` output.
 *
 * Expected formats:
 *   aws-api: http://localhost:8000/mcp (HTTP) - ✓ Connected
 *   aws-api: http://localhost:8000/mcp (HTTP) - ! Needs authentication
 *   claude.ai Notion: https://mcp.notion.com/mcp - ✓ Connected
 */
export function parseClaudeMcpListLine(line: string): ClaudeMcpServerInfo | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Match: <name>: <url> [optional] - <status_icon> <status_text>
  const match = trimmed.match(/^(.+?):\s+(https?:\/\/\S+)(?:\s+\([^)]*\))?\s+-\s+(.+)$/);
  if (!match) return null;

  const name = match[1]?.trim() ?? null;
  const url = match[2]?.trim() ?? null;
  const statusRaw = match[3]?.trim() ?? null;
  if (!name) return null;

  // Strip status icons (✓, !, ✗, etc.)
  const statusText = statusRaw?.replace(/^[✓✗!]\s*/, '').trim() ?? null;
  const connected = statusRaw?.startsWith('✓') === true;
  const needsAuth =
    statusRaw?.startsWith('!') === true ||
    /needs?\s+auth/i.test(statusText ?? '') ||
    /auth(entication)?\s+required/i.test(statusText ?? '') ||
    /requires?\s+auth/i.test(statusText ?? '');

  return { name, url, connected, needsAuth, statusText };
}

function extractClaudeMcpServers(events: DriverEvent[]): ClaudeMcpServerInfo[] {
  const serverByName = new Map<string, ClaudeMcpServerInfo>();
  for (const event of events) {
    if (event.type !== 'text' && event.type !== 'status' && event.type !== 'error') continue;
    const lines = event.content.split(/\r?\n/);
    for (const rawLine of lines) {
      const parsed = parseClaudeMcpListLine(rawLine);
      if (!parsed) continue;
      serverByName.set(parsed.name, parsed);
    }
  }
  return [...serverByName.values()];
}

export async function runClaudeMcpList(
  runner: Runner,
  env: Record<string, string>,
  cwd: string,
  options?: ClaudeMcpCliOptions,
): Promise<ClaudeMcpListResult> {
  const driver = new ClaudeDriver();
  const args = [...buildClaudeMcpConfigArgs(options?.mcpConfigPath), 'mcp', 'list'];
  const events: DriverEvent[] = [];

  const result = await runner.run(driver, args, env, cwd, (event) => {
    events.push(event);
  });
  const servers = extractClaudeMcpServers(events);

  return {
    events,
    exitCode: result.exitCode,
    errorKind: result.errorKind,
    servers,
  };
}

export const CLAUDE_MCP_AUTH_VERIFIED_SERVER_KEY = 'claude_mcp_auth_verified_server';
export const CLAUDE_MCP_AUTH_BYPASS_SERVER_KEY = 'claude_mcp_auth_bypass_server';

export interface ClaudeMcpAuthPreflightResult {
  ok: boolean;
  events: DriverEvent[];
  exitCode: number | null;
  errorKind: string | null;
  requiredServer: string | null;
  interactiveFailure: boolean;
  tokenRefreshFailed: boolean;
}

export function isClaudeMcpPreflightVerified(toolState: ToolState, server: string): boolean {
  return isMcpPreflightMarker(toolState, CLAUDE_MCP_AUTH_VERIFIED_SERVER_KEY, server);
}

export function isClaudeMcpPreflightBypassed(toolState: ToolState, server: string): boolean {
  return isMcpPreflightMarker(toolState, CLAUDE_MCP_AUTH_BYPASS_SERVER_KEY, server);
}

export function markClaudeMcpPreflightVerified(toolState: ToolState, server: string): ToolState {
  return setMcpPreflightMarker(toolState, CLAUDE_MCP_AUTH_VERIFIED_SERVER_KEY, server);
}

export function formatClaudeMcpAuthRequiredMessage(server: string): string {
  return `Claude MCP server \`${server}\` requires authentication. I tried running \`/mcp auth ${server}\` automatically, but authentication is still required.\nPlease run \`claude\` in a local interactive terminal and complete the MCP OAuth flow for \`${server}\`, then retry.`;
}

export function formatClaudeMcpAuthGenericFailureMessage(
  server: string,
  exitCode: number | null,
  errorKind: string | null,
): string {
  return formatMcpAuthGenericFailure(
    'Claude',
    server,
    exitCode,
    errorKind,
    `Claude MCP server \`${server}\` was not found in \`claude mcp list\`.\nPlease verify the server name is correct and the MCP server is configured in Claude settings.`,
  );
}

function formatClaudeMcpAuthBypassPrompt(server: string, expiresInSec: number): string {
  return `Claude MCP auth for \`${server}\` may not be ready.\nReply \`!yes\`, \`!y\` or \`!no\`, \`!n\` to proceed without MCP auth check. (expires in ${expiresInSec}s)\nNote: MCP tools may fail until authentication is completed locally.`;
}

function formatClaudeMcpAuthRetryPrompt(server: string, expiresInSec: number): string {
  return `Claude MCP auth for \`${server}\` appears expired or missing.\nReply \`!yes\`, \`!y\` to retry with pre-auth, or \`!no\`, \`!n\` to cancel. (expires in ${expiresInSec}s)\nIf rerun still fails, complete MCP auth in a local interactive terminal.`;
}

export function formatClaudeMcpAuthLoopPreventionMessage(server: string): string {
  return `Claude MCP auth for \`${server}\` is still required after the approved rerun.\nTo prevent an approval loop, this request will not be auto-rerun again.\nPlease complete MCP auth locally with \`claude\`, then send your request again.`;
}

export interface ClaudeMcpApprovalPromptInput {
  action: 'skip_preflight_once' | 'retry_with_preauth';
  prompt: string | null;
  server: string;
}

export function formatClaudeMcpApprovalPrompt(
  pending: ClaudeMcpApprovalPromptInput,
  expiresInSec: number,
): string {
  if (pending.action === 'retry_with_preauth') {
    return formatClaudeMcpAuthRetryPrompt(pending.server, expiresInSec);
  }
  return formatClaudeMcpAuthBypassPrompt(pending.server, expiresInSec);
}

export interface ClaudeMcpAuthPreflightEvaluation {
  requiredServer: string | null;
  interactiveFailure: boolean;
  tokenRefreshFailed: boolean;
  mcpWarningSeen: boolean;
}

export function evaluateClaudeMcpAuthPreflight(
  events: DriverEvent[],
): ClaudeMcpAuthPreflightEvaluation {
  let requiredServer: string | null = null;
  let interactiveFailure = false;
  let tokenRefreshFailed = false;
  let mcpWarningSeen = false;

  for (const event of events) {
    if (event.type !== 'status' && event.type !== 'error' && event.type !== 'text') continue;

    if (!requiredServer) {
      requiredServer = detectMcpAuthRequiredServer(event.content);
    }
    if (!interactiveFailure) {
      interactiveFailure = isMcpInteractiveAuthFailure(event.content);
    }
    if (!tokenRefreshFailed) {
      tokenRefreshFailed = isMcpTokenRefreshFailure(event.content);
    }
    if (!mcpWarningSeen) {
      mcpWarningSeen = isMcpRuntimeWarning(event.content);
    }
  }

  return {
    requiredServer,
    interactiveFailure,
    tokenRefreshFailed,
    mcpWarningSeen,
  };
}

export interface ClaudeMcpAuthCommandResult {
  ok: boolean;
  events: DriverEvent[];
  exitCode: number | null;
  errorKind: string | null;
  interactiveFailure: boolean;
}

/**
 * Run `/mcp auth <server>` via `claude -p` to trigger Claude Code's built-in
 * OAuth token refresh — matching the approach used by Gemini (gemini.ts).
 */
export async function runClaudeMcpAuthCommand(
  runner: Runner,
  env: Record<string, string>,
  cwd: string,
  server: string,
  options?: ClaudeMcpCliOptions,
): Promise<ClaudeMcpAuthCommandResult> {
  const driver = new ClaudeDriver();
  const args = [
    ...buildClaudeMcpConfigArgs(options?.mcpConfigPath),
    '-p',
    `/mcp auth ${server}`,
    '--output-format',
    'stream-json',
    '--verbose',
  ];
  const events: DriverEvent[] = [];

  const result = await runner.run(driver, args, env, cwd, (event) => {
    events.push(event);
  });

  const evaluated = evaluateClaudeMcpAuthPreflight(events);
  const interactiveFailure = evaluated.interactiveFailure;
  const ok =
    result.exitCode === 0 &&
    result.errorKind === null &&
    evaluated.requiredServer === null &&
    !interactiveFailure;

  return {
    ok,
    events,
    exitCode: result.exitCode,
    errorKind: result.errorKind,
    interactiveFailure,
  };
}

/**
 * Check if a server is connected after re-running `claude mcp list`.
 * Returns the successful preflight result if connected, or null otherwise.
 */
async function recheckMcpServer(
  runner: Runner,
  env: Record<string, string>,
  cwd: string,
  server: string,
  options?: ClaudeMcpCliOptions,
): Promise<ClaudeMcpAuthPreflightResult | null> {
  const retryResult = await runClaudeMcpList(runner, env, cwd, options);
  const retryServer = retryResult.servers.find(
    (s) => s.name.toLowerCase() === server.toLowerCase(),
  );

  if (retryServer?.connected && !retryServer.needsAuth) {
    return {
      ok: true,
      events: retryResult.events,
      exitCode: retryResult.exitCode,
      errorKind: retryResult.errorKind,
      requiredServer: null,
      interactiveFailure: false,
      tokenRefreshFailed: false,
    };
  }
  return null;
}

export async function runClaudeMcpAuthPreflight(
  runner: Runner,
  env: Record<string, string>,
  cwd: string,
  server: string,
  options?: ClaudeMcpCliOptions,
): Promise<ClaudeMcpAuthPreflightResult> {
  // Step 1: Check current MCP server status with `claude mcp list`.
  const listResult = await runClaudeMcpList(runner, env, cwd, options);

  const targetServer = listResult.servers.find(
    (s) => s.name.toLowerCase() === server.toLowerCase(),
  );

  // Also check events for explicit MCP auth error patterns (belt-and-suspenders)
  const evaluated = evaluateClaudeMcpAuthPreflight(listResult.events);

  if (targetServer?.connected && !targetServer.needsAuth) {
    // Server found and connected — auth is good
    return {
      ok: true,
      events: listResult.events,
      exitCode: listResult.exitCode,
      errorKind: listResult.errorKind,
      requiredServer: null,
      interactiveFailure: false,
      tokenRefreshFailed: false,
    };
  }

  if (!targetServer && listResult.exitCode === 0) {
    // `claude mcp list` succeeded but the target server was not found.
    return {
      ok: false,
      events: listResult.events,
      exitCode: listResult.exitCode,
      errorKind: 'server_not_found',
      requiredServer: null,
      interactiveFailure: false,
      tokenRefreshFailed: false,
    };
  }

  // Server needs auth or is not connected — attempt recovery.
  const needsRecovery = targetServer?.needsAuth || (targetServer && !targetServer.connected);

  if (needsRecovery) {
    // Step 2: Try `/mcp auth <server>` via `claude -p` (matches Gemini's approach).
    // This triggers Claude Code's built-in OAuth token refresh.
    logger.info('claude_mcp_preflight_auth_command', { server });
    const authResult = await runClaudeMcpAuthCommand(runner, env, cwd, server, options);

    if (authResult.ok) {
      // `/mcp auth` reported success — verify with `claude mcp list`
      let verified = await recheckMcpServer(runner, env, cwd, server, options);
      if (!verified) {
        // Claude CLI may take a moment to pick up the refreshed token from disk.
        await new Promise((resolve) => setTimeout(resolve, 2000));
        verified = await recheckMcpServer(runner, env, cwd, server, options);
      }
      if (verified) {
        logger.info('claude_mcp_preflight_auth_command_success', { server });
        return verified;
      }
      logger.warn('claude_mcp_preflight_auth_command_ok_but_not_connected', { server });
    } else {
      logger.warn('claude_mcp_preflight_auth_command_failed', {
        server,
        exitCode: authResult.exitCode,
        errorKind: authResult.errorKind,
        interactiveFailure: authResult.interactiveFailure,
      });
    }

    // Step 3: Fallback to custom token refresh as a last resort.
    logger.info('claude_mcp_preflight_fallback_token_refresh', { server });
    const refreshResult = await refreshClaudeMcpOAuthToken(server);

    if (refreshResult.refreshed) {
      logger.info('claude_mcp_preflight_token_refreshed', { server });
      let verified = await recheckMcpServer(runner, env, cwd, server, options);
      if (!verified) {
        // Claude CLI may take a moment to pick up the refreshed token from disk.
        await new Promise((resolve) => setTimeout(resolve, 2000));
        verified = await recheckMcpServer(runner, env, cwd, server, options);
      }
      if (verified) return verified;
      logger.warn('claude_mcp_preflight_still_needs_auth_after_refresh', { server });
    } else {
      logger.warn('claude_mcp_preflight_token_refresh_failed', {
        server,
        reason: refreshResult.reason,
        error: refreshResult.error,
      });
    }

    return {
      ok: false,
      events: listResult.events,
      exitCode: listResult.exitCode,
      errorKind: listResult.errorKind,
      requiredServer: server,
      interactiveFailure: authResult.interactiveFailure,
      tokenRefreshFailed: !refreshResult.refreshed,
    };
  }

  // Fallback: `claude mcp list` failed or returned unexpected output
  return {
    ok: false,
    events: listResult.events,
    exitCode: listResult.exitCode,
    errorKind: listResult.errorKind,
    requiredServer: evaluated.requiredServer,
    interactiveFailure: evaluated.interactiveFailure,
    tokenRefreshFailed: evaluated.tokenRefreshFailed,
  };
}
