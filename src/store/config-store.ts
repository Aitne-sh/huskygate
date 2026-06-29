/** @module config-store — Key-value config persistence with keychain-ref support. */
import type Database from 'better-sqlite3';

export type ConfigStorage = 'db' | 'keychain_ref';
export type ConfigSource = 'user';

export interface ConfigRecord {
  key: string;
  value: string | null;
  storage: ConfigStorage;
  source: ConfigSource;
  updatedAt: string;
}

interface ConfigRow {
  key: string;
  value: string | null;
  storage: ConfigStorage;
  source: ConfigSource;
  updated_at: string;
}

interface MetadataRow {
  value: string;
}

/** CRUD for the `config` and `metadata` tables (DB values and keychain references). */
export class ConfigStore {
  constructor(private readonly db: Database.Database) {}

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  list(): ConfigRecord[] {
    const rows = this.db
      .prepare(
        `SELECT key, value, storage, source, updated_at
         FROM config
         ORDER BY key`,
      )
      .all() as ConfigRow[];
    return rows.map(mapConfigRow);
  }

  get(key: string): ConfigRecord | null {
    const row = this.db
      .prepare(
        `SELECT key, value, storage, source, updated_at
         FROM config
         WHERE key = ?`,
      )
      .get(key) as ConfigRow | undefined;
    return row ? mapConfigRow(row) : null;
  }

  setDbValue(key: string, value: string, source: ConfigSource = 'user'): void {
    this.db
      .prepare(
        `INSERT INTO config (key, value, storage, source, updated_at)
         VALUES (?, ?, 'db', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           storage = excluded.storage,
           source = excluded.source,
           updated_at = excluded.updated_at`,
      )
      .run(key, value, source);
  }

  setKeychainRef(key: string, source: ConfigSource = 'user'): void {
    this.db
      .prepare(
        `INSERT INTO config (key, value, storage, source, updated_at)
         VALUES (?, NULL, 'keychain_ref', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           storage = excluded.storage,
           source = excluded.source,
           updated_at = excluded.updated_at`,
      )
      .run(key, source);
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM config WHERE key = ?').run(key);
  }

  getMetadata(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get(key) as
      | MetadataRow
      | undefined;
    return row?.value ?? null;
  }

  setMetadata(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO metadata (key, value, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run(key, value);
  }

  deleteMetadata(key: string): void {
    this.db.prepare('DELETE FROM metadata WHERE key = ?').run(key);
  }
}

function mapConfigRow(row: ConfigRow): ConfigRecord {
  return {
    key: row.key,
    value: row.value,
    storage: row.storage,
    source: row.source,
    updatedAt: row.updated_at,
  };
}
