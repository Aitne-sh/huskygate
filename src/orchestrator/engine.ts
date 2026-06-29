/** @module engine — DAG execution engine: run lifecycle, node resolution, and crash recovery. */

import type { ToolName } from '../config.js';
import { parseTriggerContext, serializeTriggerContext } from '../event/trigger-context.js';
import type { Job } from '../queue/types.js';
import type { RunResult } from '../runner/types.js';
import type { Mode } from '../session/types.js';
import type { SkillRef } from '../skills/catalog.js';
import type { AgentStore } from '../store/agent-store.js';
import type { OrchestratorStore } from '../store/orchestrator.js';
import { logger } from '../utils/logger.js';
import { buildValidatedDAG, getAncestors, validateDAG } from './dag.js';
import {
  completeEndNode,
  completeGateNode,
  executeTaskNode,
  executeTriggeredNode,
  handleNodeJobComplete,
  isGateReady,
  isNodeSkippable,
  isTaskReady,
  recoverTriggeredNodeWait,
} from './engine-executor.js';
import { sendCompletionNotification } from './engine-notify.js';
import { startSummaryJob } from './engine-summary.js';
import { listCustomWorkdirs } from './engine-utils.js';
import type { ActiveOrchestrationRun, OrchestratorNode, RunTrigger } from './types.js';

export interface StartRunOptions {
  userId?: string;
  triggerContext?: Record<string, unknown>;
}

function normalizeStartRunOptions(userIdOrOptions?: string | StartRunOptions): StartRunOptions {
  if (typeof userIdOrOptions === 'string') {
    return { userId: userIdOrOptions };
  }
  return userIdOrOptions ?? {};
}

function buildTriggeredNodeSubscriptionIds(
  ctx: EngineContext,
  nodes: OrchestratorNode[],
): Set<string> {
  if (!ctx.eventRouter) return new Set<string>();
  return new Set(
    nodes
      .filter(
        (node) =>
          node.nodeType === 'triggered' && ctx.eventRouter?.getTriggeredNodeSubscription(node.id),
      )
      .map((node) => node.id),
  );
}

// ── Dependencies (injected) ──────────────────────────────────

export interface EngineContext {
  orchestratorStore: OrchestratorStore;
  /** Agent store for resolving node → agent configuration. */
  agentStore?: AgentStore;
  /** Create a standalone session for a tool */
  createSession: (
    tool: ToolName,
    userId: string,
    mode?: Mode,
    options?: { skipWorkdir?: boolean },
  ) => { sessionKey: string; workdir: string };
  /** Prepare workdir with instructions + skills */
  prepareWorkdir: (workdir: string, tool: ToolName, enabledSkills?: SkillRef[] | null) => void;
  /** Enqueue a job into the job queue */
  enqueueJob: (job: Job) => { error?: string } | { position: number };
  /** Delete a session and its workdir */
  cleanupSession: (sessionKey: string) => void;
  /** Delete an auto-generated run workdir by run ID */
  cleanupRunWorkdir?: (runId: string) => void;
  /** Validate a custom workdir against allowed roots and existence rules. */
  validateWorkdir?: (workdir: string) => string;
  /** Cancel a running job by its session key (e.g., kill the runner process) */
  cancelJob?: (sessionKey: string) => void;
  /** Post a Slack notification — returns the resolved channel ID + message ts, or null */
  postNotification?: (
    channel: string,
    text: string,
    threadTs?: string,
  ) => Promise<{ channelId: string; ts: string } | null>;
  /** Upload a file to a Slack channel (optionally in a thread) */
  uploadFile?: (
    channel: string,
    filePath: string,
    filename: string,
    threadTs?: string,
  ) => Promise<void>;
  /** Default notify channel from config */
  defaultNotifyChannel?: string;
  /** Event router used for triggered nodes and webhook fan-out. */
  eventRouter?: import('../event/event-router.js').EventRouter;
}

// ── Engine Class ─────────────────────────────────────────────

/** Stateful controller that manages active orchestration runs against a validated DAG. */
export class OrchestratorEngine {
  private activeRuns = new Map<string, ActiveOrchestrationRun>();

  constructor(private readonly ctx: EngineContext) {}

  /** Wire postNotification after runtime init (Slack app created after engine). */
  setPostNotification(
    fn: (
      channel: string,
      text: string,
      threadTs?: string,
    ) => Promise<{ channelId: string; ts: string } | null>,
  ): void {
    this.ctx.postNotification = fn;
  }

