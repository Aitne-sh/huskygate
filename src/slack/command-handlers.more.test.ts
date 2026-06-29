import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => {
  const removeSessionWorkdir = vi.fn(
    (_ctx: unknown, _workdir: string): { removed: boolean; skippedReason: string | null } => ({
      removed: true,
      skippedReason: null,
    }),
  );
  return {
    postMessageWithContext: vi.fn().mockResolvedValue(undefined),
    formatCommandListMessage: vi.fn(() => 'command-list'),
    formatSessionListMessage: vi.fn((sessions: unknown[]) => `sessions:${sessions.length}`),
    formatUnknownBangCommandError: vi.fn((input: string) => `Unknown bang: ${input}`),
    generateChallengeCode: vi.fn(() => 'ABCD'),
    sanitizeStickyApprovalState: vi.fn((toolState: Record<string, unknown>) => ({
      toolState,
      changed: false,
    })),
    scheduleExpiry: vi.fn(),
    clearInactivityTimer: vi.fn(),
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
    stopSessionExecution: vi.fn(),
    clearPendingStateForSession: vi.fn(),
    removeSessionWorkdir,
    getActiveSessionRef: vi.fn(
      (): { sessionKey: string; session: Record<string, unknown> } | null => null,
    ),
    maybeRunSwitchPreflight: vi.fn().mockResolvedValue(undefined),
    downloadFiles: vi.fn().mockResolvedValue({ downloaded: [], errors: [] }),
    buildFileReferenceBlock: vi.fn(() => '\n[file-ref]'),
    loggerWarn: vi.fn(),
    getDefaultModelForTool: vi.fn((): string | null => null),
    postMessageWithBlocks: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('./app-helpers.js', () => ({
  CHALLENGE_TIMEOUT_MS: 30_000,
  clearInactivityTimer: mocked.clearInactivityTimer,
  formatCommandListMessage: mocked.formatCommandListMessage,
  formatSessionListMessage: mocked.formatSessionListMessage,
  formatUnknownBangCommandError: mocked.formatUnknownBangCommandError,
  generateChallengeCode: mocked.generateChallengeCode,
  getDefaultModelForTool: mocked.getDefaultModelForTool,
  postMessageWithBlocks: mocked.postMessageWithBlocks,
  postMessageWithContext: mocked.postMessageWithContext,
  scheduleExpiry: mocked.scheduleExpiry,
}));

vi.mock('../shared/approval.js', () => ({
  sanitizeStickyApprovalState: mocked.sanitizeStickyApprovalState,
}));

vi.mock('./block-kit.js', () => ({
  buildSessionListBlocks: vi.fn(() => [
    { type: 'section', text: { type: 'mrkdwn', text: 'sessions' } },
  ]),
  buildMenuNoSessionBlocks: vi.fn(() => [
    { type: 'section', text: { type: 'mrkdwn', text: 'menu-no-session' } },
  ]),
  buildMenuActiveSessionBlocks: vi.fn(() => [
    { type: 'section', text: { type: 'mrkdwn', text: 'menu-active' } },
  ]),
}));

vi.mock('./handler-context.js', () => ({
  clearPendingStateForSession: mocked.clearPendingStateForSession,
  formatSessionClearAllSummary: mocked.formatSessionClearAllSummary,
  formatSessionClearedMessage: mocked.formatSessionClearedMessage,
  getActiveSessionRef: mocked.getActiveSessionRef,
  removeSessionWorkdir: mocked.removeSessionWorkdir,
  stopSessionExecution: mocked.stopSessionExecution,
}));

vi.mock('./mcp-preflight.js', () => ({
  maybeRunSwitchPreflight: mocked.maybeRunSwitchPreflight,
}));

vi.mock('../shared/file-attachment.js', () => ({
  buildFileReferenceBlock: mocked.buildFileReferenceBlock,
  downloadFiles: mocked.downloadFiles,
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: mocked.loggerWarn,
    error: vi.fn(),
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, writeFileSync: vi.fn() };
});

import {
  dispatchCommand,
  handleAutorun,
  handleConfirm,
  handleCurrentSession,
  handleDev,
  handleDevList,
  handleDevNew,
  handleExit,
  handleListCommands,
  handleMcp,
  handleMcpReset,
  handleMcpToggle,
  handleMenu,
  handleModeChange,
  handleModeNetDisabled,
  handleNewSession,
  handlePrompt,
  handleReset,
  handleSessionClear,
  handleSessionClearAll,
  handleSessions,
  handleStartSession,
  handleStatus,
  handleStop,
  handleTask,
  handleToolSwitch,
  handleUnknownBang,
  handleWorkdirChange,
  handleWorkdirQuery,
  handleWorkdirReset,
} from './commands/dispatch.js';

type MockFn = ReturnType<typeof vi.fn>;

function createCtx() {
  const listSessionsForThread = vi.fn(() => []);
  const getSessionByIdForThread = vi.fn(() => null);
  const findLatestSessionByTool = vi.fn(() => null);
  return {
    config: {
      workdirRoot: '/tmp/test-workdir',
      slack: { botToken: 'xoxb-test' },
    },
    sessionManager: {
      listSessionsForThread,
      listSessionsForThreadOwned: listSessionsForThread,
      getSessionSummaryByIdForThreadOwned: vi.fn(() => null),
      deleteSessionById: vi.fn(() => null),
      deleteSessionsByIds: vi.fn(() => []),
      getActiveSessionSummary: vi.fn(() => null),
      getSessionByIdForThread,
      getSessionByIdForThreadOwned: getSessionByIdForThread,
      setActiveSessionKey: vi.fn(),
      clearActiveSession: vi.fn(),
      getSessionSummary: vi.fn(() => null),
      findLatestSessionByTool,
      findLatestSessionByToolOwned: findLatestSessionByTool,
      createSessionForThread: vi.fn(() => null),
      createStandaloneSession: vi.fn(() => null),
      updateMode: vi.fn(),
      get: vi.fn(() => null),
      updateWorkdir: vi.fn(),
      updateToolState: vi.fn(),
      updateTool: vi.fn(),
      findDevSession: vi.fn(() => null),
      createDevSession: vi.fn(() => null),
      deleteSessionByKeyWithCleanup: vi.fn(),
      setRunningJob: vi.fn(),
      reset: vi.fn(),
    },
    jobQueue: {
      enqueue: vi.fn(() => ({ position: 0 })),
      cancelSession: vi.fn(),
      getStatus: vi.fn(() => ({ pending: 0 })),
      getRunningJob: vi.fn(() => null),
    },
    workdirManager: {
      cleanupUnusedSessionWorkdirs: vi.fn(() => 0),
      archiveLegacyDefaultWorkdirIfUnused: vi.fn(() => null),
      prepareWorkdirForTool: vi.fn(),
      prepareWorkdirForToolWithPolicy: vi.fn(),
      prepareWorkdirSkillsOnly: vi.fn(),
      getSessionWorkdir: vi.fn(() => '/tmp/test-workdir/fallback'),
      validateCustomWorkdir: vi.fn((p: string) => p),
      prepareDevWorkdir: vi.fn(),
      seedDevInstructionFile: vi.fn(),
    },
    auditStore: {
      logModeChange: vi.fn(),
    },
    devAliasStore: {
      list: vi.fn(() => []),
      get: vi.fn(() => null),
    },
    mcpServerStore: {
      listByTool: vi.fn(() => []),
    },
    sessionMcpServerStore: {
      listBySession: vi.fn(() => []),
      setEnabled: vi.fn(),
      reset: vi.fn(),
    },
    ondemandTaskStore: {
      findByKey: vi.fn(() => null),
      recordRun: vi.fn(),
      updateRun: vi.fn(),
    },
    pendingConfirmations: new Map(),
    pendingToolApprovals: new Map(),
    pendingMcpAuthBypassApprovals: new Map(),
    inactivityTimers: new Map(),
    activeRunners: new Map(),
    switchPreflightBarriers: new Map(),
    defaultInstructionStore: { getWithEnabled: vi.fn(() => ({ content: '', enabled: false })) },
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

function setActive(session: Record<string, unknown>): void {
  mocked.getActiveSessionRef.mockReturnValue({ sessionKey: session.sessionKey as string, session });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.postMessageWithContext.mockResolvedValue(undefined);
  mocked.getActiveSessionRef.mockReturnValue(null);
  mocked.removeSessionWorkdir.mockReturnValue({ removed: true, skippedReason: null });
  mocked.downloadFiles.mockResolvedValue({ downloaded: [], errors: [] });
  mocked.sanitizeStickyApprovalState.mockImplementation((toolState: Record<string, unknown>) => ({
    toolState,
    changed: false,
  }));
});

describe('command-handlers additional coverage', () => {
  it('handles sessions and current_session routes', async () => {
    const ctx = createCtx();
    (ctx.sessionManager.listSessionsForThreadOwned as MockFn).mockReturnValue([
      { sessionKey: 's1' },
    ]);
    setActive({
      sessionKey: 'sess_1',
      tool: 'claude',
      mode: 'readonly',
      modeExpiresAt: null,
      workdir: '/tmp/test-workdir/a',
      toolState: {},
    });
    (ctx.sessionManager.getSessionSummary as MockFn).mockReturnValue({
      sessionId: 'abcd1234',
      sessionKey: 'sess_1',
      tool: 'claude',
      startedAt: '2026-01-01',
      updatedAt: '2026-01-01',
      mode: 'readonly',
      modeExpiresAt: null,
      workdir: '/tmp/test-workdir/a',
    });
    const hctx = createHctx(ctx);

    await handleSessions(hctx as never, { kind: 'sessions' });
    expect(mocked.formatSessionListMessage).toHaveBeenCalled();

    await handleCurrentSession(hctx as never, { kind: 'current_session' });
    expect(lastMessage()).toContain('*Current Session*');
  });

  it('handles session_clear not-found, already-deleted, and success cases', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);

    await handleSessionClear(hctx as never, { kind: 'session_clear', sessionId: 'deadbeef' });
    expect(lastMessage()).toContain('was not found');

    (ctx.sessionManager.getSessionSummaryByIdForThreadOwned as MockFn).mockReturnValue({
      sessionKey: 'sess_1',
      sessionId: 'abcd1234',
      threadKey: hctx.threadKey,
      userId: hctx.userId,
      tool: 'claude',
      active: true,
      workdir: '/tmp/test-workdir/s1',
    });
    (ctx.sessionManager.deleteSessionById as MockFn).mockReturnValueOnce(null).mockReturnValueOnce({
      sessionKey: 'sess_1',
      tool: 'claude',
      workdir: '/tmp/test-workdir/s1',
    });

    await handleSessionClear(hctx as never, { kind: 'session_clear', sessionId: 'abcd1234' });
    expect(lastMessage()).toContain('no longer exists');

    mocked.removeSessionWorkdir.mockReturnValue({
      removed: false,
      skippedReason: 'outside WORKDIR_ROOT',
    });
    await handleSessionClear(hctx as never, { kind: 'session_clear', sessionId: 'abcd1234' });
    expect(lastMessage()).toContain('Session cleared');
  });

  it('covers session_clear workdir removed/already-absent message branches', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);
    (ctx.sessionManager.getSessionSummaryByIdForThreadOwned as MockFn).mockReturnValue({
      sessionKey: 'sess_x',
      sessionId: 'abcd1234',
      threadKey: hctx.threadKey,
      userId: hctx.userId,
      tool: 'claude',
      active: false,
      workdir: '/tmp/test-workdir/sx',
    });
    (ctx.sessionManager.deleteSessionById as MockFn).mockReturnValue({
      sessionKey: 'sess_x',
      tool: 'claude',
      workdir: '/tmp/test-workdir/sx',
    });

    mocked.removeSessionWorkdir
      .mockReturnValueOnce({ removed: true, skippedReason: null })
      .mockReturnValueOnce({ removed: false, skippedReason: null });

    await handleSessionClear(hctx as never, { kind: 'session_clear', sessionId: 'abcd1234' });
    expect(lastMessage()).toContain('Workdir removed');

    await handleSessionClear(hctx as never, { kind: 'session_clear', sessionId: 'abcd1234' });
    expect(lastMessage()).toContain('Workdir already absent');
  });

  it('handles session_clear_all and reports skipped/archived workdirs', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);
    (ctx.sessionManager.listSessionsForThreadOwned as MockFn).mockReturnValue([
      { sessionId: 's1', sessionKey: 'sk1', active: true },
      { sessionId: 's2', sessionKey: 'sk2', active: false },
    ]);
    (ctx.sessionManager.deleteSessionsByIds as MockFn).mockReturnValue([
      { sessionKey: 'sk1', tool: 'claude', workdir: '/tmp/test-workdir/s1' },
      { sessionKey: 'sk2', tool: 'gemini', workdir: '/tmp/test-workdir/s2' },
    ]);
    (ctx.workdirManager.cleanupUnusedSessionWorkdirs as MockFn).mockReturnValue(1);
    (ctx.workdirManager.archiveLegacyDefaultWorkdirIfUnused as MockFn).mockReturnValue(
      '/tmp/test-workdir/_archive/default',
    );
    mocked.removeSessionWorkdir
      .mockReturnValueOnce({ removed: true, skippedReason: null })
      .mockReturnValueOnce({ removed: false, skippedReason: 'target is WORKDIR_ROOT' });

    await handleSessionClearAll(hctx as never, { kind: 'session_clear_all' });

    expect(lastMessage()).toContain('Cleared all sessions: 2');
    expect(lastMessage()).toContain('Archived legacy default workdir');
    expect(lastMessage()).toContain('Skipped workdir removals');
  });

  it('covers session_clear_all inactivity timer cleanup loop', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);
    (ctx.sessionManager.listSessionsForThreadOwned as MockFn).mockReturnValue([
      { sessionId: 's1', sessionKey: 'sk1', active: true },
    ]);
    (ctx.sessionManager.deleteSessionsByIds as MockFn).mockReturnValue([
      { sessionKey: 'sk1', tool: 'claude', workdir: '/tmp/test-workdir/s1' },
    ]);

    await handleSessionClearAll(hctx as never, { kind: 'session_clear_all' });

    expect(mocked.clearInactivityTimer).toHaveBeenCalledWith(ctx, hctx.threadKey);
  });

  it('handles start_session and new_session branches', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);

    await handleStartSession(hctx as never, { kind: 'start_session', sessionId: 'deadbeef' });
    expect(lastMessage()).toContain('was not found in this thread');

    (ctx.sessionManager.getSessionByIdForThreadOwned as MockFn).mockReturnValue({
      sessionKey: 'sess_resume',
      tool: 'gemini',
      workdir: '/tmp/test-workdir/resume',
    });
    (ctx.sessionManager.getSessionSummary as MockFn).mockReturnValue({ sessionId: 'resumeid' });
    setActive({
      sessionKey: 'other',
      tool: 'claude',
      mode: 'readonly',
      workdir: '/tmp',
      toolState: {},
    });

    await handleStartSession(hctx as never, { kind: 'start_session', sessionId: 'resumeid' });
    expect(lastMessage()).toContain('Cannot switch sessions');

    mocked.getActiveSessionRef.mockReturnValue(null);
    await handleStartSession(hctx as never, { kind: 'start_session', sessionId: 'resumeid' });
    expect(lastMessage()).toContain('Session resumed');
    expect(mocked.maybeRunSwitchPreflight).toHaveBeenCalled();

    setActive({
      sessionKey: 'active',
      tool: 'claude',
      mode: 'readonly',
      workdir: '/tmp',
      toolState: {},
    });
    await handleNewSession(hctx as never, { kind: 'new_session', tool: 'gemini' });
    expect(lastMessage()).toContain('Cannot start');

    mocked.getActiveSessionRef.mockReturnValue(null);
    (ctx.sessionManager.createSessionForThread as MockFn).mockReturnValue({
      sessionKey: 'sess_new',
      tool: 'gemini',
      workdir: '/tmp/test-workdir/new',
      mode: 'readonly',
      toolState: {},
    });
    (ctx.sessionManager.getSessionSummary as MockFn).mockReturnValue({ sessionId: 'newid' });
    await handleNewSession(hctx as never, { kind: 'new_session', tool: 'gemini' });
    expect(lastMessage()).toContain('New session started');
  });

  it('handles mode and confirm flows', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);

    await handleModeNetDisabled(hctx as never, { kind: 'mode_net_disabled' });
    expect(lastMessage()).toContain('disabled');

    await handleModeChange(hctx as never, { kind: 'mode_change', mode: 'write' });
    expect(lastMessage()).toContain('No active session');

    setActive({
      sessionKey: 'sess_1',
      tool: 'claude',
      mode: 'write',
      modeExpiresAt: null,
      workdir: '/tmp/test-workdir/s1',
      toolState: {},
    });

    await handleModeChange(hctx as never, { kind: 'mode_change', mode: 'readonly' });
    expect(lastMessage()).toContain('Mode set to readonly');

    await handleModeChange(hctx as never, { kind: 'mode_change', mode: 'write' });
    expect(lastMessage()).toContain('Write permission requested');
    expect(mocked.scheduleExpiry).toHaveBeenCalled();

    (ctx.sessionManager.get as MockFn).mockReturnValue({
      tool: 'claude',
      mode: 'readonly',
    });
    await handleConfirm(hctx as never, { kind: 'confirm', code: 'ABCD' });
    expect(lastMessage()).toContain('Mode set to `write`');

    ctx.pendingConfirmations.set(hctx.threadKey, {
      kind: 'workdir',
      code: 'WORK',
      expiresAt: Date.now() + 10_000,
      sessionKey: 'sess_1',
      workdir: '/tmp/test-workdir/newwd',
    });
    (ctx.sessionManager.get as MockFn).mockReturnValue({ tool: 'claude' });

    await handleConfirm(hctx as never, { kind: 'confirm', code: 'WORK' });
    expect(lastMessage()).toContain('Workdir changed to');
  });

  it('handles workdir query/reset/change branches', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);

    await handleWorkdirQuery(hctx as never, { kind: 'workdir_query' });
    expect(lastMessage()).toContain('No active session');

    setActive({
      sessionKey: 'sess_1',
      tool: 'claude',
      mode: 'readonly',
      modeExpiresAt: null,
      workdir: '/tmp/test-workdir/s1',
      toolState: {},
    });

    await handleWorkdirQuery(hctx as never, { kind: 'workdir_query' });
    expect(lastMessage()).toContain('Current workdir');

    (ctx.sessionManager.getSessionSummary as MockFn).mockReturnValue({ sessionId: 'abc12345' });
    await handleWorkdirReset(hctx as never, { kind: 'workdir_reset' });
    expect(lastMessage()).toContain('Workdir reset to');

    await handleWorkdirChange(hctx as never, {
      kind: 'workdir_change',
      path: '/tmp/test-workdir/custom',
    });
    expect(lastMessage()).toContain('Workdir change requested');

    (ctx.workdirManager.validateCustomWorkdir as MockFn).mockImplementation(() => {
      throw new Error('outside allowed roots');
    });
    await handleWorkdirChange(hctx as never, { kind: 'workdir_change', path: '/etc' });
    expect(lastMessage()).toContain('Workdir error: outside allowed roots');
  });

  it('handles dev_list/dev/dev_new flows', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);

    await handleDevList(hctx as never, { kind: 'dev_list' });
    expect(lastMessage()).toContain('No dev aliases configured');

    (ctx.devAliasStore.list as MockFn).mockReturnValue([
      { name: 'api', tool: 'claude', path: '/repo' },
    ]);
    await handleDevList(hctx as never, { kind: 'dev_list' });
    expect(lastMessage()).toContain('*Dev Aliases*');

    await handleDev(hctx as never, { kind: 'dev', alias: 'missing' });
    expect(lastMessage()).toContain('not found');

    const alias = { name: 'api', tool: 'gemini', path: '/repo', instructionContent: 'Read AGENTS' };
    (ctx.devAliasStore.get as MockFn).mockReturnValue(alias);
    setActive({
      sessionKey: 'other',
      tool: 'claude',
      mode: 'readonly',
      workdir: '/tmp',
      toolState: {},
    });

    await handleDev(hctx as never, { kind: 'dev', alias: 'api' });
    expect(lastMessage()).toContain('Cannot start dev session');

    mocked.getActiveSessionRef.mockReturnValue(null);
    (ctx.sessionManager.findDevSession as MockFn).mockReturnValue({
      sessionKey: 'dev_sess',
      tool: 'gemini',
      workdir: '/repo',
    });
    (ctx.sessionManager.getSessionSummary as MockFn).mockReturnValue({ sessionId: 'dev1234' });
    await handleDev(hctx as never, { kind: 'dev', alias: 'api' });
    expect(lastMessage()).toContain('Dev session resumed');

    (ctx.sessionManager.findDevSession as MockFn).mockReturnValue(null);
    (ctx.sessionManager.createDevSession as MockFn).mockReturnValue({
      sessionKey: 'dev_new',
      tool: 'gemini',
      workdir: '/repo',
    });
    await handleDev(hctx as never, { kind: 'dev', alias: 'api' });
    expect(lastMessage()).toContain('Dev session started');

    (ctx.devAliasStore.get as MockFn).mockReturnValue(null);
    await handleDevNew(hctx as never, { kind: 'dev_new', alias: 'missing' });
    expect(lastMessage()).toContain('not found');

    (ctx.devAliasStore.get as MockFn).mockReturnValue(alias);
    (ctx.sessionManager.findDevSession as MockFn).mockReturnValue({
      sessionKey: 'dev_old',
      tool: 'gemini',
      workdir: '/repo',
    });
    await handleDevNew(hctx as never, { kind: 'dev_new', alias: 'api' });
    expect(lastMessage()).toContain('New dev session started');
  });

  it('covers unknown/list/current-session-empty and exit tool-state cleanup', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);

    await handleUnknownBang(hctx as never, { kind: 'unknown_bang', input: '!oops' });
    expect(lastMessage()).toContain('Unknown bang');

    await handleListCommands(hctx as never, { kind: 'list_commands' });
    expect(lastMessage()).toContain('command-list');

    await handleCurrentSession(hctx as never, { kind: 'current_session' });
    expect(lastMessage()).toContain('No active session');

    const kill = vi.fn();
    ctx.activeRunners.set('sess_g', {
      runner: { isRunning: () => true, kill },
      job: {},
    } as never);
    setActive({
      sessionKey: 'sess_g',
      tool: 'gemini',
      mode: 'readonly',
      workdir: '/tmp/g',
      toolState: {},
    });
    await handleExit(hctx as never, { kind: 'exit' });
    expect(kill).toHaveBeenCalledWith('user_exit');
    expect((ctx.sessionManager.updateToolState as MockFn).mock.calls.length).toBeGreaterThan(0);
    expect((ctx.sessionManager.clearActiveSession as MockFn).mock.calls.length).toBeGreaterThan(0);
  });

  it('covers additional stop/status/reset and confirm edge branches', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);

    setActive({
      sessionKey: 'sess_1',
      tool: 'claude',
      mode: 'write',
      modeExpiresAt: null,
      workdir: '/tmp/w',
      toolState: {},
    });
    await handleStop(hctx as never, { kind: 'stop' });
    expect(lastMessage()).toContain('No running job to stop');

    (ctx.jobQueue.getRunningJob as MockFn).mockReturnValue({
      id: 'job_1',
      createdAt: Date.now() - 4000,
    });
    await handleStatus(hctx as never, { kind: 'status' });
    expect(lastMessage()).toContain('Running: job_1');

    const runnerKill = vi.fn();
    ctx.activeRunners.set('sess_1', {
      runner: { isRunning: () => true, kill: runnerKill },
      job: {},
    } as never);
    await handleReset(hctx as never, { kind: 'reset' });
    expect(runnerKill).toHaveBeenCalledWith('reset');

    await handleConfirm(hctx as never, { kind: 'confirm', code: 'ABCD' });
    expect(lastMessage()).toContain('No pending confirmation');

    ctx.pendingConfirmations.set(hctx.threadKey, {
      kind: 'mode',
      mode: 'write',
      code: 'ABCD',
      expiresAt: Date.now() - 1,
      sessionKey: 'sess_1',
    });
    await handleConfirm(hctx as never, { kind: 'confirm', code: 'ABCD' });
    expect(lastMessage()).toContain('expired');

    ctx.pendingConfirmations.set(hctx.threadKey, {
      kind: 'mode',
      mode: 'write',
      code: 'GOOD',
      expiresAt: Date.now() + 10_000,
      sessionKey: 'sess_1',
    });
    await handleConfirm(hctx as never, { kind: 'confirm', code: 'BAD' });
    expect(lastMessage()).toContain('Invalid confirmation code');

    ctx.pendingConfirmations.set(hctx.threadKey, {
      kind: 'mode',
      mode: 'write',
      code: 'GOOD',
      expiresAt: Date.now() + 10_000,
      sessionKey: 'sess_missing',
    });
    (ctx.sessionManager.get as MockFn).mockReturnValue(null);
    await handleConfirm(hctx as never, { kind: 'confirm', code: 'GOOD' });
    expect(lastMessage()).toContain('session no longer exists');

    ctx.pendingConfirmations.set(hctx.threadKey, {
      kind: 'workdir',
      code: 'W1',
      expiresAt: Date.now() + 10_000,
      sessionKey: 'sess_missing',
      workdir: '/tmp/new',
    });
    (ctx.sessionManager.get as MockFn).mockReturnValue(null);
    await handleConfirm(hctx as never, { kind: 'confirm', code: 'W1' });
    expect(lastMessage()).toContain('session no longer exists');
  });

  it('covers additional workdir and dev-new conflict branches', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);

    await handleWorkdirReset(hctx as never, { kind: 'workdir_reset' });
    expect(lastMessage()).toContain('No active session');

    await handleWorkdirChange(hctx as never, { kind: 'workdir_change', path: '/tmp/x' });
    expect(lastMessage()).toContain('No active session');

    const alias = { name: 'api', tool: 'gemini', path: '/repo', instructionContent: null };
    (ctx.devAliasStore.get as MockFn).mockReturnValue(alias);
    setActive({
      sessionKey: 'other',
      tool: 'claude',
      mode: 'readonly',
      workdir: '/tmp',
      toolState: {},
    });
    (ctx.sessionManager.findDevSession as MockFn).mockReturnValue({ sessionKey: 'dev_old' });
    await handleDevNew(hctx as never, { kind: 'dev_new', alias: 'api' });
    expect(lastMessage()).toContain('Cannot start dev session');
  });

  it('covers tool-switch already-using/latest-found and workdir-reset fallback branches', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);

    setActive({
      sessionKey: 'sess_same',
      tool: 'claude',
      mode: 'readonly',
      workdir: '/tmp/same',
      toolState: {},
    });
    (ctx.sessionManager.getSessionSummary as MockFn).mockReturnValue({ sessionId: 'same1234' });
    await handleToolSwitch(hctx as never, { kind: 'tool_switch', tool: 'claude' });
    expect(lastMessage()).toContain('Already using `claude`');

    mocked.getActiveSessionRef.mockReturnValue(null);
    (ctx.sessionManager.findLatestSessionByToolOwned as MockFn).mockReturnValue({
      sessionKey: 'sess_latest',
      tool: 'gemini',
      mode: 'readonly',
      workdir: '/tmp/latest',
      toolState: {},
    });
    (ctx.sessionManager.getSessionSummary as MockFn).mockReturnValue({ sessionId: 'latest1234' });
    await handleToolSwitch(hctx as never, { kind: 'tool_switch', tool: 'gemini' });
    expect((ctx.sessionManager.setActiveSessionKey as MockFn).mock.calls.length).toBeGreaterThan(0);

    setActive({
      sessionKey: 'sess_wr',
      tool: 'codex',
      mode: 'readonly',
      modeExpiresAt: null,
      workdir: '/tmp/wr',
      toolState: {},
    });
    (ctx.sessionManager.getSessionSummary as MockFn).mockReturnValue(null);
    await handleWorkdirReset(hctx as never, { kind: 'workdir_reset' });
    expect((ctx.workdirManager.getSessionWorkdir as MockFn).mock.calls.length).toBeGreaterThan(0);
  });

  it('covers prompt tool conflict/resolution, attachments, and queue feedback branches', async () => {
    const ctx = createCtx();
    const hctx = { ...createHctx(ctx), slackFiles: [{ id: 'F1', name: 'a.txt' }] };

    setActive({
      sessionKey: 'sess_c',
      tool: 'claude',
      mode: 'readonly',
      modeExpiresAt: null,
      workdir: '/tmp/c',
      toolState: {},
    });
    await handlePrompt(hctx as never, { kind: 'prompt', tool: 'gemini', prompt: 'hello' });
    expect(lastMessage()).toContain('Cannot run `gemini`');

    mocked.getActiveSessionRef.mockReturnValue(null);
    (ctx.sessionManager.findLatestSessionByToolOwned as MockFn).mockReturnValue({
      sessionKey: 'sess_g',
      tool: 'gemini',
      mode: 'write',
      modeExpiresAt: new Date(Date.now() - 1).toISOString(),
      workdir: '/tmp/g',
      toolState: { sticky: true },
      devAlias: 'dev',
    });
    mocked.sanitizeStickyApprovalState.mockReturnValue({
      toolState: { cleaned: true },
      changed: true,
    });
    mocked.downloadFiles.mockResolvedValue({
      downloaded: [{ path: '/tmp/g/a.txt', fileName: 'a.txt' }],
      errors: [
        {
          fileName: 'bad.bin',
          reason: 'Redirect to disallowed host: https://example.com/file',
          userReason: 'Failed to download file from Slack.',
        },
      ],
    });
    (ctx.jobQueue.enqueue as MockFn)
      .mockReturnValueOnce({ error: 'queue full' })
      .mockReturnValueOnce({ position: 2 });

    await handlePrompt(hctx as never, { kind: 'prompt', tool: 'gemini', prompt: 'with file' });
    const promptMessages = mocked.postMessageWithContext.mock.calls
      .map((call) => String(call[4] ?? ''))
      .join('\n');
    expect(promptMessages).toContain('Failed to download file from Slack.');
    expect(promptMessages).not.toContain('Redirect to disallowed host');
    expect(lastMessage()).toContain('queue full');
    expect((ctx.sessionManager.updateToolState as MockFn).mock.calls.length).toBeGreaterThan(0);
    expect((ctx.workdirManager.prepareDevWorkdir as MockFn).mock.calls.length).toBeGreaterThan(0);

    mocked.downloadFiles.mockRejectedValueOnce(new Error('download failed'));
    await handlePrompt(hctx as never, { kind: 'prompt', tool: 'gemini', prompt: 'again' });
    expect(lastMessage()).toContain('Queued (position: 2)');
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'file_attachment_failed',
      expect.objectContaining({ error: 'download failed' }),
    );
  });

  it('covers prompt session-resolution-failed and dispatch switch cases', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);

    (ctx.sessionManager.createSessionForThread as MockFn).mockReturnValue({
      sessionKey: '',
      tool: 'claude',
      mode: 'readonly',
      modeExpiresAt: null,
      workdir: '/tmp/work',
      toolState: {},
    });
    await handlePrompt(hctx as never, { kind: 'prompt', tool: 'claude', prompt: 'x' });
    expect(lastMessage()).toContain('Session resolution failed');

    const commands = [
      { kind: 'sessions' } as const,
      { kind: 'session_clear', sessionId: 'deadbeef' } as const,
      { kind: 'session_clear_all' } as const,
      { kind: 'current_session' } as const,
      { kind: 'start_session', sessionId: 'deadbeef' } as const,
      { kind: 'tool_switch', tool: 'claude' } as const,
      { kind: 'new_session', tool: 'claude' } as const,
      { kind: 'stop' } as const,
      { kind: 'status' } as const,
      { kind: 'reset' } as const,
      { kind: 'mode_net_disabled' } as const,
      { kind: 'mode_change', mode: 'readonly' } as const,
      { kind: 'confirm', code: 'ABCD' } as const,
      { kind: 'workdir_query' } as const,
      { kind: 'workdir_reset' } as const,
      { kind: 'workdir_change', path: '/tmp/a' } as const,
      { kind: 'dev_list' } as const,
      { kind: 'dev', alias: 'missing' } as const,
      { kind: 'dev_new', alias: 'missing' } as const,
      { kind: 'menu' } as const,
      { kind: 'autorun', enabled: true } as const,
      { kind: 'task', nameOrAlias: 'missing-task' } as const,
      { kind: 'prompt', prompt: 'hello' } as const,
    ];
    for (const command of commands) {
      await dispatchCommand(hctx as never, command as never);
    }
    expect(mocked.postMessageWithContext).toHaveBeenCalled();
  });

  it('covers handleAutorun branches (no active/readonly reject/toggle/explicit)', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);

    mocked.getActiveSessionRef.mockReturnValue(null);
    await handleAutorun(hctx as never, { kind: 'autorun' });
    expect(lastMessage()).toContain('No active session');

    // readonly mode → rejected
    mocked.getActiveSessionRef.mockReturnValue({
      sessionKey: 'sess_ro',
      session: {
        tool: 'claude',
        workdir: '/tmp/ro',
        mode: 'readonly',
        toolState: {},
      },
    });
    await handleAutorun(hctx as never, { kind: 'autorun' });
    expect(lastMessage()).toContain('not available in readonly mode');

    // write mode → toggle on
    mocked.getActiveSessionRef.mockReturnValue({
      sessionKey: 'sess_auto',
      session: {
        tool: 'claude',
        workdir: '/tmp/auto',
        mode: 'write',
        toolState: {},
      },
    });
    await handleAutorun(hctx as never, { kind: 'autorun' });
    expect(ctx.sessionManager.updateToolState).toHaveBeenCalledWith(
      'sess_auto',
      expect.objectContaining({ auto_approve: true }),
    );
    // Builder writes instruction file directly (no prepareWorkdirForToolWithPolicy)
    expect(lastMessage()).toContain('Auto-approve mode *enabled*');

    // write mode → explicit off
    mocked.getActiveSessionRef.mockReturnValue({
      sessionKey: 'sess_auto2',
      session: {
        tool: 'gemini',
        workdir: '/tmp/auto2',
        mode: 'write',
        toolState: { auto_approve: true },
      },
    });
    await handleAutorun(hctx as never, { kind: 'autorun', enabled: false });
    expect(ctx.sessionManager.updateToolState).toHaveBeenCalledWith(
      'sess_auto2',
      expect.objectContaining({ auto_approve: false }),
    );
    // Builder writes instruction file directly (no prepareWorkdirForToolWithPolicy)
    expect(lastMessage()).toContain('Auto-approve mode *disabled*');
  });

  it('covers handleTask not-found, enqueue-failure, success, and error branches', async () => {
    const ctx = createCtx();
    const hctx = { ...createHctx(ctx), tool: 'claude' };
    const expectLatestPostContains = (needle: string): void => {
      const call = mocked.postMessageWithContext.mock.calls.at(-1) ?? [];
      const matched = call.some((arg) => {
        if (typeof arg === 'string') return arg.includes(needle);
        if (arg && typeof arg === 'object' && 'text' in arg) {
          return String((arg as { text?: unknown }).text ?? '').includes(needle);
        }
        return false;
      });
      expect(matched).toBe(true);
    };

    await handleTask(hctx as never, { kind: 'task', nameOrAlias: 'missing' });
    expectLatestPostContains('On-demand task `missing` not found.');

    const task = {
      id: 'task-1',
      name: 'daily-report',
      userId: 'U-task',
      tool: 'gemini',
      mode: 'write',
      prompt: 'generate report',
      notifyChannel: 'C-notify',
    };
    const session = {
      sessionKey: 'sess-task',
      tool: 'gemini',
      mode: 'readonly',
      modeExpiresAt: null,
      workdir: '/tmp/test-workdir/ondemand',
      toolState: {},
    };
    (ctx.ondemandTaskStore.findByKey as MockFn).mockReturnValue(task);
    (ctx.sessionManager.createStandaloneSession as MockFn).mockReturnValue(session);
    (ctx.jobQueue.enqueue as MockFn)
      .mockReturnValueOnce({ error: 'queue full' })
      .mockReturnValueOnce({ position: 3 });

    await handleTask(hctx as never, { kind: 'task', nameOrAlias: 'daily-report' });
    expect(ctx.workdirManager.prepareWorkdirSkillsOnly).toHaveBeenCalledWith(
      '/tmp/test-workdir/ondemand',
      'gemini',
      undefined,
    );
    expect(ctx.sessionManager.updateMode).toHaveBeenCalledWith('sess-task', 'write', null);
    expect(ctx.ondemandTaskStore.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        sessionKey: 'sess-task',
        status: 'running',
        source: 'slack',
      }),
    );
    expect(ctx.ondemandTaskStore.updateRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: 'failed',
        errorMessage: expect.stringContaining('queue full'),
      }),
    );
    expect(ctx.sessionManager.deleteSessionByKeyWithCleanup).toHaveBeenCalledWith('sess-task');
    expectLatestPostContains('Failed to start on-demand task `daily-report`: queue full');

    await handleTask(hctx as never, { kind: 'task', nameOrAlias: 'daily-report' });
    expectLatestPostContains('On-demand task `daily-report` started (run: `');
    expect((ctx.jobQueue.enqueue as MockFn).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        channelId: 'C-notify',
        source: 'ondemand-task',
        ondemandTaskId: 'task-1',
        autoApprove: true,
      }),
    );

    (ctx.ondemandTaskStore.findByKey as MockFn).mockReturnValue({
      ...task,
      notifyChannel: null,
    });
    (ctx.jobQueue.enqueue as MockFn).mockReturnValueOnce({ position: 1 });
    await handleTask(hctx as never, { kind: 'task', nameOrAlias: 'daily-report' });
    expect((ctx.jobQueue.enqueue as MockFn).mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        channelId: 'C1',
      }),
    );

    (ctx.sessionManager.createStandaloneSession as MockFn).mockImplementationOnce(() => {
      throw new Error('session failed');
    });
    await handleTask(hctx as never, { kind: 'task', nameOrAlias: 'daily-report' });
    expectLatestPostContains('Error executing on-demand task: session failed');
  });

  it('covers expiry text and unknown summary fallback branches', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);
    const expiresAt = '2026-03-01T00:00:00.000Z';

    setActive({
      sessionKey: 'sess_active',
      tool: 'claude',
      mode: 'write',
      modeExpiresAt: expiresAt,
      workdir: '/tmp/active',
      toolState: {},
    });
    (ctx.sessionManager.getSessionSummary as MockFn).mockReturnValue({
      sessionId: 'active1234',
      sessionKey: 'sess_active',
      tool: 'claude',
      startedAt: '2026-01-01',
      updatedAt: '2026-01-02',
      mode: 'write',
      modeExpiresAt: expiresAt,
      workdir: '/tmp/active',
    });
    await handleCurrentSession(hctx as never, { kind: 'current_session' });
    expect(lastMessage()).toContain(`mode=write (expires: ${expiresAt})`);

    setActive({
      sessionKey: 'sess_status',
      tool: 'claude',
      mode: 'write',
      modeExpiresAt: expiresAt,
      workdir: '/tmp/status',
      toolState: {},
    });
    await handleStatus(hctx as never, { kind: 'status' });
    expect(lastMessage()).toContain(`Mode: write (expires: ${expiresAt})`);

    mocked.getActiveSessionRef.mockReturnValue(null);
    (ctx.sessionManager.getSessionByIdForThreadOwned as MockFn).mockReturnValue({
      sessionKey: 'sess_resume',
      tool: 'claude',
      workdir: '/tmp/resume',
    });
    (ctx.sessionManager.getSessionSummary as MockFn).mockReturnValue(null);
    await handleStartSession(hctx as never, { kind: 'start_session', sessionId: 'resumeid' });
    expect(lastMessage()).toContain('Session resumed: `resumeid` (claude).');

    setActive({
      sessionKey: 'sess_same_tool',
      tool: 'claude',
      mode: 'readonly',
      modeExpiresAt: null,
      workdir: '/tmp/same',
      toolState: {},
    });
    await handleToolSwitch(hctx as never, { kind: 'tool_switch', tool: 'claude' });
    expect(lastMessage()).toContain('Already using `claude` (session: `unknown`)');

    const alias = { name: 'api', tool: 'gemini', path: '/repo', instructionContent: 'Read AGENTS' };
    (ctx.devAliasStore.get as MockFn).mockReturnValue(alias);
    setActive({
      sessionKey: 'dev_same',
      tool: 'gemini',
      mode: 'readonly',
      modeExpiresAt: null,
      workdir: '/repo',
      toolState: {},
    });
    (ctx.sessionManager.findDevSession as MockFn).mockReturnValue({
      sessionKey: 'dev_same',
      tool: 'gemini',
      workdir: '/repo',
    });
    await handleDev(hctx as never, { kind: 'dev', alias: 'api' });
    expect(lastMessage()).toContain('Dev session resumed: `api` (gemini, session: `unknown`).');

    mocked.getActiveSessionRef.mockReturnValue(null);
    (ctx.sessionManager.findDevSession as MockFn).mockReturnValue(null);
    (ctx.sessionManager.createDevSession as MockFn).mockReturnValue({
      sessionKey: 'dev_new',
      tool: 'gemini',
      workdir: '/repo',
    });
    await handleDev(hctx as never, { kind: 'dev', alias: 'api' });
    expect(lastMessage()).toContain('Dev session started: `api` (gemini, session: `unknown`).');

    setActive({
      sessionKey: 'dev_old',
      tool: 'gemini',
      mode: 'readonly',
      modeExpiresAt: null,
      workdir: '/repo',
      toolState: {},
    });
    (ctx.sessionManager.findDevSession as MockFn).mockReturnValue({
      sessionKey: 'dev_old',
      tool: 'gemini',
      workdir: '/repo',
    });
    (ctx.sessionManager.createDevSession as MockFn).mockReturnValue({
      sessionKey: 'dev_new2',
      tool: 'gemini',
      workdir: '/repo',
    });
    await handleDevNew(hctx as never, { kind: 'dev_new', alias: 'api' });
    expect(lastMessage()).toContain('New dev session started: `api` (gemini, session: `unknown`).');
  });

  it('covers handleMenu with active session and no active session', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);

    // No active session branch
    await handleMenu(hctx as never, { kind: 'menu' });
    expect(mocked.postMessageWithBlocks).toHaveBeenCalledWith(
      ctx,
      hctx.client,
      'C1',
      '1.1',
      expect.any(Array),
      expect.stringContaining('No active session'),
    );

    vi.clearAllMocks();

    // Active session branch — with session model
    setActive({
      sessionKey: 'sess_menu',
      tool: 'claude',
      mode: 'write',
      modeExpiresAt: null,
      workdir: '/tmp/w',
      toolState: { model: ' gpt-4o ' },
    });
    (ctx.sessionManager.getSessionSummary as MockFn).mockReturnValue({ sessionId: 'menu-id' });
    (ctx.jobQueue.getRunningJob as MockFn).mockReturnValue({ id: 'job_123' });

    await handleMenu(hctx as never, { kind: 'menu' });
    expect(mocked.postMessageWithBlocks).toHaveBeenCalledWith(
      ctx,
      hctx.client,
      'C1',
      '1.1',
      expect.any(Array),
      expect.stringContaining('HuskyGate — Active: claude (menu-id)'),
      expect.any(Object),
    );

    vi.clearAllMocks();
    mocked.getActiveSessionRef.mockReturnValue(null);
  });

  it('covers handleMenu with empty model (null branch)', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);

    setActive({
      sessionKey: 'sess_no_model',
      tool: 'claude',
      mode: 'write',
      modeExpiresAt: null,
      workdir: '/tmp/w',
      toolState: { model: '  ' },
    });
    (ctx.sessionManager.getSessionSummary as MockFn).mockReturnValue({ sessionId: 'no-model-id' });
    (ctx.jobQueue.getRunningJob as MockFn).mockReturnValue(null);

    await handleMenu(hctx as never, { kind: 'menu' });
    expect(mocked.postMessageWithBlocks).toHaveBeenCalled();

    vi.clearAllMocks();
    mocked.getActiveSessionRef.mockReturnValue(null);
  });

  it('covers handleStatus and handleCurrentSession with env model and session model', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);

    // handleCurrentSession — active session with env model (no session model)
    setActive({
      sessionKey: 'sess_cs',
      tool: 'gemini',
      mode: 'readonly',
      modeExpiresAt: null,
      workdir: '/tmp/cs',
      toolState: {},
    });
    (ctx.sessionManager.getSessionSummary as MockFn).mockReturnValue({
      sessionId: 'cs-001',
      sessionKey: 'sess_cs',
      tool: 'gemini',
      mode: 'readonly',
      modeExpiresAt: null,
      startedAt: '2026-01-01',
      updatedAt: '2026-01-02',
    });
    mocked.getDefaultModelForTool.mockReturnValue('gemini-2.0-flash');
    await handleCurrentSession(hctx as never, { kind: 'current_session' });
    expect(lastMessage()).toContain('model=gemini-2.0-flash (env)');

    vi.clearAllMocks();

    // handleCurrentSession — session model overrides env
    setActive({
      sessionKey: 'sess_cs2',
      tool: 'claude',
      mode: 'write',
      modeExpiresAt: null,
      workdir: '/tmp/cs2',
      toolState: { model: 'claude-opus' },
    });
    (ctx.sessionManager.getSessionSummary as MockFn).mockReturnValue({
      sessionId: 'cs-002',
      sessionKey: 'sess_cs2',
      tool: 'claude',
      mode: 'write',
      modeExpiresAt: null,
      startedAt: '2026-01-01',
      updatedAt: '2026-01-02',
    });
    mocked.getDefaultModelForTool.mockReturnValue(null);
    await handleCurrentSession(hctx as never, { kind: 'current_session' });
    expect(lastMessage()).toContain('model=claude-opus (session)');

    vi.clearAllMocks();

    // handleStatus — active session with session model
    setActive({
      sessionKey: 'sess_st',
      tool: 'claude',
      mode: 'write',
      modeExpiresAt: null,
      workdir: '/tmp/st',
      toolState: { model: 'my-model' },
    });
    mocked.getDefaultModelForTool.mockReturnValue(null);
    await handleStatus(hctx as never, { kind: 'status' });
    expect(lastMessage()).toContain('Model: my-model (session)');

    vi.clearAllMocks();

    // handleStatus — active session with env model only
    setActive({
      sessionKey: 'sess_st2',
      tool: 'gemini',
      mode: 'readonly',
      modeExpiresAt: null,
      workdir: '/tmp/st2',
      toolState: {},
    });
    mocked.getDefaultModelForTool.mockReturnValue('gemini-pro');
    await handleStatus(hctx as never, { kind: 'status' });
    expect(lastMessage()).toContain('Model: gemini-pro (env)');

    mocked.getActiveSessionRef.mockReturnValue(null);
    mocked.getDefaultModelForTool.mockReturnValue(null);
  });

  it('covers handleMenu with getSessionSummary returning null (sessionId falls back to unknown)', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);

    setActive({
      sessionKey: 'sess_null_summary',
      tool: 'claude',
      mode: 'write',
      modeExpiresAt: null,
      workdir: '/tmp/ns',
      toolState: {},
    });
    (ctx.sessionManager.getSessionSummary as MockFn).mockReturnValue(null);
    (ctx.jobQueue.getRunningJob as MockFn).mockReturnValue(null);

    await handleMenu(hctx as never, { kind: 'menu' });
    expect(mocked.postMessageWithBlocks).toHaveBeenCalledWith(
      ctx,
      hctx.client,
      'C1',
      '1.1',
      expect.any(Array),
      expect.stringContaining('HuskyGate — Active: claude (unknown)'),
      expect.any(Object),
    );

    mocked.getActiveSessionRef.mockReturnValue(null);
  });

  it('lists and updates session MCP server filters', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);

    setActive({
      sessionKey: 'sess_1',
      tool: 'claude',
      mode: 'write',
      workdir: '/tmp/test-workdir/s1',
      toolState: {},
    });
    (ctx.sessionManager.getSessionSummary as MockFn).mockReturnValue({
      sessionId: 'abcd1234',
      sessionKey: 'sess_1',
    });
    (ctx.mcpServerStore.listByTool as MockFn).mockReturnValue([
      { id: 'srv-1', name: 'aws-api', tool: 'claude', transport: 'stdio' },
      { id: 'srv-2', name: 'github', tool: 'claude', transport: 'sse' },
    ]);
    (ctx.sessionMcpServerStore.listBySession as MockFn)
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        { sessionKey: 'sess_1', serverId: 'srv-1', enabled: true },
        { sessionKey: 'sess_1', serverId: 'srv-2', enabled: false },
      ]);

    await handleMcp(hctx as never, { kind: 'mcp' });
    expect(lastMessage()).toContain('*MCP Servers*');
    expect(lastMessage()).toContain('aws-api');

    await handleMcpToggle(hctx as never, {
      kind: 'mcp_toggle',
      enabled: false,
      serverName: 'github',
    });
    expect(ctx.sessionMcpServerStore.setEnabled).toHaveBeenCalledWith('sess_1', 'srv-2', false, [
      'srv-1',
      'srv-2',
    ]);
    expect(lastMessage()).toContain('disabled for this session');
  });

  it('resets MCP filters and reports readonly runtime note', async () => {
    const ctx = createCtx();
    const hctx = createHctx(ctx);

    setActive({
      sessionKey: 'sess_1',
      tool: 'gemini',
      mode: 'readonly',
      workdir: '/tmp/test-workdir/s1',
      toolState: {},
    });
    (ctx.sessionManager.getSessionSummary as MockFn).mockReturnValue({
      sessionId: 'abcd1234',
      sessionKey: 'sess_1',
    });
    (ctx.mcpServerStore.listByTool as MockFn).mockReturnValue([
      { id: 'srv-1', name: 'aws-api', tool: 'gemini', transport: 'sse' },
    ]);
    (ctx.sessionMcpServerStore.listBySession as MockFn).mockReturnValue([]);

    await handleMcpReset(hctx as never, { kind: 'mcp_reset' });
    expect(ctx.sessionMcpServerStore.reset).toHaveBeenCalledWith('sess_1');
    expect(lastMessage()).toContain('Readonly note');
  });
});
