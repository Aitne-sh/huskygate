/** @module dashboard/routes/agents — Dashboard proxy routes for AI Agent CRUD. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, readBody } from '../http.js';
import type { RouteContext } from '../route-context.js';

export async function handleAgentRoutes(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  _query: URLSearchParams,
): Promise<boolean> {
  if (!pathname.startsWith('/api/agents')) return false;

  // Proxy all agent API calls to the server API
  if (req.method === 'GET') {
    const apiRes = await ctx.proxyToServerApi('GET', pathname);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') {
    const body = req.method === 'DELETE' ? undefined : await readBody(req);
    const apiRes = await ctx.proxyToServerApi(req.method, pathname, body);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  return false;
}
