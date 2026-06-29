/** @module engine-executor — Node execution, gate/end completion, retry logic, and readiness checks. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { appendTriggerContext } from '../event/trigger-context.js';
import type { Job } from '../queue/types.js';
import type { RunResult } from '../runner/types.js';
import { isTerminalRunStatus } from '../shared/status.js';
import type { SkillRef } from '../skills/catalog.js';
import { logger } from '../utils/logger.js';
import { evaluateEdgeCondition, evaluateGateCondition } from './dag.js';
import { sendNodeNotification } from './engine-notify.js';
import {
  ERROR_RETURN,
  OTHER_RETURN,
  resolveNodeInstructionFile,
  resolveNodeWorkdir,
} from './engine-utils.js';
import type { EngineContext } from './engine.js';
import {
  buildFallbackReturnTemplate,
  buildReturnTemplateFromConditions,
  parseReturnValue,
} from './return-value.js';
import type {
  ActiveOrchestrationRun,
  AiAgent,
  NodeRunStatus,
  OrchestrationNodeRun,
  OrchestratorNode,
} from './types.js';

/** Resolve model override for a node: node.model takes priority over agent.model. */
function resolveNodeModel(
  node: Pick<OrchestratorNode, 'model'>,
  agent: Pick<AiAgent, 'model'> | null,
): string | null {
  return node.model ?? agent?.model ?? null;
}

