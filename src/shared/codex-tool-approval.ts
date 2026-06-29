/** @module codex-tool-approval — Codex-specific tool-call approval extraction, deduplication, and toolState overrides */
import type { ToolState } from '../session/types.js';

export const CODEX_ALLOW_TOOL_ONCE_LIST_KEY = 'codex_allow_tool_once_list';

export interface CodexApprovedToolCall {
  toolName: string;
  args: unknown | null;
}

export function normalizeCodexApprovalArgs(args: unknown): string | null {
  if (args === null || args === undefined) return null;
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => canonicalize(item));
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      const normalized: Record<string, unknown> = {};
      for (const [key, nested] of entries) {
        normalized[key] = canonicalize(nested);
      }
      return normalized;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return trimmed;
      try {
        return canonicalize(JSON.parse(trimmed) as unknown);
      } catch {
        return trimmed;
      }
    }
    return value;
  };
  try {
    return JSON.stringify(canonicalize(args));
  } catch {
    return String(args);
  }
}

function normalizeApprovedToolName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeApprovedToolCall(value: unknown): CodexApprovedToolCall | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const toolName =
    normalizeApprovedToolName(record.toolName) ??
    normalizeApprovedToolName(record.name) ??
    normalizeApprovedToolName(record.tool_name);
  if (!toolName) return null;
  const args = record.args ?? record.arguments ?? record.input ?? null;
  return { toolName, args };
}

function dedupeApprovedToolCalls(calls: CodexApprovedToolCall[]): CodexApprovedToolCall[] {
  const deduped: CodexApprovedToolCall[] = [];
  const seen = new Set<string>();
  for (const call of calls) {
    const normalizedToolName = normalizeApprovedToolName(call.toolName);
    if (!normalizedToolName) continue;
    const argsNormalized = normalizeCodexApprovalArgs(call.args);
    const key = `${normalizedToolName}\u0000${argsNormalized ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ toolName: normalizedToolName, args: call.args ?? null });
  }
  return deduped;
}

export function extractCodexApprovedToolCalls(toolState: ToolState): CodexApprovedToolCall[] {
  const calls: CodexApprovedToolCall[] = [];
  const rawList = toolState[CODEX_ALLOW_TOOL_ONCE_LIST_KEY];
  if (Array.isArray(rawList)) {
    for (const entry of rawList) {
      const normalized = normalizeApprovedToolCall(entry);
      if (!normalized) continue;
      calls.push(normalized);
    }
  }

  return dedupeApprovedToolCalls(calls);
}

export function appendCodexApprovedToolCall(
  approvedCalls: CodexApprovedToolCall[],
  toolName: string,
  args: unknown,
): CodexApprovedToolCall[] {
  const normalizedToolName = normalizeApprovedToolName(toolName);
  if (!normalizedToolName) return dedupeApprovedToolCalls(approvedCalls);
  return dedupeApprovedToolCalls([
    ...approvedCalls,
    {
      toolName: normalizedToolName,
      args: args ?? null,
    },
  ]);
}

export function buildCodexApprovalToolStateOverridesForCalls(
  approvedToolCalls: CodexApprovedToolCall[],
): ToolState {
  const deduped = dedupeApprovedToolCalls(approvedToolCalls);
  return {
    codex_ask_for_approval: 'never',
    [CODEX_ALLOW_TOOL_ONCE_LIST_KEY]: deduped.map((call) => ({
      toolName: call.toolName,
      args: call.args,
    })),
  };
}
