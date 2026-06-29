import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ChatMessage, DashboardDb } from './db.js';

// Schema matching src/store/database.ts
const SCHEMA_SQL = `
CREATE TABLE sessions (
  session_key    TEXT PRIMARY KEY,
  tool           TEXT NOT NULL DEFAULT 'claude',
  mode           TEXT NOT NULL DEFAULT 'write',
  mode_expires_at TEXT,
  tool_state     TEXT NOT NULL DEFAULT '{}',
  workdir        TEXT NOT NULL,
  running_job_id TEXT,
  updated_at     TEXT NOT NULL
);

CREATE TABLE session_registry (
  session_key    TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL UNIQUE,
  thread_key     TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  started_at     TEXT NOT NULL
);

CREATE TABLE thread_contexts (
  thread_key      TEXT PRIMARY KEY,
  active_session_key TEXT,
  last_activity_at TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE audit (
  job_id         TEXT PRIMARY KEY,
  session_key    TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  tool           TEXT NOT NULL,
  mode           TEXT NOT NULL,
  workdir        TEXT NOT NULL,
  prompt_hash    TEXT,
  source         TEXT,
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  exit_code      INTEGER,
  error_kind     TEXT
);

CREATE TABLE IF NOT EXISTS dashboard_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key TEXT NOT NULL,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
`;

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir: string;
let dbPath: string;
let dashDb: DashboardDb;

/** Insert a message via raw SQL (since DashboardDb no longer has saveMessage) */
function insertMessage(
  rawDbPath: string,
  sessionKey: string,
  role: string,
  content: string,
): number {
  const db = new Database(rawDbPath);
  const result = db
    .prepare(
      'INSERT INTO dashboard_messages (session_key, role, content, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(sessionKey, role, content, new Date().toISOString());
  const id = Number(result.lastInsertRowid);
  db.close();
  return id;
}

function seedDb(targetPath: string): void {
  const db = new Database(targetPath);
  db.exec(SCHEMA_SQL);

  const now = '2026-01-15T10:00:00.000Z';
  const later = '2026-01-15T11:00:00.000Z';

  // Session 1: active (with tool_state)
  db.prepare(
    `INSERT INTO sessions (session_key, tool, mode, tool_state, workdir, running_job_id, updated_at)
     VALUES ('sk_aaa', 'claude', 'write', ?, '/work/aaa', NULL, ?)`,
  ).run(JSON.stringify({ session_id: 'uuid-123' }), later);
  db.prepare(
    `INSERT INTO session_registry (session_key, session_id, thread_key, user_id, started_at)
     VALUES ('sk_aaa', 'aabbccdd', 'C01:ts1', 'U01', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO thread_contexts (thread_key, active_session_key, last_activity_at, updated_at)
     VALUES ('C01:ts1', 'sk_aaa', ?, ?)`,
  ).run(later, later);

  // Session 2: inactive
  db.prepare(
    `INSERT INTO sessions (session_key, tool, mode, workdir, running_job_id, updated_at)
     VALUES ('sk_bbb', 'gemini', 'readonly', '/work/bbb', 'job-1', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO session_registry (session_key, session_id, thread_key, user_id, started_at)
     VALUES ('sk_bbb', '11223344', 'C02:ts2', 'U02', ?)`,
  ).run(now);

  // Audit rows for session 1
  db.prepare(
    `INSERT INTO audit (job_id, session_key, user_id, tool, mode, workdir, prompt_hash, source, started_at, ended_at, exit_code, error_kind)
     VALUES ('j1', 'sk_aaa', 'U01', 'claude', 'write', '/work/aaa', 'abc123', 'slack', ?, ?, 0, NULL)`,
  ).run(now, later);
  db.prepare(
    `INSERT INTO audit (job_id, session_key, user_id, tool, mode, workdir, prompt_hash, source, started_at, ended_at, exit_code, error_kind)
     VALUES ('j2', 'sk_aaa', 'U01', 'claude', 'write', '/work/aaa', 'def456', 'dashboard', ?, NULL, NULL, NULL)`,
  ).run(later);

  db.close();
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'dashdb-'));
  dbPath = join(tmpDir, 'test.db');
  seedDb(dbPath);
  dashDb = new DashboardDb(dbPath);
});

