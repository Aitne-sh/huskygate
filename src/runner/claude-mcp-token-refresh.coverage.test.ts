/** Coverage tests for claude-mcp-token-refresh. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../shared/constants.js', () => ({
  TIMEOUTS: { mcpTokenExpiryMargin: 60000 },
}));

describe('claude-mcp-token-refresh coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCredentialsPath', () => {
    it('uses CLAUDE_CONFIG_DIR when set', async () => {
      const orig = process.env.CLAUDE_CONFIG_DIR;
      process.env.CLAUDE_CONFIG_DIR = '/custom/dir';
      const { getCredentialsPath } = await import('./claude-mcp-token-refresh.js');
      const result = getCredentialsPath();
      expect(result).toContain('/custom/dir');
      expect(result).toContain('.credentials.json');
      if (orig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = orig;
    });

    it('ignores CLAUDE_CONFIG_DIR if set to "undefined" string', async () => {
      const orig = process.env.CLAUDE_CONFIG_DIR;
      process.env.CLAUDE_CONFIG_DIR = 'undefined';
      const { getCredentialsPath } = await import('./claude-mcp-token-refresh.js');
      const result = getCredentialsPath();
      expect(result).toContain('.claude');
      if (orig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = orig;
    });

    it('uses homedir when CLAUDE_CONFIG_DIR is not set', async () => {
      const orig = process.env.CLAUDE_CONFIG_DIR;
      delete process.env.CLAUDE_CONFIG_DIR;
      const { getCredentialsPath } = await import('./claude-mcp-token-refresh.js');
      const result = getCredentialsPath();
      expect(result).toContain('.claude');
      expect(result).toContain('.credentials.json');
      if (orig !== undefined) process.env.CLAUDE_CONFIG_DIR = orig;
    });
  });

  describe('decodeJwtPayload', () => {
    it('decodes valid JWT payload', async () => {
      const { decodeJwtPayload } = await import('./claude-mcp-token-refresh.js');
      const payload = { iss: 'https://auth.example.com', azp: 'client-id' };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const jwt = `header.${encoded}.signature`;
      const result = decodeJwtPayload(jwt);
      expect(result).toEqual(payload);
    });

    it('returns null for non-JWT string', async () => {
      const { decodeJwtPayload } = await import('./claude-mcp-token-refresh.js');
      expect(decodeJwtPayload('not-a-jwt')).toBeNull();
      expect(decodeJwtPayload('a.b')).toBeNull();
    });

    it('returns null for invalid base64 payload', async () => {
      const { decodeJwtPayload } = await import('./claude-mcp-token-refresh.js');
      expect(decodeJwtPayload('a.!!!invalid!!!.c')).toBeNull();
    });
  });

  describe('findMcpOAuthKey', () => {
    it('finds key by server name prefix', async () => {
      const { findMcpOAuthKey } = await import('./claude-mcp-token-refresh.js');
      const mcpOAuth = {
        'my-server|hash123': { accessToken: 'tok' },
        'other-server|hash456': { accessToken: 'tok2' },
      };
      expect(findMcpOAuthKey(mcpOAuth, 'my-server')).toBe('my-server|hash123');
    });

    it('returns null when not found', async () => {
      const { findMcpOAuthKey } = await import('./claude-mcp-token-refresh.js');
      expect(findMcpOAuthKey({}, 'missing')).toBeNull();
    });
  });

  describe('discoverTokenEndpoint', () => {
    it('returns null for non-https issuer', async () => {
      const { discoverTokenEndpoint } = await import('./claude-mcp-token-refresh.js');
      const result = await discoverTokenEndpoint('http://example.com');
      expect(result).toBeNull();
    });

    it('returns null for private IP issuer', async () => {
      const { discoverTokenEndpoint } = await import('./claude-mcp-token-refresh.js');
      const result = await discoverTokenEndpoint('https://127.0.0.1');
      expect(result).toBeNull();
    });
  });
});
