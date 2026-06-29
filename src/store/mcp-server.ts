/** @module mcp-server — MCP server registry with per-tool config import and normalization. */
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { ToolName } from '../config.js';
import { parseToml } from '../shared/toml.js';
import { errorMessage } from '../utils/error.js';
import { logger } from '../utils/logger.js';

export type McpServerTool = ToolName;
export type McpServerTransport = 'stdio' | 'sse' | 'http';

export interface McpServerRecord {
  id: string;
  name: string;
  tool: McpServerTool;
  transport: McpServerTransport;
  definition: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalMcpConfigSource {
  tool: McpServerTool;
  filePath: string;
  exists: boolean;
  servers: Array<{
    name: string;
    transport: McpServerTransport;
    definition: Record<string, unknown>;
  }>;
  globalMcp?: Record<string, unknown>;
}

interface McpServerRow {
  id: string;
  name: string;
  tool: string;
  transport: string;
  definition: string;
  created_at: string;
  updated_at: string;
}

const MCP_PATH_KEYS: Record<McpServerTool, string> = {
  claude: 'CLAUDE_MCP_CONFIG_PATH',
  gemini: 'GEMINI_MCP_CONFIG_PATH',
  codex: 'CODEX_MCP_CONFIG_PATH',
};

const MCP_GLOBAL_IMPORT_METADATA_KEY = 'mcp_global_import_v1';

const ALLOWED_TRANSPORTS: Record<McpServerTool, readonly McpServerTransport[]> = {
  claude: ['stdio', 'sse', 'http'],
  gemini: ['stdio', 'sse'],
  codex: ['stdio', 'http'],
};

const CODEX_TOML_TO_CANONICAL: Record<string, string> = {
  bearer_token: 'bearerToken',
  bearer_token_env_var: 'bearerTokenEnvVar',
  http_headers: 'httpHeaders',
  env_http_headers: 'envHttpHeaders',
  enabled_tools: 'includeTools',
  disabled_tools: 'excludeTools',
  startup_timeout_sec: 'timeout',
  tool_timeout_sec: 'toolTimeout',
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMcpServerTransport(value: string): value is McpServerTransport {
  return value === 'stdio' || value === 'sse' || value === 'http';
}

function isMcpServerTool(value: string): value is McpServerTool {
  return value === 'claude' || value === 'gemini' || value === 'codex';
}

function resolveConfiguredPath(rawValue: string | undefined, fallbackPath: string): string {
  const configured = rawValue?.trim();
  if (!configured) return fallbackPath;
  return path.isAbsolute(configured) ? configured : path.join(homedir(), configured);
}

function parseDefinition(row: McpServerRow): Record<string, unknown> {
  const parsed = JSON.parse(row.definition) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid MCP server definition for ${row.id}`);
  }
  return parsed as Record<string, unknown>;
}

function mapRow(row: McpServerRow): McpServerRecord {
  return {
    id: row.id,
    name: row.name,
    tool: isMcpServerTool(row.tool) ? row.tool : 'claude',
    transport: isMcpServerTransport(row.transport) ? row.transport : 'stdio',
    definition: parseDefinition(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStringArray(value: unknown, keyName: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${keyName} must be an array of strings`);
  }
  return value;
}

function toStringMap(value: unknown, keyName: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) {
    throw new Error(`${keyName} must be an object`);
  }
  const result: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== 'string') {
      throw new Error(`${keyName}.${key} must be a string`);
    }
    result[key] = rawValue;
  }
  return result;
}

function safeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function explicitTransport(value: unknown): McpServerTransport | undefined {
  const transport = safeString(value);
  return transport && isMcpServerTransport(transport) ? transport : undefined;
}

export function detectTransport(definition: Record<string, unknown>): McpServerTransport {
  const explicit = explicitTransport(definition.type);
  if (explicit) return explicit;
  if (safeString(definition.command)) return 'stdio';
  if (safeString(definition.httpUrl)) return 'http';
  if (safeString(definition.url)) {
    return definition.bearer_token !== undefined ||
      definition.bearerToken !== undefined ||
      definition.bearer_token_env_var !== undefined ||
      definition.bearerTokenEnvVar !== undefined
      ? 'http'
      : 'sse';
  }
  return 'stdio';
}

function detectGeminiTransport(definition: Record<string, unknown>): McpServerTransport {
  const explicit = explicitTransport(definition.type);
  if (explicit) return explicit;
  if (safeString(definition.command)) return 'stdio';
  if (safeString(definition.url) || safeString(definition.httpUrl)) return 'sse';
  return 'stdio';
}

