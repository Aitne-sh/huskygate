/** Coverage3 tests for claude-mcp-token-refresh: uncovered lines 213-218 (untrusted OAuth host) */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  isTrustedPublicHttpsUrl: vi.fn(() => false),
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

describe('claude-mcp-token-refresh coverage3', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = '/tmp/test-claude-config-3';
    vi.stubGlobal('fetch', mocked.fetch);
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = originalEnv;
    vi.unstubAllGlobals();
  });

  describe('untrusted OAuth issuer host (lines 213-218)', () => {
    it('returns untrusted_oauth_host when issuer URL is not trusted', async () => {
      const jwt = makeJwt({
        iss: 'https://untrusted.example.com',
        azp: 'client-123',
        scp: 'openid',
      });

      const creds = JSON.stringify({
        mcpOAuth: {
          'srv|hash': {
            accessToken: jwt,
            refreshToken: 'refresh-tok',
            expiresAt: Date.now() - 120000,
          },
        },
      });
      mocked.readFileSync.mockReturnValue(creds);
      mocked.getTrustedOAuthHostsFromEnv.mockReturnValue(new Set(['auth.example.com']));
      mocked.isTrustedPublicHttpsUrl.mockReturnValue(false);

      const { refreshClaudeMcpOAuthToken } = await import('./claude-mcp-token-refresh.js');
      const result = await refreshClaudeMcpOAuthToken('srv');
      expect(result.refreshed).toBe(false);
      expect(result.reason).toBe('untrusted_oauth_host');
      expect(result.error).toContain('Untrusted OAuth issuer host');
    });
  });
});
