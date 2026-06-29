import type { IncomingMessage, ServerResponse } from 'node:http';
/** @module server/routes/orchestrator-crud — Orchestrator CRUD and run query routes. */
import path from 'node:path';
import type { AppContext } from '../../context/app-context.js';
import {
  ORCHESTRATOR_DEFAULTS,
  validateOrchestratorLimits,
} from '../../orchestrator/orchestrator-limits.js';
import type { OrchestratorPatch } from '../../orchestrator/types-patch.js';
import { parseEnabledSkills } from '../../queue/types.js';
import { getNextCronRun, validateCronExpr } from '../../schedule/cron-utils.js';
import { json, readBody } from '../../shared/http.js';
import {
  matchOrchestratorId,
  matchOrchestratorRunId,
  matchOrchestratorRuns,
  matchOrchestratorRunsOverview,
} from '../../shared/route-matchers.js';
import { TriggerModeSchema } from '../../shared/schemas/common.js';
import { discoverCatalogForSkillValidation } from '../../skills/skill-refs.js';
import { StaleUpdateError } from '../../store/store-utils.js';
import { errorMessage } from '../../utils/error.js';
import { logger } from '../../utils/logger.js';
import { resolveAndValidateTimezone } from '../../utils/timezone.js';
import { cleanupWorkdir } from '../../utils/workdir.js';
import {
  VALID_ERROR_POLICIES,
  VALID_SCHEDULE_TYPES,
  normalizeSummaryEnabled,
  orchMaxRunWorkdirs,
  parseSummaryTool,
  validateNodeWorkdir,
} from './orchestrator-shared.js';

/**
 * Handle orchestrator CRUD routes and run query routes.
 *
 * Returns `true` if the route was handled (response sent), `false` otherwise.
 */
