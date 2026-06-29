/** @module tools/tool-state-utils — Generic toolState helpers for MCP preflight markers and auth failure messages */
import type { ToolState } from '../../session/types.js';

/**
 * Read a string value from toolState, returning null if missing, non-string, or empty.
 */
function readToolStateString(toolState: ToolState, key: string): string | null {
  const value = toolState[key];
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

// ---------------------------------------------------------------------------
// 4-3: Generic MCP preflight marker helpers
// ---------------------------------------------------------------------------

/**
 * Check if a toolState key matches a specific server name.
 * Shared pattern for is*McpPreflightVerified / is*McpPreflightBypassed.
 */
export function isMcpPreflightMarker(toolState: ToolState, key: string, server: string): boolean {
  return readToolStateString(toolState, key) === server;
}

/**
 * Return a new toolState with the given key set to the server name.
 * Shared pattern for mark*McpPreflightVerified / mark*McpPreflightInitialized.
 */
export function setMcpPreflightMarker(
  toolState: ToolState,
  key: string,
  server: string,
): ToolState {
  return { ...toolState, [key]: server };
}

// ---------------------------------------------------------------------------
// 4-5: Generic MCP auth message builders
// ---------------------------------------------------------------------------

/**
 * Build a generic "auth required" failure message for any driver.
 * Uses a template approach to avoid duplicating the format across claude/codex/gemini.
 */
export function formatMcpAuthGenericFailure(
  driverLabel: string,
  server: string,
  exitCode: number | null,
  errorKind: string | null,
  serverNotFoundHint?: string,
): string {
  const details = [
    errorKind ? `error=${errorKind}` : null,
    exitCode !== null ? `exit=${exitCode}` : null,
  ]
    .filter((v) => v !== null)
    .join(', ');
  const suffix = details ? ` (${details})` : '';
  if (errorKind === 'server_not_found' && serverNotFoundHint) {
    return serverNotFoundHint;
  }
  return `${driverLabel} MCP pre-auth check for \`${server}\` failed${suffix}. Resolve authentication in a local interactive terminal, then retry.`;
}
