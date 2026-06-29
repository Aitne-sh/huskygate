/** @module scheduled-task — Row-to-domain mappers for ScheduledTask and ScheduledTaskRun */

import type { ToolName } from '../../config.js';
import type { Mode } from '../../session/types.js';
import { parseStoredSkillRefs } from '../../skills/skill-refs.js';
import type {
  ScheduleType,
  ScheduledRunStatus,
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTaskStatus,
} from '../../store/schedule.js';
import { boolFromDb } from '../../store/store-utils.js';
import { resolveTimezone } from '../../utils/timezone.js';
import { num, str } from './helpers.js';

/* ── Task ── */

export function mapScheduledTask(r: object): ScheduledTask {
  const row = r as Record<string, unknown>;
  return {
    id: row.id as string,
    name: row.name as string,
    description: str(row.description),
    userId: row.user_id as string,
    tool: (row.tool ?? 'claude') as ToolName,
    model: str(row.model),
    mode: (row.mode ?? 'write') as Mode,
    prompt: row.prompt as string,
    workdir: str(row.workdir),
    scheduleType: (row.schedule_type ?? 'once') as ScheduleType,
    runAt: str(row.run_at),
    cronExpr: str(row.cron_expr),
    timezone: resolveTimezone(str(row.timezone)),
    notifyChannel: str(row.notify_channel),
    notifyThread: str(row.notify_thread),
    status: (row.status ?? 'active') as ScheduledTaskStatus,
    lastRunAt: str(row.last_run_at),
    nextRunAt: str(row.next_run_at),
    runCount: num(row.run_count, 0),
    maxRuns: row.max_runs != null ? num(row.max_runs, 0) : null,
    maxRetries: num(row.max_retries, 0),
    allowMcp: boolFromDb(row.allow_mcp),
    enabledSkills: parseStoredSkillRefs(str(row.enabled_skills_json)).skillRefs,
    instructionFile: str(row.instruction_file),
    agentId: str(row.agent_id),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/* ── Run ── */

export function mapScheduledTaskRun(r: object): ScheduledTaskRun {
  const row = r as Record<string, unknown>;
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    sessionKey: row.session_key as string,
    status: (row.status ?? 'pending') as ScheduledRunStatus,
    exitCode: row.exit_code != null ? num(row.exit_code, 0) : null,
    outputSummary: str(row.output_summary),
    errorMessage: str(row.error_message),
    startedAt: row.started_at as string,
    endedAt: str(row.ended_at),
    artifacts: str(row.artifacts),
    retryCount: num(row.retry_count, 0),
    source: (row.source ?? 'schedule') as string,
  };
}
