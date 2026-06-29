/** @module gemini-runtime-home — Prepare isolated Gemini CLI home directory with OAuth token repair and MCP config */
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { McpServerRecord } from '../store/mcp-server.js';
import { logger } from '../utils/logger.js';

const GEMINI_DIR = '.gemini';
const RUNTIME_HOME_DIRNAME = '.gemini_runtime_home';

interface GeminiServerConfig {
  httpUrl?: unknown;
  url?: unknown;
  oauth?: unknown;
  [key: string]: unknown;
}

interface GeminiSettings {
  mcpServers?: Record<string, GeminiServerConfig>;
  [key: string]: unknown;
}

interface OAuthTokenValue {
  accessToken: string;
  tokenType: string;
  refreshToken?: string;
  scope?: string;
  expiresAt?: number;
}

interface OAuthCredential {
  serverName: string;
  token: OAuthTokenValue;
  clientId?: string;
  tokenUrl?: string;
  mcpServerUrl?: string;
  updatedAt?: number;
}

export interface GeminiRuntimeHomeResult {
  homeDir: string;
  tokenAliasRepaired: boolean;
  tokenUrlNormalized: boolean;
  oauthDisabledForServer: boolean;
}

interface GeminiProjectRegistry {
  projects: Record<string, string>;
}

function resolveSourceHomeDir(): string {
  const geminiCliHome = process.env.GEMINI_CLI_HOME?.trim();
  if (geminiCliHome) return geminiCliHome;
  return os.homedir();
}

function resolveSourceSettingsPath(sourceHome: string): string {
  const configured = process.env.GEMINI_MCP_CONFIG_PATH?.trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.join(os.homedir(), configured);
  }
  return path.join(sourceHome, GEMINI_DIR, 'settings.json');
}

function normalizeUrl(urlValue: string): string | null {
  try {
    const parsed = new URL(urlValue);
    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }
    if (!parsed.pathname) parsed.pathname = '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function urlHost(urlValue: string): string | null {
  try {
    return new URL(urlValue).host;
  } catch {
    return null;
  }
}

function safeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function copyJsonIfPresent(sourcePath: string, destPath: string): Promise<void> {
  const raw = await readJsonFile<unknown>(sourcePath);
  if (raw !== null) {
    await writeJsonFile(destPath, raw);
  }
}

async function ensureProjectRegistryExists(runtimeGeminiDir: string): Promise<void> {
  const registryPath = path.join(runtimeGeminiDir, 'projects.json');
  const existing = await readJsonFile<GeminiProjectRegistry>(registryPath);
  if (existing !== null) return;
  await writeJsonFile(registryPath, { projects: {} satisfies Record<string, string> });
}

function buildGeminiSettingsFromServers(
  servers: ReadonlyArray<McpServerRecord>,
): Record<string, GeminiServerConfig> {
  return Object.fromEntries(
    [...servers]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((server) => {
        const { transport: _t, type: _ty, ...definition } = server.definition as GeminiServerConfig;
        return [server.name, definition];
      }),
  );
}

function selectAliasCredential(
  tokens: OAuthCredential[],
  targetServer: string,
  targetServerUrl: string | null,
): OAuthCredential | null {
  const hasTarget = tokens.some((token) => token.serverName === targetServer);
  if (hasTarget) return null;

  if (targetServerUrl) {
    const normalizedTarget = normalizeUrl(targetServerUrl);
    if (normalizedTarget) {
      const byExactUrl = tokens.find((token) => {
        const tokenUrl = safeString(token.mcpServerUrl);
        if (!tokenUrl) return false;
        return normalizeUrl(tokenUrl) === normalizedTarget;
      });
      if (byExactUrl) return byExactUrl;
    }

    const targetHost = urlHost(targetServerUrl);
    if (targetHost) {
      const byHost = tokens.find((token) => {
        const tokenUrl = safeString(token.mcpServerUrl);
        if (!tokenUrl) return false;
        if (!token.token?.refreshToken) return false;
        return urlHost(tokenUrl) === targetHost;
      });
      if (byHost) return byHost;
    }
  }

  const byLegacyName = tokens.find((token) => token.serverName === 'aws-cli-mcp');
  if (byLegacyName) return byLegacyName;

  return null;
}

function cloneCredentialWithServer(
  source: OAuthCredential,
  targetServer: string,
  targetUrl: string | null,
): OAuthCredential {
  const next: OAuthCredential = {
    ...source,
    token: { ...source.token },
    serverName: targetServer,
    updatedAt: Date.now(),
  };
  if (targetUrl) {
    next.mcpServerUrl = targetUrl;
  }
  return next;
}

