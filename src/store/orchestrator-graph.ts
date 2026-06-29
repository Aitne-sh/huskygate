/** @module orchestrator-graph — CRUD operations for orchestrator nodes and edges */
/**
 * OrchestratorGraphStore — Node CRUD + Edge CRUD.
 *
 * Extracted from OrchestratorStore (Phase 2 split).
 */

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { assertValidOrchestratorNodeLimits } from '../orchestrator/orchestrator-limits.js';
import type { EdgeRow, NodeRow } from '../orchestrator/types-db.js';
import type { NodePatch } from '../orchestrator/types-patch.js';
import type {
  CreateOrchestratorEdge,
  CreateOrchestratorNode,
  OrchestratorEdge,
  OrchestratorNode,
} from '../orchestrator/types.js';
import { mapEdge as toEdge, mapNode as toNode } from '../shared/mappers/orchestrator.js';
import {
  BOOL_TRANSFORM,
  JSON_TRANSFORM,
  TRIM_OR_NULL_TRANSFORM,
  StaleUpdateError,
  boolToDb,
  buildDynamicUpdate,
  jsonToDb,
} from './store-utils.js';

// ─── Graph Store Class ─────────────────────────────────────────

export class OrchestratorGraphStore {
  constructor(private readonly db: Database.Database) {}

  // ── Node CRUD ──────────────────────────────────────────────

