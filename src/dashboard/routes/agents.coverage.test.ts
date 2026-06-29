/**
 * Coverage tests for dashboard/routes/agents.ts
 * Targets all branches: GET proxy, POST/PATCH/DELETE proxy, unmatched pathname, unsupported method.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { jsonMock, readBodyMock } = vi.hoisted(() => ({
  jsonMock: vi.fn(),
  readBodyMock: vi.fn(),
}));

vi.mock('../http.js', () => ({
  json: jsonMock,
  readBody: readBodyMock,
}));

import type { RouteContext } from '../route-context.js';
import { handleAgentRoutes } from './agents.js';

function makeReq(method: string): IncomingMessage {
  return { method } as IncomingMessage;
}

function makeRes(): ServerResponse {
  return {} as ServerResponse;
}

function makeCtx(overrides?: Partial<RouteContext>): RouteContext {
  return {
    proxyToServerApi: vi.fn().mockResolvedValue({ status: 200, data: { agents: [] } }),
    ...overrides,
  } as unknown as RouteContext;
}

beforeEach(() => {
  jsonMock.mockReset();
  readBodyMock.mockReset();
});

describe('handleAgentRoutes', () => {
  it('returns false for non-matching pathname', async () => {
    const result = await handleAgentRoutes(
      makeCtx(),
      makeReq('GET'),
      makeRes(),
      '/api/sessions',
      new URLSearchParams(),
    );
    expect(result).toBe(false);
    expect(jsonMock).not.toHaveBeenCalled();
  });

  describe('GET /api/agents', () => {
    it('proxies GET request to server API and returns json', async () => {
      const proxyToServerApi = vi.fn().mockResolvedValue({ status: 200, data: [{ id: 'a1' }] });
      const ctx = makeCtx({ proxyToServerApi });
      const res = makeRes();

      const result = await handleAgentRoutes(
        ctx,
        makeReq('GET'),
        res,
        '/api/agents',
        new URLSearchParams(),
      );

      expect(result).toBe(true);
      expect(proxyToServerApi).toHaveBeenCalledWith('GET', '/api/agents');
      expect(jsonMock).toHaveBeenCalledWith(res, 200, [{ id: 'a1' }]);
    });

    it('passes through server error status', async () => {
      const proxyToServerApi = vi
        .fn()
        .mockResolvedValue({ status: 500, data: { error: 'Internal' } });
      const ctx = makeCtx({ proxyToServerApi });
      const res = makeRes();

      const result = await handleAgentRoutes(
        ctx,
        makeReq('GET'),
        res,
        '/api/agents/some-id',
        new URLSearchParams(),
      );

      expect(result).toBe(true);
      expect(proxyToServerApi).toHaveBeenCalledWith('GET', '/api/agents/some-id');
      expect(jsonMock).toHaveBeenCalledWith(res, 500, { error: 'Internal' });
    });
  });

  describe('POST /api/agents', () => {
    it('reads body and proxies POST to server API', async () => {
      const body = JSON.stringify({ name: 'new-agent' });
      readBodyMock.mockResolvedValue(body);
      const proxyToServerApi = vi
        .fn()
        .mockResolvedValue({ status: 201, data: { id: 'a1', name: 'new-agent' } });
      const ctx = makeCtx({ proxyToServerApi });
      const res = makeRes();

      const result = await handleAgentRoutes(
        ctx,
        makeReq('POST'),
        res,
        '/api/agents',
        new URLSearchParams(),
      );

      expect(result).toBe(true);
      expect(readBodyMock).toHaveBeenCalled();
      expect(proxyToServerApi).toHaveBeenCalledWith('POST', '/api/agents', body);
      expect(jsonMock).toHaveBeenCalledWith(res, 201, { id: 'a1', name: 'new-agent' });
    });
  });

  describe('PATCH /api/agents/:id', () => {
    it('reads body and proxies PATCH to server API', async () => {
      const body = JSON.stringify({ name: 'updated' });
      readBodyMock.mockResolvedValue(body);
      const proxyToServerApi = vi
        .fn()
        .mockResolvedValue({ status: 200, data: { id: 'a1', name: 'updated' } });
      const ctx = makeCtx({ proxyToServerApi });
      const res = makeRes();

      const result = await handleAgentRoutes(
        ctx,
        makeReq('PATCH'),
        res,
        '/api/agents/a1',
        new URLSearchParams(),
      );

      expect(result).toBe(true);
      expect(readBodyMock).toHaveBeenCalled();
      expect(proxyToServerApi).toHaveBeenCalledWith('PATCH', '/api/agents/a1', body);
      expect(jsonMock).toHaveBeenCalledWith(res, 200, { id: 'a1', name: 'updated' });
    });
  });

  describe('DELETE /api/agents/:id', () => {
    it('proxies DELETE without reading body', async () => {
      const proxyToServerApi = vi
        .fn()
        .mockResolvedValue({ status: 200, data: { success: true } });
      const ctx = makeCtx({ proxyToServerApi });
      const res = makeRes();

      const result = await handleAgentRoutes(
        ctx,
        makeReq('DELETE'),
        res,
        '/api/agents/a1',
        new URLSearchParams(),
      );

      expect(result).toBe(true);
      expect(readBodyMock).not.toHaveBeenCalled();
      expect(proxyToServerApi).toHaveBeenCalledWith('DELETE', '/api/agents/a1', undefined);
      expect(jsonMock).toHaveBeenCalledWith(res, 200, { success: true });
    });
  });

  describe('unsupported method', () => {
    it('returns false for PUT method on /api/agents', async () => {
      const result = await handleAgentRoutes(
        makeCtx(),
        makeReq('PUT'),
        makeRes(),
        '/api/agents',
        new URLSearchParams(),
      );
      expect(result).toBe(false);
      expect(jsonMock).not.toHaveBeenCalled();
    });

    it('returns false for OPTIONS method on /api/agents', async () => {
      const result = await handleAgentRoutes(
        makeCtx(),
        makeReq('OPTIONS'),
        makeRes(),
        '/api/agents',
        new URLSearchParams(),
      );
      expect(result).toBe(false);
    });
  });
});
