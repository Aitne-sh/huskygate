/** @module types — Orchestrator domain types: DAG nodes, edges, runs, and validation results. */

import type { ToolName } from '../config.js';
import type { Mode } from '../session/types.js';
import type { SkillRef } from '../skills/catalog.js';

// ─── Status types (canonical source: ../shared/status.ts) ────
export type {
  OrchestratorStatus,
  OrchestrationRunStatus,
  NodeRunStatus,
} from '../shared/status.js';
import type {
  NodeRunStatus,
  OrchestrationRunStatus,
  OrchestratorStatus,
} from '../shared/status.js';

// ─── Orchestrator ────────────────────────────────────────────
export type ScheduleType = 'once' | 'recurring';
export type ErrorPolicy = 'fail_fast' | 'continue';
export type TriggerMode = 'ondemand' | 'webhook';

export interface Orchestrator {
  id: string;
  name: string;
  alias: string | null;
  description: string | null;
  userId: string;
  workdir: string | null;
  startNodeId: string;

  /** How the orchestrator is triggered: 'ondemand' (manual/schedule) or 'webhook' (event-driven). */
  triggerMode: TriggerMode;

  // Schedule
  scheduleType: ScheduleType | null;
  runAt: string | null;
  cronExpr: string | null;
  timezone: string;

  // Notification
  notifyChannel: string | null;

  // Execution control
  maxParallelism: number;
  maxTotalNodes: number;
  errorPolicy: ErrorPolicy;
  timeoutSec: number | null;
  instructionFile: string | null;

  // Housekeeping
  /** Max run workdirs to keep per orchestrator (0 = delete immediately after run). Default 20. */
  maxRunWorkdirs: number;

  // Execution policy (shared by all nodes in a run)
  enabledSkills: SkillRef[] | null;

  // Task Summary
  summaryEnabled: boolean;
  summaryTool: ToolName | null;

  // State
  status: OrchestratorStatus;
  dagValidated: boolean;
  lastRunAt: string | null;
  runCount: number;
  nextRunAt: string | null;
  claimedAt: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface CreateOrchestrator {
  name: string;
  alias?: string | null;
  description?: string | null;
  userId?: string;
  workdir?: string | null;
  triggerMode?: TriggerMode;
  scheduleType?: ScheduleType | null;
  runAt?: string | null;
  cronExpr?: string | null;
  timezone?: string;
  notifyChannel?: string | null;
  maxParallelism?: number;
  maxTotalNodes?: number;
  errorPolicy?: ErrorPolicy;
  timeoutSec?: number | null;
  instructionFile?: string | null;
  enabledSkills?: SkillRef[] | null;
  summaryEnabled?: boolean;
  summaryTool?: ToolName | null;
  nextRunAt?: string | null;
  maxRunWorkdirs?: number;
}

// ─── AI Agent ─────────────────────────────────────────────────

export interface AiAgent {
  id: string;
  name: string;
  description: string | null;
  tool: ToolName;
  model: string | null;
  systemInstruction: string | null;
  enabledSkills: SkillRef[] | null;
  enabledMcpServerIds: string[] | null;
  allowMcp: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAiAgent {
  name: string;
  description?: string | null;
  tool: ToolName;
  model?: string | null;
  systemInstruction?: string | null;
  enabledSkills?: SkillRef[] | null;
  enabledMcpServerIds?: string[] | null;
  allowMcp?: boolean;
}

export type AiAgentPatch = Partial<
  Pick<
    AiAgent,
    | 'name'
    | 'description'
    | 'tool'
    | 'model'
    | 'systemInstruction'
    | 'enabledSkills'
    | 'enabledMcpServerIds'
    | 'allowMcp'
  >
>;

// ─── Node ────────────────────────────────────────────────────

export type NodeType = 'task' | 'triggered' | 'gate' | 'end';

export type OutputMode = 'auto' | 'manual';

export interface TriggeredNodeConfig {
  waitTimeoutSec: number;
  onTimeout: 'fail' | 'skip';
}

export interface ReturnCondition {
  /** Pattern matched against CLI output to determine the return value. */
  condition: string;
  /** Return value emitted when condition matches. */
  value: string;
}

export interface OrchestratorNode {
  id: string;
  orchestratorId: string;
  label: string;

