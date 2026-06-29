import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSummary } from '../session/manager.js';
import {
  TOOL_APPROVAL_ARGS_MAX_CHARS,
  buildClaudeMcpToolRerunPrompt,
  buildCodexMcpToolRerunPrompt,
  buildGeminiSingleToolRerunPrompt,
  formatApprovalArgsBlock,
  formatApprovalArgsForMarkdown,
  formatToolApprovalPrompt,
  resolveApprovedToolName,
  sanitizeStickyApprovalState,
  serializeArgsForPrompt,
} from '../shared/approval.js';
import { STICKY_APPROVAL_STATE_KEYS } from '../shared/sticky-tool-state.js';
import { ExpiringMap } from '../utils/expiring-map.js';
import { logger } from '../utils/logger.js';
import {
  CHALLENGE_CHARS,
  CHALLENGE_TIMEOUT_MS,
  MCP_AUTH_BYPASS_TIMEOUT_MS,
  TOOL_APPROVAL_TIMEOUT_MS,
  buildSlackContextPrefix,
  clearInactivityTimer,
  detectMcpAuthRequiredResourceFromEvents,
  extractAnswerText,
  fallbackSessionId,
  formatCommandListMessage,
  formatSessionListMessage,
  formatUnknownBangCommandError,
  generateChallengeCode,
  getDefaultModelForTool,
  getSlackApiError,
  hasGeminiResumeStateError,
  logSlackCommandError,
  postMessageWithContext,
  resolveContext,
  scheduleExpiry,
  scheduleInactivityAutoExit,
  toThreadKey,
  updateMessageBlocks,
  withSlackContext,
} from './app-helpers.js';

