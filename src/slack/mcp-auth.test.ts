import { describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from '../runner/types.js';
import {
  detectMcpAuthRequiredResourceUrl,
  detectMcpAuthRequiredServer,
  detectToolNotFound,
  evaluateCodexMcpAuthLogin,
  evaluateGeminiMcpAuthPreflight,
  extractOAuthUrl,
  isMcpConnectionFailure,
  isMcpInteractiveAuthFailure,
  isMcpRuntimeWarning,
  isMcpTokenRefreshFailure,
  isOAuthFlowEvent,
} from './mcp-auth.js';

describe('detectMcpAuthRequiredServer', () => {
  it('extracts server from MCP auth-required line', () => {
    expect(
      detectMcpAuthRequiredServer(
        "MCP server 'aws-api' requires authentication using: /mcp auth aws-api",
      ),
    ).toBe('aws-api');
  });

  it('extracts server from Error-prefixed line', () => {
    expect(
      detectMcpAuthRequiredServer(
        "Error: MCP server 'aws-api' requires authentication using: /mcp auth aws-api",
      ),
    ).toBe('aws-api');
  });

  it('extracts server when JSON text is concatenated after auth line', () => {
    expect(
      detectMcpAuthRequiredServer(
        `MCP server 'aws-api' requires authentication using: /mcp auth aws-api{"type":"init","status":"ok"}`,
      ),
    ).toBe('aws-api');
  });

  it('extracts server from fallback auth-required line without MCP server prefix', () => {
    expect(detectMcpAuthRequiredServer('requires authentication using: /mcp auth aws-api')).toBe(
      'aws-api',
    );
  });

  it('returns null when unrelated', () => {
    expect(detectMcpAuthRequiredServer('Loading extension: Stitch')).toBeNull();
  });
});

describe('detectMcpAuthRequiredResourceUrl', () => {
  it('extracts resource URL from codex rmcp AuthRequired logs', () => {
    expect(
      detectMcpAuthRequiredResourceUrl(
        '2026-02-14T00:30:51.311975Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer realm=\\"mcp\\", resource=\\"http://localhost:8000/mcp\\", resource_metadata=\\"http://localhost:8000/.well-known/oauth-protected-resource/mcp\\", scope=\\"openid profile offline_access\\"" })',
      ),
    ).toBe('http://localhost:8000/mcp');
  });

  it('returns null when no resource URL exists', () => {
    expect(detectMcpAuthRequiredResourceUrl('Loading extension: Stitch')).toBeNull();
  });
});

describe('isMcpInteractiveAuthFailure', () => {
  it('detects interactive consent failures', () => {
    expect(
      isMcpInteractiveAuthFailure(
        'Error authenticating: FatalAuthenticationError: Interactive consent could not be obtained.',
      ),
    ).toBe(true);
  });

  it('returns false for non-auth lines', () => {
    expect(isMcpInteractiveAuthFailure('Hook registry initialized with 0 hook entries')).toBe(
      false,
    );
  });
});

describe('isMcpRuntimeWarning', () => {
  it('detects runtime discovery/auth warning lines', () => {
    expect(
      isMcpRuntimeWarning(
        "Error during discovery for MCP server 'aws-api': Protected resource does not match expected",
      ),
    ).toBe(true);
    expect(isMcpRuntimeWarning('Refreshing expired token for MCP server: aws-api')).toBe(true);
  });

  it('returns false for non-MCP lines', () => {
    expect(isMcpRuntimeWarning('Loading extension: Stitch')).toBe(false);
  });
});

describe('isMcpTokenRefreshFailure', () => {
  it('detects codex token refresh failure lines', () => {
    expect(
      isMcpTokenRefreshFailure(
        '2026-02-14T02:00:19.744877Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when Auth(TokenRefreshFailed("Server returned error response: upstream_token_error: upstream token refresh failed"))',
      ),
    ).toBe(true);
  });

  it('returns false for non-refresh lines', () => {
    expect(isMcpTokenRefreshFailure('Loading extension: Stitch')).toBe(false);
  });
});

describe('isMcpConnectionFailure', () => {
  it('detects MCP error -32000 connection closed', () => {
    expect(
      isMcpConnectionFailure(
        "Error: [MCP error] Error during discovery for MCP server 'awsapi': MCP error -32000: Connection closed",
      ),
    ).toBe(true);
  });

  it('detects Connection closed during discovery', () => {
    expect(
      isMcpConnectionFailure('Connection closed during discovery for MCP server aws-api'),
    ).toBe(true);
  });

  it('detects ECONNREFUSED', () => {
    expect(isMcpConnectionFailure('connect ECONNREFUSED 127.0.0.1:3000')).toBe(true);
  });

  it('detects ECONNRESET', () => {
    expect(isMcpConnectionFailure('read ECONNRESET')).toBe(true);
  });

  it('returns false for non-connection errors', () => {
    expect(isMcpConnectionFailure('Loading extension: Stitch')).toBe(false);
  });

  it('returns false for MCP auth required', () => {
    expect(
      isMcpConnectionFailure(
        "MCP server 'aws-api' requires authentication using: /mcp auth aws-api",
      ),
    ).toBe(false);
  });
});

describe('detectToolNotFound', () => {
  it('extracts missing tool from error line', () => {
    expect(
      detectToolNotFound(
        'Error executing tool aws_execute: Tool "aws_execute" not found. Did you mean one of: "ask_user"?',
      ),
    ).toEqual({
      requestedTool: 'aws_execute',
      missingTool: 'aws_execute',
    });
  });

  it('returns null for unrelated lines', () => {
    expect(detectToolNotFound('Error: Access denied by policy')).toBeNull();
  });

  it('falls back to empty strings when tool-not-found regex captures are missing', () => {
    const originalMatch = String.prototype.match;
    const matchSpy = vi.spyOn(String.prototype, 'match').mockImplementation(function (
      this: string,
      pattern: unknown,
    ) {
      if (pattern instanceof RegExp && pattern.source.includes('Error executing tool')) {
        return ['Error executing tool'] as unknown as RegExpMatchArray;
      }
      return originalMatch.call(this, pattern as never);
    });

    try {
      expect(detectToolNotFound('Error executing tool x')).toEqual({
        requestedTool: '',
        missingTool: '',
      });
    } finally {
      matchSpy.mockRestore();
    }
  });
});

describe('evaluateGeminiMcpAuthPreflight', () => {
  it('collects required server and interactive failure state', () => {
    const events: DriverEvent[] = [
      { type: 'status', content: 'Loaded cached credentials.' },
      {
        type: 'status',
        content: "MCP server 'aws-api' requires authentication using: /mcp auth aws-api",
      },
      {
        type: 'error',
        content:
          'Error authenticating: FatalAuthenticationError: Interactive consent could not be obtained.',
      },
    ];

    expect(evaluateGeminiMcpAuthPreflight(events)).toEqual({
      requiredServer: 'aws-api',
      interactiveFailure: true,
      oauthFlowStarted: false,
    });
  });

  it('detects oauth flow start from status lines', () => {
    const events: DriverEvent[] = [
      { type: 'status', content: 'Refreshing expired token for MCP server: aws-api' },
      {
        type: 'error',
        content: 'Dynamic client registration is supported at: http://localhost:8000/register',
      },
      { type: 'error', content: 'OAuth callback server listening on port 8080' },
    ];

    expect(evaluateGeminiMcpAuthPreflight(events)).toEqual({
      requiredServer: null,
      interactiveFailure: false,
      oauthFlowStarted: true,
    });
  });

  it('ignores non text/status/error events in preflight evaluation', () => {
    const events: DriverEvent[] = [
      { type: 'tool_use', content: 'Using tool: x' },
      {
        type: 'text',
        content: "MCP server 'aws-api' requires authentication using: /mcp auth aws-api",
      },
    ];

    expect(evaluateGeminiMcpAuthPreflight(events)).toEqual({
      requiredServer: 'aws-api',
      interactiveFailure: false,
      oauthFlowStarted: false,
    });
  });
});

describe('evaluateCodexMcpAuthLogin', () => {
  it('extracts required resource URL from codex auth error logs', () => {
    const events: DriverEvent[] = [
      { type: 'status', content: 'Loaded cached credentials.' },
      {
        type: 'error',
        content:
          '2026-02-14T00:30:51.311975Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer realm=\\"mcp\\", resource=\\"http://localhost:8000/mcp\\", resource_metadata=\\"http://localhost:8000/.well-known/oauth-protected-resource/mcp\\", scope=\\"openid profile offline_access\\"" })',
      },
    ];

    expect(evaluateCodexMcpAuthLogin(events)).toEqual({
      requiredServer: null,
      requiredResourceUrl: 'http://localhost:8000/mcp',
      tokenRefreshFailed: false,
    });
  });

  it('extracts required server from explicit auth-required line', () => {
    const events: DriverEvent[] = [
      {
        type: 'error',
        content: "MCP server 'aws-api' requires authentication using: /mcp auth aws-api",
      },
    ];

    expect(evaluateCodexMcpAuthLogin(events)).toEqual({
      requiredServer: 'aws-api',
      requiredResourceUrl: null,
      tokenRefreshFailed: false,
    });
  });

  it('flags token refresh failure events', () => {
    const events: DriverEvent[] = [
      {
        type: 'error',
        content:
          '2026-02-14T02:00:19.744877Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when Auth(TokenRefreshFailed("Server returned error response: upstream_token_error: upstream token refresh failed"))',
      },
    ];

    expect(evaluateCodexMcpAuthLogin(events)).toEqual({
      requiredServer: null,
      requiredResourceUrl: null,
      tokenRefreshFailed: true,
    });
  });

  it('ignores non text/status/error events in codex auth login evaluation', () => {
    const events: DriverEvent[] = [
      { type: 'tool_use', content: 'Using tool: x' },
      {
        type: 'text',
        content:
          'AuthRequired(AuthRequiredError { resource: "https://example.com/mcp", scope: "openid" })',
      },
    ];

    expect(evaluateCodexMcpAuthLogin(events)).toEqual({
      requiredServer: null,
      requiredResourceUrl: 'https://example.com/mcp',
      tokenRefreshFailed: false,
    });
  });
});

describe('isOAuthFlowEvent', () => {
  it('detects OAuth flow status messages', () => {
    expect(isOAuthFlowEvent('Starting OAuth authentication for server aws-api')).toBe(true);
    expect(isOAuthFlowEvent('OAuth callback server listening on port 8080')).toBe(true);
    expect(isOAuthFlowEvent('Refreshing expired token for MCP server: aws-api')).toBe(true);
    expect(
      isOAuthFlowEvent('Dynamic client registration is supported at: http://example.com/register'),
    ).toBe(true);
  });

  it('returns false for non-OAuth content', () => {
    expect(isOAuthFlowEvent('Loading extension: Stitch')).toBe(false);
    expect(isOAuthFlowEvent('MCP auth check complete')).toBe(false);
  });

  it('strips Error: prefix before matching', () => {
    expect(isOAuthFlowEvent('Error: OAuth callback server listening on port 8080')).toBe(true);
  });
});

describe('extractOAuthUrl', () => {
  it('returns null for empty string', () => {
    expect(extractOAuthUrl('')).toBeNull();
  });

  it('returns null when no URL is present', () => {
    expect(extractOAuthUrl('Starting OAuth authentication for server aws-api')).toBeNull();
  });

  it('returns null for localhost URLs', () => {
    expect(extractOAuthUrl('Visit https://localhost:8080/callback to continue')).toBeNull();
    expect(extractOAuthUrl('Visit https://127.0.0.1:8080/callback to continue')).toBeNull();
  });

  it('returns null for link-local IP URLs', () => {
    expect(extractOAuthUrl('Visit https://169.254.10.20/callback to continue')).toBeNull();
  });

  it('returns null for private network IP URLs', () => {
    expect(extractOAuthUrl('Visit https://10.0.0.5/callback to continue')).toBeNull();
    expect(extractOAuthUrl('Visit https://172.16.0.10/callback to continue')).toBeNull();
    expect(extractOAuthUrl('Visit https://192.168.1.99/callback to continue')).toBeNull();
  });

  it('returns null for private or loopback IPv6 URLs', () => {
    expect(extractOAuthUrl('Visit https://[::1]/callback to continue')).toBeNull();
    expect(extractOAuthUrl('Visit https://[fe80::1]/callback to continue')).toBeNull();
    expect(extractOAuthUrl('Visit https://[fd00::1234]/callback to continue')).toBeNull();
    expect(extractOAuthUrl('Visit https://[::ffff:127.0.0.1]/callback to continue')).toBeNull();
  });

  it('extracts a non-localhost HTTPS URL', () => {
    expect(
      extractOAuthUrl('Please visit https://accounts.google.com/o/oauth2/auth to authenticate'),
    ).toBe('https://accounts.google.com/o/oauth2/auth');
  });

  it('prefers URLs with OAuth query params over plain URLs', () => {
    const content =
      'Visit https://example.com/docs or https://auth.example.com/authorize?client_id=abc&response_type=code';
    expect(extractOAuthUrl(content)).toBe(
      'https://auth.example.com/authorize?client_id=abc&response_type=code',
    );
  });

  it('handles trailing punctuation', () => {
    expect(extractOAuthUrl('Open https://auth.example.com/login.')).toBe(
      'https://auth.example.com/login',
    );
    expect(extractOAuthUrl('URL: https://auth.example.com/login)')).toBe(
      'https://auth.example.com/login',
    );
  });

  it('falls back to first non-localhost URL when no OAuth params present', () => {
    expect(extractOAuthUrl('Visit https://auth.example.com/start to begin')).toBe(
      'https://auth.example.com/start',
    );
  });

  it('skips HTTP (non-HTTPS) URLs', () => {
    expect(extractOAuthUrl('Visit http://auth.example.com/login to continue')).toBeNull();
  });

  it('skips malformed URLs that match regex but fail URL parsing', () => {
    // The regex matches https://... but new URL() rejects it
    expect(extractOAuthUrl('See https://[')).toBeNull();
  });

  it('enforces trusted hosts allowlist when configured', () => {
    const original = process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS;
    process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS =
      ' accounts.google.com, login.microsoftonline.com , , ';
    try {
      const content =
        'Open https://evil.example.com/login?client_id=x and https://accounts.google.com/o/oauth2/auth?client_id=abc';
      expect(extractOAuthUrl(content)).toBe(
        'https://accounts.google.com/o/oauth2/auth?client_id=abc',
      );
    } finally {
      if (original === undefined) {
        delete process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS;
      } else {
        process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS = original;
      }
    }
  });

  it('returns null when allowlist is configured but no host is trusted', () => {
    const original = process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS;
    process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS = 'accounts.google.com';
    try {
      expect(
        extractOAuthUrl(
          'Visit https://evil.example.com/authorize?client_id=abc&response_type=code',
        ),
      ).toBeNull();
    } finally {
      if (original === undefined) {
        delete process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS;
      } else {
        process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS = original;
      }
    }
  });
});
