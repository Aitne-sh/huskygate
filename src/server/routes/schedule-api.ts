/** @module server/routes/schedule-api — Server API routes for scheduled task CRUD and execution. */
import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isToolName } from '../../config.js';
import type { AppContext } from '../../context/app-context.js';
import { ORCHESTRATOR_NODE_LIMIT_RANGES } from '../../orchestrator/orchestrator-limits.js';
import { type Job, normalizeBool, parseEnabledSkills } from '../../queue/types.js';
import { getNextCronRun, validateCronExpr } from '../../schedule/cron-utils.js';
import { FIELD_LIMITS } from '../../shared/field-limits.js';
import { json, parseUrl, readBody } from '../../shared/http.js';
import { normalizeModel } from '../../shared/normalize-model.js';
import { parseLimit } from '../../shared/pagination.js';
import {
  matchScheduleTaskExecute,
  matchScheduleTaskId,
  matchScheduleTaskRunDetail,
  matchScheduleTaskRuns,
} from '../../shared/route-matchers.js';
import { cleanupStandaloneSessionResources } from '../../shared/standalone-session-cleanup.js';
import { resolveTaskAgent } from '../../shared/task-agent-resolver.js';
import { discoverCatalogForSkillValidation } from '../../skills/skill-refs.js';
import type { CreateScheduledTask } from '../../store/schedule.js';
import { StaleUpdateError } from '../../store/store-utils.js';
import { errorMessage } from '../../utils/error.js';
import { logger } from '../../utils/logger.js';
import { resolveAndValidateTimezone } from '../../utils/timezone.js';
import {
  MAX_INSTRUCTION_FILE_LENGTH,
  isAllowedTaskUserId,
  resolvePatchedTaskUserId,
  resolveTaskUserId,
  validateCustomWorkdir,
} from './task-api-shared.js';

const VALID_LIST_STATUSES = new Set(['active', 'paused', 'completed']);

export function matchesScheduleApiPath(pathname: string): boolean {
  return pathname === '/api/schedules' || pathname.startsWith('/api/schedules/');
}

function ensureScheduleEnabled(ctx: AppContext, res: ServerResponse): boolean {
  if (ctx.config.scheduleEnabled) return true;
  json(res, 503, { error: 'Schedule feature is not enabled (set SCHEDULE_ENABLED=true)' });
  return false;
}

