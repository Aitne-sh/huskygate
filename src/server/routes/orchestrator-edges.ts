/** @module server/routes/orchestrator-edges — Edge CRUD routes for orchestrators. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../../context/app-context.js';
import { json, readBody } from '../../shared/http.js';
import { matchOrchestratorEdgeId, matchOrchestratorEdges } from '../../shared/route-matchers.js';
import { CreateEdgeSchema, PatchEdgeSchema } from '../../shared/schemas/orchestrator.js';
import { formatZodError } from '../../shared/schemas/validation.js';

/**
 * Handle edge CRUD routes for orchestrators.
 *
 * Returns `true` if the route was handled (response sent), `false` otherwise.
 */
export async function handleOrchestratorEdgeRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  // ── Edge CRUD ─────────────────────────────────────────────

  // POST /api/orchestrators/:id/edges — create edge
  const orchEdgesId = matchOrchestratorEdges(pathname);
  if (req.method === 'POST' && orchEdgesId) {
    const orch = ctx.orchestratorStore.getById(orchEdgesId);
    if (!orch || orch.status === 'deleted') {
      json(res, 404, { error: 'Orchestrator not found' });
      return true;
    }
    const body = await readBody(req);
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }

    const result = CreateEdgeSchema.safeParse(raw);
    if (!result.success) {
      json(res, 400, { error: formatZodError(result.error) });
      return true;
    }
    const { fromNodeId, toNodeId, conditionValue, conditionOperator, sortOrder } = result.data;

    // Verify both nodes exist and belong to this orchestrator
    const fromNode = ctx.orchestratorStore.getNodeById(fromNodeId);
    const toNode = ctx.orchestratorStore.getNodeById(toNodeId);
    if (!fromNode || fromNode.orchestratorId !== orchEdgesId) {
      json(res, 400, { error: 'fromNodeId not found in this orchestrator' });
      return true;
    }
    if (!toNode || toNode.orchestratorId !== orchEdgesId) {
      json(res, 400, { error: 'toNodeId not found in this orchestrator' });
      return true;
    }

    const edge = ctx.orchestratorStore.createEdge({
      orchestratorId: orchEdgesId,
      fromNodeId,
      toNodeId,
      conditionValue: conditionValue ?? null,
      conditionOperator,
      sortOrder,
    });
    ctx.orchestratorStore.invalidateDag(orchEdgesId);
    json(res, 201, { ok: true, data: edge });
    return true;
  }

  // PATCH /api/orchestrators/:oid/edges/:eid — update edge
  const orchEdgeId = matchOrchestratorEdgeId(pathname);
  if (req.method === 'PATCH' && orchEdgeId) {
    const edge = ctx.orchestratorStore.getEdgeById(orchEdgeId.edgeId);
    if (!edge) {
      json(res, 404, { error: 'Edge not found' });
      return true;
    }
    const body = await readBody(req);
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }

    const result = PatchEdgeSchema.safeParse(raw);
    if (!result.success) {
      json(res, 400, { error: formatZodError(result.error) });
      return true;
    }

    ctx.orchestratorStore.updateEdge(orchEdgeId.edgeId, result.data);
    ctx.orchestratorStore.invalidateDag(orchEdgeId.orchestratorId);
    const updated = ctx.orchestratorStore.getEdgeById(orchEdgeId.edgeId);
    json(res, 200, { ok: true, data: updated });
    return true;
  }

  // DELETE /api/orchestrators/:oid/edges/:eid — delete edge
  if (req.method === 'DELETE' && orchEdgeId) {
    const edge = ctx.orchestratorStore.getEdgeById(orchEdgeId.edgeId);
    if (!edge) {
      json(res, 404, { error: 'Edge not found' });
      return true;
    }
    ctx.orchestratorStore.deleteEdge(orchEdgeId.edgeId);
    ctx.orchestratorStore.invalidateDag(orchEdgeId.orchestratorId);
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
