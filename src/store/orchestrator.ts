/** @module orchestrator — Facade for orchestrator, graph, and run persistence. */
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  ORCHESTRATOR_DEFAULTS,
  assertValidOrchestratorLimits,
  assertValidOrchestratorNodeLimits,
} from '../orchestrator/orchestrator-limits.js';
import type { OrchestratorRow } from '../orchestrator/types-db.js';
import type {
  NodePatch,
  NodeRunPatch,
  OrchestratorPatch,
  RunPatch,
} from '../orchestrator/types-patch.js';
import type {
  CreateOrchestrationNodeRun,
  CreateOrchestrationRun,
  CreateOrchestrator,
  CreateOrchestratorEdge,
  CreateOrchestratorNode,
  OrchestrationNodeRun,
  OrchestrationRun,
  Orchestrator,
  OrchestratorEdge,
  OrchestratorNode,
  OrchestratorStatus,
} from '../orchestrator/types.js';
import { mapOrchestrator as toOrchestrator } from '../shared/mappers/orchestrator.js';
import { resolveTimezone } from '../utils/timezone.js';
import { archiveAndPruneOutputFull } from './orchestrator-archive.js';
import { OrchestratorGraphStore } from './orchestrator-graph.js';
import { OrchestratorRunStore } from './orchestrator-run.js';
import { revertToValidatedSnapshot, saveValidatedSnapshot } from './orchestrator-snapshot.js';
import {
  BOOL_TRANSFORM,
  SKILLS_TRANSFORM,
  StaleUpdateError,
  TRIM_OR_NULL_TRANSFORM,
  TRIM_TRANSFORM,
  buildDynamicUpdate,
  skillsToDb,
} from './store-utils.js';

const START_NODE_RETURN_CONDITIONS = [
  {
    condition: 'The task completes',
    value: 'done',
  },
] as const;
const START_NODE_RETURN_VALUES = ['done', 'other_return', 'error_return'] as const;

/**
 * Orchestrator CRUD with delegated graph (nodes/edges) and run sub-stores.
 * Backward-compat proxy methods forward to `this.graph` and `this.runs`.
 */
export class OrchestratorStore {
  readonly graph: OrchestratorGraphStore;
  readonly runs: OrchestratorRunStore;

  constructor(
    private readonly db: Database.Database,
    dataDir?: string,
  ) {
    this.graph = new OrchestratorGraphStore(db);
    this.runs = new OrchestratorRunStore(db, dataDir);
  }

