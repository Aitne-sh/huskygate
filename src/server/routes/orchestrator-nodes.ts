/** @module server/routes/orchestrator-nodes — Node CRUD routes for orchestrators. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isToolName } from '../../config.js';
import type { AppContext } from '../../context/app-context.js';
import { validateOrchestratorNodeLimits } from '../../orchestrator/orchestrator-limits.js';
import type { NodePatch } from '../../orchestrator/types-patch.js';
import type {
  GateCondition,
  OrchestratorNode,
  TriggeredNodeConfig,
} from '../../orchestrator/types.js';
import { normalizeModel } from '../../shared/normalize-model.js';
import { normalizeBool } from '../../queue/types.js';
import { json, readBody } from '../../shared/http.js';
import { matchOrchestratorNodeId, matchOrchestratorNodes } from '../../shared/route-matchers.js';
import { GateModeSchema, NodeTypeSchema } from '../../shared/schemas/common.js';
import { StaleUpdateError } from '../../store/store-utils.js';
import { errorMessage } from '../../utils/error.js';
import { parseInlineEventSubscriptionInput } from './inline-event-subscription.js';
import {
  VALID_OUTPUT_MODES,
  validateEnabledMcpServerIds,
  validateNodeInstructionFile,
  validateNodeWorkdir,
  validateReturnConditions,
  validateTriggeredConfig,
} from './orchestrator-shared.js';

/**
 * Handle node CRUD routes for orchestrators.
 *
 * Returns `true` if the route was handled (response sent), `false` otherwise.
 */
