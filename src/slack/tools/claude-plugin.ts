/** @module slack/tools/claude-plugin — ToolPlugin implementation for Claude (allowlist-based approval gate). */
import type { Config } from '../../config.js';
import { CORE_WRITE_TOOLS } from '../../shared/core-tools.js';
import {
  type AllowlistToolApprovalGate,
  buildAllowlistPermissionDeniedSummary,
  createAllowlistToolApprovalGate,
  detectClaudeMcpVoluntaryStop,
  detectClaudeTextPermissionDenied,
  evaluateAllowlistToolUseForApproval,
} from '../../shared/tool-approval.js';
import type { ApprovalGate, ToolPlugin } from '../tool-plugin.js';
import { CLAUDE_MCP_AUTH_VERIFIED_SERVER_KEY } from './claude.js';

const claudePlugin: ToolPlugin = {
  name: 'claude',

  getMcpAuthServer(config: Config) {
    return config.claudeMcpAuthServer;
  },

  clearMcpAuthState(merged) {
    const next = { ...merged };
    delete next[CLAUDE_MCP_AUTH_VERIFIED_SERVER_KEY];
    return next;
  },

  createApprovalGate(toolState) {
    return createAllowlistToolApprovalGate(
      'claude',
      toolState,
      CORE_WRITE_TOOLS,
    ) as unknown as ApprovalGate;
  },

  evaluateToolUse(gate, event) {
    const result = evaluateAllowlistToolUseForApproval(
      gate as unknown as AllowlistToolApprovalGate,
      event,
    );
    return {
      shouldBlock: result.shouldBlock,
      gate: result.gate as unknown as ApprovalGate,
    };
  },

  buildPermissionDeniedSummary(gate) {
    return buildAllowlistPermissionDeniedSummary(gate as unknown as AllowlistToolApprovalGate);
  },

  detectVoluntaryStop(events, _textBuffer, hasDetectedPD, hasProactivePD) {
    // Claude has two detection modes:
    // 1. Text-based permission denied (CLI silently denies MCP tool calls)
    // 2. Voluntary stop via [MCP_TOOL_REQUEST] block
    if (hasDetectedPD || hasProactivePD) return null;
    const textDenied = detectClaudeTextPermissionDenied(events);
    if (textDenied) return textDenied;
    return detectClaudeMcpVoluntaryStop(events);
  },
};

export default claudePlugin;