  /** Wire uploadFile after runtime init. */
  setUploadFile(
    fn: (channel: string, filePath: string, filename: string, threadTs?: string) => Promise<void>,
  ): void {
    this.ctx.uploadFile = fn;
  }

  /** Set default notify channel from config. */
  setDefaultNotifyChannel(channel: string | undefined): void {
    this.ctx.defaultNotifyChannel = channel;
  }

  setEventRouter(router: import('../event/event-router.js').EventRouter): void {
    this.ctx.eventRouter = router;
  }

  // ── Lifecycle ──────────────────────────────────────────────

  /**
   * Start a new orchestration run.
   */
  async startRun(
    orchestratorId: string,
    triggeredBy: RunTrigger,
    userIdOrOptions?: string | StartRunOptions,
  ): Promise<string> {
    const store = this.ctx.orchestratorStore;
    const full = store.getFullOrchestrator(orchestratorId);
    if (!full) throw new Error(`Orchestrator ${orchestratorId} not found`);
    const options = normalizeStartRunOptions(userIdOrOptions);
    const triggerContextJson = serializeTriggerContext(options.triggerContext);

    const { orchestrator, nodes, edges } = full;
    if (orchestrator.status === 'deleted') {
      throw new Error(`Orchestrator ${orchestratorId} has been deleted`);
    }
    if (triggeredBy === 'webhook' && orchestrator.triggerMode !== 'webhook') {
      throw new Error(
        `Orchestrator ${orchestratorId} cannot be triggered by webhook when triggerMode=${orchestrator.triggerMode}`,
      );
    }
    if (!orchestrator.dagValidated) {
      throw new Error(`Orchestrator ${orchestratorId} has not been validated. Run validate first.`);
    }

    const validation = validateDAG(nodes, edges, orchestrator.maxTotalNodes, {
      startNodeId: orchestrator.startNodeId,
      triggeredNodeSubscriptionIds: buildTriggeredNodeSubscriptionIds(this.ctx, nodes),
      agentResolver: this.ctx.agentStore
        ? (id) => this.ctx.agentStore?.getById(id) ?? null
        : undefined,
    });
    if (!validation.valid) {
      const errMsgs = validation.errors.map((e) => e.message).join('; ');
      throw new Error(`DAG validation failed: ${errMsgs}`);
    }

    this.validateCustomWorkdirs(orchestrator, nodes);

    const run = store.createRun({
      orchestratorId,
      triggeredBy,
      triggeredUserId: options.userId,
      triggerContextJson,
    });
    const dag = buildValidatedDAG(nodes, edges, validation.topologicalOrder);

    const active: ActiveOrchestrationRun = {
      runId: run.id,
      orchestrator,
      dag,
      nodeRuns: new Map(),
      runningCount: 0,
      startedAt: Date.now(),
      triggerContext: options.triggerContext ?? null,
      waitingTriggeredNodes: new Map(),
      pendingTriggeredPayloads: new Map(),
    };

    if (orchestrator.timeoutSec) {
      active.timeoutTimer = setTimeout(() => {
        this.handleTimeout(run.id);
      }, orchestrator.timeoutSec * 1000);
    }

    this.activeRuns.set(run.id, active);

    store.incrementRunCount(orchestratorId, new Date().toISOString());
    await this.advanceExecution(active);

    return run.id;
  }

