import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingHttpHeaders, Server, ServerResponse } from 'node:http';
import { Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENV_REGISTRY, PERSISTED_CONFIG_KEYS, SECURE_STORE_KEYS } from '../config.js';
import * as security from '../shared/security.js';
import { type KeychainProvider, setKeychainProvider } from '../utils/keychain.js';
import { createDashboardServer } from './server.js';

interface MockConfigRecord {
  key: string;
  value: string | null;
  storage: 'db' | 'keychain_ref';
  source: 'user';
  updatedAt: string;
}

const mocked = vi.hoisted(() => ({
  getServerStatus: vi.fn(() => ({ running: true, pid: 12345, pidFile: '/tmp/huskygate.pid' })),
  getPidFilePath: vi.fn(() => '/tmp/huskygate.pid'),
  startDaemon: vi.fn((): { pid?: number; error?: string } => ({ pid: 12346 })),
  stopDaemon: vi.fn((): { pid?: number; error?: string } => ({ pid: 12345 })),
  renderApp: vi.fn(() => '<!DOCTYPE html><html><body>dashboard</body></html>'),
  dbCtor: vi.fn((_dbPath?: string) => undefined),
  dbClose: vi.fn(),
  listSessions: vi.fn((): Record<string, unknown>[] => []),
  listSessionsByTool: vi.fn((_tool?: string): Record<string, unknown>[] => []),
  getOverviewStats: vi.fn(() => ({})),
  getChartData: vi.fn(() => ({
    dailyJobs: [] as { date: string; tool: string; total: number; errors: number }[],
    successRateRange: 100,
    totalRange: 0,
  })),
  getSessionToolState: vi.fn((_sessionId?: string): Record<string, unknown> | null => null),
  getNewMessages: vi.fn((_sessionKey?: string, _afterId?: number): Record<string, unknown>[] => []),
  getMessages: vi.fn(
    (_sessionKey?: string, _limit?: number, _before?: number): Record<string, unknown>[] => [],
  ),
  getSessionAudit: vi.fn((_sessionId?: string): Record<string, unknown>[] => []),
  listDevAliases: vi.fn((): Record<string, unknown>[] => []),
  getDevAlias: vi.fn((_name?: string): Record<string, unknown> | null => null),
  getAuditByWorkdir: vi.fn((_workdir?: string): Record<string, unknown>[] => []),
  createDevAlias: vi.fn(
    (
      _name?: string,
      _path?: string,
      _tool?: string,
      _instructionContent?: string | null,
    ): Record<string, unknown> | undefined => undefined,
  ),
  updateDevAlias: vi.fn(
    (_name?: string, _updates?: Record<string, unknown>): Record<string, unknown> | null => null,
  ),
  deleteDevAlias: vi.fn((_name?: string) => false),
  clearSessionDevAlias: vi.fn((_name?: string) => undefined),
  getSparklineData: vi.fn(
    (): { sessions: number[]; jobs: number[]; successRate: number[]; errors: number[] } => ({
      sessions: [0, 0, 0, 0, 0, 0, 0],
      jobs: [0, 0, 0, 0, 0, 0, 0],
      successRate: [100, 100, 100, 100, 100, 100, 100],
      errors: [0, 0, 0, 0, 0, 0, 0],
    }),
  ),
  fetchMock: vi.fn(),
  configRecordsByDbPath: new Map<string, Map<string, MockConfigRecord>>(),
  metadataByDbPath: new Map<string, Map<string, string>>(),
  skillEnablementByDbPath: new Map<string, Map<string, boolean>>(),
}));

function getConfigBucket(dbPath: string): Map<string, MockConfigRecord> {
  let bucket = mocked.configRecordsByDbPath.get(dbPath);
  if (!bucket) {
    bucket = new Map<string, MockConfigRecord>();
    mocked.configRecordsByDbPath.set(dbPath, bucket);
  }
  return bucket;
}

function getDbPathForDataDir(dataDir: string): string {
  return resolve(dataDir, 'orchestrator.db');
}

function getMetadataBucket(dbPath: string): Map<string, string> {
  let bucket = mocked.metadataByDbPath.get(dbPath);
  if (!bucket) {
    bucket = new Map<string, string>();
    mocked.metadataByDbPath.set(dbPath, bucket);
  }
  return bucket;
}

function makeSkillEnablementKey(skillRef: string, tool: string): string {
  return `${skillRef}:${tool}`;
}

function getSkillEnablementBucket(dbPath: string): Map<string, boolean> {
  let bucket = mocked.skillEnablementByDbPath.get(dbPath);
  if (!bucket) {
    bucket = new Map<string, boolean>();
    mocked.skillEnablementByDbPath.set(dbPath, bucket);
  }
  return bucket;
}

function makeConfigRecord(
  key: string,
  value: string | null,
  storage: 'db' | 'keychain_ref',
  source: 'user' = 'user',
): MockConfigRecord {
  return {
    key,
    value,
    storage,
    source,
    updatedAt: new Date().toISOString(),
  };
}

vi.mock('../server/daemon.js', () => ({
  getServerStatus: mocked.getServerStatus,
  getPidFilePath: mocked.getPidFilePath,
  startDaemon: mocked.startDaemon,
  stopDaemon: mocked.stopDaemon,
}));

vi.mock('./app.js', () => ({
  renderApp: mocked.renderApp,
}));

vi.mock('./db.js', () => ({
  DashboardDb: class DashboardDbMock {
    private readonly dbPath: string;
    readonly config: {
      transaction: <T>(fn: () => T) => T;
      list: () => MockConfigRecord[];
      get: (key: string) => MockConfigRecord | null;
      setDbValue: (key: string, value: string, source?: 'user') => void;
      setKeychainRef: (key: string, source?: 'user') => void;
      delete: (key: string) => void;
      getMetadata: (key: string) => string | null;
      setMetadata: (key: string, value: string) => void;
      deleteMetadata: (key: string) => void;
    };
    readonly skillEnablement: {
      getEnabled: (skillRef: string, tool: string) => boolean | null;
      set: (skillRef: string, tool: string, enabled: boolean) => void;
    };

    constructor(dbPath: string) {
      this.dbPath = dbPath;
      mocked.dbCtor(dbPath);
      this.config = {
        transaction: <T>(fn: () => T): T => fn(),
        list: () =>
          [...getConfigBucket(this.dbPath).values()].sort((left, right) =>
            left.key.localeCompare(right.key),
          ),
        get: (key: string) => getConfigBucket(this.dbPath).get(key) ?? null,
        setDbValue: (key: string, value: string, source: 'user' = 'user') => {
          getConfigBucket(this.dbPath).set(key, makeConfigRecord(key, value, 'db', source));
        },
        setKeychainRef: (key: string, source: 'user' = 'user') => {
          getConfigBucket(this.dbPath).set(
            key,
            makeConfigRecord(key, null, 'keychain_ref', source),
          );
        },
        delete: (key: string) => {
          getConfigBucket(this.dbPath).delete(key);
        },
        getMetadata: (key: string) => getMetadataBucket(this.dbPath).get(key) ?? null,
        setMetadata: (key: string, value: string) => {
          getMetadataBucket(this.dbPath).set(key, value);
        },
        deleteMetadata: (key: string) => {
          getMetadataBucket(this.dbPath).delete(key);
        },
      };
      this.skillEnablement = {
        getEnabled: (skillRef: string, tool: string) =>
          getSkillEnablementBucket(this.dbPath).get(makeSkillEnablementKey(skillRef, tool)) ?? null,
        set: (skillRef: string, tool: string, enabled: boolean) => {
          getSkillEnablementBucket(this.dbPath).set(
            makeSkillEnablementKey(skillRef, tool),
            enabled,
          );
        },
      };
    }

    listSessions() {
      return mocked.listSessions();
    }

    listSessionsByTool(tool: string) {
      return mocked.listSessionsByTool(tool);
    }

    getOverviewStats() {
      return mocked.getOverviewStats();
    }

    getChartData() {
      return mocked.getChartData();
    }

    getSessionToolState(sessionId: string) {
      return mocked.getSessionToolState(sessionId);
    }

    getNewMessages(sessionKey: string, afterId: number) {
      return mocked.getNewMessages(sessionKey, afterId);
    }

    getMessages(sessionKey: string, limit: number, before?: number) {
      return mocked.getMessages(sessionKey, limit, before);
    }

    getSessionAudit(sessionId: string) {
      return mocked.getSessionAudit(sessionId);
    }

    listDevAliases() {
      return mocked.listDevAliases();
    }

    getDevAlias(name: string) {
      return mocked.getDevAlias(name);
    }

    getAuditByWorkdir(workdir: string) {
      return mocked.getAuditByWorkdir(workdir);
    }

    createDevAlias(
      name: string,
      aliasPath: string,
      tool: string,
      instructionContent: string | null,
    ) {
      return mocked.createDevAlias(name, aliasPath, tool, instructionContent);
    }

    updateDevAlias(
      name: string,
      updates: { path?: string; tool?: string; instructionContent?: string | null },
    ) {
      return mocked.updateDevAlias(name, updates);
    }

    deleteDevAlias(name: string) {
      return mocked.deleteDevAlias(name);
    }

    clearSessionDevAlias(name: string) {
      return mocked.clearSessionDevAlias(name);
    }

    getSparklineData() {
      return mocked.getSparklineData();
    }

    close() {
      mocked.dbClose();
    }
  },
}));