  /** Run a synchronous callback inside a single DB transaction. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // ── Orchestrator CRUD ──────────────────────────────────────

  create(input: CreateOrchestrator): Orchestrator {
    const id = crypto.randomUUID();
    const startNodeId = crypto.randomUUID();
    const now = new Date().toISOString();
    const trimmedName = input.name.trim();
    const trimmedAlias = input.alias?.trim() || null;

    assertValidOrchestratorLimits({
      maxParallelism: input.maxParallelism,
      maxTotalNodes: input.maxTotalNodes,
      timeoutSec: input.timeoutSec,
    });

    if (!this.isNameAvailable(trimmedName)) {
      throw new Error(`Name "${trimmedName}" is already in use`);
    }

    if (trimmedAlias && !this.isAliasAvailable(trimmedAlias)) {
      throw new Error(`Alias "${trimmedAlias}" is already in use`);
    }

    const triggerMode = input.triggerMode ?? 'ondemand';

    const createTxn = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO orchestrators (
            id, name, alias, description, user_id, workdir, start_node_id,
            trigger_mode, schedule_type, run_at, cron_expr, timezone,
            notify_channel, max_parallelism, max_total_nodes,
            error_policy, timeout_sec, instruction_file,
            enabled_skills_json, summary_enabled, summary_tool,
            max_run_workdirs,
            next_run_at, status, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?,
            ?, 'active', ?, ?
          )`,
        )
        .run(
          id,
          trimmedName,
          trimmedAlias,
          input.description?.trim() || null,
          input.userId ?? 'dashboard',
          input.workdir ?? null,
          startNodeId,
          triggerMode,
          input.scheduleType ?? null,
          input.runAt ?? null,
          input.cronExpr ?? null,
          resolveTimezone(input.timezone),
          input.notifyChannel ?? null,
          input.maxParallelism ?? ORCHESTRATOR_DEFAULTS.maxParallelism,
          input.maxTotalNodes ?? ORCHESTRATOR_DEFAULTS.maxTotalNodes,
          input.errorPolicy ?? ORCHESTRATOR_DEFAULTS.errorPolicy,
          input.timeoutSec ?? null,
          input.instructionFile ?? null,
          skillsToDb(input.enabledSkills),
          input.summaryEnabled ? 1 : 0,
          input.summaryTool ?? null,
          input.maxRunWorkdirs ?? ORCHESTRATOR_DEFAULTS.maxRunWorkdirs,
          input.nextRunAt ?? null,
          now,
          now,
        );

      this.db
        .prepare(
          `INSERT INTO orchestrator_nodes (
            id, orchestrator_id, label, node_type, tool, mode, prompt,
            instruction_file, workdir, write_instruction_file,
            max_retries, timeout_sec, allow_mcp, enabled_mcp_server_ids,
            output_mode, return_conditions,
            return_values, gate_condition,
            notify_enabled, notify_channel, notify_on_error,
            position_x, position_y, sort_order,
            created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?
          )`,
        )
        .run(
          startNodeId,
          id,
          'Start',
          'task',
          'claude',
          'write',
          '',
          null,
          null,
          1,
          0,
          null,
          1,
          null,
          'auto',
          JSON.stringify(START_NODE_RETURN_CONDITIONS),
          JSON.stringify(START_NODE_RETURN_VALUES),
          null,
          0,
          null,
          1,
          0,
          0,
          0,
          now,
          now,
        );
    });

    createTxn();

    const created = this.getById(id);
    if (!created) throw new Error('Failed to create orchestrator');
    return created;
  }

  getById(id: string): Orchestrator | null {
    const row = this.db.prepare('SELECT * FROM orchestrators WHERE id = ?').get(id) as
      | OrchestratorRow
      | undefined;
    return row ? toOrchestrator(row) : null;
  }

  findByAlias(alias: string): Orchestrator | null {
    const row = this.db
      .prepare("SELECT * FROM orchestrators WHERE alias = ? AND status != 'deleted'")
      .get(alias) as OrchestratorRow | undefined;
    return row ? toOrchestrator(row) : null;
  }

  list(filter?: { status?: OrchestratorStatus }): Orchestrator[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    } else {
      conditions.push("status != 'deleted'");
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = this.db
      .prepare(`SELECT * FROM orchestrators ${where} ORDER BY created_at DESC`)
      .all(...params) as OrchestratorRow[];
    return rows.map(toOrchestrator);
  }

  /** List with enrichment fields (nodeCount, lastRunStatus, etc.) for dashboard-style display. */
  listEnriched(): Array<
    Orchestrator & {
      nodeCount: number;
      lastRunStatus: string | null;
      lastRunEndedAt: string | null;
      lastRunError: string | null;
    }
  > {
    const orchestrators = this.list();
    const stmtNodeCount = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM orchestrator_nodes WHERE orchestrator_id = ?',
    );
    const stmtLastRun = this.db.prepare(
      'SELECT status, ended_at, error_message FROM orchestration_runs WHERE orchestrator_id = ? ORDER BY created_at DESC LIMIT 1',
    );

