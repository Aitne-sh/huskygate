/**
 * Coverage tests for orchestrator-archive.ts — targets uncovered branches:
 * - readVerifiedOutputFile: missing output_path (line 97-98)
 * - persistOutputOffload: no output_full (line 111-112)
 * - resolveStoredOutputFull: no dataDir, file integrity error
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { offloadRunOutputs, resolveStoredOutputFull } from './orchestrator-archive.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-archive-cov-'));
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

describe('orchestrator-archive coverage', () => {
  it('resolveStoredOutputFull returns output_full when it is a string', () => {
    const result = resolveStoredOutputFull('/data', {
      id: 'nr-1',
      output_full: 'inline output',
      output_path: null,
      output_bytes: null,
      output_sha256: null,
    });
    expect(result).toBe('inline output');
  });

  it('resolveStoredOutputFull returns null when no dataDir', () => {
    const result = resolveStoredOutputFull(undefined, {
      id: 'nr-1',
      output_full: null,
      output_path: 'some/path',
      output_bytes: 10,
      output_sha256: 'abc',
    });
    expect(result).toBeNull();
  });

  it('resolveStoredOutputFull returns null when no output_path', () => {
    const result = resolveStoredOutputFull('/data', {
      id: 'nr-1',
      output_full: null,
      output_path: null,
      output_bytes: null,
      output_sha256: null,
    });
    expect(result).toBeNull();
  });

  it('resolveStoredOutputFull reads file when dataDir and output_path exist', () => {
    const dataDir = makeTempDir();
    const content = 'file-based output';
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const outputDir = path.join(dataDir, 'orchestrator_outputs');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = 'orchestrator_outputs/test.txt';
    fs.writeFileSync(path.join(dataDir, outputPath), content);

    const result = resolveStoredOutputFull(dataDir, {
      id: 'nr-1',
      output_full: null,
      output_path: outputPath,
      output_bytes: Buffer.byteLength(content),
      output_sha256: hash,
    });
    expect(result).toBe(content);
  });

  it('resolveStoredOutputFull returns null on read error', () => {
    const result = resolveStoredOutputFull('/nonexistent', {
      id: 'nr-1',
      output_full: null,
      output_path: 'missing.txt',
      output_bytes: 10,
      output_sha256: 'abc',
    });
    expect(result).toBeNull();
  });

  it('offloadRunOutputs skips rows without output_full', () => {
    const db = createDb();
    const dataDir = makeTempDir();
    db.prepare(
      'INSERT INTO orchestration_node_runs (id, orchestration_run_id, node_id, output_full) VALUES (?, ?, ?, ?)',
    ).run('nr-1', 'run-1', 'node-1', null);

    const result = offloadRunOutputs(db, dataDir, 'run-1');
    expect(result.offloadedCount).toBe(0);
  });

  it('offloadRunOutputs offloads rows with output_full', () => {
    const db = createDb();
    const dataDir = makeTempDir();
    const runId = '01234567-89ab-cdef-0123-456789abcdef';
    db.prepare(
      'INSERT INTO orchestration_node_runs (id, orchestration_run_id, node_id, output_full) VALUES (?, ?, ?, ?)',
    ).run(
      'abcdef01-2345-6789-abcd-ef0123456789',
      runId,
      'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
      'some output',
    );

    const nodeRunId = 'abcdef01-2345-6789-abcd-ef0123456789';
    const result = offloadRunOutputs(db, dataDir, runId);
    expect(result.offloadedCount).toBe(1);
    const row = db
      .prepare('SELECT output_full, output_path FROM orchestration_node_runs WHERE id = ?')
      .get(nodeRunId) as { output_full: string | null; output_path: string | null };
    expect(row.output_full).toBeNull();
    expect(row.output_path).toBeTruthy();
  });
});
