/** @module orchestrator-archive — Archive and prune node-run output_full data from DB to disk */
/**
 * Output Full Archive — archive old output_full data to disk.
 *
 * Extracted from OrchestratorStore (Phase 2 split).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { writePrivateFile } from '../utils/fs-security.js';
import { logger } from '../utils/logger.js';

interface ArchivableRow {
  id: string;
  orchestration_run_id: string;
  output_full: string | null;
  output_path?: string | null;
  output_bytes?: number | null;
  output_sha256?: string | null;
}

interface OutputStorageRow extends ArchivableRow {
  output_full: string | null;
}

interface OutputFileMetadata {
  outputPath: string;
  outputBytes: number;
  outputSha256: string;
}

const SAFE_ID = /^[a-f0-9-]+$/i;

function assertSafeId(id: string, label: string): void {
  if (!SAFE_ID.test(id)) {
    throw new Error(`Invalid ${label} format: ${id}`);
  }
}

function buildOutputRelativePath(orchestrationRunId: string, nodeRunId: string): string {
  assertSafeId(orchestrationRunId, 'orchestration_run_id');
  assertSafeId(nodeRunId, 'node_run_id');
  return path.join('job-logs', orchestrationRunId, `${nodeRunId}.log`);
}

function resolveOutputAbsolutePath(dataDir: string, relativePath: string): string {
  const absolutePath = path.resolve(dataDir, relativePath);
  const dataRoot = path.resolve(dataDir);
  if (absolutePath !== dataRoot && !absolutePath.startsWith(`${dataRoot}${path.sep}`)) {
    throw new Error(`Output path escapes data directory: ${relativePath}`);
  }
  return absolutePath;
}

function writeNodeRunOutput(
  dataDir: string,
  row: Pick<ArchivableRow, 'id' | 'orchestration_run_id'>,
  outputFull: string,
): OutputFileMetadata {
  const outputPath = buildOutputRelativePath(row.orchestration_run_id, row.id);
  const absolutePath = resolveOutputAbsolutePath(dataDir, outputPath);
  writePrivateFile(absolutePath, outputFull, { encoding: 'utf-8' });

  return {
    outputPath,
    outputBytes: Buffer.byteLength(outputFull, 'utf8'),
    outputSha256: crypto.createHash('sha256').update(outputFull).digest('hex'),
  };
}

function verifyOutputIntegrity(
  row: Pick<ArchivableRow, 'id' | 'output_bytes' | 'output_sha256'>,
  outputFull: string,
): void {
  const outputBytes = Buffer.byteLength(outputFull, 'utf8');
  if (typeof row.output_bytes === 'number' && row.output_bytes !== outputBytes) {
    throw new Error(
      `Output byte length mismatch for ${row.id}: expected ${row.output_bytes}, got ${outputBytes}`,
    );
  }

  if (typeof row.output_sha256 === 'string' && row.output_sha256.length > 0) {
    const actualSha256 = crypto.createHash('sha256').update(outputFull).digest('hex');
    if (actualSha256 !== row.output_sha256) {
      throw new Error(`Output SHA-256 mismatch for ${row.id}`);
    }
  }
}

function readVerifiedOutputFile(
  dataDir: string,
  row: Pick<OutputStorageRow, 'id' | 'output_path' | 'output_bytes' | 'output_sha256'>,
): string {
  if (!row.output_path) {
    throw new Error(`Missing output_path for ${row.id}`);
  }

  const absolutePath = resolveOutputAbsolutePath(dataDir, row.output_path);
  const outputFull = fs.readFileSync(absolutePath, 'utf-8');
  verifyOutputIntegrity(row, outputFull);
  return outputFull;
}

function persistOutputOffload(
  db: Database.Database,
  dataDir: string,
  row: OutputStorageRow,
): boolean {
  if (!row.output_full) {
    return false;
  }

  const metadata = writeNodeRunOutput(dataDir, row, row.output_full);
  readVerifiedOutputFile(dataDir, {
    id: row.id,
    output_path: metadata.outputPath,
    output_bytes: metadata.outputBytes,
    output_sha256: metadata.outputSha256,
  });
  db.prepare(
    `UPDATE orchestration_node_runs
        SET output_path = ?, output_bytes = ?, output_sha256 = ?, output_full = NULL
      WHERE id = ?`,
  ).run(metadata.outputPath, metadata.outputBytes, metadata.outputSha256, row.id);
  return true;
}

export function resolveStoredOutputFull(
  dataDir: string | undefined,
  row: Pick<
    OutputStorageRow,
    'id' | 'output_full' | 'output_path' | 'output_bytes' | 'output_sha256'
  >,
): string | null {
  if (typeof row.output_full === 'string') {
    return row.output_full;
  }

  if (!dataDir || !row.output_path) {
    return null;
  }

  try {
    return readVerifiedOutputFile(dataDir, row);
  } catch (err) {
    logger.warn('node_run_output_read_failed', {
      nodeRunId: row.id,
      path: row.output_path,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export function offloadRunOutputs(
  db: Database.Database,
  dataDir: string,
  orchestrationRunId: string,
): { offloadedCount: number; errors: string[] } {
  const rows = db
    .prepare(
      `SELECT id, orchestration_run_id, output_full, output_path, output_bytes, output_sha256
         FROM orchestration_node_runs
        WHERE orchestration_run_id = ? AND output_full IS NOT NULL`,
    )
    .all(orchestrationRunId) as OutputStorageRow[];

  const errors: string[] = [];
  let offloadedCount = 0;

  for (const row of rows) {
    try {
      if (persistOutputOffload(db, dataDir, row)) {
        offloadedCount++;
      }
    } catch (err) {
      errors.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { offloadedCount, errors };
}

/**
 * Archive old output_full data to disk and set to NULL in DB.
 *
 * Step 1: Find rows where output_full IS NOT NULL and ended_at < retentionDays ago.
 * Step 2: Write each to `<dataDir>/job-logs/<orchestration_run_id>/<node_run_id>.log`.
 * Step 3: Set output_full = NULL for archived rows.
 * Step 4: If total non-null rows exceed maxRows, archive oldest beyond the limit.
 */
