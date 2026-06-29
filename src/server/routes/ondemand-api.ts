/** @module server/routes/ondemand-api — Server API routes for on-demand task CRUD and execution. */
import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isToolName } from '../../config.js';
import type { AppContext } from '../../context/app-context.js';
import { ORCHESTRATOR_NODE_LIMIT_RANGES } from '../../orchestrator/orchestrator-limits.js';
import { type Job, normalizeBool, parseEnabledSkills } from '../../queue/types.js';
import { FIELD_LIMITS } from '../../shared/field-limits.js';
import { json, parseUrl, readBody } from '../../shared/http.js';
import { normalizeModel } from '../../shared/normalize-model.js';
import { parseLimit } from '../../shared/pagination.js';
import {
  matchOndemandTaskExecute,
  matchOndemandTaskId,
  matchOndemandTaskRuns,
} from '../../shared/route-matchers.js';
import { cleanupStandaloneSessionResources } from '../../shared/standalone-session-cleanup.js';
import { resolveTaskAgent } from '../../shared/task-agent-resolver.js';
import { discoverCatalogForSkillValidation } from '../../skills/skill-refs.js';
import type { CreateOndemandTask } from '../../store/ondemand-task.js';
import { StaleUpdateError } from '../../store/store-utils.js';
import { errorMessage } from '../../utils/error.js';
import { logger } from '../../utils/logger.js';
import {
  MAX_INSTRUCTION_FILE_LENGTH,
  isAllowedTaskUserId,
  resolvePatchedTaskUserId,
  resolveTaskUserId,
  validateCustomWorkdir,
} from './task-api-shared.js';

export function matchesOndemandApiPath(pathname: string): boolean {
  return pathname === '/api/ondemand-tasks' || pathname.startsWith('/api/ondemand-tasks/');
}