function detectCodexTransport(definition: Record<string, unknown>): McpServerTransport {
  const explicit = explicitTransport(definition.type);
  if (explicit) return explicit;
  if (safeString(definition.command)) return 'stdio';
  if (safeString(definition.url) || safeString(definition.httpUrl)) return 'http';
  return 'stdio';
}

function normalizeCodexTomlDefinition(
  rawDefinition: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawDefinition)) {
    result[CODEX_TOML_TO_CANONICAL[key] ?? key] = value;
  }
  return result;
}

/** Remove keys from a shallow-copied record without triggering V8 deopt via `delete`. */
function omitKeys(obj: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const excluded = new Set(keys);
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !excluded.has(k)));
}

/** Keys that are transport metadata or transport-irrelevant aliases. */
const META_KEYS = ['id', 'tool', 'transport', 'type'] as const;
const NETWORK_ONLY_KEYS = [
  'url',
  'httpUrl',
  'headers',
  'httpHeaders',
  'bearer_token',
  'bearerToken',
  'bearer_token_env_var',
  'bearerTokenEnvVar',
  'scopes',
] as const;
const STDIO_ONLY_KEYS = ['command', 'args', 'cwd', 'env'] as const;

function normalizeClaudeDefinition(
  rawDefinition: Record<string, unknown>,
  explicitTransport?: string,
): { transport: McpServerTransport; definition: Record<string, unknown> } {
  const resolvedTransport = explicitTransport ?? detectTransport(rawDefinition);
  if (
    !isMcpServerTransport(resolvedTransport) ||
    !ALLOWED_TRANSPORTS.claude.includes(resolvedTransport)
  ) {
    throw new Error('transport must be stdio, sse, or http');
  }
  const transport: McpServerTransport = resolvedTransport;

  const base = omitKeys(rawDefinition, META_KEYS);

  if (transport === 'stdio') {
    const command = safeString(base.command);
    if (!command) throw new Error('stdio definition.command is required');
    const definition = omitKeys(base, [...NETWORK_ONLY_KEYS]);
    definition.command = command;
    const args = toStringArray(base.args, 'stdio definition.args');
    if (args !== undefined) definition.args = args;
    const env = toStringMap(base.env, 'env');
    if (env !== undefined) definition.env = env;
    const cwd = safeString(base.cwd);
    if (cwd !== undefined) definition.cwd = cwd;
    return { transport, definition };
  }

  const url = safeString(base.url) ?? safeString(base.httpUrl);
  if (!url) throw new Error(`${transport} definition.url is required`);
  const definition = omitKeys(base, [
    ...STDIO_ONLY_KEYS,
    'httpUrl',
    'httpHeaders',
    'bearer_token',
    'bearerToken',
    'bearer_token_env_var',
    'bearerTokenEnvVar',
    'scopes',
  ]);
  definition.url = url;

  const headers =
    toStringMap(base.headers, 'headers') ?? toStringMap(base.httpHeaders, 'headers') ?? {};
  const bearerToken = safeString(base.bearer_token) ?? safeString(base.bearerToken);
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }
  if (Object.keys(headers).length > 0) {
    definition.headers = headers;
  }
  return { transport, definition };
}

const GEMINI_NETWORK_ONLY_KEYS = ['url', 'httpUrl', 'oauth', 'authProvider'] as const;

