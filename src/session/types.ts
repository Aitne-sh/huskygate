/** @module session/types — Shared types for session state, tool state, and access modes. */
import type { ToolName } from '../config.js';

export type Mode = 'readonly' | 'write';

export function isMode(value: string): value is Mode {
  return value === 'readonly' || value === 'write';
}

/* ── Tool State ── */

/**
 * Typed interface for session tool state persisted as JSON in the DB.
 *
 * Known keys have explicit types for IDE autocomplete and typo prevention.
 * The index signature `[key: string]: unknown` preserves backwards
 * compatibility with dynamic keys (e.g. `approved_tool:<name>`).
 */
export interface ToolState {
  // -- Common (all drivers) --
  model?: string;
  auto_approve?: boolean;
  _tool_approval_rerun?: boolean;
  mcp_server_filter_active?: boolean;
  /** Tool names denied by the user in a previous approval prompt.
   *  Consumed once by job-executor to inject denial context into the next prompt. */
  denied_tools?: string[];

  // -- Claude --
  session_id?: string;
  claude_allowed_tools?: string[];
  claude_runtime_allowed_tools?: string[];
  claude_setting_sources?: string;
  claude_mcp_auth_verified_server?: string;
  claude_mcp_auth_bypass_server?: string;
  claude_mcp_auth_approval_completed?: boolean;
  claude_skip_mcp_preflight_once?: boolean;
  claude_mcp_auth_approval_rerun?: boolean;
  claude_mcp_auth_approval_action?: string;
  claude_mcp_auth_auto_rerun?: boolean;

  // -- Codex --
  thread_id?: string;
  codex_ask_for_approval?: string;
  codex_skip_git_repo_check?: boolean;
  codex_mcp_auth_verified_server?: string;
  codex_mcp_auth_auto_rerun?: boolean;
  codex_approved_tool_calls?: string[];
  codex_allow_tool_once_list?: unknown[];

  // -- Gemini --
  session_index?: string;
  gemini_resume_ready?: boolean;
  gemini_allowed_tools?: string[];
  gemini_runtime_allowed_tools?: string[];
  gemini_mcp_auth_initialized_server?: string;
  gemini_mcp_auth_verified_server?: string;
  gemini_mcp_auth_bypass_server?: string;
  gemini_skip_mcp_preflight_once?: boolean;
  gemini_mcp_auth_approval_rerun?: boolean;
  gemini_mcp_auth_approval_action?: string;

  // Dynamic keys (e.g. "approved_tool:Bash")
  [key: string]: unknown;
}

/* ── Session ── */

export interface Session {
  sessionKey: string;
  tool: ToolName;
  mode: Mode;
  modeExpiresAt: string | null;
  toolState: ToolState;
  workdir: string;
  runningJobId: string | null;
  updatedAt: string;
  devAlias: string | null;
}
