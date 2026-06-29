/** @module database — SQLite schema bootstrap, migrations, and singleton lifecycle. */
import path from 'node:path';
import Database from 'better-sqlite3';
import { errorMessage } from '../utils/error.js';
import { ensurePrivateDirectory } from '../utils/fs-security.js';
import { logger } from '../utils/logger.js';
import {
  applySqliteConnectionPragmas,
  tightenSqliteRuntimeFilePermissions,
} from '../utils/sqlite.js';
import { McpServerStore } from './mcp-server.js';
import { MIGRATIONS } from './migrations.js';
import { SCHEMA_SQL } from './schema.js';

let db: Database.Database | null = null;

/** Return the singleton database handle. @throws if called before initDatabase(). */
export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Run schema creation and all migrations on an open database handle.
 * Called by both the full server (initDatabase) and dashboard-only mode (DashboardDb).
 */
export function ensureSchema(database: Database.Database): void {
  database.exec(SCHEMA_SQL);
  for (const migration of MIGRATIONS) {
    migration(database);
  }
}

/** Open (or create) the SQLite database in WAL mode and run all migrations. */
export function initDatabase(dataDir: string): Database.Database {
  ensurePrivateDirectory(dataDir);
  const dbPath = path.join(dataDir, 'orchestrator.db');

  try {
    db = new Database(dbPath);
    applySqliteConnectionPragmas(db);
    ensureSchema(db);
    new McpServerStore(db).importFromGlobalConfigs();
    tightenSqliteRuntimeFilePermissions(dbPath);
  } catch (err) {
    logger.error('database_init_failed', {
      path: dbPath,
      error: errorMessage(err),
    });
    if (db) {
      try {
        db.close();
      } catch {
        /* ignore close error during init failure */
      }
      db = null;
    }
    throw err;
  }

  logger.info('database_initialized', { path: dbPath });
  return db;
}

/** Checkpoint WAL and close the singleton database handle. */
export function closeDatabase(): void {
  if (db) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      logger.error('wal_checkpoint_failed', {
        error: errorMessage(err),
      });
    }
    try {
      db.close();
    } catch (err) {
      logger.error('database_close_failed', {
        error: errorMessage(err),
      });
    }
    db = null;
    logger.info('database_closed');
  }
}
