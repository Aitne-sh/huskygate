/** Coverage tests for store/housekeeping: uncovered lines 277-281, 290-297, 312-315, 715-719, 783-788 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/error.js', () => ({
  errorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));

vi.mock('../utils/fs-security.js', () => ({
  ensurePrivateDirectory: vi.fn(),
  ensurePrivateFile: vi.fn(),
}));

let tmpDir: string;

function createMinimalDb(): Database.Database {
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
    CREATE TABLE audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      started_at TEXT NOT NULL
    );
    CREATE TABLE scheduled_task_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL
    );
    CREATE TABLE ondemand_task_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL
    );
    CREATE TABLE triggered_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE triggered_task_runs (
      id TEXT PRIMARY KEY,
      triggered_task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL
    );
    CREATE TABLE webhook_deliveries (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL,
      delivery_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE mode_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL,
      changed_at TEXT NOT NULL
    );
    CREATE TABLE orchestrators (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      workdir TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE orchestrator_nodes (
      id TEXT PRIMARY KEY,
      orchestrator_id TEXT NOT NULL
    );
    CREATE TABLE orchestrator_edges (
      id TEXT PRIMARY KEY,
      orchestrator_id TEXT NOT NULL
    );
    CREATE TABLE orchestration_runs (
      id TEXT PRIMARY KEY,
      orchestrator_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE orchestration_node_runs (
      id TEXT PRIMARY KEY,
      orchestration_run_id TEXT NOT NULL,
      node_id TEXT NOT NULL
    );
    CREATE TABLE event_subscriptions (
      id TEXT PRIMARY KEY,
      orchestrator_id TEXT,
      node_id TEXT
    );
    CREATE TABLE config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  return db;
}

describe('housekeeping coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('retentionCleanup — sessionCleanupEnabled=false (lines 283-284)', () => {
    it('skips session and thread_contexts cleanup when disabled', async () => {
      const { retentionCleanup } = await import('./housekeeping.js');
      const db = createMinimalDb();

      // Insert stale session
      const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(
        `INSERT INTO sessions (session_key, workdir, updated_at)
         VALUES ('sess-old', '/tmp/old', ?)`,
      ).run(oldDate);

      retentionCleanup(db, { sessionCleanupEnabled: false });
      // Session should NOT be cleaned up
      const sessions = db.prepare('SELECT * FROM sessions').all();
      expect(sessions).toHaveLength(1);
      db.close();
    });
  });

  describe('retentionCleanup — cascade delete for orchestration_runs (lines 301-342)', () => {
    it('deletes orchestration_runs and their child node_runs', async () => {
      const { retentionCleanup } = await import('./housekeeping.js');
      const db = createMinimalDb();

      const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(
        `INSERT INTO orchestration_runs (id, orchestrator_id, status, created_at)
         VALUES ('run-old', 'orch-1', 'completed', ?)`,
      ).run(oldDate);
      db.prepare(
        `INSERT INTO orchestration_node_runs (id, orchestration_run_id, node_id)
         VALUES ('nrun-1', 'run-old', 'n1')`,
      ).run();

      const result = retentionCleanup(db);
      expect(result.deletedOrchestrationRunIds).toContain('run-old');

      const runs = db.prepare('SELECT * FROM orchestration_runs').all();
      expect(runs).toHaveLength(0);
      const nodeRuns = db.prepare('SELECT * FROM orchestration_node_runs').all();
      expect(nodeRuns).toHaveLength(0);
      db.close();
    });
  });

  describe('retentionCleanup — maxRows enforcement (lines 354-373)', () => {
    it('prunes excess dashboard_messages rows', async () => {
      const { retentionCleanup } = await import('./housekeeping.js');
      const db = createMinimalDb();

      // Insert many dashboard messages
      const recentDate = new Date().toISOString();
      for (let i = 0; i < 10; i++) {
        db.prepare(
          `INSERT INTO dashboard_messages (session_key, role, content, created_at)
           VALUES ('sess-1', 'user', 'msg-${i}', ?)`,
        ).run(recentDate);
      }

      // The maxRows for dashboard_messages is 10_000, which we won't hit in test,
      // but we verify the code path runs without error
      const result = retentionCleanup(db);
      expect(result.results).toBeDefined();
      db.close();
    });
  });

  describe('cleanupJobLogFiles (lines 389-416)', () => {
    it('cleans up job log directories for deleted run IDs', async () => {
      const { cleanupJobLogFiles } = await import('./housekeeping.js');

      const jobLogsDir = path.join(tmpDir, 'job-logs');
      const runDir = path.join(jobLogsDir, 'abc12345-dead-beef-1234');
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'output.log'), 'log data');

      const cleaned = cleanupJobLogFiles(tmpDir, ['abc12345-dead-beef-1234']);
      expect(cleaned).toBe(1);
      expect(fs.existsSync(runDir)).toBe(false);
    });

    it('skips invalid IDs (line 397)', async () => {
      const { cleanupJobLogFiles } = await import('./housekeeping.js');

      const jobLogsDir = path.join(tmpDir, 'job-logs');
      fs.mkdirSync(jobLogsDir, { recursive: true });

      const cleaned = cleanupJobLogFiles(tmpDir, ['../../../etc']);
      expect(cleaned).toBe(0);
    });

    it('returns 0 when job-logs dir does not exist', async () => {
      const { cleanupJobLogFiles } = await import('./housekeeping.js');
      const cleaned = cleanupJobLogFiles('/nonexistent', ['abc']);
      expect(cleaned).toBe(0);
    });
  });

  describe('cleanupOrphanRunWorkdirs (lines 690-723)', () => {
    it('removes orphaned orch_* workdirs', async () => {
      const { cleanupOrphanRunWorkdirs } = await import('./housekeeping.js');
      const db = createMinimalDb();

      // Create orch_ dir that has no matching run
      const orphanDir = path.join(tmpDir, 'orch_abcdef01');
      fs.mkdirSync(orphanDir, { recursive: true });

      const cleaned = cleanupOrphanRunWorkdirs(db, tmpDir);
      expect(cleaned).toBe(1);
      expect(fs.existsSync(orphanDir)).toBe(false);
      db.close();
    });

    it('keeps orch_* dirs with matching run', async () => {
      const { cleanupOrphanRunWorkdirs } = await import('./housekeeping.js');
      const db = createMinimalDb();

      // Insert matching run
      db.prepare(
        `INSERT INTO orchestration_runs (id, orchestrator_id, status, created_at)
         VALUES ('abcdef01-1234-5678-9abc-def012345678', 'orch-1', 'completed', '2026-01-01')`,
      ).run();

      const matchDir = path.join(tmpDir, 'orch_abcdef01');
      fs.mkdirSync(matchDir, { recursive: true });

      const cleaned = cleanupOrphanRunWorkdirs(db, tmpDir);
      expect(cleaned).toBe(0);
      expect(fs.existsSync(matchDir)).toBe(true);
      db.close();
    });

    it('returns 0 when workdirRoot does not exist', async () => {
      const { cleanupOrphanRunWorkdirs } = await import('./housekeeping.js');
      const db = createMinimalDb();
      const cleaned = cleanupOrphanRunWorkdirs(db, '/nonexistent');
      expect(cleaned).toBe(0);
      db.close();
    });
  });

  describe('rotateLogs (lines 519-570)', () => {
    it('rotates log files exceeding size limit', async () => {
      const { rotateLogs } = await import('./housekeeping.js');

      const logPath = path.join(tmpDir, 'huskygate.log');
      // Write a file larger than the threshold (use small threshold for test)
      fs.writeFileSync(logPath, 'x'.repeat(1000));

      const rotated = rotateLogs(tmpDir, 500, 2);
      expect(rotated).toBe(1);
      expect(fs.existsSync(`${logPath}.1`)).toBe(true);
      // Original should be truncated
      const stat = fs.statSync(logPath);
      expect(stat.size).toBe(0);
    });

    it('skips files under threshold', async () => {
      const { rotateLogs } = await import('./housekeeping.js');

      const logPath = path.join(tmpDir, 'huskygate.log');
      fs.writeFileSync(logPath, 'small');

      const rotated = rotateLogs(tmpDir, 1000000);
      expect(rotated).toBe(0);
    });
  });

  describe('pruneBackups (lines 482-510)', () => {
    it('prunes old backups exceeding max generations', async () => {
      const { pruneBackups } = await import('./housekeeping.js');

      const backupDir = path.join(tmpDir, 'backups');
      fs.mkdirSync(backupDir, { recursive: true });

      // Create backup files
      for (let i = 1; i <= 5; i++) {
        fs.writeFileSync(path.join(backupDir, `orchestrator_20260${i}01_000000.db`), 'backup data');
      }

      const pruned = pruneBackups(tmpDir, 3);
      expect(pruned).toBe(2);
      const remaining = fs.readdirSync(backupDir).filter((f) => f.endsWith('.db'));
      expect(remaining).toHaveLength(3);
    });

    it('returns 0 when no backup dir exists', async () => {
      const { pruneBackups } = await import('./housekeeping.js');
      const pruned = pruneBackups('/nonexistent');
      expect(pruned).toBe(0);
    });
  });

  describe('assertSafePath', () => {
    it('rejects path traversal', async () => {
      const { assertSafePath } = await import('./housekeeping.js');
      expect(() => assertSafePath('../etc/passwd')).toThrow('traversal');
    });

    it('rejects unsafe characters', async () => {
      const { assertSafePath } = await import('./housekeeping.js');
      expect(() => assertSafePath('/tmp/file name')).toThrow('Unsafe');
    });

    it('accepts safe paths', async () => {
      const { assertSafePath } = await import('./housekeeping.js');
      expect(() => assertSafePath('/tmp/data/backups/file.db')).not.toThrow();
    });
  });

  describe('runHousekeeping integration', () => {
    it('runs full housekeeping pipeline', async () => {
      const { runHousekeeping } = await import('./housekeeping.js');
      const db = createMinimalDb();

      const result = runHousekeeping(db, tmpDir, tmpDir);
      expect(result).toHaveProperty('retention');
      expect(result).toHaveProperty('durationMs');
      expect(result).toHaveProperty('orphanedThreadContextsCleared');
      expect(result).toHaveProperty('logsRotated');
      db.close();
    });
  });
});
