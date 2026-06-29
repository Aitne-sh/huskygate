/** @module dashboard/routes/metrics — Dashboard API route for comprehensive analytics metrics. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from '../http.js';
import type { RouteContext } from '../route-context.js';

const VALID_RANGES = new Map<string, number>([
  ['24h', 24 * 60 * 60 * 1000],
  ['7d', 7 * 24 * 60 * 60 * 1000],
  ['30d', 30 * 24 * 60 * 60 * 1000],
]);

const DEFAULT_RANGE = '7d';

export async function handleMetricsRoutes(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  query: URLSearchParams,
): Promise<boolean> {
  // GET /api/metrics?range=7d
  if (req.method === 'GET' && pathname === '/api/metrics') {
    const rangeParam = query.get('range') ?? DEFAULT_RANGE;
    const rangeMs = VALID_RANGES.get(rangeParam);

    if (rangeMs === undefined) {
      json(res, 400, { error: `Invalid range: ${rangeParam}. Must be one of: 24h, 7d, 30d` });
      return true;
    }

    const db = ctx.getDb();
    try {
      const data = db.getMetricsData(rangeMs);
      json(res, 200, { ok: true, data });
    } catch {
      json(res, 500, { error: 'Failed to retrieve metrics data' });
    }
    return true;
  }

  return false;
}
