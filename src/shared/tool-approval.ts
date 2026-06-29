/** @module tool-approval — Permission-denied detection, runtime tool allowlist gating, and MCP tool-request parsing */
import type { ToolName } from '../config.js';
import type { DriverEvent } from '../runner/types.js';
import type { ToolState } from '../session/types.js';

/**
 * Key added to `toolStateOverrides` to mark a job as a tool-approval retry.
 * Used by job-executor to skip saving a duplicate user message.
 */
export const TOOL_APPROVAL_RERUN_KEY = '_tool_approval_rerun' as const;

type AllowlistToolName = 'claude' | 'gemini';

const RUNTIME_ALLOWLIST_KEY_BY_TOOL: Record<AllowlistToolName, string> = {
  claude: 'claude_runtime_allowed_tools',
  gemini: 'gemini_runtime_allowed_tools',
};

const TOOL_NAME_PATTERN_BY_TOOL: Record<AllowlistToolName, RegExp> = {
  claude: /^[A-Za-z0-9_.*:()/-]+$/,
  gemini: /^[A-Za-z0-9_.*-]+$/,
};

const PERMISSION_DENIED_PATTERNS_BY_TOOL: Record<ToolName, RegExp[]> = {
  claude: [
    /tool execution denied by policy/i,
    /\bpermission denied\b/i,
    /\bapproval required\b/i,
    /\brequires approval\b/i,
    /\bdenied by policy\b/i,
  ],
  codex: [
    /\bapproval required\b/i,
    /\brequires approval\b/i,
    /\bpermission denied\b/i,
    /\bdenied by policy\b/i,
    /\bask[- ]for[- ]approval\b/i,
  ],
  gemini: [/tool execution denied by policy/i, /\bapproval required\b/i, /\brequires approval\b/i],
};

const TOOL_NAME_FROM_ERROR_PATTERNS = [
  /^(?:Error:\s*)?Error executing tool\s+([A-Za-z0-9_.*:()/-]+):/i,
  /\bfor tool\s+["'`]?([A-Za-z0-9_.*:()/-]+)["'`]?/i,
  /\btool\s+([A-Za-z0-9_.*:()/-]+):\s*(?:denied|not allowed|requires approval|permission denied)/i,
  /\btool\s+["'`]([A-Za-z0-9_.*:()/-]+)["'`]\s*(?:execution\s+)?(?:denied|not allowed|requires approval|permission denied)/i,
];

function isAllowlistTool(tool: ToolName): tool is AllowlistToolName {
  return tool === 'claude' || tool === 'gemini';
}

function normalizeAllowedTools(tool: AllowlistToolName, raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const pattern = TOOL_NAME_PATTERN_BY_TOOL[tool];
  const tools: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (!normalized || normalized === '*' || !pattern.test(normalized) || seen.has(normalized))
      continue;
    seen.add(normalized);
    tools.push(normalized);
  }
  return tools;
}

function extractToolNamesFromErrorLine(line: string): string[] {
  const tools: string[] = [];
  const seen = new Set<string>();
  for (const pattern of TOOL_NAME_FROM_ERROR_PATTERNS) {
    const match = line.match(pattern);
    const name = match?.[1]?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    tools.push(name);
  }
  return tools;
}

function extractToolNameFromToolUse(content: string): string | null {
  const usingTool = content.match(/^Using tool:\s*(.+)$/i)?.[1]?.trim();
  if (usingTool) return usingTool;
  const callingTool = content.match(/^Calling:\s*(.+)$/i)?.[1]?.trim();
  if (callingTool) return callingTool;
  return null;
}

function normalizeArgsCandidate(value: unknown): unknown | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    // Treat empty objects/arrays as "no args" — avoids displaying bare "{}" in approval prompts.
    if (typeof value === 'object' && Object.keys(value as Record<string, unknown>).length === 0) {
      return null;
    }
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

export interface ToolUseSnapshot {
  toolName: string | null;
  args: unknown | null;
}

export function extractToolUseSnapshot(event: DriverEvent): ToolUseSnapshot | null {
  if (event.type !== 'tool_use') return null;

  let toolName = extractToolNameFromToolUse(event.content);
  let args: unknown | null = null;

  const raw = event.raw;
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;

    if (typeof record.tool_name === 'string') {
      toolName = record.tool_name;
    }
    if (record.parameters !== undefined) {
      args = normalizeArgsCandidate(record.parameters);
    } else if (record.arguments !== undefined) {
      args = normalizeArgsCandidate(record.arguments);
    } else if (record.input !== undefined) {
      args = normalizeArgsCandidate(record.input);
    } else if (record.args !== undefined) {
      args = normalizeArgsCandidate(record.args);
    }

    const delta =
      record.delta && typeof record.delta === 'object'
        ? (record.delta as Record<string, unknown>)
        : null;
    if (delta) {
      if (delta.partial_json !== undefined) {
        args = normalizeArgsCandidate(delta.partial_json);
      } else if (delta.arguments !== undefined) {
        args = normalizeArgsCandidate(delta.arguments);
      } else if (delta.input !== undefined) {
        args = normalizeArgsCandidate(delta.input);
      } else if (delta.args !== undefined) {
        args = normalizeArgsCandidate(delta.args);
      }
    }

    const contentBlock =
      record.content_block && typeof record.content_block === 'object'
        ? (record.content_block as Record<string, unknown>)
        : null;
    if (contentBlock) {
      if (typeof contentBlock.name === 'string') {
        toolName = contentBlock.name;
      }
      if (contentBlock.input !== undefined) {
        args = normalizeArgsCandidate(contentBlock.input);
      } else if (contentBlock.arguments !== undefined) {
        args = normalizeArgsCandidate(contentBlock.arguments);
      } else if (contentBlock.partial_json !== undefined) {
        args = normalizeArgsCandidate(contentBlock.partial_json);
      }
    }

    const item =
      record.item && typeof record.item === 'object'
        ? (record.item as Record<string, unknown>)
        : null;
    if (item) {
      if (typeof item.name === 'string') {
        toolName = item.name;
      }
      if (item.arguments !== undefined) {
        args = normalizeArgsCandidate(item.arguments);
      } else if (item.args !== undefined) {
        args = normalizeArgsCandidate(item.args);
      } else if (item.input !== undefined) {
        args = normalizeArgsCandidate(item.input);
      }
    }
  }

  if (!toolName && args === null) return null;
  return { toolName, args };
}

