/** @module orchestrator-snapshot — Save and revert validated DAG snapshots (nodes + edges) */
/**
 * Validated Snapshot — save / revert node+edge snapshots.
 *
 * Extracted from OrchestratorStore (Phase 2 split).
 */

import type Database from 'better-sqlite3';
import { validateOrchestratorNodeLimits } from '../orchestrator/orchestrator-limits.js';
import type { OrchestratorEdge, OrchestratorNode } from '../orchestrator/types.js';
import type { OrchestratorGraphStore } from './orchestrator-graph.js';
import { boolToDb, jsonToDb } from './store-utils.js';

/**
 * Save current nodes + edges as a validated snapshot JSON blob.
 * Called when DAG validation succeeds with commit=true.
 */
export function saveValidatedSnapshot(
  db: Database.Database,
  graphStore: OrchestratorGraphStore,
  orchestratorId: string,
): void {
  const nodes = graphStore.getNodesByOrchestrator(orchestratorId);
  const edges = graphStore.getEdgesByOrchestrator(orchestratorId);
  const snapshot = JSON.stringify({ nodes, edges });
  db.prepare('UPDATE orchestrators SET validated_snapshot = ? WHERE id = ?').run(
    snapshot,
    orchestratorId,
  );
}

/**
 * Revert nodes + edges to the last validated snapshot.
 * Deletes all current nodes/edges and re-inserts from snapshot.
 * Returns true if reverted, false if no snapshot exists.
 */
export function revertToValidatedSnapshot(db: Database.Database, orchestratorId: string): boolean {
  const row = db
    .prepare('SELECT validated_snapshot FROM orchestrators WHERE id = ?')
    .get(orchestratorId) as { validated_snapshot: string | null } | undefined;

  if (!row?.validated_snapshot) return false;

  let snapshot: { nodes: OrchestratorNode[]; edges: OrchestratorEdge[] };
  try {
    snapshot = JSON.parse(row.validated_snapshot) as {
      nodes: OrchestratorNode[];
      edges: OrchestratorEdge[];
    };
  } catch {
    return false;
  }

  for (const node of snapshot.nodes) {
    const limitError = validateOrchestratorNodeLimits({
      maxRetries: node.maxRetries,
      timeoutSec: node.timeoutSec,
      waitTimeoutSec: node.triggeredConfig?.waitTimeoutSec,
    });
    if (limitError) {
      throw new Error(`Validated snapshot node "${node.label}" is invalid: ${limitError}`);
    }
  }

  const txn = db.transaction(() => {
    // Delete current edges then nodes
    db.prepare('DELETE FROM orchestrator_edges WHERE orchestrator_id = ?').run(orchestratorId);
    db.prepare('DELETE FROM orchestrator_nodes WHERE orchestrator_id = ?').run(orchestratorId);

    const now = new Date().toISOString();

    // Re-insert nodes from snapshot
    const insertNode = db.prepare(
      `INSERT INTO orchestrator_nodes (
        id, orchestrator_id, label, node_type, agent_id, tool, model, mode, prompt,
        instruction_file, workdir, write_instruction_file,
        max_retries, timeout_sec, allow_mcp, enabled_mcp_server_ids,
        output_mode, return_conditions,
        return_values, gate_condition, triggered_config_json,
        notify_enabled, notify_channel, notify_on_error,
        position_x, position_y, sort_order,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const n of snapshot.nodes) {
      insertNode.run(
        n.id,
        orchestratorId,
        n.label,
        n.nodeType,
        n.agentId ?? null,
        n.tool ?? null,
        n.model ?? null,
        n.mode ?? 'write',
        n.prompt ?? null,
        n.instructionFile ?? null,
        n.workdir ?? null,
        boolToDb(n.writeInstructionFile ?? true),
        n.maxRetries ?? 0,
        n.timeoutSec ?? null,
        boolToDb(n.allowMcp ?? true),
        jsonToDb(n.enabledMcpServerIds),
        n.outputMode ?? 'auto',
        jsonToDb(n.returnConditions),
        jsonToDb(n.returnValues),
        jsonToDb(n.gateCondition),
        jsonToDb(n.triggeredConfig),
        boolToDb(n.notifyEnabled),
        n.notifyChannel ?? null,
        boolToDb(n.notifyOnError ?? true),
        n.positionX ?? 0,
        n.positionY ?? 0,
        n.sortOrder ?? 0,
        n.createdAt ?? now,
        now,
      );
    }

    // Re-insert edges from snapshot
    const insertEdge = db.prepare(
      `INSERT INTO orchestrator_edges (
        id, orchestrator_id, from_node_id, to_node_id,
        condition_value, condition_operator, sort_order, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const e of snapshot.edges) {
      insertEdge.run(
        e.id,
        orchestratorId,
        e.fromNodeId,
        e.toNodeId,
        e.conditionValue ?? null,
        e.conditionOperator ?? 'eq',
        e.sortOrder ?? 0,
        e.createdAt ?? now,
      );
    }

    // Re-mark as validated
    db.prepare('UPDATE orchestrators SET dag_validated = 1 WHERE id = ?').run(orchestratorId);
  });

  txn();
  return true;
}
