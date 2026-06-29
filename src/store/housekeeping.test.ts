import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../utils/logger.js';
import {
  LOG_MAX_BYTES,
  RETENTION_RULES,
  assertSafePath,
  cleanupJobLogFiles,
  cleanupOrphanRunWorkdirs,
  cleanupOrphanedJobLogs,
  pruneBackups,
  purgeDeletedOrchestrators,
  retentionCleanup,
  rotateLogs,
  runHousekeeping,
  vacuumBackup,
} from './housekeeping.js';

// ── Schema helpers ──────────────────────────────────────────────

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE audit (
      job_id      TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      tool        TEXT NOT NULL,
      mode        TEXT NOT NULL,
      workdir     TEXT NOT NULL,
      prompt_hash TEXT,
      source      TEXT,
      started_at  TEXT NOT NULL,
      ended_at    TEXT,
      exit_code   INTEGER,
      error_kind  TEXT
    );
    CREATE INDEX idx_audit_started ON audit(started_at);

    CREATE TABLE dashboard_messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      job_id      TEXT
    );
    CREATE INDEX idx_dash_msg_created ON dashboard_messages(created_at);

    CREATE TABLE mode_changes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      from_mode   TEXT NOT NULL,
      to_mode     TEXT NOT NULL,
      changed_at  TEXT NOT NULL,
      expires_at  TEXT
    );
    CREATE INDEX idx_mode_changes_changed ON mode_changes(changed_at);

    CREATE TABLE scheduled_task_runs (
      id              TEXT PRIMARY KEY,
      task_id         TEXT NOT NULL,
      session_key     TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      exit_code       INTEGER,
      output_summary  TEXT,
      error_message   TEXT,
      started_at      TEXT NOT NULL,
      ended_at        TEXT,
      retry_count     INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_sched_runs_started ON scheduled_task_runs(started_at);

    CREATE TABLE ondemand_task_runs (
      id              TEXT PRIMARY KEY,
      task_id         TEXT NOT NULL,
      session_key     TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      exit_code       INTEGER,
      output_summary  TEXT,
      error_message   TEXT,
      started_at      TEXT NOT NULL,
      ended_at        TEXT,
      retry_count     INTEGER NOT NULL DEFAULT 0,
      source          TEXT NOT NULL DEFAULT 'dashboard'
    );
    CREATE INDEX idx_ondemand_runs_started ON ondemand_task_runs(started_at);

    CREATE TABLE triggered_task_runs (
      id                   TEXT PRIMARY KEY,
      triggered_task_id    TEXT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'pending',
      triggered_by         TEXT NOT NULL DEFAULT 'webhook',
      trigger_context_json TEXT,
      session_key          TEXT,
      job_id               TEXT,
      exit_code            INTEGER,
      output_summary       TEXT,
      error_message        TEXT,
      retry_count          INTEGER NOT NULL DEFAULT 0,
      started_at           TEXT NOT NULL,
      ended_at             TEXT
    );
    CREATE INDEX idx_triggered_task_runs_started ON triggered_task_runs(started_at);

    CREATE TABLE orchestration_runs (
      id                  TEXT PRIMARY KEY,
      orchestrator_id     TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'pending',
      triggered_by        TEXT NOT NULL DEFAULT 'dashboard',
      triggered_user_id   TEXT,
      started_at          TEXT,
      ended_at            TEXT,
      error_message       TEXT,
      rerun_from_run_id   TEXT,
      rerun_from_node_id  TEXT,
      created_at          TEXT NOT NULL
    );
    CREATE INDEX idx_orch_runs_created ON orchestration_runs(created_at);

    CREATE TABLE orchestration_node_runs (
      id                    TEXT PRIMARY KEY,
      orchestration_run_id  TEXT NOT NULL,
      node_id               TEXT NOT NULL,
      job_id                TEXT,
      session_key           TEXT,
      status                TEXT NOT NULL DEFAULT 'pending',
      return_value          TEXT,
      exit_code             INTEGER,
      output_summary        TEXT,
      output_full           TEXT,
      error_message         TEXT,
      gate_evaluation       TEXT,
      retry_count           INTEGER NOT NULL DEFAULT 0,
      started_at            TEXT,
      ended_at              TEXT
    );
    CREATE INDEX idx_node_runs_run ON orchestration_node_runs(orchestration_run_id);

    CREATE TABLE sessions (
      session_key TEXT PRIMARY KEY,
      tool TEXT NOT NULL DEFAULT 'claude',
      mode TEXT NOT NULL DEFAULT 'write',
      mode_expires_at TEXT,
      tool_state TEXT NOT NULL DEFAULT '{}',
      workdir TEXT NOT NULL,
      running_job_id TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_sessions_updated_at ON sessions(updated_at);

    CREATE TABLE session_registry (
      session_key TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL UNIQUE,
      thread_key  TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      started_at  TEXT NOT NULL
    );
    CREATE INDEX idx_session_registry_started_asc ON session_registry(started_at);

    CREATE TABLE thread_contexts (
      thread_key TEXT PRIMARY KEY,
      active_session_key TEXT,
      last_activity_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_thread_contexts_last_activity ON thread_contexts(last_activity_at);
    CREATE INDEX idx_thread_contexts_active_session ON thread_contexts(active_session_key);

    CREATE TABLE session_mcp_servers (
      session_key TEXT NOT NULL,
      server_id   TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (session_key, server_id)
    );
    CREATE INDEX idx_session_mcp_servers_session ON session_mcp_servers(session_key);

    CREATE TABLE orchestrators (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      workdir         TEXT,
      status          TEXT NOT NULL DEFAULT 'active',
      max_run_workdirs INTEGER NOT NULL DEFAULT 20,
      created_at      TEXT NOT NULL DEFAULT '',
      updated_at      TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE orchestrator_nodes (
      id              TEXT PRIMARY KEY,
      orchestrator_id TEXT NOT NULL,
      label           TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT '',
      updated_at      TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX idx_orch_nodes_orch ON orchestrator_nodes(orchestrator_id);

    CREATE TABLE orchestrator_edges (
      id              TEXT PRIMARY KEY,
      orchestrator_id TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX idx_orch_edges_orch ON orchestrator_edges(orchestrator_id);

    CREATE TABLE event_subscriptions (
      id                   TEXT PRIMARY KEY,
      endpoint_id          TEXT NOT NULL,
      target_type          TEXT NOT NULL,
      orchestrator_id      TEXT,
      triggered_task_id    TEXT,
      node_id              TEXT,
      filter_json          TEXT,
      context_mapping_json TEXT,
      enabled              INTEGER NOT NULL DEFAULT 1,
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL
    );

    CREATE TABLE webhook_deliveries (
      endpoint_id  TEXT NOT NULL,
      delivery_id  TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'dispatching',
      successful_sub_ids TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      PRIMARY KEY (endpoint_id, delivery_id)
    );
  `);
  return db;
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hk-test-'));
}

// ── Tests ───────────────────────────────────────────────────────

describe('housekeeping', () => {
  let db: Database.Database | null = null;
  let tmpDir: string | null = null;

  afterEach(() => {
    vi.restoreAllMocks();
    db?.close();
    db = null;
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  // ── Retention Cleanup ──

  describe('retentionCleanup', () => {
    it('deletes audit rows older than 90 days', () => {
      db = createDb();
      db.prepare(
        'INSERT INTO audit (job_id, session_key, user_id, tool, mode, workdir, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('old-job', 'sess-1', 'user-1', 'claude', 'write', '/tmp', daysAgo(100));
      db.prepare(
        'INSERT INTO audit (job_id, session_key, user_id, tool, mode, workdir, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('new-job', 'sess-2', 'user-1', 'claude', 'write', '/tmp', daysAgo(10));

      const { results } = retentionCleanup(db);
      const auditResult = results.find((r) => r.table === 'audit');

      expect(auditResult).toBeDefined();
      expect(auditResult?.deletedCount).toBe(1);

      const remaining = db.prepare('SELECT COUNT(*) as cnt FROM audit').get() as { cnt: number };
      expect(remaining.cnt).toBe(1);
    });

    it('deletes dashboard_messages older than 30 days', () => {
      db = createDb();
      db.prepare(
        'INSERT INTO dashboard_messages (session_key, role, content, created_at) VALUES (?, ?, ?, ?)',
      ).run('sess-1', 'user', 'old msg', daysAgo(35));
      db.prepare(
        'INSERT INTO dashboard_messages (session_key, role, content, created_at) VALUES (?, ?, ?, ?)',
      ).run('sess-1', 'user', 'new msg', daysAgo(5));

      const { results } = retentionCleanup(db);
      const msgResult = results.find((r) => r.table === 'dashboard_messages');
      expect(msgResult?.deletedCount).toBe(1);
    });

    it('enforces maxRows for dashboard_messages', () => {
      db = createDb();
      const stmt = db.prepare(
        'INSERT INTO dashboard_messages (session_key, role, content, created_at) VALUES (?, ?, ?, ?)',
      );
      const insertMany = db.transaction(() => {
        for (let i = 0; i < 10_005; i++) {
          stmt.run('sess-1', 'user', `msg-${i}`, daysAgo(i < 5 ? 0 : 1));
        }
      });
      insertMany();

      const { results } = retentionCleanup(db);
      const msgResult = results.find((r) => r.table === 'dashboard_messages');
      expect(msgResult).toBeDefined();
      expect(msgResult?.deletedCount).toBeGreaterThanOrEqual(5);

      const remaining = db.prepare('SELECT COUNT(*) as cnt FROM dashboard_messages').get() as {
        cnt: number;
      };
      expect(remaining.cnt).toBe(10_000);
    });

    it('cascade-deletes orchestration_node_runs when orchestration_runs are pruned', () => {
      db = createDb();
      const oldRunId = 'aaa-bbb-111';
      db.prepare(
        'INSERT INTO orchestration_runs (id, orchestrator_id, status, created_at) VALUES (?, ?, ?, ?)',
      ).run(oldRunId, 'orch-1', 'completed', daysAgo(100));
      db.prepare(
        'INSERT INTO orchestration_node_runs (id, orchestration_run_id, node_id, status) VALUES (?, ?, ?, ?)',
      ).run('nr-1', oldRunId, 'node-a', 'completed');
      db.prepare(
        'INSERT INTO orchestration_node_runs (id, orchestration_run_id, node_id, status) VALUES (?, ?, ?, ?)',
      ).run('nr-2', oldRunId, 'node-b', 'completed');

      const newRunId = 'ccc-ddd-222';
      db.prepare(
        'INSERT INTO orchestration_runs (id, orchestrator_id, status, created_at) VALUES (?, ?, ?, ?)',
      ).run(newRunId, 'orch-1', 'completed', daysAgo(10));
      db.prepare(
        'INSERT INTO orchestration_node_runs (id, orchestration_run_id, node_id, status) VALUES (?, ?, ?, ?)',
      ).run('nr-3', newRunId, 'node-a', 'completed');

      const { deletedOrchestrationRunIds } = retentionCleanup(db);

      // Verify cascade
      const runs = db.prepare('SELECT COUNT(*) as cnt FROM orchestration_runs').get() as {
        cnt: number;
      };
      expect(runs.cnt).toBe(1);
      const nodeRuns = db.prepare('SELECT COUNT(*) as cnt FROM orchestration_node_runs').get() as {
        cnt: number;
      };
      expect(nodeRuns.cnt).toBe(1);
      const survivor = db.prepare('SELECT id FROM orchestration_node_runs').get() as { id: string };
      expect(survivor.id).toBe('nr-3');

      // Verify deleted IDs are collected
      expect(deletedOrchestrationRunIds).toContain(oldRunId);
      expect(deletedOrchestrationRunIds).not.toContain(newRunId);
    });

    it('deletes mode_changes older than 30 days', () => {
      db = createDb();
      db.prepare(
        'INSERT INTO mode_changes (session_key, user_id, from_mode, to_mode, changed_at) VALUES (?, ?, ?, ?, ?)',
      ).run('sess-1', 'user-1', 'readonly', 'write', daysAgo(35));
      db.prepare(
        'INSERT INTO mode_changes (session_key, user_id, from_mode, to_mode, changed_at) VALUES (?, ?, ?, ?, ?)',
      ).run('sess-1', 'user-1', 'write', 'readonly', daysAgo(5));

      retentionCleanup(db);

      const cnt = db.prepare('SELECT COUNT(*) as cnt FROM mode_changes').get() as { cnt: number };
      expect(cnt.cnt).toBe(1);
    });

    it('deletes stale session graphs as a unit', () => {
      db = createDb();
      db.prepare(
        `INSERT INTO sessions (
          session_key, tool, mode, tool_state, workdir, running_job_id, updated_at
        ) VALUES (?, 'claude', 'write', '{}', ?, NULL, ?)`,
      ).run('old-sess', '/tmp/old', daysAgo(100));
      db.prepare(
        `INSERT INTO sessions (
          session_key, tool, mode, tool_state, workdir, running_job_id, updated_at
        ) VALUES (?, 'claude', 'write', '{}', ?, NULL, ?)`,
      ).run('new-sess', '/tmp/new', daysAgo(10));
      db.prepare(
        'INSERT INTO session_registry (session_key, session_id, thread_key, user_id, started_at) VALUES (?, ?, ?, ?, ?)',
      ).run('old-sess', 'sid-old', 'thread-1', 'user-1', daysAgo(100));
      db.prepare(
        'INSERT INTO session_registry (session_key, session_id, thread_key, user_id, started_at) VALUES (?, ?, ?, ?, ?)',
      ).run('new-sess', 'sid-new', 'thread-2', 'user-1', daysAgo(10));
      db.prepare(
        'INSERT INTO thread_contexts (thread_key, active_session_key, last_activity_at, updated_at) VALUES (?, ?, ?, ?)',
      ).run('thread-1', 'old-sess', daysAgo(5), daysAgo(5));
      db.prepare(
        'INSERT INTO thread_contexts (thread_key, active_session_key, last_activity_at, updated_at) VALUES (?, ?, ?, ?)',
      ).run('thread-2', 'new-sess', daysAgo(10), daysAgo(10));
      db.prepare(
        'INSERT INTO dashboard_messages (session_key, role, content, created_at) VALUES (?, ?, ?, ?)',
      ).run('new-sess', 'user', 'recent', daysAgo(5));
      db.prepare(
        'INSERT INTO session_mcp_servers (session_key, server_id, enabled) VALUES (?, ?, ?)',
      ).run('old-sess', 'srv-1', 1);

      retentionCleanup(db);

      const registryCount = db.prepare('SELECT COUNT(*) as cnt FROM session_registry').get() as {
        cnt: number;
      };
      const sessionCount = db.prepare('SELECT COUNT(*) as cnt FROM sessions').get() as {
        cnt: number;
      };
      const dashCount = db.prepare('SELECT COUNT(*) as cnt FROM dashboard_messages').get() as {
        cnt: number;
      };
      const mcpCount = db.prepare('SELECT COUNT(*) as cnt FROM session_mcp_servers').get() as {
        cnt: number;
      };
      const threadOne = db
        .prepare('SELECT active_session_key FROM thread_contexts WHERE thread_key = ?')
        .get('thread-1') as { active_session_key: string | null } | undefined;

      expect(registryCount.cnt).toBe(1);
      expect(sessionCount.cnt).toBe(1);
      expect(dashCount.cnt).toBe(1);
      expect(mcpCount.cnt).toBe(0);
      expect(threadOne?.active_session_key).toBeNull();
    });

    it('keeps old sessions with recent dashboard activity', () => {
      db = createDb();
      db.prepare(
        `INSERT INTO sessions (
          session_key, tool, mode, tool_state, workdir, running_job_id, updated_at
        ) VALUES (?, 'claude', 'write', '{}', ?, NULL, ?)`,
      ).run('keep-sess', '/tmp/keep', daysAgo(100));
      db.prepare(
        'INSERT INTO session_registry (session_key, session_id, thread_key, user_id, started_at) VALUES (?, ?, ?, ?, ?)',
      ).run('keep-sess', 'sid-keep', 'thread-1', 'user-1', daysAgo(100));
      db.prepare(
        'INSERT INTO dashboard_messages (session_key, role, content, created_at) VALUES (?, ?, ?, ?)',
      ).run('keep-sess', 'user', 'recent dashboard activity', daysAgo(2));

      retentionCleanup(db);

      expect(db.prepare('SELECT COUNT(*) as cnt FROM sessions').get()).toEqual({ cnt: 1 });
      expect(db.prepare('SELECT COUNT(*) as cnt FROM session_registry').get()).toEqual({
        cnt: 1,
      });
    });

    it('backfills session updated_at from dashboard messages before pruning old messages', () => {
      db = createDb();
      const staleUpdatedAt = daysAgo(100);
      const lastMessageAt = daysAgo(40);
      db.prepare(
        `INSERT INTO sessions (
          session_key, tool, mode, tool_state, workdir, running_job_id, updated_at
        ) VALUES (?, 'claude', 'write', '{}', ?, NULL, ?)`,
      ).run('backfill-sess', '/tmp/backfill', staleUpdatedAt);
      db.prepare(
        'INSERT INTO session_registry (session_key, session_id, thread_key, user_id, started_at) VALUES (?, ?, ?, ?, ?)',
      ).run('backfill-sess', 'sid-backfill', 'thread-backfill', 'user-1', daysAgo(100));
      db.prepare(
        'INSERT INTO dashboard_messages (session_key, role, content, created_at) VALUES (?, ?, ?, ?)',
      ).run(
        'backfill-sess',
        'user',
        'older than message retention, newer than session retention',
        lastMessageAt,
      );

      retentionCleanup(db);

      expect(db.prepare('SELECT COUNT(*) as cnt FROM sessions').get()).toEqual({ cnt: 1 });
      expect(db.prepare('SELECT COUNT(*) as cnt FROM session_registry').get()).toEqual({ cnt: 1 });
      expect(db.prepare('SELECT COUNT(*) as cnt FROM dashboard_messages').get()).toEqual({
        cnt: 0,
      });
      expect(
        db
          .prepare('SELECT updated_at FROM sessions WHERE session_key = ?')
          .get('backfill-sess') as { updated_at: string },
      ).toEqual({
        updated_at: lastMessageAt,
      });
    });

    it('deletes stale thread_contexts after they are detached from a session', () => {
      db = createDb();
      db.prepare(
        'INSERT INTO thread_contexts (thread_key, active_session_key, last_activity_at, updated_at) VALUES (?, ?, ?, ?)',
      ).run('thread-old', null, daysAgo(100), daysAgo(100));
      db.prepare(
        'INSERT INTO thread_contexts (thread_key, active_session_key, last_activity_at, updated_at) VALUES (?, ?, ?, ?)',
      ).run('thread-new', null, daysAgo(5), daysAgo(5));

      retentionCleanup(db);

      expect(db.prepare('SELECT COUNT(*) as cnt FROM thread_contexts').get()).toEqual({ cnt: 1 });
      expect(
        db.prepare('SELECT thread_key FROM thread_contexts').get() as { thread_key: string },
      ).toEqual({
        thread_key: 'thread-new',
      });
    });

    it('returns empty results when nothing to delete', () => {
      db = createDb();
      const { results, deletedOrchestrationRunIds } = retentionCleanup(db);
      expect(results).toEqual([]);
      expect(deletedOrchestrationRunIds).toEqual([]);
    });

    it('skips session and thread_contexts cleanup when sessionCleanupEnabled is false', () => {
      db = createDb();
      // Insert a stale session that would normally be cleaned up
      db.prepare(
        `INSERT INTO sessions (
          session_key, tool, mode, tool_state, workdir, running_job_id, updated_at
        ) VALUES (?, 'claude', 'write', '{}', ?, NULL, ?)`,
      ).run('stale-sess', '/tmp/stale', daysAgo(100));
      db.prepare(
        'INSERT INTO session_registry (session_key, session_id, thread_key, user_id, started_at) VALUES (?, ?, ?, ?, ?)',
      ).run('stale-sess', 'sid-stale', 'thread-stale', 'user-1', daysAgo(100));
      // Insert a stale thread_context that would normally be cleaned up
      db.prepare(
        'INSERT INTO thread_contexts (thread_key, active_session_key, last_activity_at, updated_at) VALUES (?, ?, ?, ?)',
      ).run('thread-stale', null, daysAgo(100), daysAgo(100));

      retentionCleanup(db, { sessionCleanupEnabled: false });

      // Session and registry should be preserved
      expect(db.prepare('SELECT COUNT(*) as cnt FROM sessions').get()).toEqual({ cnt: 1 });
      expect(db.prepare('SELECT COUNT(*) as cnt FROM session_registry').get()).toEqual({ cnt: 1 });
      // Thread context should be preserved
      expect(db.prepare('SELECT COUNT(*) as cnt FROM thread_contexts').get()).toEqual({ cnt: 1 });
    });

    it('cleans sessions and thread_contexts by default (sessionCleanupEnabled unset)', () => {
      db = createDb();
      db.prepare(
        `INSERT INTO sessions (
          session_key, tool, mode, tool_state, workdir, running_job_id, updated_at
        ) VALUES (?, 'claude', 'write', '{}', ?, NULL, ?)`,
      ).run('stale-sess', '/tmp/stale', daysAgo(100));
      db.prepare(
        'INSERT INTO session_registry (session_key, session_id, thread_key, user_id, started_at) VALUES (?, ?, ?, ?, ?)',
      ).run('stale-sess', 'sid-stale', 'thread-stale', 'user-1', daysAgo(100));
      db.prepare(
        'INSERT INTO thread_contexts (thread_key, active_session_key, last_activity_at, updated_at) VALUES (?, ?, ?, ?)',
      ).run('thread-stale', null, daysAgo(100), daysAgo(100));

      retentionCleanup(db);

      expect(db.prepare('SELECT COUNT(*) as cnt FROM sessions').get()).toEqual({ cnt: 0 });
      expect(db.prepare('SELECT COUNT(*) as cnt FROM thread_contexts').get()).toEqual({ cnt: 0 });
    });

    it('returns cleaned session keys for monitoring', () => {
      db = createDb();
      db.prepare(
        `INSERT INTO sessions (
          session_key, tool, mode, tool_state, workdir, running_job_id, updated_at
        ) VALUES (?, 'claude', 'write', '{}', ?, NULL, ?)`,
      ).run('stale-a', '/tmp/a', daysAgo(100));
      db.prepare(
        `INSERT INTO sessions (
          session_key, tool, mode, tool_state, workdir, running_job_id, updated_at
        ) VALUES (?, 'claude', 'write', '{}', ?, NULL, ?)`,
      ).run('stale-b', '/tmp/b', daysAgo(100));
      db.prepare(
        'INSERT INTO session_registry (session_key, session_id, thread_key, user_id, started_at) VALUES (?, ?, ?, ?, ?)',
      ).run('stale-a', 'sid-a', 'thread-a', 'user-1', daysAgo(100));
      db.prepare(
        'INSERT INTO session_registry (session_key, session_id, thread_key, user_id, started_at) VALUES (?, ?, ?, ?, ?)',
      ).run('stale-b', 'sid-b', 'thread-b', 'user-1', daysAgo(100));

      const { cleanedSessionKeys } = retentionCleanup(db);

      expect(cleanedSessionKeys).toHaveLength(2);
      expect(cleanedSessionKeys.sort()).toEqual(['stale-a', 'stale-b']);
    });

    it('returns empty cleanedSessionKeys when sessionCleanupEnabled is false', () => {
      db = createDb();
      db.prepare(
        `INSERT INTO sessions (
          session_key, tool, mode, tool_state, workdir, running_job_id, updated_at
        ) VALUES (?, 'claude', 'write', '{}', ?, NULL, ?)`,
      ).run('stale-sess', '/tmp/stale', daysAgo(100));
      db.prepare(
        'INSERT INTO session_registry (session_key, session_id, thread_key, user_id, started_at) VALUES (?, ?, ?, ?, ?)',
      ).run('stale-sess', 'sid-stale', 'thread-stale', 'user-1', daysAgo(100));

      const { cleanedSessionKeys } = retentionCleanup(db, { sessionCleanupEnabled: false });

      expect(cleanedSessionKeys).toEqual([]);
      // Session should still exist
      expect(db.prepare('SELECT COUNT(*) as cnt FROM sessions').get()).toEqual({ cnt: 1 });
    });
  });

  // ── Job Log File Cleanup ──

  describe('cleanupJobLogFiles', () => {
    it('returns 0 when the job-logs root directory does not exist', () => {
      tmpDir = makeTmpDir();

      const cleaned = cleanupJobLogFiles(tmpDir, ['aaa-bbb-111']);
      expect(cleaned).toBe(0);
    });

    it('removes job-log directories for deleted run IDs', () => {
      tmpDir = makeTmpDir();
      const jobLogsDir = path.join(tmpDir, 'job-logs');
      const runDir = path.join(jobLogsDir, 'aaa-bbb-111');
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'node-a_job-1.log'), 'output');

      const cleaned = cleanupJobLogFiles(tmpDir, ['aaa-bbb-111']);
      expect(cleaned).toBe(1);
      expect(fs.existsSync(runDir)).toBe(false);
    });

    it('skips non-existent run directories gracefully', () => {
      tmpDir = makeTmpDir();
      fs.mkdirSync(path.join(tmpDir, 'job-logs'), { recursive: true });

      const cleaned = cleanupJobLogFiles(tmpDir, ['nonexistent-id']);
      expect(cleaned).toBe(0);
    });

    it('skips invalid IDs (defense-in-depth)', () => {
      tmpDir = makeTmpDir();
      fs.mkdirSync(path.join(tmpDir, 'job-logs'), { recursive: true });

      const cleaned = cleanupJobLogFiles(tmpDir, ['../../etc']);
      expect(cleaned).toBe(0);
    });

    it('logs and skips removal errors', () => {
      tmpDir = makeTmpDir();
      const jobLogsDir = path.join(tmpDir, 'job-logs');
      const runDir = path.join(jobLogsDir, 'aaa-bbb-111');
      fs.mkdirSync(runDir, { recursive: true });

      const realRmSync = fs.rmSync.bind(fs);
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      vi.spyOn(fs, 'rmSync').mockImplementation(((target: fs.PathLike, options?: fs.RmOptions) => {
        if (String(target) === runDir) throw new Error('rm failed');
        return realRmSync(target, options);
      }) as typeof fs.rmSync);

      const cleaned = cleanupJobLogFiles(tmpDir, ['aaa-bbb-111']);

      expect(cleaned).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith('job_log_cleanup_error', {
        runId: 'aaa-bbb-111',
        error: 'rm failed',
      });
      expect(fs.existsSync(runDir)).toBe(true);
    });
  });

  describe('cleanupOrphanedJobLogs', () => {
    it('removes job-log dirs whose run ID no longer exists in DB', () => {
      db = createDb();
      tmpDir = makeTmpDir();

      // Create a run that still exists
      const liveRunId = 'aaa-111';
      db.prepare(
        'INSERT INTO orchestration_runs (id, orchestrator_id, status, created_at) VALUES (?, ?, ?, ?)',
      ).run(liveRunId, 'orch-1', 'completed', daysAgo(10));

      // Create log dirs: one live, one orphaned
      const jobLogsDir = path.join(tmpDir, 'job-logs');
      fs.mkdirSync(path.join(jobLogsDir, liveRunId), { recursive: true });
      fs.mkdirSync(path.join(jobLogsDir, 'bbb-222'), { recursive: true });
      fs.writeFileSync(path.join(jobLogsDir, 'bbb-222', 'node.log'), 'orphan');

      const cleaned = cleanupOrphanedJobLogs(db, tmpDir);
      expect(cleaned).toBe(1);
      expect(fs.existsSync(path.join(jobLogsDir, liveRunId))).toBe(true);
      expect(fs.existsSync(path.join(jobLogsDir, 'bbb-222'))).toBe(false);
    });

    it('returns 0 when job-logs directory does not exist', () => {
      db = createDb();
      tmpDir = makeTmpDir();
      const cleaned = cleanupOrphanedJobLogs(db, tmpDir);
      expect(cleaned).toBe(0);
    });

    it('skips files and invalid directory names while scanning job logs', () => {
      db = createDb();
      tmpDir = makeTmpDir();
      const jobLogsDir = path.join(tmpDir, 'job-logs');
      fs.mkdirSync(jobLogsDir, { recursive: true });
      fs.writeFileSync(path.join(jobLogsDir, 'orphan.log'), 'not-a-directory');
      fs.mkdirSync(path.join(jobLogsDir, 'invalid!dir'), { recursive: true });

      const cleaned = cleanupOrphanedJobLogs(db, tmpDir);

      expect(cleaned).toBe(0);
      expect(fs.existsSync(path.join(jobLogsDir, 'invalid!dir'))).toBe(true);
    });

    it('logs and skips orphan cleanup errors', () => {
      db = createDb();
      tmpDir = makeTmpDir();
      const jobLogsDir = path.join(tmpDir, 'job-logs');
      const orphanDir = path.join(jobLogsDir, 'bbb-222');
      fs.mkdirSync(orphanDir, { recursive: true });

      const realRmSync = fs.rmSync.bind(fs);
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      vi.spyOn(fs, 'rmSync').mockImplementation(((target: fs.PathLike, options?: fs.RmOptions) => {
        if (String(target) === orphanDir) throw new Error('orphan rm failed');
        return realRmSync(target, options);
      }) as typeof fs.rmSync);

      const cleaned = cleanupOrphanedJobLogs(db, tmpDir);

      expect(cleaned).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith('orphan_job_log_cleanup_error', {
        dir: 'bbb-222',
        error: 'orphan rm failed',
      });
      expect(fs.existsSync(orphanDir)).toBe(true);
    });
  });

  // ── Path Validation ──

  describe('assertSafePath', () => {
    it('accepts valid paths', () => {
      expect(() =>
        assertSafePath('/tmp/data/backups/orchestrator_20260305_120000.db'),
      ).not.toThrow();
    });

    it('rejects path traversal', () => {
      expect(() => assertSafePath('/tmp/../etc/passwd')).toThrow('Path traversal rejected');
    });

    it('rejects special characters', () => {
      expect(() => assertSafePath("/tmp/foo'; DROP TABLE--")).toThrow('Unsafe path characters');
    });
  });

  // ── Log Rotation ──

  describe('rotateLogs', () => {
    it('rotates log files exceeding max size', () => {
      tmpDir = makeTmpDir();
      const logPath = path.join(tmpDir, 'huskygate.log');
      // Create a file just over the threshold (use 1KB threshold for testing)
      const data = 'x'.repeat(2048);
      fs.writeFileSync(logPath, data);

      const rotated = rotateLogs(tmpDir, 1024, 3);
      expect(rotated).toBe(1);

      // Original should be truncated to 0
      const stat = fs.statSync(logPath);
      expect(stat.size).toBe(0);

      // Rotated copy should exist with original content
      const rotatedPath = `${logPath}.1`;
      expect(fs.existsSync(rotatedPath)).toBe(true);
      expect(fs.readFileSync(rotatedPath, 'utf-8')).toBe(data);
    });

    it('shifts existing rotations correctly', () => {
      tmpDir = makeTmpDir();
      const logPath = path.join(tmpDir, 'huskygate.log');

      // Simulate existing rotations
      fs.writeFileSync(`${logPath}.1`, 'rotation-1');
      fs.writeFileSync(`${logPath}.2`, 'rotation-2');
      // Current log is over threshold
      fs.writeFileSync(logPath, 'x'.repeat(2048));

      rotateLogs(tmpDir, 1024, 3);

      // .2 should now contain old .1 content
      expect(fs.readFileSync(`${logPath}.2`, 'utf-8')).toBe('rotation-1');
      // .3 should contain old .2 content
      expect(fs.readFileSync(`${logPath}.3`, 'utf-8')).toBe('rotation-2');
      // .1 should contain the rotated current log
      expect(fs.readFileSync(`${logPath}.1`, 'utf-8').length).toBe(2048);
    });

    it('deletes oldest rotation when exceeding max', () => {
      tmpDir = makeTmpDir();
      const logPath = path.join(tmpDir, 'huskygate.log');

      fs.writeFileSync(`${logPath}.1`, 'rot-1');
      fs.writeFileSync(`${logPath}.2`, 'rot-2');
      fs.writeFileSync(`${logPath}.3`, 'rot-3-will-be-deleted');
      fs.writeFileSync(logPath, 'x'.repeat(2048));

      rotateLogs(tmpDir, 1024, 3);

      // .3 should now be the old .2 content (shifted), old .3 was deleted
      expect(fs.readFileSync(`${logPath}.3`, 'utf-8')).toBe('rot-2');
    });

    it('does nothing when log files are under threshold', () => {
      tmpDir = makeTmpDir();
      fs.writeFileSync(path.join(tmpDir, 'huskygate.log'), 'small');

      const rotated = rotateLogs(tmpDir, LOG_MAX_BYTES, 3);
      expect(rotated).toBe(0);
    });

    it('does nothing when log files do not exist', () => {
      tmpDir = makeTmpDir();
      const rotated = rotateLogs(tmpDir, LOG_MAX_BYTES, 3);
      expect(rotated).toBe(0);
    });

    it('skips a log when statSync fails after the file is discovered', () => {
      tmpDir = makeTmpDir();
      const logPath = path.join(tmpDir, 'huskygate.log');
      fs.writeFileSync(logPath, 'x'.repeat(2048));

      const realStatSync = fs.statSync.bind(fs);
      vi.spyOn(fs, 'statSync').mockImplementation(((
        target: fs.PathLike,
        options?: fs.StatOptions,
      ) => {
        if (String(target) === logPath) throw new Error('stat failed');
        return realStatSync(target, options as never);
      }) as typeof fs.statSync);

      const rotated = rotateLogs(tmpDir, 1024, 3);

      expect(rotated).toBe(0);
      expect(fs.existsSync(`${logPath}.1`)).toBe(false);
    });

    it('logs copytruncate failures and leaves the log unrotated', () => {
      tmpDir = makeTmpDir();
      const logPath = path.join(tmpDir, 'huskygate.log');
      fs.writeFileSync(logPath, 'x'.repeat(2048));

      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      vi.spyOn(fs, 'copyFileSync').mockImplementation(((src: fs.PathLike) => {
        if (String(src) === logPath) throw new Error('copy failed');
      }) as typeof fs.copyFileSync);

      const rotated = rotateLogs(tmpDir, 1024, 3);

      expect(rotated).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith('log_rotation_error', {
        file: 'huskygate.log',
        error: 'copy failed',
      });
    });
  });

  // ── VACUUM INTO Backup ──

  describe('vacuumBackup', () => {
    it('creates a backup file in backups directory', () => {
      tmpDir = makeTmpDir();
      const dbPath = path.join(tmpDir, 'orchestrator.db');
      db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)');
      db.prepare('INSERT INTO test VALUES (1, ?)').run('hello');

      const result = vacuumBackup(db, tmpDir);

      expect(result).not.toBeNull();
      const backupPath = result?.backupPath;
      expect(backupPath).toContain('backups/orchestrator_');
      expect(backupPath).toBeDefined();
      if (!backupPath) throw new Error('Backup path should exist');
      expect(fs.existsSync(backupPath)).toBe(true);

      // Verify backup is a valid SQLite DB
      const backupDb = new Database(backupPath, { readonly: true });
      const row = backupDb.prepare('SELECT val FROM test WHERE id = 1').get() as { val: string };
      expect(row.val).toBe('hello');
      backupDb.close();
    });
  });

  // ── Backup Pruning ──

  describe('pruneBackups', () => {
    it('keeps only maxGenerations backups, deleting oldest', () => {
      tmpDir = makeTmpDir();
      const backupDir = path.join(tmpDir, 'backups');
      fs.mkdirSync(backupDir);

      for (let i = 0; i < 10; i++) {
        const ts = `2026030${i}_060000`;
        fs.writeFileSync(path.join(backupDir, `orchestrator_${ts}.db`), 'fake');
      }

      const pruned = pruneBackups(tmpDir, 7);
      expect(pruned).toBe(3);

      const remaining = fs.readdirSync(backupDir).filter((f) => f.endsWith('.db'));
      expect(remaining.length).toBe(7);

      expect(remaining.some((f) => f.includes('20260300'))).toBe(false);
      expect(remaining.some((f) => f.includes('20260301'))).toBe(false);
      expect(remaining.some((f) => f.includes('20260302'))).toBe(false);
    });

    it('does nothing when fewer backups than max', () => {
      tmpDir = makeTmpDir();
      const backupDir = path.join(tmpDir, 'backups');
      fs.mkdirSync(backupDir);
      fs.writeFileSync(path.join(backupDir, 'orchestrator_20260301_060000.db'), 'fake');

      const pruned = pruneBackups(tmpDir, 7);
      expect(pruned).toBe(0);
    });

    it('returns 0 when backup directory does not exist', () => {
      tmpDir = makeTmpDir();
      const pruned = pruneBackups(tmpDir, 7);
      expect(pruned).toBe(0);
    });

    it('logs unlink errors and keeps going when pruning old backups', () => {
      tmpDir = makeTmpDir();
      const backupDir = path.join(tmpDir, 'backups');
      fs.mkdirSync(backupDir);
      const doomed = path.join(backupDir, 'orchestrator_20260301_060000.db');
      fs.writeFileSync(doomed, 'oldest');
      fs.writeFileSync(path.join(backupDir, 'orchestrator_20260302_060000.db'), 'middle');
      fs.writeFileSync(path.join(backupDir, 'orchestrator_20260303_060000.db'), 'newest');

      const realUnlinkSync = fs.unlinkSync.bind(fs);
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      vi.spyOn(fs, 'unlinkSync').mockImplementation(((target: fs.PathLike) => {
        if (String(target) === doomed) throw new Error('unlink failed');
        return realUnlinkSync(target);
      }) as typeof fs.unlinkSync);

      const pruned = pruneBackups(tmpDir, 2);

      expect(pruned).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith('backup_prune_error', {
        file: 'orchestrator_20260301_060000.db',
        error: 'unlink failed',
      });
      expect(fs.existsSync(doomed)).toBe(true);
    });
  });

  // ── Deleted Orchestrator Purge ──

  describe('purgeDeletedOrchestrators', () => {
    it('purges all DB records and run workdirs for soft-deleted orchestrators', () => {
      db = createDb();
      tmpDir = makeTmpDir();
      const workdirRoot = path.join(tmpDir, 'workdir');
      fs.mkdirSync(workdirRoot, { recursive: true });

      // Create a deleted orchestrator with runs
      const orchId = 'orch-deleted-1';
      db.prepare("INSERT INTO orchestrators (id, name, status) VALUES (?, ?, 'deleted')").run(
        orchId,
        'Deleted Pipeline',
      );

      const runId1 = 'aaaa1111-2222-3333-4444-555566667777';
      const runId2 = 'bbbb1111-2222-3333-4444-555566667777';
      db.prepare(
        'INSERT INTO orchestration_runs (id, orchestrator_id, status, created_at) VALUES (?, ?, ?, ?)',
      ).run(runId1, orchId, 'completed', daysAgo(10));
      db.prepare(
        'INSERT INTO orchestration_runs (id, orchestrator_id, status, created_at) VALUES (?, ?, ?, ?)',
      ).run(runId2, orchId, 'completed', daysAgo(5));

      db.prepare(
        'INSERT INTO orchestration_node_runs (id, orchestration_run_id, node_id, status) VALUES (?, ?, ?, ?)',
      ).run('nr-1', runId1, 'node-a', 'completed');
      db.prepare(
        'INSERT INTO orchestration_node_runs (id, orchestration_run_id, node_id, status) VALUES (?, ?, ?, ?)',
      ).run('nr-2', runId2, 'node-a', 'completed');

      db.prepare(
        'INSERT INTO orchestrator_nodes (id, orchestrator_id, label) VALUES (?, ?, ?)',
      ).run('node-a', orchId, 'Task A');
      db.prepare('INSERT INTO orchestrator_edges (id, orchestrator_id) VALUES (?, ?)').run(
        'edge-1',
        orchId,
      );

      // Create run workdirs
      const wd1 = path.join(workdirRoot, `orch_${runId1.slice(0, 8)}`);
      const wd2 = path.join(workdirRoot, `orch_${runId2.slice(0, 8)}`);
      fs.mkdirSync(wd1, { recursive: true });
      fs.mkdirSync(wd2, { recursive: true });

      const result = purgeDeletedOrchestrators(db, workdirRoot, tmpDir);

      expect(result.orchestratorsPurged).toBe(1);
      expect(result.runsPurged).toBe(2);
      expect(result.workdirsCleaned).toBe(2);

      // Verify DB records are gone
      expect(db.prepare('SELECT COUNT(*) as cnt FROM orchestrators').get()).toEqual({ cnt: 0 });
      expect(db.prepare('SELECT COUNT(*) as cnt FROM orchestration_runs').get()).toEqual({
        cnt: 0,
      });
      expect(db.prepare('SELECT COUNT(*) as cnt FROM orchestration_node_runs').get()).toEqual({
        cnt: 0,
      });
      expect(db.prepare('SELECT COUNT(*) as cnt FROM orchestrator_nodes').get()).toEqual({
        cnt: 0,
      });
      expect(db.prepare('SELECT COUNT(*) as cnt FROM orchestrator_edges').get()).toEqual({
        cnt: 0,
      });

      // Verify workdirs are gone
      expect(fs.existsSync(wd1)).toBe(false);
      expect(fs.existsSync(wd2)).toBe(false);
    });

    it('skips workdir cleanup for orchestrators with user-specified workdir', () => {
      db = createDb();
      tmpDir = makeTmpDir();
      const workdirRoot = path.join(tmpDir, 'workdir');
      fs.mkdirSync(workdirRoot, { recursive: true });

      const orchId = 'orch-custom-wd';
      db.prepare(
        "INSERT INTO orchestrators (id, name, workdir, status) VALUES (?, ?, ?, 'deleted')",
      ).run(orchId, 'Custom WD', '/some/custom/path');

      const runId = 'cccc1111-2222-3333-4444-555566667777';
      db.prepare(
        'INSERT INTO orchestration_runs (id, orchestrator_id, status, created_at) VALUES (?, ?, ?, ?)',
      ).run(runId, orchId, 'completed', daysAgo(5));

      // Create run workdir (should NOT be cleaned since orchestrator has custom workdir)
      const wd = path.join(workdirRoot, `orch_${runId.slice(0, 8)}`);
      fs.mkdirSync(wd, { recursive: true });

      const result = purgeDeletedOrchestrators(db, workdirRoot, tmpDir);

      expect(result.orchestratorsPurged).toBe(1);
      expect(result.workdirsCleaned).toBe(0);
      expect(fs.existsSync(wd)).toBe(true); // not cleaned
    });

    it('does nothing when no deleted orchestrators exist', () => {
      db = createDb();
      tmpDir = makeTmpDir();
      const result = purgeDeletedOrchestrators(db, path.join(tmpDir, 'workdir'), tmpDir);
      expect(result.orchestratorsPurged).toBe(0);
    });

    it('purges event subscriptions that reference deleted orchestrators or their nodes', () => {
      db = createDb();
      tmpDir = makeTmpDir();
      const workdirRoot = path.join(tmpDir, 'workdir');
      db.prepare(
        'INSERT INTO orchestrators (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run('orch-1', 'Pipeline', 'deleted', daysAgo(10), daysAgo(10));
      db.prepare(
        'INSERT INTO orchestrator_nodes (id, orchestrator_id, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run('node-1', 'orch-1', 'Wait for Event', daysAgo(10), daysAgo(10));
      db.prepare(
        `INSERT INTO event_subscriptions (
          id, endpoint_id, target_type, orchestrator_id, triggered_task_id, node_id,
          filter_json, context_mapping_json, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'sub-1',
        'endpoint-1',
        'triggered_node',
        null,
        null,
        'node-1',
        null,
        null,
        1,
        daysAgo(10),
        daysAgo(10),
      );

      const result = purgeDeletedOrchestrators(db, workdirRoot, tmpDir);

      expect(result.orchestratorsPurged).toBe(1);
      const remaining = db.prepare('SELECT COUNT(*) as cnt FROM event_subscriptions').get() as {
        cnt: number;
      };
      expect(remaining.cnt).toBe(0);
    });

    it('skips deleted orchestrators that still have active runs', () => {
      db = createDb();
      tmpDir = makeTmpDir();
      const workdirRoot = path.join(tmpDir, 'workdir');
      fs.mkdirSync(workdirRoot, { recursive: true });
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      db.prepare(
        "INSERT INTO orchestrators (id, name, status, created_at, updated_at) VALUES (?, ?, 'deleted', ?, ?)",
      ).run('orch-active', 'Active Pipeline', daysAgo(2), daysAgo(2));
      db.prepare(
        'INSERT INTO orchestration_runs (id, orchestrator_id, status, created_at) VALUES (?, ?, ?, ?)',
      ).run('eeee1111-2222-3333-4444-555566667777', 'orch-active', 'running', daysAgo(1));

      const result = purgeDeletedOrchestrators(db, workdirRoot, tmpDir);

      expect(result).toEqual({
        orchestratorsPurged: 0,
        runsPurged: 0,
        workdirsCleaned: 0,
      });
      expect(warnSpy).toHaveBeenCalledWith('purge_orchestrator_skipped_active_runs', {
        orchestratorId: 'orch-active',
        activeRuns: 1,
      });
      expect(db.prepare('SELECT COUNT(*) as cnt FROM orchestrators').get()).toEqual({ cnt: 1 });
      expect(db.prepare('SELECT COUNT(*) as cnt FROM orchestration_runs').get()).toEqual({
        cnt: 1,
      });
    });
  });

  // ── Orphan Run Workdir Cleanup ──

  describe('cleanupOrphanRunWorkdirs', () => {
    it('removes orch_ directories with no matching run in DB', () => {
      db = createDb();
      tmpDir = makeTmpDir();
      const workdirRoot = path.join(tmpDir, 'workdir');

      // Create run in DB
      const liveRunId = 'dddd1111-2222-3333-4444-555566667777';
      db.prepare(
        'INSERT INTO orchestration_runs (id, orchestrator_id, status, created_at) VALUES (?, ?, ?, ?)',
      ).run(liveRunId, 'orch-1', 'completed', daysAgo(5));

      // Create matching workdir + orphan workdir
      fs.mkdirSync(path.join(workdirRoot, `orch_${liveRunId.slice(0, 8)}`), { recursive: true });
      fs.mkdirSync(path.join(workdirRoot, 'orch_deadbeef'), { recursive: true });
      // Non-matching dir (not orch_ pattern) should be ignored
      fs.mkdirSync(path.join(workdirRoot, 'session_12345678'), { recursive: true });

      const cleaned = cleanupOrphanRunWorkdirs(db, workdirRoot);

      expect(cleaned).toBe(1);
      expect(fs.existsSync(path.join(workdirRoot, `orch_${liveRunId.slice(0, 8)}`))).toBe(true);
      expect(fs.existsSync(path.join(workdirRoot, 'orch_deadbeef'))).toBe(false);
      expect(fs.existsSync(path.join(workdirRoot, 'session_12345678'))).toBe(true);
    });

    it('returns 0 when workdir root does not exist', () => {
      db = createDb();
      const cleaned = cleanupOrphanRunWorkdirs(db, '/nonexistent/workdir');
      expect(cleaned).toBe(0);
    });
  });

  // ── Integration: runHousekeeping ──

  describe('runHousekeeping', () => {
    it('performs full housekeeping cycle with job-log cleanup', () => {
      tmpDir = makeTmpDir();
      const dbPath = path.join(tmpDir, 'orchestrator.db');
      db = new Database(dbPath);
      db.pragma('journal_mode = WAL');

      db.exec(`
        CREATE TABLE audit (
          job_id TEXT PRIMARY KEY, session_key TEXT NOT NULL, user_id TEXT NOT NULL,
          tool TEXT NOT NULL, mode TEXT NOT NULL, workdir TEXT NOT NULL, started_at TEXT NOT NULL
        );
        CREATE INDEX idx_audit_started ON audit(started_at);

        CREATE TABLE dashboard_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT, session_key TEXT NOT NULL,
          role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, job_id TEXT
        );
        CREATE INDEX idx_dash_msg_created ON dashboard_messages(created_at);

        CREATE TABLE mode_changes (
          id INTEGER PRIMARY KEY AUTOINCREMENT, session_key TEXT NOT NULL,
          user_id TEXT NOT NULL, from_mode TEXT NOT NULL, to_mode TEXT NOT NULL, changed_at TEXT NOT NULL
        );
        CREATE INDEX idx_mode_changes_changed ON mode_changes(changed_at);

        CREATE TABLE scheduled_task_runs (
          id TEXT PRIMARY KEY, task_id TEXT NOT NULL, session_key TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending', started_at TEXT NOT NULL, retry_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_sched_runs_started ON scheduled_task_runs(started_at);

        CREATE TABLE ondemand_task_runs (
          id TEXT PRIMARY KEY, task_id TEXT NOT NULL, session_key TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending', started_at TEXT NOT NULL,
          retry_count INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'dashboard'
        );
        CREATE INDEX idx_ondemand_runs_started ON ondemand_task_runs(started_at);

        CREATE TABLE triggered_task_runs (
          id TEXT PRIMARY KEY, triggered_task_id TEXT NOT NULL, session_key TEXT,
          status TEXT NOT NULL DEFAULT 'pending', started_at TEXT NOT NULL,
          retry_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_triggered_task_runs_started ON triggered_task_runs(started_at);

        CREATE TABLE orchestration_runs (
          id TEXT PRIMARY KEY, orchestrator_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL
        );
        CREATE INDEX idx_orch_runs_created ON orchestration_runs(created_at);

        CREATE TABLE orchestration_node_runs (
          id TEXT PRIMARY KEY, orchestration_run_id TEXT NOT NULL,
          node_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
        );
        CREATE INDEX idx_node_runs_run ON orchestration_node_runs(orchestration_run_id);

        CREATE TABLE sessions (
          session_key TEXT PRIMARY KEY,
          tool TEXT NOT NULL DEFAULT 'claude',
          mode TEXT NOT NULL DEFAULT 'write',
          mode_expires_at TEXT,
          tool_state TEXT NOT NULL DEFAULT '{}',
          workdir TEXT NOT NULL,
          running_job_id TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE thread_contexts (
          thread_key TEXT PRIMARY KEY,
          active_session_key TEXT,
          last_activity_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE session_registry (
          session_key TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE,
          thread_key TEXT NOT NULL, user_id TEXT NOT NULL, started_at TEXT NOT NULL
        );
        CREATE INDEX idx_session_registry_started_asc ON session_registry(started_at);

        CREATE TABLE session_mcp_servers (
          session_key TEXT NOT NULL,
          server_id TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (session_key, server_id)
        );

        CREATE TABLE orchestrators (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, workdir TEXT,
          status TEXT NOT NULL DEFAULT 'active', max_run_workdirs INTEGER NOT NULL DEFAULT 20,
          created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE orchestrator_nodes (
          id TEXT PRIMARY KEY, orchestrator_id TEXT NOT NULL, label TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX idx_orch_nodes_orch_int ON orchestrator_nodes(orchestrator_id);
        CREATE TABLE orchestrator_edges (
          id TEXT PRIMARY KEY, orchestrator_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX idx_orch_edges_orch_int ON orchestrator_edges(orchestrator_id);

        CREATE TABLE event_subscriptions (
          id TEXT PRIMARY KEY,
          endpoint_id TEXT NOT NULL,
          target_type TEXT NOT NULL,
          orchestrator_id TEXT,
          triggered_task_id TEXT,
          node_id TEXT,
          filter_json TEXT,
          context_mapping_json TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE webhook_deliveries (
          endpoint_id  TEXT NOT NULL,
          delivery_id  TEXT NOT NULL,
          status       TEXT NOT NULL DEFAULT 'dispatching',
          successful_sub_ids TEXT,
          created_at   TEXT NOT NULL,
          updated_at   TEXT NOT NULL,
          PRIMARY KEY (endpoint_id, delivery_id)
        );
      `);

      // Seed: old orchestration run with log files + old audit row
      const oldRunId = 'aaa-bbb-ccc';
      db.prepare(
        'INSERT INTO orchestration_runs (id, orchestrator_id, status, created_at) VALUES (?, ?, ?, ?)',
      ).run(oldRunId, 'orch-1', 'completed', daysAgo(100));
      db.prepare(
        'INSERT INTO orchestration_node_runs (id, orchestration_run_id, node_id, status) VALUES (?, ?, ?, ?)',
      ).run('nr-1', oldRunId, 'node-a', 'completed');
      db.prepare(
        'INSERT INTO audit (job_id, session_key, user_id, tool, mode, workdir, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('j-old', 'sess-1', 'u1', 'claude', 'write', '/tmp', daysAgo(100));

      // Create job-log directory for the old run
      const runLogDir = path.join(tmpDir, 'job-logs', oldRunId);
      fs.mkdirSync(runLogDir, { recursive: true });
      fs.writeFileSync(path.join(runLogDir, 'node-a_job-1.log'), 'archived output');

      const result = runHousekeeping(db, tmpDir);

      // Retention cleaned DB rows
      expect(result.retention.find((r) => r.table === 'audit')?.deletedCount).toBe(1);
      expect(result.retention.find((r) => r.table === 'orchestration_runs')?.deletedCount).toBe(1);

      // Job-log files cleaned
      expect(result.jobLogsCleaned).toBe(1);
      expect(fs.existsSync(runLogDir)).toBe(false);

      // Backup created
      expect(result.backup).not.toBeNull();
      const backupPath = result.backup?.path;
      expect(backupPath).toBeDefined();
      if (!backupPath) throw new Error('Backup result path should exist');
      expect(fs.existsSync(backupPath)).toBe(true);

      // Duration tracked
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.orphanedThreadContextsCleared).toBe(0);
      expect(result.orphanedSessionMcpRows).toBe(0);
    });

    it('logs backup and wal checkpoint failures without aborting the run', () => {
      db = createDb();
      tmpDir = makeTmpDir();

      const execImpl = db.exec.bind(db);
      vi.spyOn(db, 'exec').mockImplementation((sql: string) => {
        if (sql.startsWith('VACUUM INTO')) throw new Error('vacuum failed');
        return execImpl(sql);
      });

      const pragmaImpl = db.pragma.bind(db);
      vi.spyOn(db, 'pragma').mockImplementation((arg: string) => {
        if (arg === 'wal_checkpoint(TRUNCATE)') throw new Error('checkpoint failed');
        return pragmaImpl(arg);
      });

      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const result = runHousekeeping(db, tmpDir);

      expect(result.backup).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith('vacuum_backup_failed', { error: 'vacuum failed' });
      expect(warnSpy).toHaveBeenCalledWith('wal_checkpoint_failed', {
        error: 'checkpoint failed',
      });
    });

    it('repairs orphaned thread_contexts and reports orphaned session_mcp rows', () => {
      db = createDb();
      tmpDir = makeTmpDir();
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      db.prepare(
        'INSERT INTO thread_contexts (thread_key, active_session_key, last_activity_at, updated_at) VALUES (?, ?, ?, ?)',
      ).run('thread-orphan', 'missing-session', daysAgo(5), daysAgo(5));
      db.prepare(
        'INSERT INTO session_mcp_servers (session_key, server_id, enabled) VALUES (?, ?, ?)',
      ).run('missing-session', 'srv-1', 1);

      const result = runHousekeeping(db, tmpDir);

      expect(result.orphanedThreadContextsCleared).toBe(1);
      expect(result.orphanedSessionMcpRows).toBe(1);
      expect(
        db
          .prepare('SELECT active_session_key FROM thread_contexts WHERE thread_key = ?')
          .get('thread-orphan'),
      ).toEqual({
        active_session_key: null,
      });
      expect(infoSpy).toHaveBeenCalledWith('thread_context_orphans_cleared', { count: 1 });
      expect(warnSpy).toHaveBeenCalledWith('session_mcp_server_orphans_deleted', { count: 1 });
    });
  });

  // ── Retention rules config validation ──

  describe('RETENTION_RULES', () => {
    it('has rules for all expected tables', () => {
      const tables = RETENTION_RULES.map((r) => r.table);
      expect(tables).toContain('orchestration_runs');
      expect(tables).toContain('audit');
      expect(tables).toContain('dashboard_messages');
      expect(tables).toContain('scheduled_task_runs');
      expect(tables).toContain('ondemand_task_runs');
      expect(tables).toContain('mode_changes');
      expect(tables).toContain('sessions');
      expect(tables).toContain('thread_contexts');
    });

    it('orchestration_runs has cascade children and collectDeletedIds', () => {
      const rule = RETENTION_RULES.find((r) => r.table === 'orchestration_runs');
      expect(rule?.cascadeChildren).toBeDefined();
      const children = rule?.cascadeChildren ?? [];
      expect(children[0]?.table).toBe('orchestration_node_runs');
      expect(rule?.collectDeletedIds).toBe(true);
    });

    it('sessions and thread_contexts use custom cleanup handlers', () => {
      const sessionRule = RETENTION_RULES.find((r) => r.table === 'sessions');
      const threadRule = RETENTION_RULES.find((r) => r.table === 'thread_contexts');
      expect(typeof sessionRule?.run).toBe('function');
      expect(typeof threadRule?.run).toBe('function');
    });
  });
});
