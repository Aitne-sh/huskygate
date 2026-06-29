/**
 * Coverage tests for dashboard/proxy.ts
 * Targets: createProxyToServerApi, createProxySSE, createProxySSEGet — all branches
 */
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProxySSE, createProxySSEGet, createProxyToServerApi } from './proxy.js';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeReq(): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  return req;
}

function makeRes(): ServerResponse & {
  headStatus: number | null;
  headHeaders: Record<string, string>;
  bodyChunks: string[];
  ended: boolean;
  headersSent: boolean;
  writableEnded: boolean;
} {
  const res = new EventEmitter() as unknown as ServerResponse & {
    headStatus: number | null;
    headHeaders: Record<string, string>;
    bodyChunks: string[];
    ended: boolean;
    headersSent: boolean;
    writableEnded: boolean;
  };
  res.headStatus = null;
  res.headHeaders = {};
  res.bodyChunks = [];
  res.ended = false;
  res.headersSent = false;
  res.writableEnded = false;
  res.writeHead = vi.fn((status: number, headers?: Record<string, string>) => {
    res.headStatus = status;
    res.headersSent = true;
    if (headers) Object.assign(res.headHeaders, headers);
    return res;
  }) as unknown as typeof res.writeHead;
  res.write = vi.fn((chunk: string) => {
    res.bodyChunks.push(chunk);
    return true;
  }) as unknown as typeof res.write;
  res.end = vi.fn((data?: string) => {
    if (data) res.bodyChunks.push(data);
    res.ended = true;
    res.writableEnded = true;
    return res;
  }) as unknown as typeof res.end;
  return res;
}

describe('createProxyToServerApi', () => {
  it('proxies GET request successfully', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const proxy = createProxyToServerApi('http://127.0.0.1:3738', 'secret');
    const result = await proxy('GET', '/api/status');

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3738/api/status',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret',
        }),
      }),
    );
  });

  it('proxies POST request with body', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 201 }));

    const proxy = createProxyToServerApi('http://127.0.0.1:3738', 'secret');
    const result = await proxy('POST', '/api/sessions', '{"tool":"claude"}');

    expect(result.status).toBe(201);
    expect(result.data).toEqual({ id: 1 });
    const call = fetchMock.mock.calls[0];
    expect(call?.[1]?.body).toBe('{"tool":"claude"}');
  });

  it('returns 503 when fetch throws (server unreachable)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const proxy = createProxyToServerApi('http://127.0.0.1:3738', 'secret');
    const result = await proxy('GET', '/api/status');

    expect(result.status).toBe(503);
    expect(result.data).toEqual({ error: 'Server is not running' });
  });
});

