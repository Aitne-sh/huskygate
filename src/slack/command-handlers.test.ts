import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../context/app-context.js';
import { makeTestAppContext } from '../test-helpers/app-context-builder.js';
import {
  dispatchCommand,
  handleExit,
  handleModelChange,
  handleModelQuery,
  handleOrch,
  handleOrchCancel,
  handleOrchList,
  handleOrchStatus,
  handlePrompt,
  handleReset,
  handleStatus,
  handleStop,
  handleToolSwitch,
} from './commands/dispatch.js';
import type { HandlerContext } from './handler-context.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockClient() {
  return {
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ok: true, ts: '1.1' }),
      update: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
}

function createMockCtx(overrides: Partial<AppContext> = {}): AppContext {
  const base = makeTestAppContext({
    webClient: createMockClient() as unknown as Partial<AppContext['webClient']>,
  });
  const listSessionsForThread = vi.fn().mockReturnValue([]);
  const getSessionByIdForThread = vi.fn().mockReturnValue(null);
  const findLatestSessionByTool = vi.fn().mockReturnValue(null);

  return {
    ...base,
    sessionManager: {
      ...base.sessionManager,
      getActiveSessionKey: vi.fn().mockReturnValue(null),
      getActiveSessionForThread: vi.fn().mockReturnValue(null),
      get: vi.fn().mockReturnValue(null),
      clearActiveSession: vi.fn(),
      setActiveSessionKey: vi.fn(),
      createSessionForThread: vi.fn(),
      findLatestSessionByTool,
      findLatestSessionByToolOwned: findLatestSessionByTool,
      listSessionsForThread,
      listSessionsForThreadOwned: listSessionsForThread,
      getActiveSessionSummary: vi.fn().mockReturnValue(null),
      getSessionSummary: vi.fn().mockReturnValue(null),
      getSessionByIdForThread,
      getSessionByIdForThreadOwned: getSessionByIdForThread,
      getSessionSummaryByIdForThreadOwned: vi.fn().mockReturnValue(null),
      deleteSessionById: vi.fn().mockReturnValue(null),
      deleteSessionsByIds: vi.fn().mockReturnValue([]),
      updateToolState: vi.fn(),
      updateTool: vi.fn(),
      updateMode: vi.fn(),
      updateWorkdir: vi.fn(),
      reset: vi.fn(),
      setRunningJob: vi.fn(),
    } as unknown as AppContext['sessionManager'],
    jobQueue: {
      ...base.jobQueue,
      enqueue: vi.fn().mockReturnValue({ position: 0 }),
      cancelSession: vi.fn(),
      getStatus: vi.fn().mockReturnValue({ pending: 0 }),
      getRunningJob: vi.fn().mockReturnValue(null),
    } as unknown as AppContext['jobQueue'],
    dedupeStore: {
      ...base.dedupeStore,
      isDuplicate: vi.fn(),
      register: vi.fn(),
    } as unknown as AppContext['dedupeStore'],
    auditStore: {
      ...base.auditStore,
      logModeChange: vi.fn(),
      logJobStart: vi.fn(),
      logJobComplete: vi.fn(),
    } as unknown as AppContext['auditStore'],
    conversationStore: {
      ...base.conversationStore,
      saveMessage: vi.fn(),
    } as unknown as AppContext['conversationStore'],
    workdirManager: {
      ...base.workdirManager,
      prepareWorkdirForTool: vi.fn(),
      prepareWorkdirForToolWithPolicy: vi.fn(),
      prepareWorkdirSkillsOnly: vi.fn(),
      getSessionWorkdir: vi.fn().mockReturnValue('/tmp/test-workdir/default'),
      validateCustomWorkdir: vi.fn().mockImplementation((p: string) => p),
      cleanupUnusedSessionWorkdirs: vi.fn().mockReturnValue(0),
      archiveLegacyDefaultWorkdirIfUnused: vi.fn().mockReturnValue(null),
    } as unknown as AppContext['workdirManager'],
    devAliasStore: {
      ...base.devAliasStore,
      list: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
    } as unknown as AppContext['devAliasStore'],
    ...overrides,
  };
}

function createHctx(ctx?: AppContext): HandlerContext {
  const mockCtx = ctx ?? createMockCtx();
  return {
    ctx: mockCtx,
    client: createMockClient() as unknown as HandlerContext['client'],
    channelId: 'C123',
    threadTs: '1.1',
    userId: 'U1',
    threadKey: 'C123:1.1',
  };
}

