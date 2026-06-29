/**
 * Coverage tests for handleSessionMcpRoutes.
 */
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { RouteContext } from '../route-context.js';
import { handleSessionMcpRoutes } from './session-mcp.js';

const SID = 'aabbccdd'; // 8-char hex
const SID_MISSING = 'ffffffff';
const SRV_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SRV_BAD = '11111111-1111-1111-1111-111111111111';
const SRV_OTHER = '22222222-2222-2222-2222-222222222222';

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
      getSessionMcpServers: vi.fn((id: string) =>
        id === SID ? { sessionId: SID, servers: [] } : null,
      ),
      resetSessionMcpServers: vi.fn((id: string) =>
        id === SID ? { sessionId: SID, filterActive: false, servers: [] } : null,
      ),
      setSessionMcpServerEnabled: vi.fn((sessionId: string, serverId: string) => {
        if (sessionId !== SID) return null;
        if (serverId === SRV_BAD) throw new Error('Server not found for session tool');
        if (serverId === SRV_OTHER) throw new Error('other error');
        return { sessionId: SID, servers: [] };
      }),
    })) as unknown as RouteContext['getDb'],
    proxyToServerApi: vi.fn(async () => ({ status: 200, data: { ok: true } })),
    proxySSE: vi.fn(async () => {}),
    proxySSEGet: vi.fn(async () => {}),
  };
}

describe('handleSessionMcpRoutes', () => {
  it('GET mcp-servers — found', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSessionMcpRoutes(ctx, makeReq('GET'), res, `/api/sessions/${SID}/mcp-servers`),
    ).toBe(true);
    expect(getData(res)).toMatchObject({ sessionId: SID });
  });

  it('GET mcp-servers — not found', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSessionMcpRoutes(
        ctx,
        makeReq('GET'),
        res,
        `/api/sessions/${SID_MISSING}/mcp-servers`,
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Session not found' });
  });

  it('DELETE mcp-servers — found', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSessionMcpRoutes(ctx, makeReq('DELETE'), res, `/api/sessions/${SID}/mcp-servers`),
    ).toBe(true);
    expect(getData(res)).toMatchObject({ ok: true });
  });

  it('DELETE mcp-servers — not found', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSessionMcpRoutes(
        ctx,
        makeReq('DELETE'),
        res,
        `/api/sessions/${SID_MISSING}/mcp-servers`,
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Session not found' });
  });

  it('PUT toggle — success', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSessionMcpRoutes(
        ctx,
        makeReq('PUT', '{"enabled":true}'),
        res,
        `/api/sessions/${SID}/mcp-servers/${SRV_UUID}`,
      ),
    ).toBe(true);
    expect(getData(res)).toMatchObject({ ok: true });
  });

  it('PUT toggle — bad body', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSessionMcpRoutes(
        ctx,
        makeReq('PUT', '{"enabled":"nope"}'),
        res,
        `/api/sessions/${SID}/mcp-servers/${SRV_UUID}`,
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'enabled must be a boolean' });
  });

  it('PUT toggle — session not found', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSessionMcpRoutes(
        ctx,
        makeReq('PUT', '{"enabled":true}'),
        res,
        `/api/sessions/${SID_MISSING}/mcp-servers/${SRV_UUID}`,
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Session not found' });
  });

  it('PUT toggle — server not found for tool (404)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSessionMcpRoutes(
        ctx,
        makeReq('PUT', '{"enabled":true}'),
        res,
        `/api/sessions/${SID}/mcp-servers/${SRV_BAD}`,
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Server not found for session tool' });
  });

  it('PUT toggle — other error (400)', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSessionMcpRoutes(
        ctx,
        makeReq('PUT', '{"enabled":true}'),
        res,
        `/api/sessions/${SID}/mcp-servers/${SRV_OTHER}`,
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'other error' });
  });

  it('returns false for unmatched route', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(await handleSessionMcpRoutes(ctx, makeReq('GET'), res, '/api/something-else')).toBe(
      false,
    );
  });
});
