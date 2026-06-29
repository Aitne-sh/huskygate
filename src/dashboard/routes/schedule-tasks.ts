/** @module dashboard/routes/schedule-tasks — Dashboard API routes for scheduled task CRUD. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, readBody } from '../../shared/http.js';
import type { RouteContext } from '../route-context.js';
export async function handleScheduleTaskRoutes(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  query: URLSearchParams,
): Promise<boolean> {
  // GET /api/schedule-tasks — list tasks (read from DB)
  if (req.method === 'GET' && pathname === '/api/schedule-tasks') {
    const db = ctx.getDb();
    const tasks = db.getScheduledTasks();
    json(res, 200, { ok: true, data: tasks });
    return true;
  }

  // Match /api/schedule-tasks/:id
  const taskIdMatch = pathname.match(/^\/api\/schedule-tasks\/([a-f0-9-]{36})$/);
  const taskId = taskIdMatch?.[1] ?? null;

  // GET /api/schedule-tasks/:id — task detail with recent runs
  if (req.method === 'GET' && taskId) {
    const db = ctx.getDb();
    const task = db.getScheduledTaskById(taskId);
    if (!task) {
      json(res, 404, { error: 'Task not found' });
      return true;
    }
    const runs = db.getScheduledTaskRuns(taskId, 10);
    json(res, 200, { ok: true, data: { ...task, recentRuns: runs } });
    return true;
  }

  // Match /api/schedule-tasks/:id/runs
  const runsMatch = pathname.match(/^\/api\/schedule-tasks\/([a-f0-9-]{36})\/runs$/);
  const runsTaskId = runsMatch?.[1] ?? null;

  // GET /api/schedule-tasks/:id/runs — list runs
  if (req.method === 'GET' && runsTaskId) {
    const db = ctx.getDb();
    const limit = Math.min(Math.max(Number.parseInt(query.get('limit') ?? '20', 10) || 20, 1), 100);
    const runs = db.getScheduledTaskRuns(runsTaskId, limit);
    json(res, 200, { ok: true, data: runs });
    return true;
  }

  // POST /api/schedule-tasks — proxy to server API
  if (req.method === 'POST' && pathname === '/api/schedule-tasks') {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi('POST', '/api/schedules', body);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // PATCH /api/schedule-tasks/:id — proxy to server API
  if (req.method === 'PATCH' && taskId) {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi('PATCH', `/api/schedules/${taskId}`, body);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // POST /api/schedule-tasks/:id/execute — proxy to server API
  const executeMatch = pathname.match(/^\/api\/schedule-tasks\/([a-f0-9-]{36})\/execute$/);
  const executeTaskId = executeMatch?.[1] ?? null;
  if (req.method === 'POST' && executeTaskId) {
    const apiRes = await ctx.proxyToServerApi('POST', `/api/schedules/${executeTaskId}/execute`);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // DELETE /api/schedule-tasks/:id — proxy to server API
  if (req.method === 'DELETE' && taskId) {
    const apiRes = await ctx.proxyToServerApi('DELETE', `/api/schedules/${taskId}`);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // GET /api/slack/targets — proxy to server API
  if (req.method === 'GET' && pathname === '/api/slack/targets') {
    const apiRes = await ctx.proxyToServerApi('GET', '/api/slack/targets');
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // POST /api/notify — proxy to server API
  if (req.method === 'POST' && pathname === '/api/notify') {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi('POST', '/api/notify', body);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  return false;
}
