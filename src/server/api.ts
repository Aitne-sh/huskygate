/** @module server/api — Internal HTTP API server for the HuskyGate backend (localhost-only). */
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AppContext } from '../context/app-context.js';
import { isJsonContentType, json, parseUrl, readBody } from '../shared/http.js';
import { timingSafeEqualString } from '../shared/security.js';
import { errorMessage } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import { terminateProcess } from '../utils/platform.js';
import { findPidOnPort } from './daemon.js';
import type { NotificationService } from './notification-service.js';
import { handleAgentApiRoutes, matchesAgentApiPath } from './routes/agent-api.js';
import { handleArtifactApiRoutes, matchesArtifactApiPath } from './routes/artifact-api.js';
import {
  CODEX_ANSWER_MARKER,
  PROCESS_END_SEPARATOR,
  findProcessBoundary,
  handleChatApiRoutes,
  injectProcessSeparator,
  matchesChatApiPath,
} from './routes/chat-api.js';
import { handleOndemandApiRoutes, matchesOndemandApiPath } from './routes/ondemand-api.js';
import {
  handleOrchestratorApiRoutes,
  matchesOrchestratorApiPath,
} from './routes/orchestrator-api.js';
import { handleScheduleApiRoutes, matchesScheduleApiPath } from './routes/schedule-api.js';
import { handleSessionApiRoutes, matchesSessionApiPath } from './routes/session-api.js';
import { handleSettingsApiRoutes, matchesSettingsApiPath } from './routes/settings-api.js';
import { handleTunnelApiRoutes, matchesTunnelApiPath } from './routes/tunnel-api.js';
import {
  handlePublicWebhookRoute,
  handleWebhookApiRoutes,
  matchesWebhookApiPath,
} from './routes/webhook-api.js';
import { startJobStreamBufferCleanup } from './state.js';

export { matchJobStream, matchToolApproval } from '../shared/route-matchers.js';
export { CODEX_ANSWER_MARKER, PROCESS_END_SEPARATOR, findProcessBoundary, injectProcessSeparator };

type ApiRouteHandler = (
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
) => Promise<boolean>;

type ApiRouteRegistration = {
  matches: (pathname: string) => boolean;
  handle: ApiRouteHandler;
};

const AUTHENTICATED_API_ROUTES: ApiRouteRegistration[] = [
  { matches: matchesAgentApiPath, handle: handleAgentApiRoutes },
  { matches: matchesSettingsApiPath, handle: handleSettingsApiRoutes },
  { matches: matchesWebhookApiPath, handle: handleWebhookApiRoutes },
  { matches: matchesTunnelApiPath, handle: handleTunnelApiRoutes },
  { matches: matchesSessionApiPath, handle: handleSessionApiRoutes },
  { matches: matchesChatApiPath, handle: handleChatApiRoutes },
  { matches: matchesArtifactApiPath, handle: handleArtifactApiRoutes },
  { matches: matchesScheduleApiPath, handle: handleScheduleApiRoutes },
  { matches: matchesOndemandApiPath, handle: handleOndemandApiRoutes },
  { matches: matchesOrchestratorApiPath, handle: handleOrchestratorApiRoutes },
];

function verifyBearer(req: IncomingMessage, secret: string): boolean {
  const header = req.headers.authorization;
  if (!header) return false;
  const [scheme, token] = header.split(' ', 2);
  return scheme === 'Bearer' && !!token && timingSafeEqualString(token, secret);
}

function isAuthorizedRequest(req: IncomingMessage, pathname: string, adminSecret: string): boolean {
  if (verifyBearer(req, adminSecret)) return true;
  if (!matchesScheduleApiPath(pathname)) return false;
  // HUSKYGATE_API_SECRET is a derived key synced to process.env via syncProcessEnvFromResolver.
  // Reading from process.env here picks up hot-reloaded values (mutable + skill scope).
  const scheduleSkillSecret = process.env.HUSKYGATE_API_SECRET;
  if (!scheduleSkillSecret) return false;
  return verifyBearer(req, scheduleSkillSecret);
}