function normalizeGeminiDefinition(
  rawDefinition: Record<string, unknown>,
  explicitTransport?: string,
): { transport: McpServerTransport; definition: Record<string, unknown> } {
  const resolvedTransport = explicitTransport ?? detectGeminiTransport(rawDefinition);
  if (
    !isMcpServerTransport(resolvedTransport) ||
    !ALLOWED_TRANSPORTS.gemini.includes(resolvedTransport)
  ) {
    throw new Error('transport must be stdio or sse');
  }
  const transport: McpServerTransport = resolvedTransport;

  const base = omitKeys(rawDefinition, META_KEYS);

  if (transport === 'stdio') {
    const command = safeString(base.command);
    if (!command) throw new Error('stdio definition.command is required');
    const definition = omitKeys(base, [...GEMINI_NETWORK_ONLY_KEYS]);
    definition.command = command;
    const args = toStringArray(base.args, 'stdio definition.args');
    if (args !== undefined) definition.args = args;
    const env = toStringMap(base.env, 'env');
    if (env !== undefined) definition.env = env;
    const cwd = safeString(base.cwd);
    if (cwd !== undefined) definition.cwd = cwd;
    if (definition.timeout !== undefined && typeof definition.timeout !== 'number') {
      throw new Error('timeout must be a number');
    }
    const excludeTools = toStringArray(base.excludeTools, 'excludeTools');
    if (excludeTools !== undefined) definition.excludeTools = excludeTools;
    return { transport, definition };
  }

  const url = safeString(base.url) ?? safeString(base.httpUrl);
  if (!url) throw new Error('sse definition.url is required');
  const definition = omitKeys(base, [...STDIO_ONLY_KEYS, 'httpUrl']);
  definition.url = url;
  if (definition.timeout !== undefined && typeof definition.timeout !== 'number') {
    throw new Error('timeout must be a number');
  }
  const excludeTools = toStringArray(base.excludeTools, 'excludeTools');
  if (excludeTools !== undefined) definition.excludeTools = excludeTools;
  const authProvider = safeString(base.authProvider);
  if (authProvider !== undefined) definition.authProvider = authProvider;
  if (base.oauth !== undefined && !isPlainRecord(base.oauth)) {
    throw new Error('oauth must be an object');
  }
  return { transport, definition };
}

/** Snake_case alias keys that must be stripped after normalizing to camelCase equivalents. */
const CODEX_ALIAS_KEYS = [
  'bearer_token',
  'bearer_token_env_var',
  'http_headers',
  'env_http_headers',
] as const;

function normalizeCodexDefinition(
  rawDefinition: Record<string, unknown>,
  explicitTransport?: string,
): { transport: McpServerTransport; definition: Record<string, unknown> } {
  const resolvedTransport = explicitTransport ?? detectCodexTransport(rawDefinition);
  if (
    !isMcpServerTransport(resolvedTransport) ||
    !ALLOWED_TRANSPORTS.codex.includes(resolvedTransport)
  ) {
    throw new Error('transport must be stdio or http');
  }
  const transport: McpServerTransport = resolvedTransport;

  const base = omitKeys(rawDefinition, [...META_KEYS, ...CODEX_ALIAS_KEYS]);

  let definition: Record<string, unknown>;
  if (transport === 'stdio') {
    const command = safeString(base.command);
    if (!command) throw new Error('stdio definition.command is required');
    definition = omitKeys(base, ['url', 'httpUrl']);
    definition.command = command;
    const args = toStringArray(base.args, 'stdio definition.args');
    if (args !== undefined) definition.args = args;
    const env = toStringMap(base.env, 'env');
    if (env !== undefined) definition.env = env;
    const cwd = safeString(base.cwd);
    if (cwd !== undefined) definition.cwd = cwd;
  } else {
    const url = safeString(base.url) ?? safeString(rawDefinition.httpUrl as string | undefined);
    if (!url) throw new Error('http definition.url is required');
    definition = omitKeys(base, [...STDIO_ONLY_KEYS, 'httpUrl']);
    definition.url = url;
  }

  if (definition.timeout !== undefined && typeof definition.timeout !== 'number') {
    throw new Error('timeout must be a number');
  }
  if (definition.toolTimeout !== undefined && typeof definition.toolTimeout !== 'number') {
    throw new Error('toolTimeout must be a number');
  }
  if (definition.enabled !== undefined && typeof definition.enabled !== 'boolean') {
    throw new Error('enabled must be a boolean');
  }
  if (definition.required !== undefined && typeof definition.required !== 'boolean') {
    throw new Error('required must be a boolean');
  }
  const includeTools = toStringArray(base.includeTools, 'includeTools');
  if (includeTools !== undefined) definition.includeTools = includeTools;
  const excludeTools = toStringArray(base.excludeTools, 'excludeTools');
  if (excludeTools !== undefined) definition.excludeTools = excludeTools;
  const scopes = toStringArray(base.scopes, 'scopes');
  if (scopes !== undefined) definition.scopes = scopes;
  const bearerToken =
    safeString(rawDefinition.bearerToken as string | undefined) ??
    safeString(rawDefinition.bearer_token as string | undefined);
  if (bearerToken !== undefined) definition.bearerToken = bearerToken;
  const bearerTokenEnvVar =
    safeString(rawDefinition.bearerTokenEnvVar as string | undefined) ??
    safeString(rawDefinition.bearer_token_env_var as string | undefined);
  if (bearerTokenEnvVar !== undefined) definition.bearerTokenEnvVar = bearerTokenEnvVar;
  const httpHeaders =
    toStringMap(rawDefinition.httpHeaders, 'httpHeaders') ??
    toStringMap(rawDefinition.http_headers, 'httpHeaders') ??
    undefined;
  if (httpHeaders !== undefined) definition.httpHeaders = httpHeaders;
  const envHttpHeaders =
    toStringMap(rawDefinition.envHttpHeaders, 'envHttpHeaders') ??
    toStringMap(rawDefinition.env_http_headers, 'envHttpHeaders') ??
    undefined;
  if (envHttpHeaders !== undefined) definition.envHttpHeaders = envHttpHeaders;
  return { transport, definition };
}

