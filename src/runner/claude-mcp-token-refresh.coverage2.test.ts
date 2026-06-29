/** Coverage2 tests for claude-mcp-token-refresh: uncovered lines 158-166, 189-194, 289-294, 308-313 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  isTrustedPublicHttpsUrl: vi.fn(() => true),
  getTrustedOAuthHostsFromEnv: vi.fn(() => new Set(['auth.example.com'])),
  normalizeOAuthHostname: vi.fn((h: string) => h),
  errorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
  fetch: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: mocked.readFileSync,
    writeFileSync: mocked.writeFileSync,
    renameSync: mocked.renameSync,
  };
});

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: mocked.loggerInfo,
    warn: mocked.loggerWarn,
    error: mocked.loggerError,
    debug: vi.fn(),
  },
}));

vi.mock('../shared/constants.js', () => ({
  TIMEOUTS: { mcpTokenExpiryMargin: 60000 },
}));

vi.mock('../shared/oauth-security.js', () => ({
  isTrustedPublicHttpsUrl: mocked.isTrustedPublicHttpsUrl,
  getTrustedOAuthHostsFromEnv: mocked.getTrustedOAuthHostsFromEnv,
  normalizeOAuthHostname: mocked.normalizeOAuthHostname,
}));

vi.mock('../utils/error.js', () => ({
  errorMessage: mocked.errorMessage,
}));

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${encoded}.signature`;
}

function makeCredentials(serverName: string, overrides: Record<string, unknown> = {}) {
  const jwt = makeJwt({ iss: 'https://auth.example.com', azp: 'client-123', scp: 'openid' });
  return JSON.stringify({
    mcpOAuth: {
      [`${serverName}|hash123`]: {
        accessToken: jwt,
        refreshToken: 'refresh-tok',
        expiresAt: Date.now() - 120000, // expired
        ...overrides,
      },
    },
  });
}

describe('claude-mcp-token-refresh coverage2', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = '/tmp/test-claude-config';
    // Default: global fetch mock
    vi.stubGlobal('fetch', mocked.fetch);
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = originalEnv;
    vi.unstubAllGlobals();
  });

  describe('refreshClaudeMcpOAuthTokenUnlocked', () => {
    it('returns no_credentials_file when readFileSync throws (lines 158-162)', async () => {
      mocked.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const { refreshClaudeMcpOAuthToken } = await import('./claude-mcp-token-refresh.js');
      const result = await refreshClaudeMcpOAuthToken('my-server');
      expect(result.refreshed).toBe(false);
      expect(result.reason).toBe('no_credentials_file');
    });

    it('returns no_mcp_oauth when mcpOAuth is missing (lines 164-166)', async () => {
      mocked.readFileSync.mockReturnValue(JSON.stringify({ other: 'data' }));

      const { refreshClaudeMcpOAuthToken } = await import('./claude-mcp-token-refresh.js');
      const result = await refreshClaudeMcpOAuthToken('my-server');
      expect(result.refreshed).toBe(false);
      expect(result.reason).toBe('no_mcp_oauth');
    });

    it('returns no_mcp_oauth when mcpOAuth is not an object', async () => {
      mocked.readFileSync.mockReturnValue(JSON.stringify({ mcpOAuth: 'not-an-object' }));

      const { refreshClaudeMcpOAuthToken } = await import('./claude-mcp-token-refresh.js');
      const result = await refreshClaudeMcpOAuthToken('my-server');
      expect(result.refreshed).toBe(false);
      expect(result.reason).toBe('no_mcp_oauth');
    });

    it('returns jwt_parse_failed when accessToken is not a valid JWT (lines 189-194)', async () => {
      const creds = JSON.stringify({
        mcpOAuth: {
          'my-server|hash': {
            accessToken: 'not-a-jwt',
            refreshToken: 'refresh',
            expiresAt: Date.now() - 120000,
          },
        },
      });
      mocked.readFileSync.mockReturnValue(creds);

      const { refreshClaudeMcpOAuthToken } = await import('./claude-mcp-token-refresh.js');
      const result = await refreshClaudeMcpOAuthToken('my-server');
      expect(result.refreshed).toBe(false);
      expect(result.reason).toBe('jwt_parse_failed');
      expect(result.error).toContain('Failed to decode JWT payload');
    });

    it('returns credentials_changed when freshMcpOAuth is missing on re-read (lines 289-294)', async () => {
      let readCount = 0;
      mocked.readFileSync.mockImplementation(() => {
        readCount++;
        if (readCount === 1) {
          return makeCredentials('srv');
        }
        // Second read: mcpOAuth gone
        return JSON.stringify({ other: 'data' });
      });

      mocked.isTrustedPublicHttpsUrl.mockReturnValue(true);
      mocked.getTrustedOAuthHostsFromEnv.mockReturnValue(new Set(['auth.example.com']));

      // Discovery returns token endpoint
      const discoveryResp = {
        ok: true,
        json: async () => ({ token_endpoint: 'https://auth.example.com/token' }),
      };
      // Token refresh returns new tokens
      const tokenResp = {
        json: async () => ({
          access_token: 'new-token',
          refresh_token: 'new-refresh',
          expires_in: 3600,
        }),
      };
      mocked.fetch.mockResolvedValueOnce(discoveryResp).mockResolvedValueOnce(tokenResp);

      const { refreshClaudeMcpOAuthToken } = await import('./claude-mcp-token-refresh.js');
      const result = await refreshClaudeMcpOAuthToken('srv');
      expect(result.refreshed).toBe(false);
      expect(result.reason).toBe('credentials_changed');
      expect(result.error).toContain('changed while refreshing');
    });

    it('returns credentials_changed when entry was updated concurrently (lines 308-313)', async () => {
      let readCount = 0;
      const jwt = makeJwt({ iss: 'https://auth.example.com', azp: 'client-123', scp: 'openid' });
      mocked.readFileSync.mockImplementation(() => {
        readCount++;
        if (readCount === 1) {
          return JSON.stringify({
            mcpOAuth: {
              'srv2|hash': {
                accessToken: jwt,
                refreshToken: 'refresh-tok',
                expiresAt: Date.now() - 120000,
              },
            },
          });
        }
        // Second read: entry has different values (concurrent update)
        return JSON.stringify({
          mcpOAuth: {
            'srv2|hash': {
              accessToken: 'changed-token',
              refreshToken: 'changed-refresh',
              expiresAt: Date.now() + 999999,
            },
          },
        });
      });

      mocked.isTrustedPublicHttpsUrl.mockReturnValue(true);
      mocked.getTrustedOAuthHostsFromEnv.mockReturnValue(new Set(['auth.example.com']));

      const discoveryResp = {
        ok: true,
        json: async () => ({ token_endpoint: 'https://auth.example.com/token' }),
      };
      const tokenResp = {
        json: async () => ({
          access_token: 'new-token',
          refresh_token: 'new-refresh',
          expires_in: 3600,
        }),
      };
      mocked.fetch.mockResolvedValueOnce(discoveryResp).mockResolvedValueOnce(tokenResp);

      const { refreshClaudeMcpOAuthToken } = await import('./claude-mcp-token-refresh.js');
      const result = await refreshClaudeMcpOAuthToken('srv2');
      expect(result.refreshed).toBe(false);
      expect(result.reason).toBe('credentials_changed');
      expect(result.error).toContain('updated concurrently');
    });
  });
});
