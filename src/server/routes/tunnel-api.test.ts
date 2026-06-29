import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import { handleTunnelApiRoutes, matchesTunnelApiPath } from './tunnel-api.js';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/platform.js', () => ({
  resolveCommand: vi.fn((name: string) => (name === 'cloudflared' ? '/usr/bin/cloudflared' : null)),
}));

// Configurable mock — tests can override behavior per-test via mockTunnelBehavior.
const mockTunnelBehavior = {
  startResult: 'https://test.trycloudflare.com' as string | null,
  startError: null as Error | null,
  stopCalled: false,
  lastOptions: null as Record<string, unknown> | null,
};

vi.mock('../tunnel.js', () => {
  return {
    CloudflareTunnel: class MockTunnel {
      constructor(opts: Record<string, unknown>) {
        mockTunnelBehavior.lastOptions = opts;
      }
      async start() {
        if (mockTunnelBehavior.startError) throw mockTunnelBehavior.startError;
        return mockTunnelBehavior.startResult;
      }
      stop() {
        mockTunnelBehavior.stopCalled = true;
      }
      getPublicUrl() {
        return mockTunnelBehavior.startResult;
      }
    },
  };
});

// Minimal HTTP helpers for invoking the handler directly.
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

class MockReq extends EventEmitter {
  method: string;
  url: string;
  headers: Record<string, string> = {};
  socket = { remoteAddress: '127.0.0.1' };
  private buf: Buffer[] = [];
  private endPending = false;

  constructor(method: string, url: string, body?: string) {
    super();
    this.method = method;
    this.url = url;
    if (body !== undefined) {
      this.buf.push(Buffer.from(body));
      this.endPending = true;
    }
  }
  destroy(): this {
    return this;
  }
  override on(event: string | symbol, listener: (...args: unknown[]) => void): this {
    super.on(event, listener);
    if (event === 'data') {
      for (const b of this.buf.splice(0)) listener(b);
    }
    if (event === 'end' && this.endPending) {
      this.endPending = false;
      // Defer to next microtask so 'data' listeners are registered first.
      queueMicrotask(() => listener());
    }
    return this;
  }
}

class MockRes {
  statusCode = 200;
  body = '';
  headers: Record<string, string> = {};
  setHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  writeHead(code: number, hdrs?: Record<string, string>) {
    this.statusCode = code;
    if (hdrs) Object.assign(this.headers, hdrs);
  }
  end(data?: string) {
    if (data) this.body = data;
  }
}

function json(res: MockRes): unknown {
  return JSON.parse(res.body);
}

