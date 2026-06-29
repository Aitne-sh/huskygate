import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestAppContext } from '../test-helpers/app-context-builder.js';

const mocked = vi.hoisted(() => ({
  postMessageWithContext: vi.fn().mockResolvedValue(undefined),
  logSlackCommandError: vi.fn(),
  sanitizeStickyApprovalState: vi.fn((toolState: Record<string, unknown>) => ({
    toolState,
    changed: false,
  })),
  resolveApprovedToolName: vi.fn().mockReturnValue('aws_execute'),
  saveMessage: vi.fn(),
}));

vi.mock('./app-helpers.js', () => ({
  logSlackCommandError: mocked.logSlackCommandError,
  postMessageWithContext: mocked.postMessageWithContext,
}));

vi.mock('../shared/approval.js', () => ({
  buildClaudeMcpToolRerunPrompt: vi.fn().mockReturnValue('claude-rerun'),
  buildCodexMcpToolRerunPrompt: vi.fn().mockReturnValue('codex-rerun'),
  buildGeminiSingleToolRerunPrompt: vi.fn().mockReturnValue('gemini-rerun'),
  formatToolApprovalPrompt: vi.fn().mockReturnValue('approval-prompt'),
  isWildcardToolApprovalTarget: vi.fn((toolName: string) => toolName.includes('*')),
  resolveApprovedToolName: mocked.resolveApprovedToolName,
  sanitizeStickyApprovalState: mocked.sanitizeStickyApprovalState,
}));

import {
  handleMcpAuthBypassApproval,
  handleToolApproval,
  processMcpAuthApprove,
  processMcpAuthReject,
  processToolApprove,
  processToolReject,
} from './approval-handler.js';

function createHandlerContext() {
  const ctx = createAppContext();
  return {
    ctx,
    client: ctx.webClient,
    channelId: 'C1',
    threadTs: '1.1',
    userId: 'U1',
    threadKey: 'C1:1.1',
  };
}

function createAppContext() {
  const base = makeTestAppContext();
  return {
    ...base,
    sessionManager: {
      ...base.sessionManager,
      get: vi.fn().mockReturnValue({
        tool: 'claude',
        mode: 'write',
        modeExpiresAt: null,
        toolState: {},
        workdir: '/tmp/work',
      }),
      setActiveSessionKey: vi.fn(),
      mergeToolState: vi.fn(),
      updateToolState: vi.fn(),
      updateMode: vi.fn(),
      updateTool: vi.fn(),
    },
    workdirManager: {
      ...base.workdirManager,
      prepareWorkdirForTool: vi.fn(),
      prepareWorkdirForToolWithPolicy: vi.fn(),
      prepareWorkdirSkillsOnly: vi.fn(),
    },
    jobQueue: {
      ...base.jobQueue,
      enqueue: vi.fn().mockReturnValue({ position: 0 }),
    },
    conversationStore: { ...base.conversationStore, saveMessage: mocked.saveMessage },
  };
}