class MockRequest extends EventEmitter {
  public method: string;
  public url?: string;
  public headers: IncomingHttpHeaders;
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

interface InvokeOptions {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

async function invoke(
  server: Server,
  options: InvokeOptions,
): Promise<{ status: number; body: unknown; headers: Record<string, string | string[]> }> {
  const req = new MockRequest(options.method, options.path, options.headers);
  const res = new MockResponse();
  server.emit('request', req as never, res as unknown as ServerResponse);
  // Allow async handler chain to drain microtasks before emitting body events
  await new Promise((r) => setTimeout(r, 0));

  if (options.body !== undefined) {
    req.emit('data', Buffer.from(options.body));
  }
  req.emit('end');

  await res.done;

  let parsed: unknown = res.body;
  const contentType = String(res.headers['content-type'] ?? '');
  if (contentType.includes('application/json') && res.body) {
    parsed = JSON.parse(res.body);
  }
  return { status: res.statusCode, body: parsed, headers: res.headers };
}

async function invokeRaw(
  server: Server,
  req: MockRequest,
  res: MockResponse,
): Promise<{ status: number; body: unknown; headers: Record<string, string | string[]> }> {
  server.emit('request', req as never, res as unknown as ServerResponse);
  await res.done;
  let parsed: unknown = res.body;
  const contentType = String(res.headers['content-type'] ?? '');
  if (contentType.includes('application/json') && res.body) {
    parsed = JSON.parse(res.body);
  }
  return { status: res.statusCode, body: parsed, headers: res.headers };
}

const tempDirs: string[] = [];
const servers: Server[] = [];
let listenSpy: ReturnType<typeof vi.fn>;
let testKeychainValues = new Map<string, string>();
let savedKnownEnv: Record<string, string | undefined> = {};

function seedLegacySettings(dataDir: string, envContent = ''): void {
  const configBucket = getConfigBucket(getDbPathForDataDir(dataDir));
  configBucket.clear();
  if (!envContent) return;

  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();

    if (SECURE_STORE_KEYS.has(key)) {
      testKeychainValues.set(key, value);
      configBucket.set(key, makeConfigRecord(key, null, 'keychain_ref'));
      continue;
    }

    if (PERSISTED_CONFIG_KEYS.has(key)) {
      configBucket.set(key, makeConfigRecord(key, value, 'db'));
    }
  }
}

function getStoredSettingValue(dataDir: string, key: string): string | null {
  const record = getConfigBucket(getDbPathForDataDir(dataDir)).get(key);
  if (record?.storage === 'db') {
    return record.value;
  }
  if (SECURE_STORE_KEYS.has(key)) {
    return testKeychainValues.get(key) ?? null;
  }
  return null;
}

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

// Prevent tests from reading the real OS keychain
beforeEach(() => {
  savedKnownEnv = {};
  for (const key of Object.keys(ENV_REGISTRY)) {
    savedKnownEnv[key] = process.env[key];
    delete process.env[key];
  }

  testKeychainValues = new Map<string, string>();
  const inMemoryKeychain: KeychainProvider = {
    platform: 'test',
    isAvailable: async () => true,
    getPassword: async (key) => testKeychainValues.get(key) ?? null,
    setPassword: async (key, value) => {
      testKeychainValues.set(key, value);
    },
    deletePassword: async (key) => testKeychainValues.delete(key),
    listKeys: async () => [...testKeychainValues.keys()],
  };
  setKeychainProvider(inMemoryKeychain);
});

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.emit('close');
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(savedKnownEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  savedKnownEnv = {};
  testKeychainValues.clear();
  mocked.configRecordsByDbPath.clear();
  mocked.metadataByDbPath.clear();
  mocked.skillEnablementByDbPath.clear();

  mocked.getServerStatus.mockReset();
  mocked.getServerStatus.mockReturnValue({
    running: true,
    pid: 12345,
    pidFile: '/tmp/huskygate.pid',
  });
  mocked.getPidFilePath.mockReset();
  mocked.getPidFilePath.mockReturnValue('/tmp/huskygate.pid');
  mocked.startDaemon.mockReset();
  mocked.startDaemon.mockReturnValue({ pid: 12346 });
  mocked.stopDaemon.mockReset();
  mocked.stopDaemon.mockReturnValue({ pid: 12345 });
  mocked.renderApp.mockReset();
  mocked.renderApp.mockReturnValue('<!DOCTYPE html><html><body>dashboard</body></html>');
  mocked.dbCtor.mockReset();
  mocked.dbClose.mockReset();
  mocked.listSessions.mockReset();
  mocked.listSessions.mockReturnValue([]);
  mocked.listSessionsByTool.mockReset();
  mocked.listSessionsByTool.mockReturnValue([]);
  mocked.getOverviewStats.mockReset();
  mocked.getOverviewStats.mockReturnValue({});
  mocked.getSessionToolState.mockReset();
  mocked.getSessionToolState.mockReturnValue(null);
  mocked.getNewMessages.mockReset();
  mocked.getNewMessages.mockReturnValue([]);
  mocked.getMessages.mockReset();
  mocked.getMessages.mockReturnValue([]);
  mocked.getSessionAudit.mockReset();
  mocked.getSessionAudit.mockReturnValue([]);
  mocked.listDevAliases.mockReset();
  mocked.listDevAliases.mockReturnValue([]);
  mocked.getDevAlias.mockReset();
  mocked.getDevAlias.mockReturnValue(null);
  mocked.getAuditByWorkdir.mockReset();
  mocked.getAuditByWorkdir.mockReturnValue([]);
  mocked.createDevAlias.mockReset();
  mocked.updateDevAlias.mockReset();
  mocked.updateDevAlias.mockReturnValue(null);
  mocked.deleteDevAlias.mockReset();
  mocked.deleteDevAlias.mockReturnValue(false);
  mocked.clearSessionDevAlias.mockReset();
  mocked.fetchMock.mockReset();
});

function createTestServer(
  envContent = '',
  opts?: { dashboardBootstrapToken?: string },
): {
  server: Server;
  envFilePath: string;
  dataDir: string;
} {
  const tempDir = mkdtempSync(join(tmpdir(), 'dashboard-server-test-'));
  tempDirs.push(tempDir);
  const envFilePath = join(tempDir, '.env');
  writeFileSync(envFilePath, envContent, 'utf-8');
  seedLegacySettings(tempDir, envContent);

  const server = createDashboardServer({
    port: 0,
    version: 'test-version',
    dataDir: tempDir,
    serverApiPort: 3738,
    serverApiSecret: 'server-api-secret',
    dashboardSecret: 'dashboard-secret',
    dashboardBootstrapToken: opts?.dashboardBootstrapToken,
    workdirRoot: tempDir,
  });
  servers.push(server);

  return { server, envFilePath, dataDir: tempDir };
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    cookie: 'hg_session=dashboard-secret',
    'x-csrf-protection': '1',
    ...extra,
  };
}

