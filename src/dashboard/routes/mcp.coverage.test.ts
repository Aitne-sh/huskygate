/**
 * Coverage tests for handleMcpRoutes — fills remaining uncovered lines.
 */
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { RouteContext } from '../route-context.js';
import { handleMcpRoutes } from './mcp.js';

const SRV_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SRV_MISSING = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

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
      listMcpServers: vi.fn(() => []),
      getMcpServerById: vi.fn((id: string) =>
        id === SRV_UUID
          ? {
              id: SRV_UUID,
              name: 'test',
              tool: 'claude',
              transport: 'stdio',
              definition: { command: 'echo' },
            }
          : null,
      ),
      createMcpServer: vi.fn((input: Record<string, unknown>) => ({
        id: 'new-id',
        name: input.name,
        tool: input.tool,
        transport: input.transport,
        definition: input.definition,
      })),
      updateMcpServer: vi.fn((id: string, input: Record<string, unknown>) =>
        id === SRV_UUID
          ? {
              id: SRV_UUID,
              name: 'test',
              tool: 'claude',
              transport: input.transport,
              definition: input.definition,
            }
          : null,
      ),
      deleteMcpServer: vi.fn((id: string) => id === SRV_UUID),
    })) as unknown as RouteContext['getDb'],
    proxyToServerApi: vi.fn(async () => ({ status: 200, data: { ok: true } })),
    proxySSE: vi.fn(async () => {}),
    proxySSEGet: vi.fn(async () => {}),
  };
}