describe('createProxySSE (POST)', () => {
  it('streams SSE data from upstream', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"msg":"hello"}\n\n'));
        controller.close();
      },
    });

    fetchMock.mockResolvedValue(new Response(stream, { status: 200 }));

    const proxySSE = createProxySSE('http://127.0.0.1:3738', 'secret');
    const req = makeReq();
    const res = makeRes();

    await proxySSE('/api/chat/12345678/send', '{"prompt":"hi"}', req, res);

    expect(res.bodyChunks.join('')).toContain('data: {"msg":"hello"}');
    expect(res.writableEnded).toBe(true);
  });

  it('returns error when upstream responds with non-ok status', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'not found' }), { status: 404 }),
    );

    const proxySSE = createProxySSE('http://127.0.0.1:3738', 'secret');
    const req = makeReq();
    const res = makeRes();

    await proxySSE('/api/chat/12345678/send', '{}', req, res);

    expect(res.headStatus).toBe(404);
  });

  it('returns error when upstream body is null', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    const proxySSE = createProxySSE('http://127.0.0.1:3738', 'secret');
    const req = makeReq();
    const res = makeRes();

    await proxySSE('/api/chat/12345678/send', '{}', req, res);

    // Should handle non-ok-or-no-body gracefully
    expect(res.headStatus).toBe(200);
  });

  it('returns 503 when fetch throws (connection failed)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const proxySSE = createProxySSE('http://127.0.0.1:3738', 'secret');
    const req = makeReq();
    const res = makeRes();

    await proxySSE('/api/chat/12345678/send', '{}', req, res);

    expect(res.headStatus).toBe(503);
  });

  it('handles upstream error with non-JSON text', async () => {
    fetchMock.mockResolvedValue(new Response('plain error text', { status: 500 }));

    const proxySSE = createProxySSE('http://127.0.0.1:3738', 'secret');
    const req = makeReq();
    const res = makeRes();

    await proxySSE('/api/chat/12345678/send', '{}', req, res);

    expect(res.headStatus).toBe(500);
  });

  it('cancels reader when client disconnects', async () => {
    const cancelMock = vi.fn().mockResolvedValue(undefined);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Keep stream open
        controller.enqueue(encoder.encode('data: first\n\n'));
        // Don't close — will be cancelled
      },
    });

    // Monkey-patch reader to track cancel calls
    const origGetReader = stream.getReader.bind(stream);
    let reader: ReadableStreamDefaultReader;
    vi.spyOn(stream, 'getReader').mockImplementation(() => {
      reader = origGetReader();
      const origCancel = reader.cancel.bind(reader);
      reader.cancel = async (reason) => {
        cancelMock();
        return origCancel(reason);
      };
      return reader;
    });

    fetchMock.mockResolvedValue(new Response(stream, { status: 200 }));

    const proxySSE = createProxySSE('http://127.0.0.1:3738', 'secret');
    const req = makeReq();
    const res = makeRes();

    // Start the SSE proxy (it will block reading from stream)
    const proxyPromise = proxySSE('/api/chat/12345678/send', '{}', req, res);

    // Simulate client disconnect after a tick
    await new Promise((r) => setTimeout(r, 50));
    req.emit('close');

    // Wait for proxy to finish
    await proxyPromise;

    expect(cancelMock).toHaveBeenCalled();
  });

  it('ends response when headers already sent and fetch throws during stream', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const proxySSE = createProxySSE('http://127.0.0.1:3738', 'secret');
    const req = makeReq();
    const res = makeRes();

    // Simulate headers already sent
    res.headersSent = true;

    await proxySSE('/api/chat/12345678/send', '{}', req, res);

    // Should call res.end() instead of json() since headers were sent
    expect(res.writableEnded).toBe(true);
  });
});

describe('createProxySSE — backpressure', () => {
  it('waits for drain when res.write returns false (lines 95-97)', async () => {
    const encoder = new TextEncoder();
    let enqueueNext: (() => void) | null = null;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: first\n\n'));
        // Enqueue second chunk asynchronously after drain
        enqueueNext = () => {
          controller.enqueue(encoder.encode('data: second\n\n'));
          controller.close();
        };
      },
    });

    fetchMock.mockResolvedValue(new Response(stream, { status: 200 }));

    const proxySSE = createProxySSE('http://127.0.0.1:3738', 'secret');
    const req = makeReq();
    const res = makeRes();

    // Override res.write to return false on first call (simulate backpressure)
    let writeCallCount = 0;
    (res.write as ReturnType<typeof vi.fn>).mockImplementation((chunk: string) => {
      res.bodyChunks.push(chunk);
      writeCallCount++;
      if (writeCallCount === 1) {
        // Simulate backpressure — return false, then emit 'drain' after tick
        setTimeout(() => {
          enqueueNext?.();
          res.emit('drain');
        }, 10);
        return false;
      }
      return true;
    });

    await proxySSE('/api/chat/12345678/send', '{}', req, res);

    expect(res.bodyChunks.join('')).toContain('data: first');
    expect(res.writableEnded).toBe(true);
  });
});

describe('createProxySSEGet', () => {
  it('proxies GET SSE request', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"event":"update"}\n\n'));
        controller.close();
      },
    });

    fetchMock.mockResolvedValue(new Response(stream, { status: 200 }));

    const proxySSEGet = createProxySSEGet('http://127.0.0.1:3738', 'secret');
    const req = makeReq();
    const res = makeRes();

    await proxySSEGet('/api/chat/12345678/job-stream/abc-123', req, res);

    expect(res.bodyChunks.join('')).toContain('data: {"event":"update"}');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/chat/12345678/job-stream/abc-123'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns 503 when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const proxySSEGet = createProxySSEGet('http://127.0.0.1:3738', 'secret');
    const req = makeReq();
    const res = makeRes();

    await proxySSEGet('/api/chat/12345678/job-stream/abc', req, res);

    expect(res.headStatus).toBe(503);
  });
});
