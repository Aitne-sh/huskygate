import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  postMessageWithContext: vi.fn().mockResolvedValue(undefined),
  logSlackCommandError: vi.fn(),
  sanitizeStickyApprovalState: vi.fn((toolState: Record<string, unknown>) => ({
    toolState,
    changed: false,
  })),
  resolveApprovedToolName: vi.fn((): string | null => 'mcp__aws__list'),
  buildClaudeMcpToolRerunPrompt: vi.fn(() => 'claude-rerun'),
  buildCodexMcpToolRerunPrompt: vi.fn(() => 'codex-rerun'),
  buildGeminiSingleToolRerunPrompt: vi.fn(() => 'gemini-rerun'),
  formatToolApprovalPrompt: vi.fn(() => 'approval-reminder'),
  parseApprovalDecision: vi.fn((): string | null => null),
  extractMcpShortToolName: vi.fn((): string | null => 'aws__list'),
  mergeApprovedAllowlistTools: vi.fn(() => ({ allow: ['mcp__aws__list', 'aws__list'] })),
  formatClaudeMcpApprovalPrompt: vi.fn(() => 'claude-mcp-reminder'),
  formatGeminiMcpApprovalPrompt: vi.fn(() => 'gemini-mcp-reminder'),
  appendCodexApprovedToolCall: vi.fn((calls: unknown[], name: string, args: unknown) => [
    ...(calls ?? []),
    { name, args },
  ]),
  buildCodexApprovalToolStateOverridesForCalls: vi.fn(() => ({ codex_allow: ['mcp__aws__list'] })),
}));

vi.mock('./app-helpers.js', () => ({
  logSlackCommandError: mocked.logSlackCommandError,
  postMessageWithContext: mocked.postMessageWithContext,
}));

vi.mock('../shared/approval.js', () => ({
  buildClaudeMcpToolRerunPrompt: mocked.buildClaudeMcpToolRerunPrompt,
  buildCodexMcpToolRerunPrompt: mocked.buildCodexMcpToolRerunPrompt,
  buildGeminiSingleToolRerunPrompt: mocked.buildGeminiSingleToolRerunPrompt,
  formatToolApprovalPrompt: mocked.formatToolApprovalPrompt,
  isWildcardToolApprovalTarget: (name: string) => name.includes('*'),
  resolveApprovedToolName: mocked.resolveApprovedToolName,
  sanitizeStickyApprovalState: mocked.sanitizeStickyApprovalState,
}));

vi.mock('./approval.js', () => ({
  parseApprovalDecision: mocked.parseApprovalDecision,
}));

vi.mock('../shared/tool-approval.js', () => ({
  TOOL_APPROVAL_RERUN_KEY: '_tool_approval_rerun',
  extractMcpShortToolName: mocked.extractMcpShortToolName,
  mergeApprovedAllowlistTools: mocked.mergeApprovedAllowlistTools,
}));

vi.mock('./tools/claude.js', () => ({
  CLAUDE_MCP_AUTH_APPROVAL_ACTION_KEY: 'claude_mcp_auth_approval_action',
  CLAUDE_MCP_AUTH_APPROVAL_RERUN_KEY: 'claude_mcp_auth_approval_rerun',
  CLAUDE_MCP_AUTH_BYPASS_SERVER_KEY: 'claude_mcp_auth_bypass_server',
  formatClaudeMcpApprovalPrompt: mocked.formatClaudeMcpApprovalPrompt,
}));

vi.mock('./tools/gemini.js', () => ({
  GEMINI_MCP_AUTH_APPROVAL_ACTION_KEY: 'gemini_mcp_auth_approval_action',
  GEMINI_MCP_AUTH_APPROVAL_RERUN_KEY: 'gemini_mcp_auth_approval_rerun',
  GEMINI_MCP_AUTH_BYPASS_SERVER_KEY: 'gemini_mcp_auth_bypass_server',
  formatGeminiMcpApprovalPrompt: mocked.formatGeminiMcpApprovalPrompt,
}));

