/** @module slack/tool-plugin — ToolPlugin interface and registry for per-tool polymorphic dispatch. */
import type { Config, ToolName } from '../config.js';
import type { DriverEvent } from '../runner/types.js';
import type { ToolState } from '../session/types.js';
import type { PermissionDeniedSummary } from '../shared/tool-approval.js';

// ── Tool Plugin Interface ──
//
// Consolidates tool-specific branching into a single polymorphic dispatch.
// When adding a new tool, implement this interface instead of modifying
// branching logic across the codebase.

/**
 * Opaque approval gate. Each tool stores its own shape internally.
 */
export interface ApprovalGate {
  readonly __brand: 'ApprovalGate';
}

export interface ApprovalEvaluation {
  shouldBlock: boolean;
  gate: ApprovalGate;
}

export interface ToolPlugin {
  readonly name: ToolName;

  // ── MCP config ──
  getMcpAuthServer(config: Config): string | null;

  /**
   * Remove tool-specific MCP state keys when auth failure is detected.
   * Returns cleaned state.
   */
  clearMcpAuthState(merged: ToolState): ToolState;

  // ── Approval gate ──
  createApprovalGate(toolState: ToolState): ApprovalGate;
  evaluateToolUse(gate: ApprovalGate, event: DriverEvent): ApprovalEvaluation;
  buildPermissionDeniedSummary(gate: ApprovalGate): PermissionDeniedSummary | null;

  // ── Voluntary stop detection ──
  detectVoluntaryStop(
    events: DriverEvent[],
    textBuffer: string,
    hasDetectedPermissionDenied: boolean,
    hasProactivePermissionDenied: boolean,
  ): PermissionDeniedSummary | null;
}

// ── Registry ──

const plugins = new Map<ToolName, ToolPlugin>();

export function registerToolPlugin(plugin: ToolPlugin): void {
  plugins.set(plugin.name, plugin);
}

export function getToolPlugin(tool: ToolName): ToolPlugin {
  const plugin = plugins.get(tool);
  if (!plugin) throw new Error(`No plugin registered for tool: ${tool}`);
  return plugin;
}
