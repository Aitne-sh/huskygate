/** @module orchestrator-run — CRUD operations for orchestration runs and node runs */
/**
 * OrchestratorRunStore — Run CRUD + NodeRun CRUD.
 *
 * Extracted from OrchestratorStore (Phase 2 split).
 */

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { NodeRunRow, RunRow } from '../orchestrator/types-db.js';
import type { NodeRunPatch, RunPatch } from '../orchestrator/types-patch.js';
import type {
  CreateOrchestrationNodeRun,
  CreateOrchestrationRun,
  OrchestrationNodeRun,
  OrchestrationRun,
} from '../orchestrator/types.js';
import { mapNodeRun as toNodeRun, mapRun as toRun } from '../shared/mappers/orchestrator-run.js';
import { offloadRunOutputs, resolveStoredOutputFull } from './orchestrator-archive.js';
import { buildDynamicUpdate } from './store-utils.js';

interface NodeRunStorageRow extends NodeRunRow {
  output_path?: string | null;
  output_bytes?: number | null;
  output_sha256?: string | null;
}

// ─── Run Store Class ───────────────────────────────────────────

export class OrchestratorRunStore {
  constructor(
    private readonly db: Database.Database,
    private readonly dataDir?: string,
  ) {}

  // ── Run Management ─────────────────────────────────────────

  createRun(input: CreateOrchestrationRun): OrchestrationRun {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO orchestration_runs (
          id, orchestrator_id, status, triggered_by, triggered_user_id,
          trigger_context_json, started_at, rerun_from_run_id, rerun_from_node_id, created_at
        ) VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.orchestratorId,
        input.triggeredBy,
        input.triggeredUserId ?? null,
        input.triggerContextJson ?? null,
        now,
        input.rerunFromRunId ?? null,
        input.rerunFromNodeId ?? null,
        now,
      );