describe('app-helpers (pure utilities)', () => {
  it('generates 4-char challenge code from allowed character set', () => {
    const randomSpy = vi.spyOn(crypto, 'randomInt').mockImplementation(() => 0);
    const code = generateChallengeCode();
    randomSpy.mockRestore();

    expect(code).toHaveLength(4);
    for (const ch of code) {
      expect(CHALLENGE_CHARS.includes(ch)).toBe(true);
    }
  });

  it('returns default model from config by tool', () => {
    const config = {
      claudeModel: 'claude-opus',
      codexModel: 'gpt-5-codex',
      geminiModel: 'gemini-2.5-pro',
    };
    expect(getDefaultModelForTool(config as never, 'claude')).toBe('claude-opus');
    expect(getDefaultModelForTool(config as never, 'codex')).toBe('gpt-5-codex');
    expect(getDefaultModelForTool(config as never, 'gemini')).toBe('gemini-2.5-pro');
  });

  it('expires pending entries via scheduled cleanup timers', () => {
    vi.useFakeTimers();

    const pendingConfirmations = new ExpiringMap<
      string,
      { kind: 'mode'; mode: 'write'; code: string; expiresAt: number; sessionKey: string }
    >();
    pendingConfirmations.set('sess-1', {
      kind: 'mode',
      mode: 'write',
      code: 'ABCD',
      expiresAt: Date.now() + 1000,
      sessionKey: 'sess-1',
    });
    scheduleExpiry(
      pendingConfirmations,
      'sess-1',
      (p) => p.code === 'ABCD',
      CHALLENGE_TIMEOUT_MS,
      'confirmation',
    );
    vi.advanceTimersByTime(CHALLENGE_TIMEOUT_MS);
    expect(pendingConfirmations.get('sess-1')).toBeUndefined();

    const pendingToolApprovals = new ExpiringMap<
      string,
      {
        sessionKey: string;
        tool: 'claude';
        deniedTools: string[];
        requestedToolName: string | null;
        requestedToolArgs: unknown;
        approvedCodexToolCalls: never[];
        skipGeminiMcpPreflightOnce: boolean;
        prompt: string;
        userId: string;
        requestId: string;
        expiresAt: number;
      }
    >();
    pendingToolApprovals.set('sess-2', {
      sessionKey: 'sess-2',
      tool: 'claude',
      deniedTools: ['x'],
      requestedToolName: null,
      requestedToolArgs: null,
      approvedCodexToolCalls: [],
      skipGeminiMcpPreflightOnce: false,
      prompt: 'p',
      userId: 'U1',
      requestId: 'r1',
      expiresAt: Date.now() + 1000,
    });
    scheduleExpiry(
      pendingToolApprovals,
      'sess-2',
      (p) => p.requestId === 'r1',
      TOOL_APPROVAL_TIMEOUT_MS,
      'tool_approval',
    );
    vi.advanceTimersByTime(TOOL_APPROVAL_TIMEOUT_MS);
    expect(pendingToolApprovals.get('sess-2')).toBeUndefined();

    const pendingBypass = new ExpiringMap<
      string,
      {
        sessionKey: string;
        tool: 'claude';
        server: string;
        action: 'retry_with_preauth';
        prompt: string | null;
        userId: string;
        requestId: string;
        expiresAt: number;
      }
    >();
    pendingBypass.set('sess-3', {
      sessionKey: 'sess-3',
      tool: 'claude',
      server: 'aws-api',
      action: 'retry_with_preauth',
      prompt: 'p',
      userId: 'U1',
      requestId: 'r2',
      expiresAt: Date.now() + 1000,
    });
    scheduleExpiry(
      pendingBypass,
      'sess-3',
      (p) => p.requestId === 'r2',
      MCP_AUTH_BYPASS_TIMEOUT_MS,
      'mcp_auth_bypass',
    );
    vi.advanceTimersByTime(MCP_AUTH_BYPASS_TIMEOUT_MS);
    expect(pendingBypass.get('sess-3')).toBeUndefined();
  });

  it('keeps a replacement pending entry when an older expiry timer fires', () => {
    vi.useFakeTimers();

    const pendingToolApprovals = new ExpiringMap<
      string,
      {
        sessionKey: string;
        tool: 'claude';
        deniedTools: string[];
        requestedToolName: string | null;
        requestedToolArgs: unknown;
        approvedCodexToolCalls: never[];
        skipGeminiMcpPreflightOnce: boolean;
        prompt: string;
        userId: string;
        requestId: string;
        expiresAt: number;
      }
    >();
    pendingToolApprovals.set(
      'sess-replace',
      {
        sessionKey: 'sess-replace',
        tool: 'claude',
        deniedTools: ['x'],
        requestedToolName: null,
        requestedToolArgs: null,
        approvedCodexToolCalls: [],
        skipGeminiMcpPreflightOnce: false,
        prompt: 'old',
        userId: 'U1',
        requestId: 'old',
        expiresAt: Date.now() + TOOL_APPROVAL_TIMEOUT_MS,
      },
      TOOL_APPROVAL_TIMEOUT_MS,
    );
    scheduleExpiry(
      pendingToolApprovals,
      'sess-replace',
      (p) => p.requestId === 'old',
      TOOL_APPROVAL_TIMEOUT_MS,
      'tool_approval',
    );

    pendingToolApprovals.set(
      'sess-replace',
      {
        sessionKey: 'sess-replace',
        tool: 'claude',
        deniedTools: ['x'],
        requestedToolName: null,
        requestedToolArgs: null,
        approvedCodexToolCalls: [],
        skipGeminiMcpPreflightOnce: false,
        prompt: 'new',
        userId: 'U1',
        requestId: 'new',
        expiresAt: Date.now() + TOOL_APPROVAL_TIMEOUT_MS * 2,
      },
      TOOL_APPROVAL_TIMEOUT_MS * 2,
    );

    vi.advanceTimersByTime(TOOL_APPROVAL_TIMEOUT_MS);
    expect(pendingToolApprovals.get('sess-replace')?.requestId).toBe('new');
  });

  it('logs warning when scheduled cleanup throws', () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const failingConfirmationMap = {
      get: vi.fn(() => {
        throw 'confirm cleanup failed';
      }),
      delete: vi.fn(),
    };
    const failingToolApprovalMap = {
      get: vi.fn(() => {
        throw 'tool approval cleanup failed';
      }),
      delete: vi.fn(),
    };
    const failingBypassMap = {
      get: vi.fn(() => {
        throw 'bypass cleanup failed';
      }),
      delete: vi.fn(),
    };

    scheduleExpiry(
      failingConfirmationMap as never,
      'sess-1',
      (p: { code: string }) => p.code === 'ABCD',
      CHALLENGE_TIMEOUT_MS,
      'confirmation',
    );
    scheduleExpiry(
      failingToolApprovalMap as never,
      'sess-2',
      (p: { requestId: string }) => p.requestId === 'r1',
      TOOL_APPROVAL_TIMEOUT_MS,
      'tool_approval',
    );
    scheduleExpiry(
      failingBypassMap as never,
      'sess-3',
      (p: { requestId: string }) => p.requestId === 'r2',
      MCP_AUTH_BYPASS_TIMEOUT_MS,
      'mcp_auth_bypass',
    );
    vi.advanceTimersByTime(MCP_AUTH_BYPASS_TIMEOUT_MS);

    expect(warnSpy).toHaveBeenCalledWith(
      'confirmation_expiry_cleanup_failed',
      expect.objectContaining({ error: 'confirm cleanup failed' }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'tool_approval_expiry_cleanup_failed',
      expect.objectContaining({ error: 'tool approval cleanup failed' }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'mcp_auth_bypass_expiry_cleanup_failed',
      expect.objectContaining({ error: 'bypass cleanup failed' }),
    );

    warnSpy.mockRestore();
  });

  it('logs warning from Error instances during scheduled cleanup failures', () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const failingConfirmationMap = {
      get: vi.fn(() => {
        throw new Error('confirm cleanup failed as Error');
      }),
      delete: vi.fn(),
    };
    const failingToolApprovalMap = {
      get: vi.fn(() => {
        throw new Error('tool approval cleanup failed as Error');
      }),
      delete: vi.fn(),
    };
    const failingBypassMap = {
      get: vi.fn(() => {
        throw new Error('bypass cleanup failed as Error');
      }),
      delete: vi.fn(),
    };

    scheduleExpiry(
      failingConfirmationMap as never,
      'sess-1',
      (p: { code: string }) => p.code === 'ABCD',
      CHALLENGE_TIMEOUT_MS,
      'confirmation',
    );
    scheduleExpiry(
      failingToolApprovalMap as never,
      'sess-2',
      (p: { requestId: string }) => p.requestId === 'r1',
      TOOL_APPROVAL_TIMEOUT_MS,
      'tool_approval',
    );
    scheduleExpiry(
      failingBypassMap as never,
      'sess-3',
      (p: { requestId: string }) => p.requestId === 'r2',
      MCP_AUTH_BYPASS_TIMEOUT_MS,
      'mcp_auth_bypass',
    );
    vi.advanceTimersByTime(MCP_AUTH_BYPASS_TIMEOUT_MS);

    expect(warnSpy).toHaveBeenCalledWith(
      'confirmation_expiry_cleanup_failed',
      expect.objectContaining({ error: 'confirm cleanup failed as Error' }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'tool_approval_expiry_cleanup_failed',
      expect.objectContaining({ error: 'tool approval cleanup failed as Error' }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'mcp_auth_bypass_expiry_cleanup_failed',
      expect.objectContaining({ error: 'bypass cleanup failed as Error' }),
    );

    warnSpy.mockRestore();
  });

  it('sanitizes sticky approval keys and reports change state', () => {
    const stickyState = Object.fromEntries(
      STICKY_APPROVAL_STATE_KEYS.map((key) => [key, true] as const),
    );
    const out = sanitizeStickyApprovalState({
      keep: 1,
      ...stickyState,
    });
    expect(out.changed).toBe(true);
    expect(out.toolState).toEqual({ keep: 1 });
    expect(sanitizeStickyApprovalState({ keep: 1 }).changed).toBe(false);
  });

  it('formats approval args block for null/string/object/long inputs', () => {
    expect(formatApprovalArgsBlock(null)).toBe('Arguments: (not available)');
    expect(formatApprovalArgsBlock('   ')).toBe('Arguments: (not available)');
    expect(formatApprovalArgsBlock('  hello  ')).toContain('```text\nhello');
    expect(formatApprovalArgsBlock({ a: 1 })).toContain('```json');

    const long = `x${'a'.repeat(TOOL_APPROVAL_ARGS_MAX_CHARS + 20)}`;
    const formatted = formatApprovalArgsBlock(long);
    expect(formatted).toContain('... (truncated)');
  });

  it('falls back to string rendering for non-serializable arguments', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(formatApprovalArgsBlock(circular)).toContain('```text\n[object Object]');
    expect(serializeArgsForPrompt(circular)).toBe('[object Object]');
  });

  it('formats approval args for markdown block with syntax hints', () => {
    expect(formatApprovalArgsForMarkdown(null)).toBe('**Arguments:** (not available)');
    expect(formatApprovalArgsForMarkdown(undefined)).toBe('**Arguments:** (not available)');
    expect(formatApprovalArgsForMarkdown('   ')).toBe('**Arguments:** (not available)');
    expect(formatApprovalArgsForMarkdown('  hello  ')).toContain('```text\nhello');
    expect(formatApprovalArgsForMarkdown('  hello  ')).toContain('**Arguments:**');
    expect(formatApprovalArgsForMarkdown({ a: 1 })).toContain('```json');
    expect(formatApprovalArgsForMarkdown({ a: 1 })).toContain('**Arguments:**');

    const long = `x${'a'.repeat(TOOL_APPROVAL_ARGS_MAX_CHARS + 20)}`;
    const formatted = formatApprovalArgsForMarkdown(long);
    expect(formatted).toContain('... (truncated)');
    expect(formatted).toContain('**Arguments:**');
  });

  it('formats markdown args with text fallback for circular refs', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(formatApprovalArgsForMarkdown(circular)).toContain('```text\n[object Object]');
    expect(formatApprovalArgsForMarkdown(circular)).toContain('**Arguments:**');
  });

  it('resolves approved tool names and builds tool-approval prompt', () => {
    const pending = {
      sessionKey: 's',
      tool: 'gemini',
      deniedTools: ['unknown_tool'],
      requestedToolName: '  aws_execute ',
      requestedToolArgs: { cmd: 'ls' },
      approvedCodexToolCalls: [],
      skipGeminiMcpPreflightOnce: false,
      prompt: 'run',
      userId: 'U1',
      requestId: 'r',
      expiresAt: Date.now() + 1000,
    };
    expect(resolveApprovedToolName(pending as never)).toBe('aws_execute');
    expect(
      resolveApprovedToolName({
        ...pending,
        requestedToolName: 'unknown',
        deniedTools: [],
      } as never),
    ).toBeNull();
    expect(
      resolveApprovedToolName({
        ...pending,
        requestedToolName: null,
        deniedTools: ['aws_execute'],
      } as never),
    ).toBe('aws_execute');
    expect(
      resolveApprovedToolName({
        ...pending,
        requestedToolName: '   ',
        deniedTools: [],
      } as never),
    ).toBeNull();
    expect(formatToolApprovalPrompt(pending as never, 12)).toContain('expires in 12s');
    expect(
      formatToolApprovalPrompt(
        {
          ...pending,
          requestedToolName: null,
          deniedTools: [],
        } as never,
        12,
      ),
    ).toContain('Tool call: `unknown_tool`');
  });

  it('extracts Slack API error shape and logs error details', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    expect(getSlackApiError(null)).toBeNull();
    expect(getSlackApiError({ code: 'x' })).toEqual({ code: 'x' });

    logSlackCommandError(
      {
        code: 'slack_webapi_platform_error',
        data: { error: 'missing_scope', needed: 'chat:write', provided: 'im:history' },
      },
      { command: 'test', sessionKey: 'sess-1' },
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'slack_missing_scope',
      expect.objectContaining({ command: 'test', needed_scope: 'chat:write' }),
    );

    logSlackCommandError(
      {
        code: 'slack_webapi_platform_error',
        data: { error: 'missing_scope' },
      },
      { command: 'test-missing-fields', sessionKey: 'sess-1' },
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'slack_missing_scope',
      expect.objectContaining({
        command: 'test-missing-fields',
        needed_scope: 'unknown',
        provided_scopes: 'unknown',
      }),
    );

    logSlackCommandError(new Error('boom'), { command: 'test2', sessionKey: 'sess-2' });
    expect(errorSpy).toHaveBeenCalledWith(
      'slack_command_error',
      expect.objectContaining({ command: 'test2', error: 'boom' }),
    );
    logSlackCommandError('string-error', { command: 'test3', sessionKey: 'sess-3' });
    expect(errorSpy).toHaveBeenCalledWith(
      'slack_command_error',
      expect.objectContaining({ command: 'test3', error: 'string-error' }),
    );

    errorSpy.mockRestore();
  });

  it('formats context prefixes and Gemini resume-state detection', () => {
    expect(buildSlackContextPrefix('claude', 'abc')).toBe('[app:claude/session-id:abc]');
    expect(withSlackContext('[app:x]', 'body')).toBe('[app:x]\nbody');
    expect(
      hasGeminiResumeStateError([
        {
          type: 'error',
          content: 'Error: No previous sessions found for this project',
        },
      ] as never),
    ).toBe(true);
    expect(hasGeminiResumeStateError([{ type: 'text', content: 'ok' }] as never)).toBe(false);
  });

  it('detects MCP auth required resource URL from events', () => {
    const url = detectMcpAuthRequiredResourceFromEvents([
      {
        type: 'text',
        content: 'AuthRequired(AuthRequiredError { resource: "https://a.example" })',
      },
    ] as never);
    expect(url).toBe('https://a.example');
    expect(
      detectMcpAuthRequiredResourceFromEvents([{ type: 'tool_use', content: 'x' }] as never),
    ).toBeNull();
  });

  it('extracts answer text from event stream variants', () => {
    const postToolText = extractAnswerText([
      { type: 'tool_use', content: 'Using tool: aws_execute' },
      undefined,
      { type: 'status', content: 'working' },
      { type: 'text', content: 'partial', raw: { type: 'delta' } },
      { type: 'text', content: 'ignored', raw: { type: 'result' } },
      { type: 'text', content: ' answer', raw: { type: 'delta' } },
    ] as never);
    expect(postToolText).toBe('partial answer');

    const resultFallback = extractAnswerText([
      { type: 'text', content: 'final result', raw: { type: 'result' } },
    ] as never);
    expect(resultFallback).toBe('final result');

    const allText = extractAnswerText([
      { type: 'text', content: '', raw: { type: 'result' } },
      { type: 'text', content: 'a', raw: { type: 'delta' } },
      { type: 'text', content: 'b', raw: { type: 'delta' } },
    ] as never);
    expect(allText).toBe('ab');

    const markerAnswer = extractAnswerText([
      { type: 'text', content: 'prefix <!-- answer --> final', raw: { type: 'result' } },
    ] as never);
    expect(markerAnswer).toBe('final');

    const markerAtEndFallsBack = extractAnswerText([
      { type: 'text', content: 'prefix <!-- answer -->', raw: { type: 'result' } },
    ] as never);
    expect(markerAtEndFallsBack).toBe('prefix');

    // Multiple markers — should use the last one
    const multiMarker = extractAnswerText([
      {
        type: 'text',
        content: 'searching...\n<!-- answer -->intermediate status\n<!-- answer -->real answer',
        raw: { type: 'result' },
      },
    ] as never);
    expect(multiMarker).toBe('real answer');

    // Consecutive markers at end — text before them is the answer
    const consecutiveAtEnd = extractAnswerText([
      {
        type: 'text',
        content: 'final text\n<!-- answer --><!-- answer -->',
        raw: { type: 'result' },
      },
    ] as never);
    expect(consecutiveAtEnd).toBe('final text');

    // Multiple markers with Japanese text preserved
    const jpMultiMarker = extractAnswerText([
      {
        type: 'text',
        content: '検索中...\n<!-- answer -->中間報告です\n<!-- answer -->最終回答はこちらです。',
        raw: { type: 'result' },
      },
    ] as never);
    expect(jpMultiMarker).toBe('最終回答はこちらです。');
  });

  it('formats command/session list messages and rerun prompts', () => {
    expect(formatUnknownBangCommandError('!bad `cmd`')).toContain('\uFF40cmd\uFF40');
    expect(formatCommandListMessage()).toContain('*Commands*');
    expect(formatSessionListMessage([])).toContain('No sessions found');

    const sessions: SessionSummary[] = [
      {
        sessionId: 'S1',
        sessionKey: 'k',
        threadKey: 'C1:1.1',
        userId: 'U1',
        tool: 'claude',
        mode: 'readonly',
        modeExpiresAt: null,
        workdir: '/tmp/workdir',
        runningJobId: null,
        startedAt: '2026-01-01',
        updatedAt: '2026-01-02',
        devAlias: null,
        active: true,
      },
    ];
    expect(formatSessionListMessage(sessions)).toContain('[active]');
    const firstSession = sessions[0] as NonNullable<(typeof sessions)[0]>;
    expect(formatSessionListMessage([{ ...firstSession, active: false }])).not.toContain(
      '[active]',
    );

    expect(serializeArgsForPrompt(null)).toBe('(not available)');
    expect(serializeArgsForPrompt('  hi  ')).toBe('hi');
    expect(serializeArgsForPrompt('   ')).toBe('(not available)');
    expect(serializeArgsForPrompt({ a: 1 })).toBe('{"a":1}');

    expect(buildGeminiSingleToolRerunPrompt('p', 'aws_execute', { x: 1 })).toContain(
      'aws_execute is now available',
    );
    expect(buildClaudeMcpToolRerunPrompt('mcp__x__y', { a: 1 })).toContain(
      'mcp__x__y is now available',
    );
    expect(buildCodexMcpToolRerunPrompt('p', 'mcp__x__y', { a: 1 })).toContain(
      'mcp__x__y is now available',
    );
  });

  it('builds thread key, warns for invalid delimiters, and computes fallback session id', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    expect(toThreadKey('C1', '1.1')).toBe('C1:1.1');
    expect(toThreadKey('C:1', '1:1')).toBe('C:1:1:1');
    expect(warnSpy).toHaveBeenCalled();
    expect(fallbackSessionId('abc')).toHaveLength(8);
    warnSpy.mockRestore();
  });
});

