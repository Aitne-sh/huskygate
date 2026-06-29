/** Coverage tests for store/migrations — verify MIGRATIONS and additive column migrations. */
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from './migrations.js';

describe('migrations', () => {
  it('MIGRATIONS array contains additive column migrations', () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(1);
  });

  it('migration 0 adds job_id column to dashboard_messages', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE dashboard_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    // Column should not exist yet
    const colsBefore = db.pragma('table_info(dashboard_messages)') as { name: string }[];
    expect(colsBefore.some((c) => c.name === 'job_id')).toBe(false);

    // Run migration
    MIGRATIONS[0]!(db);

    // Column should now exist
    const colsAfter = db.pragma('table_info(dashboard_messages)') as { name: string }[];
    expect(colsAfter.some((c) => c.name === 'job_id')).toBe(true);

    db.close();
  });

  it('migration 0 is idempotent', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE dashboard_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        job_id TEXT
      );
    `);

    // Column already exists — migration should be a no-op
    expect(() => MIGRATIONS[0]!(db)).not.toThrow();

    db.close();
  });
});