afterEach(() => {
  dashDb.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('DashboardDb', () => {
  describe('listSessions', () => {
    it('returns all sessions ordered by updated_at DESC', () => {
      const sessions = dashDb.listSessions();
      expect(sessions).toHaveLength(2);
      // sk_aaa has later updated_at, so it comes first
      expect(sessions[0]?.sessionId).toBe('aabbccdd');
      expect(sessions[1]?.sessionId).toBe('11223344');
    });

    it('maps fields correctly', () => {
      const sessions = dashDb.listSessions();
      const s = sessions[0] as (typeof sessions)[number];
      expect(s.sessionKey).toBe('sk_aaa');
      expect(s.sessionId).toBe('aabbccdd');
      expect(s.threadKey).toBe('C01:ts1');
      expect(s.userId).toBe('U01');
      expect(s.tool).toBe('claude');
      expect(s.mode).toBe('write');
      expect(s.workdir).toBe('/work/aaa');
      expect(s.runningJobId).toBeNull();
      expect(s.active).toBe(true);
    });

    it('marks inactive sessions correctly', () => {
      const sessions = dashDb.listSessions();
      const inactive = sessions.find(
        (s) => s.sessionId === '11223344',
      ) as (typeof sessions)[number];
      expect(inactive.active).toBe(false);
      expect(inactive.runningJobId).toBe('job-1');
    });

    it('returns empty array when no sessions exist', () => {
      // Clear via raw SQL
      const rawDb = new Database(dbPath);
      rawDb.exec('DELETE FROM sessions; DELETE FROM session_registry; DELETE FROM thread_contexts');
      rawDb.close();

      dashDb.close();
      dashDb = new DashboardDb(dbPath);
      expect(dashDb.listSessions()).toEqual([]);
    });
  });

  describe('getSessionAudit', () => {
    it('returns audit rows for existing session', () => {
      const rows = dashDb.getSessionAudit('aabbccdd');
      expect(rows).toHaveLength(2);
      // Ordered by started_at DESC
      expect(rows[0]?.jobId).toBe('j2');
      expect(rows[1]?.jobId).toBe('j1');
    });

    it('maps audit fields correctly', () => {
      const rows = dashDb.getSessionAudit('aabbccdd');
      const r = rows[1] as (typeof rows)[number]; // j1
      expect(r.sessionKey).toBe('sk_aaa');
      expect(r.userId).toBe('U01');
      expect(r.tool).toBe('claude');
      expect(r.mode).toBe('write');
      expect(r.workdir).toBe('/work/aaa');
      expect(r.promptHash).toBe('abc123');
      expect(r.exitCode).toBe(0);
      expect(r.errorKind).toBeNull();
      expect(r.endedAt).toBe('2026-01-15T11:00:00.000Z');
    });

    it('returns empty array for unknown session id', () => {
      expect(dashDb.getSessionAudit('99999999')).toEqual([]);
    });

    it('returns empty array for session with no audit rows', () => {
      expect(dashDb.getSessionAudit('11223344')).toEqual([]);
    });
  });

  describe('listSessionsByTool', () => {
    it('filters sessions by tool name', () => {
      const claude = dashDb.listSessionsByTool('claude');
      expect(claude).toHaveLength(1);
      expect(claude[0]?.sessionId).toBe('aabbccdd');
      expect(claude[0]?.tool).toBe('claude');

      const gemini = dashDb.listSessionsByTool('gemini');
      expect(gemini).toHaveLength(1);
      expect(gemini[0]?.sessionId).toBe('11223344');
      expect(gemini[0]?.tool).toBe('gemini');
    });

    it('returns empty array for tool with no sessions', () => {
      expect(dashDb.listSessionsByTool('codex')).toEqual([]);
    });
  });

  describe('getSessionToolState', () => {
    it('returns tool state for existing session', () => {
      const result = dashDb.getSessionToolState('aabbccdd');
      expect(result).not.toBeNull();
      expect(result?.sessionKey).toBe('sk_aaa');
      expect(result?.tool).toBe('claude');
      expect(result?.workdir).toBe('/work/aaa');
      expect(result?.toolState).toEqual({ session_id: 'uuid-123' });
    });

    it('returns null for unknown session', () => {
      expect(dashDb.getSessionToolState('99999999')).toBeNull();
    });

    it('returns empty object for corrupted JSON', () => {
      const rawDb = new Database(dbPath);
      rawDb
        .prepare("UPDATE sessions SET tool_state = 'not-json' WHERE session_key = 'sk_aaa'")
        .run();
      rawDb.close();

      dashDb.close();
      dashDb = new DashboardDb(dbPath);
      const result = dashDb.getSessionToolState('aabbccdd');
      expect(result).not.toBeNull();
      expect(result?.toolState).toEqual({});
    });
  });

  describe('getMessages', () => {
    it('retrieves messages in newest-first order', () => {
      insertMessage(dbPath, 'sk_aaa', 'user', 'Hello');
      insertMessage(dbPath, 'sk_aaa', 'assistant', 'Hi there!');

      // Re-open to pick up new data
      dashDb.close();
      dashDb = new DashboardDb(dbPath);

      const msgs = dashDb.getMessages('sk_aaa', 50);
      expect(msgs).toHaveLength(2);
      expect(msgs[0]?.role).toBe('assistant');
      expect(msgs[0]?.content).toBe('Hi there!');
      expect(msgs[1]?.role).toBe('user');
      expect(msgs[1]?.content).toBe('Hello');
    });

    it('respects limit', () => {
      insertMessage(dbPath, 'sk_aaa', 'user', 'msg1');
      insertMessage(dbPath, 'sk_aaa', 'user', 'msg2');
      insertMessage(dbPath, 'sk_aaa', 'user', 'msg3');

      dashDb.close();
      dashDb = new DashboardDb(dbPath);

      const msgs = dashDb.getMessages('sk_aaa', 2);
      expect(msgs).toHaveLength(2);
      expect(msgs[0]?.content).toBe('msg3');
      expect(msgs[1]?.content).toBe('msg2');
    });

    it('supports before filter for pagination', () => {
      const id1 = insertMessage(dbPath, 'sk_aaa', 'user', 'msg1');
      insertMessage(dbPath, 'sk_aaa', 'user', 'msg2');
      insertMessage(dbPath, 'sk_aaa', 'user', 'msg3');

      dashDb.close();
      dashDb = new DashboardDb(dbPath);

      const msgs = dashDb.getMessages('sk_aaa', 50, id1 + 1);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]?.content).toBe('msg1');
    });

    it('returns empty array for session with no messages', () => {
      expect(dashDb.getMessages('sk_aaa', 50)).toEqual([]);
    });

    it('isolates messages by session key', () => {
      insertMessage(dbPath, 'sk_aaa', 'user', 'from aaa');
      insertMessage(dbPath, 'sk_bbb', 'user', 'from bbb');

      dashDb.close();
      dashDb = new DashboardDb(dbPath);

      const aaa = dashDb.getMessages('sk_aaa', 50);
      expect(aaa).toHaveLength(1);
      expect(aaa[0]?.content).toBe('from aaa');

      const bbb = dashDb.getMessages('sk_bbb', 50);
      expect(bbb).toHaveLength(1);
      expect(bbb[0]?.content).toBe('from bbb');
    });

    it('has correct ChatMessage fields', () => {
      insertMessage(dbPath, 'sk_aaa', 'user', 'test');

      dashDb.close();
      dashDb = new DashboardDb(dbPath);

      const msgs = dashDb.getMessages('sk_aaa', 1);
      const m = msgs[0] as ChatMessage;
      expect(m.id).toBeTypeOf('number');
      expect(m.sessionKey).toBe('sk_aaa');
      expect(m.role).toBe('user');
      expect(m.content).toBe('test');
      expect(m.createdAt).toBeTruthy();
    });
  });

  describe('getSessionThreadInfo', () => {
    it('returns thread info for existing session', () => {
      const info = dashDb.getSessionThreadInfo('aabbccdd');
      expect(info).not.toBeNull();
      expect(info?.channelId).toBe('C01');
      expect(info?.threadTs).toBe('ts1');
      expect(info?.tool).toBe('claude');
      expect(info?.sessionKey).toBe('sk_aaa');
    });

    it('returns null for unknown session', () => {
      expect(dashDb.getSessionThreadInfo('99999999')).toBeNull();
    });

    it('parses thread_key with colon-separated format', () => {
      const info = dashDb.getSessionThreadInfo('11223344');
      expect(info).not.toBeNull();
      expect(info?.channelId).toBe('C02');
      expect(info?.threadTs).toBe('ts2');
      expect(info?.tool).toBe('gemini');
    });

    it('returns null when thread_key does not include a colon separator', () => {
      const rawDb = new Database(dbPath);
      rawDb
        .prepare(
          "UPDATE session_registry SET thread_key = 'malformed-thread-key' WHERE session_id = ?",
        )
        .run('aabbccdd');
      rawDb.close();

      dashDb.close();
      dashDb = new DashboardDb(dbPath);

      expect(dashDb.getSessionThreadInfo('aabbccdd')).toBeNull();
    });
  });

  describe('missing tables (Server API not started)', () => {
    let bareDb: DashboardDb;
    let bareTmpDir: string;

    beforeEach(() => {
      bareTmpDir = mkdtempSync(join(tmpdir(), 'dashdb-bare-'));
      const barePath = join(bareTmpDir, 'bare.db');
      // Create DB without Server API schema — only dev_aliases (auto-created by constructor)
      bareDb = new DashboardDb(barePath);
    });

    afterEach(() => {
      bareDb.close();
      rmSync(bareTmpDir, { recursive: true, force: true });
    });

    it('listSessions returns empty array', () => {
      expect(bareDb.listSessions()).toEqual([]);
    });

    it('listSessionsByTool returns empty array', () => {
      expect(bareDb.listSessionsByTool('claude')).toEqual([]);
    });

    it('getSessionToolState returns null', () => {
      expect(bareDb.getSessionToolState('aabbccdd')).toBeNull();
    });

    it('getSessionThreadInfo returns null', () => {
      expect(bareDb.getSessionThreadInfo('aabbccdd')).toBeNull();
    });

    it('getSessionAudit returns empty array', () => {
      expect(bareDb.getSessionAudit('aabbccdd')).toEqual([]);
    });

    it('getOverviewStats returns defaults', () => {
      const stats = bareDb.getOverviewStats();
      expect(stats.totalJobs).toBe(0);
      expect(stats.jobs24h).toBe(0);
      expect(stats.errors24h).toBe(0);
    });
  });

  describe('getNewMessages', () => {
    it('returns messages after given id in chronological order', () => {
      const id1 = insertMessage(dbPath, 'sk_aaa', 'user', 'msg1');
      insertMessage(dbPath, 'sk_aaa', 'assistant', 'reply1');
      insertMessage(dbPath, 'sk_aaa', 'user', 'msg2');

      dashDb.close();
      dashDb = new DashboardDb(dbPath);

      const msgs = dashDb.getNewMessages('sk_aaa', id1);
      expect(msgs).toHaveLength(2);
      expect(msgs[0]?.content).toBe('reply1');
      expect(msgs[1]?.content).toBe('msg2');
    });

    it('returns empty array when no new messages', () => {
      const id = insertMessage(dbPath, 'sk_aaa', 'user', 'msg1');

      dashDb.close();
      dashDb = new DashboardDb(dbPath);

      expect(dashDb.getNewMessages('sk_aaa', id)).toEqual([]);
    });

    it('returns all messages when afterId is 0', () => {
      insertMessage(dbPath, 'sk_aaa', 'user', 'msg1');
      insertMessage(dbPath, 'sk_aaa', 'assistant', 'msg2');

      dashDb.close();
      dashDb = new DashboardDb(dbPath);

      const msgs = dashDb.getNewMessages('sk_aaa', 0);
      expect(msgs).toHaveLength(2);
      expect(msgs[0]?.content).toBe('msg1');
      expect(msgs[1]?.content).toBe('msg2');
    });

    it('isolates by session key', () => {
      insertMessage(dbPath, 'sk_aaa', 'user', 'aaa-msg');
      insertMessage(dbPath, 'sk_bbb', 'user', 'bbb-msg');

      dashDb.close();
      dashDb = new DashboardDb(dbPath);

      const msgs = dashDb.getNewMessages('sk_aaa', 0);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]?.content).toBe('aaa-msg');
    });
  });
});
