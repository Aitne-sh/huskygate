/**
 * Coverage tests for handleSessionRoutes — fills remaining uncovered lines.
 */
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { RouteContext } from '../route-context.js';
import { handleSessionRoutes } from './sessions.js';

const SID = 'aabbccdd';
const JOB_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeReq(method: string): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = method;
  setTimeout(() => req.emit('end'), 0);
  return req;
}

function makeRes(): ServerResponse {
  const res = new EventEmitter() as ServerResponse;
  res.writeHead = vi.fn(() => res);
  res.end = vi.fn() as unknown as ServerResponse['end'];
  res.setHeader = vi.fn();
  res.write = vi.fn(() => true) as unknown as ServerResponse['write'];
  res.destroyed = false;
  return res;
}

function getData(res: ServerResponse): unknown {
  const call = (res.end as ReturnType<typeof vi.fn>).mock.calls[0];
  return call?.[0] ? JSON.parse(call[0] as string) : null;
}

function makeCtx(overrides: Partial<RouteContext> = {}): RouteContext {
  return {
    version: '1.0.0',
    dataDir: '/tmp/data',
    workdirRoot: '/tmp/work',
    dashboardSecret: 'secret',
    serverApiBase: 'http://127.0.0.1:9999',
    logPath: '/tmp/server.log',
    dashboardLogPath: '/tmp/dashboard.log',
    getDb: vi.fn(() => ({
      listSessions: vi.fn(() => []),
      getJobMessages: vi.fn(() => []),
      getSessionTrace: vi.fn((id: string) =>
        id === SID ? { sessionId: SID, tool: 'claude', jobs: [] } : null,
      ),
      getSessionAudit: vi.fn(() => []),
    })) as unknown as RouteContext['getDb'],
    proxyToServerApi: vi.fn(async () => ({ status: 200, data: { ok: true } })),
    proxySSE: vi.fn(async () => {}),
    proxySSEGet: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('handleSessionRoutes — additional coverage', () => {
  it('GET /api/sessions/:id/audit/:jobId/messages', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSessionRoutes(
        ctx,
        makeReq('GET'),
        res,
        `/api/sessions/${SID}/audit/${JOB_UUID}/messages`,
        new URLSearchParams(),
      ),
    ).toBe(true);
  });

  it('GET /api/sessions/:id/trace — found', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSessionRoutes(
        ctx,
        makeReq('GET'),
        res,
        `/api/sessions/${SID}/trace`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    const data = getData(res) as Record<string, unknown>;
    expect(data.sessionId).toBe(SID);
  });

  it('GET /api/sessions/:id/trace — not found', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSessionRoutes(
        ctx,
        makeReq('GET'),
        res,
        '/api/sessions/ffffffff/trace',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Session not found' });
  });

  it('DELETE /api/sessions/:id — proxied', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSessionRoutes(
        ctx,
        makeReq('DELETE'),
        res,
        `/api/sessions/${SID}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(ctx.proxyToServerApi).toHaveBeenCalledWith('DELETE', `/api/sessions/${SID}`);
  });

  it('DELETE /api/sessions — clear all proxied', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSessionRoutes(
        ctx,
        makeReq('DELETE'),
        res,
        '/api/sessions',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(ctx.proxyToServerApi).toHaveBeenCalledWith('DELETE', '/api/sessions');
  });

  it('GET /api/logs — with source=server', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSessionRoutes(
        ctx,
        makeReq('GET'),
        res,
        '/api/logs',
        new URLSearchParams('source=server'),
      ),
    ).toBe(true);
  });

  it('GET /api/logs — with source=dashboard', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSessionRoutes(
        ctx,
        makeReq('GET'),
        res,
        '/api/logs',
        new URLSearchParams('source=dashboard'),
      ),
    ).toBe(true);
  });

  it('GET /api/logs — with source=all (merged)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSessionRoutes(
        ctx,
        makeReq('GET'),
        res,
        '/api/logs',
        new URLSearchParams('source=all'),
      ),
    ).toBe(true);
  });

  it('GET /api/logs/stream — SSE tail (server source)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSessionRoutes(
        ctx,
        makeReq('GET'),
        res,
        '/api/logs/stream',
        new URLSearchParams('source=server'),
      ),
    ).toBe(true);
    // Cleanup: trigger close to stop the tail
    res.emit('close');
  });

  it('GET /api/logs/stream — SSE tail (dashboard source)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSessionRoutes(
        ctx,
        makeReq('GET'),
        res,
        '/api/logs/stream',
        new URLSearchParams('source=dashboard'),
      ),
    ).toBe(true);
    res.emit('close');
  });

  it('GET /api/sessions — error falls back to empty', async () => {
    const ctx = makeCtx({
      getDb: vi.fn(() => ({
        listSessions: vi.fn(() => {
          throw new Error('db error');
        }),
      })) as unknown as RouteContext['getDb'],
    });
    const res = makeRes();
    expect(
      await handleSessionRoutes(ctx, makeReq('GET'), res, '/api/sessions', new URLSearchParams()),
    ).toBe(true);
    expect(getData(res)).toEqual([]);
  });
});
