/** @module dashboard/routes/orchestrator — Dashboard API routes for orchestrator CRUD and execution. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, readBody } from '../../shared/http.js';
import {
  matchOrchestratorCancel,
  matchOrchestratorEdgeId,
  matchOrchestratorEdges,
  matchOrchestratorExecute,
  matchOrchestratorId,
  matchOrchestratorNodeId,
  matchOrchestratorNodes,
  matchOrchestratorRerun,
  matchOrchestratorRevertSnapshot,
  matchOrchestratorRunId,
  matchOrchestratorRunStream,
  matchOrchestratorRuns,
  matchOrchestratorRunsOverview,
  matchOrchestratorValidate,
} from '../../shared/route-matchers.js';
import type { RouteContext } from '../route-context.js';

export async function handleOrchestratorRoutes(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  _query: URLSearchParams,
): Promise<boolean> {
  // ── List orchestrators ──
  if (req.method === 'GET' && pathname === '/api/orchestrators') {
    const db = ctx.getDb();
    const orchestrators = db.getOrchestrators();
    json(res, 200, { ok: true, data: orchestrators });
    return true;
  }

  // ── Get orchestrator by ID (with nodes + edges) ──
  const orchId = matchOrchestratorId(pathname);
  if (req.method === 'GET' && orchId) {
    const db = ctx.getDb();
    const orch = db.getOrchestratorById(orchId);
    if (!orch) {
      json(res, 404, { error: 'Orchestrator not found' });
      return true;
    }
    json(res, 200, { ok: true, data: orch });
    return true;
  }

  // ── Create orchestrator (proxy) ──
  if (req.method === 'POST' && pathname === '/api/orchestrators') {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi('POST', '/api/orchestrators', body);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // ── Update orchestrator (proxy) ──
  if (req.method === 'PATCH' && orchId) {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi('PATCH', `/api/orchestrators/${orchId}`, body);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // ── Delete orchestrator (proxy) ──
  if (req.method === 'DELETE' && orchId) {
    const apiRes = await ctx.proxyToServerApi('DELETE', `/api/orchestrators/${orchId}`);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // ── Node CRUD ──

  const nodesOrchId = matchOrchestratorNodes(pathname);
  if (req.method === 'POST' && nodesOrchId) {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi(
      'POST',
      `/api/orchestrators/${nodesOrchId}/nodes`,
      body,
    );
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  const nodeIdMatch = matchOrchestratorNodeId(pathname);
  if (req.method === 'PATCH' && nodeIdMatch) {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi(
      'PATCH',
      `/api/orchestrators/${nodeIdMatch.orchestratorId}/nodes/${nodeIdMatch.nodeId}`,
      body,
    );
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  if (req.method === 'DELETE' && nodeIdMatch) {
    const apiRes = await ctx.proxyToServerApi(
      'DELETE',
      `/api/orchestrators/${nodeIdMatch.orchestratorId}/nodes/${nodeIdMatch.nodeId}`,
    );
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // ── Edge CRUD ──

  const edgesOrchId = matchOrchestratorEdges(pathname);
  if (req.method === 'POST' && edgesOrchId) {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi(
      'POST',
      `/api/orchestrators/${edgesOrchId}/edges`,
      body,
    );
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  const edgeIdMatch = matchOrchestratorEdgeId(pathname);
  if (req.method === 'PATCH' && edgeIdMatch) {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi(
      'PATCH',
      `/api/orchestrators/${edgeIdMatch.orchestratorId}/edges/${edgeIdMatch.edgeId}`,
      body,
    );
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  if (req.method === 'DELETE' && edgeIdMatch) {
    const apiRes = await ctx.proxyToServerApi(
      'DELETE',
      `/api/orchestrators/${edgeIdMatch.orchestratorId}/edges/${edgeIdMatch.edgeId}`,
    );
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // ── Validate DAG ──
  const validateId = matchOrchestratorValidate(pathname);
  if (req.method === 'POST' && validateId) {
    const valBody = await readBody(req);
    const apiRes = await ctx.proxyToServerApi(
      'POST',
      `/api/orchestrators/${validateId}/validate`,
      valBody || undefined,
    );
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // ── Revert to validated snapshot ──
  const revertId = matchOrchestratorRevertSnapshot(pathname);
  if (req.method === 'POST' && revertId) {
    const apiRes = await ctx.proxyToServerApi('POST', `/api/orchestrators/${revertId}/revert`);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // ── Execute ──
  const execId = matchOrchestratorExecute(pathname);
  if (req.method === 'POST' && execId) {
    const apiRes = await ctx.proxyToServerApi('POST', `/api/orchestrators/${execId}/execute`);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // ── Runs overview (aggregated runs + node runs) ──
  const runsOverviewOrchId = matchOrchestratorRunsOverview(pathname);
  if (req.method === 'GET' && runsOverviewOrchId) {
    const db = ctx.getDb();
    const runsOverview = db.getOrchestratorRunsOverview(runsOverviewOrchId);
    if (!runsOverview) {
      json(res, 404, { error: 'Orchestrator not found' });
      return true;
    }
    json(res, 200, { ok: true, data: runsOverview });
    return true;
  }

  // ── Runs ──
  const runsOrchId = matchOrchestratorRuns(pathname);
  if (req.method === 'GET' && runsOrchId) {
    const db = ctx.getDb();
    const runs = db.getOrchestratorRuns(runsOrchId);
    json(res, 200, { ok: true, data: runs });
    return true;
  }

  const runIdMatch = matchOrchestratorRunId(pathname);
  if (req.method === 'GET' && runIdMatch) {
    const db = ctx.getDb();
    const run = db.getOrchestratorRunById(runIdMatch.runId);
    if (!run) {
      json(res, 404, { error: 'Run not found' });
      return true;
    }
    json(res, 200, { ok: true, data: run });
    return true;
  }

  // ── Rerun ──
  const rerunMatch = matchOrchestratorRerun(pathname);
  if (req.method === 'POST' && rerunMatch) {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi(
      'POST',
      `/api/orchestrators/${rerunMatch.orchestratorId}/rerun/${rerunMatch.runId}`,
      body,
    );
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // ── Cancel ──
  const cancelMatch = matchOrchestratorCancel(pathname);
  if (req.method === 'POST' && cancelMatch) {
    const apiRes = await ctx.proxyToServerApi(
      'POST',
      `/api/orchestrators/${cancelMatch.orchestratorId}/cancel/${cancelMatch.runId}`,
    );
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // ── Run stream (SSE proxy) ──
  const streamMatch = matchOrchestratorRunStream(pathname);
  if (req.method === 'GET' && streamMatch) {
    await ctx.proxySSEGet(
      `/api/orchestrators/${streamMatch.orchestratorId}/runs/${streamMatch.runId}/stream`,
      req,
      res,
    );
    return true;
  }

  return false;
}
