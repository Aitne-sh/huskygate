/** @module server/routes/orchestrator-execution — DAG validation, execution, and SSE streaming routes. */
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../../context/app-context.js';
import { validateDAG } from '../../orchestrator/dag.js';
import { json, readBody } from '../../shared/http.js';
import {
  matchOrchestratorCancel,
  matchOrchestratorExecute,
  matchOrchestratorRerun,
  matchOrchestratorRevertSnapshot,
  matchOrchestratorRunStream,
  matchOrchestratorValidate,
} from '../../shared/route-matchers.js';
import { writeSseHeaders } from '../../shared/sse.js';
import { errorMessage } from '../../utils/error.js';
import { sseRetry, sseWrite, startHeartbeat } from './orchestrator-shared.js';

/**
 * Handle orchestrator execution routes (validate, revert, execute, rerun, cancel, SSE stream).
 *
 * Returns `true` if the route was handled (response sent), `false` otherwise.
 */
export async function handleOrchestratorExecutionRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  // ── Validate DAG ──────────────────────────────────────────

  // POST /api/orchestrators/:id/validate — validate DAG
  // Body { commit: true } to register the flow on success (manual validate button).
  // Without commit flag, this is a dry-run for auto-validation (no dagValidated change).
  const orchValidateId = matchOrchestratorValidate(pathname);
  if (req.method === 'POST' && orchValidateId) {
    const orch = ctx.orchestratorStore.getById(orchValidateId);
    if (!orch || orch.status === 'deleted') {
      json(res, 404, { error: 'Orchestrator not found' });
      return true;
    }
    const valBody = await readBody(req);
    let commit = false;
    try {
      if (valBody) {
        const valParsed = JSON.parse(valBody) as Record<string, unknown>;
        commit = valParsed.commit === true;
      }
    } catch {
      /* no body or invalid JSON — dry run */
    }

    const nodes = ctx.orchestratorStore.getNodesByOrchestrator(orchValidateId);
    const edges = ctx.orchestratorStore.getEdgesByOrchestrator(orchValidateId);
    const subscriptions = ctx.eventSubscriptionStore.list();
    const triggeredNodeSubscriptionIds = new Set(
      subscriptions
        .filter(
          (subscription) => subscription.targetType === 'triggered_node' && subscription.nodeId,
        )
        .map((subscription) => subscription.nodeId as string),
    );
    const result = validateDAG(nodes, edges, orch.maxTotalNodes, {
      startNodeId: orch.startNodeId,
      triggeredNodeSubscriptionIds,
      agentResolver: (id) => ctx.agentStore.getById(id),
    });
    const errors = [...result.errors];
    if (
      orch.triggerMode === 'webhook' &&
      !subscriptions.some(
        (subscription) =>
          subscription.targetType === 'orchestrator' &&
          subscription.orchestratorId === orchValidateId,
      )
    ) {
      errors.push({
        code: 'WEBHOOK_TRIGGER_NO_SUBSCRIPTION',
        message: 'Webhook-triggered orchestrators must have a webhook endpoint subscription.',
      });
    }
    const validationResult = {
      ...result,
      errors,
      valid: errors.length === 0,
    };

    if (commit && validationResult.valid) {
      ctx.orchestratorStore.update(orchValidateId, { dagValidated: true });
      ctx.orchestratorStore.saveValidatedSnapshot(orchValidateId);
    }

    json(res, 200, {
      ok: validationResult.valid,
      data: validationResult,
      ...(validationResult.valid ? {} : { error: 'DAG validation failed' }),
    });
    return true;
  }

  // POST /api/orchestrators/:id/revert — revert to last validated snapshot
  const orchRevertId = matchOrchestratorRevertSnapshot(pathname);
  if (req.method === 'POST' && orchRevertId) {
    const orch = ctx.orchestratorStore.getById(orchRevertId);
    if (!orch || orch.status === 'deleted') {
      json(res, 404, { error: 'Orchestrator not found' });
      return true;
    }
    // Block revert while a run is active
    const allRunning = ctx.orchestratorStore.getRunningRuns();
    if (allRunning.some((r) => r.orchestratorId === orchRevertId)) {
      json(res, 409, { error: 'Cannot revert while an orchestration run is active' });
      return true;
    }
    let reverted = false;
    try {
      reverted = ctx.orchestratorStore.revertToValidatedSnapshot(orchRevertId);
    } catch (err) {
      json(res, 400, { error: errorMessage(err) });
      return true;
    }
    if (!reverted) {
      json(res, 400, { error: 'No validated snapshot to revert to' });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  // POST /api/orchestrators/:id/execute — start orchestration run
  const orchExecId = matchOrchestratorExecute(pathname);
  if (req.method === 'POST' && orchExecId) {
    const orch = ctx.orchestratorStore.getById(orchExecId);
    if (!orch || orch.status === 'deleted') {
      json(res, 404, { error: 'Orchestrator not found' });
      return true;
    }
    if (orch.triggerMode === 'webhook') {
      json(res, 400, {
        error:
          'Webhook-triggered orchestrators cannot be started manually. Use the configured webhook endpoint.',
      });
      return true;
    }

    // Require successful DAG validation before execution
    if (!orch.dagValidated) {
      json(res, 400, { error: 'DAG has not been validated. Run validate first.' });
      return true;
    }

    // Check workdir permissions
    if (orch.workdir) {
      try {
        fs.accessSync(orch.workdir, fs.constants.W_OK | fs.constants.X_OK);
      } catch {
        json(res, 400, {
          error: `Workdir "${orch.workdir}" is not writable or not accessible. Check directory permissions.`,
        });
        return true;
      }
    }

    try {
      const runId = await ctx.orchestratorEngine.startRun(orchExecId, 'dashboard');
      json(res, 200, { ok: true, data: { runId } });
    } catch (err) {
      json(res, 400, { error: errorMessage(err) });
    }
    return true;
  }

  // POST /api/orchestrators/:id/rerun/:runId — rerun from node
  const orchRerun = matchOrchestratorRerun(pathname);
  if (req.method === 'POST' && orchRerun) {
    // Require validated DAG for reruns as well
    const rerunOrch = ctx.orchestratorStore.getById(orchRerun.orchestratorId);
    if (!rerunOrch || rerunOrch.status === 'deleted') {
      json(res, 404, { error: 'Orchestrator not found' });
      return true;
    }
    if (!rerunOrch.dagValidated) {
      json(res, 400, { error: 'DAG has not been validated. Run validate first.' });
      return true;
    }

    const body = await readBody(req);
    let parsed: Record<string, unknown> = {};
    try {
      if (body) parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      /* empty body is ok */
    }

    const fromNodeId = typeof parsed.fromNodeId === 'string' ? parsed.fromNodeId : undefined;

    try {
      const newRunId = await ctx.orchestratorEngine.startRerun(
        orchRerun.runId,
        fromNodeId,
        'dashboard',
      );
      json(res, 200, { ok: true, data: { runId: newRunId } });
    } catch (err) {
      json(res, 400, { error: errorMessage(err) });
    }
    return true;
  }

  // POST /api/orchestrators/:id/cancel/:runId — cancel run
  const orchCancel = matchOrchestratorCancel(pathname);
  if (req.method === 'POST' && orchCancel) {
    try {
      await ctx.orchestratorEngine.cancelRun(orchCancel.runId);
      json(res, 200, { ok: true });
    } catch (err) {
      json(res, 400, { error: errorMessage(err) });
    }
    return true;
  }

  // GET /api/orchestrators/:id/runs/:runId/stream — SSE for run status
  const orchRunStream = matchOrchestratorRunStream(pathname);
  if (req.method === 'GET' && orchRunStream) {
    const { runId } = orchRunStream;
    writeSseHeaders(res);
    sseRetry(res, 3000);
    const heartbeat = startHeartbeat(res);
    let lastSnapshot = '';

    const interval = setInterval(() => {
      if (res.writableEnded) {
        clearInterval(interval);
        clearInterval(heartbeat);
        return;
      }

      const active = ctx.orchestratorEngine.getActiveRun(runId);
      if (!active) {
        // Run ended or not found — send final state from DB
        const run = ctx.orchestratorStore.getRunById(runId);
        const nodeRuns = run ? ctx.orchestratorStore.getNodeRunsByRun(runId) : [];
        sseWrite(res, { type: 'state', run, nodeRuns });
        sseWrite(res, { type: 'done' });
        clearInterval(interval);
        clearInterval(heartbeat);
        if (!res.writableEnded) res.end();
        return;
      }

      // Emit state snapshot only if changed
      const nodeRunArr = [...active.nodeRuns.values()].map((nr) => ({
        nodeId: nr.nodeId,
        status: nr.status,
        returnValue: nr.returnValue,
        exitCode: nr.exitCode,
        errorMessage: nr.errorMessage,
      }));
      const snapshot = JSON.stringify(nodeRunArr);
      if (snapshot !== lastSnapshot) {
        lastSnapshot = snapshot;
        sseWrite(res, { type: 'state', nodeRuns: nodeRunArr });
        // If the stream has been destroyed/ended after the write, clean up.
        // Note: sseWrite may return false on backpressure (slow client) without
        // the connection being dead, so we check writableEnded explicitly.
        if (res.writableEnded) {
          clearInterval(interval);
          clearInterval(heartbeat);
          return;
        }
      }
    }, 2000);

    req.on('close', () => {
      clearInterval(interval);
      clearInterval(heartbeat);
    });
    return true;
  }

  return false;
}