export function createApiServer(ctx: AppContext, notificationService: NotificationService): Server {
  const apiSecret = ctx.config.serverApiSecret;

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const { pathname } = parseUrl(req.url);

    try {
      if (req.method === 'GET' && pathname === '/health') {
        json(res, 200, { ok: true });
        return;
      }

      if (await handlePublicWebhookRoute(ctx, req, res, pathname)) {
        return;
      }

      if (!isAuthorizedRequest(req, pathname, apiSecret)) {
        json(res, 401, { error: 'Unauthorized' });
        return;
      }

      // Reject non-JSON Content-Type on mutation requests (POST/PATCH/PUT)
      const method = req.method ?? '';
      if ((method === 'POST' || method === 'PATCH' || method === 'PUT') && !isJsonContentType(req)) {
        json(res, 415, { error: 'Unsupported Media Type: expected application/json' });
        return;
      }

      for (const route of AUTHENTICATED_API_ROUTES) {
        if (!route.matches(pathname)) continue;
        if (await route.handle(ctx, req, res, pathname)) {
          return;
        }
      }

      if (req.method === 'POST' && pathname === '/api/notify') {
        const body = await readBody(req);
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(body) as Record<string, unknown>;
        } catch {
          json(res, 400, { error: 'Invalid JSON' });
          return;
        }
        const channel = typeof parsed.channel === 'string' ? parsed.channel.trim() : '';
        const text = typeof parsed.text === 'string' ? parsed.text : '';
        if (!channel) {
          json(res, 400, { error: 'channel is required' });
          return;
        }
        if (!text.trim()) {
          json(res, 400, { error: 'text is required' });
          return;
        }
        const threadTsRaw = typeof parsed.thread_ts === 'string' ? parsed.thread_ts.trim() : '';
        const threadTs = threadTsRaw || undefined;
        try {
          const result = await notificationService.postNotification(channel, text, threadTs);
          json(res, 200, { ok: true, data: { ts: result.ts, channel: result.channel } });
        } catch (notificationError) {
          logger.error('notification_post_failed', { error: errorMessage(notificationError) });
          json(res, 502, { error: 'Notification service error' });
        }
        return;
      }

      if (req.method === 'GET' && pathname === '/api/slack/targets') {
        try {
          const targets = await notificationService.listTargets();
          json(res, 200, { ok: true, data: targets });
        } catch (notificationError) {
          logger.error('notification_list_targets_failed', {
            error: errorMessage(notificationError),
          });
          json(res, 502, { error: 'Notification service error' });
        }
        return;
      }

      json(res, 404, { error: 'Not Found' });
    } catch (err) {
      const message = errorMessage(err);
      if (message === 'Body too large') {
        json(res, 413, { error: 'Request body too large' });
      } else {
        logger.error('api_server_error', { error: message, path: pathname });
        json(res, 500, { error: 'Internal server error' });
      }
    }
  });
}

export function startApiServer(ctx: AppContext, notificationService: NotificationService): Server {
  const port = ctx.config.serverApiPort;
  const host = ctx.config.serverApiHost ?? '127.0.0.1';
  const server = createApiServer(ctx, notificationService);

  startJobStreamBufferCleanup(server);

  let eaddrinuseRetried = false;
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      if (eaddrinuseRetried) {
        logger.error('api_port_in_use_fatal', { port, msg: 'retry also failed' });
        process.exit(1);
      }
      logger.warn('api_port_in_use', { port, action: 'attempting_recovery' });
      const stalePid = findPidOnPort(port);
      if (stalePid !== null) {
        logger.info('killing_stale_process', { pid: stalePid, port });
        try {
          terminateProcess(stalePid);
        } catch {
          /* already gone */
        }
        eaddrinuseRetried = true;
        setTimeout(() => {
          server.listen(port, host, () => {
            logger.info('api_server_started', { port, host, recovered: true });
          });
        }, 1000);
        return;
      }
      logger.error('api_port_in_use_fatal', { port, msg: 'no stale process found' });
      process.exit(1);
    }
    logger.error('api_server_error', { port, code: err.code, error: errorMessage(err) });
    process.exit(1);
  });

  server.listen(port, host, () => {
    logger.info('api_server_started', { port, host });
  });
  return server;
}