export async function handleOrchestratorCrudRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  // GET /api/orchestrators — list (with enrichment: nodeCount, lastRunStatus, etc.)
  if (req.method === 'GET' && pathname === '/api/orchestrators') {
    const orchestrators = ctx.orchestratorStore.listEnriched();
    json(res, 200, { ok: true, data: orchestrators });
    return true;
  }

  // Shared match for GET / PATCH / DELETE /api/orchestrators/:id
  const orchId = matchOrchestratorId(pathname);

  // GET /api/orchestrators/:id — detail (with nodes + edges)
  if (req.method === 'GET' && orchId) {
    const orch = ctx.orchestratorStore.getById(orchId);
    if (!orch || orch.status === 'deleted') {
      json(res, 404, { error: 'Orchestrator not found' });
      return true;
    }
    const nodes = ctx.orchestratorStore.getNodesByOrchestrator(orchId);
    const edges = ctx.orchestratorStore.getEdgesByOrchestrator(orchId);
    json(res, 200, { ok: true, data: { ...orch, nodes, edges } });
    return true;
  }

  // POST /api/orchestrators — create
  if (req.method === 'POST' && pathname === '/api/orchestrators') {
    const body = await readBody(req);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }

    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    if (!name) {
      json(res, 400, { error: 'name is required' });
      return true;
    }

    const VALID_TRIGGER_MODES: ReadonlySet<string> = new Set(TriggerModeSchema.options);
    const rawTriggerMode = typeof parsed.triggerMode === 'string' ? parsed.triggerMode : 'ondemand';
    if (!VALID_TRIGGER_MODES.has(rawTriggerMode)) {
      json(res, 400, {
        error: `Invalid triggerMode: ${rawTriggerMode}. Must be one of: ondemand, webhook`,
      });
      return true;
    }
    const triggerMode = rawTriggerMode as 'ondemand' | 'webhook';
    const isWebhookMode = triggerMode === 'webhook';

    // Webhook orchestrators: force-null schedule/alias fields (these features are ondemand-only)
    const rawScheduleType = isWebhookMode
      ? null
      : typeof parsed.scheduleType === 'string'
        ? parsed.scheduleType
        : null;
    if (rawScheduleType && !VALID_SCHEDULE_TYPES.has(rawScheduleType)) {
      json(res, 400, {
        error: `Invalid scheduleType: ${rawScheduleType}. Must be one of: ${[...VALID_SCHEDULE_TYPES].join(', ')}`,
      });
      return true;
    }
    const scheduleType = rawScheduleType as 'once' | 'recurring' | null;

    const rawErrorPolicy =
      typeof parsed.errorPolicy === 'string'
        ? parsed.errorPolicy
        : ORCHESTRATOR_DEFAULTS.errorPolicy;
    if (!VALID_ERROR_POLICIES.has(rawErrorPolicy)) {
      json(res, 400, {
        error: `Invalid errorPolicy: ${rawErrorPolicy}. Must be one of: ${[...VALID_ERROR_POLICIES].join(', ')}`,
      });
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
    const runAt = typeof parsed.runAt === 'string' ? parsed.runAt : null;
    const cronExpr = typeof parsed.cronExpr === 'string' ? parsed.cronExpr : null;
    const createLimitsError = validateOrchestratorLimits({
      maxParallelism: parsed.maxParallelism,
      maxTotalNodes: parsed.maxTotalNodes,
      timeoutSec: parsed.timeoutSec,
    });
    if (createLimitsError) {
      json(res, 400, { error: createLimitsError });
      return true;
    }

    // Compute nextRunAt from schedule fields
    let orchNextRunAt: string | null = null;
    if (scheduleType === 'once' && runAt) {
      const runDate = new Date(runAt);
      if (!Number.isNaN(runDate.getTime()) && runDate.getTime() > Date.now() - 60_000) {
        orchNextRunAt = runDate.toISOString();
      }
    } else if (scheduleType === 'recurring' && cronExpr) {
      const cronError = validateCronExpr(cronExpr);
      if (!cronError) {
        orchNextRunAt = getNextCronRun(cronExpr, timezone);
      }
    }

    // Validate enabledSkills at orchestrator level
    const skillCatalog = discoverCatalogForSkillValidation(ctx.config);
    const orchSkillsResult = parseEnabledSkills(
      parsed.enabledSkills,
      skillCatalog,
      'enabledSkills',
    );
    if (orchSkillsResult.error) {
      json(res, 400, { error: orchSkillsResult.error });
      return true;
    }

    const summaryEnabled = normalizeSummaryEnabled(parsed.summaryEnabled);
    const summaryToolResult = parseSummaryTool(parsed.summaryTool);
    if (summaryToolResult.error) {
      json(res, 400, { error: summaryToolResult.error });
      return true;
    }
    if (summaryEnabled && !summaryToolResult.value) {
      json(res, 400, { error: 'summaryTool is required when summaryEnabled is true' });
      return true;
    }

    const orchestratorWorkdirResult = validateNodeWorkdir(ctx, parsed.workdir);
    if (orchestratorWorkdirResult.error) {
      json(res, 400, { error: orchestratorWorkdirResult.error });
      return true;
    }

    const maxRunWorkdirsResult = orchMaxRunWorkdirs(parsed.maxRunWorkdirs);
    if (maxRunWorkdirsResult.error) {
      json(res, 400, { error: maxRunWorkdirsResult.error });
      return true;
    }

    try {
      const orch = ctx.orchestratorStore.create({
        name,
        alias: isWebhookMode
          ? null
          : typeof parsed.alias === 'string'
            ? parsed.alias.trim() || null
            : null,
        description: typeof parsed.description === 'string' ? parsed.description : null,
        workdir: orchestratorWorkdirResult.value ?? null,
        triggerMode,
        scheduleType,
        runAt: isWebhookMode ? null : runAt,
        cronExpr: isWebhookMode ? null : cronExpr,
        timezone,
        notifyChannel: isWebhookMode
          ? null
          : typeof parsed.notifyChannel === 'string'
            ? parsed.notifyChannel
            : null,
        maxParallelism:
          typeof parsed.maxParallelism === 'number'
            ? parsed.maxParallelism
            : ORCHESTRATOR_DEFAULTS.maxParallelism,
        maxTotalNodes:
          typeof parsed.maxTotalNodes === 'number'
            ? parsed.maxTotalNodes
            : ORCHESTRATOR_DEFAULTS.maxTotalNodes,
        errorPolicy: rawErrorPolicy as 'fail_fast' | 'continue',
        timeoutSec: typeof parsed.timeoutSec === 'number' ? parsed.timeoutSec : null,
        instructionFile: typeof parsed.instructionFile === 'string' ? parsed.instructionFile : null,
        enabledSkills: orchSkillsResult.skills,
        summaryEnabled,
        summaryTool: summaryToolResult.value,
        nextRunAt: orchNextRunAt,
        maxRunWorkdirs: maxRunWorkdirsResult.value,
      });
      json(res, 201, { ok: true, data: orch });
    } catch (err) {
      const msg = errorMessage(err);
      if (msg.includes('already in use')) {
        json(res, 409, { error: msg });
      } else {
        throw err;
      }
    }
    return true;
  }

  // PATCH /api/orchestrators/:id — update
  if (req.method === 'PATCH' && orchId) {
    const orch = ctx.orchestratorStore.getById(orchId);
    if (!orch || orch.status === 'deleted') {
      json(res, 404, { error: 'Orchestrator not found' });
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

    // Webhook orchestrators: strip ondemand-only fields to prevent data corruption
    if (orch.triggerMode === 'webhook') {
      for (const key of ['alias', 'scheduleType', 'runAt', 'cronExpr', 'notifyChannel'] as const) {
        delete parsed[key];
      }
    }

    if (parsed.name !== undefined) {
      const newName = typeof parsed.name === 'string' ? parsed.name.trim() : '';
      if (!newName) {
        json(res, 400, { error: 'name must be a non-empty string' });
        return true;
      }
      if (!ctx.orchestratorStore.isNameAvailable(newName, orchId)) {
        json(res, 409, { error: `Name "${newName}" is already in use` });
        return true;
      }
      parsed.name = newName;
    }

    if (parsed.alias !== undefined) {
      const newAlias = typeof parsed.alias === 'string' ? parsed.alias.trim() : null;
      if (newAlias && !ctx.orchestratorStore.isAliasAvailable(newAlias, orchId)) {
        json(res, 409, { error: `Alias "${newAlias}" is already in use` });
        return true;
      }
      parsed.alias = newAlias || null;
    }

    if (parsed.timezone !== undefined) {
      if (typeof parsed.timezone !== 'string') {
        json(res, 400, { error: 'timezone must be a string' });
        return true;
      }
      try {
        parsed.timezone = resolveAndValidateTimezone(parsed.timezone);
      } catch (err) {
        json(res, 400, { error: errorMessage(err) });
        return true;
      }
    }

    if (parsed.scheduleType !== undefined) {
      if (parsed.scheduleType !== null && typeof parsed.scheduleType !== 'string') {
        json(res, 400, { error: 'scheduleType must be one of: once, recurring, or null' });
        return true;
      }
      if (
        typeof parsed.scheduleType === 'string' &&
        !VALID_SCHEDULE_TYPES.has(parsed.scheduleType)
      ) {
        json(res, 400, {
          error: `Invalid scheduleType: ${parsed.scheduleType}. Must be one of: ${[...VALID_SCHEDULE_TYPES].join(', ')}`,
        });
        return true;
      }
    }

    if (parsed.errorPolicy !== undefined) {
      if (typeof parsed.errorPolicy !== 'string') {
        json(res, 400, { error: 'errorPolicy must be one of: fail_fast, continue' });
        return true;
      }
      if (!VALID_ERROR_POLICIES.has(parsed.errorPolicy)) {
        json(res, 400, {
          error: `Invalid errorPolicy: ${parsed.errorPolicy}. Must be one of: ${[...VALID_ERROR_POLICIES].join(', ')}`,
        });
        return true;
      }
    }

    // Validate enabledSkills if provided
    if (parsed.enabledSkills !== undefined) {
      const skillCatalog = discoverCatalogForSkillValidation(ctx.config);
      const orchSkillsResult = parseEnabledSkills(
        parsed.enabledSkills,
        skillCatalog,
        'enabledSkills',
      );
      if (orchSkillsResult.error) {
        json(res, 400, { error: orchSkillsResult.error });
        return true;
      }
      parsed.enabledSkills = orchSkillsResult.skills;
    }

    if (parsed.summaryEnabled !== undefined) {
      parsed.summaryEnabled = normalizeSummaryEnabled(parsed.summaryEnabled);
    }
    if (parsed.summaryTool !== undefined) {
      const summaryToolResult = parseSummaryTool(parsed.summaryTool);
      if (summaryToolResult.error) {
        json(res, 400, { error: summaryToolResult.error });
        return true;
      }
      parsed.summaryTool = summaryToolResult.value;
    }

    const effectiveSummaryEnabled =
      parsed.summaryEnabled !== undefined ? Boolean(parsed.summaryEnabled) : orch.summaryEnabled;
    const effectiveSummaryTool =
      parsed.summaryTool !== undefined
        ? (parsed.summaryTool as typeof orch.summaryTool)
        : orch.summaryTool;
    if (effectiveSummaryEnabled && !effectiveSummaryTool) {
      json(res, 400, { error: 'summaryTool is required when summaryEnabled is true' });
      return true;
    }

    if (parsed.maxRunWorkdirs !== undefined) {
      if (
        typeof parsed.maxRunWorkdirs !== 'number' ||
        !Number.isInteger(parsed.maxRunWorkdirs) ||
        parsed.maxRunWorkdirs < 0
      ) {
        json(res, 400, { error: 'maxRunWorkdirs must be a non-negative integer' });
        return true;
      }
    }

    // Restrict updatable fields — prevent clients from setting status, runCount, claimedAt, etc.
    const allowedKeys = new Set([
      'name',
      'alias',
      'description',
      'workdir',
      'scheduleType',
      'runAt',
      'cronExpr',
      'timezone',
      'notifyChannel',
      'maxParallelism',
      'maxTotalNodes',
      'errorPolicy',
      'timeoutSec',
      'instructionFile',
      'enabledSkills',
      'summaryEnabled',
      'summaryTool',
      'maxRunWorkdirs',
    ]);
    const safePatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (allowedKeys.has(k)) safePatch[k] = v;
    }

    if (safePatch.workdir !== undefined) {
      const orchestratorWorkdirResult = validateNodeWorkdir(ctx, safePatch.workdir);
      if (orchestratorWorkdirResult.error) {
        json(res, 400, { error: orchestratorWorkdirResult.error });
        return true;
      }
      safePatch.workdir = orchestratorWorkdirResult.value;
    }

    const patchLimitsError = validateOrchestratorLimits({
      maxParallelism: safePatch.maxParallelism,
      maxTotalNodes: safePatch.maxTotalNodes,
      timeoutSec: safePatch.timeoutSec,
    });
    if (patchLimitsError) {
      json(res, 400, { error: patchLimitsError });
      return true;
    }

    // Recompute nextRunAt when schedule fields change
    const effectiveScheduleType = (safePatch.scheduleType ?? orch.scheduleType) as string | null;
    const effectiveRunAt = (safePatch.runAt ?? orch.runAt) as string | null;
    const effectiveCronExpr = (safePatch.cronExpr ?? orch.cronExpr) as string | null;
    const effectiveTimezone = (safePatch.timezone ?? orch.timezone) as string;

    if (
      'scheduleType' in safePatch ||
      'runAt' in safePatch ||
      'cronExpr' in safePatch ||
      'timezone' in safePatch
    ) {
      if (effectiveScheduleType === 'once' && effectiveRunAt) {
        const runDate = new Date(effectiveRunAt);
        safePatch.nextRunAt =
          !Number.isNaN(runDate.getTime()) && runDate.getTime() > Date.now() - 60_000
            ? runDate.toISOString()
            : null;
      } else if (effectiveScheduleType === 'recurring' && effectiveCronExpr) {
        const cronError = validateCronExpr(effectiveCronExpr);
        safePatch.nextRunAt = cronError
          ? null
          : getNextCronRun(effectiveCronExpr, effectiveTimezone);
      } else {
        safePatch.nextRunAt = null;
      }
      // Release any existing claim when schedule changes
      safePatch.claimedAt = null;
    }

    const expectedUpdatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined;
    try {
      ctx.orchestratorStore.update(orchId, safePatch as OrchestratorPatch, expectedUpdatedAt);
    } catch (err) {
      if (err instanceof StaleUpdateError) {
        json(res, 409, { error: err.message });
        return true;
      }
      const msg = errorMessage(err);
      if (msg.includes('already in use')) {
        json(res, 409, { error: msg });
        return true;
      }
      throw err;
    }

    const updated = ctx.orchestratorStore.getById(orchId);
    json(res, 200, { ok: true, data: updated });
    return true;
  }

  // DELETE /api/orchestrators/:id — soft delete + workdir cleanup
  if (req.method === 'DELETE' && orchId) {
    const orch = ctx.orchestratorStore.getById(orchId);
    if (!orch || orch.status === 'deleted') {
      json(res, 404, { error: 'Orchestrator not found' });
      return true;
    }

    // Clean up auto-generated run workdirs before soft-deleting
    if (!orch.workdir) {
      const runIds = ctx.orchestratorStore.getAllRunIds(orchId);
      let cleaned = 0;
      for (const runId of runIds) {
        try {
          const workdir = path.join(ctx.config.workdirRoot, `orch_${runId.slice(0, 8)}`);
          cleanupWorkdir(ctx.config.workdirRoot, workdir);
          cleaned++;
        } catch (err) {
          logger.warn('orchestrator_delete_workdir_cleanup_failed', {
            orchestratorId: orchId,
            runId,
            error: errorMessage(err),
          });
        }
      }
      if (cleaned > 0) {
        logger.info('orchestrator_delete_workdirs_cleaned', {
          orchestratorId: orchId,
          cleaned,
        });
      }
    }

    ctx.orchestratorStore.softDelete(orchId);
    await ctx.eventRouter.reload();
    json(res, 200, { ok: true });
    return true;
  }

  // ── Run Queries ──────────────────────────────────────────

  // GET /api/orchestrators/:id/runs — list runs
  const orchRunsId = matchOrchestratorRuns(pathname);
  if (req.method === 'GET' && orchRunsId) {
    const orch = ctx.orchestratorStore.getById(orchRunsId);
    if (!orch || orch.status === 'deleted') {
      json(res, 404, { error: 'Orchestrator not found' });
      return true;
    }
    const runs = ctx.orchestratorStore.getRunsByOrchestrator(orchRunsId);
    json(res, 200, { ok: true, data: runs });
    return true;
  }

  // GET /api/orchestrators/:id/runs/:runId — run detail with node runs
  const orchRunIdMatch = matchOrchestratorRunId(pathname);
  if (req.method === 'GET' && orchRunIdMatch) {
    const run = ctx.orchestratorStore.getRunById(orchRunIdMatch.runId);
    if (!run || run.orchestratorId !== orchRunIdMatch.orchestratorId) {
      json(res, 404, { error: 'Run not found' });
      return true;
    }
    const nodeRuns = ctx.orchestratorStore.getNodeRunsByRun(orchRunIdMatch.runId);
    json(res, 200, { ok: true, data: { ...run, nodeRuns } });
    return true;
  }

  // GET /api/orchestrators/:id/runs-overview — aggregated runs + node runs
  const orchRunsOverviewId = matchOrchestratorRunsOverview(pathname);
  if (req.method === 'GET' && orchRunsOverviewId) {
    const orch = ctx.orchestratorStore.getById(orchRunsOverviewId);
    if (!orch || orch.status === 'deleted') {
      json(res, 404, { error: 'Orchestrator not found' });
      return true;
    }
    const nodes = ctx.orchestratorStore.getNodesByOrchestrator(orchRunsOverviewId);
    const edges = ctx.orchestratorStore.getEdgesByOrchestrator(orchRunsOverviewId);
    const runs = ctx.orchestratorStore.getRunsByOrchestrator(orchRunsOverviewId, 50);
    const runDetails = runs.map((run) => ({
      ...run,
      nodeRuns: ctx.orchestratorStore.getNodeRunsByRun(run.id),
    }));
    json(res, 200, {
      ok: true,
      data: { orchestrator: { ...orch, nodes, edges }, runs: runDetails },
    });
    return true;
  }

  return false;
}
