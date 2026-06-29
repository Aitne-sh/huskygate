/** @module ondemand-task — Row-to-domain mappers for OndemandTask and OndemandTaskRun */

import type { ToolName } from '../../config.js';
import type { Mode } from '../../session/types.js';
import { parseStoredSkillRefs } from '../../skills/skill-refs.js';
import type {
  OndemandRunStatus,
  OndemandTask,
  OndemandTaskRun,
  OndemandTaskStatus,
} from '../../store/ondemand-task.js';
import { boolFromDb } from '../../store/store-utils.js';
import { num, str } from './helpers.js';

/* ── Task ── */

export function mapOndemandTask(r: object): OndemandTask {
  const row = r as Record<string, unknown>;
  return {
    id: row.id as string,
    name: row.name as string,
    alias: str(row.alias),
    description: str(row.description),
    userId: row.user_id as string,
    tool: (row.tool ?? 'claude') as ToolName,
    model: str(row.model),
    mode: (row.mode ?? 'write') as Mode,
    prompt: row.prompt as string,
    workdir: str(row.workdir),
    maxRetries: num(row.max_retries, 0),
    allowMcp: boolFromDb(row.allow_mcp),
    enabledSkills: parseStoredSkillRefs(str(row.enabled_skills_json)).skillRefs,
    instructionFile: str(row.instruction_file),
    agentId: str(row.agent_id),
    notifyChannel: str(row.notify_channel),
    notifyThread: str(row.notify_thread),
    status: (row.status ?? 'active') as OndemandTaskStatus,
    runCount: num(row.run_count, 0),
    lastRunAt: str(row.last_run_at),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/* ── Run ── */

export function mapOndemandTaskRun(r: object): OndemandTaskRun {
  const row = r as Record<string, unknown>;
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    sessionKey: row.session_key as string,
    status: (row.status ?? 'pending') as OndemandRunStatus,
    exitCode: row.exit_code != null ? num(row.exit_code, 0) : null,
    outputSummary: str(row.output_summary),
    errorMessage: str(row.error_message),
    startedAt: row.started_at as string,
    endedAt: str(row.ended_at),
    retryCount: num(row.retry_count, 0),
    source: (row.source ?? 'dashboard') as string,
  };
}
