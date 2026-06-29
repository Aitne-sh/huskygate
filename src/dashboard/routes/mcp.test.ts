import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteContext } from '../route-context.js';

const { jsonMock, readBodyMock, readGlobalMcpConfigSourceMock } = vi.hoisted(() => ({
  jsonMock: vi.fn(),
  readBodyMock: vi.fn(),
  readGlobalMcpConfigSourceMock: vi.fn(),
}));

vi.mock('../http.js', () => ({
  json: jsonMock,
  parseJson: <T>(body: string): T | null => {
    try {
      return JSON.parse(body) as T;
    } catch {
      return null;
    }
  },
  readBody: readBodyMock,
}));

vi.mock('../../store/mcp-server.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/mcp-server.js')>();
  return {
    ...actual,
    readGlobalMcpConfigSource: readGlobalMcpConfigSourceMock,
  };
});

import { handleMcpRoutes } from './mcp.js';

function makeReq(method: string): IncomingMessage {
  return { method } as IncomingMessage;
}

function makeRes(): ServerResponse {
  return {} as ServerResponse;
}

function makeCtx(dbOverrides?: Record<string, unknown>): RouteContext {
  const db = {
    listMcpServers: vi.fn().mockReturnValue([]),
    getMcpServerById: vi.fn().mockReturnValue(null),
    createMcpServer: vi.fn(),
    updateMcpServer: vi.fn(),
    deleteMcpServer: vi.fn().mockReturnValue(false),
    ...dbOverrides,
  };

  return {
    getDb: vi.fn(() => db),
  } as unknown as RouteContext;
}

