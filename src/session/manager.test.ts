import crypto from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../config.js';
import { SessionManager } from './manager.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      session_key TEXT PRIMARY KEY,
      tool TEXT NOT NULL DEFAULT 'claude',
      mode TEXT NOT NULL DEFAULT 'write',
      mode_expires_at TEXT,
      tool_state TEXT NOT NULL DEFAULT '{}',
      workdir TEXT NOT NULL,
      running_job_id TEXT,
      updated_at TEXT NOT NULL,
      dev_alias TEXT
    );
    CREATE TABLE session_registry (
      session_key TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      thread_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      started_at TEXT NOT NULL
    );
    CREATE TABLE thread_contexts (
      thread_key TEXT PRIMARY KEY,
      active_session_key TEXT,
      last_activity_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE dashboard_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      job_id TEXT
    );
    CREATE TABLE session_mcp_servers (
      session_key TEXT NOT NULL,
      server_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (session_key, server_id)
    );
  `);
  return db;
}

function createConfig(): Config {
  return {
    slack: { botToken: 'xoxb-test', appToken: 'xapp-test' },
    allowedUserIds: ['U1'],
    allowedTeamId: null,
    defaultTool: 'claude',
    maxConcurrency: 2,
    maxRuntimeSec: 900,
    noOutputTimeoutSec: 90,
    claudeModel: null,
    codexModel: null,
    geminiModel: null,
    claudeMcpAuthServer: null,
    geminiMcpAuthServer: 'aws-api',
    codexMcpAuthServer: 'aws-api',
    workdirRoot: '/tmp/orchestrator-workdir',
    allowedWorkdirRoots: ['/tmp/orchestrator-workdir'],
    serverApiPort: 3738,
    serverApiSecret: 'test-api-secret',
    dashboardSecret: 'test-dashboard-secret',
    sessionIdleTimeoutSec: 86400,
    sessionCleanupEnabled: true,
    scheduleEnabled: false,
    schedulePollIntervalSec: 30,
    scheduleMaxConcurrent: 1,
    scheduleDefaultNotifyChannel: null,
    logLevel: 'info',
    toolAutoApproveMode: false,
    claudeDefaultMode: 'write' as const,
    codexDefaultSandboxMode: 'write' as const,
    geminiDefaultMode: 'write' as const,
    cloudflareTunnelEnabled: false,
    cloudflareTunnelToken: null,
    githubWebhookIpAllowlist: true,
    dashboardCookieSecure: true,
    logStacks: false,
    skillTemplateDir: null,
  };
}

describe('SessionManager', () => {
  it('creates and lists per-thread sessions with stable session ids', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());
    const threadKey = 'C1:123.456';

    const created = manager.createSessionForThread(threadKey, 'U1', 'gemini');
    const summary = manager.getSessionSummary(created.sessionKey);
    const listed = manager.listSessionsForThread(threadKey);

    expect(summary?.tool).toBe('gemini');
    expect(summary?.sessionId).toMatch(/^[a-f0-9]{8}$/);
    expect(summary?.workdir).toBe(path.join('/tmp/orchestrator-workdir', summary?.sessionId ?? ''));
    expect(summary?.active).toBe(true);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.sessionKey).toBe(created.sessionKey);
    expect(listed[0]?.active).toBe(true);

    db.close();
  });

  it('throws when a newly created session cannot be loaded', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());
    vi.spyOn(manager, 'get').mockReturnValueOnce(null);

    expect(() => manager.createSessionForThread('C1:load-failed', 'U1', 'claude')).toThrow(
      /Failed to load newly created session:/,
    );

    db.close();
  });

  it('finds latest session by tool and tracks active session per thread', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());
    const threadKey = 'C1:123.456';

    const first = manager.createSessionForThread(threadKey, 'U1', 'claude');
    manager.updateToolState(first.sessionKey, { session_id: 'abc' });
    const second = manager.createSessionForThread(threadKey, 'U1', 'claude');
    const firstSummary = manager.getSessionSummary(first.sessionKey);
    const secondSummary = manager.getSessionSummary(second.sessionKey);
    expect(firstSummary?.workdir).toBe(
      path.join('/tmp/orchestrator-workdir', firstSummary?.sessionId ?? ''),
    );
    expect(secondSummary?.workdir).toBe(
      path.join('/tmp/orchestrator-workdir', secondSummary?.sessionId ?? ''),
    );
    expect(secondSummary?.workdir).not.toBe(firstSummary?.workdir);

    const latestClaude = manager.findLatestSessionByTool(threadKey, 'claude');
    expect(latestClaude?.sessionKey).toBe(second.sessionKey);

    manager.setActiveSessionKey(threadKey, first.sessionKey);
    expect(manager.getActiveSessionKey(threadKey)).toBe(first.sessionKey);
    manager.clearActiveSession(threadKey);
    expect(manager.getActiveSessionKey(threadKey)).toBeNull();

    db.close();
  });

  it('findLatestSessionByTool returns null when no matching tool exists', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());

    manager.createSessionForThread('C1:only-claude', 'U1', 'claude');
    const latest = manager.findLatestSessionByTool('C1:only-claude', 'gemini');
    expect(latest).toBeNull();

    db.close();
  });

  it('uses readonly as initial mode for codex when configured', () => {
    const db = createDb();
    const config = createConfig();
    config.codexDefaultSandboxMode = 'readonly';
    const manager = new SessionManager(db, config);

    expect(manager.resolveInitialMode('codex')).toBe('readonly');
    expect(manager.resolveInitialMode('claude')).toBe('write');

    const created = manager.createSessionForThread('C1:readonly.mode', 'U1', 'codex');
    expect(created.mode).toBe('readonly');

    db.close();
  });

  it('resolveInitialMode respects claudeDefaultMode config', () => {
    const db = createDb();
    const config = createConfig();
    config.claudeDefaultMode = 'readonly';
    const manager = new SessionManager(db, config);

    expect(manager.resolveInitialMode('claude')).toBe('readonly');
    expect(manager.resolveInitialMode('codex')).toBe('write');
    expect(manager.resolveInitialMode('gemini')).toBe('write');

    const created = manager.createSessionForThread('C1:claude-readonly', 'U1', 'claude');
    expect(created.mode).toBe('readonly');

    db.close();
  });

  it('resolveInitialMode respects geminiDefaultMode config', () => {
    const db = createDb();
    const config = createConfig();
    config.geminiDefaultMode = 'readonly';
    const manager = new SessionManager(db, config);

    expect(manager.resolveInitialMode('gemini')).toBe('readonly');
    expect(manager.resolveInitialMode('claude')).toBe('write');
    expect(manager.resolveInitialMode('codex')).toBe('write');

    db.close();
  });

  it('createStandaloneSession respects modeOverride parameter', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());

    const readonlySess = manager.createStandaloneSession('claude', 'dashboard', 'readonly');
    expect(readonlySess.mode).toBe('readonly');

    const writeSess = manager.createStandaloneSession('claude', 'dashboard', 'write');
    expect(writeSess.mode).toBe('write');

    // Without modeOverride, falls back to config default (write)
    const defaultSess = manager.createStandaloneSession('claude');
    expect(defaultSess.mode).toBe('write');

    db.close();
  });

  it('deletes a session by session id', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());
    const created = manager.createSessionForThread('C1:123.456', 'U1', 'codex');
    const summary = manager.getSessionSummary(created.sessionKey);
    expect(summary?.sessionId).toBeTruthy();

    const byId = manager.getSessionSummaryById(summary?.sessionId ?? '');
    expect(byId?.sessionKey).toBe(created.sessionKey);

    const deleted = manager.deleteSessionById(summary?.sessionId ?? '');
    expect(deleted?.sessionKey).toBe(created.sessionKey);
    expect(manager.getSessionSummary(created.sessionKey)).toBeNull();
    expect(manager.getSessionSummaryById(summary?.sessionId ?? '')).toBeNull();

    db.close();
  });

  it('clears all sessions and thread contexts', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());
    manager.createSessionForThread('C1:123.456', 'U1', 'claude');
    manager.createSessionForThread('C2:123.456', 'U1', 'gemini');

    const cleared = manager.clearAllSessions();
    expect(cleared).toHaveLength(2);
    expect(manager.listAllSessions()).toHaveLength(0);
    expect(manager.getThreadContext('C1:123.456')).toBeNull();
    expect(manager.getThreadContext('C2:123.456')).toBeNull();

    db.close();
  });

  it('handles invalid JSON in tool_state gracefully', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());
    const now = new Date().toISOString();

    // Insert a row with invalid JSON in tool_state
    db.prepare(
      `INSERT INTO sessions (session_key, tool, mode, mode_expires_at, tool_state, workdir, running_job_id, updated_at)
       VALUES (?, 'claude', 'write', NULL, ?, '/tmp/workdir', NULL, ?)`,
    ).run('bad-json-key', '{invalid json', now);

    const session = manager.get('bad-json-key');
    expect(session).not.toBeNull();
    expect(session?.toolState).toEqual({});

    db.close();
  });

  it('handles non-object JSON in tool_state gracefully', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());
    const now = new Date().toISOString();

    // Insert with an array as tool_state
    db.prepare(
      `INSERT INTO sessions (session_key, tool, mode, mode_expires_at, tool_state, workdir, running_job_id, updated_at)
       VALUES (?, 'claude', 'write', NULL, ?, '/tmp/workdir', NULL, ?)`,
    ).run('array-state-key', '[1,2,3]', now);

    const session = manager.get('array-state-key');
    expect(session).not.toBeNull();
    expect(session?.toolState).toEqual({});

    db.close();
  });

  it('reset deletes session, registry, and clears active thread reference', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());
    const threadKey = 'C1:123.456';

    const session = manager.createSessionForThread(threadKey, 'U1', 'claude');
    expect(manager.getActiveSessionKey(threadKey)).toBe(session.sessionKey);

    manager.reset(session.sessionKey);

    expect(manager.get(session.sessionKey)).toBeNull();
    expect(manager.getSessionId(session.sessionKey)).toBeNull();
    expect(manager.getActiveSessionKey(threadKey)).toBeNull();

    db.close();
  });

  it('getSessionByIdForThread returns session for matching thread/id', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());
    const threadKey = 'C1:123.456';

    const session = manager.createSessionForThread(threadKey, 'U1', 'claude');
    const summary = manager.getSessionSummary(session.sessionKey);

    const found = manager.getSessionByIdForThread(threadKey, summary?.sessionId ?? '');
    expect(found?.sessionKey).toBe(session.sessionKey);

    // Wrong thread returns null
    const notFound = manager.getSessionByIdForThread('C2:other', summary?.sessionId ?? '');
    expect(notFound).toBeNull();

    db.close();
  });

  it('updateTool changes tool and resets tool_state', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());

    const session = manager.createSessionForThread('C1:123.456', 'U1', 'claude');
    manager.updateToolState(session.sessionKey, { session_id: 'abc' });
    manager.updateTool(session.sessionKey, 'gemini');

    const updated = manager.get(session.sessionKey);
    expect(updated?.tool).toBe('gemini');
    expect(updated?.toolState).toEqual({});

    db.close();
  });

  it('setRunningJob, updateMode, and updateWorkdir persist to database', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());

    const session = manager.createSessionForThread('C1:123.456', 'U1', 'claude');

    manager.setRunningJob(session.sessionKey, 'job-123');
    let s = manager.get(session.sessionKey);
    expect(s?.runningJobId).toBe('job-123');

    manager.setRunningJob(session.sessionKey, null);
    s = manager.get(session.sessionKey);
    expect(s?.runningJobId).toBeNull();

    manager.updateMode(session.sessionKey, 'readonly', '2099-01-01T00:00:00.000Z');
    s = manager.get(session.sessionKey);
    expect(s?.mode).toBe('readonly');
    expect(s?.modeExpiresAt).toBe('2099-01-01T00:00:00.000Z');

    manager.updateWorkdir(session.sessionKey, '/new/workdir');
    s = manager.get(session.sessionKey);
    expect(s?.workdir).toBe('/new/workdir');

    db.close();
  });

  it('mergeToolState updates selected keys without clobbering unrelated state', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());
    const session = manager.createSessionForThread('C1:merge', 'U1', 'claude');

    manager.updateToolState(session.sessionKey, {
      session_id: 'sess-123',
      claude_mcp_auth_bypass_server: 'aws-api',
      keep: 'value',
    });
    manager.mergeToolState(session.sessionKey, {
      claude_mcp_auth_verified_server: 'aws-api',
      claude_mcp_auth_bypass_server: undefined,
    });

    expect(manager.get(session.sessionKey)?.toolState).toEqual({
      session_id: 'sess-123',
      claude_mcp_auth_verified_server: 'aws-api',
      keep: 'value',
    });

    db.close();
  });

  it('touchThreadActivity updates last_activity_at and refreshes the active session timestamp', () => {
    vi.useFakeTimers();
    try {
      const db = createDb();
      const manager = new SessionManager(db, createConfig());
      const threadKey = 'C1:123.456';
      vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
      const session = manager.createSessionForThread(threadKey, 'U1', 'claude');
      const before = manager.get(session.sessionKey)?.updatedAt;

      vi.setSystemTime(new Date('2026-03-01T00:05:00.000Z'));
      manager.touchThreadActivity(threadKey);
      const ctx = manager.getThreadContext(threadKey);
      const after = manager.get(session.sessionKey)?.updatedAt;
      expect(ctx).not.toBeNull();
      expect(ctx?.last_activity_at).toBeTruthy();
      expect(after).toBeTruthy();
      expect(after).not.toBe(before);

      db.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('getActiveSession returns the active session object', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());
    const threadKey = 'C1:123.456';

    const session = manager.createSessionForThread(threadKey, 'U1', 'claude');
    const active = manager.getActiveSession(threadKey);
    expect(active?.sessionKey).toBe(session.sessionKey);

    manager.clearActiveSession(threadKey);
    expect(manager.getActiveSession(threadKey)).toBeNull();

    db.close();
  });

  it('getActiveSessionSummary returns summary of active session', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());
    const threadKey = 'C1:123.456';

    const session = manager.createSessionForThread(threadKey, 'U1', 'claude');
    const summary = manager.getActiveSessionSummary(threadKey);
    expect(summary?.sessionKey).toBe(session.sessionKey);
    expect(summary?.active).toBe(true);

    manager.clearActiveSession(threadKey);
    expect(manager.getActiveSessionSummary(threadKey)).toBeNull();

    db.close();
  });

  it('deleteSessionById returns null for non-existent session', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());

    expect(manager.deleteSessionById('nonexistent')).toBeNull();

    db.close();
  });

  it('listAllSessions returns all sessions across threads', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());

    manager.createSessionForThread('C1:t1', 'U1', 'claude');
    manager.createSessionForThread('C1:t2', 'U2', 'gemini');

    const all = manager.listAllSessions();
    expect(all).toHaveLength(2);

    db.close();
  });

  it('createDevSession creates session with dev_alias and alias workdir', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());
    const threadKey = 'C1:123.456';

    const alias = {
      name: 'my-project',
      path: '/Users/test/project',
      tool: 'claude' as const,
      instructionContent: null,
      createdAt: new Date().toISOString(),
    };

    const session = manager.createDevSession(threadKey, 'U1', alias);
    expect(session.devAlias).toBe('my-project');
    expect(session.workdir).toBe('/Users/test/project');
    expect(session.tool).toBe('claude');
    expect(session.mode).toBe('write');

    const active = manager.getActiveSessionKey(threadKey);
    expect(active).toBe(session.sessionKey);

    db.close();
  });

  it('findDevSession finds session by dev alias name', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());

    const alias = {
      name: 'test-alias',
      path: '/Users/test/project',
      tool: 'gemini' as const,
      instructionContent: null,
      createdAt: new Date().toISOString(),
    };

    const created = manager.createDevSession('C1:123.456', 'U1', alias);
    const found = manager.findDevSession('test-alias');
    expect(found).not.toBeNull();
    expect(found?.sessionKey).toBe(created.sessionKey);
    expect(found?.devAlias).toBe('test-alias');

    db.close();
  });

  it('findDevSession returns null when no dev session exists', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());

    expect(manager.findDevSession('nonexistent')).toBeNull();

    db.close();
  });

  it('falls back to safe defaults when invalid tool or mode are stored', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO sessions (session_key, tool, mode, mode_expires_at, tool_state, workdir, running_job_id, updated_at)
       VALUES (?, ?, ?, NULL, '{}', ?, NULL, ?)`,
    ).run('bad-tool-mode', 'not-a-tool', 'not-a-mode', '/tmp/workdir', now);
    db.prepare(
      `INSERT INTO session_registry (session_key, session_id, thread_key, user_id, started_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('bad-tool-mode', 'abc12345', 'C1:bad.thread', 'U1', now);
    db.prepare(
      `INSERT INTO thread_contexts (thread_key, active_session_key, last_activity_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run('C1:bad.thread', 'bad-tool-mode', now, now);

    const session = manager.get('bad-tool-mode');
    expect(session?.tool).toBe('claude');
    expect(session?.mode).toBe('write');

    const summary = manager.getSessionSummary('bad-tool-mode');
    expect(summary?.tool).toBe('claude');
    expect(summary?.mode).toBe('write');

    db.close();
  });

  it('throws when unique session id cannot be allocated', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO sessions (session_key, tool, mode, mode_expires_at, tool_state, workdir, running_job_id, updated_at)
       VALUES (?, 'claude', 'write', NULL, '{}', ?, NULL, ?)`,
    ).run('existing', '/tmp/workdir', now);
    db.prepare(
      `INSERT INTO session_registry (session_key, session_id, thread_key, user_id, started_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('existing', 'deadbeef', 'C1:existing', 'U1', now);

    const uuidSpy = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue('deadbeef-dead-beef-dead-beefdeadbeef');
    expect(() => manager.createSessionForThread('C1:new', 'U1', 'claude')).toThrow(
      'Failed to allocate unique session id',
    );
    uuidSpy.mockRestore();

    db.close();
  });

  it('throws when unique session key cannot be allocated', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO sessions (session_key, tool, mode, mode_expires_at, tool_state, workdir, running_job_id, updated_at)
       VALUES (?, 'claude', 'write', NULL, '{}', ?, NULL, ?)`,
    ).run('sess_deadbeefdead', '/tmp/workdir', now);

    const uuidSpy = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue('deadbeef-dead-beef-dead-beefdeadbeef');
    expect(() => manager.createSessionForThread('C1:new', 'U1', 'claude')).toThrow(
      'Failed to allocate unique session key',
    );
    uuidSpy.mockRestore();

    db.close();
  });

  it('creates standalone dashboard sessions and marks thread context active', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());

    const summary = manager.createStandaloneSession('codex', 'U-dashboard');
    expect(summary.sessionKey).toMatch(/^sess_[a-f0-9]{12}$/);
    expect(summary.sessionId).toMatch(/^[a-f0-9]{8}$/);
    expect(summary.threadKey).toBe(`dashboard_${summary.sessionId}`);
    expect(summary.userId).toBe('U-dashboard');
    expect(summary.tool).toBe('codex');
    expect(summary.active).toBe(true);
    expect(summary.workdir).toBe(path.join('/tmp/orchestrator-workdir', summary.sessionId));

    const active = manager.getActiveSessionKey(summary.threadKey);
    expect(active).toBe(summary.sessionKey);

    const fetched = manager.getSessionSummary(summary.sessionKey);
    expect(fetched?.threadKey).toBe(summary.threadKey);
    expect(fetched?.active).toBe(true);

    db.close();
  });

  it('deleteSessionByIdWithCleanup handles found and missing rows', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());

    const session = manager.createSessionForThread('C1:cleanup.id', 'U1', 'claude');
    const sessionId = manager.getSessionId(session.sessionKey);
    expect(sessionId).toBeTruthy();

    const missing = manager.deleteSessionByIdWithCleanup('missing');
    expect(missing).toBeNull();

    const result = manager.deleteSessionByIdWithCleanup(sessionId ?? '');
    expect(result).toEqual({
      sessionKey: session.sessionKey,
      threadKey: 'C1:cleanup.id',
      workdir: session.workdir,
    });
    expect(manager.get(session.sessionKey)).toBeNull();

    db.close();
  });

  it('deleteSessionByKeyWithCleanup handles found and missing rows', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());

    const session = manager.createSessionForThread('C1:cleanup.key', 'U1', 'gemini');

    const missing = manager.deleteSessionByKeyWithCleanup('sess_missing');
    expect(missing).toBeNull();

    const result = manager.deleteSessionByKeyWithCleanup(session.sessionKey);
    expect(result).toEqual({ threadKey: 'C1:cleanup.key' });
    expect(manager.get(session.sessionKey)).toBeNull();

    db.close();
  });

  it('clearAllSessionsWithCleanup returns cleanup rows and clears persisted state', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());

    const a = manager.createSessionForThread('C1:cleanup.all', 'U1', 'claude');
    const b = manager.createSessionForThread('C2:cleanup.all', 'U2', 'codex');

    const rows = manager.clearAllSessionsWithCleanup();
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { sessionKey: a.sessionKey, threadKey: 'C1:cleanup.all', workdir: a.workdir },
        { sessionKey: b.sessionKey, threadKey: 'C2:cleanup.all', workdir: b.workdir },
      ]),
    );
    expect(manager.listAllSessions()).toEqual([]);
    expect(manager.getThreadContext('C1:cleanup.all')).toBeNull();
    expect(manager.getThreadContext('C2:cleanup.all')).toBeNull();

    db.close();
  });

  it('deleteSessionByIdWithCleanup normalizes nullable workdir values to null', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());
    const managerAccess = manager as unknown as {
      _deleteSessionByKey: (sessionKey: string) => void;
      stmts: {
        deleteCleanupById: {
          get: (id: string) =>
            | {
                session_key: string;
                thread_key: string | null;
                workdir: string | null;
              }
            | undefined;
        };
      };
    };

    const deleteSpy = vi.fn();
    managerAccess._deleteSessionByKey = deleteSpy;
    managerAccess.stmts.deleteCleanupById = {
      get: vi.fn().mockReturnValue({
        session_key: 'sess_nullable',
        thread_key: 'C1:nullable.workdir',
        workdir: null,
      }),
    };

    const result = manager.deleteSessionByIdWithCleanup('sid_nullable');
    expect(result).toEqual({
      sessionKey: 'sess_nullable',
      threadKey: 'C1:nullable.workdir',
      workdir: null,
    });
    expect(deleteSpy).toHaveBeenCalledWith('sess_nullable');

    db.close();
  });

  it('clearAllSessionsWithCleanup normalizes nullable workdir rows to null', () => {
    const db = createDb();
    const manager = new SessionManager(db, createConfig());
    const managerAccess = manager as unknown as {
      _clearAllSessions: () => void;
      stmts: {
        allCleanupRows: {
          all: () =>
            | Array<{
                session_key: string;
                thread_key: string | null;
                workdir: string | null;
              }>
            | undefined;
        };
      };
    };

    const clearSpy = vi.fn();
    managerAccess._clearAllSessions = clearSpy;
    managerAccess.stmts.allCleanupRows = {
      all: vi.fn().mockReturnValue([
        {
          session_key: 'sess_nullable',
          thread_key: null,
          workdir: null,
        },
      ]),
    };

    const rows = manager.clearAllSessionsWithCleanup();
    expect(rows).toEqual([{ sessionKey: 'sess_nullable', threadKey: null, workdir: null }]);
    expect(clearSpy).toHaveBeenCalledOnce();

    db.close();
  });
});
