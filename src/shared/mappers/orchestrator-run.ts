/** @module orchestrator-run — Row-to-domain mappers for OrchestrationRun and OrchestrationNodeRun */

import type {
  NodeRunStatus,
  OrchestrationNodeRun,
  OrchestrationRun,
  RunTrigger,
} from '../../orchestrator/types.js';
import { num, str } from './helpers.js';

/* ── Run ── */

export function mapRun(r: object): OrchestrationRun {
  const row = r as Record<string, unknown>;
  return {
    id: row.id as string,
    orchestratorId: row.orchestrator_id as string,
    status: (row.status ?? 'pending') as OrchestrationRun['status'],
    triggeredBy: (row.triggered_by ?? 'dashboard') as RunTrigger,
    triggeredUserId: str(row.triggered_user_id),
    triggerContextJson: str(row.trigger_context_json),
    startedAt: str(row.started_at),
    endedAt: str(row.ended_at),
    errorMessage: str(row.error_message),
    rerunFromRunId: str(row.rerun_from_run_id),
    rerunFromNodeId: str(row.rerun_from_node_id),
    createdAt: row.created_at as string,
  };
}

/* ── NodeRun ── */

export function mapNodeRun(r: object): OrchestrationNodeRun {
  const row = r as Record<string, unknown>;
  return {
    id: row.id as string,
    orchestrationRunId: row.orchestration_run_id as string,
    nodeId: row.node_id as string,
    jobId: str(row.job_id),
    sessionKey: str(row.session_key),
    status: (row.status ?? 'pending') as NodeRunStatus,
    prompt: str(row.prompt),
    returnValue: str(row.return_value),
    exitCode: row.exit_code != null ? num(row.exit_code, 0) : null,
    outputSummary: str(row.output_summary),
    outputFull: str(row.output_full),
    errorMessage: str(row.error_message),
    gateEvaluation: str(row.gate_evaluation),
    retryCount: num(row.retry_count, 0),
    startedAt: str(row.started_at),
    endedAt: str(row.ended_at),
  };
}