  createNode(input: CreateOrchestratorNode): OrchestratorNode {
    assertValidOrchestratorNodeLimits({
      maxRetries: input.maxRetries,
      timeoutSec: input.timeoutSec,
      waitTimeoutSec: input.triggeredConfig?.waitTimeoutSec,
    });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO orchestrator_nodes (
          id, orchestrator_id, label, node_type, agent_id, tool, model, mode, prompt,
          instruction_file, workdir, write_instruction_file,
          max_retries, timeout_sec, allow_mcp, enabled_mcp_server_ids,
          output_mode, return_conditions,
          return_values, gate_condition, triggered_config_json,
          notify_enabled, notify_channel, notify_on_error,
          position_x, position_y, sort_order,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?
        )`,
      )
      .run(
        id,
        input.orchestratorId,
        input.label.trim(),
        input.nodeType ?? 'task',
        input.agentId ?? null,
        input.tool ?? null,
        input.model ?? null,
        'write',
        input.prompt ?? null,
        input.instructionFile ?? null,
        input.workdir ?? null,
        boolToDb(input.writeInstructionFile ?? true),
        input.maxRetries ?? 0,
        input.timeoutSec ?? null,
        boolToDb(input.allowMcp ?? true),
        jsonToDb(input.enabledMcpServerIds),
        input.outputMode ?? 'auto',
        jsonToDb(input.returnConditions),
        jsonToDb(input.returnValues),
        jsonToDb(input.gateCondition),
        jsonToDb(input.triggeredConfig),
        boolToDb(input.notifyEnabled),
        input.notifyChannel ?? null,
        boolToDb(input.notifyOnError ?? true),
        input.positionX ?? 0,
        input.positionY ?? 0,
        input.sortOrder ?? 0,
        now,
        now,
      );

    const created = this.getNodeById(id);
    if (!created) throw new Error(`Failed to create orchestrator node (id=${id})`);
    return created;
  }

  getNodeById(id: string): OrchestratorNode | null {
    const row = this.db.prepare('SELECT * FROM orchestrator_nodes WHERE id = ?').get(id) as
      | NodeRow
      | undefined;
    return row ? toNode(row) : null;
  }

  getNodesByOrchestrator(orchestratorId: string): OrchestratorNode[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM orchestrator_nodes WHERE orchestrator_id = ? ORDER BY sort_order, created_at',
      )
      .all(orchestratorId) as NodeRow[];
    return rows.map(toNode);
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
    const arrayJsonTransform = (v: unknown): string | null =>
      v !== null && v !== undefined && Array.isArray(v) ? JSON.stringify(v) : null;
    const current = this.getNodeById(nodeId);
    const clearsTriggeredSubscription =
      current?.nodeType === 'triggered' &&
      patch.nodeType !== undefined &&
      patch.nodeType !== 'triggered';

    const result = buildDynamicUpdate(patch as Record<string, unknown>, {
      expectedUpdatedAt,
      autoTimestamp: options?.autoTimestamp ?? true,
      fieldMap: {
        label: 'label',
        nodeType: 'node_type',
        agentId: 'agent_id',
        tool: 'tool',
        model: 'model',
        prompt: 'prompt',
        maxRetries: 'max_retries',
        timeoutSec: 'timeout_sec',
        allowMcp: 'allow_mcp',
        enabledMcpServerIds: 'enabled_mcp_server_ids',
        workdir: 'workdir',
        writeInstructionFile: 'write_instruction_file',
        instructionFile: 'instruction_file',
        outputMode: 'output_mode',
        returnConditions: 'return_conditions',
        returnValues: 'return_values',
        gateCondition: 'gate_condition',
        triggeredConfig: 'triggered_config_json',
        notifyEnabled: 'notify_enabled',
        notifyChannel: 'notify_channel',
        notifyOnError: 'notify_on_error',
        positionX: 'position_x',
        positionY: 'position_y',
        sortOrder: 'sort_order',
      },
      transforms: {
        model: TRIM_OR_NULL_TRANSFORM,
        allowMcp: BOOL_TRANSFORM,
        enabledMcpServerIds: JSON_TRANSFORM,
        writeInstructionFile: BOOL_TRANSFORM,
        notifyEnabled: BOOL_TRANSFORM,
        notifyOnError: BOOL_TRANSFORM,
        gateCondition: JSON_TRANSFORM,
        triggeredConfig: JSON_TRANSFORM,
        returnConditions: arrayJsonTransform,
        returnValues: arrayJsonTransform,
      },
    });
    if (!result) return;

    const whereClause = result.extraWhere ? `WHERE id = ? ${result.extraWhere}` : 'WHERE id = ?';
    result.params.push(nodeId);
    if (result.extraWhereParams) result.params.push(...result.extraWhereParams);
    const info = this.db
      .prepare(`UPDATE orchestrator_nodes SET ${result.sets.join(', ')} ${whereClause}`)
      .run(...result.params);
    if (expectedUpdatedAt && info.changes === 0) {
      throw new StaleUpdateError('Node', nodeId);
    }
    if (info.changes > 0 && clearsTriggeredSubscription) {
      this.db.prepare('DELETE FROM event_subscriptions WHERE node_id = ?').run(nodeId);
    }
  }

  deleteNode(nodeId: string): void {
    // Cascade: delete edges referencing this node
    this.db
      .prepare('DELETE FROM orchestrator_edges WHERE from_node_id = ? OR to_node_id = ?')
      .run(nodeId, nodeId);
    this.db.prepare('DELETE FROM event_subscriptions WHERE node_id = ?').run(nodeId);
    this.db.prepare('DELETE FROM orchestrator_nodes WHERE id = ?').run(nodeId);
  }

  // ── Edge CRUD ──────────────────────────────────────────────

  createEdge(input: CreateOrchestratorEdge): OrchestratorEdge {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO orchestrator_edges (
          id, orchestrator_id, from_node_id, to_node_id,
          condition_value, condition_operator, sort_order, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.orchestratorId,
        input.fromNodeId,
        input.toNodeId,
        input.conditionValue ?? null,
        input.conditionOperator ?? 'eq',
        input.sortOrder ?? 0,
        now,
      );

    const created = this.getEdgeById(id);
    if (!created) throw new Error(`Failed to create orchestrator edge (id=${id})`);
    return created;
  }

  getEdgeById(id: string): OrchestratorEdge | null {
    const row = this.db.prepare('SELECT * FROM orchestrator_edges WHERE id = ?').get(id) as
      | EdgeRow
      | undefined;
    return row ? toEdge(row) : null;
  }

  getEdgesByOrchestrator(orchestratorId: string): OrchestratorEdge[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM orchestrator_edges WHERE orchestrator_id = ? ORDER BY sort_order, created_at',
      )
      .all(orchestratorId) as EdgeRow[];
    return rows.map(toEdge);
  }

  updateEdge(
    edgeId: string,
    patch: {
      conditionValue?: string | null;
      conditionOperator?: string;
      sortOrder?: number;
    },
  ): void {
    const result = buildDynamicUpdate(patch as Record<string, unknown>, {
      fieldMap: {
        conditionValue: 'condition_value',
        conditionOperator: 'condition_operator',
        sortOrder: 'sort_order',
      },
      autoTimestamp: false,
    });
    if (!result) return;

    result.params.push(edgeId);
    this.db
      .prepare(`UPDATE orchestrator_edges SET ${result.sets.join(', ')} WHERE id = ?`)
      .run(...result.params);
  }

  deleteEdge(edgeId: string): void {
    this.db.prepare('DELETE FROM orchestrator_edges WHERE id = ?').run(edgeId);
  }

  deleteEdgesByOrchestrator(orchestratorId: string): void {
    this.db.prepare('DELETE FROM orchestrator_edges WHERE orchestrator_id = ?').run(orchestratorId);
  }
}