export interface AllowlistToolApprovalGate {
  allowedTools: string[];
  proactiveApprovalRequest: ToolUseSnapshot | null;
}

export interface AllowlistToolApprovalEvaluation {
  shouldBlock: boolean;
  gate: AllowlistToolApprovalGate;
}

export function createAllowlistToolApprovalGate(
  tool: AllowlistToolName,
  toolState: ToolState,
  coreTools: readonly string[] = [],
): AllowlistToolApprovalGate {
  const allowlistKey = RUNTIME_ALLOWLIST_KEY_BY_TOOL[tool];
  const dynamicTools = normalizeAllowedTools(tool, toolState[allowlistKey]);
  // Merge core tools (from shared/core-tools.ts) with dynamic allowlist
  // (claude_runtime_allowed_tools / gemini_runtime_allowed_tools).
  // Core tools are always permitted so the proactive gate never blocks
  // built-in tools like Read, Glob, Bash, Agent, etc.
  // Glob patterns (e.g. "mcp__awsapi__*") added by the proxy for
  // configured MCP servers pass through without per-call approval.
  const merged = new Set([...coreTools, ...dynamicTools]);
  return {
    allowedTools: [...merged],
    proactiveApprovalRequest: null,
  };
}

/**
 * Check if a tool name matches any entry in the allowlist.
 * Supports trailing-wildcard glob patterns (e.g. "mcp__server__*").
 */
function isToolAllowed(allowedTools: string[], toolName: string): boolean {
  for (const pattern of allowedTools) {
    if (pattern === toolName) return true;
    if (pattern.endsWith('*') && toolName.startsWith(pattern.slice(0, -1))) {
      return true;
    }
  }
  return false;
}

export function evaluateAllowlistToolUseForApproval(
  gate: AllowlistToolApprovalGate,
  event: DriverEvent,
): AllowlistToolApprovalEvaluation {
  const request = extractToolUseSnapshot(event);
  if (!request?.toolName) return { shouldBlock: false, gate };

  if (isToolAllowed(gate.allowedTools, request.toolName)) {
    return { shouldBlock: false, gate };
  }

  return {
    shouldBlock: true,
    gate: {
      ...gate,
      proactiveApprovalRequest: request,
    },
  };
}

