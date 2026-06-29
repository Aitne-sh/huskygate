import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureSchema } from './database.js';
import {
  McpServerStore,
  detectTransport,
  normalizeMcpServerDefinition,
  readGlobalMcpConfigSource,
} from './mcp-server.js';

const tempDirs: string[] = [];
const ORIGINAL_MCP_PATH_ENV = {
  CLAUDE_MCP_CONFIG_PATH: process.env.CLAUDE_MCP_CONFIG_PATH,
  GEMINI_MCP_CONFIG_PATH: process.env.GEMINI_MCP_CONFIG_PATH,
  CODEX_MCP_CONFIG_PATH: process.env.CODEX_MCP_CONFIG_PATH,
};

function createDb(): Database.Database {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-mcp-store-'));
  tempDirs.push(dir);
  const db = new Database(path.join(dir, 'test.db'));
  ensureSchema(db);
  return db;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const [key, value] of Object.entries(ORIGINAL_MCP_PATH_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('McpServerStore', () => {
  it('creates and lists records by tool', () => {
    const db = createDb();
    const store = new McpServerStore(db);

    const created = store.create({
      name: 'aws-api',
      tool: 'claude',
      transport: 'http',
      definition: {
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer secret' },
      },
    });

    expect(created.id).toBeTruthy();
    expect(store.listByTool('claude')).toHaveLength(1);
    expect(store.listByTool('gemini')).toHaveLength(0);

    db.close();
  });

  it('updates records in place', () => {
    const db = createDb();
    const store = new McpServerStore(db);
    const created = store.create({
      name: 'aws-api',
      tool: 'claude',
      transport: 'stdio',
      definition: { command: 'node', args: ['server.js'] },
    });

    const updated = store.update(created.id, {
      transport: 'sse',
      definition: { url: 'https://example.com/sse' },
    });

    expect(updated?.transport).toBe('sse');
    expect(updated?.definition).toEqual({ url: 'https://example.com/sse' });
    expect(store.getByName('aws-api', 'claude')?.transport).toBe('sse');

    db.close();
  });

  it('replaces all records for a tool transactionally', () => {
    const db = createDb();
    const store = new McpServerStore(db);
    store.create({
      name: 'old',
      tool: 'claude',
      transport: 'stdio',
      definition: { command: 'node' },
    });
    store.create({
      name: 'gemini-old',
      tool: 'gemini',
      transport: 'stdio',
      definition: { command: 'node' },
    });

    const replaced = store.replaceAllForTool('claude', [
      {
        name: 'new-one',
        transport: 'http',
        definition: { url: 'https://example.com/mcp' },
      },
    ]);

    expect(replaced).toHaveLength(1);
    expect(store.listByTool('claude').map((row) => row.name)).toEqual(['new-one']);
    expect(store.listByTool('gemini').map((row) => row.name)).toEqual(['gemini-old']);

    db.close();
  });

  it('deletes records by id', () => {
    const db = createDb();
    const store = new McpServerStore(db);
    const created = store.create({
      name: 'aws-api',
      tool: 'claude',
      transport: 'stdio',
      definition: { command: 'node' },
    });

    expect(store.delete(created.id)).toBe(true);
    expect(store.getById(created.id)).toBeNull();

    db.close();
  });

  it('delete scrubs server ID from orchestrator_nodes.enabled_mcp_server_ids', () => {
    const db = createDb();
    const store = new McpServerStore(db);

    const s1 = store.create({
      name: 'srv1',
      tool: 'claude',
      transport: 'stdio',
      definition: { command: 'a' },
    });
    const s2 = store.create({
      name: 'srv2',
      tool: 'claude',
      transport: 'stdio',
      definition: { command: 'b' },
    });
    const s3 = store.create({
      name: 'srv3',
      tool: 'claude',
      transport: 'stdio',
      definition: { command: 'c' },
    });

    // Insert orchestrator nodes referencing the servers
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO orchestrator_nodes (id, orchestrator_id, label, enabled_mcp_server_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('node-1', 'orch-1', 'Node 1', JSON.stringify([s1.id, s2.id, s3.id]), now, now);
    db.prepare(
      `INSERT INTO orchestrator_nodes (id, orchestrator_id, label, enabled_mcp_server_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('node-2', 'orch-1', 'Node 2', JSON.stringify([s2.id]), now, now);
    db.prepare(
      `INSERT INTO orchestrator_nodes (id, orchestrator_id, label, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('node-3', 'orch-1', 'Node 3 (null)', now, now);

    // Delete s2 — should scrub from node-1 and null out node-2
    store.delete(s2.id);

    const getIds = (nodeId: string) => {
      const row = db
        .prepare('SELECT enabled_mcp_server_ids FROM orchestrator_nodes WHERE id = ?')
        .get(nodeId) as { enabled_mcp_server_ids: string | null };
      return row.enabled_mcp_server_ids ? JSON.parse(row.enabled_mcp_server_ids) : null;
    };

    expect(getIds('node-1')).toEqual([s1.id, s3.id]);
    expect(getIds('node-2')).toBeNull(); // became empty → null
    expect(getIds('node-3')).toBeNull(); // was already null

    db.close();
  });

  it('replaceAllForTool scrubs old server IDs from orchestrator nodes', () => {
    const db = createDb();
    const store = new McpServerStore(db);

    const s1 = store.create({
      name: 'srv1',
      tool: 'claude',
      transport: 'stdio',
      definition: { command: 'a' },
    });
    const s2 = store.create({
      name: 'srv2',
      tool: 'claude',
      transport: 'stdio',
      definition: { command: 'b' },
    });
    const gemini = store.create({
      name: 'gsrv',
      tool: 'gemini',
      transport: 'stdio',
      definition: { command: 'g' },
    });

    const now = new Date().toISOString();
    // Node references both claude servers and one gemini server
    db.prepare(
      `INSERT INTO orchestrator_nodes (id, orchestrator_id, label, enabled_mcp_server_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('node-mix', 'orch-1', 'Mixed', JSON.stringify([s1.id, s2.id, gemini.id]), now, now);

    // Replace all claude servers — old IDs should be scrubbed, gemini ID remains
    store.replaceAllForTool('claude', [
      { name: 'new-srv', transport: 'stdio', definition: { command: 'new' } },
    ]);

    const row = db
      .prepare('SELECT enabled_mcp_server_ids FROM orchestrator_nodes WHERE id = ?')
      .get('node-mix') as { enabled_mcp_server_ids: string | null };
    const ids = row.enabled_mcp_server_ids ? JSON.parse(row.enabled_mcp_server_ids) : null;
    expect(ids).toEqual([gemini.id]);

    db.close();
  });

  it('merges missing phase2 servers into a phase1-populated DB without overwriting existing rows', () => {
    const db = createDb();
    const store = new McpServerStore(db);
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-mcp-import-'));
    tempDirs.push(configDir);

    store.create({
      name: 'claude_srv',
      tool: 'claude',
      transport: 'stdio',
      definition: { command: 'existing-claude' },
    });

    const claudePath = path.join(configDir, 'claude.json');
    const geminiPath = path.join(configDir, 'settings.json');
    const codexPath = path.join(configDir, 'config.toml');
    fs.writeFileSync(
      claudePath,
      JSON.stringify({
        mcpServers: {
          claude_srv: {
            command: 'global-claude',
          },
          claude_extra: {
            command: 'global-claude-extra',
          },
        },
      }),
      'utf-8',
    );
    fs.writeFileSync(
      geminiPath,
      JSON.stringify({
        mcpServers: {
          gemini_srv: {
            httpUrl: 'https://gemini.example/mcp',
            authProvider: 'oauth',
            oauth: { enabled: true },
          },
        },
      }),
      'utf-8',
    );
    fs.writeFileSync(
      codexPath,
      [
        '[mcp_servers.codex_srv]',
        'url = "https://codex.example/mcp"',
        'env_http_headers = { Authorization = "CODEX_TOKEN" }',
        'startup_timeout_sec = 15',
      ].join('\n'),
      'utf-8',
    );

    process.env.CLAUDE_MCP_CONFIG_PATH = claudePath;
    process.env.GEMINI_MCP_CONFIG_PATH = geminiPath;
    process.env.CODEX_MCP_CONFIG_PATH = codexPath;

    const first = store.importFromGlobalConfigs();
    expect(first).toEqual({ imported: 3, skipped: 1, alreadyImported: false });

    expect(store.getByName('claude_srv', 'claude')).toMatchObject({
      transport: 'stdio',
      definition: {
        command: 'existing-claude',
      },
    });
    expect(store.getByName('claude_extra', 'claude')).toMatchObject({
      transport: 'stdio',
      definition: {
        command: 'global-claude-extra',
      },
    });
    expect(store.getByName('gemini_srv', 'gemini')).toMatchObject({
      transport: 'sse',
      definition: {
        url: 'https://gemini.example/mcp',
        authProvider: 'oauth',
        oauth: { enabled: true },
      },
    });
    expect(store.getByName('codex_srv', 'codex')).toMatchObject({
      transport: 'http',
      definition: {
        url: 'https://codex.example/mcp',
        envHttpHeaders: { Authorization: 'CODEX_TOKEN' },
        timeout: 15,
      },
    });

    for (const record of store.listAll()) {
      store.delete(record.id);
    }
    const second = store.importFromGlobalConfigs();
    expect(second).toEqual({ imported: 0, skipped: 0, alreadyImported: true });
    expect(store.listAll()).toEqual([]);

    db.close();
  });

  it('update returns null for non-existing record', () => {
    const db = createDb();
    const store = new McpServerStore(db);

    const result = store.update('non-existent-id', {
      transport: 'http',
      definition: { url: 'https://example.com' },
    });

    expect(result).toBeNull();
    db.close();
  });

  it('scrubServerIdFromNodes handles invalid JSON in enabled_mcp_server_ids gracefully', () => {
    const db = createDb();
    const store = new McpServerStore(db);

    const s1 = store.create({
      name: 'srv1',
      tool: 'claude',
      transport: 'stdio',
      definition: { command: 'a' },
    });

    const now = new Date().toISOString();
    // Insert a node with invalid JSON for enabled_mcp_server_ids
    db.prepare(
      `INSERT INTO orchestrator_nodes (id, orchestrator_id, label, enabled_mcp_server_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('node-bad-json', 'orch-1', 'Bad JSON', '{not-valid-json}', now, now);

    // Should not throw — the bad JSON row is skipped
    expect(() => store.delete(s1.id)).not.toThrow();

    // The bad-json node should remain untouched
    const row = db
      .prepare('SELECT enabled_mcp_server_ids FROM orchestrator_nodes WHERE id = ?')
      .get('node-bad-json') as { enabled_mcp_server_ids: string | null };
    expect(row.enabled_mcp_server_ids).toBe('{not-valid-json}');

    db.close();
  });

  it('scrubServerIdFromNodes skips when parsed JSON is valid but not an array', () => {
    const db = createDb();
    const store = new McpServerStore(db);

    const s1 = store.create({
      name: 'srv1',
      tool: 'claude',
      transport: 'stdio',
      definition: { command: 'a' },
    });

    const now = new Date().toISOString();
    // Insert a node with valid JSON that is not an array (an object)
    db.prepare(
      `INSERT INTO orchestrator_nodes (id, orchestrator_id, label, enabled_mcp_server_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('node-obj', 'orch-1', 'Object', JSON.stringify({ key: 'value' }), now, now);

    // Should not throw — the non-array row is skipped
    expect(() => store.delete(s1.id)).not.toThrow();

    // The node should remain untouched
    const row = db
      .prepare('SELECT enabled_mcp_server_ids FROM orchestrator_nodes WHERE id = ?')
      .get('node-obj') as { enabled_mcp_server_ids: string | null };
    expect(JSON.parse(row.enabled_mcp_server_ids ?? '')).toEqual({ key: 'value' });

    db.close();
  });

  it('scrubServerIdsFromNodes handles invalid JSON, non-array JSON, and no-match nodes', () => {
    const db = createDb();
    const store = new McpServerStore(db);

    // Create servers for two tools
    const s1 = store.create({
      name: 'srv1',
      tool: 'claude',
      transport: 'stdio',
      definition: { command: 'a' },
    });
    const s2 = store.create({
      name: 'srv2',
      tool: 'claude',
      transport: 'stdio',
      definition: { command: 'b' },
    });

    const now = new Date().toISOString();
    // Node with invalid JSON
    db.prepare(
      `INSERT INTO orchestrator_nodes (id, orchestrator_id, label, enabled_mcp_server_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('node-bad', 'orch-1', 'Bad', 'not-json', now, now);
    // Node with valid JSON but not an array (an object)
    db.prepare(
      `INSERT INTO orchestrator_nodes (id, orchestrator_id, label, enabled_mcp_server_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('node-obj', 'orch-1', 'Object', JSON.stringify({ foo: 'bar' }), now, now);
    // Node with IDs that don't match any being removed
    db.prepare(
      `INSERT INTO orchestrator_nodes (id, orchestrator_id, label, enabled_mcp_server_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'node-no-match',
      'orch-1',
      'NoMatch',
      JSON.stringify(['other-id-1', 'other-id-2']),
      now,
      now,
    );
    // Node with all IDs being removed (should become null)
    db.prepare(
      `INSERT INTO orchestrator_nodes (id, orchestrator_id, label, enabled_mcp_server_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('node-all-removed', 'orch-1', 'AllRemoved', JSON.stringify([s1.id, s2.id]), now, now);

    // Replace removes old IDs via scrubServerIdsFromNodes
    store.replaceAllForTool('claude', []);

    const getIds = (nodeId: string) => {
      const row = db
        .prepare('SELECT enabled_mcp_server_ids FROM orchestrator_nodes WHERE id = ?')
        .get(nodeId) as { enabled_mcp_server_ids: string | null };
      return row.enabled_mcp_server_ids;
    };

    expect(getIds('node-bad')).toBe('not-json'); // skipped due to parse error
    expect(getIds('node-obj')).toBe(JSON.stringify({ foo: 'bar' })); // skipped (not an array)
    expect(getIds('node-no-match')).toBe(JSON.stringify(['other-id-1', 'other-id-2'])); // no match → unchanged
    expect(getIds('node-all-removed')).toBeNull(); // empty → null

    db.close();
  });

  it('scrubServerIdsFromNodes skips when serverIds set is empty', () => {
    const db = createDb();
    const store = new McpServerStore(db);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO orchestrator_nodes (id, orchestrator_id, label, enabled_mcp_server_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('node-keep', 'orch-1', 'Keep', JSON.stringify(['some-id']), now, now);

    // replaceAllForTool with no existing servers = empty set → early return, nothing scrubbed
    store.replaceAllForTool('gemini', []);

    const row = db
      .prepare('SELECT enabled_mcp_server_ids FROM orchestrator_nodes WHERE id = ?')
      .get('node-keep') as { enabled_mcp_server_ids: string | null };
    expect(JSON.parse(row.enabled_mcp_server_ids ?? '')).toEqual(['some-id']);

    db.close();
  });

  it('importFromGlobalConfigs handles UNIQUE constraint errors from create gracefully', () => {
    const db = createDb();
    const store = new McpServerStore(db);
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-mcp-import-unique-'));
    tempDirs.push(configDir);

    const claudePath = path.join(configDir, 'claude.json');
    fs.writeFileSync(
      claudePath,
      JSON.stringify({
        mcpServers: {
          srv: { command: 'node' },
        },
      }),
      'utf-8',
    );
    process.env.CLAUDE_MCP_CONFIG_PATH = claudePath;
    process.env.GEMINI_MCP_CONFIG_PATH = path.join(configDir, 'nonexistent.json');
    process.env.CODEX_MCP_CONFIG_PATH = path.join(configDir, 'nonexistent.toml');

    // Spy on create to throw a UNIQUE constraint error on the first call
    let callCount = 0;
    const originalCreate = store.create.bind(store);
    vi.spyOn(store, 'create').mockImplementation((input) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('UNIQUE constraint failed: mcp_servers.name, mcp_servers.tool');
      }
      return originalCreate(input);
    });

    const result = store.importFromGlobalConfigs();
    // The UNIQUE constraint error should be caught and counted as skipped
    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(0);
    expect(result.alreadyImported).toBe(false);

    db.close();
  });

  it('importFromGlobalConfigs handles non-UNIQUE create errors gracefully', () => {
    const db = createDb();
    const store = new McpServerStore(db);
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-mcp-import-err-'));
    tempDirs.push(configDir);

    const claudePath = path.join(configDir, 'claude.json');
    fs.writeFileSync(
      claudePath,
      JSON.stringify({
        mcpServers: {
          srv: { command: 'node' },
        },
      }),
      'utf-8',
    );
    process.env.CLAUDE_MCP_CONFIG_PATH = claudePath;
    process.env.GEMINI_MCP_CONFIG_PATH = path.join(configDir, 'nonexistent.json');
    process.env.CODEX_MCP_CONFIG_PATH = path.join(configDir, 'nonexistent.toml');

    // Spy on create to throw a non-UNIQUE error
    vi.spyOn(store, 'create').mockImplementation(() => {
      throw new Error('disk I/O error');
    });

    const result = store.importFromGlobalConfigs();
    // Non-UNIQUE errors should also be counted as skipped (but logged)
    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(0);
    expect(result.alreadyImported).toBe(false);

    db.close();
  });

  it('importFromGlobalConfigs handles PRIMARY KEY error as skipped', () => {
    const db = createDb();
    const store = new McpServerStore(db);
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-mcp-import-pk-'));
    tempDirs.push(configDir);

    const claudePath = path.join(configDir, 'claude.json');
    fs.writeFileSync(
      claudePath,
      JSON.stringify({
        mcpServers: {
          srv: { command: 'node' },
        },
      }),
      'utf-8',
    );
    process.env.CLAUDE_MCP_CONFIG_PATH = claudePath;
    process.env.GEMINI_MCP_CONFIG_PATH = path.join(configDir, 'nonexistent.json');
    process.env.CODEX_MCP_CONFIG_PATH = path.join(configDir, 'nonexistent.toml');

    // Spy on create to throw a PRIMARY KEY error
    vi.spyOn(store, 'create').mockImplementation(() => {
      throw new Error('PRIMARY KEY constraint failed');
    });

    const result = store.importFromGlobalConfigs();
    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(0);

    db.close();
  });

  it('throws when stored definition JSON is not a valid object', () => {
    const db = createDb();
    const store = new McpServerStore(db);
    const now = new Date().toISOString();

    // Insert a row with an array as definition (invalid — must be object)
    db.prepare(
      `INSERT INTO mcp_servers (id, name, tool, transport, definition, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('bad-def-id', 'bad-srv', 'claude', 'stdio', '[1,2,3]', now, now);

    expect(() => store.getById('bad-def-id')).toThrow(
      'Invalid MCP server definition for bad-def-id',
    );

    db.close();
  });

  it('maps unknown tool/transport values to defaults', () => {
    const db = createDb();
    const store = new McpServerStore(db);
    const now = new Date().toISOString();

    // Insert a row with unknown tool and transport values
    db.prepare(
      `INSERT INTO mcp_servers (id, name, tool, transport, definition, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('unknown-id', 'unknown-srv', 'unknown-tool', 'websocket', '{"command":"node"}', now, now);

    const record = store.getById('unknown-id');
    expect(record).not.toBeNull();
    expect(record?.tool).toBe('claude'); // defaults to claude
    expect(record?.transport).toBe('stdio'); // defaults to stdio

    db.close();
  });
});

describe('detectTransport', () => {
  it('detects stdio from command', () => {
    expect(detectTransport({ command: 'node' })).toBe('stdio');
  });

  it('detects http from httpUrl', () => {
    expect(detectTransport({ httpUrl: 'https://example.com/mcp' })).toBe('http');
  });

  it('detects sse from url without bearer token', () => {
    expect(detectTransport({ url: 'https://example.com/sse' })).toBe('sse');
  });

  it('detects http from url with bearer_token', () => {
    expect(detectTransport({ url: 'https://example.com/mcp', bearer_token: 'tok' })).toBe('http');
  });

  it('detects http from url with bearerToken', () => {
    expect(detectTransport({ url: 'https://example.com/mcp', bearerToken: 'tok' })).toBe('http');
  });

  it('detects http from url with bearer_token_env_var', () => {
    expect(detectTransport({ url: 'https://example.com/mcp', bearer_token_env_var: 'TOKEN' })).toBe(
      'http',
    );
  });

  it('detects http from url with bearerTokenEnvVar', () => {
    expect(detectTransport({ url: 'https://example.com/mcp', bearerTokenEnvVar: 'TOKEN' })).toBe(
      'http',
    );
  });

  it('uses explicit transport type when provided', () => {
    expect(detectTransport({ type: 'sse' })).toBe('sse');
    expect(detectTransport({ type: 'http' })).toBe('http');
    expect(detectTransport({ type: 'stdio' })).toBe('stdio');
  });

  it('defaults to stdio when nothing matches', () => {
    expect(detectTransport({})).toBe('stdio');
  });
});

describe('normalizeMcpServerDefinition', () => {
  it('throws on non-object definition', () => {
    expect(() => normalizeMcpServerDefinition('claude', null)).toThrow(
      'definition must be an object',
    );
    expect(() => normalizeMcpServerDefinition('claude', 'string')).toThrow(
      'definition must be an object',
    );
    expect(() => normalizeMcpServerDefinition('claude', [1, 2])).toThrow(
      'definition must be an object',
    );
    expect(() => normalizeMcpServerDefinition('claude', undefined)).toThrow(
      'definition must be an object',
    );
  });

  describe('Claude normalization', () => {
    it('normalizes stdio with command, args, env, cwd', () => {
      const result = normalizeMcpServerDefinition('claude', {
        command: 'node',
        args: ['server.js', '--port', '3000'],
        env: { NODE_ENV: 'production' },
        cwd: '/opt/app',
      });
      expect(result.transport).toBe('stdio');
      expect(result.definition).toEqual({
        command: 'node',
        args: ['server.js', '--port', '3000'],
        env: { NODE_ENV: 'production' },
        cwd: '/opt/app',
      });
    });

    it('throws when stdio definition is missing command', () => {
      expect(() => normalizeMcpServerDefinition('claude', { type: 'stdio' })).toThrow(
        'stdio definition.command is required',
      );
    });

    it('treats whitespace-only command as missing', () => {
      expect(() => normalizeMcpServerDefinition('claude', { command: '   ' })).toThrow(
        'stdio definition.command is required',
      );
    });

    it('throws on invalid transport type', () => {
      expect(() => normalizeMcpServerDefinition('claude', { command: 'x' }, 'websocket')).toThrow(
        'transport must be stdio, sse, or http',
      );
    });

    it('throws when env contains non-string values', () => {
      expect(() =>
        normalizeMcpServerDefinition('claude', {
          command: 'node',
          env: { PORT: 3000 },
        }),
      ).toThrow('env.PORT must be a string');
    });

    it('throws when env is not an object', () => {
      expect(() =>
        normalizeMcpServerDefinition('claude', {
          command: 'node',
          env: 'not-an-object',
        }),
      ).toThrow('env must be an object');
    });

    it('throws when args is not a string array', () => {
      expect(() =>
        normalizeMcpServerDefinition('claude', {
          command: 'node',
          args: [1, 2, 3],
        }),
      ).toThrow('stdio definition.args must be an array of strings');
    });

    it('throws when args is not an array at all', () => {
      expect(() =>
        normalizeMcpServerDefinition('claude', {
          command: 'node',
          args: 'not-an-array',
        }),
      ).toThrow('stdio definition.args must be an array of strings');
    });

    it('normalizes sse with url and headers', () => {
      const result = normalizeMcpServerDefinition('claude', {
        url: 'https://example.com/sse',
        headers: { 'X-Api-Key': 'abc123' },
      });
      expect(result.transport).toBe('sse');
      expect(result.definition).toEqual({
        url: 'https://example.com/sse',
        headers: { 'X-Api-Key': 'abc123' },
      });
    });

    it('normalizes http with httpUrl', () => {
      const result = normalizeMcpServerDefinition('claude', {
        httpUrl: 'https://example.com/http',
      });
      expect(result.transport).toBe('http');
      expect(result.definition).toEqual({
        url: 'https://example.com/http',
      });
    });

    it('throws when sse/http definition has no url', () => {
      expect(() => normalizeMcpServerDefinition('claude', {}, 'sse')).toThrow(
        'sse definition.url is required',
      );
      expect(() => normalizeMcpServerDefinition('claude', {}, 'http')).toThrow(
        'http definition.url is required',
      );
    });

    it('normalizes http with bearerToken into Authorization header', () => {
      const result = normalizeMcpServerDefinition('claude', {
        url: 'https://example.com/http',
        bearerToken: 'my-token',
      });
      expect(result.transport).toBe('http');
      expect(result.definition.headers).toEqual({
        Authorization: 'Bearer my-token',
      });
    });

    it('normalizes http with bearer_token (snake_case) into Authorization header', () => {
      const result = normalizeMcpServerDefinition('claude', {
        url: 'https://example.com/http',
        bearer_token: 'my-token',
      });
      expect(result.transport).toBe('http');
      expect(result.definition.headers).toEqual({
        Authorization: 'Bearer my-token',
      });
    });

    it('normalizes sse/http with httpHeaders alias', () => {
      const result = normalizeMcpServerDefinition(
        'claude',
        {
          url: 'https://example.com/sse',
          httpHeaders: { 'X-Custom': 'value' },
        },
        'sse',
      );
      expect(result.definition.headers).toEqual({ 'X-Custom': 'value' });
    });

    it('uses explicit transport type from definition.type', () => {
      const result = normalizeMcpServerDefinition('claude', {
        type: 'http',
        url: 'https://example.com/http',
      });
      expect(result.transport).toBe('http');
    });

    it('omits empty headers object', () => {
      const result = normalizeMcpServerDefinition('claude', {
        url: 'https://example.com/sse',
      });
      expect(result.definition.headers).toBeUndefined();
    });
  });

  describe('Gemini normalization', () => {
    it('throws on invalid transport (e.g. http)', () => {
      expect(() => normalizeMcpServerDefinition('gemini', { command: 'node' }, 'http')).toThrow(
        'transport must be stdio or sse',
      );
    });

    it('normalizes stdio with args, env, cwd, timeout, excludeTools', () => {
      const result = normalizeMcpServerDefinition('gemini', {
        command: 'python',
        args: ['-m', 'server'],
        env: { API_KEY: 'secret' },
        cwd: '/app',
        timeout: 30,
        excludeTools: ['dangerous-tool'],
      });
      expect(result.transport).toBe('stdio');
      expect(result.definition).toEqual({
        command: 'python',
        args: ['-m', 'server'],
        env: { API_KEY: 'secret' },
        cwd: '/app',
        timeout: 30,
        excludeTools: ['dangerous-tool'],
      });
    });

    it('throws when stdio has invalid timeout', () => {
      expect(() =>
        normalizeMcpServerDefinition('gemini', {
          command: 'node',
          timeout: 'invalid',
        }),
      ).toThrow('timeout must be a number');
    });

    it('throws when stdio definition is missing command (explicit type)', () => {
      expect(() => normalizeMcpServerDefinition('gemini', { type: 'stdio' })).toThrow(
        'stdio definition.command is required',
      );
    });

    it('defaults to stdio and throws when command is missing (no type, no url)', () => {
      expect(() => normalizeMcpServerDefinition('gemini', {})).toThrow(
        'stdio definition.command is required',
      );
    });

    it('normalizes sse with url, timeout, excludeTools, authProvider', () => {
      const result = normalizeMcpServerDefinition('gemini', {
        url: 'https://gemini.example/sse',
        timeout: 60,
        excludeTools: ['tool-a'],
        authProvider: 'oauth2',
      });
      expect(result.transport).toBe('sse');
      expect(result.definition).toMatchObject({
        url: 'https://gemini.example/sse',
        timeout: 60,
        excludeTools: ['tool-a'],
        authProvider: 'oauth2',
      });
    });

    it('normalizes sse with httpUrl', () => {
      const result = normalizeMcpServerDefinition('gemini', {
        httpUrl: 'https://gemini.example/sse',
      });
      expect(result.transport).toBe('sse');
      expect(result.definition.url).toBe('https://gemini.example/sse');
    });

    it('throws when sse has no url', () => {
      expect(() => normalizeMcpServerDefinition('gemini', {}, 'sse')).toThrow(
        'sse definition.url is required',
      );
    });

    it('throws when sse has invalid timeout', () => {
      expect(() =>
        normalizeMcpServerDefinition('gemini', {
          url: 'https://example.com/sse',
          timeout: 'bad',
        }),
      ).toThrow('timeout must be a number');
    });

    it('throws when sse has invalid oauth (not an object)', () => {
      expect(() =>
        normalizeMcpServerDefinition('gemini', {
          url: 'https://example.com/sse',
          oauth: 'not-an-object',
        }),
      ).toThrow('oauth must be an object');
    });

    it('passes valid oauth through', () => {
      const result = normalizeMcpServerDefinition('gemini', {
        url: 'https://example.com/sse',
        oauth: { clientId: 'abc', scope: 'read' },
      });
      expect(result.definition.oauth).toEqual({ clientId: 'abc', scope: 'read' });
    });

    it('uses explicit transport from type field', () => {
      const result = normalizeMcpServerDefinition('gemini', {
        type: 'sse',
        url: 'https://example.com/sse',
      });
      expect(result.transport).toBe('sse');
    });

    it('detects sse from url', () => {
      const result = normalizeMcpServerDefinition('gemini', {
        url: 'https://example.com/sse',
      });
      expect(result.transport).toBe('sse');
    });
  });

  describe('Codex normalization', () => {
    it('throws on invalid transport (e.g. sse)', () => {
      expect(() => normalizeMcpServerDefinition('codex', { command: 'node' }, 'sse')).toThrow(
        'transport must be stdio or http',
      );
    });

    it('normalizes stdio with args, env, cwd', () => {
      const result = normalizeMcpServerDefinition('codex', {
        command: 'node',
        args: ['serve.js'],
        env: { PORT: '3000' },
        cwd: '/srv',
      });
      expect(result.transport).toBe('stdio');
      expect(result.definition).toEqual({
        command: 'node',
        args: ['serve.js'],
        env: { PORT: '3000' },
        cwd: '/srv',
      });
    });

    it('throws when stdio definition is missing command (explicit type)', () => {
      expect(() => normalizeMcpServerDefinition('codex', { type: 'stdio' })).toThrow(
        'stdio definition.command is required',
      );
    });

    it('defaults to stdio and throws when command is missing (no type, no url)', () => {
      expect(() => normalizeMcpServerDefinition('codex', {})).toThrow(
        'stdio definition.command is required',
      );
    });

    it('normalizes http with url from httpUrl', () => {
      const result = normalizeMcpServerDefinition('codex', {
        httpUrl: 'https://codex.example/mcp',
      });
      expect(result.transport).toBe('http');
      expect(result.definition.url).toBe('https://codex.example/mcp');
    });

    it('normalizes http with url', () => {
      const result = normalizeMcpServerDefinition('codex', {
        url: 'https://codex.example/mcp',
      });
      expect(result.transport).toBe('http');
      expect(result.definition.url).toBe('https://codex.example/mcp');
    });

    it('throws when http definition has no url', () => {
      expect(() => normalizeMcpServerDefinition('codex', {}, 'http')).toThrow(
        'http definition.url is required',
      );
    });

    it('validates timeout must be a number', () => {
      expect(() =>
        normalizeMcpServerDefinition('codex', {
          url: 'https://example.com',
          timeout: 'bad',
        }),
      ).toThrow('timeout must be a number');
    });

    it('validates toolTimeout must be a number', () => {
      expect(() =>
        normalizeMcpServerDefinition('codex', {
          url: 'https://example.com',
          toolTimeout: 'bad',
        }),
      ).toThrow('toolTimeout must be a number');
    });

    it('validates enabled must be a boolean', () => {
      expect(() =>
        normalizeMcpServerDefinition('codex', {
          url: 'https://example.com',
          enabled: 'yes',
        }),
      ).toThrow('enabled must be a boolean');
    });

    it('validates required must be a boolean', () => {
      expect(() =>
        normalizeMcpServerDefinition('codex', {
          url: 'https://example.com',
          required: 1,
        }),
      ).toThrow('required must be a boolean');
    });

    it('normalizes includeTools, excludeTools, scopes arrays', () => {
      const result = normalizeMcpServerDefinition('codex', {
        url: 'https://example.com',
        includeTools: ['tool-a', 'tool-b'],
        excludeTools: ['tool-c'],
        scopes: ['read', 'write'],
      });
      expect(result.definition.includeTools).toEqual(['tool-a', 'tool-b']);
      expect(result.definition.excludeTools).toEqual(['tool-c']);
      expect(result.definition.scopes).toEqual(['read', 'write']);
    });

    it('normalizes snake_case bearer_token alias', () => {
      const result = normalizeMcpServerDefinition('codex', {
        url: 'https://example.com',
        bearer_token: 'my-token',
      });
      expect(result.definition.bearerToken).toBe('my-token');
    });

    it('normalizes camelCase bearerToken', () => {
      const result = normalizeMcpServerDefinition('codex', {
        url: 'https://example.com',
        bearerToken: 'my-token',
      });
      expect(result.definition.bearerToken).toBe('my-token');
    });

    it('normalizes snake_case bearer_token_env_var alias', () => {
      const result = normalizeMcpServerDefinition('codex', {
        url: 'https://example.com',
        bearer_token_env_var: 'MY_TOKEN',
      });
      expect(result.definition.bearerTokenEnvVar).toBe('MY_TOKEN');
    });

    it('normalizes camelCase bearerTokenEnvVar', () => {
      const result = normalizeMcpServerDefinition('codex', {
        url: 'https://example.com',
        bearerTokenEnvVar: 'MY_TOKEN',
      });
      expect(result.definition.bearerTokenEnvVar).toBe('MY_TOKEN');
    });

    it('normalizes snake_case http_headers alias', () => {
      const result = normalizeMcpServerDefinition('codex', {
        url: 'https://example.com',
        http_headers: { 'X-Key': 'value' },
      });
      expect(result.definition.httpHeaders).toEqual({ 'X-Key': 'value' });
    });

    it('normalizes camelCase httpHeaders', () => {
      const result = normalizeMcpServerDefinition('codex', {
        url: 'https://example.com',
        httpHeaders: { 'X-Key': 'value' },
      });
      expect(result.definition.httpHeaders).toEqual({ 'X-Key': 'value' });
    });

    it('normalizes snake_case env_http_headers alias', () => {
      const result = normalizeMcpServerDefinition('codex', {
        url: 'https://example.com',
        env_http_headers: { Authorization: 'TOKEN_VAR' },
      });
      expect(result.definition.envHttpHeaders).toEqual({ Authorization: 'TOKEN_VAR' });
    });

    it('normalizes camelCase envHttpHeaders', () => {
      const result = normalizeMcpServerDefinition('codex', {
        url: 'https://example.com',
        envHttpHeaders: { Authorization: 'TOKEN_VAR' },
      });
      expect(result.definition.envHttpHeaders).toEqual({ Authorization: 'TOKEN_VAR' });
    });

    it('detects http transport from url', () => {
      const result = normalizeMcpServerDefinition('codex', {
        url: 'https://codex.example/mcp',
      });
      expect(result.transport).toBe('http');
    });

    it('uses explicit transport type', () => {
      const result = normalizeMcpServerDefinition('codex', {
        type: 'http',
        url: 'https://codex.example/mcp',
      });
      expect(result.transport).toBe('http');
    });

    it('passes valid timeout and toolTimeout through', () => {
      const result = normalizeMcpServerDefinition('codex', {
        url: 'https://example.com',
        timeout: 30,
        toolTimeout: 60,
      });
      expect(result.definition.timeout).toBe(30);
      expect(result.definition.toolTimeout).toBe(60);
    });

    it('passes valid enabled and required through', () => {
      const result = normalizeMcpServerDefinition('codex', {
        url: 'https://example.com',
        enabled: true,
        required: false,
      });
      expect(result.definition.enabled).toBe(true);
      expect(result.definition.required).toBe(false);
    });
  });
});

describe('readGlobalMcpConfigSource', () => {
  it('returns exists: false when config file does not exist', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-mcp-read-'));
    tempDirs.push(configDir);
    // Point to a non-existent file
    process.env.CLAUDE_MCP_CONFIG_PATH = path.join(configDir, 'nonexistent.json');

    const result = readGlobalMcpConfigSource('claude');
    expect(result.exists).toBe(false);
    expect(result.servers).toEqual([]);
  });

  it('returns exists: false on parse errors (invalid JSON)', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-mcp-read-'));
    tempDirs.push(configDir);
    const filePath = path.join(configDir, 'bad.json');
    fs.writeFileSync(filePath, '{ invalid json }', 'utf-8');
    process.env.CLAUDE_MCP_CONFIG_PATH = filePath;

    const result = readGlobalMcpConfigSource('claude');
    expect(result.exists).toBe(false);
    expect(result.servers).toEqual([]);
  });

  it('parses Claude JSON config with mcpServers', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-mcp-read-'));
    tempDirs.push(configDir);
    const filePath = path.join(configDir, 'claude.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        mcpServers: {
          myServer: { command: 'node', args: ['srv.js'] },
        },
      }),
      'utf-8',
    );
    process.env.CLAUDE_MCP_CONFIG_PATH = filePath;

    const result = readGlobalMcpConfigSource('claude');
    expect(result.exists).toBe(true);
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]).toMatchObject({
      name: 'myServer',
      transport: 'stdio',
    });
  });

  it('skips individual servers that fail normalization in Claude config', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-mcp-read-'));
    tempDirs.push(configDir);
    const filePath = path.join(configDir, 'claude.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        mcpServers: {
          good: { command: 'node' },
          bad: 'not-an-object',
          alsoGood: { url: 'https://example.com/sse' },
        },
      }),
      'utf-8',
    );
    process.env.CLAUDE_MCP_CONFIG_PATH = filePath;

    const result = readGlobalMcpConfigSource('claude');
    expect(result.servers).toHaveLength(2);
    expect(result.servers.map((s) => s.name)).toEqual(['good', 'alsoGood']);
  });

  it('handles Claude config without mcpServers key', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-mcp-read-'));
    tempDirs.push(configDir);
    const filePath = path.join(configDir, 'claude.json');
    fs.writeFileSync(filePath, JSON.stringify({ otherKey: true }), 'utf-8');
    process.env.CLAUDE_MCP_CONFIG_PATH = filePath;

    const result = readGlobalMcpConfigSource('claude');
    expect(result.exists).toBe(true);
    expect(result.servers).toEqual([]);
  });

  it('parses Gemini JSON config and extracts globalMcp', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-mcp-read-'));
    tempDirs.push(configDir);
    const filePath = path.join(configDir, 'settings.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        mcpServers: {
          gServer: { command: 'python', args: ['-m', 'mcp'] },
        },
        mcp: { timeout: 60, retries: 3 },
      }),
      'utf-8',
    );
    process.env.GEMINI_MCP_CONFIG_PATH = filePath;

    const result = readGlobalMcpConfigSource('gemini');
    expect(result.exists).toBe(true);
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]?.name).toBe('gServer');
    expect(result.globalMcp).toEqual({ timeout: 60, retries: 3 });
  });

  it('does not set globalMcp for Gemini when mcp key is not a plain record', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-mcp-read-'));
    tempDirs.push(configDir);
    const filePath = path.join(configDir, 'settings.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        mcpServers: {},
        mcp: 'not-an-object',
      }),
      'utf-8',
    );
    process.env.GEMINI_MCP_CONFIG_PATH = filePath;

    const result = readGlobalMcpConfigSource('gemini');
    expect(result.globalMcp).toBeUndefined();
  });

  it('parses Codex TOML config', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-mcp-read-'));
    tempDirs.push(configDir);
    const filePath = path.join(configDir, 'config.toml');
    fs.writeFileSync(
      filePath,
      ['[mcp_servers.my_server]', 'command = "node"', 'args = ["serve.js"]'].join('\n'),
      'utf-8',
    );
    process.env.CODEX_MCP_CONFIG_PATH = filePath;

    const result = readGlobalMcpConfigSource('codex');
    expect(result.exists).toBe(true);
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]).toMatchObject({
      name: 'my_server',
      transport: 'stdio',
    });
  });

  it('skips individual Codex servers that fail normalization', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-mcp-read-'));
    tempDirs.push(configDir);
    const filePath = path.join(configDir, 'config.toml');
    // A server with no command and no url will fail stdio command check
    fs.writeFileSync(
      filePath,
      [
        '[mcp_servers.good_server]',
        'command = "node"',
        '',
        '[mcp_servers.bad_server]',
        'timeout = "not-a-number"',
      ].join('\n'),
      'utf-8',
    );
    process.env.CODEX_MCP_CONFIG_PATH = filePath;

    const result = readGlobalMcpConfigSource('codex');
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]?.name).toBe('good_server');
  });

  it('handles Codex TOML with no mcp_servers section', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-mcp-read-'));
    tempDirs.push(configDir);
    const filePath = path.join(configDir, 'config.toml');
    fs.writeFileSync(filePath, 'some_key = "value"\n', 'utf-8');
    process.env.CODEX_MCP_CONFIG_PATH = filePath;

    const result = readGlobalMcpConfigSource('codex');
    expect(result.exists).toBe(true);
    expect(result.servers).toEqual([]);
  });

  it('handles Codex TOML canonical alias translation', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-mcp-read-'));
    tempDirs.push(configDir);
    const filePath = path.join(configDir, 'config.toml');
    fs.writeFileSync(
      filePath,
      [
        '[mcp_servers.aliased]',
        'url = "https://example.com"',
        'bearer_token = "tok"',
        'bearer_token_env_var = "MY_VAR"',
        'startup_timeout_sec = 10',
        'tool_timeout_sec = 20',
        'enabled_tools = ["a", "b"]',
        'disabled_tools = ["c"]',
      ].join('\n'),
      'utf-8',
    );
    process.env.CODEX_MCP_CONFIG_PATH = filePath;

    const result = readGlobalMcpConfigSource('codex');
    expect(result.servers).toHaveLength(1);
    const def = result.servers[0]?.definition;
    expect(def?.bearerToken).toBe('tok');
    expect(def?.bearerTokenEnvVar).toBe('MY_VAR');
    expect(def?.timeout).toBe(10);
    expect(def?.toolTimeout).toBe(20);
    expect(def?.includeTools).toEqual(['a', 'b']);
    expect(def?.excludeTools).toEqual(['c']);
  });

  it('handles Codex TOML with non-record server definitions', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-mcp-read-'));
    tempDirs.push(configDir);
    const filePath = path.join(configDir, 'config.toml');
    // A TOML entry where the server value is a string, not a table
    // Since TOML parsing would make [mcp_servers] a section, we need a key that is not a table
    // In the code, isPlainRecord check would fail for a scalar → uses {} as fallback → fails on command
    fs.writeFileSync(
      filePath,
      ['[mcp_servers]', 'scalar_server = "not-a-table"'].join('\n'),
      'utf-8',
    );
    process.env.CODEX_MCP_CONFIG_PATH = filePath;

    const result = readGlobalMcpConfigSource('codex');
    // The scalar entry should fail normalization (no command, no url) and be skipped
    expect(result.exists).toBe(true);
    expect(result.servers).toHaveLength(0);
  });

  it('uses default fallback path when env var is not set', () => {
    // Ensure the env var is not set
    delete process.env.CLAUDE_MCP_CONFIG_PATH;

    const result = readGlobalMcpConfigSource('claude');
    // Default fallback path is ~/.claude.json; the file may or may not exist
    expect(result.filePath).toBe(path.join(os.homedir(), '.claude.json'));
  });

  it('uses relative path joined with homedir when env var is relative', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-mcp-read-'));
    tempDirs.push(configDir);
    // Set the env to a relative path — it should be joined with homedir
    // This won't find a real file, but it tests the resolveConfiguredPath branch
    process.env.CLAUDE_MCP_CONFIG_PATH = 'relative/config.json';

    const result = readGlobalMcpConfigSource('claude');
    // The resolved path should be under homedir, and since the file won't exist,
    // it returns exists: false
    expect(result.exists).toBe(false);
    expect(result.filePath).toBe(path.join(os.homedir(), 'relative/config.json'));
  });
});
