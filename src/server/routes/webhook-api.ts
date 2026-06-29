/** @module server/routes/webhook-api — Server API routes for webhook endpoint and event subscription management. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../../context/app-context.js';
import { WebhookDispatchError } from '../../event/event-router.js';
import { json, readBodyBuffer } from '../../shared/http.js';
import { matchWebhookToken } from '../../shared/route-matchers.js';
import { errorMessage } from '../../utils/error.js';
import { logger } from '../../utils/logger.js';
import { extractClientIp } from '../github-ip-allowlist.js';
import { handleEndpointRoutes } from './webhook-endpoints.js';
import { handleSubscriptionRoutes } from './webhook-subscriptions.js';
import { handleTriggeredTaskRoutes } from './webhook-triggered-tasks.js';

export function matchesWebhookApiPath(pathname: string): boolean {
  return (
    pathname === '/api/webhook-endpoints' ||
    pathname.startsWith('/api/webhook-endpoints/') ||
    pathname === '/api/event-subscriptions' ||
    pathname.startsWith('/api/event-subscriptions/') ||
    pathname === '/api/triggered-tasks' ||
    pathname.startsWith('/api/triggered-tasks/')
  );
}

export async function handlePublicWebhookRoute(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const token = matchWebhookToken(pathname);
  if (req.method !== 'POST' || !token) return false;

  const endpoint = ctx.eventRouter.getEndpointByToken(token);
  if (!endpoint) {
    json(res, 404, { error: 'endpoint_not_found' });
    return true;
  }

  // Resolve the real client IP once — used for both IP allowlist and dispatch metadata.
  const clientIp = extractClientIp(req, ctx.tunnelEnabled);

  // GitHub IP allowlist check (defense-in-depth on top of HMAC verification).
  if (endpoint.publisherPreset === 'github' && ctx.githubIpAllowlist && ctx.tunnelEnabled) {
    if (!ctx.githubIpAllowlist.isAllowed(clientIp)) {
      logger.warn('webhook_ip_rejected', {
        ip: clientIp,
        endpointId: endpoint.id,
        preset: endpoint.publisherPreset,
      });
      json(res, 403, { error: 'ip_not_allowed' });
      return true;
    }
  }

  let body: Buffer;
  try {
    body = await readBodyBuffer(req, endpoint.maxBodyBytes);
  } catch (err) {
    json(res, 413, { error: errorMessage(err) });
    return true;
  }

  try {
    const result = await ctx.eventRouter.dispatchWebhook(
      endpoint,
      body,
      req.headers,
      clientIp || undefined,
    );
    if (result.challenge !== undefined) {
      json(res, 200, { challenge: result.challenge });
    } else {
      json(res, 202, result);
    }
  } catch (err) {
    if (err instanceof WebhookDispatchError) {
      json(res, err.status, err.body);
      return true;
    }
    logger.error('webhook_dispatch_unhandled_error', { error: errorMessage(err) });
    json(res, 500, { error: 'internal_error' });
  }
  return true;
}

export async function handleWebhookApiRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  // Route by prefix to avoid an async microtask gap between sub-handlers.
  // readBody() attaches stream listeners synchronously — if the wrong handler
  // is awaited first, buffered request data events can be missed.
  if (pathname === '/api/webhook-endpoints' || pathname.startsWith('/api/webhook-endpoints/')) {
    return handleEndpointRoutes(ctx, req, res, pathname);
  }
  if (pathname === '/api/event-subscriptions' || pathname.startsWith('/api/event-subscriptions/')) {
    return handleSubscriptionRoutes(ctx, req, res, pathname);
  }
  return handleTriggeredTaskRoutes(ctx, req, res, pathname);
}