  nodeType: NodeType;
  agentId: string | null;
  tool: ToolName | null;
  model: string | null;
  /**
   * Execution mode for the node.
   * Currently enforced as 'write' for all nodes.
   * @reserved Future: may support 'read' for readonly/analysis nodes.
   */
  mode: Mode;
  prompt: string | null;
  maxRetries: number;
  timeoutSec: number | null;
  allowMcp: boolean;
  enabledMcpServerIds: string[] | null;
  workdir: string | null;
  writeInstructionFile: boolean;
  instructionFile: string | null;

  // Output control
  outputMode: OutputMode;
  returnConditions: ReturnCondition[] | null;

  // Output port definitions (e.g. ["success", "error"])
  returnValues: string[] | null;

  // Gate
  gateCondition: GateCondition | null;
  triggeredConfig: TriggeredNodeConfig | null;

  // Notification
  notifyEnabled: boolean;
  notifyChannel: string | null;
  notifyOnError: boolean;

  // UI layout
  positionX: number;
  positionY: number;

  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrchestratorNode {
  orchestratorId: string;
  label: string;
  nodeType?: NodeType;
  agentId?: string | null;
  tool?: ToolName | null;
  model?: string | null;
  prompt?: string | null;
  maxRetries?: number;
  timeoutSec?: number | null;
  allowMcp?: boolean;
  enabledMcpServerIds?: string[] | null;
  workdir?: string | null;
  writeInstructionFile?: boolean;
  instructionFile?: string | null;
  outputMode?: OutputMode;
  returnConditions?: ReturnCondition[] | null;
  returnValues?: string[] | null;
  gateCondition?: GateCondition | null;
  triggeredConfig?: TriggeredNodeConfig | null;
  notifyEnabled?: boolean;
  notifyChannel?: string | null;
  notifyOnError?: boolean;
  positionX?: number;
  positionY?: number;
  sortOrder?: number;
}

// ─── Gate Condition ──────────────────────────────────────────

export type GateMode = 'and' | 'or';
export type ConditionOperator = 'eq' | 'neq' | 'in' | 'regex';

export interface GateCondition {
  mode: GateMode;
  matchValue: string;
}

// ─── Edge ────────────────────────────────────────────────────

export interface OrchestratorEdge {
  id: string;
  orchestratorId: string;
  fromNodeId: string;
  toNodeId: string;
  conditionValue: string | null;
  conditionOperator: ConditionOperator;
  sortOrder: number;
  createdAt: string;
}

export interface CreateOrchestratorEdge {
  orchestratorId: string;
  fromNodeId: string;
  toNodeId: string;
  conditionValue?: string | null;
  conditionOperator?: ConditionOperator;
  sortOrder?: number;
}

// ─── Orchestration Run ───────────────────────────────────────

export type RunTrigger = 'dashboard' | 'slack' | 'schedule' | 'webhook' | 'chat' | 'polling';

export interface OrchestrationRun {
  id: string;
  orchestratorId: string;
  status: OrchestrationRunStatus;
  triggeredBy: RunTrigger;
  triggeredUserId: string | null;
  triggerContextJson: string | null;

  startedAt: string | null;
  endedAt: string | null;
  errorMessage: string | null;

  rerunFromRunId: string | null;
  rerunFromNodeId: string | null;

  createdAt: string;
}

export interface CreateOrchestrationRun {
  orchestratorId: string;
  triggeredBy: RunTrigger;
  triggeredUserId?: string | null;
  triggerContextJson?: string | null;
  rerunFromRunId?: string | null;
  rerunFromNodeId?: string | null;
}

// ─── Node Run ────────────────────────────────────────────────

export interface OrchestrationNodeRun {
  id: string;
  orchestrationRunId: string;
  nodeId: string;
  jobId: string | null;
  sessionKey: string | null;

  status: NodeRunStatus;
  prompt: string | null;
  returnValue: string | null;
  exitCode: number | null;
  outputSummary: string | null;
  outputFull: string | null;
  errorMessage: string | null;

  /** Serialized JSON of gate evaluation details (mode, matchValue, sources, result). */
  gateEvaluation: string | null;

  retryCount: number;

