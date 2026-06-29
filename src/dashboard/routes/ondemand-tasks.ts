/** @module dashboard/routes/ondemand-tasks — Dashboard API routes for on-demand task CRUD and execution. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, readBody } from '../../shared/http.js';
import {
  matchOndemandTaskExecute,
  matchOndemandTaskId,
  matchOndemandTaskRuns,
} from '../../shared/route-matchers.js';
import type { RouteContext } from '../route-context.js';

/**
 * Dashboard route handler for On-Demand Tasks.
 * Read operations go directly to DashboardDb.
 * Mutations and execute are proxied to the Server Internal API.
 */
export async function handleOndemandTaskRoutes(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  query: URLSearchParams,
): Promise<boolean> {
  // GET /api/ondemand-tasks — list tasks (read from DB)
  if (req.method === 'GET' && pathname === '/api/ondemand-tasks') {
    const db = ctx.getDb();
    const tasks = db.getOndemandTasks();
    json(res, 200, { ok: true, data: tasks });
    return true;
  }

  const taskId = matchOndemandTaskId(pathname);
  const runsTaskId = matchOndemandTaskRuns(pathname);
  const execTaskId = matchOndemandTaskExecute(pathname);

  // GET /api/ondemand-tasks/:id — task detail with recent runs
  if (req.method === 'GET' && taskId) {
    const db = ctx.getDb();
    const task = db.getOndemandTaskById(taskId);
    if (!task) {
      json(res, 404, { error: 'Task not found' });
      return true;
    }
    const runs = db.getOndemandTaskRuns(taskId, 10);
    json(res, 200, { ok: true, data: { ...task, recentRuns: runs } });
    return true;
  }

  // GET /api/ondemand-tasks/:id/runs — list runs
  if (req.method === 'GET' && runsTaskId) {
    const db = ctx.getDb();
    const limit = Math.min(Math.max(Number.parseInt(query.get('limit') ?? '20', 10) || 20, 1), 100);
    const runs = db.getOndemandTaskRuns(runsTaskId, limit);
    json(res, 200, { ok: true, data: runs });
    return true;
  }

  // POST /api/ondemand-tasks — proxy to server API
  if (req.method === 'POST' && pathname === '/api/ondemand-tasks') {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi('POST', '/api/ondemand-tasks', body);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // POST /api/ondemand-tasks/:id/execute — proxy to server API
  if (req.method === 'POST' && execTaskId) {
    const apiRes = await ctx.proxyToServerApi('POST', `/api/ondemand-tasks/${execTaskId}/execute`);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // PATCH /api/ondemand-tasks/:id — proxy to server API
  if (req.method === 'PATCH' && taskId) {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi('PATCH', `/api/ondemand-tasks/${taskId}`, body);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // DELETE /api/ondemand-tasks/:id — proxy to server API
  if (req.method === 'DELETE' && taskId) {
    const apiRes = await ctx.proxyToServerApi('DELETE', `/api/ondemand-tasks/${taskId}`);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  return false;
}