  /**
   * Rerun from a specific node (or from the beginning).
   */
  async startRerun(
    originalRunId: string,
    fromNodeId?: string,
    triggeredBy: Extract<RunTrigger, 'dashboard' | 'slack'> = 'dashboard',
    userId?: string,
  ): Promise<string> {
    const store = this.ctx.orchestratorStore;
    const originalRun = store.getRunById(originalRunId);
    if (!originalRun) throw new Error(`Run ${originalRunId} not found`);

    const full = store.getFullOrchestrator(originalRun.orchestratorId);
    if (!full) throw new Error(`Orchestrator ${originalRun.orchestratorId} not found`);

    const { orchestrator, nodes, edges } = full;
    if (!orchestrator.dagValidated) {
      throw new Error(
        `Orchestrator ${originalRun.orchestratorId} has not been validated. Run validate first.`,
      );
    }
    const validation = validateDAG(nodes, edges, orchestrator.maxTotalNodes, {
      startNodeId: orchestrator.startNodeId,
      triggeredNodeSubscriptionIds: buildTriggeredNodeSubscriptionIds(this.ctx, nodes),
      agentResolver: this.ctx.agentStore
        ? (id) => this.ctx.agentStore?.getById(id) ?? null
        : undefined,
    });
    if (!validation.valid) {
      const errMsgs = validation.errors.map((e) => e.message).join('; ');
      throw new Error(`DAG validation failed: ${errMsgs}`);
    }
    this.validateCustomWorkdirs(orchestrator, nodes);
    const dag = buildValidatedDAG(nodes, edges, validation.topologicalOrder);

    const newRun = store.createRun({
      orchestratorId: orchestrator.id,
      triggeredBy,
      triggeredUserId: userId,
      rerunFromRunId: originalRunId,
      rerunFromNodeId: fromNodeId,
    });
    const active: ActiveOrchestrationRun = {
      runId: newRun.id,
      orchestrator,
      dag,
      nodeRuns: new Map(),
      runningCount: 0,
      startedAt: Date.now(),
      triggerContext: null,
      waitingTriggeredNodes: new Map(),
      pendingTriggeredPayloads: new Map(),
    };

    if (orchestrator.timeoutSec) {
      active.timeoutTimer = setTimeout(() => {
        this.handleTimeout(newRun.id);
      }, orchestrator.timeoutSec * 1000);
    }

    this.activeRuns.set(newRun.id, active);

    // Copy completed ancestor node runs from original
    if (fromNodeId) {
      const originalNodeRuns = store.getNodeRunsByRun(originalRunId);
      const ancestors = getAncestors(dag, fromNodeId);

      for (const nodeRun of originalNodeRuns) {
        if (ancestors.has(nodeRun.nodeId) && nodeRun.status === 'completed') {
          const copiedRun = store.createNodeRun({
            orchestrationRunId: newRun.id,
            nodeId: nodeRun.nodeId,
            status: 'completed',
            returnValue: nodeRun.returnValue,
            exitCode: nodeRun.exitCode,
            outputSummary: nodeRun.outputSummary,
          });
          active.nodeRuns.set(nodeRun.nodeId, copiedRun);
        }
      }
    }

    store.incrementRunCount(orchestrator.id, new Date().toISOString());
    await this.advanceExecution(active);

    return newRun.id;
  }

  /**
   * Cancel a running orchestration.
   */
  async cancelRun(runId: string): Promise<void> {
    const active = this.activeRuns.get(runId);
    if (!active) {
      // Not in memory — update DB directly
      const store = this.ctx.orchestratorStore;
      store.updateRun(runId, {
        status: 'cancelled',
        endedAt: new Date().toISOString(),
      });
      return;
    }

    this.finalizeRun(active, 'cancelled');
  }

  /** Called by JobExecutor when a job with source='orchestrator' completes. */
  async onNodeJobComplete(
    jobId: string,
    result: RunResult,
    _outputSummary: string,
    outputRaw: string,
  ): Promise<void> {
    const store = this.ctx.orchestratorStore;
    const nodeRun = store.getNodeRunByJobId(jobId);
    if (!nodeRun) {
      logger.warn('orchestrator_node_run_not_found', { jobId });
      return;
    }

    const active = this.activeRuns.get(nodeRun.orchestrationRunId);
    if (!active) {
      logger.warn('orchestrator_run_not_active', { runId: nodeRun.orchestrationRunId, jobId });
      return;
    }

    await handleNodeJobComplete(
      this.ctx,
      active,
      nodeRun,
      result,
      outputRaw,
      (a) => this.advanceExecution(a),
      (a, s, e) => this.finalizeRun(a, s, e),
    );
  }

