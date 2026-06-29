import { describe, expect, it, vi } from 'vitest';
import type { DriverEvent, RunResult } from '../../runner/types.js';
import {
  formatGeminiMcpApprovalPrompt,
  formatGeminiMcpAuthGenericFailureMessage,
  formatGeminiMcpAuthInteractiveFailureMessage,
  formatGeminiMcpAuthLoopPreventionMessage,
  formatGeminiMcpAuthOAuthUrlMessage,
  formatGeminiMcpAuthRequiredMessage,
  formatGeminiMcpAuthWaitingMessage,
  formatGeminiMissingToolMessage,
  isGeminiMcpPreflightBypassed,
  isGeminiMcpPreflightInitialized,
  markGeminiMcpPreflightInitialized,
  markGeminiMcpPreflightVerified,
  runGeminiInteractiveMcpAuth,
  runGeminiMcpAuthPreflight,
} from './gemini.js';

function createFakeRunner(
  result: RunResult,
  events: DriverEvent[],
): {
  run: (
    driver: unknown,
    args: string[],
    env: Record<string, string>,
    cwd: string,
    onEvent: (event: DriverEvent) => void,
  ) => Promise<RunResult>;
} {
  return {
    run: vi.fn(async (_driver, _args, _env, _cwd, onEvent) => {
      for (const event of events) {
        onEvent(event);
      }
      return result;
    }),
  };
}

describe('gemini MCP helper formatting', () => {
  it('formats required and interactive failure messages', () => {
    expect(formatGeminiMcpAuthRequiredMessage('aws-api')).toContain('/mcp auth aws-api');
    expect(formatGeminiMcpAuthInteractiveFailureMessage('aws-api')).toContain(
      'NO_BROWSER=true gemini -i "/mcp auth aws-api"',
    );
    expect(formatGeminiMcpAuthLoopPreventionMessage('aws-api')).toContain('approval loop');
  });

  it('formats generic failure details when provided', () => {
    expect(formatGeminiMcpAuthGenericFailureMessage('aws-api', 42, 'exit_42')).toContain(
      '(error=exit_42, exit=42)',
    );
    expect(formatGeminiMcpAuthGenericFailureMessage('aws-api', null, null)).not.toContain('(');
  });

  it('formats approval prompt variants by action/prompt', () => {
    expect(
      formatGeminiMcpApprovalPrompt(
        { action: 'retry_with_preauth', prompt: 'x', server: 'aws-api' },
        30,
      ),
    ).toContain('appears expired or missing');
    expect(
      formatGeminiMcpApprovalPrompt(
        { action: 'skip_preflight_once', prompt: null, server: 'aws-api' },
        30,
      ),
    ).toContain('still needs local interactive consent');
    expect(
      formatGeminiMcpApprovalPrompt(
        { action: 'skip_preflight_once', prompt: 'retry prompt', server: 'aws-api' },
        30,
      ),
    ).toContain('still needs local interactive consent');
  });

  it('formats missing-tool message with optional hints', () => {
    const withHints = formatGeminiMissingToolMessage('aws_execute', 'aws-api', true);
    expect(withHints).toContain('tool `aws_execute`');
    expect(withHints).toContain('/mcp auth aws-api');
    expect(withHints).toContain('warnings in this run');

    const withoutHints = formatGeminiMissingToolMessage('aws_execute', null, false);
    expect(withoutHints).not.toContain('/mcp auth');
  });
});