describe('handleMcpRoutes — coverage', () => {
  it('GET /api/mcp/servers — no filter', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleMcpRoutes(ctx, makeReq('GET'), res, '/api/mcp/servers', new URLSearchParams()),
    ).toBe(true);
  });

  it('GET /api/mcp/servers?tool=claude', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleMcpRoutes(
        ctx,
        makeReq('GET'),
        res,
        '/api/mcp/servers',
        new URLSearchParams('tool=claude'),
      ),
    ).toBe(true);
  });

  it('GET /api/mcp/servers?tool=invalid', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleMcpRoutes(
        ctx,
        makeReq('GET'),
        res,
        '/api/mcp/servers',
        new URLSearchParams('tool=invalid'),
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Invalid tool' });
  });

  it('POST /api/mcp/servers — create', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    const body = JSON.stringify({
      name: 'new-server',
      tool: 'claude',
      definition: { command: 'echo' },
    });
    expect(
      await handleMcpRoutes(
        ctx,
        makeReq('POST', body),
        res,
        '/api/mcp/servers',
        new URLSearchParams(),
      ),
    ).toBe(true);
    const data = getData(res) as Record<string, unknown>;
    expect(data.success).toBe(true);
  });

  it('POST /api/mcp/servers — invalid JSON', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleMcpRoutes(
        ctx,
        makeReq('POST', 'not-json'),
        res,
        '/api/mcp/servers',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Invalid JSON' });
  });

  it('POST /api/mcp/servers — invalid tool', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    const body = JSON.stringify({ name: 'x', tool: 'bad', definition: {} });
    expect(
      await handleMcpRoutes(
        ctx,
        makeReq('POST', body),
        res,
        '/api/mcp/servers',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Invalid tool' });
  });

  it('POST /api/mcp/servers — invalid name', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    const body = JSON.stringify({ name: '', tool: 'claude', definition: {} });
    expect(
      await handleMcpRoutes(
        ctx,
        makeReq('POST', body),
        res,
        '/api/mcp/servers',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Invalid server name' });
  });

  it('POST /api/mcp/servers — missing definition', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    const body = JSON.stringify({ name: 'good', tool: 'claude' });
    expect(
      await handleMcpRoutes(
        ctx,
        makeReq('POST', body),
        res,
        '/api/mcp/servers',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'definition required' });
  });

  it('PUT /api/mcp/servers/:id — update', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    const body = JSON.stringify({ definition: { command: 'cat' } });
    expect(
      await handleMcpRoutes(
        ctx,
        makeReq('PUT', body),
        res,
        `/api/mcp/servers/${SRV_UUID}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    const data = getData(res) as Record<string, unknown>;
    expect(data.success).toBe(true);
  });

  it('PUT /api/mcp/servers/:id — not found', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    const body = JSON.stringify({ definition: { command: 'cat' } });
    expect(
      await handleMcpRoutes(
        ctx,
        makeReq('PUT', body),
        res,
        `/api/mcp/servers/${SRV_MISSING}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Server not found' });
  });

  it('PUT /api/mcp/servers/:id — invalid JSON in update', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleMcpRoutes(
        ctx,
        makeReq('PUT', 'not-json'),
        res,
        `/api/mcp/servers/${SRV_UUID}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Invalid JSON' });
  });

  it('PUT /api/mcp/servers/:id — missing definition in update', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    const body = JSON.stringify({});
    expect(
      await handleMcpRoutes(
        ctx,
        makeReq('PUT', body),
        res,
        `/api/mcp/servers/${SRV_UUID}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'definition required' });
  });

  it('DELETE /api/mcp/servers/:id — success', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleMcpRoutes(
        ctx,
        makeReq('DELETE'),
        res,
        `/api/mcp/servers/${SRV_UUID}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    const data = getData(res) as Record<string, unknown>;
    expect(data.success).toBe(true);
  });

  it('DELETE /api/mcp/servers/:id — not found', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleMcpRoutes(
        ctx,
        makeReq('DELETE'),
        res,
        `/api/mcp/servers/${SRV_MISSING}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Server not found' });
  });

  it('POST /api/mcp/servers — UNIQUE constraint', async () => {
    const mockDb = {
      listMcpServers: vi.fn(() => []),
      getMcpServerById: vi.fn(() => null),
      createMcpServer: vi.fn(() => {
        throw new Error('UNIQUE constraint failed');
      }),
      updateMcpServer: vi.fn(() => null),
      deleteMcpServer: vi.fn(() => false),
    };
    const ctx = makeCtx();
    (ctx as { getDb: () => unknown }).getDb = () => mockDb;
    const res = makeRes();
    const body = JSON.stringify({ name: 'dup', tool: 'claude', definition: { command: 'echo' } });
    expect(
      await handleMcpRoutes(
        ctx,
        makeReq('POST', body),
        res,
        '/api/mcp/servers',
        new URLSearchParams(),
      ),
    ).toBe(true);
    const data = getData(res) as Record<string, unknown>;
    expect(data.error).toBeDefined();
    expect(String(data.error)).toContain('already exists');
  });

  it('returns false for unmatched route', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleMcpRoutes(ctx, makeReq('GET'), res, '/api/other', new URLSearchParams()),
    ).toBe(false);
  });

  it('POST /api/mcp/servers — re-throws unknown errors from handleStoreError (line 151)', async () => {
    const mockDb = {
      listMcpServers: vi.fn(() => []),
      getMcpServerById: vi.fn(() => null),
      createMcpServer: vi.fn(() => {
        throw new Error('Unexpected DB corruption');
      }),
      updateMcpServer: vi.fn(() => null),
      deleteMcpServer: vi.fn(() => false),
    };
    const ctx = makeCtx();
    (ctx as { getDb: () => unknown }).getDb = () => mockDb;
    const res = makeRes();
    const body = JSON.stringify({ name: 'srv', tool: 'claude', definition: { command: 'echo' } });
    await expect(
      handleMcpRoutes(
        ctx,
        makeReq('POST', body),
        res,
        '/api/mcp/servers',
        new URLSearchParams(),
      ),
    ).rejects.toThrow('Unexpected DB corruption');
  });

  it('PUT /api/mcp/servers/:id — updateMcpServer returns null after concurrent delete (lines 209-212)', async () => {
    // Simulate a race condition where the server exists when looked up but is gone by update time
    const mockDb = {
      listMcpServers: vi.fn(() => []),
      getMcpServerById: vi.fn((id: string) =>
        id === SRV_UUID
          ? {
              id: SRV_UUID,
              name: 'test',
              tool: 'claude',
              transport: 'stdio',
              definition: { command: 'echo' },
            }
          : null,
      ),
      createMcpServer: vi.fn(),
      updateMcpServer: vi.fn(() => null), // Returns null — server was deleted concurrently
      deleteMcpServer: vi.fn(),
    };
    const ctx = makeCtx();
    (ctx as { getDb: () => unknown }).getDb = () => mockDb;
    const res = makeRes();
    const body = JSON.stringify({ definition: { command: 'cat' } });
    expect(
      await handleMcpRoutes(
        ctx,
        makeReq('PUT', body),
        res,
        `/api/mcp/servers/${SRV_UUID}`,
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Server not found' });
  });
});