export function archiveAndPruneOutputFull(
  db: Database.Database,
  dataDir: string,
  retentionDays = 7,
  maxRows = 1000,
): { archivedCount: number; errors: string[] } {
  const errors: string[] = [];
  let archivedCount = 0;

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  // Step 1–3: Archive rows older than retentionDays
  const oldRows = db
    .prepare(
      `SELECT id, orchestration_run_id, output_full, output_path, output_bytes, output_sha256
       FROM orchestration_node_runs
       WHERE output_full IS NOT NULL AND ended_at IS NOT NULL AND ended_at < ?
       ORDER BY ended_at ASC`,
    )
    .all(cutoff) as ArchivableRow[];

  for (const row of oldRows) {
    try {
      archiveNodeRunOutput(db, dataDir, row);
      archivedCount++;
    } catch (err) {
      errors.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Step 4: If remaining non-null rows exceed maxRows, archive oldest beyond the cap
  const remainingCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS cnt
       FROM orchestration_node_runs
       WHERE output_full IS NOT NULL AND ended_at IS NOT NULL`,
      )
      .get() as { cnt: number }
  ).cnt;

  if (remainingCount > maxRows) {
    const excess = db
      .prepare(
        `SELECT id, orchestration_run_id, output_full, output_path, output_bytes, output_sha256
         FROM orchestration_node_runs
         WHERE output_full IS NOT NULL AND ended_at IS NOT NULL
         ORDER BY ended_at ASC
         LIMIT ?`,
      )
      .all(remainingCount - maxRows) as ArchivableRow[];
    for (const row of excess) {
      try {
        archiveNodeRunOutput(db, dataDir, row);
        archivedCount++;
      } catch (err) {
        errors.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return { archivedCount, errors };
}

/** Write output_full to a log file and NULL-ify it in the DB. */
function archiveNodeRunOutput(db: Database.Database, dataDir: string, row: ArchivableRow): void {
  persistOutputOffload(db, dataDir, row);
}
