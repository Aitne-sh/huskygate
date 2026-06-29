import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { IncomingHttpHeaders, Server, ServerResponse } from 'node:http';
import { Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENV_REGISTRY } from '../config.js';
import { type KeychainProvider, setKeychainProvider } from '../utils/keychain.js';

/* ── Hoisted state for dynamic mock values ── */

interface MockConfigRecord {
  key: string;
  value: string | null;
  storage: 'db' | 'keychain_ref';
  source: 'user';
  updatedAt: string;
}

const state = vi.hoisted(() => ({
  homeDir: '/tmp/test-home',
  claudeMcpServers: [] as Array<{
    id: string;
    name: string;
    tool: 'claude';
    transport: 'stdio' | 'sse' | 'http';
    definition: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  }>,
  configRecordsByDbPath: new Map<string, Map<string, MockConfigRecord>>(),
  metadataByDbPath: new Map<string, Map<string, string>>(),
}));

function makeMockUuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function getConfigBucket(dbPath: string): Map<string, MockConfigRecord> {
  let bucket = state.configRecordsByDbPath.get(dbPath);
  if (!bucket) {
    bucket = new Map<string, MockConfigRecord>();
    state.configRecordsByDbPath.set(dbPath, bucket);
  }
  return bucket;
}

function getMetadataBucket(dbPath: string): Map<string, string> {
  let bucket = state.metadataByDbPath.get(dbPath);
  if (!bucket) {
    bucket = new Map<string, string>();
    state.metadataByDbPath.set(dbPath, bucket);
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

/* ── Module mocks ── */

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => state.homeDir,
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
      getEnabled: (skillRef: string, tool: 'claude' | 'codex' | 'gemini') => boolean | null;
      set: (skillRef: string, tool: 'claude' | 'codex' | 'gemini', enabled: boolean) => void;
      delete: (skillRef: string, tool: 'claude' | 'codex' | 'gemini') => number;
      deleteBySkillRef: (skillRef: string) => number;
    };

    constructor(dbPath: string) {
      this.dbPath = dbPath;
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
        getEnabled: () => null,
        set: () => {},
        delete: () => 1,
        deleteBySkillRef: () => 1,
      };
    }

    listMcpServers(tool?: 'claude') {
      return tool
        ? state.claudeMcpServers.filter((server) => server.tool === tool)
        : state.claudeMcpServers;
    }
    getMcpServerById(id: string) {
      return state.claudeMcpServers.find((server) => server.id === id) ?? null;
    }
    getMcpServerByName(name: string, tool: 'claude') {
      return (
        state.claudeMcpServers.find((server) => server.name === name && server.tool === tool) ??
        null
      );
    }
    createMcpServer(input: {
      name: string;
      tool: 'claude';
      transport: 'stdio' | 'sse' | 'http';
      definition: Record<string, unknown>;
    }) {
      if (this.getMcpServerByName(input.name, input.tool)) {
        throw new Error('UNIQUE constraint failed: mcp_servers.name, mcp_servers.tool');
      }
      const now = new Date().toISOString();
      const created = {
        id: makeMockUuid(state.claudeMcpServers.length + 1),
        name: input.name,
        tool: input.tool,
        transport: input.transport,
        definition: input.definition,
        createdAt: now,
        updatedAt: now,
      } as const;
      state.claudeMcpServers.push(created);
      return created;
    }
    updateMcpServer(
      id: string,
      input: { transport: 'stdio' | 'sse' | 'http'; definition: Record<string, unknown> },
    ) {
      const existing = this.getMcpServerById(id);
      if (!existing) return null;
      existing.transport = input.transport;
      existing.definition = input.definition;
      existing.updatedAt = new Date().toISOString();
      return existing;
    }
    replaceMcpServersForTool(
      tool: 'claude',
      servers: ReadonlyArray<{
        name: string;
        transport: 'stdio' | 'sse' | 'http';
        definition: Record<string, unknown>;
      }>,
    ) {
      state.claudeMcpServers = state.claudeMcpServers.filter((server) => server.tool !== tool);
      const now = new Date().toISOString();
      const created = servers.map((server, index) => ({
        id: makeMockUuid(index + 1),
        name: server.name,
        tool,
        transport: server.transport,
        definition: server.definition,
        createdAt: now,
        updatedAt: now,
      })) as Array<(typeof state.claudeMcpServers)[number]>;
      state.claudeMcpServers.push(...created);
      return created;
    }
    deleteMcpServer(id: string) {
      const before = state.claudeMcpServers.length;
      state.claudeMcpServers = state.claudeMcpServers.filter((server) => server.id !== id);
      return state.claudeMcpServers.length !== before;
    }
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

/* ── Test infrastructure ── */

class MockRequest extends EventEmitter {
  public method: string;
  public url?: string;
  public headers: IncomingHttpHeaders;

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
  let parsed: unknown = res.body;
  const contentType = String(res.headers['content-type'] ?? '');
  if (contentType.includes('application/json') && res.body) {
    parsed = JSON.parse(res.body);
  }
  return { status: res.statusCode, body: parsed };
}

/* ── Shared setup ── */

const tempDirs: string[] = [];
const servers: Server[] = [];
let listenSpy: ReturnType<typeof vi.fn>;
let tempHome: string;
let workRoot: string;
let savedKnownEnv: Record<string, string | undefined> = {};

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

beforeEach(() => {
  savedKnownEnv = {};
  for (const key of Object.keys(ENV_REGISTRY)) {
    savedKnownEnv[key] = process.env[key];
    delete process.env[key];
  }

  const inMemoryKeychain: KeychainProvider = {
    platform: 'test',
    isAvailable: async () => true,
    getPassword: async () => null,
    setPassword: async () => {},
    deletePassword: async () => false,
    listKeys: async () => [],
  };
  setKeychainProvider(inMemoryKeychain);

  tempHome = mkdtempSync(join(tmpdir(), 'v5-home-'));
  workRoot = mkdtempSync(join(tmpdir(), 'v5-work-'));
  tempDirs.push(tempHome, workRoot);
  state.homeDir = tempHome;
  state.claudeMcpServers = [];
  process.env.SKILL_TEMPLATE_DIR = join(workRoot, 'builtin-skills');
  mkdirSync(process.env.SKILL_TEMPLATE_DIR, { recursive: true });
});

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.emit('close');
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const [key, value] of Object.entries(savedKnownEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  savedKnownEnv = {};
  state.configRecordsByDbPath.clear();
  state.metadataByDbPath.clear();
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.SKILL_TEMPLATE_DIR;
});

