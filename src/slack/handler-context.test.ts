import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingStateForSession,
  formatSessionClearAllSummary,
  formatSessionClearedMessage,
  formatSessionWorkdirRemovalLine,
  getActiveSessionRef,
  removeSessionWorkdir,
  stopSessionExecution,
} from './handler-context.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-hctx-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore test cleanup error
    }
  }
});

describe('handler-context helpers', () => {
  it('getActiveSessionRef resolves active session via single query and clears stale key', () => {
    const session = {
      sessionKey: 'sess-1',
      tool: 'claude',
      mode: 'readonly',
      modeExpiresAt: null,
      toolState: {},
      workdir: '/tmp/w',
      runningJobId: null,
      updatedAt: new Date().toISOString(),
    };
    const sessionManager = {
      getActiveSessionForThread: vi.fn().mockReturnValue({
        sessionKey: 'sess-1',
        session,
        userId: 'U1',
      }),
      getActiveSessionKey: vi.fn().mockReturnValue('sess-1'),
      clearActiveSession: vi.fn(),
    };
    const ctx = { sessionManager };

    expect(getActiveSessionRef(ctx as never, 'thread', 'U1')).toEqual({
      sessionKey: 'sess-1',
      session,
    });

    // When getActiveSessionForThread returns null (session deleted), clears stale pointer
    sessionManager.getActiveSessionForThread.mockReturnValueOnce(null);
    expect(getActiveSessionRef(ctx as never, 'thread', 'U1')).toBeNull();
    expect(sessionManager.clearActiveSession).toHaveBeenCalledWith('thread');
  });

  it('getActiveSessionRef hides sessions owned by another user without clearing active state', () => {
    const session = {
      sessionKey: 'sess-1',
      tool: 'claude',
      mode: 'readonly',
      modeExpiresAt: null,
      toolState: {},
      workdir: '/tmp/w',
      runningJobId: null,
      updatedAt: new Date().toISOString(),
    };
    const sessionManager = {
      getActiveSessionForThread: vi.fn().mockReturnValue({
        sessionKey: 'sess-1',
        session,
        userId: 'U2',
      }),
      getActiveSessionKey: vi.fn(),
      clearActiveSession: vi.fn(),
    };

    expect(getActiveSessionRef({ sessionManager } as never, 'thread', 'U1')).toBeNull();
    expect(sessionManager.clearActiveSession).not.toHaveBeenCalled();
  });

  it('stopSessionExecution cancels queue and kills active runner if running', () => {
    const runner = { isRunning: vi.fn().mockReturnValue(true), kill: vi.fn() };
    const activeRunners = new Map([['sess-1', { runner, job: { id: 'job-1' } }]]);

    const ctx = {
      activeRunners,
      jobQueue: { cancelSession: vi.fn() },
      sessionManager: { setRunningJob: vi.fn() },
    };

    stopSessionExecution(ctx as never, 'sess-1', 'user_exit');

    expect(runner.kill).toHaveBeenCalledWith('user_exit');
    expect(ctx.jobQueue.cancelSession).toHaveBeenCalledWith('sess-1');
    expect(ctx.sessionManager.setRunningJob).toHaveBeenCalledWith('sess-1', null);
    expect(activeRunners.has('sess-1')).toBe(false);
  });

  it('clearPendingStateForSession removes matching records from all pending maps', () => {
    const pendingConfirmations = new Map([
      ['t1', { sessionKey: 'sess-1' }],
      ['t2', { sessionKey: 'sess-2' }],
    ]);
    const pendingToolApprovals = new Map([
      ['t3', { sessionKey: 'sess-1' }],
      ['t4', { sessionKey: 'sess-2' }],
    ]);
    const pendingMcpAuthBypassApprovals = new Map([
      ['t5', { sessionKey: 'sess-1' }],
      ['t6', { sessionKey: 'sess-2' }],
    ]);

    const ctx = {
      pendingConfirmations,
      pendingToolApprovals,
      pendingMcpAuthBypassApprovals,
    };

    clearPendingStateForSession(ctx as never, 'sess-1');

    expect([...pendingConfirmations.keys()]).toEqual(['t2']);
    expect([...pendingToolApprovals.keys()]).toEqual(['t4']);
    expect([...pendingMcpAuthBypassApprovals.keys()]).toEqual(['t6']);
  });

  it('removeSessionWorkdir validates path boundaries and removes managed directory', () => {
    const root = makeTempDir();
    const target = path.join(root, 'sess-a');
    fs.mkdirSync(target, { recursive: true });

    const ctx = {
      config: { workdirRoot: root },
    };

    expect(removeSessionWorkdir(ctx as never, '/tmp/outside')).toEqual({
      removed: false,
      skippedReason: 'outside WORKDIR_ROOT',
    });
    expect(removeSessionWorkdir(ctx as never, root)).toEqual({
      removed: false,
      skippedReason: 'target is WORKDIR_ROOT',
    });

    expect(removeSessionWorkdir(ctx as never, target)).toEqual({
      removed: true,
      skippedReason: null,
    });
    expect(fs.existsSync(target)).toBe(false);

    expect(removeSessionWorkdir(ctx as never, target)).toEqual({
      removed: false,
      skippedReason: 'outside WORKDIR_ROOT',
    });
  });

  it('formatSessionWorkdirRemovalLine and formatSessionClearedMessage preserve output format', () => {
    expect(
      formatSessionWorkdirRemovalLine('/tmp/work', {
        removed: false,
        skippedReason: 'outside WORKDIR_ROOT',
      }),
    ).toBe('Workdir removal skipped (outside WORKDIR_ROOT): `/tmp/work`');
    expect(
      formatSessionWorkdirRemovalLine('/tmp/work', {
        removed: true,
        skippedReason: null,
      }),
    ).toBe('Workdir removed: `/tmp/work`');
    expect(
      formatSessionWorkdirRemovalLine('/tmp/work', {
        removed: false,
        skippedReason: null,
      }),
    ).toBe('Workdir already absent: `/tmp/work`');

    expect(
      formatSessionClearedMessage('abc123', 'claude', '/tmp/work', {
        removed: true,
        skippedReason: null,
      }),
    ).toBe('Session cleared: id=`abc123` app=`claude`\nWorkdir removed: `/tmp/work`');
  });

  it('formatSessionClearAllSummary reports removed, skipped, and archived workdirs', () => {
    const root = makeTempDir();
    const w1 = path.join(root, 'sess-1');
    const w2 = path.join(root, 'sess-2');
    fs.mkdirSync(w1, { recursive: true });
    fs.mkdirSync(w2, { recursive: true });
    const workdirManager = {
      cleanupUnusedSessionWorkdirs: vi.fn().mockReturnValue(1),
      archiveLegacyDefaultWorkdirIfUnused: vi
        .fn()
        .mockReturnValue(path.join(root, '_archive/default')),
    };
    const ctx = {
      config: { workdirRoot: root },
      workdirManager,
    };

    const summary = formatSessionClearAllSummary(ctx as never, [
      { workdir: w1 },
      { workdir: '/tmp/outside' },
      { workdir: w2 },
    ]);

    expect(summary).toContain('Cleared all sessions: 3');
    expect(summary).toContain('Removed workdirs: 3');
    expect(summary).toContain('Archived legacy default workdir');
    expect(summary).toContain('Skipped workdir removals');
    expect(workdirManager.cleanupUnusedSessionWorkdirs).toHaveBeenCalledWith([]);
    expect(workdirManager.archiveLegacyDefaultWorkdirIfUnused).toHaveBeenCalledWith([]);
  });
});
