/** @module housekeeping — Periodic retention cleanup, backup, log rotation, and orphan purge. */
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { RETRY_LIMITS, SIZE_LIMITS } from '../shared/constants.js';
import { errorMessage } from '../utils/error.js';
import { ensurePrivateDirectory, ensurePrivateFile } from '../utils/fs-security.js';
import { logger } from '../utils/logger.js';

// ── Retention Configuration ─────────────────────────────────────

interface RetentionRule {
  table: string;
  retentionDays: number;
  timestampColumn?: string;
  keyColumn?: string;
  maxRows?: number;
  /** Tables whose rows must be deleted before this table (cascade). */
  cascadeChildren?: { table: string; fkColumn: string }[];
  /** If true, collect deleted parent IDs for file cleanup. */
  collectDeletedIds?: boolean;
  /** Custom retention logic for rules that span multiple related tables. */
  run?: (
    db: Database.Database,
    cutoff: string,
  ) => {
    deletedCount: number;
    deletedIds?: string[];
  };
}

const RETENTION_RULES: RetentionRule[] = [
  // Orchestration: delete node_runs first (child), then runs (parent)
  {
    table: 'orchestration_runs',
    timestampColumn: 'created_at',
    retentionDays: 90,
    cascadeChildren: [{ table: 'orchestration_node_runs', fkColumn: 'orchestration_run_id' }],
    collectDeletedIds: true, // needed for job-log file cleanup
  },
  {
    table: 'audit',
    timestampColumn: 'started_at',
    retentionDays: 90,
  },
  {
    table: 'dashboard_messages',
    timestampColumn: 'created_at',
    retentionDays: 30,
    maxRows: 10_000,
  },
  {
    table: 'scheduled_task_runs',
    timestampColumn: 'started_at',
    retentionDays: 60,
  },
  {
    table: 'ondemand_task_runs',
    timestampColumn: 'started_at',
    retentionDays: 60,
  },
  {
    table: 'triggered_task_runs',
    timestampColumn: 'started_at',
    retentionDays: 60,
  },
  {
    table: 'webhook_deliveries',
    timestampColumn: 'updated_at',
    retentionDays: 7,
  },
  {
    table: 'mode_changes',
    timestampColumn: 'changed_at',
    retentionDays: 30,
  },
  {
    table: 'sessions',
    retentionDays: 90,
    run: cleanupStaleSessionGraph,
  },
  {
    table: 'thread_contexts',
    retentionDays: 90,
    run: cleanupStaleThreadContexts,
  },
];

// ── Backup Configuration ────────────────────────────────────────

const BACKUP_DIR_NAME = 'backups';
const MAX_BACKUP_GENERATIONS = RETRY_LIMITS.backupGenerations;

// ── Log Rotation Configuration ──────────────────────────────────

const LOG_FILES = ['huskygate.log', 'dashboard.log'];
const LOG_MAX_BYTES = SIZE_LIMITS.logRotationMax;
const LOG_MAX_ROTATIONS = RETRY_LIMITS.logRotations;

// ── Path Validation ─────────────────────────────────────────────

// Allowlist: alphanumeric, slashes, underscores, hyphens, single dots
const SAFE_PATH_PATTERN = /^[a-zA-Z0-9/_.\-]+$/;

function assertSafePath(p: string): void {
  if (!SAFE_PATH_PATTERN.test(p)) {
    throw new Error(`Unsafe path characters: ${p}`);
  }
  // Reject path traversal sequences even if individual chars pass
  if (p.includes('..')) {
    throw new Error(`Path traversal rejected: ${p}`);
  }
}

// Safe ID pattern for file paths (UUID-like hex strings)
const SAFE_ID = /^[a-f0-9-]+$/i;

// ── Retention Cleanup ───────────────────────────────────────────

interface RetentionResult {
  table: string;
  deletedCount: number;
}

interface RetentionOutput {
  results: RetentionResult[];
  /** orchestration_run IDs that were deleted (for job-log cleanup). */
  deletedOrchestrationRunIds: string[];
  /** Session keys deleted by session-graph cleanup (for false-positive monitoring). */
  cleanedSessionKeys: string[];
}