export function normalizeMcpServerDefinition(
  tool: McpServerTool,
  rawDefinition: unknown,
  explicitTransport?: string,
): { transport: McpServerTransport; definition: Record<string, unknown> } {
  if (!isPlainRecord(rawDefinition)) {
    throw new Error('definition must be an object');
  }

  switch (tool) {
    case 'claude':
      return normalizeClaudeDefinition(rawDefinition, explicitTransport);
    case 'gemini':
      return normalizeGeminiDefinition(rawDefinition, explicitTransport);
    case 'codex':
      return normalizeCodexDefinition(rawDefinition, explicitTransport);
  }
  const exhaustive: never = tool;
  throw new Error(`Unsupported MCP tool: ${exhaustive}`);
}

export function resolveGlobalMcpConfigPath(tool: McpServerTool): string {
  const home = homedir();
  switch (tool) {
    case 'claude':
      return resolveConfiguredPath(
        process.env[MCP_PATH_KEYS.claude],
        path.join(home, '.claude.json'),
      );
    case 'gemini':
      return resolveConfiguredPath(
        process.env[MCP_PATH_KEYS.gemini],
        path.join(home, '.gemini', 'settings.json'),
      );
    case 'codex':
      return resolveConfiguredPath(
        process.env[MCP_PATH_KEYS.codex],
        path.join(home, '.codex', 'config.toml'),
      );
  }
}

export function readGlobalMcpConfigSource(tool: McpServerTool): GlobalMcpConfigSource {
  const filePath = resolveGlobalMcpConfigPath(tool);
  if (!existsSync(filePath)) {
    return { tool, filePath, exists: false, servers: [] };
  }

  try {
    if (tool === 'codex') {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = parseToml(raw) as Record<string, unknown>;
      const rawServers = isPlainRecord(parsed.mcp_servers)
        ? (parsed.mcp_servers as Record<string, unknown>)
        : {};
      const servers = Object.entries(rawServers).flatMap(([name, rawDefinition]) => {
        try {
          const normalized = normalizeCodexDefinition(
            normalizeCodexTomlDefinition(
              isPlainRecord(rawDefinition) ? rawDefinition : ({} as Record<string, unknown>),
            ),
          );
          return [{ name, transport: normalized.transport, definition: normalized.definition }];
        } catch (err) {
          logger.warn('mcp_global_config_server_parse_failed', {
            tool,
            filePath,
            server: name,
            error: errorMessage(err),
          });
          return [];
        }
      });
      return { tool, filePath, exists: true, servers };
    }

    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const rawServers = isPlainRecord(parsed.mcpServers)
      ? (parsed.mcpServers as Record<string, unknown>)
      : {};
    const servers = Object.entries(rawServers).flatMap(([name, rawDefinition]) => {
      try {
        const normalized = normalizeMcpServerDefinition(tool, rawDefinition);
        return [{ name, transport: normalized.transport, definition: normalized.definition }];
      } catch (err) {
        logger.warn('mcp_global_config_server_parse_failed', {
          tool,
          filePath,
          server: name,
          error: errorMessage(err),
        });
        return [];
      }
    });
    const source: GlobalMcpConfigSource = { tool, filePath, exists: true, servers };
    if (tool === 'gemini' && isPlainRecord(parsed.mcp)) {
      source.globalMcp = parsed.mcp;
    }
    return source;
  } catch (err) {
    logger.warn('mcp_global_config_read_failed', {
      tool,
      filePath,
      error: errorMessage(err),
    });
    return { tool, filePath, exists: false, servers: [] };
  }
}

/** CRUD for registered MCP servers, with one-time global config import. */
export class McpServerStore {
  private readonly stmts: {
    countAll: Database.Statement;
    listAll: Database.Statement;
    listByTool: Database.Statement;
    getById: Database.Statement;
    getByName: Database.Statement;
    insert: Database.Statement;
    update: Database.Statement;
    delete: Database.Statement;
    deleteByTool: Database.Statement;
    deleteSessionOverridesByServer: Database.Statement;
    deleteSessionOverridesByTool: Database.Statement;
    getMetadata: Database.Statement;
    upsertMetadata: Database.Statement;
  };