export function buildAllowlistPermissionDeniedSummary(
  gate: AllowlistToolApprovalGate,
): PermissionDeniedSummary | null {
  const request = gate.proactiveApprovalRequest;
  if (!request) return null;
  return {
    deniedTools: request.toolName ? [request.toolName] : [],
    request: {
      toolName: request.toolName,
      args: request.args,
    },
  };
}

export interface PermissionDeniedSummary {
  deniedTools: string[];
  request: {
    toolName: string | null;
    args: unknown | null;
  };
}

export function isPermissionDeniedError(tool: ToolName, content: string): boolean {
  const line = content.trim();
  if (!line) return false;
  return PERMISSION_DENIED_PATTERNS_BY_TOOL[tool].some((pattern) => pattern.test(line));
}

export function detectPermissionDenied(
  tool: ToolName,
  events: DriverEvent[],
): PermissionDeniedSummary | null {
  const deniedTools: string[] = [];
  const seen = new Set<string>();
  let matchedDeniedLine = false;
  let latestToolUse: { toolName: string | null; args: unknown | null } | null = null;
  let deniedRequest: { toolName: string | null; args: unknown | null } | null = null;

  for (const event of events) {
    const toolUseSnapshot = extractToolUseSnapshot(event);
    if (toolUseSnapshot) {
      latestToolUse = toolUseSnapshot;
      continue;
    }

    if (event.type !== 'error' && event.type !== 'status') continue;
    const line = event.content.trim();
    if (!isPermissionDeniedError(tool, line)) continue;
    matchedDeniedLine = true;

    const extracted = extractToolNamesFromErrorLine(line);
    if (extracted.length === 0 && latestToolUse?.toolName) {
      extracted.push(latestToolUse.toolName);
    }

    if (!deniedRequest) {
      let requestToolName: string | null = latestToolUse ? latestToolUse.toolName : null;
      if (extracted.length > 0 && extracted[0] !== undefined) {
        requestToolName = extracted[0];
      }
      deniedRequest = {
        toolName: requestToolName,
        args: latestToolUse?.args ?? null,
      };
    }

    for (const name of extracted) {
      if (seen.has(name)) continue;
      seen.add(name);
      deniedTools.push(name);
    }
  }

  if (!matchedDeniedLine) return null;
  return {
    deniedTools,
    request: {
      toolName: deniedRequest?.toolName ?? deniedTools[0] ?? null,
      args: deniedRequest?.args ?? null,
    },
  };
}

function mergeApprovedTools(
  tool: AllowlistToolName,
  toolState: ToolState,
  approvedTools: string[],
): ToolState {
  const allowlistKey = RUNTIME_ALLOWLIST_KEY_BY_TOOL[tool];
  const existing = normalizeAllowedTools(tool, toolState[allowlistKey]);
  const approved = normalizeAllowedTools(tool, approvedTools);
  const mergedSet = new Set<string>(existing);
  for (const item of approved) {
    mergedSet.add(item);
  }

  return {
    ...toolState,
    [allowlistKey]: [...mergedSet],
  };
}

export function mergeApprovedAllowlistTools(
  tool: ToolName,
  toolState: ToolState,
  approvedTools: string[],
): ToolState {
  if (!isAllowlistTool(tool)) return toolState;
  return mergeApprovedTools(tool, toolState, approvedTools);
}

/**
 * Parse a [MCP_TOOL_REQUEST] block emitted per the MCP_APPROVAL instruction section.
 * Returns tool name and parsed arguments, or null if the block is not found.
 *
 * Supports two formats:
 * 1. Backtick-fenced (Claude's typical format):
 *    arguments:\n```json\n{...}\n```
 * 2. Plain (Gemini's typical format):
 *    arguments: {...}   or   arguments:\n{...}
 */
export function parseClaudeMcpToolRequest(text: string): ToolUseSnapshot | null {
  // Format 1: arguments in backtick-fenced code block
  const fencedMatch = text.match(
    /\[MCP_TOOL_REQUEST\]\s*\ntool:\s*(\S+)\s*\narguments:\s*\n```(?:json)?\s*\n([\s\S]*?)\n```\s*\n\[\/MCP_TOOL_REQUEST\]/i,
  );
  if (fencedMatch) {
    return buildToolRequestSnapshot(fencedMatch[1], fencedMatch[2]);
  }

  // Format 2: arguments inline or on next line(s) without code fence
  const plainMatch = text.match(
    /\[MCP_TOOL_REQUEST\]\s*\ntool:\s*(\S+)\s*\narguments:\s*([\s\S]*?)\s*\[\/MCP_TOOL_REQUEST\]/i,
  );
  if (plainMatch) {
    return buildToolRequestSnapshot(plainMatch[1], plainMatch[2]);
  }

  return null;
}