describe('app-helpers (context-dependent)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves context from explicit session, active session, and fallback', () => {
    const ctx = {
      sessionManager: {
        getSessionSummary: vi.fn((key: string) =>
          key === 'sess-1' ? { tool: 'claude', sessionId: 'S1' } : null,
        ),
        getActiveSessionSummary: vi.fn((threadKey: string) =>
          threadKey === 'C1:1.1' ? { tool: 'gemini', sessionId: 'S2' } : null,
        ),
      },
    };

    expect(resolveContext(ctx as never, 'C1:1.1', { sessionKey: 'sess-1' })).toEqual({
      tool: 'claude',
      sessionId: 'S1',
    });
    expect(resolveContext(ctx as never, 'C1:1.1')).toEqual({
      tool: 'gemini',
      sessionId: 'S2',
    });
    expect(
      resolveContext(ctx as never, 'C1:2.2', { sessionKey: 'missing', tool: 'codex' }),
    ).toEqual({
      tool: 'codex',
      sessionId: fallbackSessionId('missing'),
    });
    expect(resolveContext(ctx as never, 'C1:2.2', { sessionKey: 'missing' })).toEqual({
      tool: 'none',
      sessionId: fallbackSessionId('missing'),
    });
    expect(resolveContext(ctx as never, 'C1:2.2')).toEqual({ tool: 'none', sessionId: 'none' });
  });

  it('posts message with context prefix through Slack client', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    const ctx = {
      sessionManager: {
        getSessionSummary: vi.fn().mockReturnValue({ tool: 'claude', sessionId: 'S1' }),
        getActiveSessionSummary: vi.fn().mockReturnValue(null),
      },
    };

    await postMessageWithContext(
      ctx as never,
      { chat: { postMessage } } as never,
      'C1',
      '1.1',
      'hello',
      { sessionKey: 'sess-1' },
    );

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C1',
        thread_ts: '1.1',
        text: '[app:claude/session-id:S1]\nhello',
      }),
    );
  });

  it('updateMessageBlocks calls chat.update with correct params', async () => {
    const chatUpdate = vi.fn().mockResolvedValue({ ok: true });
    const slackClient = { chat: { update: chatUpdate } };
    const blocks = [{ type: 'section' as const, text: { type: 'mrkdwn' as const, text: 'done' } }];

    await updateMessageBlocks(slackClient as never, 'C1', '1.1', blocks as never, 'fallback');

    expect(chatUpdate).toHaveBeenCalledWith({
      channel: 'C1',
      ts: '1.1',
      blocks,
      text: 'fallback',
    });
  });

  it('clears inactivity timer entry when present', () => {
    const timer = setTimeout(() => undefined, 1000);
    const ctx = { inactivityTimers: new Map([['C1:1.1', timer]]) };
    clearInactivityTimer(ctx as never, 'C1:1.1');
    expect(ctx.inactivityTimers.has('C1:1.1')).toBe(false);
  });

  it('auto-exits inactive session and clears pending state', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    const session = {
      tool: 'claude',
      toolState: { foo: 'bar', claude_mcp_auth_bypass_server: 'aws-api' },
    };
    const ctx = {
      config: { sessionIdleTimeoutSec: 86400 },
      webClient: { chat: { postMessage } },
      sessionManager: {
        getActiveSessionKey: vi.fn().mockReturnValue('sess-1'),
        getSessionSummary: vi.fn().mockReturnValue({ tool: 'claude', sessionId: 'S1' }),
        get: vi.fn().mockReturnValue(session),
        updateToolState: vi.fn(),
        clearActiveSession: vi.fn(),
      },
      activeRunners: new Map(),
      switchPreflightBarriers: new Map(),
      pendingConfirmations: new Map([['C1:1.1', { sessionKey: 'sess-1' }]]),
      pendingToolApprovals: new Map([['C1:1.1', { sessionKey: 'sess-1' }]]),
      pendingMcpAuthBypassApprovals: new Map([['C1:1.1', { sessionKey: 'sess-1' }]]),
      inactivityTimers: new Map(),
    };

    scheduleInactivityAutoExit(ctx as never, 'C1:1.1', 'C1', '1.1');
    vi.advanceTimersByTime(86400 * 1000);
    await vi.runAllTimersAsync();

    expect(ctx.sessionManager.updateToolState).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        foo: 'bar',
        claude_mcp_auth_approval_completed: undefined,
        claude_mcp_auth_bypass_server: undefined,
      }),
    );
    expect(ctx.sessionManager.clearActiveSession).toHaveBeenCalledWith('C1:1.1');
    expect(ctx.pendingConfirmations.size).toBe(0);
    expect(postMessage).toHaveBeenCalled();
  });

  it('auto-exit clears Gemini bypass flag and logs notification failure', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const postMessage = vi.fn().mockRejectedValue(new Error('post failed'));
    const session = {
      tool: 'gemini',
      toolState: { gemini_mcp_auth_bypass_server: 'aws-api', keep: true },
    };
    const ctx = {
      config: { sessionIdleTimeoutSec: 86400 },
      webClient: { chat: { postMessage } },
      sessionManager: {
        getActiveSessionKey: vi.fn().mockReturnValue('sess-2'),
        getSessionSummary: vi.fn().mockReturnValue({ tool: 'gemini', sessionId: 'S2' }),
        get: vi.fn().mockReturnValue(session),
        updateToolState: vi.fn(),
        clearActiveSession: vi.fn(),
      },
      activeRunners: new Map(),
      switchPreflightBarriers: new Map(),
      pendingConfirmations: new Map(),
      pendingToolApprovals: new Map(),
      pendingMcpAuthBypassApprovals: new Map(),
      inactivityTimers: new Map(),
    };

    scheduleInactivityAutoExit(ctx as never, 'C1:2.2', 'C1', '2.2');
    vi.advanceTimersByTime(86400 * 1000);
    await vi.runAllTimersAsync();

    expect(ctx.sessionManager.updateToolState).toHaveBeenCalledWith(
      'sess-2',
      expect.objectContaining({
        keep: true,
        gemini_mcp_auth_bypass_server: undefined,
      }),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'auto_exit_notification_failed',
      expect.objectContaining({ thread_key: 'C1:2.2', error: 'post failed' }),
    );
    errorSpy.mockRestore();
  });

  it('reschedules inactivity timer when active runner is still running', async () => {
    const runner = { isRunning: vi.fn().mockReturnValue(true) };
    const ctx = {
      config: { sessionIdleTimeoutSec: 86400 },
      webClient: { chat: { postMessage: vi.fn() } },
      sessionManager: {
        getActiveSessionKey: vi.fn().mockReturnValue('sess-1'),
      },
      activeRunners: new Map([['sess-1', { runner }]]),
      switchPreflightBarriers: new Map(),
      pendingConfirmations: new Map(),
      pendingToolApprovals: new Map(),
      pendingMcpAuthBypassApprovals: new Map(),
      inactivityTimers: new Map(),
    };

    scheduleInactivityAutoExit(ctx as never, 'C1:1.1', 'C1', '1.1');
    vi.advanceTimersByTime(86400 * 1000);
    await Promise.resolve();

    expect(ctx.inactivityTimers.has('C1:1.1')).toBe(true);
  });

  it('returns early when no active session exists on inactivity timeout', async () => {
    const postMessage = vi.fn();
    const ctx = {
      config: { sessionIdleTimeoutSec: 86400 },
      webClient: { chat: { postMessage } },
      sessionManager: {
        getActiveSessionKey: vi.fn().mockReturnValue(null),
      },
      activeRunners: new Map(),
      switchPreflightBarriers: new Map(),
      pendingConfirmations: new Map(),
      pendingToolApprovals: new Map(),
      pendingMcpAuthBypassApprovals: new Map(),
      inactivityTimers: new Map(),
    };

    scheduleInactivityAutoExit(ctx as never, 'C1:3.3', 'C1', '3.3');
    vi.advanceTimersByTime(86400 * 1000);
    await vi.runAllTimersAsync();

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('uses fallback tool label when session summary is missing during auto-exit', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    const ctx = {
      config: { sessionIdleTimeoutSec: 86400 },
      webClient: { chat: { postMessage } },
      sessionManager: {
        getActiveSessionKey: vi.fn().mockReturnValue('sess-9'),
        getSessionSummary: vi.fn().mockReturnValue(null),
        get: vi.fn().mockReturnValue({ tool: 'codex', toolState: { keep: true } }),
        updateToolState: vi.fn(),
        clearActiveSession: vi.fn(),
      },
      activeRunners: new Map(),
      switchPreflightBarriers: new Map(),
      pendingConfirmations: new Map(),
      pendingToolApprovals: new Map(),
      pendingMcpAuthBypassApprovals: new Map(),
      inactivityTimers: new Map(),
    };

    scheduleInactivityAutoExit(ctx as never, 'C1:9.9', 'C1', '9.9');
    vi.advanceTimersByTime(86400 * 1000);
    await vi.runAllTimersAsync();

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('[app:none/session-id:'),
      }),
    );
  });

  it('logs non-Error rejection values during auto-exit notification', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const postMessage = vi.fn().mockRejectedValue('post failed by string');
    const ctx = {
      config: { sessionIdleTimeoutSec: 86400 },
      webClient: { chat: { postMessage } },
      sessionManager: {
        getActiveSessionKey: vi.fn().mockReturnValue('sess-10'),
        getSessionSummary: vi.fn().mockReturnValue({ tool: 'codex', sessionId: 'S10' }),
        get: vi.fn().mockReturnValue({ tool: 'codex', toolState: {} }),
        updateToolState: vi.fn(),
        clearActiveSession: vi.fn(),
      },
      activeRunners: new Map(),
      switchPreflightBarriers: new Map(),
      pendingConfirmations: new Map(),
      pendingToolApprovals: new Map(),
      pendingMcpAuthBypassApprovals: new Map(),
      inactivityTimers: new Map(),
    };

    scheduleInactivityAutoExit(ctx as never, 'C1:10.10', 'C1', '10.10');
    vi.advanceTimersByTime(86400 * 1000);
    await vi.runAllTimersAsync();

    expect(errorSpy).toHaveBeenCalledWith(
      'auto_exit_notification_failed',
      expect.objectContaining({ error: 'post failed by string' }),
    );
    errorSpy.mockRestore();
  });
});
