/** @module shared/task-agent-resolver — Resolves agent config for standalone task execution. */

import type { ToolName } from '../config.js';
import type { AiAgent } from '../orchestrator/types.js';
import type { SkillRef } from '../skills/catalog.js';
import type { AgentStore } from '../store/agent-store.js';

export interface ResolvedTaskAgent {
  tool: ToolName;
  model: string | null;
  allowMcp: boolean;
  enabledSkills: SkillRef[] | null;
  enabledMcpServerIds: string[] | null;
  instructionFile: string | null;
}

/**
 * Resolve agent configuration for a standalone task (schedule / on-demand / triggered).
 *
 * When `agentId` references a valid agent, its tool, model, allowMcp, and enabledSkills take
 * precedence over the task's own values, and the agent's systemInstruction is prepended
 * to the task's instructionFile.
 *
 * Model resolution: task.model takes priority over agent.model.
 *
 * Falls back to `taskDefaults` when the agent is missing (deleted or null).
 */
export function resolveTaskAgent(
  agentStore: AgentStore | undefined,
  agentId: string | null,
  taskDefaults: {
    tool: ToolName;
    model: string | null;
    allowMcp: boolean;
    enabledSkills: SkillRef[] | null;
    instructionFile: string | null;
  },
): ResolvedTaskAgent {
  if (!agentId || !agentStore)
    return { ...taskDefaults, enabledMcpServerIds: null };

  const agent: AiAgent | null = agentStore.getById(agentId);
  if (!agent)
    return { ...taskDefaults, enabledMcpServerIds: null }; // agent deleted → fallback

  return {
    tool: agent.tool,
    model: taskDefaults.model ?? agent.model ?? null,
    allowMcp: agent.allowMcp,
    enabledSkills: agent.enabledSkills,
    enabledMcpServerIds: agent.enabledMcpServerIds,
    instructionFile: mergeInstruction(agent.systemInstruction, taskDefaults.instructionFile),
  };
}

/** Concatenate agent system instruction with task instruction (both optional). */
function mergeInstruction(
  agentInstruction: string | null,
  taskInstruction: string | null,
): string | null {
  if (!agentInstruction && !taskInstruction) return null;
  if (!agentInstruction) return taskInstruction;
  if (!taskInstruction) return agentInstruction;
  return `${agentInstruction}\n\n${taskInstruction}`;
}