    return orchestrators.map((orch) => {
      const countRow = stmtNodeCount.get(orch.id) as { cnt: number } | undefined;
      const lastRun = stmtLastRun.get(orch.id) as
        | { status: string; ended_at: string | null; error_message: string | null }
        | undefined;
      return {
        ...orch,
        nodeCount: countRow?.cnt ?? 0,
        lastRunStatus: lastRun?.status ?? null,
        lastRunEndedAt: lastRun?.ended_at ?? null,
        lastRunError: lastRun?.error_message ?? null,
      };
    });
  }

  update(id: string, patch: OrchestratorPatch, expectedUpdatedAt?: string): void {
    const existing = this.getById(id);
    if (!existing) return;

    assertValidOrchestratorLimits({
      maxParallelism: patch.maxParallelism,
      maxTotalNodes: patch.maxTotalNodes,
      timeoutSec: patch.timeoutSec,
    });

    if ('name' in patch || 'alias' in patch) {
      const nextName = typeof patch.name === 'string' ? patch.name.trim() : existing.name;
      const nextAlias =
        typeof patch.alias === 'string'
          ? patch.alias.trim() || null
          : (patch.alias ?? existing.alias);

      if (!this.isNameAvailable(nextName, id)) {
        throw new Error(`Name "${nextName}" is already in use`);
      }
      if (nextAlias && !this.isAliasAvailable(nextAlias, id)) {
        throw new Error(`Alias "${nextAlias}" is already in use`);
      }
    }

    const result = buildDynamicUpdate(patch as Record<string, unknown>, {
      fieldMap: {
        name: 'name',
        alias: 'alias',
        description: 'description',
        userId: 'user_id',
        workdir: 'workdir',
        scheduleType: 'schedule_type',
        runAt: 'run_at',
        cronExpr: 'cron_expr',
        timezone: 'timezone',
        notifyChannel: 'notify_channel',
        maxParallelism: 'max_parallelism',
        maxTotalNodes: 'max_total_nodes',
        errorPolicy: 'error_policy',
        timeoutSec: 'timeout_sec',
        instructionFile: 'instruction_file',
        enabledSkills: 'enabled_skills_json',
        summaryEnabled: 'summary_enabled',
        summaryTool: 'summary_tool',
        maxRunWorkdirs: 'max_run_workdirs',
        status: 'status',
        dagValidated: 'dag_validated',
        lastRunAt: 'last_run_at',
        runCount: 'run_count',
        nextRunAt: 'next_run_at',
        claimedAt: 'claimed_at',
      },
      transforms: {
        dagValidated: BOOL_TRANSFORM,
        name: TRIM_TRANSFORM,
        alias: TRIM_OR_NULL_TRANSFORM,
        enabledSkills: SKILLS_TRANSFORM,
        summaryEnabled: BOOL_TRANSFORM,
      },
      expectedUpdatedAt,
    });
    if (!result) return;

    const whereClause = result.extraWhere ? `WHERE id = ? ${result.extraWhere}` : 'WHERE id = ?';
    result.params.push(id);
    if (result.extraWhereParams) result.params.push(...result.extraWhereParams);
    const info = this.db
      .prepare(`UPDATE orchestrators SET ${result.sets.join(', ')} ${whereClause}`)
      .run(...result.params);
    if (expectedUpdatedAt && info.changes === 0) {
      throw new StaleUpdateError('Orchestrator', id);
    }
  }

  /** Mark DAG as not validated (called when nodes/edges change). */
  invalidateDag(id: string): void {
    this.db.prepare('UPDATE orchestrators SET dag_validated = 0 WHERE id = ?').run(id);
  }

  softDelete(id: string): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM event_subscriptions
           WHERE orchestrator_id = ?
              OR node_id IN (
                SELECT id FROM orchestrator_nodes WHERE orchestrator_id = ?
              )`,
        )
        .run(id, id);
      this.update(id, { status: 'deleted' });
    })();
  }

  isNameAvailable(name: string, excludeId?: string): boolean {
    const row = this.db
      .prepare(
        excludeId
          ? "SELECT id FROM orchestrators WHERE name = ? AND status != 'deleted' AND id != ?"
          : "SELECT id FROM orchestrators WHERE name = ? AND status != 'deleted'",
      )
      .get(...(excludeId ? [name, excludeId] : [name])) as { id: string } | undefined;
    return !row;
  }

  isAliasAvailable(alias: string, excludeId?: string): boolean {
    const row = this.db
      .prepare(
        excludeId
          ? "SELECT id FROM orchestrators WHERE alias = ? AND status != 'deleted' AND id != ?"
          : "SELECT id FROM orchestrators WHERE alias = ? AND status != 'deleted'",
      )
      .get(...(excludeId ? [alias, excludeId] : [alias])) as { id: string } | undefined;
    return !row;
  }

  incrementRunCount(id: string, lastRunAt: string): void {
    this.db
      .prepare('UPDATE orchestrators SET run_count = run_count + 1, last_run_at = ? WHERE id = ?')
      .run(lastRunAt, id);
  }

  // ── Scheduler Support ──────────────────────────────────────

  getDueOrchestrators(now: string): Orchestrator[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM orchestrators
         WHERE status = 'active'
           AND trigger_mode = 'ondemand'
           AND schedule_type IS NOT NULL
           AND next_run_at IS NOT NULL
           AND next_run_at <= ?
           AND claimed_at IS NULL`,
      )
      .all(now) as OrchestratorRow[];
    return rows.map(toOrchestrator);
  }

  claimOrchestrator(id: string, now: string): Orchestrator | null {
    const row = this.db
      .prepare(
        'UPDATE orchestrators SET claimed_at = ? WHERE id = ? AND claimed_at IS NULL RETURNING *',
      )
      .get(now, id) as OrchestratorRow | undefined;
    return row ? toOrchestrator(row) : null;
  }

  releaseClaim(id: string): void {
    this.db.prepare('UPDATE orchestrators SET claimed_at = NULL WHERE id = ?').run(id);
  }

  recoverStaleClaims(timeoutMinutes: number): number {
    const cutoff = new Date(Date.now() - timeoutMinutes * 60_000).toISOString();
    const result = this.db
      .prepare(
        "UPDATE orchestrators SET claimed_at = NULL WHERE claimed_at IS NOT NULL AND claimed_at < ? AND status = 'active'",
      )
      .run(cutoff);
    return result.changes;
  }

  // ── Full Load (for engine) ─────────────────────────────────

  /**
   * Load orchestrator with all nodes and edges in a single call.
   */
  getFullOrchestrator(
    id: string,
  ): { orchestrator: Orchestrator; nodes: OrchestratorNode[]; edges: OrchestratorEdge[] } | null {
    const orchestrator = this.getById(id);
    if (!orchestrator) return null;

    return {
      orchestrator,
      nodes: this.graph.getNodesByOrchestrator(id),
      edges: this.graph.getEdgesByOrchestrator(id),
    };
  }

  // ── Validated Snapshot (delegated) ─────────────────────────

  saveValidatedSnapshot(orchestratorId: string): void {
    saveValidatedSnapshot(this.db, this.graph, orchestratorId);
  }

  revertToValidatedSnapshot(orchestratorId: string): boolean {
    return revertToValidatedSnapshot(this.db, orchestratorId);
  }

  // ── Output Full Cleanup (delegated) ────────────────────────

  archiveAndPruneOutputFull(
    dataDir: string,
    retentionDays = 7,
    maxRows = 1000,
  ): { archivedCount: number; errors: string[] } {
    return archiveAndPruneOutputFull(this.db, dataDir, retentionDays, maxRows);
  }

  offloadRunOutputs(runId: string): { offloadedCount: number; errors: string[] } {
    return this.runs.offloadRunOutputs(runId);
  }

  // ── Graph Delegation (backwards compatibility) ─────────────

  createNode(input: CreateOrchestratorNode): OrchestratorNode {
    assertValidOrchestratorNodeLimits({
      maxRetries: input.maxRetries,
      timeoutSec: input.timeoutSec,
      waitTimeoutSec: input.triggeredConfig?.waitTimeoutSec,
    });
    return this.graph.createNode(input);
  }

  getNodeById(id: string): OrchestratorNode | null {
    return this.graph.getNodeById(id);
  }

  getNodesByOrchestrator(orchestratorId: string): OrchestratorNode[] {
    return this.graph.getNodesByOrchestrator(orchestratorId);
  }

  updateNode(
    nodeId: string,
    patch: NodePatch,
    expectedUpdatedAt?: string,
    options?: { autoTimestamp?: boolean },
  ): void {
    assertValidOrchestratorNodeLimits({
      maxRetries: patch.maxRetries,
      timeoutSec: patch.timeoutSec,
      waitTimeoutSec: patch.triggeredConfig?.waitTimeoutSec,
    });
    const node = this.graph.getNodeById(nodeId);
    if (!node) return;
    const orchestrator = this.getById(node.orchestratorId);
    if (
      orchestrator &&
      orchestrator.startNodeId === nodeId &&
      patch.nodeType !== undefined &&
      patch.nodeType !== 'task'
    ) {
      throw new Error('Start node type cannot be changed');
    }
    this.graph.updateNode(nodeId, patch, expectedUpdatedAt, options);
  }

  deleteNode(nodeId: string): void {
    const node = this.graph.getNodeById(nodeId);
    if (!node) return;
    const orchestrator = this.getById(node.orchestratorId);
    if (orchestrator && orchestrator.startNodeId === nodeId) {
      throw new Error('Start node cannot be deleted');
    }
    this.graph.deleteNode(nodeId);
  }

  createEdge(input: CreateOrchestratorEdge): OrchestratorEdge {
    return this.graph.createEdge(input);
  }

  getEdgeById(id: string): OrchestratorEdge | null {
    return this.graph.getEdgeById(id);
  }

  getEdgesByOrchestrator(orchestratorId: string): OrchestratorEdge[] {
    return this.graph.getEdgesByOrchestrator(orchestratorId);
  }

  updateEdge(
    edgeId: string,
    patch: { conditionValue?: string | null; conditionOperator?: string; sortOrder?: number },
  ): void {
    this.graph.updateEdge(edgeId, patch);
  }

  deleteEdge(edgeId: string): void {
    this.graph.deleteEdge(edgeId);
  }

  deleteEdgesByOrchestrator(orchestratorId: string): void {
    this.graph.deleteEdgesByOrchestrator(orchestratorId);
  }

  // ── Run Delegation (backwards compatibility) ───────────────

  createRun(input: CreateOrchestrationRun): OrchestrationRun {
    return this.runs.createRun(input);
  }

  getRunById(runId: string): OrchestrationRun | null {
    return this.runs.getRunById(runId);
  }

  getRunsByOrchestrator(orchestratorId: string, limit = 20): OrchestrationRun[] {
    return this.runs.getRunsByOrchestrator(orchestratorId, limit);
  }

  getCompletedRunIds(orchestratorId: string): string[] {
    return this.runs.getCompletedRunIds(orchestratorId);
  }

  getAllRunIds(orchestratorId: string): string[] {
    return this.runs.getAllRunIds(orchestratorId);
  }

  updateRun(runId: string, patch: RunPatch): void {
    this.runs.updateRun(runId, patch);
  }

  getRunningRuns(): OrchestrationRun[] {
    return this.runs.getRunningRuns();
  }

  createNodeRun(input: CreateOrchestrationNodeRun): OrchestrationNodeRun {
    return this.runs.createNodeRun(input);
  }

  getNodeRunById(nodeRunId: string): OrchestrationNodeRun | null {
    return this.runs.getNodeRunById(nodeRunId);
  }

  getNodeRunsByRun(runId: string): OrchestrationNodeRun[] {
    return this.runs.getNodeRunsByRun(runId);
  }

  getNodeRunByJobId(jobId: string): OrchestrationNodeRun | null {
    return this.runs.getNodeRunByJobId(jobId);
  }

  updateNodeRun(nodeRunId: string, patch: NodeRunPatch): void {
    this.runs.updateNodeRun(nodeRunId, patch);
  }
}
