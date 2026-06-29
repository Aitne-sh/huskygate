/** @module mcp-auth — Detects MCP authentication events, token refresh failures, and OAuth flow status from driver output */
import type { DriverEvent } from '../runner/types.js';
import { getTrustedOAuthHostsFromEnv, isTrustedPublicHttpsUrl } from '../shared/oauth-security.js';

const MCP_AUTH_REQUIRED_PATTERN =
  /MCP server\s+'([^']+)'\s+requires authentication using:\s*\/mcp auth\s+([A-Za-z0-9._-]+)/i;
const MCP_AUTH_REQUIRED_FALLBACK_PATTERN =
  /requires authentication using:\s*\/mcp auth\s+([A-Za-z0-9._-]+)/i;
const MCP_AUTH_REQUIRED_RESOURCE_PATTERNS: RegExp[] = [
  /AuthRequired\(AuthRequiredError\s*\{[^}]*\bresource:\s*"?(https?:\/\/[^",}\s]+)"/i,
  /\bresource=\\?"(https?:\/\/[^"\\]+)\\?"/i,
  /\bresource="(https?:\/\/[^"]+)"/i,
];

const INTERACTIVE_AUTH_FAILURE_PATTERNS: RegExp[] = [
  /Interactive consent could not be obtained/i,
  /FatalAuthenticationError/i,
  /Error authenticating/i,
];

const OAUTH_FLOW_STATUS_PATTERNS: RegExp[] = [
  /Refreshing expired token for MCP server:/i,
  /Dynamic client registration is supported at:/i,
  /Discovered OAuth configuration from base URL for server/i,
  /Starting OAuth authentication for server/i,
  /OAuth callback server listening on port/i,
];

