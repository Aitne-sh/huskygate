/**
 * Coverage tests for dashboard/routes/schedule-tasks.ts
 * Targets: POST /api/schedule-tasks/:id/execute proxy (lines 70-73)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteContext } from '../route-context.js';

const { jsonMock, readBodyMock } = vi.hoisted(() => ({
  jsonMock: vi.fn(),
  readBodyMock: vi.fn(),
}));

vi.mock('../../shared/http.js', () => ({
  json: jsonMock,
  readBody: readBodyMock,
}));

import { handleScheduleTaskRoutes } from './schedule-tasks.js';

function makeReq(method: string): IncomingMessage {
  return { method } as IncomingMessage;
}

function makeRes(): ServerResponse {
  return {} as ServerResponse;
}

function makeCtx(overrides?: Record<string, unknown>): RouteContext {
  const db = {
    getScheduledTasks: vi.fn().mockReturnValue([]),
    getScheduledTaskById: vi.fn(),
    getScheduledTaskRuns: vi.fn().mockReturnValue([]),
  };

  return {
    getDb: vi.fn(() => db),
    proxyToServerApi: vi.fn().mockResolvedValue({ status: 200, data: { ok: true } }),
    ...overrides,
  } as unknown as RouteContext;
}

describe('handleScheduleTaskRoutes — coverage', () => {
  const taskId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    jsonMock.mockReset();
    readBodyMock.mockReset();
  });

  it('POST /api/schedule-tasks/:id/execute proxies to server API', async () => {
    const proxyToServerApi = vi
      .fn()
      .mockResolvedValue({ status: 200, data: { ok: true, runId: 'run-1' } });
    const ctx = makeCtx({ proxyToServerApi });

    const handled = await handleScheduleTaskRoutes(
      ctx,
      makeReq('POST'),
      makeRes(),
      `/api/schedule-tasks/${taskId}/execute`,
      new URLSearchParams(),
    );

    expect(handled).toBe(true);
    expect(proxyToServerApi).toHaveBeenCalledWith(
      'POST',
      `/api/schedules/${taskId}/execute`,
    );
    expect(jsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      { ok: true, runId: 'run-1' },
    );
  });

  it('POST /api/schedule-tasks/:id/execute returns error from upstream', async () => {
    const proxyToServerApi = vi
      .fn()
      .mockResolvedValue({ status: 500, data: { error: 'Internal error' } });
    const ctx = makeCtx({ proxyToServerApi });

    const handled = await handleScheduleTaskRoutes(
      ctx,
      makeReq('POST'),
      makeRes(),
      `/api/schedule-tasks/${taskId}/execute`,
      new URLSearchParams(),
    );

    expect(handled).toBe(true);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.anything(),
      500,
      { error: 'Internal error' },
    );
  });
});
