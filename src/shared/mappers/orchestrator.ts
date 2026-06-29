/** @module orchestrator — Row-to-domain mappers for Orchestrator, Node, and Edge entities */

import { type ToolName, isToolName } from '../../config.js';
import { ORCHESTRATOR_DEFAULTS } from '../../orchestrator/orchestrator-limits.js';
import type {
  AiAgent,
  ConditionOperator,
  ErrorPolicy,
  GateCondition,
  NodeType,
  Orchestrator,
  OrchestratorEdge,
  OrchestratorNode,
  OrchestratorStatus,
  OutputMode,
  ReturnCondition,
  ScheduleType,
  TriggerMode,
  TriggeredNodeConfig,
} from '../../orchestrator/types.js';
import type { Mode } from '../../session/types.js';
import { parseStoredSkillRefs } from '../../skills/skill-refs.js';
import { boolFromDb } from '../../store/store-utils.js';
import { resolveTimezone } from '../../utils/timezone.js';
import { num, parseJson, str } from './helpers.js';

/* ── Orchestrator ── */

export function mapOrchestrator(r: object): Orchestrator {
  const row = r as Record<string, unknown>;
  const rawSummaryTool = str(row.summary_tool);
  const startNodeId = str(row.start_node_id);
  if (!startNodeId) {
    throw new Error(`Orchestrator ${String(row.id ?? 'unknown')} is missing start_node_id`);
  }
  return {
    id: row.id as string,
    name: row.name as string,
    alias: str(row.alias),
    description: str(row.description),
    userId: row.user_id as string,
    workdir: str(row.workdir),
    startNodeId,
    triggerMode: (str(row.trigger_mode) ?? 'ondemand') as TriggerMode,
    scheduleType: str(row.schedule_type) as ScheduleType | null,
    runAt: str(row.run_at),
    cronExpr: str(row.cron_expr),
    timezone: resolveTimezone(str(row.timezone)),
    notifyChannel: str(row.notify_channel),
    maxParallelism: num(row.max_parallelism, ORCHESTRATOR_DEFAULTS.maxParallelism),
    maxTotalNodes: num(row.max_total_nodes, ORCHESTRATOR_DEFAULTS.maxTotalNodes),
    errorPolicy: (row.error_policy ?? ORCHESTRATOR_DEFAULTS.errorPolicy) as ErrorPolicy,
    timeoutSec: row.timeout_sec != null ? num(row.timeout_sec, 0) : null,
    instructionFile: str(row.instruction_file),
    enabledSkills: parseStoredSkillRefs(str(row.enabled_skills_json)).skillRefs,
    summaryEnabled: boolFromDb(row.summary_enabled),
    summaryTool: rawSummaryTool && isToolName(rawSummaryTool) ? rawSummaryTool : null,
    maxRunWorkdirs: num(row.max_run_workdirs, ORCHESTRATOR_DEFAULTS.maxRunWorkdirs),
    status: (row.status ?? 'active') as OrchestratorStatus,
    dagValidated: boolFromDb(row.dag_validated),
    lastRunAt: str(row.last_run_at),
    runCount: num(row.run_count, 0),
    nextRunAt: str(row.next_run_at),
    claimedAt: str(row.claimed_at),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/* ── Node ── */

export function mapNode(r: object): OrchestratorNode {
  const row = r as Record<string, unknown>;
  let gateCondition: GateCondition | null = null;
  if (row.gate_condition) {
    const raw = parseJson<Record<string, unknown>>(row.gate_condition as string);
    if (raw) {
      const mode =
        typeof raw.mode === 'string' && raw.mode === 'or' ? ('or' as const) : ('and' as const);
      const matchValue = typeof raw.matchValue === 'string' ? raw.matchValue : 'done';
      gateCondition = { mode, matchValue };
    }
  }

  const parsedReturnValues = parseJson<string[]>(row.return_values as string);

  // Auto-inject system-managed return values (immutable — no mutation of parsed input)
  let returnValues: string[] | null = parsedReturnValues;
  if (parsedReturnValues) {
    const systemValues: string[] = [];
    if (!parsedReturnValues.includes('other_return')) systemValues.push('other_return');
    if (!parsedReturnValues.includes('error_return')) systemValues.push('error_return');
    returnValues =
      systemValues.length > 0 ? [...parsedReturnValues, ...systemValues] : parsedReturnValues;
  }

  const returnConditions = parseJson<ReturnCondition[]>(row.return_conditions as string);
  const triggeredConfig = parseJson<TriggeredNodeConfig>(row.triggered_config_json as string);
  const enabledMcpServerIds = parseJson<string[]>(row.enabled_mcp_server_ids as string);

  return {
    id: row.id as string,
    orchestratorId: row.orchestrator_id as string,
    label: row.label as string,
    nodeType: (row.node_type ?? 'task') as NodeType,
    agentId: str(row.agent_id),
    tool: (row.tool ?? null) as ToolName | null,
    model: str(row.model),
    // @reserved — currently always 'write'; retained for future readonly support
    mode: (row.mode ?? 'write') as Mode,
    prompt: str(row.prompt),
    maxRetries: num(row.max_retries, 0),
    timeoutSec: row.timeout_sec != null ? num(row.timeout_sec, 0) : null,
    allowMcp: boolFromDb(row.allow_mcp),
    enabledMcpServerIds:
      Array.isArray(enabledMcpServerIds) && enabledMcpServerIds.length > 0
        ? enabledMcpServerIds
        : null,
    workdir: str(row.workdir),
    writeInstructionFile:
      row.write_instruction_file == null ? true : boolFromDb(row.write_instruction_file),
    instructionFile: str(row.instruction_file),
    outputMode: (row.output_mode ?? 'auto') as OutputMode,
    returnConditions,
    returnValues,
    gateCondition,
    triggeredConfig,
    notifyEnabled: boolFromDb(row.notify_enabled),
    notifyChannel: str(row.notify_channel),
    notifyOnError: boolFromDb(row.notify_on_error),
    positionX: num(row.position_x, 0),
    positionY: num(row.position_y, 0),
    sortOrder: num(row.sort_order, 0),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/* ── AI Agent ── */

export function mapAiAgent(r: object): AiAgent {
  const row = r as Record<string, unknown>;
  const rawTool = str(row.tool);
  return {
    id: row.id as string,
    name: row.name as string,
    description: str(row.description),
    tool: rawTool && isToolName(rawTool) ? rawTool : 'claude',
    model: str(row.model),
    systemInstruction: str(row.system_instruction),
    enabledSkills: parseStoredSkillRefs(str(row.enabled_skills_json)).skillRefs,
    enabledMcpServerIds: parseJson<string[]>(row.enabled_mcp_server_ids),
    allowMcp: boolFromDb(row.allow_mcp),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/* ── Edge ── */

export function mapEdge(r: object): OrchestratorEdge {
  const row = r as Record<string, unknown>;
  return {
    id: row.id as string,
    orchestratorId: row.orchestrator_id as string,
    fromNodeId: row.from_node_id as string,
    toNodeId: row.to_node_id as string,
    conditionValue: str(row.condition_value),
    conditionOperator: (row.condition_operator ?? 'eq') as ConditionOperator,
    sortOrder: num(row.sort_order, 0),
    createdAt: row.created_at as string,
  };
}
