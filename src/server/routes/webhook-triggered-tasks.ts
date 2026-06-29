/** @module server/routes/webhook-triggered-tasks — Triggered task CRUD, execution, and task run handlers. */
import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isToolName } from '../../config.js';
import { normalizeModel } from '../../shared/normalize-model.js';
import type { AppContext } from '../../context/app-context.js';
import type { CreateTriggeredTask, TriggeredTask } from '../../event/types.js';
import { ORCHESTRATOR_NODE_LIMIT_RANGES } from '../../orchestrator/orchestrator-limits.js';
import { type Job, normalizeBool, parseEnabledSkills } from '../../queue/types.js';
import { FIELD_LIMITS } from '../../shared/field-limits.js';
import { json, readBody } from '../../shared/http.js';
import { parseLimit } from '../../shared/pagination.js';
import {
  matchTriggeredTaskExecute,
  matchTriggeredTaskId,
  matchTriggeredTaskRuns,
} from '../../shared/route-matchers.js';
import { cleanupStandaloneSessionResources } from '../../shared/standalone-session-cleanup.js';
import { resolveTaskAgent } from '../../shared/task-agent-resolver.js';
import { discoverCatalogForSkillValidation } from '../../skills/skill-refs.js';
import { StaleUpdateError } from '../../store/store-utils.js';
import { errorMessage } from '../../utils/error.js';
import { logger } from '../../utils/logger.js';
import { parseInlineEventSubscriptionInput } from './inline-event-subscription.js';
import {
  MAX_INSTRUCTION_FILE_LENGTH,
  isAllowedTaskUserId,
  resolveTaskUserId,
} from './task-api-shared.js';
import {
  ensureInlineSubscriptionEndpointExists,
  eventSubscriptionConflictMessage,
  isInlineSubscriptionEndpointMissingError,
  normalizeNullableString,
  refreshRouter,
} from './webhook-shared.js';