describe('createDashboardServer', () => {
  it('rejects root access without token or auth cookie', async () => {
    const { server } = createTestServer();
    const res = await invoke(server, { method: 'GET', path: '/' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: 'Unauthorized. Open dashboard via CLI: npx huskygate dashboard start',
    });
  });

  it('rejects legacy query-token login flow', async () => {
    const { server } = createTestServer();
    const res = await invoke(server, { method: 'GET', path: '/?token=dashboard-secret' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: 'Unauthorized. Open dashboard via CLI: npx huskygate dashboard start',
    });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('serves /auth bootstrap page without auth cookie', async () => {
    const { server } = createTestServer();
    const res = await invoke(server, { method: 'GET', path: '/auth' });
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/html');
    expect(String(res.headers['cache-control'])).toBe('no-store');
    expect(String(res.body)).toContain('/api/auth/bootstrap');
  });

  it('exchanges bootstrap token for dashboard cookie', async () => {
    const { server } = createTestServer('', { dashboardBootstrapToken: 'bootstrap-token' });
    const res = await invoke(server, {
      method: 'POST',
      path: '/api/auth/bootstrap',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'bootstrap-token' }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(String(res.headers['set-cookie'])).toContain('hg_session=dashboard-secret');
  });

  it('consumes bootstrap token only once', async () => {
    const { server } = createTestServer('', { dashboardBootstrapToken: 'bootstrap-token' });
    const first = await invoke(server, {
      method: 'POST',
      path: '/api/auth/bootstrap',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'bootstrap-token' }),
    });
    expect(first.status).toBe(200);

    const second = await invoke(server, {
      method: 'POST',
      path: '/api/auth/bootstrap',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'bootstrap-token' }),
    });
    expect(second.status).toBe(401);
  });

  it('rejects invalid bootstrap token', async () => {
    const { server } = createTestServer('', { dashboardBootstrapToken: 'bootstrap-token' });
    const res = await invoke(server, {
      method: 'POST',
      path: '/api/auth/bootstrap',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'wrong' }),
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('rejects bootstrap exchange when bootstrap token is not configured', async () => {
    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'POST',
      path: '/api/auth/bootstrap',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'dashboard-secret' }),
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('still calls timing-safe comparison when bootstrap token is not configured', async () => {
    const compareSpy = vi.spyOn(security, 'timingSafeEqualString');
    try {
      const { server } = createTestServer();
      const res = await invoke(server, {
        method: 'POST',
        path: '/api/auth/bootstrap',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'bootstrap-token' }),
      });
      expect(res.status).toBe(401);
      expect(compareSpy).toHaveBeenCalledWith('bootstrap-token', '');
    } finally {
      compareSpy.mockRestore();
    }
  });

  it('does not pass dashboardSecret to renderApp', async () => {
    const { server } = createTestServer(
      'SLACK_BOT_TOKEN=xoxb-test-token\nSLACK_APP_TOKEN=xapp-test-token',
    );
    await invoke(server, { method: 'GET', path: '/', headers: authHeaders() });
    expect(mocked.renderApp).toHaveBeenCalledWith({ version: 'test-version' });
  });

  it('sets Cache-Control no-store on HTML responses', async () => {
    const { server } = createTestServer(
      'SLACK_BOT_TOKEN=xoxb-test-token\nSLACK_APP_TOKEN=xapp-test-token',
    );
    const res = await invoke(server, { method: 'GET', path: '/', headers: authHeaders() });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('requires cookie auth for /api/* endpoints', async () => {
    const { server } = createTestServer();
    const res = await invoke(server, { method: 'GET', path: '/api/status' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('rejects API requests with only X-HG-Token header (cookie required)', async () => {
    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/status',
      headers: { 'x-hg-token': 'dashboard-secret' },
    });
    expect(res.status).toBe(401);
  });

  it('returns server status summary for authenticated /api/status', async () => {
    mocked.listSessions.mockReturnValue([
      { active: true, sessionId: '11111111', tool: 'claude' },
      { active: false, sessionId: '22222222', tool: 'gemini' },
    ]);
    mocked.getOverviewStats.mockReturnValue({ jobs24h: 9, errors24h: 2 });
    mocked.fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', mocked.fetchMock as never);

    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/status',
      headers: authHeaders(),
    });
    const body = res.body as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.running).toBe(true);
    expect(body.serverApiOnline).toBe(true);
    expect(body.sessionCount).toBe(2);
    expect(body.activeSessionCount).toBe(1);
    expect(body.appSessionStats).toEqual({
      claude: { total: 1, active: 1 },
      codex: { total: 0, active: 0 },
      gemini: { total: 1, active: 0 },
    });
    expect(body.jobs24h).toBe(9);
    expect(body.errors24h).toBe(2);
    expect(body.chartData).toBeDefined();
    expect(body.chartData).toMatchObject({
      successRateRange: 100,
      totalRange: 0,
    });
  });

  it('includes chartData with custom values in /api/status', async () => {
    mocked.listSessions.mockReturnValue([]);
    mocked.getOverviewStats.mockReturnValue({});
    mocked.getChartData.mockReturnValue({
      dailyJobs: [{ date: '2026-01-10', tool: 'claude', total: 5, errors: 1 }],
      successRateRange: 90,
      totalRange: 50,
    });
    mocked.fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', mocked.fetchMock as never);

    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/status',
      headers: authHeaders(),
    });
    const body = res.body as Record<string, unknown>;
    expect(res.status).toBe(200);
    const cd = body.chartData as Record<string, unknown>;
    expect(cd.successRateRange).toBe(90);
    expect(cd.totalRange).toBe(50);
    // dailyJobs is stripped from /api/status response (migrated to /api/metrics)
    expect(cd.dailyJobs).toBeUndefined();
  });

  it('includes sparklines in /api/status response', async () => {
    mocked.listSessions.mockReturnValue([]);
    mocked.getOverviewStats.mockReturnValue({});
    mocked.getSparklineData.mockReturnValue({
      sessions: [1, 2, 3, 4, 5, 3, 2],
      jobs: [10, 12, 8, 15, 20, 18, 14],
      successRate: [100, 90, 95, 85, 100, 100, 92],
      errors: [0, 1, 0, 2, 0, 0, 1],
    });
    mocked.fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', mocked.fetchMock as never);

    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/status',
      headers: authHeaders(),
    });
    const body = res.body as Record<string, unknown>;
    expect(res.status).toBe(200);
    const sp = body.sparklines as {
      sessions: number[];
      jobs: number[];
      successRate: number[];
      errors: number[];
    };
    expect(sp).toBeDefined();
    expect(sp.sessions).toHaveLength(7);
    expect(sp.jobs).toHaveLength(7);
    expect(sp.successRate).toHaveLength(7);
    expect(sp.errors).toHaveLength(7);
    expect(sp.sessions).toEqual([1, 2, 3, 4, 5, 3, 2]);
    expect(sp.errors).toEqual([0, 1, 0, 2, 0, 0, 1]);
  });

  it('returns default sparklines when getSparklineData throws', async () => {
    mocked.listSessions.mockReturnValue([]);
    mocked.getOverviewStats.mockReturnValue({});
    mocked.getSparklineData.mockImplementation(() => {
      throw new Error('DB not ready');
    });
    mocked.fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', mocked.fetchMock as never);

    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/status',
      headers: authHeaders(),
    });
    const body = res.body as Record<string, unknown>;
    expect(res.status).toBe(200);
    const sp = body.sparklines as {
      sessions: number[];
      jobs: number[];
      successRate: number[];
      errors: number[];
    };
    expect(sp).toEqual({ sessions: [], jobs: [], successRate: [], errors: [] });
  });

  it('masks sensitive values in /api/settings response', async () => {
    const { server } = createTestServer(
      'SLACK_BOT_TOKEN=xoxb-secret\nMAX_CONCURRENCY=2\n# comment\n',
    );
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/settings',
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    const body = res.body as {
      entries: Array<{ key: string; value: string; masked: boolean }>;
    };
    expect(body.entries).toContainEqual(
      expect.objectContaining({ key: 'SLACK_BOT_TOKEN', value: '***', masked: true }),
    );
    expect(body.entries).toContainEqual(
      expect.objectContaining({ key: 'MAX_CONCURRENCY', value: '2', masked: false }),
    );
  });

  it('ignores malformed .env lines without "=" when reading settings', async () => {
    const { server } = createTestServer('MALFORMED_LINE\nMAX_CONCURRENCY=2\n');
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/settings',
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    const body = res.body as { entries: Array<Record<string, unknown>> };
    expect(body.entries.find((entry) => entry.key === 'MAX_CONCURRENCY')).toMatchObject({
      key: 'MAX_CONCURRENCY',
      value: '2',
      masked: false,
    });
    expect(body.entries.some((entry) => entry.key === 'MALFORMED_LINE')).toBe(false);
  });

  it('rejects unknown keys in PUT /api/settings', async () => {
    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'PUT',
      path: '/api/settings',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        patches: [{ key: 'NOT_A_REAL_KEY', op: 'set', value: 'x' }],
      }),
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Key 'NOT_A_REAL_KEY' is not editable",
    });
  });

  it('rejects legacy skill enablement keys in PUT /api/settings', async () => {
    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'PUT',
      path: '/api/settings',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        patches: [{ key: 'PLAYWRIGHT_SKILL_ENABLED_CLAUDE', op: 'set', value: 'true' }],
      }),
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Key 'PLAYWRIGHT_SKILL_ENABLED_CLAUDE' is not editable",
    });
  });

  it('updates known keys and keeps masked sensitive values unchanged', async () => {
    const { server, dataDir } = createTestServer(
      'SLACK_BOT_TOKEN=xoxb-existing\nMAX_CONCURRENCY=2\n',
    );
    const res = await invoke(server, {
      method: 'PUT',
      path: '/api/settings',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        patches: [
          { key: 'SLACK_BOT_TOKEN', op: 'noop' },
          { key: 'MAX_CONCURRENCY', op: 'set', value: '4' },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = res.body as { success: boolean; applied: unknown[]; requiresRestart: unknown[] };
    expect(body.success).toBe(true);
    // hot-reload fields are present (may be empty arrays if server API is not running)
    expect(Array.isArray(body.applied)).toBe(true);
    expect(Array.isArray(body.requiresRestart)).toBe(true);
    expect(getStoredSettingValue(dataDir, 'SLACK_BOT_TOKEN')).toBe('xoxb-existing');
    expect(getStoredSettingValue(dataDir, 'MAX_CONCURRENCY')).toBe('4');
  });

  it('serves root HTML with auth cookie and returns 404 for unknown route', async () => {
    const { server } = createTestServer(
      'SLACK_BOT_TOKEN=xoxb-test-token\nSLACK_APP_TOKEN=xapp-test-token',
    );
    const rootRes = await invoke(server, { method: 'GET', path: '/', headers: authHeaders() });
    expect(rootRes.status).toBe(200);
    expect(String(rootRes.body)).toContain('dashboard');

    const res404 = await invoke(server, {
      method: 'GET',
      path: '/not-found',
      headers: authHeaders(),
    });
    expect(res404.status).toBe(404);
    expect(res404.body).toEqual({ error: 'Not Found' });
  });

  it('rejects root with unrelated cookie value', async () => {
    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'GET',
      path: '/',
      headers: { cookie: 'other=value' },
    });
    expect(res.status).toBe(401);
  });

  it('redirects root to /setup when unconfigured', async () => {
    const { server } = createTestServer();
    const res = await invoke(server, { method: 'GET', path: '/', headers: authHeaders() });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/setup');
  });

  it('does not redirect root when setup is complete', async () => {
    const { server } = createTestServer(
      'SLACK_BOT_TOKEN=xoxb-test-token\nSLACK_APP_TOKEN=xapp-test-token',
    );
    const res = await invoke(server, { method: 'GET', path: '/', headers: authHeaders() });
    expect(res.status).toBe(200);
    expect(String(res.body)).toContain('dashboard');
  });

  it('serves setup page at GET /setup with auth', async () => {
    const { server } = createTestServer();
    const res = await invoke(server, { method: 'GET', path: '/setup', headers: authHeaders() });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
  });

  it('rejects GET /setup without auth', async () => {
    const { server } = createTestServer();
    const res = await invoke(server, { method: 'GET', path: '/setup' });
    expect(res.status).toBe(401);
  });

  it('returns setup status at GET /api/setup/status', async () => {
    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/setup/status',
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ complete: false });
  });

  it('handles /api/status when server API and DB are unavailable', async () => {
    mocked.fetchMock.mockRejectedValue(new Error('offline'));
    mocked.listSessions.mockImplementation(() => {
      throw new Error('db unavailable');
    });
    mocked.getOverviewStats.mockImplementation(() => {
      throw new Error('db unavailable');
    });
    vi.stubGlobal('fetch', mocked.fetchMock as never);

    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/status',
      headers: authHeaders(),
    });
    const body = res.body as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.serverApiOnline).toBe(false);
    expect(body.sessionCount).toBe(0);
    expect(body.activeSessionCount).toBe(0);
  });

  it('reuses a single DB connection across requests (lazy singleton)', async () => {
    mocked.fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    mocked.listSessions.mockReturnValue([]);
    vi.stubGlobal('fetch', mocked.fetchMock as never);

    const { server } = createTestServer();
    await invoke(server, {
      method: 'GET',
      path: '/api/status',
      headers: authHeaders(),
    });
    const second = await invoke(server, {
      method: 'GET',
      path: '/api/status',
      headers: authHeaders(),
    });

    expect(second.status).toBe(200);
    // DB constructor called once — connection is reused, not re-opened
    expect(mocked.dbCtor).toHaveBeenCalledTimes(1);
    expect(mocked.dbClose).not.toHaveBeenCalled();
  });

  it('handles daemon start/stop success and error branches', async () => {
    const { server } = createTestServer();

    const startOk = await invoke(server, {
      method: 'POST',
      path: '/api/daemon/start',
      headers: authHeaders(),
    });
    expect(startOk.status).toBe(200);
    expect(startOk.body).toEqual({ success: true, pid: 12346 });

    mocked.startDaemon.mockReturnValue({ error: 'already running' });
    const startNg = await invoke(server, {
      method: 'POST',
      path: '/api/daemon/start',
      headers: authHeaders(),
    });
    expect(startNg.body).toEqual({ success: false, error: 'already running' });

    const stopOk = await invoke(server, {
      method: 'POST',
      path: '/api/daemon/stop',
      headers: authHeaders(),
    });
    expect(stopOk.body).toEqual({ success: true, pid: 12345 });

    mocked.stopDaemon.mockReturnValue({ error: 'not running' });
    const stopNg = await invoke(server, {
      method: 'POST',
      path: '/api/daemon/stop',
      headers: authHeaders(),
    });
    expect(stopNg.body).toEqual({ success: false, error: 'not running' });
  });

  it('handles sessions APIs (list/audit/delete/clear all)', async () => {
    mocked.listSessions.mockReturnValue([{ sessionId: 'abcd1234', active: true }]);
    mocked.getSessionAudit.mockReturnValue([{ action: 'job_start' }]);
    mocked.fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', mocked.fetchMock as never);

    const { server } = createTestServer();
    const listRes = await invoke(server, {
      method: 'GET',
      path: '/api/sessions',
      headers: authHeaders(),
    });
    expect(listRes.status).toBe(200);
    expect(listRes.body).toEqual([{ sessionId: 'abcd1234', active: true }]);

    const auditRes = await invoke(server, {
      method: 'GET',
      path: '/api/sessions/abcd1234/audit',
      headers: authHeaders(),
    });
    expect(auditRes.status).toBe(200);
    expect(auditRes.body).toEqual([{ action: 'job_start' }]);

    const deleteRes = await invoke(server, {
      method: 'DELETE',
      path: '/api/sessions/abcd1234',
      headers: authHeaders(),
    });
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body).toEqual({ ok: true });

    const clearRes = await invoke(server, {
      method: 'DELETE',
      path: '/api/sessions',
      headers: authHeaders(),
    });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body).toEqual({ ok: true });
  });

  it('returns fallback responses when proxy or DB reads fail', async () => {
    mocked.fetchMock.mockRejectedValue(new Error('network down'));
    mocked.listSessions.mockImplementation(() => {
      throw new Error('db read failed');
    });
    vi.stubGlobal('fetch', mocked.fetchMock as never);

    const { server } = createTestServer();
    const sessionsRes = await invoke(server, {
      method: 'GET',
      path: '/api/sessions',
      headers: authHeaders(),
    });
    expect(sessionsRes.status).toBe(200);
    expect(sessionsRes.body).toEqual([]);

    const deleteRes = await invoke(server, {
      method: 'DELETE',
      path: '/api/sessions/abcd1234',
      headers: authHeaders(),
    });
    expect(deleteRes.status).toBe(503);
    expect(deleteRes.body).toEqual({ error: 'Server is not running' });
  });

  it('handles /api/logs with filtering, paging, source switch, and oversized file tail', async () => {
    const { server, dataDir } = createTestServer();
    const logPath = join(dataDir, 'huskygate.log');
    const dashboardLogPath = join(dataDir, 'dashboard.log');

    writeFileSync(
      logPath,
      [
        JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', level: 'info', msg: 'first' }),
        'not-json-line',
        JSON.stringify({ ts: '2026-01-01T00:00:01.000Z', level: 'error', msg: 'second' }),
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(
      dashboardLogPath,
      [
        JSON.stringify({ ts: '2026-01-02T00:00:00.000Z', level: 'info', msg: 'dash-1' }),
        JSON.stringify({ ts: '2026-01-02T00:00:01.000Z', level: 'warn', msg: 'dash-2' }),
      ].join('\n'),
      'utf-8',
    );

    const filtered = await invoke(server, {
      method: 'GET',
      path: '/api/logs?limit=1&offset=0&level=error',
      headers: authHeaders(),
    });
    expect(filtered.status).toBe(200);
    expect(filtered.body).toEqual({
      lines: [{ ts: '2026-01-01T00:00:01.000Z', level: 'error', msg: 'second', source: 'server' }],
      total: 1,
      hasMore: false,
    });

    const paged = await invoke(server, {
      method: 'GET',
      path: '/api/logs?source=dashboard&limit=1&offset=1',
      headers: authHeaders(),
    });
    const pagedBody = paged.body as {
      lines: Array<{ msg: string }>;
      total: number;
      hasMore: boolean;
    };
    expect(pagedBody.total).toBe(2);
    expect(pagedBody.hasMore).toBe(false);
    expect(pagedBody.lines[0]?.msg).toBe('dash-1');

    const huge = `${'x'.repeat(10 * 1024 * 1024)}\n${JSON.stringify({
      ts: '2026-01-03T00:00:00.000Z',
      level: 'info',
      msg: 'tail',
    })}\n`;
    writeFileSync(logPath, huge, 'utf-8');
    const tailed = await invoke(server, {
      method: 'GET',
      path: '/api/logs?limit=5&offset=0',
      headers: authHeaders(),
    });
    const tailedBody = tailed.body as { lines: Array<{ msg: string }> };
    expect(tailedBody.lines[0]?.msg).toBe('tail');
  });

  it('handles log read errors and preserves extra log fields', async () => {
    const { server, dataDir } = createTestServer();
    const logPath = join(dataDir, 'huskygate.log');
    rmSync(logPath, { force: true });
    mkdirSync(logPath);

    const readError = await invoke(server, {
      method: 'GET',
      path: '/api/logs',
      headers: authHeaders(),
    });
    expect(readError.status).toBe(200);
    expect(readError.body).toEqual({ lines: [], total: 0, hasMore: false });

    rmSync(logPath, { recursive: true, force: true });
    writeFileSync(
      logPath,
      `${JSON.stringify({
        ts: '2026-01-04T00:00:00.000Z',
        level: 'info',
        msg: 'with-extra',
        user: 'U1',
      })}\n`,
      'utf-8',
    );
    const withExtra = await invoke(server, {
      method: 'GET',
      path: '/api/logs',
      headers: authHeaders(),
    });
    expect(withExtra.body).toEqual({
      lines: [
        {
          ts: '2026-01-04T00:00:00.000Z',
          level: 'info',
          msg: 'with-extra',
          source: 'server',
          data: { user: 'U1' },
        },
      ],
      total: 1,
      hasMore: false,
    });
  });

  it('validates settings body and handles parse/body errors', async () => {
    const { server } = createTestServer();

    const invalidShape = await invoke(server, {
      method: 'PUT',
      path: '/api/settings',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ entries: 'invalid' }),
    });
    expect(invalidShape.status).toBe(400);
    expect(invalidShape.body).toEqual({ error: 'Invalid body: patches array required' });

    const invalidJson = await invoke(server, {
      method: 'PUT',
      path: '/api/settings',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: '{bad-json',
    });
    expect(invalidJson.status).toBe(400);
    expect(invalidJson.body).toEqual({ error: 'Invalid JSON' });

    const invalidEntryValue = await invoke(server, {
      method: 'PUT',
      path: '/api/settings',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        patches: [{ key: 'MAX_CONCURRENCY', op: 'set', value: '1\nINJECTED=1' }],
      }),
    });
    expect(invalidEntryValue.status).toBe(400);
    expect(invalidEntryValue.body).toEqual({
      error: 'Invalid value for env key: MAX_CONCURRENCY',
    });

    const tooLarge = await invoke(server, {
      method: 'PUT',
      path: '/api/settings',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: 'x'.repeat(70_000),
    });
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body).toEqual({ error: 'Request body too large' });
  });

  it('persists settings even when no legacy env file exists', async () => {
    const { server, envFilePath, dataDir } = createTestServer();
    rmSync(envFilePath, { force: true });
    const res = await invoke(server, {
      method: 'PUT',
      path: '/api/settings',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        patches: [
          { key: 'MAX_CONCURRENCY', op: 'set', value: '5' },
          { key: 'SLACK_BOT_TOKEN', op: 'noop' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(getStoredSettingValue(dataDir, 'MAX_CONCURRENCY')).toBe('5');
    expect(getStoredSettingValue(dataDir, 'SLACK_BOT_TOKEN')).toBeNull();
  });

  it('updates persisted settings independently of malformed legacy env content', async () => {
    const { server, dataDir } = createTestServer('MAX_CONCURRENCY=2\nMALFORMED\n');
    const res = await invoke(server, {
      method: 'PUT',
      path: '/api/settings',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        patches: [
          { key: 'MAX_CONCURRENCY', op: 'set', value: '3' },
          { key: 'DEFAULT_TOOL', op: 'set', value: 'gemini' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(getStoredSettingValue(dataDir, 'MAX_CONCURRENCY')).toBe('3');
    expect(getStoredSettingValue(dataDir, 'DEFAULT_TOOL')).toBe('gemini');
  });

  it('handles chat session list/create and message APIs', async () => {
    mocked.listSessions.mockReturnValue([{ sessionId: 'abcd1234' }]);
    mocked.listSessionsByTool.mockReturnValue([{ sessionId: 'abcd1234', tool: 'claude' }]);
    mocked.getSessionToolState
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ sessionKey: 'sess_1' })
      .mockReturnValueOnce({ sessionKey: 'sess_1' });
    mocked.getNewMessages.mockReturnValue([{ id: 2, role: 'assistant' }]);
    mocked.getMessages.mockReturnValue([{ id: 1, role: 'user' }]);
    mocked.fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ sessionId: 'new1' }), { status: 201 }),
    );
    vi.stubGlobal('fetch', mocked.fetchMock as never);

    const { server } = createTestServer();
    const listAll = await invoke(server, {
      method: 'GET',
      path: '/api/chat/sessions',
      headers: authHeaders(),
    });
    expect(listAll.body).toEqual([{ sessionId: 'abcd1234' }]);

    const listTool = await invoke(server, {
      method: 'GET',
      path: '/api/chat/sessions?tool=claude',
      headers: authHeaders(),
    });
    expect(listTool.body).toEqual([{ sessionId: 'abcd1234', tool: 'claude' }]);

    const created = await invoke(server, {
      method: 'POST',
      path: '/api/chat/sessions',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ tool: 'claude' }),
    });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ sessionId: 'new1' });

    const notFoundNew = await invoke(server, {
      method: 'GET',
      path: '/api/chat/abcd1234/messages/new',
      headers: authHeaders(),
    });
    expect(notFoundNew.status).toBe(404);

    const newMessages = await invoke(server, {
      method: 'GET',
      path: '/api/chat/abcd1234/messages/new?after=1',
      headers: authHeaders(),
    });
    expect(newMessages.status).toBe(200);
    expect(newMessages.body).toEqual({ messages: [{ id: 2, role: 'assistant' }] });

    const history = await invoke(server, {
      method: 'GET',
      path: '/api/chat/abcd1234/messages?limit=500&before=9',
      headers: authHeaders(),
    });
    expect(history.status).toBe(200);
    expect(history.body).toEqual({ messages: [{ id: 1, role: 'user' }], hasMore: false });
    expect(mocked.getMessages).toHaveBeenCalledWith('sess_1', 200, 9);
  });

  it('validates chat message query parameters', async () => {
    const { server } = createTestServer();

    const invalidAfter = await invoke(server, {
      method: 'GET',
      path: '/api/chat/abcd1234/messages/new?after=abc',
      headers: authHeaders(),
    });
    expect(invalidAfter.status).toBe(400);
    expect(invalidAfter.body).toEqual({ error: 'Invalid "after" parameter' });

    const invalidBefore = await invoke(server, {
      method: 'GET',
      path: '/api/chat/abcd1234/messages?before=oops',
      headers: authHeaders(),
    });
    expect(invalidBefore.status).toBe(400);
    expect(invalidBefore.body).toEqual({ error: 'Invalid "before" parameter' });
  });

  it('uses default history limit when chat messages limit query is omitted', async () => {
    mocked.getSessionToolState.mockReturnValue({ sessionKey: 'sess_1' });
    mocked.getMessages.mockReturnValue([{ id: 1, role: 'assistant' }]);
    const { server } = createTestServer();

    const res = await invoke(server, {
      method: 'GET',
      path: '/api/chat/abcd1234/messages',
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    expect(mocked.getMessages).toHaveBeenCalledWith('sess_1', 50, undefined);
  });

  it('falls back to default history limit when query limit parses to zero', async () => {
    mocked.getSessionToolState.mockReturnValue({ sessionKey: 'sess_1' });
    mocked.getMessages.mockReturnValue([{ id: 1, role: 'assistant' }]);
    const { server } = createTestServer();

    const res = await invoke(server, {
      method: 'GET',
      path: '/api/chat/abcd1234/messages?limit=0',
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    expect(mocked.getMessages).toHaveBeenCalledWith('sess_1', 50, undefined);
  });

  it('returns 404 for message history when session mapping is missing', async () => {
    mocked.getSessionToolState.mockReturnValue(null);
    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/chat/abcd1234/messages',
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Session not found' });
  });

  it('returns empty chat sessions when DB read fails', async () => {
    mocked.listSessions.mockImplementation(() => {
      throw new Error('db read failed');
    });
    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/chat/sessions',
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('proxies stop-job and SSE chat send with success and error paths', async () => {
    const encoder = new TextEncoder();
    mocked.fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ stopped: true }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('data: hello\n\n'));
              controller.close();
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
      )
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockRejectedValueOnce(new Error('upstream down'));
    vi.stubGlobal('fetch', mocked.fetchMock as never);

    const { server } = createTestServer();
    const stopRes = await invoke(server, {
      method: 'POST',
      path: '/api/jobs/sess_abc123def456/stop',
      headers: authHeaders(),
    });
    expect(stopRes.status).toBe(200);
    expect(stopRes.body).toEqual({ stopped: true });

    const sseOk = await invoke(server, {
      method: 'POST',
      path: '/api/chat/abcd1234/send',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ prompt: 'hi' }),
    });
    expect(sseOk.status).toBe(200);
    expect(String(sseOk.body)).toContain('data: hello');
    expect(sseOk.headers['content-type']).toBe('text/event-stream');

    const sseUpstreamFail = await invoke(server, {
      method: 'POST',
      path: '/api/chat/abcd1234/send',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ prompt: 'hi again' }),
    });
    expect(sseUpstreamFail.status).toBe(502);
    expect(sseUpstreamFail.body).toEqual({ error: 'Server request failed' });

    const sseNetworkFail = await invoke(server, {
      method: 'POST',
      path: '/api/chat/abcd1234/send',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ prompt: 'once more' }),
    });
    expect(sseNetworkFail.status).toBe(503);
    expect(sseNetworkFail.body).toEqual({ error: 'Server is not running' });
  });

  it('proxies session-id stop endpoint for chat retry cancellation', async () => {
    mocked.fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', mocked.fetchMock as never);

    const { server } = createTestServer();
    const stopRes = await invoke(server, {
      method: 'POST',
      path: '/api/chat/abcd1234/stop',
      headers: authHeaders(),
    });
    expect(stopRes.status).toBe(200);
    expect(stopRes.body).toEqual({ success: true });
  });

  it('proxies tool-approval POST and job-stream GET endpoints', async () => {
    const encoder = new TextEncoder();
    mocked.fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, decision: 'approved' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('data: replay\n\n'));
              controller.close();
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
      )
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', mocked.fetchMock as never);

    const { server } = createTestServer();
    const approval = await invoke(server, {
      method: 'POST',
      path: '/api/chat/abcd1234/tool-approval',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ decision: 'approve', requestId: 'req-1' }),
    });
    expect(approval.status).toBe(200);
    expect(approval.body).toEqual({ success: true, decision: 'approved' });

    const streamOk = await invoke(server, {
      method: 'GET',
      path: '/api/chat/abcd1234/job-stream/deadbeef',
      headers: authHeaders(),
    });
    expect(streamOk.status).toBe(200);
    expect(streamOk.headers['content-type']).toBe('text/event-stream');
    expect(String(streamOk.body)).toContain('data: replay');

    const streamUpstreamFail = await invoke(server, {
      method: 'GET',
      path: '/api/chat/abcd1234/job-stream/deadbeef',
      headers: authHeaders(),
    });
    expect(streamUpstreamFail.status).toBe(502);
    expect(streamUpstreamFail.body).toEqual({ error: 'Server request failed' });

    const streamNetworkFail = await invoke(server, {
      method: 'GET',
      path: '/api/chat/abcd1234/job-stream/deadbeef',
      headers: authHeaders(),
    });
    expect(streamNetworkFail.status).toBe(503);
    expect(streamNetworkFail.body).toEqual({ error: 'Server is not running' });
  });

  it('covers GET job-stream close/cancel and stream-read error paths', async () => {
    const encoder = new TextEncoder();
    mocked.fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          getReader() {
            let cancelled = false;
            let emitted = false;
            return {
              read: async () => {
                if (!emitted) {
                  emitted = true;
                  return { done: false, value: encoder.encode('data: keep-open\n\n') };
                }
                return await new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => {
                  const timer = setInterval(() => {
                    if (cancelled) {
                      clearInterval(timer);
                      resolve({ done: true });
                    }
                  }, 1);
                });
              },
              cancel: async () => {
                cancelled = true;
                throw new Error('cancel failed');
              },
            };
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          getReader() {
            return {
              read: async () => {
                throw new Error('stream read failed');
              },
              cancel: async () => undefined,
            };
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          getReader() {
            throw new Error('reader init failed');
          },
        },
      });
    vi.stubGlobal('fetch', mocked.fetchMock as never);

    const { server } = createTestServer();
    const req1 = new MockRequest('GET', '/api/chat/abcd1234/job-stream/deadbeef', authHeaders());
    const res1 = new MockResponse();
    const done1 = invokeRaw(server, req1, res1);
    setTimeout(() => req1.emit('close'), 0);
    const closePath = await done1;
    expect(closePath.status).toBe(200);
    expect(String(closePath.body)).toContain('data: keep-open');

    const readErrorPath = await invoke(server, {
      method: 'GET',
      path: '/api/chat/abcd1234/job-stream/deadbeef',
      headers: authHeaders(),
    });
    expect(readErrorPath.status).toBe(200);

    const readerInitError = await invoke(server, {
      method: 'GET',
      path: '/api/chat/abcd1234/job-stream/deadbeef',
      headers: authHeaders(),
    });
    expect(readerInitError.status).toBe(200);
  });

  it('covers SSE close/cancel and stream-read error paths', async () => {
    const encoder = new TextEncoder();
    mocked.fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          getReader() {
            let cancelled = false;
            let emitted = false;
            return {
              read: async () => {
                if (!emitted) {
                  emitted = true;
                  return { done: false, value: encoder.encode('data: keep-open\n\n') };
                }
                return await new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => {
                  const timer = setInterval(() => {
                    if (cancelled) {
                      clearInterval(timer);
                      resolve({ done: true });
                    }
                  }, 1);
                });
              },
              cancel: async () => {
                cancelled = true;
                throw new Error('cancel failed');
              },
            };
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          getReader() {
            return {
              read: async () => {
                throw new Error('stream read failed');
              },
              cancel: async () => undefined,
            };
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          getReader() {
            throw new Error('reader init failed');
          },
        },
      });
    vi.stubGlobal('fetch', mocked.fetchMock as never);

    const { server } = createTestServer();

    const req1 = new MockRequest('POST', '/api/chat/abcd1234/send', authHeaders());
    const res1 = new MockResponse();
    const done1 = invokeRaw(server, req1, res1);
    await new Promise((r) => setTimeout(r, 0));
    req1.emit('data', Buffer.from('{}'));
    req1.emit('end');
    setTimeout(() => req1.emit('close'), 0);
    const closePath = await done1;
    expect(closePath.status).toBe(200);
    expect(String(closePath.body)).toContain('data: keep-open');

    const readErrorPath = await invoke(server, {
      method: 'POST',
      path: '/api/chat/abcd1234/send',
      headers: authHeaders(),
      body: '{}',
    });
    expect(readErrorPath.status).toBe(200);

    const readerInitError = await invoke(server, {
      method: 'POST',
      path: '/api/chat/abcd1234/send',
      headers: authHeaders(),
      body: '{}',
    });
    expect(readerInitError.status).toBe(200);
    expect(String(readerInitError.body)).toContain('');
  });

  it('handles request stream error while reading body', async () => {
    const { server } = createTestServer();
    const req = new MockRequest(
      'PUT',
      '/api/settings',
      authHeaders({ 'content-type': 'application/json' }),
    );
    const res = new MockResponse();
    const request = invokeRaw(server, req, res);
    await new Promise((r) => setTimeout(r, 0));
    req.emit('error', new Error('stream failed'));
    const result = await request;
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Internal server error' });
  });

  it('handles dev aliases list/audit/create/update/delete endpoints', async () => {
    mocked.listDevAliases.mockReturnValue([
      { name: 'dev1', path: '/tmp/work1', tool: 'claude' },
      { name: 'dev2', path: '/tmp/work2', tool: 'codex' },
    ]);
    mocked.getDevAlias.mockImplementation((name?: string) => {
      if (name === 'dev1') return { name: 'dev1', path: '/tmp/work1', tool: 'claude' };
      if (name === 'dev2') return { name: 'dev2', path: '/tmp/work2', tool: 'codex' };
      return null;
    });
    mocked.getAuditByWorkdir.mockReturnValue([
      { startedAt: '2026-01-01T00:00:00.000Z', errorKind: null },
      { startedAt: '2025-12-31T00:00:00.000Z', errorKind: 'exit_1' },
    ]);
    mocked.createDevAlias.mockReturnValue({
      name: 'dev3',
      path: '/tmp/work3',
      tool: 'gemini',
      instructionContent: null,
    });
    mocked.updateDevAlias.mockReturnValue({
      name: 'dev1',
      path: '/tmp/work1',
      tool: 'claude',
      instructionContent: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    mocked.deleteDevAlias.mockReturnValue(true);

    const { server, dataDir } = createTestServer();
    const createdDir = join(dataDir, 'created');
    const existingFile = join(dataDir, 'not-dir.txt');
    writeFileSync(existingFile, 'x', 'utf-8');

    const listRes = await invoke(server, {
      method: 'GET',
      path: '/api/dev-aliases',
      headers: authHeaders(),
    });
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(2);

    const missingAudit = await invoke(server, {
      method: 'GET',
      path: '/api/dev-aliases/notfound/audit',
      headers: authHeaders(),
    });
    expect(missingAudit.status).toBe(404);
    expect(missingAudit.body).toEqual({ error: 'Alias not found' });

    const auditRes = await invoke(server, {
      method: 'GET',
      path: '/api/dev-aliases/dev1/audit',
      headers: authHeaders(),
    });
    expect(auditRes.status).toBe(200);
    expect(auditRes.body).toEqual({
      summary: {
        total: 2,
        succeeded: 1,
        failed: 1,
        lastRun: '2026-01-01T00:00:00.000Z',
      },
      jobs: [
        { startedAt: '2026-01-01T00:00:00.000Z', errorKind: null },
        { startedAt: '2025-12-31T00:00:00.000Z', errorKind: 'exit_1' },
      ],
    });

    const invalidCreate = await invoke(server, {
      method: 'POST',
      path: '/api/dev-aliases',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ name: '', path: '' }),
    });
    expect(invalidCreate.status).toBe(400);

    const invalidName = await invoke(server, {
      method: 'POST',
      path: '/api/dev-aliases',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ name: 'bad name', path: createdDir }),
    });
    expect(invalidName.status).toBe(400);

    const invalidTool = await invoke(server, {
      method: 'POST',
      path: '/api/dev-aliases',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ name: 'dev3', path: createdDir, tool: 'bad-tool' }),
    });
    expect(invalidTool.status).toBe(400);

    const blockedPath = await invoke(server, {
      method: 'POST',
      path: '/api/dev-aliases',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ name: 'ok', path: '/etc/passwd' }),
    });
    expect(blockedPath.status).toBe(400);

    const noPath = await invoke(server, {
      method: 'POST',
      path: '/api/dev-aliases',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ name: 'dev3', path: join(dataDir, 'missing') }),
    });
    expect(noPath.status).toBe(400);
    expect((noPath.body as Record<string, unknown>).pathNotFound).toBe(true);

    const notDir = await invoke(server, {
      method: 'POST',
      path: '/api/dev-aliases',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ name: 'dev3', path: existingFile }),
    });
    expect(notDir.status).toBe(400);
    expect((notDir.body as Record<string, unknown>).error).toContain('not a directory');

    const createMkdirFail = await invoke(server, {
      method: 'POST',
      path: '/api/dev-aliases',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        name: 'dev4',
        path: '/dev/null/nope',
        createPath: true,
      }),
    });
    expect(createMkdirFail.status).toBe(400);
    expect((createMkdirFail.body as Record<string, unknown>).error).toContain(
      'Failed to create directory',
    );

    const created = await invoke(server, {
      method: 'POST',
      path: '/api/dev-aliases',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        name: 'dev3',
        path: createdDir,
        tool: 'gemini',
        instructionContent: '  hello  ',
        createPath: true,
      }),
    });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      name: 'dev3',
      path: '/tmp/work3',
      tool: 'gemini',
      instructionContent: null,
    });

    mocked.createDevAlias.mockImplementationOnce(() => {
      throw new Error('UNIQUE constraint failed');
    });
    const duplicate = await invoke(server, {
      method: 'POST',
      path: '/api/dev-aliases',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ name: 'dev3', path: createdDir, tool: 'claude' }),
    });
    expect(duplicate.status).toBe(409);

    mocked.createDevAlias.mockImplementationOnce(() => {
      throw new Error('unexpected create failure');
    });
    const create500 = await invoke(server, {
      method: 'POST',
      path: '/api/dev-aliases',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ name: 'dev5', path: createdDir }),
    });
    expect(create500.status).toBe(500);

    const invalidUpdateTool = await invoke(server, {
      method: 'PUT',
      path: '/api/dev-aliases/dev1',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ tool: 'unknown' }),
    });
    expect(invalidUpdateTool.status).toBe(400);

    const updateMissing = await invoke(server, {
      method: 'PUT',
      path: '/api/dev-aliases/dev1',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ path: join(dataDir, 'still-missing') }),
    });
    expect(updateMissing.status).toBe(400);
    expect((updateMissing.body as Record<string, unknown>).pathNotFound).toBe(true);

    const updateBlocked = await invoke(server, {
      method: 'PUT',
      path: '/api/dev-aliases/dev1',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ path: '/etc/hosts' }),
    });
    expect(updateBlocked.status).toBe(400);

    const updateNotDir = await invoke(server, {
      method: 'PUT',
      path: '/api/dev-aliases/dev1',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ path: existingFile }),
    });
    expect(updateNotDir.status).toBe(400);

    const updateMkdirFail = await invoke(server, {
      method: 'PUT',
      path: '/api/dev-aliases/dev1',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ path: '/dev/null/nope', createPath: true }),
    });
    expect(updateMkdirFail.status).toBe(400);

    const updated = await invoke(server, {
      method: 'PUT',
      path: '/api/dev-aliases/dev1',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        path: createdDir,
        tool: 'codex',
        instructionContent: '  keep this  ',
        createPath: true,
      }),
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toEqual({ success: true });
    expect(mocked.updateDevAlias).toHaveBeenCalledWith('dev1', {
      path: realpathSync(createdDir),
      tool: 'codex',
      instructionContent: 'keep this',
    });

    const updatedNullInstruction = await invoke(server, {
      method: 'PUT',
      path: '/api/dev-aliases/dev1',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        instructionContent: 123,
      }),
    });
    expect(updatedNullInstruction.status).toBe(200);
    expect(mocked.updateDevAlias).toHaveBeenCalledWith('dev1', { instructionContent: null });

    mocked.updateDevAlias.mockReturnValueOnce(null);
    const update404 = await invoke(server, {
      method: 'PUT',
      path: '/api/dev-aliases/ghost',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ tool: 'claude' }),
    });
    expect(update404.status).toBe(404);

    mocked.deleteDevAlias.mockReturnValueOnce(false);
    const delete404 = await invoke(server, {
      method: 'DELETE',
      path: '/api/dev-aliases/ghost',
      headers: authHeaders(),
    });
    expect(delete404.status).toBe(404);

    const deleteOk = await invoke(server, {
      method: 'DELETE',
      path: '/api/dev-aliases/dev1',
      headers: authHeaders(),
    });
    expect(deleteOk.status).toBe(200);
    expect(deleteOk.body).toEqual({ success: true });
  });

  it('returns safe fallbacks when alias list/audit queries throw', async () => {
    mocked.listDevAliases.mockImplementationOnce(() => {
      throw new Error('list failed');
    });
    const { server } = createTestServer();
    const listRes = await invoke(server, {
      method: 'GET',
      path: '/api/dev-aliases',
      headers: authHeaders(),
    });
    expect(listRes.status).toBe(200);
    expect(listRes.body).toEqual([]);

    mocked.getDevAlias.mockReturnValue({ name: 'dev1', path: '/tmp/work1', tool: 'claude' });
    mocked.getAuditByWorkdir.mockImplementationOnce(() => {
      throw new Error('audit failed');
    });
    const auditRes = await invoke(server, {
      method: 'GET',
      path: '/api/dev-aliases/dev1/audit',
      headers: authHeaders(),
    });
    expect(auditRes.status).toBe(200);
    expect(auditRes.body).toEqual({
      summary: { total: 0, succeeded: 0, failed: 0, lastRun: null },
      jobs: [],
    });
  });

  it('falls back to "/" when request URL is undefined', async () => {
    const { server } = createTestServer(
      'SLACK_BOT_TOKEN=xoxb-test-token\nSLACK_APP_TOKEN=xapp-test-token',
    );
    const req = new MockRequest('GET', '/', authHeaders());
    req.url = undefined;
    const res = new MockResponse();

    const result = await invokeRaw(server, req, res);
    expect(result.status).toBe(200);
    expect(String(result.body)).toContain('dashboard');
  });

  it('uses 502 fallback when upstream responds with status 0 for SSE proxy routes', async () => {
    mocked.fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 0,
        body: null,
        text: async () => 'not-json',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 0,
        body: null,
        text: async () => 'not-json',
      });
    vi.stubGlobal('fetch', mocked.fetchMock as never);

    const { server } = createTestServer();
    const sendRes = await invoke(server, {
      method: 'POST',
      path: '/api/chat/abcd1234/send',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: '{}',
    });
    expect(sendRes.status).toBe(502);
    expect(sendRes.body).toEqual({ error: 'Server request failed' });

    const streamRes = await invoke(server, {
      method: 'GET',
      path: '/api/chat/abcd1234/job-stream/deadbeef',
      headers: authHeaders(),
    });
    expect(streamRes.status).toBe(502);
    expect(streamRes.body).toEqual({ error: 'Server request failed' });
  });

  it('breaks SSE proxy loops when response is already ended mid-stream', async () => {
    const encoder = new TextEncoder();
    mocked.fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          getReader() {
            let i = 0;
            return {
              read: async () => {
                i += 1;
                if (i === 1) return { done: false, value: encoder.encode('data: one\n\n') };
                return { done: false, value: encoder.encode('data: two\n\n') };
              },
              cancel: async () => undefined,
            };
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: {
          getReader() {
            let i = 0;
            return {
              read: async () => {
                i += 1;
                if (i === 1) return { done: false, value: encoder.encode('data: one\n\n') };
                return { done: false, value: encoder.encode('data: two\n\n') };
              },
              cancel: async () => undefined,
            };
          },
        },
      });
    vi.stubGlobal('fetch', mocked.fetchMock as never);

    const { server } = createTestServer();

    const req1 = new MockRequest('POST', '/api/chat/abcd1234/send', authHeaders());
    const res1 = new MockResponse();
    let postWrites = 0;
    const baseWrite1 = res1.write.bind(res1);
    res1.write = ((chunk: string) => {
      postWrites += 1;
      const out = baseWrite1(chunk);
      res1.writableEnded = true;
      return out;
    }) as never;
    const pendingPost = invokeRaw(server, req1, res1);
    await new Promise((r) => setTimeout(r, 0));
    req1.emit('data', Buffer.from('{}'));
    req1.emit('end');
    await new Promise((resolve) => setImmediate(resolve));
    expect(postWrites).toBe(1);
    res1.end();
    await pendingPost;

    const req2 = new MockRequest('GET', '/api/chat/abcd1234/job-stream/deadbeef', authHeaders());
    const res2 = new MockResponse();
    let getWrites = 0;
    const baseWrite2 = res2.write.bind(res2);
    res2.write = ((chunk: string) => {
      getWrites += 1;
      const out = baseWrite2(chunk);
      res2.writableEnded = true;
      return out;
    }) as never;
    const pendingGet = invokeRaw(server, req2, res2);
    await new Promise((resolve) => setImmediate(resolve));
    expect(getWrites).toBe(1);
    res2.end();
    await pendingGet;
  });

  it('returns empty logs when file is missing and applies pagination fallbacks', async () => {
    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/logs?limit=0&offset=not-a-number',
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lines: [], total: 0, hasMore: false });
  });

  it('fills default log fields when ts/level/msg are missing', async () => {
    const { server, dataDir } = createTestServer();
    writeFileSync(join(dataDir, 'huskygate.log'), `${JSON.stringify({ user: 'U1' })}\n`, 'utf-8');

    const res = await invoke(server, {
      method: 'GET',
      path: '/api/logs?limit=1',
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      lines: [{ ts: '', level: 'info', msg: '', source: 'server', data: { user: 'U1' } }],
      total: 1,
      hasMore: false,
    });
  });

  it('streams new log lines via SSE on /api/logs/stream', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      const { server, dataDir } = createTestServer();
      const logPath = join(dataDir, 'huskygate.log');
      // Write initial content (should be skipped — tail starts from end)
      writeFileSync(
        logPath,
        `${JSON.stringify({ ts: '2026-01-01T00:00:00Z', level: 'info', msg: 'old' })}\n`,
      );

      const req = new MockRequest('GET', '/api/logs/stream?source=server', authHeaders());
      const res = new MockResponse();
      server.emit('request', req as never, res as unknown as ServerResponse);
      // Let handler set up (synchronous, but let microtasks drain)
      await vi.advanceTimersByTimeAsync(0);

      // Verify SSE headers
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/event-stream');

      // Append new log line
      const { appendFileSync } = await import('node:fs');
      appendFileSync(
        logPath,
        `${JSON.stringify({ ts: '2026-01-02T00:00:00Z', level: 'warn', msg: 'new-line' })}\n`,
      );

      // Advance past poll interval (2s)
      await vi.advanceTimersByTimeAsync(2500);

      // Should have received SSE data
      expect(res.body).toContain('data: ');
      expect(res.body).toContain('"msg":"new-line"');
      expect(res.body).toContain('"source":"server"');

      // Simulate client disconnect
      res.emit('close');

      // Append another line after disconnect
      appendFileSync(
        logPath,
        `${JSON.stringify({ ts: '2026-01-03T00:00:00Z', level: 'info', msg: 'after-close' })}\n`,
      );
      await vi.advanceTimersByTimeAsync(2500);

      // Should NOT contain the post-disconnect line
      expect(res.body).not.toContain('after-close');
    } finally {
      vi.useRealTimers();
    }
  });

  it('streams merged logs from both files on /api/logs/stream with source=all', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      const { server, dataDir } = createTestServer();
      const logPath = join(dataDir, 'huskygate.log');
      const dashLogPath = join(dataDir, 'dashboard.log');
      writeFileSync(logPath, '');
      writeFileSync(dashLogPath, '');

      const req = new MockRequest('GET', '/api/logs/stream', authHeaders());
      const res = new MockResponse();
      server.emit('request', req as never, res as unknown as ServerResponse);
      await vi.advanceTimersByTimeAsync(0);

      const { appendFileSync } = await import('node:fs');
      appendFileSync(
        logPath,
        `${JSON.stringify({ ts: '2026-01-01T00:00:00Z', level: 'info', msg: 'srv' })}\n`,
      );
      appendFileSync(
        dashLogPath,
        `${JSON.stringify({ ts: '2026-01-01T00:00:01Z', level: 'info', msg: 'dash' })}\n`,
      );

      await vi.advanceTimersByTimeAsync(2500);

      expect(res.body).toContain('"msg":"srv"');
      expect(res.body).toContain('"source":"server"');
      expect(res.body).toContain('"msg":"dash"');
      expect(res.body).toContain('"source":"dashboard"');

      res.emit('close');
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends SSE heartbeats on /api/logs/stream', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      const { server } = createTestServer();

      const req = new MockRequest('GET', '/api/logs/stream?source=server', authHeaders());
      const res = new MockResponse();
      server.emit('request', req as never, res as unknown as ServerResponse);
      await vi.advanceTimersByTimeAsync(0);

      // Advance past heartbeat interval (15s)
      await vi.advanceTimersByTimeAsync(16000);

      expect(res.body).toContain(': heartbeat');

      res.emit('close');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns editable settings defaults when no persisted config exists', async () => {
    const { server, envFilePath } = createTestServer();
    rmSync(envFilePath, { force: true });

    const res = await invoke(server, {
      method: 'GET',
      path: '/api/settings',
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = res.body as { entries: Array<Record<string, unknown>> };
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries.find((entry) => entry.key === 'DEFAULT_TOOL')).toMatchObject({
      key: 'DEFAULT_TOOL',
      value: 'claude',
      source: 'default',
    });
    expect(body.entries.find((entry) => entry.key === 'SLACK_BOT_TOKEN')).toMatchObject({
      key: 'SLACK_BOT_TOKEN',
      value: '',
      masked: false,
      hasValue: false,
    });
  });

  it('GET /api/settings/schema returns registry metadata', async () => {
    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/settings/schema',
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    const body = res.body as { schema: Array<Record<string, unknown>> };
    expect(Array.isArray(body.schema)).toBe(true);
    expect(body.schema.length).toBeGreaterThan(0);

    // Verify shape of each entry
    for (const entry of body.schema) {
      expect(entry).toHaveProperty('key');
      expect(entry).toHaveProperty('cat');
      expect(entry).toHaveProperty('sub');
      expect(entry).toHaveProperty('mutable');
      expect(entry).toHaveProperty('sensitive');
      // 'skill' flag is exposed so the client can filter skill keys to the Skills tab
      if (entry.skill !== undefined) {
        expect(typeof entry.skill).toBe('boolean');
      }
    }

    // Verify a known key is present
    const modeEntry = body.schema.find((e) => e.key === 'TOOL_AUTO_APPROVE_MODE');
    expect(modeEntry).toBeDefined();
    expect(modeEntry?.cat).toBe('mode');
    expect(modeEntry?.mutable).toBe(true);
    expect(modeEntry?.sensitive).toBe(false);
  });

  it('GET /api/settings/schema rejects unauthenticated requests', async () => {
    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/settings/schema',
    });
    expect(res.status).toBe(401);
  });

  it('returns alias audit summary with null lastRun when no jobs exist', async () => {
    mocked.getDevAlias.mockReturnValue({ name: 'dev1', path: '/tmp/work1', tool: 'claude' });
    mocked.getAuditByWorkdir.mockReturnValue([]);
    const { server } = createTestServer();

    const res = await invoke(server, {
      method: 'GET',
      path: '/api/dev-aliases/dev1/audit',
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      summary: { total: 0, succeeded: 0, failed: 0, lastRun: null },
      jobs: [],
    });
  });

  it('normalizes blank instructionContent to null on alias create/update', async () => {
    mocked.listDevAliases.mockReturnValue([{ name: 'dev1', path: '/tmp/work1', tool: 'claude' }]);
    mocked.createDevAlias.mockReturnValue({ name: 'devx' });
    mocked.updateDevAlias.mockReturnValue({
      name: 'dev1',
      path: '/tmp/work1',
      tool: 'claude',
      instructionContent: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const { server, dataDir } = createTestServer();
    const validDir = join(dataDir, 'valid');
    mkdirSync(validDir, { recursive: true });

    const createRes = await invoke(server, {
      method: 'POST',
      path: '/api/dev-aliases',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        name: 'blank',
        path: validDir,
        instructionContent: '   ',
      }),
    });
    expect(createRes.status).toBe(201);
    expect(mocked.createDevAlias).toHaveBeenCalledWith(
      'blank',
      realpathSync(validDir),
      'claude',
      null,
    );

    const updateRes = await invoke(server, {
      method: 'PUT',
      path: '/api/dev-aliases/dev1',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ instructionContent: '   ' }),
    });
    expect(updateRes.status).toBe(200);
    expect(mocked.updateDevAlias).toHaveBeenCalledWith('dev1', { instructionContent: null });
  });

  it('handles non-Error throws in global request handler', async () => {
    mocked.createDevAlias.mockImplementationOnce(() => {
      throw 'boom';
    });
    const { server, dataDir } = createTestServer();
    const validDir = join(dataDir, 'valid-non-error');
    mkdirSync(validDir, { recursive: true });

    const res = await invoke(server, {
      method: 'POST',
      path: '/api/dev-aliases',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        name: 'boom_alias',
        path: validDir,
      }),
    });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  it('closes dashboard DB on server close after DB has been used', async () => {
    const { server } = createTestServer();
    await invoke(server, {
      method: 'GET',
      path: '/api/sessions',
      headers: authHeaders(),
    });
    server.emit('close');
    expect(mocked.dbClose).toHaveBeenCalled();
  });
});

