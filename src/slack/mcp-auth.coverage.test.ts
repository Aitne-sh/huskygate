/**
 * Coverage tests for src/slack/mcp-auth.ts
 * Targets: line 94 (catch block for invalid URL in extractOAuthUrl)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  getTrustedOAuthHostsFromEnv: vi.fn().mockReturnValue(null),
  isTrustedPublicHttpsUrl: vi.fn().mockReturnValue(true),
}));

vi.mock('../shared/oauth-security.js', () => ({
  getTrustedOAuthHostsFromEnv: mocked.getTrustedOAuthHostsFromEnv,
  isTrustedPublicHttpsUrl: mocked.isTrustedPublicHttpsUrl,
}));

import { extractOAuthUrl } from './mcp-auth.js';

describe('mcp-auth: extractOAuthUrl catch branch (line 94)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getTrustedOAuthHostsFromEnv.mockReturnValue(null);
  });

  it('skips URLs that throw in isTrustedPublicHttpsUrl and continues to next', () => {
    // First URL throws, second is valid
    mocked.isTrustedPublicHttpsUrl
      .mockImplementationOnce(() => {
        throw new Error('Invalid URL');
      })
      .mockReturnValueOnce(true);

    const content = 'Visit https://bad-url.example.com and https://good.example.com/oauth';
    const result = extractOAuthUrl(content);
    expect(result).toBe('https://good.example.com/oauth');
  });

  it('returns null when all URLs throw in isTrustedPublicHttpsUrl', () => {
    mocked.isTrustedPublicHttpsUrl.mockImplementation(() => {
      throw new Error('Invalid URL');
    });

    const content = 'Visit https://bad1.example.com and https://bad2.example.com';
    const result = extractOAuthUrl(content);
    expect(result).toBeNull();
  });
});
