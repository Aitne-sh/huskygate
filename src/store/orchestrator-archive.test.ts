/**
 * Tests for store/orchestrator-archive — archive, offload, and resolve output_full data.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  archiveAndPruneOutputFull,
  offloadRunOutputs,
  resolveStoredOutputFull,
} from './orchestrator-archive.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-archive-'));
  tempDirs.push(dir);
  return dir;
}

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE orchestration_node_runs (
      id                    TEXT PRIMARY KEY,
      orchestration_run_id  TEXT NOT NULL,
      node_id               TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'pending',
      output_full           TEXT,
      output_path           TEXT,
      output_bytes          INTEGER,
      output_sha256         TEXT,
      ended_at              TEXT,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return db;
}

function insertNodeRun(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    orchestration_run_id: string;
    output_full: string | null;
    ended_at: string | null;
  }> = {},
): string {
  const id = overrides.id ?? crypto.randomUUID();
  const runId = overrides.orchestration_run_id ?? crypto.randomUUID();
  db.prepare(
    `INSERT INTO orchestration_node_runs (id, orchestration_run_id, node_id, status, output_full, ended_at)
     VALUES (?, ?, 'node-1', 'completed', ?, ?)`,
  ).run(
    id,
    runId,
    overrides.output_full ?? 'test output',
    overrides.ended_at ?? new Date().toISOString(),
  );
  return id;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveStoredOutputFull', () => {
  it('returns output_full directly when available as string', () => {
    const result = resolveStoredOutputFull(undefined, {
      id: 'nr-1',
      output_full: 'direct content',
      output_path: null,
      output_bytes: null,
      output_sha256: null,
    });
    expect(result).toBe('direct content');
  });

  it('returns null when no dataDir and output_full is null', () => {
    const result = resolveStoredOutputFull(undefined, {
      id: 'nr-1',
      output_full: null,
      output_path: 'some/path.log',
      output_bytes: null,
      output_sha256: null,
    });
    expect(result).toBeNull();
  });

  it('returns null when no output_path', () => {
    const result = resolveStoredOutputFull('/tmp/data', {
      id: 'nr-1',
      output_full: null,
      output_path: null,
      output_bytes: null,
      output_sha256: null,
    });
    expect(result).toBeNull();
  });

  it('reads and verifies file from output_path', () => {
    const dataDir = makeTempDir();
    const content = 'archived content';
    const relPath = path.join('job-logs', 'run-1', 'nr-1.log');
    const absPath = path.join(dataDir, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf-8');

    const outputBytes = Buffer.byteLength(content, 'utf8');
    const outputSha256 = crypto.createHash('sha256').update(content).digest('hex');

    const result = resolveStoredOutputFull(dataDir, {
      id: 'nr-1',
      output_full: null,
      output_path: relPath,
      output_bytes: outputBytes,
      output_sha256: outputSha256,
    });
    expect(result).toBe(content);
  });

  it('returns null and logs warning when file read fails', () => {
    const dataDir = makeTempDir();
    const result = resolveStoredOutputFull(dataDir, {
      id: 'nr-1',
      output_full: null,
      output_path: 'job-logs/run-1/missing.log',
      output_bytes: null,
      output_sha256: null,
    });
    expect(result).toBeNull();
  });

  it('returns null when SHA-256 mismatch', () => {
    const dataDir = makeTempDir();
    const content = 'archived content';
    const relPath = path.join('job-logs', 'run-1', 'nr-2.log');
    const absPath = path.join(dataDir, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf-8');

    const result = resolveStoredOutputFull(dataDir, {
      id: 'nr-2',
      output_full: null,
      output_path: relPath,
      output_bytes: null,
      output_sha256: 'wrong-sha256',
    });
    expect(result).toBeNull();
  });

  it('returns null when byte length mismatch', () => {
    const dataDir = makeTempDir();
    const content = 'archived content';
    const relPath = path.join('job-logs', 'run-1', 'nr-3.log');
    const absPath = path.join(dataDir, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf-8');

    const result = resolveStoredOutputFull(dataDir, {
      id: 'nr-3',
      output_full: null,
      output_path: relPath,
      output_bytes: 999,
      output_sha256: null,
    });
    expect(result).toBeNull();
  });
});

describe('offloadRunOutputs', () => {
  it('offloads outputs to disk and nullifies in DB', () => {
    const db = createDb();
    const dataDir = makeTempDir();
    const runId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    insertNodeRun(db, {
      id: '11111111-2222-3333-4444-555555555555',
      orchestration_run_id: runId,
      output_full: 'offload me',
    });

    const result = offloadRunOutputs(db, dataDir, runId);
    expect(result.offloadedCount).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Verify DB is nullified
    const row = db
      .prepare('SELECT output_full, output_path FROM orchestration_node_runs WHERE id = ?')
      .get('11111111-2222-3333-4444-555555555555') as {
      output_full: string | null;
      output_path: string | null;
    };
    expect(row.output_full).toBeNull();
    expect(row.output_path).toBeTruthy();
  });

  it('returns empty when no rows with output_full', () => {
    const db = createDb();
    const dataDir = makeTempDir();
    const runId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    db.prepare(
      `INSERT INTO orchestration_node_runs (id, orchestration_run_id, node_id, status, output_full, ended_at)
       VALUES ('nr-1', ?, 'n1', 'completed', NULL, datetime('now'))`,
    ).run(runId);

    const result = offloadRunOutputs(db, dataDir, runId);
    expect(result.offloadedCount).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('skips rows with null output_full', () => {
    const db = createDb();
    const dataDir = makeTempDir();
    const runId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    // Insert row where output_full is already null (already offloaded)
    db.prepare(
      `INSERT INTO orchestration_node_runs (id, orchestration_run_id, node_id, status, output_full, ended_at)
       VALUES ('11111111-2222-3333-4444-555555555555', ?, 'n1', 'completed', NULL, datetime('now'))`,
    ).run(runId);

    const result = offloadRunOutputs(db, dataDir, runId);
    expect(result.offloadedCount).toBe(0);
  });

  it('catches errors per row and returns them', () => {
    const db = createDb();
    const dataDir = '/nonexistent/path/that/cannot/be/created';
    const runId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    insertNodeRun(db, {
      id: '11111111-2222-3333-4444-555555555555',
      orchestration_run_id: runId,
      output_full: 'will fail',
    });

    const result = offloadRunOutputs(db, dataDir, runId);
    expect(result.offloadedCount).toBe(0);
    expect(result.errors).toHaveLength(1);
  });
});

describe('archiveAndPruneOutputFull', () => {
  it('archives rows older than retention threshold', () => {
    const db = createDb();
    const dataDir = makeTempDir();
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const runId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    insertNodeRun(db, {
      id: '11111111-2222-3333-4444-555555555555',
      orchestration_run_id: runId,
      output_full: 'old output',
      ended_at: oldDate,
    });

    const result = archiveAndPruneOutputFull(db, dataDir, 7, 1000);
    expect(result.archivedCount).toBe(1);
    expect(result.errors).toHaveLength(0);

    const row = db
      .prepare('SELECT output_full FROM orchestration_node_runs WHERE id = ?')
      .get('11111111-2222-3333-4444-555555555555') as { output_full: string | null };
    expect(row.output_full).toBeNull();
  });

  it('does not archive recent rows', () => {
    const db = createDb();
    const dataDir = makeTempDir();
    const recentDate = new Date().toISOString();
    const runId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    insertNodeRun(db, {
      id: '11111111-2222-3333-4444-555555555555',
      orchestration_run_id: runId,
      output_full: 'recent output',
      ended_at: recentDate,
    });

    const result = archiveAndPruneOutputFull(db, dataDir, 7, 1000);
    expect(result.archivedCount).toBe(0);
  });

  it('enforces maxRows cap by archiving excess', () => {
    const db = createDb();
    const dataDir = makeTempDir();
    const recentDate = new Date().toISOString();
    const runId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    // Insert 5 recent rows
    for (let i = 0; i < 5; i++) {
      const nodeRunId = `1111111${i}-2222-3333-4444-555555555555`;
      insertNodeRun(db, {
        id: nodeRunId,
        orchestration_run_id: runId,
        output_full: `output ${i}`,
        ended_at: recentDate,
      });
    }

    const result = archiveAndPruneOutputFull(db, dataDir, 7, 2);
    // 5 rows remaining, maxRows=2, so 3 excess should be archived
    expect(result.archivedCount).toBe(3);
  });

  it('catches errors on individual archive attempts', () => {
    const db = createDb();
    const dataDir = '/nonexistent/dir';
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const runId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    insertNodeRun(db, {
      id: '11111111-2222-3333-4444-555555555555',
      orchestration_run_id: runId,
      output_full: 'fail output',
      ended_at: oldDate,
    });

    const result = archiveAndPruneOutputFull(db, dataDir, 7, 1000);
    expect(result.archivedCount).toBe(0);
    expect(result.errors).toHaveLength(1);
  });

  it('catches errors on excess archive attempts in step 4', () => {
    const db = createDb();
    const dataDir = '/nonexistent/dir';
    const recentDate = new Date().toISOString();
    const runId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    for (let i = 0; i < 3; i++) {
      const nodeRunId = `1111111${i}-2222-3333-4444-555555555555`;
      insertNodeRun(db, {
        id: nodeRunId,
        orchestration_run_id: runId,
        output_full: `output ${i}`,
        ended_at: recentDate,
      });
    }

    const result = archiveAndPruneOutputFull(db, dataDir, 7, 1);
    // 2 excess rows should fail
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('path traversal protection', () => {
  it('rejects path that escapes data directory', () => {
    const dataDir = makeTempDir();
    const result = resolveStoredOutputFull(dataDir, {
      id: 'nr-1',
      output_full: null,
      output_path: '../../../etc/passwd',
      output_bytes: null,
      output_sha256: null,
    });
    // Should be caught and return null (logged as warning)
    expect(result).toBeNull();
  });

  it('rejects unsafe ID in buildOutputRelativePath', () => {
    const db = createDb();
    const dataDir = makeTempDir();
    // Insert a row with an unsafe orchestration_run_id
    db.prepare(
      `INSERT INTO orchestration_node_runs (id, orchestration_run_id, node_id, status, output_full, ended_at)
       VALUES ('safe-id-00000000', '../evil', 'n1', 'completed', 'data', datetime('now'))`,
    ).run();

    const result = offloadRunOutputs(db, dataDir, '../evil');
    // No rows match the query since the run ID is used directly
    expect(result.offloadedCount).toBe(0);
  });
});