function mockOwnedActiveSession(
  ctx: AppContext,
  session: {
    sessionKey: string;
    tool: 'claude' | 'codex' | 'gemini';
    mode: 'readonly' | 'write';
    workdir: string;
    toolState: Record<string, unknown>;
    modeExpiresAt: string | null;
  },
): void {
  (ctx.sessionManager.getActiveSessionKey as ReturnType<typeof vi.fn>).mockReturnValue(
    session.sessionKey,
  );
  (ctx.sessionManager.getActiveSessionForThread as ReturnType<typeof vi.fn>).mockReturnValue({
    sessionKey: session.sessionKey,
    session,
    userId: 'U1',
  });
  (ctx.sessionManager.get as ReturnType<typeof vi.fn>).mockReturnValue(session);
  (ctx.sessionManager.getSessionSummary as ReturnType<typeof vi.fn>).mockReturnValue({
    sessionKey: session.sessionKey,
    sessionId: 'sess-id',
    threadKey: 'C123:1.1',
    userId: 'U1',
    tool: session.tool,
    mode: session.mode,
    modeExpiresAt: session.modeExpiresAt,
    workdir: session.workdir,
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    active: true,
  });
}

function getPostedMessages(hctx: HandlerContext): string[] {
  const mock = hctx.client.chat.postMessage as ReturnType<typeof vi.fn>;
  return mock.mock.calls.map((call: unknown[]) => {
    const arg = call[0] as { text?: string };
    return arg?.text ?? '';
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dispatchCommand', () => {
  it('dispatches exit command', async () => {
    const hctx = createHctx();
    await dispatchCommand(hctx, { kind: 'exit' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('Exited'))).toBe(true);
  });

  it('dispatches status command', async () => {
    const hctx = createHctx();
    await dispatchCommand(hctx, { kind: 'status' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('Active session:'))).toBe(true);
  });

  it('dispatches list_commands command', async () => {
    const hctx = createHctx();
    await dispatchCommand(hctx, { kind: 'list_commands' });
    const messages = getPostedMessages(hctx);
    expect(messages.length).toBeGreaterThan(0);
  });

  it('dispatches unknown_bang command', async () => {
    const hctx = createHctx();
    await dispatchCommand(hctx, { kind: 'unknown_bang', input: '!foo' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('Unknown'))).toBe(true);
  });
});

describe('handleExit', () => {
  it('exits when no active session', async () => {
    const hctx = createHctx();
    await handleExit(hctx, { kind: 'exit' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('Exited'))).toBe(true);
  });

  it('kills runner and clears session on exit', async () => {
    const mockRunner = { isRunning: vi.fn().mockReturnValue(true), kill: vi.fn() };
    const ctx = createMockCtx();
    ctx.activeRunners.set('sess_1', {
      runner: mockRunner,
      job: {},
    } as unknown as AppContext['activeRunners'] extends Map<string, infer V> ? V : never);
    mockOwnedActiveSession(ctx, {
      sessionKey: 'sess_1',
      tool: 'claude',
      mode: 'readonly',
      workdir: '/tmp',
      toolState: { claude_mcp_auth_approval_completed: true },
      modeExpiresAt: null,
    });

    const hctx = createHctx(ctx);
    await handleExit(hctx, { kind: 'exit' });

    expect(mockRunner.kill).toHaveBeenCalledWith('user_exit');
    expect(ctx.sessionManager.updateToolState).toHaveBeenCalledWith(
      'sess_1',
      expect.objectContaining({
        claude_mcp_auth_approval_completed: undefined,
      }),
    );
    expect(ctx.sessionManager.clearActiveSession).toHaveBeenCalledWith('C123:1.1');
  });
});

describe('handleStatus', () => {
  it('shows no active session', async () => {
    const hctx = createHctx();
    await handleStatus(hctx, { kind: 'status' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('Active session: none'))).toBe(true);
  });

  it('shows active session info', async () => {
    const ctx = createMockCtx();
    mockOwnedActiveSession(ctx, {
      sessionKey: 'sess_1',
      tool: 'gemini',
      mode: 'readonly',
      workdir: '/tmp/w',
      toolState: {},
      modeExpiresAt: null,
    });

    const hctx = createHctx(ctx);
    await handleStatus(hctx, { kind: 'status' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('gemini'))).toBe(true);
  });
});

describe('handleStop', () => {
  it('reports no active session', async () => {
    const hctx = createHctx();
    await handleStop(hctx, { kind: 'stop' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('No active session'))).toBe(true);
  });

  it('kills running job', async () => {
    const mockRunner = { isRunning: vi.fn().mockReturnValue(true), kill: vi.fn() };
    const ctx = createMockCtx();
    ctx.activeRunners.set('sess_1', {
      runner: mockRunner,
      job: {},
    } as unknown as AppContext['activeRunners'] extends Map<string, infer V> ? V : never);
    mockOwnedActiveSession(ctx, {
      sessionKey: 'sess_1',
      tool: 'claude',
      mode: 'readonly',
      workdir: '/tmp',
      toolState: {},
      modeExpiresAt: null,
    });

    const hctx = createHctx(ctx);
    await handleStop(hctx, { kind: 'stop' });

    expect(mockRunner.kill).toHaveBeenCalledWith('user_stop');
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('Stopping'))).toBe(true);
  });
});

