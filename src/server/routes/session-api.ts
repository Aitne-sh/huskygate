/** @module server/routes/session-api — Server API routes for session lifecycle (create, stop, restart). */
import { mkdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { AppContext } from '../../context/app-context.js';
import { json, readBody } from '../../shared/http.js';
import { matchSessionId } from '../../shared/route-matchers.js';
import { logger } from '../../utils/logger.js';
import { cleanupWorkdir as cleanupWorkdirSafe } from '../../utils/workdir.js';

export function matchesSessionApiPath(pathname: string): boolean {
  return pathname === '/api/sessions' || pathname.startsWith('/api/sessions/');
}

/* ── session cleanup ── */

function cleanupWorkdir(ctx: AppContext, workdir: string | null): void {
  try {
    cleanupWorkdirSafe(ctx.config.workdirRoot, workdir);
  } catch (err) {
    logger.warn('workdir_cleanup_failed', {
      workdir: workdir ? path.resolve(workdir) : null,
      error: String(err),
    });
  }
}

function cleanupSessionState(ctx: AppContext, sessionKey: string, threadKey: string | null): void {
  const active = ctx.activeRunners.get(sessionKey);
  if (active) {
    active.runner.kill('orchestrator_shutdown');
    ctx.activeRunners.delete(sessionKey);
  }
  ctx.jobQueue.cancelSession(sessionKey);

  if (threadKey) {
    ctx.pendingToolApprovals.delete(threadKey);
    ctx.pendingMcpAuthBypassApprovals.delete(threadKey);
    ctx.pendingConfirmations.delete(threadKey);
    const timer = ctx.inactivityTimers.get(threadKey);
    if (timer) {
      clearTimeout(timer);
      ctx.inactivityTimers.delete(threadKey);
    }
  }
}

export async function handleSessionApiRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  // POST /api/sessions — create standalone session
  if (req.method === 'POST' && pathname === '/api/sessions') {
    const body = await readBody(req);
    let parsed: { tool?: string; mode?: string };
    try {
      parsed = JSON.parse(body) as { tool?: string; mode?: string };
    } catch {
      logger.debug('api_invalid_json', { endpoint: '/api/sessions' });
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    const tool = parsed.tool;
    if (tool !== 'claude' && tool !== 'codex' && tool !== 'gemini') {
      json(res, 400, { error: 'Invalid tool. Must be claude, codex, or gemini.' });
      return true;
    }
    const mode = parsed.mode;
    if (mode !== undefined && mode !== 'readonly' && mode !== 'write') {
      json(res, 400, { error: 'Invalid mode. Must be readonly or write.' });
      return true;
    }
    const session = ctx.sessionManager.createStandaloneSession(
      tool,
      undefined,
      mode as 'readonly' | 'write' | undefined,
    );
    mkdirSync(session.workdir, { recursive: true });
    json(res, 201, session);
    return true;
  }

  // DELETE /api/sessions — clear all
  if (req.method === 'DELETE' && pathname === '/api/sessions') {
    const deleted = ctx.sessionManager.clearAllSessionsWithCleanup();
    for (const { sessionKey, threadKey, workdir } of deleted) {
      cleanupSessionState(ctx, sessionKey, threadKey);
      cleanupWorkdir(ctx, workdir);
    }
    const orphanRemoved = ctx.workdirManager.cleanupUnusedSessionWorkdirs([]);
    json(res, 200, { success: true, deleted: deleted.length, orphanRemoved });
    return true;
  }

  // DELETE /api/sessions/:id
  const deleteId = matchSessionId(pathname);
  if (req.method === 'DELETE' && deleteId) {
    const result = ctx.sessionManager.deleteSessionByIdWithCleanup(deleteId);
    if (!result) {
      json(res, 200, { success: false, error: 'Session not found' });
      return true;
    }
    cleanupSessionState(ctx, result.sessionKey, result.threadKey);
    cleanupWorkdir(ctx, result.workdir);
    json(res, 200, { success: true });
    return true;
  }

  return false;
}