describe('approval-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Text-based handler tests (handleMcpAuthBypassApproval / handleToolApproval)
  // -------------------------------------------------------------------------

  it('returns false when no pending MCP auth bypass exists', async () => {
    const hctx = createHandlerContext();
    await expect(handleMcpAuthBypassApproval(hctx as never, '!yes')).resolves.toBe(false);
  });

  it('expires pending MCP auth bypass request and notifies user', async () => {
    const hctx = createHandlerContext();
    hctx.ctx.pendingMcpAuthBypassApprovals.set('C1:1.1', {
      sessionKey: 'sess-1',
      tool: 'claude',
      server: 'aws-api',
      action: 'retry_with_preauth',
      prompt: 'p',
      userId: 'U1',
      requestId: 'r1',
      expiresAt: Date.now() - 1,
    });

    await expect(handleMcpAuthBypassApproval(hctx as never, '!yes')).resolves.toBe(true);
    expect(hctx.ctx.pendingMcpAuthBypassApprovals.size).toBe(0);
    expect(mocked.postMessageWithContext).toHaveBeenCalled();
  });

  it('returns false when no pending tool approval exists', async () => {
    const hctx = createHandlerContext();
    await expect(handleToolApproval(hctx as never, '!yes')).resolves.toBe(false);
  });

  it('expires pending tool approval request and notifies user', async () => {
    const hctx = createHandlerContext();
    hctx.ctx.pendingToolApprovals.set('C1:1.1', {
      sessionKey: 'sess-1',
      tool: 'gemini',
      deniedTools: ['aws_execute'],
      requestedToolName: 'aws_execute',
      requestedToolArgs: { cmd: 'ls' },
      approvedCodexToolCalls: [],
      skipGeminiMcpPreflightOnce: false,
      prompt: 'p',
      userId: 'U1',
      requestId: 'r1',
      expiresAt: Date.now() - 1,
    });

    await expect(handleToolApproval(hctx as never, '!yes')).resolves.toBe(true);
    expect(hctx.ctx.pendingToolApprovals.size).toBe(0);
    expect(mocked.postMessageWithContext).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Shared process functions — dashboard sync (conversationStore.saveMessage)
  // -------------------------------------------------------------------------

  describe('processToolApprove — dashboard sync', () => {
    it('saves tool_approval_result with decision=approved to conversationStore', async () => {
      const ctx = createAppContext();
      const pending = {
        sessionKey: 'sk-1',
        tool: 'claude' as const,
        deniedTools: ['Bash'],
        requestedToolName: 'Bash',
        requestedToolArgs: { command: 'ls' },
        approvedCodexToolCalls: [],
        skipGeminiMcpPreflightOnce: false,
        prompt: 'do something',
        userId: 'U1',
        requestId: 'req-123',
        expiresAt: Date.now() + 120_000,
      };
      ctx.pendingToolApprovals.set('C1:1.0', pending);

      await processToolApprove(ctx as never, pending, 'C1:1.0', 'C1', '1.0', 'U1');

      expect(mocked.saveMessage).toHaveBeenCalledWith(
        'sk-1',
        'system',
        JSON.stringify({
          type: 'tool_approval_result',
          requestId: 'req-123',
          decision: 'approved',
        }),
      );
    });

    it('does not save when session is missing', async () => {
      const ctx = createAppContext();
      ctx.sessionManager.get.mockReturnValue(null);
      const pending = {
        sessionKey: 'sk-missing',
        tool: 'claude' as const,
        deniedTools: [],
        requestedToolName: null,
        requestedToolArgs: null,
        approvedCodexToolCalls: [],
        skipGeminiMcpPreflightOnce: false,
        prompt: 'p',
        userId: 'U1',
        requestId: 'req-456',
        expiresAt: Date.now() + 120_000,
      };

      const outcome = await processToolApprove(ctx as never, pending, 'C1:1.0', 'C1', '1.0', 'U1');

      expect(outcome.message).toContain('no longer exists');
      expect(mocked.saveMessage).not.toHaveBeenCalled();
    });
  });

  describe('processToolReject — dashboard sync', () => {
    it('saves tool_approval_result with decision=denied to conversationStore', () => {
      const ctx = createAppContext();
      const pending = {
        sessionKey: 'sk-1',
        tool: 'claude' as const,
        deniedTools: ['Bash'],
        requestedToolName: 'Bash',
        requestedToolArgs: { command: 'ls' },
        approvedCodexToolCalls: [],
        skipGeminiMcpPreflightOnce: false,
        prompt: 'do something',
        userId: 'U1',
        requestId: 'req-789',
        expiresAt: Date.now() + 120_000,
      };
      ctx.pendingToolApprovals.set('C1:1.0', pending);

      processToolReject(ctx as never, pending, 'C1:1.0');

      expect(mocked.saveMessage).toHaveBeenCalledWith(
        'sk-1',
        'system',
        JSON.stringify({ type: 'tool_approval_result', requestId: 'req-789', decision: 'denied' }),
      );
    });

    it('uses fallback target when approved tool name cannot be resolved', () => {
      mocked.resolveApprovedToolName.mockReturnValueOnce(null);
      const ctx = createAppContext();
      const pending = {
        sessionKey: 'sk-1',
        tool: 'gemini' as const,
        deniedTools: ['search_web'],
        requestedToolName: 'search_web',
        requestedToolArgs: { q: 'hello' },
        approvedCodexToolCalls: [],
        skipGeminiMcpPreflightOnce: false,
        prompt: 'do something',
        userId: 'U1',
        requestId: 'req-790',
        expiresAt: Date.now() + 120_000,
      };

      const out = processToolReject(ctx as never, pending, 'C1:1.0');
      expect(out.target).toBe('gemini');
    });

    it.each(['claude', 'codex', 'gemini'] as const)(
      'stores denied_tools in session state for %s',
      (tool) => {
        const ctx = createAppContext();
        ctx.sessionManager.get.mockReturnValue({
          tool,
          mode: 'write',
          modeExpiresAt: null,
          toolState: {},
          workdir: '/tmp/work',
        });
        const pending = {
          sessionKey: 'sk-deny',
          tool,
          deniedTools: ['mcp__aws__execute'],
          requestedToolName: 'mcp__aws__execute',
          requestedToolArgs: { cmd: 'ls' },
          approvedCodexToolCalls: [],
          skipGeminiMcpPreflightOnce: false,
          prompt: 'run aws',
          userId: 'U1',
          requestId: 'req-deny-1',
          expiresAt: Date.now() + 120_000,
        };

        // resolveApprovedToolName returns the tool name (not equal to pending.tool)
        mocked.resolveApprovedToolName.mockReturnValueOnce('mcp__aws__execute');

        processToolReject(ctx as never, pending, 'C1:1.0');

        expect(ctx.sessionManager.mergeToolState).toHaveBeenCalledWith('sk-deny', {
          denied_tools: ['mcp__aws__execute'],
        });
      },
    );

    it('appends to existing denied_tools without duplicates', () => {
      const ctx = createAppContext();
      ctx.sessionManager.get.mockReturnValue({
        tool: 'claude',
        mode: 'write',
        modeExpiresAt: null,
        toolState: { denied_tools: ['Bash'] },
        workdir: '/tmp/work',
      });
      const pending = {
        sessionKey: 'sk-deny2',
        tool: 'claude' as const,
        deniedTools: ['Write'],
        requestedToolName: 'Write',
        requestedToolArgs: { path: '/tmp/x' },
        approvedCodexToolCalls: [],
        skipGeminiMcpPreflightOnce: false,
        prompt: 'write file',
        userId: 'U1',
        requestId: 'req-deny-2',
        expiresAt: Date.now() + 120_000,
      };
      mocked.resolveApprovedToolName.mockReturnValueOnce('Write');

      processToolReject(ctx as never, pending, 'C1:1.0');

      expect(ctx.sessionManager.mergeToolState).toHaveBeenCalledWith('sk-deny2', {
        denied_tools: ['Bash', 'Write'],
      });
    });

    it('stores sentinel when tool name cannot be resolved', () => {
      mocked.resolveApprovedToolName.mockReturnValueOnce(null);
      const ctx = createAppContext();
      ctx.sessionManager.get.mockReturnValue({
        tool: 'claude',
        mode: 'write',
        modeExpiresAt: null,
        toolState: {},
        workdir: '/tmp/work',
      });
      const pending = {
        sessionKey: 'sk-deny3',
        tool: 'claude' as const,
        deniedTools: [],
        requestedToolName: null,
        requestedToolArgs: null,
        approvedCodexToolCalls: [],
        skipGeminiMcpPreflightOnce: false,
        prompt: 'do something',
        userId: 'U1',
        requestId: 'req-deny-3',
        expiresAt: Date.now() + 120_000,
      };

      processToolReject(ctx as never, pending, 'C1:1.0');

      // When resolveApprovedToolName returns null, a sentinel is stored
      // so the next prompt still gets a generic denial note.
      expect(ctx.sessionManager.mergeToolState).toHaveBeenCalledWith('sk-deny3', {
        denied_tools: ['_previous_request_'],
      });
    });
  });

  describe('processMcpAuthApprove — dashboard sync', () => {
    it('saves tool_approval_result with decision=approved to conversationStore', async () => {
      const ctx = createAppContext();
      const pending = {
        sessionKey: 'sk-2',
        tool: 'claude' as const,
        server: 'aws-api',
        action: 'retry_with_preauth' as const,
        prompt: 'deploy it',
        userId: 'U1',
        requestId: 'req-mcp-1',
        expiresAt: Date.now() + 120_000,
      };
      ctx.pendingMcpAuthBypassApprovals.set('C1:1.0', pending);

      await processMcpAuthApprove(ctx as never, pending, 'C1:1.0', 'C1', '1.0', 'U1');

      expect(mocked.saveMessage).toHaveBeenCalledWith(
        'sk-2',
        'system',
        JSON.stringify({
          type: 'tool_approval_result',
          requestId: 'req-mcp-1',
          decision: 'approved',
        }),
      );
      expect(ctx.sessionManager.mergeToolState).toHaveBeenCalledWith('sk-2', {
        claude_mcp_auth_approval_completed: true,
      });
    });

    it('saves even when prompt is null (no-rerun path)', async () => {
      const ctx = createAppContext();
      const pending = {
        sessionKey: 'sk-2',
        tool: 'claude' as const,
        server: 'aws-api',
        action: 'skip_preflight_once' as const,
        prompt: null,
        userId: 'U1',
        requestId: 'req-mcp-2',
        expiresAt: Date.now() + 120_000,
      };

      await processMcpAuthApprove(ctx as never, pending, 'C1:1.0', 'C1', '1.0', 'U1');

      expect(mocked.saveMessage).toHaveBeenCalledWith(
        'sk-2',
        'system',
        JSON.stringify({
          type: 'tool_approval_result',
          requestId: 'req-mcp-2',
          decision: 'approved',
        }),
      );
    });

    it('does not persist approval-completed when rerun enqueue fails', async () => {
      const ctx = createAppContext();
      (ctx.jobQueue.enqueue as ReturnType<typeof vi.fn>).mockReturnValue({
        error: 'Queue is not accepting new jobs (shutting down).',
      });
      const pending = {
        sessionKey: 'sk-2',
        tool: 'claude' as const,
        server: 'aws-api',
        action: 'retry_with_preauth' as const,
        prompt: 'deploy it',
        userId: 'U1',
        requestId: 'req-mcp-enqueue-fail',
        expiresAt: Date.now() + 120_000,
      };

      const outcome = await processMcpAuthApprove(
        ctx as never,
        pending,
        'C1:1.0',
        'C1',
        '1.0',
        'U1',
      );

      expect(outcome).toEqual({
        message:
          'Approved MCP auth retry. Enqueue failed: Queue is not accepting new jobs (shutting down).',
        target: 'aws-api',
      });
      expect(ctx.sessionManager.mergeToolState).not.toHaveBeenCalled();
    });
  });

  describe('processToolApprove — readonly MCP guard', () => {
    it('rejects MCP tool approval in readonly mode', async () => {
      const ctx = createAppContext();
      ctx.sessionManager.get.mockReturnValue({
        tool: 'claude',
        mode: 'readonly',
        toolState: {},
        workdir: '/tmp/work',
      });
      const pending = {
        sessionKey: 'sk-ro',
        tool: 'claude' as const,
        deniedTools: ['mcp__aws__execute'],
        requestedToolName: 'mcp__aws__execute',
        requestedToolArgs: { cmd: 'ls' },
        approvedCodexToolCalls: [],
        skipGeminiMcpPreflightOnce: false,
        prompt: 'do something',
        userId: 'U1',
        requestId: 'req-ro-1',
        expiresAt: Date.now() + 120_000,
      };

      const outcome = await processToolApprove(ctx as never, pending, 'C1:1.0', 'C1', '1.0', 'U1');
      expect(outcome.message).toContain('cannot be approved in readonly mode');
      expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
      expect(mocked.saveMessage).toHaveBeenCalledWith(
        'sk-ro',
        'system',
        JSON.stringify({
          type: 'tool_approval_result',
          requestId: 'req-ro-1',
          decision: 'denied',
        }),
      );
    });

    it('allows non-MCP tool approval in readonly mode', async () => {
      const ctx = createAppContext();
      ctx.sessionManager.get.mockReturnValue({
        tool: 'claude',
        mode: 'readonly',
        toolState: {},
        workdir: '/tmp/work',
      });
      const pending = {
        sessionKey: 'sk-ro',
        tool: 'claude' as const,
        deniedTools: ['Bash'],
        requestedToolName: 'Bash',
        requestedToolArgs: { command: 'ls' },
        approvedCodexToolCalls: [],
        skipGeminiMcpPreflightOnce: false,
        prompt: 'do something',
        userId: 'U1',
        requestId: 'req-ro-2',
        expiresAt: Date.now() + 120_000,
      };

      const outcome = await processToolApprove(ctx as never, pending, 'C1:1.0', 'C1', '1.0', 'U1');
      expect(outcome.message).not.toContain('readonly');
    });

    it('falls back to the pending tool name when approved tool name cannot be resolved', async () => {
      mocked.resolveApprovedToolName.mockReturnValueOnce(null);
      const ctx = createAppContext();
      ctx.sessionManager.get.mockReturnValue({
        tool: 'claude',
        mode: 'readonly',
        toolState: {},
        workdir: '/tmp/work',
      });
      const pending = {
        sessionKey: 'sk-ro',
        tool: 'claude' as const,
        deniedTools: ['mcp__aws__execute'],
        requestedToolName: 'mcp__aws__execute',
        requestedToolArgs: { cmd: 'ls' },
        approvedCodexToolCalls: [],
        skipGeminiMcpPreflightOnce: false,
        prompt: 'do something',
        userId: 'U1',
        requestId: 'req-ro-3',
        expiresAt: Date.now() + 120_000,
      };

      const outcome = await processToolApprove(ctx as never, pending, 'C1:1.0', 'C1', '1.0', 'U1');
      expect(outcome).toEqual({
        message: 'MCP tool `claude` cannot be approved in readonly mode.',
        target: 'claude',
      });
    });
  });

  describe('processToolApprove — wildcard approval target hardening', () => {
    it('rejects wildcard tool approval targets', async () => {
      mocked.resolveApprovedToolName.mockReturnValueOnce('mcp__aws-api__*');
      const ctx = createAppContext();
      const pending = {
        sessionKey: 'sk-wild',
        tool: 'claude' as const,
        deniedTools: ['mcp__aws-api__*'],
        requestedToolName: 'mcp__aws-api__*',
        requestedToolArgs: { cmd: 'ls' },
        approvedCodexToolCalls: [],
        skipGeminiMcpPreflightOnce: false,
        prompt: 'do something',
        userId: 'U1',
        requestId: 'req-wild-1',
        expiresAt: Date.now() + 120_000,
      };

      const outcome = await processToolApprove(ctx as never, pending, 'C1:1.0', 'C1', '1.0', 'U1');
      expect(outcome.message).toContain('wildcard tool patterns are not allowed');
      expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('processMcpAuthApprove — readonly guard', () => {
    it('rejects MCP auth approval in readonly mode', async () => {
      const ctx = createAppContext();
      ctx.sessionManager.get.mockReturnValue({
        tool: 'claude',
        mode: 'readonly',
        toolState: {},
        workdir: '/tmp/work',
      });
      const pending = {
        sessionKey: 'sk-ro',
        tool: 'claude' as const,
        server: 'aws-api',
        action: 'retry_with_preauth' as const,
        prompt: 'deploy it',
        userId: 'U1',
        requestId: 'req-ro-mcp',
        expiresAt: Date.now() + 120_000,
      };

      const outcome = await processMcpAuthApprove(
        ctx as never,
        pending,
        'C1:1.0',
        'C1',
        '1.0',
        'U1',
      );
      expect(outcome.message).toContain('cannot be approved in readonly mode');
      expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
      expect(mocked.saveMessage).toHaveBeenCalledWith(
        'sk-ro',
        'system',
        JSON.stringify({
          type: 'tool_approval_result',
          requestId: 'req-ro-mcp',
          decision: 'denied',
        }),
      );
    });
  });

  describe('processMcpAuthReject — dashboard sync', () => {
    it('saves tool_approval_result with decision=denied to conversationStore', () => {
      const ctx = createAppContext();
      const pending = {
        sessionKey: 'sk-2',
        tool: 'claude' as const,
        server: 'aws-api',
        action: 'retry_with_preauth' as const,
        prompt: 'deploy it',
        userId: 'U1',
        requestId: 'req-mcp-3',
        expiresAt: Date.now() + 120_000,
      };

      processMcpAuthReject(ctx as never, pending, 'C1:1.0');

      expect(mocked.saveMessage).toHaveBeenCalledWith(
        'sk-2',
        'system',
        JSON.stringify({
          type: 'tool_approval_result',
          requestId: 'req-mcp-3',
          decision: 'denied',
        }),
      );
    });
  });
});
