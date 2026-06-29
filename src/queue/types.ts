/** @module queue/types — Job definitions, execution policies, and skill configuration for the task queue. */
import type { ToolName } from '../config.js';
import type { RunTrigger } from '../orchestrator/types.js';
import type { Mode, ToolState } from '../session/types.js';
import type { SkillCatalogEntry, SkillRef } from '../skills/catalog.js';
import { validateRequestedSkillRefs } from '../skills/skill-refs.js';

/**
 * Superset of RunTrigger — includes job-specific sources beyond the
 * orchestrator-level trigger origins (e.g. assistant, ondemand-task).
 */
export type JobSource =
  | RunTrigger
  | 'assistant'
  | 'ondemand-task'
  | 'triggered-task'
  | 'orchestrator'
  | 'orchestrator-summary';

/**
 * Validate and parse an `enabledSkills` value from a request body.
 * Returns { skills, error } — if error is set, respond 400.
 * A null/undefined input returns null (inherit global).
 */
export function parseEnabledSkills(raw: unknown): {
  skills: SkillRef[] | null;
  error?: string;
};
export function parseEnabledSkills(
  raw: unknown,
  catalogEntries: readonly SkillCatalogEntry[],
  fieldName?: string,
): {
  skills: SkillRef[] | null;
  error?: string;
};
export function parseEnabledSkills(
  raw: unknown,
  catalogEntries?: readonly SkillCatalogEntry[],
  fieldName = 'enabled_skills',
): {
  skills: SkillRef[] | null;
  error?: string;
} {
  if (!catalogEntries) {
    if (raw === undefined || raw === null) return { skills: null };
    return { skills: null, error: `${fieldName} validation requires a skill catalog` };
  }
  const result = validateRequestedSkillRefs(raw, catalogEntries, fieldName);
  return {
    skills: result.skillRefs,
    error: result.error,
  };
}

/**
 * Normalize `allowMcp` from a request body field.
 * - undefined/null → returns `defaultValue` (backward compat: existing tasks allow MCP)
 * - boolean → used as-is
 * - number → 0 is false, everything else is true
 * - string → "false", "0", "no", "" → false; everything else → true
 */
export function normalizeBool(raw: unknown, defaultValue = true): boolean {
  if (raw === undefined || raw === null) return defaultValue;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const lower = raw.trim().toLowerCase();
    return lower !== '' && lower !== 'false' && lower !== '0' && lower !== 'no';
  }
  return Boolean(raw);
}

/**
 * Per-task execution policy controlling MCP access and skill availability.
 *
 * - `allowMcp`: whether MCP tools are permitted (driver glob injection + approval flow)
 * - `enabledSkills`: explicit list of skills to seed, or null to inherit global settings
 */
export interface TaskExecutionPolicy {
  allowMcp: boolean;
  enabledSkills: SkillRef[] | null;
  enabledMcpServerIds?: string[] | null;
}

/** A unit of work to be executed by a driver within a session context. */
export interface Job {
  id: string;
  sessionKey: string;
  channelId: string;
  threadTs: string;
  userId: string;
  tool: ToolName;
  mode: Mode;
  prompt: string;
  workdir: string;
  toolState: ToolState;
  toolStateOverrides?: ToolState;
  createdAt: number;
  source?: JobSource;
  /** Linked scheduled task ID (set when source='schedule') */
  scheduleTaskId?: string;
  /** Linked scheduled task run ID (set when source='schedule') */
  scheduleRunId?: string;
  /** Linked on-demand task ID (set when source='ondemand-task') */
  ondemandTaskId?: string;
  /** Linked on-demand task run ID (set when source='ondemand-task') */
  ondemandTaskRunId?: string;
  /** Linked triggered task ID (set when source='triggered-task') */
  triggeredTaskId?: string;
  /** Linked triggered task run ID (set when source='triggered-task') */
  triggeredTaskRunId?: string;
  /** Linked orchestration run ID (set when source='orchestrator') */
  orchestrationRunId?: string;
  /** Linked orchestrator node ID (set when source='orchestrator') */
  orchestrationNodeId?: string;
  /** Slack channel ID where the orchestrator summary should be posted */
  summaryNotifyChannel?: string;
  /** Slack thread timestamp where the orchestrator summary should be posted */
  summaryNotifyThreadTs?: string;
  /** When true, tool approval requests are auto-approved */
  autoApprove?: boolean;
  /** Per-node timeout override (seconds). When set, overrides global maxRuntimeSec. */
  timeoutSec?: number | null;
  /** Per-task execution policy (MCP access + skill selection). Set by task sources. */
  executionPolicy?: TaskExecutionPolicy;
  /** Custom instruction content from task definitions (schedule/ondemand). */
  instructionFile?: string | null;
  /** When true, do not auto-write a tool instruction file into the workdir. */
  skipInstructionFile?: boolean;
  /** Fully-rendered instruction content that replaces the generated instruction file. */
  instructionOverride?: string | null;
}