vi.mock('./tools/codex.js', () => ({
  appendCodexApprovedToolCall: mocked.appendCodexApprovedToolCall,
  buildCodexApprovalToolStateOverridesForCalls: mocked.buildCodexApprovalToolStateOverridesForCalls,
}));

import { handleMcpAuthBypassApproval, handleToolApproval } from './approval-handler.js';

type MockFn = ReturnType<typeof vi.fn>;

function createCtx() {
  return {
    pendingMcpAuthBypassApprovals: new Map(),
    pendingToolApprovals: new Map(),
    sessionManager: {
      get: vi.fn(() => null),
      mergeToolState: vi.fn(),
      updateToolState: vi.fn(),
      setActiveSessionKey: vi.fn(),
      updateMode: vi.fn(),
      updateTool: vi.fn(),
    },
    workdirManager: {
      prepareWorkdirForTool: vi.fn(),
      prepareWorkdirForToolWithPolicy: vi.fn(),
      prepareWorkdirSkillsOnly: vi.fn(),
    },
    jobQueue: {
      enqueue: vi.fn(() => ({ position: 0 })),
    },
    conversationStore: {
      saveMessage: vi.fn(),
    },
  } as const;
}

function createHctx(ctx = createCtx()) {
  return {
    ctx,
    client: { chat: { postMessage: vi.fn(), update: vi.fn() } },
    channelId: 'C1',
    threadTs: '1.1',
    userId: 'U1',
    threadKey: 'C1:1.1',
  };
}

function lastMessage(): string {
  const last = mocked.postMessageWithContext.mock.calls.at(-1);
  return String(last?.[4] ?? '');
}

function baseSession(tool = 'claude') {
  return {
    sessionKey: 'sess_1',
    tool,
    mode: 'write',
    modeExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    workdir: '/tmp/workdir',
    toolState: { keep: true },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.postMessageWithContext.mockResolvedValue(undefined);
  mocked.parseApprovalDecision.mockReturnValue(null);
  mocked.sanitizeStickyApprovalState.mockImplementation((toolState: Record<string, unknown>) => ({
    toolState,
    changed: false,
  }));
  mocked.resolveApprovedToolName.mockReturnValue('mcp__aws__list');
  mocked.extractMcpShortToolName.mockReturnValue('aws__list');
});

