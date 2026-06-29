/**
 * Coverage tests for handleOndemandTaskRoutes.
 */
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { RouteContext } from '../route-context.js';
import { handleOndemandTaskRoutes } from './ondemand-tasks.js';

const UUID1 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
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
  return res;
}

function getData(res: ServerResponse): unknown {
  const call = (res.end as ReturnType<typeof vi.fn>).mock.calls[0];
  return call?.[0] ? JSON.parse(call[0] as string) : null;
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
      getOndemandTasks: vi.fn(() => []),
      getOndemandTaskById: vi.fn((id: string) =>
        id === UUID1 ? { id: UUID1, name: 'task1' } : null,
      ),
      getOndemandTaskRuns: vi.fn(() => []),
    })) as unknown as RouteContext['getDb'],
    proxyToServerApi: vi.fn(async () => ({ status: 200, data: { ok: true } })),
    proxySSE: vi.fn(async () => {}),
    proxySSEGet: vi.fn(async () => {}),
  };
}

describe('handleOndemandTaskRoutes', () => {
  it('GET list tasks', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOndemandTaskRoutes(
        ctx,
        makeReq('GET'),
        res,
        '/api/ondemand-tasks',
        new URLSearchParams(),
      ),
    ).toBe(true);
  });

  it('GET task by id — found', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOndemandTaskRoutes(
        ctx,
        makeReq('GET'),
        res,
        `/api/ondemand-tasks/${UUID1}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    const data = getData(res) as Record<string, unknown>;
    expect(data.ok).toBe(true);
  });

  it('GET task by id — not found', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOndemandTaskRoutes(
        ctx,
        makeReq('GET'),
        res,
        `/api/ondemand-tasks/${UUID_MISSING}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Task not found' });
  });

  it('GET task runs', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOndemandTaskRoutes(
        ctx,
        makeReq('GET'),
        res,
        `/api/ondemand-tasks/${UUID1}/runs`,
        new URLSearchParams('limit=5'),
      ),
    ).toBe(true);
  });

  it('POST create (proxy)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOndemandTaskRoutes(
        ctx,
        makeReq('POST', '{}'),
        res,
        '/api/ondemand-tasks',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(ctx.proxyToServerApi).toHaveBeenCalledWith('POST', '/api/ondemand-tasks', '{}');
  });

  it('POST execute (proxy)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOndemandTaskRoutes(
        ctx,
        makeReq('POST'),
        res,
        `/api/ondemand-tasks/${UUID1}/execute`,
        new URLSearchParams(),
      ),
    ).toBe(true);
  });

  it('PATCH update (proxy)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOndemandTaskRoutes(
        ctx,
        makeReq('PATCH', '{}'),
        res,
        `/api/ondemand-tasks/${UUID1}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
  });

  it('DELETE (proxy)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOndemandTaskRoutes(
        ctx,
        makeReq('DELETE'),
        res,
        `/api/ondemand-tasks/${UUID1}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
  });

  it('returns false for unmatched', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleOndemandTaskRoutes(ctx, makeReq('GET'), res, '/api/other', new URLSearchParams()),
    ).toBe(false);
  });
});
