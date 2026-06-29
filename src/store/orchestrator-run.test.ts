import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { OrchestratorRunStore } from './orchestrator-run.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE orchestration_runs (
      id TEXT PRIMARY KEY,
      orchestrator_id TEXT NOT NULL,
      status TEXT,
      triggered_by TEXT,
      triggered_user_id TEXT,
      trigger_context_json TEXT,
      started_at TEXT,
      ended_at TEXT,
      error_message TEXT,
      rerun_from_run_id TEXT,
      rerun_from_node_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE orchestration_node_runs (
      id TEXT PRIMARY KEY,
      orchestration_run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      job_id TEXT,
      session_key TEXT,
      status TEXT,
      prompt TEXT,
      return_value TEXT,
      exit_code INTEGER,
      output_summary TEXT,
      output_full TEXT,
      output_path TEXT,
      output_bytes INTEGER,
      output_sha256 TEXT,
      error_message TEXT,
      gate_evaluation TEXT,
      retry_count INTEGER,
      started_at TEXT,
      ended_at TEXT
    );
  `);
  return db;
}

describe('OrchestratorRunStore', () => {
  let db: Database.Database | null = null;
  let dataDir: string | null = null;

  afterEach(() => {
    db?.close();
    db = null;
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
      dataDir = null;
    }
  });

  it('returns only completed terminal run ids ordered newest first', () => {
    db = createDb();
    const store = new OrchestratorRunStore(db);

    db.prepare(
      `INSERT INTO orchestration_runs (
        id, orchestrator_id, status, triggered_by, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run('run-running', 'orch-1', 'running', 'dashboard', '2026-03-01T00:00:00.000Z');
    db.prepare(
      `INSERT INTO orchestration_runs (
        id, orchestrator_id, status, triggered_by, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run('run-old-complete', 'orch-1', 'completed', 'dashboard', '2026-03-02T00:00:00.000Z');
    db.prepare(
      `INSERT INTO orchestration_runs (
        id, orchestrator_id, status, triggered_by, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run('run-failed', 'orch-1', 'failed', 'dashboard', '2026-03-03T00:00:00.000Z');
    db.prepare(
      `INSERT INTO orchestration_runs (
        id, orchestrator_id, status, triggered_by, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run('run-other', 'orch-2', 'completed', 'dashboard', '2026-03-04T00:00:00.000Z');

    expect(store.getCompletedRunIds('orch-1')).toEqual(['run-failed', 'run-old-complete']);
  });

  it('offloads node-run output to disk and keeps getNodeRunById backward-compatible', () => {
    db = createDb();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-run-store-'));
    const store = new OrchestratorRunStore(db, dataDir);

    db.prepare(
      `INSERT INTO orchestration_runs (
        id, orchestrator_id, status, triggered_by, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      'orch-1',
      'completed',
      'dashboard',
      '2026-03-01T00:00:00.000Z',
    );
    db.prepare(
      `INSERT INTO orchestration_node_runs (
        id, orchestration_run_id, node_id, status, output_full, ended_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      '11111111-2222-3333-4444-555555555555',
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      'node-1',
      'completed',
      'full output',
      '2026-03-01T00:05:00.000Z',
    );

    const result = store.offloadRunOutputs('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    const row = db
      .prepare(
        'SELECT output_full, output_path, output_bytes, output_sha256 FROM orchestration_node_runs WHERE id = ?',
      )
      .get('11111111-2222-3333-4444-555555555555') as {
      output_full: string | null;
      output_path: string | null;
      output_bytes: number | null;
      output_sha256: string | null;
    };

    expect(result).toEqual({ offloadedCount: 1, errors: [] });
    expect(row.output_full).toBeNull();
    expect(row.output_path).toBe(
      path.join(
        'job-logs',
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        '11111111-2222-3333-4444-555555555555.log',
      ),
    );
    expect(row.output_bytes).toBe(Buffer.byteLength('full output', 'utf8'));
    expect(row.output_sha256).toHaveLength(64);
    expect(
      fs.existsSync(
        path.join(
          dataDir,
          'job-logs',
          'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          '11111111-2222-3333-4444-555555555555.log',
        ),
      ),
    ).toBe(true);
    expect(store.getNodeRunById('11111111-2222-3333-4444-555555555555')?.outputFull).toBe(
      'full output',
    );
  });

  it('returns error when offloadRunOutputs is called without dataDir', () => {
    db = createDb();
    const store = new OrchestratorRunStore(db);

    const result = store.offloadRunOutputs('any-run-id');
    expect(result).toEqual({
      offloadedCount: 0,
      errors: ['dataDir is not configured for OrchestratorRunStore'],
    });
  });

  it('treats tampered offloaded output as unreadable', () => {
    db = createDb();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-run-store-'));
    const store = new OrchestratorRunStore(db, dataDir);

    db.prepare(
      `INSERT INTO orchestration_runs (
        id, orchestrator_id, status, triggered_by, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      'orch-1',
      'completed',
      'dashboard',
      '2026-03-01T00:00:00.000Z',
    );
    db.prepare(
      `INSERT INTO orchestration_node_runs (
        id, orchestration_run_id, node_id, status, output_full, ended_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      '11111111-2222-3333-4444-555555555555',
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      'node-1',
      'completed',
      'full output',
      '2026-03-01T00:05:00.000Z',
    );

    expect(store.offloadRunOutputs('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toEqual({
      offloadedCount: 1,
      errors: [],
    });

    fs.writeFileSync(
      path.join(
        dataDir,
        'job-logs',
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        '11111111-2222-3333-4444-555555555555.log',
      ),
      'tampered output',
      'utf-8',
    );

    expect(store.getNodeRunById('11111111-2222-3333-4444-555555555555')?.outputFull).toBeNull();
  });
});