describe('handleReset', () => {
  it('reports no active session', async () => {
    const hctx = createHctx();
    await handleReset(hctx, { kind: 'reset' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('No active session'))).toBe(true);
  });

  it('resets session and clears pending state', async () => {
    const ctx = createMockCtx();
    mockOwnedActiveSession(ctx, {
      sessionKey: 'sess_1',
      tool: 'codex',
      mode: 'readonly',
      workdir: '/tmp',
      toolState: {},
      modeExpiresAt: null,
    });

    const hctx = createHctx(ctx);
    await handleReset(hctx, { kind: 'reset' });

    expect(ctx.sessionManager.reset).toHaveBeenCalledWith('sess_1');
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('Session reset'))).toBe(true);
  });
});

describe('handlePrompt', () => {
  it('shows dashboard when no session and no tool prefix', async () => {
    const hctx = createHctx();
    await handlePrompt(hctx, { kind: 'prompt', prompt: 'hello' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('No active session'))).toBe(true);
    // Should also have blocks (dashboard)
    const postCalls = (hctx.client.chat.postMessage as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = postCalls[postCalls.length - 1]?.[0] as { blocks?: unknown[] };
    expect(lastCall?.blocks).toBeDefined();
  });

  it('enqueues prompt for active session', async () => {
    const ctx = createMockCtx();
    mockOwnedActiveSession(ctx, {
      sessionKey: 'sess_1',
      tool: 'claude',
      mode: 'readonly',
      workdir: '/tmp/w',
      toolState: {},
      modeExpiresAt: null,
    });

    const hctx = createHctx(ctx);
    await handlePrompt(hctx, { kind: 'prompt', prompt: 'do something' });

    expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(1);
    const enqueuedJob = (ctx.jobQueue.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(enqueuedJob?.prompt).toBe('do something');
    expect(enqueuedJob?.tool).toBe('claude');
  });

  it('creates session when tool prefix provided but no active session', async () => {
    const ctx = createMockCtx();
    const createdSession = {
      sessionKey: 'sess_new',
      tool: 'gemini',
      mode: 'readonly',
      workdir: '/tmp/w',
      toolState: {},
      modeExpiresAt: null,
    };
    (ctx.sessionManager.createSessionForThread as ReturnType<typeof vi.fn>).mockReturnValue(
      createdSession,
    );

    const hctx = createHctx(ctx);
    await handlePrompt(hctx, { kind: 'prompt', tool: 'gemini', prompt: 'hello gemini' });

    expect(ctx.sessionManager.createSessionForThread).toHaveBeenCalled();
    expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(1);
  });
});

describe('handleToolSwitch', () => {
  it('creates new session for tool switch', async () => {
    const ctx = createMockCtx();
    const createdSession = {
      sessionKey: 'sess_new',
      tool: 'gemini',
      mode: 'readonly',
      workdir: '/tmp/w',
      toolState: {},
      modeExpiresAt: null,
    };
    (ctx.sessionManager.createSessionForThread as ReturnType<typeof vi.fn>).mockReturnValue(
      createdSession,
    );

    const hctx = createHctx(ctx);
    await handleToolSwitch(hctx, { kind: 'tool_switch', tool: 'gemini' });

    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('gemini'))).toBe(true);
  });

  it('rejects tool switch while different tool is active', async () => {
    const ctx = createMockCtx();
    mockOwnedActiveSession(ctx, {
      sessionKey: 'sess_1',
      tool: 'claude',
      mode: 'readonly',
      workdir: '/tmp',
      toolState: {},
      modeExpiresAt: null,
    });

    const hctx = createHctx(ctx);
    await handleToolSwitch(hctx, { kind: 'tool_switch', tool: 'codex' });

    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('Cannot switch'))).toBe(true);
  });
});