function cleanupSynchronousNodeSession(
  ctx: EngineContext,
  active: ActiveOrchestrationRun,
  node: OrchestratorNode,
  sessionKey: string,
): void {
  try {
    ctx.cleanupSession(sessionKey);
  } catch (err) {
    logger.warn('orchestrator_sync_session_cleanup_failed', {
      runId: active.runId,
      nodeId: node.id,
      sessionKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (!node.workdir && !active.orchestrator.workdir && ctx.cleanupRunWorkdir) {
    try {
      ctx.cleanupRunWorkdir(active.runId);
    } catch (err) {
      logger.warn('orchestrator_sync_run_workdir_cleanup_failed', {
        runId: active.runId,
        nodeId: node.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function buildNodePrompt(
  active: ActiveOrchestrationRun,
  node: OrchestratorNode,
  triggeredPayload: Record<string, unknown> | null = null,
): string {
  let effectivePrompt = node.prompt ?? '';
  if (node.id === active.orchestrator.startNodeId) {
    effectivePrompt = appendTriggerContext(
      effectivePrompt,
      'Trigger Event Context',
      active.triggerContext,
    );
  }
  if (node.nodeType === 'triggered' && triggeredPayload !== null) {
    effectivePrompt = appendTriggerContext(
      effectivePrompt,
      'Triggered Event Context',
      triggeredPayload,
    );
  }
  if (node.outputMode === 'auto') {
    if (node.returnConditions?.length) {
      effectivePrompt += `\n\n${buildReturnTemplateFromConditions(node.returnConditions)}`;
    } else if (node.returnValues?.length) {
      const fallback = buildFallbackReturnTemplate(node.returnValues);
      if (fallback) effectivePrompt += `\n\n${fallback}`;
    }
  }
  return effectivePrompt;
}

// ── Agent Resolution Helpers ──────────────────────────────────

/** Compose agent + node instructions (both layers applied, not override). */
export function composeInstructions(
  agentInstruction: string | null,
  nodeInstruction: string | null,
): string | null {
  if (!agentInstruction && !nodeInstruction) return null;
  if (!agentInstruction) return nodeInstruction;
  if (!nodeInstruction) return agentInstruction;
  return `${agentInstruction}\n\n---\n\n${nodeInstruction}`;
}

/** Intersect orchestrator skills with agent skills (narrowing only). */
export function intersectSkills(
  orchSkills: SkillRef[] | null,
  agentSkills: SkillRef[] | null,
): SkillRef[] | null {
  if (orchSkills === null) return agentSkills;
  if (agentSkills === null) return orchSkills;
  const orchSet = new Set(orchSkills);
  return agentSkills.filter((s) => orchSet.has(s));
}

/** Chain-narrow MCP server IDs (each level can only narrow). */
export function narrowMcpChain(
  agentMcpIds: string[] | null,
  nodeMcpIds: string[] | null,
): string[] | null {
  if (agentMcpIds === null) return nodeMcpIds;
  if (nodeMcpIds === null) return agentMcpIds;
  const agentSet = new Set(agentMcpIds);
  return nodeMcpIds.filter((id) => agentSet.has(id));
}

/** Resolve effective config by merging agent defaults into node config. */
function resolveAgentConfig(
  ctx: EngineContext,
  active: ActiveOrchestrationRun,
  node: OrchestratorNode,
): {
  agent: AiAgent | null;
  effectiveTool: string;
  effectiveSkills: SkillRef[] | null;
  effectiveMcpIds: string[] | null;
  agentInstruction: string | null;
} {
  const agent: AiAgent | null =
    node.agentId && ctx.agentStore ? ctx.agentStore.getById(node.agentId) : null;

  const effectiveTool = node.tool ?? agent?.tool ?? 'claude';
  const effectiveSkills = intersectSkills(
    active.orchestrator.enabledSkills,
    agent?.enabledSkills ?? null,
  );
  const agentMcpIds = agent?.enabledMcpServerIds ?? null;
  const effectiveMcpIds = narrowMcpChain(agentMcpIds, node.enabledMcpServerIds);
  const agentInstruction = agent?.systemInstruction ?? null;

  return { agent, effectiveTool, effectiveSkills, effectiveMcpIds, agentInstruction };
}

/** Check if a task/end node is ready — at least one live incoming edge must match. */
export function isTaskReady(
  active: ActiveOrchestrationRun,
  node: OrchestratorNode,
  skipCache?: Map<string, boolean>,
): boolean {
  const incoming = active.dag.incoming.get(node.id);

  if (!incoming || incoming.length === 0) return true;

  const DEAD_STATUSES = new Set(['skipped', 'failed', 'cancelled']);
  let anyEdgeMatched = false;
  let allDead = true;

  for (const edge of incoming) {
    const sourceRun = active.nodeRuns.get(edge.fromNodeId);

    if (!sourceRun) {
      const sourceNode = active.dag.nodes.get(edge.fromNodeId);
      if (sourceNode && isNodeSkippable(active, sourceNode, skipCache)) {
        continue;
      }
      return false;
    }

    if (DEAD_STATUSES.has(sourceRun.status)) continue;

    allDead = false;

    if (sourceRun.status !== 'completed') return false;

    if (evaluateEdgeCondition(edge.conditionValue, edge.conditionOperator, sourceRun.returnValue)) {
      anyEdgeMatched = true;
    }
  }

  // If all sources are dead, this node is unreachable (handled by isNodeSkippable)
  if (allDead) return false;

  return anyEdgeMatched;
}

/** Check if a gate node is ready — all incoming sources must be in a terminal state. */
export function isGateReady(
  active: ActiveOrchestrationRun,
  node: OrchestratorNode,
  skipCache?: Map<string, boolean>,
): boolean {
  if (!node.gateCondition) return false;

  const incoming = active.dag.incoming.get(node.id);
  if (!incoming || incoming.length === 0) return false;

  const sourceIds = new Set(incoming.map((e) => e.fromNodeId));

  for (const sourceId of sourceIds) {
    const sourceRun = active.nodeRuns.get(sourceId);
    if (!sourceRun) {
      const sourceNode = active.dag.nodes.get(sourceId);
      if (sourceNode && isNodeSkippable(active, sourceNode, skipCache)) {
        continue;
      }
      return false;
    }
    if (!isTerminalRunStatus(sourceRun.status)) return false;
  }

  return true;
}

/** Check if a node is unreachable (skippable). Memoized via `cache` to avoid exponential re-computation. */
export function isNodeSkippable(
  active: ActiveOrchestrationRun,
  node: OrchestratorNode,
  cache?: Map<string, boolean>,
): boolean {
  const cached = cache?.get(node.id);
  if (cached !== undefined) return cached;

  const result = isNodeSkippableCore(active, node, cache);
  cache?.set(node.id, result);
  return result;
}

function isNodeSkippableCore(
  active: ActiveOrchestrationRun,
  node: OrchestratorNode,
  cache?: Map<string, boolean>,
): boolean {
  const incoming = active.dag.incoming.get(node.id);
  if (!incoming || incoming.length === 0) return false; // Root nodes are not skippable

  // Skippable when every incoming path is dead or completed-but-unmatched
  const DEAD_STATUSES = new Set(['skipped', 'failed', 'cancelled']);
  for (const edge of incoming) {
    const sourceRun = active.nodeRuns.get(edge.fromNodeId);

    if (!sourceRun) {
      const sourceNode = active.dag.nodes.get(edge.fromNodeId);
      if (sourceNode && isNodeSkippable(active, sourceNode, cache)) {
        continue;
      }
      return false;
    }

    if (sourceRun.status === 'completed') {
      if (
        evaluateEdgeCondition(edge.conditionValue, edge.conditionOperator, sourceRun.returnValue)
      ) {
        return false;
      }
      continue;
    }

    if (DEAD_STATUSES.has(sourceRun.status)) {
      continue;
    }

    return false; // Source still pending/running
  }

  return true; // All source paths are dead or no condition matched
}

/** Execute a task node by creating a session and enqueuing a job. Returns true on synchronous failure. */
export async function executeTaskNode(
  ctx: EngineContext,
  active: ActiveOrchestrationRun,
  node: OrchestratorNode,
  retryCount = 0,
): Promise<boolean> {
  // Resolve agent config (graceful fallback to node-only if agent deleted)
  const agentConfig = resolveAgentConfig(ctx, active, node);
  const effectiveTool = agentConfig.effectiveTool;
  const nodeModel = resolveNodeModel(node, agentConfig.agent);

  if (!effectiveTool || !node.prompt) return false;

  const store = ctx.orchestratorStore;
  const workdir = resolveNodeWorkdir(active.orchestrator, node, active.runId);

  // Compose instruction: agent instruction + node instruction
  const composedInstruction = composeInstructions(
    agentConfig.agentInstruction,
    resolveNodeInstructionFile(active.orchestrator, node).content,
  );
  const instructionSkip = !node.writeInstructionFile;

  const nodeRun = store.createNodeRun({
    orchestrationRunId: active.runId,
    nodeId: node.id,
    status: 'running',
    retryCount,
    startedAt: new Date().toISOString(),
  });
  active.nodeRuns.set(node.id, nodeRun);
  active.runningCount++;

  // Tasks always run in write mode (non-interactive jobs are write-fixed)
  const session = ctx.createSession(
    effectiveTool as import('../config.js').ToolName,
    active.orchestrator.userId,
    'write',
    {
      skipWorkdir: true,
    },
  );

  try {
    fs.mkdirSync(workdir, { recursive: true });
    ctx.prepareWorkdir(
      workdir,
      effectiveTool as import('../config.js').ToolName,
      agentConfig.effectiveSkills,
    );
  } catch (err) {
    const errorMsg = `Workdir preparation failed: ${err instanceof Error ? err.message : String(err)}`;
    store.updateNodeRun(nodeRun.id, {
      status: 'failed',
      errorMessage: errorMsg,
      endedAt: new Date().toISOString(),
    });
    cleanupSynchronousNodeSession(ctx, active, node, session.sessionKey);
    active.runningCount = Math.max(0, active.runningCount - 1);
    const updated = store.getNodeRunById(nodeRun.id);
    if (updated) active.nodeRuns.set(node.id, updated);
    return true; // synchronous failure
  }

  const effectivePrompt = buildNodePrompt(active, node);
  const jobId = crypto.randomUUID();
  const job: Job = {
    id: jobId,
    sessionKey: session.sessionKey,
    channelId: '',
    threadTs: '',
    userId: active.orchestrator.userId,
    tool: effectiveTool as import('../config.js').ToolName,
    mode: 'write',
    prompt: effectivePrompt,
    workdir,
    toolState: {},
    ...(nodeModel ? { toolStateOverrides: { model: nodeModel } } : {}),
    createdAt: Date.now(),
    source: 'orchestrator',
    orchestrationRunId: active.runId,
    orchestrationNodeId: node.id,
    autoApprove: true,
    timeoutSec: node.timeoutSec ?? null,
    executionPolicy: {
      allowMcp: node.allowMcp,
      enabledSkills: agentConfig.effectiveSkills,
      enabledMcpServerIds: agentConfig.effectiveMcpIds,
    },
    instructionFile: composedInstruction,
    skipInstructionFile: instructionSkip,
  };

  store.updateNodeRun(nodeRun.id, {
    jobId,
    sessionKey: session.sessionKey,
    prompt: effectivePrompt,
  });

  const result = ctx.enqueueJob(job);
  if ('error' in result && result.error) {
    store.updateNodeRun(nodeRun.id, {
      status: 'failed',
      errorMessage: `Enqueue failed: ${result.error}`,
      endedAt: new Date().toISOString(),
    });
    cleanupSynchronousNodeSession(ctx, active, node, session.sessionKey);
    active.runningCount = Math.max(0, active.runningCount - 1);
    const updated = store.getNodeRunById(nodeRun.id);
    if (updated) active.nodeRuns.set(node.id, updated);
    return true; // synchronous failure
  }
  return false; // job enqueued successfully (async completion)
}

function clearTriggeredWaitState(active: ActiveOrchestrationRun, nodeId: string): void {
  const waitState = active.waitingTriggeredNodes.get(nodeId);
  if (!waitState) return;
  clearTimeout(waitState.timer);
  waitState.unsubscribe();
  active.waitingTriggeredNodes.delete(nodeId);
}

async function beginTriggeredNodeWait(
  ctx: EngineContext,
  active: ActiveOrchestrationRun,
  node: OrchestratorNode,
  retryCount: number,
  advanceExecution: (active: ActiveOrchestrationRun) => Promise<void>,
  finalizeRun: (
    active: ActiveOrchestrationRun,
    status: 'completed' | 'failed' | 'cancelled',
    errorMessage?: string,
  ) => void,
  existingNodeRun?: OrchestrationNodeRun,
  remainingMs?: number,
): Promise<boolean> {
  const store = ctx.orchestratorStore;
  const eventRouter = ctx.eventRouter;
  if (!eventRouter) {
    const now = new Date().toISOString();
    const nodeRun =
      existingNodeRun ??
      store.createNodeRun({
        orchestrationRunId: active.runId,
        nodeId: node.id,
        status: 'failed',
        retryCount,
        startedAt: now,
        endedAt: now,
        errorMessage: 'Event router is not configured',
      });
    active.nodeRuns.set(node.id, nodeRun);
    if (active.orchestrator.errorPolicy === 'fail_fast') {
      finalizeRun(active, 'failed', 'Event router is not configured');
    } else {
      await advanceExecution(active);
    }
    return true;
  }

  const subscription = eventRouter.getTriggeredNodeSubscription(node.id);
  if (!subscription) {
    const now = new Date().toISOString();
    const nodeRun =
      existingNodeRun ??
      store.createNodeRun({
        orchestrationRunId: active.runId,
        nodeId: node.id,
        status: 'failed',
        retryCount,
        startedAt: now,
        endedAt: now,
        errorMessage: 'Triggered node has no event subscription',
      });
    active.nodeRuns.set(node.id, nodeRun);
    if (active.orchestrator.errorPolicy === 'fail_fast') {
      finalizeRun(active, 'failed', 'Triggered node has no event subscription');
    } else {
      await advanceExecution(active);
    }
    return true;
  }

  const nodeRun =
    existingNodeRun ??
    store.createNodeRun({
      orchestrationRunId: active.runId,
      nodeId: node.id,
      status: 'waiting',
      retryCount,
      startedAt: new Date().toISOString(),
    });
  active.nodeRuns.set(node.id, nodeRun);

  const waiterKey = `${active.runId}:${node.id}`;
  let fired = false;
  const handleTimeout = (): void => {
    if (fired) return;
    fired = true;
    clearTriggeredWaitState(active, node.id);
    active.pendingTriggeredPayloads.delete(node.id);
    const status = node.triggeredConfig?.onTimeout === 'skip' ? 'skipped' : 'failed';
    const errorMessage =
      status === 'failed'
        ? `Triggered node timed out after ${node.triggeredConfig?.waitTimeoutSec ?? 0}s`
        : null;
    store.updateNodeRun(nodeRun.id, {
      status,
      errorMessage,
      endedAt: new Date().toISOString(),
    });
    const updated = store.getNodeRunById(nodeRun.id);
    if (updated) active.nodeRuns.set(node.id, updated);
    if (status === 'failed' && active.orchestrator.errorPolicy === 'fail_fast') {
      finalizeRun(active, 'failed', errorMessage ?? undefined);
      return;
    }
    advanceExecution(active).catch((err) => {
      logger.error('advance_after_timeout_failed', { runId: active.runId, nodeId: node.id, error: String(err) });
      finalizeRun(active, 'failed', `Internal error advancing after timeout: ${String(err)}`);
    });
  };
  const handleEvent = (payload: Record<string, unknown> | null): void => {
    if (fired) return;
    fired = true;
    clearTriggeredWaitState(active, node.id);
    active.pendingTriggeredPayloads.set(node.id, payload);
    advanceExecution(active).catch((err) => {
      logger.error('advance_after_event_failed', { runId: active.runId, nodeId: node.id, error: String(err) });
      finalizeRun(active, 'failed', `Internal error advancing after event: ${String(err)}`);
    });
  };

  const unsubscribe = eventRouter.registerTriggeredWaiter(subscription.id, waiterKey, {
    runId: active.runId,
    nodeId: node.id,
    subscriptionId: subscription.id,
    onEvent: handleEvent,
    onTimeout: handleTimeout,
  });
  const timeoutMs = remainingMs ?? (node.triggeredConfig?.waitTimeoutSec ?? 0) * 1000;
  const timer = setTimeout(handleTimeout, Math.max(timeoutMs, 0));
  active.waitingTriggeredNodes.set(node.id, {
    subscriptionId: subscription.id,
    waiterKey,
    unsubscribe,
    timer,
  });
  return false;
}

async function resumeTriggeredNode(
  ctx: EngineContext,
  active: ActiveOrchestrationRun,
  node: OrchestratorNode,
  nodeRun: OrchestrationNodeRun,
): Promise<boolean> {
  // Resolve agent config (graceful fallback to node-only if agent deleted)
  const agentConfig = resolveAgentConfig(ctx, active, node);
  const effectiveTool = agentConfig.effectiveTool;
  const nodeModel = resolveNodeModel(node, agentConfig.agent);

  if (!effectiveTool || !node.prompt) return false;
  const store = ctx.orchestratorStore;
  const workdir = resolveNodeWorkdir(active.orchestrator, node, active.runId);
  const pendingPayload = active.pendingTriggeredPayloads.get(node.id) ?? null;

  // Compose instruction: agent instruction + node instruction
  const composedInstruction = composeInstructions(
    agentConfig.agentInstruction,
    resolveNodeInstructionFile(active.orchestrator, node).content,
  );
  const instructionSkip = !node.writeInstructionFile;

  active.runningCount++;
  const session = ctx.createSession(
    effectiveTool as import('../config.js').ToolName,
    active.orchestrator.userId,
    'write',
    {
      skipWorkdir: true,
    },
  );

  try {
    fs.mkdirSync(workdir, { recursive: true });
    ctx.prepareWorkdir(
      workdir,
      effectiveTool as import('../config.js').ToolName,
      agentConfig.effectiveSkills,
    );
  } catch (err) {
    const errorMsg = `Workdir preparation failed: ${err instanceof Error ? err.message : String(err)}`;
    store.updateNodeRun(nodeRun.id, {
      status: 'failed',
      errorMessage: errorMsg,
      endedAt: new Date().toISOString(),
    });
    cleanupSynchronousNodeSession(ctx, active, node, session.sessionKey);
    active.runningCount = Math.max(0, active.runningCount - 1);
    const updated = store.getNodeRunById(nodeRun.id);
    if (updated) active.nodeRuns.set(node.id, updated);
    return true;
  }

  const triggeredPrompt = buildNodePrompt(active, node, pendingPayload);
  const jobId = crypto.randomUUID();
  store.updateNodeRun(nodeRun.id, {
    status: 'running',
    jobId,
    sessionKey: session.sessionKey,
    prompt: triggeredPrompt,
  });
  const updatedNodeRun = store.getNodeRunById(nodeRun.id);
  if (updatedNodeRun) {
    active.nodeRuns.set(node.id, updatedNodeRun);
  }

  const job: Job = {
    id: jobId,
    sessionKey: session.sessionKey,
    channelId: '',
    threadTs: '',
    userId: active.orchestrator.userId,
    tool: effectiveTool as import('../config.js').ToolName,
    mode: 'write',
    prompt: triggeredPrompt,
    workdir,
    toolState: {},
    ...(nodeModel ? { toolStateOverrides: { model: nodeModel } } : {}),
    createdAt: Date.now(),
    source: 'orchestrator',
    orchestrationRunId: active.runId,
    orchestrationNodeId: node.id,
    autoApprove: true,
    timeoutSec: node.timeoutSec ?? null,
    executionPolicy: {
      allowMcp: node.allowMcp,
      enabledSkills: agentConfig.effectiveSkills,
      enabledMcpServerIds: agentConfig.effectiveMcpIds,
    },
    instructionFile: composedInstruction,
    skipInstructionFile: instructionSkip,
  };
  const result = ctx.enqueueJob(job);
  if ('error' in result && result.error) {
    store.updateNodeRun(nodeRun.id, {
      status: 'failed',
      errorMessage: `Enqueue failed: ${result.error}`,
      endedAt: new Date().toISOString(),
    });
    cleanupSynchronousNodeSession(ctx, active, node, session.sessionKey);
    active.runningCount = Math.max(0, active.runningCount - 1);
    const failedNodeRun = store.getNodeRunById(nodeRun.id);
    if (failedNodeRun) active.nodeRuns.set(node.id, failedNodeRun);
    return true;
  }
  return false;
}

export async function executeTriggeredNode(
  ctx: EngineContext,
  active: ActiveOrchestrationRun,
  node: OrchestratorNode,
  advanceExecution: (active: ActiveOrchestrationRun) => Promise<void>,
  finalizeRun: (
    active: ActiveOrchestrationRun,
    status: 'completed' | 'failed' | 'cancelled',
    errorMessage?: string,
  ) => void,
  retryCount = 0,
): Promise<boolean> {
  const existingNodeRun = active.nodeRuns.get(node.id);
  if (existingNodeRun?.status === 'waiting') {
    if (!active.pendingTriggeredPayloads.has(node.id)) return false;
    return resumeTriggeredNode(ctx, active, node, existingNodeRun);
  }
  return beginTriggeredNodeWait(ctx, active, node, retryCount, advanceExecution, finalizeRun);
}

async function retryTriggeredNodeExecution(
  ctx: EngineContext,
  active: ActiveOrchestrationRun,
  node: OrchestratorNode,
  retryCount: number,
): Promise<void> {
  // Resolve agent config (graceful fallback to node-only if agent deleted)
  const agentConfig = resolveAgentConfig(ctx, active, node);
  const effectiveTool = agentConfig.effectiveTool;
  const nodeModel = resolveNodeModel(node, agentConfig.agent);

  if (!effectiveTool || !node.prompt) return;
  const store = ctx.orchestratorStore;
  const workdir = resolveNodeWorkdir(active.orchestrator, node, active.runId);
  const payload = active.pendingTriggeredPayloads.get(node.id) ?? null;

  // Compose instruction: agent instruction + node instruction
  const composedInstruction = composeInstructions(
    agentConfig.agentInstruction,
    resolveNodeInstructionFile(active.orchestrator, node).content,
  );
  const instructionSkip = !node.writeInstructionFile;

  const nodeRun = store.createNodeRun({
    orchestrationRunId: active.runId,
    nodeId: node.id,
    status: 'running',
    retryCount,
    startedAt: new Date().toISOString(),
  });
  active.nodeRuns.set(node.id, nodeRun);
  active.runningCount++;

  const session = ctx.createSession(
    effectiveTool as import('../config.js').ToolName,
    active.orchestrator.userId,
    'write',
    {
      skipWorkdir: true,
    },
  );

  try {
    fs.mkdirSync(workdir, { recursive: true });
    ctx.prepareWorkdir(
      workdir,
      effectiveTool as import('../config.js').ToolName,
      agentConfig.effectiveSkills,
    );
  } catch (err) {
    store.updateNodeRun(nodeRun.id, {
      status: 'failed',
      errorMessage: `Workdir preparation failed: ${err instanceof Error ? err.message : String(err)}`,
      endedAt: new Date().toISOString(),
    });
    cleanupSynchronousNodeSession(ctx, active, node, session.sessionKey);
    active.runningCount = Math.max(0, active.runningCount - 1);
    const updated = store.getNodeRunById(nodeRun.id);
    if (updated) active.nodeRuns.set(node.id, updated);
    return;
  }

  const eventPrompt = buildNodePrompt(active, node, payload);
  const jobId = crypto.randomUUID();
  store.updateNodeRun(nodeRun.id, { jobId, sessionKey: session.sessionKey, prompt: eventPrompt });
  const updatedNodeRun = store.getNodeRunById(nodeRun.id);
  if (updatedNodeRun) active.nodeRuns.set(node.id, updatedNodeRun);

  const job: Job = {
    id: jobId,
    sessionKey: session.sessionKey,
    channelId: '',
    threadTs: '',
    userId: active.orchestrator.userId,
    tool: effectiveTool as import('../config.js').ToolName,
    mode: 'write',
    prompt: eventPrompt,
    workdir,
    toolState: {},
    ...(nodeModel ? { toolStateOverrides: { model: nodeModel } } : {}),
    createdAt: Date.now(),
    source: 'orchestrator',
    orchestrationRunId: active.runId,
    orchestrationNodeId: node.id,
    autoApprove: true,
    timeoutSec: node.timeoutSec ?? null,
    executionPolicy: {
      allowMcp: node.allowMcp,
      enabledSkills: agentConfig.effectiveSkills,
      enabledMcpServerIds: agentConfig.effectiveMcpIds,
    },
    instructionFile: composedInstruction,
    skipInstructionFile: instructionSkip,
  };
  const result = ctx.enqueueJob(job);
  if ('error' in result && result.error) {
    store.updateNodeRun(nodeRun.id, {
      status: 'failed',
      errorMessage: `Enqueue failed: ${result.error}`,
      endedAt: new Date().toISOString(),
    });
    cleanupSynchronousNodeSession(ctx, active, node, session.sessionKey);
    active.runningCount = Math.max(0, active.runningCount - 1);
    const failedNodeRun = store.getNodeRunById(nodeRun.id);
    if (failedNodeRun) active.nodeRuns.set(node.id, failedNodeRun);
  }
}

export async function recoverTriggeredNodeWait(
  ctx: EngineContext,
  active: ActiveOrchestrationRun,
  node: OrchestratorNode,
  nodeRun: OrchestrationNodeRun,
  advanceExecution: (active: ActiveOrchestrationRun) => Promise<void>,
  finalizeRun: (
    active: ActiveOrchestrationRun,
    status: 'completed' | 'failed' | 'cancelled',
    errorMessage?: string,
  ) => void,
): Promise<boolean> {
  const startedAtMs = nodeRun.startedAt ? new Date(nodeRun.startedAt).getTime() : Date.now();
  const waitTimeoutMs = (node.triggeredConfig?.waitTimeoutSec ?? 0) * 1000;
  const remainingMs = Math.max(startedAtMs + waitTimeoutMs - Date.now(), 0);
  return beginTriggeredNodeWait(
    ctx,
    active,
    node,
    nodeRun.retryCount,
    advanceExecution,
    finalizeRun,
    nodeRun,
    remainingMs,
  );
}

/** Complete a gate node synchronously — evaluates condition and records 'pass' or 'fail'. */
export async function completeGateNode(
  ctx: EngineContext,
  active: ActiveOrchestrationRun,
  node: OrchestratorNode,
): Promise<void> {
  if (!node.gateCondition) return;

  const store = ctx.orchestratorStore;
  const now = new Date().toISOString();

  const incoming = active.dag.incoming.get(node.id) ?? [];
  const sourceIds = [...new Set(incoming.map((e) => e.fromNodeId))];

  const sources: Record<string, string | null> = {};
  const sourceResults: (string | null)[] = [];
  for (const sourceId of sourceIds) {
    const sourceRun = active.nodeRuns.get(sourceId);
    const rv = sourceRun?.status === 'completed' ? sourceRun.returnValue : null;
    sources[sourceId] = rv;
    sourceResults.push(rv);
  }

  const result = evaluateGateCondition(
    node.gateCondition.mode,
    node.gateCondition.matchValue,
    sourceResults,
  );
  const evaluation = JSON.stringify({
    mode: node.gateCondition.mode,
    matchValue: node.gateCondition.matchValue,
    sources,
    result,
  });

  const nodeRun = store.createNodeRun({
    orchestrationRunId: active.runId,
    nodeId: node.id,
    status: 'completed',
    returnValue: result,
    gateEvaluation: evaluation,
    startedAt: now,
    endedAt: now,
  });
  active.nodeRuns.set(node.id, nodeRun);

  await sendNodeNotification(ctx, active, nodeRun, node);
}

/** Complete an end node synchronously — immediate completion, no job. */
export function completeEndNode(
  ctx: EngineContext,
  active: ActiveOrchestrationRun,
  node: OrchestratorNode,
): void {
  const store = ctx.orchestratorStore;
  const now = new Date().toISOString();

  const nodeRun = store.createNodeRun({
    orchestrationRunId: active.runId,
    nodeId: node.id,
    status: 'completed',
    returnValue: 'workflow_ended',
    startedAt: now,
    endedAt: now,
  });
  active.nodeRuns.set(node.id, nodeRun);
}

/** Retry a failed node with incremented retryCount. */
export async function retryNode(
  ctx: EngineContext,
  active: ActiveOrchestrationRun,
  node: OrchestratorNode,
  failedRun: OrchestrationNodeRun,
): Promise<void> {
  const newRetryCount = failedRun.retryCount + 1;

  logger.info('orchestrator_node_retry', {
    runId: active.runId,
    nodeId: node.id,
    retryCount: newRetryCount,
    maxRetries: node.maxRetries,
  });

  if (node.nodeType === 'triggered') {
    await retryTriggeredNodeExecution(ctx, active, node, newRetryCount);
    return;
  }
  await executeTaskNode(ctx, active, node, newRetryCount);
}

/** Handle job completion for an orchestrator node — parse return value, apply retry/error policy, advance. */
export async function handleNodeJobComplete(
  ctx: EngineContext,
  active: ActiveOrchestrationRun,
  nodeRun: OrchestrationNodeRun,
  result: RunResult,
  outputRaw: string,
  advanceExecution: (active: ActiveOrchestrationRun) => Promise<void>,
  finalizeRun: (
    active: ActiveOrchestrationRun,
    status: 'completed' | 'failed' | 'cancelled',
    errorMessage?: string,
  ) => void,
): Promise<void> {
  const store = ctx.orchestratorStore;

  // Always decrement runningCount first — the job has finished regardless of
  // whether the node still exists in the DAG.  Decrementing after the guard
  // would leave runningCount permanently inflated if the node lookup fails,
  // causing the run to hang indefinitely (Risk-2).
  active.runningCount = Math.max(0, active.runningCount - 1);

  const node = active.dag.nodes.get(nodeRun.nodeId);
  if (!node) return;

  const returnValue = parseReturnValue(outputRaw);
  let status: NodeRunStatus;
  let effectiveReturn = returnValue;
  let errorMessage: string | undefined;

  const definedReturnValues = node.returnValues ?? [];
  const hasReturnValues = definedReturnValues.length > 0;

  // errorKind takes priority — CLI crashed/timed out so any <return:X> is unreliable
  if (result.errorKind) {
    errorMessage = result.errorKind;
    status = 'failed';
    effectiveReturn = null;
    // If retries are exhausted, error_return routing below upgrades to 'completed'
  } else if (returnValue !== null) {
    if (hasReturnValues && !definedReturnValues.includes(returnValue)) {
      effectiveReturn = OTHER_RETURN;
    }
    status = 'completed';
  } else {
    effectiveReturn = OTHER_RETURN;
    status = 'completed';
  }

  const shouldRetry = status === 'failed' && nodeRun.retryCount < node.maxRetries;

  // Error return routing when retries exhausted
  if (!shouldRetry && status === 'failed' && result.errorKind && hasReturnValues) {
    status = 'completed';
    effectiveReturn = ERROR_RETURN;
  }

  const now = new Date().toISOString();
  const truncatedSummary =
    outputRaw.length > 4000 ? `${outputRaw.slice(0, 4000)}… (truncated)` : outputRaw;
  store.updateNodeRun(nodeRun.id, {
    status,
    returnValue: effectiveReturn,
    exitCode: result.exitCode,
    outputSummary: truncatedSummary || null,
    outputFull: outputRaw || null,
    errorMessage: errorMessage ?? null,
    endedAt: now,
  });

  const updatedNodeRun = store.getNodeRunById(nodeRun.id);
  if (updatedNodeRun) {
    active.nodeRuns.set(nodeRun.nodeId, updatedNodeRun);
  }

  await sendNodeNotification(ctx, active, updatedNodeRun ?? nodeRun, node);

  if (shouldRetry) {
    await retryNode(ctx, active, node, updatedNodeRun ?? nodeRun);
    return;
  }

  if (node.nodeType === 'triggered') {
    active.pendingTriggeredPayloads.delete(node.id);
  }

  if (status === 'failed' && active.orchestrator.errorPolicy === 'fail_fast') {
    const failFastMessage = errorMessage ?? 'Node failed with fail_fast policy';
    finalizeRun(active, 'failed', failFastMessage);
    return;
  }

  await advanceExecution(active);
}
