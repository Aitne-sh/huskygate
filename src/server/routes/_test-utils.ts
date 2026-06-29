/** Shared test utilities for server route tests. */
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

// UUIDs matching the 36-char hex pattern required by route matchers
export const UUID = {
  orch1: '11111111-1111-1111-1111-111111111111',
  orch2: '22222222-2222-2222-2222-222222222222',
  missing: '99999999-9999-9999-9999-999999999999',
  node1: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  node2: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  node3: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  edge1: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  task1: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  run1: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  endpoint1: '11111111-2222-3333-4444-555555555555',
  sub1: '66666666-6666-6666-6666-666666666666',
} as const;

export class MockRequest extends EventEmitter {
  public method: string;
  public url?: string;
  public headers: Record<string, string>;
  public socket = { remoteAddress: '127.0.0.1' };
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

export class MockResponse {
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

export type InvokeResult = { handled: boolean; status: number; body: unknown };

export function createInvoker(
  handler: (
    ctx: unknown,
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ) => Promise<boolean>,
) {
  return async function invoke(
    ctx: unknown,
    o: { method: string; path: string; body?: unknown },
  ): Promise<InvokeResult> {
    const req = new MockRequest(o.method, o.path);
    const res = new MockResponse();
    const p = handler(
      ctx,
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      o.path,
    );
    if (o.body !== undefined) {
      req.emit('data', Buffer.from(JSON.stringify(o.body)));
    }
    req.emit('end');
    const handled = await p;
    return {
      handled,
      status: res.statusCode,
      body: res.body ? JSON.parse(res.body) : null,
    };
  };
}