describe('dispatchCommand — model routes', () => {
  it('dispatches model_query command', async () => {
    const hctx = createHctx();
    await dispatchCommand(hctx, { kind: 'model_query' });
    const messages = getPostedMessages(hctx);
    // No active session → prompt to select one
    expect(messages.some((m) => m.includes('No active session'))).toBe(true);
  });

  it('dispatches model_change command', async () => {
    const hctx = createHctx();
    await dispatchCommand(hctx, { kind: 'model_change', model: 'gpt-4' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('No active session'))).toBe(true);
  });

  it('dispatches orchestrator commands', async () => {
    const orch = { id: 'orch-1', name: 'Deploy', status: 'active', alias: 'deploy' };
    const ctx = createMockOrchCtx();
    (ctx.orchestratorStore.findByAlias as ReturnType<typeof vi.fn>).mockReturnValue(orch);
    (ctx.orchestratorStore.list as ReturnType<typeof vi.fn>).mockReturnValue([
      { name: 'Deploy', alias: 'deploy', runCount: 1, scheduleType: 'once' },
    ]);
    (ctx.orchestratorStore.getRunsByOrchestrator as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const hctx = createHctx(ctx);

    await dispatchCommand(hctx, { kind: 'orch', nameOrAlias: 'deploy' });
    await dispatchCommand(hctx, { kind: 'orch_list' });
    await dispatchCommand(hctx, { kind: 'orch_status', target: 'deploy' });
    await dispatchCommand(hctx, { kind: 'orch_cancel', runId: 'run-1' });

    expect(ctx.orchestratorEngine.startRun).toHaveBeenCalledWith('orch-1', 'slack', 'U1');
    expect(ctx.orchestratorEngine.cancelRun).toHaveBeenCalledWith('run-1');
  });
});

describe('handleModelQuery', () => {
  it('reports no active session', async () => {
    const hctx = createHctx();
    await handleModelQuery(hctx, { kind: 'model_query' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('No active session'))).toBe(true);
  });

  it('displays session model override', async () => {
    const ctx = createMockCtx();
    mockOwnedActiveSession(ctx, {
      sessionKey: 'sess_1',
      tool: 'claude',
      mode: 'readonly',
      workdir: '/tmp',
      toolState: { model: 'my-model' },
      modeExpiresAt: null,
    });

    const hctx = createHctx(ctx);
    await handleModelQuery(hctx, { kind: 'model_query' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('my-model') && m.includes('session override'))).toBe(
      true,
    );
  });

  it('displays env default model', async () => {
    const ctx = createMockCtx({
      config: {
        ...createMockCtx().config,
        claudeModel: 'env-claude-model',
      } as AppContext['config'],
    });
    mockOwnedActiveSession(ctx, {
      sessionKey: 'sess_1',
      tool: 'claude',
      mode: 'readonly',
      workdir: '/tmp',
      toolState: {},
      modeExpiresAt: null,
    });

    const hctx = createHctx(ctx);
    await handleModelQuery(hctx, { kind: 'model_query' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('env-claude-model') && m.includes('env default'))).toBe(
      true,
    );
  });

  it('displays CLI built-in default', async () => {
    const ctx = createMockCtx();
    mockOwnedActiveSession(ctx, {
      sessionKey: 'sess_1',
      tool: 'claude',
      mode: 'readonly',
      workdir: '/tmp',
      toolState: {},
      modeExpiresAt: null,
    });

    const hctx = createHctx(ctx);
    await handleModelQuery(hctx, { kind: 'model_query' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('CLI built-in'))).toBe(true);
  });
});

describe('handleModelChange', () => {
  it('sets model on active session', async () => {
    const ctx = createMockCtx();
    mockOwnedActiveSession(ctx, {
      sessionKey: 'sess_1',
      tool: 'gemini',
      mode: 'readonly',
      workdir: '/tmp',
      toolState: {},
      modeExpiresAt: null,
    });

    const hctx = createHctx(ctx);
    await handleModelChange(hctx, { kind: 'model_change', model: 'gpt-4o' });

    expect(ctx.sessionManager.updateToolState).toHaveBeenCalledWith(
      'sess_1',
      expect.objectContaining({ model: 'gpt-4o' }),
    );
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('gpt-4o'))).toBe(true);
  });

  it('resets model to default', async () => {
    const ctx = createMockCtx();
    mockOwnedActiveSession(ctx, {
      sessionKey: 'sess_1',
      tool: 'claude',
      mode: 'readonly',
      workdir: '/tmp',
      toolState: { model: 'custom-model' },
      modeExpiresAt: null,
    });

    const hctx = createHctx(ctx);
    await handleModelChange(hctx, { kind: 'model_change', model: 'default' });

    expect(ctx.sessionManager.updateToolState).toHaveBeenCalledWith(
      'sess_1',
      expect.not.objectContaining({ model: expect.anything() }),
    );
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('reset to default'))).toBe(true);
  });

  it('reports no active session', async () => {
    const hctx = createHctx();
    await handleModelChange(hctx, { kind: 'model_change', model: 'x' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('No active session'))).toBe(true);
  });
});

