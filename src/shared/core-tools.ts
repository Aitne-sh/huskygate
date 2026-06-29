/**
 * @module shared/core-tools — Single source of truth for built-in tool allowlists.
 *
 * Used by BOTH:
 *  - Layer 1: CLI `--allowed-tools` flags (driver-claude.ts)
 *  - Layer 2: Proactive approval gate (tool-approval.ts / claude-plugin.ts)
 *
 * Keeping one canonical list prevents the two layers from diverging.
 */

/**
 * Core tools auto-approved in readonly mode.
 * These have no side effects and are safe to execute without user confirmation.
 */
export const CORE_READONLY_TOOLS: readonly string[] = [
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'Task',
];

/**
 * Core tools auto-approved in write mode.
 * Includes mutation tools (Write/Edit/Bash) and orchestration tools (Agent).
 *
 * Agent is included because it is an orchestration-only tool: it spawns
 * sub-agents that inherit the same --allowed-tools restrictions.
 * Blocking Agent adds no security value — the sub-agent's tools are
 * individually gated.
 */
export const CORE_WRITE_TOOLS: readonly string[] = [
  ...CORE_READONLY_TOOLS,
  'Write',
  'Edit',
  'Bash',
  'NotebookEdit',
  'Agent',
];