function buildToolRequestSnapshot(
  rawTool: string | undefined,
  rawArgs: string | undefined,
): ToolUseSnapshot {
  const toolName = (rawTool ?? '').trim();
  let args: unknown = null;
  const trimmedArgs = (rawArgs ?? '').trim();
  if (trimmedArgs) {
    try {
      args = JSON.parse(trimmedArgs);
    } catch {
      args = trimmedArgs;
    }
  }
  return { toolName, args };
}

/**
 * Detect Claude's text-based permission denial that occurs when Claude CLI
 * silently denies MCP tool calls (no tool_use events emitted).
 *
 * Example text output:
 *   "Claude requested permissions to use mcp__aws-api__aws_execute, but you haven't granted it yet."
 *
 * Also extracts args from [MCP_TOOL_REQUEST] block if present in the text.
 */
const CLAUDE_TEXT_PERMISSION_DENIED_PATTERN =
  /requested permissions? to use\s+([A-Za-z0-9_.*:()/-]+)/i;

export function detectClaudeTextPermissionDenied(
  events: DriverEvent[],
): PermissionDeniedSummary | null {
  const textParts: string[] = [];
  for (const event of events) {
    if (event.type === 'text') {
      textParts.push(event.content);
    }
  }
  const fullText = textParts.join('\n');
  const match = fullText.match(CLAUDE_TEXT_PERMISSION_DENIED_PATTERN);
  if (!match) return null;

  const toolName = (match[1] ?? '').trim();
  // Extract args from [MCP_TOOL_REQUEST] block if present
  const toolPlan = parseClaudeMcpToolRequest(fullText);
  const args = toolPlan?.args ?? null;
  return {
    deniedTools: [toolName],
    request: {
      toolName,
      args,
    },
  };
}

/**
 * Detect Claude's voluntary stop after outputting [MCP_TOOL_REQUEST] block.
 *
 * In the voluntary-stop approach, Claude outputs the block and ends its response
 * (exit 0, clean session). This function detects the block in text output when
 * no CLI-level denial text is present (which would be handled by detectClaudeTextPermissionDenied).
 */
export function detectClaudeMcpVoluntaryStop(
  events: DriverEvent[],
): PermissionDeniedSummary | null {
  const textParts: string[] = [];
  for (const event of events) {
    if (event.type === 'text') textParts.push(event.content);
  }
  const fullText = textParts.join('\n');
  // Skip if CLI-level denial text is present (handled by detectClaudeTextPermissionDenied)
  if (CLAUDE_TEXT_PERMISSION_DENIED_PATTERN.test(fullText)) return null;
  const request = parseClaudeMcpToolRequest(fullText);
  if (!request?.toolName) return null;
  return {
    deniedTools: [request.toolName],
    request: { toolName: request.toolName, args: request.args },
  };
}

/**
 * Detect [MCP_TOOL_REQUEST] voluntary stop from assembled text.
 *
 * Works on any tool (Gemini, Codex, etc.) by parsing the block from the
 * provided text string. This is the preferred detection method because
 * it works regardless of whether the text came from streaming events
 * or from file-based output (e.g. Codex's --output-last-message).
 */
export function detectMcpVoluntaryStopFromText(text: string): PermissionDeniedSummary | null {
  const request = parseClaudeMcpToolRequest(text);
  if (!request?.toolName) return null;
  return {
    deniedTools: [request.toolName],
    request: { toolName: request.toolName, args: request.args },
  };
}

/**
 * Extract the short tool name from an MCP-prefixed name.
 * e.g. "mcp__aws-api__aws_execute" → "aws_execute"
 *
 * MCP tool names follow the format mcp__<server>__<tool>. Tool-use events
 * from some CLIs (e.g. Codex) reference the short name only, while the
 * voluntary-stop [MCP_TOOL_REQUEST] block uses the full prefixed name.
 */
export function extractMcpShortToolName(toolName: string): string | null {
  const parts = toolName.split('__');
  if (parts.length >= 3 && parts[0] === 'mcp') {
    const shortName = parts.slice(2).join('__');
    if (!shortName || shortName.includes('*')) return null;
    return shortName;
  }
  return null;
}
