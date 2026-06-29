/** @module claude-mcp-token-refresh — Auto-refresh expired Claude MCP OAuth tokens via OIDC discovery */
/**
 * Claude MCP OAuth token auto-refresh.
 *
 * Reads ~/.claude/.credentials.json, detects expired MCP OAuth tokens,
 * and refreshes them using the upstream OAuth provider's token endpoint
 * (discovered via OpenID Connect Discovery from the JWT issuer claim).
 */
import crypto from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TIMEOUTS } from '../shared/constants.js';
import {
  getTrustedOAuthHostsFromEnv,
  isTrustedPublicHttpsUrl,
  normalizeOAuthHostname,
} from '../shared/oauth-security.js';
import { errorMessage } from '../utils/error.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface McpOAuthEntry {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string;
  [key: string]: unknown;
}

interface CredentialsFile {
  mcpOAuth?: Record<string, McpOAuthEntry>;
  [key: string]: unknown;
}

export interface RefreshResult {
  refreshed: boolean;
  reason:
    | 'not_expired'
    | 'no_credentials_file'
    | 'no_mcp_oauth'
    | 'server_not_found'
    | 'refresh_failed'
    | 'discovery_failed'
    | 'untrusted_oauth_host'
    | 'credentials_changed'
    | 'jwt_parse_failed'
    | 'success';
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXPIRY_MARGIN_MS = TIMEOUTS.mcpTokenExpiryMargin; // refresh 60s before actual expiry
const refreshLocks = new Map<string, Promise<RefreshResult>>();

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

export function getCredentialsPath(): string {
  const configuredRaw = process.env.CLAUDE_CONFIG_DIR;
  const configuredDir = typeof configuredRaw === 'string' ? configuredRaw.trim() : undefined;
  const useConfiguredDir =
    configuredDir &&
    configuredDir.length > 0 &&
    configuredDir !== 'undefined' &&
    configuredDir !== 'null';
  const claudeConfigDir = useConfiguredDir ? configuredDir : path.join(os.homedir(), '.claude');
  return path.join(claudeConfigDir, '.credentials.json');
}

/**
 * Decode a JWT payload without verification (we only need issuer/azp claims).
 * Returns null if the token is not a valid 3-segment JWT.
 */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Find the mcpOAuth key that matches `serverName`.
 * Keys are formatted as `<serverName>|<hash>`.
 */
export function findMcpOAuthKey(
  mcpOAuth: Record<string, unknown>,
  serverName: string,
): string | null {
  const prefix = `${serverName}|`;
  return Object.keys(mcpOAuth).find((k) => k.startsWith(prefix)) ?? null;
}

/**
 * Discover the token endpoint via OpenID Connect Discovery.
 * Fetches `<issuer>/.well-known/openid-configuration` and extracts `token_endpoint`.
 */
export async function discoverTokenEndpoint(
  issuer: string,
  options?: { trustedHosts?: ReadonlySet<string> | null; requireTrustedHosts?: boolean },
): Promise<string | null> {
  if (!isTrustedPublicHttpsUrl(issuer, options)) return null;
  const wellKnownUrl = `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  try {
    const resp = await fetch(wellKnownUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;
    const body = (await resp.json()) as Record<string, unknown>;
    const endpoint = body.token_endpoint;
    if (typeof endpoint !== 'string') return null;
    if (!isTrustedPublicHttpsUrl(endpoint, options)) return null;
    return endpoint;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main refresh logic
// ---------------------------------------------------------------------------

export async function refreshClaudeMcpOAuthToken(serverName: string): Promise<RefreshResult> {
  const lockKey = `${getCredentialsPath()}:${serverName}`;
  const existing = refreshLocks.get(lockKey);
  if (existing) return existing;

  const refreshPromise = refreshClaudeMcpOAuthTokenUnlocked(serverName);
  const cleanup = () => {
    if (refreshLocks.get(lockKey) === refreshPromise) {
      refreshLocks.delete(lockKey);
    }
  };
  refreshPromise.then(cleanup, cleanup);
  refreshLocks.set(lockKey, refreshPromise);
  return refreshPromise;
}

async function refreshClaudeMcpOAuthTokenUnlocked(serverName: string): Promise<RefreshResult> {
  // 1. Read credentials file
  const credsPath = getCredentialsPath();
  let creds: CredentialsFile;
  try {
    creds = JSON.parse(readFileSync(credsPath, 'utf-8')) as CredentialsFile;
  } catch {
    return { refreshed: false, reason: 'no_credentials_file' };
  }

  // 2. Find mcpOAuth section
  const mcpOAuth = creds.mcpOAuth;
  if (!mcpOAuth || typeof mcpOAuth !== 'object') {
    return { refreshed: false, reason: 'no_mcp_oauth' };
  }

  // 3. Find matching server entry
  const mcpKey = findMcpOAuthKey(mcpOAuth, serverName);
  if (!mcpKey) {
    return { refreshed: false, reason: 'server_not_found' };
  }
  const entry = mcpOAuth[mcpKey];
  if (!entry?.accessToken || !entry.refreshToken) {
    return { refreshed: false, reason: 'server_not_found' };
  }

  // 4. Check expiry
  const now = Date.now();
  if (entry.expiresAt && entry.expiresAt > now + EXPIRY_MARGIN_MS) {
    return { refreshed: false, reason: 'not_expired' };
  }

  logger.info('claude_mcp_token_refresh_start', {
    server: serverName,
    expiredAt: entry.expiresAt ? new Date(entry.expiresAt).toISOString() : 'unknown',
  });

  // 5. Parse JWT to extract issuer and client_id
  const jwtPayload = decodeJwtPayload(entry.accessToken);
  if (!jwtPayload) {
    return { refreshed: false, reason: 'jwt_parse_failed', error: 'Failed to decode JWT payload' };
  }

  const issuer = jwtPayload.iss;
  const clientId = jwtPayload.azp;
  if (typeof issuer !== 'string' || typeof clientId !== 'string') {
    return {
      refreshed: false,
      reason: 'jwt_parse_failed',
      error: `Missing iss or azp claim in JWT (iss=${String(issuer)}, azp=${String(clientId)})`,
    };
  }
  const trustedHosts = getTrustedOAuthHostsFromEnv();
  if (!trustedHosts) {
    return {
      refreshed: false,
      reason: 'untrusted_oauth_host',
      error:
        'HUSKYGATE_OAUTH_TRUSTED_HOSTS must be configured before Claude fallback token refresh is allowed',
    };
  }
  if (!isTrustedPublicHttpsUrl(issuer, { trustedHosts, requireTrustedHosts: true })) {
    return {
      refreshed: false,
      reason: 'untrusted_oauth_host',
      error: `Untrusted OAuth issuer host: ${normalizeOAuthHostname(new URL(issuer).hostname)}`,
    };
  }

  // 6. Discover token endpoint via OIDC Discovery
  const tokenEndpoint = await discoverTokenEndpoint(issuer, {
    trustedHosts,
    requireTrustedHosts: true,
  });
  if (!tokenEndpoint) {
    return {
      refreshed: false,
      reason: 'discovery_failed',
      error: `Failed to discover a trusted token endpoint from issuer: ${issuer}`,
    };
  }

  // 7. Refresh the token
  const scope = entry.scope ?? (typeof jwtPayload.scp === 'string' ? jwtPayload.scp : '');
  const scopeWithOfflineAccess = scope.includes('offline_access')
    ? scope
    : `${scope} offline_access`.trim();

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: entry.refreshToken,
    client_id: clientId,
    scope: scopeWithOfflineAccess,
  });

  let tokenResponse: Record<string, unknown>;
  try {
    const resp = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    tokenResponse = (await resp.json()) as Record<string, unknown>;
  } catch (err) {
    const errMsg = errorMessage(err);
    logger.error('claude_mcp_token_refresh_request_failed', { server: serverName, error: errMsg });
    return { refreshed: false, reason: 'refresh_failed', error: errMsg };
  }

  if (tokenResponse.error) {
    const errDesc = String(tokenResponse.error_description ?? tokenResponse.error);
    logger.error('claude_mcp_token_refresh_oauth_error', {
      server: serverName,
      error: String(tokenResponse.error),
      description: errDesc,
    });
    return { refreshed: false, reason: 'refresh_failed', error: errDesc };
  }

  const newAccessToken = tokenResponse.access_token;
  const newRefreshToken = tokenResponse.refresh_token;
  const expiresIn = tokenResponse.expires_in;
  if (typeof newAccessToken !== 'string' || typeof expiresIn !== 'number') {
    return {
      refreshed: false,
      reason: 'refresh_failed',
      error: 'Invalid token response: missing access_token or expires_in',
    };
  }

  // 8. Write back to credentials file (re-read to minimize race window, atomic write)
  try {
    const freshCreds = JSON.parse(readFileSync(credsPath, 'utf-8')) as CredentialsFile;
    const freshMcpOAuth = freshCreds.mcpOAuth;
    if (!freshMcpOAuth || typeof freshMcpOAuth !== 'object') {
      return {
        refreshed: false,
        reason: 'credentials_changed',
        error: `Credentials entry changed while refreshing token for server: ${serverName}`,
      };
    }
    const freshEntry = freshMcpOAuth[mcpKey];
    if (!freshEntry) {
      return {
        refreshed: false,
        reason: 'credentials_changed',
        error: `Credentials entry changed while refreshing token for server: ${serverName}`,
      };
    }
    if (
      freshEntry.accessToken !== entry.accessToken ||
      freshEntry.refreshToken !== entry.refreshToken ||
      freshEntry.expiresAt !== entry.expiresAt
    ) {
      return {
        refreshed: false,
        reason: 'credentials_changed',
        error: `Credentials entry was updated concurrently for server: ${serverName}`,
      };
    }

    const writeNow = Date.now();
    freshMcpOAuth[mcpKey] = {
      ...freshEntry,
      accessToken: newAccessToken,
      refreshToken: typeof newRefreshToken === 'string' ? newRefreshToken : entry.refreshToken,
      expiresAt: writeNow + expiresIn * 1000,
    };
    const tmpPath = `${credsPath}.tmp.${crypto.randomUUID().slice(0, 8)}`;
    writeFileSync(tmpPath, JSON.stringify(freshCreds), { mode: 0o600 });
    renameSync(tmpPath, credsPath);
  } catch (err) {
    const errMsg = errorMessage(err);
    logger.error('claude_mcp_token_refresh_write_failed', { server: serverName, error: errMsg });
    return {
      refreshed: false,
      reason: 'refresh_failed',
      error: `Failed to write credentials: ${errMsg}`,
    };
  }

  logger.info('claude_mcp_token_refresh_success', {
    server: serverName,
    newExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  });

  return { refreshed: true, reason: 'success' };
}
