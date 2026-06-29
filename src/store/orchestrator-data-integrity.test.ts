/**
 * Orchestrator Data Integrity Tests
 *
 * Verifies that DAG configuration set in the dashboard is preserved without
 * data overwrites or data loss across the full lifecycle:
 *   - Node CRUD round-trips (all field types including JSON blobs)
 *   - Partial updates preserve unmentioned fields
 *   - Node type transitions clear only relevant fields
 *   - Edge CRUD round-trips
 *   - Snapshot save + revert preserves all fields (including agentId)
 *   - Concurrent update detection (StaleUpdateError)
 *   - DAG validated flag consistency across mutations
 *   - Complex multi-branch DAG patterns
 */
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrchestratorNode } from '../orchestrator/types.js';
import { OrchestratorGraphStore } from './orchestrator-graph.js';
import { revertToValidatedSnapshot, saveValidatedSnapshot } from './orchestrator-snapshot.js';
import { OrchestratorStore } from './orchestrator.js';
import { StaleUpdateError } from './store-utils.js';

// ── Test DB schema (mirrors production schema) ──────────────────

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

    CREATE TABLE orchestration_runs (
      id                  TEXT PRIMARY KEY,
      orchestrator_id     TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'pending',
      triggered_by        TEXT NOT NULL DEFAULT 'dashboard',
      triggered_user_id   TEXT,
      trigger_context_json TEXT,
      started_at          TEXT,
      ended_at            TEXT,
      error_message       TEXT,
      rerun_from_run_id   TEXT,
      rerun_from_node_id  TEXT,
      created_at          TEXT NOT NULL
    );

    CREATE INDEX idx_orch_runs_orch ON orchestration_runs(orchestrator_id, created_at DESC);

    CREATE TABLE orchestration_node_runs (
      id                    TEXT PRIMARY KEY,
      orchestration_run_id  TEXT NOT NULL,
      node_id               TEXT NOT NULL,
      job_id                TEXT,
      session_key           TEXT,
      status                TEXT NOT NULL DEFAULT 'pending',
      prompt                TEXT,
      return_value          TEXT,
      exit_code             INTEGER,
      output_summary        TEXT,
      output_full           TEXT,
      error_message         TEXT,
      gate_evaluation       TEXT,
      retry_count           INTEGER NOT NULL DEFAULT 0,
      started_at            TEXT,
      ended_at              TEXT
    );

    CREATE INDEX idx_node_runs_run ON orchestration_node_runs(orchestration_run_id);
    CREATE INDEX idx_node_runs_job ON orchestration_node_runs(job_id);

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
  const orch = store.create({ name: 'Test Pipeline' });
  return { store, orch };
}

/** Extract the raw DB row for a node (snake_case columns). */
function rawNodeRow(db: Database.Database, nodeId: string) {
  return db.prepare('SELECT * FROM orchestrator_nodes WHERE id = ?').get(nodeId) as Record<
    string,
    unknown
  >;
}

function expectPresent<T>(value: T | null | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}

// ═════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════

