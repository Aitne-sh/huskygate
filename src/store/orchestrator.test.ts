import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOsTimezone } from '../utils/timezone.js';
import * as snapshotModule from './orchestrator-snapshot.js';
import { OrchestratorStore } from './orchestrator.js';

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

describe('OrchestratorStore', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
    vi.restoreAllMocks();
  });

  // ── Orchestrator CRUD ──

  it('creates, fetches, lists, and soft-deletes orchestrators', () => {
    db = createDb();
    const store = new OrchestratorStore(db);

    const first = store.create({
      name: '  Pipeline A  ',
      alias: '  pipe-a  ',
      description: '  A test pipeline  ',
      workdir: '/tmp/work',
      errorPolicy: 'fail_fast',
      maxParallelism: 5,
      maxTotalNodes: 100,
      timeoutSec: 3600,
      notifyChannel: 'C123',
      summaryEnabled: true,
      summaryTool: 'codex',
    });

    expect(first.name).toBe('Pipeline A');
    expect(first.alias).toBe('pipe-a');
    expect(first.description).toBe('A test pipeline');
    expect(first.userId).toBe('dashboard');
    expect(first.errorPolicy).toBe('fail_fast');
    expect(first.maxParallelism).toBe(5);
    expect(first.maxTotalNodes).toBe(100);
    expect(first.timeoutSec).toBe(3600);
    expect(first.notifyChannel).toBe('C123');
    expect(first.summaryEnabled).toBe(true);
    expect(first.summaryTool).toBe('codex');
    expect(first.maxRunWorkdirs).toBe(20); // default
    expect(first.status).toBe('active');
    expect(first.runCount).toBe(0);
    expect(first.timezone).toBe(getOsTimezone());
    expect(first.startNodeId).toBeTruthy();
    expect(store.getNodeById(first.startNodeId)).toMatchObject({
      id: first.startNodeId,
      orchestratorId: first.id,
      label: 'Start',
      nodeType: 'task',
      tool: 'claude',
    });

    const second = store.create({ name: 'Pipeline B', maxRunWorkdirs: 0 });
    expect(second.alias).toBeNull();
    expect(second.errorPolicy).toBe('continue');
    expect(second.maxParallelism).toBe(3);
    expect(second.maxRunWorkdirs).toBe(0);
    expect(second.timezone).toBe(getOsTimezone());

    expect(store.getById(first.id)?.id).toBe(first.id);
    expect(store.getById('missing')).toBeNull();
    expect(store.findByAlias('pipe-a')?.id).toBe(first.id);
    expect(store.findByAlias('not-found')).toBeNull();

    expect(store.list()).toHaveLength(2);
    expect(store.list({ status: 'active' })).toHaveLength(2);

    store.softDelete(first.id);
    expect(store.list()).toHaveLength(1);
    expect(store.list({ status: 'deleted' })).toHaveLength(1);
    expect(store.findByAlias('pipe-a')).toBeNull(); // excluded by status filter
    expect(store.getById(first.id)?.status).toBe('deleted'); // getById returns all
  });

  it('rejects duplicate aliases', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    store.create({ name: 'First', alias: 'shared' });
    expect(() => store.create({ name: 'Second', alias: 'shared' })).toThrow(
      'Alias "shared" is already in use',
    );
  });

  it('rejects duplicate names', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    store.create({ name: 'Same Name' });
    expect(() => store.create({ name: '  Same Name  ' })).toThrow(
      'Name "Same Name" is already in use',
    );
  });

  it('rejects out-of-range orchestrator limits on create', () => {
    db = createDb();
    const store = new OrchestratorStore(db);

    expect(() => store.create({ name: 'Bad Parallelism', maxParallelism: 0 })).toThrow(
      'maxParallelism must be between 1 and 20',
    );
    expect(() => store.create({ name: 'Bad Node Limit', maxTotalNodes: 201 })).toThrow(
      'maxTotalNodes must be between 1 and 200',
    );
    expect(() => store.create({ name: 'Bad Timeout', timeoutSec: 86_401 })).toThrow(
      'timeoutSec must be between 1 and 86400',
    );
    expect(() => store.create({ name: 'Bad Integer', maxParallelism: 1.5 })).toThrow(
      'maxParallelism must be an integer between 1 and 20',
    );
  });

  it('allows reuse of alias after soft-delete', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const first = store.create({ name: 'First', alias: 'reuse' });
    store.softDelete(first.id);
    const second = store.create({ name: 'Second', alias: 'reuse' });
    expect(second.alias).toBe('reuse');
  });

  it('allows reuse of name after soft-delete', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const first = store.create({ name: 'Reusable Name' });
    store.softDelete(first.id);
    const second = store.create({ name: 'Reusable Name' });
    expect(second.name).toBe('Reusable Name');
  });

  it('removes triggered-node subscriptions when soft-deleting an orchestrator', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orchestrator = store.create({ name: 'Pipeline' });
    const triggeredNode = store.createNode({
      orchestratorId: orchestrator.id,
      label: 'Wait for Event',
      nodeType: 'triggered',
      tool: 'claude',
      prompt: 'wait',
      returnValues: ['success', 'error'],
      triggeredConfig: { waitTimeoutSec: 60, onTimeout: 'fail' },
    });

    db.prepare(
      `INSERT INTO event_subscriptions (
        id, endpoint_id, target_type, orchestrator_id, triggered_task_id, node_id,
        filter_json, context_mapping_json, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'sub-1',
      'endpoint-1',
      'triggered_node',
      null,
      null,
      triggeredNode.id,
      null,
      null,
      1,
      '2026-03-08T00:00:00.000Z',
      '2026-03-08T00:00:00.000Z',
    );

    store.softDelete(orchestrator.id);

    const remaining = db.prepare('SELECT COUNT(*) as cnt FROM event_subscriptions').get() as {
      cnt: number;
    };
    expect(remaining.cnt).toBe(0);
  });

  it('removes triggered-node subscriptions when a node stops being triggered', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orchestrator = store.create({ name: 'Pipeline' });
    const triggeredNode = store.createNode({
      orchestratorId: orchestrator.id,
      label: 'Wait for Event',
      nodeType: 'triggered',
      tool: 'claude',
      prompt: 'wait',
      triggeredConfig: { waitTimeoutSec: 60, onTimeout: 'fail' },
    });

    db.prepare(
      `INSERT INTO event_subscriptions (
        id, endpoint_id, target_type, orchestrator_id, triggered_task_id, node_id,
        filter_json, context_mapping_json, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'sub-1',
      'endpoint-1',
      'triggered_node',
      null,
      null,
      triggeredNode.id,
      null,
      null,
      1,
      '2026-03-08T00:00:00.000Z',
      '2026-03-08T00:00:00.000Z',
    );

    store.updateNode(triggeredNode.id, { nodeType: 'task', triggeredConfig: null });

    expect(store.getNodeById(triggeredNode.id)?.nodeType).toBe('task');
    const remaining = db.prepare('SELECT COUNT(*) as cnt FROM event_subscriptions').get() as {
      cnt: number;
    };
    expect(remaining.cnt).toBe(0);
  });

  it('rejects duplicate name and alias on update', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const first = store.create({ name: 'First Name', alias: 'first' });
    const second = store.create({ name: 'Second Name', alias: 'second' });

    expect(() => store.update(second.id, { name: 'First Name' })).toThrow(
      'Name "First Name" is already in use',
    );
    expect(() => store.update(second.id, { alias: 'first' })).toThrow(
      'Alias "first" is already in use',
    );

    store.update(second.id, { name: '  Second Name  ', alias: '  second  ' });
    expect(store.getById(second.id)?.name).toBe('Second Name');
    expect(store.getById(second.id)?.alias).toBe('second');
    expect(store.getById(first.id)?.name).toBe('First Name');
    expect(store.getById(first.id)?.alias).toBe('first');
  });

  it('updates fields and increments run count', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'Updatable' });

    // Empty update does nothing
    const before = store.getById(orch.id)?.updatedAt;
    store.update(orch.id, {});
    expect(store.getById(orch.id)?.updatedAt).toBe(before);

    store.update(orch.id, {
      name: 'Updated',
      alias: 'upd',
      description: 'desc',
      errorPolicy: 'fail_fast',
      maxParallelism: 10,
      timeoutSec: 7200,
      summaryEnabled: true,
      summaryTool: 'gemini',
    });

    const updated = store.getById(orch.id);
    expect(updated?.name).toBe('Updated');
    expect(updated?.alias).toBe('upd');
    expect(updated?.description).toBe('desc');
    expect(updated?.errorPolicy).toBe('fail_fast');
    expect(updated?.maxParallelism).toBe(10);
    expect(updated?.timeoutSec).toBe(7200);
    expect(updated?.summaryEnabled).toBe(true);
    expect(updated?.summaryTool).toBe('gemini');

    store.incrementRunCount(orch.id, '2026-03-01T00:00:00.000Z');
    const after = store.getById(orch.id);
    expect(after?.runCount).toBe(1);
    expect(after?.lastRunAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('rejects out-of-range orchestrator limits on update', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'Update Limits' });

    expect(() => store.update(orch.id, { maxParallelism: 21 })).toThrow(
      'maxParallelism must be between 1 and 20',
    );
    expect(() => store.update(orch.id, { maxTotalNodes: 0 })).toThrow(
      'maxTotalNodes must be between 1 and 200',
    );
    expect(() => store.update(orch.id, { timeoutSec: 0 })).toThrow(
      'timeoutSec must be between 1 and 86400',
    );
    expect(() => store.update(orch.id, { maxTotalNodes: 10.2 })).toThrow(
      'maxTotalNodes must be an integer between 1 and 200',
    );
  });

  it('rejects out-of-range node retry and timeout limits', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'Node Limits' });

    expect(() =>
      store.createNode({
        orchestratorId: orch.id,
        label: 'Retry Flood',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'run',
        maxRetries: 11,
      }),
    ).toThrow('maxRetries must be between 0 and 10');

    expect(() =>
      store.createNode({
        orchestratorId: orch.id,
        label: 'Slow Wait',
        nodeType: 'triggered',
        tool: 'claude',
        prompt: 'wait',
        triggeredConfig: { waitTimeoutSec: 86_401, onTimeout: 'fail' },
      }),
    ).toThrow('waitTimeoutSec must be between 1 and 86400');

    const node = store.createNode({
      orchestratorId: orch.id,
      label: 'Task A',
      nodeType: 'task',
      tool: 'claude',
      prompt: 'run',
    });
    expect(() => store.updateNode(node.id, { timeoutSec: 21_601 })).toThrow(
      'timeoutSec must be between 1 and 21600',
    );
  });

  it('isAliasAvailable with excludeId', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'Has Alias', alias: 'mine' });
    expect(store.isAliasAvailable('mine')).toBe(false);
    expect(store.isAliasAvailable('mine', orch.id)).toBe(true);
    expect(store.isAliasAvailable('other')).toBe(true);
  });

  // ── Scheduler Support ──

  it('stores nextRunAt from create input', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({
      name: 'With NextRun',
      scheduleType: 'once',
      runAt: '2026-06-01T00:00:00.000Z',
      nextRunAt: '2026-06-01T00:00:00.000Z',
    });
    expect(orch.nextRunAt).toBe('2026-06-01T00:00:00.000Z');
    expect(store.getDueOrchestrators('2026-06-01T00:00:01.000Z')).toHaveLength(1);
  });

  it('getDueOrchestrators and claim/release', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'Scheduled', scheduleType: 'recurring' });
    store.update(orch.id, { nextRunAt: '2026-01-01T00:00:00.000Z' });

    expect(store.getDueOrchestrators('2026-01-01T00:00:01.000Z')).toHaveLength(1);
    expect(store.getDueOrchestrators('2025-12-31T23:59:59.000Z')).toHaveLength(0);

    const claimed = store.claimOrchestrator(orch.id, '2026-01-01T00:00:01.000Z');
    expect(claimed?.id).toBe(orch.id);
    expect(claimed?.claimedAt).toBe('2026-01-01T00:00:01.000Z');

    // Cannot claim twice
    expect(store.claimOrchestrator(orch.id, '2026-01-01T00:00:02.000Z')).toBeNull();

    // Due query skips claimed
    expect(store.getDueOrchestrators('2026-01-01T00:00:02.000Z')).toHaveLength(0);

    store.releaseClaim(orch.id);
    expect(store.getById(orch.id)?.claimedAt).toBeNull();
  });

  it('recoverStaleClaims', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'Stale' });
    store.claimOrchestrator(orch.id, '2026-01-01T00:00:00.000Z');

    // Recover with 5-minute window — claim is far in the past
    const recovered = store.recoverStaleClaims(5);
    expect(recovered).toBe(1);
    expect(store.getById(orch.id)?.claimedAt).toBeNull();
  });

  // ── Node CRUD ──

  it('creates, gets, lists, updates, and deletes nodes', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'NodeTest' });

    const node = store.createNode({
      orchestratorId: orch.id,
      label: '  TaskA  ',
      nodeType: 'task',
      tool: 'claude',
      prompt: 'do something',
      maxRetries: 2,
      timeoutSec: 300,
      workdir: '/tmp/task-workdir',
      writeInstructionFile: false,
      instructionFile: '# node instructions',
      notifyEnabled: true,
      notifyChannel: 'C456',
    });

    expect(node.label).toBe('TaskA');
    expect(node.nodeType).toBe('task');
    expect(node.tool).toBe('claude');
    expect(node.maxRetries).toBe(2);
    expect(node.workdir).toBe('/tmp/task-workdir');
    expect(node.writeInstructionFile).toBe(false);
    expect(node.instructionFile).toBe('# node instructions');
    expect(node.notifyEnabled).toBe(true);
    expect(node.notifyChannel).toBe('C456');
    expect(node.notifyOnError).toBe(true); // default

    const gateNode = store.createNode({
      orchestratorId: orch.id,
      label: 'GateA',
      nodeType: 'gate',
      gateCondition: {
        mode: 'and',
        matchValue: 'success',
      },
    });
    expect(gateNode.nodeType).toBe('gate');
    expect(gateNode.gateCondition?.mode).toBe('and');
    expect(gateNode.gateCondition?.matchValue).toBe('success');

    expect(store.getNodeById(node.id)?.id).toBe(node.id);
    expect(store.getNodeById('missing')).toBeNull();
    expect(store.getNodesByOrchestrator(orch.id)).toHaveLength(3);

    store.updateNode(node.id, {
      label: 'TaskA-Updated',
      maxRetries: 5,
      workdir: null,
      writeInstructionFile: true,
      instructionFile: null,
    });
    expect(store.getNodeById(node.id)?.label).toBe('TaskA-Updated');
    expect(store.getNodeById(node.id)?.maxRetries).toBe(5);
    expect(store.getNodeById(node.id)?.workdir).toBeNull();
    expect(store.getNodeById(node.id)?.writeInstructionFile).toBe(true);
    expect(store.getNodeById(node.id)?.instructionFile).toBeNull();

    // Update gate condition
    store.updateNode(gateNode.id, {
      gateCondition: { mode: 'or', matchValue: 'done' },
    });
    expect(store.getNodeById(gateNode.id)?.gateCondition?.mode).toBe('or');
    expect(store.getNodeById(gateNode.id)?.gateCondition?.matchValue).toBe('done');

    // Empty update does nothing
    store.updateNode(node.id, {});
    expect(store.getNodeById(node.id)?.label).toBe('TaskA-Updated');
  });

  it('creates and updates node model', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'ModelNodeTest' });

    // Create node with model
    const node = store.createNode({
      orchestratorId: orch.id,
      label: 'WithModel',
      nodeType: 'task',
      tool: 'claude',
      prompt: 'test',
      model: 'claude-opus-4-6',
    });
    expect(node.model).toBe('claude-opus-4-6');

    // Create node without model → null
    const noModelNode = store.createNode({
      orchestratorId: orch.id,
      label: 'NoModel',
      nodeType: 'task',
      tool: 'gemini',
      prompt: 'test',
    });
    expect(noModelNode.model).toBeNull();

    // Update model
    store.updateNode(node.id, { model: 'claude-sonnet-4-6' });
    expect(store.getNodeById(node.id)?.model).toBe('claude-sonnet-4-6');

    // Clear model
    store.updateNode(node.id, { model: '  ' });
    expect(store.getNodeById(node.id)?.model).toBeNull();

    // Set model on previously null-model node
    store.updateNode(noModelNode.id, { model: 'gemini-2.5-pro' });
    expect(store.getNodeById(noModelNode.id)?.model).toBe('gemini-2.5-pro');
  });

  it('rejects deleting or retagging the persisted start node', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'StartProtection' });

    expect(() => store.deleteNode(orch.startNodeId)).toThrow('Start node cannot be deleted');
    expect(() => store.updateNode(orch.startNodeId, { nodeType: 'gate' })).toThrow(
      'Start node type cannot be changed',
    );
  });

  it('deleteNode cascades edges', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'CascadeTest' });
    const nodeA = store.createNode({ orchestratorId: orch.id, label: 'A' });
    const nodeB = store.createNode({ orchestratorId: orch.id, label: 'B' });
    store.createEdge({ orchestratorId: orch.id, fromNodeId: nodeA.id, toNodeId: nodeB.id });

    expect(store.getEdgesByOrchestrator(orch.id)).toHaveLength(1);
    store.deleteNode(nodeA.id);
    expect(store.getNodeById(nodeA.id)).toBeNull();
    expect(store.getEdgesByOrchestrator(orch.id)).toHaveLength(0);
  });

  // ── Edge CRUD ──

  it('creates, gets, lists, and deletes edges', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'EdgeTest' });
    const nodeA = store.createNode({ orchestratorId: orch.id, label: 'A' });
    const nodeB = store.createNode({ orchestratorId: orch.id, label: 'B' });

    const edge = store.createEdge({
      orchestratorId: orch.id,
      fromNodeId: nodeA.id,
      toNodeId: nodeB.id,
      conditionValue: 'success',
      conditionOperator: 'eq',
    });

    expect(edge.fromNodeId).toBe(nodeA.id);
    expect(edge.toNodeId).toBe(nodeB.id);
    expect(edge.conditionValue).toBe('success');
    expect(edge.conditionOperator).toBe('eq');

    expect(store.getEdgeById(edge.id)?.id).toBe(edge.id);
    expect(store.getEdgeById('missing')).toBeNull();
    expect(store.getEdgesByOrchestrator(orch.id)).toHaveLength(1);

    store.deleteEdge(edge.id);
    expect(store.getEdgesByOrchestrator(orch.id)).toHaveLength(0);
  });

  it('updateEdge updates conditionValue and conditionOperator', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'UpdateEdgeTest' });
    const a = store.createNode({ orchestratorId: orch.id, label: 'A' });
    const b = store.createNode({ orchestratorId: orch.id, label: 'B' });
    const edge = store.createEdge({
      orchestratorId: orch.id,
      fromNodeId: a.id,
      toNodeId: b.id,
      conditionValue: 'success',
      conditionOperator: 'eq',
    });

    store.updateEdge(edge.id, { conditionValue: 'fail', conditionOperator: 'neq' });
    const updated = store.getEdgeById(edge.id);
    expect(updated?.conditionValue).toBe('fail');
    expect(updated?.conditionOperator).toBe('neq');

    // Clear condition
    store.updateEdge(edge.id, { conditionValue: null });
    expect(store.getEdgeById(edge.id)?.conditionValue).toBeNull();

    // Update sortOrder
    store.updateEdge(edge.id, { sortOrder: 5 });
    expect(store.getEdgeById(edge.id)?.sortOrder).toBe(5);
  });

  it('updateEdge with empty patch does nothing', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'EmptyPatch' });
    const a = store.createNode({ orchestratorId: orch.id, label: 'A' });
    const b = store.createNode({ orchestratorId: orch.id, label: 'B' });
    const edge = store.createEdge({
      orchestratorId: orch.id,
      fromNodeId: a.id,
      toNodeId: b.id,
      conditionValue: 'ok',
    });

    store.updateEdge(edge.id, {});
    const unchanged = store.getEdgeById(edge.id);
    expect(unchanged?.conditionValue).toBe('ok');
    expect(unchanged?.conditionOperator).toBe('eq');
  });

  it('deleteEdgesByOrchestrator removes all edges', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'BulkDel' });
    const a = store.createNode({ orchestratorId: orch.id, label: 'A' });
    const b = store.createNode({ orchestratorId: orch.id, label: 'B' });
    const c = store.createNode({ orchestratorId: orch.id, label: 'C' });
    store.createEdge({ orchestratorId: orch.id, fromNodeId: a.id, toNodeId: b.id });
    store.createEdge({ orchestratorId: orch.id, fromNodeId: b.id, toNodeId: c.id });

    expect(store.getEdgesByOrchestrator(orch.id)).toHaveLength(2);
    store.deleteEdgesByOrchestrator(orch.id);
    expect(store.getEdgesByOrchestrator(orch.id)).toHaveLength(0);
  });

  // ── Run Management ──

  it('creates, gets, updates, and lists runs', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'RunTest' });

    const run = store.createRun({
      orchestratorId: orch.id,
      triggeredBy: 'dashboard',
      triggeredUserId: 'user-1',
    });

    expect(run.orchestratorId).toBe(orch.id);
    expect(run.status).toBe('running');
    expect(run.triggeredBy).toBe('dashboard');
    expect(run.triggeredUserId).toBe('user-1');
    expect(run.startedAt).toBeTruthy();

    expect(store.getRunById(run.id)?.id).toBe(run.id);
    expect(store.getRunById('missing')).toBeNull();

    store.updateRun(run.id, {
      status: 'completed',
      endedAt: '2026-03-01T00:01:00.000Z',
    });
    const updated = store.getRunById(run.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.endedAt).toBe('2026-03-01T00:01:00.000Z');

    // Empty update does nothing
    store.updateRun(run.id, {});

    const runs = store.getRunsByOrchestrator(orch.id);
    expect(runs).toHaveLength(1);

    // Rerun
    const rerun = store.createRun({
      orchestratorId: orch.id,
      triggeredBy: 'slack',
      rerunFromRunId: run.id,
      rerunFromNodeId: 'node-1',
    });
    expect(rerun.rerunFromRunId).toBe(run.id);
    expect(rerun.rerunFromNodeId).toBe('node-1');
    expect(store.getRunsByOrchestrator(orch.id)).toHaveLength(2);
  });

  it('getRunsByOrchestrator respects limit', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'LimitTest' });
    for (let i = 0; i < 5; i++) {
      store.createRun({ orchestratorId: orch.id, triggeredBy: 'dashboard' });
    }
    expect(store.getRunsByOrchestrator(orch.id, 2)).toHaveLength(2);
    expect(store.getRunsByOrchestrator(orch.id)).toHaveLength(5);
  });

  it('getAllRunIds returns all run IDs for an orchestrator', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'AllRunIds' });
    const other = store.create({ name: 'Other' });
    const run1 = store.createRun({ orchestratorId: orch.id, triggeredBy: 'dashboard' });
    const run2 = store.createRun({ orchestratorId: orch.id, triggeredBy: 'dashboard' });
    store.createRun({ orchestratorId: other.id, triggeredBy: 'dashboard' }); // different orchestrator

    const ids = store.getAllRunIds(orch.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids)).toEqual(new Set([run1.id, run2.id]));

    // Other orchestrator should have its own run
    expect(store.getAllRunIds(other.id)).toHaveLength(1);
  });

  it('getRunningRuns returns only running status', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'RunningTest' });
    const run1 = store.createRun({ orchestratorId: orch.id, triggeredBy: 'dashboard' });
    const run2 = store.createRun({ orchestratorId: orch.id, triggeredBy: 'dashboard' });
    store.updateRun(run1.id, { status: 'completed' });

    const running = store.getRunningRuns();
    expect(running).toHaveLength(1);
    expect(running[0]?.id).toBe(run2.id);
  });

  // ── Node Run Management ──

  it('creates, gets, updates, and lists node runs', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'NodeRunTest' });
    const run = store.createRun({ orchestratorId: orch.id, triggeredBy: 'dashboard' });
    const node = store.createNode({ orchestratorId: orch.id, label: 'A' });

    const nodeRun = store.createNodeRun({
      orchestrationRunId: run.id,
      nodeId: node.id,
      status: 'running',
      startedAt: '2026-03-01T00:00:00.000Z',
    });

    expect(nodeRun.orchestrationRunId).toBe(run.id);
    expect(nodeRun.nodeId).toBe(node.id);
    expect(nodeRun.status).toBe('running');
    expect(nodeRun.retryCount).toBe(0);

    expect(store.getNodeRunById(nodeRun.id)?.id).toBe(nodeRun.id);
    expect(store.getNodeRunById('missing')).toBeNull();

    store.updateNodeRun(nodeRun.id, {
      status: 'completed',
      returnValue: 'success',
      exitCode: 0,
      outputSummary: 'all good',
      endedAt: '2026-03-01T00:01:00.000Z',
    });

    const updated = store.getNodeRunById(nodeRun.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.returnValue).toBe('success');
    expect(updated?.exitCode).toBe(0);
    expect(updated?.outputSummary).toBe('all good');

    // Empty update does nothing
    store.updateNodeRun(nodeRun.id, {});

    expect(store.getNodeRunsByRun(run.id)).toHaveLength(1);
  });

  it('getNodeRunByJobId returns matching run', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'JobIdTest' });
    const run = store.createRun({ orchestratorId: orch.id, triggeredBy: 'dashboard' });
    const node = store.createNode({ orchestratorId: orch.id, label: 'A' });

    const nodeRun = store.createNodeRun({
      orchestrationRunId: run.id,
      nodeId: node.id,
      jobId: 'job-123',
    });

    expect(store.getNodeRunByJobId('job-123')?.id).toBe(nodeRun.id);
    expect(store.getNodeRunByJobId('missing-job')).toBeNull();
  });

  it('createNodeRun with gate evaluation', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'GateRunTest' });
    const run = store.createRun({ orchestratorId: orch.id, triggeredBy: 'dashboard' });
    const node = store.createNode({ orchestratorId: orch.id, label: 'Gate' });

    const nodeRun = store.createNodeRun({
      orchestrationRunId: run.id,
      nodeId: node.id,
      status: 'completed',
      gateEvaluation: '{"mode":"all","satisfied":true}',
      returnValue: 'gate_passed',
      startedAt: '2026-03-01',
      endedAt: '2026-03-01',
    });

    expect(nodeRun.gateEvaluation).toBe('{"mode":"all","satisfied":true}');
    expect(nodeRun.returnValue).toBe('gate_passed');
  });

  // ── Full Load ──

  it('getFullOrchestrator returns orchestrator with nodes and edges', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'FullLoad' });
    const nodeA = store.createNode({ orchestratorId: orch.id, label: 'A' });
    const nodeB = store.createNode({ orchestratorId: orch.id, label: 'B' });
    store.createEdge({ orchestratorId: orch.id, fromNodeId: nodeA.id, toNodeId: nodeB.id });

    const full = store.getFullOrchestrator(orch.id);
    expect(full).not.toBeNull();
    expect(full?.orchestrator.id).toBe(orch.id);
    expect(full?.nodes).toHaveLength(3);
    expect(full?.edges).toHaveLength(1);

    expect(store.getFullOrchestrator('missing')).toBeNull();
  });

  // ── Error cases ──

  it('throws when created records cannot be reloaded', () => {
    db = createDb();
    const store = new OrchestratorStore(db);

    // Orchestrator create failure
    const getByIdSpy = vi.spyOn(store, 'getById').mockReturnValue(null);
    expect(() => store.create({ name: 'bad' })).toThrow('Failed to create orchestrator');
    getByIdSpy.mockRestore();

    const orch = store.create({ name: 'ok' });

    // Node create failure (spy on sub-store since facade delegates)
    const getNodeSpy = vi.spyOn(store.graph, 'getNodeById').mockReturnValue(null);
    expect(() => store.createNode({ orchestratorId: orch.id, label: 'bad' })).toThrow(
      'Failed to create orchestrator node',
    );
    getNodeSpy.mockRestore();

    const node = store.createNode({ orchestratorId: orch.id, label: 'A' });
    const nodeB = store.createNode({ orchestratorId: orch.id, label: 'B' });

    // Edge create failure (spy on sub-store since facade delegates)
    const getEdgeSpy = vi.spyOn(store.graph, 'getEdgeById').mockReturnValue(null);
    expect(() =>
      store.createEdge({ orchestratorId: orch.id, fromNodeId: node.id, toNodeId: nodeB.id }),
    ).toThrow('Failed to create orchestrator edge');
    getEdgeSpy.mockRestore();

    const run = store.createRun({ orchestratorId: orch.id, triggeredBy: 'dashboard' });

    // Node run create failure (spy on sub-store since facade delegates)
    const getNodeRunSpy = vi.spyOn(store.runs, 'getNodeRunById').mockReturnValue(null);
    expect(() => store.createNodeRun({ orchestrationRunId: run.id, nodeId: node.id })).toThrow(
      'Failed to create orchestration node run',
    );
    getNodeRunSpy.mockRestore();
  });

  // ── returnValues + end node ──

  it('creates and retrieves node with returnValues', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'ReturnValuesTest' });

    const node = store.createNode({
      orchestratorId: orch.id,
      label: 'Build',
      nodeType: 'task',
      tool: 'claude',
      prompt: 'build it',
      returnValues: ['success', 'error'],
    });

    expect(node.returnValues).toEqual(['success', 'error', 'other_return', 'error_return']);

    // Verify roundtrip from DB
    const fetched = store.getNodeById(node.id);
    expect(fetched?.returnValues).toEqual(['success', 'error', 'other_return', 'error_return']);
  });

  it('stores null returnValues for nodes without them', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'NullReturnValues' });

    const node = store.createNode({
      orchestratorId: orch.id,
      label: 'NoRV',
      nodeType: 'task',
      tool: 'claude',
      prompt: 'test',
    });

    expect(node.returnValues).toBeNull();
  });

  it('updates returnValues on existing node', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'UpdateRVTest' });

    const node = store.createNode({
      orchestratorId: orch.id,
      label: 'Task',
      tool: 'claude',
      prompt: 'test',
      returnValues: ['ok'],
    });

    store.updateNode(node.id, { returnValues: ['pass', 'fail', 'retry'] });
    const updated = store.getNodeById(node.id);
    expect(updated?.returnValues).toEqual([
      'pass',
      'fail',
      'retry',
      'other_return',
      'error_return',
    ]);

    // Clear returnValues
    store.updateNode(node.id, { returnValues: null });
    const cleared = store.getNodeById(node.id);
    expect(cleared?.returnValues).toBeNull();
  });

  it('creates end node without tool or prompt', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'EndNodeTest' });

    const endNode = store.createNode({
      orchestratorId: orch.id,
      label: 'Finish',
      nodeType: 'end',
    });

    expect(endNode.nodeType).toBe('end');
    expect(endNode.tool).toBeNull();
    expect(endNode.prompt).toBeNull();
    expect(endNode.returnValues).toBeNull();
  });

  it('returnValues included in getFullOrchestrator', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'FullLoadRV' });
    store.createNode({
      orchestratorId: orch.id,
      label: 'A',
      tool: 'claude',
      prompt: 'go',
      returnValues: ['done'],
    });

    const full = store.getFullOrchestrator(orch.id);
    expect(full?.nodes[0]?.returnValues).toEqual(['done', 'other_return', 'error_return']);
  });

  it('handles invalid gate_condition JSON gracefully', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'BadJSON' });

    // Insert a node with malformed gate_condition directly
    db.prepare(
      `INSERT INTO orchestrator_nodes
        (id, orchestrator_id, label, node_type, gate_condition, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('bad-gate', orch.id, 'BadGate', 'gate', '{invalid json}', '2026-01-01', '2026-01-01');

    const node = store.getNodeById('bad-gate');
    expect(node?.gateCondition).toBeNull();
  });

  it('updateNode handles boolean-to-integer conversion', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'BoolTest' });
    const node = store.createNode({ orchestratorId: orch.id, label: 'B', notifyEnabled: false });
    expect(node.notifyEnabled).toBe(false);

    store.updateNode(node.id, { notifyEnabled: true, notifyOnError: false });
    const updated = store.getNodeById(node.id);
    expect(updated?.notifyEnabled).toBe(true);
    expect(updated?.notifyOnError).toBe(false);
  });

  it('updates orchestrators with trimming, dagValidated coercion, and undefined-to-null handling', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({
      name: 'Initial Name',
      alias: 'initial-alias',
      description: 'desc',
    });

    store.update(orch.id, {
      name: '  Updated Name  ',
      alias: '   ',
      dagValidated: true,
      description: undefined,
    });

    const updated = store.getById(orch.id);
    expect(updated?.name).toBe('Updated Name');
    expect(updated?.alias).toBeNull();
    expect(updated?.dagValidated).toBe(true);
    expect(updated?.description).toBeNull();

    store.update(orch.id, {
      dagValidated: false,
      unknown: 'ignored',
    } as never);

    expect(store.getById(orch.id)?.dagValidated).toBe(false);
  });

  it('allows update checks to short-circuit when the target orchestrator does not exist', () => {
    db = createDb();
    const store = new OrchestratorStore(db);

    expect(() => store.update('missing-orch', { name: 'Renamed' })).not.toThrow();
  });

  it('invalidates dag validation state directly', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'Invalidate Me' });

    store.update(orch.id, { dagValidated: true });
    expect(store.getById(orch.id)?.dagValidated).toBe(true);

    store.invalidateDag(orch.id);
    expect(store.getById(orch.id)?.dagValidated).toBe(false);
  });

  it('delegates validated snapshot helpers through the facade', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const saveSpy = vi.spyOn(snapshotModule, 'saveValidatedSnapshot').mockImplementation(() => {});
    const revertSpy = vi.spyOn(snapshotModule, 'revertToValidatedSnapshot').mockReturnValue(true);

    store.saveValidatedSnapshot('orch-1');
    expect(saveSpy).toHaveBeenCalledWith(db, store.graph, 'orch-1');

    expect(store.revertToValidatedSnapshot('orch-1')).toBe(true);
    expect(revertSpy).toHaveBeenCalledWith(db, 'orch-1');
  });

  it('restores node-level workdir and instruction settings from validated snapshots', () => {
    db = createDb();
    db.exec('ALTER TABLE orchestrators ADD COLUMN validated_snapshot TEXT');
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'Snapshot Restore' });
    const node = store.createNode({
      orchestratorId: orch.id,
      label: 'Task',
      tool: 'claude',
      prompt: 'run',
      workdir: '/tmp/node-workdir',
      writeInstructionFile: false,
      instructionFile: '# node instructions',
    });

    store.saveValidatedSnapshot(orch.id);
    store.graph.updateNode(node.id, {
      workdir: '/tmp/changed-workdir',
      writeInstructionFile: true,
      instructionFile: '# changed instructions',
    });

    expect(store.revertToValidatedSnapshot(orch.id)).toBe(true);
    expect(store.getNodeById(node.id)).toMatchObject({
      workdir: '/tmp/node-workdir',
      writeInstructionFile: false,
      instructionFile: '# node instructions',
    });
  });

  it('restores triggered node config from validated snapshots', () => {
    db = createDb();
    db.exec('ALTER TABLE orchestrators ADD COLUMN validated_snapshot TEXT');
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'Triggered Snapshot Restore' });
    const node = store.createNode({
      orchestratorId: orch.id,
      label: 'Wait for Event',
      nodeType: 'triggered',
      tool: 'claude',
      prompt: 'wait',
      triggeredConfig: { waitTimeoutSec: 60, onTimeout: 'skip' },
      workdir: '/tmp/triggered-workdir',
      writeInstructionFile: false,
      instructionFile: '# triggered instructions',
    });

    store.saveValidatedSnapshot(orch.id);
    store.graph.updateNode(node.id, {
      triggeredConfig: { waitTimeoutSec: 120, onTimeout: 'fail' },
      workdir: '/tmp/changed-workdir',
      writeInstructionFile: true,
      instructionFile: '# changed instructions',
    });

    expect(store.revertToValidatedSnapshot(orch.id)).toBe(true);
    expect(store.getNodeById(node.id)).toMatchObject({
      triggeredConfig: { waitTimeoutSec: 60, onTimeout: 'skip' },
      workdir: '/tmp/triggered-workdir',
      writeInstructionFile: false,
      instructionFile: '# triggered instructions',
    });
  });

  it('rejects invalid node limits in validated snapshots before replacing current graph', () => {
    db = createDb();
    db.exec('ALTER TABLE orchestrators ADD COLUMN validated_snapshot TEXT');
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'Reject Invalid Snapshot' });
    const node = store.createNode({
      orchestratorId: orch.id,
      label: 'Task',
      tool: 'claude',
      prompt: 'run',
    });
    const current = store.getNodeById(node.id);
    if (!current) {
      throw new Error('expected node to exist');
    }

    db.prepare('UPDATE orchestrators SET validated_snapshot = ? WHERE id = ?').run(
      JSON.stringify({
        nodes: [
          {
            ...current,
            timeoutSec: 21_601,
          },
        ],
        edges: [],
      }),
      orch.id,
    );

    expect(() => store.revertToValidatedSnapshot(orch.id)).toThrow(
      'Validated snapshot node "Task" is invalid: timeoutSec must be between 1 and 21600',
    );
    expect(store.getNodeById(node.id)).toMatchObject({
      label: 'Task',
      timeoutSec: null,
    });
  });

  it('graph updates serialize JSON fields and ignore unknown patch keys', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'Graph JSON' });
    const node = store.createNode({
      orchestratorId: orch.id,
      label: 'Task',
      tool: 'claude',
      prompt: 'run',
      returnConditions: [{ condition: 'ok', value: 'pass' }],
      notifyOnError: false,
    });

    store.graph.updateNode(node.id, {
      returnConditions: [{ condition: 'ok', value: 'pass' }],
      returnValues: ['pass', 'fail'],
      gateCondition: { mode: 'and', matchValue: 'pass' },
      notifyEnabled: true,
      notifyOnError: false,
      unknown: 'ignored',
    } as never);
    expect(store.getNodeById(node.id)).toMatchObject({
      returnConditions: [{ condition: 'ok', value: 'pass' }],
      returnValues: ['pass', 'fail', 'other_return', 'error_return'],
      gateCondition: { mode: 'and', matchValue: 'pass' },
      notifyEnabled: true,
      notifyOnError: false,
    });

    store.graph.updateNode(node.id, {
      returnConditions: null,
      returnValues: null,
      unknown: 'ignored',
    } as never);
    expect(store.getNodeById(node.id)).toMatchObject({
      returnConditions: null,
      returnValues: null,
    });

    store.graph.updateNode(node.id, {
      prompt: undefined,
      unknown: 'ignored',
    } as never);
    expect(store.getNodeById(node.id)?.prompt).toBeNull();

    expect(() =>
      store.graph.updateNode(node.id, { label: 'stale' }, '2000-01-01T00:00:00.000Z'),
    ).toThrow(/was modified by another request/);
  });

  it('edge updates ignore unknown keys and coerce undefined values to null', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'Edge JSON' });
    const a = store.createNode({
      orchestratorId: orch.id,
      label: 'A',
      tool: 'claude',
      prompt: 'run',
    });
    const b = store.createNode({
      orchestratorId: orch.id,
      label: 'B',
      tool: 'claude',
      prompt: 'run',
    });
    const edge = store.createEdge({
      orchestratorId: orch.id,
      fromNodeId: a.id,
      toNodeId: b.id,
      conditionValue: 'ok',
      conditionOperator: 'eq',
    });

    store.graph.updateEdge(edge.id, {
      conditionValue: undefined,
      unknown: 'ignored',
    } as never);

    expect(store.getEdgeById(edge.id)).toMatchObject({
      conditionValue: null,
      conditionOperator: 'eq',
    });
  });

  it('run stores ignore unknown patch keys and coerce undefined values to null', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'Run Patch' });
    const run = store.runs.createRun({ orchestratorId: orch.id, triggeredBy: 'dashboard' });
    const node = store.createNode({
      orchestratorId: orch.id,
      label: 'Task',
      tool: 'claude',
      prompt: 'run',
    });
    const nodeRun = store.runs.createNodeRun({
      orchestrationRunId: run.id,
      nodeId: node.id,
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
    });

    store.runs.updateRun(run.id, { startedAt: undefined, unknown: 'ignored' } as never);
    store.runs.updateNodeRun(nodeRun.id, { outputSummary: undefined, unknown: 'ignored' } as never);

    expect(store.runs.getRunById(run.id)?.startedAt).toBeNull();
    expect(store.runs.getNodeRunById(nodeRun.id)?.outputSummary).toBeNull();
  });

  it('throws when the split run store cannot reload a freshly-created run', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'Run Reload Failure' });
    const getRunSpy = vi.spyOn(store.runs, 'getRunById').mockReturnValueOnce(null);

    expect(() =>
      store.runs.createRun({
        orchestratorId: orch.id,
        triggeredBy: 'dashboard',
      }),
    ).toThrow('Failed to create orchestration run');

    getRunSpy.mockRestore();
  });

  // ── Delegation coverage ──

  it('offloadRunOutputs delegates to runs store', () => {
    db = createDb();
    // Add missing columns that offloadRunOutputs queries
    db.exec('ALTER TABLE orchestration_node_runs ADD COLUMN output_path TEXT');
    db.exec('ALTER TABLE orchestration_node_runs ADD COLUMN output_bytes INTEGER');
    db.exec('ALTER TABLE orchestration_node_runs ADD COLUMN output_sha256 TEXT');
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'Offload Test' });
    const run = store.createRun({
      orchestratorId: orch.id,
      triggeredBy: 'dashboard',
    });

    // No dataDir configured — should return error about missing dataDir
    const result = store.offloadRunOutputs(run.id);
    expect(result.offloadedCount).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('dataDir');
  });

  it('getCompletedRunIds returns completed run IDs', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'Completed Test' });
    const run = store.createRun({
      orchestratorId: orch.id,
      triggeredBy: 'dashboard',
    });
    store.updateRun(run.id, { status: 'completed', endedAt: new Date().toISOString() });

    const ids = store.getCompletedRunIds(orch.id);
    expect(ids).toContain(run.id);
  });

  it('getAllRunIds returns all run IDs', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'All Runs Test' });
    const run1 = store.createRun({
      orchestratorId: orch.id,
      triggeredBy: 'dashboard',
    });
    const run2 = store.createRun({
      orchestratorId: orch.id,
      triggeredBy: 'dashboard',
    });

    const ids = store.getAllRunIds(orch.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(run1.id);
    expect(ids).toContain(run2.id);
  });

  it('archiveAndPruneOutputFull delegates to archive module', () => {
    db = createDb();
    // Add missing columns that archiveAndPruneOutputFull queries
    db.exec('ALTER TABLE orchestration_node_runs ADD COLUMN output_path TEXT');
    db.exec('ALTER TABLE orchestration_node_runs ADD COLUMN output_bytes INTEGER');
    db.exec('ALTER TABLE orchestration_node_runs ADD COLUMN output_sha256 TEXT');
    const store = new OrchestratorStore(db);
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-orch-archive-'));
    try {
      const result = store.archiveAndPruneOutputFull(dataDir);
      expect(result.archivedCount).toBe(0);
      expect(result.errors).toHaveLength(0);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('listEnriched returns orchestrators with node count and last run info', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'Enriched Test' });
    const run = store.createRun({
      orchestratorId: orch.id,
      triggeredBy: 'dashboard',
    });
    store.updateRun(run.id, {
      status: 'completed',
      endedAt: new Date().toISOString(),
    });

    const enriched = store.listEnriched();
    const found = enriched.find((o) => o.id === orch.id);
    expect(found).toBeTruthy();
    expect(found?.nodeCount).toBeGreaterThanOrEqual(1); // has start node
    expect(found?.lastRunStatus).toBe('completed');
  });

  it('update with expectedUpdatedAt throws StaleUpdateError on mismatch', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'Stale Test' });

    expect(() => {
      store.update(orch.id, { name: 'Updated' }, '2020-01-01T00:00:00Z');
    }).toThrow('modified by another request');
  });

  it('releaseClaim clears claimed_at on orchestrator', () => {
    db = createDb();
    const store = new OrchestratorStore(db);
    const orch = store.create({ name: 'Release Test' });
    const now = new Date().toISOString();

    store.claimOrchestrator(orch.id, now);
    let current = store.getById(orch.id);
    expect(current?.claimedAt).toBeTruthy();

    store.releaseClaim(orch.id);
    current = store.getById(orch.id);
    expect(current?.claimedAt).toBeNull();
  });
});
