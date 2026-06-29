import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server, ServerResponse } from 'node:http';
import { Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual };
});

vi.mock('../server/daemon.js', () => ({
  getServerStatus: vi.fn(() => ({ running: false, pid: null, pidFile: '/tmp/pid' })),
  getPidFilePath: vi.fn(() => '/tmp/pid'),
  startDaemon: vi.fn(() => ({ pid: 1 })),
  stopDaemon: vi.fn(() => ({ pid: 1 })),
}));

vi.mock('./app.js', () => ({
  renderApp: vi.fn(() => '<html></html>'),
}));

vi.mock('./db.js', () => ({
  DashboardDb: class DashboardDbMock {
    listSessions() {
      return [];
    }
    listSessionsByTool() {
      return [];
    }
    getOverviewStats() {
      return {};
    }
    getSessionToolState(_id: string) {
      return { workdir: '/tmp/work' };
    }
    getNewMessages() {
      return [];
    }
    getMessages() {
      return [];
    }
    getSessionAudit() {
      return [];
    }
    listDevAliases() {
      return [];
    }
    getDevAlias() {
      return null;
    }
    getAuditByWorkdir() {
      return [];
    }
    createDevAlias() {
      return {};
    }
    updateDevAlias() {
      return {};
    }
    deleteDevAlias() {
      return true;
    }
    clearSessionDevAlias() {}
    close() {}
  },
}));

/**
 * Mock saveLocalFile to throw "File type not allowed" errors.
 * This covers the global error handler at server.ts L2392-2395.
 */
vi.mock('../shared/file-attachment.js', async () => {
  const actual = await vi.importActual<typeof import('../shared/file-attachment.js')>(
    '../shared/file-attachment.js',
  );
  return {
    ...actual,
    saveLocalFile: vi.fn().mockImplementation(async () => {
      throw new Error('File type not allowed: application/zip');
    }),
  };
});

import { createDashboardServer } from './server.js';

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

async function invoke(
  server: Server,
  method: string,
  path: string,
  body?: string,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const req = new MockRequest(method, path, {
    cookie: 'hg_session=dashboard-secret',
    'content-type': 'application/json',
    'x-csrf-protection': '1',
    ...extraHeaders,
  });
  const res = new MockResponse();
  server.emit('request', req as never, res as unknown as ServerResponse);
  // Allow async handler chain to drain microtasks before emitting body events
  await new Promise((r) => setTimeout(r, 0));
  if (body !== undefined) {
    req.emit('data', Buffer.from(body));
  }
  req.emit('end');
  await res.done;
  let parsed: unknown = res.body;
  const contentType = String(res.headers['content-type'] ?? '');
  if (contentType.includes('application/json') && res.body) {
    parsed = JSON.parse(res.body);
  }
  return { status: res.statusCode, body: parsed };
}

const tempDirs: string[] = [];
const servers: Server[] = [];
let listenSpy: ReturnType<typeof vi.fn>;

beforeAll(() => {
  listenSpy = vi.spyOn(HttpServer.prototype, 'listen').mockImplementation(function (
    this: HttpServer,
    ...args: unknown[]
  ) {
    const callback = args.find((arg) => typeof arg === 'function') as (() => void) | undefined;
    callback?.();
    return this;
  }) as unknown as ReturnType<typeof vi.fn>;
});

afterAll(() => {
  listenSpy.mockRestore();
});

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.emit('close');
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTestServer(): { server: Server; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'dashboard-browse-errors-'));
  tempDirs.push(root);
  const envFilePath = join(root, '.env');
  writeFileSync(envFilePath, '', 'utf-8');
  const server = createDashboardServer({
    port: 0,
    version: 'test',
    dataDir: root,
    serverApiPort: 3738,
    serverApiSecret: 'secret',
    dashboardSecret: 'dashboard-secret',
    workdirRoot: root,
  });
  servers.push(server);
  return { server, root };
}

describe('global error handler — File type not allowed', () => {
  it('returns 400 when saveLocalFile throws File type not allowed', async () => {
    const { server } = createTestServer();
    // POST to chat upload endpoint — saveLocalFile is mocked to throw "File type not allowed"
    // The URL must match /api/chat/{8-hex}/upload pattern
    const res = await invoke(server, 'POST', '/api/chat/abcd1234/upload', 'binary data', {
      'x-file-name': 'test.zip',
      'x-file-mime': 'application/zip',
      'content-type': 'application/octet-stream',
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'File type not allowed: application/zip',
    });
  });
});