interface SessionIntegrityAuditResult {
  orphanedThreadContextsCleared: number;
  orphanedSessionMcpRows: number;
}

function backfillSessionActivityFromMessages(db: Database.Database): void {
  db.prepare(
    `UPDATE sessions
        SET updated_at = (
          SELECT MAX(dm.created_at)
            FROM dashboard_messages dm
           WHERE dm.session_key = sessions.session_key
        )
      WHERE EXISTS (
        SELECT 1
          FROM dashboard_messages dm
         WHERE dm.session_key = sessions.session_key
           AND dm.created_at > sessions.updated_at
      )`,
  ).run();
}

function deleteByIdsInBatches(
  db: Database.Database,
  table: string,
  column: string,
  ids: string[],
): number {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const placeholders = batch.map(() => '?').join(',');
    deleted += db
      .prepare(`DELETE FROM ${table} WHERE ${column} IN (${placeholders})`)
      .run(...batch).changes;
  }
  return deleted;
}

function cleanupStaleSessionGraph(
  db: Database.Database,
  cutoff: string,
): { deletedCount: number; deletedIds?: string[] } {
  const txn = db.transaction(() => {
    const staleSessionKeys = (
      db
        .prepare(
          `SELECT session_key
             FROM sessions
            WHERE running_job_id IS NULL
              AND updated_at < ?`,
        )
        .all(cutoff) as { session_key: string }[]
    ).map((row) => row.session_key);

    if (staleSessionKeys.length === 0) {
      return { deletedCount: 0, deletedIds: [] as string[] };
    }

    const now = new Date().toISOString();
    for (let i = 0; i < staleSessionKeys.length; i += 500) {
      const batch = staleSessionKeys.slice(i, i + 500);
      const placeholders = batch.map(() => '?').join(',');
      db.prepare(
        `UPDATE thread_contexts
            SET active_session_key = NULL, updated_at = ?
          WHERE active_session_key IN (${placeholders})`,
      ).run(now, ...batch);
    }

    deleteByIdsInBatches(db, 'dashboard_messages', 'session_key', staleSessionKeys);
    deleteByIdsInBatches(db, 'session_mcp_servers', 'session_key', staleSessionKeys);
    deleteByIdsInBatches(db, 'session_registry', 'session_key', staleSessionKeys);
    deleteByIdsInBatches(db, 'sessions', 'session_key', staleSessionKeys);

    return { deletedCount: staleSessionKeys.length, deletedIds: staleSessionKeys };
  });

  return txn();
}

function cleanupStaleThreadContexts(
  db: Database.Database,
  cutoff: string,
): { deletedCount: number } {
  const result = db
    .prepare(
      `DELETE FROM thread_contexts
        WHERE active_session_key IS NULL
          AND last_activity_at < ?`,
    )
    .run(cutoff);
  return { deletedCount: result.changes };
}

function auditSessionIntegrity(db: Database.Database): SessionIntegrityAuditResult {
  const now = new Date().toISOString();
  const orphanedThreadKeys = (
    db
      .prepare(
        `SELECT tc.thread_key
           FROM thread_contexts tc
           LEFT JOIN sessions s ON s.session_key = tc.active_session_key
          WHERE tc.active_session_key IS NOT NULL
            AND s.session_key IS NULL`,
      )
      .all() as { thread_key: string }[]
  ).map((row) => row.thread_key);

  let orphanedThreadContextsCleared = 0;
  if (orphanedThreadKeys.length > 0) {
    for (let i = 0; i < orphanedThreadKeys.length; i += 500) {
      const batch = orphanedThreadKeys.slice(i, i + 500);
      const placeholders = batch.map(() => '?').join(',');
      orphanedThreadContextsCleared += db
        .prepare(
          `UPDATE thread_contexts
              SET active_session_key = NULL, updated_at = ?
            WHERE thread_key IN (${placeholders})`,
        )
        .run(now, ...batch).changes;
    }
  }

  const orphanedSessionMcpRows = db
    .prepare(
      `DELETE FROM session_mcp_servers
        WHERE session_key NOT IN (SELECT session_key FROM sessions)`,
    )
    .run().changes;

  return {
    orphanedThreadContextsCleared,
    orphanedSessionMcpRows,
  };
}