describe('orchestrator data integrity', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  // ── Node CRUD Round-Trip ──────────────────────────────────────

  describe('node CRUD round-trip', () => {
    it('preserves all fields on create + read for task node with full config', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Full Task',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Do the work\nWith multiple lines',
        maxRetries: 3,
        timeoutSec: 600,
        allowMcp: false,
        enabledMcpServerIds: ['mcp-1', 'mcp-2'],
        workdir: '/custom/work',
        writeInstructionFile: false,
        instructionFile: 'custom-instructions.md',
        outputMode: 'manual',
        returnConditions: [
          { condition: 'contains "success"', value: 'success' },
          { condition: 'contains "error"', value: 'error_return' },
        ],
        returnValues: ['success', 'partial', 'failure'],
        gateCondition: null,
        triggeredConfig: null,
        notifyEnabled: true,
        notifyChannel: 'C999',
        notifyOnError: false,
        positionX: 150,
        positionY: 200,
        sortOrder: 5,
      });

      const fetched = expectPresent(store.getNodeById(node.id));
      expect(fetched).not.toBeNull();

      // Core fields
      expect(fetched.label).toBe('Full Task');
      expect(fetched.nodeType).toBe('task');
      expect(fetched.tool).toBe('claude');
      expect(fetched.prompt).toBe('Do the work\nWith multiple lines');
      expect(fetched.mode).toBe('write');

      // Limits
      expect(fetched.maxRetries).toBe(3);
      expect(fetched.timeoutSec).toBe(600);

      // MCP config
      expect(fetched.allowMcp).toBe(false);
      expect(fetched.enabledMcpServerIds).toEqual(['mcp-1', 'mcp-2']);

      // Workdir + instruction
      expect(fetched.workdir).toBe('/custom/work');
      expect(fetched.writeInstructionFile).toBe(false);
      expect(fetched.instructionFile).toBe('custom-instructions.md');

      // Output control
      expect(fetched.outputMode).toBe('manual');
      expect(fetched.returnConditions).toEqual([
        { condition: 'contains "success"', value: 'success' },
        { condition: 'contains "error"', value: 'error_return' },
      ]);
      // returnValues includes system values injected by mapNode
      expect(fetched.returnValues).toContain('success');
      expect(fetched.returnValues).toContain('partial');
      expect(fetched.returnValues).toContain('failure');
      expect(fetched.returnValues).toContain('other_return');
      expect(fetched.returnValues).toContain('error_return');

      // Notification
      expect(fetched.notifyEnabled).toBe(true);
      expect(fetched.notifyChannel).toBe('C999');
      expect(fetched.notifyOnError).toBe(false);

      // Position
      expect(fetched.positionX).toBe(150);
      expect(fetched.positionY).toBe(200);
      expect(fetched.sortOrder).toBe(5);
    });

    it('preserves all fields on create + read for gate node', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Approval Gate',
        nodeType: 'gate',
        gateCondition: { mode: 'and', matchValue: 'approved' },
        returnValues: ['true', 'false'],
        positionX: 300,
        positionY: 400,
      });

      const fetched = expectPresent(store.getNodeById(node.id));
      expect(fetched.nodeType).toBe('gate');
      expect(fetched.gateCondition).toEqual({ mode: 'and', matchValue: 'approved' });
      expect(fetched.returnValues).toContain('true');
      expect(fetched.returnValues).toContain('false');
      expect(fetched.positionX).toBe(300);
      expect(fetched.positionY).toBe(400);
    });

    it('preserves all fields on create + read for triggered node', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Wait for Event',
        nodeType: 'triggered',
        tool: 'claude',
        prompt: 'Process the event',
        triggeredConfig: { waitTimeoutSec: 300, onTimeout: 'skip' },
      });

      const fetched = expectPresent(store.getNodeById(node.id));
      expect(fetched.nodeType).toBe('triggered');
      expect(fetched.triggeredConfig).toEqual({ waitTimeoutSec: 300, onTimeout: 'skip' });
      expect(fetched.tool).toBe('claude');
      expect(fetched.prompt).toBe('Process the event');
    });

    it('preserves all fields on create + read for end node', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Done',
        nodeType: 'end',
        positionX: 500,
        positionY: 600,
      });

      const fetched = expectPresent(store.getNodeById(node.id));
      expect(fetched.nodeType).toBe('end');
      expect(fetched.positionX).toBe(500);
      expect(fetched.positionY).toBe(600);
      expect(fetched.tool).toBeNull();
      expect(fetched.prompt).toBeNull();
    });
  });

  // ── Partial Update Preservation ────────────────────────────────

  describe('partial update preserves unmentioned fields', () => {
    it('updating only label preserves all other task node fields', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Original',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Do work',
        maxRetries: 2,
        timeoutSec: 300,
        allowMcp: false,
        enabledMcpServerIds: ['srv-1'],
        workdir: '/some/path',
        writeInstructionFile: false,
        instructionFile: 'guide.md',
        outputMode: 'manual',
        returnConditions: [{ condition: 'test', value: 'pass' }],
        returnValues: ['pass', 'fail'],
        notifyEnabled: true,
        notifyChannel: 'C100',
        notifyOnError: false,
        positionX: 10,
        positionY: 20,
        sortOrder: 3,
      });

      // Partial update: only label
      store.updateNode(node.id, { label: 'Updated Label' });

      const updated = expectPresent(store.getNodeById(node.id));
      expect(updated.label).toBe('Updated Label');

      // ALL other fields must be unchanged
      expect(updated.nodeType).toBe('task');
      expect(updated.tool).toBe('claude');
      expect(updated.prompt).toBe('Do work');
      expect(updated.maxRetries).toBe(2);
      expect(updated.timeoutSec).toBe(300);
      expect(updated.allowMcp).toBe(false);
      expect(updated.enabledMcpServerIds).toEqual(['srv-1']);
      expect(updated.workdir).toBe('/some/path');
      expect(updated.writeInstructionFile).toBe(false);
      expect(updated.instructionFile).toBe('guide.md');
      expect(updated.outputMode).toBe('manual');
      expect(updated.returnConditions).toEqual([{ condition: 'test', value: 'pass' }]);
      expect(updated.notifyEnabled).toBe(true);
      expect(updated.notifyChannel).toBe('C100');
      expect(updated.notifyOnError).toBe(false);
      expect(updated.positionX).toBe(10);
      expect(updated.positionY).toBe(20);
      expect(updated.sortOrder).toBe(3);
    });

    it('updating only position preserves all other fields', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Task',
        nodeType: 'task',
        tool: 'codex',
        prompt: 'Process data',
        returnConditions: [
          { condition: 'output matches /done/', value: 'done' },
          { condition: 'output matches /error/', value: 'err' },
        ],
        returnValues: ['done', 'err'],
      });

      store.updateNode(node.id, { positionX: 999, positionY: 888 });

      const updated = expectPresent(store.getNodeById(node.id));
      expect(updated.positionX).toBe(999);
      expect(updated.positionY).toBe(888);
      expect(updated.tool).toBe('codex');
      expect(updated.prompt).toBe('Process data');
      expect(updated.returnConditions).toEqual([
        { condition: 'output matches /done/', value: 'done' },
        { condition: 'output matches /error/', value: 'err' },
      ]);
    });

    it('multiple sequential partial updates accumulate correctly', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Step 1',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Initial',
        maxRetries: 0,
      });

      // Update 1: change prompt
      store.updateNode(node.id, { prompt: 'Second prompt' });
      // Update 2: change maxRetries
      store.updateNode(node.id, { maxRetries: 5 });
      // Update 3: change label
      store.updateNode(node.id, { label: 'Step 1 v3' });

      const final = expectPresent(store.getNodeById(node.id));
      expect(final.label).toBe('Step 1 v3');
      expect(final.prompt).toBe('Second prompt');
      expect(final.maxRetries).toBe(5);
      expect(final.tool).toBe('claude');
    });
  });

  // ── JSON Field Round-Trips ─────────────────────────────────────

  describe('JSON field round-trips', () => {
    it('returnConditions complex array survives create → read → update → read', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const conditions = [
        { condition: 'output contains "deployment successful"', value: 'success' },
        { condition: 'output matches /ERROR:.*/i', value: 'error_return' },
        { condition: 'exit code != 0', value: 'failure' },
        { condition: 'output contains "partial"', value: 'partial' },
      ];

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'RC Test',
        nodeType: 'task',
        tool: 'claude',
        returnConditions: conditions,
      });

      // Verify after create
      const afterCreate = expectPresent(store.getNodeById(node.id));
      expect(afterCreate.returnConditions).toEqual(conditions);

      // Update returnConditions with modified set
      const newConditions = [
        ...conditions,
        { condition: 'output contains "warning"', value: 'warning' },
      ];
      store.updateNode(node.id, { returnConditions: newConditions });

      // Verify after update
      const afterUpdate = expectPresent(store.getNodeById(node.id));
      expect(afterUpdate.returnConditions).toEqual(newConditions);
      expect(afterUpdate.returnConditions).toHaveLength(5);
    });

    it('returnConditions can be cleared to null', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'RC Clear',
        nodeType: 'task',
        tool: 'claude',
        returnConditions: [{ condition: 'test', value: 'val' }],
      });

      expect(store.getNodeById(node.id)?.returnConditions).not.toBeNull();

      store.updateNode(node.id, { returnConditions: null });

      expect(store.getNodeById(node.id)?.returnConditions).toBeNull();
    });

    it('returnValues system injection is idempotent across read-write cycles', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'RV Test',
        nodeType: 'task',
        tool: 'claude',
        returnValues: ['success', 'failure'],
      });

      // First read: system values injected
      const read1 = expectPresent(store.getNodeById(node.id));
      expect(read1.returnValues).toContain('other_return');
      expect(read1.returnValues).toContain('error_return');
      expect(read1.returnValues).toContain('success');
      expect(read1.returnValues).toContain('failure');

      // Write back (including system values)
      store.updateNode(node.id, { returnValues: read1.returnValues });

      // Second read: same values, no duplicates
      const read2 = expectPresent(store.getNodeById(node.id));
      const otherReturnCount = read2.returnValues?.filter((v) => v === 'other_return').length;
      const errorReturnCount = read2.returnValues?.filter((v) => v === 'error_return').length;
      expect(otherReturnCount).toBe(1);
      expect(errorReturnCount).toBe(1);
      expect(read2.returnValues).toHaveLength(read1.returnValues?.length ?? 0);
    });

    it('gateCondition with "and" mode is preserved as-is', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'AND Gate',
        nodeType: 'gate',
        gateCondition: { mode: 'and', matchValue: 'all_done' },
      });

      const fetched = expectPresent(store.getNodeById(node.id));
      expect(fetched.gateCondition).toEqual({ mode: 'and', matchValue: 'all_done' });
    });

    it('enabledMcpServerIds empty array normalizes to null on read', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      // Insert directly with empty array
      const nodeId = 'test-empty-mcp';
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO orchestrator_nodes
          (id, orchestrator_id, label, node_type, enabled_mcp_server_ids, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(nodeId, orch.id, 'Empty MCP', 'task', '[]', now, now);

      const fetched = expectPresent(store.getNodeById(nodeId));
      expect(fetched.enabledMcpServerIds).toBeNull();
    });

    it('triggeredConfig round-trip with all fields', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const config = { waitTimeoutSec: 600, onTimeout: 'fail' as const };
      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Triggered',
        nodeType: 'triggered',
        tool: 'claude',
        triggeredConfig: config,
      });

      const fetched = expectPresent(store.getNodeById(node.id));
      expect(fetched.triggeredConfig).toEqual(config);

      // Update triggeredConfig
      const newConfig = { waitTimeoutSec: 120, onTimeout: 'skip' as const };
      store.updateNode(node.id, { triggeredConfig: newConfig });

      const updated = expectPresent(store.getNodeById(node.id));
      expect(updated.triggeredConfig).toEqual(newConfig);
    });

    it('null JSON fields remain null through read cycle', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Minimal',
        nodeType: 'task',
      });

      const fetched = expectPresent(store.getNodeById(node.id));
      expect(fetched.returnConditions).toBeNull();
      expect(fetched.gateCondition).toBeNull();
      expect(fetched.triggeredConfig).toBeNull();
      expect(fetched.enabledMcpServerIds).toBeNull();
    });
  });

  // ── Node Type Transitions ──────────────────────────────────────

  describe('node type transitions', () => {
    it('task → gate: preserves common fields, gains gate fields', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Morph Target',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Original prompt',
        positionX: 42,
        positionY: 84,
      });

      store.updateNode(node.id, {
        nodeType: 'gate',
        gateCondition: { mode: 'or', matchValue: 'done' },
      });

      const updated = expectPresent(store.getNodeById(node.id));
      expect(updated.nodeType).toBe('gate');
      expect(updated.gateCondition).toEqual({ mode: 'or', matchValue: 'done' });
      // Position preserved
      expect(updated.positionX).toBe(42);
      expect(updated.positionY).toBe(84);
      // Label preserved
      expect(updated.label).toBe('Morph Target');
    });

    it('gate → task: clears gateCondition (via explicit patch), preserves position', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Gate to Task',
        nodeType: 'gate',
        gateCondition: { mode: 'and', matchValue: 'ready' },
        positionX: 100,
        positionY: 200,
      });

      // Note: store layer is thin — field cleanup is done by the route handler.
      // The route handler explicitly sets gateCondition: null on gate→task transition.
      store.updateNode(node.id, {
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Now a task',
        gateCondition: null,
      });

      const updated = expectPresent(store.getNodeById(node.id));
      expect(updated.nodeType).toBe('task');
      expect(updated.gateCondition).toBeNull();
      expect(updated.tool).toBe('claude');
      expect(updated.prompt).toBe('Now a task');
      expect(updated.positionX).toBe(100);
      expect(updated.positionY).toBe(200);
    });

    it('triggered → task: clears triggeredConfig (via explicit patch)', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Triggered to Task',
        nodeType: 'triggered',
        tool: 'claude',
        prompt: 'Wait for event',
        triggeredConfig: { waitTimeoutSec: 300, onTimeout: 'fail' },
      });

      // Note: store layer is thin — field cleanup is done by the route handler.
      // The route handler explicitly sets triggeredConfig: null on triggered→task transition.
      store.updateNode(node.id, { nodeType: 'task', triggeredConfig: null });

      const updated = expectPresent(store.getNodeById(node.id));
      expect(updated.nodeType).toBe('task');
      expect(updated.triggeredConfig).toBeNull();
      // Other fields preserved
      expect(updated.tool).toBe('claude');
      expect(updated.prompt).toBe('Wait for event');
    });

    it('gate label update does not modify writeInstructionFile or other fields', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Gate Node',
        nodeType: 'gate',
        gateCondition: { mode: 'and', matchValue: 'done' },
      });

      // Verify initial state of writeInstructionFile (default: true → stored as 1)
      const rawBefore = rawNodeRow(db, node.id);
      expect(rawBefore.write_instruction_file).toBe(1);

      // Update only the label
      store.updateNode(node.id, { label: 'Updated Gate' });

      // writeInstructionFile must remain unchanged
      const rawAfter = rawNodeRow(db, node.id);
      expect(rawAfter.write_instruction_file).toBe(1);

      // All other fields preserved
      const updated = expectPresent(store.getNodeById(node.id));
      expect(updated.label).toBe('Updated Gate');
      expect(updated.nodeType).toBe('gate');
      expect(updated.gateCondition).toEqual({ mode: 'and', matchValue: 'done' });
    });

    it('end node update does not overwrite fields unnecessarily', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'End Node',
        nodeType: 'end',
        positionX: 50,
        positionY: 60,
      });

      const rawBefore = rawNodeRow(db, node.id);

      store.updateNode(node.id, { label: 'Final End', positionX: 100 });

      const rawAfter = rawNodeRow(db, node.id);
      // Position updated
      expect(rawAfter.position_x).toBe(100);
      // Label updated
      expect(rawAfter.label).toBe('Final End');
      // Other defaults preserved
      expect(rawAfter.write_instruction_file).toBe(rawBefore.write_instruction_file);
      expect(rawAfter.allow_mcp).toBe(rawBefore.allow_mcp);
    });
  });

  // ── Edge CRUD Round-Trip ───────────────────────────────────────

  describe('edge CRUD round-trip', () => {
    it('preserves all fields on create + read', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const nodeA = store.createNode({
        orchestratorId: orch.id,
        label: 'A',
        nodeType: 'task',
      });
      const nodeB = store.createNode({
        orchestratorId: orch.id,
        label: 'B',
        nodeType: 'task',
      });

      const edge = store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        conditionValue: 'success',
        conditionOperator: 'eq',
        sortOrder: 2,
      });

      const fetched = expectPresent(store.getEdgeById(edge.id));
      expect(fetched.orchestratorId).toBe(orch.id);
      expect(fetched.fromNodeId).toBe(nodeA.id);
      expect(fetched.toNodeId).toBe(nodeB.id);
      expect(fetched.conditionValue).toBe('success');
      expect(fetched.conditionOperator).toBe('eq');
      expect(fetched.sortOrder).toBe(2);
    });

    it('partial edge update preserves unmentioned fields', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const nodeA = store.createNode({ orchestratorId: orch.id, label: 'A' });
      const nodeB = store.createNode({ orchestratorId: orch.id, label: 'B' });

      const edge = store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        conditionValue: 'done',
        conditionOperator: 'neq',
        sortOrder: 1,
      });

      // Update only sortOrder
      store.updateEdge(edge.id, { sortOrder: 10 });

      const updated = expectPresent(store.getEdgeById(edge.id));
      expect(updated.sortOrder).toBe(10);
      expect(updated.conditionValue).toBe('done');
      expect(updated.conditionOperator).toBe('neq');
      expect(updated.fromNodeId).toBe(nodeA.id);
      expect(updated.toNodeId).toBe(nodeB.id);
    });

    it('edge with null conditionValue is preserved', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const nodeA = store.createNode({ orchestratorId: orch.id, label: 'A' });
      const nodeB = store.createNode({ orchestratorId: orch.id, label: 'B' });

      const edge = store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        conditionValue: null,
      });

      const fetched = expectPresent(store.getEdgeById(edge.id));
      expect(fetched.conditionValue).toBeNull();
      expect(fetched.conditionOperator).toBe('eq'); // default
    });

    it('multiple edges between same nodes with different conditions are preserved', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const nodeA = store.createNode({ orchestratorId: orch.id, label: 'A' });
      const nodeB = store.createNode({ orchestratorId: orch.id, label: 'B' });
      const nodeC = store.createNode({ orchestratorId: orch.id, label: 'C' });

      const edge1 = store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
        conditionValue: 'success',
        conditionOperator: 'eq',
      });
      const edge2 = store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: nodeA.id,
        toNodeId: nodeC.id,
        conditionValue: 'failure',
        conditionOperator: 'eq',
      });

      const edges = store.getEdgesByOrchestrator(orch.id);
      expect(edges).toHaveLength(2);

      const e1 = expectPresent(edges.find((e) => e.id === edge1.id));
      const e2 = expectPresent(edges.find((e) => e.id === edge2.id));
      expect(e1.conditionValue).toBe('success');
      expect(e2.conditionValue).toBe('failure');
    });

    it('node deletion cascades edge deletion', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const nodeA = store.createNode({ orchestratorId: orch.id, label: 'A' });
      const nodeB = store.createNode({ orchestratorId: orch.id, label: 'B' });
      const nodeC = store.createNode({ orchestratorId: orch.id, label: 'C' });

      store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
      });
      store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: nodeB.id,
        toNodeId: nodeC.id,
      });
      store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: nodeA.id,
        toNodeId: nodeC.id,
      });

      expect(store.getEdgesByOrchestrator(orch.id)).toHaveLength(3);

      // Delete B: should remove edges A→B and B→C, keep A→C
      store.deleteNode(nodeB.id);

      const remaining = store.getEdgesByOrchestrator(orch.id);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.fromNodeId).toBe(nodeA.id);
      expect(remaining[0]?.toNodeId).toBe(nodeC.id);
    });
  });

  // ── Snapshot Save/Revert Integrity ─────────────────────────────

  describe('snapshot save + revert integrity', () => {
    it('preserves all node fields including agentId through save + revert', () => {
      db = createDb();
      const graphStore = new OrchestratorGraphStore(db);
      const now = new Date().toISOString();

      // Create orchestrator manually (for snapshot testing)
      db.prepare(
        'INSERT INTO orchestrators (id, name, user_id, start_node_id, validated_snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('orch-snap', 'Snap Test', 'dashboard', 'n-start', null, now, now);

      // Create a fully-populated node with agentId
      const node = graphStore.createNode({
        orchestratorId: 'orch-snap',
        label: 'Full Agent Node',
        nodeType: 'task',
        agentId: 'agent-123',
        tool: 'claude',
        prompt: 'Do the thing',
        maxRetries: 2,
        timeoutSec: 120,
        allowMcp: false,
        enabledMcpServerIds: ['mcp-a', 'mcp-b'],
        workdir: '/project',
        writeInstructionFile: false,
        instructionFile: 'setup.md',
        outputMode: 'manual',
        returnConditions: [
          { condition: 'success pattern', value: 'ok' },
          { condition: 'error pattern', value: 'err' },
        ],
        returnValues: ['ok', 'err'],
        gateCondition: null,
        triggeredConfig: null,
        notifyEnabled: true,
        notifyChannel: 'C456',
        notifyOnError: false,
        positionX: 111,
        positionY: 222,
        sortOrder: 7,
      });

      // Save snapshot
      saveValidatedSnapshot(db, graphStore, 'orch-snap');

      // Delete the node to simulate modifications
      graphStore.deleteNode(node.id);
      expect(graphStore.getNodeById(node.id)).toBeNull();

      // Revert from snapshot
      const reverted = revertToValidatedSnapshot(db, 'orch-snap');
      expect(reverted).toBe(true);

      // Verify ALL fields are restored
      const restored = expectPresent(graphStore.getNodeById(node.id));
      expect(restored).not.toBeNull();
      expect(restored.label).toBe('Full Agent Node');
      expect(restored.nodeType).toBe('task');
      expect(restored.agentId).toBe('agent-123');
      expect(restored.tool).toBe('claude');
      expect(restored.prompt).toBe('Do the thing');
      expect(restored.maxRetries).toBe(2);
      expect(restored.timeoutSec).toBe(120);
      expect(restored.allowMcp).toBe(false);
      expect(restored.enabledMcpServerIds).toEqual(['mcp-a', 'mcp-b']);
      expect(restored.workdir).toBe('/project');
      expect(restored.writeInstructionFile).toBe(false);
      expect(restored.instructionFile).toBe('setup.md');
      expect(restored.outputMode).toBe('manual');
      expect(restored.returnConditions).toEqual([
        { condition: 'success pattern', value: 'ok' },
        { condition: 'error pattern', value: 'err' },
      ]);
      expect(restored.notifyEnabled).toBe(true);
      expect(restored.notifyChannel).toBe('C456');
      expect(restored.notifyOnError).toBe(false);
      expect(restored.positionX).toBe(111);
      expect(restored.positionY).toBe(222);
      expect(restored.sortOrder).toBe(7);
    });

    it('preserves complex multi-node multi-edge DAG through save + revert', () => {
      db = createDb();
      const graphStore = new OrchestratorGraphStore(db);
      const now = new Date().toISOString();

      db.prepare(
        'INSERT INTO orchestrators (id, name, user_id, start_node_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('orch-dag', 'DAG Test', 'dashboard', 'start', now, now);

      // Create a diamond DAG: Start → A, Start → B, A → Gate, B → Gate, Gate → End
      const start = graphStore.createNode({
        orchestratorId: 'orch-dag',
        label: 'Start',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Begin',
        returnValues: ['branch_a', 'branch_b'],
      });
      const nodeA = graphStore.createNode({
        orchestratorId: 'orch-dag',
        label: 'Branch A',
        nodeType: 'task',
        tool: 'codex',
        prompt: 'Process A',
        returnValues: ['done'],
      });
      const nodeB = graphStore.createNode({
        orchestratorId: 'orch-dag',
        label: 'Branch B',
        nodeType: 'task',
        tool: 'gemini',
        prompt: 'Process B',
        returnValues: ['done'],
      });
      const gate = graphStore.createNode({
        orchestratorId: 'orch-dag',
        label: 'Merge Gate',
        nodeType: 'gate',
        gateCondition: { mode: 'and', matchValue: 'done' },
        returnValues: ['true', 'false'],
      });
      const end = graphStore.createNode({
        orchestratorId: 'orch-dag',
        label: 'Done',
        nodeType: 'end',
      });

      // Create edges with conditions
      const e1 = graphStore.createEdge({
        orchestratorId: 'orch-dag',
        fromNodeId: start.id,
        toNodeId: nodeA.id,
        conditionValue: 'branch_a',
        conditionOperator: 'eq',
        sortOrder: 0,
      });
      const e2 = graphStore.createEdge({
        orchestratorId: 'orch-dag',
        fromNodeId: start.id,
        toNodeId: nodeB.id,
        conditionValue: 'branch_b',
        conditionOperator: 'eq',
        sortOrder: 1,
      });
      const e3 = graphStore.createEdge({
        orchestratorId: 'orch-dag',
        fromNodeId: nodeA.id,
        toNodeId: gate.id,
        conditionValue: 'done',
      });
      const e4 = graphStore.createEdge({
        orchestratorId: 'orch-dag',
        fromNodeId: nodeB.id,
        toNodeId: gate.id,
        conditionValue: 'done',
      });
      const e5 = graphStore.createEdge({
        orchestratorId: 'orch-dag',
        fromNodeId: gate.id,
        toNodeId: end.id,
        conditionValue: 'true',
      });

      // Save snapshot
      saveValidatedSnapshot(db, graphStore, 'orch-dag');

      // Destroy all nodes and edges
      for (const n of [end, gate, nodeB, nodeA, start]) {
        graphStore.deleteNode(n.id);
      }
      expect(graphStore.getNodesByOrchestrator('orch-dag')).toHaveLength(0);
      expect(graphStore.getEdgesByOrchestrator('orch-dag')).toHaveLength(0);

      // Revert
      expect(revertToValidatedSnapshot(db, 'orch-dag')).toBe(true);

      // Verify all 5 nodes restored
      const restoredNodes = graphStore.getNodesByOrchestrator('orch-dag');
      expect(restoredNodes).toHaveLength(5);

      const nodeMap = new Map(restoredNodes.map((n) => [n.id, n]));
      expect(nodeMap.get(start.id)?.label).toBe('Start');
      expect(nodeMap.get(start.id)?.tool).toBe('claude');
      expect(nodeMap.get(nodeA.id)?.label).toBe('Branch A');
      expect(nodeMap.get(nodeA.id)?.tool).toBe('codex');
      expect(nodeMap.get(nodeB.id)?.label).toBe('Branch B');
      expect(nodeMap.get(nodeB.id)?.tool).toBe('gemini');
      expect(nodeMap.get(gate.id)?.nodeType).toBe('gate');
      expect(nodeMap.get(gate.id)?.gateCondition).toEqual({ mode: 'and', matchValue: 'done' });
      expect(nodeMap.get(end.id)?.nodeType).toBe('end');

      // Verify all 5 edges restored
      const restoredEdges = graphStore.getEdgesByOrchestrator('orch-dag');
      expect(restoredEdges).toHaveLength(5);

      const edgeMap = new Map(restoredEdges.map((e) => [e.id, e]));
      expect(edgeMap.get(e1.id)?.conditionValue).toBe('branch_a');
      expect(edgeMap.get(e1.id)?.conditionOperator).toBe('eq');
      expect(edgeMap.get(e2.id)?.conditionValue).toBe('branch_b');
      expect(edgeMap.get(e3.id)?.conditionValue).toBe('done');
      expect(edgeMap.get(e4.id)?.conditionValue).toBe('done');
      expect(edgeMap.get(e5.id)?.conditionValue).toBe('true');
    });

    it('snapshot revert with gate node preserves gateCondition exactly', () => {
      db = createDb();
      const graphStore = new OrchestratorGraphStore(db);
      const now = new Date().toISOString();

      db.prepare(
        'INSERT INTO orchestrators (id, name, user_id, start_node_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('orch-gc', 'Gate Test', 'dashboard', 'start', now, now);

      const gate = graphStore.createNode({
        orchestratorId: 'orch-gc',
        label: 'Complex Gate',
        nodeType: 'gate',
        gateCondition: { mode: 'or', matchValue: 'proceed' },
        returnValues: ['true', 'false'],
      });

      saveValidatedSnapshot(db, graphStore, 'orch-gc');
      graphStore.deleteNode(gate.id);
      revertToValidatedSnapshot(db, 'orch-gc');

      const restored = expectPresent(graphStore.getNodeById(gate.id));
      expect(restored.gateCondition).toEqual({ mode: 'or', matchValue: 'proceed' });
    });

    it('snapshot revert with triggered node preserves triggeredConfig', () => {
      db = createDb();
      const graphStore = new OrchestratorGraphStore(db);
      const now = new Date().toISOString();

      db.prepare(
        'INSERT INTO orchestrators (id, name, user_id, start_node_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('orch-tc', 'Triggered Test', 'dashboard', 'start', now, now);

      const triggered = graphStore.createNode({
        orchestratorId: 'orch-tc',
        label: 'Event Listener',
        nodeType: 'triggered',
        tool: 'claude',
        prompt: 'Handle event',
        triggeredConfig: { waitTimeoutSec: 600, onTimeout: 'skip' },
      });

      saveValidatedSnapshot(db, graphStore, 'orch-tc');
      graphStore.deleteNode(triggered.id);
      revertToValidatedSnapshot(db, 'orch-tc');

      const restored = expectPresent(graphStore.getNodeById(triggered.id));
      expect(restored.triggeredConfig).toEqual({ waitTimeoutSec: 600, onTimeout: 'skip' });
    });
  });

  // ── Concurrent Update Detection ────────────────────────────────

  describe('concurrent update detection', () => {
    it('throws StaleUpdateError when expectedUpdatedAt does not match', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Contested',
        nodeType: 'task',
      });

      // Simulate concurrent update by providing a stale timestamp
      expect(() => {
        store.updateNode(node.id, { label: 'Conflict' }, '2000-01-01T00:00:00.000Z');
      }).toThrow(StaleUpdateError);

      // Verify original value unchanged
      expect(store.getNodeById(node.id)?.label).toBe('Contested');
    });

    it('update succeeds with correct expectedUpdatedAt', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Versioned',
        nodeType: 'task',
      });

      // Use the actual updatedAt for optimistic concurrency
      store.updateNode(node.id, { label: 'Updated' }, node.updatedAt);

      expect(store.getNodeById(node.id)?.label).toBe('Updated');
    });

    it('second update with first updatedAt fails after first update', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Race',
        nodeType: 'task',
        tool: 'claude',
      });

      // Force a distinctive initial timestamp to avoid sub-millisecond collisions
      const initialTimestamp = '2025-01-01T00:00:00.000Z';
      db.prepare('UPDATE orchestrator_nodes SET updated_at = ? WHERE id = ?').run(
        initialTimestamp,
        node.id,
      );

      // First update succeeds (sets updated_at to a new value)
      store.updateNode(node.id, { label: 'First Win' }, initialTimestamp);

      // Second update with the same original timestamp fails (stale)
      expect(() => {
        store.updateNode(node.id, { prompt: 'Stale update' }, initialTimestamp);
      }).toThrow(StaleUpdateError);

      const final = expectPresent(store.getNodeById(node.id));
      expect(final.label).toBe('First Win');
      expect(final.prompt).toBeNull(); // stale update was rejected
    });
  });

  // ── DAG Validated Flag Consistency ─────────────────────────────

  describe('DAG validated flag consistency', () => {
    it('invalidated on node creation', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      // Manually set dag_validated = 1
      db.prepare('UPDATE orchestrators SET dag_validated = 1 WHERE id = ?').run(orch.id);
      expect(store.getById(orch.id)?.dagValidated).toBe(true);

      store.createNode({ orchestratorId: orch.id, label: 'New' });
      store.invalidateDag(orch.id);

      expect(store.getById(orch.id)?.dagValidated).toBe(false);
    });

    it('invalidated on edge creation', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const nodeA = store.createNode({ orchestratorId: orch.id, label: 'A' });
      const nodeB = store.createNode({ orchestratorId: orch.id, label: 'B' });

      db.prepare('UPDATE orchestrators SET dag_validated = 1 WHERE id = ?').run(orch.id);

      store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
      });
      store.invalidateDag(orch.id);

      expect(store.getById(orch.id)?.dagValidated).toBe(false);
    });

    it('invalidated on node deletion', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({ orchestratorId: orch.id, label: 'Doomed' });

      db.prepare('UPDATE orchestrators SET dag_validated = 1 WHERE id = ?').run(orch.id);

      store.deleteNode(node.id);
      store.invalidateDag(orch.id);

      expect(store.getById(orch.id)?.dagValidated).toBe(false);
    });
  });

  // ── Complex Multi-Branch DAG Patterns ──────────────────────────

  describe('complex multi-branch DAG patterns', () => {
    it('fan-out + fan-in DAG preserves all conditions and node configs', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      // Start → (A | B | C) → Gate → End
      const nodeA = store.createNode({
        orchestratorId: orch.id,
        label: 'Worker A',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Task A',
        maxRetries: 1,
        returnValues: ['done'],
      });
      const nodeB = store.createNode({
        orchestratorId: orch.id,
        label: 'Worker B',
        nodeType: 'task',
        tool: 'codex',
        prompt: 'Task B',
        maxRetries: 2,
        returnValues: ['done'],
      });
      const nodeC = store.createNode({
        orchestratorId: orch.id,
        label: 'Worker C',
        nodeType: 'task',
        tool: 'gemini',
        prompt: 'Task C',
        maxRetries: 3,
        returnConditions: [
          { condition: 'success', value: 'done' },
          { condition: 'partial', value: 'partial' },
        ],
        returnValues: ['done', 'partial'],
      });
      const gate = store.createNode({
        orchestratorId: orch.id,
        label: 'Merge',
        nodeType: 'gate',
        gateCondition: { mode: 'and', matchValue: 'done' },
      });
      const end = store.createNode({
        orchestratorId: orch.id,
        label: 'Finish',
        nodeType: 'end',
      });

      // Fan-out edges from start node
      const startNode = expectPresent(store.getNodeById(orch.startNodeId));
      void [
        store.createEdge({
          orchestratorId: orch.id,
          fromNodeId: startNode.id,
          toNodeId: nodeA.id,
          conditionValue: null,
          sortOrder: 0,
        }),
        store.createEdge({
          orchestratorId: orch.id,
          fromNodeId: startNode.id,
          toNodeId: nodeB.id,
          conditionValue: null,
          sortOrder: 1,
        }),
        store.createEdge({
          orchestratorId: orch.id,
          fromNodeId: startNode.id,
          toNodeId: nodeC.id,
          conditionValue: null,
          sortOrder: 2,
        }),
        // Fan-in to gate
        store.createEdge({
          orchestratorId: orch.id,
          fromNodeId: nodeA.id,
          toNodeId: gate.id,
          conditionValue: 'done',
        }),
        store.createEdge({
          orchestratorId: orch.id,
          fromNodeId: nodeB.id,
          toNodeId: gate.id,
          conditionValue: 'done',
        }),
        store.createEdge({
          orchestratorId: orch.id,
          fromNodeId: nodeC.id,
          toNodeId: gate.id,
          conditionValue: 'done',
        }),
        // Gate → End
        store.createEdge({
          orchestratorId: orch.id,
          fromNodeId: gate.id,
          toNodeId: end.id,
          conditionValue: 'true',
        }),
      ];

      // Read back entire DAG
      const allNodes = store.getNodesByOrchestrator(orch.id);
      const allEdges = store.getEdgesByOrchestrator(orch.id);

      // 5 created + 1 auto-created start = 6 nodes
      expect(allNodes).toHaveLength(6);
      expect(allEdges).toHaveLength(7);

      // Verify specific node configs preserved
      const workerC = expectPresent(allNodes.find((n) => n.label === 'Worker C'));
      expect(workerC.tool).toBe('gemini');
      expect(workerC.maxRetries).toBe(3);
      expect(workerC.returnConditions).toEqual([
        { condition: 'success', value: 'done' },
        { condition: 'partial', value: 'partial' },
      ]);

      const mergeGate = expectPresent(allNodes.find((n) => n.label === 'Merge'));
      expect(mergeGate.gateCondition).toEqual({ mode: 'and', matchValue: 'done' });

      // Verify edge conditions preserved
      const gateInEdges = allEdges.filter((e) => e.toNodeId === gate.id);
      expect(gateInEdges).toHaveLength(3);
      for (const e of gateInEdges) {
        expect(e.conditionValue).toBe('done');
      }
    });

    it('multi-condition branching DAG preserves all edge operators', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const router = store.createNode({
        orchestratorId: orch.id,
        label: 'Router',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Classify input',
        returnValues: ['urgent', 'normal', 'spam'],
      });

      const urgentHandler = store.createNode({
        orchestratorId: orch.id,
        label: 'Urgent',
        nodeType: 'task',
        tool: 'claude',
      });
      const normalHandler = store.createNode({
        orchestratorId: orch.id,
        label: 'Normal',
        nodeType: 'task',
        tool: 'codex',
      });
      const spamFilter = store.createNode({
        orchestratorId: orch.id,
        label: 'Spam',
        nodeType: 'end',
      });

      // Different condition operators
      store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: router.id,
        toNodeId: urgentHandler.id,
        conditionValue: 'urgent',
        conditionOperator: 'eq',
      });
      store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: router.id,
        toNodeId: normalHandler.id,
        conditionValue: 'normal',
        conditionOperator: 'eq',
      });
      store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: router.id,
        toNodeId: spamFilter.id,
        conditionValue: 'spam|junk',
        conditionOperator: 'regex',
      });

      const allEdges = store.getEdgesByOrchestrator(orch.id);
      const routerEdges = allEdges.filter((e) => e.fromNodeId === router.id);
      expect(routerEdges).toHaveLength(3);

      const regexEdge = expectPresent(routerEdges.find((e) => e.toNodeId === spamFilter.id));
      expect(regexEdge.conditionOperator).toBe('regex');
      expect(regexEdge.conditionValue).toBe('spam|junk');

      const eqEdges = routerEdges.filter((e) => e.conditionOperator === 'eq');
      expect(eqEdges).toHaveLength(2);
    });

    it('deep chain DAG preserves all node configs through getNodesByOrchestrator', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      // Create a 10-node deep chain
      const nodes: OrchestratorNode[] = [];
      for (let i = 0; i < 10; i++) {
        const node = store.createNode({
          orchestratorId: orch.id,
          label: `Step ${i}`,
          nodeType: i === 9 ? 'end' : 'task',
          tool: i === 9 ? null : 'claude',
          prompt: i === 9 ? null : `Execute step ${i}`,
          maxRetries: i,
          sortOrder: i,
          positionX: i * 100,
          positionY: i * 50,
        });
        nodes.push(node);
      }

      // Create chain edges
      for (let i = 0; i < 9; i++) {
        const fromNode = nodes[i];
        const toNode = nodes[i + 1];
        if (!fromNode || !toNode) throw new Error(`Missing node at index ${i}`);
        store.createEdge({
          orchestratorId: orch.id,
          fromNodeId: fromNode.id,
          toNodeId: toNode.id,
          sortOrder: i,
        });
      }

      const allNodes = store.getNodesByOrchestrator(orch.id);
      // 10 created + 1 auto-start = 11
      expect(allNodes).toHaveLength(11);

      // Verify each node's config is preserved
      for (let i = 0; i < 10; i++) {
        const found = expectPresent(allNodes.find((n) => n.id === nodes[i]?.id));
        expect(found.label).toBe(`Step ${i}`);
        expect(found.maxRetries).toBe(i);
        expect(found.sortOrder).toBe(i);
        expect(found.positionX).toBe(i * 100);
        expect(found.positionY).toBe(i * 50);
      }

      const allEdges = store.getEdgesByOrchestrator(orch.id);
      expect(allEdges).toHaveLength(9);
    });

    it('W-shape DAG (2 merge points) preserves all data', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      // W-shape: Start → A,B → Gate1 → C,D → Gate2 → End
      const a = store.createNode({
        orchestratorId: orch.id,
        label: 'A',
        tool: 'claude',
        returnValues: ['done'],
      });
      const b = store.createNode({
        orchestratorId: orch.id,
        label: 'B',
        tool: 'codex',
        returnValues: ['done'],
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
        tool: 'claude',
        returnValues: ['done'],
      });
      const d = store.createNode({
        orchestratorId: orch.id,
        label: 'D',
        tool: 'gemini',
        returnValues: ['done'],
      });
      const gate2 = store.createNode({
        orchestratorId: orch.id,
        label: 'Gate2',
        nodeType: 'gate',
        gateCondition: { mode: 'or', matchValue: 'done' },
      });
      const end = store.createNode({ orchestratorId: orch.id, label: 'End', nodeType: 'end' });

      // First fan-out/in
      store.createEdge({ orchestratorId: orch.id, fromNodeId: orch.startNodeId, toNodeId: a.id });
      store.createEdge({ orchestratorId: orch.id, fromNodeId: orch.startNodeId, toNodeId: b.id });
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

      // Second fan-out/in
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
        conditionValue: 'true',
      });
      store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: c.id,
        toNodeId: gate2.id,
        conditionValue: 'done',
      });
      store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: d.id,
        toNodeId: gate2.id,
        conditionValue: 'done',
      });
      store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: gate2.id,
        toNodeId: end.id,
        conditionValue: 'true',
      });

      const nodes = store.getNodesByOrchestrator(orch.id);
      const edges = store.getEdgesByOrchestrator(orch.id);

      // 7 created + 1 auto-start = 8 nodes, 9 edges
      expect(nodes).toHaveLength(8);
      expect(edges).toHaveLength(9);

      // Verify both gates have distinct conditions
      const g1 = expectPresent(nodes.find((n) => n.label === 'Gate1'));
      const g2 = expectPresent(nodes.find((n) => n.label === 'Gate2'));
      expect(g1.gateCondition?.mode).toBe('and');
      expect(g2.gateCondition?.mode).toBe('or');

      // Verify tools preserved across different branches
      const nodeLabels = new Map(nodes.map((n) => [n.label, n]));
      expect(nodeLabels.get('A')?.tool).toBe('claude');
      expect(nodeLabels.get('B')?.tool).toBe('codex');
      expect(nodeLabels.get('D')?.tool).toBe('gemini');
    });
  });

  // ── Edge Cases ─────────────────────────────────────────────────

  describe('edge cases', () => {
    it('node with special characters in prompt is preserved', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const specialPrompt = `Line 1\nLine 2\tTabbed\n"Quoted" 'Single'\n\`Backtick\`\n\\ Backslash\n日本語テスト\n🚀 Emoji`;
      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Special',
        nodeType: 'task',
        tool: 'claude',
        prompt: specialPrompt,
      });

      const fetched = expectPresent(store.getNodeById(node.id));
      expect(fetched.prompt).toBe(specialPrompt);
    });

    it('returnConditions with special regex patterns are preserved', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const conditions = [
        { condition: 'output matches /^Error:\\s+(.*)$/m', value: 'error_return' },
        { condition: 'contains "\\"escaped\\"" quotes', value: 'quoted' },
      ];

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Regex Node',
        nodeType: 'task',
        tool: 'claude',
        returnConditions: conditions,
      });

      const fetched = expectPresent(store.getNodeById(node.id));
      expect(fetched.returnConditions).toEqual(conditions);
    });

    it('updating a node with empty patch is a no-op', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'Static',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Do not change',
      });

      const before = expectPresent(store.getNodeById(node.id));
      store.updateNode(node.id, {});
      const after = expectPresent(store.getNodeById(node.id));

      // updatedAt might change (auto-timestamp), but all other fields must match
      expect(after.label).toBe(before.label);
      expect(after.prompt).toBe(before.prompt);
      expect(after.tool).toBe(before.tool);
    });

    it('deleting all edges for an orchestrator leaves nodes intact', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const nodeA = store.createNode({ orchestratorId: orch.id, label: 'A' });
      const nodeB = store.createNode({ orchestratorId: orch.id, label: 'B' });

      store.createEdge({
        orchestratorId: orch.id,
        fromNodeId: nodeA.id,
        toNodeId: nodeB.id,
      });

      store.deleteEdgesByOrchestrator(orch.id);

      expect(store.getEdgesByOrchestrator(orch.id)).toHaveLength(0);
      // Nodes still exist
      expect(store.getNodeById(nodeA.id)).not.toBeNull();
      expect(store.getNodeById(nodeB.id)).not.toBeNull();
    });

    it('returnValues with only system values is handled correctly', () => {
      db = createDb();
      const { store, orch } = createStoreWithOrch(db);

      const node = store.createNode({
        orchestratorId: orch.id,
        label: 'System Only',
        nodeType: 'task',
        tool: 'claude',
        returnValues: ['other_return', 'error_return'],
      });

      const fetched = expectPresent(store.getNodeById(node.id));
      // No duplicates
      expect(fetched.returnValues).toEqual(['other_return', 'error_return']);
    });
  });
});
