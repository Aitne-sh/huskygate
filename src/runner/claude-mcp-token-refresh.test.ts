import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeJwtPayload,
  discoverTokenEndpoint,
  findMcpOAuthKey,
  getCredentialsPath,
  refreshClaudeMcpOAuthToken,
} from './claude-mcp-token-refresh.js';

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

function encodeJwtSegment(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function buildJwt(payload: Record<string, unknown>): string {
  const header = encodeJwtSegment({ alg: 'RS256', typ: 'JWT' });
  const body = encodeJwtSegment(payload);
  return `${header}.${body}.fakesig`;
}

// ---------------------------------------------------------------------------
// decodeJwtPayload
// ---------------------------------------------------------------------------

describe('decodeJwtPayload', () => {
  it('decodes a valid JWT payload', () => {
    const payload = { iss: 'https://login.microsoftonline.com/tenant-id/v2.0', azp: 'client-123' };
    const jwt = buildJwt(payload);
    const result = decodeJwtPayload(jwt);
    expect(result).toMatchObject(payload);
  });

  it('returns null for non-JWT strings', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('')).toBeNull();
    expect(decodeJwtPayload('a.b')).toBeNull();
  });

  it('returns null for invalid base64 payload', () => {
    expect(decodeJwtPayload('header.!!!invalid!!!.sig')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findMcpOAuthKey
// ---------------------------------------------------------------------------

describe('findMcpOAuthKey', () => {
  const mcpOAuth = {
    'aws-api|abc123': { accessToken: 'x', refreshToken: 'y', expiresAt: 0 },
    'other-server|def456': { accessToken: 'a', refreshToken: 'b', expiresAt: 0 },
  };

  it('finds key matching server name prefix', () => {
    expect(findMcpOAuthKey(mcpOAuth, 'aws-api')).toBe('aws-api|abc123');
  });

  it('finds key for other server', () => {
    expect(findMcpOAuthKey(mcpOAuth, 'other-server')).toBe('other-server|def456');
  });

  it('returns null when server not found', () => {
    expect(findMcpOAuthKey(mcpOAuth, 'nonexistent')).toBeNull();
  });

  it('does not partial-match server names', () => {
    expect(findMcpOAuthKey(mcpOAuth, 'aws')).toBeNull();
  });
});

describe('getCredentialsPath', () => {
  it('uses CLAUDE_CONFIG_DIR when configured', () => {
    const hadOriginal = Object.prototype.hasOwnProperty.call(process.env, 'CLAUDE_CONFIG_DIR');
    const original = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = '/tmp/custom-claude';
    try {
      expect(getCredentialsPath()).toBe('/tmp/custom-claude/.credentials.json');
    } finally {
      if (hadOriginal) {
        process.env.CLAUDE_CONFIG_DIR = original;
      } else {
        delete process.env.CLAUDE_CONFIG_DIR;
      }
    }
  });

  it('defaults to ~/.claude/.credentials.json when CLAUDE_CONFIG_DIR is unset', () => {
    const hadOriginal = Object.prototype.hasOwnProperty.call(process.env, 'CLAUDE_CONFIG_DIR');
    const original = process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CLAUDE_CONFIG_DIR;
    try {
      expect(getCredentialsPath().endsWith('/.claude/.credentials.json')).toBe(true);
    } finally {
      if (hadOriginal) {
        process.env.CLAUDE_CONFIG_DIR = original;
      } else {
        delete process.env.CLAUDE_CONFIG_DIR;
      }
    }
  });

  it('treats missing CLAUDE_CONFIG_DIR as undefined (not string)', () => {
    const hadOriginal = Object.prototype.hasOwnProperty.call(process.env, 'CLAUDE_CONFIG_DIR');
    const original = process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CLAUDE_CONFIG_DIR;
    try {
      expect(getCredentialsPath().endsWith('/.claude/.credentials.json')).toBe(true);
    } finally {
      if (hadOriginal) {
        process.env.CLAUDE_CONFIG_DIR = original;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// discoverTokenEndpoint
// ---------------------------------------------------------------------------

describe('discoverTokenEndpoint', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('extracts token_endpoint from OIDC discovery', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token_endpoint: 'https://login.microsoftonline.com/tenant/oauth2/v2.0/token',
        issuer: 'https://login.microsoftonline.com/tenant/v2.0',
      }),
    }) as unknown as typeof fetch;

    const result = await discoverTokenEndpoint('https://login.microsoftonline.com/tenant/v2.0', {
      trustedHosts: new Set(['login.microsoftonline.com']),
      requireTrustedHosts: true,
    });
    expect(result).toBe('https://login.microsoftonline.com/tenant/oauth2/v2.0/token');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://login.microsoftonline.com/tenant/v2.0/.well-known/openid-configuration',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('strips trailing slash from issuer', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token_endpoint: 'https://example.com/token',
      }),
    }) as unknown as typeof fetch;

    await discoverTokenEndpoint('https://example.com/issuer/', {
      trustedHosts: new Set(['example.com']),
      requireTrustedHosts: true,
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://example.com/issuer/.well-known/openid-configuration',
      expect.any(Object),
    );
  });

  it('returns null on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof fetch;

    expect(
      await discoverTokenEndpoint('https://example.com', {
        trustedHosts: new Set(['example.com']),
        requireTrustedHosts: true,
      }),
    ).toBeNull();
  });

  it('returns null on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
    expect(
      await discoverTokenEndpoint('https://example.com', {
        trustedHosts: new Set(['example.com']),
        requireTrustedHosts: true,
      }),
    ).toBeNull();
  });

  it('returns null when token_endpoint is missing from response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ issuer: 'https://example.com' }),
    }) as unknown as typeof fetch;

    expect(
      await discoverTokenEndpoint('https://example.com', {
        trustedHosts: new Set(['example.com']),
        requireTrustedHosts: true,
      }),
    ).toBeNull();
  });

  it('returns null when discovery yields an untrusted token endpoint host', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token_endpoint: 'https://evil.example/token' }),
    }) as unknown as typeof fetch;

    expect(
      await discoverTokenEndpoint('https://example.com', {
        trustedHosts: new Set(['example.com']),
        requireTrustedHosts: true,
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// refreshClaudeMcpOAuthToken (integration-style with mocked fs/fetch)
// ---------------------------------------------------------------------------

// vi.hoisted ensures these are available when vi.mock runs (hoisted to top)
const { readSyncMock, writeSyncMock, renameSyncMock } = vi.hoisted(() => ({
  readSyncMock: vi.fn(),
  writeSyncMock: vi.fn(),
  renameSyncMock: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readFileSync: readSyncMock,
  writeFileSync: writeSyncMock,
  renameSync: renameSyncMock,
}));

describe('refreshClaudeMcpOAuthToken', () => {
  const originalFetch = globalThis.fetch;
  const originalTrustedHosts = process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS;

  const tenant = 'test-tenant-id';
  const clientId = 'test-client-id';
  const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
  const tokenEndpoint = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

  const jwtPayload = { iss: issuer, azp: clientId, scp: 'api://scope/.default' };
  const jwt = buildJwt(jwtPayload);

  function makeCredentials(overrides?: {
    expiresAt?: number;
    accessToken?: string;
    refreshToken?: string;
  }) {
    return {
      mcpOAuth: {
        'aws-api|hash123': {
          accessToken: overrides?.accessToken ?? jwt,
          refreshToken: overrides?.refreshToken ?? 'refresh-tok',
          expiresAt: overrides?.expiresAt ?? 0,
        },
      },
    };
  }

  beforeEach(() => {
    readSyncMock.mockReset();
    writeSyncMock.mockReset();
    renameSyncMock.mockReset();
    process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS =
      'login.microsoftonline.com,oauth2.googleapis.com,example.com';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalTrustedHosts === undefined) {
      delete process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS;
    } else {
      process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS = originalTrustedHosts;
    }
  });

  it('returns not_expired when token is still valid', async () => {
    const creds = makeCredentials({ expiresAt: Date.now() + 300_000 });
    readSyncMock.mockReturnValue(JSON.stringify(creds));

    const result = await refreshClaudeMcpOAuthToken('aws-api');
    expect(result).toEqual({ refreshed: false, reason: 'not_expired' });
  });

  it('returns no_credentials_file when file does not exist', async () => {
    readSyncMock.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = await refreshClaudeMcpOAuthToken('aws-api');
    expect(result).toEqual({ refreshed: false, reason: 'no_credentials_file' });
  });

  it('returns no_mcp_oauth when mcpOAuth section is missing', async () => {
    readSyncMock.mockReturnValue(JSON.stringify({}));

    const result = await refreshClaudeMcpOAuthToken('aws-api');
    expect(result).toEqual({ refreshed: false, reason: 'no_mcp_oauth' });
  });

  it('returns server_not_found when server key does not match', async () => {
    const creds = makeCredentials();
    readSyncMock.mockReturnValue(JSON.stringify(creds));

    const result = await refreshClaudeMcpOAuthToken('nonexistent-server');
    expect(result).toEqual({ refreshed: false, reason: 'server_not_found' });
  });

  it('returns server_not_found when access or refresh token is missing', async () => {
    readSyncMock.mockReturnValue(
      JSON.stringify({
        mcpOAuth: {
          'aws-api|hash123': {
            accessToken: jwt,
            expiresAt: Date.now() - 1000,
          },
        },
      }),
    );

    const result = await refreshClaudeMcpOAuthToken('aws-api');
    expect(result).toEqual({ refreshed: false, reason: 'server_not_found' });
  });

  it('refreshes expired token successfully', async () => {
    const creds = makeCredentials({ expiresAt: Date.now() - 1000 });
    readSyncMock.mockReturnValue(JSON.stringify(creds));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token_endpoint: tokenEndpoint }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        }),
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await refreshClaudeMcpOAuthToken('aws-api');
    expect(result).toEqual({ refreshed: true, reason: 'success' });

    // Verify credentials were written
    expect(writeSyncMock).toHaveBeenCalledTimes(1);
    const writeCall = writeSyncMock.mock.calls[0] as [string, string, object];
    const writtenData = JSON.parse(writeCall[1]);
    expect(writtenData.mcpOAuth['aws-api|hash123'].accessToken).toBe('new-access-token');
    expect(writtenData.mcpOAuth['aws-api|hash123'].refreshToken).toBe('new-refresh-token');
    expect(writtenData.mcpOAuth['aws-api|hash123'].expiresAt).toBeGreaterThan(Date.now());
  });

  it('returns refresh_failed when upstream returns OAuth error', async () => {
    const creds = makeCredentials({ expiresAt: Date.now() - 1000 });
    readSyncMock.mockReturnValue(JSON.stringify(creds));

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token_endpoint: tokenEndpoint }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'Refresh token has expired',
        }),
      }) as unknown as typeof fetch;

    const result = await refreshClaudeMcpOAuthToken('aws-api');
    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe('refresh_failed');
    expect(result.error).toContain('Refresh token has expired');
  });

  it('falls back to OAuth error code when error_description is missing', async () => {
    const creds = makeCredentials({ expiresAt: Date.now() - 1000 });
    readSyncMock.mockReturnValue(JSON.stringify(creds));

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token_endpoint: tokenEndpoint }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: 'invalid_grant',
        }),
      }) as unknown as typeof fetch;

    const result = await refreshClaudeMcpOAuthToken('aws-api');
    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe('refresh_failed');
    expect(result.error).toBe('invalid_grant');
  });

  it('returns discovery_failed when OIDC discovery fails', async () => {
    const creds = makeCredentials({ expiresAt: Date.now() - 1000 });
    readSyncMock.mockReturnValue(JSON.stringify(creds));

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    }) as unknown as typeof fetch;

    const result = await refreshClaudeMcpOAuthToken('aws-api');
    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe('discovery_failed');
  });

  it('returns untrusted_oauth_host when trusted hosts are not configured', async () => {
    delete process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS;
    const creds = makeCredentials({ expiresAt: Date.now() - 1000 });
    readSyncMock.mockReturnValue(JSON.stringify(creds));

    const result = await refreshClaudeMcpOAuthToken('aws-api');
    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe('untrusted_oauth_host');
  });

  it('returns discovery_failed when token endpoint host is not trusted', async () => {
    const creds = makeCredentials({ expiresAt: Date.now() - 1000 });
    readSyncMock.mockReturnValue(JSON.stringify(creds));

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token_endpoint: 'https://evil.example/token' }),
    }) as unknown as typeof fetch;

    const result = await refreshClaudeMcpOAuthToken('aws-api');
    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe('discovery_failed');
  });

  it('returns jwt_parse_failed when JWT is invalid', async () => {
    const creds = makeCredentials({ accessToken: 'not-a-jwt' });
    readSyncMock.mockReturnValue(JSON.stringify(creds));

    const result = await refreshClaudeMcpOAuthToken('aws-api');
    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe('jwt_parse_failed');
  });

  it('returns jwt_parse_failed when JWT claims are missing', async () => {
    const incompleteJwt = buildJwt({ iss: issuer });
    const creds = makeCredentials({ accessToken: incompleteJwt });
    readSyncMock.mockReturnValue(JSON.stringify(creds));

    const result = await refreshClaudeMcpOAuthToken('aws-api');
    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe('jwt_parse_failed');
    expect(result.error).toContain('Missing iss or azp');
  });

  it('preserves existing refresh token when upstream omits it', async () => {
    const creds = makeCredentials({ expiresAt: Date.now() - 1000 });
    readSyncMock.mockReturnValue(JSON.stringify(creds));

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token_endpoint: tokenEndpoint }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          expires_in: 3600,
        }),
      }) as unknown as typeof fetch;

    const result = await refreshClaudeMcpOAuthToken('aws-api');
    expect(result).toEqual({ refreshed: true, reason: 'success' });

    const writeCall = writeSyncMock.mock.calls[0] as [string, string, object];
    const writtenData = JSON.parse(writeCall[1]);
    expect(writtenData.mcpOAuth['aws-api|hash123'].refreshToken).toBe('refresh-tok');
  });

  it('keeps scope unchanged when it already includes offline_access', async () => {
    readSyncMock.mockReturnValue(
      JSON.stringify({
        mcpOAuth: {
          'aws-api|hash123': {
            accessToken: jwt,
            refreshToken: 'refresh-tok',
            expiresAt: Date.now() - 1000,
            scope: 'api://scope/.default offline_access',
          },
        },
      }),
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token_endpoint: tokenEndpoint }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        }),
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await refreshClaudeMcpOAuthToken('aws-api');
    expect(result).toEqual({ refreshed: true, reason: 'success' });

    const tokenReq = fetchMock.mock.calls[1]?.[1] as { body?: string };
    expect(tokenReq.body).toContain('offline_access');
    expect(tokenReq.body?.match(/offline_access/g)?.length).toBe(1);
  });

  it('falls back to empty scope when entry scope and jwt scp are unusable', async () => {
    const jwtWithoutStringScope = buildJwt({
      iss: issuer,
      azp: clientId,
      scp: 123,
    });
    readSyncMock.mockReturnValue(
      JSON.stringify({
        mcpOAuth: {
          'aws-api|hash123': {
            accessToken: jwtWithoutStringScope,
            refreshToken: 'refresh-tok',
            expiresAt: Date.now() - 1000,
          },
        },
      }),
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token_endpoint: tokenEndpoint }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        }),
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await refreshClaudeMcpOAuthToken('aws-api');
    expect(result).toEqual({ refreshed: true, reason: 'success' });

    const tokenReq = fetchMock.mock.calls[1]?.[1] as { body?: string };
    expect(tokenReq.body).toContain('scope=offline_access');
  });

  it('returns refresh_failed when token endpoint request throws', async () => {
    const creds = makeCredentials({ expiresAt: Date.now() - 1000 });
    readSyncMock.mockReturnValue(JSON.stringify(creds));

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token_endpoint: tokenEndpoint }),
      })
      .mockRejectedValueOnce(new Error('token endpoint down')) as unknown as typeof fetch;

    const result = await refreshClaudeMcpOAuthToken('aws-api');
    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe('refresh_failed');
    expect(result.error).toContain('token endpoint down');
  });

  it('returns refresh_failed for invalid token response payload', async () => {
    const creds = makeCredentials({ expiresAt: Date.now() - 1000 });
    readSyncMock.mockReturnValue(JSON.stringify(creds));

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token_endpoint: tokenEndpoint }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 123,
          expires_in: '3600',
        }),
      }) as unknown as typeof fetch;

    const result = await refreshClaudeMcpOAuthToken('aws-api');
    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe('refresh_failed');
    expect(result.error).toContain('Invalid token response');
  });

  it('returns refresh_failed when credentials write-back fails', async () => {
    const creds = makeCredentials({ expiresAt: Date.now() - 1000 });
    readSyncMock.mockReturnValue(JSON.stringify(creds));
    writeSyncMock.mockImplementation(() => {
      throw new Error('disk full');
    });

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token_endpoint: tokenEndpoint }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        }),
      }) as unknown as typeof fetch;

    const result = await refreshClaudeMcpOAuthToken('aws-api');
    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe('refresh_failed');
    expect(result.error).toContain('Failed to write credentials');
  });

  it('returns credentials_changed when the credentials entry disappears before write-back', async () => {
    const creds = makeCredentials({ expiresAt: Date.now() - 1000 });
    readSyncMock
      .mockReturnValueOnce(JSON.stringify(creds))
      .mockReturnValueOnce(JSON.stringify({ mcpOAuth: {} }));

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token_endpoint: tokenEndpoint }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        }),
      }) as unknown as typeof fetch;

    const result = await refreshClaudeMcpOAuthToken('aws-api');
    expect(result.refreshed).toBe(false);
    expect(result.reason).toBe('credentials_changed');
    expect(writeSyncMock).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent refresh requests for the same server', async () => {
    const creds = makeCredentials({ expiresAt: Date.now() - 1000 });
    readSyncMock.mockReturnValue(JSON.stringify(creds));

    let resolveTokenResponse: ((value: Response) => void) | undefined;
    const tokenResponsePromise = new Promise<Response>((resolve) => {
      resolveTokenResponse = resolve;
    });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token_endpoint: tokenEndpoint }),
      })
      .mockImplementationOnce(
        () => tokenResponsePromise as Promise<Response>,
      ) as unknown as typeof fetch;

    const first = refreshClaudeMcpOAuthToken('aws-api');
    const second = refreshClaudeMcpOAuthToken('aws-api');
    const resolveToken = resolveTokenResponse;
    if (!resolveToken) {
      throw new Error('Expected token response resolver to be initialized');
    }
    resolveToken({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      }),
    } as Response);

    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual({ refreshed: true, reason: 'success' });
    expect(b).toEqual({ refreshed: true, reason: 'success' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(writeSyncMock).toHaveBeenCalledTimes(1);
  });
});
