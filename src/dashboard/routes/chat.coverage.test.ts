/**
 * Coverage tests for dashboard/routes/chat.ts
 * Targets uncovered branches: chat messages, upload, artifact, error cases
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteContext } from '../route-context.js';

const { jsonMock, readBodyMock, readBinaryBodyMock, dashLogMock } = vi.hoisted(() => ({
  jsonMock: vi.fn(),
  readBodyMock: vi.fn(),
  readBinaryBodyMock: vi.fn(),
  dashLogMock: vi.fn(),
}));

vi.mock('../http.js', () => ({
  json: jsonMock,
  readBody: readBodyMock,
  readBinaryBody: readBinaryBodyMock,
  dashLog: dashLogMock,
}));

const { saveLocalFileMock, validateArtifactFileMock, buildArtifactResponseHeadersMock } =
  vi.hoisted(() => ({
    saveLocalFileMock: vi.fn(),
    validateArtifactFileMock: vi.fn(),
    buildArtifactResponseHeadersMock: vi
      .fn()
      .mockReturnValue({ 'Content-Type': 'application/octet-stream' }),
  }));

vi.mock('../../shared/file-attachment.js', () => ({
  saveLocalFile: saveLocalFileMock,
  validateArtifactFile: validateArtifactFileMock,
  buildArtifactResponseHeaders: buildArtifactResponseHeadersMock,
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
}));

const { readFileSyncMock } = vi.hoisted(() => ({
  readFileSyncMock: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readFileSync: readFileSyncMock,
}));

import { handleChatRoutes } from './chat.js';

function makeReq(method: string, headers?: Record<string, string>): IncomingMessage {
  return { method, headers: headers ?? {} } as IncomingMessage;
}

function makeRes(): ServerResponse {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse;
}

function makeCtx(overrides?: Partial<RouteContext>): RouteContext {
  return {
    getDb: vi.fn(() => ({
      listSessions: vi.fn().mockReturnValue([]),
      listSessionsByTool: vi.fn().mockReturnValue([]),
      getSessionToolState: vi.fn().mockReturnValue(null),
      getNewMessages: vi.fn().mockReturnValue([]),
      getMessages: vi.fn().mockReturnValue([]),
    })),
    proxyToServerApi: vi.fn().mockResolvedValue({ status: 200, data: { ok: true } }),
    proxySSE: vi.fn(),
    proxySSEGet: vi.fn(),
    ...overrides,
  } as unknown as RouteContext;
}

beforeEach(() => {
  jsonMock.mockReset();
  readBodyMock.mockReset();
  readBinaryBodyMock.mockReset();
  dashLogMock.mockReset();
  saveLocalFileMock.mockReset();
  validateArtifactFileMock.mockReset();
  readFileSyncMock.mockReset();
});

describe('handleChatRoutes', () => {
  it('returns false for unmatched route', async () => {
    const result = await handleChatRoutes(
      makeCtx(),
      makeReq('GET'),
      makeRes(),
      '/api/unmatched',
      new URLSearchParams(),
    );
    expect(result).toBe(false);
  });

  describe('GET /api/chat/sessions', () => {
    it('lists all sessions when no tool query', async () => {
      const db = {
        listSessions: vi.fn().mockReturnValue([{ id: '1' }]),
        listSessionsByTool: vi.fn(),
      };
      const ctx = makeCtx({ getDb: vi.fn(() => db) as unknown as RouteContext['getDb'] });

      await handleChatRoutes(
        ctx,
        makeReq('GET'),
        makeRes(),
        '/api/chat/sessions',
        new URLSearchParams(),
      );
      expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, [{ id: '1' }]);
    });

    it('lists sessions filtered by tool', async () => {
      const db = {
        listSessions: vi.fn(),
        listSessionsByTool: vi.fn().mockReturnValue([{ id: '2' }]),
      };
      const ctx = makeCtx({ getDb: vi.fn(() => db) as unknown as RouteContext['getDb'] });

      await handleChatRoutes(
        ctx,
        makeReq('GET'),
        makeRes(),
        '/api/chat/sessions',
        new URLSearchParams('tool=claude'),
      );
      expect(db.listSessionsByTool).toHaveBeenCalledWith('claude');
      expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, [{ id: '2' }]);
    });

    it('returns empty array on DB error', async () => {
      const db = {
        listSessions: vi.fn(() => {
          throw new Error('DB error');
        }),
      };
      const ctx = makeCtx({ getDb: vi.fn(() => db) as unknown as RouteContext['getDb'] });

      await handleChatRoutes(
        ctx,
        makeReq('GET'),
        makeRes(),
        '/api/chat/sessions',
        new URLSearchParams(),
      );
      expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, []);
    });
  });

  describe('POST /api/chat/sessions', () => {
    it('proxies to server API', async () => {
      readBodyMock.mockResolvedValue('{"tool":"claude"}');
      await handleChatRoutes(
        makeCtx(),
        makeReq('POST'),
        makeRes(),
        '/api/chat/sessions',
        new URLSearchParams(),
      );
      expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, { ok: true });
    });
  });

  describe('GET /api/chat/:id/messages/new', () => {
    it('returns 400 for invalid after param', async () => {
      await handleChatRoutes(
        makeCtx(),
        makeReq('GET'),
        makeRes(),
        '/api/chat/12345678/messages/new',
        new URLSearchParams('after=notanumber'),
      );
      expect(jsonMock).toHaveBeenCalledWith(
        expect.anything(),
        400,
        expect.objectContaining({ error: expect.stringContaining('after') }),
      );
    });

    it('returns 404 when session not found', async () => {
      await handleChatRoutes(
        makeCtx(),
        makeReq('GET'),
        makeRes(),
        '/api/chat/12345678/messages/new',
        new URLSearchParams('after=0'),
      );
      expect(jsonMock).toHaveBeenCalledWith(
        expect.anything(),
        404,
        expect.objectContaining({ error: 'Session not found' }),
      );
    });

    it('returns new messages successfully', async () => {
      const db = {
        getSessionToolState: vi.fn().mockReturnValue({ sessionKey: 'sess_test', workdir: '/tmp' }),
        getNewMessages: vi.fn().mockReturnValue([{ id: 1, text: 'msg' }]),
      };
      const ctx = makeCtx({ getDb: vi.fn(() => db) as unknown as RouteContext['getDb'] });

      await handleChatRoutes(
        ctx,
        makeReq('GET'),
        makeRes(),
        '/api/chat/12345678/messages/new',
        new URLSearchParams('after=0'),
      );
      expect(jsonMock).toHaveBeenCalledWith(
        expect.anything(),
        200,
        expect.objectContaining({ messages: expect.any(Array) }),
      );
    });

    it('defaults after to 0 when not provided', async () => {
      const db = {
        getSessionToolState: vi.fn().mockReturnValue({ sessionKey: 'sess_test', workdir: '/tmp' }),
        getNewMessages: vi.fn().mockReturnValue([]),
      };
      const ctx = makeCtx({ getDb: vi.fn(() => db) as unknown as RouteContext['getDb'] });

      await handleChatRoutes(
        ctx,
        makeReq('GET'),
        makeRes(),
        '/api/chat/12345678/messages/new',
        new URLSearchParams(),
      );
      expect(db.getNewMessages).toHaveBeenCalledWith('sess_test', 0);
    });
  });

  describe('GET /api/chat/:id/messages', () => {
    it('returns 400 for invalid before param', async () => {
      const db = {
        getSessionToolState: vi.fn().mockReturnValue({ sessionKey: 'sess_test', workdir: '/tmp' }),
        getMessages: vi.fn(),
      };
      const ctx = makeCtx({ getDb: vi.fn(() => db) as unknown as RouteContext['getDb'] });

      await handleChatRoutes(
        ctx,
        makeReq('GET'),
        makeRes(),
        '/api/chat/12345678/messages',
        new URLSearchParams('before=abc'),
      );
      expect(jsonMock).toHaveBeenCalledWith(
        expect.anything(),
        400,
        expect.objectContaining({ error: expect.stringContaining('before') }),
      );
    });

    it('returns 404 when session not found', async () => {
      await handleChatRoutes(
        makeCtx(),
        makeReq('GET'),
        makeRes(),
        '/api/chat/12345678/messages',
        new URLSearchParams(),
      );
      expect(jsonMock).toHaveBeenCalledWith(
        expect.anything(),
        404,
        expect.objectContaining({ error: 'Session not found' }),
      );
    });

    it('returns messages with hasMore flag', async () => {
      const msgs = Array.from({ length: 50 }, (_, i) => ({ id: i }));
      const db = {
        getSessionToolState: vi.fn().mockReturnValue({ sessionKey: 'sess_test', workdir: '/tmp' }),
        getMessages: vi.fn().mockReturnValue(msgs),
      };
      const ctx = makeCtx({ getDb: vi.fn(() => db) as unknown as RouteContext['getDb'] });

      await handleChatRoutes(
        ctx,
        makeReq('GET'),
        makeRes(),
        '/api/chat/12345678/messages',
        new URLSearchParams('limit=50'),
      );
      expect(jsonMock).toHaveBeenCalledWith(
        expect.anything(),
        200,
        expect.objectContaining({ hasMore: true }),
      );
    });
  });

  describe('POST /api/jobs/:sessionKey/stop', () => {
    it('proxies stop request', async () => {
      await handleChatRoutes(
        makeCtx(),
        makeReq('POST'),
        makeRes(),
        '/api/jobs/sess_abcdef01/stop',
        new URLSearchParams(),
      );
      expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, expect.any(Object));
    });
  });

  describe('POST /api/chat/:id/stop', () => {
    it('proxies session stop', async () => {
      await handleChatRoutes(
        makeCtx(),
        makeReq('POST'),
        makeRes(),
        '/api/chat/12345678/stop',
        new URLSearchParams(),
      );
      expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, expect.any(Object));
    });
  });

  describe('GET /api/chat/:id/status', () => {
    it('proxies status request', async () => {
      await handleChatRoutes(
        makeCtx(),
        makeReq('GET'),
        makeRes(),
        '/api/chat/12345678/status',
        new URLSearchParams(),
      );
      expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, expect.any(Object));
    });
  });

  describe('POST /api/chat/:id/tool-approval', () => {
    it('proxies tool approval', async () => {
      readBodyMock.mockResolvedValue('{"approved":true}');
      await handleChatRoutes(
        makeCtx(),
        makeReq('POST'),
        makeRes(),
        '/api/chat/12345678/tool-approval',
        new URLSearchParams(),
      );
      expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, expect.any(Object));
    });
  });

  describe('POST /api/chat/:id/upload', () => {
    it('returns 404 when session not found', async () => {
      await handleChatRoutes(
        makeCtx(),
        makeReq('POST', { 'x-file-name': 'test.txt' }),
        makeRes(),
        '/api/chat/12345678/upload',
        new URLSearchParams(),
      );
      expect(jsonMock).toHaveBeenCalledWith(
        expect.anything(),
        404,
        expect.objectContaining({ error: 'Session not found' }),
      );
    });

    it('returns 400 for invalid x-file-name encoding', async () => {
      const db = {
        getSessionToolState: vi.fn().mockReturnValue({ sessionKey: 'sess_test', workdir: '/tmp' }),
      };
      const ctx = makeCtx({ getDb: vi.fn(() => db) as unknown as RouteContext['getDb'] });

      await handleChatRoutes(
        ctx,
        makeReq('POST', { 'x-file-name': '%ZZ' }),
        makeRes(),
        '/api/chat/12345678/upload',
        new URLSearchParams(),
      );
      expect(jsonMock).toHaveBeenCalledWith(
        expect.anything(),
        400,
        expect.objectContaining({ error: expect.stringContaining('encoding') }),
      );
    });

    it('uploads file successfully', async () => {
      const db = {
        getSessionToolState: vi
          .fn()
          .mockReturnValue({ sessionKey: 'sess_test', workdir: '/tmp/work' }),
      };
      const ctx = makeCtx({ getDb: vi.fn(() => db) as unknown as RouteContext['getDb'] });
      readBinaryBodyMock.mockResolvedValue(Buffer.from('content'));
      saveLocalFileMock.mockResolvedValue({
        originalName: 'test.txt',
        size: 7,
        path: '/tmp/work/file',
      });

      await handleChatRoutes(
        ctx,
        makeReq('POST', { 'x-file-name': 'test.txt', 'x-file-mime': 'text/plain' }),
        makeRes(),
        '/api/chat/12345678/upload',
        new URLSearchParams(),
      );
      expect(jsonMock).toHaveBeenCalledWith(
        expect.anything(),
        200,
        expect.objectContaining({ originalName: 'test.txt' }),
      );
    });
  });

  describe('POST /api/chat/:id/send', () => {
    it('proxies SSE to server', async () => {
      readBodyMock.mockResolvedValue('{"prompt":"hi"}');
      const ctx = makeCtx();

      await handleChatRoutes(
        ctx,
        makeReq('POST'),
        makeRes(),
        '/api/chat/12345678/send',
        new URLSearchParams(),
      );
      expect(ctx.proxySSE).toHaveBeenCalled();
    });
  });

  describe('GET /api/chat/:id/job-stream/:jobId', () => {
    it('proxies SSE GET to server', async () => {
      const ctx = makeCtx();
      await handleChatRoutes(
        ctx,
        makeReq('GET'),
        makeRes(),
        '/api/chat/12345678/job-stream/abc-def-123',
        new URLSearchParams(),
      );
      expect(ctx.proxySSEGet).toHaveBeenCalled();
    });
  });

  describe('GET /api/chat/:id/artifacts', () => {
    it('returns 404 when session not found', async () => {
      await handleChatRoutes(
        makeCtx(),
        makeReq('GET'),
        makeRes(),
        '/api/chat/12345678/artifacts',
        new URLSearchParams(),
      );
      expect(jsonMock).toHaveBeenCalledWith(
        expect.anything(),
        404,
        expect.objectContaining({ error: 'Session not found' }),
      );
    });

    it('proxies artifact listing when session found', async () => {
      const db = {
        getSessionToolState: vi.fn().mockReturnValue({ sessionKey: 'sess_test', workdir: '/tmp' }),
      };
      const ctx = makeCtx({ getDb: vi.fn(() => db) as unknown as RouteContext['getDb'] });

      await handleChatRoutes(
        ctx,
        makeReq('GET'),
        makeRes(),
        '/api/chat/12345678/artifacts',
        new URLSearchParams(),
      );
      expect(ctx.proxyToServerApi).toHaveBeenCalledWith('GET', '/api/chat/12345678/artifacts');
    });
  });

  describe('GET /api/chat/:id/artifacts/:jobId/:filename', () => {
    it('returns 404 when session not found', async () => {
      await handleChatRoutes(
        makeCtx(),
        makeReq('GET'),
        makeRes(),
        '/api/chat/12345678/artifacts/abc-def-123/file.txt',
        new URLSearchParams(),
      );
      expect(jsonMock).toHaveBeenCalledWith(
        expect.anything(),
        404,
        expect.objectContaining({ error: 'Session not found' }),
      );
    });

    it('returns error when artifact validation fails', async () => {
      const db = {
        getSessionToolState: vi.fn().mockReturnValue({ sessionKey: 'sess_test', workdir: '/tmp' }),
      };
      const ctx = makeCtx({ getDb: vi.fn(() => db) as unknown as RouteContext['getDb'] });
      validateArtifactFileMock.mockResolvedValue({
        ok: false,
        status: 404,
        error: 'File not found',
      });

      await handleChatRoutes(
        ctx,
        makeReq('GET'),
        makeRes(),
        '/api/chat/12345678/artifacts/abc-def-123/file.txt',
        new URLSearchParams(),
      );
      expect(jsonMock).toHaveBeenCalledWith(
        expect.anything(),
        404,
        expect.objectContaining({ error: 'File not found' }),
      );
    });

    it('serves artifact file when validation passes', async () => {
      const db = {
        getSessionToolState: vi.fn().mockReturnValue({ sessionKey: 'sess_test', workdir: '/tmp' }),
      };
      const ctx = makeCtx({ getDb: vi.fn(() => db) as unknown as RouteContext['getDb'] });
      validateArtifactFileMock.mockResolvedValue({
        ok: true,
        filePath: '/tmp/artifacts/file.txt',
        stat: { size: 100 },
        contentType: 'text/plain',
      });
      readFileSyncMock.mockReturnValue(Buffer.from('file content'));
      const res = makeRes();

      await handleChatRoutes(
        ctx,
        makeReq('GET'),
        res,
        '/api/chat/12345678/artifacts/abc-def-123/file.txt',
        new URLSearchParams(),
      );
      expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
      expect(res.end).toHaveBeenCalled();
    });
  });
});