  startedAt: string | null;
  endedAt: string | null;
}

export interface CreateOrchestrationNodeRun {
  orchestrationRunId: string;
  nodeId: string;
  status?: NodeRunStatus;
  prompt?: string | null;
  jobId?: string | null;
  sessionKey?: string | null;
  returnValue?: string | null;
  exitCode?: number | null;
  outputSummary?: string | null;
  outputFull?: string | null;
  errorMessage?: string | null;
  gateEvaluation?: string | null;
  retryCount?: number;
  startedAt?: string | null;
  endedAt?: string | null;
}

// ─── DAG Validation ──────────────────────────────────────────

export type DAGValidationErrorCode =
  | 'CYCLE_DETECTED'
  | 'ORPHAN_NODE'
  | 'MISSING_EDGE_TARGET'
  | 'START_NODE_MISSING'
  | 'START_NODE_NOT_TASK'
  | 'START_NODE_HAS_INCOMING'
  | 'GATE_NO_MATCH_VALUE'
  | 'GATE_NO_INCOMING'
  | 'TASK_NO_TOOL'
  | 'TASK_NO_PROMPT'
  | 'TRIGGERED_CONFIG_REQUIRED'
  | 'TRIGGERED_TIMEOUT_INVALID'
  | 'TRIGGERED_ON_TIMEOUT_INVALID'
  | 'TRIGGERED_NO_SUBSCRIPTION'
  | 'WEBHOOK_TRIGGER_NO_SUBSCRIPTION'
  | 'TRIGGERED_CONFIG_FORBIDDEN'
  | 'MAX_NODES_EXCEEDED'
  | 'DUPLICATE_EDGE'
  | 'END_HAS_OUTGOING'
  | 'SELF_LOOP'
  | 'DISCONNECTED_PORT';

export type DAGValidationWarningCode = 'UNREACHABLE_EDGE' | 'NO_TERMINAL_NODE';

export interface DAGValidationError {
  code: DAGValidationErrorCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface DAGValidationWarning {
  code: DAGValidationWarningCode;
  message: string;
  nodeId?: string;
  detail?: string;
}

export interface DAGValidationResult {
  valid: boolean;
  errors: DAGValidationError[];
  warnings: DAGValidationWarning[];
  topologicalOrder: string[];
}

// ─── Validated DAG (runtime) ─────────────────────────────────

export interface ValidatedDAG {
  nodes: Map<string, OrchestratorNode>;
  edges: OrchestratorEdge[];
  /** Adjacency list: fromNodeId → edges leaving that node */
  outgoing: Map<string, OrchestratorEdge[]>;
  /** Reverse adjacency: toNodeId → edges entering that node */
  incoming: Map<string, OrchestratorEdge[]>;
  /** Root nodes (no incoming edges and not a gate) */
  roots: string[];
  /** Topological ordering of node IDs */
  topologicalOrder: string[];
}

// ─── Engine Runtime ──────────────────────────────────────────

export interface ActiveOrchestrationRun {
  runId: string;
  orchestrator: Orchestrator;
  dag: ValidatedDAG;
  nodeRuns: Map<string, OrchestrationNodeRun>;
  runningCount: number;
  startedAt: number;
  triggerContext: Record<string, unknown> | null;
  waitingTriggeredNodes: Map<string, ActiveTriggeredWaitState>;
  pendingTriggeredPayloads: Map<string, Record<string, unknown> | null>;
  timeoutTimer?: ReturnType<typeof setTimeout>;
}

/** In-memory state for a triggered node waiting for an event callback. */
export interface ActiveTriggeredWaitState {
  subscriptionId: string;
  /** Composite key `runId:nodeId` used to register/unregister the waiter. */
  waiterKey: string;
  unsubscribe: () => void;
  timer: ReturnType<typeof setTimeout>;
}

// ─── Re-exports: Patch types (canonical source: ./types-patch.ts) ────
export type { OrchestratorPatch, NodePatch, RunPatch, NodeRunPatch } from './types-patch.js';

// ─── Re-exports: DB Row types (canonical source: ./types-db.ts) ─────
export type { OrchestratorRow, NodeRow, EdgeRow, RunRow, NodeRunRow } from './types-db.js';
