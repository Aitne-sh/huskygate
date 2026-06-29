/** @module tool-state — Safe JSON parsing of persisted tool-state blobs from the database */
import type { ToolState } from '../session/types.js';

/**
 * Safely parse a JSON-encoded tool state string.
 *
 * Returns an empty object on invalid JSON, non-object types, or arrays.
 * Used by both SessionManager (server process) and DashboardDb (dashboard process).
 *
 * @param raw - The raw JSON string from the database `sessions.tool_state` column.
 * @param onWarning - Optional callback for logging parse warnings.
 */
export function safeParseToolState(
  raw: string,
  onWarning?: (code: string, data: Record<string, unknown>) => void,
): ToolState {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as ToolState;
    }
    onWarning?.('tool_state_invalid_type', {
      type: typeof parsed,
      isArray: Array.isArray(parsed),
    });
    return {};
  } catch {
    onWarning?.('tool_state_parse_failed', { raw_length: raw.length });
    return {};
  }
}
