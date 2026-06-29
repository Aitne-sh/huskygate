/**
 * Coverage tests for src/slack/actions/session.ts
 * Targets: branch at line 74 (summary?.sessionId ?? sessionId in session resume)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  postMessageWithContext: vi.fn().mockResolvedValue(undefined),
  generateChallengeCode: vi.fn().mockReturnValue('ABC123'),
  scheduleExpiry: vi.fn(),
  getActiveSessionRef: vi.fn().mockReturnValue(null),
  maybeRunSwitchPreflight: vi.fn().mockResolvedValue(undefined),
  parseThreadKey: vi.fn(),
  parseMenuPayload: vi.fn(),
  decodeActionValue: vi.fn(),
}));

vi.mock('../app-helpers.js', () => ({
  CHALLENGE_TIMEOUT_MS: 30000,
  postMessageWithContext: mocked.postMessageWithContext,
  generateChallengeCode: mocked.generateChallengeCode,
  scheduleExpiry: mocked.scheduleExpiry,
}));

vi.mock('../handler-context.js', () => ({
  getActiveSessionRef: mocked.getActiveSessionRef,
}));

vi.mock('../mcp-preflight.js', () => ({
  maybeRunSwitchPreflight: mocked.maybeRunSwitchPreflight,
}));

vi.mock('../block-kit.js', () => ({
  ACTION_SESSION_RESUME: 'session_resume',
  ACTION_MODE_SELECT: 'mode_select',
  ACTION_MENU_TOOL_SELECT: 'menu_tool_select',
  decodeActionValue: mocked.decodeActionValue,
}));

vi.mock('./helpers.js', () => ({
  VALID_TOOLS: new Set(['gemini', 'claude', 'codex']),
  parseMenuPayload: mocked.parseMenuPayload,
  parseThreadKey: mocked.parseThreadKey,
}));

vi.mock('../../utils/error.js', () => ({
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { registerSessionActions } from './session.js';

/** Helper to access a mock function with proper vi.fn() typing */
function mockFn(obj: unknown): ReturnType<typeof vi.fn> {
  return obj as ReturnType<typeof vi.fn>;
}

describe('session actions: summary?.sessionId ?? sessionId (line 74)', () => {
  type ActionHandler = (payload: unknown) => Promise<void>;
  type SessionCtx = Parameters<typeof registerSessionActions>[0];

  let actionHandlers: Map<string, ActionHandler>;
  let ctx: SessionCtx;

  beforeEach(() => {
    vi.clearAllMocks();
    actionHandlers = new Map();

    ctx = {
      sessionManager: {
        getSessionByIdForThreadOwned: vi.fn().mockReturnValue(null),
        setActiveSessionKey: vi.fn(),
        getSessionSummary: vi.fn().mockReturnValue(null),
      },
      workdirManager: {
        prepareWorkdirSkillsOnly: vi.fn(),
      },
      webClient: {},
      pendingConfirmations: { set: vi.fn() },
      auditStore: { logModeChange: vi.fn() },
    } as unknown as SessionCtx;

    const app = {
      action: vi.fn((nameOrRegex: string | RegExp, handler: ActionHandler) => {
        const key = typeof nameOrRegex === 'string' ? nameOrRegex : nameOrRegex.source;
        actionHandlers.set(key, handler);
      }),
    } as unknown as Parameters<typeof registerSessionActions>[1];

    registerSessionActions(ctx, app);
  });

  it('uses sessionId fallback when getSessionSummary returns null', async () => {
    const handler = actionHandlers.get('session_resume');
    expect(handler).toBeDefined();

    mocked.decodeActionValue.mockReturnValue({ tk: 'C1:1.1', rid: 'my-session-id' });
    mocked.parseThreadKey.mockReturnValue({
      threadKey: 'C1:1.1',
      channelId: 'C1',
      threadTs: '1.1',
    });
    mocked.getActiveSessionRef.mockReturnValue(null);

    mockFn(ctx.sessionManager.getSessionByIdForThreadOwned).mockReturnValue({
      sessionKey: 'sess-key',
      tool: 'claude',
      workdir: '/tmp/wd',
    });
    mockFn(ctx.sessionManager.getSessionSummary).mockReturnValue(null);

    await handler?.({
      action: { type: 'button', value: 'encoded-value' },
      body: { user: { id: 'U1' } },
      ack: vi.fn(),
    });

    expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
      ctx,
      ctx.webClient,
      'C1',
      '1.1',
      expect.stringContaining('my-session-id'),
      expect.anything(),
    );
  });

  it('uses summary.sessionId when getSessionSummary returns a summary', async () => {
    const handler = actionHandlers.get('session_resume');
    expect(handler).toBeDefined();

    mocked.decodeActionValue.mockReturnValue({ tk: 'C1:1.1', rid: 'my-session-id' });
    mocked.parseThreadKey.mockReturnValue({
      threadKey: 'C1:1.1',
      channelId: 'C1',
      threadTs: '1.1',
    });
    mocked.getActiveSessionRef.mockReturnValue(null);

    mockFn(ctx.sessionManager.getSessionByIdForThreadOwned).mockReturnValue({
      sessionKey: 'sess-key',
      tool: 'claude',
      workdir: '/tmp/wd',
    });
    mockFn(ctx.sessionManager.getSessionSummary).mockReturnValue({ sessionId: 'summary-sid' });

    await handler?.({
      action: { type: 'button', value: 'encoded-value' },
      body: { user: { id: 'U1' } },
      ack: vi.fn(),
    });

    expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
      ctx,
      ctx.webClient,
      'C1',
      '1.1',
      expect.stringContaining('summary-sid'),
      expect.anything(),
    );
  });
});