  /**
   * Recover runs that were in-progress when the process crashed.
   */
  async recoverActiveRuns(): Promise<number> {
    const store = this.ctx.orchestratorStore;
    const runningRuns = store.getRunningRuns();
    let recovered = 0;

    for (const run of runningRuns) {
      const full = store.getFullOrchestrator(run.orchestratorId);
      if (!full) {
        store.updateRun(run.id, {
          status: 'failed',
          errorMessage: 'Orchestrator not found during recovery',
          endedAt: new Date().toISOString(),
        });
        continue;
      }

      try {
        const dag = buildValidatedDAG(full.nodes, full.edges);
        const nodeRuns = store.getNodeRunsByRun(run.id);

        const active: ActiveOrchestrationRun = {
          runId: run.id,
          orchestrator: full.orchestrator,
          dag,
          nodeRuns: new Map(),
          runningCount: 0,
          startedAt: run.startedAt ? new Date(run.startedAt).getTime() : Date.now(),
          triggerContext: parseTriggerContext(run.triggerContextJson),
          waitingTriggeredNodes: new Map(),
          pendingTriggeredPayloads: new Map(),
        };

        for (const nr of nodeRuns) {
          active.nodeRuns.set(nr.nodeId, nr);
          // Keep retryCount unchanged — the crash is not a retry attempt
          if (nr.status === 'running') {
            store.updateNodeRun(nr.id, {
              status: 'failed',
              errorMessage: 'Interrupted by process restart',
              endedAt: new Date().toISOString(),
            });
            const updated = store.getNodeRunById(nr.id);
            if (updated) active.nodeRuns.set(nr.nodeId, updated);
          } else if (nr.status === 'waiting') {
            const node = active.dag.nodes.get(nr.nodeId);
            if (node?.nodeType === 'triggered') {
              await recoverTriggeredNodeWait(
                this.ctx,
                active,
                node,
                nr,
                (a) => this.advanceExecution(a),
                (a, s, e) => this.finalizeRun(a, s, e),
              );
            }
          }
        }

        this.activeRuns.set(run.id, active);
        await this.advanceExecution(active);
        recovered++;
      } catch (err) {
        logger.error('orchestrator_recovery_failed', {
          runId: run.id,
          error: err instanceof Error ? err.message : String(err),
        });
        store.updateRun(run.id, {
          status: 'failed',
          errorMessage: `Recovery failed: ${err instanceof Error ? err.message : String(err)}`,
          endedAt: new Date().toISOString(),
        });
      }
    }

    if (recovered > 0) {
      logger.info('orchestrator_runs_recovered', { count: recovered });
    }

    return recovered;
  }

  /**
   * Get active run status (for SSE streaming).
   */
  getActiveRun(runId: string): ActiveOrchestrationRun | undefined {
    return this.activeRuns.get(runId);
  }

  // ── Core Execution Logic ───────────────────────────────────

  /**
   * Resolve runnable nodes and execute them.
   * Uses a loop instead of recursion to prevent stack overflow on long gate/end chains.
   */
  private async advanceExecution(active: ActiveOrchestrationRun): Promise<void> {
    for (;;) {
      const runnableNodes = this.resolveRunnableNodes(active);

      if (runnableNodes.length === 0) {
        this.checkRunCompletion(active);
        return;
      }

      let madeProgress = false;

      for (const node of runnableNodes) {
        if (active.runningCount >= active.orchestrator.maxParallelism) break;

        // Guard: another advanceExecution call (via onNodeJobComplete during an await)
        // may have already started this node while we yielded.
        // Exception: triggered nodes with a pending payload need to pass through
        // so executeTriggeredNode can call resumeTriggeredNode.
        if (active.nodeRuns.has(node.id)) {
          const existingRun = active.nodeRuns.get(node.id);
          const isTriggeredResume =
            node.nodeType === 'triggered' &&
            existingRun?.status === 'waiting' &&
            active.pendingTriggeredPayloads.has(node.id);
          if (!isTriggeredResume) continue;
        }

        if (node.nodeType === 'end') {
          completeEndNode(this.ctx, active, node);
          madeProgress = true;
        } else if (node.nodeType === 'gate') {
          await completeGateNode(this.ctx, active, node);
          madeProgress = true;
        } else if (node.nodeType === 'triggered') {
          const changed = await executeTriggeredNode(
            this.ctx,
            active,
            node,
            (a) => this.advanceExecution(a),
            (a, s, e) => this.finalizeRun(a, s, e),
          );
          if (changed) madeProgress = true;
        } else {
          // Task nodes are typically async (enqueued), but may fail synchronously
          const failedSync = await executeTaskNode(this.ctx, active, node);
          if (failedSync) madeProgress = true;
        }
      }

      // If only task nodes were enqueued (no synchronous gate/end progress), exit the loop.
      // advanceExecution will be called again when those tasks complete via onNodeJobComplete.
      if (!madeProgress) return;
    }
  }

