/** @module dashboard/routes/session-mcp — Dashboard API routes for per-session MCP server overrides. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { errorMessage } from '../../utils/error.js';
import { json, parseJson, readBody } from '../http.js';
import type { RouteContext } from '../route-context.js';
import { matchSessionMcpServerId, matchSessionMcpServers } from '../route-context.js';

interface SessionMcpToggleBody {
  enabled?: unknown;
}

export async function handleSessionMcpRoutes(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const sessionId = matchSessionMcpServers(pathname);
  if (req.method === 'GET' && sessionId) {
    const state = ctx.getDb().getSessionMcpServers(sessionId);
    if (!state) {
      json(res, 404, { error: 'Session not found' });
      return true;
    }
    json(res, 200, state);
    return true;
  }

  if (req.method === 'DELETE' && sessionId) {
    const state = ctx.getDb().resetSessionMcpServers(sessionId);
    if (!state) {
      json(res, 404, { error: 'Session not found' });
      return true;
    }
    json(res, 200, { ok: true, data: state });
    return true;
  }

  const sessionServer = matchSessionMcpServerId(pathname);
  if (req.method === 'PUT' && sessionServer) {
    const parsed = parseJson<SessionMcpToggleBody>(await readBody(req));
    if (typeof parsed?.enabled !== 'boolean') {
      json(res, 400, { error: 'enabled must be a boolean' });
      return true;
    }

    try {
      const state = ctx
        .getDb()
        .setSessionMcpServerEnabled(
          sessionServer.sessionId,
          sessionServer.serverId,
          parsed.enabled,
        );
      if (!state) {
        json(res, 404, { error: 'Session not found' });
        return true;
      }
      json(res, 200, { ok: true, data: state });
    } catch (err) {
      const message = errorMessage(err);
      json(res, message === 'Server not found for session tool' ? 404 : 400, { error: message });
    }
    return true;
  }

  return false;
}