  constructor(private readonly db: Database.Database) {
    this.stmts = {
      countAll: db.prepare('SELECT COUNT(*) AS count FROM mcp_servers'),
      listAll: db.prepare('SELECT * FROM mcp_servers ORDER BY tool, name'),
      listByTool: db.prepare('SELECT * FROM mcp_servers WHERE tool = ? ORDER BY name'),
      getById: db.prepare('SELECT * FROM mcp_servers WHERE id = ?'),
      getByName: db.prepare('SELECT * FROM mcp_servers WHERE tool = ? AND name = ?'),
      insert: db.prepare(
        `INSERT INTO mcp_servers (
          id, name, tool, transport, definition, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ),
      update: db.prepare(
        'UPDATE mcp_servers SET transport = ?, definition = ?, updated_at = ? WHERE id = ?',
      ),
      delete: db.prepare('DELETE FROM mcp_servers WHERE id = ?'),
      deleteByTool: db.prepare('DELETE FROM mcp_servers WHERE tool = ?'),
      deleteSessionOverridesByServer: db.prepare(
        'DELETE FROM session_mcp_servers WHERE server_id = ?',
      ),
      deleteSessionOverridesByTool: db.prepare(
        `DELETE FROM session_mcp_servers
          WHERE server_id IN (SELECT id FROM mcp_servers WHERE tool = ?)`,
      ),
      getMetadata: db.prepare('SELECT value FROM metadata WHERE key = ?'),
      upsertMetadata: db.prepare(
        `INSERT INTO metadata (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ),
    };
  }

  private countAll(): number {
    const row = this.stmts.countAll.get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  private getMetadata(key: string): string | null {
    const row = this.stmts.getMetadata.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setMetadata(key: string, value: string): void {
    this.stmts.upsertMetadata.run(key, value, new Date().toISOString());
  }

  listAll(): McpServerRecord[] {
    const rows = this.stmts.listAll.all() as McpServerRow[];
    return rows.map(mapRow);
  }

  listByTool(tool: McpServerTool): McpServerRecord[] {
    const rows = this.stmts.listByTool.all(tool) as McpServerRow[];
    return rows.map(mapRow);
  }

  getById(id: string): McpServerRecord | null {
    const row = this.stmts.getById.get(id) as McpServerRow | undefined;
    return row ? mapRow(row) : null;
  }

  getByName(name: string, tool: McpServerTool): McpServerRecord | null {
    const row = this.stmts.getByName.get(tool, name) as McpServerRow | undefined;
    return row ? mapRow(row) : null;
  }

  create(input: {
    name: string;
    tool: McpServerTool;
    transport: McpServerTransport;
    definition: Record<string, unknown>;
  }): McpServerRecord {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.stmts.insert.run(
      id,
      input.name,
      input.tool,
      input.transport,
      JSON.stringify(input.definition),
      now,
      now,
    );
    return {
      id,
      name: input.name,
      tool: input.tool,
      transport: input.transport,
      definition: input.definition,
      createdAt: now,
      updatedAt: now,
    };
  }

  update(
    id: string,
    updates: {
      transport: McpServerTransport;
      definition: Record<string, unknown>;
    },
  ): McpServerRecord | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const updatedAt = new Date().toISOString();
    this.stmts.update.run(updates.transport, JSON.stringify(updates.definition), updatedAt, id);
    return {
      ...existing,
      transport: updates.transport,
      definition: updates.definition,
      updatedAt,
    };
  }

  replaceAllForTool(
    tool: McpServerTool,
    servers: ReadonlyArray<{
      name: string;
      transport: McpServerTransport;
      definition: Record<string, unknown>;
    }>,
  ): McpServerRecord[] {
    const replaceTxn = this.db.transaction(
      (
        rows: ReadonlyArray<{
          name: string;
          transport: McpServerTransport;
          definition: Record<string, unknown>;
        }>,
      ) => {
        // Collect old server IDs before deletion to scrub from orchestrator nodes
        const oldIds = new Set(
          (this.stmts.listByTool.all(tool) as McpServerRow[]).map((r) => r.id),
        );
        this.stmts.deleteSessionOverridesByTool.run(tool);
        this.scrubServerIdsFromNodes(oldIds);
        this.stmts.deleteByTool.run(tool);
        return rows.map((row) => this.create({ ...row, tool }));
      },
    );
    return replaceTxn(servers);
  }

  delete(id: string): boolean {
    const deleteTxn = this.db.transaction(() => {
      this.stmts.deleteSessionOverridesByServer.run(id);
      this.scrubServerIdFromNodes(id);
      return this.stmts.delete.run(id).changes > 0;
    });
    return deleteTxn();
  }

  /**
   * Remove a single server ID from all orchestrator_nodes.enabled_mcp_server_ids JSON arrays.
   * If the array becomes empty after removal, set to null (inherit session defaults).
   */
  private scrubServerIdFromNodes(serverId: string): void {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare(
        'SELECT id, enabled_mcp_server_ids FROM orchestrator_nodes WHERE enabled_mcp_server_ids IS NOT NULL',
      )
      .all() as Array<{ id: string; enabled_mcp_server_ids: string }>;
    const updateStmt = this.db.prepare(
      'UPDATE orchestrator_nodes SET enabled_mcp_server_ids = ?, updated_at = ? WHERE id = ?',
    );
    for (const row of rows) {
      let ids: unknown;
      try {
        ids = JSON.parse(row.enabled_mcp_server_ids);
      } catch {
        continue;
      }
      if (!Array.isArray(ids) || !ids.includes(serverId)) continue;
      const filtered = ids.filter((id: unknown) => id !== serverId);
      updateStmt.run(filtered.length > 0 ? JSON.stringify(filtered) : null, now, row.id);
    }
  }

  /**
   * Remove multiple server IDs from all orchestrator_nodes.enabled_mcp_server_ids JSON arrays.
   */
  private scrubServerIdsFromNodes(serverIds: ReadonlySet<string>): void {
    if (serverIds.size === 0) return;
    const now = new Date().toISOString();
    const rows = this.db
      .prepare(
        'SELECT id, enabled_mcp_server_ids FROM orchestrator_nodes WHERE enabled_mcp_server_ids IS NOT NULL',
      )
      .all() as Array<{ id: string; enabled_mcp_server_ids: string }>;
    const updateStmt = this.db.prepare(
      'UPDATE orchestrator_nodes SET enabled_mcp_server_ids = ?, updated_at = ? WHERE id = ?',
    );
    for (const row of rows) {
      let ids: unknown;
      try {
        ids = JSON.parse(row.enabled_mcp_server_ids);
      } catch {
        continue;
      }
      if (!Array.isArray(ids)) continue;
      const filtered = ids.filter((id: unknown) => typeof id === 'string' && !serverIds.has(id));
      if (filtered.length === ids.length) continue;
      updateStmt.run(filtered.length > 0 ? JSON.stringify(filtered) : null, now, row.id);
    }
  }

  importFromGlobalConfigs(): {
    imported: number;
    skipped: number;
    alreadyImported: boolean;
  } {
    if (this.getMetadata(MCP_GLOBAL_IMPORT_METADATA_KEY)) {
      return { imported: 0, skipped: 0, alreadyImported: true };
    }

    const sources = [
      readGlobalMcpConfigSource('claude'),
      readGlobalMcpConfigSource('gemini'),
      readGlobalMcpConfigSource('codex'),
    ];

    let imported = 0;
    let skipped = 0;
    const importTxn = this.db.transaction(() => {
      for (const source of sources) {
        for (const server of source.servers) {
          if (this.getByName(server.name, source.tool)) {
            skipped += 1;
            continue;
          }
          try {
            this.create({
              name: server.name,
              tool: source.tool,
              transport: server.transport,
              definition: server.definition,
            });
            imported += 1;
          } catch (err) {
            const message = errorMessage(err);
            if (message.includes('UNIQUE constraint') || message.includes('PRIMARY KEY')) {
              skipped += 1;
              continue;
            }
            skipped += 1;
            logger.warn('mcp_global_config_import_server_failed', {
              tool: source.tool,
              server: server.name,
              error: message,
            });
          }
        }
      }
      this.setMetadata(
        MCP_GLOBAL_IMPORT_METADATA_KEY,
        JSON.stringify({
          imported,
          skipped,
          existingRows: this.countAll(),
          completedAt: new Date().toISOString(),
        }),
      );
    });
    importTxn();

    if (imported > 0 || skipped > 0) {
      logger.info('mcp_global_config_import_completed', { imported, skipped });
    }

    return { imported, skipped, alreadyImported: false };
  }
}
