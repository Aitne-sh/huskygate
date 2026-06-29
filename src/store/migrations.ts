/** @module store/migrations — Database schema migrations in execution order. */
import type Database from 'better-sqlite3';

/**
 * All schema is now defined in schema.ts (CREATE TABLE IF NOT EXISTS).
 * Legacy migrations have been removed since this app has not been released.
 * Future schema changes should be added directly to schema.ts.
 *
 * Additive column migrations go here for existing databases.
 */
export const MIGRATIONS: ReadonlyArray<(db: Database.Database) => void> = [
  // Migration 0: Add job_id column to dashboard_messages for direct job correlation.
  (db) => {
    const cols = (db.pragma('table_info(dashboard_messages)') ?? []) as { name: string }[];
    if (cols.length > 0 && !cols.some((c) => c.name === 'job_id')) {
      db.exec('ALTER TABLE dashboard_messages ADD COLUMN job_id TEXT');
    }
    // Create index for both fresh (column from schema.ts) and migrated DBs
    if (cols.length > 0) {
      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_dash_msg_job_id ON dashboard_messages(job_id) WHERE job_id IS NOT NULL',
      );
    }
  },

  // Migration 1: Add model column to all task/agent/node tables for per-task model selection.
  (db) => {
    const tables = [
      'ondemand_tasks',
      'scheduled_tasks',
      'triggered_tasks',
      'orchestrator_nodes',
      'ai_agents',
    ] as const;
    for (const table of tables) {
      const cols = (db.pragma(`table_info(${table})`) ?? []) as { name: string }[];
      if (cols.length > 0 && !cols.some((c) => c.name === 'model')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN model TEXT DEFAULT NULL`);
      }
    }
  },
];