export async function handleOndemandApiRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const { query } = parseUrl(req.url);

  // POST /api/ondemand-tasks — create on-demand task
  if (req.method === 'POST' && pathname === '/api/ondemand-tasks') {
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
    const alias = typeof parsed.alias === 'string' ? parsed.alias.trim() : null;
    if (alias !== null && alias.length > FIELD_LIMITS.alias.max) {
      json(res, 400, { error: `alias must be <= ${FIELD_LIMITS.alias.max} characters` });
      return true;
    }
    const description = typeof parsed.description === 'string' ? parsed.description.trim() : null;
    if (description !== null && description.length > FIELD_LIMITS.description.max) {
      json(res, 400, {
        error: `description must be <= ${FIELD_LIMITS.description.max} characters`,
      });
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

    const rawEnabledSkills = parsed.enabledSkills ?? parsed.enabled_skills;
    const skillCatalog = discoverCatalogForSkillValidation(ctx.config, tool);
    const skillsResult = parseEnabledSkills(rawEnabledSkills, skillCatalog, 'enabledSkills');
    if (skillsResult.error) {
      json(res, 400, { error: skillsResult.error });
      return true;
    }

    const rawNotifyChannel = (parsed.notifyChannel ?? parsed.notify_channel) as string | undefined;
    const rawNotifyThread = (parsed.notifyThread ?? parsed.notify_thread) as string | undefined;
    const rawUserId = (parsed.userId ?? parsed.user_id) as string | undefined;
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
      typeof rawNotifyChannel === 'string' && rawNotifyChannel.trim()
        ? rawNotifyChannel.trim()
        : undefined,
    );
    if (!isAllowedTaskUserId(ctx, resolvedUserId)) {
      json(res, 403, { error: 'user_id not in allowlist' });
      return true;
    }

    const input: CreateOndemandTask = {
      name,
      alias: alias || null,
      description: description || null,
      userId: resolvedUserId,
      tool,
      model,
      mode: 'write',
      prompt,
      workdir: null,
      maxRetries: typeof rawMaxRetries === 'number' ? Math.floor(rawMaxRetries) : 0,
      allowMcp: normalizeBool(rawAllowMcp, false),
      enabledSkills: skillsResult.skills,
      notifyChannel:
        typeof rawNotifyChannel === 'string' && rawNotifyChannel.trim()
          ? rawNotifyChannel.trim()
          : null,
      notifyThread:
        typeof rawNotifyThread === 'string' && rawNotifyThread.trim()
          ? rawNotifyThread.trim()
          : null,
      instructionFile: typeof rawInstructionFile === 'string' ? rawInstructionFile : null,
      agentId: typeof rawAgentId === 'string' && rawAgentId ? rawAgentId : null,
    };

    try {
      input.workdir = validateCustomWorkdir(ctx, parsed.workdir);
    } catch (err) {
      json(res, 400, { error: errorMessage(err) });
      return true;
    }

    try {
      const task = ctx.ondemandTaskStore.create(input);
      json(res, 201, { ok: true, data: task });
    } catch (err) {
      const message = errorMessage(err);
      if (message.includes('already in use')) {
        json(res, 409, { error: message });
      } else {
        throw err;
      }
    }
    return true;
  }

  // GET /api/ondemand-tasks — list on-demand tasks
  if (req.method === 'GET' && pathname === '/api/ondemand-tasks') {
    const tasks = ctx.ondemandTaskStore.list();
    json(res, 200, { ok: true, data: tasks });
    return true;
  }

  // GET /api/ondemand-tasks/:id — task detail with recent runs
  const ondemandTaskId = matchOndemandTaskId(pathname);
  if (req.method === 'GET' && ondemandTaskId) {
    const task = ctx.ondemandTaskStore.getById(ondemandTaskId);
    if (!task || task.status === 'deleted') {
      json(res, 404, { error: 'Task not found' });
      return true;
    }
    const runs = ctx.ondemandTaskStore.getRunsByTask(ondemandTaskId, 10);
    json(res, 200, { ok: true, data: { ...task, recentRuns: runs } });
    return true;
  }

  // PATCH /api/ondemand-tasks/:id — update task
  if (req.method === 'PATCH' && ondemandTaskId) {
    const task = ctx.ondemandTaskStore.getById(ondemandTaskId);
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
    if (typeof parsed.name === 'string' && parsed.name.trim()) {
      const name = parsed.name.trim();
      if (name.length > FIELD_LIMITS.name.max) {
        json(res, 400, { error: `name must be <= ${FIELD_LIMITS.name.max} characters` });
        return true;
      }
      patch.name = name;
    }
    if ('alias' in parsed) {
      const alias = typeof parsed.alias === 'string' ? parsed.alias.trim() : null;
      if (alias !== null && alias.length > FIELD_LIMITS.alias.max) {
        json(res, 400, { error: `alias must be <= ${FIELD_LIMITS.alias.max} characters` });
        return true;
      }
      patch.alias = alias || null;
    }
    if ('description' in parsed) {
      const description = typeof parsed.description === 'string' ? parsed.description.trim() : null;
      if (description !== null && description.length > FIELD_LIMITS.description.max) {
        json(res, 400, {
          error: `description must be <= ${FIELD_LIMITS.description.max} characters`,
        });
        return true;
      }
      patch.description = description;
    }
    if (typeof parsed.tool === 'string') {
      if (!isToolName(parsed.tool)) {
        json(res, 400, { error: 'tool must be claude, codex, or gemini' });
        return true;
      }
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
    if (typeof parsed.prompt === 'string') {
      const prompt = parsed.prompt.trim();
      if (!prompt) {
        json(res, 400, { error: 'prompt cannot be empty' });
        return true;
      }
      if (prompt.length > FIELD_LIMITS.prompt.max) {
        json(res, 400, { error: `prompt must be <= ${FIELD_LIMITS.prompt.max} characters` });
        return true;
      }
      patch.prompt = prompt;
    }
    {
      const maxRetries = parsed.maxRetries ?? parsed.max_retries;
      if (maxRetries !== undefined) {
        const { min, max } = ORCHESTRATOR_NODE_LIMIT_RANGES.maxRetries;
        if (
          typeof maxRetries !== 'number' ||
          !Number.isFinite(maxRetries) ||
          maxRetries < min ||
          maxRetries > max
        ) {
          json(res, 400, { error: `maxRetries must be an integer between ${min} and ${max}` });
          return true;
        }
        patch.maxRetries = Math.floor(maxRetries);
      }
    }
    {
      const notifyChannel = parsed.notifyChannel ?? parsed.notify_channel;
      if (notifyChannel !== undefined) {
        patch.notifyChannel =
          typeof notifyChannel === 'string' && notifyChannel.trim() ? notifyChannel.trim() : null;
      }
    }
    const resolvedPatchedUserId = resolvePatchedTaskUserId(parsed, task.notifyChannel);
    if (resolvedPatchedUserId !== undefined) {
      if (!isAllowedTaskUserId(ctx, resolvedPatchedUserId)) {
        json(res, 403, { error: 'user_id not in allowlist' });
        return true;
      }
      patch.userId = resolvedPatchedUserId;
    }
    {
      const notifyThread = parsed.notifyThread ?? parsed.notify_thread;
      if (notifyThread !== undefined) {
        patch.notifyThread =
          typeof notifyThread === 'string' && notifyThread.trim() ? notifyThread.trim() : null;
      }
    }
    {
      const allowMcp = parsed.allowMcp ?? parsed.allow_mcp;
      if (allowMcp !== undefined) {
        patch.allowMcp = normalizeBool(allowMcp, false);
      }
    }
    {
      const enabledSkills = parsed.enabledSkills ?? parsed.enabled_skills;
      if (enabledSkills !== undefined) {
        const effectiveTool = (patch.tool ?? task.tool) as typeof task.tool;
        const skillCatalog = discoverCatalogForSkillValidation(ctx.config, effectiveTool);
        const enabledSkillsResult = parseEnabledSkills(
          enabledSkills,
          skillCatalog,
          'enabledSkills',
        );
        if (enabledSkillsResult.error) {
          json(res, 400, { error: enabledSkillsResult.error });
          return true;
        }
        patch.enabledSkills = enabledSkillsResult.skills;
      }
    }
    if ('workdir' in parsed) {
      try {
        patch.workdir = validateCustomWorkdir(ctx, parsed.workdir);
      } catch (err) {
        json(res, 400, { error: errorMessage(err) });
        return true;
      }
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

    try {
      const expectedUpdatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined;
      ctx.ondemandTaskStore.update(ondemandTaskId, patch, expectedUpdatedAt);
      const updated = ctx.ondemandTaskStore.getById(ondemandTaskId);
      json(res, 200, { ok: true, data: updated });
    } catch (err) {
      if (err instanceof StaleUpdateError) {
        json(res, 409, { error: err.message });
        return true;
      }
      const message = errorMessage(err);
      if (message.includes('already in use')) {
        json(res, 409, { error: message });
      } else {
        throw err;
      }
    }
    return true;
  }

  // DELETE /api/ondemand-tasks/:id — soft delete
  if (req.method === 'DELETE' && ondemandTaskId) {
    const task = ctx.ondemandTaskStore.getById(ondemandTaskId);
    if (!task || task.status === 'deleted') {
      json(res, 404, { error: 'Task not found' });
      return true;
    }
    ctx.ondemandTaskStore.softDelete(ondemandTaskId);
    json(res, 200, { ok: true });
    return true;
  }

  // POST /api/ondemand-tasks/:id/execute — execute task
  const ondemandExecuteId = matchOndemandTaskExecute(pathname);
  if (req.method === 'POST' && ondemandExecuteId) {
    const task = ctx.ondemandTaskStore.getById(ondemandExecuteId);
    if (!task || task.status === 'deleted') {
      json(res, 404, { error: 'Task not found' });
      return true;
    }

    // Resolve agent config before session/workdir setup so the agent's
    // current tool and skills are used for workdir preparation.
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
      ctx.ondemandTaskStore.recordRun({
        id: runId,
        taskId: task.id,
        sessionKey: session.sessionKey,
        status: 'failed',
        startedAt,
        source: 'dashboard',
      });
      ctx.ondemandTaskStore.updateRun(runId, {
        status: 'failed',
        errorMessage: 'Workdir preparation failed',
        endedAt: new Date().toISOString(),
      });
      logger.error('ondemand_workdir_failed', {
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

    ctx.ondemandTaskStore.recordRun({
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
      source: 'ondemand-task',
      ondemandTaskId: task.id,
      ondemandTaskRunId: runId,
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
      ctx.ondemandTaskStore.updateRun(runId, {
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

  // GET /api/ondemand-tasks/:id/runs — list runs for a task
  const ondemandRunsTaskId = matchOndemandTaskRuns(pathname);
  if (req.method === 'GET' && ondemandRunsTaskId) {
    const parentTask = ctx.ondemandTaskStore.getById(ondemandRunsTaskId);
    if (!parentTask || parentTask.status === 'deleted') {
      json(res, 404, { error: 'Task not found' });
      return true;
    }
    const limit = parseLimit(query.get('limit'));
    const runs = ctx.ondemandTaskStore.getRunsByTask(ondemandRunsTaskId, limit);
    json(res, 200, { ok: true, data: runs });
    return true;
  }

  return false;
}
