/**
 * Coverage tests for dashboard/routes/status.ts
 * Targets: getChartData catch branch (line 68)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteContext } from '../route-context.js';

const { jsonMock } = vi.hoisted(() => ({
  jsonMock: vi.fn(),
}));

vi.mock('../http.js', () => ({
  json: jsonMock,
}));

vi.mock('../../server/daemon.js', () => ({
  getServerStatus: vi.fn(() => ({ running: true, pid: 1234, pidFile: '/tmp/pid' })),
  getPidFilePath: vi.fn(() => '/tmp/pid'),
}));

import { handleStatusRoutes } from './status.js';

function makeReq(method: string): IncomingMessage {
  return { method } as IncomingMessage;
}

function makeRes(): ServerResponse {
  return {} as ServerResponse;
}

beforeEach(() => {
  jsonMock.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});

describe('handleStatusRoutes — coverage', () => {
  it('handles getChartData throwing (catch branch at line 68)', async () => {
    const db = {
      getOverviewStats: vi.fn().mockReturnValue({
        totalJobs: 0,
        jobs24h: 0,
        errors24h: 0,
        toolStats: [],
        recentJobs: [],
      }),
      getChartData: vi.fn(() => {
        throw new Error('DB table missing');
      }),
      getErrorStats: vi.fn().mockReturnValue([]),
      getAppToolStats: vi.fn().mockReturnValue([]),
      getSparklineData: vi.fn().mockReturnValue({
        sessions: [],
        jobs: [],
        successRate: [],
        errors: [],
      }),
    };
    const ctx = {
      serverApiBase: 'http://127.0.0.1:3738',
      getDb: vi.fn(() => db),
    } as unknown as RouteContext;

    const handled = await handleStatusRoutes(
      ctx,
      makeReq('GET'),
      makeRes(),
      '/api/status',
      new URLSearchParams(),
    );

    expect(handled).toBe(true);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        chartData: expect.objectContaining({
          successRateRange: 100,
          totalRange: 0,
        }),
      }),
    );
  });
});
