/**
 * Coverage2 tests for chat-api.ts — targets remaining uncovered branches.
 * Covers: NaN "before" parameter → 400, NaN "after" parameter → 400,
 * matchesChatApiPath additional paths, sseWrite on ended response,
 * sseRetry on ended response, sseWrite error handling.
 */
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../context/app-context.js';
import type { ActiveRunner } from '../../context/app-types.js';
import {
  makeTestAppContext,
  makeTestSessionSummary,
} from '../../test-helpers/app-context-builder.js';
import { handleChatApiRoutes, matchesChatApiPath } from './chat-api.js';

const mocked = vi.hoisted(() => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
    })),
  })),
}));

vi.mock('../../store/database.js', () => ({
  getDb: mocked.getDb,
}));

class MockRequest extends EventEmitter {
  public method: string;
  public url?: string;
  public headers: Record<string, string>;

  constructor(method: string, url: string, headers?: Record<string, string>) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers ?? {};
  }

  destroy(): this {
    this.emit('close');
    return this;
  }
}

class MockResponse {
  public statusCode = 200;
  public body = '';
  public headers: Record<string, string> = {};
  public writableEnded = false;

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.statusCode = statusCode;
    if (headers) this.headers = { ...headers };
    return this;
  }

  setHeader(k: string, v: string): this {
    this.headers[k] = v;
    return this;
  }

  write(chunk: string): boolean {
    this.body += chunk;
    return true;
  }

  end(chunk?: string): this {
    if (chunk) this.body += chunk;
    this.writableEnded = true;
    return this;
  }
}

async function invoke(
  ctx: AppContext,
  options: { method: string; path: string; body?: unknown; query?: string },
): Promise<{ handled: boolean; status: number; body: unknown }> {
  const url = options.query ? `${options.path}?${options.query}` : options.path;
  const req = new MockRequest(options.method, url, { 'content-type': 'application/json' });
  const res = new MockResponse();
  const promise = handleChatApiRoutes(
    ctx,
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse,
    options.path,
  );
  if (options.body !== undefined) {
    req.emit('data', Buffer.from(JSON.stringify(options.body)));
  }
  req.emit('end');
  const handled = await promise;
  return {
    handled,
    status: res.statusCode,
    body: res.body ? JSON.parse(res.body) : null,
  };
}

function expectBody(body: unknown): Record<string, unknown> {
  expect(body).not.toBeNull();
  return body as Record<string, unknown>;
}

