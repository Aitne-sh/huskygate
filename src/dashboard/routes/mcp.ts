/** @module dashboard/routes/mcp — Dashboard API routes for MCP server configuration. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type McpServerRecord,
  type McpServerTool,
  type McpServerTransport,
  normalizeMcpServerDefinition,
  readGlobalMcpConfigSource,
} from '../../store/mcp-server.js';
import { errorMessage } from '../../utils/error.js';
import { json, parseJson, readBody } from '../http.js';
import { maskMcpSecrets, unmaskMcpSecrets } from '../mcp-config.js';
import type { RouteContext } from '../route-context.js';

const MCP_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MCP_SERVER_ID_RE = /^\/api\/mcp\/servers\/([a-f0-9-]{36})$/;
interface McpServerInput {
  name?: string;
  tool?: string;
  transport?: string;
  definition?: Record<string, unknown>;
}

function isMcpToolName(value: string): value is McpServerTool {
  return value === 'claude' || value === 'gemini' || value === 'codex';
}

function matchMcpServerId(pathname: string): string | null {
  return pathname.match(MCP_SERVER_ID_RE)?.[1] ?? null;
}

function runtimeFilePath(tool: McpServerTool): string {
  switch (tool) {
    case 'claude':
      return 'SQLite -> <workdir>/.huskygate/claude.mcp.json';
    case 'gemini':
      return 'SQLite -> <workdir>/.gemini_runtime_home/.gemini/settings.json';
    case 'codex':
      return 'SQLite -> <workdir>/.codex_runtime_home/config.toml';
  }
}

function maskRecord(record: McpServerRecord) {
  return {
    id: record.id,
    name: record.name,
    tool: record.tool,
    transport: record.transport,
    definition: maskMcpSecrets(record.definition),
  };
}

function buildConfigResponse(ctx: RouteContext, tool: McpServerTool) {
  const records = ctx.getDb().listMcpServers(tool);
  const servers: Record<string, Record<string, unknown>> = {};
  for (const record of records) {
    servers[record.name] = {
      id: record.id,
      transport: record.transport,
      ...maskMcpSecrets(record.definition),
    };
  }

  const payload: Record<string, unknown> = {
    tool,
    filePath: runtimeFilePath(tool),
    exists: records.length > 0,
    format: tool === 'codex' ? 'toml' : 'json',
    servers,
  };

  if (tool === 'gemini') {
    const source = readGlobalMcpConfigSource('gemini');
    if (source.globalMcp) {
      payload.globalMcp = source.globalMcp;
    }
  }

  return payload;
}

function restoreMaskedSecrets(
  definition: Record<string, unknown>,
  existingDefinition?: Record<string, unknown>,
): Record<string, unknown> {
  return unmaskMcpSecrets(definition, existingDefinition ?? {});
}

function parseCreateBody(body: string): {
  name: string;
  tool: McpServerTool;
  transport: McpServerTransport;
  definition: Record<string, unknown>;
} {
  const parsed = parseJson<McpServerInput>(body);
  if (!parsed) {
    throw new Error('Invalid JSON');
  }
  const tool = (parsed.tool ?? 'claude').trim();
  if (!isMcpToolName(tool)) {
    throw new Error('Invalid tool');
  }
  if (typeof parsed.name !== 'string' || !MCP_NAME_RE.test(parsed.name)) {
    throw new Error('Invalid server name');
  }
  if (!('definition' in parsed) || parsed.definition === undefined) {
    throw new Error('definition required');
  }
  const normalized = normalizeMcpServerDefinition(tool, parsed.definition, parsed.transport);
  return {
    name: parsed.name,
    tool,
    transport: normalized.transport,
    definition: normalized.definition,
  };
}

function parseUpdateBody(
  body: string,
  tool: McpServerTool,
): { transport: McpServerTransport; definition: Record<string, unknown> } {
  const parsed = parseJson<McpServerInput>(body);
  if (!parsed) {
    throw new Error('Invalid JSON');
  }
  if (!('definition' in parsed) || parsed.definition === undefined) {
    throw new Error('definition required');
  }
  const normalized = normalizeMcpServerDefinition(tool, parsed.definition, parsed.transport);
  return {
    transport: normalized.transport,
    definition: normalized.definition,
  };
}

function handleStoreError(res: ServerResponse, err: unknown, duplicateName?: string): true {
  const message = errorMessage(err);
  if (
    message === 'Invalid JSON' ||
    message.endsWith('required') ||
    /\bmust be\b/.test(message) ||
    message.includes('Invalid')
  ) {
    json(res, 400, { error: message });
    return true;
  }
  if (message.includes('UNIQUE constraint') || message.includes('PRIMARY KEY')) {
    json(res, 409, { error: `Server '${duplicateName ?? 'record'}' already exists` });
    return true;
  }
  throw err;
}

export async function handleMcpRoutes(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  query: URLSearchParams,
): Promise<boolean> {
  if (req.method === 'GET' && pathname === '/api/mcp/servers') {
    const rawTool = query.get('tool')?.trim();
    if (rawTool) {
      if (!isMcpToolName(rawTool)) {
        json(res, 400, { error: 'Invalid tool' });
        return true;
      }
      json(res, 200, buildConfigResponse(ctx, rawTool));
    } else {
      // No tool filter — return all tools
      const allTools: McpServerTool[] = ['claude', 'gemini', 'codex'];
      const result = allTools.map((tool) => buildConfigResponse(ctx, tool));
      json(res, 200, result);
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/mcp/servers') {
    const body = await readBody(req);
    try {
      const parsed = parseCreateBody(body);
      const created = ctx.getDb().createMcpServer({
        name: parsed.name,
        tool: parsed.tool,
        transport: parsed.transport,
        definition: restoreMaskedSecrets(parsed.definition),
      });
      json(res, 201, { success: true, server: maskRecord(created) });
    } catch (err) {
      return handleStoreError(res, err, parseJson<McpServerInput>(body)?.name);
    }
    return true;
  }

  const serverId = matchMcpServerId(pathname);
  if (serverId && req.method === 'PUT') {
    const existing = ctx.getDb().getMcpServerById(serverId);
    if (!existing) {
      json(res, 404, { error: 'Server not found' });
      return true;
    }
    const body = await readBody(req);
    try {
      const parsed = parseUpdateBody(body, existing.tool);
      const updated = ctx.getDb().updateMcpServer(serverId, {
        transport: parsed.transport,
        definition: restoreMaskedSecrets(parsed.definition, existing.definition),
      });
      if (!updated) {
        json(res, 404, { error: 'Server not found' });
        return true;
      }
      json(res, 200, { success: true, server: maskRecord(updated) });
    } catch (err) {
      return handleStoreError(res, err);
    }
    return true;
  }

  if (serverId && req.method === 'DELETE') {
    if (!ctx.getDb().deleteMcpServer(serverId)) {
      json(res, 404, { error: 'Server not found' });
      return true;
    }
    json(res, 200, { success: true });
    return true;
  }

  return false;
}