    const created = this.getRunById(id);
    if (!created) throw new Error(`Failed to create orchestration run (id=${id})`);
    return created;
  }

  getRunById(runId: string): OrchestrationRun | null {
    const row = this.db.prepare('SELECT * FROM orchestration_runs WHERE id = ?').get(runId) as
      | RunRow
      | undefined;
    return row ? toRun(row) : null;
  }

  getRunsByOrchestrator(orchestratorId: string, limit = 20): OrchestrationRun[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM orchestration_runs WHERE orchestrator_id = ? ORDER BY created_at DESC LIMIT ?',
      )
      .all(orchestratorId, limit) as RunRow[];
    return rows.map(toRun);
  }

  updateRun(runId: string, patch: RunPatch): void {
    const result = buildDynamicUpdate(patch as Record<string, unknown>, {
      fieldMap: {
        status: 'status',
        startedAt: 'started_at',
        endedAt: 'ended_at',
        errorMessage: 'error_message',
      },
      autoTimestamp: false,
    });
    if (!result) return;

    result.params.push(runId);
    this.db
      .prepare(`UPDATE orchestration_runs SET ${result.sets.join(', ')} WHERE id = ?`)
      .run(...result.params);
  }

  /**
   * Get completed/terminated run IDs for an orchestrator, ordered by created_at DESC.
   * Excludes 'running' and 'pending' runs to prevent workdir deletion for active runs.
   * Used for workdir cleanup.
   */
  getCompletedRunIds(orchestratorId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM orchestration_runs
         WHERE orchestrator_id = ? AND status IN ('completed', 'failed', 'cancelled')
         ORDER BY created_at DESC`,
      )
      .all(orchestratorId) as { id: string }[];
    return rows.map((r) => r.id);
  }

  /** Get ALL run IDs for an orchestrator (including running), ordered by created_at DESC. */
  getAllRunIds(orchestratorId: string): string[] {
    const rows = this.db
      .prepare(
        'SELECT id FROM orchestration_runs WHERE orchestrator_id = ? ORDER BY created_at DESC',
      )
      .all(orchestratorId) as { id: string }[];
    return rows.map((r) => r.id);
  }

  getRunningRuns(): OrchestrationRun[] {
    const rows = this.db
      .prepare("SELECT * FROM orchestration_runs WHERE status = 'running'")
      .all() as RunRow[];
    return rows.map(toRun);
  }

  // ── Node Run Management ────────────────────────────────────

  createNodeRun(input: CreateOrchestrationNodeRun): OrchestrationNodeRun {
    const id = crypto.randomUUID();

    this.db
      .prepare(
        `INSERT INTO orchestration_node_runs (
          id, orchestration_run_id, node_id, job_id, session_key,
          status, prompt, return_value, exit_code, output_summary, output_full,
          error_message, gate_evaluation, retry_count, started_at, ended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.orchestrationRunId,
        input.nodeId,
        input.jobId ?? null,
        input.sessionKey ?? null,
        input.status ?? 'pending',
        input.prompt ?? null,
        input.returnValue ?? null,
        input.exitCode ?? null,
        input.outputSummary ?? null,
        input.outputFull ?? null,
        input.errorMessage ?? null,
        input.gateEvaluation ?? null,
        input.retryCount ?? 0,
        input.startedAt ?? null,
        input.endedAt ?? null,
      );

    const created = this.getNodeRunById(id);
    if (!created) throw new Error(`Failed to create orchestration node run (id=${id})`);
    return created;
  }

  getNodeRunById(nodeRunId: string): OrchestrationNodeRun | null {
    const row = this.db
      .prepare('SELECT * FROM orchestration_node_runs WHERE id = ?')
      .get(nodeRunId) as NodeRunStorageRow | undefined;
    return row ? this.hydrateNodeRun(row) : null;
  }

  getNodeRunsByRun(runId: string): OrchestrationNodeRun[] {
    const rows = this.db
      .prepare('SELECT * FROM orchestration_node_runs WHERE orchestration_run_id = ?')
      .all(runId) as NodeRunStorageRow[];
    return rows.map((row) => this.hydrateNodeRun(row));
  }

  getNodeRunByJobId(jobId: string): OrchestrationNodeRun | null {
    const row = this.db
      .prepare('SELECT * FROM orchestration_node_runs WHERE job_id = ?')
      .get(jobId) as NodeRunStorageRow | undefined;
    return row ? this.hydrateNodeRun(row) : null;
  }

  updateNodeRun(nodeRunId: string, patch: NodeRunPatch): void {
    const result = buildDynamicUpdate(patch as Record<string, unknown>, {
      fieldMap: {
        status: 'status',
        prompt: 'prompt',
        jobId: 'job_id',
        sessionKey: 'session_key',
        returnValue: 'return_value',
        exitCode: 'exit_code',
        outputSummary: 'output_summary',
        outputFull: 'output_full',
        errorMessage: 'error_message',
        gateEvaluation: 'gate_evaluation',
        retryCount: 'retry_count',
        startedAt: 'started_at',
        endedAt: 'ended_at',
      },
      autoTimestamp: false,
    });
    if (!result) return;

    result.params.push(nodeRunId);
    this.db
      .prepare(`UPDATE orchestration_node_runs SET ${result.sets.join(', ')} WHERE id = ?`)
      .run(...result.params);
  }

  offloadRunOutputs(runId: string): { offloadedCount: number; errors: string[] } {
    if (!this.dataDir) {
      return {
        offloadedCount: 0,
        errors: ['dataDir is not configured for OrchestratorRunStore'],
      };
    }
    return offloadRunOutputs(this.db, this.dataDir, runId);
  }

  private hydrateNodeRun(row: NodeRunStorageRow): OrchestrationNodeRun {
    const nodeRun = toNodeRun(row);
    if (nodeRun.outputFull === null) {
      nodeRun.outputFull = resolveStoredOutputFull(this.dataDir, row);
    }
    return nodeRun;
  }
}
