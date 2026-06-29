/** @module mcp-selection — Resolves effective MCP server selection for sessions and jobs based on store and policy */
import type { ToolName } from '../config.js';
import type { AppContext } from '../context/app-context.js';
import type { Job } from '../queue/types.js';
import {
  type ResolvedMcpServerSelection,
  resolveEffectiveMcpServerSelection,
  resolveSessionMcpServerSelection,
} from '../shared/mcp-server-selection.js';
import type { McpServerRecord } from '../store/mcp-server.js';

export interface ContextResolvedMcpServerSelection extends ResolvedMcpServerSelection {
  allServers: McpServerRecord[];
}

function emptySelection(): ContextResolvedMcpServerSelection {
  return {
    allServers: [],
    filterActive: false,
    enabledServers: [],
    enabledServerIds: new Set<string>(),
    enabledServerNames: new Set<string>(),
  };
}

export function resolveSessionMcpSelection(
  ctx: AppContext,
  sessionKey: string,
  tool: ToolName,
): ContextResolvedMcpServerSelection {
  const allServers = ctx.mcpServerStore.listByTool(tool);
  const sessionRows = ctx.sessionMcpServerStore.listBySession(sessionKey);
  return {
    allServers,
    ...resolveSessionMcpServerSelection(allServers, sessionRows),
  };
}

export function resolveJobMcpSelection(
  ctx: AppContext,
  job: Pick<Job, 'executionPolicy' | 'sessionKey' | 'tool'>,
): ContextResolvedMcpServerSelection {
  if (job.executionPolicy?.allowMcp === false) {
    return emptySelection();
  }

  const allServers = ctx.mcpServerStore.listByTool(job.tool);
  const sessionRows = ctx.sessionMcpServerStore.listBySession(job.sessionKey);
  return {
    allServers,
    ...resolveEffectiveMcpServerSelection(
      allServers,
      sessionRows,
      job.executionPolicy?.enabledMcpServerIds ?? null,
    ),
  };
}
