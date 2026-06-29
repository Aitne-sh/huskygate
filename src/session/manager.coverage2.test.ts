/** Coverage2 tests for session/manager: uncovered lines 425, 503-505, 518-522, 525-526,
 * 529-533, 536-537 (resolveInitialMode, listSessionsForThreadOwned, getSessionByIdForThread,
 * getSessionByIdForThreadOwned, getSessionSummaryByIdForThreadOwned) */
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../config.js';
import { SessionManager } from './manager.js';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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

function createConfig(overrides: Partial<Config> = {}): Config {
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
    geminiMcpAuthServer: null,
    codexMcpAuthServer: null,
    workdirRoot: '/tmp/test-workdir',
    allowedWorkdirRoots: ['/tmp/test-workdir'],
    serverApiPort: 3738,
    serverApiHost: '127.0.0.1',
    serverApiSecret: 'test-api-secret',
    dashboardSecret: 'test-dashboard-secret',
    sessionCleanupEnabled: true,
    scheduleEnabled: false,
    schedulePollIntervalSec: 30,
    scheduleMaxConcurrent: 1,
    scheduleDefaultNotifyChannel: null,
    logLevel: 'info',
    toolAutoApproveMode: false,
    claudeDefaultMode: 'write',
    codexDefaultSandboxMode: 'write',
    geminiDefaultMode: 'write',
    webhookPublicBaseUrl: null,
    cloudflareTunnelEnabled: false,
    cloudflareTunnelToken: null,
    githubWebhookIpAllowlist: true,
    dashboardCookieSecure: true,
    logStacks: false,
    skillTemplateDir: null,
    ...overrides,
  } as Config;
}

describe('SessionManager coverage2', () => {
  describe('resolveInitialMode — default case (line 425)', () => {
    it('returns "write" for unknown tool type', () => {
      const db = createDb();
      const sm = new SessionManager(db, createConfig());
      // Force a call with an unexpected tool string
      const mode = sm.resolveInitialMode('unknown-tool' as any);
      expect(mode).toBe('write');
      db.close();
    });
  });

  describe('listSessionsForThreadOwned (lines 503-505)', () => {
    it('returns only sessions owned by specified user', () => {
      const db = createDb();
      const sm = new SessionManager(db, createConfig());
      sm.createSessionForThread('T1', 'U1', 'claude');
      sm.createSessionForThread('T1', 'U2', 'gemini');

      const u1Sessions = sm.listSessionsForThreadOwned('T1', 'U1');
      expect(u1Sessions).toHaveLength(1);
      expect(u1Sessions[0]?.userId).toBe('U1');

      const u2Sessions = sm.listSessionsForThreadOwned('T1', 'U2');
      expect(u2Sessions).toHaveLength(1);
      expect(u2Sessions[0]?.userId).toBe('U2');
      db.close();
    });

    it('returns empty array when no sessions match', () => {
      const db = createDb();
      const sm = new SessionManager(db, createConfig());
      const sessions = sm.listSessionsForThreadOwned('T-none', 'U-none');
      expect(sessions).toEqual([]);
      db.close();
    });
  });

  describe('getSessionByIdForThread (lines 518-522)', () => {
    it('returns session when found by ID within thread', () => {
      const db = createDb();
      const sm = new SessionManager(db, createConfig());
      const session = sm.createSessionForThread('T1', 'U1', 'claude');
      const sessionId = sm.getSessionId(session.sessionKey)!;

      const found = sm.getSessionByIdForThread('T1', sessionId);
      expect(found).not.toBeNull();
      expect(found?.sessionKey).toBe(session.sessionKey);
      db.close();
    });

    it('returns null when session ID is not in given thread', () => {
      const db = createDb();
      const sm = new SessionManager(db, createConfig());
      const session = sm.createSessionForThread('T1', 'U1', 'claude');
      const sessionId = sm.getSessionId(session.sessionKey)!;

      const found = sm.getSessionByIdForThread('T-wrong', sessionId);
      expect(found).toBeNull();
      db.close();
    });
  });

  describe('getSessionByIdForThreadOwned (lines 525-526)', () => {
    it('returns session when found by ID, thread, and user', () => {
      const db = createDb();
      const sm = new SessionManager(db, createConfig());
      const session = sm.createSessionForThread('T1', 'U1', 'claude');
      const sessionId = sm.getSessionId(session.sessionKey)!;

      const found = sm.getSessionByIdForThreadOwned('T1', 'U1', sessionId);
      expect(found).not.toBeNull();
      expect(found?.sessionKey).toBe(session.sessionKey);
      db.close();
    });

    it('returns null when user does not own the session', () => {
      const db = createDb();
      const sm = new SessionManager(db, createConfig());
      const session = sm.createSessionForThread('T1', 'U1', 'claude');
      const sessionId = sm.getSessionId(session.sessionKey)!;

      const found = sm.getSessionByIdForThreadOwned('T1', 'U-other', sessionId);
      expect(found).toBeNull();
      db.close();
    });
  });

  describe('getSessionSummaryByIdForThreadOwned (lines 529-537)', () => {
    it('returns summary when found', () => {
      const db = createDb();
      const sm = new SessionManager(db, createConfig());
      const session = sm.createSessionForThread('T1', 'U1', 'claude');
      const sessionId = sm.getSessionId(session.sessionKey)!;

      const summary = sm.getSessionSummaryByIdForThreadOwned('T1', 'U1', sessionId);
      expect(summary).not.toBeNull();
      expect(summary?.sessionId).toBe(sessionId);
      db.close();
    });

    it('returns null when no matching summary exists', () => {
      const db = createDb();
      const sm = new SessionManager(db, createConfig());
      const summary = sm.getSessionSummaryByIdForThreadOwned('T-none', 'U-none', 'sid-none');
      expect(summary).toBeNull();
      db.close();
    });
  });
});
