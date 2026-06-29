/** Coverage tests for session/manager: uncovered lines 454-478, 507-510, 545-549, 589-600 */
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

describe('SessionManager coverage', () => {
  describe('deleteSessionsByIds (lines 454-468)', () => {
    it('deletes multiple sessions atomically', () => {
      const db = createDb();
      const sm = new SessionManager(db, createConfig());
      const s1 = sm.createSessionForThread('T1', 'U1', 'claude');
      const s2 = sm.createSessionForThread('T2', 'U1', 'codex');
      const id1 = sm.getSessionId(s1.sessionKey);
      const id2 = sm.getSessionId(s2.sessionKey);
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();

      const results = sm.deleteSessionsByIds([id1 ?? '', id2 ?? '']);
      expect(results).toHaveLength(2);
      expect(sm.get(s1.sessionKey)).toBeNull();
      expect(sm.get(s2.sessionKey)).toBeNull();
      db.close();
    });

    it('skips non-existent session IDs', () => {
      const db = createDb();
      const sm = new SessionManager(db, createConfig());
      const results = sm.deleteSessionsByIds(['nonexistent']);
      expect(results).toHaveLength(0);
      db.close();
    });
  });

  describe('clearAllSessions (lines 471-475)', () => {
    it('clears all sessions and returns deletion summaries', () => {
      const db = createDb();
      const sm = new SessionManager(db, createConfig());
      sm.createSessionForThread('T1', 'U1', 'claude');
      sm.createSessionForThread('T2', 'U1', 'gemini');

      const results = sm.clearAllSessions();
      expect(results).toHaveLength(2);
      expect(sm.listAllSessions()).toHaveLength(0);
      db.close();
    });
  });

  describe('listAllSessions (lines 507-510)', () => {
    it('returns all sessions as summaries', () => {
      const db = createDb();
      const sm = new SessionManager(db, createConfig());
      sm.createSessionForThread('T1', 'U1', 'claude');
      sm.createSessionForThread('T1', 'U2', 'codex');

      const sessions = sm.listAllSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions[0]).toHaveProperty('sessionId');
      expect(sessions[0]).toHaveProperty('threadKey');
      db.close();
    });
  });

  describe('findLatestSessionByToolOwned (lines 545-549)', () => {
    it('finds latest session by tool and user', () => {
      const db = createDb();
      const sm = new SessionManager(db, createConfig());
      sm.createSessionForThread('T1', 'U1', 'claude');
      const s2 = sm.createSessionForThread('T1', 'U1', 'claude');

      const found = sm.findLatestSessionByToolOwned('T1', 'U1', 'claude');
      expect(found).not.toBeNull();
      expect(found?.sessionKey).toBe(s2.sessionKey);
      db.close();
    });

    it('returns null when no session matches', () => {
      const db = createDb();
      const sm = new SessionManager(db, createConfig());
      const found = sm.findLatestSessionByToolOwned('T1', 'U1', 'gemini');
      expect(found).toBeNull();
      db.close();
    });
  });

  describe('getActiveSessionForThread (lines 589-600)', () => {
    it('returns session with userId when active session exists', () => {
      const db = createDb();
      const sm = new SessionManager(db, createConfig());
      const session = sm.createSessionForThread('T1', 'U1', 'claude');

      const result = sm.getActiveSessionForThread('T1');
      expect(result).not.toBeNull();
      expect(result?.sessionKey).toBe(session.sessionKey);
      expect(result?.userId).toBe('U1');
      expect(result?.session.tool).toBe('claude');
      db.close();
    });

    it('returns null when no active session', () => {
      const db = createDb();
      const sm = new SessionManager(db, createConfig());
      const result = sm.getActiveSessionForThread('T-nonexistent');
      expect(result).toBeNull();
      db.close();
    });
  });
});