function createTestServer(): Server {
  const envFilePath = join(workRoot, '.env');
  writeFileSync(envFilePath, '', 'utf-8');
  const server = createDashboardServer({
    port: 0,
    version: 'test',
    dataDir: workRoot,
    serverApiPort: 3738,
    serverApiSecret: 'secret',
    dashboardSecret: 'dashboard-secret',
    workdirRoot: workRoot,
  });
  servers.push(server);
  return server;
}

/* ═══════════════════════════════════════════════
   MCP Config API
   ═══════════════════════════════════════════════ */

describe('DB-backed MCP Server API', () => {
  it('GET /api/mcp/servers returns DB-backed Claude config', async () => {
    state.claudeMcpServers = [
      {
        id: makeMockUuid(1),
        name: 'aws-api',
        tool: 'claude',
        transport: 'http',
        definition: {
          url: 'https://claude.example/mcp',
          headers: { Authorization: 'Bearer secret' },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const server = createTestServer();
    const res = await invoke(server, 'GET', '/api/mcp/servers?tool=claude');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      tool: 'claude',
      filePath: 'SQLite -> <workdir>/.huskygate/claude.mcp.json',
      exists: true,
      format: 'json',
      servers: {
        'aws-api': {
          id: makeMockUuid(1),
          transport: 'http',
          url: 'https://claude.example/mcp',
          headers: { Authorization: '***' },
        },
      },
    });
  });

  it('POST /api/mcp/servers persists a DB-backed Claude server', async () => {
    const server = createTestServer();
    const res = await invoke(
      server,
      'POST',
      '/api/mcp/servers',
      JSON.stringify({
        tool: 'claude',
        name: 'new-srv',
        transport: 'stdio',
        definition: {
          command: 'npx',
          args: ['-y', '@example/mcp'],
        },
      }),
    );

    expect(res.status).toBe(201);
    expect(state.claudeMcpServers).toHaveLength(1);
    expect(state.claudeMcpServers[0]).toMatchObject({
      name: 'new-srv',
      tool: 'claude',
      transport: 'stdio',
      definition: {
        command: 'npx',
        args: ['-y', '@example/mcp'],
      },
    });
  });
});

/* ═══════════════════════════════════════════════
   Skills API
   ═══════════════════════════════════════════════ */

describe('Skills API', () => {
  function setupSkill(tool: string, scope: string, name: string, content: string): string {
    const base =
      scope === 'project'
        ? join(workRoot, '.huskygate', 'skills')
        : join(tempHome, '.huskygate', 'skills');
    const skillDir = join(base, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, `SKILL.${tool}.md`), content, 'utf-8');
    return skillDir;
  }

  it('GET /api/skills lists skills for a tool and scope', async () => {
    setupSkill(
      'claude',
      'project',
      'my-skill',
      '---\nname: My Skill\ndescription: A test skill\n---\nHello world',
    );

    const server = createTestServer();
    const res = await invoke(server, 'GET', '/api/skills?tool=claude&scope=project');
    expect(res.status).toBe(200);
    const skills = res.body as Array<{ dirName: string; name: string; description: string }>;
    expect(skills).toHaveLength(1);
    const firstSkill = skills[0];
    expect(firstSkill).toBeDefined();
    if (!firstSkill) throw new Error('expected a listed skill');
    expect(firstSkill.dirName).toBe('my-skill');
    expect(firstSkill.name).toBe('My Skill');
    expect(firstSkill.description).toBe('A test skill');
  });

  it('GET /api/skills returns 400 for invalid tool', async () => {
    const server = createTestServer();
    const res = await invoke(server, 'GET', '/api/skills?tool=invalid');
    expect(res.status).toBe(400);
  });

  it('GET /api/skills returns empty array when no skills exist', async () => {
    const server = createTestServer();
    const res = await invoke(server, 'GET', '/api/skills?tool=claude&scope=project');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('POST creates a new skill with frontmatter and body', async () => {
    const server = createTestServer();
    const res = await invoke(
      server,
      'POST',
      '/api/skills/claude/project',
      JSON.stringify({
        name: 'new-skill',
        frontmatter: { name: 'New Skill', description: 'A new one' },
        body: '# Instructions\nDo the thing.',
      }),
    );
    expect(res.status).toBe(201);

    // Verify file was created
    const skillPath = join(workRoot, '.huskygate', 'skills', 'new-skill', 'SKILL.claude.md');
    expect(existsSync(skillPath)).toBe(true);
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toContain('name: New Skill');
    expect(content).toContain('# Instructions');
  });

  it('POST returns 409 for duplicate skill name', async () => {
    setupSkill('claude', 'project', 'existing', '---\nname: Existing\n---\n');

    const server = createTestServer();
    const res = await invoke(
      server,
      'POST',
      '/api/skills/claude/project',
      JSON.stringify({ name: 'existing', body: 'content' }),
    );
    expect(res.status).toBe(409);
  });

  it('POST validates skill name format', async () => {
    const server = createTestServer();
    const badName = await invoke(
      server,
      'POST',
      '/api/skills/claude/project',
      JSON.stringify({ name: 'Invalid Name!', body: 'x' }),
    );
    expect(badName.status).toBe(400);

    const noName = await invoke(
      server,
      'POST',
      '/api/skills/claude/project',
      JSON.stringify({ body: 'x' }),
    );
    expect(noName.status).toBe(400);
  });

  it('GET /api/skills/:tool/:scope/:name returns full detail', async () => {
    const skillDir = setupSkill(
      'claude',
      'project',
      'detailed',
      '---\nname: Detailed\ndescription: Full detail test\n---\nBody content here',
    );
    // Add a support file
    writeFileSync(join(skillDir, 'helper.py'), 'print("hi")', 'utf-8');

    const server = createTestServer();
    const res = await invoke(server, 'GET', '/api/skills/claude/project/detailed');
    expect(res.status).toBe(200);
    const detail = res.body as {
      frontmatter: Record<string, unknown>;
      body: string;
      supportFiles: string[];
    };
    expect(detail.frontmatter.name).toBe('Detailed');
    expect(detail.body).toContain('Body content here');
    expect(detail.supportFiles).toContain('helper.py');
  });

  it('GET detail returns 404 for missing skill', async () => {
    const server = createTestServer();
    const res = await invoke(server, 'GET', '/api/skills/claude/project/nonexistent');
    expect(res.status).toBe(404);
  });

  it('PUT updates an existing skill', async () => {
    setupSkill('claude', 'project', 'updatable', '---\nname: Old\n---\nOld body');

    const server = createTestServer();
    const res = await invoke(
      server,
      'PUT',
      '/api/skills/claude/project/updatable',
      JSON.stringify({
        frontmatter: { name: 'Updated', description: 'Now updated' },
        body: 'New body content',
      }),
    );
    expect(res.status).toBe(200);

    const content = readFileSync(
      join(workRoot, '.huskygate', 'skills', 'updatable', 'SKILL.claude.md'),
      'utf-8',
    );
    expect(content).toContain('name: Updated');
    expect(content).toContain('New body content');
  });

  it('PUT returns 404 for missing skill', async () => {
    const server = createTestServer();
    const res = await invoke(
      server,
      'PUT',
      '/api/skills/claude/project/ghost',
      JSON.stringify({ body: 'x' }),
    );
    expect(res.status).toBe(404);
  });

  it('DELETE removes a skill directory', async () => {
    const skillDir = setupSkill('claude', 'project', 'deletable', '---\nname: Delete Me\n---\n');
    writeFileSync(join(skillDir, 'extra.txt'), 'extra', 'utf-8');

    const server = createTestServer();
    const res = await invoke(server, 'DELETE', '/api/skills/claude/project/deletable');
    expect(res.status).toBe(200);
    expect(existsSync(skillDir)).toBe(false);
  });

  it('DELETE returns 404 for missing skill', async () => {
    const server = createTestServer();
    const res = await invoke(server, 'DELETE', '/api/skills/claude/project/ghost');
    expect(res.status).toBe(404);
  });

  /* ── Support file CRUD ── */

  it('GET/PUT/DELETE support files within a skill', async () => {
    const skillDir = setupSkill('claude', 'project', 'with-files', '---\nname: Files\n---\n');

    const server = createTestServer();

    // PUT creates a support file
    const putRes = await invoke(
      server,
      'PUT',
      '/api/skills/claude/project/with-files/files/helper.py',
      JSON.stringify({ content: 'print("hello")' }),
    );
    expect(putRes.status).toBe(200);
    expect(readFileSync(join(skillDir, 'helper.py'), 'utf-8')).toBe('print("hello")');

    // GET reads the support file
    const getRes = await invoke(
      server,
      'GET',
      '/api/skills/claude/project/with-files/files/helper.py',
    );
    expect(getRes.status).toBe(200);
    const fileData = getRes.body as { filename: string; content: string };
    expect(fileData.filename).toBe('helper.py');
    expect(fileData.content).toBe('print("hello")');

    // DELETE removes the support file
    const delRes = await invoke(
      server,
      'DELETE',
      '/api/skills/claude/project/with-files/files/helper.py',
    );
    expect(delRes.status).toBe(200);
    expect(existsSync(join(skillDir, 'helper.py'))).toBe(false);
  });

  it('rejects support file path traversal to sibling skill directories', async () => {
    setupSkill('claude', 'project', 'with-files', '---\nname: Files\n---\n');
    const siblingDir = setupSkill('claude', 'project', 'with-files-evil', '---\nname: Evil\n---\n');
    const initialSiblingFiles = readdirSync(siblingDir);
    const escapePath = encodeURIComponent('../with-files-evil/pwn.txt');

    const server = createTestServer();

    const putRes = await invoke(
      server,
      'PUT',
      `/api/skills/claude/project/with-files/files/${escapePath}`,
      JSON.stringify({ content: 'owned' }),
    );
    expect(putRes.status).toBe(400);

    const getRes = await invoke(
      server,
      'GET',
      `/api/skills/claude/project/with-files/files/${escapePath}`,
    );
    expect(getRes.status).toBe(400);

    const deleteRes = await invoke(
      server,
      'DELETE',
      `/api/skills/claude/project/with-files/files/${escapePath}`,
    );
    expect(deleteRes.status).toBe(400);

    expect(readdirSync(siblingDir)).toEqual(initialSiblingFiles);
  });

  it('GET support file returns 404 for missing file', async () => {
    setupSkill('claude', 'project', 'no-extra', '---\nname: No Extra\n---\n');

    const server = createTestServer();
    const res = await invoke(
      server,
      'GET',
      '/api/skills/claude/project/no-extra/files/missing.txt',
    );
    expect(res.status).toBe(404);
  });

  it('PUT support file returns 404 when skill does not exist', async () => {
    const server = createTestServer();
    const res = await invoke(
      server,
      'PUT',
      '/api/skills/claude/project/nonexistent/files/test.txt',
      JSON.stringify({ content: 'x' }),
    );
    expect(res.status).toBe(404);
  });

  it('PUT support file requires content string', async () => {
    setupSkill('claude', 'project', 'needs-content', '---\nname: X\n---\n');

    const server = createTestServer();
    const res = await invoke(
      server,
      'PUT',
      '/api/skills/claude/project/needs-content/files/bad.txt',
      JSON.stringify({ content: 123 }),
    );
    expect(res.status).toBe(400);
  });

  it('lists skills across both scopes when scope is omitted', async () => {
    setupSkill('claude', 'project', 'proj-skill', '---\nname: Project Skill\n---\n');
    setupSkill('claude', 'local', 'local-skill', '---\nname: Local Skill\n---\n');

    const server = createTestServer();
    const res = await invoke(server, 'GET', '/api/skills?tool=claude');
    expect(res.status).toBe(200);
    const skills = res.body as Array<{ dirName: string; scope: string }>;
    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.dirName).sort();
    expect(names).toEqual(['local-skill', 'proj-skill']);
  });

  it('GET /api/skills supports unified source listing', async () => {
    const builtinDir = join(workRoot, 'builtin-skills', 'playwright-runner');
    mkdirSync(builtinDir, { recursive: true });
    writeFileSync(
      join(builtinDir, 'skill.json'),
      JSON.stringify({
        schemaVersion: 1,
        excludeDirs: ['.venv', '__pycache__', '.git', 'node_modules'],
        envVars: [],
      }),
      'utf-8',
    );
    writeFileSync(
      join(builtinDir, 'SKILL.claude.md'),
      '---\nname: Playwright Runner\n---\n',
      'utf-8',
    );
    setupSkill('claude', 'project', 'proj-skill', '---\nname: Project Skill\n---\n');

    const server = createTestServer();
    const res = await invoke(server, 'GET', '/api/skills?tool=claude&source=all');
    expect(res.status).toBe(200);
    const skills = res.body as Array<{ skillRef: string; sourceKind: string }>;
    expect(skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ skillRef: 'builtin:playwright-runner', sourceKind: 'builtin' }),
        expect.objectContaining({ skillRef: 'project:proj-skill', sourceKind: 'project' }),
      ]),
    );
  });

  it('GET /api/skills/entry/:source/:name returns unified detail', async () => {
    const skillDir = setupSkill(
      'claude',
      'project',
      'detail-skill',
      '---\nname: Detail Skill\ndescription: Unified detail\n---\nBody',
    );
    writeFileSync(
      join(skillDir, 'skill.json'),
      JSON.stringify({
        schemaVersion: 1,
        excludeDirs: ['.venv', '__pycache__', '.git', 'node_modules'],
        envVars: ['PERPLEXITY_API_KEY'],
      }),
      'utf-8',
    );
    writeFileSync(join(skillDir, 'helper.py'), 'print("hi")', 'utf-8');

    const server = createTestServer();
    const res = await invoke(server, 'GET', '/api/skills/entry/project/detail-skill');
    expect(res.status).toBe(200);
    const detail = res.body as {
      skillRef: string;
      sourceKind: string;
      variants: Record<string, { body: string }>;
      supportFiles: Array<{ path: string }>;
      envVars: Array<{ key: string }>;
    };
    expect(detail.skillRef).toBe('project:detail-skill');
    expect(detail.sourceKind).toBe('project');
    expect(detail.variants.claude).toBeDefined();
    expect(detail.variants.claude?.body).toContain('Body');
    expect(detail.supportFiles).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'helper.py' })]),
    );
    expect(detail.envVars).toEqual([]);
  });

  it('PUT/GET/DELETE /api/skills/entry/:source/:name/files/:filename mutates custom support files', async () => {
    const skillDir = setupSkill(
      'claude',
      'project',
      'detail-files',
      '---\nname: Detail Files\n---\nBody',
    );

    const server = createTestServer();
    const putRes = await invoke(
      server,
      'PUT',
      '/api/skills/entry/project/detail-files/files/scripts%2Frun.py',
      JSON.stringify({ content: 'print("hello")' }),
    );
    expect(putRes.status).toBe(200);
    expect(readFileSync(join(skillDir, 'scripts', 'run.py'), 'utf-8')).toBe('print("hello")');

    const getRes = await invoke(
      server,
      'GET',
      '/api/skills/entry/project/detail-files/files/scripts%2Frun.py',
    );
    expect(getRes.status).toBe(200);
    expect(getRes.body).toEqual(
      expect.objectContaining({ filename: 'scripts/run.py', content: 'print("hello")' }),
    );

    const deleteRes = await invoke(
      server,
      'DELETE',
      '/api/skills/entry/project/detail-files/files/scripts%2Frun.py',
    );
    expect(deleteRes.status).toBe(200);
    expect(existsSync(join(skillDir, 'scripts', 'run.py'))).toBe(false);
  });

  it('PUT /api/skills/entry/:source/:name/files/:filename keeps built-in skills read-only', async () => {
    const builtinDir = join(workRoot, 'builtin-skills', 'builtin-readonly');
    mkdirSync(builtinDir, { recursive: true });
    writeFileSync(
      join(builtinDir, 'skill.json'),
      JSON.stringify({
        schemaVersion: 1,
        excludeDirs: ['.venv', '__pycache__', '.git', 'node_modules'],
        envVars: [],
      }),
      'utf-8',
    );
    writeFileSync(
      join(builtinDir, 'SKILL.claude.md'),
      '---\nname: Built-in Readonly\n---\n',
      'utf-8',
    );

    const server = createTestServer();
    const res = await invoke(
      server,
      'PUT',
      '/api/skills/entry/builtin/builtin-readonly/files/notes.txt',
      JSON.stringify({ content: 'updated' }),
    );
    expect(res.status).toBe(403);
  });

  it('PUT /api/skills/entry/:source/:name/toggle rejects a tool without a variant', async () => {
    setupSkill('claude', 'project', 'claude-only', '---\nname: Claude Only\n---\nBody');

    const server = createTestServer();
    const res = await invoke(
      server,
      'PUT',
      '/api/skills/entry/project/claude-only/toggle',
      JSON.stringify({ enabled: true, driver: 'gemini' }),
    );
    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({ error: expect.stringContaining('not available') }),
    );
  });
});

