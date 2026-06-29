import { describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from '../../runner/types.js';
import {
  evaluateClaudeMcpAuthPreflight,
  formatClaudeMcpApprovalPrompt,
  formatClaudeMcpAuthGenericFailureMessage,
  formatClaudeMcpAuthLoopPreventionMessage,
  formatClaudeMcpAuthRequiredMessage,
  isClaudeMcpPreflightBypassed,
  isClaudeMcpPreflightVerified,
  markClaudeMcpPreflightVerified,
  parseClaudeMcpListLine,
  runClaudeMcpAuthCommand,
  runClaudeMcpList,
} from './claude.js';

describe('parseClaudeMcpListLine', () => {
  it('parses connected server with HTTP protocol', () => {
    const result = parseClaudeMcpListLine(
      'aws-api: http://localhost:8000/mcp (HTTP) - ✓ Connected',
    );
    expect(result).toEqual({
      name: 'aws-api',
      url: 'http://localhost:8000/mcp',
      connected: true,
      needsAuth: false,
      statusText: 'Connected',
    });
  });

  it('parses server needing authentication', () => {
    const result = parseClaudeMcpListLine(
      'aws-api: http://localhost:8000/mcp (HTTP) - ! Needs authentication',
    );
    expect(result).toEqual({
      name: 'aws-api',
      url: 'http://localhost:8000/mcp',
      connected: false,
      needsAuth: true,
      statusText: 'Needs authentication',
    });
  });

  it('parses server name with spaces (e.g. claude.ai Notion)', () => {
    const result = parseClaudeMcpListLine(
      'claude.ai Notion: https://mcp.notion.com/mcp - ✓ Connected',
    );
    expect(result).toEqual({
      name: 'claude.ai Notion',
      url: 'https://mcp.notion.com/mcp',
      connected: true,
      needsAuth: false,
      statusText: 'Connected',
    });
  });

  it('parses server with query params in URL', () => {
    const result = parseClaudeMcpListLine(
      'claude.ai Hugging Face: https://huggingface.co/mcp?login&gradio=none - ! Needs authentication',
    );
    expect(result).toEqual({
      name: 'claude.ai Hugging Face',
      url: 'https://huggingface.co/mcp?login&gradio=none',
      connected: false,
      needsAuth: true,
      statusText: 'Needs authentication',
    });
  });

  it('returns null for header/status lines', () => {
    expect(parseClaudeMcpListLine('Checking MCP server health...')).toBeNull();
    expect(parseClaudeMcpListLine('')).toBeNull();
    expect(parseClaudeMcpListLine('   ')).toBeNull();
  });

  it('returns null for non-server lines', () => {
    expect(parseClaudeMcpListLine('Some random text')).toBeNull();
    expect(parseClaudeMcpListLine('---')).toBeNull();
  });

  it('returns null when parsed match has no server name capture', () => {
    const originalMatch = String.prototype.match;
    const matchSpy = vi.spyOn(String.prototype, 'match').mockImplementation(function (
      this: string,
      pattern: unknown,
    ) {
      if (pattern instanceof RegExp && pattern.source.includes('^(.+?):\\s+(https?:\\/\\/\\S+)')) {
        return ['raw'] as unknown as RegExpMatchArray;
      }
      return originalMatch.call(this, pattern as never);
    });

    try {
      expect(parseClaudeMcpListLine('aws-api: http://localhost - ✓ Connected')).toBeNull();
    } finally {
      matchSpy.mockRestore();
    }
  });

  it('handles missing url/status captures with safe defaults', () => {
    const originalMatch = String.prototype.match;
    const matchSpy = vi.spyOn(String.prototype, 'match').mockImplementation(function (
      this: string,
      pattern: unknown,
    ) {
      if (pattern instanceof RegExp && pattern.source.includes('^(.+?):\\s+(https?:\\/\\/\\S+)')) {
        return ['raw', 'aws-api'] as unknown as RegExpMatchArray;
      }
      return originalMatch.call(this, pattern as never);
    });

    try {
      expect(parseClaudeMcpListLine('aws-api: http://localhost - ✓ Connected')).toEqual({
        name: 'aws-api',
        url: null,
        connected: false,
        needsAuth: false,
        statusText: null,
      });
    } finally {
      matchSpy.mockRestore();
    }
  });
});

describe('Claude MCP helper utilities', () => {
  it('handles state markers and message formatting', () => {
    expect(isClaudeMcpPreflightVerified({}, 'aws-api')).toBe(false);
    expect(isClaudeMcpPreflightBypassed({}, 'aws-api')).toBe(false);
    expect(
      isClaudeMcpPreflightVerified({ claude_mcp_auth_verified_server: 'aws-api' }, 'aws-api'),
    ).toBe(true);
    expect(
      isClaudeMcpPreflightBypassed({ claude_mcp_auth_bypass_server: 'aws-api' }, 'aws-api'),
    ).toBe(true);
    expect(
      isClaudeMcpPreflightVerified({ claude_mcp_auth_verified_server: '   ' }, 'aws-api'),
    ).toBe(false);
    expect(isClaudeMcpPreflightBypassed({ claude_mcp_auth_bypass_server: '   ' }, 'aws-api')).toBe(
      false,
    );

    expect(markClaudeMcpPreflightVerified({ x: 1 }, 'aws-api')).toEqual({
      x: 1,
      claude_mcp_auth_verified_server: 'aws-api',
    });

    expect(formatClaudeMcpAuthRequiredMessage('aws-api')).toContain('`/mcp auth aws-api`');
    expect(formatClaudeMcpAuthGenericFailureMessage('aws-api', 1, 'exit_1')).toContain(
      '(error=exit_1, exit=1)',
    );
    expect(formatClaudeMcpAuthGenericFailureMessage('aws-api', 0, 'server_not_found')).toContain(
      'was not found in `claude mcp list`',
    );
    expect(formatClaudeMcpAuthGenericFailureMessage('aws-api', null, null)).toContain(
      'failed. Resolve authentication',
    );
    expect(formatClaudeMcpAuthLoopPreventionMessage('aws-api')).toContain('approval loop');

    expect(
      formatClaudeMcpApprovalPrompt(
        { action: 'skip_preflight_once', prompt: null, server: 'aws-api' },
        30,
      ),
    ).toContain('proceed without MCP auth check');
    expect(
      formatClaudeMcpApprovalPrompt(
        { action: 'retry_with_preauth', prompt: null, server: 'aws-api' },
        30,
      ),
    ).toContain('retry with pre-auth');
  });

  it('evaluates preflight flags from mixed events', () => {
    const events: DriverEvent[] = [
      {
        type: 'status',
        content: "MCP server 'aws-api' requires authentication using: /mcp auth aws-api",
      },
      {
        type: 'error',
        content: 'Error authenticating: FatalAuthenticationError',
      },
      {
        type: 'text',
        content: 'token refresh failed',
      },
    ];

    const out = evaluateClaudeMcpAuthPreflight(events);
    expect(out.requiredServer).toBe('aws-api');
    expect(out.interactiveFailure).toBe(true);
    expect(out.tokenRefreshFailed).toBe(true);
    expect(out.mcpWarningSeen).toBe(true);
  });
});

describe('Claude MCP command runners', () => {
  it('collects mcp list servers across status/text/error events', async () => {
    const run = vi
      .fn()
      .mockImplementation(
        async (
          _driver: unknown,
          args: string[],
          _env: Record<string, string>,
          _cwd: string,
          onEvent: (event: DriverEvent) => void,
        ) => {
          expect(args).toEqual(['mcp', 'list']);
          onEvent({
            type: 'status',
            content: 'aws-api: http://localhost:8000/mcp (HTTP) - ✓ Connected',
          });
          onEvent({
            type: 'error',
            content: 'blender: http://localhost:9000/mcp (HTTP) - ! Needs authentication',
          });
          onEvent({
            type: 'text',
            content: 'aws-api: http://localhost:8000/mcp (HTTP) - ✓ Connected',
          });
          return { exitCode: 0, errorKind: null, events: [] };
        },
      );

    const out = await runClaudeMcpList({ run } as never, {}, '/tmp');
    expect(out.exitCode).toBe(0);
    expect(out.errorKind).toBeNull();
    expect(out.servers).toEqual([
      {
        name: 'aws-api',
        url: 'http://localhost:8000/mcp',
        connected: true,
        needsAuth: false,
        statusText: 'Connected',
      },
      {
        name: 'blender',
        url: 'http://localhost:9000/mcp',
        connected: false,
        needsAuth: true,
        statusText: 'Needs authentication',
      },
    ]);
  });

  it('ignores non text/status/error events while collecting mcp list servers', async () => {
    const run = vi
      .fn()
      .mockImplementation(
        async (
          _driver: unknown,
          _args: string[],
          _env: Record<string, string>,
          _cwd: string,
          onEvent: (event: DriverEvent) => void,
        ) => {
          onEvent({ type: 'tool_use', content: 'ignore me' });
          onEvent({
            type: 'text',
            content: 'aws-api: http://localhost:8000/mcp (HTTP) - ✓ Connected',
          });
          return { exitCode: 0, errorKind: null, events: [] };
        },
      );

    const out = await runClaudeMcpList({ run } as never, {}, '/tmp');
    expect(out.servers).toEqual([
      {
        name: 'aws-api',
        url: 'http://localhost:8000/mcp',
        connected: true,
        needsAuth: false,
        statusText: 'Connected',
      },
    ]);
  });

  it('runs /mcp auth command and reports interactive failure', async () => {
    const run = vi
      .fn()
      .mockImplementation(
        async (
          _driver: unknown,
          args: string[],
          _env: Record<string, string>,
          _cwd: string,
          onEvent: (event: DriverEvent) => void,
        ) => {
          expect(args).toEqual([
            '-p',
            '/mcp auth aws-api',
            '--output-format',
            'stream-json',
            '--verbose',
          ]);
          onEvent({
            type: 'status',
            content: 'Error authenticating: FatalAuthenticationError',
          });
          return { exitCode: 1, errorKind: 'exit_1', events: [] };
        },
      );

    const out = await runClaudeMcpAuthCommand({ run } as never, {}, '/tmp', 'aws-api');
    expect(out.ok).toBe(false);
    expect(out.interactiveFailure).toBe(true);
    expect(out.errorKind).toBe('exit_1');
  });
});
