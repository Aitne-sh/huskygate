/**
 * Coverage supplement for orchestrator-snapshot.ts — triggers ?? fallback branches
 * by providing minimal node/edge objects with many undefined fields.
 */
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { revertToValidatedSnapshot } from './orchestrator-snapshot.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE orchestrators (
      id TEXT PRIMARY KEY,
      validated_snapshot TEXT,
      dag_validated INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE orchestrator_nodes (
      id TEXT PRIMARY KEY, orchestrator_id TEXT NOT NULL,
      label TEXT NOT NULL, node_type TEXT NOT NULL DEFAULT 'task',
      tool TEXT, model TEXT, mode TEXT DEFAULT 'write', prompt TEXT,
      instruction_file TEXT, workdir TEXT,
      write_instruction_file INTEGER NOT NULL DEFAULT 1,
      max_retries INTEGER NOT NULL DEFAULT 0,
      timeout_sec INTEGER, allow_mcp INTEGER NOT NULL DEFAULT 1,
      enabled_mcp_server_ids TEXT, enabled_skills_json TEXT,
      output_mode TEXT NOT NULL DEFAULT 'auto',
      return_conditions TEXT, return_values TEXT,
      gate_condition TEXT, triggered_config_json TEXT,
      notify_enabled INTEGER NOT NULL DEFAULT 0,
      notify_channel TEXT, notify_on_error INTEGER NOT NULL DEFAULT 1,
      position_x REAL NOT NULL DEFAULT 0, position_y REAL NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      agent_id TEXT
    );
    CREATE INDEX idx_orch_nodes_orch ON orchestrator_nodes(orchestrator_id);
    CREATE TABLE orchestrator_edges (
      id TEXT PRIMARY KEY, orchestrator_id TEXT NOT NULL,
      from_node_id TEXT NOT NULL, to_node_id TEXT NOT NULL,
      condition_value TEXT, condition_operator TEXT NOT NULL DEFAULT 'eq',
      sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE INDEX idx_orch_edges_orch ON orchestrator_edges(orchestrator_id);
  `);
  return db;
}

describe('orchestrator-snapshot ?? branch coverage', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('revertToValidatedSnapshot handles minimal node/edge (many undefined fields)', () => {
    db = createDb();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO orchestrators (id, updated_at) VALUES (?, ?)').run('orch-1', now);

    // Snapshot with minimal node — all optional fields undefined to trigger ?? fallbacks
    const snapshot = {
      nodes: [
        {
          id: 'n1',
          orchestratorId: 'orch-1',
          label: 'Minimal',
          nodeType: 'task',
          // tool: undefined,
          // mode: undefined,
          // prompt: undefined,
          // instructionFile: undefined,
          // workdir: undefined,
          // writeInstructionFile: undefined,
          // maxRetries: undefined,
          // timeoutSec: undefined,
          // allowMcp: undefined,
          // enabledMcpServerIds: undefined,
          // outputMode: undefined,
          // returnConditions: undefined,
          // returnValues: undefined,
          // gateCondition: undefined,
          // triggeredConfig: undefined,
          // notifyEnabled: undefined,
          // notifyChannel: undefined,
          // notifyOnError: undefined,
          // positionX: undefined,
          // positionY: undefined,
          // sortOrder: undefined,
          // createdAt: undefined,
        },
      ],
      edges: [
        {
          id: 'e1',
          orchestratorId: 'orch-1',
          fromNodeId: 'n1',
          toNodeId: 'n2',
          // conditionValue: undefined,
          // conditionOperator: undefined,
          // sortOrder: undefined,
          // createdAt: undefined,
        },
      ],
    };

    db.prepare('UPDATE orchestrators SET validated_snapshot = ? WHERE id = ?').run(
      JSON.stringify(snapshot),
      'orch-1',
    );

    const result = revertToValidatedSnapshot(db, 'orch-1');
    expect(result).toBe(true);

    // Verify nodes/edges were re-inserted
    const nodes = db
      .prepare('SELECT * FROM orchestrator_nodes WHERE orchestrator_id = ?')
      .all('orch-1');
    expect(nodes).toHaveLength(1);
    const edges = db
      .prepare('SELECT * FROM orchestrator_edges WHERE orchestrator_id = ?')
      .all('orch-1');
    expect(edges).toHaveLength(1);
  });
});