describe('gemini MCP state helpers', () => {
  it('checks initialized/bypassed state using trimmed string keys', () => {
    const state = {
      gemini_mcp_auth_verified_server: 'aws-api',
      gemini_mcp_auth_bypass_server: 'aws-api',
    };
    expect(isGeminiMcpPreflightInitialized(state, 'aws-api')).toBe(true);
    expect(isGeminiMcpPreflightBypassed(state, 'aws-api')).toBe(true);
    expect(
      isGeminiMcpPreflightInitialized({ gemini_mcp_auth_initialized_server: '' }, 'aws-api'),
    ).toBe(false);
    expect(isGeminiMcpPreflightBypassed({ gemini_mcp_auth_bypass_server: '   ' }, 'aws-api')).toBe(
      false,
    );
  });

  it('marks initialized/verified state', () => {
    const initial = { x: 1 };
    expect(markGeminiMcpPreflightInitialized(initial, 'aws-api')).toMatchObject({
      x: 1,
      gemini_mcp_auth_initialized_server: 'aws-api',
    });
    expect(markGeminiMcpPreflightVerified(initial, 'aws-api')).toMatchObject({
      x: 1,
      gemini_mcp_auth_verified_server: 'aws-api',
    });
  });
});

describe('runGeminiMcpAuthPreflight', () => {
  it('returns ok on clean success result', async () => {
    process.env.GEMINI_COMMAND = 'gemini';
    const runner = createFakeRunner({ exitCode: 0, events: [], errorKind: null }, [
      { type: 'text', content: 'MCP auth check complete' },
    ]);

    const result = await runGeminiMcpAuthPreflight(
      runner as never,
      { PATH: process.env.PATH ?? '' },
      '/tmp/workdir',
      'aws-api',
    );

    expect(result.ok).toBe(true);
    expect(result.requiredServer).toBeNull();
    expect(result.interactiveFailure).toBe(false);
    expect(result.oauthFlowStarted).toBe(false);
    const args = (runner.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string[];
    expect(args).toContain('/mcp auth aws-api');
  });

  it('returns required server when auth-required event is present', async () => {
    process.env.GEMINI_COMMAND = 'gemini';
    const runner = createFakeRunner({ exitCode: 1, events: [], errorKind: 'exit_1' }, [
      {
        type: 'error',
        content: "MCP server 'aws-api' requires authentication using: /mcp auth aws-api",
      },
    ]);

    const result = await runGeminiMcpAuthPreflight(
      runner as never,
      { PATH: process.env.PATH ?? '' },
      '/tmp/workdir',
      'aws-api',
    );

    expect(result.ok).toBe(false);
    expect(result.requiredServer).toBe('aws-api');
    expect(result.interactiveFailure).toBe(false);
  });

  it('treats exit_42 as interactive failure even without parsed event markers', async () => {
    process.env.GEMINI_COMMAND = 'gemini';
    const runner = createFakeRunner({ exitCode: 42, events: [], errorKind: 'exit_42' }, [
      { type: 'status', content: 'Starting OAuth authentication for server aws-api' },
    ]);

    const result = await runGeminiMcpAuthPreflight(
      runner as never,
      { PATH: process.env.PATH ?? '' },
      '/tmp/workdir',
      'aws-api',
    );

    expect(result.ok).toBe(false);
    expect(result.interactiveFailure).toBe(true);
    expect(result.oauthFlowStarted).toBe(true);
  });
});

describe('gemini MCP OAuth URL formatting', () => {
  it('formats OAuth URL message with server and URL', () => {
    const msg = formatGeminiMcpAuthOAuthUrlMessage('aws-api', 'https://auth.example.com/authorize');
    expect(msg).toContain('`aws-api`');
    expect(msg).toContain('OAuth consent');
    expect(msg).toContain('https://auth.example.com/authorize');
    expect(msg).toContain('browser on the machine running HuskyGate');
  });

  it('formats waiting message with server name', () => {
    const msg = formatGeminiMcpAuthWaitingMessage('aws-api');
    expect(msg).toContain('`aws-api`');
    expect(msg).toContain('Waiting');
  });
});

describe('runGeminiInteractiveMcpAuth', () => {
  it('passes NO_BROWSER=true in env', async () => {
    process.env.GEMINI_COMMAND = 'gemini';
    const runner = createFakeRunner({ exitCode: 0, events: [], errorKind: null }, [
      { type: 'text', content: 'MCP auth check complete' },
    ]);

    await runGeminiInteractiveMcpAuth(
      runner as never,
      { PATH: process.env.PATH ?? '' },
      '/tmp/workdir',
      'aws-api',
    );

    const env = (runner.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as Record<
      string,
      string
    >;
    expect(env.NO_BROWSER).toBe('true');
  });

  it('fires onOAuthUrl callback when OAuth URL is detected in events', async () => {
    process.env.GEMINI_COMMAND = 'gemini';
    const oauthUrl = 'https://auth.example.com/authorize?client_id=abc&response_type=code';
    const runner = createFakeRunner({ exitCode: 0, events: [], errorKind: null }, [
      { type: 'status', content: 'Starting OAuth authentication for server aws-api' },
      { type: 'status', content: `Open this URL to authenticate: ${oauthUrl}` },
      { type: 'text', content: 'Auth complete' },
    ]);

    const onOAuthUrl = vi.fn();
    const result = await runGeminiInteractiveMcpAuth(
      runner as never,
      { PATH: process.env.PATH ?? '' },
      '/tmp/workdir',
      'aws-api',
      onOAuthUrl,
    );

    expect(onOAuthUrl).toHaveBeenCalledOnce();
    expect(onOAuthUrl).toHaveBeenCalledWith(oauthUrl);
    expect(result.oauthUrl).toBe(oauthUrl);
    expect(result.ok).toBe(true);
  });

  it('fires onOAuthUrl callback only once even with multiple URLs', async () => {
    process.env.GEMINI_COMMAND = 'gemini';
    const runner = createFakeRunner({ exitCode: 0, events: [], errorKind: null }, [
      { type: 'status', content: 'Visit https://auth.example.com/first' },
      { type: 'status', content: 'Visit https://auth.example.com/second' },
    ]);

    const onOAuthUrl = vi.fn();
    await runGeminiInteractiveMcpAuth(
      runner as never,
      { PATH: process.env.PATH ?? '' },
      '/tmp/workdir',
      'aws-api',
      onOAuthUrl,
    );

    expect(onOAuthUrl).toHaveBeenCalledOnce();
    expect(onOAuthUrl).toHaveBeenCalledWith('https://auth.example.com/first');
  });

  it('returns oauthUrl as null when no URL found', async () => {
    process.env.GEMINI_COMMAND = 'gemini';
    const runner = createFakeRunner({ exitCode: 1, events: [], errorKind: 'exit_1' }, [
      { type: 'error', content: 'Interactive consent could not be obtained.' },
    ]);

    const result = await runGeminiInteractiveMcpAuth(
      runner as never,
      { PATH: process.env.PATH ?? '' },
      '/tmp/workdir',
      'aws-api',
    );

    expect(result.oauthUrl).toBeNull();
    expect(result.ok).toBe(false);
  });

  it('ignores non-status/error/text events when scanning oauth hints', async () => {
    process.env.GEMINI_COMMAND = 'gemini';
    const runner = createFakeRunner({ exitCode: 0, events: [], errorKind: null }, [
      {
        type: 'tool_use',
        content: 'Open this URL to authenticate: https://auth.example.com/ignored',
      },
    ]);
    const onOAuthUrl = vi.fn();

    const result = await runGeminiInteractiveMcpAuth(
      runner as never,
      { PATH: process.env.PATH ?? '' },
      '/tmp/workdir',
      'aws-api',
      onOAuthUrl,
    );

    expect(result.ok).toBe(true);
    expect(result.oauthUrl).toBeNull();
    expect(onOAuthUrl).not.toHaveBeenCalled();
  });

  it('detects oauthFlowStarted from isOAuthFlowEvent', async () => {
    process.env.GEMINI_COMMAND = 'gemini';
    const runner = createFakeRunner({ exitCode: 42, events: [], errorKind: 'exit_42' }, [
      { type: 'status', content: 'Starting OAuth authentication for server aws-api' },
    ]);

    const result = await runGeminiInteractiveMcpAuth(
      runner as never,
      { PATH: process.env.PATH ?? '' },
      '/tmp/workdir',
      'aws-api',
    );

    expect(result.oauthFlowStarted).toBe(true);
    expect(result.interactiveFailure).toBe(true);
  });
});
