/** @module dashboard/routes/event-triggers — Dashboard API routes for webhook endpoints and event subscriptions. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, readBody } from '../../shared/http.js';
import {
  matchEventSubscriptionId,
  matchEventSubscriptionTest,
  matchTriggeredTaskExecute,
  matchTriggeredTaskId,
  matchTriggeredTaskRuns,
  matchWebhookEndpointId,
} from '../../shared/route-matchers.js';
import type { RouteContext } from '../route-context.js';

function withQuery(path: string, query: URLSearchParams): string {
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export async function handleEventTriggerRoutes(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  query: URLSearchParams,
): Promise<boolean> {
  if (req.method === 'GET' && pathname === '/api/webhook-endpoints') {
    const apiRes = await ctx.proxyToServerApi('GET', '/api/webhook-endpoints');
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/webhook-endpoints') {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi('POST', '/api/webhook-endpoints', body);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  const endpointId = matchWebhookEndpointId(pathname);
  if (endpointId && req.method === 'GET') {
    const apiRes = await ctx.proxyToServerApi('GET', `/api/webhook-endpoints/${endpointId}`);
    json(res, apiRes.status, apiRes.data);
    return true;
  }
  if (endpointId && req.method === 'PATCH') {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi(
      'PATCH',
      `/api/webhook-endpoints/${endpointId}`,
      body,
    );
    json(res, apiRes.status, apiRes.data);
    return true;
  }
  if (endpointId && req.method === 'DELETE') {
    const apiRes = await ctx.proxyToServerApi('DELETE', `/api/webhook-endpoints/${endpointId}`);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/event-subscriptions') {
    const apiRes = await ctx.proxyToServerApi('GET', '/api/event-subscriptions');
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/event-subscriptions') {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi('POST', '/api/event-subscriptions', body);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  const subscriptionId = matchEventSubscriptionId(pathname);
  if (subscriptionId && req.method === 'PATCH') {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi(
      'PATCH',
      `/api/event-subscriptions/${subscriptionId}`,
      body,
    );
    json(res, apiRes.status, apiRes.data);
    return true;
  }
  if (subscriptionId && req.method === 'DELETE') {
    const apiRes = await ctx.proxyToServerApi(
      'DELETE',
      `/api/event-subscriptions/${subscriptionId}`,
    );
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  const subscriptionTestId = matchEventSubscriptionTest(pathname);
  if (subscriptionTestId && req.method === 'POST') {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi(
      'POST',
      `/api/event-subscriptions/${subscriptionTestId}/test`,
      body,
    );
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/triggered-tasks') {
    const apiRes = await ctx.proxyToServerApi('GET', '/api/triggered-tasks');
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/triggered-tasks') {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi('POST', '/api/triggered-tasks', body);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  const triggeredTaskId = matchTriggeredTaskId(pathname);
  if (triggeredTaskId && req.method === 'GET') {
    const apiRes = await ctx.proxyToServerApi('GET', `/api/triggered-tasks/${triggeredTaskId}`);
    json(res, apiRes.status, apiRes.data);
    return true;
  }
  if (triggeredTaskId && req.method === 'PATCH') {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi(
      'PATCH',
      `/api/triggered-tasks/${triggeredTaskId}`,
      body,
    );
    json(res, apiRes.status, apiRes.data);
    return true;
  }
  if (triggeredTaskId && req.method === 'DELETE') {
    const apiRes = await ctx.proxyToServerApi('DELETE', `/api/triggered-tasks/${triggeredTaskId}`);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // POST /api/triggered-tasks/:id/execute — proxy to server API
  const triggeredTaskExecuteId = matchTriggeredTaskExecute(pathname);
  if (req.method === 'POST' && triggeredTaskExecuteId) {
    const apiRes = await ctx.proxyToServerApi(
      'POST',
      `/api/triggered-tasks/${triggeredTaskExecuteId}/execute`,
    );
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  const triggeredTaskRunsId = matchTriggeredTaskRuns(pathname);
  if (triggeredTaskRunsId && req.method === 'GET') {
    const apiRes = await ctx.proxyToServerApi(
      'GET',
      withQuery(`/api/triggered-tasks/${triggeredTaskRunsId}/runs`, query),
    );
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  // ── Tunnel management ──
  if (req.method === 'GET' && pathname === '/api/tunnel/status') {
    const apiRes = await ctx.proxyToServerApi('GET', '/api/tunnel/status');
    json(res, apiRes.status, apiRes.data);
    return true;
  }
  if (req.method === 'POST' && pathname === '/api/tunnel/start') {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi('POST', '/api/tunnel/start', body);
    json(res, apiRes.status, apiRes.data);
    return true;
  }
  if (req.method === 'POST' && pathname === '/api/tunnel/stop') {
    const body = await readBody(req);
    const apiRes = await ctx.proxyToServerApi('POST', '/api/tunnel/stop', body);
    json(res, apiRes.status, apiRes.data);
    return true;
  }

  return false;
}
