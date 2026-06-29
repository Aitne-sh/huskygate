/** @module slack/tools/codex-plugin — ToolPlugin implementation for Codex (custom approval gate). */
import type { Config } from '../../config.js';
import { detectMcpVoluntaryStopFromText } from '../../shared/tool-approval.js';
import type { ApprovalGate, ToolPlugin } from '../tool-plugin.js';
import {
  CODEX_MCP_AUTH_VERIFIED_SERVER_KEY,
  type CodexToolApprovalGate,
  buildCodexPermissionDeniedSummary,
  createCodexToolApprovalGate,
  evaluateCodexToolUseForApproval,
} from './codex.js';

const codexPlugin: ToolPlugin = {
  name: 'codex',

  getMcpAuthServer(config: Config) {
    return config.codexMcpAuthServer;
  },

  clearMcpAuthState(merged) {
    const next = { ...merged };
    delete next[CODEX_MCP_AUTH_VERIFIED_SERVER_KEY];
    // Clear thread_id so the MCP-auth retry starts a fresh thread instead of
    // attempting to resume the aborted one (which produces invalid CLI args).
    next.thread_id = undefined;
    return next;
  },

  createApprovalGate(toolState) {
    return createCodexToolApprovalGate(toolState) as unknown as ApprovalGate;
  },

  evaluateToolUse(gate, event) {
    const result = evaluateCodexToolUseForApproval(gate as unknown as CodexToolApprovalGate, event);
    return {
      shouldBlock: result.shouldBlock,
      gate: result.gate as unknown as ApprovalGate,
    };
  },

  buildPermissionDeniedSummary(gate) {
    return buildCodexPermissionDeniedSummary(gate as unknown as CodexToolApprovalGate);
  },

  detectVoluntaryStop(_events, textBuffer, hasDetectedPD, hasProactivePD) {
    if (hasDetectedPD || hasProactivePD) return null;
    return detectMcpVoluntaryStopFromText(textBuffer);
  },
};

export default codexPlugin;
