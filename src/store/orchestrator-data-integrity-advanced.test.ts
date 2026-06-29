/**
 * Orchestrator Data Integrity — Advanced Test Suite
 *
 * Extends the base data-integrity tests with scenarios that specifically target
 * potential data overwrite and data loss patterns in the dashboard → backend pipeline:
 *
 *   - Snapshot ↔ mapper interaction (returnValues injection through snapshot cycle)
 *   - Snapshot lifecycle (overwrite, multi-cycle, edit-between-save-and-revert)
 *   - Multi-step node type transition chains (all pairwise combinations)
 *   - Field boundary edge cases (empty string vs null, boolean coercion, zero values)
 *   - Concurrent / sequential partial update isolation
 *   - Event subscription cascading on node operations
 *   - Full DAG lifecycle simulation (create → configure → snapshot → edit → revert)
 */
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrchestratorNode } from '../orchestrator/types.js';
import { OrchestratorGraphStore } from './orchestrator-graph.js';
import { revertToValidatedSnapshot, saveValidatedSnapshot } from './orchestrator-snapshot.js';
import { OrchestratorStore } from './orchestrator.js';
import { StaleUpdateError } from './store-utils.js';

// ── Test DB schema (mirrors production) ──────────────────────────

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE orchestrators (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      alias           TEXT,
      description     TEXT,
      user_id         TEXT NOT NULL DEFAULT 'dashboard',
      workdir         TEXT,
      start_node_id   TEXT,
      trigger_mode    TEXT NOT NULL DEFAULT 'ondemand',
      schedule_type   TEXT,
      run_at          TEXT,
      cron_expr       TEXT,
      timezone        TEXT NOT NULL DEFAULT 'default',
      notify_channel  TEXT,
      max_parallelism INTEGER NOT NULL DEFAULT 3,
      max_total_nodes INTEGER NOT NULL DEFAULT 50,
      error_policy    TEXT NOT NULL DEFAULT 'continue',
      timeout_sec     INTEGER,
      instruction_file TEXT,
      enabled_skills_json TEXT,
      summary_enabled INTEGER NOT NULL DEFAULT 0,
      summary_tool    TEXT,
      max_run_workdirs INTEGER NOT NULL DEFAULT 20,
      validated_snapshot TEXT,
      status          TEXT NOT NULL DEFAULT 'active',
      dag_validated   INTEGER NOT NULL DEFAULT 0,
      last_run_at     TEXT,
      run_count       INTEGER NOT NULL DEFAULT 0,
      next_run_at     TEXT,
      claimed_at      TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE UNIQUE INDEX idx_orchestrator_alias
      ON orchestrators(alias) WHERE alias IS NOT NULL AND status != 'deleted';
    CREATE INDEX idx_orchestrators_start_node_id ON orchestrators(start_node_id);

    CREATE TABLE orchestrator_nodes (
      id                TEXT PRIMARY KEY,
      orchestrator_id   TEXT NOT NULL,
      label             TEXT NOT NULL,
      node_type         TEXT NOT NULL DEFAULT 'task',
      tool              TEXT,
      model             TEXT,
      mode              TEXT DEFAULT 'write',
      prompt            TEXT,
      instruction_file  TEXT,
      workdir           TEXT,
      write_instruction_file INTEGER NOT NULL DEFAULT 1,
      args              TEXT,
      max_retries       INTEGER NOT NULL DEFAULT 0,
      timeout_sec       INTEGER,
      allow_mcp         INTEGER NOT NULL DEFAULT 1,
      agent_id          TEXT,
      enabled_mcp_server_ids TEXT,
      enabled_skills_json TEXT,
      on_missing_return TEXT NOT NULL DEFAULT 'fail',
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
      id                  TEXT PRIMARY KEY,
      orchestrator_id     TEXT NOT NULL,
      from_node_id        TEXT NOT NULL,
      to_node_id          TEXT NOT NULL,
      condition_value     TEXT,
      condition_operator  TEXT NOT NULL DEFAULT 'eq',
      sort_order          INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT NOT NULL
    );

    CREATE INDEX idx_orch_edges_orch ON orchestrator_edges(orchestrator_id);
    CREATE INDEX idx_orch_edges_from ON orchestrator_edges(from_node_id);
    CREATE INDEX idx_orch_edges_to ON orchestrator_edges(to_node_id);

    CREATE TABLE event_subscriptions (
      id                   TEXT PRIMARY KEY,
      endpoint_id          TEXT NOT NULL,
      target_type          TEXT NOT NULL,
      orchestrator_id      TEXT,
      triggered_task_id    TEXT,
      node_id              TEXT,
      filter_json          TEXT,
      context_mapping_json TEXT,
      enabled              INTEGER NOT NULL DEFAULT 1,
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL
    );
  `);
  return db;
}

// ── Helpers ──────────────────────────────────────────────────────

function createStoreWithOrch(db: Database.Database) {
  const store = new OrchestratorStore(db);
  const orch = store.create({ name: 'IntegrityTest' });
  return { store, orch };
}

function createRawOrchestrator(
  db: Database.Database,
  id: string,
  name: string,
  startNodeId: string,
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO orchestrators (id, name, user_id, start_node_id, created_at, updated_at)
     VALUES (?, ?, 'dashboard', ?, ?, ?)`,
  ).run(id, name, startNodeId, now, now);
}

/** Extract the raw DB row for a node (snake_case columns). */
function rawNodeRow(db: Database.Database, nodeId: string): Record<string, unknown> {
  return db.prepare('SELECT * FROM orchestrator_nodes WHERE id = ?').get(nodeId) as Record<
    string,
    unknown
  >;
}

/** Read raw validated_snapshot JSON from DB. */
function rawSnapshot(db: Database.Database, orchId: string): string | null {
  const row = db.prepare('SELECT validated_snapshot FROM orchestrators WHERE id = ?').get(orchId) as
    | {
        validated_snapshot: string | null;
      }
    | undefined;
  return row?.validated_snapshot ?? null;
}

