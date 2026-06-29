/** @module auto-approve — Resolves whether tool auto-approve is active based on job, session, and global config */
import type { Config } from '../config.js';
import type { Mode, ToolState } from '../session/types.js';

/**
 * Resolves whether auto-approve mode is active for a given job.
 *
 * **Invariant: readonly mode → auto-approve is always false.**
 *
 * Auto-approve is a write-mode-only mechanism that skips user approval
 * prompts for tool execution.  In readonly mode MCP tools and write tools
 * are out of scope, so auto-approve has no meaningful effect and must be
 * disabled to preserve the readonly security boundary.
 *
 * For write mode, resolution order (first definitive value wins):
 * 1. Per-job override: `jobAutoApprove` (schedule/orchestrator/ondemand set this)
 * 2. Per-session override: `toolState.auto_approve` (toggled via `!autorun`)
 * 3. Global config: `config.toolAutoApproveMode` (env `TOOL_AUTO_APPROVE_MODE`)
 */
export function resolveAutoApprove(
  config: Pick<Config, 'toolAutoApproveMode'>,
  mode: Mode,
  jobAutoApprove: boolean | undefined,
  toolState: ToolState,
): boolean {
  // Invariant: readonly → auto-approve disabled
  if (mode === 'readonly') return false;

  // Write mode: resolve from job → session → global
  if (jobAutoApprove === true) return true;
  if (toolState.auto_approve === true) return true;
  if (toolState.auto_approve === false) return false;
  return config.toolAutoApproveMode;
}
