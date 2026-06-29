import type Database from 'better-sqlite3';
import { TIMEOUTS } from '../shared/constants.js';
import { ensurePrivateFile } from './fs-security.js';

export const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = TIMEOUTS.sqliteBusy;

export interface SqliteConnectionOptions {
  enableWal?: boolean;
}

export function applySqliteConnectionPragmas(
  database: Database.Database,
  options: SqliteConnectionOptions = {},
): void {
  database.pragma(`busy_timeout = ${DEFAULT_SQLITE_BUSY_TIMEOUT_MS}`);
  if (options.enableWal !== false) {
    database.pragma('journal_mode = WAL');
  }
}

export function tightenSqliteRuntimeFilePermissions(dbPath: string): void {
  ensurePrivateFile(dbPath);
  ensurePrivateFile(`${dbPath}-wal`);
  ensurePrivateFile(`${dbPath}-shm`);
}