function retentionCleanup(
  db: Database.Database,
  opts?: { sessionCleanupEnabled?: boolean },
): RetentionOutput {
  const results: RetentionResult[] = [];
  const deletedOrchestrationRunIds: string[] = [];
  const cleanedSessionKeys: string[] = [];
  const sessionCleanupEnabled = opts?.sessionCleanupEnabled !== false;

  backfillSessionActivityFromMessages(db);

  for (const rule of RETENTION_RULES) {
    // Skip session-related rules when feature flag is off
    if (!sessionCleanupEnabled && (rule.table === 'sessions' || rule.table === 'thread_contexts')) {
      continue;
    }
    const cutoff = new Date(Date.now() - rule.retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const cascadeChildren = rule.cascadeChildren;
    const keyColumn = rule.keyColumn ?? 'id';

    let deletedCount = 0;

    if (rule.run) {
      const customResult = rule.run(db, cutoff);
      deletedCount = customResult.deletedCount;
      if (rule.collectDeletedIds && customResult.deletedIds?.length) {
        deletedOrchestrationRunIds.push(...customResult.deletedIds);
      }
      if (rule.table === 'sessions' && customResult.deletedIds?.length) {
        cleanedSessionKeys.push(...customResult.deletedIds);
      }
    } else if (cascadeChildren?.length) {
      // Cascade delete: wrap in transaction for atomicity
      const txn = db.transaction(() => {
        // 1. Find parent IDs to delete
        const parentIds = db
          .prepare(`SELECT ${keyColumn} AS id FROM ${rule.table} WHERE ${rule.timestampColumn} < ?`)
          .all(cutoff) as { id: string }[];

        if (parentIds.length === 0) return { count: 0, ids: [] as string[] };

        const ids = parentIds.map((r) => r.id);

        // 2. Delete children in batches (SQLite variable limit = 999)
        for (const child of cascadeChildren) {
          for (let i = 0; i < ids.length; i += 500) {
            const batch = ids.slice(i, i + 500);
            const placeholders = batch.map(() => '?').join(',');
            db.prepare(
              `DELETE FROM ${child.table} WHERE ${child.fkColumn} IN (${placeholders})`,
            ).run(...batch);
          }
        }

        // 3. Delete parents
        for (let i = 0; i < ids.length; i += 500) {
          const batch = ids.slice(i, i + 500);
          const placeholders = batch.map(() => '?').join(',');
          db.prepare(`DELETE FROM ${rule.table} WHERE ${keyColumn} IN (${placeholders})`).run(
            ...batch,
          );
        }

        return { count: parentIds.length, ids };
      });

      const result = txn();
      deletedCount = result.count;

      // Collect IDs for file cleanup
      if (rule.collectDeletedIds && result.ids.length > 0) {
        deletedOrchestrationRunIds.push(...result.ids);
      }
    } else {
      // Simple age-based deletion (timestampColumn is required for this path)
      if (!rule.timestampColumn) {
        throw new Error(`Retention rule for ${rule.table} requires timestampColumn or run()`);
      }
      const result = db
        .prepare(`DELETE FROM ${rule.table} WHERE ${rule.timestampColumn} < ?`)
        .run(cutoff);
      deletedCount = result.changes;
    }

    // Max rows enforcement (if configured)
    if (rule.maxRows != null && rule.timestampColumn) {
      const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM ${rule.table}`).get() as {
        cnt: number;
      };

      if (countRow.cnt > rule.maxRows) {
        const excess = countRow.cnt - rule.maxRows;
        const pruned = db
          .prepare(
            `DELETE FROM ${rule.table} WHERE rowid IN (
              SELECT rowid FROM ${rule.table}
              ORDER BY ${rule.timestampColumn} ASC
              LIMIT ?
            )`,
          )
          .run(excess);
        deletedCount += pruned.changes;
      }
    }

    if (deletedCount > 0) {
      results.push({ table: rule.table, deletedCount });
    }
  }

  return { results, deletedOrchestrationRunIds, cleanedSessionKeys };
}

// ── Job Log File Cleanup ────────────────────────────────────────

/**
 * Remove archived job-log directories for deleted orchestration runs.
 * Each run's logs live under `data/job-logs/{run_id}/`.
 */
function cleanupJobLogFiles(dataDir: string, deletedRunIds: string[]): number {
  const jobLogsDir = path.join(dataDir, 'job-logs');
  if (!fs.existsSync(jobLogsDir)) return 0;

  let cleaned = 0;
  for (const runId of deletedRunIds) {
    // Validate ID before using in file path (defense-in-depth)
    if (!SAFE_ID.test(runId)) {
      logger.warn('job_log_cleanup_skip_invalid_id', { runId });
      continue;
    }

    const runLogDir = path.join(jobLogsDir, runId);
    if (fs.existsSync(runLogDir)) {
      try {
        fs.rmSync(runLogDir, { recursive: true, force: true });
        cleaned++;
      } catch (err) {
        logger.warn('job_log_cleanup_error', {
          runId,
          error: errorMessage(err),
        });
      }
    }
  }

  return cleaned;
}

/**
 * Scan job-logs directory and remove directories whose run ID
 * no longer exists in orchestration_runs (orphan cleanup).
 */
function cleanupOrphanedJobLogs(db: Database.Database, dataDir: string): number {
  const jobLogsDir = path.join(dataDir, 'job-logs');
  if (!fs.existsSync(jobLogsDir)) return 0;

  let cleaned = 0;
  const entries = fs.readdirSync(jobLogsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!SAFE_ID.test(entry.name)) continue;

    // Check if orchestration run still exists in DB
    const row = db.prepare('SELECT 1 FROM orchestration_runs WHERE id = ?').get(entry.name) as
      | { 1: number }
      | undefined;

    if (!row) {
      try {
        fs.rmSync(path.join(jobLogsDir, entry.name), { recursive: true, force: true });
        cleaned++;
      } catch (err) {
        logger.warn('orphan_job_log_cleanup_error', {
          dir: entry.name,
          error: errorMessage(err),
        });
      }
    }
  }

  return cleaned;
}

// ── VACUUM INTO Backup ──────────────────────────────────────────

function vacuumBackup(db: Database.Database, dataDir: string): { backupPath: string } | null {
  const backupDir = path.join(dataDir, BACKUP_DIR_NAME);
  ensurePrivateDirectory(backupDir);

  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '_')
    .replace(/\.\d{3}Z$/, '');
  const backupFileName = `orchestrator_${timestamp}.db`;
  const backupPath = path.join(backupDir, backupFileName);

  // Validate: reject SQL injection and path traversal
  assertSafePath(backupPath);

  // VACUUM INTO creates a defragmented copy atomically
  db.exec(`VACUUM INTO '${backupPath}'`);

  // Tighten file permissions — VACUUM INTO inherits OS defaults, not Node mode flags
  ensurePrivateFile(backupPath);

  return { backupPath };
}

// ── Backup Pruning ──────────────────────────────────────────────

function pruneBackups(dataDir: string, maxGenerations: number = MAX_BACKUP_GENERATIONS): number {
  const backupDir = path.join(dataDir, BACKUP_DIR_NAME);

  if (!fs.existsSync(backupDir)) return 0;

  const files = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('orchestrator_') && f.endsWith('.db'))
    .sort()
    .reverse(); // newest first

  let pruned = 0;
  if (files.length > maxGenerations) {
    const toDelete = files.slice(maxGenerations);
    for (const file of toDelete) {
      try {
        fs.unlinkSync(path.join(backupDir, file));
        pruned++;
      } catch (err) {
        logger.warn('backup_prune_error', {
          file,
          error: errorMessage(err),
        });
      }
    }
  }

  return pruned;
}

// ── Log File Rotation (copytruncate) ────────────────────────────

/**
 * Rotate log files that exceed the size threshold.
 * Uses copytruncate: copy → truncate original to 0.
 * Safe with O_APPEND file descriptors (daemon's stdout/stderr).
 */
function rotateLogs(
  dataDir: string,
  maxBytes: number = LOG_MAX_BYTES,
  maxRotations: number = LOG_MAX_ROTATIONS,
): number {
  let rotated = 0;

  for (const logFile of LOG_FILES) {
    const logPath = path.join(dataDir, logFile);
    if (!fs.existsSync(logPath)) continue;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(logPath);
    } catch {
      continue;
    }

    if (stat.size <= maxBytes) continue;

    try {
      // Shift existing rotations: .3 → delete, .2 → .3, .1 → .2
      for (let i = maxRotations; i >= 1; i--) {
        const src = i === 1 ? logPath : `${logPath}.${i - 1}`;
        const dst = `${logPath}.${i}`;
        if (i === maxRotations && fs.existsSync(dst)) {
          fs.unlinkSync(dst);
        }
        if (fs.existsSync(src) && i > 1) {
          fs.renameSync(src, dst);
        }
      }

      // copytruncate: copy current → .1, then truncate original
      fs.copyFileSync(logPath, `${logPath}.1`);
      fs.truncateSync(logPath, 0);
      rotated++;

      logger.info('log_rotated', {
        file: logFile,
        size_mb: Math.round(stat.size / 1024 / 1024),
      });
    } catch (err) {
      logger.warn('log_rotation_error', {
        file: logFile,
        error: errorMessage(err),
      });
    }
  }

  return rotated;
}

// ── Deleted Orchestrator Purge ───────────────────────────────

/** Pattern matching auto-generated orchestrator run workdir names: orch_<8-hex-chars> */
const ORCH_RUN_WORKDIR_RE = /^orch_[a-f0-9]{8}$/;

interface PurgeDeletedOrchestratorsResult {
  orchestratorsPurged: number;
  runsPurged: number;
  workdirsCleaned: number;
}

/**
 * Purge all DB records and run workdirs for soft-deleted orchestrators.
 * Cascade: node_runs → runs → nodes → edges → orchestrator row.
 */
function purgeDeletedOrchestrators(
  db: Database.Database,
  workdirRoot: string,
  dataDir: string,
): PurgeDeletedOrchestratorsResult {
  const deletedOrchestrators = db
    .prepare("SELECT id, workdir FROM orchestrators WHERE status = 'deleted'")
    .all() as { id: string; workdir: string | null }[];

  if (deletedOrchestrators.length === 0) {
    return { orchestratorsPurged: 0, runsPurged: 0, workdirsCleaned: 0 };
  }

  let totalRunsPurged = 0;
  let totalWorkdirsCleaned = 0;
  const purgedPlans: Array<{ id: string; workdir: string | null; runIds: string[] }> = [];

  const txn = db.transaction((orchestrators: { id: string; workdir: string | null }[]) => {
    for (const orch of orchestrators) {
      const activeCount = (
        db
          .prepare(
            "SELECT COUNT(*) as cnt FROM orchestration_runs WHERE orchestrator_id = ? AND status IN ('running', 'pending')",
          )
          .get(orch.id) as { cnt: number }
      ).cnt;
      if (activeCount > 0) {
        logger.warn('purge_orchestrator_skipped_active_runs', {
          orchestratorId: orch.id,
          activeRuns: activeCount,
        });
        continue;
      }

      const runIds = (
        db.prepare('SELECT id FROM orchestration_runs WHERE orchestrator_id = ?').all(orch.id) as {
          id: string;
        }[]
      ).map((r) => r.id);

      for (let i = 0; i < runIds.length; i += 500) {
        const batch = runIds.slice(i, i + 500);
        const placeholders = batch.map(() => '?').join(',');
        db.prepare(
          `DELETE FROM orchestration_node_runs WHERE orchestration_run_id IN (${placeholders})`,
        ).run(...batch);
      }

      db.prepare('DELETE FROM orchestration_runs WHERE orchestrator_id = ?').run(orch.id);
      db.prepare(
        `DELETE FROM event_subscriptions
           WHERE orchestrator_id = ?
              OR node_id IN (
                SELECT id FROM orchestrator_nodes WHERE orchestrator_id = ?
              )`,
      ).run(orch.id, orch.id);
      db.prepare('DELETE FROM orchestrator_nodes WHERE orchestrator_id = ?').run(orch.id);
      db.prepare('DELETE FROM orchestrator_edges WHERE orchestrator_id = ?').run(orch.id);
      db.prepare('DELETE FROM orchestrators WHERE id = ?').run(orch.id);

      totalRunsPurged += runIds.length;
      purgedPlans.push({ id: orch.id, workdir: orch.workdir, runIds });
    }
  });

  txn.immediate(deletedOrchestrators);

  for (const plan of purgedPlans) {
    if (!plan.workdir) {
      for (const runId of plan.runIds) {
        if (!SAFE_ID.test(runId)) continue;
        const runWorkdir = path.join(workdirRoot, `orch_${runId.slice(0, 8)}`);
        try {
          if (fs.existsSync(runWorkdir)) {
            fs.rmSync(runWorkdir, { recursive: true, force: true });
            totalWorkdirsCleaned++;
          }
        } catch (err) {
          logger.warn('purge_orchestrator_workdir_error', {
            orchestratorId: plan.id,
            runId,
            error: errorMessage(err),
          });
        }
      }
    }

    cleanupJobLogFiles(dataDir, plan.runIds);
  }

  return {
    orchestratorsPurged: purgedPlans.length,
    runsPurged: totalRunsPurged,
    workdirsCleaned: totalWorkdirsCleaned,
  };
}

// ── Orphan Run Workdir Cleanup ──────────────────────────────

/**
 * Scan workdir root for orch_* directories and remove any whose
 * run ID prefix no longer matches an existing orchestration_runs record.
 */
function cleanupOrphanRunWorkdirs(db: Database.Database, workdirRoot: string): number {
  if (!fs.existsSync(workdirRoot)) return 0;

  let cleaned = 0;
  const entries = fs.readdirSync(workdirRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!ORCH_RUN_WORKDIR_RE.test(entry.name)) continue;

    const prefix = entry.name.slice(5); // "orch_XXXXXXXX" → "XXXXXXXX"

    // Defense-in-depth: validate extracted prefix is hex
    if (!/^[a-f0-9]{8}$/.test(prefix)) continue;

    // Check if any orchestration_runs.id starts with this prefix
    const row = db
      .prepare("SELECT 1 FROM orchestration_runs WHERE id LIKE ? || '%' LIMIT 1")
      .get(prefix) as { 1: number } | undefined;

    if (!row) {
      try {
        fs.rmSync(path.join(workdirRoot, entry.name), { recursive: true, force: true });
        cleaned++;
      } catch (err) {
        logger.warn('orphan_run_workdir_cleanup_error', {
          dir: entry.name,
          error: errorMessage(err),
        });
      }
    }
  }

  return cleaned;
}

// ── Main Entry Point ────────────────────────────────────────────

export interface HousekeepingResult {
  retention: RetentionResult[];
  orphanedThreadContextsCleared: number;
  orphanedSessionMcpRows: number;
  /** Session keys deleted by session-graph retention (for false-positive monitoring). */
  cleanedSessionKeys: string[];
  jobLogsCleaned: number;
  orphanJobLogsCleaned: number;
  orchestratorsPurged: number;
  orchestratorRunsPurged: number;
  orchestratorWorkdirsCleaned: number;
  orphanRunWorkdirsCleaned: number;
  logsRotated: number;
  backup: { path: string } | null;
  backupsPruned: number;
  durationMs: number;
}

export interface HousekeepingOptions {
  /** When false, session-graph and thread_contexts retention cleanup is skipped (default: true). */
  sessionCleanupEnabled?: boolean;
}

/** Execute all housekeeping steps: retention, orphan cleanup, log rotation, backup. */
export function runHousekeeping(
  db: Database.Database,
  dataDir: string,
  workdirRoot?: string,
  options?: HousekeepingOptions,
): HousekeepingResult {
  const start = Date.now();
  const sessionCleanupEnabled = options?.sessionCleanupEnabled !== false;
  const integrity = auditSessionIntegrity(db);

  if (integrity.orphanedThreadContextsCleared > 0) {
    logger.info('thread_context_orphans_cleared', {
      count: integrity.orphanedThreadContextsCleared,
    });
  }
  if (integrity.orphanedSessionMcpRows > 0) {
    logger.warn('session_mcp_server_orphans_deleted', {
      count: integrity.orphanedSessionMcpRows,
    });
  }

  // Step 1: Retention cleanup (DB rows)
  const {
    results: retention,
    deletedOrchestrationRunIds,
    cleanedSessionKeys,
  } = retentionCleanup(db, {
    sessionCleanupEnabled,
  });

  if (cleanedSessionKeys.length > 0) {
    logger.info('session_graph_cleanup', {
      count: cleanedSessionKeys.length,
      // Log first 20 keys for post-mortem analysis without excessive noise
      sample: cleanedSessionKeys.slice(0, 20),
    });
  }

  // Step 2: Clean up job-log files for deleted orchestration runs
  let jobLogsCleaned = 0;
  if (deletedOrchestrationRunIds.length > 0) {
    jobLogsCleaned = cleanupJobLogFiles(dataDir, deletedOrchestrationRunIds);
  }

  // Step 3: Clean up orphaned job-log directories (catch-up for past deletions)
  const orphanJobLogsCleaned = cleanupOrphanedJobLogs(db, dataDir);

  // Step 4: Purge soft-deleted orchestrators (DB records + workdirs)
  const resolvedWorkdirRoot = workdirRoot ?? path.join(process.cwd(), 'workdir');
  const purgeResult = purgeDeletedOrchestrators(db, resolvedWorkdirRoot, dataDir);

  // Step 5: Clean up orphaned run workdirs (orch_* dirs with no matching run)
  const orphanRunWorkdirsCleaned = cleanupOrphanRunWorkdirs(db, resolvedWorkdirRoot);

  // Step 6: Log file rotation
  const logsRotated = rotateLogs(dataDir);

  // Step 7: VACUUM INTO backup
  let backup: { path: string } | null = null;
  try {
    const result = vacuumBackup(db, dataDir);
    if (result) {
      backup = { path: result.backupPath };
    }
  } catch (err) {
    logger.error('vacuum_backup_failed', { error: errorMessage(err) });
  }

  // Step 8: WAL checkpoint (reclaim WAL space after vacuum)
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    logger.warn('wal_checkpoint_failed', { error: errorMessage(err) });
  }

  // Step 9: Prune old backups
  const backupsPruned = pruneBackups(dataDir);

  const durationMs = Date.now() - start;

  return {
    retention,
    orphanedThreadContextsCleared: integrity.orphanedThreadContextsCleared,
    orphanedSessionMcpRows: integrity.orphanedSessionMcpRows,
    cleanedSessionKeys,
    jobLogsCleaned,
    orphanJobLogsCleaned,
    orchestratorsPurged: purgeResult.orchestratorsPurged,
    orchestratorRunsPurged: purgeResult.runsPurged,
    orchestratorWorkdirsCleaned: purgeResult.workdirsCleaned,
    orphanRunWorkdirsCleaned,
    logsRotated,
    backup,
    backupsPruned,
    durationMs,
  };
}

// Export for testing
export {
  retentionCleanup,
  vacuumBackup,
  pruneBackups,
  cleanupJobLogFiles,
  cleanupOrphanedJobLogs,
  purgeDeletedOrchestrators,
  cleanupOrphanRunWorkdirs,
  rotateLogs,
  assertSafePath,
  RETENTION_RULES,
  LOG_MAX_BYTES,
  ORCH_RUN_WORKDIR_RE,
};
