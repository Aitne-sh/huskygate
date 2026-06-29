/**
 * Additional coverage tests for src/slack/commands/session.ts
 * Covers lines 139-147 (handleCurrentSession when getSessionSummary returns null)
 */
import { describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  postMessageWithContext: vi.fn().mockResolvedValue(undefined),
  postMessageWithBlocks: vi.fn().mockResolvedValue(undefined),
  getActiveSessionRef: vi.fn(),
  maybeRunSwitchPreflight: vi.fn().mockResolvedValue(undefined),
  formatSessionListMessage: vi.fn(() => 'list'),
  buildSessionListBlocks: vi.fn(() => []),
  clearInactivityTimer: vi.fn(),
  getDefaultModelForTool: vi.fn(() => null),
}));

vi.mock('../app-helpers.js', () => ({
  postMessageWithContext: mocked.postMessageWithContext,
  postMessageWithBlocks: mocked.postMessageWithBlocks,
  formatSessionListMessage: mocked.formatSessionListMessage,
  clearInactivityTimer: mocked.clearInactivityTimer,
  getDefaultModelForTool: mocked.getDefaultModelForTool,
}));

vi.mock('../block-kit.js', () => ({
  buildSessionListBlocks: mocked.buildSessionListBlocks,
}));

vi.mock('../handler-context.js', () => ({
  getActiveSessionRef: mocked.getActiveSessionRef,
  clearPendingStateForSession: vi.fn(),
  formatSessionClearedMessage: vi.fn(() => 'cleared'),
  formatSessionClearAllSummary: vi.fn(() => 'all cleared'),
  removeSessionWorkdir: vi.fn(() => true),
  stopSessionExecution: vi.fn(),
}));

vi.mock('../mcp-preflight.js', () => ({
  maybeRunSwitchPreflight: mocked.maybeRunSwitchPreflight,
}));

import { handleCurrentSession } from './session.js';

function makeHctx() {
  return {
    ctx: {
      sessionManager: {
        getSessionSummary: vi.fn().mockReturnValue(null),
        listSessionsForThreadOwned: vi.fn().mockReturnValue([]),
        getSessionSummaryByIdForThreadOwned: vi.fn().mockReturnValue(null),
        deleteSessionById: vi.fn().mockReturnValue(null),
        deleteSessionsByIds: vi.fn().mockReturnValue([]),
        setActiveSessionKey: vi.fn(),
        createSessionForThread: vi.fn(),
        getSessionByIdForThreadOwned: vi.fn().mockReturnValue(null),
      },
      workdirManager: { prepareWorkdirSkillsOnly: vi.fn() },
      pendingConfirmations: new Map(),
      pendingToolApprovals: new Map(),
      pendingMcpAuthBypassApprovals: new Map(),
    },
    client: {},
    channelId: 'C1',
    threadTs: '1.1',
    userId: 'U1',
    threadKey: 'C1:1.1',
  };
}

describe('handleCurrentSession', () => {
  it('posts no-session when getSessionSummary returns null for active session', async () => {
    const hctx = makeHctx();
    mocked.getActiveSessionRef.mockReturnValue({
      sessionKey: 'sess_1',
      session: { tool: 'claude', mode: 'write', toolState: {} },
    });
    // getSessionSummary returns null despite having an activeRef
    hctx.ctx.sessionManager.getSessionSummary.mockReturnValue(null);

    await handleCurrentSession(hctx as never, { kind: 'current_session' } as never);

    expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'C1',
      '1.1',
      expect.stringContaining('No active session'),
    );
  });
});
