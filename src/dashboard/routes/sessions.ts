/** @module dashboard/routes/sessions — Dashboard API routes for session listing, detail, and log streaming. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeSseHeaders } from '../../shared/sse.js';
import { errorMessage } from '../../utils/error.js';
import {
  LOG_TAIL_HEARTBEAT_MS,
  createLogTail,
  dashLog,
  json,
  readLogLines,
  readMergedLogLines,
} from '../http.js';
import type { RouteContext } from '../route-context.js';
import {
  matchSessionAudit,
  matchSessionAuditJobMessages,
  matchSessionId,
  matchSessionTrace,
} from '../route-context.js';

export async function handleSessionRoutes(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  query: URLSearchParams,
): Promise<boolean> {
  // GET /api/sessions — local DB read
  if (req.method === 'GET' && pathname === '/api/sessions') {
    try {
      const sessions = ctx.getDb().listSessions();
      json(res, 200, sessions);
    } catch (err) {
      dashLog('warn', 'api_sessions_list_error', { error: errorMessage(err) });
      json(res, 200, []);
    }
    return true;
  }

  // GET /api/sessions/:id/audit/:jobId/messages — local DB read
  const jobMsgMatch = matchSessionAuditJobMessages(pathname);
  if (req.method === 'GET' && jobMsgMatch) {
    const messages = ctx.getDb().getJobMessages(jobMsgMatch.sessionId, jobMsgMatch.jobId);
    json(res, 200, messages);
    return true;
  }

  // GET /api/sessions/:id/trace — local DB read
  const traceId = matchSessionTrace(pathname);
  if (req.method === 'GET' && traceId) {
    const trace = ctx.getDb().getSessionTrace(traceId);
    if (!trace) {
      json(res, 404, { error: 'Session not found' });
    } else {
      json(res, 200, trace);
    }
    return true;
  }

  // GET /api/sessions/:id/audit — local DB read
  const auditId = matchSessionAudit(pathname);
  if (req.method === 'GET' && auditId) {
    const rows = ctx.getDb().getSessionAudit(auditId);
    json(res, 200, rows);
    return true;
  }

  // DELETE /api/sessions/:id → proxy to Server API
  const deleteId = matchSessionId(pathname);
  if (req.method === 'DELETE' && deleteId) {
    const result = await ctx.proxyToServerApi('DELETE', `/api/sessions/${deleteId}`);
    json(res, result.status, result.data);
    return true;
  }

  // DELETE /api/sessions (clear all) → proxy to Server API
  if (req.method === 'DELETE' && pathname === '/api/sessions') {
    const result = await ctx.proxyToServerApi('DELETE', '/api/sessions');
    json(res, result.status, result.data);
    return true;
  }

  // GET /api/logs/stream — SSE live tail
  if (req.method === 'GET' && pathname === '/api/logs/stream') {
    const rawSource = query.get('source');
    const source = rawSource === 'server' || rawSource === 'dashboard' ? rawSource : 'all';
    const files: { path: string; source: 'server' | 'dashboard' }[] = [];
    if (source === 'all' || source === 'server') {
      files.push({ path: ctx.logPath, source: 'server' });
    }
    if (source === 'all' || source === 'dashboard') {
      files.push({ path: ctx.dashboardLogPath, source: 'dashboard' });
    }

    writeSseHeaders(res);

    let sseId = 0;
    const tail = createLogTail(files, (lines) => {
      for (const line of lines) {
        sseId++;
        const ok = res.write(`id: ${sseId}\ndata: ${JSON.stringify(line)}\n\n`);
        if (!ok) break; // backpressure
      }
    });

    const heartbeat = setInterval(() => {
      if (!res.destroyed) res.write(': heartbeat\n\n');
    }, LOG_TAIL_HEARTBEAT_MS);

    res.on('close', () => {
      tail.stop();
      clearInterval(heartbeat);
    });
    return true;
  }

  // GET /api/logs — local file read
  if (req.method === 'GET' && pathname === '/api/logs') {
    const limit = Math.min(
      Math.max(Number.parseInt(query.get('limit') ?? '200', 10) || 200, 1),
      1000,
    );
    const offset = Math.max(Number.parseInt(query.get('offset') ?? '0', 10) || 0, 0);
    const level = query.get('level') || undefined;
    const rawSource = query.get('source');
    const source = rawSource === 'server' || rawSource === 'dashboard' ? rawSource : 'all';
    const result =
      source === 'all'
        ? readMergedLogLines(ctx.logPath, ctx.dashboardLogPath, limit, offset, level)
        : readLogLines(
            source === 'dashboard' ? ctx.dashboardLogPath : ctx.logPath,
            limit,
            offset,
            level,
          );
    json(res, 200, result);
    return true;
  }

  return false;
}
