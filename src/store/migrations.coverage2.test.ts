/** Coverage2 tests for store/migrations: uncovered lines 38-39 (model column migration) */
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from './migrations.js';

describe('migrations coverage2', () => {
  it('migration adds model column to tables that lack it (lines 38-39)', () => {
    const db = new Database(':memory:');
    // Create the tables that need the model column
    db.exec(`
      CREATE TABLE scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE triggered_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE orchestrator_nodes (
        id TEXT PRIMARY KEY,
        orchestrator_id TEXT NOT NULL
      );
      CREATE TABLE ai_agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
    `);

    // Find the migration that adds model columns
    const modelMigration = MIGRATIONS.find((fn) => {
      // Test if this migration handles the model column by looking for 'model' column
      const testDb = new Database(':memory:');
      testDb.exec(
        'CREATE TABLE scheduled_tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL)',
      );
      testDb.exec(
        'CREATE TABLE triggered_tasks (id TEXT PRIMARY KEY, name TEXT NOT NULL)',
      );
      testDb.exec(
        'CREATE TABLE orchestrator_nodes (id TEXT PRIMARY KEY, orchestrator_id TEXT NOT NULL)',
      );
      testDb.exec('CREATE TABLE ai_agents (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
      try {
        fn(testDb);
        const cols = testDb.pragma('table_info(scheduled_tasks)') as { name: string }[];
        const hasModel = cols.some((c) => c.name === 'model');
        testDb.close();
        return hasModel;
      } catch {
        testDb.close();
        return false;
      }
    });

    expect(modelMigration).toBeDefined();

    // Run the migration on our test DB
    modelMigration!(db);

    // Verify model column was added to all tables
    for (const table of ['scheduled_tasks', 'triggered_tasks', 'orchestrator_nodes', 'ai_agents']) {
      const cols = db.pragma(`table_info(${table})`) as { name: string }[];
      expect(cols.some((c) => c.name === 'model')).toBe(true);
    }
    db.close();
  });

  it('migration is idempotent for model column (model already exists)', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        model TEXT DEFAULT NULL
      );
      CREATE TABLE triggered_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        model TEXT DEFAULT NULL
      );
      CREATE TABLE orchestrator_nodes (
        id TEXT PRIMARY KEY,
        orchestrator_id TEXT NOT NULL,
        model TEXT DEFAULT NULL
      );
      CREATE TABLE ai_agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        model TEXT DEFAULT NULL
      );
    `);

    // Find and run the model migration — should be a no-op
    const lastMigration = MIGRATIONS[MIGRATIONS.length - 1];
    expect(() => lastMigration!(db)).not.toThrow();
    db.close();
  });
});
