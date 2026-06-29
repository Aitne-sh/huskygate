/**
 * Coverage tests for dashboard/routes/event-triggers.ts
 * Targets: POST /api/triggered-tasks/:id/execute proxy (lines 144-150)
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

import { handleEventTriggerRoutes } from './event-triggers.js';

function makeReq(method: string): IncomingMessage {
  return { method } as IncomingMessage;
}

function makeRes(): ServerResponse {
  return {} as ServerResponse;
}

function makeCtx(overrides?: Record<string, unknown>): RouteContext {
  return {
    proxyToServerApi: vi.fn().mockResolvedValue({ status: 200, data: { ok: true } }),
    ...overrides,
  } as unknown as RouteContext;
}

describe('handleEventTriggerRoutes — coverage', () => {
  const taskId = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    jsonMock.mockReset();
    readBodyMock.mockReset();
  });

  it('POST /api/triggered-tasks/:id/execute proxies to server API', async () => {
    const proxyToServerApi = vi
      .fn()
      .mockResolvedValue({ status: 200, data: { ok: true, runId: 'run-1' } });
    const ctx = makeCtx({ proxyToServerApi });

    const handled = await handleEventTriggerRoutes(
      ctx,
      makeReq('POST'),
      makeRes(),
      `/api/triggered-tasks/${taskId}/execute`,
      new URLSearchParams(),
    );

    expect(handled).toBe(true);
    expect(proxyToServerApi).toHaveBeenCalledWith(
      'POST',
      `/api/triggered-tasks/${taskId}/execute`,
    );
    expect(jsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      { ok: true, runId: 'run-1' },
    );
  });

  it('POST /api/triggered-tasks/:id/execute returns error status from upstream', async () => {
    const proxyToServerApi = vi
      .fn()
      .mockResolvedValue({ status: 404, data: { error: 'Task not found' } });
    const ctx = makeCtx({ proxyToServerApi });

    const handled = await handleEventTriggerRoutes(
      ctx,
      makeReq('POST'),
      makeRes(),
      `/api/triggered-tasks/${taskId}/execute`,
      new URLSearchParams(),
    );

    expect(handled).toBe(true);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.anything(),
      404,
      { error: 'Task not found' },
    );
  });
});