describe('approval-handler additional coverage', () => {
  it('handles MCP auth pending ownership, reminder, and rejection branches', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);
    ctx.pendingMcpAuthBypassApprovals.set(hctx.threadKey, {
      sessionKey: 'sess_1',
      tool: 'claude',
      server: 'aws-api',
      action: 'retry_with_preauth',
      prompt: 'retry please',
      userId: 'OTHER',
      requestId: 'r1',
      expiresAt: Date.now() + 10_000,
    });

    await handleMcpAuthBypassApproval(hctx as never, '!yes');
    expect(lastMessage()).toContain('Only the user');

    ctx.pendingMcpAuthBypassApprovals.set(hctx.threadKey, {
      sessionKey: 'sess_1',
      tool: 'claude',
      server: 'aws-api',
      action: 'retry_with_preauth',
      prompt: 'retry please',
      userId: 'U1',
      requestId: 'r-claude',
      expiresAt: Date.now() + 10_000,
    });
    mocked.parseApprovalDecision.mockReturnValueOnce(null);

    await handleMcpAuthBypassApproval(hctx as never, '?');
    expect(lastMessage()).toContain('claude-mcp-reminder');

    ctx.pendingMcpAuthBypassApprovals.set(hctx.threadKey, {
      sessionKey: 'sess_1',
      tool: 'gemini',
      server: 'aws-api',
      action: 'skip_preflight_once',
      prompt: 'retry please',
      userId: 'U1',
      requestId: 'r2',
      expiresAt: Date.now() + 10_000,
    });
    mocked.parseApprovalDecision.mockReturnValueOnce(null).mockReturnValueOnce('reject');

    await handleMcpAuthBypassApproval(hctx as never, '?');
    expect(lastMessage()).toContain('gemini-mcp-reminder');

    await handleMcpAuthBypassApproval(hctx as never, '!no');
    expect(lastMessage()).toContain('rejected');
  });

  it('handles MCP auth approval without prompt for both claude and gemini', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);
    (ctx.sessionManager.get as MockFn).mockReturnValue(baseSession('claude'));

    ctx.pendingMcpAuthBypassApprovals.set(hctx.threadKey, {
      sessionKey: 'sess_1',
      tool: 'claude',
      server: 'aws-api',
      action: 'skip_preflight_once',
      prompt: '',
      userId: 'U1',
      requestId: 'r1',
      expiresAt: Date.now() + 10_000,
    });
    mocked.parseApprovalDecision.mockReturnValue('approve');

    await handleMcpAuthBypassApproval(hctx as never, '!yes');
    expect(ctx.sessionManager.updateToolState).toHaveBeenCalled();
    expect(lastMessage()).toContain('Approved Claude MCP auth bypass');

    (ctx.sessionManager.get as MockFn).mockReturnValue(baseSession('gemini'));
    ctx.pendingMcpAuthBypassApprovals.set(hctx.threadKey, {
      sessionKey: 'sess_1',
      tool: 'gemini',
      server: 'aws-api',
      action: 'retry_with_preauth',
      prompt: undefined,
      userId: 'U1',
      requestId: 'r2',
      expiresAt: Date.now() + 10_000,
    });

    await handleMcpAuthBypassApproval(hctx as never, '!yes');
    expect(lastMessage()).toContain('Approved MCP auth retry');

    ctx.pendingMcpAuthBypassApprovals.set(hctx.threadKey, {
      sessionKey: 'sess_1',
      tool: 'gemini',
      server: 'aws-api',
      action: 'skip_preflight_once',
      prompt: '',
      userId: 'U1',
      requestId: 'r3',
      expiresAt: Date.now() + 10_000,
    });
    await handleMcpAuthBypassApproval(hctx as never, '!yes');
    expect(ctx.sessionManager.updateToolState).toHaveBeenCalledWith(
      'sess_1',
      expect.objectContaining({ gemini_mcp_auth_bypass_server: 'aws-api' }),
    );
  });

  it('handles MCP auth rerun with missing session and enqueue outcomes', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);

    ctx.pendingMcpAuthBypassApprovals.set(hctx.threadKey, {
      sessionKey: 'sess_1',
      tool: 'claude',
      server: 'aws-api',
      action: 'retry_with_preauth',
      prompt: 'do it',
      userId: 'U1',
      requestId: 'r1',
      expiresAt: Date.now() + 10_000,
    });
    mocked.parseApprovalDecision.mockReturnValue('approve');

    await handleMcpAuthBypassApproval(hctx as never, '!yes');
    expect(lastMessage()).toContain('source session no longer exists');

    (ctx.sessionManager.get as MockFn).mockReturnValue(baseSession('gemini'));
    mocked.sanitizeStickyApprovalState.mockReturnValue({
      toolState: { cleaned: true },
      changed: true,
    });
    (ctx.jobQueue.enqueue as MockFn)
      .mockReturnValueOnce({ error: 'queue down' })
      .mockReturnValueOnce({ position: 2 })
      .mockReturnValueOnce({ position: 0 });

    for (const [requestId, action] of [
      ['r2', 'skip_preflight_once'],
      ['r3', 'retry_with_preauth'],
      ['r4', 'retry_with_preauth'],
    ] as const) {
      ctx.pendingMcpAuthBypassApprovals.set(hctx.threadKey, {
        sessionKey: 'sess_1',
        tool: 'gemini',
        server: 'aws-api',
        action,
        prompt: 'rerun this',
        userId: 'U1',
        requestId,
        expiresAt: Date.now() + 10_000,
      });
      await handleMcpAuthBypassApproval(hctx as never, '!yes');
    }

    expect(lastMessage()).toContain('Re-running previous request with MCP pre-auth check now');
  });

  it('handles claude rerun overrides, tool switching, and queued/immediate bypass messages', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);
    mocked.parseApprovalDecision.mockReturnValue('approve');

    const mismatchedSession = baseSession('gemini');
    (ctx.sessionManager.get as MockFn).mockReturnValue(mismatchedSession);
    (ctx.jobQueue.enqueue as MockFn).mockReturnValueOnce({ position: 2 }).mockReturnValueOnce({
      position: 0,
    });

    for (const requestId of ['c1', 'c2']) {
      ctx.pendingMcpAuthBypassApprovals.set(hctx.threadKey, {
        sessionKey: 'sess_1',
        tool: 'claude',
        server: 'aws-api',
        action: 'skip_preflight_once',
        prompt: 'rerun claude',
        userId: 'U1',
        requestId,
        expiresAt: Date.now() + 10_000,
      });
      await handleMcpAuthBypassApproval(hctx as never, '!yes');
    }

    expect(ctx.sessionManager.updateTool).toHaveBeenCalledWith('sess_1', 'claude');
    expect(lastMessage()).toContain('Re-running previous request now');
  });

  it('handles MCP auth no-prompt approval for claude retry_with_preauth', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);
    (ctx.sessionManager.get as MockFn).mockReturnValue(baseSession('claude'));

    ctx.pendingMcpAuthBypassApprovals.set(hctx.threadKey, {
      sessionKey: 'sess_1',
      tool: 'claude',
      server: 'aws-api',
      action: 'retry_with_preauth',
      prompt: '',
      userId: 'U1',
      requestId: 'r-claude-nopr',
      expiresAt: Date.now() + 10_000,
    });
    mocked.parseApprovalDecision.mockReturnValue('approve');

    await handleMcpAuthBypassApproval(hctx as never, '!yes');
    expect(ctx.sessionManager.updateToolState).toHaveBeenCalledWith(
      'sess_1',
      expect.objectContaining({ claude_mcp_auth_approval_completed: true }),
    );
    expect(lastMessage()).toContain('Approved MCP auth retry');
  });

  it('handles MCP auth exception path', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);
    (ctx.sessionManager.get as MockFn).mockImplementation(() => {
      throw new Error('boom');
    });
    ctx.pendingMcpAuthBypassApprovals.set(hctx.threadKey, {
      sessionKey: 'sess_1',
      tool: 'claude',
      server: 'aws-api',
      action: 'retry_with_preauth',
      prompt: 'rerun',
      userId: 'U1',
      requestId: 'r1',
      expiresAt: Date.now() + 10_000,
    });
    mocked.parseApprovalDecision.mockReturnValue('approve');

    await handleMcpAuthBypassApproval(hctx as never, '!yes');
    expect(mocked.logSlackCommandError).toHaveBeenCalled();
  });

  it('handles tool approval ownership/reminder/reject branches', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);

    ctx.pendingToolApprovals.set(hctx.threadKey, {
      sessionKey: 'sess_1',
      tool: 'claude',
      deniedTools: ['mcp__aws__list'],
      requestedToolName: 'mcp__aws__list',
      requestedToolArgs: { a: 1 },
      approvedCodexToolCalls: [],
      skipGeminiMcpPreflightOnce: false,
      prompt: 'run',
      userId: 'OTHER',
      requestId: 't1',
      expiresAt: Date.now() + 10_000,
    });

    await handleToolApproval(hctx as never, '!yes');
    expect(lastMessage()).toContain('Only the user');

    ctx.pendingToolApprovals.set(hctx.threadKey, {
      sessionKey: 'sess_1',
      tool: 'claude',
      deniedTools: ['mcp__aws__list'],
      requestedToolName: 'mcp__aws__list',
      requestedToolArgs: { a: 1 },
      approvedCodexToolCalls: [],
      skipGeminiMcpPreflightOnce: false,
      prompt: 'run',
      userId: 'U1',
      requestId: 't2',
      expiresAt: Date.now() + 10_000,
    });
    mocked.parseApprovalDecision.mockReturnValueOnce(null).mockReturnValueOnce('reject');

    await handleToolApproval(hctx as never, '?');
    expect(lastMessage()).toContain('approval-reminder');

    await handleToolApproval(hctx as never, '!no');
    expect(lastMessage()).toContain('Approval rejected');
  });

  it('handles tool approval missing session and missing approved tool names', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);
    mocked.parseApprovalDecision.mockReturnValue('approve');

    ctx.pendingToolApprovals.set(hctx.threadKey, {
      sessionKey: 'sess_1',
      tool: 'gemini',
      deniedTools: ['unknown_tool'],
      requestedToolName: 'unknown_tool',
      requestedToolArgs: {},
      approvedCodexToolCalls: [],
      skipGeminiMcpPreflightOnce: true,
      prompt: 'run',
      userId: 'U1',
      requestId: 't1',
      expiresAt: Date.now() + 10_000,
    });

    await handleToolApproval(hctx as never, '!yes');
    expect(lastMessage()).toContain('source session no longer exists');

    (ctx.sessionManager.get as MockFn).mockReturnValue(baseSession('gemini'));
    mocked.resolveApprovedToolName.mockReturnValue(null);

    ctx.pendingToolApprovals.set(hctx.threadKey, {
      sessionKey: 'sess_1',
      tool: 'gemini',
      deniedTools: ['unknown_tool'],
      requestedToolName: 'unknown_tool',
      requestedToolArgs: {},
      approvedCodexToolCalls: [],
      skipGeminiMcpPreflightOnce: true,
      prompt: 'run',
      userId: 'U1',
      requestId: 't2',
      expiresAt: Date.now() + 10_000,
    });
    await handleToolApproval(hctx as never, '!yes');
    expect(lastMessage()).toContain('denied tool names could not be identified');

    ctx.pendingToolApprovals.set(hctx.threadKey, {
      sessionKey: 'sess_1',
      tool: 'codex',
      deniedTools: ['unknown_tool'],
      requestedToolName: 'unknown_tool',
      requestedToolArgs: {},
      approvedCodexToolCalls: [],
      skipGeminiMcpPreflightOnce: false,
      prompt: 'run',
      userId: 'U1',
      requestId: 't3',
      expiresAt: Date.now() + 10_000,
    });
    await handleToolApproval(hctx as never, '!yes');
    expect(lastMessage()).toContain('tool name could not be identified');
  });

  it('handles tool approval rerun paths for codex/gemini/claude and enqueue outcomes', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);
    mocked.parseApprovalDecision.mockReturnValue('approve');
    mocked.resolveApprovedToolName.mockReturnValue('mcp__aws__list');
    mocked.sanitizeStickyApprovalState.mockReturnValue({
      toolState: { cleaned: true },
      changed: true,
    });

    const session = baseSession('claude');
    (ctx.sessionManager.get as MockFn).mockReturnValue(session);
    (ctx.jobQueue.enqueue as MockFn)
      .mockReturnValueOnce({ error: 'queue down' })
      .mockReturnValueOnce({ position: 2 })
      .mockReturnValueOnce({ position: 0 });

    for (const [idx, tool] of ['codex', 'gemini', 'claude'].entries()) {
      ctx.pendingToolApprovals.set(hctx.threadKey, {
        sessionKey: 'sess_1',
        tool,
        deniedTools: ['mcp__aws__list'],
        requestedToolName: 'mcp__aws__list',
        requestedToolArgs: { i: idx },
        approvedCodexToolCalls: [],
        skipGeminiMcpPreflightOnce: true,
        prompt: 'run something',
        userId: 'U1',
        requestId: `t${idx}`,
        expiresAt: Date.now() + 10_000,
      });
      await handleToolApproval(hctx as never, '!yes');
    }

    expect(mocked.buildCodexMcpToolRerunPrompt).toHaveBeenCalled();
    expect(mocked.buildGeminiSingleToolRerunPrompt).toHaveBeenCalled();
    expect(mocked.buildClaudeMcpToolRerunPrompt).toHaveBeenCalled();
    expect(lastMessage()).toContain('for one execution');
  });

  it('handles tool approval exception path', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);
    (ctx.sessionManager.get as MockFn).mockImplementation(() => {
      throw new Error('explode');
    });
    mocked.parseApprovalDecision.mockReturnValue('approve');

    ctx.pendingToolApprovals.set(hctx.threadKey, {
      sessionKey: 'sess_1',
      tool: 'claude',
      deniedTools: ['mcp__aws__list'],
      requestedToolName: 'mcp__aws__list',
      requestedToolArgs: {},
      approvedCodexToolCalls: [],
      skipGeminiMcpPreflightOnce: false,
      prompt: 'run',
      userId: 'U1',
      requestId: 't1',
      expiresAt: Date.now() + 10_000,
    });

    await handleToolApproval(hctx as never, '!yes');
    expect(mocked.logSlackCommandError).toHaveBeenCalled();
  });

  it('covers remaining approval text and allowlist fallback branches', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);
    mocked.parseApprovalDecision.mockReturnValue('approve');
    (ctx.sessionManager.get as MockFn).mockReturnValue(baseSession('gemini'));

    mocked.extractMcpShortToolName.mockReturnValueOnce(null);
    mocked.mergeApprovedAllowlistTools.mockReturnValueOnce(undefined as never);
    ctx.pendingToolApprovals.set(hctx.threadKey, {
      sessionKey: 'sess_1',
      tool: 'gemini',
      deniedTools: ['aws_execute'],
      requestedToolName: 'aws_execute',
      requestedToolArgs: { q: 1 },
      approvedCodexToolCalls: [],
      skipGeminiMcpPreflightOnce: true,
      prompt: 'run',
      userId: 'U1',
      requestId: 't-fallback',
      expiresAt: Date.now() + 10_000,
    });

    await handleToolApproval(hctx as never, '!yes');
    const geminiJob = (ctx.jobQueue.enqueue as MockFn).mock.calls.at(-1)?.[0] as {
      toolStateOverrides?: Record<string, unknown>;
    };
    expect(geminiJob.toolStateOverrides).toEqual({
      gemini_skip_mcp_preflight_once: true,
      _tool_approval_rerun: true,
    });

    mocked.resolveApprovedToolName.mockReturnValueOnce(null);
    (ctx.sessionManager.get as MockFn).mockReturnValue(baseSession('claude'));
    ctx.pendingToolApprovals.set(hctx.threadKey, {
      sessionKey: 'sess_1',
      tool: 'custom',
      deniedTools: ['x'],
      requestedToolName: null,
      requestedToolArgs: null,
      approvedCodexToolCalls: [],
      skipGeminiMcpPreflightOnce: false,
      prompt: 'run custom',
      userId: 'U1',
      requestId: 't-custom',
      expiresAt: Date.now() + 10_000,
    });
    await handleToolApproval(hctx as never, '!yes');
    expect(lastMessage()).toContain('`requested operation`');
  });

  it('covers rejection text for retry-with-preauth MCP auth approvals', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);
    mocked.parseApprovalDecision.mockReturnValue('reject');

    ctx.pendingMcpAuthBypassApprovals.set(hctx.threadKey, {
      sessionKey: 'sess_1',
      tool: 'claude',
      server: 'aws-api',
      action: 'retry_with_preauth',
      prompt: 'rerun',
      userId: 'U1',
      requestId: 'r-reject-retry',
      expiresAt: Date.now() + 10_000,
    });

    await handleMcpAuthBypassApproval(hctx as never, '!no');
    expect(lastMessage()).toContain('MCP auth retry rejected');
  });
});