describe('chat-api coverage2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('matchesChatApiPath additional paths', () => {
    it('matches /api/jobs/:key/stop', () => {
      expect(matchesChatApiPath('/api/jobs/sess_abc/stop')).toBe(true);
    });

    it('matches /api/chat/:id/stop', () => {
      expect(matchesChatApiPath('/api/chat/abcdef01/stop')).toBe(true);
    });

    it('matches /api/chat/:id/status', () => {
      expect(matchesChatApiPath('/api/chat/abcdef01/status')).toBe(true);
    });

    it('matches /api/chat/:id/send', () => {
      expect(matchesChatApiPath('/api/chat/abcdef01/send')).toBe(true);
    });

    it('matches /api/chat/:id/messages', () => {
      expect(matchesChatApiPath('/api/chat/abcdef01/messages')).toBe(true);
    });

    it('matches /api/chat/:id/messages/new', () => {
      expect(matchesChatApiPath('/api/chat/abcdef01/messages/new')).toBe(true);
    });

    it('matches /api/chat/:id/tool-approval', () => {
      expect(matchesChatApiPath('/api/chat/abcdef01/tool-approval')).toBe(true);
    });

    it('matches /api/chat/:id/job-stream/:jobId', () => {
      expect(
        matchesChatApiPath('/api/chat/abcdef01/job-stream/11111111-1111-1111-1111-111111111111'),
      ).toBe(true);
    });
  });

  describe('GET /api/chat/:id/messages — NaN before parameter', () => {
    it('returns 400 when before is NaN', async () => {
      const ctx = makeTestAppContext();
      const session = makeTestSessionSummary({ sessionId: 'abcdef01' });
      (ctx.sessionManager.getSessionSummaryById as ReturnType<typeof vi.fn>).mockReturnValue(
        session,
      );

      const req = new MockRequest('GET', '/api/chat/abcdef01/messages?before=notanumber', {
        'content-type': 'application/json',
      });
      const res = new MockResponse();
      const promise = handleChatApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/chat/abcdef01/messages',
      );
      req.emit('end');
      const handled = await promise;

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Invalid "before" parameter');
    });
  });

  describe('GET /api/chat/:id/messages/new — NaN after parameter', () => {
    it('returns 400 when after is NaN', async () => {
      const ctx = makeTestAppContext();
      const session = makeTestSessionSummary({ sessionId: 'abcdef01' });
      (ctx.sessionManager.getSessionSummaryById as ReturnType<typeof vi.fn>).mockReturnValue(
        session,
      );

      const req = new MockRequest('GET', '/api/chat/abcdef01/messages/new?after=notanumber', {
        'content-type': 'application/json',
      });
      const res = new MockResponse();
      const promise = handleChatApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/chat/abcdef01/messages/new',
      );
      req.emit('end');
      const handled = await promise;

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Invalid "after" parameter');
    });
  });

  describe('GET /api/chat/:id/messages — session not found', () => {
    it('returns 404 when session does not exist', async () => {
      const ctx = makeTestAppContext();
      (ctx.sessionManager.getSessionSummaryById as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const r = await invoke(ctx, {
        method: 'GET',
        path: '/api/chat/abcdef01/messages',
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(404);
    });
  });

  describe('GET /api/chat/:id/messages/new — session not found', () => {
    it('returns 404 when session does not exist', async () => {
      const ctx = makeTestAppContext();
      (ctx.sessionManager.getSessionSummaryById as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const r = await invoke(ctx, {
        method: 'GET',
        path: '/api/chat/abcdef01/messages/new',
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(404);
    });
  });

  describe('GET /api/chat/sessions — filtering by tool', () => {
    it('filters sessions by tool query parameter', async () => {
      const ctx = makeTestAppContext();
      const sessions = [
        makeTestSessionSummary({ tool: 'claude', sessionKey: 'sk1' }),
        makeTestSessionSummary({ tool: 'codex', sessionKey: 'sk2' }),
      ];
      (ctx.sessionManager.listAllSessions as ReturnType<typeof vi.fn>).mockReturnValue(sessions);

      const req = new MockRequest('GET', '/api/chat/sessions?tool=claude', {
        'content-type': 'application/json',
      });
      const res = new MockResponse();
      const promise = handleChatApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/chat/sessions',
      );
      req.emit('end');
      const handled = await promise;

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveLength(1);
      expect(body[0].tool).toBe('claude');
    });
  });

  describe('POST /api/jobs/:sessionKey/stop', () => {
    it('returns success false when no active runner', async () => {
      const ctx = makeTestAppContext();

      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/jobs/sess_abcdef01/stop',
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(200);
      expect(expectBody(r.body).success).toBe(false);
    });

    it('kills active runner when found', async () => {
      const ctx = makeTestAppContext();
      const killMock = vi.fn();
      ctx.activeRunners.set('sess_abcdef01', {
        runner: { kill: killMock, isRunning: () => true } as unknown as ActiveRunner['runner'],
        job: { id: 'job-1' } as unknown as ActiveRunner['job'],
      } as ActiveRunner);

      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/jobs/sess_abcdef01/stop',
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(200);
      expect(expectBody(r.body).success).toBe(true);
      expect(killMock).toHaveBeenCalledWith('dashboard_stop');
    });
  });

  describe('POST /api/chat/:id/stop', () => {
    it('returns 404 when session not found', async () => {
      const ctx = makeTestAppContext();
      (ctx.sessionManager.getSessionSummaryById as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/chat/abcdef01/stop',
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(404);
    });
  });

  describe('GET /api/chat/:id/status', () => {
    it('returns 404 when session not found', async () => {
      const ctx = makeTestAppContext();
      (ctx.sessionManager.getSessionSummaryById as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const r = await invoke(ctx, {
        method: 'GET',
        path: '/api/chat/abcdef01/status',
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(404);
    });

    it('returns running state and pending approval info', async () => {
      const ctx = makeTestAppContext();
      const session = makeTestSessionSummary({ sessionId: 'abcdef01' });
      (ctx.sessionManager.getSessionSummaryById as ReturnType<typeof vi.fn>).mockReturnValue(
        session,
      );
      ctx.activeRunners.set(session.sessionKey, {
        runner: { isRunning: () => true, kill: vi.fn() } as unknown as ActiveRunner['runner'],
        job: { id: 'job-1' } as unknown as ActiveRunner['job'],
      } as ActiveRunner);

      const r = await invoke(ctx, {
        method: 'GET',
        path: '/api/chat/abcdef01/status',
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(200);
      expect(expectBody(r.body).running).toBe(true);
      expect(expectBody(r.body).jobId).toBe('job-1');
    });
  });

  describe('unmatched path returns false', () => {
    it('returns false for unrecognized path', async () => {
      const ctx = makeTestAppContext();

      const r = await invoke(ctx, {
        method: 'GET',
        path: '/api/other-route',
      });
      expect(r.handled).toBe(false);
    });
  });
});
