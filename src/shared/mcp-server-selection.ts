/** @module mcp-server-selection — Resolves effective MCP server selections from session and task-level overrides */
import type { McpServerRecord } from '../store/mcp-server.js';
import type { SessionMcpServerRecord } from '../store/session-mcp-server.js';
import { logger } from '../utils/logger.js';

export interface ResolvedMcpServerSelection {
  filterActive: boolean;
  enabledServers: McpServerRecord[];
  enabledServerIds: Set<string>;
  enabledServerNames: Set<string>;
}

function buildEnabledServerSet(rows: ReadonlyArray<SessionMcpServerRecord>): {
  filterActive: boolean;
  enabledIds: Set<string>;
} {
  if (rows.length === 0) {
    return { filterActive: false, enabledIds: new Set<string>() };
  }
  return {
    filterActive: true,
    enabledIds: new Set(rows.filter((row) => row.enabled).map((row) => row.serverId)),
  };
}

export function resolveSessionMcpServerSelection(
  allServers: ReadonlyArray<McpServerRecord>,
  sessionRows: ReadonlyArray<SessionMcpServerRecord>,
): ResolvedMcpServerSelection {
  const { filterActive, enabledIds } = buildEnabledServerSet(sessionRows);
  const enabledServers = filterActive
    ? allServers.filter((server) => enabledIds.has(server.id))
    : [...allServers];
  return {
    filterActive,
    enabledServers,
    enabledServerIds: new Set(enabledServers.map((server) => server.id)),
    enabledServerNames: new Set(enabledServers.map((server) => server.name)),
  };
}

export function resolveEffectiveMcpServerSelection(
  allServers: ReadonlyArray<McpServerRecord>,
  sessionRows: ReadonlyArray<SessionMcpServerRecord>,
  enabledMcpServerIds?: ReadonlyArray<string> | null,
): ResolvedMcpServerSelection {
  const sessionSelection = resolveSessionMcpServerSelection(allServers, sessionRows);
  if (enabledMcpServerIds == null) {
    return sessionSelection;
  }

  const knownIds = new Set(allServers.map((server) => server.id));
  for (const id of enabledMcpServerIds) {
    if (!knownIds.has(id)) {
      logger.warn('mcp_server_selection_invalid_id', {
        invalidServerId: id,
        requestedServerIds: [...enabledMcpServerIds],
        availableServerIds: [...knownIds],
      });
    }
  }

  const allowedIds = new Set(enabledMcpServerIds);
  const enabledServers = sessionSelection.enabledServers.filter((server) =>
    allowedIds.has(server.id),
  );
  return {
    filterActive: sessionSelection.filterActive,
    enabledServers,
    enabledServerIds: new Set(enabledServers.map((server) => server.id)),
    enabledServerNames: new Set(enabledServers.map((server) => server.name)),
  };
}