  /**
   * Determine which nodes are ready to execute.
   */
  private resolveRunnableNodes(active: ActiveOrchestrationRun): OrchestratorNode[] {
    const runnable: OrchestratorNode[] = [];
    const { dag, nodeRuns } = active;
    // Memoize isNodeSkippable to avoid exponential re-computation on diamond DAGs
    const skipCache = new Map<string, boolean>();

    for (const nodeId of dag.topologicalOrder) {
      const node = dag.nodes.get(nodeId);
      if (!node) continue;

      const existingRun = nodeRuns.get(nodeId);
      if (existingRun) {
        if (
          node.nodeType === 'triggered' &&
          existingRun.status === 'waiting' &&
          active.pendingTriggeredPayloads.has(node.id)
        ) {
          runnable.push(node);
          continue;
        }
        // All statuses indicate the node already has a run record — skip it.
        // (triggered nodes in 'waiting' with a pending payload are handled above.)
        continue;
      }

      if (node.nodeType === 'gate') {
        if (isGateReady(active, node, skipCache)) {
          runnable.push(node);
        }
      } else {
        // Both 'task' and 'end' nodes use edge-based readiness
        if (isTaskReady(active, node, skipCache)) {
          runnable.push(node);
        }
      }
    }

    return runnable;
  }

  // ── Run Completion ─────────────────────────────────────────

  /**
   * Check if all nodes are done and finalize the run.
   */
  private checkRunCompletion(active: ActiveOrchestrationRun): void {
    const { dag, nodeRuns, runningCount } = active;

    if (runningCount > 0) return;

    let allDone = true;
    let anyFailed = false;
    const skipCache = new Map<string, boolean>();

    for (const nodeId of dag.topologicalOrder) {
      const nodeRun = nodeRuns.get(nodeId);
      if (!nodeRun) {
        const node = dag.nodes.get(nodeId);
        if (node && !isNodeSkippable(active, node, skipCache)) {
          allDone = false;
          break;
        }
        continue;
      }

      if (
        nodeRun.status === 'running' ||
        nodeRun.status === 'waiting' ||
        nodeRun.status === 'pending'
      ) {
        allDone = false;
        break;
      }
      if (nodeRun.status === 'failed') {
        anyFailed = true;
      }
    }

    if (allDone) {
      this.finalizeRun(active, anyFailed ? 'failed' : 'completed');
    }
  }

