/** @module approval — Tool-approval formatting, lookup, and rerun-prompt builders for all driver types */
import type { PendingToolApproval } from '../context/app-types.js';
import type { ToolState } from '../session/types.js';
import type { ExpiringMap } from '../utils/expiring-map.js';
import { STICKY_APPROVAL_STATE_KEYS } from './sticky-tool-state.js';

export const TOOL_APPROVAL_ARGS_MAX_CHARS = 1400;

export function sanitizeStickyApprovalState(toolState: ToolState): {
  toolState: ToolState;
  changed: boolean;
} {
  const nextState = { ...toolState };
  let changed = false;
  for (const key of STICKY_APPROVAL_STATE_KEYS) {
    if (key in nextState) {
      delete nextState[key];
      changed = true;
    }
  }
  return { toolState: nextState, changed };
}

/** Shared core for formatting tool-approval arguments as a fenced code block. */
function formatArgsCore(args: unknown, prefix: string): string {
  if (args === null || args === undefined) {
    return `${prefix} (not available)`;
  }

  let body: string;
  let language = 'json';
  if (typeof args === 'string') {
    body = args.trim();
    language = 'text';
  } else {
    try {
      body = JSON.stringify(args, null, 2);
    } catch {
      body = String(args);
      language = 'text';
    }
  }

  if (!body) return `${prefix} (not available)`;

  let suffix = '';
  if (body.length > TOOL_APPROVAL_ARGS_MAX_CHARS) {
    body = body.slice(0, TOOL_APPROVAL_ARGS_MAX_CHARS);
    suffix = '\n... (truncated)';
  }

  return `${prefix}\n\`\`\`${language}\n${body}${suffix}\n\`\`\``;
}

/** Format tool-approval arguments as mrkdwn (for plain-text approval prompts). */
export function formatApprovalArgsBlock(args: unknown): string {
  return formatArgsCore(args, 'Arguments:');
}

/**
 * Format tool-approval arguments as standard Markdown for use in a `markdown` block.
 * Returns a string with a fenced code block and language hint for syntax highlighting.
 */
export function formatApprovalArgsForMarkdown(args: unknown): string {
  return formatArgsCore(args, '**Arguments:**');
}

export function findPendingApprovalBySessionKey(
  map: ExpiringMap<string, PendingToolApproval>,
  sessionKey: string,
): { key: string; approval: PendingToolApproval } | null {
  for (const [key, approval] of map.entries()) {
    if (approval.sessionKey === sessionKey) return { key, approval };
  }
  return null;
}

export function resolveApprovedToolName(pending: PendingToolApproval): string | null {
  const candidate = pending.requestedToolName ?? pending.deniedTools[0];
  if (!candidate) return null;
  const normalized = candidate.trim();
  if (!normalized) return null;
  if (normalized.toLowerCase() === 'unknown' || normalized.toLowerCase() === 'unknown_tool') {
    return null;
  }
  return normalized;
}

export function isWildcardToolApprovalTarget(toolName: string): boolean {
  return toolName.includes('*');
}

export function formatToolApprovalPrompt(
  pending: PendingToolApproval,
  expiresInSec: number,
): string {
  const requestedTool = resolveApprovedToolName(pending) ?? 'unknown_tool';
  const toolLine = `Tool call: \`${requestedTool}\``;
  const argsBlock = formatApprovalArgsBlock(pending.requestedToolArgs);
  return `\`${pending.tool}\` needs permission for the next tool execution.\n${toolLine}\n${argsBlock}\nReply \`!yes\`, \`!y\` or \`!no\`, \`!n\`. (expires in ${expiresInSec}s)`;
}

export function serializeArgsForPrompt(args: unknown): string {
  if (args === null || args === undefined) return '(not available)';
  if (typeof args === 'string') {
    const trimmed = args.trim();
    return trimmed.length > 0 ? trimmed : '(not available)';
  }
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

export function buildGeminiSingleToolRerunPrompt(
  originalPrompt: string,
  toolName: string,
  args: unknown,
): string {
  return `${originalPrompt}

Note: The tool ${toolName} is now available. Please proceed with the task using this tool.
Arguments for reference: ${serializeArgsForPrompt(args)}`;
}

export function buildClaudeMcpToolRerunPrompt(toolName: string, args: unknown): string {
  // The resumed session already preserves context and toolStateOverrides;
  // a short continuation prompt avoids tripping prompt-injection guards.
  void args;
  return `Continue with the task. The tool ${toolName} is now available for use.`;
}

export function buildCodexMcpToolRerunPrompt(
  originalPrompt: string,
  toolName: string,
  args: unknown,
): string {
  return `${originalPrompt}

Note: The tool ${toolName} is now available. Please proceed with the task using this tool.
Arguments for reference: ${serializeArgsForPrompt(args)}`;
}

