import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupGeminiRuntimeHome, prepareGeminiRuntimeHome } from './gemini-runtime-home.js';

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

describe('prepareGeminiRuntimeHome', () => {
  const originalGeminiCliHome = process.env.GEMINI_CLI_HOME;
  const tempDirs: string[] = [];

  afterEach(async () => {
    if (originalGeminiCliHome === undefined) {
      delete process.env.GEMINI_CLI_HOME;
    } else {
      process.env.GEMINI_CLI_HOME = originalGeminiCliHome;
    }

    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it('repairs token alias and disables oauth for target server in runtime settings', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-src-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-work-'));
    tempDirs.push(sourceHome, workdir);

    const sourceGeminiDir = path.join(sourceHome, '.gemini');
    await mkdir(sourceGeminiDir, { recursive: true });

    await writeJson(path.join(sourceGeminiDir, 'settings.json'), {
      mcpServers: {
        'aws-api': {
          httpUrl: 'http://localhost:8000/mcp',
          oauth: {
            enabled: true,
            clientId: 'legacy-client',
          },
        },
      },
    });
    await writeJson(path.join(sourceGeminiDir, 'mcp-oauth-tokens.json'), [
      {
        serverName: 'aws-cli-mcp',
        token: {
          accessToken: 'token',
          tokenType: 'Bearer',
          refreshToken: 'refresh',
          expiresAt: Date.now() + 60_000,
        },
        clientId: 'dynamic-client',
        tokenUrl: 'http://localhost:8000/token',
        mcpServerUrl: 'http://localhost:8000/mcp',
      },
    ]);

    process.env.GEMINI_CLI_HOME = sourceHome;
    const result = await prepareGeminiRuntimeHome(workdir, 'aws-api');

    expect(result.tokenAliasRepaired).toBe(true);
    expect(result.oauthDisabledForServer).toBe(true);

    const runtimeSettings = await readJson<{ mcpServers: Record<string, Record<string, unknown>> }>(
      path.join(result.homeDir, '.gemini', 'settings.json'),
    );
    expect(runtimeSettings.mcpServers['aws-api']?.oauth).toBeUndefined();

    const runtimeTokens = await readJson<Array<{ serverName: string; mcpServerUrl?: string }>>(
      path.join(result.homeDir, '.gemini', 'mcp-oauth-tokens.json'),
    );
    expect(runtimeTokens.some((token) => token.serverName === 'aws-api')).toBe(true);
  });

  it('normalizes target token mcpServerUrl to configured server url', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-src-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-work-'));
    tempDirs.push(sourceHome, workdir);

    const sourceGeminiDir = path.join(sourceHome, '.gemini');
    await mkdir(sourceGeminiDir, { recursive: true });

    await writeJson(path.join(sourceGeminiDir, 'settings.json'), {
      mcpServers: {
        'aws-api': {
          httpUrl: 'http://localhost:8000/mcp',
        },
      },
    });
    await writeJson(path.join(sourceGeminiDir, 'mcp-oauth-tokens.json'), [
      {
        serverName: 'aws-api',
        token: {
          accessToken: 'token',
          tokenType: 'Bearer',
          refreshToken: 'refresh',
          expiresAt: Date.now() + 60_000,
        },
        clientId: 'dynamic-client',
        tokenUrl: 'http://localhost:8000/token',
        mcpServerUrl: 'http://localhost:8000/',
      },
    ]);

    process.env.GEMINI_CLI_HOME = sourceHome;
    const result = await prepareGeminiRuntimeHome(workdir, 'aws-api');

    expect(result.tokenUrlNormalized).toBe(true);
    const runtimeTokens = await readJson<Array<{ serverName: string; mcpServerUrl?: string }>>(
      path.join(result.homeDir, '.gemini', 'mcp-oauth-tokens.json'),
    );
    const awsApi = runtimeTokens.find((token) => token.serverName === 'aws-api');
    expect(awsApi?.mcpServerUrl).toBe('http://localhost:8000/mcp');
  });

  it('falls back to os.homedir when GEMINI_CLI_HOME is not set and copies optional files', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-os-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-work-'));
    tempDirs.push(sourceHome, workdir);

    const sourceGeminiDir = path.join(sourceHome, '.gemini');
    await mkdir(sourceGeminiDir, { recursive: true });
    await writeJson(path.join(sourceGeminiDir, 'settings.json'), { mcpServers: {} });
    await writeJson(path.join(sourceGeminiDir, 'mcp-oauth-tokens.json'), []);
    await writeJson(path.join(sourceGeminiDir, 'oauth_creds.json'), { token: 'abc' });
    await writeJson(path.join(sourceGeminiDir, 'google_accounts.json'), {
      account: 'u@example.com',
    });

    delete process.env.GEMINI_CLI_HOME;
    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(sourceHome);
    try {
      const result = await prepareGeminiRuntimeHome(workdir, null);
      const copiedOauth = await readJson<{ token: string }>(
        path.join(result.homeDir, '.gemini', 'oauth_creds.json'),
      );
      const copiedAccounts = await readJson<{ account: string }>(
        path.join(result.homeDir, '.gemini', 'google_accounts.json'),
      );
      expect(copiedOauth.token).toBe('abc');
      expect(copiedAccounts.account).toBe('u@example.com');
      const runtimeRegistry = await readJson<{ projects: Record<string, string> }>(
        path.join(result.homeDir, '.gemini', 'projects.json'),
      );
      expect(runtimeRegistry).toEqual({ projects: {} });
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it('preserves an existing runtime project registry when preparing again', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-src-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-work-'));
    tempDirs.push(sourceHome, workdir);

    const sourceGeminiDir = path.join(sourceHome, '.gemini');
    await mkdir(sourceGeminiDir, { recursive: true });
    await writeJson(path.join(sourceGeminiDir, 'settings.json'), { mcpServers: {} });
    await writeJson(path.join(sourceGeminiDir, 'mcp-oauth-tokens.json'), []);

    process.env.GEMINI_CLI_HOME = sourceHome;
    const initial = await prepareGeminiRuntimeHome(workdir, null);

    const runtimeRegistryPath = path.join(initial.homeDir, '.gemini', 'projects.json');
    await writeJson(runtimeRegistryPath, {
      projects: {
        [workdir]: 'seeded-project',
      },
    });

    await prepareGeminiRuntimeHome(workdir, null);

    const runtimeRegistry = await readJson<{ projects: Record<string, string> }>(
      runtimeRegistryPath,
    );
    expect(runtimeRegistry).toEqual({
      projects: {
        [workdir]: 'seeded-project',
      },
    });
  });

  it('replaces mcpServers from DB while preserving non-MCP settings', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-src-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-work-'));
    tempDirs.push(sourceHome, workdir);

    const sourceGeminiDir = path.join(sourceHome, '.gemini');
    await mkdir(sourceGeminiDir, { recursive: true });

    await writeJson(path.join(sourceGeminiDir, 'settings.json'), {
      theme: 'solarized',
      mcp: { timeout: 30 },
      mcpServers: {
        legacy: {
          command: 'legacy-server',
        },
      },
    });
    await writeJson(path.join(sourceGeminiDir, 'mcp-oauth-tokens.json'), []);

    process.env.GEMINI_CLI_HOME = sourceHome;
    const result = await prepareGeminiRuntimeHome(workdir, null, [
      {
        id: 'srv-1',
        name: 'aws-api',
        tool: 'gemini',
        transport: 'sse',
        definition: {
          url: 'https://example.com/mcp',
          excludeTools: ['dangerous_tool'],
        },
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
      },
    ]);

    const runtimeSettings = await readJson<{
      theme: string;
      mcp: Record<string, unknown>;
      mcpServers: Record<string, Record<string, unknown>>;
    }>(path.join(result.homeDir, '.gemini', 'settings.json'));
    expect(runtimeSettings.theme).toBe('solarized');
    expect(runtimeSettings.mcp).toEqual({ timeout: 30 });
    expect(runtimeSettings.mcpServers).toEqual({
      'aws-api': {
        url: 'https://example.com/mcp',
        excludeTools: ['dangerous_tool'],
      },
    });
  });

  it('clears runtime mcpServers when a later DB selection is empty', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-src-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-work-'));
    tempDirs.push(sourceHome, workdir);

    const sourceGeminiDir = path.join(sourceHome, '.gemini');
    await mkdir(sourceGeminiDir, { recursive: true });
    await writeJson(path.join(sourceGeminiDir, 'settings.json'), {
      theme: 'solarized',
      mcpServers: {
        legacy: {
          command: 'legacy-server',
        },
      },
    });
    await writeJson(path.join(sourceGeminiDir, 'mcp-oauth-tokens.json'), []);

    process.env.GEMINI_CLI_HOME = sourceHome;
    await prepareGeminiRuntimeHome(workdir, null, [
      {
        id: 'srv-1',
        name: 'aws-api',
        tool: 'gemini',
        transport: 'sse',
        definition: {
          url: 'https://example.com/mcp',
        },
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
      },
    ]);

    const result = await prepareGeminiRuntimeHome(workdir, null, []);
    const runtimeSettings = await readJson<{
      theme: string;
      mcpServers: Record<string, Record<string, unknown>>;
    }>(path.join(result.homeDir, '.gemini', 'settings.json'));

    expect(runtimeSettings.theme).toBe('solarized');
    expect(runtimeSettings.mcpServers).toEqual({});
  });

  it('repairs alias by host match when target server token is missing', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-src-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-work-'));
    tempDirs.push(sourceHome, workdir);

    const sourceGeminiDir = path.join(sourceHome, '.gemini');
    await mkdir(sourceGeminiDir, { recursive: true });

    await writeJson(path.join(sourceGeminiDir, 'settings.json'), {
      mcpServers: {
        'aws-api': {
          httpUrl: 'https://api.example.com/mcp',
        },
      },
    });
    await writeJson(path.join(sourceGeminiDir, 'mcp-oauth-tokens.json'), [
      {
        serverName: 'other-alias',
        token: {
          accessToken: 'token',
          tokenType: 'Bearer',
          refreshToken: 'refresh',
          expiresAt: Date.now() + 60_000,
        },
        mcpServerUrl: 'https://api.example.com/legacy',
      },
    ]);

    process.env.GEMINI_CLI_HOME = sourceHome;
    const result = await prepareGeminiRuntimeHome(workdir, 'aws-api');
    expect(result.tokenAliasRepaired).toBe(true);
    expect(result.tokenUrlNormalized).toBe(false);

    const runtimeTokens = await readJson<Array<{ serverName: string }>>(
      path.join(result.homeDir, '.gemini', 'mcp-oauth-tokens.json'),
    );
    expect(runtimeTokens.some((token) => token.serverName === 'aws-api')).toBe(true);
  });

  it('normalizes target credential URL when target token exists without mcpServerUrl', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-src-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-work-'));
    tempDirs.push(sourceHome, workdir);

    const sourceGeminiDir = path.join(sourceHome, '.gemini');
    await mkdir(sourceGeminiDir, { recursive: true });

    await writeJson(path.join(sourceGeminiDir, 'settings.json'), {
      mcpServers: {
        'aws-api': {
          httpUrl: 'https://api.example.com/mcp',
        },
      },
    });
    await writeJson(path.join(sourceGeminiDir, 'mcp-oauth-tokens.json'), [
      {
        serverName: 'aws-api',
        token: {
          accessToken: 'token2',
          tokenType: 'Bearer',
          refreshToken: 'refresh2',
          expiresAt: Date.now() + 60_000,
        },
      },
    ]);

    process.env.GEMINI_CLI_HOME = sourceHome;
    const result = await prepareGeminiRuntimeHome(workdir, 'aws-api');
    expect(result.tokenAliasRepaired).toBe(false);
    expect(result.tokenUrlNormalized).toBe(true);

    const runtimeTokens = await readJson<Array<{ serverName: string; mcpServerUrl?: string }>>(
      path.join(result.homeDir, '.gemini', 'mcp-oauth-tokens.json'),
    );
    const target = runtimeTokens.find((token) => token.serverName === 'aws-api');
    expect(target?.mcpServerUrl).toBe('https://api.example.com/mcp');
  });

  it('uses legacy aws-cli-mcp alias when target url is invalid', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-src-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-work-'));
    tempDirs.push(sourceHome, workdir);

    const sourceGeminiDir = path.join(sourceHome, '.gemini');
    await mkdir(sourceGeminiDir, { recursive: true });

    await writeJson(path.join(sourceGeminiDir, 'settings.json'), {
      mcpServers: {
        'aws-api': {
          url: 'not a valid url%%',
        },
      },
    });
    await writeJson(path.join(sourceGeminiDir, 'mcp-oauth-tokens.json'), [
      {
        serverName: 'aws-cli-mcp',
        token: {
          accessToken: 'token',
          tokenType: 'Bearer',
          refreshToken: 'refresh',
          expiresAt: Date.now() + 60_000,
        },
        mcpServerUrl: 'https://legacy.example.com/mcp',
      },
    ]);

    process.env.GEMINI_CLI_HOME = sourceHome;
    const result = await prepareGeminiRuntimeHome(workdir, 'aws-api');
    expect(result.tokenAliasRepaired).toBe(true);

    const runtimeTokens = await readJson<Array<{ serverName: string }>>(
      path.join(result.homeDir, '.gemini', 'mcp-oauth-tokens.json'),
    );
    expect(runtimeTokens.some((token) => token.serverName === 'aws-api')).toBe(true);
  });

  it('does not repair aliases when no matching candidate exists', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-src-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-work-'));
    tempDirs.push(sourceHome, workdir);

    const sourceGeminiDir = path.join(sourceHome, '.gemini');
    await mkdir(sourceGeminiDir, { recursive: true });
    await writeJson(path.join(sourceGeminiDir, 'settings.json'), {
      mcpServers: {
        'aws-api': {
          httpUrl: 'https://api.example.com/mcp',
        },
      },
    });
    await writeJson(path.join(sourceGeminiDir, 'mcp-oauth-tokens.json'), []);

    process.env.GEMINI_CLI_HOME = sourceHome;
    const result = await prepareGeminiRuntimeHome(workdir, 'aws-api');
    expect(result.tokenAliasRepaired).toBe(false);
    expect(result.tokenUrlNormalized).toBe(false);
  });

  it('uses default empty settings/tokens when source files are missing', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-src-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-work-'));
    tempDirs.push(sourceHome, workdir);

    await mkdir(path.join(sourceHome, '.gemini'), { recursive: true });
    process.env.GEMINI_CLI_HOME = sourceHome;

    const result = await prepareGeminiRuntimeHome(workdir, 'aws-api');
    expect(result.tokenAliasRepaired).toBe(false);
    expect(result.tokenUrlNormalized).toBe(false);
    expect(result.oauthDisabledForServer).toBe(false);

    const runtimeSettings = await readJson<Record<string, unknown>>(
      path.join(result.homeDir, '.gemini', 'settings.json'),
    );
    const runtimeTokens = await readJson<unknown[]>(
      path.join(result.homeDir, '.gemini', 'mcp-oauth-tokens.json'),
    );
    expect(runtimeSettings).toEqual({ mcpServers: {} });
    expect(runtimeTokens).toEqual([]);
  });

  it('handles target server URLs with custom scheme and empty pathname', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-src-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-work-'));
    tempDirs.push(sourceHome, workdir);

    const sourceGeminiDir = path.join(sourceHome, '.gemini');
    await mkdir(sourceGeminiDir, { recursive: true });
    await writeJson(path.join(sourceGeminiDir, 'settings.json'), {
      mcpServers: {
        'aws-api': {
          url: 'foo:',
        },
      },
    });
    await writeJson(path.join(sourceGeminiDir, 'mcp-oauth-tokens.json'), []);

    process.env.GEMINI_CLI_HOME = sourceHome;
    const result = await prepareGeminiRuntimeHome(workdir, 'aws-api');
    expect(result.tokenAliasRepaired).toBe(false);
    expect(result.tokenUrlNormalized).toBe(false);
  });

  it('normalizes target URL containing only slashes to canonical root URL', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-src-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-work-'));
    tempDirs.push(sourceHome, workdir);

    const sourceGeminiDir = path.join(sourceHome, '.gemini');
    await mkdir(sourceGeminiDir, { recursive: true });
    await writeJson(path.join(sourceGeminiDir, 'settings.json'), {
      mcpServers: {
        'aws-api': {
          httpUrl: 'https://api.example.com///',
        },
      },
    });
    await writeJson(path.join(sourceGeminiDir, 'mcp-oauth-tokens.json'), [
      {
        serverName: 'aws-api',
        token: {
          accessToken: 'token',
          tokenType: 'Bearer',
          refreshToken: 'refresh',
          expiresAt: Date.now() + 60_000,
        },
        mcpServerUrl: 'https://api.example.com/legacy',
      },
    ]);

    process.env.GEMINI_CLI_HOME = sourceHome;
    const result = await prepareGeminiRuntimeHome(workdir, 'aws-api');
    expect(result.tokenUrlNormalized).toBe(true);

    const runtimeTokens = await readJson<Array<{ serverName: string; mcpServerUrl?: string }>>(
      path.join(result.homeDir, '.gemini', 'mcp-oauth-tokens.json'),
    );
    const target = runtimeTokens.find((token) => token.serverName === 'aws-api');
    expect(target?.mcpServerUrl).toBe('https://api.example.com///');
  });

  it('skips alias candidates with missing URL/refresh token before legacy fallback', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-src-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-work-'));
    tempDirs.push(sourceHome, workdir);

    const sourceGeminiDir = path.join(sourceHome, '.gemini');
    await mkdir(sourceGeminiDir, { recursive: true });
    await writeJson(path.join(sourceGeminiDir, 'settings.json'), {
      mcpServers: {
        'aws-api': {
          httpUrl: 'https://api.example.com/mcp',
        },
      },
    });
    await writeJson(path.join(sourceGeminiDir, 'mcp-oauth-tokens.json'), [
      {
        serverName: 'candidate-no-url',
        token: {
          accessToken: 'token-a',
          tokenType: 'Bearer',
          refreshToken: 'refresh-a',
          expiresAt: Date.now() + 60_000,
        },
      },
      {
        serverName: 'candidate-no-refresh',
        token: {
          accessToken: 'token-b',
          tokenType: 'Bearer',
          expiresAt: Date.now() + 60_000,
        },
        mcpServerUrl: 'https://api.example.com/legacy',
      },
      {
        serverName: 'aws-cli-mcp',
        token: {
          accessToken: 'token-c',
          tokenType: 'Bearer',
          refreshToken: 'refresh-c',
          expiresAt: Date.now() + 60_000,
        },
        mcpServerUrl: 'https://legacy.example.com/mcp',
      },
    ]);

    process.env.GEMINI_CLI_HOME = sourceHome;
    const result = await prepareGeminiRuntimeHome(workdir, 'aws-api');
    expect(result.tokenAliasRepaired).toBe(true);
    expect(result.tokenUrlNormalized).toBe(false);

    const runtimeTokens = await readJson<Array<{ serverName: string }>>(
      path.join(result.homeDir, '.gemini', 'mcp-oauth-tokens.json'),
    );
    expect(runtimeTokens.some((token) => token.serverName === 'aws-api')).toBe(true);
  });

  it('treats whitespace-only token URLs as missing during alias matching', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-src-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-work-'));
    tempDirs.push(sourceHome, workdir);

    const sourceGeminiDir = path.join(sourceHome, '.gemini');
    await mkdir(sourceGeminiDir, { recursive: true });
    await writeJson(path.join(sourceGeminiDir, 'settings.json'), {
      mcpServers: {
        'aws-api': {
          httpUrl: 'https://api.example.com/mcp',
        },
      },
    });
    await writeJson(path.join(sourceGeminiDir, 'mcp-oauth-tokens.json'), [
      {
        serverName: 'candidate-space-url',
        token: {
          accessToken: 'token-a',
          tokenType: 'Bearer',
          refreshToken: 'refresh-a',
          expiresAt: Date.now() + 60_000,
        },
        mcpServerUrl: '   ',
      },
      {
        serverName: 'aws-cli-mcp',
        token: {
          accessToken: 'token-b',
          tokenType: 'Bearer',
          refreshToken: 'refresh-b',
          expiresAt: Date.now() + 60_000,
        },
        mcpServerUrl: 'https://legacy.example.com/mcp',
      },
    ]);

    process.env.GEMINI_CLI_HOME = sourceHome;
    const result = await prepareGeminiRuntimeHome(workdir, 'aws-api');
    expect(result.tokenAliasRepaired).toBe(true);
  });

  it('does not normalize target credential URL when target server URL is absent', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-src-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-work-'));
    tempDirs.push(sourceHome, workdir);

    const sourceGeminiDir = path.join(sourceHome, '.gemini');
    await mkdir(sourceGeminiDir, { recursive: true });
    await writeJson(path.join(sourceGeminiDir, 'settings.json'), {
      mcpServers: {
        'aws-api': {},
      },
    });
    await writeJson(path.join(sourceGeminiDir, 'mcp-oauth-tokens.json'), [
      {
        serverName: 'aws-api',
        token: {
          accessToken: 'token',
          tokenType: 'Bearer',
          refreshToken: 'refresh',
          expiresAt: Date.now() + 60_000,
        },
        mcpServerUrl: 'https://api.example.com/mcp',
      },
    ]);

    process.env.GEMINI_CLI_HOME = sourceHome;
    const result = await prepareGeminiRuntimeHome(workdir, 'aws-api');
    expect(result.tokenUrlNormalized).toBe(false);
  });
});

describe('cleanupGeminiRuntimeHome', () => {
  it('removes credential files and tolerates missing files', async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'gemini-cleanup-'));
    const runtimeDir = path.join(workdir, '.gemini_runtime_home', '.gemini');
    await mkdir(runtimeDir, { recursive: true });
    await writeJson(path.join(runtimeDir, 'oauth_creds.json'), { token: 'abc' });
    await writeJson(path.join(runtimeDir, 'mcp-oauth-tokens.json'), []);

    await cleanupGeminiRuntimeHome(workdir);

    await expect(readFile(path.join(runtimeDir, 'oauth_creds.json'), 'utf-8')).rejects.toThrow();
    await expect(
      readFile(path.join(runtimeDir, 'mcp-oauth-tokens.json'), 'utf-8'),
    ).rejects.toThrow();

    await rm(workdir, { recursive: true, force: true });
  });
});