export async function handleOrchestratorNodeRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  // ── Node CRUD ─────────────────────────────────────────────

  // POST /api/orchestrators/:id/nodes — create node
  const orchNodesId = matchOrchestratorNodes(pathname);
  if (req.method === 'POST' && orchNodesId) {
    const orch = ctx.orchestratorStore.getById(orchNodesId);
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

    const label = typeof parsed.label === 'string' ? parsed.label.trim() : '';
    if (!label) {
      json(res, 400, { error: 'label is required' });
      return true;
    }

    const VALID_NODE_TYPES: ReadonlySet<string> = new Set(NodeTypeSchema.options);
    const rawNodeType = typeof parsed.nodeType === 'string' ? parsed.nodeType : 'task';
    if (!VALID_NODE_TYPES.has(rawNodeType)) {
      json(res, 400, {
        error: `Invalid nodeType: ${rawNodeType}. Must be one of: ${[...VALID_NODE_TYPES].join(', ')}`,
      });
      return true;
    }
    const nodeType = rawNodeType as 'task' | 'triggered' | 'gate' | 'end';

    // Validate tool
    if (typeof parsed.tool === 'string' && parsed.tool && !isToolName(parsed.tool)) {
      json(res, 400, { error: `Invalid tool: ${parsed.tool}` });
      return true;
    }

    // Normalize model
    let model: string | null = null;
    try {
      model = normalizeModel(parsed.model);
    } catch (e) {
      json(res, 400, { error: (e as Error).message });
      return true;
    }

    // Parse returnValues
    let returnValues: string[] | null = null;
    if (parsed.returnValues !== undefined && parsed.returnValues !== null) {
      if (Array.isArray(parsed.returnValues)) {
        returnValues = (parsed.returnValues as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        );
      }
    }

    // Validate gateCondition
    const VALID_GATE_MODES: ReadonlySet<string> = new Set(GateModeSchema.options);
    if (parsed.gateCondition != null) {
      const gc = parsed.gateCondition as Record<string, unknown>;
      if (typeof gc.mode === 'string' && !VALID_GATE_MODES.has(gc.mode)) {
        json(res, 400, {
          error: `Invalid gateCondition.mode: ${gc.mode}. Must be one of: ${[...VALID_GATE_MODES].join(', ')}`,
        });
        return true;
      }
      if (gc.matchValue !== undefined && typeof gc.matchValue !== 'string') {
        json(res, 400, { error: 'gateCondition.matchValue must be a string' });
        return true;
      }
    }

    // Validate outputMode
    const outputMode =
      typeof parsed.outputMode === 'string' && VALID_OUTPUT_MODES.has(parsed.outputMode)
        ? (parsed.outputMode as 'auto' | 'manual')
        : 'auto';

    // Validate returnConditions
    const rcResult = validateReturnConditions(parsed.returnConditions);
    if (rcResult.error) {
      json(res, 400, { error: rcResult.error });
      return true;
    }
    const returnConditions = rcResult.conditions;
    const triggeredConfigResult = validateTriggeredConfig(parsed.triggeredConfig);
    if (triggeredConfigResult.error) {
      json(res, 400, { error: triggeredConfigResult.error });
      return true;
    }

    // End nodes have no tool, prompt, or output ports
    const isEnd = nodeType === 'end';
    const isTaskLike = nodeType === 'task' || nodeType === 'triggered';
    const isGate = nodeType === 'gate';
    const nodeTool =
      !isEnd && typeof parsed.tool === 'string' && isToolName(parsed.tool) ? parsed.tool : null;
    const workdirResult = isTaskLike ? validateNodeWorkdir(ctx, parsed.workdir) : { value: null };
    if ('error' in workdirResult && workdirResult.error) {
      json(res, 400, { error: workdirResult.error });
      return true;
    }
    const instructionFileResult = isTaskLike
      ? validateNodeInstructionFile(parsed.instructionFile)
      : { value: null };
    if ('error' in instructionFileResult && instructionFileResult.error) {
      json(res, 400, { error: instructionFileResult.error });
      return true;
    }
    const enabledMcpServerIdsResult = isTaskLike
      ? validateEnabledMcpServerIds(ctx, nodeTool, parsed.enabledMcpServerIds)
      : { value: null };
    if ('error' in enabledMcpServerIdsResult && enabledMcpServerIdsResult.error) {
      json(res, 400, { error: enabledMcpServerIdsResult.error });
      return true;
    }
    const nodeLimitsError = isTaskLike
      ? validateOrchestratorNodeLimits({
          maxRetries: parsed.maxRetries,
          timeoutSec: parsed.timeoutSec,
          waitTimeoutSec: triggeredConfigResult.value?.waitTimeoutSec,
        })
      : null;
    if (nodeLimitsError) {
      json(res, 400, { error: nodeLimitsError });
      return true;
    }

    const inlineSubscription = parseInlineEventSubscriptionInput(
      parsed.triggeredSubscription,
      'triggeredSubscription',
    );
    if (inlineSubscription.error) {
      json(res, 400, { error: inlineSubscription.error });
      return true;
    }
    const triggeredSubscription = inlineSubscription.value;
    if (triggeredSubscription.kind === 'upsert' && nodeType !== 'triggered') {
      json(res, 400, { error: 'triggeredSubscription is only supported for triggered nodes' });
      return true;
    }
    if (
      triggeredSubscription.kind === 'upsert' &&
      !ctx.webhookEndpointStore.getById(triggeredSubscription.endpointId)
    ) {
      json(res, 400, { error: 'endpointId not found' });
      return true;
    }

    // Validate agentId exists if provided
    const agentId =
      isTaskLike && typeof parsed.agentId === 'string' ? parsed.agentId || null : null;
    if (agentId && !ctx.agentStore.getById(agentId)) {
      json(res, 400, { error: 'Agent not found' });
      return true;
    }

    // Force outputMode to 'auto' when agent is assigned
    const effectiveOutputMode = agentId ? 'auto' : outputMode;

    let node: OrchestratorNode;
    try {
      node = ctx.orchestratorStore.transaction(() => {
        const created = ctx.orchestratorStore.createNode({
          orchestratorId: orchNodesId,
          label,
          nodeType,
          agentId,
          tool: nodeTool,
          model,
          prompt: isEnd ? null : typeof parsed.prompt === 'string' ? parsed.prompt : null,
          maxRetries: typeof parsed.maxRetries === 'number' ? parsed.maxRetries : 0,
          timeoutSec: typeof parsed.timeoutSec === 'number' ? parsed.timeoutSec : null,
          allowMcp: normalizeBool(parsed.allowMcp),
          enabledMcpServerIds: isTaskLike ? (enabledMcpServerIdsResult.value ?? null) : null,
          workdir: isTaskLike ? (workdirResult.value ?? null) : null,
          writeInstructionFile: isTaskLike
            ? normalizeBool(parsed.writeInstructionFile, true)
            : true,
          instructionFile: isTaskLike ? (instructionFileResult.value ?? null) : null,
          outputMode: effectiveOutputMode,
          returnConditions: isEnd ? null : returnConditions,
          returnValues: isEnd ? null : isGate ? ['true', 'false'] : returnValues,
          gateCondition:
            isGate && parsed.gateCondition != null ? (parsed.gateCondition as GateCondition) : null,
          triggeredConfig: nodeType === 'triggered' ? (triggeredConfigResult.value ?? null) : null,
          notifyEnabled: parsed.notifyEnabled === true,
          notifyChannel: typeof parsed.notifyChannel === 'string' ? parsed.notifyChannel : null,
          notifyOnError: parsed.notifyOnError !== false,
          positionX: typeof parsed.positionX === 'number' ? parsed.positionX : 0,
          positionY: typeof parsed.positionY === 'number' ? parsed.positionY : 0,
          sortOrder: typeof parsed.sortOrder === 'number' ? parsed.sortOrder : 0,
        });
        // Create subscription atomically with node
        if (triggeredSubscription.kind === 'upsert' && created) {
          ctx.eventSubscriptionStore.create({
            endpointId: triggeredSubscription.endpointId,
            targetType: 'triggered_node',
            orchestratorId: null,
            triggeredTaskId: null,
            nodeId: created.id,
            filterJson: triggeredSubscription.filterJson,
            contextMappingJson: triggeredSubscription.contextMappingJson,
            enabled: triggeredSubscription.enabled,
          });
        }
        return created;
      });
    } catch (err) {
      json(res, 400, { error: errorMessage(err) });
      return true;
    }
    ctx.orchestratorStore.invalidateDag(orchNodesId);
    if (triggeredSubscription.kind === 'upsert') {
      await ctx.eventRouter.reload();
    }
    json(res, 201, { ok: true, data: node });
    return true;
  }

  // PATCH /api/orchestrators/:oid/nodes/:nid — update node
  const orchNodeId = matchOrchestratorNodeId(pathname);
  if (req.method === 'PATCH' && orchNodeId) {
    const node = ctx.orchestratorStore.getNodeById(orchNodeId.nodeId);
    if (!node) {
      json(res, 404, { error: 'Node not found' });
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
    // Whitelist allowed keys (args excluded — deprecated)
    const nodeAllowedKeys = new Set([
      'label',
      'nodeType',
      'agentId',
      'tool',
      'model',
      'prompt',
      'maxRetries',
      'timeoutSec',
      'allowMcp',
      'enabledMcpServerIds',
      'workdir',
      'writeInstructionFile',
      'instructionFile',
      'outputMode',
      'returnConditions',
      'returnValues',
      'gateCondition',
      'triggeredConfig',
      'notifyEnabled',
      'notifyChannel',
      'notifyOnError',
      'positionX',
      'positionY',
      'sortOrder',
    ]);
    const safeParsed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (nodeAllowedKeys.has(k)) safeParsed[k] = v;
    }
    const requestedPatchKeys = new Set(Object.keys(safeParsed));

    // ── Fast path for position-only updates ──
    // Position saves happen in the background via debounced drag events.
    // They must NOT bump updated_at, which is used for optimistic concurrency
    // on content saves — otherwise a background position save can race with a
    // user-initiated content save and cause a spurious StaleUpdateError.
    const POSITION_ONLY_KEYS: ReadonlySet<string> = new Set([
      'positionX',
      'positionY',
      'sortOrder',
    ]);
    const patchKeyArr = [...requestedPatchKeys];
    if (patchKeyArr.length > 0 && patchKeyArr.every((k) => POSITION_ONLY_KEYS.has(k))) {
      try {
        ctx.orchestratorStore.updateNode(
          orchNodeId.nodeId,
          safeParsed as NodePatch,
          undefined, // no concurrency check for position-only
          { autoTimestamp: false },
        );
      } catch (err) {
        json(res, 400, { error: errorMessage(err) });
        return true;
      }
      const updated = ctx.orchestratorStore.getNodeById(orchNodeId.nodeId);
      json(res, 200, { ok: true, data: updated });
      return true;
    }

    // Normalize agentId (string → string | null) and validate existence
    if ('agentId' in safeParsed) {
      safeParsed.agentId =
        typeof safeParsed.agentId === 'string' && safeParsed.agentId ? safeParsed.agentId : null;
      if (safeParsed.agentId && !ctx.agentStore.getById(safeParsed.agentId as string)) {
        json(res, 400, { error: 'Agent not found' });
        return true;
      }
    }
    // Force outputMode to 'auto' when agent is assigned (patched or existing).
    // Also preserve returnConditions — if the client sends null because it
    // thinks manual mode is active, restore the existing conditions so the
    // forced auto mode still has routing data.
    const patchEffectiveAgentId =
      'agentId' in safeParsed ? (safeParsed.agentId as string | null) : node.agentId;
    if (patchEffectiveAgentId) {
      safeParsed.outputMode = 'auto';
      if (
        'returnConditions' in safeParsed &&
        safeParsed.returnConditions === null &&
        node.returnConditions
      ) {
        safeParsed.returnConditions = node.returnConditions;
      }
    }
    // Validate tool if provided
    if (typeof safeParsed.tool === 'string' && safeParsed.tool && !isToolName(safeParsed.tool)) {
      json(res, 400, { error: `Invalid tool: ${safeParsed.tool}` });
      return true;
    }
    // Normalize model if provided
    if ('model' in safeParsed) {
      try {
        safeParsed.model = normalizeModel(safeParsed.model);
      } catch (e) {
        json(res, 400, { error: (e as Error).message });
        return true;
      }
    }
    // Validate allowMcp if provided (normalize to boolean)
    if (safeParsed.allowMcp !== undefined) {
      safeParsed.allowMcp = normalizeBool(safeParsed.allowMcp, false);
    }
    // Validate gateCondition if provided
    if (safeParsed.gateCondition != null) {
      const gc = safeParsed.gateCondition as Record<string, unknown>;
      const patchGateModes: ReadonlySet<string> = new Set(GateModeSchema.options);
      if (typeof gc.mode === 'string' && !patchGateModes.has(gc.mode)) {
        json(res, 400, {
          error: `Invalid gateCondition.mode: ${gc.mode}. Must be one of: ${[...patchGateModes].join(', ')}`,
        });
        return true;
      }
      if (gc.matchValue !== undefined && typeof gc.matchValue !== 'string') {
        json(res, 400, { error: 'gateCondition.matchValue must be a string' });
        return true;
      }
    }

    // Validate outputMode if provided
    if (safeParsed.outputMode !== undefined) {
      if (
        typeof safeParsed.outputMode !== 'string' ||
        !VALID_OUTPUT_MODES.has(safeParsed.outputMode)
      ) {
        json(res, 400, {
          error: `Invalid outputMode: ${safeParsed.outputMode}. Must be one of: auto, manual`,
        });
        return true;
      }
    }

    // Validate returnConditions if provided
    if (safeParsed.returnConditions !== undefined) {
      const rcResult = validateReturnConditions(safeParsed.returnConditions);
      if (rcResult.error) {
        json(res, 400, { error: rcResult.error });
        return true;
      }
      safeParsed.returnConditions = rcResult.conditions;
    }
    if (safeParsed.triggeredConfig !== undefined) {
      const triggeredConfigResult = validateTriggeredConfig(safeParsed.triggeredConfig);
      if (triggeredConfigResult.error) {
        json(res, 400, { error: triggeredConfigResult.error });
        return true;
      }
      safeParsed.triggeredConfig = triggeredConfigResult.value;
    }

    // Normalize returnValues for the store
    if (safeParsed.returnValues !== undefined) {
      if (safeParsed.returnValues === null) {
        // keep null
      } else if (Array.isArray(safeParsed.returnValues)) {
        safeParsed.returnValues = (safeParsed.returnValues as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        );
      } else {
        safeParsed.returnValues = undefined; // invalid, ignore
      }
    }

    // Enforce nodeType-specific returnValues constraints
    const effectiveNodeType =
      typeof safeParsed.nodeType === 'string' ? safeParsed.nodeType : node.nodeType;
    const nextTool =
      typeof safeParsed.tool === 'string' && isToolName(safeParsed.tool)
        ? safeParsed.tool
        : node.tool;
    const isChangingTool =
      typeof safeParsed.tool === 'string' &&
      isToolName(safeParsed.tool) &&
      safeParsed.tool !== node.tool;
    const touchedTaskOnlyFields =
      'workdir' in safeParsed ||
      'enabledMcpServerIds' in safeParsed ||
      'writeInstructionFile' in safeParsed ||
      'instructionFile' in safeParsed;
    if (effectiveNodeType === 'task' || effectiveNodeType === 'triggered') {
      if (safeParsed.writeInstructionFile !== undefined) {
        safeParsed.writeInstructionFile = normalizeBool(safeParsed.writeInstructionFile, true);
      }
      if (safeParsed.workdir !== undefined) {
        const workdirResult = validateNodeWorkdir(ctx, safeParsed.workdir);
        if (workdirResult.error) {
          json(res, 400, { error: workdirResult.error });
          return true;
        }
        safeParsed.workdir = workdirResult.value;
      }
      if (safeParsed.instructionFile !== undefined) {
        const instructionFileResult = validateNodeInstructionFile(safeParsed.instructionFile);
        if (instructionFileResult.error) {
          json(res, 400, { error: instructionFileResult.error });
          return true;
        }
        safeParsed.instructionFile = instructionFileResult.value;
      }
      if (safeParsed.enabledMcpServerIds !== undefined) {
        const enabledMcpServerIdsResult = validateEnabledMcpServerIds(
          ctx,
          nextTool,
          safeParsed.enabledMcpServerIds,
        );
        if (enabledMcpServerIdsResult.error) {
          json(res, 400, { error: enabledMcpServerIdsResult.error });
          return true;
        }
        safeParsed.enabledMcpServerIds = enabledMcpServerIdsResult.value;
      } else if (isChangingTool) {
        safeParsed.enabledMcpServerIds = null;
      }
    }
    // ── nodeType-transition field cleanup ──
    // When nodeType changes, clear fields that belong to the *old* type
    // to prevent stale data from persisting in the DB.
    const isChangingNodeType =
      safeParsed.nodeType !== undefined && safeParsed.nodeType !== node.nodeType;

    // Clear task/triggered-specific fields when moving away from task/triggered
    if (effectiveNodeType !== 'task' && effectiveNodeType !== 'triggered') {
      const wasTaskLike =
        node.nodeType === 'task' || node.nodeType === 'triggered' || touchedTaskOnlyFields;
      if (wasTaskLike) {
        safeParsed.workdir = null;
        safeParsed.writeInstructionFile = true;
        safeParsed.instructionFile = null;
        safeParsed.tool = null;
        safeParsed.prompt = null;
        safeParsed.maxRetries = 0;
        safeParsed.timeoutSec = null;
        safeParsed.allowMcp = true;
        safeParsed.enabledMcpServerIds = null;
        safeParsed.outputMode = 'auto';
        safeParsed.returnConditions = null;
      } else {
        safeParsed.workdir = undefined;
        safeParsed.enabledMcpServerIds = undefined;
        safeParsed.writeInstructionFile = undefined;
        safeParsed.instructionFile = undefined;
      }
    }

    // Clear gate-specific fields when moving away from gate
    if (effectiveNodeType !== 'gate' && isChangingNodeType && node.nodeType === 'gate') {
      safeParsed.gateCondition = null;
    }

    // Enforce per-type returnValues and triggeredConfig
    if (effectiveNodeType === 'end') {
      safeParsed.returnValues = null;
      safeParsed.triggeredConfig = null;
      safeParsed.gateCondition = null;
    } else if (effectiveNodeType === 'gate') {
      safeParsed.returnValues = ['true', 'false'];
      safeParsed.triggeredConfig = null;
    } else if (effectiveNodeType === 'task') {
      safeParsed.triggeredConfig = null;
    }
    if (effectiveNodeType === 'task' || effectiveNodeType === 'triggered') {
      const nodeLimitsError = validateOrchestratorNodeLimits({
        maxRetries: safeParsed.maxRetries,
        timeoutSec: safeParsed.timeoutSec,
        waitTimeoutSec:
          safeParsed.triggeredConfig !== undefined &&
          safeParsed.triggeredConfig !== null &&
          typeof safeParsed.triggeredConfig === 'object'
            ? (safeParsed.triggeredConfig as TriggeredNodeConfig).waitTimeoutSec
            : undefined,
      });
      if (nodeLimitsError) {
        json(res, 400, { error: nodeLimitsError });
        return true;
      }
    }
    const clearsTriggeredSubscription =
      node.nodeType === 'triggered' && effectiveNodeType !== 'triggered';
    const expectedUpdatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined;

    const inlineSubscription = parseInlineEventSubscriptionInput(
      parsed.triggeredSubscription,
      'triggeredSubscription',
    );
    if (inlineSubscription.error) {
      json(res, 400, { error: inlineSubscription.error });
      return true;
    }
    const triggeredSubscription = inlineSubscription.value;
    if (triggeredSubscription.kind === 'upsert' && effectiveNodeType !== 'triggered') {
      json(res, 400, { error: 'triggeredSubscription is only supported for triggered nodes' });
      return true;
    }
    if (
      triggeredSubscription.kind === 'upsert' &&
      !ctx.webhookEndpointStore.getById(triggeredSubscription.endpointId)
    ) {
      json(res, 400, { error: 'endpointId not found' });
      return true;
    }

    try {
      const orchestrator = ctx.orchestratorStore.getById(orchNodeId.orchestratorId);
      if (
        orchestrator &&
        orchestrator.startNodeId === orchNodeId.nodeId &&
        safeParsed.nodeType !== undefined &&
        safeParsed.nodeType !== 'task'
      ) {
        json(res, 400, { error: 'Start node type cannot be changed' });
        return true;
      }

      // Wrap node update + subscription upsert in a single transaction
      ctx.orchestratorStore.transaction(() => {
        ctx.orchestratorStore.updateNode(
          orchNodeId.nodeId,
          safeParsed as NodePatch,
          expectedUpdatedAt,
        );

        const shouldManageTriggeredSubscription =
          clearsTriggeredSubscription ||
          (triggeredSubscription.kind !== 'omit' && effectiveNodeType === 'triggered');
        if (shouldManageTriggeredSubscription) {
          const existingSub = ctx.eventSubscriptionStore.getTriggeredNodeSubscription(
            orchNodeId.nodeId,
          );
          if (clearsTriggeredSubscription) {
            if (existingSub) ctx.eventSubscriptionStore.delete(existingSub.id);
          } else {
            if (triggeredSubscription.kind === 'remove') {
              if (existingSub) ctx.eventSubscriptionStore.delete(existingSub.id);
            } else if (triggeredSubscription.kind === 'upsert' && existingSub) {
              ctx.eventSubscriptionStore.update(existingSub.id, {
                endpointId: triggeredSubscription.endpointId,
                filterJson: triggeredSubscription.filterJson,
                contextMappingJson: triggeredSubscription.contextMappingJson,
                enabled: triggeredSubscription.enabled,
              });
            } else if (triggeredSubscription.kind === 'upsert') {
              ctx.eventSubscriptionStore.create({
                endpointId: triggeredSubscription.endpointId,
                targetType: 'triggered_node',
                orchestratorId: null,
                triggeredTaskId: null,
                nodeId: orchNodeId.nodeId,
                filterJson: triggeredSubscription.filterJson,
                contextMappingJson: triggeredSubscription.contextMappingJson,
                enabled: triggeredSubscription.enabled,
              });
            }
          }
        }
      });
    } catch (err) {
      if (err instanceof StaleUpdateError) {
        json(res, 409, { error: err.message });
        return true;
      }
      json(res, 400, { error: errorMessage(err) });
      return true;
    }
    // Position-only patches exit via the fast path above, so all remaining
    // patches contain content changes that invalidate the DAG.
    ctx.orchestratorStore.invalidateDag(orchNodeId.orchestratorId);
    if (clearsTriggeredSubscription || triggeredSubscription.kind !== 'omit') {
      await ctx.eventRouter.reload();
    }
    const updated = ctx.orchestratorStore.getNodeById(orchNodeId.nodeId);
    json(res, 200, { ok: true, data: updated });
    return true;
  }

  // DELETE /api/orchestrators/:oid/nodes/:nid — delete node (cascades edges)
  if (req.method === 'DELETE' && orchNodeId) {
    const node = ctx.orchestratorStore.getNodeById(orchNodeId.nodeId);
    if (!node) {
      json(res, 404, { error: 'Node not found' });
      return true;
    }
    const orchestrator = ctx.orchestratorStore.getById(orchNodeId.orchestratorId);
    if (orchestrator && orchestrator.startNodeId === orchNodeId.nodeId) {
      json(res, 400, { error: 'Start node cannot be deleted' });
      return true;
    }
    try {
      ctx.orchestratorStore.deleteNode(orchNodeId.nodeId);
    } catch (err) {
      json(res, 400, { error: errorMessage(err) });
      return true;
    }
    await ctx.eventRouter.reload();
    ctx.orchestratorStore.invalidateDag(orchNodeId.orchestratorId);
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