describe('handleMcpRoutes', () => {
  beforeEach(() => {
    jsonMock.mockReset();
    readBodyMock.mockReset();
    readGlobalMcpConfigSourceMock.mockReset();
    readGlobalMcpConfigSourceMock.mockReturnValue({
      tool: 'gemini',
      filePath: '/tmp/.gemini/settings.json',
      exists: true,
      servers: [],
      globalMcp: { timeout: 30 },
    });
  });

  it('returns DB-backed server config and read-only Gemini global settings', async () => {
    const ctx = makeCtx({
      listMcpServers: vi.fn().mockReturnValue([
        {
          id: 'srv-1',
          name: 'aws-api',
          tool: 'gemini',
          transport: 'sse',
          definition: { url: 'https://example.com/mcp', oauth: { clientId: 'secret' } },
        },
      ]),
    });

    const handled = await handleMcpRoutes(
      ctx,
      makeReq('GET'),
      makeRes(),
      '/api/mcp/servers',
      new URLSearchParams('tool=gemini'),
    );

    expect(handled).toBe(true);
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      tool: 'gemini',
      filePath: 'SQLite -> <workdir>/.gemini_runtime_home/.gemini/settings.json',
      exists: true,
      format: 'json',
      servers: {
        'aws-api': {
          id: 'srv-1',
          transport: 'sse',
          url: 'https://example.com/mcp',
          oauth: { clientId: 'secret' },
        },
      },
      globalMcp: { timeout: 30 },
    });
  });

  it('creates, updates, and deletes DB-backed servers for non-Claude tools', async () => {
    const serverId = '11111111-1111-4111-8111-111111111111';
    readBodyMock
      .mockResolvedValueOnce(
        JSON.stringify({
          tool: 'codex',
          name: 'codex-http',
          transport: 'http',
          definition: {
            url: 'https://example.com/mcp',
            bearerToken: 'top-secret',
            envHttpHeaders: { Authorization: 'CODEX_TOKEN' },
          },
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          transport: 'http',
          definition: {
            url: 'https://example.com/new',
            bearerToken: '***',
            envHttpHeaders: { Authorization: 'CODEX_TOKEN' },
          },
        }),
      );

    const db = {
      listMcpServers: vi.fn().mockReturnValue([]),
      getMcpServerById: vi
        .fn()
        .mockReturnValueOnce({
          id: serverId,
          name: 'codex-http',
          tool: 'codex',
          transport: 'http',
          definition: {
            url: 'https://example.com/mcp',
            bearerToken: 'top-secret',
            envHttpHeaders: { Authorization: 'CODEX_TOKEN' },
          },
        })
        .mockReturnValueOnce({
          id: serverId,
          name: 'codex-http',
          tool: 'codex',
          transport: 'http',
          definition: {
            url: 'https://example.com/mcp',
            bearerToken: 'top-secret',
            envHttpHeaders: { Authorization: 'CODEX_TOKEN' },
          },
        }),
      createMcpServer: vi.fn().mockReturnValue({
        id: serverId,
        name: 'codex-http',
        tool: 'codex',
        transport: 'http',
        definition: {
          url: 'https://example.com/mcp',
          bearerToken: 'top-secret',
          envHttpHeaders: { Authorization: 'CODEX_TOKEN' },
        },
      }),
      updateMcpServer: vi.fn().mockReturnValue({
        id: serverId,
        name: 'codex-http',
        tool: 'codex',
        transport: 'http',
        definition: {
          url: 'https://example.com/new',
          bearerToken: 'top-secret',
          envHttpHeaders: { Authorization: 'CODEX_TOKEN' },
        },
      }),
      deleteMcpServer: vi.fn().mockReturnValue(true),
    };
    const ctx = makeCtx(db);

    await handleMcpRoutes(
      ctx,
      makeReq('POST'),
      makeRes(),
      '/api/mcp/servers',
      new URLSearchParams(),
    );
    await handleMcpRoutes(
      ctx,
      makeReq('PUT'),
      makeRes(),
      `/api/mcp/servers/${serverId}`,
      new URLSearchParams(),
    );
    await handleMcpRoutes(
      ctx,
      makeReq('DELETE'),
      makeRes(),
      `/api/mcp/servers/${serverId}`,
      new URLSearchParams(),
    );

    expect(db.createMcpServer).toHaveBeenCalledWith({
      name: 'codex-http',
      tool: 'codex',
      transport: 'http',
      definition: {
        url: 'https://example.com/mcp',
        bearerToken: 'top-secret',
        envHttpHeaders: { Authorization: 'CODEX_TOKEN' },
      },
    });
    expect(db.updateMcpServer).toHaveBeenCalledWith(serverId, {
      transport: 'http',
      definition: {
        url: 'https://example.com/new',
        bearerToken: 'top-secret',
        envHttpHeaders: { Authorization: 'CODEX_TOKEN' },
      },
    });
    expect(db.deleteMcpServer).toHaveBeenCalledWith(serverId);
  });

  it('masks Codex httpHeaders in GET and preserves them on masked update', async () => {
    const serverId = '22222222-2222-4222-8222-222222222222';
    const existing = {
      id: serverId,
      name: 'codex-http',
      tool: 'codex',
      transport: 'http',
      definition: {
        url: 'https://example.com/mcp',
        httpHeaders: {
          Authorization: 'Bearer top-secret',
          'X-Trace': 'visible',
        },
      },
    };

    readBodyMock.mockResolvedValueOnce(
      JSON.stringify({
        transport: 'http',
        definition: {
          url: 'https://example.com/new',
          httpHeaders: {
            Authorization: '***',
            'X-Trace': 'changed',
          },
        },
      }),
    );

    const db = {
      listMcpServers: vi.fn().mockReturnValue([existing]),
      getMcpServerById: vi.fn().mockReturnValue(existing),
      updateMcpServer: vi.fn().mockReturnValue({
        ...existing,
        definition: {
          url: 'https://example.com/new',
          httpHeaders: {
            Authorization: 'Bearer top-secret',
            'X-Trace': 'changed',
          },
        },
      }),
    };
    const ctx = makeCtx(db);

    await handleMcpRoutes(
      ctx,
      makeReq('GET'),
      makeRes(),
      '/api/mcp/servers',
      new URLSearchParams('tool=codex'),
    );
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      tool: 'codex',
      filePath: 'SQLite -> <workdir>/.codex_runtime_home/config.toml',
      exists: true,
      format: 'toml',
      servers: {
        'codex-http': {
          id: serverId,
          transport: 'http',
          url: 'https://example.com/mcp',
          httpHeaders: {
            Authorization: '***',
            'X-Trace': 'visible',
          },
        },
      },
    });

    jsonMock.mockClear();

    await handleMcpRoutes(
      ctx,
      makeReq('PUT'),
      makeRes(),
      `/api/mcp/servers/${serverId}`,
      new URLSearchParams(),
    );

    expect(db.updateMcpServer).toHaveBeenCalledWith(serverId, {
      transport: 'http',
      definition: {
        url: 'https://example.com/new',
        httpHeaders: {
          Authorization: 'Bearer top-secret',
          'X-Trace': 'changed',
        },
      },
    });
  });

  it('returns 400 when a create request sends a masked secret without an existing value', async () => {
    readBodyMock.mockResolvedValueOnce(
      JSON.stringify({
        tool: 'codex',
        name: 'codex-http',
        transport: 'http',
        definition: {
          url: 'https://example.com/mcp',
          bearerToken: '***',
        },
      }),
    );

    const ctx = makeCtx();
    const handled = await handleMcpRoutes(
      ctx,
      makeReq('POST'),
      makeRes(),
      '/api/mcp/servers',
      new URLSearchParams(),
    );

    expect(handled).toBe(true);
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 400, {
      error: 'Invalid masked secret for "bearerToken": no existing value to restore',
    });
  });
});
