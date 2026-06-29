/** @module slack/tools/gemini-plugin — ToolPlugin implementation for Gemini (allowlist-based approval gate). */
import type { Config } from '../../config.js';
import {
  type AllowlistToolApprovalGate,
  buildAllowlistPermissionDeniedSummary,
  createAllowlistToolApprovalGate,
  detectMcpVoluntaryStopFromText,
  evaluateAllowlistToolUseForApproval,
} from '../../shared/tool-approval.js';
import type { ApprovalGate, ToolPlugin } from '../tool-plugin.js';
import {
  GEMINI_MCP_AUTH_INITIALIZED_SERVER_KEY,
  GEMINI_MCP_AUTH_VERIFIED_SERVER_KEY,
} from './gemini.js';

const geminiPlugin: ToolPlugin = {
  name: 'gemini',

  getMcpAuthServer(config: Config) {
    return config.geminiMcpAuthServer;
  },

  clearMcpAuthState(merged) {
    const next = { ...merged };
    delete next[GEMINI_MCP_AUTH_INITIALIZED_SERVER_KEY];
    delete next[GEMINI_MCP_AUTH_VERIFIED_SERVER_KEY];
    return next;
  },

  createApprovalGate(toolState) {
    // TODO: Pass Gemini core tools (read_file, edit_file, etc.) once their
    // stream-json tool names are confirmed.  Without them, the proactive gate
    // blocks built-in tools when autoApprove=false — same bug fixed for Claude
    // via CORE_WRITE_TOOLS in claude-plugin.ts.
    return createAllowlistToolApprovalGate('gemini', toolState) as unknown as ApprovalGate;
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

  detectVoluntaryStop(_events, textBuffer, hasDetectedPD, hasProactivePD) {
    if (hasDetectedPD || hasProactivePD) return null;
    return detectMcpVoluntaryStopFromText(textBuffer);
  },
};

export default geminiPlugin;
