import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestAppContext } from '../test-helpers/app-context-builder.js';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocked = vi.hoisted(() => {
  const removeSessionWorkdir = vi.fn().mockReturnValue({ removed: true, skippedReason: null });
  return {
    postMessageWithContext: vi.fn().mockResolvedValue(undefined),
    postMessageWithBlocks: vi.fn().mockResolvedValue(undefined),
    updateMessageBlocks: vi.fn().mockResolvedValue(undefined),
    clearInactivityTimer: vi.fn(),
    generateChallengeCode: vi.fn().mockReturnValue('ABC123'),
    scheduleExpiry: vi.fn(),
    processToolApprove: vi.fn().mockResolvedValue({ message: 'Tool approved', target: 'Bash' }),
    processToolReject: vi.fn().mockReturnValue({ message: 'Tool rejected', target: 'Bash' }),
    processMcpAuthApprove: vi
      .fn()
      .mockResolvedValue({ message: 'MCP approved', target: 'aws-api' }),
    processMcpAuthReject: vi.fn().mockReturnValue({ message: 'MCP rejected', target: 'aws-api' }),
    buildApprovalResolvedBlocks: vi
      .fn()
      .mockReturnValue([{ type: 'section', text: { type: 'mrkdwn', text: 'resolved' } }]),
    buildSessionListBlocks: vi
      .fn()
      .mockReturnValue([{ type: 'section', text: { type: 'mrkdwn', text: 'session list' } }]),
    buildSessionClearBlocks: vi
      .fn()
      .mockReturnValue([{ type: 'section', text: { type: 'mrkdwn', text: 'session clear' } }]),
    decodeActionValue: vi.fn(),
    formatSessionClearAllSummary: vi.fn(
      (
        ctx: {
          workdirManager: {
            cleanupUnusedSessionWorkdirs: (arg: unknown[]) => number;
            archiveLegacyDefaultWorkdirIfUnused: (arg: unknown[]) => string | null;
          };
        },
        cleared: Array<{ workdir: string }>,
      ) => {
        const workdirs = Array.from(new Set(cleared.map((session) => session.workdir)));
        let removedWorkdirs = 0;
        const skippedWorkdirs: string[] = [];
        for (const workdir of workdirs) {
          const deletedWd = removeSessionWorkdir(ctx as never, workdir);
          if (deletedWd.skippedReason) {
            skippedWorkdirs.push(`\`${workdir}\` (${deletedWd.skippedReason})`);
            continue;
          }
          if (deletedWd.removed) removedWorkdirs += 1;
        }
        const orphanRemoved = ctx.workdirManager.cleanupUnusedSessionWorkdirs([]);
        const archivedDefault = ctx.workdirManager.archiveLegacyDefaultWorkdirIfUnused([]);
        const lines = [
          `Cleared all sessions: ${cleared.length}`,
          `Removed workdirs: ${removedWorkdirs + orphanRemoved}`,
        ];
        if (archivedDefault) {
          lines.push(`Archived legacy default workdir: \`${archivedDefault}\``);
        }
        if (skippedWorkdirs.length > 0) {
          lines.push(`Skipped workdir removals: ${skippedWorkdirs.join(', ')}`);
        }
        return lines.join('\n');
      },
    ),
    formatSessionClearedMessage: vi.fn(
      (
        sessionId: string,
        tool: string,
        workdir: string,
        workdirDeletion: { removed: boolean; skippedReason: string | null },
      ) => {
        const workdirLine = workdirDeletion.skippedReason
          ? `Workdir removal skipped (${workdirDeletion.skippedReason}): \`${workdir}\``
          : workdirDeletion.removed
            ? `Workdir removed: \`${workdir}\``
            : `Workdir already absent: \`${workdir}\``;
        return [`Session cleared: id=\`${sessionId}\` app=\`${tool}\``, workdirLine].join('\n');
      },
    ),
    removeSessionWorkdir,
    maybeRunSwitchPreflight: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('./app-helpers.js', () => ({
  postMessageWithContext: mocked.postMessageWithContext,
  postMessageWithBlocks: mocked.postMessageWithBlocks,
  updateMessageBlocks: mocked.updateMessageBlocks,
  clearInactivityTimer: mocked.clearInactivityTimer,
  CHALLENGE_TIMEOUT_MS: 30_000,
  generateChallengeCode: mocked.generateChallengeCode,
  scheduleExpiry: mocked.scheduleExpiry,
  toThreadKey: (c: string, t: string) => `${c}:${t}`,
}));

vi.mock('./approval-handler.js', () => ({
  processToolApprove: mocked.processToolApprove,
  processToolReject: mocked.processToolReject,
  processMcpAuthApprove: mocked.processMcpAuthApprove,
  processMcpAuthReject: mocked.processMcpAuthReject,
}));

vi.mock('./block-kit.js', () => ({
  ACTION_TOOL_APPROVE: 'proxy_tool_approve',
  ACTION_TOOL_REJECT: 'proxy_tool_reject',
  ACTION_MCP_AUTH_APPROVE: 'proxy_mcp_auth_approve',
  ACTION_MCP_AUTH_REJECT: 'proxy_mcp_auth_reject',
  ACTION_SESSION_RESUME: 'proxy_session_resume',
  ACTION_MODE_SELECT: 'proxy_mode_select',
  ACTION_MENU_TOOL_SELECT: 'proxy_menu_tool_select',
  ACTION_MENU_EXIT: 'proxy_menu_exit',
  ACTION_MENU_STOP: 'proxy_menu_stop',
  ACTION_MENU_NEW_SESSION: 'proxy_menu_new_session',
  ACTION_MENU_RESET: 'proxy_menu_reset',
  ACTION_MENU_DEV_SELECT: 'proxy_menu_dev_select',
  ACTION_MENU_SESSION_LIST: 'proxy_menu_session_list',
  ACTION_MENU_SESSION_CLEAR: 'proxy_menu_session_clear',
  ACTION_MENU_SESSION_DELETE: 'proxy_menu_session_delete',
  ACTION_MENU_SESSION_CLEAR_ALL: 'proxy_menu_session_clear_all',
  buildApprovalResolvedBlocks: mocked.buildApprovalResolvedBlocks,
  buildSessionListBlocks: mocked.buildSessionListBlocks,
  buildSessionClearBlocks: mocked.buildSessionClearBlocks,
  decodeActionValue: mocked.decodeActionValue,
}));

vi.mock('./handler-context.js', () => ({
  clearPendingStateForSession: vi.fn(),
  formatSessionClearAllSummary: mocked.formatSessionClearAllSummary,
  formatSessionClearedMessage: mocked.formatSessionClearedMessage,
  getActiveSessionRef: vi.fn().mockReturnValue(null),
  removeSessionWorkdir: mocked.removeSessionWorkdir,
  stopSessionExecution: vi.fn(),
}));

vi.mock('./mcp-preflight.js', () => ({
  maybeRunSwitchPreflight: mocked.maybeRunSwitchPreflight,
}));

import { registerActionHandlers } from './actions/register.js';
import { getActiveSessionRef } from './handler-context.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type ActionHandler = (ctx: {
  action: unknown;
  body: unknown;
  ack: () => Promise<void>;
}) => Promise<void>;

function createMockApp() {
  const handlers = new Map<string, ActionHandler>();
  return {
    action: (actionId: string | RegExp, handler: ActionHandler) => {
      const key = actionId instanceof RegExp ? actionId.source : actionId;
      handlers.set(key, handler);
    },
    getHandler: (actionId: string) => {
      // Direct match first
      const direct = handlers.get(actionId);
      if (direct) return direct;
      // Try RegExp source match
      for (const [key, handler] of handlers) {
        if (new RegExp(key).test(actionId)) return handler;
      }
      return undefined;
    },
    handlers,
  };
}

function mustGetHandler(
  mockApp: ReturnType<typeof createMockApp>,
  actionId: string,
): ActionHandler {
  const handler = mockApp.getHandler(actionId);
  if (!handler) {
    throw new Error(`missing handler: ${actionId}`);
  }
  return handler;
}

function createMockCtx() {
  const webClient = { chat: { postMessage: vi.fn(), update: vi.fn() } };
  const base = makeTestAppContext({
    webClient: webClient as never,
  });
  const getSessionByIdForThread = vi.fn().mockReturnValue(null);
  const listSessionsForThread = vi.fn().mockReturnValue([]);
  const findLatestSessionByTool = vi.fn().mockReturnValue(null);
  return {
    ...base,
    webClient,
    pendingConfirmations: {
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
    },
    sessionManager: {
      ...base.sessionManager,
      getSessionByIdForThread,
      getSessionByIdForThreadOwned: getSessionByIdForThread,
      getSessionSummaryByIdForThreadOwned: vi.fn().mockReturnValue(null),
      setActiveSessionKey: vi.fn(),
      getSessionSummary: vi.fn().mockReturnValue(null),
      clearActiveSession: vi.fn(),
      findLatestSessionByTool,
      findLatestSessionByToolOwned: findLatestSessionByTool,
      createSessionForThread: vi.fn().mockReturnValue({
        sessionKey: 'sk-new',
        tool: 'claude',
        mode: 'readonly',
        workdir: '/tmp/work',
        toolState: {},
      }),
      updateMode: vi.fn(),
      updateToolState: vi.fn(),
      reset: vi.fn(),
      findDevSession: vi.fn().mockReturnValue(null),
      createDevSession: vi.fn().mockReturnValue({
        sessionKey: 'sk-dev',
        tool: 'claude',
        mode: 'readonly',
        workdir: '/tmp/dev-work',
        toolState: {},
      }),
      listSessionsForThread,
      listSessionsForThreadOwned: listSessionsForThread,
      deleteSessionById: vi.fn().mockReturnValue(null),
      deleteSessionsByIds: vi.fn().mockReturnValue([]),
    },
    workdirManager: {
      ...base.workdirManager,
      prepareWorkdirForTool: vi.fn(),
      prepareWorkdirForToolWithPolicy: vi.fn(),
      prepareWorkdirSkillsOnly: vi.fn(),
      prepareDevWorkdir: vi.fn(),
      seedDevInstructionFile: vi.fn(),
      cleanupUnusedSessionWorkdirs: vi.fn().mockReturnValue(0),
      archiveLegacyDefaultWorkdirIfUnused: vi.fn().mockReturnValue(null),
    },
    devAliasStore: {
      ...base.devAliasStore,
      get: vi.fn().mockReturnValue(null),
      list: vi.fn().mockReturnValue([]),
    },
    jobQueue: {
      ...base.jobQueue,
      cancelSession: vi.fn(),
      getRunningJob: vi.fn().mockReturnValue(null),
    },
    auditStore: {
      ...base.auditStore,
      logModeChange: vi.fn(),
    },
  };
}

const THREAD_KEY = 'C1:1.0';
const REQUEST_ID = 'req-abc';

function pendingToolApproval() {
  return {
    sessionKey: 'sk-1',
    tool: 'claude' as const,
    deniedTools: ['bash'],
    requestedToolName: 'Bash',
    requestedToolArgs: { command: 'ls' },
    approvedCodexToolCalls: [],
    skipGeminiMcpPreflightOnce: false,
    prompt: 'do it',
    userId: 'U1',
    requestId: REQUEST_ID,
    expiresAt: Date.now() + 120_000,
  };
}

function pendingMcpAuth() {
  return {
    sessionKey: 'sk-2',
    tool: 'claude' as const,
    server: 'aws-api',
    action: 'retry_with_preauth' as const,
    prompt: 'deploy',
    userId: 'U2',
    requestId: REQUEST_ID,
    expiresAt: Date.now() + 120_000,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('action-handlers', () => {
  let mockApp: ReturnType<typeof createMockApp>;
  let ctx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApp = createMockApp();
    ctx = createMockCtx();
    mocked.decodeActionValue.mockReturnValue({ tk: THREAD_KEY, rid: REQUEST_ID });
    registerActionHandlers(ctx as never, mockApp as never);
  });

  it('registers all 16 action handlers', () => {
    expect(mockApp.handlers.size).toBe(16);
    expect(mockApp.getHandler('proxy_tool_approve')).toBeDefined();
    expect(mockApp.getHandler('proxy_tool_reject')).toBeDefined();
    expect(mockApp.getHandler('proxy_mcp_auth_approve')).toBeDefined();
    expect(mockApp.getHandler('proxy_mcp_auth_reject')).toBeDefined();
    expect(mockApp.getHandler('proxy_session_resume')).toBeDefined();
    expect(mockApp.getHandler('proxy_mode_select')).toBeDefined();
    expect(mockApp.getHandler('proxy_menu_tool_select_claude')).toBeDefined();
    expect(mockApp.getHandler('proxy_menu_exit')).toBeDefined();
    expect(mockApp.getHandler('proxy_menu_stop')).toBeDefined();
    expect(mockApp.getHandler('proxy_menu_new_session')).toBeDefined();
    expect(mockApp.getHandler('proxy_menu_reset')).toBeDefined();
    expect(mockApp.getHandler('proxy_menu_dev_select_myalias')).toBeDefined();
    expect(mockApp.getHandler('proxy_menu_session_list')).toBeDefined();
    expect(mockApp.getHandler('proxy_menu_session_clear')).toBeDefined();
    expect(mockApp.getHandler('proxy_menu_session_delete')).toBeDefined();
    expect(mockApp.getHandler('proxy_menu_session_clear_all')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Tool Approve
  // -----------------------------------------------------------------------

  describe('tool_approve', () => {
    it('calls processToolApprove and updates message', async () => {
      const pending = pendingToolApproval();
      ctx.pendingToolApprovals.set(THREAD_KEY, pending);

      const handler = mustGetHandler(mockApp, 'proxy_tool_approve');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: {
          user: { id: 'U1' },
          channel: { id: 'C1' },
          message: { ts: '999.0' },
        },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processToolApprove).toHaveBeenCalledWith(
        ctx,
        pending,
        THREAD_KEY,
        'C1',
        '1.0',
        'U1',
      );
      expect(mocked.updateMessageBlocks).toHaveBeenCalled();
      expect(mocked.postMessageWithContext).toHaveBeenCalled();
    });

    it('ignores when no pending approval exists', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_tool_approve');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processToolApprove).not.toHaveBeenCalled();
    });

    it('ignores expired approval', async () => {
      const pending = pendingToolApproval();
      pending.expiresAt = Date.now() - 1;
      ctx.pendingToolApprovals.set(THREAD_KEY, pending);

      const handler = mustGetHandler(mockApp, 'proxy_tool_approve');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processToolApprove).not.toHaveBeenCalled();
      expect(ctx.pendingToolApprovals.has(THREAD_KEY)).toBe(false);
    });

    it('rejects approval from different user', async () => {
      const pending = pendingToolApproval();
      ctx.pendingToolApprovals.set(THREAD_KEY, pending);

      const handler = mustGetHandler(mockApp, 'proxy_tool_approve');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U_OTHER' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processToolApprove).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        'Only the user who requested the previous run can approve this tool execution.',
        expect.any(Object),
      );
    });

    it('ignores non-button action types', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_tool_approve');
      await handler({
        action: { type: 'static_select' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processToolApprove).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Tool Approve — catch block
  // -----------------------------------------------------------------------

  it('tool_approve catches and logs error', async () => {
    const pending = pendingToolApproval();
    ctx.pendingToolApprovals.set(THREAD_KEY, pending);
    mocked.processToolApprove.mockRejectedValueOnce(new Error('boom'));

    const handler = mustGetHandler(mockApp, 'proxy_tool_approve');
    await handler({
      action: { type: 'button', value: 'encoded' },
      body: { user: { id: 'U1' }, channel: { id: 'C1' }, message: { ts: '999.0' } },
      ack: vi.fn().mockResolvedValue(undefined),
    });

    // Should not throw — error is caught internally
    expect(mocked.processToolApprove).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Tool Reject
  // -----------------------------------------------------------------------

  describe('tool_reject', () => {
    it('calls processToolReject and updates message', async () => {
      const pending = pendingToolApproval();
      ctx.pendingToolApprovals.set(THREAD_KEY, pending);

      const handler = mustGetHandler(mockApp, 'proxy_tool_reject');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: {
          user: { id: 'U1' },
          channel: { id: 'C1' },
          message: { ts: '999.0' },
        },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processToolReject).toHaveBeenCalledWith(ctx, pending, THREAD_KEY);
      expect(mocked.updateMessageBlocks).toHaveBeenCalled();
    });

    it('deletes expired approval and returns', async () => {
      const pending = pendingToolApproval();
      pending.expiresAt = Date.now() - 1;
      ctx.pendingToolApprovals.set(THREAD_KEY, pending);

      const handler = mustGetHandler(mockApp, 'proxy_tool_reject');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processToolReject).not.toHaveBeenCalled();
      expect(ctx.pendingToolApprovals.has(THREAD_KEY)).toBe(false);
    });

    it('rejects from different user', async () => {
      const pending = pendingToolApproval();
      ctx.pendingToolApprovals.set(THREAD_KEY, pending);

      const handler = mustGetHandler(mockApp, 'proxy_tool_reject');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U_OTHER' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processToolReject).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        'Only the user who requested the previous run can approve this tool execution.',
        expect.any(Object),
      );
    });

    it('catches and logs error', async () => {
      const pending = pendingToolApproval();
      ctx.pendingToolApprovals.set(THREAD_KEY, pending);
      mocked.processToolReject.mockImplementationOnce(() => {
        throw new Error('reject boom');
      });

      const handler = mustGetHandler(mockApp, 'proxy_tool_reject');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' }, channel: { id: 'C1' }, message: { ts: '999.0' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      // Should not throw
      expect(mocked.processToolReject).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // MCP Auth Approve
  // -----------------------------------------------------------------------

  describe('mcp_auth_approve', () => {
    it('calls processMcpAuthApprove and updates message', async () => {
      const pending = pendingMcpAuth();
      ctx.pendingMcpAuthBypassApprovals.set(THREAD_KEY, pending);

      const handler = mustGetHandler(mockApp, 'proxy_mcp_auth_approve');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: {
          user: { id: 'U2' },
          channel: { id: 'C1' },
          message: { ts: '999.0' },
        },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processMcpAuthApprove).toHaveBeenCalledWith(
        ctx,
        pending,
        THREAD_KEY,
        'C1',
        '1.0',
        'U2',
      );
      expect(mocked.updateMessageBlocks).toHaveBeenCalled();
    });

    it('rejects approval from different user', async () => {
      const pending = pendingMcpAuth();
      ctx.pendingMcpAuthBypassApprovals.set(THREAD_KEY, pending);

      const handler = mustGetHandler(mockApp, 'proxy_mcp_auth_approve');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U_OTHER' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processMcpAuthApprove).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        'Only the user who requested the previous run can approve this MCP auth action.',
        expect.any(Object),
      );
    });

    it('deletes expired MCP auth approval and returns', async () => {
      const pending = pendingMcpAuth();
      pending.expiresAt = Date.now() - 1;
      ctx.pendingMcpAuthBypassApprovals.set(THREAD_KEY, pending);

      const handler = mustGetHandler(mockApp, 'proxy_mcp_auth_approve');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U2' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processMcpAuthApprove).not.toHaveBeenCalled();
      expect(ctx.pendingMcpAuthBypassApprovals.has(THREAD_KEY)).toBe(false);
    });

    it('catches and logs error', async () => {
      const pending = pendingMcpAuth();
      ctx.pendingMcpAuthBypassApprovals.set(THREAD_KEY, pending);
      mocked.processMcpAuthApprove.mockRejectedValueOnce(new Error('mcp boom'));

      const handler = mustGetHandler(mockApp, 'proxy_mcp_auth_approve');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U2' }, channel: { id: 'C1' }, message: { ts: '999.0' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processMcpAuthApprove).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // MCP Auth Reject
  // -----------------------------------------------------------------------

  describe('mcp_auth_reject', () => {
    it('calls processMcpAuthReject and updates message', async () => {
      const pending = pendingMcpAuth();
      ctx.pendingMcpAuthBypassApprovals.set(THREAD_KEY, pending);

      const handler = mustGetHandler(mockApp, 'proxy_mcp_auth_reject');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: {
          user: { id: 'U2' },
          channel: { id: 'C1' },
          message: { ts: '999.0' },
        },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processMcpAuthReject).toHaveBeenCalledWith(ctx, pending, THREAD_KEY);
      expect(mocked.updateMessageBlocks).toHaveBeenCalled();
    });

    it('deletes expired MCP auth reject and returns', async () => {
      const pending = pendingMcpAuth();
      pending.expiresAt = Date.now() - 1;
      ctx.pendingMcpAuthBypassApprovals.set(THREAD_KEY, pending);

      const handler = mustGetHandler(mockApp, 'proxy_mcp_auth_reject');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U2' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processMcpAuthReject).not.toHaveBeenCalled();
      expect(ctx.pendingMcpAuthBypassApprovals.has(THREAD_KEY)).toBe(false);
    });

    it('rejects from different user', async () => {
      const pending = pendingMcpAuth();
      ctx.pendingMcpAuthBypassApprovals.set(THREAD_KEY, pending);

      const handler = mustGetHandler(mockApp, 'proxy_mcp_auth_reject');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U_OTHER' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processMcpAuthReject).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        'Only the user who requested the previous run can approve this MCP auth action.',
        expect.any(Object),
      );
    });

    it('catches and logs error', async () => {
      const pending = pendingMcpAuth();
      ctx.pendingMcpAuthBypassApprovals.set(THREAD_KEY, pending);
      mocked.processMcpAuthReject.mockImplementationOnce(() => {
        throw new Error('reject boom');
      });

      const handler = mustGetHandler(mockApp, 'proxy_mcp_auth_reject');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U2' }, channel: { id: 'C1' }, message: { ts: '999.0' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processMcpAuthReject).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Session Resume
  // -----------------------------------------------------------------------

  describe('session_resume', () => {
    it('resumes session when target exists', async () => {
      const target = {
        sessionKey: 'sk-3',
        session: { tool: 'claude', mode: 'readonly' },
        workdir: '/tmp/w',
        tool: 'claude',
      };
      ctx.sessionManager.getSessionByIdForThread.mockReturnValue(target);
      ctx.sessionManager.getSessionSummary.mockReturnValue({
        sessionId: 'sess-001',
      });

      const handler = mustGetHandler(mockApp, 'proxy_session_resume');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.setActiveSessionKey).toHaveBeenCalledWith(THREAD_KEY, 'sk-3');
      expect(ctx.workdirManager.prepareWorkdirSkillsOnly).toHaveBeenCalledWith('/tmp/w', 'claude');
      expect(mocked.postMessageWithContext).toHaveBeenCalled();
    });

    it('posts error when target session not found', async () => {
      ctx.sessionManager.getSessionByIdForThread.mockReturnValue(null);

      const handler = mustGetHandler(mockApp, 'proxy_session_resume');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('was not found'),
      );
    });

    it('blocks resume when another session is active', async () => {
      const target = {
        sessionKey: 'sk-new',
        session: { tool: 'claude', mode: 'readonly' },
        workdir: '/tmp/w',
        tool: 'claude',
      };
      ctx.sessionManager.getSessionByIdForThread.mockReturnValue(target);

      // Mock an active session with a different key
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-old',
        session: { tool: 'gemini', mode: 'readonly' } as never,
      });

      const handler = mustGetHandler(mockApp, 'proxy_session_resume');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.setActiveSessionKey).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Cannot switch sessions'),
        expect.any(Object),
      );

      // Restore mock
      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });

    it('catches and logs error', async () => {
      const target = {
        sessionKey: 'sk-3',
        session: { tool: 'claude', mode: 'readonly' },
        workdir: '/tmp/w',
        tool: 'claude',
      };
      ctx.sessionManager.getSessionByIdForThread.mockReturnValue(target);
      ctx.sessionManager.setActiveSessionKey.mockImplementationOnce(() => {
        throw new Error('resume boom');
      });

      const handler = mustGetHandler(mockApp, 'proxy_session_resume');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      // Should not throw
      expect(ctx.sessionManager.setActiveSessionKey).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Mode Select
  // -----------------------------------------------------------------------

  describe('mode_select', () => {
    it('sets readonly mode immediately', async () => {
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'claude', mode: 'write' } as never,
      });

      mocked.decodeActionValue.mockReturnValue({ tk: THREAD_KEY, rid: '' });

      const handler = mustGetHandler(mockApp, 'proxy_mode_select');
      await handler({
        action: {
          type: 'static_select',
          selected_option: {
            value: JSON.stringify({ tk: THREAD_KEY, mode: 'readonly' }),
          },
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.updateMode).toHaveBeenCalledWith('sk-active', 'readonly', null);
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        'Mode set to readonly.',
        expect.any(Object),
      );

      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });

    it('triggers challenge code for write mode', async () => {
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'claude', mode: 'readonly' } as never,
      });

      const handler = mustGetHandler(mockApp, 'proxy_mode_select');
      await handler({
        action: {
          type: 'static_select',
          selected_option: {
            value: JSON.stringify({ tk: THREAD_KEY, mode: 'write' }),
          },
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.updateMode).not.toHaveBeenCalled();
      expect(ctx.pendingConfirmations.set).toHaveBeenCalledWith(
        THREAD_KEY,
        expect.objectContaining({ kind: 'mode', mode: 'write', code: 'ABC123' }),
        30_000,
      );
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('!confirm ABC123'),
        expect.any(Object),
      );

      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });

    it('posts error when no active session', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_mode_select');
      await handler({
        action: {
          type: 'static_select',
          selected_option: {
            value: JSON.stringify({ tk: THREAD_KEY, mode: 'readonly' }),
          },
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('No active session'),
      );
    });

    it('catches and logs error', async () => {
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'claude', mode: 'write' } as never,
      });
      mocked.postMessageWithContext.mockRejectedValueOnce(new Error('mode boom'));

      const handler = mustGetHandler(mockApp, 'proxy_mode_select');
      await handler({
        action: {
          type: 'static_select',
          selected_option: {
            value: JSON.stringify({ tk: THREAD_KEY, mode: 'readonly' }),
          },
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      // Should not throw
      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });
  });

  // -----------------------------------------------------------------------
  // New Session
  // -----------------------------------------------------------------------

  describe('menu_new_session', () => {
    it('creates new session using active tool', async () => {
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'gemini', mode: 'readonly', toolState: {} } as never,
      });
      ctx.sessionManager.createSessionForThread.mockReturnValue({
        sessionKey: 'sk-created',
        tool: 'gemini',
        mode: 'readonly',
        workdir: '/tmp/new',
        toolState: {},
      });
      ctx.sessionManager.getSessionSummary.mockReturnValue({ sessionId: 'new-sess' });

      const handler = mustGetHandler(mockApp, 'proxy_menu_new_session');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.createSessionForThread).toHaveBeenCalledWith(
        THREAD_KEY,
        'U1',
        'gemini',
      );
      expect(ctx.workdirManager.prepareWorkdirSkillsOnly).toHaveBeenCalledWith(
        '/tmp/new',
        'gemini',
      );
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('New session started'),
        expect.any(Object),
      );
      expect(mocked.maybeRunSwitchPreflight).toHaveBeenCalled();

      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });

    it('posts error when no active session', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_new_session');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.createSessionForThread).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('No active session'),
      );
    });

    it('ignores invalid payload', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_new_session');
      await handler({
        action: { type: 'button', value: 'not-json' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.createSessionForThread).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
    });

    it('catches and logs error', async () => {
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'gemini', mode: 'readonly', toolState: {} } as never,
      });
      ctx.sessionManager.createSessionForThread.mockImplementationOnce(() => {
        throw new Error('new session boom');
      });

      const handler = mustGetHandler(mockApp, 'proxy_menu_new_session');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      // Should not throw
      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });
  });

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  describe('menu_reset', () => {
    it('resets active session', async () => {
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'claude', mode: 'write', toolState: {} } as never,
      });

      const handler = mustGetHandler(mockApp, 'proxy_menu_reset');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.reset).toHaveBeenCalledWith('sk-active');
      expect(ctx.jobQueue.cancelSession).toHaveBeenCalledWith('sk-active');
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        'Session reset.',
        expect.any(Object),
      );

      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });

    it('kills running job before reset', async () => {
      const mockRunner = { isRunning: vi.fn().mockReturnValue(true), kill: vi.fn() };
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'claude', mode: 'write', toolState: {} } as never,
      });
      ctx.activeRunners.set('sk-active', { runner: mockRunner, job: {} as never } as never);

      const handler = mustGetHandler(mockApp, 'proxy_menu_reset');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mockRunner.kill).toHaveBeenCalledWith('reset');
      expect(ctx.sessionManager.reset).toHaveBeenCalledWith('sk-active');

      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });

    it('posts error when no active session', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_reset');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.reset).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        'No active session.',
      );
    });

    it('clears pending state on reset', async () => {
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'claude', mode: 'write', toolState: {} } as never,
      });
      ctx.pendingToolApprovals.set(THREAD_KEY, pendingToolApproval());
      ctx.pendingMcpAuthBypassApprovals.set(THREAD_KEY, pendingMcpAuth());

      const handler = mustGetHandler(mockApp, 'proxy_menu_reset');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.pendingToolApprovals.has(THREAD_KEY)).toBe(false);
      expect(ctx.pendingMcpAuthBypassApprovals.has(THREAD_KEY)).toBe(false);
      expect(ctx.pendingConfirmations.delete).toHaveBeenCalledWith(THREAD_KEY);

      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });

    it('ignores invalid payload', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_reset');
      await handler({
        action: { type: 'button', value: 'not-json' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.reset).not.toHaveBeenCalled();
    });

    it('catches and logs error', async () => {
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'claude', mode: 'write', toolState: {} } as never,
      });
      ctx.sessionManager.reset.mockImplementationOnce(() => {
        throw new Error('reset boom');
      });

      const handler = mustGetHandler(mockApp, 'proxy_menu_reset');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      // Should not throw
      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });
  });

  // -----------------------------------------------------------------------
  // Dev Alias Select
  // -----------------------------------------------------------------------

  describe('menu_dev_select', () => {
    it('creates new dev session when alias exists and no existing session', async () => {
      ctx.devAliasStore.get.mockReturnValue({
        name: 'myapp',
        path: '/home/user/myapp',
        tool: 'claude',
        instructionContent: 'Build features',
        createdAt: '2026-01-01T00:00:00Z',
      });
      ctx.sessionManager.findDevSession.mockReturnValue(null);
      ctx.sessionManager.createDevSession.mockReturnValue({
        sessionKey: 'sk-dev-new',
        tool: 'claude',
        mode: 'readonly',
        workdir: '/tmp/dev/myapp',
        toolState: {},
      });
      ctx.sessionManager.getSessionSummary.mockReturnValue({ sessionId: 'dev-sess-001' });

      const handler = mustGetHandler(mockApp, 'proxy_menu_dev_select_myapp');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY, alias: 'myapp' }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.createDevSession).toHaveBeenCalledWith(
        THREAD_KEY,
        'U1',
        expect.objectContaining({ name: 'myapp', tool: 'claude' }),
      );
      expect(ctx.workdirManager.prepareDevWorkdir).toHaveBeenCalledWith('/tmp/dev/myapp');
      expect(ctx.workdirManager.seedDevInstructionFile).toHaveBeenCalledWith(
        '/tmp/dev/myapp',
        'claude',
        'Build features',
      );
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Dev session started'),
        expect.any(Object),
      );
    });

    it('resumes existing dev session', async () => {
      ctx.devAliasStore.get.mockReturnValue({
        name: 'myapp',
        path: '/home/user/myapp',
        tool: 'claude',
        instructionContent: null,
        createdAt: '2026-01-01T00:00:00Z',
      });
      ctx.sessionManager.findDevSession.mockReturnValue({
        sessionKey: 'sk-dev-existing',
        tool: 'claude',
        workdir: '/tmp/dev/myapp',
      });
      ctx.sessionManager.getSessionSummary.mockReturnValue({ sessionId: 'dev-sess-existing' });

      const handler = mustGetHandler(mockApp, 'proxy_menu_dev_select_myapp');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY, alias: 'myapp' }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.setActiveSessionKey).toHaveBeenCalledWith(
        THREAD_KEY,
        'sk-dev-existing',
      );
      expect(ctx.workdirManager.prepareDevWorkdir).toHaveBeenCalledWith('/tmp/dev/myapp');
      expect(ctx.sessionManager.createDevSession).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Dev session resumed'),
        expect.any(Object),
      );
    });

    it('posts error when alias not found', async () => {
      ctx.devAliasStore.get.mockReturnValue(null);

      const handler = mustGetHandler(mockApp, 'proxy_menu_dev_select_missing');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY, alias: 'missing' }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.createDevSession).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('not found'),
      );
    });

    it('blocks when another session is active', async () => {
      ctx.devAliasStore.get.mockReturnValue({
        name: 'myapp',
        path: '/home/user/myapp',
        tool: 'claude',
        instructionContent: null,
        createdAt: '2026-01-01T00:00:00Z',
      });
      ctx.sessionManager.findDevSession.mockReturnValue(null);

      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-other',
        session: { tool: 'gemini', mode: 'readonly' } as never,
      });

      const handler = mustGetHandler(mockApp, 'proxy_menu_dev_select_myapp');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY, alias: 'myapp' }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.createDevSession).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Cannot start dev session'),
        expect.any(Object),
      );

      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });

    it('does not seed instruction file when instructionContent is null', async () => {
      ctx.devAliasStore.get.mockReturnValue({
        name: 'myapp',
        path: '/home/user/myapp',
        tool: 'claude',
        instructionContent: null,
        createdAt: '2026-01-01T00:00:00Z',
      });
      ctx.sessionManager.findDevSession.mockReturnValue(null);
      ctx.sessionManager.createDevSession.mockReturnValue({
        sessionKey: 'sk-dev',
        tool: 'claude',
        workdir: '/tmp/dev/myapp',
        toolState: {},
      });

      const handler = mustGetHandler(mockApp, 'proxy_menu_dev_select_myapp');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY, alias: 'myapp' }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.workdirManager.seedDevInstructionFile).not.toHaveBeenCalled();
    });

    it('ignores invalid payload (missing alias)', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_dev_select_myapp');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.createDevSession).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
    });

    it('catches and logs error', async () => {
      ctx.devAliasStore.get.mockReturnValue({
        name: 'myapp',
        path: '/home/user/myapp',
        tool: 'claude',
        instructionContent: null,
        createdAt: '2026-01-01T00:00:00Z',
      });
      ctx.sessionManager.findDevSession.mockReturnValue(null);
      ctx.sessionManager.createDevSession.mockImplementationOnce(() => {
        throw new Error('dev boom');
      });

      const handler = mustGetHandler(mockApp, 'proxy_menu_dev_select_myapp');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY, alias: 'myapp' }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      // Should not throw
      expect(ctx.sessionManager.createDevSession).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Session List Button
  // -----------------------------------------------------------------------

  describe('menu_session_list', () => {
    it('posts session list blocks when sessions exist', async () => {
      const sessions = [
        { sessionId: 'sess-1', tool: 'claude', startedAt: '2026-02-22', updatedAt: '2026-02-22' },
        { sessionId: 'sess-2', tool: 'gemini', startedAt: '2026-02-21', updatedAt: '2026-02-22' },
      ];
      ctx.sessionManager.listSessionsForThread.mockReturnValue(sessions);

      const handler = mustGetHandler(mockApp, 'proxy_menu_session_list');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.buildSessionListBlocks).toHaveBeenCalledWith(sessions, THREAD_KEY);
      expect(mocked.postMessageWithBlocks).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        mocked.buildSessionListBlocks.mock.results[0]?.value,
        expect.stringContaining('2 found'),
      );
    });

    it('posts empty fallback when no sessions', async () => {
      ctx.sessionManager.listSessionsForThread.mockReturnValue([]);

      const handler = mustGetHandler(mockApp, 'proxy_menu_session_list');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.buildSessionListBlocks).toHaveBeenCalledWith([], THREAD_KEY);
      expect(mocked.postMessageWithBlocks).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.anything(),
        'No sessions found.',
      );
    });

    it('ignores invalid payload', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_session_list');
      await handler({
        action: { type: 'button', value: 'not-json' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithBlocks).not.toHaveBeenCalled();
    });

    it('catches and logs error', async () => {
      ctx.sessionManager.listSessionsForThread.mockImplementationOnce(() => {
        throw new Error('list boom');
      });

      const handler = mustGetHandler(mockApp, 'proxy_menu_session_list');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      // Should not throw
    });
  });

  // -----------------------------------------------------------------------
  // Session Clear View Button
  // -----------------------------------------------------------------------

  describe('menu_session_clear', () => {
    it('posts session clear blocks when sessions exist', async () => {
      const sessions = [
        { sessionId: 'sess-1', tool: 'claude', startedAt: '2026-02-22', updatedAt: '2026-02-22' },
      ];
      ctx.sessionManager.listSessionsForThread.mockReturnValue(sessions);

      const handler = mustGetHandler(mockApp, 'proxy_menu_session_clear');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.buildSessionClearBlocks).toHaveBeenCalledWith(sessions, THREAD_KEY);
      expect(mocked.postMessageWithBlocks).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        mocked.buildSessionClearBlocks.mock.results[0]?.value,
        expect.stringContaining('1 sessions'),
      );
    });

    it('posts empty fallback when no sessions', async () => {
      ctx.sessionManager.listSessionsForThread.mockReturnValue([]);

      const handler = mustGetHandler(mockApp, 'proxy_menu_session_clear');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.buildSessionClearBlocks).toHaveBeenCalledWith([], THREAD_KEY);
      expect(mocked.postMessageWithBlocks).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.anything(),
        'No sessions to clear.',
      );
    });

    it('ignores invalid payload', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_session_clear');
      await handler({
        action: { type: 'button', value: 'not-json' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithBlocks).not.toHaveBeenCalled();
    });

    it('catches and logs error', async () => {
      ctx.sessionManager.listSessionsForThread.mockImplementationOnce(() => {
        throw new Error('clear view boom');
      });

      const handler = mustGetHandler(mockApp, 'proxy_menu_session_clear');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      // Should not throw
    });
  });

  // -----------------------------------------------------------------------
  // Session Delete Button (per-session)
  // -----------------------------------------------------------------------

  describe('menu_session_delete', () => {
    it('deletes session and removes workdir', async () => {
      mocked.decodeActionValue.mockReturnValue({ tk: THREAD_KEY, rid: 'sess-del' });
      ctx.sessionManager.getSessionSummaryByIdForThreadOwned.mockReturnValue({
        sessionKey: 'sk-del',
        sessionId: 'sess-del',
        threadKey: THREAD_KEY,
        userId: 'U1',
        tool: 'claude',
        active: false,
      });
      ctx.sessionManager.deleteSessionById.mockReturnValue({
        workdir: '/tmp/sess-del-work',
        tool: 'claude',
      });
      mocked.removeSessionWorkdir.mockReturnValue({ removed: true, skippedReason: null });

      const handler = mustGetHandler(mockApp, 'proxy_menu_session_delete');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.getSessionSummaryByIdForThreadOwned).toHaveBeenCalledWith(
        THREAD_KEY,
        'U1',
        'sess-del',
      );
      expect(ctx.sessionManager.deleteSessionById).toHaveBeenCalledWith('sess-del');
      expect(mocked.removeSessionWorkdir).toHaveBeenCalledWith(ctx, '/tmp/sess-del-work');
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Session cleared'),
      );
    });

    it('posts error when session not found', async () => {
      mocked.decodeActionValue.mockReturnValue({ tk: THREAD_KEY, rid: 'sess-missing' });

      const handler = mustGetHandler(mockApp, 'proxy_menu_session_delete');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.deleteSessionById).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('was not found'),
      );
    });

    it('posts error when deleteSessionById returns null', async () => {
      mocked.decodeActionValue.mockReturnValue({ tk: THREAD_KEY, rid: 'sess-gone' });
      ctx.sessionManager.getSessionSummaryByIdForThreadOwned.mockReturnValue({
        sessionKey: 'sk-gone',
        sessionId: 'sess-gone',
        threadKey: THREAD_KEY,
        userId: 'U1',
        tool: 'claude',
        active: false,
      });
      ctx.sessionManager.deleteSessionById.mockReturnValue(null);

      const handler = mustGetHandler(mockApp, 'proxy_menu_session_delete');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.removeSessionWorkdir).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('no longer exists'),
      );
    });

    it('reports skipped workdir removal', async () => {
      mocked.decodeActionValue.mockReturnValue({ tk: THREAD_KEY, rid: 'sess-skip' });
      ctx.sessionManager.getSessionSummaryByIdForThreadOwned.mockReturnValue({
        sessionKey: 'sk-skip',
        sessionId: 'sess-skip',
        threadKey: THREAD_KEY,
        userId: 'U1',
        tool: 'gemini',
        active: false,
      });
      ctx.sessionManager.deleteSessionById.mockReturnValue({
        workdir: '/outside/boundary',
        tool: 'gemini',
      });
      mocked.removeSessionWorkdir.mockReturnValue({
        removed: false,
        skippedReason: 'outside managed directory',
      });

      const handler = mustGetHandler(mockApp, 'proxy_menu_session_delete');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Workdir removal skipped'),
      );
    });

    it('clears inactivity timer when deleting active session', async () => {
      mocked.decodeActionValue.mockReturnValue({ tk: THREAD_KEY, rid: 'sess-active' });
      ctx.sessionManager.getSessionSummaryByIdForThreadOwned.mockReturnValue({
        sessionKey: 'sk-active',
        sessionId: 'sess-active',
        threadKey: THREAD_KEY,
        userId: 'U1',
        tool: 'claude',
        active: true,
      });
      ctx.sessionManager.deleteSessionById.mockReturnValue({
        workdir: '/tmp/active-work',
        tool: 'claude',
      });
      mocked.removeSessionWorkdir.mockReturnValue({ removed: true, skippedReason: null });

      const handler = mustGetHandler(mockApp, 'proxy_menu_session_delete');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.deleteSessionById).toHaveBeenCalledWith('sess-active');
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Session cleared'),
      );
    });

    it('catches and logs error', async () => {
      mocked.decodeActionValue.mockReturnValue({ tk: THREAD_KEY, rid: 'sess-err' });
      ctx.sessionManager.getSessionSummaryByIdForThreadOwned.mockImplementationOnce(() => {
        throw new Error('delete boom');
      });

      const handler = mustGetHandler(mockApp, 'proxy_menu_session_delete');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      // Should not throw
    });
  });

  // -----------------------------------------------------------------------
  // Session Clear All Button
  // -----------------------------------------------------------------------

  describe('menu_session_clear_all', () => {
    it('clears all sessions and workdirs', async () => {
      const allSessions = [
        { sessionId: 'sess-a', sessionKey: 'sk-a', workdir: '/tmp/a', active: true },
        { sessionId: 'sess-b', sessionKey: 'sk-b', workdir: '/tmp/b', active: false },
      ];
      ctx.sessionManager.listSessionsForThread.mockReturnValue(allSessions);
      ctx.sessionManager.deleteSessionsByIds.mockReturnValue([
        { workdir: '/tmp/a', tool: 'claude' },
        { workdir: '/tmp/b', tool: 'gemini' },
      ]);
      mocked.removeSessionWorkdir.mockReturnValue({ removed: true, skippedReason: null });

      const handler = mustGetHandler(mockApp, 'proxy_menu_session_clear_all');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.listSessionsForThread).toHaveBeenCalledWith(THREAD_KEY, 'U1');
      expect(ctx.sessionManager.deleteSessionsByIds).toHaveBeenCalledWith(['sess-a', 'sess-b']);
      expect(mocked.removeSessionWorkdir).toHaveBeenCalledTimes(2);
      expect(ctx.workdirManager.cleanupUnusedSessionWorkdirs).toHaveBeenCalledWith([]);
      expect(ctx.workdirManager.archiveLegacyDefaultWorkdirIfUnused).toHaveBeenCalledWith([]);
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Cleared all sessions: 2'),
      );
    });

    it('clears pending state maps and inactivity timers', async () => {
      ctx.sessionManager.listSessionsForThread.mockReturnValue([
        { sessionId: 'sess-a', sessionKey: 'sk-a', active: true },
        { sessionId: 'sess-b', sessionKey: 'sk-b', active: false },
      ]);
      ctx.sessionManager.deleteSessionsByIds.mockReturnValue([
        { workdir: '/tmp/a', tool: 'claude' },
      ]);
      ctx.inactivityTimers.set(
        THREAD_KEY,
        setTimeout(() => {}, 100_000),
      );

      const { clearPendingStateForSession } = await import('./handler-context.js');

      const handler = mustGetHandler(mockApp, 'proxy_menu_session_clear_all');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      // Per-session clearPendingStateForSession is called for each owned session
      expect(clearPendingStateForSession).toHaveBeenCalledWith(ctx, 'sk-a');
      expect(clearPendingStateForSession).toHaveBeenCalledWith(ctx, 'sk-b');
      expect(mocked.clearInactivityTimer).toHaveBeenCalledWith(ctx, THREAD_KEY);
    });

    it('reports skipped workdir removals', async () => {
      ctx.sessionManager.listSessionsForThread.mockReturnValue([
        { sessionId: 'sess-x', sessionKey: 'sk-x', active: false },
      ]);
      ctx.sessionManager.deleteSessionsByIds.mockReturnValue([
        { workdir: '/outside/managed', tool: 'claude' },
      ]);
      mocked.removeSessionWorkdir.mockReturnValue({
        removed: false,
        skippedReason: 'outside managed directory',
      });

      const handler = mustGetHandler(mockApp, 'proxy_menu_session_clear_all');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Skipped workdir removals'),
      );
    });

    it('ignores invalid payload', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_session_clear_all');
      await handler({
        action: { type: 'button', value: 'not-json' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.deleteSessionsByIds).not.toHaveBeenCalled();
    });

    it('catches and logs error', async () => {
      ctx.sessionManager.listSessionsForThread.mockImplementationOnce(() => {
        throw new Error('clear all boom');
      });

      const handler = mustGetHandler(mockApp, 'proxy_menu_session_clear_all');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      // Should not throw
    });
  });

  // -----------------------------------------------------------------------
  // Tool Select (menu_tool_select)
  // -----------------------------------------------------------------------

  describe('menu_tool_select', () => {
    it('creates new session when no active and no latest session', async () => {
      ctx.sessionManager.findLatestSessionByTool.mockReturnValue(null);
      ctx.sessionManager.createSessionForThread.mockReturnValue({
        sessionKey: 'sk-new',
        tool: 'claude',
        mode: 'readonly',
        workdir: '/tmp/w',
        toolState: {},
      });
      ctx.sessionManager.getSessionSummary.mockReturnValue({ sessionId: 'sess-new' });

      const handler = mustGetHandler(mockApp, 'proxy_menu_tool_select_claude');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY, tool: 'claude' }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.createSessionForThread).toHaveBeenCalledWith(
        THREAD_KEY,
        'U1',
        'claude',
      );
      expect(ctx.workdirManager.prepareWorkdirSkillsOnly).toHaveBeenCalledWith('/tmp/w', 'claude');
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('New session started'),
        expect.any(Object),
      );
      expect(mocked.maybeRunSwitchPreflight).toHaveBeenCalled();
    });

    it('resumes latest session when one exists', async () => {
      ctx.sessionManager.findLatestSessionByTool.mockReturnValue({
        sessionKey: 'sk-latest',
        tool: 'gemini',
        workdir: '/tmp/latest',
      });
      ctx.sessionManager.getSessionSummary.mockReturnValue({ sessionId: 'sess-latest' });

      const handler = mustGetHandler(mockApp, 'proxy_menu_tool_select_gemini');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY, tool: 'gemini' }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.setActiveSessionKey).toHaveBeenCalledWith(THREAD_KEY, 'sk-latest');
      expect(ctx.workdirManager.prepareWorkdirSkillsOnly).toHaveBeenCalledWith(
        '/tmp/latest',
        'gemini',
      );
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Session resumed'),
        expect.any(Object),
      );
      expect(mocked.maybeRunSwitchPreflight).toHaveBeenCalled();
    });

    it('shows already-on message when same tool is active', async () => {
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'claude', mode: 'readonly' } as never,
      });
      ctx.sessionManager.getSessionSummary.mockReturnValue({ sessionId: 'sess-active' });

      const handler = mustGetHandler(mockApp, 'proxy_menu_tool_select_claude');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY, tool: 'claude' }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.createSessionForThread).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Already on'),
        expect.any(Object),
      );

      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });

    it('blocks switch when different tool is active', async () => {
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'gemini', mode: 'readonly' } as never,
      });

      const handler = mustGetHandler(mockApp, 'proxy_menu_tool_select_claude');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY, tool: 'claude' }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.createSessionForThread).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Cannot switch to'),
        expect.any(Object),
      );

      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });

    it('rejects invalid tool name', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_tool_select_badtool');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY, tool: 'badtool' }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.createSessionForThread).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Invalid tool'),
      );
    });

    it('ignores non-button action types', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_tool_select_claude');
      await handler({
        action: { type: 'static_select' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
    });

    it('ignores invalid payload', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_tool_select_claude');
      await handler({
        action: { type: 'button', value: 'not-json' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
    });

    it('catches and logs error', async () => {
      ctx.sessionManager.findLatestSessionByTool.mockImplementationOnce(() => {
        throw new Error('tool select boom');
      });

      const handler = mustGetHandler(mockApp, 'proxy_menu_tool_select_claude');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY, tool: 'claude' }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      // Should not throw
    });
  });

  // -----------------------------------------------------------------------
  // Exit (menu_exit)
  // -----------------------------------------------------------------------

  describe('menu_exit', () => {
    it('exits active session successfully', async () => {
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'claude', mode: 'write', toolState: {} } as never,
      });
      ctx.sessionManager.getSessionSummary.mockReturnValue({ sessionId: 'sess-001' });

      const handler = mustGetHandler(mockApp, 'proxy_menu_exit');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.clearActiveSession).toHaveBeenCalledWith(THREAD_KEY);
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Session exited'),
        expect.any(Object),
      );

      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });

    it('clears MCP auth bypass state for gemini', async () => {
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'gemini', mode: 'readonly', toolState: { existing: true } } as never,
      });
      ctx.sessionManager.getSessionSummary.mockReturnValue({ sessionId: 'sess-002' });

      const handler = mustGetHandler(mockApp, 'proxy_menu_exit');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.updateToolState).toHaveBeenCalledWith(
        'sk-active',
        expect.objectContaining({ existing: true }),
      );
      expect(ctx.sessionManager.clearActiveSession).toHaveBeenCalledWith(THREAD_KEY);

      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });

    it('posts error when no active session', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_exit');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.clearActiveSession).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        'No active session to exit.',
      );
    });

    it('ignores non-button action types', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_exit');
      await handler({
        action: { type: 'static_select' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
    });

    it('ignores invalid payload', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_exit');
      await handler({
        action: { type: 'button', value: 'not-json' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
    });

    it('catches and logs error', async () => {
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'claude', mode: 'write', toolState: {} } as never,
      });
      mocked.postMessageWithContext.mockRejectedValueOnce(new Error('exit boom'));

      const handler = mustGetHandler(mockApp, 'proxy_menu_exit');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      // Should not throw
      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });
  });

  // -----------------------------------------------------------------------
  // Stop (menu_stop)
  // -----------------------------------------------------------------------

  describe('menu_stop', () => {
    it('stops running job successfully', async () => {
      const mockRunner = { isRunning: vi.fn().mockReturnValue(true), kill: vi.fn() };
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'claude', mode: 'write', toolState: {} } as never,
      });
      ctx.activeRunners.set('sk-active', { runner: mockRunner, job: {} as never } as never);
      ctx.sessionManager.getSessionSummary.mockReturnValue({ sessionId: 'sess-001' });

      const handler = mustGetHandler(mockApp, 'proxy_menu_stop');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Job stopped'),
        expect.any(Object),
      );

      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });

    it('posts error when no active session', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_stop');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        'No active session.',
      );
    });

    it('posts error when no job is running', async () => {
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'claude', mode: 'readonly', toolState: {} } as never,
      });

      const handler = mustGetHandler(mockApp, 'proxy_menu_stop');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        'No running job to stop.',
        expect.any(Object),
      );

      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });

    it('ignores non-button action types', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_stop');
      await handler({
        action: { type: 'static_select' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
    });

    it('ignores invalid payload', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_stop');
      await handler({
        action: { type: 'button', value: 'not-json' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
    });

    it('catches and logs error', async () => {
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'claude', mode: 'write', toolState: {} } as never,
      });
      const mockRunner = { isRunning: vi.fn().mockReturnValue(true), kill: vi.fn() };
      ctx.activeRunners.set('sk-active', { runner: mockRunner, job: {} as never } as never);
      ctx.sessionManager.getSessionSummary.mockImplementationOnce(() => {
        throw new Error('stop boom');
      });

      const handler = mustGetHandler(mockApp, 'proxy_menu_stop');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      // Should not throw
      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });
  });

  // =======================================================================
  // Branch coverage: parseThreadKey null, extractOriginalMessage null,
  // parseMenuPayload edge cases
  // =======================================================================

  describe('branch coverage: parseThreadKey returns null', () => {
    // For button handlers using decodeActionValue → parseThreadKey:
    // When decodeActionValue returns a tk without ':', parseThreadKey returns null.

    it('tool_approve: parseThreadKey null in main path', async () => {
      mocked.decodeActionValue.mockReturnValueOnce({ tk: 'nocolon', rid: REQUEST_ID });
      const pending = pendingToolApproval();
      ctx.pendingToolApprovals.set('nocolon', pending);

      const handler = mustGetHandler(mockApp, 'proxy_tool_approve');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' }, channel: { id: 'C1' }, message: { ts: '999.0' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      // parseThreadKey returns null → early return, no processToolApprove
      expect(mocked.processToolApprove).not.toHaveBeenCalled();
    });

    it('tool_approve: parseThreadKey null in wrong-user path', async () => {
      mocked.decodeActionValue.mockReturnValueOnce({ tk: 'nocolon', rid: REQUEST_ID });
      const pending = pendingToolApproval();
      ctx.pendingToolApprovals.set('nocolon', pending);

      const handler = mustGetHandler(mockApp, 'proxy_tool_approve');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U_OTHER' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      // parseThreadKey null → no postMessageWithContext for wrong-user message
      expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
    });

    it('tool_reject: parseThreadKey null in main path', async () => {
      mocked.decodeActionValue.mockReturnValueOnce({ tk: 'nocolon', rid: REQUEST_ID });
      const pending = pendingToolApproval();
      ctx.pendingToolApprovals.set('nocolon', pending);

      const handler = mustGetHandler(mockApp, 'proxy_tool_reject');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' }, channel: { id: 'C1' }, message: { ts: '999.0' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      // processToolReject is still called (it doesn't need parsed thread key)
      expect(mocked.processToolReject).toHaveBeenCalled();
      // But postMessageWithContext is not called because parsed is null
      expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
    });

    it('tool_reject: parseThreadKey null in wrong-user path', async () => {
      mocked.decodeActionValue.mockReturnValueOnce({ tk: 'nocolon', rid: REQUEST_ID });
      const pending = pendingToolApproval();
      ctx.pendingToolApprovals.set('nocolon', pending);

      const handler = mustGetHandler(mockApp, 'proxy_tool_reject');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U_OTHER' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processToolReject).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
    });

    it('mcp_auth_approve: parseThreadKey null in main path', async () => {
      mocked.decodeActionValue.mockReturnValueOnce({ tk: 'nocolon', rid: REQUEST_ID });
      const pending = pendingMcpAuth();
      ctx.pendingMcpAuthBypassApprovals.set('nocolon', pending);

      const handler = mustGetHandler(mockApp, 'proxy_mcp_auth_approve');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U2' }, channel: { id: 'C1' }, message: { ts: '999.0' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processMcpAuthApprove).not.toHaveBeenCalled();
    });

    it('mcp_auth_approve: parseThreadKey null in wrong-user path', async () => {
      mocked.decodeActionValue.mockReturnValueOnce({ tk: 'nocolon', rid: REQUEST_ID });
      const pending = pendingMcpAuth();
      ctx.pendingMcpAuthBypassApprovals.set('nocolon', pending);

      const handler = mustGetHandler(mockApp, 'proxy_mcp_auth_approve');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U_OTHER' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processMcpAuthApprove).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
    });

    it('mcp_auth_reject: parseThreadKey null in main path', async () => {
      mocked.decodeActionValue.mockReturnValueOnce({ tk: 'nocolon', rid: REQUEST_ID });
      const pending = pendingMcpAuth();
      ctx.pendingMcpAuthBypassApprovals.set('nocolon', pending);

      const handler = mustGetHandler(mockApp, 'proxy_mcp_auth_reject');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U2' }, channel: { id: 'C1' }, message: { ts: '999.0' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      // processMcpAuthReject is still called, but postMessageWithContext is not
      expect(mocked.processMcpAuthReject).toHaveBeenCalled();
      expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
    });

    it('mcp_auth_reject: parseThreadKey null in wrong-user path', async () => {
      mocked.decodeActionValue.mockReturnValueOnce({ tk: 'nocolon', rid: REQUEST_ID });
      const pending = pendingMcpAuth();
      ctx.pendingMcpAuthBypassApprovals.set('nocolon', pending);

      const handler = mustGetHandler(mockApp, 'proxy_mcp_auth_reject');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U_OTHER' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processMcpAuthReject).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
    });

    it('session_resume: parseThreadKey null', async () => {
      mocked.decodeActionValue.mockReturnValueOnce({ tk: 'nocolon', rid: 'sess-1' });

      const handler = mustGetHandler(mockApp, 'proxy_session_resume');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.getSessionByIdForThread).not.toHaveBeenCalled();
    });

    it('mode_select: parseThreadKey null', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_mode_select');
      await handler({
        action: {
          type: 'static_select',
          selected_option: {
            value: JSON.stringify({ tk: 'nocolon', mode: 'readonly' }),
          },
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.updateMode).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
    });

    // For menu payload handlers: valid JSON but tk has no colon
    it('tool_select: parseThreadKey null', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_tool_select_claude');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: 'nocolon', tool: 'claude' }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
    });

    it('exit: parseThreadKey null', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_exit');
      await handler({
        action: { type: 'button', value: JSON.stringify({ tk: 'nocolon' }) },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.clearActiveSession).not.toHaveBeenCalled();
    });

    it('stop: parseThreadKey null', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_stop');
      await handler({
        action: { type: 'button', value: JSON.stringify({ tk: 'nocolon' }) },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
    });

    it('new_session: parseThreadKey null', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_new_session');
      await handler({
        action: { type: 'button', value: JSON.stringify({ tk: 'nocolon' }) },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.createSessionForThread).not.toHaveBeenCalled();
    });

    it('reset: parseThreadKey null', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_reset');
      await handler({
        action: { type: 'button', value: JSON.stringify({ tk: 'nocolon' }) },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.reset).not.toHaveBeenCalled();
    });

    it('session_list: parseThreadKey null', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_session_list');
      await handler({
        action: { type: 'button', value: JSON.stringify({ tk: 'nocolon' }) },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithBlocks).not.toHaveBeenCalled();
    });

    it('session_clear: parseThreadKey null', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_session_clear');
      await handler({
        action: { type: 'button', value: JSON.stringify({ tk: 'nocolon' }) },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithBlocks).not.toHaveBeenCalled();
    });

    it('session_clear_all: parseThreadKey null', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_session_clear_all');
      await handler({
        action: { type: 'button', value: JSON.stringify({ tk: 'nocolon' }) },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.deleteSessionsByIds).not.toHaveBeenCalled();
    });

    it('dev_select: parseThreadKey null', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_dev_select_myapp');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: 'nocolon', alias: 'myapp' }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.devAliasStore.get).not.toHaveBeenCalled();
    });

    it('session_delete: parseThreadKey null', async () => {
      mocked.decodeActionValue.mockReturnValueOnce({ tk: 'nocolon', rid: 'sess-1' });

      const handler = mustGetHandler(mockApp, 'proxy_menu_session_delete');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(ctx.sessionManager.getSessionSummaryByIdForThreadOwned).not.toHaveBeenCalled();
    });
  });

  describe('branch coverage: extractOriginalMessage returns null', () => {
    it('tool_approve: no body.message → skips updateMessageBlocks', async () => {
      const pending = pendingToolApproval();
      ctx.pendingToolApprovals.set(THREAD_KEY, pending);

      const handler = mustGetHandler(mockApp, 'proxy_tool_approve');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' }, channel: { id: 'C1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processToolApprove).toHaveBeenCalled();
      expect(mocked.updateMessageBlocks).not.toHaveBeenCalled();
      expect(mocked.postMessageWithContext).toHaveBeenCalled();
    });

    it('tool_reject: no body.message → skips updateMessageBlocks', async () => {
      const pending = pendingToolApproval();
      ctx.pendingToolApprovals.set(THREAD_KEY, pending);

      const handler = mustGetHandler(mockApp, 'proxy_tool_reject');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' }, channel: { id: 'C1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processToolReject).toHaveBeenCalled();
      expect(mocked.updateMessageBlocks).not.toHaveBeenCalled();
    });

    it('mcp_auth_approve: no body.message → skips updateMessageBlocks', async () => {
      const pending = pendingMcpAuth();
      ctx.pendingMcpAuthBypassApprovals.set(THREAD_KEY, pending);

      const handler = mustGetHandler(mockApp, 'proxy_mcp_auth_approve');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U2' }, channel: { id: 'C1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processMcpAuthApprove).toHaveBeenCalled();
      expect(mocked.updateMessageBlocks).not.toHaveBeenCalled();
    });

    it('mcp_auth_reject: no body.message → skips updateMessageBlocks', async () => {
      const pending = pendingMcpAuth();
      ctx.pendingMcpAuthBypassApprovals.set(THREAD_KEY, pending);

      const handler = mustGetHandler(mockApp, 'proxy_mcp_auth_reject');
      await handler({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U2' }, channel: { id: 'C1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.processMcpAuthReject).toHaveBeenCalled();
      expect(mocked.updateMessageBlocks).not.toHaveBeenCalled();
    });
  });

  describe('branch coverage: mode_select already readonly', () => {
    it('posts readonly message without calling updateMode when already readonly', async () => {
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'claude', mode: 'readonly' } as never,
      });

      const handler = mustGetHandler(mockApp, 'proxy_mode_select');
      await handler({
        action: {
          type: 'static_select',
          selected_option: {
            value: JSON.stringify({ tk: THREAD_KEY, mode: 'readonly' }),
          },
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      // updateMode should NOT be called since already readonly
      expect(ctx.sessionManager.updateMode).not.toHaveBeenCalled();
      // But message should still be posted
      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        'Mode set to readonly.',
        expect.any(Object),
      );

      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });
  });

  describe('branch coverage: tool_select missing tool field', () => {
    it('logs warning when payload has tk but no tool field', async () => {
      const handler = mustGetHandler(mockApp, 'proxy_menu_tool_select_claude');
      await handler({
        action: {
          type: 'button',
          value: JSON.stringify({ tk: THREAD_KEY }),
        },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
    });
  });

  describe('additional branch coverage for action-type guards', () => {
    it('returns early for non-button/static action types across handlers', async () => {
      const ack = vi.fn().mockResolvedValue(undefined);

      await mustGetHandler(
        mockApp,
        'proxy_tool_reject',
      )({
        action: { type: 'static_select' },
        body: { user: { id: 'U1' } },
        ack,
      });
      await mustGetHandler(
        mockApp,
        'proxy_mcp_auth_approve',
      )({
        action: { type: 'static_select' },
        body: { user: { id: 'U1' } },
        ack,
      });
      await mustGetHandler(
        mockApp,
        'proxy_mcp_auth_reject',
      )({
        action: { type: 'static_select' },
        body: { user: { id: 'U1' } },
        ack,
      });
      await mustGetHandler(
        mockApp,
        'proxy_session_resume',
      )({
        action: { type: 'static_select' },
        body: { user: { id: 'U1' } },
        ack,
      });
      await mustGetHandler(
        mockApp,
        'proxy_mode_select',
      )({
        action: { type: 'button' },
        body: { user: { id: 'U1' } },
        ack,
      });
      await mustGetHandler(
        mockApp,
        'proxy_menu_new_session',
      )({
        action: { type: 'static_select' },
        body: { user: { id: 'U1' } },
        ack,
      });
      await mustGetHandler(
        mockApp,
        'proxy_menu_reset',
      )({
        action: { type: 'static_select' },
        body: { user: { id: 'U1' } },
        ack,
      });
      await mustGetHandler(
        mockApp,
        'proxy_menu_session_list',
      )({
        action: { type: 'static_select' },
        body: { user: { id: 'U1' } },
        ack,
      });
      await mustGetHandler(
        mockApp,
        'proxy_menu_session_clear',
      )({
        action: { type: 'static_select' },
        body: { user: { id: 'U1' } },
        ack,
      });
      await mustGetHandler(
        mockApp,
        'proxy_menu_session_delete',
      )({
        action: { type: 'static_select' },
        body: { user: { id: 'U1' } },
        ack,
      });
      await mustGetHandler(
        mockApp,
        'proxy_menu_session_clear_all',
      )({
        action: { type: 'static_select' },
        body: { user: { id: 'U1' } },
        ack,
      });
      await mustGetHandler(
        mockApp,
        'proxy_menu_dev_select_myapp',
      )({
        action: { type: 'static_select' },
        body: { user: { id: 'U1' } },
        ack,
      });

      expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
    });
  });

  describe('additional branch coverage for unknown session summaries', () => {
    it('uses unknown fallback text when summaries are unavailable', async () => {
      ctx.sessionManager.getSessionSummary.mockReturnValue(null);

      ctx.sessionManager.findLatestSessionByTool.mockReturnValue({
        sessionKey: 'sk-latest',
        tool: 'gemini',
        workdir: '/tmp/latest',
      });
      await mustGetHandler(
        mockApp,
        'proxy_menu_tool_select_gemini',
      )({
        action: { type: 'button', value: JSON.stringify({ tk: THREAD_KEY, tool: 'gemini' }) },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });
      expect(mocked.postMessageWithContext).toHaveBeenLastCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Session resumed: `unknown` (gemini).'),
        expect.any(Object),
      );

      mocked.postMessageWithContext.mockClear();
      ctx.sessionManager.findLatestSessionByTool.mockReturnValue(null);
      ctx.sessionManager.createSessionForThread.mockReturnValue({
        sessionKey: 'sk-new',
        tool: 'claude',
        mode: 'readonly',
        workdir: '/tmp/new',
        toolState: {},
      });
      await mustGetHandler(
        mockApp,
        'proxy_menu_tool_select_claude',
      )({
        action: { type: 'button', value: JSON.stringify({ tk: THREAD_KEY, tool: 'claude' }) },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });
      expect(mocked.postMessageWithContext).toHaveBeenLastCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('New session started: `unknown` (claude).'),
        expect.any(Object),
      );

      mocked.postMessageWithContext.mockClear();
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'claude', mode: 'readonly' } as never,
      });
      await mustGetHandler(
        mockApp,
        'proxy_menu_tool_select_claude',
      )({
        action: { type: 'button', value: JSON.stringify({ tk: THREAD_KEY, tool: 'claude' }) },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });
      expect(mocked.postMessageWithContext).toHaveBeenLastCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Already on `claude` session: `unknown`.'),
        expect.any(Object),
      );

      mocked.postMessageWithContext.mockClear();
      const mockRunner = { isRunning: vi.fn().mockReturnValue(true), kill: vi.fn() };
      ctx.activeRunners.set('sk-active', { runner: mockRunner, job: {} as never } as never);
      await mustGetHandler(
        mockApp,
        'proxy_menu_stop',
      )({
        action: { type: 'button', value: JSON.stringify({ tk: THREAD_KEY }) },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });
      expect(mocked.postMessageWithContext).toHaveBeenLastCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Job stopped for session `unknown`.'),
        expect.any(Object),
      );

      mocked.postMessageWithContext.mockClear();
      vi.mocked(getActiveSessionRef).mockReturnValue(null);
      ctx.devAliasStore.get.mockReturnValue({
        name: 'myapp',
        path: '/home/user/myapp',
        tool: 'claude',
        instructionContent: null,
        createdAt: '2026-01-01T00:00:00Z',
      });
      ctx.sessionManager.findDevSession.mockReturnValue({
        sessionKey: 'sk-dev-existing',
        tool: 'claude',
        workdir: '/tmp/dev/myapp',
      });
      await mustGetHandler(
        mockApp,
        'proxy_menu_dev_select_myapp',
      )({
        action: { type: 'button', value: JSON.stringify({ tk: THREAD_KEY, alias: 'myapp' }) },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });
      expect(mocked.postMessageWithContext).toHaveBeenLastCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Dev session resumed: `myapp` (claude, session: `unknown`).'),
        expect.any(Object),
      );

      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });

    it('blocks dev session start when a different existing dev session is present', async () => {
      ctx.devAliasStore.get.mockReturnValue({
        name: 'myapp',
        path: '/home/user/myapp',
        tool: 'claude',
        instructionContent: null,
        createdAt: '2026-01-01T00:00:00Z',
      });
      ctx.sessionManager.findDevSession.mockReturnValue({
        sessionKey: 'sk-existing',
        tool: 'claude',
        workdir: '/tmp/dev/myapp',
      });
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-other',
        session: { tool: 'gemini', mode: 'readonly' } as never,
      });

      await mustGetHandler(
        mockApp,
        'proxy_menu_dev_select_myapp',
      )({
        action: { type: 'button', value: JSON.stringify({ tk: THREAD_KEY, alias: 'myapp' }) },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Cannot start dev session'),
        expect.any(Object),
      );
      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });
  });

  describe('additional nullish and mismatch branch coverage', () => {
    it('uses empty-string fallback for decodeActionValue when button value is missing', async () => {
      const ack = vi.fn().mockResolvedValue(undefined);
      const pendingTool = pendingToolApproval();
      const pendingMcp = pendingMcpAuth();
      ctx.pendingToolApprovals.set(THREAD_KEY, pendingTool);
      ctx.pendingMcpAuthBypassApprovals.set(THREAD_KEY, pendingMcp);
      ctx.sessionManager.getSessionByIdForThread.mockReturnValue({
        sessionKey: 'sk-resume',
        tool: 'claude',
        workdir: '/tmp/work',
      });
      ctx.sessionManager.getSessionSummary.mockReturnValue({
        sessionKey: 'sk-del',
        threadKey: THREAD_KEY,
        userId: 'U1',
        tool: 'claude',
        sessionId: 'sess-del',
        active: false,
        workdir: '/tmp/work',
      });
      ctx.sessionManager.getSessionSummaryByIdForThreadOwned.mockReturnValue({
        sessionKey: 'sk-del',
        threadKey: THREAD_KEY,
        userId: 'U1',
        tool: 'claude',
        sessionId: 'sess-del',
        active: false,
        workdir: '/tmp/work',
      });
      ctx.sessionManager.deleteSessionById.mockReturnValue({
        sessionKey: 'sk-del',
        tool: 'claude',
        sessionId: 'sess-del',
        active: false,
        workdir: '/tmp/work',
      });

      await mustGetHandler(
        mockApp,
        'proxy_tool_approve',
      )({
        action: { type: 'button' },
        body: { user: { id: 'U1' } },
        ack,
      });
      await mustGetHandler(
        mockApp,
        'proxy_tool_reject',
      )({
        action: { type: 'button' },
        body: { user: { id: 'U1' } },
        ack,
      });
      await mustGetHandler(
        mockApp,
        'proxy_mcp_auth_approve',
      )({
        action: { type: 'button' },
        body: { user: { id: 'U2' } },
        ack,
      });
      await mustGetHandler(
        mockApp,
        'proxy_mcp_auth_reject',
      )({
        action: { type: 'button' },
        body: { user: { id: 'U2' } },
        ack,
      });
      await mustGetHandler(
        mockApp,
        'proxy_session_resume',
      )({
        action: { type: 'button' },
        body: { user: { id: 'U1' } },
        ack,
      });
      await mustGetHandler(
        mockApp,
        'proxy_menu_session_delete',
      )({
        action: { type: 'button' },
        body: { user: { id: 'U1' } },
        ack,
      });

      expect(mocked.decodeActionValue).toHaveBeenCalledWith('');
    });

    it('returns early on requestId mismatch for reject/mcp handlers', async () => {
      const wrongTool = pendingToolApproval();
      wrongTool.requestId = 'expected';
      const wrongMcp = pendingMcpAuth();
      wrongMcp.requestId = 'expected';
      ctx.pendingToolApprovals.set(THREAD_KEY, wrongTool);
      ctx.pendingMcpAuthBypassApprovals.set(THREAD_KEY, wrongMcp);
      mocked.decodeActionValue.mockReturnValue({ tk: THREAD_KEY, rid: 'different' });

      const ack = vi.fn().mockResolvedValue(undefined);
      await mustGetHandler(
        mockApp,
        'proxy_tool_reject',
      )({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' } },
        ack,
      });
      await mustGetHandler(
        mockApp,
        'proxy_mcp_auth_approve',
      )({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U2' } },
        ack,
      });
      await mustGetHandler(
        mockApp,
        'proxy_mcp_auth_reject',
      )({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U2' } },
        ack,
      });

      expect(mocked.processToolReject).not.toHaveBeenCalled();
      expect(mocked.processMcpAuthApprove).not.toHaveBeenCalled();
      expect(mocked.processMcpAuthReject).not.toHaveBeenCalled();
    });

    it('uses resolved session IDs when session summaries are present', async () => {
      mocked.decodeActionValue.mockReturnValue({ tk: THREAD_KEY, rid: 'sess-123' });
      ctx.sessionManager.getSessionByIdForThread.mockReturnValue({
        sessionKey: 'sk-resume',
        tool: 'claude',
        workdir: '/tmp/work',
      });
      ctx.sessionManager.getSessionSummary.mockReturnValue({ sessionId: 'sess-real' });
      await mustGetHandler(
        mockApp,
        'proxy_session_resume',
      )({
        action: { type: 'button', value: 'encoded' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });
      expect(mocked.postMessageWithContext).toHaveBeenLastCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('Session resumed: `sess-real` (claude).'),
        expect.any(Object),
      );

      mocked.postMessageWithContext.mockClear();
      mocked.decodeActionValue.mockReturnValue({ tk: THREAD_KEY, rid: REQUEST_ID });
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'claude', mode: 'readonly' } as never,
      });
      ctx.sessionManager.createSessionForThread.mockReturnValue({
        sessionKey: 'sk-created',
        tool: 'claude',
        mode: 'readonly',
        workdir: '/tmp/new',
        toolState: {},
      });
      ctx.sessionManager.getSessionSummary.mockReturnValue({ sessionId: 'sess-created' });

      await mustGetHandler(
        mockApp,
        'proxy_menu_new_session',
      )({
        action: { type: 'button', value: JSON.stringify({ tk: THREAD_KEY }) },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithContext).toHaveBeenLastCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('New session started: `sess-created` (claude).'),
        expect.any(Object),
      );
      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });

    it('handles mode_select when selected_option is omitted and menu payload has empty tk', async () => {
      await mustGetHandler(
        mockApp,
        'proxy_mode_select',
      )({
        action: { type: 'static_select' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      await mustGetHandler(
        mockApp,
        'proxy_menu_session_list',
      )({
        action: { type: 'button' },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      await mustGetHandler(
        mockApp,
        'proxy_menu_session_list',
      )({
        action: { type: 'button', value: JSON.stringify({ tk: '' }) },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithBlocks).not.toHaveBeenCalled();
    });

    it('uses unknown session id fallback for menu_new_session when summary is absent', async () => {
      vi.mocked(getActiveSessionRef).mockReturnValue({
        sessionKey: 'sk-active',
        session: { tool: 'claude', mode: 'readonly' } as never,
      });
      ctx.sessionManager.createSessionForThread.mockReturnValue({
        sessionKey: 'sk-created',
        tool: 'claude',
        mode: 'readonly',
        workdir: '/tmp/new',
        toolState: {},
      });
      ctx.sessionManager.getSessionSummary.mockReturnValue(null);

      await mustGetHandler(
        mockApp,
        'proxy_menu_new_session',
      )({
        action: { type: 'button', value: JSON.stringify({ tk: THREAD_KEY }) },
        body: { user: { id: 'U1' } },
        ack: vi.fn().mockResolvedValue(undefined),
      });

      expect(mocked.postMessageWithContext).toHaveBeenLastCalledWith(
        ctx,
        ctx.webClient,
        'C1',
        '1.0',
        expect.stringContaining('New session started: `unknown` (claude).'),
        expect.any(Object),
      );
      vi.mocked(getActiveSessionRef).mockReturnValue(null);
    });
  });
});
