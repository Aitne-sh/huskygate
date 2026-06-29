/** Coverage2 tests for orchestrator-archive: uncovered lines 97-98 (readVerifiedOutputFile missing path), 112-113 (persistOutputOffload no output_full) */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { offloadRunOutputs, resolveStoredOutputFull } from './orchestrator-archive.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-archive-cov2-'));
  tempDirs.push(dir);
  return dir;
}

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE orchestration_node_runs (
      id TEXT PRIMARY KEY,
      orchestration_run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      output_full TEXT,
      output_path TEXT,
      output_bytes INTEGER,
      output_sha256 TEXT
    );
  `);
  return db;
}

afterEach(() => {
  for (const d of tempDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe('orchestrator-archive coverage2', () => {
  it('offloadRunOutputs succeeds for valid node run with output_full (lines 97-98)', () => {
    const db = createDb();
    const dataDir = makeTempDir();
    // Use hex-only IDs that pass the SAFE_ID regex /^[a-f0-9-]+$/i
    const runId = 'a0b1c2d3-e4f5-0000-1111-aabbccddeeff';
    const nodeRunId = 'ff00ee11-dd22-cc33-bb44-aa5566778899';

    db.prepare(
      `INSERT INTO orchestration_node_runs (id, orchestration_run_id, node_id, output_full)
       VALUES (?, ?, ?, ?)`,
    ).run(nodeRunId, runId, 'a1b2c3d4', 'some output text');

    const result = offloadRunOutputs(db, dataDir, runId);
    expect(result.offloadedCount).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('persistOutputOffload returns false when no output_full (lines 112-113)', () => {
    const db = createDb();
    const dataDir = makeTempDir();

    // Insert row with NULL output_full
    db.prepare(
      `INSERT INTO orchestration_node_runs (id, orchestration_run_id, node_id, output_full)
       VALUES (?, ?, ?, ?)`,
    ).run('nr-nofull', 'run-nofull', 'n1', null);

    const result = offloadRunOutputs(db, dataDir, 'run-nofull');
    expect(result.offloadedCount).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('resolveStoredOutputFull returns null for integrity mismatch', () => {
    const dataDir = makeTempDir();
    const outputDir = path.join(dataDir, 'orchestrator_outputs');
    fs.mkdirSync(outputDir, { recursive: true });

    const content = 'the real content';
    const wrongHash = 'wrong-hash-value';
    const outputPath = 'orchestrator_outputs/mismatch.txt';
    fs.writeFileSync(path.join(dataDir, outputPath), content);

    const result = resolveStoredOutputFull(dataDir, {
      id: 'nr-mismatch',
      output_full: null,
      output_path: outputPath,
      output_bytes: Buffer.byteLength(content),
      output_sha256: wrongHash,
    });
    // Should return null due to integrity check failure
    expect(result).toBeNull();
  });
});