  /**
   * Finalize a run and clean up resources.
   */
  private finalizeRun(
    active: ActiveOrchestrationRun,
    status: 'completed' | 'failed' | 'cancelled',
    errorMessage?: string,
  ): void {
    const store = this.ctx.orchestratorStore;
    const now = new Date().toISOString();

    const sessionKeysToCleanup: string[] = [];
    for (const waitState of active.waitingTriggeredNodes.values()) {
      clearTimeout(waitState.timer);
      waitState.unsubscribe();
    }
    active.waitingTriggeredNodes.clear();
    active.pendingTriggeredPayloads.clear();
    for (const [, nodeRun] of active.nodeRuns) {
      if (nodeRun.sessionKey) {
        sessionKeysToCleanup.push(nodeRun.sessionKey);
      }
      if (
        nodeRun.status === 'running' ||
        nodeRun.status === 'pending' ||
        nodeRun.status === 'waiting'
      ) {
        if (nodeRun.status === 'running' && nodeRun.sessionKey && this.ctx.cancelJob) {
          try {
            this.ctx.cancelJob(nodeRun.sessionKey);
          } catch (err) {
            logger.warn('orchestrator_cancel_job_failed', {
              runId: active.runId,
              sessionKey: nodeRun.sessionKey,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        store.updateNodeRun(nodeRun.id, {
          status: status === 'cancelled' ? 'cancelled' : 'skipped',
          endedAt: now,
        });
        active.nodeRuns.set(nodeRun.nodeId, {
          ...nodeRun,
          status: status === 'cancelled' ? 'cancelled' : 'skipped',
          endedAt: now,
        });
      }
    }

    if (status !== 'cancelled') {
      this.persistSkippedNodeRuns(active, now);
    }

    store.updateRun(active.runId, {
      status,
      endedAt: now,
      errorMessage: errorMessage ?? null,
    });

    if (active.timeoutTimer) {
      clearTimeout(active.timeoutTimer);
    }

    this.activeRuns.delete(active.runId);

    for (const sessionKey of sessionKeysToCleanup) {
      try {
        this.ctx.cleanupSession(sessionKey);
      } catch (err) {
        logger.warn('orchestrator_session_cleanup_failed', {
          runId: active.runId,
          sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.trimRunWorkdirs(active);

    sendCompletionNotification(this.ctx, active, status)
      .then((posted) => {
        if (
          posted &&
          status !== 'cancelled' &&
          active.orchestrator.summaryEnabled &&
          active.orchestrator.summaryTool
        ) {
          startSummaryJob(this.ctx, {
            orchestrator: active.orchestrator,
            runId: active.runId,
            status,
            startedAt: active.startedAt,
            endedAt: now,
            nodeRuns: store.getNodeRunsByRun(active.runId),
            nodes: [...active.dag.nodes.values()],
            nodeOrder: [...active.dag.topologicalOrder],
            notifyChannelId: posted.channelId,
            notifyThreadTs: posted.ts,
          });
        }
        return posted;
      })
      .catch((err) => {
        logger.error('orchestrator_completion_notification_failed', {
          runId: active.runId,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      })
      .then(() => {
        try {
          const offloadResult = store.offloadRunOutputs(active.runId);
          if (offloadResult.offloadedCount > 0) {
            logger.info('orchestrator_output_offloaded', {
              runId: active.runId,
              offloaded: offloadResult.offloadedCount,
            });
          }
          if (offloadResult.errors.length > 0) {
            logger.warn('orchestrator_output_offload_errors', {
              runId: active.runId,
              errors: offloadResult.errors.slice(0, 10),
            });
          }
        } catch (err) {
          logger.warn('orchestrator_output_offload_failed', {
            runId: active.runId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

    logger.info('orchestrator_run_finalized', {
      runId: active.runId,
      orchestratorId: active.orchestrator.id,
      status,
    });
  }

  /** Trim excess run workdirs. Only applies to auto-generated workdirs. */
  private trimRunWorkdirs(active: ActiveOrchestrationRun): void {
    if (!this.ctx.cleanupRunWorkdir) return;
    if (active.orchestrator.workdir) return;

    const maxWorkdirs = active.orchestrator.maxRunWorkdirs;
    const store = this.ctx.orchestratorStore;
    const completedRunIds = store.getCompletedRunIds(active.orchestrator.id);

    const toDelete = maxWorkdirs === 0 ? completedRunIds : completedRunIds.slice(maxWorkdirs);

    for (const runId of toDelete) {
      try {
        this.ctx.cleanupRunWorkdir(runId);
      } catch (err) {
        logger.warn('orchestrator_run_workdir_cleanup_failed', {
          runId,
          orchestratorId: active.orchestrator.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (toDelete.length > 0) {
      logger.info('orchestrator_run_workdirs_trimmed', {
        orchestratorId: active.orchestrator.id,
        trimmed: toDelete.length,
        kept: completedRunIds.length - toDelete.length,
        maxRunWorkdirs: maxWorkdirs,
      });
    }
  }

  private persistSkippedNodeRuns(active: ActiveOrchestrationRun, now: string): void {
    const store = this.ctx.orchestratorStore;
    const skipCache = new Map<string, boolean>();

    for (const nodeId of active.dag.topologicalOrder) {
      if (active.nodeRuns.has(nodeId)) continue;

      const node = active.dag.nodes.get(nodeId);
      if (!node || !isNodeSkippable(active, node, skipCache)) continue;

      const skippedRun = store.createNodeRun({
        orchestrationRunId: active.runId,
        nodeId,
        status: 'skipped',
        startedAt: now,
        endedAt: now,
      });
      active.nodeRuns.set(nodeId, skippedRun);
    }
  }

  /**
   * Handle overall timeout.
   */
  private handleTimeout(runId: string): void {
    const active = this.activeRuns.get(runId);
    if (!active) return;

    logger.warn('orchestrator_run_timeout', {
      runId,
      timeoutSec: active.orchestrator.timeoutSec,
    });

    this.finalizeRun(
      active,
      'failed',
      `Overall timeout (${active.orchestrator.timeoutSec}s) exceeded`,
    );
  }

  private validateCustomWorkdirs(
    orchestrator: ActiveOrchestrationRun['orchestrator'],
    nodes: OrchestratorNode[],
  ): void {
    if (!this.ctx.validateWorkdir) return;

    for (const target of listCustomWorkdirs(orchestrator, nodes)) {
      try {
        this.ctx.validateWorkdir(target.workdir);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        if (target.scope === 'orchestrator') {
          throw new Error(`Invalid orchestrator workdir: ${detail}`);
        }
        throw new Error(`Invalid workdir for node "${target.nodeLabel}": ${detail}`);
      }
    }
  }
}