describe('Dashboard artifact routes', () => {
  it('proxies artifact listing to server API when session exists', async () => {
    mocked.getSessionToolState.mockReturnValue({ workdir: '/tmp/work' });
    mocked.fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ artifacts: [{ jobId: 'job1', files: [] }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', mocked.fetchMock as never);

    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/artifacts',
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ artifacts: [{ jobId: 'job1', files: [] }] });
  });

  it('returns 404 for artifact listing when session is missing', async () => {
    mocked.getSessionToolState.mockReturnValue(null);
    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/artifacts',
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Session not found' });
  });

  it('serves artifact file content with expected headers', async () => {
    const { server, dataDir } = createTestServer();
    const workdir = join(dataDir, 'workdir-artifacts');
    const artifactFile = join(workdir, '_artifacts', 'deafbeef', 'result.txt');
    mkdirSync(join(workdir, '_artifacts', 'deafbeef'), { recursive: true });
    writeFileSync(artifactFile, 'artifact-content', 'utf-8');
    mocked.getSessionToolState.mockReturnValue({ workdir });

    const res = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/artifacts/deafbeef/result.txt',
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain');
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
    expect(res.body).toBe('artifact-content');
  });

  it('validates artifact file path and returns errors', async () => {
    const { server, dataDir } = createTestServer();
    const workdir = join(dataDir, 'workdir-artifacts-invalid');
    mkdirSync(join(workdir, '_artifacts', 'feedface'), { recursive: true });
    writeFileSync(join(workdir, '_artifacts', 'feedface', 'ok.txt'), 'ok', 'utf-8');

    mocked.getSessionToolState.mockReturnValue(null);
    const missing = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/artifacts/feedface/ok.txt',
      headers: authHeaders(),
    });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'Session not found' });

    mocked.getSessionToolState.mockReturnValue({ workdir });
    const forbidden = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/artifacts/feedface/..%2Fescape.txt',
      headers: authHeaders(),
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toEqual({ error: 'Forbidden' });

    const malformedPath = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/artifacts/feedface/%E0%A4%A',
      headers: authHeaders(),
    });
    expect(malformedPath.status).toBe(404);
  });
});