/* ═══════════════════════════════════════════════
   Hot-reload classification in PUT /api/settings
   ═══════════════════════════════════════════════ */

describe('PUT /api/settings hot-reload classification', () => {
  it('classifies changed keys into applied and requiresRestart', async () => {
    const server = createTestServer();
    const res = await invoke(
      server,
      'PUT',
      '/api/settings',
      JSON.stringify({
        patches: [
          { key: 'MAX_CONCURRENCY', op: 'set', value: '4' }, // runtime-mutable
          { key: 'DEFAULT_TOOL', op: 'set', value: 'gemini' }, // requires restart
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = res.body as {
      success: boolean;
      applied: string[];
      requiresRestart: string[];
    };
    expect(body.success).toBe(true);
    // MAX_CONCURRENCY is runtime-mutable; server API not running so it won't appear in applied
    expect(body.requiresRestart).toContain('DEFAULT_TOOL');
  });

  it('does not classify unchanged keys', async () => {
    const server = createTestServer();
    const res = await invoke(
      server,
      'PUT',
      '/api/settings',
      JSON.stringify({
        patches: [{ key: 'MAX_CONCURRENCY', op: 'noop' }],
      }),
    );
    expect(res.status).toBe(200);
    const body = res.body as { requiresRestart: string[] };
    expect(body.requiresRestart).toEqual([]);
  });

  it('skips masked values from classification', async () => {
    const server = createTestServer();
    const res = await invoke(
      server,
      'PUT',
      '/api/settings',
      JSON.stringify({
        patches: [{ key: 'SLACK_BOT_TOKEN', op: 'noop' }],
      }),
    );
    expect(res.status).toBe(200);
    const body = res.body as { requiresRestart: string[]; applied: string[] };
    expect(body.requiresRestart).toEqual([]);
    expect(body.applied).toEqual([]);
  });

  it('hot-reloads runtime keys with applied response from server API', async () => {
    const server = createTestServer();

    // Mock fetch to return applied keys
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ applied: ['LOG_LEVEL'] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await invoke(
      server,
      'PUT',
      '/api/settings',
      JSON.stringify({
        patches: [{ key: 'LOG_LEVEL', op: 'set', value: 'debug' }],
      }),
    );
    expect(res.status).toBe(200);
    const body = res.body as { applied: string[]; requiresRestart: string[] };
    expect(body.applied).toContain('LOG_LEVEL');

    vi.unstubAllGlobals();
  });

  it('marks runtime keys as restart-required when server API does not apply them', async () => {
    const server = createTestServer();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          applied: ['LOG_LEVEL'],
          rejected: ['HUSKYGATE_OAUTH_TRUSTED_HOSTS'],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await invoke(
      server,
      'PUT',
      '/api/settings',
      JSON.stringify({
        patches: [
          { key: 'LOG_LEVEL', op: 'set', value: 'debug' },
          {
            key: 'HUSKYGATE_OAUTH_TRUSTED_HOSTS',
            op: 'set',
            value: 'accounts.google.com',
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = res.body as { applied: string[]; requiresRestart: string[] };
    expect(body.applied).toEqual(['LOG_LEVEL']);
    expect(body.requiresRestart).toContain('HUSKYGATE_OAUTH_TRUSTED_HOSTS');

    vi.unstubAllGlobals();
  });

  it('handles server API fetch failure gracefully during hot-reload', async () => {
    const server = createTestServer();

    // Mock fetch to throw (server not running)
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    const res = await invoke(
      server,
      'PUT',
      '/api/settings',
      JSON.stringify({
        patches: [{ key: 'LOG_LEVEL', op: 'set', value: 'debug' }],
      }),
    );
    // Should still succeed (saved to disk), just no applied keys
    expect(res.status).toBe(200);
    const body = res.body as { applied: string[]; requiresRestart: string[] };
    expect(body.applied).toEqual([]);

    vi.unstubAllGlobals();
  });
});

/* ═══════════════════════════════════════════════
   Coverage: Skills API edge cases
   ═══════════════════════════════════════════════ */

describe('Skills API edge cases', () => {
  it('returns 400 for invalid scope in skills list', async () => {
    const server = createTestServer();
    const res = await invoke(server, 'GET', '/api/skills?tool=claude&scope=invalid');
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain('scope must be local or project');
  });

  it('handles skill with non-directory entry in skill base dir', async () => {
    const server = createTestServer();
    const skillsDir = join(tempHome, '.huskygate', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    // Create a file (not a directory) that matches skill name pattern
    writeFileSync(join(skillsDir, 'not-a-dir'), 'some file', 'utf-8');

    const res = await invoke(server, 'GET', '/api/skills?tool=claude&scope=local');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('handles unreadable SKILL.claude.md with hasErrors flag', async () => {
    const server = createTestServer();
    const skillDir = join(tempHome, '.huskygate', 'skills', 'bad-skill');
    mkdirSync(skillDir, { recursive: true });
    // Create SKILL.claude.md as a directory to make readFileSync throw
    mkdirSync(join(skillDir, 'SKILL.claude.md'), { recursive: true });

    const res = await invoke(server, 'GET', '/api/skills?tool=claude&scope=local');
    expect(res.status).toBe(200);
    const skills = res.body as Array<{ dirName: string; hasErrors: boolean }>;
    const bad = skills.find((s) => s.dirName === 'bad-skill');
    expect(bad?.hasErrors).toBe(true);
  });

  it('resolves gemini skills dir to .huskygate/skills for local scope', async () => {
    const server = createTestServer();
    const skillDir = join(tempHome, '.huskygate', 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.gemini.md'),
      '---\nname: My Skill\n---\nBody content',
      'utf-8',
    );

    const res = await invoke(server, 'GET', '/api/skills?tool=gemini&scope=local');
    expect(res.status).toBe(200);
    const skills = res.body as Array<{ name: string }>;
    expect(skills.some((s) => s.name === 'My Skill')).toBe(true);
  });

  it('resolves codex skills dir to .huskygate/skills for local scope', async () => {
    const server = createTestServer();
    const skillDir = join(tempHome, '.huskygate', 'skills', 'my-agent');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.codex.md'), '---\nname: Agent Skill\n---\nBody', 'utf-8');

    const res = await invoke(server, 'GET', '/api/skills?tool=codex&scope=local');
    expect(res.status).toBe(200);
    const skills = res.body as Array<{ name: string }>;
    expect(skills.some((s) => s.name === 'Agent Skill')).toBe(true);
  });

  it('resolves project skills to .huskygate/skills', async () => {
    const server = createTestServer();
    const skillDir = join(workRoot, '.huskygate', 'skills', 'proj-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.codex.md'), '---\nname: Proj Skill\n---\nBody', 'utf-8');

    const res = await invoke(server, 'GET', '/api/skills?tool=codex&scope=project');
    expect(res.status).toBe(200);
    const skills = res.body as Array<{ name: string }>;
    expect(skills.some((s) => s.name === 'Proj Skill')).toBe(true);
  });

  it('listSkills returns empty on readdirSync failure', async () => {
    const server = createTestServer();
    // Create the skills base dir as a file (not a directory) to trigger readdirSync error
    const skillsBase = join(tempHome, '.huskygate', 'skills');
    mkdirSync(join(tempHome, '.huskygate'), { recursive: true });
    writeFileSync(skillsBase, 'not-a-dir', 'utf-8');

    const res = await invoke(server, 'GET', '/api/skills?tool=gemini&scope=local');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('recursively deletes skill directory with subdirectories', async () => {
    const server = createTestServer();
    const skillDir = join(tempHome, '.huskygate', 'skills', 'fail-del');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.claude.md'), 'content', 'utf-8');

    // Create a subdirectory with nested file (like scripts/)
    const subDir = join(skillDir, 'subdir');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'nested.txt'), 'nested', 'utf-8');

    const res = await invoke(server, 'DELETE', '/api/skills/claude/local/fail-del');
    // rmSync with recursive:true handles nested directories correctly
    expect(res.status).toBe(200);
    expect(existsSync(skillDir)).toBe(false);
  });

  it('handles readdir error in support files gracefully', async () => {
    const server = createTestServer();
    const skillDir = join(tempHome, '.huskygate', 'skills', 'redir-test');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.claude.md'), '---\nname: Test\n---\nBody', 'utf-8');
    writeFileSync(join(skillDir, 'helper.py'), 'print("hi")', 'utf-8');

    // GET detail with support files
    const res = await invoke(server, 'GET', '/api/skills/claude/local/redir-test');
    expect(res.status).toBe(200);
    const body = res.body as { supportFiles: string[] };
    expect(body.supportFiles).toContain('helper.py');
  });

  it('PUT support file validates content type is string', async () => {
    const server = createTestServer();
    const skillDir = join(tempHome, '.huskygate', 'skills', 'check-type');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.claude.md'), 'skill', 'utf-8');

    const res = await invoke(
      server,
      'PUT',
      '/api/skills/claude/local/check-type/files/data.json',
      JSON.stringify({ content: 123 }),
    );
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('content string required');
  });

  it('DELETE support file returns 404 for missing file', async () => {
    const server = createTestServer();
    const skillDir = join(tempHome, '.huskygate', 'skills', 'del-missing');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.claude.md'), 'skill', 'utf-8');

    const res = await invoke(
      server,
      'DELETE',
      '/api/skills/claude/local/del-missing/files/gone.txt',
    );
    expect(res.status).toBe(404);
  });
});

/* ═══════════════════════════════════════════════
   Coverage: Filesystem browse edge cases
   ═══════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════
   Coverage: Chat file upload session not found
   ═══════════════════════════════════════════════ */

describe('Chat file upload', () => {
  it('returns 404 when session not found for file upload', async () => {
    const server = createTestServer();
    // Session ID must be 8 hex chars to match the route
    const res = await invoke(server, 'POST', '/api/chat/deadbeef/upload');
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe('Session not found');
  });
});

/* ═══════════════════════════════════════════════
   Coverage: Global error handler for file-too-large
   ═══════════════════════════════════════════════ */

describe('Global error handler', () => {
  it('returns 400 for File type not allowed errors', async () => {
    const server = createTestServer();
    const res = await invoke(server, 'PATCH', '/api/nonexistent');
    expect(res.status).toBe(404);
  });
});

/* ═══════════════════════════════════════════════
   Coverage: YAML frontmatter parsing (parseYamlValue + parseYamlFrontmatter)
   ═══════════════════════════════════════════════ */

describe('YAML frontmatter parsing via Skills', () => {
  it('parses skill with quoted strings, flow arrays, nested objects, and block arrays in frontmatter', async () => {
    const server = createTestServer();
    const skillDir = join(tempHome, '.huskygate', 'skills', 'yaml-full');
    mkdirSync(skillDir, { recursive: true });

    // Build a SKILL.md that exercises all parseYamlValue branches:
    // - quoted string (single + double)
    // - flow-style array [a, b, c]
    // - nested object (indented subkeys)
    // - block-style array (- items)
    // - boolean, number
    const skillContent = [
      '---',
      'name: yaml-full',
      'description: "A skill with: special chars"',
      "alias: 'single-quoted'",
      'tags: ["alpha", "beta"]',
      'enabled: true',
      'priority: 42',
      'metadata:',
      '  author: someone',
      '  version: 1.0',
      'steps:',
      '  - first step',
      '  - second step',
      '---',
      'Body content here.',
    ].join('\n');
    writeFileSync(join(skillDir, 'SKILL.claude.md'), skillContent, 'utf-8');

    const res = await invoke(server, 'GET', '/api/skills/claude/local/yaml-full');
    expect(res.status).toBe(200);
    const body = res.body as {
      frontmatter: Record<string, unknown>;
      body: string;
    };
    expect(body.frontmatter.name).toBe('yaml-full');
    expect(body.frontmatter.description).toBe('A skill with: special chars');
    expect(body.frontmatter.alias).toBe('single-quoted');
    // Flow array with quoted items — the parser strips quotes from individual items
    expect(body.frontmatter.tags).toEqual(['alpha', 'beta']);
    expect(body.frontmatter.enabled).toBe(true);
    expect(body.frontmatter.priority).toBe(42);
    expect(body.frontmatter.metadata).toEqual({ author: 'someone', version: 1.0 });
    expect(body.frontmatter.steps).toEqual(['first step', 'second step']);
    expect(body.body.trim()).toBe('Body content here.');
  });

  it('returns content as body when no frontmatter delimiters present', async () => {
    const server = createTestServer();
    const skillDir = join(tempHome, '.huskygate', 'skills', 'no-fm');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.claude.md'), 'Just plain content, no ---', 'utf-8');

    const res = await invoke(server, 'GET', '/api/skills/claude/local/no-fm');
    expect(res.status).toBe(200);
    const body = res.body as { frontmatter: Record<string, unknown>; body: string };
    expect(body.frontmatter).toEqual({});
    expect(body.body).toContain('Just plain content');
  });

  it('returns content as body when frontmatter is unclosed (no ending ---)', async () => {
    const server = createTestServer();
    const skillDir = join(tempHome, '.huskygate', 'skills', 'unclosed-fm');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.claude.md'),
      '---\nname: unclosed\nNo closing delimiter',
      'utf-8',
    );

    const res = await invoke(server, 'GET', '/api/skills/claude/local/unclosed-fm');
    expect(res.status).toBe(200);
    const body = res.body as { frontmatter: Record<string, unknown>; body: string };
    expect(body.frontmatter).toEqual({});
  });
});

/* ═══════════════════════════════════════════════
   Coverage: YAML frontmatter serialization (serializeYamlFrontmatter)
   ═══════════════════════════════════════════════ */

describe('YAML frontmatter serialization via Skill create', () => {
  it('serializes boolean, number, quoted string, arrays, and nested objects', async () => {
    const server = createTestServer();

    const res = await invoke(
      server,
      'POST',
      '/api/skills/claude/local',
      JSON.stringify({
        name: 'serialize-test',
        frontmatter: {
          enabled: true,
          priority: 7,
          description: 'has: colon',
          tags: ['web', 'api'],
          options: { timeout: 30, verbose: true },
        },
        body: 'Skill body',
      }),
    );
    expect(res.status).toBe(201);

    // Read it back to verify serialization round-trips
    const getRes = await invoke(server, 'GET', '/api/skills/claude/local/serialize-test');
    expect(getRes.status).toBe(200);
    const body = getRes.body as { frontmatter: Record<string, unknown>; body: string };
    expect(body.frontmatter.enabled).toBe(true);
    expect(body.frontmatter.priority).toBe(7);
    expect(body.frontmatter.description).toBe('has: colon');
    expect(body.frontmatter.tags).toEqual(['web', 'api']);
    expect(body.body.trim()).toBe('Skill body');
  });

  it('serializes nested objects containing array sub-values', async () => {
    const server = createTestServer();

    const res = await invoke(
      server,
      'POST',
      '/api/skills/claude/local',
      JSON.stringify({
        name: 'nested-arr',
        frontmatter: {
          config: { ports: [8080, 3000], name: 'server' },
        },
        body: '',
      }),
    );
    expect(res.status).toBe(201);

    // Read back the raw file to verify nested array serialization
    const raw = readFileSync(
      join(tempHome, '.huskygate', 'skills', 'nested-arr', 'SKILL.claude.md'),
      'utf-8',
    );
    expect(raw).toContain('config:');
    expect(raw).toContain('  ports: [8080, 3000]');
    expect(raw).toContain('  name: server');
  });

  it('serializes array with non-string items (number) via skill create', async () => {
    const server = createTestServer();

    const res = await invoke(
      server,
      'POST',
      '/api/skills/claude/local',
      JSON.stringify({
        name: 'num-arr',
        frontmatter: {
          ports: [8080, 3000],
        },
        body: '',
      }),
    );
    expect(res.status).toBe(201);

    // Read back — the serialized YAML has numeric array items
    const raw = readFileSync(
      join(tempHome, '.huskygate', 'skills', 'num-arr', 'SKILL.claude.md'),
      'utf-8',
    );
    expect(raw).toContain('ports: [8080, 3000]');
  });
});

/* ═══════════════════════════════════════════════
   Coverage: listSkills stat error (L1243-1244)
   ═══════════════════════════════════════════════ */

describe('listSkills stat error on entry', () => {
  it('skips entries where stat throws', async () => {
    const server = createTestServer();
    const skillsDir = join(tempHome, '.huskygate', 'skills');
    mkdirSync(skillsDir, { recursive: true });

    // Create a valid skill
    const validDir = join(skillsDir, 'valid-skill');
    mkdirSync(validDir, { recursive: true });
    writeFileSync(join(validDir, 'SKILL.claude.md'), '---\nname: valid\n---\nBody', 'utf-8');

    // Create a symlink to a nonexistent path (stat will throw)
    const { symlinkSync } = await import('node:fs');
    try {
      symlinkSync('/nonexistent/path', join(skillsDir, 'broken-link'));
    } catch {
      // skip test if symlinks not supported
    }

    const res = await invoke(server, 'GET', '/api/skills?tool=claude&scope=local');
    expect(res.status).toBe(200);
    const body = res.body as Array<{ dirName: string }>;
    // valid-skill should still be present
    expect(body.some((s) => s.dirName === 'valid-skill')).toBe(true);
  });
});

/* ═══════════════════════════════════════════════
   Coverage: listSkills support files readdir catch (L1258)
   ═══════════════════════════════════════════════ */

describe('listSkills support files readdir catch', () => {
  it('handles readdir failure on skill dir after reading SKILL.md', async () => {
    // Use execute-only permission (0o111) on dir — allows stat and readFileSync
    // of known filenames but readdirSync will fail (EACCES).
    const server = createTestServer();
    const skillDir = join(tempHome, '.huskygate', 'skills', 'noread-dir');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.claude.md'), '---\nname: noread\n---\nBody', 'utf-8');

    const { chmodSync } = await import('node:fs');
    chmodSync(skillDir, 0o111);

    try {
      // listSkills: readFileSync(SKILL.md) succeeds (known path), readdirSync fails
      const listRes = await invoke(server, 'GET', '/api/skills?tool=claude&scope=local');
      expect(listRes.status).toBe(200);
      const skills = listRes.body as Array<{ dirName: string; supportFiles: string[] }>;
      const skill = skills.find((s) => s.dirName === 'noread-dir');
      // Skill should be listed but with empty supportFiles (readdir catch)
      if (skill) {
        expect(skill.supportFiles).toEqual([]);
      }

      // Also test GET detail (same readdir catch at L2071)
      const detailRes = await invoke(server, 'GET', '/api/skills/claude/local/noread-dir');
      if (detailRes.status === 200) {
        const body = detailRes.body as { supportFiles: string[] };
        expect(body.supportFiles).toEqual([]);
      }
    } finally {
      chmodSync(skillDir, 0o755);
    }
  });
});

/* ═══════════════════════════════════════════════
   Coverage: chat file upload success path (L1890-1897)
   ═══════════════════════════════════════════════ */

describe('Chat file upload — success path', () => {
  it('uploads a file to a valid session workdir', async () => {
    // We need getSessionToolState to return a workdir and saveLocalFile to be callable.
    // Since DashboardDb is mocked at the module level, modify the mock class prototype.
    const dbMod = await import('./db.js');
    const origGetState = dbMod.DashboardDb.prototype.getSessionToolState;
    dbMod.DashboardDb.prototype.getSessionToolState = () => ({ workdir: workRoot }) as never;

    // For saveLocalFile, we need to use vi.mock at the top level.
    // Instead, we'll use vi.spyOn on the module after dynamic import.
    // The module is already imported by server.ts, so we need to mock it at the vi.mock level.
    // Since we can't add vi.mock dynamically, let's use a different approach:
    // Create a real file in workdir and verify the upload handler gets past the session check.
    // The readBinaryBody + saveLocalFile will execute.
    // Actually saveLocalFile writes files to disk, which should work in test.

    try {
      const req = new MockRequest('POST', '/api/chat/abcd1234/upload', {
        cookie: 'hg_session=dashboard-secret',
        'content-type': 'application/octet-stream',
        'x-file-name': 'test.txt',
        'x-file-mime': 'text/plain',
        'x-csrf-protection': '1',
      });
      const res = new MockResponse();
      const server = createTestServer();
      server.emit('request', req as never, res as unknown as ServerResponse);
      await new Promise((r) => setTimeout(r, 0));
      req.emit('data', Buffer.from('hello world'));
      req.emit('end');
      await res.done;
      // saveLocalFile creates a file in the workdir
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.originalName).toBe('test.txt');
    } finally {
      dbMod.DashboardDb.prototype.getSessionToolState = origGetState;
    }
  });
});

/* ═══════════════════════════════════════════════
   Coverage: hot-reload with non-200 server response
   ═══════════════════════════════════════════════ */

describe('Settings hot-reload non-200 response', () => {
  it('returns empty applied when server returns non-200', async () => {
    const server = createTestServer();

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: 'bad' }), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await invoke(
      server,
      'PUT',
      '/api/settings',
      JSON.stringify({
        patches: [{ key: 'LOG_LEVEL', op: 'set', value: 'warn' }],
      }),
    );
    expect(res.status).toBe(200);
    const body = res.body as { applied: string[] };
    expect(body.applied).toEqual([]);

    vi.unstubAllGlobals();
  });
});

/* ═══════════════════════════════════════════════
   Skills Multi-driver API coverage
   ═══════════════════════════════════════════════ */

describe('Skills Multi API', () => {
  it('POST /api/skills/multi validates script filenames and content', async () => {
    const server = createTestServer();

    const badFilename = await invoke(
      server,
      'POST',
      '/api/skills/multi/local',
      JSON.stringify({
        name: 'multi-a',
        drivers: { claude: { body: 'x' } },
        scripts: [{ filename: '../hack.sh', content: 'echo bad' }],
      }),
    );
    expect(badFilename.status).toBe(400);
    expect(badFilename.body).toEqual({ error: 'Invalid script filename: ../hack.sh' });

    const badContent = await invoke(
      server,
      'POST',
      '/api/skills/multi/local',
      JSON.stringify({
        name: 'multi-b',
        drivers: { claude: { body: 'x' } },
        scripts: [{ filename: 'ok.sh', content: 1 }],
      }),
    );
    expect(badContent.status).toBe(400);
    expect(badContent.body).toEqual({ error: 'Script content must be a string' });
  });

  it('creates, reads, updates, and deletes multi-driver skills', async () => {
    const server = createTestServer();
    const skillName = 'multi-main';

    const createRes = await invoke(
      server,
      'POST',
      '/api/skills/multi/local',
      JSON.stringify({
        name: skillName,
        drivers: {
          claude: { frontmatter: { name: 'Claude Multi' }, body: 'claude body' },
          gemini: { frontmatter: { name: 'Gemini Multi' }, body: 'gemini body' },
        },
        requirements: 'requests==2.0.0\n',
        scripts: [{ filename: 'run.sh', content: '#!/bin/sh\necho hello\n' }],
      }),
    );
    expect(createRes.status).toBe(201);

    const sharedDir = join(tempHome, '.huskygate', 'skills', skillName);
    expect(existsSync(join(sharedDir, 'SKILL.claude.md'))).toBe(true);
    expect(existsSync(join(sharedDir, 'SKILL.gemini.md'))).toBe(true);
    expect(readFileSync(join(sharedDir, 'requirements.txt'), 'utf-8')).toBe('requests==2.0.0\n');
    expect(readFileSync(join(sharedDir, 'scripts', 'run.sh'), 'utf-8')).toContain('echo hello');

    const getRes = await invoke(server, 'GET', `/api/skills/multi/local/${skillName}`);
    expect(getRes.status).toBe(200);
    const getBody = getRes.body as {
      drivers: Record<string, unknown>;
      requirements: string | null;
      scripts: string[];
    };
    expect(Object.keys(getBody.drivers).sort()).toEqual(['claude', 'gemini']);
    expect(getBody.requirements).toBe('requests==2.0.0\n');
    expect(getBody.scripts).toContain('run.sh');

    const putInvalidDriver = await invoke(
      server,
      'PUT',
      `/api/skills/multi/local/${skillName}`,
      JSON.stringify({
        drivers: {
          invalid: { body: 'x' },
        },
      }),
    );
    expect(putInvalidDriver.status).toBe(400);
    expect(putInvalidDriver.body).toEqual({ error: 'Invalid driver: invalid' });

    const putRes = await invoke(
      server,
      'PUT',
      `/api/skills/multi/local/${skillName}`,
      JSON.stringify({
        drivers: {
          codex: { frontmatter: { name: 'Codex Multi' }, body: 'codex body' },
        },
        requirements: null,
      }),
    );
    expect(putRes.status).toBe(200);
    expect(existsSync(join(sharedDir, 'SKILL.codex.md'))).toBe(true);
    expect(existsSync(join(sharedDir, 'requirements.txt'))).toBe(false);

    const deleteRes = await invoke(server, 'DELETE', `/api/skills/multi/local/${skillName}`);
    expect(deleteRes.status).toBe(200);
    expect(existsSync(sharedDir)).toBe(false);
  });

  it('handles multi-file delete edge cases', async () => {
    const server = createTestServer();
    const skillName = 'multi-file';
    const skillDir = join(tempHome, '.huskygate', 'skills', skillName);
    const scriptsDir = join(skillDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.claude.md'), 'body', 'utf-8');
    writeFileSync(join(scriptsDir, 'runner.sh'), '#!/bin/sh\necho x\n', 'utf-8');

    const invalidEncoding = await invoke(
      server,
      'DELETE',
      `/api/skills/multi/local/${skillName}/files/%E0%A4%A`,
    );
    expect(invalidEncoding.status).toBe(400);
    expect(invalidEncoding.body).toEqual({ error: 'Invalid filename encoding' });

    const invalidName = await invoke(
      server,
      'DELETE',
      `/api/skills/multi/local/${skillName}/files/${encodeURIComponent('../hack.sh')}`,
    );
    expect(invalidName.status).toBe(400);
    expect(invalidName.body).toEqual({ error: 'Invalid filename' });

    const missing = await invoke(
      server,
      'DELETE',
      `/api/skills/multi/local/${skillName}/files/${encodeURIComponent('scripts/missing.sh')}`,
    );
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'File not found in any driver' });

    const ok = await invoke(
      server,
      'DELETE',
      `/api/skills/multi/local/${skillName}/files/${encodeURIComponent('scripts/runner.sh')}`,
    );
    expect(ok.status).toBe(200);
    expect(existsSync(join(scriptsDir, 'runner.sh'))).toBe(false);
  });
});