describe('tunnel-api routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockTunnelBehavior.startResult = 'https://test.trycloudflare.com';
    mockTunnelBehavior.startError = null;
    mockTunnelBehavior.stopCalled = false;
    mockTunnelBehavior.lastOptions = null;
  });

  describe('matchesTunnelApiPath', () => {
    it('matches /api/tunnel paths', () => {
      expect(matchesTunnelApiPath('/api/tunnel')).toBe(true);
      expect(matchesTunnelApiPath('/api/tunnel/status')).toBe(true);
      expect(matchesTunnelApiPath('/api/tunnel/start')).toBe(true);
      expect(matchesTunnelApiPath('/api/tunnel/stop')).toBe(true);
    });

    it('rejects non-tunnel paths', () => {
      expect(matchesTunnelApiPath('/api/settings')).toBe(false);
      expect(matchesTunnelApiPath('/api/webhook-endpoints')).toBe(false);
    });
  });

  describe('GET /api/tunnel/status', () => {
    it('returns inactive status when no tunnel is running', async () => {
      const ctx = makeTestAppContext();
      const req = new MockReq('GET', '/api/tunnel/status');
      const res = new MockRes();

      await handleTunnelApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/tunnel/status',
      );

      expect(res.statusCode).toBe(200);
      const body = json(res) as { ok: boolean; data: Record<string, unknown> };
      expect(body.ok).toBe(true);
      expect(body.data.active).toBe(false);
      expect(body.data.url).toBeNull();
      expect(body.data.cloudflaredInstalled).toBe(true);
      expect(body.data.localPort).toBe(3738);
    });
  });

  describe('POST /api/tunnel/start', () => {
    it('starts a tunnel and returns the URL', async () => {
      const ctx = makeTestAppContext();
      const req = new MockReq('POST', '/api/tunnel/start', '{}');
      const res = new MockRes();

      await handleTunnelApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/tunnel/start',
      );

      expect(res.statusCode).toBe(200);
      const body = json(res) as { ok: boolean; data: Record<string, unknown> };
      expect(body.ok).toBe(true);
      expect(body.data.active).toBe(true);
      expect(body.data.url).toBe('https://test.trycloudflare.com');
      expect(ctx.tunnel).not.toBeNull();
      expect(ctx.tunnelEnabled).toBe(true);
    });

    it('returns existing tunnel if already running', async () => {
      const ctx = makeTestAppContext();
      const mockTunnel = {
        start: vi.fn(),
        stop: vi.fn(),
        getPublicUrl: vi.fn(() => 'https://existing.trycloudflare.com'),
      };
      (ctx as unknown as { tunnel: typeof mockTunnel }).tunnel = mockTunnel;

      const req = new MockReq('POST', '/api/tunnel/start', '{}');
      const res = new MockRes();

      await handleTunnelApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/tunnel/start',
      );

      expect(res.statusCode).toBe(200);
      const body = json(res) as { data: Record<string, unknown> };
      expect(body.data.url).toBe('https://existing.trycloudflare.com');
      expect(mockTunnel.start).not.toHaveBeenCalled();
    });

    it('returns 400 when cloudflared is not installed', async () => {
      const { resolveCommand } = await import('../../utils/platform.js');
      vi.mocked(resolveCommand).mockReturnValue(null);

      const ctx = makeTestAppContext();
      const req = new MockReq('POST', '/api/tunnel/start', '{}');
      const res = new MockRes();

      await handleTunnelApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/tunnel/start',
      );

      expect(res.statusCode).toBe(400);
      const body = json(res) as { error: string };
      expect(body.error).toContain('cloudflared is not installed');
    });
  });

  describe('POST /api/tunnel/stop', () => {
    it('stops the running tunnel', async () => {
      const ctx = makeTestAppContext();
      const mockTunnel = {
        stop: vi.fn(),
        getPublicUrl: vi.fn(() => 'https://stopping.trycloudflare.com'),
      };
      (ctx as unknown as { tunnel: typeof mockTunnel }).tunnel = mockTunnel;
      ctx.tunnelEnabled = true;

      const req = new MockReq('POST', '/api/tunnel/stop', '{}');
      const res = new MockRes();

      await handleTunnelApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/tunnel/stop',
      );

      expect(res.statusCode).toBe(200);
      expect(mockTunnel.stop).toHaveBeenCalled();
      expect(ctx.tunnel).toBeNull();
      expect(ctx.tunnelEnabled).toBe(false);
    });

    it('succeeds even when no tunnel is running', async () => {
      const ctx = makeTestAppContext();
      const req = new MockReq('POST', '/api/tunnel/stop', '{}');
      const res = new MockRes();

      await handleTunnelApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/tunnel/stop',
      );

      expect(res.statusCode).toBe(200);
      const body = json(res) as { data: Record<string, unknown> };
      expect(body.data.active).toBe(false);
    });
  });

  describe('POST /api/tunnel/start — error handling', () => {
    it('calls tunnel.stop() on start failure to prevent resource leak', async () => {
      mockTunnelBehavior.startError = new Error('connection refused');

      const ctx = makeTestAppContext();
      const req = new MockReq('POST', '/api/tunnel/start', '{}');
      const res = new MockRes();

      await handleTunnelApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/tunnel/start',
      );

      expect(res.statusCode).toBe(500);
      expect(mockTunnelBehavior.stopCalled).toBe(true);
      expect(ctx.tunnel).toBeNull();
      expect(ctx.tunnelEnabled).toBe(false);
    });

    it('passes token from request body to CloudflareTunnel', async () => {
      const ctx = makeTestAppContext();
      const req = new MockReq('POST', '/api/tunnel/start', '{"token":"my-body-token"}');
      const res = new MockRes();

      await handleTunnelApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/tunnel/start',
      );

      expect(res.statusCode).toBe(200);
      expect(mockTunnelBehavior.lastOptions?.token).toBe('my-body-token');
    });

    it('falls back to config token when body has no token', async () => {
      const ctx = makeTestAppContext({ config: { cloudflareTunnelToken: 'config-token' } });
      const req = new MockReq('POST', '/api/tunnel/start', '{}');
      const res = new MockRes();

      await handleTunnelApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/tunnel/start',
      );

      expect(mockTunnelBehavior.lastOptions?.token).toBe('config-token');
    });
  });

  describe('POST /api/tunnel/start — publicBaseUrl auto-set', () => {
    it('auto-sets webhookPublicBaseUrl for quick tunnels', async () => {
      const ctx = makeTestAppContext({ config: { webhookPublicBaseUrl: null } });
      const req = new MockReq('POST', '/api/tunnel/start', '{}');
      const res = new MockRes();

      await handleTunnelApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/tunnel/start',
      );

      expect(ctx.config.webhookPublicBaseUrl).toBe('https://test.trycloudflare.com');
    });

    it('does not overwrite existing webhookPublicBaseUrl', async () => {
      const ctx = makeTestAppContext({
        config: { webhookPublicBaseUrl: 'https://custom.example.com' },
      });
      const req = new MockReq('POST', '/api/tunnel/start', '{}');
      const res = new MockRes();

      await handleTunnelApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/tunnel/start',
      );

      expect(ctx.config.webhookPublicBaseUrl).toBe('https://custom.example.com');
    });
  });

  describe('POST /api/tunnel/stop — publicBaseUrl cleanup', () => {
    it('clears webhookPublicBaseUrl when stopping a quick tunnel', async () => {
      const ctx = makeTestAppContext({
        config: { webhookPublicBaseUrl: 'https://test.trycloudflare.com' },
      });
      const mockTunnel = {
        stop: vi.fn(),
        getPublicUrl: vi.fn(() => 'https://test.trycloudflare.com'),
      };
      (ctx as unknown as { tunnel: typeof mockTunnel }).tunnel = mockTunnel;
      ctx.tunnelEnabled = true;

      const req = new MockReq('POST', '/api/tunnel/stop', '{}');
      const res = new MockRes();

      await handleTunnelApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/tunnel/stop',
      );

      expect(ctx.config.webhookPublicBaseUrl).toBeNull();
    });

    it('preserves webhookPublicBaseUrl when stopping a named tunnel', async () => {
      const ctx = makeTestAppContext({
        config: { webhookPublicBaseUrl: 'https://hooks.example.com' },
      });
      const mockTunnel = {
        stop: vi.fn(),
        getPublicUrl: vi.fn(() => null), // Named tunnel has no publicUrl
      };
      (ctx as unknown as { tunnel: typeof mockTunnel }).tunnel = mockTunnel;
      ctx.tunnelEnabled = true;

      const req = new MockReq('POST', '/api/tunnel/stop', '{}');
      const res = new MockRes();

      await handleTunnelApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/tunnel/stop',
      );

      expect(ctx.config.webhookPublicBaseUrl).toBe('https://hooks.example.com');
    });
  });

  describe('POST /api/tunnel/start — invalid JSON body (line 71)', () => {
    it('handles invalid JSON body gracefully and uses quick tunnel', async () => {
      const ctx = makeTestAppContext();
      const req = new MockReq('POST', '/api/tunnel/start', 'not-valid-json{{{');
      const res = new MockRes();

      await handleTunnelApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/tunnel/start',
      );

      expect(res.statusCode).toBe(200);
      const body = json(res) as { ok: boolean; data: Record<string, unknown> };
      expect(body.ok).toBe(true);
      expect(body.data.active).toBe(true);
    });
  });

  describe('unmatched paths', () => {
    it('returns false for unknown tunnel sub-paths', async () => {
      const ctx = makeTestAppContext();
      const req = new MockReq('GET', '/api/tunnel/unknown');
      const res = new MockRes();

      const handled = await handleTunnelApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/tunnel/unknown',
      );

      expect(handled).toBe(false);
    });
  });
});
