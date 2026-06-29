/**
 * Tests for store/orchestrator-snapshot — save and revert validated DAG snapshots.
 */
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { OrchestratorGraphStore } from './orchestrator-graph.js';
import { revertToValidatedSnapshot, saveValidatedSnapshot } from './orchestrator-snapshot.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE orchestrators (
      id              TEXT PRIMARY KEY,
      validated_snapshot TEXT,
      dag_validated   INTEGER NOT NULL DEFAULT 0,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE orchestrator_nodes (
      id                TEXT PRIMARY KEY,
      orchestrator_id   TEXT NOT NULL,
      label             TEXT NOT NULL,
      node_type         TEXT NOT NULL DEFAULT 'task',
      agent_id          TEXT,
      tool              TEXT,
      model             TEXT,
      mode              TEXT DEFAULT 'write',
      prompt            TEXT,
      instruction_file  TEXT,
      workdir           TEXT,
      write_instruction_file INTEGER NOT NULL DEFAULT 1,
      max_retries       INTEGER NOT NULL DEFAULT 0,
      timeout_sec       INTEGER,
      allow_mcp         INTEGER NOT NULL DEFAULT 1,
      enabled_mcp_server_ids TEXT,
      enabled_skills_json TEXT,
      output_mode       TEXT NOT NULL DEFAULT 'auto',
      return_conditions TEXT,
      return_values     TEXT,
      gate_condition    TEXT,
      triggered_config_json TEXT,
      notify_enabled    INTEGER NOT NULL DEFAULT 0,
      notify_channel    TEXT,
      notify_on_error   INTEGER NOT NULL DEFAULT 1,
      position_x        REAL NOT NULL DEFAULT 0,
      position_y        REAL NOT NULL DEFAULT 0,
      sort_order        INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );
    CREATE INDEX idx_orch_nodes_orch ON orchestrator_nodes(orchestrator_id);

    CREATE TABLE orchestrator_edges (
      id              TEXT PRIMARY KEY,
      orchestrator_id TEXT NOT NULL,
      from_node_id    TEXT NOT NULL,
      to_node_id      TEXT NOT NULL,
      condition_value TEXT,
      condition_operator TEXT NOT NULL DEFAULT 'eq',
      sort_order      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL
    );
    CREATE INDEX idx_orch_edges_orch ON orchestrator_edges(orchestrator_id);
  `);
  return db;
}

describe('orchestrator-snapshot', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('saveValidatedSnapshot persists nodes and edges as JSON', () => {
    db = createDb();
    const graphStore = new OrchestratorGraphStore(db);
    const now = new Date().toISOString();

    db.prepare('INSERT INTO orchestrators (id, updated_at) VALUES (?, ?)').run('orch-1', now);
    db.prepare(
      `INSERT INTO orchestrator_nodes (id, orchestrator_id, label, node_type, tool, prompt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('n1', 'orch-1', 'Task A', 'task', 'claude', 'Do stuff', now, now);
    db.prepare(
      `INSERT INTO orchestrator_edges (id, orchestrator_id, from_node_id, to_node_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('e1', 'orch-1', 'n1', 'n2', now);

    saveValidatedSnapshot(db, graphStore, 'orch-1');

    const row = db
      .prepare('SELECT validated_snapshot FROM orchestrators WHERE id = ?')
      .get('orch-1') as { validated_snapshot: string };
    expect(row.validated_snapshot).toBeTruthy();
    const snapshot = JSON.parse(row.validated_snapshot);
    expect(snapshot.nodes).toHaveLength(1);
    expect(snapshot.edges).toHaveLength(1);
  });

  it('revertToValidatedSnapshot returns false when no snapshot exists', () => {
    db = createDb();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO orchestrators (id, updated_at) VALUES (?, ?)').run('orch-1', now);

    const result = revertToValidatedSnapshot(db, 'orch-1');
    expect(result).toBe(false);
  });

  it('revertToValidatedSnapshot returns false for invalid JSON snapshot', () => {
    db = createDb();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO orchestrators (id, validated_snapshot, updated_at) VALUES (?, ?, ?)',
    ).run('orch-1', 'not valid json', now);

    const result = revertToValidatedSnapshot(db, 'orch-1');
    expect(result).toBe(false);
  });

  it('revertToValidatedSnapshot returns false for null snapshot', () => {
    db = createDb();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO orchestrators (id, validated_snapshot, updated_at) VALUES (?, ?, ?)',
    ).run('orch-1', null, now);

    const result = revertToValidatedSnapshot(db, 'orch-1');
    expect(result).toBe(false);
  });

  it('revertToValidatedSnapshot returns false for nonexistent orchestrator', () => {
    db = createDb();
    const result = revertToValidatedSnapshot(db, 'nonexistent');
    expect(result).toBe(false);
  });

  it('revertToValidatedSnapshot restores nodes and edges from snapshot', () => {
    db = createDb();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO orchestrators (id, updated_at) VALUES (?, ?)').run('orch-1', now);

    // Create snapshot with a node and edge
    const snapshot = {
      nodes: [
        {
          id: 'n1',
          orchestratorId: 'orch-1',
          label: 'Task A',
          nodeType: 'task',
          tool: 'claude',
          mode: 'write',
          prompt: 'Do stuff',
          maxRetries: 0,
          timeoutSec: null,
          allowMcp: true,
          workdir: null,
          writeInstructionFile: true,
          instructionFile: null,
          outputMode: 'auto',
          returnConditions: null,
          returnValues: null,
          gateCondition: null,
          triggeredConfig: null,
          notifyEnabled: false,
          notifyChannel: null,
          notifyOnError: true,
          positionX: 10,
          positionY: 20,
          sortOrder: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
      edges: [
        {
          id: 'e1',
          orchestratorId: 'orch-1',
          fromNodeId: 'n1',
          toNodeId: 'n2',
          conditionValue: 'done',
          conditionOperator: 'eq',
          sortOrder: 0,
          createdAt: now,
        },
      ],
    };

    db.prepare('UPDATE orchestrators SET validated_snapshot = ? WHERE id = ?').run(
      JSON.stringify(snapshot),
      'orch-1',
    );

    // Add some existing nodes that should be replaced
    db.prepare(
      `INSERT INTO orchestrator_nodes (id, orchestrator_id, label, node_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('old-node', 'orch-1', 'Old Node', 'task', now, now);

    const result = revertToValidatedSnapshot(db, 'orch-1');
    expect(result).toBe(true);

    // Verify old nodes are gone and snapshot nodes are present
    const nodes = db
      .prepare('SELECT * FROM orchestrator_nodes WHERE orchestrator_id = ?')
      .all('orch-1');
    expect(nodes).toHaveLength(1);
    expect((nodes[0] as { id: string }).id).toBe('n1');

    const edges = db
      .prepare('SELECT * FROM orchestrator_edges WHERE orchestrator_id = ?')
      .all('orch-1');
    expect(edges).toHaveLength(1);
    expect((edges[0] as { id: string }).id).toBe('e1');

    // dag_validated should be set to 1
    const orch = db
      .prepare('SELECT dag_validated FROM orchestrators WHERE id = ?')
      .get('orch-1') as { dag_validated: number };
    expect(orch.dag_validated).toBe(1);
  });

  it('revertToValidatedSnapshot throws when node limits are invalid', () => {
    db = createDb();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO orchestrators (id, updated_at) VALUES (?, ?)').run('orch-1', now);

    const snapshot = {
      nodes: [
        {
          id: 'n1',
          orchestratorId: 'orch-1',
          label: 'Bad Node',
          nodeType: 'task',
          tool: 'claude',
          maxRetries: 999,
          timeoutSec: null,
        },
      ],
      edges: [],
    };

    db.prepare('UPDATE orchestrators SET validated_snapshot = ? WHERE id = ?').run(
      JSON.stringify(snapshot),
      'orch-1',
    );

    expect(db).not.toBeNull();
    expect(() => revertToValidatedSnapshot(db as Database.Database, 'orch-1')).toThrow('invalid');
  });
});
