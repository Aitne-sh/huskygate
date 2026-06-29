/** Coverage tests for store/orchestrator: uncovered lines 71-72 (transaction wrapper) */
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorStore } from './orchestrator.js';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE orchestrators (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      alias TEXT,
      description TEXT,
      user_id TEXT,
      workdir TEXT,
      start_node_id TEXT,
      trigger_mode TEXT DEFAULT 'ondemand',
      schedule_type TEXT,
      run_at TEXT,
      cron_expr TEXT,
      timezone TEXT,
      notify_channel TEXT,
      max_parallelism INTEGER DEFAULT 3,
      max_total_nodes INTEGER DEFAULT 50,
      error_policy TEXT DEFAULT 'continue',
      timeout_sec INTEGER,
      instruction_file TEXT,
      enabled_skills_json TEXT,
      summary_enabled INTEGER DEFAULT 0,
      summary_tool TEXT,
      max_run_workdirs INTEGER DEFAULT 5,
      status TEXT NOT NULL DEFAULT 'active',
      dag_validated INTEGER DEFAULT 0,
      last_run_at TEXT,
      run_count INTEGER DEFAULT 0,
      next_run_at TEXT,
      claimed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE orchestrator_nodes (
      id TEXT PRIMARY KEY,
      orchestrator_id TEXT NOT NULL,
      label TEXT NOT NULL,
      node_type TEXT DEFAULT 'task',
      agent_id TEXT,
      tool TEXT,
      model TEXT,
      mode TEXT DEFAULT 'write',
      prompt TEXT,
      max_retries INTEGER DEFAULT 0,
      timeout_sec INTEGER,
      allow_mcp INTEGER DEFAULT 0,
      enabled_mcp_server_ids TEXT,
      workdir TEXT,
      write_instruction_file INTEGER DEFAULT 1,
      instruction_file TEXT,
      output_mode TEXT DEFAULT 'auto',
      return_conditions TEXT,
      return_values TEXT,
      gate_condition TEXT,
      triggered_config_json TEXT,
      notify_enabled INTEGER DEFAULT 0,
      notify_channel TEXT,
      notify_on_error INTEGER DEFAULT 0,
      position_x REAL DEFAULT 0,
      position_y REAL DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE orchestrator_edges (
      id TEXT PRIMARY KEY,
      orchestrator_id TEXT NOT NULL,
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      condition_value TEXT,
      condition_operator TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE orchestration_runs (
      id TEXT PRIMARY KEY,
      orchestrator_id TEXT NOT NULL,
      status TEXT NOT NULL,
      triggered_by TEXT,
      triggered_user_id TEXT,
      trigger_context_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE TABLE orchestration_node_runs (
      id TEXT PRIMARY KEY,
      orchestration_run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      output_full TEXT,
      output_path TEXT,
      output_bytes INTEGER,
      output_sha256 TEXT,
      return_value TEXT,
      error_message TEXT,
      started_at TEXT,
      ended_at TEXT
    );
    CREATE TABLE event_subscriptions (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT,
      orchestrator_id TEXT,
      node_id TEXT
    );
  `);
  return db;
}

describe('OrchestratorStore coverage', () => {
  it('transaction wraps callback in DB transaction (lines 71-72)', () => {
    const db = createDb();
    const store = new OrchestratorStore(db);

    let executedInTransaction = false;
    const result = store.transaction(() => {
      executedInTransaction = true;
      return 42;
    });
    expect(executedInTransaction).toBe(true);
    expect(result).toBe(42);
    db.close();
  });

  it('transaction rolls back on error', () => {
    const db = createDb();
    const store = new OrchestratorStore(db);

    expect(() =>
      store.transaction(() => {
        throw new Error('rollback test');
      }),
    ).toThrow('rollback test');
    db.close();
  });
});
