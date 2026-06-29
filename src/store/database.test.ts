import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, ensureSchema, getDb, initDatabase } from './database.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-db-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  closeDatabase();
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors in tests
    }
  }
});

describe('database', () => {
  it('throws when getDb is called before init', () => {
    expect(() => getDb()).toThrow(/Database not initialized/);
  });

  it('initializes sqlite schema and exposes shared db instance', () => {
    const dataDir = createTempDir();
    const db = initDatabase(dataDir);
    const dbPath = path.join(dataDir, 'orchestrator.db');

    expect(db).toBe(getDb());
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    if (process.platform !== 'win32') {
      expect(fs.statSync(dbPath).mode & 0o777).toBe(0o600);
    }

    const sessionsTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'")
      .get() as { name: string } | undefined;
    const auditTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit'")
      .get() as { name: string } | undefined;
    const jobQueueTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'job_queue'")
      .get() as { name: string } | undefined;
    const orchestratorColumns = db.prepare('PRAGMA table_info(orchestrators)').all() as Array<{
      name: string;
    }>;
    const runColumns = db.prepare('PRAGMA table_info(orchestration_runs)').all() as Array<{
      name: string;
    }>;
    const nodeRunColumns = db.prepare('PRAGMA table_info(orchestration_node_runs)').all() as Array<{
      name: string;
    }>;

    expect(sessionsTable?.name).toBe('sessions');
    expect(auditTable?.name).toBe('audit');
    expect(jobQueueTable?.name).toBe('job_queue');
    expect(orchestratorColumns.some((column) => column.name === 'start_node_id')).toBe(true);
    expect(runColumns.some((column) => column.name === 'trigger_context_json')).toBe(true);
    expect(nodeRunColumns.some((column) => column.name === 'output_path')).toBe(true);
    expect(nodeRunColumns.some((column) => column.name === 'output_bytes')).toBe(true);
    expect(nodeRunColumns.some((column) => column.name === 'output_sha256')).toBe(true);
  });

  it('enforces unique webhook targets via schema indexes', () => {
    const db = new Database(':memory:');
    ensureSchema(db);

    // Insert first subscription for a triggered task
    db.prepare(
      `INSERT INTO event_subscriptions (
        id, endpoint_id, target_type, triggered_task_id, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('sub-1', 'ep-1', 'triggered_task', 'task-1', 1, '2026-01-01', '2026-01-01');

    // Duplicate triggered_task_id violates unique index
    expect(() =>
      db
        .prepare(
          `INSERT INTO event_subscriptions (
          id, endpoint_id, target_type, triggered_task_id, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('sub-dup', 'ep-2', 'triggered_task', 'task-1', 1, '2026-01-01', '2026-01-01'),
    ).toThrow(/UNIQUE/);

    // Insert first subscription for an orchestrator
    db.prepare(
      `INSERT INTO event_subscriptions (
        id, endpoint_id, target_type, orchestrator_id, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('sub-2', 'ep-1', 'orchestrator', 'orch-1', 1, '2026-01-01', '2026-01-01');

    // Duplicate orchestrator_id violates unique index
    expect(() =>
      db
        .prepare(
          `INSERT INTO event_subscriptions (
          id, endpoint_id, target_type, orchestrator_id, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('sub-dup2', 'ep-2', 'orchestrator', 'orch-1', 1, '2026-01-01', '2026-01-01'),
    ).toThrow(/UNIQUE/);

    db.close();
  });

  it('closes database and resets singleton', () => {
    initDatabase(createTempDir());
    closeDatabase();
    expect(() => getDb()).toThrow(/Database not initialized/);
  });

  it('is safe to call closeDatabase multiple times', () => {
    initDatabase(createTempDir());
    closeDatabase();
    expect(() => closeDatabase()).not.toThrow();
  });
});
