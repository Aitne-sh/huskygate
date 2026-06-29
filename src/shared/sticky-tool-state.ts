/** @module sticky-tool-state — Key constants for per-driver sticky approval state persisted across job runs */
import { CODEX_ALLOW_TOOL_ONCE_LIST_KEY } from './codex-tool-approval.js';

export const CLAUDE_MCP_AUTH_APPROVAL_RERUN_KEY = 'claude_mcp_auth_approval_rerun';
export const CLAUDE_MCP_AUTH_APPROVAL_ACTION_KEY = 'claude_mcp_auth_approval_action';
export const CLAUDE_STICKY_TOOL_STATE_KEYS = [
  'claude_allowed_tools',
  'claude_runtime_allowed_tools',
  'claude_skip_mcp_preflight_once',
  CLAUDE_MCP_AUTH_APPROVAL_RERUN_KEY,
  CLAUDE_MCP_AUTH_APPROVAL_ACTION_KEY,
] as const;

export const GEMINI_MCP_AUTH_APPROVAL_RERUN_KEY = 'gemini_mcp_auth_approval_rerun';
export const GEMINI_MCP_AUTH_APPROVAL_ACTION_KEY = 'gemini_mcp_auth_approval_action';
export const GEMINI_STICKY_TOOL_STATE_KEYS = [
  'gemini_allowed_tools',
  'gemini_runtime_allowed_tools',
  'gemini_skip_mcp_preflight_once',
  GEMINI_MCP_AUTH_APPROVAL_RERUN_KEY,
  GEMINI_MCP_AUTH_APPROVAL_ACTION_KEY,
] as const;

export const CODEX_STICKY_TOOL_STATE_KEYS = [
  'codex_ask_for_approval',
  CODEX_ALLOW_TOOL_ONCE_LIST_KEY,
] as const;

export const STICKY_APPROVAL_STATE_KEYS = [
  ...CLAUDE_STICKY_TOOL_STATE_KEYS,
  ...GEMINI_STICKY_TOOL_STATE_KEYS,
  ...CODEX_STICKY_TOOL_STATE_KEYS,
] as const;
