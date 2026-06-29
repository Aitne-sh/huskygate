/** @module dashboard/routes/status — Dashboard API routes for server daemon status, start, and stop. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getPidFilePath, getServerStatus, startDaemon, stopDaemon } from '../../server/daemon.js';
import { json } from '../http.js';
import type { RouteContext } from '../route-context.js';

export async function handleStatusRoutes(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  _query: URLSearchParams,
): Promise<boolean> {
  // GET /api/status
  if (req.method === 'GET' && pathname === '/api/status') {
    const status = getServerStatus(getPidFilePath());

    // Also check Server API reachability
    let serverApiOnline = false;
    try {
      const healthRes = await fetch(`${ctx.serverApiBase}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      serverApiOnline = healthRes.ok;
    } catch {
      // Server API not reachable
    }

    const db = ctx.getDb();

    let sessionCount = 0;
    let activeSessionCount = 0;
    const appSessionStats: Record<string, { total: number; active: number }> = {
      claude: { total: 0, active: 0 },
      codex: { total: 0, active: 0 },
      gemini: { total: 0, active: 0 },
    };
    try {
      const sessions = db.listSessions();
      sessionCount = sessions.length;
      activeSessionCount = sessions.filter((s) => s.active).length;
      for (const s of sessions) {
        const stat = appSessionStats[s.tool];
        if (stat) {
          stat.total++;
          if (s.active) stat.active++;
        }
      }
    } catch {
      // DB may not exist yet
    }

    let overviewStats = {};
    try {
      overviewStats = db.getOverviewStats();
    } catch {
      // DB may not exist yet
    }
    let chartData: { successRateRange: number; totalRange: number } = {
      successRateRange: 100,
      totalRange: 0,
    };
    try {
      const full = db.getChartData();
      chartData = { successRateRange: full.successRateRange, totalRange: full.totalRange };
    } catch {
      // DB may not exist yet
    }

    // errorCategories is still used by the Overview Errors card subtitle
    let errorCategories: unknown[] = [];
    try {
      errorCategories = db.getErrorStats();
    } catch {
      // DB may not exist yet
    }

    let appToolStats: unknown[] = [];
    try {
      appToolStats = db.getAppToolStats();
    } catch {
      // DB may not exist yet
    }

    let sparklines: {
      sessions: number[];
      jobs: number[];
      successRate: number[];
      errors: number[];
    } = { sessions: [], jobs: [], successRate: [], errors: [] };
    try {
      sparklines = db.getSparklineData();
    } catch {
      // DB may not exist yet
    }

    json(res, 200, {
      ...status,
      serverApiOnline,
      sessionCount,
      activeSessionCount,
      appSessionStats,
      ...overviewStats,
      chartData,
      errorCategories,
      appToolStats,
      sparklines,
    });
    return true;
  }

  // POST /api/daemon/start
  if (req.method === 'POST' && pathname === '/api/daemon/start') {
    const result = await startDaemon();
    if ('error' in result) {
      json(res, 200, { success: false, error: result.error });
    } else {
      json(res, 200, { success: true, pid: result.pid });
    }
    return true;
  }

  // POST /api/daemon/stop
  if (req.method === 'POST' && pathname === '/api/daemon/stop') {
    const result = stopDaemon();
    if ('error' in result) {
      json(res, 200, { success: false, error: result.error });
    } else {
      json(res, 200, { success: true, pid: result.pid });
    }
    return true;
  }

  return false;
}