function expectPresent<T>(value: T | null | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe('orchestrator data integrity — advanced', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  // ── 1. Snapshot ↔ Mapper Interaction ────────────────────────────

  describe('snapshot ↔ mapper interaction', () => {
    it('returnValues system injection is stable through snapshot save → revert cycle', () => {
      db = createDb();
      const graphStore = new OrchestratorGraphStore(db);
      createRawOrchestrator(db, 'orch-rv', 'RV Test', 'start');

      // Create node with user-defined returnValues (no system values)
      const node = graphStore.createNode({
        orchestratorId: 'orch-rv',
        label: 'Worker',
        nodeType: 'task',
        tool: 'claude',
        returnValues: ['success', 'failure'],
      });

      // Verify DB stores canonical values (without system injection)
      const rawBefore = rawNodeRow(db, node.id);
      const dbReturnValues = JSON.parse(rawBefore.return_values as string) as string[];
      expect(dbReturnValues).toEqual(['success', 'failure']);

      // mapNode() injects system values on read
      const mapped = expectPresent(graphStore.getNodeById(node.id));
      expect(mapped.returnValues).toContain('other_return');
      expect(mapped.returnValues).toContain('error_return');

      // saveValidatedSnapshot captures domain objects (with injected values)
      saveValidatedSnapshot(db, graphStore, 'orch-rv');

      // Inspect what snapshot actually persisted
      const snap = JSON.parse(expectPresent(rawSnapshot(db, 'orch-rv'))) as {
        nodes: OrchestratorNode[];
      };
      const snappedNode = expectPresent(snap.nodes.find((n) => n.id === node.id));
      // Snapshot includes system values because it serializes domain objects
      expect(snappedNode.returnValues).toContain('other_return');
      expect(snappedNode.returnValues).toContain('error_return');

      // Delete and revert
      graphStore.deleteNode(node.id);
      revertToValidatedSnapshot(db, 'orch-rv');

      // After revert: DB now has system values baked in
      const rawAfter = rawNodeRow(db, node.id);
      const dbAfterRevert = JSON.parse(rawAfter.return_values as string) as string[];
      // This demonstrates the known behavior: system values persist in DB after revert
      expect(dbAfterRevert).toContain('success');
      expect(dbAfterRevert).toContain('failure');
      expect(dbAfterRevert).toContain('other_return');
      expect(dbAfterRevert).toContain('error_return');

      // CRITICAL: Domain-level read must NOT duplicate system values
      const restored = expectPresent(graphStore.getNodeById(node.id));
      const otherCount = restored.returnValues?.filter((v) => v === 'other_return').length;
      const errorCount = restored.returnValues?.filter((v) => v === 'error_return').length;
      expect(otherCount).toBe(1);
      expect(errorCount).toBe(1);
    });

    it('multiple snapshot save-revert cycles do not accumulate duplicate system returnValues', () => {
      db = createDb();
      const graphStore = new OrchestratorGraphStore(db);
      createRawOrchestrator(db, 'orch-multi-rv', 'Multi RV', 'start');

      const node = graphStore.createNode({
        orchestratorId: 'orch-multi-rv',
        label: 'Worker',
        nodeType: 'task',
        tool: 'claude',
        returnValues: ['done'],
      });

      // Cycle 1: save → revert
      saveValidatedSnapshot(db, graphStore, 'orch-multi-rv');
      graphStore.deleteNode(node.id);
      revertToValidatedSnapshot(db, 'orch-multi-rv');

      // Cycle 2: save (now DB has system values) → revert
      saveValidatedSnapshot(db, graphStore, 'orch-multi-rv');
      graphStore.deleteNode(node.id);
      revertToValidatedSnapshot(db, 'orch-multi-rv');

      // Cycle 3: one more round
      saveValidatedSnapshot(db, graphStore, 'orch-multi-rv');
      graphStore.deleteNode(node.id);
      revertToValidatedSnapshot(db, 'orch-multi-rv');

      const final = expectPresent(graphStore.getNodeById(node.id));
      const allReturnValues = expectPresent(final.returnValues);
      // Must have exactly 1 of each, no duplicates even after 3 cycles
      expect(allReturnValues.filter((v) => v === 'done').length).toBe(1);
      expect(allReturnValues.filter((v) => v === 'other_return').length).toBe(1);
      expect(allReturnValues.filter((v) => v === 'error_return').length).toBe(1);
    });

    it('snapshot with null returnValues survives save-revert without gaining system values', () => {
      db = createDb();
      const graphStore = new OrchestratorGraphStore(db);
      createRawOrchestrator(db, 'orch-null-rv', 'Null RV', 'start');

      const node = graphStore.createNode({
        orchestratorId: 'orch-null-rv',
        label: 'End',
        nodeType: 'end',
      });

      expect(graphStore.getNodeById(node.id)?.returnValues).toBeNull();

      saveValidatedSnapshot(db, graphStore, 'orch-null-rv');
      graphStore.deleteNode(node.id);
      revertToValidatedSnapshot(db, 'orch-null-rv');

      expect(graphStore.getNodeById(node.id)?.returnValues).toBeNull();
    });

    it('enabledMcpServerIds empty array → null normalization persists through snapshot', () => {
      db = createDb();
      const graphStore = new OrchestratorGraphStore(db);
      createRawOrchestrator(db, 'orch-mcp-norm', 'MCP Norm', 'start');

      // Insert with empty array in DB
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO orchestrator_nodes
          (id, orchestrator_id, label, node_type, enabled_mcp_server_ids, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run('mcp-node', 'orch-mcp-norm', 'Task', 'task', '[]', now, now);

      // mapper normalizes [] → null
      expect(graphStore.getNodeById('mcp-node')?.enabledMcpServerIds).toBeNull();

      saveValidatedSnapshot(db, graphStore, 'orch-mcp-norm');
      graphStore.deleteNode('mcp-node');
      revertToValidatedSnapshot(db, 'orch-mcp-norm');

      // After revert: DB has null (not [])
      const raw = rawNodeRow(db, 'mcp-node');
      expect(raw.enabled_mcp_server_ids).toBeNull();
      expect(graphStore.getNodeById('mcp-node')?.enabledMcpServerIds).toBeNull();
    });
  });

  // ── 2. Snapshot Lifecycle ───────────────────────────────────────

  describe('snapshot lifecycle', () => {
    it('second snapshot save overwrites first — revert uses latest', () => {
      db = createDb();
      const graphStore = new OrchestratorGraphStore(db);
      createRawOrchestrator(db, 'orch-overwrite', 'Overwrite', 'start');

      const nodeA = graphStore.createNode({
        orchestratorId: 'orch-overwrite',
        label: 'V1 Node',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Version 1',
      });

      // First snapshot: captures V1
      saveValidatedSnapshot(db, graphStore, 'orch-overwrite');

      // Modify node to V2
      graphStore.updateNode(nodeA.id, { prompt: 'Version 2', label: 'V2 Node' });

      // Second snapshot: captures V2 (overwrites V1)
      saveValidatedSnapshot(db, graphStore, 'orch-overwrite');

      // Destroy and revert
      graphStore.deleteNode(nodeA.id);
      revertToValidatedSnapshot(db, 'orch-overwrite');

      // Must restore V2, not V1
      const restored = expectPresent(graphStore.getNodeById(nodeA.id));
      expect(restored.label).toBe('V2 Node');
      expect(restored.prompt).toBe('Version 2');
    });

    it('edits after snapshot save are lost on revert', () => {
      db = createDb();
      const graphStore = new OrchestratorGraphStore(db);
      createRawOrchestrator(db, 'orch-edit-loss', 'Edit Loss', 'start');

      const nodeA = graphStore.createNode({
        orchestratorId: 'orch-edit-loss',
        label: 'Saved',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Original prompt',
        maxRetries: 2,
      });

      // Save snapshot
      saveValidatedSnapshot(db, graphStore, 'orch-edit-loss');

      // Make edits after snapshot
      graphStore.updateNode(nodeA.id, {
        prompt: 'Modified prompt',
        maxRetries: 5,
        label: 'Modified',
      });

      // Add a new node (not in snapshot)
      const nodeB = graphStore.createNode({
        orchestratorId: 'orch-edit-loss',
        label: 'New Node',
        nodeType: 'task',
        tool: 'codex',
      });

      // Add edge (not in snapshot)
      graphStore.createEdge({
        orchestratorId: 'orch-edit-loss',
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        conditionValue: 'done',
      });

      // Verify modifications exist
      expect(graphStore.getNodeById(nodeA.id)?.prompt).toBe('Modified prompt');
      expect(graphStore.getNodeById(nodeB.id)).not.toBeNull();
      expect(graphStore.getEdgesByOrchestrator('orch-edit-loss')).toHaveLength(1);

      // Revert — all post-snapshot changes must be lost
      revertToValidatedSnapshot(db, 'orch-edit-loss');

      const restored = expectPresent(graphStore.getNodeById(nodeA.id));
      expect(restored.prompt).toBe('Original prompt');
      expect(restored.maxRetries).toBe(2);
      expect(restored.label).toBe('Saved');

      // New node gone
      expect(graphStore.getNodeById(nodeB.id)).toBeNull();

      // Edge gone
      expect(graphStore.getEdgesByOrchestrator('orch-edit-loss')).toHaveLength(0);
    });

    it('revert returns false when no snapshot exists', () => {
      db = createDb();
      createRawOrchestrator(db, 'orch-no-snap', 'No Snap', 'start');

      const result = revertToValidatedSnapshot(db, 'orch-no-snap');
      expect(result).toBe(false);
    });

    it('revert returns false for corrupted snapshot JSON', () => {
      db = createDb();
      createRawOrchestrator(db, 'orch-corrupt', 'Corrupt', 'start');

      db.prepare('UPDATE orchestrators SET validated_snapshot = ? WHERE id = ?').run(
        '{invalid json!!!',
        'orch-corrupt',
      );

      const result = revertToValidatedSnapshot(db, 'orch-corrupt');
      expect(result).toBe(false);
    });

    it('snapshot preserves edge condition operators through save-revert', () => {
      db = createDb();
      const graphStore = new OrchestratorGraphStore(db);
      createRawOrchestrator(db, 'orch-edge-ops', 'Edge Ops', 'start');

      const nodeA = graphStore.createNode({
        orchestratorId: 'orch-edge-ops',
        label: 'Router',
        nodeType: 'task',
        tool: 'claude',
      });
      const nodeB = graphStore.createNode({
        orchestratorId: 'orch-edge-ops',
        label: 'Target1',
        nodeType: 'task',
      });
      const nodeC = graphStore.createNode({
        orchestratorId: 'orch-edge-ops',
        label: 'Target2',
        nodeType: 'task',
      });
      const nodeD = graphStore.createNode({
        orchestratorId: 'orch-edge-ops',
        label: 'Target3',
        nodeType: 'end',
      });

      const edgeEq = graphStore.createEdge({
        orchestratorId: 'orch-edge-ops',
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        conditionValue: 'success',
        conditionOperator: 'eq',
        sortOrder: 0,
      });
      const edgeNeq = graphStore.createEdge({
        orchestratorId: 'orch-edge-ops',
        fromNodeId: nodeA.id,
        toNodeId: nodeC.id,
        conditionValue: 'error',
        conditionOperator: 'neq',
        sortOrder: 1,
      });
      const edgeRegex = graphStore.createEdge({
        orchestratorId: 'orch-edge-ops',
        fromNodeId: nodeA.id,
        toNodeId: nodeD.id,
        conditionValue: 'warn|skip',
        conditionOperator: 'regex',
        sortOrder: 2,
      });

      saveValidatedSnapshot(db, graphStore, 'orch-edge-ops');

      // Destroy all
      for (const n of [nodeD, nodeC, nodeB, nodeA]) graphStore.deleteNode(n.id);

      revertToValidatedSnapshot(db, 'orch-edge-ops');

      const edges = graphStore.getEdgesByOrchestrator('orch-edge-ops');
      expect(edges).toHaveLength(3);

      const eqEdge = expectPresent(edges.find((e) => e.id === edgeEq.id));
      expect(eqEdge.conditionOperator).toBe('eq');
      expect(eqEdge.conditionValue).toBe('success');
      expect(eqEdge.sortOrder).toBe(0);

      const neqEdge = expectPresent(edges.find((e) => e.id === edgeNeq.id));
      expect(neqEdge.conditionOperator).toBe('neq');
      expect(neqEdge.conditionValue).toBe('error');
      expect(neqEdge.sortOrder).toBe(1);

      const regexEdge = expectPresent(edges.find((e) => e.id === edgeRegex.id));
      expect(regexEdge.conditionOperator).toBe('regex');
      expect(regexEdge.conditionValue).toBe('warn|skip');
      expect(regexEdge.sortOrder).toBe(2);
    });

    it('snapshot with all 4 node types preserves type-specific fields', () => {
      db = createDb();
      const graphStore = new OrchestratorGraphStore(db);
      createRawOrchestrator(db, 'orch-all-types', 'All Types', 'start');

      const taskNode = graphStore.createNode({
        orchestratorId: 'orch-all-types',
        label: 'Task',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Do work',
        maxRetries: 3,
        workdir: '/custom',
        allowMcp: false,
        enabledMcpServerIds: ['srv-1'],
        returnConditions: [{ condition: 'ok', value: 'done' }],
        returnValues: ['done'],
      });

      const triggeredNode = graphStore.createNode({
        orchestratorId: 'orch-all-types',
        label: 'Triggered',
        nodeType: 'triggered',
        tool: 'codex',
        prompt: 'Handle event',
        triggeredConfig: { waitTimeoutSec: 300, onTimeout: 'skip' },
      });

      const gateNode = graphStore.createNode({
        orchestratorId: 'orch-all-types',
        label: 'Gate',
        nodeType: 'gate',
        gateCondition: { mode: 'or', matchValue: 'ready' },
        returnValues: ['true', 'false'],
      });

      const endNode = graphStore.createNode({
        orchestratorId: 'orch-all-types',
        label: 'End',
        nodeType: 'end',
      });

      saveValidatedSnapshot(db, graphStore, 'orch-all-types');

      // Destroy all
      for (const n of [endNode, gateNode, triggeredNode, taskNode]) {
        graphStore.deleteNode(n.id);
      }
      expect(graphStore.getNodesByOrchestrator('orch-all-types')).toHaveLength(0);

      revertToValidatedSnapshot(db, 'orch-all-types');

      const nodes = graphStore.getNodesByOrchestrator('orch-all-types');
      expect(nodes).toHaveLength(4);

      const restoredTask = expectPresent(nodes.find((n) => n.id === taskNode.id));
      expect(restoredTask.nodeType).toBe('task');
      expect(restoredTask.tool).toBe('claude');
      expect(restoredTask.prompt).toBe('Do work');
      expect(restoredTask.maxRetries).toBe(3);
      expect(restoredTask.workdir).toBe('/custom');
      expect(restoredTask.allowMcp).toBe(false);
      expect(restoredTask.enabledMcpServerIds).toEqual(['srv-1']);
      expect(restoredTask.returnConditions).toEqual([{ condition: 'ok', value: 'done' }]);

      const restoredTriggered = expectPresent(nodes.find((n) => n.id === triggeredNode.id));
      expect(restoredTriggered.nodeType).toBe('triggered');
      expect(restoredTriggered.tool).toBe('codex');
      expect(restoredTriggered.triggeredConfig).toEqual({ waitTimeoutSec: 300, onTimeout: 'skip' });

      const restoredGate = expectPresent(nodes.find((n) => n.id === gateNode.id));
      expect(restoredGate.nodeType).toBe('gate');
      expect(restoredGate.gateCondition).toEqual({ mode: 'or', matchValue: 'ready' });

      const restoredEnd = expectPresent(nodes.find((n) => n.id === endNode.id));
      expect(restoredEnd.nodeType).toBe('end');
      expect(restoredEnd.tool).toBeNull();
      expect(restoredEnd.prompt).toBeNull();
    });
  });

  // ── 3. Multi-Step Node Type Transition Chains ──────────────────

  describe('multi-step node type transition chains', () => {
    it('task → gate → task preserves position and restores task fields', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Chameleon',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Initial prompt',
        maxRetries: 2,
        positionX: 100,
        positionY: 200,
        sortOrder: 3,
      });

      // Step 1: task → gate (route handler would clear task fields)
      store.updateNode(node.id, {
        nodeType: 'gate',
        gateCondition: { mode: 'and', matchValue: 'done' },
        // Route handler would set these:
        tool: null,
        prompt: null,
        maxRetries: 0,
        workdir: null,
        returnValues: ['true', 'false'],
      });

      const asGate = expectPresent(store.getNodeById(node.id));
      expect(asGate.nodeType).toBe('gate');
      expect(asGate.gateCondition).toEqual({ mode: 'and', matchValue: 'done' });
      expect(asGate.tool).toBeNull();
      expect(asGate.positionX).toBe(100); // preserved
      expect(asGate.positionY).toBe(200); // preserved
      expect(asGate.sortOrder).toBe(3); // preserved

      // Step 2: gate → task (route handler would clear gate fields)
      store.updateNode(node.id, {
        nodeType: 'task',
        tool: 'codex',
        prompt: 'New task prompt',
        gateCondition: null,
        returnValues: ['success', 'failure'],
      });

      const asTask = expectPresent(store.getNodeById(node.id));
      expect(asTask.nodeType).toBe('task');
      expect(asTask.tool).toBe('codex');
      expect(asTask.prompt).toBe('New task prompt');
      expect(asTask.gateCondition).toBeNull();
      expect(asTask.positionX).toBe(100); // still preserved
      expect(asTask.positionY).toBe(200); // still preserved
      expect(asTask.sortOrder).toBe(3); // still preserved
    });

    it('task → triggered → gate → end covers all transitions', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Transform',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Start as task',
        positionX: 50,
        positionY: 75,
      });

      // task → triggered
      store.updateNode(node.id, {
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 120, onTimeout: 'fail' },
      });
      const asTriggered = expectPresent(store.getNodeById(node.id));
      expect(asTriggered.nodeType).toBe('triggered');
      expect(asTriggered.triggeredConfig).toEqual({ waitTimeoutSec: 120, onTimeout: 'fail' });
      expect(asTriggered.tool).toBe('claude'); // preserved from task
      expect(asTriggered.positionX).toBe(50);

      // triggered → gate (route handler clears task/triggered fields)
      store.updateNode(node.id, {
        nodeType: 'gate',
        gateCondition: { mode: 'or', matchValue: 'proceed' },
        triggeredConfig: null,
        tool: null,
        prompt: null,
        maxRetries: 0,
        returnValues: ['true', 'false'],
      });
      const asGate = expectPresent(store.getNodeById(node.id));
      expect(asGate.nodeType).toBe('gate');
      expect(asGate.gateCondition).toEqual({ mode: 'or', matchValue: 'proceed' });
      expect(asGate.triggeredConfig).toBeNull();
      expect(asGate.tool).toBeNull();
      expect(asGate.positionX).toBe(50); // preserved

      // gate → end (route handler clears gate fields)
      store.updateNode(node.id, {
        nodeType: 'end',
        gateCondition: null,
        returnValues: null,
        triggeredConfig: null,
      });
      const asEnd = expectPresent(store.getNodeById(node.id));
      expect(asEnd.nodeType).toBe('end');
      expect(asEnd.gateCondition).toBeNull();
      expect(asEnd.returnValues).toBeNull();
      expect(asEnd.triggeredConfig).toBeNull();
      expect(asEnd.positionX).toBe(50); // preserved through all transitions
      expect(asEnd.positionY).toBe(75);
    });

    it('end → task restores task fields without residual gate/triggered data', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Revived',
        nodeType: 'end',
        positionX: 300,
      });

      expect(store.getNodeById(node.id)?.tool).toBeNull();

      // end → task
      store.updateNode(node.id, {
        nodeType: 'task',
        tool: 'gemini',
        prompt: 'Now I work',
        maxRetries: 1,
        returnValues: ['done'],
      });

      const revived = expectPresent(store.getNodeById(node.id));
      expect(revived.nodeType).toBe('task');
      expect(revived.tool).toBe('gemini');
      expect(revived.prompt).toBe('Now I work');
      expect(revived.maxRetries).toBe(1);
      expect(revived.gateCondition).toBeNull(); // no residual
      expect(revived.triggeredConfig).toBeNull(); // no residual
      expect(revived.positionX).toBe(300);
    });

    it('gate → triggered → task transition chain clears/sets fields correctly', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Gate Start',
        nodeType: 'gate',
        gateCondition: { mode: 'and', matchValue: 'all_done' },
        returnValues: ['true', 'false'],
      });

      // gate → triggered
      store.updateNode(node.id, {
        nodeType: 'triggered',
        tool: 'claude',
        prompt: 'Wait for event',
        gateCondition: null,
        triggeredConfig: { waitTimeoutSec: 600, onTimeout: 'skip' },
        returnValues: ['done'],
      });

      const asTriggered = expectPresent(store.getNodeById(node.id));
      expect(asTriggered.nodeType).toBe('triggered');
      expect(asTriggered.gateCondition).toBeNull();
      expect(asTriggered.triggeredConfig).toEqual({ waitTimeoutSec: 600, onTimeout: 'skip' });

      // triggered → task
      store.updateNode(node.id, {
        nodeType: 'task',
        triggeredConfig: null,
      });

      const asTask = expectPresent(store.getNodeById(node.id));
      expect(asTask.nodeType).toBe('task');
      expect(asTask.triggeredConfig).toBeNull();
      expect(asTask.gateCondition).toBeNull();
      expect(asTask.tool).toBe('claude'); // preserved
      expect(asTask.prompt).toBe('Wait for event'); // preserved
    });
  });

  // ── 4. Field Boundary Edge Cases ────────────────────────────────

  describe('field boundary edge cases', () => {
    it('empty string prompt is preserved (not coerced to null)', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Empty Prompt',
        nodeType: 'task',
        tool: 'claude',
        prompt: '',
      });

      // Note: mapNode uses str() which converts empty strings to null for some fields
      // but prompt is preserved as-is through SQLite
      const raw = rawNodeRow(db, node.id);
      expect(raw.prompt).toBe('');
    });

    it('boolean fields survive false → update → read cycles without corruption', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Bool Test',
        nodeType: 'task',
        tool: 'claude',
        allowMcp: false,
        writeInstructionFile: false,
        notifyEnabled: true,
        notifyOnError: false,
      });

      const created = expectPresent(store.getNodeById(node.id));
      expect(created.allowMcp).toBe(false);
      expect(created.writeInstructionFile).toBe(false);
      expect(created.notifyEnabled).toBe(true);
      expect(created.notifyOnError).toBe(false);

      // Update label only — booleans must stay
      store.updateNode(node.id, { label: 'Bool Test Updated' });

      const updated = expectPresent(store.getNodeById(node.id));
      expect(updated.allowMcp).toBe(false);
      expect(updated.writeInstructionFile).toBe(false);
      expect(updated.notifyEnabled).toBe(true);
      expect(updated.notifyOnError).toBe(false);
    });

    it('explicitly toggling boolean fields works correctly', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Toggle',
        nodeType: 'task',
        tool: 'claude',
        allowMcp: true,
        notifyEnabled: false,
      });

      // Toggle allowMcp false → should work
      store.updateNode(node.id, { allowMcp: false });
      expect(store.getNodeById(node.id)?.allowMcp).toBe(false);

      // Toggle back to true
      store.updateNode(node.id, { allowMcp: true });
      expect(store.getNodeById(node.id)?.allowMcp).toBe(true);

      // Toggle notifyEnabled true → should work
      store.updateNode(node.id, { notifyEnabled: true });
      expect(store.getNodeById(node.id)?.notifyEnabled).toBe(true);
    });

    it('zero values for numeric fields are preserved (not treated as null)', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Zeroes',
        nodeType: 'task',
        tool: 'claude',
        maxRetries: 0,
        positionX: 0,
        positionY: 0,
        sortOrder: 0,
      });

      const fetched = expectPresent(store.getNodeById(node.id));
      expect(fetched.maxRetries).toBe(0);
      expect(fetched.positionX).toBe(0);
      expect(fetched.positionY).toBe(0);
      expect(fetched.sortOrder).toBe(0);

      // Update to non-zero
      store.updateNode(node.id, { maxRetries: 5, positionX: 100 });

      // Update back to zero
      store.updateNode(node.id, { maxRetries: 0, positionX: 0 });

      const final = expectPresent(store.getNodeById(node.id));
      expect(final.maxRetries).toBe(0);
      expect(final.positionX).toBe(0);
    });

    it('null timeoutSec is distinct from a set timeoutSec value', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Timeout',
        nodeType: 'task',
        tool: 'claude',
        timeoutSec: null,
      });

      expect(store.getNodeById(node.id)?.timeoutSec).toBeNull();

      // Set to a valid value
      store.updateNode(node.id, { timeoutSec: 60 });
      expect(store.getNodeById(node.id)?.timeoutSec).toBe(60);

      // Set back to null (disable timeout)
      store.updateNode(node.id, { timeoutSec: null });
      expect(store.getNodeById(node.id)?.timeoutSec).toBeNull();

      // Set to another valid value
      store.updateNode(node.id, { timeoutSec: 3600 });
      expect(store.getNodeById(node.id)?.timeoutSec).toBe(3600);
    });

    it('agentId can be set, preserved through updates, and cleared', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Agent Node',
        nodeType: 'task',
        tool: 'claude',
        agentId: 'agent-abc-123',
      });

      expect(store.getNodeById(node.id)?.agentId).toBe('agent-abc-123');

      // Update non-agent field — agentId must persist
      store.updateNode(node.id, { prompt: 'New prompt' });
      expect(store.getNodeById(node.id)?.agentId).toBe('agent-abc-123');

      // Clear agentId
      store.updateNode(node.id, { agentId: null });
      expect(store.getNodeById(node.id)?.agentId).toBeNull();

      // Set again
      store.updateNode(node.id, { agentId: 'agent-xyz-456' });
      expect(store.getNodeById(node.id)?.agentId).toBe('agent-xyz-456');
    });

    it('returnConditions with complex nested JSON survives round-trip', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const complexConditions = [
        {
          condition: 'output matches /^SUCCESS:\\s+(?:all|partial)\\s+tasks\\s+completed$/m',
          value: 'success',
        },
        { condition: 'output contains "FAILED: insufficient permissions"', value: 'auth_error' },
        { condition: 'output matches /ERROR:\\s+timeout\\s+after\\s+\\d+s/i', value: 'timeout' },
        { condition: 'exit code != 0', value: 'error_return' },
        { condition: 'output contains "\\n\\t\\"escaped\\"\\n"', value: 'special_chars' },
      ];

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Complex RC',
        nodeType: 'task',
        tool: 'claude',
        returnConditions: complexConditions,
      });

      const fetched = expectPresent(store.getNodeById(node.id));
      expect(fetched.returnConditions).toEqual(complexConditions);

      // Update through store
      store.updateNode(node.id, { returnConditions: complexConditions });
      const updated = expectPresent(store.getNodeById(node.id));
      expect(updated.returnConditions).toEqual(complexConditions);
    });

    it('large prompt (64KB) is preserved without truncation', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const largePrompt = 'A'.repeat(65536);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Large Prompt',
        nodeType: 'task',
        tool: 'claude',
        prompt: largePrompt,
      });

      const fetched = expectPresent(store.getNodeById(node.id));
      expect(fetched.prompt).toBe(largePrompt);
      expect(fetched.prompt?.length).toBe(65536);
    });

    it('notifyChannel with various string formats is preserved', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const testValues = [
        'C12345678',
        '#general',
        'DM-channel_name',
        'thread-ts:1234567890.123456',
      ];

      for (const channel of testValues) {
        const node = store.createNode({
          orchestratorId: orch.id,
          label: `Notify ${channel}`,
          nodeType: 'task',
          tool: 'claude',
          notifyChannel: channel,
          notifyEnabled: true,
        });

        const fetched = expectPresent(store.getNodeById(node.id));
        expect(fetched.notifyChannel).toBe(channel);
        expect(fetched.notifyEnabled).toBe(true);
      }
    });
  });

  // ── 5. Sequential / Concurrent Update Isolation ─────────────────

  describe('sequential and concurrent update isolation', () => {
    it('two sequential partial updates to different fields both take effect', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Multi-Update',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Initial',
        maxRetries: 0,
        timeoutSec: null,
        allowMcp: true,
      });

      // Update 1: prompt + maxRetries
      store.updateNode(node.id, { prompt: 'Updated prompt', maxRetries: 3 });

      // Update 2: timeoutSec + allowMcp (different fields)
      store.updateNode(node.id, { timeoutSec: 300, allowMcp: false });

      const final = expectPresent(store.getNodeById(node.id));
      // Both updates must be reflected
      expect(final.prompt).toBe('Updated prompt');
      expect(final.maxRetries).toBe(3);
      expect(final.timeoutSec).toBe(300);
      expect(final.allowMcp).toBe(false);
      // Untouched fields preserved
      expect(final.tool).toBe('claude');
      expect(final.label).toBe('Multi-Update');
    });

    it('optimistic locking prevents stale overwrite of concurrent edits', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Contested',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Original',
      });

      // Fix timestamp to avoid sub-millisecond collision
      const t0 = '2025-06-01T00:00:00.000Z';
      db.prepare('UPDATE orchestrator_nodes SET updated_at = ? WHERE id = ?').run(t0, node.id);

      // "User A" updates with correct timestamp
      store.updateNode(node.id, { prompt: 'User A edit' }, t0);

      // "User B" tries with the same (now stale) timestamp
      expect(() => {
        store.updateNode(node.id, { prompt: 'User B edit' }, t0);
      }).toThrow(StaleUpdateError);

      // User A's edit wins
      expect(store.getNodeById(node.id)?.prompt).toBe('User A edit');
    });

    it('optimistic locking on orchestrator-level updates prevents data loss', () => {
      db = createDb();
      const store = new OrchestratorStore(db);
      const orch = store.create({ name: 'Concurrent Orch' });

      const t0 = '2025-06-01T00:00:00.000Z';
      db.prepare('UPDATE orchestrators SET updated_at = ? WHERE id = ?').run(t0, orch.id);

      // First update succeeds
      store.update(orch.id, { description: 'Updated by User A' }, t0);

      // Second update with stale timestamp fails
      expect(() => {
        store.update(orch.id, { description: 'Updated by User B' }, t0);
      }).toThrow(StaleUpdateError);

      expect(store.getById(orch.id)?.description).toBe('Updated by User A');
    });

    it('node update without optimistic locking always succeeds (last-write-wins)', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'No Lock',
        nodeType: 'task',
        tool: 'claude',
      });

      // Both updates succeed (no expectedUpdatedAt)
      store.updateNode(node.id, { prompt: 'First' });
      store.updateNode(node.id, { prompt: 'Second' });

      expect(store.getNodeById(node.id)?.prompt).toBe('Second');
    });

    it('rapid sequential updates to same field preserve final value', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Rapid',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'V0',
      });

      for (let i = 1; i <= 20; i++) {
        store.updateNode(node.id, { prompt: `V${i}` });
      }

      expect(store.getNodeById(node.id)?.prompt).toBe('V20');
    });
  });

  // ── 6. Event Subscription Cascading ─────────────────────────────

  describe('event subscription cascading', () => {
    it('triggered node deletion cascades event_subscriptions', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const triggered = store.createNode({
        orchestratorId: orch.id,
        label: 'Event Handler',
        nodeType: 'triggered',
        tool: 'claude',
        triggeredConfig: { waitTimeoutSec: 60, onTimeout: 'fail' },
      });

      // Insert a subscription manually
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO event_subscriptions
          (id, endpoint_id, target_type, node_id, enabled, created_at, updated_at)
         VALUES (?, ?, 'triggered_node', ?, 1, ?, ?)`,
      ).run('sub-1', 'ep-1', triggered.id, now, now);

      // Verify subscription exists
      const subBefore = db
        .prepare('SELECT * FROM event_subscriptions WHERE node_id = ?')
        .get(triggered.id);
      expect(subBefore).not.toBeUndefined();

      // Delete node
      store.deleteNode(triggered.id);

      // Subscription must be cascaded
      const subAfter = db
        .prepare('SELECT * FROM event_subscriptions WHERE node_id = ?')
        .get(triggered.id);
      expect(subAfter).toBeUndefined();
    });

    it('triggered → task type change clears subscription via store', () => {
      db = createDb();
      const graphStore = new OrchestratorGraphStore(db);
      createRawOrchestrator(db, 'orch-sub-clear', 'Sub Clear', 'start');

      const triggered = graphStore.createNode({
        orchestratorId: 'orch-sub-clear',
        label: 'Triggered',
        nodeType: 'triggered',
        tool: 'claude',
        triggeredConfig: { waitTimeoutSec: 60, onTimeout: 'fail' },
      });

      // Insert subscription
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO event_subscriptions
          (id, endpoint_id, target_type, node_id, enabled, created_at, updated_at)
         VALUES (?, ?, 'triggered_node', ?, 1, ?, ?)`,
      ).run('sub-2', 'ep-1', triggered.id, now, now);

      // Change type from triggered → task (store auto-clears subscription)
      graphStore.updateNode(triggered.id, {
        nodeType: 'task',
        triggeredConfig: null,
      });

      // Subscription should be deleted
      const sub = db
        .prepare('SELECT * FROM event_subscriptions WHERE node_id = ?')
        .get(triggered.id);
      expect(sub).toBeUndefined();
    });

    it('task → task type "change" does NOT clear subscriptions', () => {
      db = createDb();
      const graphStore = new OrchestratorGraphStore(db);
      createRawOrchestrator(db, 'orch-no-clear', 'No Clear', 'start');

      const task = graphStore.createNode({
        orchestratorId: 'orch-no-clear',
        label: 'Task',
        nodeType: 'task',
        tool: 'claude',
      });

      // Insert subscription (shouldn't normally exist for task, but testing edge case)
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO event_subscriptions
          (id, endpoint_id, target_type, node_id, enabled, created_at, updated_at)
         VALUES (?, ?, 'triggered_node', ?, 1, ?, ?)`,
      ).run('sub-3', 'ep-1', task.id, now, now);

      // Update without changing nodeType
      graphStore.updateNode(task.id, { label: 'Updated Task' });

      // Subscription must still exist
      const sub = db.prepare('SELECT * FROM event_subscriptions WHERE node_id = ?').get(task.id);
      expect(sub).not.toBeUndefined();
    });
  });

  // ── 7. Full DAG Lifecycle Simulation ────────────────────────────

  describe('full DAG lifecycle simulation', () => {
    it('create → configure → snapshot → edit → revert preserves original DAG exactly', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      // ── Phase 1: Build a complex DAG ──
      const startNode = expectPresent(store.getNodeById(orch.startNodeId));

      // Task A: Code review
      const taskA = store.createNode({
        orchestratorId: orch.id,
        label: 'Code Review',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Review the PR for correctness',
        maxRetries: 1,
        timeoutSec: 600,
        allowMcp: true,
        enabledMcpServerIds: ['github-mcp'],
        workdir: '/repos/main',
        writeInstructionFile: true,
        outputMode: 'auto',
        returnConditions: [
          { condition: 'output contains "LGTM"', value: 'approved' },
          { condition: 'output contains "changes requested"', value: 'needs_work' },
        ],
        returnValues: ['approved', 'needs_work'],
        notifyEnabled: true,
        notifyChannel: 'C-review',
        notifyOnError: true,
        positionX: 200,
        positionY: 100,
        sortOrder: 1,
      });

      // Task B: Security scan
      const taskB = store.createNode({
        orchestratorId: orch.id,
        label: 'Security Scan',
        nodeType: 'task',
        tool: 'codex',
        prompt: 'Run security analysis on changed files',
        maxRetries: 2,
        timeoutSec: 900,
        allowMcp: false,
        returnValues: ['clean', 'issues_found'],
        positionX: 200,
        positionY: 300,
        sortOrder: 2,
      });

      // Gate: Both must approve
      const gate = store.createNode({
        orchestratorId: orch.id,
        label: 'Approval Gate',
        nodeType: 'gate',
        gateCondition: { mode: 'and', matchValue: 'approved' },
        returnValues: ['true', 'false'],
        positionX: 400,
        positionY: 200,
        sortOrder: 3,
      });

      // End node
      const endNode = store.createNode({
        orchestratorId: orch.id,
        label: 'Complete',
        nodeType: 'end',
        positionX: 600,
        positionY: 200,
        sortOrder: 4,
      });

      // Edges
      const e1 = store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: startNode.id,
        toNodeId: taskA.id,
        conditionValue: 'done',
        conditionOperator: 'eq',
        sortOrder: 0,
      });
      const e2 = store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: startNode.id,
        toNodeId: taskB.id,
        conditionValue: 'done',
        conditionOperator: 'eq',
        sortOrder: 1,
      });
      const e3 = store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: taskA.id,
        toNodeId: gate.id,
        conditionValue: 'approved',
        conditionOperator: 'eq',
      });
      const e4 = store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: taskB.id,
        toNodeId: gate.id,
        conditionValue: 'clean',
        conditionOperator: 'eq',
      });
      const e5 = store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: gate.id,
        toNodeId: endNode.id,
        conditionValue: 'true',
        conditionOperator: 'eq',
      });

      // ── Phase 2: Validate and save snapshot ──
      store.saveValidatedSnapshot(orch.id);

      // ── Phase 3: Make destructive edits ──
      // Delete an edge
      store.deleteEdge(e3.id);

      // Modify a node
      store.updateNode(taskA.id, {
        prompt: 'MODIFIED: This should be lost',
        maxRetries: 10,
        tool: 'gemini',
      });

      // Add a new unwanted node
      const unwanted = store.createNode({
        orchestratorId: orch.id,
        label: 'Unwanted',
        nodeType: 'task',
        tool: 'claude',
      });

      // Verify modifications took effect
      expect(store.getNodeById(taskA.id)?.prompt).toBe('MODIFIED: This should be lost');
      expect(store.getEdgeById(e3.id)).toBeNull();
      expect(store.getNodeById(unwanted.id)).not.toBeNull();

      // ── Phase 4: Revert to validated snapshot ──
      const reverted = store.revertToValidatedSnapshot(orch.id);
      expect(reverted).toBe(true);

      // ── Phase 5: Verify everything is restored exactly ──
      const restoredNodes = store.getNodesByOrchestrator(orch.id);
      const restoredEdges = store.getEdgesByOrchestrator(orch.id);

      // 1 start + 4 created = 5 nodes (unwanted node gone)
      expect(restoredNodes).toHaveLength(5);
      expect(restoredEdges).toHaveLength(5);

      // Unwanted node must be gone
      expect(store.getNodeById(unwanted.id)).toBeNull();

      // Task A must be original
      const restoredA = expectPresent(restoredNodes.find((n) => n.id === taskA.id));
      expect(restoredA.prompt).toBe('Review the PR for correctness');
      expect(restoredA.maxRetries).toBe(1);
      expect(restoredA.timeoutSec).toBe(600);
      expect(restoredA.tool).toBe('claude');
      expect(restoredA.allowMcp).toBe(true);
      expect(restoredA.enabledMcpServerIds).toEqual(['github-mcp']);
      expect(restoredA.workdir).toBe('/repos/main');
      expect(restoredA.returnConditions).toEqual([
        { condition: 'output contains "LGTM"', value: 'approved' },
        { condition: 'output contains "changes requested"', value: 'needs_work' },
      ]);
      expect(restoredA.notifyEnabled).toBe(true);
      expect(restoredA.notifyChannel).toBe('C-review');
      expect(restoredA.positionX).toBe(200);
      expect(restoredA.positionY).toBe(100);

      // Task B preserved
      const restoredB = expectPresent(restoredNodes.find((n) => n.id === taskB.id));
      expect(restoredB.tool).toBe('codex');
      expect(restoredB.maxRetries).toBe(2);
      expect(restoredB.timeoutSec).toBe(900);
      expect(restoredB.allowMcp).toBe(false);

      // Gate preserved
      const restoredGate = expectPresent(restoredNodes.find((n) => n.id === gate.id));
      expect(restoredGate.gateCondition).toEqual({ mode: 'and', matchValue: 'approved' });

      // End preserved
      const restoredEnd = expectPresent(restoredNodes.find((n) => n.id === endNode.id));
      expect(restoredEnd.nodeType).toBe('end');
      expect(restoredEnd.positionX).toBe(600);

      // Deleted edge e3 must be restored
      const restoredE3 = expectPresent(restoredEdges.find((e) => e.id === e3.id));
      expect(restoredE3).not.toBeUndefined();
      expect(restoredE3.conditionValue).toBe('approved');
      expect(restoredE3.conditionOperator).toBe('eq');

      // All edges present
      for (const edgeId of [e1.id, e2.id, e3.id, e4.id, e5.id]) {
        const edge = restoredEdges.find((e) => e.id === edgeId);
        expect(edge).not.toBeUndefined();
      }
    });

    it('complex diamond+branch DAG survives snapshot cycle with node-level integrity', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);
      const start = expectPresent(store.getNodeById(orch.startNodeId));

      // Diamond: Start → A,B → Gate1 → C → End
      // Branch:  Gate1(false) → D → End
      const a = store.createNode({
        orchestratorId: orch.id,
        label: 'A',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Task A',
        agentId: 'agent-a',
        returnValues: ['done'],
        positionX: 150,
        positionY: 50,
      });
      const b = store.createNode({
        orchestratorId: orch.id,
        label: 'B',
        nodeType: 'task',
        tool: 'codex',
        prompt: 'Task B',
        returnValues: ['done'],
        positionX: 150,
        positionY: 250,
      });
      const gate1 = store.createNode({
        orchestratorId: orch.id,
        label: 'Gate1',
        nodeType: 'gate',
        gateCondition: { mode: 'and', matchValue: 'done' },
      });
      const c = store.createNode({
        orchestratorId: orch.id,
        label: 'C',
        nodeType: 'task',
        tool: 'gemini',
        prompt: 'Final task',
        returnValues: ['done'],
      });
      const d = store.createNode({
        orchestratorId: orch.id,
        label: 'D (Fallback)',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Fallback path',
        returnValues: ['done'],
      });
      const end = store.createNode({
        orchestratorId: orch.id,
        label: 'End',
        nodeType: 'end',
      });

      // Edges
      store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: start.id,
        toNodeId: a.id,
        conditionValue: 'done',
      });
      store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: start.id,
        toNodeId: b.id,
        conditionValue: 'done',
      });
      store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: a.id,
        toNodeId: gate1.id,
        conditionValue: 'done',
      });
      store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: b.id,
        toNodeId: gate1.id,
        conditionValue: 'done',
      });
      store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: gate1.id,
        toNodeId: c.id,
        conditionValue: 'true',
      });
      store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: gate1.id,
        toNodeId: d.id,
        conditionValue: 'false',
      });
      store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: c.id,
        toNodeId: end.id,
        conditionValue: 'done',
      });
      store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: d.id,
        toNodeId: end.id,
        conditionValue: 'done',
      });

      // Snapshot
      store.saveValidatedSnapshot(orch.id);

      // Destroy everything except start
      for (const n of [end, d, c, gate1, b, a]) store.deleteNode(n.id);
      expect(store.getNodesByOrchestrator(orch.id)).toHaveLength(1); // only start

      // Revert
      store.revertToValidatedSnapshot(orch.id);

      const nodes = store.getNodesByOrchestrator(orch.id);
      const edges = store.getEdgesByOrchestrator(orch.id);

      // 1 start + 6 created = 7 nodes, 8 edges
      expect(nodes).toHaveLength(7);
      expect(edges).toHaveLength(8);

      // Verify agentId preserved
      const restoredA = expectPresent(nodes.find((n) => n.id === a.id));
      expect(restoredA.agentId).toBe('agent-a');
      expect(restoredA.tool).toBe('claude');

      // Verify edge branching intact
      const gate1Edges = edges.filter((e) => e.fromNodeId === gate1.id);
      expect(gate1Edges).toHaveLength(2);
      const trueEdge = expectPresent(gate1Edges.find((e) => e.conditionValue === 'true'));
      const falseEdge = expectPresent(gate1Edges.find((e) => e.conditionValue === 'false'));
      expect(trueEdge.toNodeId).toBe(c.id);
      expect(falseEdge.toNodeId).toBe(d.id);
    });
  });

  // ── 8. Orchestrator-Level Data Preservation ─────────────────────

  describe('orchestrator-level data preservation', () => {
    it('partial orchestrator update preserves all other fields', () => {
      db = createDb();
      const store = new OrchestratorStore(db);
      const orch = store.create({
        name: 'Full Config',
        alias: 'full-cfg',
        description: 'A fully configured orchestrator',
        workdir: '/project',
        timezone: 'Asia/Tokyo',
        maxParallelism: 5,
        maxTotalNodes: 100,
        errorPolicy: 'fail_fast',
        timeoutSec: 3600,
      });

      // Update only description
      store.update(orch.id, { description: 'Updated description' });

      const updated = expectPresent(store.getById(orch.id));
      expect(updated.description).toBe('Updated description');
      expect(updated.name).toBe('Full Config');
      expect(updated.alias).toBe('full-cfg');
      expect(updated.workdir).toBe('/project');
      expect(updated.timezone).toBe('Asia/Tokyo');
      expect(updated.maxParallelism).toBe(5);
      expect(updated.maxTotalNodes).toBe(100);
      expect(updated.errorPolicy).toBe('fail_fast');
      expect(updated.timeoutSec).toBe(3600);
    });

    it('soft delete preserves data but hides from list', () => {
      db = createDb();
      const store = new OrchestratorStore(db);
      const orch = store.create({ name: 'To Delete' });

      store.softDelete(orch.id);

      // Not in default list
      expect(store.list().find((o) => o.id === orch.id)).toBeUndefined();

      // Still accessible by ID
      const deleted = expectPresent(store.getById(orch.id));
      expect(deleted.status).toBe('deleted');
      expect(deleted.name).toBe('To Delete');
    });

    it('invalidateDag only modifies dag_validated flag', () => {
      db = createDb();
      const store = new OrchestratorStore(db);
      const orch = store.create({ name: 'DAG Flag Test' });

      // Manually validate
      db.prepare('UPDATE orchestrators SET dag_validated = 1 WHERE id = ?').run(orch.id);

      const before = expectPresent(store.getById(orch.id));
      expect(before.dagValidated).toBe(true);

      store.invalidateDag(orch.id);

      const after = expectPresent(store.getById(orch.id));
      expect(after.dagValidated).toBe(false);
      // All other fields unchanged
      expect(after.name).toBe(before.name);
      expect(after.maxParallelism).toBe(before.maxParallelism);
      expect(after.errorPolicy).toBe(before.errorPolicy);
    });
  });

  // ── 9. Edge Deletion and Re-creation ────────────────────────────

  describe('edge deletion and re-creation integrity', () => {
    it('deleting and re-creating edges does not corrupt node data', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const nodeA = store.createNode({
        orchestratorId: orch.id,
        label: 'A',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Task A',
        returnValues: ['done', 'fail'],
      });
      const nodeB = store.createNode({
        orchestratorId: orch.id,
        label: 'B',
        nodeType: 'task',
        tool: 'codex',
      });

      const edge = store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        conditionValue: 'done',
        conditionOperator: 'eq',
      });

      // Delete edge
      store.deleteEdge(edge.id);
      expect(store.getEdgeById(edge.id)).toBeNull();

      // Nodes must be intact
      expect(store.getNodeById(nodeA.id)?.prompt).toBe('Task A');
      expect(store.getNodeById(nodeB.id)?.tool).toBe('codex');

      // Re-create edge with different condition
      const newEdge = store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        conditionValue: 'fail',
        conditionOperator: 'neq',
      });

      expect(newEdge.conditionValue).toBe('fail');
      expect(newEdge.conditionOperator).toBe('neq');
      expect(newEdge.fromNodeId).toBe(nodeA.id);
      expect(newEdge.toNodeId).toBe(nodeB.id);
    });

    it('deleteEdgesByOrchestrator removes all edges but preserves nodes', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const nodes: OrchestratorNode[] = [];
      for (let i = 0; i < 5; i++) {
        nodes.push(
          store.createNode({
            orchestratorId: orch.id,
            label: `N${i}`,
            nodeType: i === 4 ? 'end' : 'task',
            tool: i === 4 ? null : 'claude',
            prompt: i === 4 ? null : `Prompt ${i}`,
          }),
        );
      }

      for (let i = 0; i < 4; i++) {
        const fromNode = nodes[i];
        const toNode = nodes[i + 1];
        if (!fromNode || !toNode) throw new Error(`Missing node at index ${i}`);
        store.createEdge({
          orchestratorId: orch.id,
          fromNodeId: fromNode.id,
          toNodeId: toNode.id,
        });
      }

      expect(store.getEdgesByOrchestrator(orch.id)).toHaveLength(4);

      store.deleteEdgesByOrchestrator(orch.id);

      expect(store.getEdgesByOrchestrator(orch.id)).toHaveLength(0);

      // All nodes still intact with their data
      for (let i = 0; i < 5; i++) {
        const n = nodes[i];
        if (!n) throw new Error(`Missing node at index ${i}`);
        const node = expectPresent(store.getNodeById(n.id));
        expect(node).not.toBeNull();
        expect(node.label).toBe(`N${i}`);
      }
    });
  });

  // ── 10. Start Node Protection ──────────────────────────────────

  describe('start node protection', () => {
    it('start node cannot be deleted', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      expect(() => {
        store.deleteNode(orch.startNodeId);
      }).toThrow('Start node cannot be deleted');

      // Start node still exists
      expect(store.getNodeById(orch.startNodeId)).not.toBeNull();
    });

    it('start node type cannot be changed', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      expect(() => {
        store.updateNode(orch.startNodeId, { nodeType: 'gate' });
      }).toThrow('Start node type cannot be changed');

      expect(store.getNodeById(orch.startNodeId)?.nodeType).toBe('task');
    });

    it('start node other fields can be updated', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      store.updateNode(orch.startNodeId, {
        prompt: 'Updated start prompt',
        label: 'Updated Start',
      });

      const updated = expectPresent(store.getNodeById(orch.startNodeId));
      expect(updated.prompt).toBe('Updated start prompt');
      expect(updated.label).toBe('Updated Start');
      expect(updated.nodeType).toBe('task'); // still task
    });
  });

  // ── 11. Snapshot with Edge Cases ────────────────────────────────

  describe('snapshot with edge cases', () => {
    it('snapshot of empty DAG (no nodes) survives save-revert', () => {
      db = createDb();
      createRawOrchestrator(db, 'orch-empty', 'Empty', 'start');

      const graphStore = new OrchestratorGraphStore(db);

      // No nodes at all
      saveValidatedSnapshot(db, graphStore, 'orch-empty');
      revertToValidatedSnapshot(db, 'orch-empty');

      expect(graphStore.getNodesByOrchestrator('orch-empty')).toHaveLength(0);
      expect(graphStore.getEdgesByOrchestrator('orch-empty')).toHaveLength(0);
    });

    it('snapshot with single node (no edges) preserves node data', () => {
      db = createDb();
      const graphStore = new OrchestratorGraphStore(db);
      createRawOrchestrator(db, 'orch-single', 'Single', 'start');

      const solo = graphStore.createNode({
        orchestratorId: 'orch-single',
        label: 'Solo',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Alone',
      });

      saveValidatedSnapshot(db, graphStore, 'orch-single');
      graphStore.deleteNode(solo.id);
      revertToValidatedSnapshot(db, 'orch-single');

      const restored = expectPresent(graphStore.getNodeById(solo.id));
      expect(restored.label).toBe('Solo');
      expect(restored.prompt).toBe('Alone');
    });

    it('snapshot revert is transactional — partial failure does not corrupt DB', () => {
      db = createDb();
      const graphStore = new OrchestratorGraphStore(db);
      createRawOrchestrator(db, 'orch-txn', 'Txn', 'start');

      const node = graphStore.createNode({
        orchestratorId: 'orch-txn',
        label: 'Safe',
        nodeType: 'task',
        tool: 'claude',
      });

      saveValidatedSnapshot(db, graphStore, 'orch-txn');

      // Modify the snapshot to contain invalid limit values
      const snap = JSON.parse(expectPresent(rawSnapshot(db, 'orch-txn')));
      snap.nodes[0].maxRetries = 999; // exceeds limit
      db.prepare('UPDATE orchestrators SET validated_snapshot = ? WHERE id = ?').run(
        JSON.stringify(snap),
        'orch-txn',
      );

      // Revert should throw due to invalid limits
      expect(() => {
        expect(db).not.toBeNull();
        revertToValidatedSnapshot(db as Database.Database, 'orch-txn');
      }).toThrow();

      // Original node should still exist (transaction rolled back)
      const original = expectPresent(graphStore.getNodeById(node.id));
      expect(original.label).toBe('Safe');
    });
  });

  // ── 12. Multi-Orchestrator Isolation ────────────────────────────

  describe('multi-orchestrator isolation', () => {
    it('operations on one orchestrator do not affect another', () => {
      db = createDb();
      const store = new OrchestratorStore(db);
      const orch1 = store.create({ name: 'Pipeline 1' });
      const orch2 = store.create({ name: 'Pipeline 2' });

      // Add nodes to orch1
      const nodeA = store.createNode({
        orchestratorId: orch1.id,
        label: 'Orch1 Task',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'For pipeline 1',
      });

      // Add nodes to orch2
      const nodeB = store.createNode({
        orchestratorId: orch2.id,
        label: 'Orch2 Task',
        nodeType: 'task',
        tool: 'codex',
        prompt: 'For pipeline 2',
      });

      // Delete node from orch1
      store.deleteNode(nodeA.id);

      // orch2's node must be unaffected
      const orch2Node = expectPresent(store.getNodeById(nodeB.id));
      expect(orch2Node.label).toBe('Orch2 Task');
      expect(orch2Node.tool).toBe('codex');

      // orch1 and orch2 node counts
      const orch1Nodes = store.getNodesByOrchestrator(orch1.id);
      const orch2Nodes = store.getNodesByOrchestrator(orch2.id);
      // orch1: only start node (nodeA deleted)
      expect(orch1Nodes).toHaveLength(1);
      // orch2: start + nodeB
      expect(orch2Nodes).toHaveLength(2);
    });

    it('snapshot revert on one orchestrator does not affect another', () => {
      db = createDb();
      const store = new OrchestratorStore(db);
      const orch1 = store.create({ name: 'Snap1' });
      const orch2 = store.create({ name: 'Snap2' });

      const node1 = store.createNode({
        orchestratorId: orch1.id,
        label: 'Node1',
        nodeType: 'task',
        tool: 'claude',
      });

      const node2 = store.createNode({
        orchestratorId: orch2.id,
        label: 'Node2',
        nodeType: 'task',
        tool: 'codex',
        prompt: 'Must survive',
      });

      // Snapshot both
      store.saveValidatedSnapshot(orch1.id);
      store.saveValidatedSnapshot(orch2.id);

      // Modify orch2
      store.updateNode(node2.id, { prompt: 'Modified' });

      // Revert only orch1
      store.revertToValidatedSnapshot(orch1.id);

      // orch2's modification must persist (not reverted)
      expect(store.getNodeById(node2.id)?.prompt).toBe('Modified');

      // orch1 restored
      expect(store.getNodeById(node1.id)).not.toBeNull();
    });
  });
});