describe('handleStatus — env model branch', () => {
  it('shows env model when session has no model override', async () => {
    const ctx = createMockCtx({
      config: {
        ...createMockCtx().config,
        geminiModel: 'gemini-pro',
      } as AppContext['config'],
    });
    mockOwnedActiveSession(ctx, {
      sessionKey: 'sess_1',
      tool: 'gemini',
      mode: 'readonly',
      workdir: '/tmp',
      toolState: {},
      modeExpiresAt: null,
    });

    const hctx = createHctx(ctx);
    await handleStatus(hctx, { kind: 'status' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('gemini-pro') && m.includes('(env)'))).toBe(true);
  });
});

// ── Orchestrator Commands ──────────────────────────────────────

function createMockOrchCtx(overrides: Record<string, unknown> = {}): AppContext {
  return createMockCtx({
    orchestratorStore: {
      findByAlias: vi.fn().mockReturnValue(null),
      getById: vi.fn().mockReturnValue(null),
      list: vi.fn().mockReturnValue([]),
      getRunsByOrchestrator: vi.fn().mockReturnValue([]),
    } as unknown as AppContext['orchestratorStore'],
    orchestratorEngine: {
      startRun: vi.fn().mockResolvedValue('run-id-1234-5678'),
      cancelRun: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppContext['orchestratorEngine'],
    ...overrides,
  });
}

describe('handleOrch', () => {
  it('starts orchestrator when alias found', async () => {
    const mockOrch = { id: 'orch-1', name: 'Deploy Pipeline', status: 'active', alias: 'deploy' };
    const ctx = createMockOrchCtx();
    (ctx.orchestratorStore.findByAlias as ReturnType<typeof vi.fn>).mockReturnValue(mockOrch);
    const hctx = createHctx(ctx);
    await handleOrch(hctx, { kind: 'orch', nameOrAlias: 'deploy' });
    expect(ctx.orchestratorEngine.startRun).toHaveBeenCalledWith('orch-1', 'slack', 'U1');
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('Deploy Pipeline') && m.includes('started'))).toBe(true);
  });

  it('reports error when orchestrator not found', async () => {
    const ctx = createMockOrchCtx();
    const hctx = createHctx(ctx);
    await handleOrch(hctx, { kind: 'orch', nameOrAlias: 'nonexistent' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('not found'))).toBe(true);
  });

  it('reports error when engine throws', async () => {
    const mockOrch = { id: 'orch-1', name: 'Deploy', status: 'active', alias: 'deploy' };
    const ctx = createMockOrchCtx();
    (ctx.orchestratorStore.findByAlias as ReturnType<typeof vi.fn>).mockReturnValue(mockOrch);
    (ctx.orchestratorEngine.startRun as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('DAG validation failed'),
    );
    const hctx = createHctx(ctx);
    await handleOrch(hctx, { kind: 'orch', nameOrAlias: 'deploy' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('Failed to start'))).toBe(true);
  });

  it('rejects manual starts for webhook-triggered orchestrators', async () => {
    const mockOrch = {
      id: 'orch-1',
      name: 'Webhook Pipeline',
      status: 'active',
      alias: 'deploy',
      triggerMode: 'webhook',
    };
    const ctx = createMockOrchCtx();
    (ctx.orchestratorStore.findByAlias as ReturnType<typeof vi.fn>).mockReturnValue(mockOrch);
    const hctx = createHctx(ctx);

    await handleOrch(hctx, { kind: 'orch', nameOrAlias: 'deploy' });

    expect(ctx.orchestratorEngine.startRun).not.toHaveBeenCalled();
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('webhook-triggered'))).toBe(true);
  });
});