function normalizeTargetCredentialUrl(
  credential: OAuthCredential,
  targetUrl: string | null,
): { credential: OAuthCredential; changed: boolean } {
  if (!targetUrl) return { credential, changed: false };
  const current = safeString(credential.mcpServerUrl);
  if (!current) {
    return { credential: { ...credential, mcpServerUrl: targetUrl }, changed: true };
  }
  const normalizedCurrent = normalizeUrl(current);
  const normalizedTarget = normalizeUrl(targetUrl);
  if (!normalizedCurrent || !normalizedTarget || normalizedCurrent === normalizedTarget) {
    return { credential, changed: false };
  }
  return {
    credential: { ...credential, mcpServerUrl: targetUrl },
    changed: true,
  };
}

export async function prepareGeminiRuntimeHome(
  workdir: string,
  mcpAuthServer: string | null,
  servers?: ReadonlyArray<McpServerRecord>,
): Promise<GeminiRuntimeHomeResult> {
  const sourceHome = resolveSourceHomeDir();
  const sourceSettingsPath = resolveSourceSettingsPath(sourceHome);
  const sourceGeminiDir = path.dirname(sourceSettingsPath);

  const runtimeHome = path.join(workdir, RUNTIME_HOME_DIRNAME);
  const runtimeGeminiDir = path.join(runtimeHome, GEMINI_DIR);
  await mkdir(runtimeGeminiDir, { recursive: true });

  const sourceTokensPath = path.join(sourceGeminiDir, 'mcp-oauth-tokens.json');
  const sourceOauthCredsPath = path.join(sourceGeminiDir, 'oauth_creds.json');
  const sourceGoogleAccountsPath = path.join(sourceGeminiDir, 'google_accounts.json');

  const runtimeSettingsPath = path.join(runtimeGeminiDir, 'settings.json');
  const runtimeTokensPath = path.join(runtimeGeminiDir, 'mcp-oauth-tokens.json');
  const runtimeOauthCredsPath = path.join(runtimeGeminiDir, 'oauth_creds.json');
  const runtimeGoogleAccountsPath = path.join(runtimeGeminiDir, 'google_accounts.json');

  const sourceSettings = (await readJsonFile<GeminiSettings>(sourceSettingsPath)) ?? {};
  const settings: GeminiSettings = {
    ...sourceSettings,
    mcpServers:
      servers === undefined
        ? ((sourceSettings.mcpServers ?? {}) as Record<string, GeminiServerConfig>)
        : buildGeminiSettingsFromServers(servers),
  };
  const tokens = (await readJsonFile<OAuthCredential[]>(sourceTokensPath)) ?? [];

  let tokenAliasRepaired = false;
  let tokenUrlNormalized = false;
  let oauthDisabledForServer = false;

  if (mcpAuthServer && settings.mcpServers?.[mcpAuthServer]) {
    const serverConfig = settings.mcpServers[mcpAuthServer];
    const targetServerUrl = safeString(serverConfig.httpUrl) ?? safeString(serverConfig.url);

    if (typeof serverConfig.oauth === 'object' && serverConfig.oauth !== null) {
      const { oauth: _oauth, ...rest } = serverConfig;
      settings.mcpServers[mcpAuthServer] = rest;
      oauthDisabledForServer = true;
    }

    const aliasSource = selectAliasCredential(tokens, mcpAuthServer, targetServerUrl);
    if (aliasSource) {
      tokens.push(cloneCredentialWithServer(aliasSource, mcpAuthServer, targetServerUrl));
      tokenAliasRepaired = true;
    }

    const targetIndex = tokens.findIndex((token) => token.serverName === mcpAuthServer);
    const targetCredential = targetIndex >= 0 ? tokens[targetIndex] : undefined;
    if (targetIndex >= 0 && targetCredential) {
      const normalized = normalizeTargetCredentialUrl(targetCredential, targetServerUrl);
      if (normalized.changed) {
        tokens[targetIndex] = normalized.credential;
        tokenUrlNormalized = true;
      }
    }
  }

  await writeJsonFile(runtimeSettingsPath, settings);
  await writeJsonFile(runtimeTokensPath, tokens);
  await copyJsonIfPresent(sourceOauthCredsPath, runtimeOauthCredsPath);
  await copyJsonIfPresent(sourceGoogleAccountsPath, runtimeGoogleAccountsPath);
  await ensureProjectRegistryExists(runtimeGeminiDir);

  return {
    homeDir: runtimeHome,
    tokenAliasRepaired,
    tokenUrlNormalized,
    oauthDisabledForServer,
  };
}

const GEMINI_CREDENTIAL_FILES = [
  'oauth_creds.json',
  'google_accounts.json',
  'mcp-oauth-tokens.json',
];

/**
 * Remove credential files from the Gemini runtime home directory
 * to prevent OAuth tokens from persisting in the workdir.
 */
export async function cleanupGeminiRuntimeHome(workdir: string): Promise<void> {
  const runtimeGeminiDir = path.join(workdir, RUNTIME_HOME_DIRNAME, GEMINI_DIR);
  for (const file of GEMINI_CREDENTIAL_FILES) {
    try {
      await unlink(path.join(runtimeGeminiDir, file));
    } catch {
      // File may not exist; ignore.
    }
  }
  logger.info('gemini_runtime_home_cleanup', { workdir });
}
