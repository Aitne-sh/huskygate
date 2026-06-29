/**
 * Coverage tests for api.ts — targets uncovered lines:
 * 106-108 (non-JSON Content-Type rejection on mutation requests),
 * 196 (terminateProcess catch block during EADDRINUSE recovery).
 */
import { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestAppContext } from '../test-helpers/app-context-builder.js';

const mocked = vi.hoisted(() => ({
  dbAll: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  loggerDebug: vi.fn(),
  daemonFindPidOnPort: vi.fn<(port: number) => number | null>(() => null),
  terminateProcess: vi.fn(),
}));

vi.mock('../store/database.js', () => ({
  getDb: () => ({
    prepare: () => ({
      all: mocked.dbAll,
    }),
  }),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: mocked.loggerDebug,
    info: mocked.loggerInfo,
    warn: mocked.loggerWarn,
    error: mocked.loggerError,
  },
  setLogLevel: vi.fn(),
  createScopedLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('./daemon.js', () => ({
  findPidOnPort: mocked.daemonFindPidOnPort,
}));

vi.mock('../utils/platform.js', () => ({
  terminateProcess: (...args: unknown[]) => mocked.terminateProcess(...args),
  findPidOnPort: vi.fn(() => null),
  resolveCommand: vi.fn(() => null),
}));

import { EventEmitter } from 'node:events';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { NotificationService } from './notification-service.js';

import { createApiServer, startApiServer } from './api.js';

class MockRequest extends EventEmitter {
  public method: string;
  public url?: string;
  public headers: IncomingHttpHeaders;
  public socket = { remoteAddress: '127.0.0.1' as string | undefined };
  private bufferedData: Buffer[] = [];
  private bufferedEnd = false;

  constructor(method: string, url?: string, headers?: Record<string, string>) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers ?? {};
  }

  destroy(): this {
    super.emit('close');
    return this;
  }

  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'data' && this.listenerCount('data') === 0) {
      this.bufferedData.push(args[0] as Buffer);
      return true;
    }
    if (event === 'end' && this.listenerCount('end') === 0) {
      this.bufferedEnd = true;
      return true;
    }
    return super.emit(event, ...args);
  }

  override on(event: string | symbol, listener: (...args: unknown[]) => void): this {
    super.on(event, listener);
    if (event === 'data') {
      for (const chunk of this.bufferedData.splice(0)) listener(chunk);
    }
    if (event === 'end' && this.bufferedEnd) {
      this.bufferedEnd = false;
      listener();
    }
    return this;
  }
}

class MockResponse extends EventEmitter {
  public statusCode = 200;
  public headers: Record<string, string | string[]> = {};
  public body = '';
  public headersSent = false;
  public writableEnded = false;
  private doneResolve!: () => void;
  public readonly done: Promise<void>;

  constructor() {
    super();
    this.done = new Promise<void>((resolve) => {
      this.doneResolve = resolve;
    });
  }

  setHeader(name: string, value: string | string[]): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.statusCode = statusCode;
    this.headersSent = true;
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        this.setHeader(key, value);
      }
    }
    return this;
  }

  write(chunk: string): boolean {
    this.body += chunk;
    return true;
  }

  end(chunk?: string): this {
    if (chunk) this.body += chunk;
    this.writableEnded = true;
    this.doneResolve();
    this.emit('finish');
    return this;
  }
}

function createNotificationServiceStub(): NotificationService {
  return {
    postNotification: vi.fn(async () => ({ ts: 'stub-ts', channel: 'stub-channel' })),
    listTargets: vi.fn(async () => []),
  };
}

async function invokeServer(
  server: Server,
  options: { method: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: unknown }> {
  const req = new MockRequest(options.method, options.path, options.headers);
  const res = new MockResponse();
  server.emit('request', req as never, res as unknown as ServerResponse);
  if (options.body !== undefined) {
    req.emit('data', Buffer.from(options.body));
  }
  req.emit('end');
  await res.done;
  let parsed: unknown = null;
  if (res.body.length > 0) {
    try {
      parsed = JSON.parse(res.body);
    } catch {
      parsed = res.body;
    }
  }
  return { status: res.statusCode, body: parsed };
}

afterEach(() => {
  mocked.dbAll.mockReset();
  mocked.loggerInfo.mockReset();
  mocked.loggerWarn.mockReset();
  mocked.loggerError.mockReset();
  mocked.loggerDebug.mockReset();
  mocked.daemonFindPidOnPort.mockReset();
  mocked.terminateProcess.mockReset();
  vi.restoreAllMocks();
});

describe('api.ts coverage', () => {
  // Lines 106-108: non-JSON Content-Type on mutation requests gets 415
  it('rejects POST with non-JSON Content-Type (415)', async () => {
    const ctx = makeTestAppContext({ config: { serverApiSecret: 'secret' } });
    const server = createApiServer(ctx, createNotificationServiceStub());
    const res = await invokeServer(server, {
      method: 'POST',
      path: '/api/sessions',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'text/plain',
      },
      body: 'hello',
    });
    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: 'Unsupported Media Type: expected application/json' });
  });

  it('rejects PATCH with non-JSON Content-Type (415)', async () => {
    const ctx = makeTestAppContext({ config: { serverApiSecret: 'secret' } });
    const server = createApiServer(ctx, createNotificationServiceStub());
    const res = await invokeServer(server, {
      method: 'PATCH',
      path: '/api/sessions/test123',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'multipart/form-data',
      },
      body: 'data',
    });
    expect(res.status).toBe(415);
  });

  // Line 196: terminateProcess throws during EADDRINUSE recovery (catch block)
  it('handles terminateProcess throwing during EADDRINUSE recovery', () => {
    const ctx = makeTestAppContext({ config: { serverApiSecret: 'secret', serverApiPort: 0 } });
    mocked.daemonFindPidOnPort.mockReturnValue(4321);
    mocked.terminateProcess.mockImplementation(() => {
      throw new Error('ESRCH: no such process');
    });
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void) => {
      cb();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as never);
    const listenSpy = vi.spyOn(Server.prototype, 'listen').mockImplementation(function (
      this: Server,
      ...args: unknown[]
    ) {
      const cb = args.find((a) => typeof a === 'function') as (() => void) | undefined;
      cb?.();
      return this;
    });

    const server = startApiServer(ctx, createNotificationServiceStub());
    server.emit('error', Object.assign(new Error('in use'), { code: 'EADDRINUSE' }));

    // terminateProcess throws, but the catch block swallows the error
    // and the recovery continues with setTimeout + listen retry
    expect(mocked.terminateProcess).toHaveBeenCalledWith(4321);
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect(listenSpy).toHaveBeenCalledTimes(2); // initial + retry
  });
});