const MCP_RUNTIME_WARNING_PATTERNS: RegExp[] = [
  /Error during discovery for MCP server/i,
  /Refreshing expired token for MCP server/i,
  /requires authentication using:\s*\/mcp auth/i,
  /Attempting OAuth discovery for /i,
  /Failed to refresh auth token/i,
  /AuthRequired\(AuthRequiredError/i,
  /Auth\(TokenRefreshFailed\(/i,
  /upstream_token_error/i,
  /token refresh failed/i,
];

const MCP_TOKEN_REFRESH_FAILURE_PATTERNS: RegExp[] = [
  /Auth\(TokenRefreshFailed\(/i,
  /upstream_token_error/i,
  /token refresh failed/i,
];

const MCP_CONNECTION_FAILURE_PATTERNS: RegExp[] = [
  /MCP error -32000:\s*Connection closed/i,
  /Connection closed during discovery/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
];

const TOOL_NOT_FOUND_PATTERN =
  /Error executing tool\s+([A-Za-z0-9_.*:()/-]+):\s*Tool\s+["'`]?([A-Za-z0-9_.*:()/-]+)["'`]?\s+not found/i;

function normalize(content: string): string {
  return content.replace(/^Error:\s*/i, '').trim();
}

/**
 * Detect whether content matches an OAuth flow status event.
 * Reuses the existing OAUTH_FLOW_STATUS_PATTERNS.
 */
export function isOAuthFlowEvent(content: string): boolean {
  const normalized = normalize(content);
  return OAUTH_FLOW_STATUS_PATTERNS.some((pattern) => pattern.test(normalized));
}

const OAUTH_QUERY_PARAMS = ['client_id', 'response_type', 'redirect_uri', 'scope', 'state'];

/**
 * Extract the first non-localhost HTTPS URL from content.
 * Prefers URLs containing OAuth query parameters (client_id, response_type, etc.).
 * Rejects private/loopback IPs and optionally enforces a trusted-host allowlist
 * via `HUSKYGATE_OAUTH_TRUSTED_HOSTS` env var.
 * Returns null if no suitable URL is found.
 */
export function extractOAuthUrl(content: string): string | null {
  const rawMatches = content.match(/https:\/\/[^\s"'<>)\]},]+/gi);
  if (!rawMatches) return null;

  const trustedHosts = getTrustedOAuthHostsFromEnv();

  const urls: string[] = [];
  for (const raw of rawMatches) {
    // Strip trailing punctuation that is often part of surrounding text
    const cleaned = raw.replace(/[.,;:!?)}\]]+$/, '');
    try {
      if (!isTrustedPublicHttpsUrl(cleaned, { trustedHosts })) continue;
      urls.push(cleaned);
    } catch {
      // Invalid URL — skip
    }
  }

  if (urls.length === 0) return null;

  // Prefer a URL with OAuth query params
  for (const url of urls) {
    if (OAUTH_QUERY_PARAMS.some((param) => url.includes(`${param}=`))) {
      return url;
    }
  }

  return urls[0] as string;
}

export function detectMcpAuthRequiredServer(content: string): string | null {
  const normalized = normalize(content);
  const specific = normalized.match(MCP_AUTH_REQUIRED_PATTERN);
  const specificServer = specific?.[2]?.trim();
  if (specificServer) return specificServer;

  const fallback = normalized.match(MCP_AUTH_REQUIRED_FALLBACK_PATTERN);
  return fallback?.[1]?.trim() ?? null;
}

export function detectMcpAuthRequiredResourceUrl(content: string): string | null {
  const normalized = normalize(content);
  for (const pattern of MCP_AUTH_REQUIRED_RESOURCE_PATTERNS) {
    const match = normalized.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

export function isMcpInteractiveAuthFailure(content: string): boolean {
  const normalized = normalize(content);
  return INTERACTIVE_AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isMcpRuntimeWarning(content: string): boolean {
  const normalized = normalize(content);
  return MCP_RUNTIME_WARNING_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isMcpTokenRefreshFailure(content: string): boolean {
  const normalized = normalize(content);
  return MCP_TOKEN_REFRESH_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isMcpConnectionFailure(content: string): boolean {
  const normalized = normalize(content);
  return MCP_CONNECTION_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export interface ToolNotFoundDetection {
  requestedTool: string;
  missingTool: string;
}

export function detectToolNotFound(content: string): ToolNotFoundDetection | null {
  const normalized = normalize(content);
  const match = normalized.match(TOOL_NOT_FOUND_PATTERN);
  if (!match) return null;
  return {
    requestedTool: (match[1] ?? '').trim(),
    missingTool: (match[2] ?? '').trim(),
  };
}

export interface GeminiMcpAuthPreflightEvaluation {
  requiredServer: string | null;
  interactiveFailure: boolean;
  oauthFlowStarted: boolean;
}

export function evaluateGeminiMcpAuthPreflight(
  events: DriverEvent[],
): GeminiMcpAuthPreflightEvaluation {
  let requiredServer: string | null = null;
  let interactiveFailure = false;
  let oauthFlowStarted = false;

  for (const event of events) {
    if (event.type !== 'status' && event.type !== 'error' && event.type !== 'text') continue;

    if (!requiredServer) {
      requiredServer = detectMcpAuthRequiredServer(event.content);
    }
    if (!interactiveFailure) {
      interactiveFailure = isMcpInteractiveAuthFailure(event.content);
    }
    if (!oauthFlowStarted) {
      const normalized = normalize(event.content);
      oauthFlowStarted = OAUTH_FLOW_STATUS_PATTERNS.some((pattern) => pattern.test(normalized));
    }
  }

  return {
    requiredServer,
    interactiveFailure,
    oauthFlowStarted,
  };
}

export interface CodexMcpAuthLoginEvaluation {
  requiredServer: string | null;
  requiredResourceUrl: string | null;
  tokenRefreshFailed: boolean;
}

export function evaluateCodexMcpAuthLogin(events: DriverEvent[]): CodexMcpAuthLoginEvaluation {
  let requiredServer: string | null = null;
  let requiredResourceUrl: string | null = null;
  let tokenRefreshFailed = false;

  for (const event of events) {
    if (event.type !== 'status' && event.type !== 'error' && event.type !== 'text') continue;

    if (!requiredServer) {
      requiredServer = detectMcpAuthRequiredServer(event.content);
    }
    if (!requiredResourceUrl) {
      requiredResourceUrl = detectMcpAuthRequiredResourceUrl(event.content);
    }
    if (!tokenRefreshFailed) {
      tokenRefreshFailed = isMcpTokenRefreshFailure(event.content);
    }
  }

  return {
    requiredServer,
    requiredResourceUrl,
    tokenRefreshFailed,
  };
}