export async function handleScheduleApiRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const { query } = parseUrl(req.url);

  // POST /api/schedules — create scheduled task
  if (req.method === 'POST' && pathname === '/api/schedules') {
    if (!ensureScheduleEnabled(ctx, res)) return true;

    const body = await readBody(req);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }

    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '';
    const scheduleType = (parsed.scheduleType ?? parsed.schedule_type) as string;
    const tool = typeof parsed.tool === 'string' ? parsed.tool : 'claude';

    if (!name) {
      json(res, 400, { error: 'name is required' });
      return true;
    }
    if (name.length > FIELD_LIMITS.name.max) {
      json(res, 400, { error: `name must be <= ${FIELD_LIMITS.name.max} characters` });
      return true;
    }
    if (!prompt) {
      json(res, 400, { error: 'prompt is required' });
      return true;
    }
    if (prompt.length > FIELD_LIMITS.prompt.max) {
      json(res, 400, { error: `prompt must be <= ${FIELD_LIMITS.prompt.max} characters` });
      return true;
    }
    const description = typeof parsed.description === 'string' ? parsed.description.trim() : null;
    if (description !== null && description.length > FIELD_LIMITS.description.max) {
      json(res, 400, {
        error: `description must be <= ${FIELD_LIMITS.description.max} characters`,
      });
      return true;
    }
    if (scheduleType !== 'once' && scheduleType !== 'recurring') {
      json(res, 400, { error: 'scheduleType must be "once" or "recurring"' });
      return true;
    }
    if (!isToolName(tool)) {
      json(res, 400, { error: 'tool must be claude, codex, or gemini' });
      return true;
    }

    let model: string | null = null;
    try {
      model = normalizeModel(parsed.model);
    } catch (e) {
      json(res, 400, { error: (e as Error).message });
      return true;
    }

    let timezone: string;
    try {
      timezone = resolveAndValidateTimezone(
        typeof parsed.timezone === 'string' ? parsed.timezone : 'default',
      );
    } catch (err) {
      json(res, 400, { error: errorMessage(err) });
      return true;
    }

    const rawMaxRuns = parsed.maxRuns ?? parsed.max_runs;
    if (rawMaxRuns !== undefined && rawMaxRuns !== null) {
      if (typeof rawMaxRuns !== 'number' || !Number.isFinite(rawMaxRuns) || rawMaxRuns < 1) {
        json(res, 400, { error: 'maxRuns must be a positive integer' });
        return true;
      }
    }

    const rawMaxRetries = parsed.maxRetries ?? parsed.max_retries;
    if (rawMaxRetries !== undefined && rawMaxRetries !== null) {
      const { min, max } = ORCHESTRATOR_NODE_LIMIT_RANGES.maxRetries;
      if (
        typeof rawMaxRetries !== 'number' ||
        !Number.isFinite(rawMaxRetries) ||
        rawMaxRetries < min ||
        rawMaxRetries > max
      ) {
        json(res, 400, { error: `maxRetries must be an integer between ${min} and ${max}` });
        return true;
      }
    }

    let nextRunAt: string | null = null;

    const rawRunAt = (parsed.runAt ?? parsed.run_at) as string | undefined;
    const rawCronExpr = (parsed.cronExpr ?? parsed.cron_expr) as string | undefined;

    if (scheduleType === 'once') {
      const runAt = typeof rawRunAt === 'string' ? rawRunAt : '';
      if (!runAt) {
        json(res, 400, { error: 'runAt is required for once schedule' });
        return true;
      }
      const runDate = new Date(runAt);
      if (Number.isNaN(runDate.getTime())) {
        json(res, 400, { error: 'runAt must be a valid ISO 8601 date' });
        return true;
      }
      if (runDate.getTime() < Date.now() - 60_000) {
        json(res, 400, { error: 'runAt must be in the future' });
        return true;
      }
      nextRunAt = runDate.toISOString();
    } else {
      const cronExpr = typeof rawCronExpr === 'string' ? rawCronExpr.trim() : '';
      if (!cronExpr) {
        json(res, 400, { error: 'cronExpr is required for recurring schedule' });
        return true;
      }
      const cronError = validateCronExpr(cronExpr);
      if (cronError) {
        json(res, 400, { error: `Invalid cron expression: ${cronError}` });
        return true;
      }
      nextRunAt = getNextCronRun(cronExpr, timezone);
    }

    const rawNotifyChannel = (parsed.notifyChannel ?? parsed.notify_channel) as string | undefined;
    const notifyChannel =
      typeof rawNotifyChannel === 'string' && rawNotifyChannel.trim()
        ? rawNotifyChannel.trim()
        : ctx.config.scheduleDefaultNotifyChannel;
    if (!notifyChannel) {
      json(res, 400, {
        error: 'notifyChannel is required (or set SCHEDULE_DEFAULT_NOTIFY_CHANNEL)',
      });
      return true;
    }

    const rawEnabledSkills = parsed.enabledSkills ?? parsed.enabled_skills;
    const skillCatalog = discoverCatalogForSkillValidation(ctx.config, tool);
    const skillsResult = parseEnabledSkills(rawEnabledSkills, skillCatalog, 'enabledSkills');
    if (skillsResult.error) {
      json(res, 400, { error: skillsResult.error });
      return true;
    }

    const rawUserId = (parsed.userId ?? parsed.user_id) as string | undefined;
    const rawNotifyThread = (parsed.notifyThread ?? parsed.notify_thread) as string | undefined;
    const rawAllowMcp = parsed.allowMcp ?? parsed.allow_mcp;
    const rawInstructionFile = parsed.instructionFile ?? parsed.instruction_file;
    if (
      typeof rawInstructionFile === 'string' &&
      rawInstructionFile.length > MAX_INSTRUCTION_FILE_LENGTH
    ) {
      json(res, 400, {
        error: `instructionFile must be <= ${MAX_INSTRUCTION_FILE_LENGTH} characters`,
      });
      return true;
    }

    const rawAgentId = (parsed.agentId ?? parsed.agent_id) as string | undefined;
    if (typeof rawAgentId === 'string' && rawAgentId) {
      if (!ctx.agentStore.getById(rawAgentId)) {
        json(res, 400, { error: 'agentId not found' });
        return true;
      }
    }

    const resolvedUserId = resolveTaskUserId(
      typeof rawUserId === 'string' ? rawUserId : undefined,
      notifyChannel,
    );
    if (!isAllowedTaskUserId(ctx, resolvedUserId)) {
      json(res, 403, { error: 'user_id not in allowlist' });
      return true;
    }

    const input: CreateScheduledTask = {
      name,
      description: description || null,
      userId: resolvedUserId,
      tool,
      model,
      mode: 'write',
      prompt,
      workdir: null,
      scheduleType: scheduleType as 'once' | 'recurring',
      runAt: typeof rawRunAt === 'string' ? rawRunAt : null,
      cronExpr: typeof rawCronExpr === 'string' ? rawCronExpr.trim() : null,
      timezone,
      notifyChannel,
      notifyThread: typeof rawNotifyThread === 'string' ? rawNotifyThread : null,
      maxRuns: typeof rawMaxRuns === 'number' ? Math.floor(rawMaxRuns) : null,
      maxRetries: typeof rawMaxRetries === 'number' ? Math.floor(rawMaxRetries) : 0,
      allowMcp: normalizeBool(rawAllowMcp, false),
      enabledSkills: skillsResult.skills,
      instructionFile: typeof rawInstructionFile === 'string' ? rawInstructionFile : null,
      agentId: typeof rawAgentId === 'string' && rawAgentId ? rawAgentId : null,
      nextRunAt,
    };

    try {
      input.workdir = validateCustomWorkdir(ctx, parsed.workdir);
    } catch (err) {
      json(res, 400, { error: errorMessage(err) });
      return true;
    }

    const task = ctx.scheduleStore.create(input);
    json(res, 201, { ok: true, data: task });
    return true;
  }

  // GET /api/schedules — list scheduled tasks
  if (req.method === 'GET' && pathname === '/api/schedules') {
    if (!ensureScheduleEnabled(ctx, res)) return true;

    const rawStatus = query.get('status');
    const status =
      rawStatus && VALID_LIST_STATUSES.has(rawStatus)
        ? (rawStatus as 'active' | 'paused' | 'completed')
        : undefined;
    const userId = query.get('user_id') ?? undefined;
    const tasks = ctx.scheduleStore.list({ userId, status });
    json(res, 200, { ok: true, data: tasks });
    return true;
  }

  // GET /api/schedules/:id — get scheduled task detail
  const scheduleTaskId = matchScheduleTaskId(pathname);
  if (req.method === 'GET' && scheduleTaskId) {
    if (!ensureScheduleEnabled(ctx, res)) return true;

    const task = ctx.scheduleStore.getById(scheduleTaskId);
    if (!task || task.status === 'deleted') {
      json(res, 404, { error: 'Task not found' });
      return true;
    }
    const runs = ctx.scheduleStore.getRunsByTask(scheduleTaskId, 10);
    json(res, 200, { ok: true, data: { ...task, recentRuns: runs } });
    return true;
  }

  // PATCH /api/schedules/:id — update scheduled task
  if (req.method === 'PATCH' && scheduleTaskId) {
    if (!ensureScheduleEnabled(ctx, res)) return true;

    const task = ctx.scheduleStore.getById(scheduleTaskId);
    if (!task || task.status === 'deleted') {
      json(res, 404, { error: 'Task not found' });
      return true;
    }
    const body = await readBody(req);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }

    const patch: Record<string, unknown> = {};

    if (typeof parsed.name === 'string') {
      const name = parsed.name.trim();
      if (!name) {
        json(res, 400, { error: 'name must not be empty' });
        return true;
      }
      if (name.length > FIELD_LIMITS.name.max) {
        json(res, 400, { error: `name must be <= ${FIELD_LIMITS.name.max} characters` });
        return true;
      }
      patch.name = name;
    }
    if (typeof parsed.prompt === 'string') {
      const prompt = parsed.prompt.trim();
      if (!prompt) {
        json(res, 400, { error: 'prompt must not be empty' });
        return true;
      }
      if (prompt.length > FIELD_LIMITS.prompt.max) {
        json(res, 400, { error: `prompt must be <= ${FIELD_LIMITS.prompt.max} characters` });
        return true;
      }
      patch.prompt = prompt;
    }
    if ('description' in parsed) {
      if (parsed.description === null || parsed.description === '') {
        patch.description = null;
      } else if (typeof parsed.description === 'string') {
        const description = parsed.description.trim();
        if (description.length > FIELD_LIMITS.description.max) {
          json(res, 400, {
            error: `description must be <= ${FIELD_LIMITS.description.max} characters`,
          });
          return true;
        }
        patch.description = description || null;
      }
    }
    if (typeof parsed.tool === 'string' && isToolName(parsed.tool)) {
      patch.tool = parsed.tool;
    }
    if ('model' in parsed) {
      try {
        patch.model = normalizeModel(parsed.model);
      } catch (e) {
        json(res, 400, { error: (e as Error).message });
        return true;
      }
    }
    if (typeof parsed.timezone === 'string') {
      try {
        patch.timezone = resolveAndValidateTimezone(parsed.timezone);
      } catch (err) {
        json(res, 400, { error: errorMessage(err) });
        return true;
      }
    }

    const patchNotifyChannel = (parsed.notifyChannel ?? parsed.notify_channel) as
      | string
      | undefined;
    if (typeof patchNotifyChannel === 'string') {
      patch.notifyChannel = patchNotifyChannel.trim();
    }
    const resolvedPatchedUserId = resolvePatchedTaskUserId(parsed, task.notifyChannel);
    if (resolvedPatchedUserId !== undefined) {
      if (!isAllowedTaskUserId(ctx, resolvedPatchedUserId)) {
        json(res, 403, { error: 'user_id not in allowlist' });
        return true;
      }
      patch.userId = resolvedPatchedUserId;
    }
    const patchNotifyThread = (parsed.notifyThread ?? parsed.notify_thread) as string | undefined;
    if (typeof patchNotifyThread === 'string') {
      patch.notifyThread = patchNotifyThread.trim() || null;
    }
    if ('workdir' in parsed) {
      try {
        patch.workdir = validateCustomWorkdir(ctx, parsed.workdir);
      } catch (err) {
        json(res, 400, { error: errorMessage(err) });
        return true;
      }
    }

    const patchMaxRuns = parsed.maxRuns ?? parsed.max_runs;
    if (patchMaxRuns === null) {
      patch.maxRuns = null;
    } else if (typeof patchMaxRuns === 'number') {
      if (!Number.isFinite(patchMaxRuns) || patchMaxRuns < 1) {
        json(res, 400, { error: 'maxRuns must be a positive integer' });
        return true;
      }
      patch.maxRuns = Math.floor(patchMaxRuns);
    }

    const patchMaxRetries = parsed.maxRetries ?? parsed.max_retries;
    if (typeof patchMaxRetries === 'number') {
      const { min, max } = ORCHESTRATOR_NODE_LIMIT_RANGES.maxRetries;
      if (!Number.isFinite(patchMaxRetries) || patchMaxRetries < min || patchMaxRetries > max) {
        json(res, 400, { error: `maxRetries must be an integer between ${min} and ${max}` });
        return true;
      }
      patch.maxRetries = Math.floor(patchMaxRetries);
    }

    if ('allowMcp' in parsed || 'allow_mcp' in parsed) {
      patch.allowMcp = normalizeBool(parsed.allowMcp ?? parsed.allow_mcp, false);
    }
    if ('enabledSkills' in parsed || 'enabled_skills' in parsed) {
      const effectiveTool = (patch.tool ?? task.tool) as typeof task.tool;
      const skillCatalog = discoverCatalogForSkillValidation(ctx.config, effectiveTool);
      const enabledSkillsResult = parseEnabledSkills(
        parsed.enabledSkills ?? parsed.enabled_skills,
        skillCatalog,
        'enabledSkills',
      );
      if (enabledSkillsResult.error) {
        json(res, 400, { error: enabledSkillsResult.error });
        return true;
      }
      patch.enabledSkills = enabledSkillsResult.skills;
    }
    if ('instructionFile' in parsed || 'instruction_file' in parsed) {
      const rawInstruction = parsed.instructionFile ?? parsed.instruction_file;
      if (
        typeof rawInstruction === 'string' &&
        rawInstruction.length > MAX_INSTRUCTION_FILE_LENGTH
      ) {
        json(res, 400, {
          error: `instructionFile must be <= ${MAX_INSTRUCTION_FILE_LENGTH} characters`,
        });
        return true;
      }
      patch.instructionFile = typeof rawInstruction === 'string' ? rawInstruction : null;
    }
    if ('agentId' in parsed || 'agent_id' in parsed) {
      const agentId = (parsed.agentId ?? parsed.agent_id) as string | null;
      if (typeof agentId === 'string' && agentId) {
        if (!ctx.agentStore.getById(agentId)) {
          json(res, 400, { error: 'agentId not found' });
          return true;
        }
      }
      patch.agentId = typeof agentId === 'string' && agentId ? agentId : null;
    }

    if (parsed.status === 'paused' && task.status === 'active') {
      patch.status = 'paused';
    } else if (parsed.status === 'active' && task.status === 'paused') {
      patch.status = 'active';
      if (task.scheduleType === 'once' && task.runAt) {
        const runDate = new Date(task.runAt);
        patch.nextRunAt = runDate.getTime() > Date.now() ? task.runAt : null;
      } else if (task.cronExpr) {
        patch.nextRunAt = getNextCronRun(task.cronExpr, task.timezone);
      }
    }

    const rawPatchScheduleType = (parsed.scheduleType ?? parsed.schedule_type) as
      | string
      | undefined;
    const newScheduleType =
      rawPatchScheduleType === 'once' || rawPatchScheduleType === 'recurring'
        ? (rawPatchScheduleType as 'once' | 'recurring')
        : null;
    if (newScheduleType && newScheduleType !== task.scheduleType) {
      patch.scheduleType = newScheduleType;
    }

    const effectiveType = (patch.scheduleType ?? task.scheduleType) as
      | 'once'
      | 'recurring'
      | undefined;

    const patchRunAt = (parsed.runAt ?? parsed.run_at) as string | undefined;
    if (typeof patchRunAt === 'string' && effectiveType !== 'recurring') {
      const runDate = new Date(patchRunAt);
      if (Number.isNaN(runDate.getTime())) {
        json(res, 400, { error: 'runAt must be a valid ISO 8601 date' });
        return true;
      }
      patch.runAt = runDate.toISOString();
      patch.nextRunAt = runDate.toISOString();
    }

    const patchCronExpr = (parsed.cronExpr ?? parsed.cron_expr) as string | undefined;
    if (typeof patchCronExpr === 'string' && effectiveType !== 'once') {
      const cronError = validateCronExpr(patchCronExpr);
      if (cronError) {
        json(res, 400, { error: `Invalid cron expression: ${cronError}` });
        return true;
      }
      patch.cronExpr = patchCronExpr;
      patch.nextRunAt = getNextCronRun(patchCronExpr, (patch.timezone ?? task.timezone) as string);
    }

    if (patch.timezone && effectiveType === 'recurring' && !('cronExpr' in patch)) {
      const effectiveCronExpr = (patch.cronExpr ?? task.cronExpr) as string | null;
      const effectiveTimezone = patch.timezone as string;
      patch.nextRunAt = effectiveCronExpr
        ? getNextCronRun(effectiveCronExpr, effectiveTimezone)
        : null;
    }

    if (newScheduleType && newScheduleType !== task.scheduleType) {
      if (newScheduleType === 'once') {
        patch.cronExpr = null;
      } else {
        patch.runAt = null;
      }
    }

    const expectedUpdatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined;
    try {
      ctx.scheduleStore.update(scheduleTaskId, patch, expectedUpdatedAt);
    } catch (err) {
      if (err instanceof StaleUpdateError) {
        json(res, 409, { error: err.message });
        return true;
      }
      throw err;
    }
    const updated = ctx.scheduleStore.getById(scheduleTaskId);
    json(res, 200, { ok: true, data: updated });
    return true;
  }

  // POST /api/schedules/:id/execute — manually execute a scheduled task (dashboard test run)
  const scheduleExecuteId = matchScheduleTaskExecute(pathname);
  if (req.method === 'POST' && scheduleExecuteId) {
    if (!ensureScheduleEnabled(ctx, res)) return true;

    const task = ctx.scheduleStore.getById(scheduleExecuteId);
    if (!task || task.status === 'deleted') {
      json(res, 404, { error: 'Task not found' });
      return true;
    }

    const resolved = resolveTaskAgent(ctx.agentStore, task.agentId, {
      tool: task.tool,
      model: task.model,
      allowMcp: task.allowMcp,
      enabledSkills: task.enabledSkills,
      instructionFile: task.instructionFile,
    });

    const session = ctx.sessionManager.createStandaloneSession(resolved.tool, task.userId);
    const effectiveWorkdir = task.workdir || session.workdir;
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    try {
      mkdirSync(effectiveWorkdir, { recursive: true });
      ctx.workdirManager.prepareWorkdirSkillsOnly(
        effectiveWorkdir,
        resolved.tool,
        resolved.enabledSkills,
      );
    } catch (workdirError) {
      ctx.scheduleStore.recordRun({
        id: runId,
        taskId: task.id,
        sessionKey: session.sessionKey,
        status: 'failed',
        startedAt,
        source: 'dashboard',
      });
      ctx.scheduleStore.updateRun(runId, {
        status: 'failed',
        errorMessage: 'Workdir preparation failed',
        endedAt: new Date().toISOString(),
      });
      logger.error('schedule_manual_workdir_failed', {
        taskId: task.id,
        runId,
        error: errorMessage(workdirError),
      });
      cleanupStandaloneSessionResources(ctx, {
        sessionKey: session.sessionKey,
        sessionWorkdir: session.workdir,
        jobWorkdir: effectiveWorkdir,
      });
      json(res, 500, { error: 'Failed to prepare workdir' });
      return true;
    }

    ctx.sessionManager.updateMode(session.sessionKey, 'write', null);

    ctx.scheduleStore.recordRun({
      id: runId,
      taskId: task.id,
      sessionKey: session.sessionKey,
      status: 'running',
      startedAt,
      source: 'dashboard',
    });

    const job: Job = {
      id: runId,
      sessionKey: session.sessionKey,
      channelId: '',
      threadTs: '',
      userId: task.userId,
      tool: resolved.tool,
      mode: 'write',
      prompt: task.prompt,
      workdir: effectiveWorkdir,
      toolState: {},
      ...(resolved.model ? { toolStateOverrides: { model: resolved.model } } : {}),
      createdAt: Date.now(),
      source: 'schedule',
      scheduleTaskId: task.id,
      scheduleRunId: runId,
      autoApprove: true,
      executionPolicy: {
        allowMcp: resolved.allowMcp,
        enabledSkills: resolved.enabledSkills,
        enabledMcpServerIds: resolved.enabledMcpServerIds,
      },
      instructionFile: resolved.instructionFile,
    };

    const enqueueResult = ctx.jobQueue.enqueue(job);
    if ('error' in enqueueResult) {
      ctx.scheduleStore.updateRun(runId, {
        status: 'failed',
        errorMessage: `Enqueue failed: ${enqueueResult.error}`,
        endedAt: new Date().toISOString(),
      });
      cleanupStandaloneSessionResources(ctx, {
        sessionKey: session.sessionKey,
        sessionWorkdir: session.workdir,
        jobWorkdir: effectiveWorkdir,
      });
      json(res, 503, { error: `Failed to enqueue job: ${enqueueResult.error}` });
      return true;
    }

    json(res, 200, { ok: true, data: { runId, sessionKey: session.sessionKey } });
    return true;
  }

  // DELETE /api/schedules/:id — soft delete
  if (req.method === 'DELETE' && scheduleTaskId) {
    if (!ensureScheduleEnabled(ctx, res)) return true;

    const task = ctx.scheduleStore.getById(scheduleTaskId);
    if (!task || task.status === 'deleted') {
      json(res, 404, { error: 'Task not found' });
      return true;
    }
    ctx.scheduleStore.softDelete(scheduleTaskId);
    json(res, 200, { ok: true });
    return true;
  }

  // GET /api/schedules/:id/runs — list runs for a task
  const scheduleRunsTaskId = matchScheduleTaskRuns(pathname);
  if (req.method === 'GET' && scheduleRunsTaskId) {
    if (!ensureScheduleEnabled(ctx, res)) return true;

    const parentTask = ctx.scheduleStore.getById(scheduleRunsTaskId);
    if (!parentTask || parentTask.status === 'deleted') {
      json(res, 404, { error: 'Task not found' });
      return true;
    }
    const limit = parseLimit(query.get('limit'));
    const runs = ctx.scheduleStore.getRunsByTask(scheduleRunsTaskId, limit);
    json(res, 200, { ok: true, data: runs });
    return true;
  }

  // GET /api/schedules/:taskId/runs/:runId — get run detail
  const scheduleRunDetail = matchScheduleTaskRunDetail(pathname);
  if (req.method === 'GET' && scheduleRunDetail) {
    if (!ensureScheduleEnabled(ctx, res)) return true;

    const run = ctx.scheduleStore.getRunById(scheduleRunDetail.runId);
    if (!run || run.taskId !== scheduleRunDetail.taskId) {
      json(res, 404, { error: 'Run not found' });
      return true;
    }
    json(res, 200, { ok: true, data: run });
    return true;
  }

  return false;
}
