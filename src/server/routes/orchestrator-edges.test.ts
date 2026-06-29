import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../context/app-context.js';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import { handleOrchestratorEdgeRoutes } from './orchestrator-edges.js';

// UUIDs matching the 36-char hex pattern required by route matchers
const O = '11111111-1111-1111-1111-111111111111';
const N1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const N2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const E1 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const MISSING = '99999999-9999-9999-9999-999999999999';

class MockRequest extends EventEmitter {
  public method: string;
  public url?: string;
  public headers: Record<string, string>;
  constructor(method: string, url: string) {
    super();
    this.method = method;
    this.url = url;
    this.headers = {};
  }
}
class MockResponse {
  public statusCode = 200;
  public body = '';
  writeHead(s: number) {
    this.statusCode = s;
    return this;
  }
  end(c?: string) {
    if (c) this.body += c;
    return this;
  }
}

async function invoke(ctx: AppContext, o: { method: string; path: string; body?: unknown }) {
  const req = new MockRequest(o.method, o.path);
  const res = new MockResponse();
  const p = handleOrchestratorEdgeRoutes(
    ctx,
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse,
    o.path,
  );
  if (o.body !== undefined) req.emit('data', Buffer.from(JSON.stringify(o.body)));
  req.emit('end');
  const handled = await p;
  return { handled, status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

function createContext(): AppContext {
  const ctx = makeTestAppContext();
  ctx.orchestratorStore = {
    getById: vi.fn((id: string) =>
      id === O ? { id: O, status: 'active', startNodeId: N1 } : null,
    ),
    getNodeById: vi.fn((id: string) => {
      if (id === N1) return { id: N1, orchestratorId: O };
      if (id === N2) return { id: N2, orchestratorId: O };
      return null;
    }),
    getEdgeById: vi.fn((id: string) =>
      id === E1 ? { id: E1, orchestratorId: O, fromNodeId: N1, toNodeId: N2 } : null,
    ),
    createEdge: vi.fn((input: Record<string, unknown>) => ({ id: 'e-new', ...input })),
    updateEdge: vi.fn(),
    deleteEdge: vi.fn(),
    invalidateDag: vi.fn(),
  } as unknown as AppContext['orchestratorStore'];
  return ctx;
}

describe('handleOrchestratorEdgeRoutes', () => {
  describe('POST /api/orchestrators/:id/edges', () => {
    it('creates an edge', async () => {
      const ctx = createContext();
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/orchestrators/${O}/edges`,
        body: { fromNodeId: N1, toNodeId: N2 },
      });
      expect(r.status).toBe(201);
      expect(ctx.orchestratorStore.invalidateDag).toHaveBeenCalledWith(O);
    });
    it('returns 404 when orchestrator not found', async () => {
      const ctx = createContext();
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/orchestrators/${MISSING}/edges`,
        body: { fromNodeId: N1, toNodeId: N2 },
      });
      expect(r.status).toBe(404);
    });
    it('returns 404 when orchestrator is deleted', async () => {
      const ctx = createContext();
      (ctx.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
        id: O,
        status: 'deleted',
      });
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/orchestrators/${O}/edges`,
        body: { fromNodeId: N1, toNodeId: N2 },
      });
      expect(r.status).toBe(404);
    });
    it('returns 400 for invalid JSON', async () => {
      const ctx = createContext();
      const req = new MockRequest('POST', `/api/orchestrators/${O}/edges`);
      const res = new MockResponse();
      const p = handleOrchestratorEdgeRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        `/api/orchestrators/${O}/edges`,
      );
      req.emit('data', Buffer.from('not-json'));
      req.emit('end');
      await p;
      expect(res.statusCode).toBe(400);
    });
    it('returns 400 when schema validation fails', async () => {
      const ctx = createContext();
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/orchestrators/${O}/edges`,
        body: { fromNodeId: 123 },
      });
      expect(r.status).toBe(400);
    });
    it('returns 400 when fromNode not in this orchestrator', async () => {
      const ctx = createContext();
      (ctx.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockImplementation(
        (id: string) => {
          if (id === N1) return { id: N1, orchestratorId: 'other' };
          if (id === N2) return { id: N2, orchestratorId: O };
          return null;
        },
      );
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/orchestrators/${O}/edges`,
        body: { fromNodeId: N1, toNodeId: N2 },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'fromNodeId not found in this orchestrator' });
    });
    it('returns 400 when toNode not in this orchestrator', async () => {
      const ctx = createContext();
      (ctx.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockImplementation(
        (id: string) => {
          if (id === N1) return { id: N1, orchestratorId: O };
          if (id === N2) return { id: N2, orchestratorId: 'other' };
          return null;
        },
      );
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/orchestrators/${O}/edges`,
        body: { fromNodeId: N1, toNodeId: N2 },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'toNodeId not found in this orchestrator' });
    });
    it('passes conditionValue and conditionOperator', async () => {
      const ctx = createContext();
      await invoke(ctx, {
        method: 'POST',
        path: `/api/orchestrators/${O}/edges`,
        body: { fromNodeId: N1, toNodeId: N2, conditionValue: 'true', conditionOperator: 'eq' },
      });
      expect(ctx.orchestratorStore.createEdge).toHaveBeenCalledWith(
        expect.objectContaining({ conditionValue: 'true', conditionOperator: 'eq' }),
      );
    });
  });

  describe('PATCH /api/orchestrators/:oid/edges/:eid', () => {
    it('updates an edge', async () => {
      const ctx = createContext();
      (ctx.orchestratorStore.getEdgeById as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ id: E1 })
        .mockReturnValueOnce({ id: E1, conditionValue: 'new' });
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/orchestrators/${O}/edges/${E1}`,
        body: { conditionValue: 'new' },
      });
      expect(r.status).toBe(200);
      expect(ctx.orchestratorStore.invalidateDag).toHaveBeenCalledWith(O);
    });
    it('returns 404 when edge not found', async () => {
      const ctx = createContext();
      (ctx.orchestratorStore.getEdgeById as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/orchestrators/${O}/edges/${MISSING}`,
        body: { conditionValue: 'x' },
      });
      expect(r.status).toBe(404);
    });
    it('returns 400 for invalid JSON', async () => {
      const ctx = createContext();
      const req = new MockRequest('PATCH', `/api/orchestrators/${O}/edges/${E1}`);
      const res = new MockResponse();
      const p = handleOrchestratorEdgeRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        `/api/orchestrators/${O}/edges/${E1}`,
      );
      req.emit('data', Buffer.from('bad'));
      req.emit('end');
      await p;
      expect(res.statusCode).toBe(400);
    });
    it('returns 400 when schema validation fails', async () => {
      const ctx = createContext();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/orchestrators/${O}/edges/${E1}`,
        body: { sortOrder: 'not-a-number' },
      });
      expect(r.status).toBe(400);
    });
  });

  describe('DELETE /api/orchestrators/:oid/edges/:eid', () => {
    it('deletes an edge', async () => {
      const ctx = createContext();
      const r = await invoke(ctx, {
        method: 'DELETE',
        path: `/api/orchestrators/${O}/edges/${E1}`,
      });
      expect(r.status).toBe(200);
      expect(ctx.orchestratorStore.deleteEdge).toHaveBeenCalledWith(E1);
      expect(ctx.orchestratorStore.invalidateDag).toHaveBeenCalledWith(O);
    });
    it('returns 404 when edge not found', async () => {
      const ctx = createContext();
      (ctx.orchestratorStore.getEdgeById as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const r = await invoke(ctx, {
        method: 'DELETE',
        path: `/api/orchestrators/${O}/edges/${MISSING}`,
      });
      expect(r.status).toBe(404);
    });
  });

  it('returns false for unmatched paths', async () => {
    const ctx = createContext();
    const r = await invoke(ctx, { method: 'GET', path: '/api/other' });
    expect(r.handled).toBe(false);
  });
});