describe('O-3: bootstrap rate limiting', () => {
  it('allows up to 5 attempts then returns 429', async () => {
    const { server } = createTestServer('', { dashboardBootstrapToken: 'tok' });
    // First attempt succeeds (consumes token)
    const first = await invoke(server, {
      method: 'POST',
      path: '/api/auth/bootstrap',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'wrong' }),
    });
    expect(first.status).toBe(401);

    // Attempts 2–5 also get 401 (wrong token, but not rate-limited)
    for (let i = 2; i <= 5; i++) {
      const res = await invoke(server, {
        method: 'POST',
        path: '/api/auth/bootstrap',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'wrong' }),
      });
      expect(res.status).toBe(401);
    }

    // 6th attempt → rate limited
    const limited = await invoke(server, {
      method: 'POST',
      path: '/api/auth/bootstrap',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'wrong' }),
    });
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: 'Too many attempts. Try again later.' });
  });
});

describe('O-4: CSRF protection', () => {
  it('rejects state-changing /api/* requests without X-CSRF-Protection header', async () => {
    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'POST',
      path: '/api/sessions',
      headers: { cookie: 'hg_session=dashboard-secret', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Missing CSRF protection header' });
  });

  it('allows state-changing requests with X-CSRF-Protection: 1', async () => {
    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'DELETE',
      path: '/api/sessions',
      headers: authHeaders({ 'x-csrf-protection': '1' }),
    });
    // Should pass CSRF check (might be 200, 404, or 500 depending on route — not 403)
    expect(res.status).not.toBe(403);
  });

  it('does not require CSRF header for GET requests', async () => {
    const { server } = createTestServer();
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/status',
      headers: authHeaders(),
    });
    expect(res.status).not.toBe(403);
  });

  it('does not require CSRF header for bootstrap POST', async () => {
    const { server } = createTestServer('', { dashboardBootstrapToken: 'tok' });
    const res = await invoke(server, {
      method: 'POST',
      path: '/api/auth/bootstrap',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'tok' }),
    });
    // Bootstrap is handled before CSRF check — should succeed
    expect(res.status).toBe(200);
  });
});
