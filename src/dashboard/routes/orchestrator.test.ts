/**
 * Coverage tests for handleOrchestratorRoutes.
 */
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { RouteContext } from '../route-context.js';
import { handleOrchestratorRoutes } from './orchestrator.js';

const UUID1 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const UUID2 = '11111111-2222-3333-4444-555555555555';
const UUID_MISSING = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

function makeReq(method: string, body = ''): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = method;
  setTimeout(() => {
    req.emit('data', Buffer.from(body));
    req.emit('end');
  }, 0);
  return req;
}

function makeRes(): ServerResponse {
  const res = new EventEmitter() as ServerResponse;
  res.writeHead = vi.fn(() => res);
  res.end = vi.fn() as unknown as ServerResponse['end'];
  res.setHeader = vi.fn();
  res.write = vi.fn(() => true) as unknown as ServerResponse['write'];
  Object.defineProperty(res, 'headersSent', { value: false, writable: true });
  Object.defineProperty(res, 'writableEnded', { value: false, writable: true });
  return res;
}

function makeCtx(): RouteContext {
  return {
    version: '1.0.0',
    dataDir: '/tmp/data',
    workdirRoot: '/tmp/work',
    dashboardSecret: 'secret',
    serverApiBase: 'http://127.0.0.1:9999',
    logPath: '/tmp/server.log',
    dashboardLogPath: '/tmp/dashboard.log',
    getDb: vi.fn(() => ({
      getOrchestrators: vi.fn(() => []),
      getOrchestratorById: vi.fn((id: string) =>
        id === UUID1 ? { id: UUID1, name: 'test', nodes: [], edges: [] } : null,
      ),
      getOrchestratorRunsOverview: vi.fn((id: string) =>
        id === UUID1 ? { orchestrator: { id: UUID1 }, runs: [] } : null,
      ),
      getOrchestratorRuns: vi.fn(() => []),
      getOrchestratorRunById: vi.fn((id: string) =>
        id === UUID2 ? { id: UUID2, nodeRuns: [] } : null,
      ),
    })) as unknown as RouteContext['getDb'],
    proxyToServerApi: vi.fn(async () => ({ status: 200, data: { ok: true } })),
    proxySSE: vi.fn(async () => {}),
    proxySSEGet: vi.fn(async () => {}),
  };
}

function getData(res: ServerResponse): unknown {
  const call = (res.end as ReturnType<typeof vi.fn>).mock.calls[0];
  return call?.[0] ? JSON.parse(call[0] as string) : null;
}

describe('handleOrchestratorRoutes', () => {
  it('GET /api/orchestrators — list', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('GET'),
        res,
        '/api/orchestrators',
        new URLSearchParams(),
      ),
    ).toBe(true);
  });

  it('GET /api/orchestrators/:id — found', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('GET'),
        res,
        `/api/orchestrators/${UUID1}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toMatchObject({ ok: true });
  });

  it('GET /api/orchestrators/:id — not found', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('GET'),
        res,
        `/api/orchestrators/${UUID_MISSING}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Orchestrator not found' });
  });

  it('POST /api/orchestrators — create (proxy)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('POST', '{}'),
        res,
        '/api/orchestrators',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(ctx.proxyToServerApi).toHaveBeenCalledWith('POST', '/api/orchestrators', '{}');
  });

  it('PATCH /api/orchestrators/:id — update (proxy)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('PATCH', '{}'),
        res,
        `/api/orchestrators/${UUID1}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(ctx.proxyToServerApi).toHaveBeenCalledWith('PATCH', `/api/orchestrators/${UUID1}`, '{}');
  });

  it('DELETE /api/orchestrators/:id — delete (proxy)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('DELETE'),
        res,
        `/api/orchestrators/${UUID1}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
  });

  it('POST nodes (proxy)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('POST', '{}'),
        res,
        `/api/orchestrators/${UUID1}/nodes`,
        new URLSearchParams(),
      ),
    ).toBe(true);
  });

  it('PATCH node (proxy)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('PATCH', '{}'),
        res,
        `/api/orchestrators/${UUID1}/nodes/${UUID2}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
  });

  it('DELETE node (proxy)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('DELETE'),
        res,
        `/api/orchestrators/${UUID1}/nodes/${UUID2}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
  });

  it('POST edges (proxy)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('POST', '{}'),
        res,
        `/api/orchestrators/${UUID1}/edges`,
        new URLSearchParams(),
      ),
    ).toBe(true);
  });

  it('PATCH edge (proxy)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('PATCH', '{}'),
        res,
        `/api/orchestrators/${UUID1}/edges/${UUID2}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
  });

  it('DELETE edge (proxy)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('DELETE'),
        res,
        `/api/orchestrators/${UUID1}/edges/${UUID2}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
  });

  it('POST validate (proxy)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('POST', ''),
        res,
        `/api/orchestrators/${UUID1}/validate`,
        new URLSearchParams(),
      ),
    ).toBe(true);
  });

  it('POST revert (proxy)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('POST'),
        res,
        `/api/orchestrators/${UUID1}/revert`,
        new URLSearchParams(),
      ),
    ).toBe(true);
  });

  it('POST execute (proxy)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('POST'),
        res,
        `/api/orchestrators/${UUID1}/execute`,
        new URLSearchParams(),
      ),
    ).toBe(true);
  });

  it('GET runs-overview — found', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('GET'),
        res,
        `/api/orchestrators/${UUID1}/runs-overview`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toMatchObject({ ok: true });
  });

  it('GET runs-overview — not found', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('GET'),
        res,
        `/api/orchestrators/${UUID_MISSING}/runs-overview`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Orchestrator not found' });
  });

  it('GET runs — list', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('GET'),
        res,
        `/api/orchestrators/${UUID1}/runs`,
        new URLSearchParams(),
      ),
    ).toBe(true);
  });

  it('GET run by id — found', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('GET'),
        res,
        `/api/orchestrators/${UUID1}/runs/${UUID2}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toMatchObject({ ok: true });
  });

  it('GET run by id — not found', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('GET'),
        res,
        `/api/orchestrators/${UUID1}/runs/${UUID_MISSING}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Run not found' });
  });

  it('POST rerun (proxy)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('POST', '{}'),
        res,
        `/api/orchestrators/${UUID1}/rerun/${UUID2}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
  });

  it('POST cancel (proxy)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('POST'),
        res,
        `/api/orchestrators/${UUID1}/cancel/${UUID2}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
  });

  it('GET run stream (proxy SSE)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('GET'),
        res,
        `/api/orchestrators/${UUID1}/runs/${UUID2}/stream`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(ctx.proxySSEGet).toHaveBeenCalled();
  });

  it('returns false for unmatched route', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOrchestratorRoutes(
        ctx,
        makeReq('GET'),
        res,
        '/api/something-else',
        new URLSearchParams(),
      ),
    ).toBe(false);
  });
});
