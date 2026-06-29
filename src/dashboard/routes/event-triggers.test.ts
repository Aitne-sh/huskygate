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

describe('handleEventTriggerRoutes', () => {
  const endpointId = '11111111-1111-4111-8111-111111111111';
  const subscriptionId = '22222222-2222-4222-8222-222222222222';
  const taskId = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    jsonMock.mockReset();
    readBodyMock.mockReset();
  });

  it('proxies webhook endpoint CRUD routes', async () => {
    readBodyMock
      .mockResolvedValueOnce('{"publisherPreset":"github"}')
      .mockResolvedValueOnce('{"enabled":false}');
    const proxyToServerApi = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, data: { ok: true, data: [] } })
      .mockResolvedValueOnce({ status: 201, data: { created: true } })
      .mockResolvedValueOnce({ status: 200, data: { detail: true } })
      .mockResolvedValueOnce({ status: 200, data: { updated: true } })
      .mockResolvedValueOnce({ status: 200, data: { deleted: true } });
    const ctx = makeCtx({ proxyToServerApi });

    expect(
      await handleEventTriggerRoutes(
        ctx,
        makeReq('GET'),
        makeRes(),
        '/api/webhook-endpoints',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(
      await handleEventTriggerRoutes(
        ctx,
        makeReq('POST'),
        makeRes(),
        '/api/webhook-endpoints',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(
      await handleEventTriggerRoutes(
        ctx,
        makeReq('GET'),
        makeRes(),
        `/api/webhook-endpoints/${endpointId}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(
      await handleEventTriggerRoutes(
        ctx,
        makeReq('PATCH'),
        makeRes(),
        `/api/webhook-endpoints/${endpointId}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(
      await handleEventTriggerRoutes(
        ctx,
        makeReq('DELETE'),
        makeRes(),
        `/api/webhook-endpoints/${endpointId}`,
        new URLSearchParams(),
      ),
    ).toBe(true);

    expect(proxyToServerApi).toHaveBeenNthCalledWith(1, 'GET', '/api/webhook-endpoints');
    expect(proxyToServerApi).toHaveBeenNthCalledWith(
      2,
      'POST',
      '/api/webhook-endpoints',
      '{"publisherPreset":"github"}',
    );
    expect(proxyToServerApi).toHaveBeenNthCalledWith(
      3,
      'GET',
      `/api/webhook-endpoints/${endpointId}`,
    );
    expect(proxyToServerApi).toHaveBeenNthCalledWith(
      4,
      'PATCH',
      `/api/webhook-endpoints/${endpointId}`,
      '{"enabled":false}',
    );
    expect(proxyToServerApi).toHaveBeenNthCalledWith(
      5,
      'DELETE',
      `/api/webhook-endpoints/${endpointId}`,
    );
  });

  it('proxies event subscription and dry-run routes', async () => {
    readBodyMock
      .mockResolvedValueOnce('{"targetType":"orchestrator"}')
      .mockResolvedValueOnce('{"enabled":false}')
      .mockResolvedValueOnce('{"body":{"action":"opened"}}');
    const proxyToServerApi = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, data: { ok: true, data: [] } })
      .mockResolvedValueOnce({ status: 201, data: { created: true } })
      .mockResolvedValueOnce({ status: 200, data: { updated: true } })
      .mockResolvedValueOnce({ status: 200, data: { tested: true } })
      .mockResolvedValueOnce({ status: 200, data: { deleted: true } });
    const ctx = makeCtx({ proxyToServerApi });

    expect(
      await handleEventTriggerRoutes(
        ctx,
        makeReq('GET'),
        makeRes(),
        '/api/event-subscriptions',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(
      await handleEventTriggerRoutes(
        ctx,
        makeReq('POST'),
        makeRes(),
        '/api/event-subscriptions',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(
      await handleEventTriggerRoutes(
        ctx,
        makeReq('PATCH'),
        makeRes(),
        `/api/event-subscriptions/${subscriptionId}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(
      await handleEventTriggerRoutes(
        ctx,
        makeReq('POST'),
        makeRes(),
        `/api/event-subscriptions/${subscriptionId}/test`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(
      await handleEventTriggerRoutes(
        ctx,
        makeReq('DELETE'),
        makeRes(),
        `/api/event-subscriptions/${subscriptionId}`,
        new URLSearchParams(),
      ),
    ).toBe(true);

    expect(proxyToServerApi).toHaveBeenNthCalledWith(1, 'GET', '/api/event-subscriptions');
    expect(proxyToServerApi).toHaveBeenNthCalledWith(
      2,
      'POST',
      '/api/event-subscriptions',
      '{"targetType":"orchestrator"}',
    );
    expect(proxyToServerApi).toHaveBeenNthCalledWith(
      3,
      'PATCH',
      `/api/event-subscriptions/${subscriptionId}`,
      '{"enabled":false}',
    );
    expect(proxyToServerApi).toHaveBeenNthCalledWith(
      4,
      'POST',
      `/api/event-subscriptions/${subscriptionId}/test`,
      '{"body":{"action":"opened"}}',
    );
    expect(proxyToServerApi).toHaveBeenNthCalledWith(
      5,
      'DELETE',
      `/api/event-subscriptions/${subscriptionId}`,
    );
  });

  it('proxies triggered task detail, mutations, and runs with query params', async () => {
    readBodyMock
      .mockResolvedValueOnce('{"name":"task"}')
      .mockResolvedValueOnce('{"enabled":false}');
    const proxyToServerApi = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, data: { ok: true, data: [] } })
      .mockResolvedValueOnce({ status: 201, data: { created: true } })
      .mockResolvedValueOnce({ status: 200, data: { detail: true } })
      .mockResolvedValueOnce({ status: 200, data: { updated: true } })
      .mockResolvedValueOnce({ status: 200, data: { runs: true } })
      .mockResolvedValueOnce({ status: 200, data: { deleted: true } });
    const ctx = makeCtx({ proxyToServerApi });

    expect(
      await handleEventTriggerRoutes(
        ctx,
        makeReq('GET'),
        makeRes(),
        '/api/triggered-tasks',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(
      await handleEventTriggerRoutes(
        ctx,
        makeReq('POST'),
        makeRes(),
        '/api/triggered-tasks',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(
      await handleEventTriggerRoutes(
        ctx,
        makeReq('GET'),
        makeRes(),
        `/api/triggered-tasks/${taskId}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(
      await handleEventTriggerRoutes(
        ctx,
        makeReq('PATCH'),
        makeRes(),
        `/api/triggered-tasks/${taskId}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(
      await handleEventTriggerRoutes(
        ctx,
        makeReq('GET'),
        makeRes(),
        `/api/triggered-tasks/${taskId}/runs`,
        new URLSearchParams('limit=5'),
      ),
    ).toBe(true);
    expect(
      await handleEventTriggerRoutes(
        ctx,
        makeReq('DELETE'),
        makeRes(),
        `/api/triggered-tasks/${taskId}`,
        new URLSearchParams(),
      ),
    ).toBe(true);

    expect(proxyToServerApi).toHaveBeenNthCalledWith(1, 'GET', '/api/triggered-tasks');
    expect(proxyToServerApi).toHaveBeenNthCalledWith(
      2,
      'POST',
      '/api/triggered-tasks',
      '{"name":"task"}',
    );
    expect(proxyToServerApi).toHaveBeenNthCalledWith(3, 'GET', `/api/triggered-tasks/${taskId}`);
    expect(proxyToServerApi).toHaveBeenNthCalledWith(
      4,
      'PATCH',
      `/api/triggered-tasks/${taskId}`,
      '{"enabled":false}',
    );
    expect(proxyToServerApi).toHaveBeenNthCalledWith(
      5,
      'GET',
      `/api/triggered-tasks/${taskId}/runs?limit=5`,
    );
    expect(proxyToServerApi).toHaveBeenNthCalledWith(6, 'DELETE', `/api/triggered-tasks/${taskId}`);
  });

  it('proxies tunnel API routes (status, start, stop)', async () => {
    readBodyMock.mockResolvedValueOnce('{}').mockResolvedValueOnce('{}');
    const proxyToServerApi = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, data: { active: false } })
      .mockResolvedValueOnce({
        status: 200,
        data: { active: true, url: 'https://test.trycloudflare.com' },
      })
      .mockResolvedValueOnce({ status: 200, data: { active: false } });
    const ctx = makeCtx({ proxyToServerApi });

    expect(
      await handleEventTriggerRoutes(
        ctx,
        makeReq('GET'),
        makeRes(),
        '/api/tunnel/status',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(
      await handleEventTriggerRoutes(
        ctx,
        makeReq('POST'),
        makeRes(),
        '/api/tunnel/start',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(
      await handleEventTriggerRoutes(
        ctx,
        makeReq('POST'),
        makeRes(),
        '/api/tunnel/stop',
        new URLSearchParams(),
      ),
    ).toBe(true);

    expect(proxyToServerApi).toHaveBeenNthCalledWith(1, 'GET', '/api/tunnel/status');
    expect(proxyToServerApi).toHaveBeenNthCalledWith(2, 'POST', '/api/tunnel/start', '{}');
    expect(proxyToServerApi).toHaveBeenNthCalledWith(3, 'POST', '/api/tunnel/stop', '{}');
  });

  it('returns false for unrelated routes', async () => {
    const ctx = makeCtx();

    const handled = await handleEventTriggerRoutes(
      ctx,
      makeReq('GET'),
      makeRes(),
      '/api/not-related',
      new URLSearchParams(),
    );

    expect(handled).toBe(false);
  });
});
