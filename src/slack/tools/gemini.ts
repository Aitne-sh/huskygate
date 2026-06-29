/** @module tools/gemini — Gemini driver helpers: MCP auth preflight, OAuth flow handling, and approval prompt formatting */
import { GeminiDriver } from '../../runner/driver-gemini.js';
import type { Runner } from '../../runner/runner.js';
import type { DriverEvent } from '../../runner/types.js';
import type { ToolState } from '../../session/types.js';
export {
  GEMINI_MCP_AUTH_APPROVAL_ACTION_KEY,
  GEMINI_MCP_AUTH_APPROVAL_RERUN_KEY,
  GEMINI_STICKY_TOOL_STATE_KEYS,
} from '../../shared/sticky-tool-state.js';
import { evaluateGeminiMcpAuthPreflight, extractOAuthUrl, isOAuthFlowEvent } from '../mcp-auth.js';
import {
  formatMcpAuthGenericFailure,
  isMcpPreflightMarker,
  setMcpPreflightMarker,
} from './tool-state-utils.js';

export const GEMINI_MCP_AUTH_INITIALIZED_SERVER_KEY = 'gemini_mcp_auth_initialized_server';
export const GEMINI_MCP_AUTH_VERIFIED_SERVER_KEY = 'gemini_mcp_auth_verified_server';
export const GEMINI_MCP_AUTH_BYPASS_SERVER_KEY = 'gemini_mcp_auth_bypass_server';

export interface GeminiMcpAuthPreflightResult {
  ok: boolean;
  events: DriverEvent[];
  exitCode: number | null;
  errorKind: string | null;
  requiredServer: string | null;
  interactiveFailure: boolean;
  oauthFlowStarted: boolean;
}

export interface GeminiMcpApprovalPromptInput {
  action: 'skip_preflight_once' | 'retry_with_preauth';
  prompt: string | null;
  server: string;
}

export function formatGeminiMcpAuthRequiredMessage(server: string): string {
  return `Gemini MCP server \`${server}\` requires authentication. I tried running \`/mcp auth ${server}\` automatically, but authentication is still required.\nPlease run \`gemini -i "/mcp auth ${server}"\` in a local interactive terminal, complete OAuth consent, then retry.`;
}

export function formatGeminiMcpAuthInteractiveFailureMessage(server: string): string {
  return `Gemini MCP authentication for \`${server}\` could not complete in headless execution.\nRun \`gemini -i "/mcp auth ${server}"\` in a local interactive terminal, choose \`1. Yes\` when prompted, complete OAuth consent, then retry.\nIf browser launch is unavailable, use \`NO_BROWSER=true gemini -i "/mcp auth ${server}"\`.`;
}

export function formatGeminiMcpAuthGenericFailureMessage(
  server: string,
  exitCode: number | null,
  errorKind: string | null,
): string {
  return formatMcpAuthGenericFailure('Gemini', server, exitCode, errorKind);
}

export function formatGeminiMcpAuthBypassPrompt(server: string, expiresInSec: number): string {
  return `Gemini MCP auth for \`${server}\` still needs local interactive consent.\nReply \`!yes\`, \`!y\` or \`!no\`, \`!n\`. (expires in ${expiresInSec}s)\nNote: AWS MCP tools may still fail until \`gemini -i "/mcp auth ${server}"\` is completed locally.`;
}

function formatGeminiMcpAuthRetryPrompt(server: string, expiresInSec: number): string {
  return `Gemini MCP auth for \`${server}\` appears expired or missing.\nReply \`!yes\`, \`!y\` or \`!no\`, \`!n\`. (expires in ${expiresInSec}s)\nIf rerun still fails, complete \`gemini -i "/mcp auth ${server}"\` in a local interactive terminal.`;
}

export function formatGeminiMcpAuthLoopPreventionMessage(server: string): string {
  return `Gemini MCP auth for \`${server}\` is still required after the approved rerun.\nTo prevent an approval loop, this request will not be auto-rerun again.\nPlease complete local interactive auth with \`gemini -i "/mcp auth ${server}"\`, then send your request again.`;
}

export function formatGeminiMcpApprovalPrompt(
  pending: GeminiMcpApprovalPromptInput,
  expiresInSec: number,
): string {
  if (pending.action === 'retry_with_preauth') {
    return formatGeminiMcpAuthRetryPrompt(pending.server, expiresInSec);
  }
  return formatGeminiMcpAuthBypassPrompt(pending.server, expiresInSec);
}