export async function handleTriggeredTaskRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  // ── Triggered Task routes ──────────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/api/triggered-tasks') {
    json(res, 200, { ok: true, data: ctx.triggeredTaskStore.list() });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/triggered-tasks') {
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
    const skillCatalog = discoverCatalogForSkillValidation(ctx.config, tool);
    const skillsResult = parseEnabledSkills(
      parsed.enabledSkills ?? parsed.enabled_skills,
      skillCatalog,
      'enabledSkills',
    );
    if (skillsResult.error) {
      json(res, 400, { error: skillsResult.error });
      return true;
    }
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
    }
    const concurrencyPolicy =
      parsed.concurrencyPolicy ?? parsed.concurrency_policy ?? 'skip_if_running';
    if (concurrencyPolicy !== 'allow' && concurrencyPolicy !== 'skip_if_running') {
      json(res, 400, { error: 'concurrencyPolicy must be allow or skip_if_running' });
      return true;
    }
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
      typeof (parsed.userId ?? parsed.user_id) === 'string'
        ? ((parsed.userId ?? parsed.user_id) as string)
        : undefined,
      typeof (parsed.notifyChannel ?? parsed.notify_channel) === 'string'
        ? ((parsed.notifyChannel ?? parsed.notify_channel) as string)
        : undefined,
    );
    if (!isAllowedTaskUserId(ctx, resolvedUserId)) {
      json(res, 403, { error: 'user_id not in allowlist' });
      return true;
    }

    const input: CreateTriggeredTask = {
      name,
      description: typeof parsed.description === 'string' ? parsed.description.trim() : null,
      userId: resolvedUserId,
      tool,
      model,
      mode: 'write',
      prompt,
      workdir: normalizeNullableString(parsed.workdir),
      maxRetries: typeof maxRetries === 'number' ? Math.floor(maxRetries) : 0,
      allowMcp: normalizeBool(parsed.allowMcp ?? parsed.allow_mcp, false),
      enabledSkills: skillsResult.skills,
      instructionFile: typeof rawInstructionFile === 'string' ? rawInstructionFile : null,
      agentId: typeof rawAgentId === 'string' && rawAgentId ? rawAgentId : null,
      notifyChannel: normalizeNullableString(parsed.notifyChannel ?? parsed.notify_channel),
      notifyThread: normalizeNullableString(parsed.notifyThread ?? parsed.notify_thread),
      enabled: normalizeBool(parsed.enabled, true),
      concurrencyPolicy,
    };

    const inlineSubscription = parseInlineEventSubscriptionInput(
      parsed.subscription,
      'subscription',
    );
    if (inlineSubscription.error) {
      json(res, 400, { error: inlineSubscription.error });
      return true;
    }
    const subscription = inlineSubscription.value;
    if (
      subscription.kind === 'upsert' &&
      !ctx.webhookEndpointStore.getById(subscription.endpointId)
    ) {
      json(res, 400, { error: 'endpointId not found' });
      return true;
    }

    let task: TriggeredTask;
    try {
      if (subscription.kind === 'upsert') {
        task = ctx.triggeredTaskStore.transaction(() => {
          const created = ctx.triggeredTaskStore.create(input);
          ensureInlineSubscriptionEndpointExists(ctx, subscription.endpointId);
          ctx.eventSubscriptionStore.create({
            endpointId: subscription.endpointId,
            targetType: 'triggered_task',
            orchestratorId: null,
            triggeredTaskId: created.id,
            nodeId: null,
            filterJson: subscription.filterJson,
            contextMappingJson: subscription.contextMappingJson,
            enabled: subscription.enabled,
          });
          return created;
        });
      } else {
        task = ctx.triggeredTaskStore.create(input);
      }
    } catch (err) {
      if (isInlineSubscriptionEndpointMissingError(err)) {
        json(res, 400, { error: 'endpointId not found' });
        return true;
      }
      throw err;
    }

    if (subscription.kind === 'upsert') {
      await refreshRouter(ctx);
    }
    json(res, 201, { ok: true, data: task });
    return true;
  }

  const triggeredTaskId = matchTriggeredTaskId(pathname);
  if (triggeredTaskId && req.method === 'GET') {
    const task = ctx.triggeredTaskStore.getById(triggeredTaskId);
    if (!task) {
      json(res, 404, { error: 'Task not found' });
      return true;
    }
    json(res, 200, {
      ok: true,
      data: { ...task, recentRuns: ctx.triggeredTaskStore.getRunsByTask(triggeredTaskId, 10) },
    });
    return true;
  }

  if (triggeredTaskId && req.method === 'PATCH') {
    const task = ctx.triggeredTaskStore.getById(triggeredTaskId);
    if (!task) {
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
      patch.name = parsed.name.trim();
      if ((patch.name as string).length > FIELD_LIMITS.name.max) {
        json(res, 400, { error: `name must be <= ${FIELD_LIMITS.name.max} characters` });
        return true;
      }
    }
    if ('description' in parsed) patch.description = normalizeNullableString(parsed.description);
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
      patch.prompt = parsed.prompt.trim();
      if ((patch.prompt as string).length > FIELD_LIMITS.prompt.max) {
        json(res, 400, { error: `prompt must be <= ${FIELD_LIMITS.prompt.max} characters` });
        return true;
      }
    }
    if ('workdir' in parsed) patch.workdir = normalizeNullableString(parsed.workdir);
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
    if (parsed.allowMcp !== undefined || parsed.allow_mcp !== undefined) {
      patch.allowMcp = normalizeBool(parsed.allowMcp ?? parsed.allow_mcp, false);
    }
    if (parsed.enabled !== undefined) patch.enabled = normalizeBool(parsed.enabled, true);
    if (parsed.notifyChannel !== undefined || parsed.notify_channel !== undefined) {
      patch.notifyChannel = normalizeNullableString(parsed.notifyChannel ?? parsed.notify_channel);
    }
    if (parsed.notifyThread !== undefined || parsed.notify_thread !== undefined) {
      patch.notifyThread = normalizeNullableString(parsed.notifyThread ?? parsed.notify_thread);
    }
    if ('instructionFile' in parsed || 'instruction_file' in parsed) {
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
      patch.instructionFile = typeof rawInstructionFile === 'string' ? rawInstructionFile : null;
    }
    if (parsed.enabledSkills !== undefined || parsed.enabled_skills !== undefined) {
      const effectiveTool =
        typeof patch.tool === 'string' && isToolName(patch.tool) ? patch.tool : task.tool;
      const skillCatalog = discoverCatalogForSkillValidation(ctx.config, effectiveTool);
      const skillsResult = parseEnabledSkills(
        parsed.enabledSkills ?? parsed.enabled_skills,
        skillCatalog,
        'enabledSkills',
      );
      if (skillsResult.error) {
        json(res, 400, { error: skillsResult.error });
        return true;
      }
      patch.enabledSkills = skillsResult.skills;
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
    const concurrencyPolicy = parsed.concurrencyPolicy ?? parsed.concurrency_policy;
    if (concurrencyPolicy !== undefined) {
      if (concurrencyPolicy !== 'allow' && concurrencyPolicy !== 'skip_if_running') {
        json(res, 400, { error: 'concurrencyPolicy must be allow or skip_if_running' });
        return true;
      }
      patch.concurrencyPolicy = concurrencyPolicy;
    }
    if (
      parsed.userId !== undefined ||
      parsed.user_id !== undefined ||
      parsed.notifyChannel !== undefined ||
      parsed.notify_channel !== undefined
    ) {
      const resolvedUserId = resolveTaskUserId(
        typeof (parsed.userId ?? parsed.user_id) === 'string'
          ? ((parsed.userId ?? parsed.user_id) as string)
          : undefined,
        typeof (parsed.notifyChannel ?? parsed.notify_channel) === 'string'
          ? ((parsed.notifyChannel ?? parsed.notify_channel) as string)
          : undefined,
      );
      if (!isAllowedTaskUserId(ctx, resolvedUserId)) {
        json(res, 403, { error: 'user_id not in allowlist' });
        return true;
      }
      patch.userId = resolvedUserId;
    }
    const inlineSubscription = parseInlineEventSubscriptionInput(
      parsed.subscription,
      'subscription',
    );
    if (inlineSubscription.error) {
      json(res, 400, { error: inlineSubscription.error });
      return true;
    }
    const subscription = inlineSubscription.value;
    if (
      subscription.kind === 'upsert' &&
      !ctx.webhookEndpointStore.getById(subscription.endpointId)
    ) {
      json(res, 400, { error: 'endpointId not found' });
      return true;
    }

    try {
      const expectedUpdatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined;

      if (subscription.kind !== 'omit') {
        // Wrap task update + subscription upsert in a transaction
        ctx.triggeredTaskStore.transaction(() => {
          ctx.triggeredTaskStore.update(triggeredTaskId, patch, expectedUpdatedAt);

          // Find existing subscription for this task
          const existing = ctx.eventSubscriptionStore
            .list()
            .find(
              (s) => s.targetType === 'triggered_task' && s.triggeredTaskId === triggeredTaskId,
            );

          if (subscription.kind === 'remove') {
            // Remove subscription
            if (existing) ctx.eventSubscriptionStore.delete(existing.id);
          } else {
            ensureInlineSubscriptionEndpointExists(ctx, subscription.endpointId);
            if (existing) {
              ctx.eventSubscriptionStore.update(existing.id, {
                endpointId: subscription.endpointId,
                filterJson: subscription.filterJson,
                contextMappingJson: subscription.contextMappingJson,
                enabled: subscription.enabled,
              });
            } else {
              ctx.eventSubscriptionStore.create({
                endpointId: subscription.endpointId,
                targetType: 'triggered_task',
                orchestratorId: null,
                triggeredTaskId,
                nodeId: null,
                filterJson: subscription.filterJson,
                contextMappingJson: subscription.contextMappingJson,
                enabled: subscription.enabled,
              });
            }
          }
        });
        await refreshRouter(ctx);
      } else {
        ctx.triggeredTaskStore.update(triggeredTaskId, patch, expectedUpdatedAt);
      }

      json(res, 200, { ok: true, data: ctx.triggeredTaskStore.getById(triggeredTaskId) });
      return true;
    } catch (err) {
      if (err instanceof StaleUpdateError) {
        json(res, 409, { error: err.message });
        return true;
      }
      if (isInlineSubscriptionEndpointMissingError(err)) {
        json(res, 400, { error: 'endpointId not found' });
        return true;
      }
      const conflict = eventSubscriptionConflictMessage(errorMessage(err));
      if (conflict) {
        json(res, 409, { error: conflict });
        return true;
      }
      throw err;
    }
  }

  if (triggeredTaskId && req.method === 'DELETE') {
    const task = ctx.triggeredTaskStore.getById(triggeredTaskId);
    if (!task) {
      json(res, 404, { error: 'Task not found' });
      return true;
    }
    ctx.triggeredTaskStore.delete(triggeredTaskId);
    await refreshRouter(ctx);
    json(res, 200, { ok: true });
    return true;
  }

  // POST /api/triggered-tasks/:id/execute — manually execute a triggered task (dashboard test run)
  const triggeredTaskExecuteId = matchTriggeredTaskExecute(pathname);
  if (req.method === 'POST' && triggeredTaskExecuteId) {
    const task = ctx.triggeredTaskStore.getById(triggeredTaskExecuteId);
    if (!task) {
      json(res, 404, { error: 'Task not found' });
      return true;
    }

    // Honour concurrency policy: claim the task to prevent race conditions
    // with concurrent webhook-triggered runs. The finisher releases the claim.
    if (task.concurrencyPolicy === 'skip_if_running') {
      const claimed = ctx.triggeredTaskStore.claimTask(task.id, new Date().toISOString());
      if (!claimed) {
        json(res, 409, { error: 'Task is currently running (skip_if_running policy)' });
        return true;
      }
    }

    const resolved = resolveTaskAgent(ctx.agentStore, task.agentId, {
      tool: task.tool,
      model: task.model,
      allowMcp: task.allowMcp,
      enabledSkills: task.enabledSkills,
      instructionFile: task.instructionFile,
    });

    // Wrap session creation and workdir setup in try-catch to guarantee
    // the claim is released on failure, preventing stale claims.
    let session: ReturnType<typeof ctx.sessionManager.createStandaloneSession> | null = null;
    let effectiveWorkdir: string | null = null;
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    try {
      session = ctx.sessionManager.createStandaloneSession(resolved.tool, task.userId);
      effectiveWorkdir = task.workdir || session.workdir;
      mkdirSync(effectiveWorkdir, { recursive: true });
      ctx.workdirManager.prepareWorkdirSkillsOnly(
        effectiveWorkdir,
        resolved.tool,
        resolved.enabledSkills,
      );
    } catch (setupError) {
      logger.error('triggered_task_manual_setup_failed', {
        taskId: task.id,
        runId,
        error: errorMessage(setupError),
      });
      if (task.concurrencyPolicy === 'skip_if_running') {
        ctx.triggeredTaskStore.releaseClaim(task.id);
      }
      // Only record run / cleanup session if session was created
      if (session && effectiveWorkdir) {
        ctx.triggeredTaskStore.recordRun({
          id: runId,
          triggeredTaskId: task.id,
          status: 'failed',
          triggeredBy: 'dashboard',
          triggerContextJson: null,
          sessionKey: session.sessionKey,
          jobId: runId,
          errorMessage: 'Setup failed',
          startedAt,
          endedAt: new Date().toISOString(),
        });
        cleanupStandaloneSessionResources(ctx, {
          sessionKey: session.sessionKey,
          sessionWorkdir: session.workdir,
          jobWorkdir: effectiveWorkdir,
        });
      }
      json(res, 500, { error: 'Failed to prepare task execution' });
      return true;
    }

    if (!session || !effectiveWorkdir) {
      json(res, 500, { error: 'Failed to prepare task execution' });
      return true;
    }
    ctx.sessionManager.updateMode(session.sessionKey, 'write', null);

    ctx.triggeredTaskStore.recordRun({
      id: runId,
      triggeredTaskId: task.id,
      status: 'running',
      triggeredBy: 'dashboard',
      triggerContextJson: null,
      sessionKey: session.sessionKey,
      jobId: runId,
      startedAt,
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
      source: 'triggered-task',
      triggeredTaskId: task.id,
      triggeredTaskRunId: runId,
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
      ctx.triggeredTaskStore.updateRun(runId, {
        status: 'failed',
        errorMessage: `Enqueue failed: ${enqueueResult.error}`,
        endedAt: new Date().toISOString(),
      });
      if (task.concurrencyPolicy === 'skip_if_running') {
        ctx.triggeredTaskStore.releaseClaim(task.id);
      }
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

  const triggeredTaskRunsId = matchTriggeredTaskRuns(pathname);
  if (triggeredTaskRunsId && req.method === 'GET') {
    const task = ctx.triggeredTaskStore.getById(triggeredTaskRunsId);
    if (!task) {
      json(res, 404, { error: 'Task not found' });
      return true;
    }
    const limit = parseLimit(new URL(req.url ?? '/', 'http://localhost').searchParams.get('limit'));
    json(res, 200, {
      ok: true,
      data: ctx.triggeredTaskStore.getRunsByTask(triggeredTaskRunsId, limit),
    });
    return true;
  }

  return false;
}
