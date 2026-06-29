import { EventEmitter } from 'node:events';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import type { Server, ServerResponse } from 'node:http';
import { Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    statSync: ((target: string, options?: unknown) => {
      if (target.includes('stat-throws')) {
        throw new Error('forced stat failure');
      }
      return actual.statSync(target, options as never);
    }) as typeof actual.statSync,
  };
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
    getSessionToolState() {
      return null;
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
): Promise<{ status: number; body: unknown }> {
  const req = new MockRequest(method, path, {
    cookie: 'hg_session=dashboard-secret',
    'content-type': 'application/json',
    'x-csrf-protection': '1',
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
  return { status: res.statusCode, body: JSON.parse(res.body) as unknown };
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
  const root = mkdtempSync(join(tmpdir(), 'dashboard-stat-errors-'));
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

describe('createDashboardServer statSync error branches', () => {
  it('returns cannot access path for alias create/update when statSync throws', async () => {
    const { server, root } = createTestServer();
    const createPath = join(root, 'stat-throws-create');
    const updatePath = join(root, 'stat-throws-update');
    writeFileSync(createPath, 'x', 'utf-8');
    writeFileSync(updatePath, 'y', 'utf-8');

    const createRes = await invoke(
      server,
      'POST',
      '/api/dev-aliases',
      JSON.stringify({ name: 'alias1', path: createPath }),
    );
    expect(createRes.status).toBe(400);
    expect(createRes.body).toEqual({ error: `Cannot access path: ${realpathSync(createPath)}` });

    const updateRes = await invoke(
      server,
      'PUT',
      '/api/dev-aliases/alias1',
      JSON.stringify({ path: updatePath }),
    );
    expect(updateRes.status).toBe(400);
    expect(updateRes.body).toEqual({ error: `Cannot access path: ${realpathSync(updatePath)}` });
  });
});