export function formatGeminiMissingToolMessage(
  missingTool: string,
  authServer: string | null,
  mcpWarningSeen: boolean,
): string {
  const authHint =
    authServer !== null
      ? `\nMCP auth is likely incomplete for \`${authServer}\`. Run \`gemini -i "/mcp auth ${authServer}"\` locally and retry.`
      : '';
  const warningHint = mcpWarningSeen
    ? '\nGemini emitted MCP discovery/auth warnings in this run, so the MCP toolset may not have been loaded.'
    : '';
  return `Gemini reported missing tool \`${missingTool}\` (tool not found).${warningHint}${authHint}`;
}

export function isGeminiMcpPreflightInitialized(toolState: ToolState, server: string): boolean {
  return isMcpPreflightMarker(toolState, GEMINI_MCP_AUTH_VERIFIED_SERVER_KEY, server);
}

export function isGeminiMcpPreflightBypassed(toolState: ToolState, server: string): boolean {
  return isMcpPreflightMarker(toolState, GEMINI_MCP_AUTH_BYPASS_SERVER_KEY, server);
}

export function markGeminiMcpPreflightInitialized(toolState: ToolState, server: string): ToolState {
  return setMcpPreflightMarker(toolState, GEMINI_MCP_AUTH_INITIALIZED_SERVER_KEY, server);
}

export function markGeminiMcpPreflightVerified(toolState: ToolState, server: string): ToolState {
  return setMcpPreflightMarker(toolState, GEMINI_MCP_AUTH_VERIFIED_SERVER_KEY, server);
}

export function formatGeminiMcpAuthOAuthUrlMessage(server: string, url: string): string {
  return `MCP auth for \`${server}\` requires OAuth consent.\nOpen this URL in a browser on the machine running HuskyGate:\n${url}`;
}

export function formatGeminiMcpAuthWaitingMessage(server: string): string {
  return `Waiting for OAuth completion for \`${server}\`...`;
}

export interface GeminiInteractiveMcpAuthResult extends GeminiMcpAuthPreflightResult {
  oauthUrl: string | null;
}

export async function runGeminiInteractiveMcpAuth(
  runner: Runner,
  env: Record<string, string>,
  cwd: string,
  server: string,
  onOAuthUrl?: (url: string) => void,
): Promise<GeminiInteractiveMcpAuthResult> {
  const driver = new GeminiDriver();
  const args = [
    ...driver.getCommandPrefixArgs(),
    '-p',
    `/mcp auth ${server}`,
    '--output-format',
    'stream-json',
    '--sandbox',
  ];
  const interactiveEnv = { ...env, NO_BROWSER: 'true' };
  const events: DriverEvent[] = [];
  let oauthUrl: string | null = null;
  let oauthFlowDetected = false;
  let callbackFired = false;

  const result = await runner.run(driver, args, interactiveEnv, cwd, (event) => {
    events.push(event);
    if (event.type !== 'status' && event.type !== 'error' && event.type !== 'text') return;

    if (!oauthFlowDetected && isOAuthFlowEvent(event.content)) {
      oauthFlowDetected = true;
    }

    if (!oauthUrl) {
      const url = extractOAuthUrl(event.content);
      if (url) {
        oauthUrl = url;
        if (onOAuthUrl && !callbackFired) {
          callbackFired = true;
          onOAuthUrl(url);
        }
      }
    }
  });

  const evaluated = evaluateGeminiMcpAuthPreflight(events);
  const interactiveFailure =
    evaluated.interactiveFailure || result.exitCode === 42 || result.errorKind === 'exit_42';
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
    requiredServer: evaluated.requiredServer,
    interactiveFailure,
    oauthFlowStarted: evaluated.oauthFlowStarted || oauthFlowDetected,
    oauthUrl,
  };
}

export async function runGeminiMcpAuthPreflight(
  runner: Runner,
  env: Record<string, string>,
  cwd: string,
  server: string,
): Promise<GeminiMcpAuthPreflightResult> {
  const driver = new GeminiDriver();
  const args = [
    ...driver.getCommandPrefixArgs(),
    '-p',
    `/mcp auth ${server}`,
    '--output-format',
    'stream-json',
    '--sandbox',
  ];
  const events: DriverEvent[] = [];

  const result = await runner.run(driver, args, env, cwd, (event) => {
    events.push(event);
  });

  const evaluated = evaluateGeminiMcpAuthPreflight(events);
  const interactiveFailure =
    evaluated.interactiveFailure || result.exitCode === 42 || result.errorKind === 'exit_42';
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
    requiredServer: evaluated.requiredServer,
    interactiveFailure,
    oauthFlowStarted: evaluated.oauthFlowStarted,
  };
}