describe('handleOrchList', () => {
  it('shows empty message when no orchestrators', async () => {
    const ctx = createMockOrchCtx();
    const hctx = createHctx(ctx);
    await handleOrchList(hctx);
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('No active orchestrators'))).toBe(true);
  });

  it('lists orchestrators', async () => {
    const ctx = createMockOrchCtx();
    (ctx.orchestratorStore.list as ReturnType<typeof vi.fn>).mockReturnValue([
      { name: 'Deploy', alias: 'deploy', runCount: 5, scheduleType: null },
      {
        name: 'One Shot',
        alias: 'once',
        runCount: 1,
        scheduleType: 'once',
        cronExpr: null,
      },
      {
        name: 'Review',
        alias: null,
        runCount: 2,
        scheduleType: 'recurring',
        cronExpr: '0 9 * * *',
      },
    ]);
    const hctx = createHctx(ctx);
    await handleOrchList(hctx);
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('Deploy') && m.includes('deploy'))).toBe(true);
    expect(messages.some((m) => m.includes('One Shot') && m.includes('| once'))).toBe(true);
    expect(messages.some((m) => m.includes('Review') && m.includes('cron'))).toBe(true);
  });
});

describe('handleOrchStatus', () => {
  it('shows run history for orchestrator', async () => {
    const mockOrch = { id: 'orch-1', name: 'Deploy', status: 'active' };
    const ctx = createMockOrchCtx();
    (ctx.orchestratorStore.findByAlias as ReturnType<typeof vi.fn>).mockReturnValue(mockOrch);
    (ctx.orchestratorStore.getRunsByOrchestrator as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        id: 'run-1234-abcd-5678-efgh',
        status: 'completed',
        triggeredBy: 'slack',
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:01:00Z',
      },
    ]);
    const hctx = createHctx(ctx);
    await handleOrchStatus(hctx, { kind: 'orch_status', target: 'deploy' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('Deploy') && m.includes('completed'))).toBe(true);
  });

  it('shows a no-runs message when orchestrator has never executed', async () => {
    const mockOrch = { id: 'orch-1', name: 'Deploy', status: 'active' };
    const ctx = createMockOrchCtx();
    (ctx.orchestratorStore.findByAlias as ReturnType<typeof vi.fn>).mockReturnValue(mockOrch);
    (ctx.orchestratorStore.getRunsByOrchestrator as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const hctx = createHctx(ctx);

    await handleOrchStatus(hctx, { kind: 'orch_status', target: 'deploy' });

    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('No runs yet'))).toBe(true);
  });

  it('formats running and incomplete runs without a finished duration', async () => {
    const mockOrch = { id: 'orch-1', name: 'Deploy', status: 'active' };
    const ctx = createMockOrchCtx();
    (ctx.orchestratorStore.findByAlias as ReturnType<typeof vi.fn>).mockReturnValue(mockOrch);
    (ctx.orchestratorStore.getRunsByOrchestrator as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        id: 'run-running-abcd-5678',
        status: 'running',
        triggeredBy: 'slack',
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: null,
      },
      {
        id: 'run-pending-abcd-5678',
        status: 'failed',
        triggeredBy: 'dashboard',
        startedAt: null,
        endedAt: null,
      },
    ]);
    const hctx = createHctx(ctx);

    await handleOrchStatus(hctx, { kind: 'orch_status', target: 'deploy' });

    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('in progress'))).toBe(true);
    expect(messages.some((m) => m.includes('failed (dashboard) -'))).toBe(true);
  });

  it('reports when orchestrator not found', async () => {
    const ctx = createMockOrchCtx();
    const hctx = createHctx(ctx);
    await handleOrchStatus(hctx, { kind: 'orch_status', target: 'nonexistent' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('not found'))).toBe(true);
  });
});

describe('handleOrchCancel', () => {
  it('cancels a running orchestration', async () => {
    const ctx = createMockOrchCtx();
    const hctx = createHctx(ctx);
    await handleOrchCancel(hctx, { kind: 'orch_cancel', runId: 'run-1234-abcd' });
    expect(ctx.orchestratorEngine.cancelRun).toHaveBeenCalledWith('run-1234-abcd');
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('cancelled'))).toBe(true);
  });

  it('reports error when cancel fails', async () => {
    const ctx = createMockOrchCtx();
    (ctx.orchestratorEngine.cancelRun as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Run not found'),
    );
    const hctx = createHctx(ctx);
    await handleOrchCancel(hctx, { kind: 'orch_cancel', runId: 'bad-id' });
    const messages = getPostedMessages(hctx);
    expect(messages.some((m) => m.includes('Failed to cancel'))).toBe(true);
  });
});
