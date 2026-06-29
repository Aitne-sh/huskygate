/** @module types-patch — Partial update shapes for orchestrator, node, run, and node-run store mutations */
/**
 * Task Orchestrator — Typed Patch Interfaces
 *
 * Partial update shapes for store .update() methods and API request bodies.
 */

import type {
  OrchestrationNodeRun,
  OrchestrationRun,
  Orchestrator,
  OrchestratorNode,
} from './types.js';

export type OrchestratorPatch = Partial<
  Pick<
    Orchestrator,
    | 'name'
    | 'alias'
    | 'description'
    | 'userId'
    | 'workdir'
    | 'scheduleType'
    | 'runAt'
    | 'cronExpr'
    | 'timezone'
    | 'notifyChannel'
    | 'maxParallelism'
    | 'maxTotalNodes'
    | 'errorPolicy'
    | 'timeoutSec'
    | 'instructionFile'
    | 'enabledSkills'
    | 'summaryEnabled'
    | 'summaryTool'
    | 'maxRunWorkdirs'
    | 'status'
    | 'dagValidated'
    | 'lastRunAt'
    | 'runCount'
    | 'nextRunAt'
    | 'claimedAt'
  >
>;

export type NodePatch = Partial<
  Pick<
    OrchestratorNode,
    | 'label'
    | 'nodeType'
    | 'agentId'
    | 'tool'
    | 'model'
    | 'prompt'
    | 'maxRetries'
    | 'timeoutSec'
    | 'allowMcp'
    | 'enabledMcpServerIds'
    | 'workdir'
    | 'writeInstructionFile'
    | 'instructionFile'
    | 'outputMode'
    | 'returnConditions'
    | 'returnValues'
    | 'gateCondition'
    | 'triggeredConfig'
    | 'notifyEnabled'
    | 'notifyChannel'
    | 'notifyOnError'
    | 'positionX'
    | 'positionY'
    | 'sortOrder'
  >
>;

export type RunPatch = Partial<
  Pick<OrchestrationRun, 'status' | 'startedAt' | 'endedAt' | 'errorMessage'>
>;

export type NodeRunPatch = Partial<
  Pick<
    OrchestrationNodeRun,
    | 'status'
    | 'prompt'
    | 'jobId'
    | 'sessionKey'
    | 'returnValue'
    | 'exitCode'
    | 'outputSummary'
    | 'outputFull'
    | 'errorMessage'
    | 'gateEvaluation'
    | 'retryCount'
    | 'startedAt'
    | 'endedAt'
  >
>;
