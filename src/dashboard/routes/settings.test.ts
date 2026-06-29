/**
 * Coverage tests for handleSettingsRoutes.
 */
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type KeychainProvider,
  resetKeychainProvider,
  setKeychainProvider,
} from '../../utils/keychain.js';
import type { RouteContext } from '../route-context.js';
import { handleSettingsRoutes } from './settings.js';

function createTestKeychain(available = true): KeychainProvider {
  return {
    platform: 'test',
    isAvailable: async () => available,
    getPassword: async () => null,
    setPassword: async () => {},
    deletePassword: async () => false,
    listKeys: async () => [],
  };
}

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

function makeCtx(overrides: Partial<RouteContext> = {}): RouteContext {
  const configStore = {
    get: vi.fn(() => null),
    getAll: vi.fn(() => []),
    setDbValue: vi.fn(),
    setKeychainRef: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn((fn: () => void) => fn()),
    getMetadata: vi.fn(() => null),
    setMetadata: vi.fn(),
  };
  const defaultInstructions = {
    getWithEnabled: vi.fn(() => ({ content: 'default content', enabled: true })),
    set: vi.fn(),
    setEnabled: vi.fn(),
  };
  return {
    version: '1.0.0',
    dataDir: '/tmp/data',
    workdirRoot: '/tmp/work',
    dashboardSecret: 'secret',
    serverApiBase: 'http://127.0.0.1:9999',
    logPath: '/tmp/server.log',
    dashboardLogPath: '/tmp/dashboard.log',
    getDb: vi.fn(() => ({
      config: configStore,
      defaultInstructions,
    })) as unknown as RouteContext['getDb'],
    proxyToServerApi: vi.fn(async () => ({ status: 200, data: { applied: ['LOG_LEVEL'] } })),
    proxySSE: vi.fn(async () => {}),
    proxySSEGet: vi.fn(async () => {}),
    ...overrides,
  };
}

afterEach(() => {
  resetKeychainProvider();
});

describe('handleSettingsRoutes', () => {
  it('GET /api/settings/schema', async () => {
    setKeychainProvider(createTestKeychain());
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSettingsRoutes(
        ctx,
        makeReq('GET'),
        res,
        '/api/settings/schema',
        new URLSearchParams(),
      ),
    ).toBe(true);
    const data = getData(res) as Record<string, unknown>;
    expect(data.schema).toBeDefined();
  });

  it('GET /api/settings/keychain-status', async () => {
    setKeychainProvider(createTestKeychain(true));
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSettingsRoutes(
        ctx,
        makeReq('GET'),
        res,
        '/api/settings/keychain-status',
        new URLSearchParams(),
      ),
    ).toBe(true);
    const data = getData(res) as Record<string, unknown>;
    expect(data.available).toBe(true);
  });

  it('GET /api/settings', async () => {
    setKeychainProvider(createTestKeychain());
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSettingsRoutes(ctx, makeReq('GET'), res, '/api/settings', new URLSearchParams()),
    ).toBe(true);
    const data = getData(res) as Record<string, unknown>;
    expect(data.entries).toBeDefined();
  });

  it('PUT /api/settings — invalid JSON', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSettingsRoutes(
        ctx,
        makeReq('PUT', 'not-json'),
        res,
        '/api/settings',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Invalid JSON' });
  });

  it('PUT /api/settings — missing patches array', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSettingsRoutes(
        ctx,
        makeReq('PUT', '{}'),
        res,
        '/api/settings',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Invalid body: patches array required' });
  });

  it('PUT /api/settings — malformed patch', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    const body = JSON.stringify({ patches: [{ not: 'valid' }] });
    expect(
      await handleSettingsRoutes(
        ctx,
        makeReq('PUT', body),
        res,
        '/api/settings',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Invalid body: malformed setting patch' });
  });

  it('PUT /api/settings — applies patches with runtime values', async () => {
    setKeychainProvider(createTestKeychain());
    const ctx = makeCtx();
    const res = makeRes();
    const body = JSON.stringify({ patches: [{ key: 'LOG_LEVEL', op: 'set', value: 'debug' }] });
    expect(
      await handleSettingsRoutes(
        ctx,
        makeReq('PUT', body),
        res,
        '/api/settings',
        new URLSearchParams(),
      ),
    ).toBe(true);
    const data = getData(res) as Record<string, unknown>;
    expect(data.success).toBe(true);
  });

  it('PUT /api/settings — handles apply failure (non-200)', async () => {
    setKeychainProvider(createTestKeychain());
    const ctx = makeCtx({
      proxyToServerApi: vi.fn(async () => ({ status: 500, data: { error: 'fail' } })),
    });
    const res = makeRes();
    const body = JSON.stringify({ patches: [{ key: 'LOG_LEVEL', op: 'set', value: 'debug' }] });
    expect(
      await handleSettingsRoutes(
        ctx,
        makeReq('PUT', body),
        res,
        '/api/settings',
        new URLSearchParams(),
      ),
    ).toBe(true);
    const data = getData(res) as Record<string, unknown>;
    expect(data.success).toBe(true);
    expect((data.requiresRestart as string[]).length).toBeGreaterThan(0);
  });

  it('PUT /api/settings — apply error throws', async () => {
    setKeychainProvider(createTestKeychain());
    const ctx = makeCtx();
    const res = makeRes();
    // Use an invalid key to trigger error
    const body = JSON.stringify({
      patches: [{ key: 'INVALID_KEY_NEVER_EXISTS', op: 'set', value: 'x' }],
    });
    expect(
      await handleSettingsRoutes(
        ctx,
        makeReq('PUT', body),
        res,
        '/api/settings',
        new URLSearchParams(),
      ),
    ).toBe(true);
    const data = getData(res) as Record<string, unknown>;
    expect(data.error).toBeDefined();
  });

  it('GET /api/settings/prompts', async () => {
    setKeychainProvider(createTestKeychain());
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSettingsRoutes(
        ctx,
        makeReq('GET'),
        res,
        '/api/settings/prompts',
        new URLSearchParams(),
      ),
    ).toBe(true);
    const data = getData(res) as Record<string, unknown>;
    expect(data.prompts).toBeDefined();
  });

  it('PUT /api/settings/prompts/defaults — invalid body', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSettingsRoutes(
        ctx,
        makeReq('PUT', '{}'),
        res,
        '/api/settings/prompts/defaults',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toEqual({ error: 'Invalid body: { tool, content?, enabled? } required' });
  });

  it('PUT /api/settings/prompts/defaults — invalid tool', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    const body = JSON.stringify({ tool: 'invalid' });
    expect(
      await handleSettingsRoutes(
        ctx,
        makeReq('PUT', body),
        res,
        '/api/settings/prompts/defaults',
        new URLSearchParams(),
      ),
    ).toBe(true);
    expect(getData(res)).toMatchObject({ error: expect.stringContaining('Invalid tool') });
  });

  it('PUT /api/settings/prompts/defaults — set content and enabled', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    const body = JSON.stringify({ tool: 'claude', content: 'new', enabled: true });
    expect(
      await handleSettingsRoutes(
        ctx,
        makeReq('PUT', body),
        res,
        '/api/settings/prompts/defaults',
        new URLSearchParams(),
      ),
    ).toBe(true);
    const data = getData(res) as Record<string, unknown>;
    expect(data.success).toBe(true);
  });

  it('returns false for unmatched', async () => {
    const ctx = makeCtx();
    const res = makeRes();
    expect(
      await handleSettingsRoutes(ctx, makeReq('GET'), res, '/api/other', new URLSearchParams()),
    ).toBe(false);
  });
});
