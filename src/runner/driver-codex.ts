/** @module driver-codex — Driver implementation for the Codex CLI. */
import { existsSync } from 'node:fs';
import type { Mode, Session, ToolState } from '../session/types.js';
import { isMacOS } from '../utils/platform.js';
import {
  SHARED_NON_FATAL_STDERR_PATTERNS,
  buildDriverEnv,
  createDriverCommandResolver,
  extractAssistantText,
  extractToolUseInfo,
  isNonFatalStderr,
  resolveModel,
  tryParseStderrAsEvent,
} from './driver-utils.js';
import type { Driver, DriverBuildOptions, DriverEvent } from './types.js';

const CODEX_ASK_FOR_APPROVAL_VALUES = new Set(['on-request', 'on-failure', 'untrusted', 'never']);
const CODEX_APP_BUNDLE_COMMAND = '/Applications/Codex.app/Contents/Resources/codex';
const CODEX_TOOL_CALL_TYPES = new Set([
  'function_call',
  'tool_call',
  'mcp_tool_call',
  'custom_tool_call',
  'call_tool',
]);
const NON_FATAL_STDERR_PATTERNS: RegExp[] = [
  ...SHARED_NON_FATAL_STDERR_PATTERNS,
  /^WARNING: proceeding, even though we could not update PATH:/i,
  /^\d{4}-\d{2}-\d{2}T\S+\s+ERROR\s+codex_core::rollout::list:\s+state db missing rollout path/i,
  /^\d{4}-\d{2}-\d{2}T\S+\s+WARN\s+codex_core::state_db:\s+state db record_discrepancy/i,
  /^(?:Error:\s*)?Reconnecting\.\.\.\s*\d+\/\d+/i,
  /stream disconnected before completion/i,
  /Transport error:\s*network error/i,
];

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function parseCodexItemEvent(
  item: Record<string, unknown> | undefined,
  raw: Record<string, unknown>,
): DriverEvent | null {
  if (!item) return null;

  const itemType = item.type as string | undefined;
  const rawType = raw.type as string | undefined;
  if (itemType && CODEX_TOOL_CALL_TYPES.has(itemType)) {
    const functionInfo =
      item.function && typeof item.function === 'object'
        ? (item.function as Record<string, unknown>)
        : null;
    const name =
      (item.name as string | undefined) ??
      (item.tool_name as string | undefined) ??
      (item.tool as string | undefined) ??
      (functionInfo?.tool_name as string | undefined) ??
      (functionInfo?.tool as string | undefined) ??
      (functionInfo?.name as string | undefined);
    if (!name) return null;
    const args =
      item.arguments ??
      item.args ??
      item.input ??
      item.parameters ??
      item.payload ??
      functionInfo?.arguments ??
      functionInfo?.args ??
      functionInfo?.input;
    const normalizedRaw =
      args !== undefined
        ? {
            ...raw,
            tool_name: name,
            arguments: args,
          }
        : {
            ...raw,
            tool_name: name,
          };
    const status = typeof item.status === 'string' ? item.status : null;
    const hasResult = item.result !== undefined && item.result !== null;
    const hasError = item.error !== undefined && item.error !== null;
    const isCompletion = rawType === 'item.completed' || status === 'completed';
    if (isCompletion) {
      const resultContent = hasError
        ? stringifyUnknown(item.error)
        : hasResult
          ? stringifyUnknown(item.result)
          : '';
      return {
        type: 'tool_result',
        content: resultContent,
        raw: normalizedRaw,
      };
    }
    return {
      type: 'tool_use',
      content: `Calling: ${name}`,
      toolInput: args ?? undefined,
      raw: normalizedRaw,
    };
  }
  if (itemType === 'function_call_output') {
    const output = item.output;
    return {
      type: 'tool_result',
      content: output === undefined ? '' : stringifyUnknown(output),
      raw,
    };
  }

  const role = item.role as string | undefined;
  const content = item.content as Array<Record<string, unknown>> | undefined;
  if (role === 'assistant' && content) {
    const texts = content.filter((c) => c.type === 'text').map((c) => c.text as string);
    if (texts.length > 0) {
      return { type: 'text', content: texts.join('\n'), raw };
    }
  }

  // Handle items with a text field (agent_message, etc.)
  // Skip reasoning (internal model thinking, not user-visible output)
  if (itemType !== 'reasoning' && typeof item.text === 'string' && item.text) {
    return { type: 'text', content: item.text, raw };
  }

  const nested = extractAssistantText(item);
  if (nested) return { type: 'text', content: nested, raw };
  return null;
}

function extractToolUseFromLine(line: string): { toolName: string } | null {
  const usingTool = line.match(/^Using tool:\s*(.+)$/i)?.[1]?.trim();
  if (usingTool) return { toolName: usingTool };
  const callingTool = line.match(/^Calling:\s*(.+)$/i)?.[1]?.trim();
  if (callingTool) return { toolName: callingTool };
  return null;
}

function extractAskForApproval(toolState: ToolState): string | null {
  const raw = toolState.codex_ask_for_approval;
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim();
  if (!normalized || !CODEX_ASK_FOR_APPROVAL_VALUES.has(normalized)) return null;
  return normalized;
}

function shouldSkipGitRepoCheck(toolState: ToolState): boolean {
  return toolState.codex_skip_git_repo_check === true;
}

const resolveCodexCommand = createDriverCommandResolver({
  envKeys: ['CODEX_COMMAND', 'CODEX_BIN'],
  binaryName: 'codex',
  platformFallback: () =>
    isMacOS && existsSync(CODEX_APP_BUNDLE_COMMAND) ? CODEX_APP_BUNDLE_COMMAND : null,
});

/** Drives Codex CLI via JSON streaming, supporting thread resumption and sandbox approval policies. */
export class CodexDriver implements Driver {
  readonly name = 'codex' as const;

  buildCommand(): string {
    return resolveCodexCommand();
  }

  buildArgs(prompt: string, session: Session, mode: Mode, options: DriverBuildOptions): string[] {
    const threadId = session.toolState.thread_id;
    const askForApprovalOverride = extractAskForApproval(session.toolState);
    // Approval policy:
    // - readonly: never use 'never' — MCP tools are outside the sandbox and
    //   must trigger approval prompts so HuskyGate can detect & block them.
    //   resolveAutoApprove() already guarantees autoApproveEnabled=false for
    //   readonly, but this is defense-in-depth.
    // - write + auto-approve: 'never' (all tools execute without prompts)
    // - write + no auto-approve: per-session override or 'on-request'
    const approvalPolicy = (() => {
      if (mode === 'readonly') return askForApprovalOverride ?? 'on-request';
      if (options.autoApproveEnabled) return 'never';
      return askForApprovalOverride ?? 'on-request';
    })();
    const args: string[] = [];

    // Apply sandbox/approval as global options so resume subcommand also honors them.
    args.push('-s', mode === 'readonly' ? 'read-only' : 'workspace-write');
    args.push('-a', approvalPolicy);

    // Enable network access for the workspace-write sandbox
    if (mode !== 'readonly') {
      args.push('-c', 'sandbox_workspace_write.network_access=true');
    }

    // Disable WebSocket transport for the Responses API.  The
    // `responses_websockets` / `responses_websockets_v2` features can be
    // enabled by server-side rollout, but WebSocket connections fail in the
    // headless spawned-process environment (no TTY, sandbox restrictions),
    // causing 5 retries + fallback delay.
    // SSE/HTTP is sufficient for `exec --json` streaming.
    args.push('--disable', 'responses_websockets');
    args.push('--disable', 'responses_websockets_v2');

    const model = resolveModel(session, 'CODEX_MODEL');
    if (model) {
      args.push('-m', model);
    }

    args.push('exec');
    if (shouldSkipGitRepoCheck(session.toolState)) {
      args.push('--skip-git-repo-check');
    }

    if (threadId) {
      // `resume` is a subcommand of `exec`, so it must appear before `--`.
      // --json is a resume-level option; --output-last-message (injected later)
      // stays at exec-level between `exec` and `resume`.
      args.push('resume', '--json', threadId, '--', prompt);
    } else {
      args.push('--json', '--', prompt);
    }
    return args;
  }

  buildEnv(): Record<string, string> {
    return buildDriverEnv('codex');
  }

  parseEvent(line: string): DriverEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const plainToolUse = extractToolUseFromLine(trimmed);
    if (plainToolUse) {
      return {
        type: 'tool_use',
        content: `Using tool: ${plainToolUse.toolName}`,
        raw: {
          tool_name: plainToolUse.toolName,
        },
      };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // Codex CLI is always invoked with --json, so ALL legitimate
      // content (text deltas, tool calls, thread events) arrives as
      // JSONL objects.  Any non-JSON stdout line is CLI noise —
      // reconnection messages, transport fallbacks, warnings, etc.
      // Tool-use announcements ("Using tool: X") are already handled
      // by extractToolUseFromLine above, so we can safely discard
      // everything that fails JSON.parse.
      return null;
    }

    const eventType = parsed.type as string | undefined;

    if (eventType === 'thread.started') {
      const threadId = parsed.thread_id as string | undefined;
      if (threadId) {
        return { type: 'status', content: `thread:${threadId}`, raw: parsed };
      }
    }

    if (eventType === 'response.output_text.delta') {
      const delta = parsed.delta as string | undefined;
      if (delta) {
        return { type: 'text', content: delta, raw: parsed };
      }
    }

    if (eventType === 'response.output_text.done') {
      const text = parsed.text as string | undefined;
      if (text) {
        return { type: 'text', content: text, raw: parsed };
      }
    }

    if (eventType === 'turn.completed') {
      const output = parsed.output as string | undefined;
      if (output) {
        return { type: 'text', content: output, raw: parsed };
      }
      const nested = extractAssistantText(parsed.turn ?? parsed);
      if (nested) {
        return { type: 'text', content: nested, raw: parsed };
      }
    }

    if (eventType?.startsWith('item.')) {
      const parsedItem = parseCodexItemEvent(
        parsed.item as Record<string, unknown> | undefined,
        parsed,
      );
      if (parsedItem) return parsedItem;
    }

    if (eventType === 'response.output_item.added') {
      const parsedItem = parseCodexItemEvent(
        parsed.item as Record<string, unknown> | undefined,
        parsed,
      );
      if (parsedItem?.type === 'tool_use' || parsedItem?.type === 'tool_result') {
        return parsedItem;
      }
    }

    if (eventType === 'response.output_item.done' || eventType === 'response.completed') {
      const nested = extractAssistantText(parsed);
      if (nested) {
        return { type: 'text', content: nested, raw: parsed };
      }
    }

    const genericToolUse = extractToolUseInfo(parsed, { requireToolName: true });
    if (genericToolUse) {
      return {
        type: 'tool_use',
        content: `Using tool: ${genericToolUse.toolName}`,
        toolInput: genericToolUse.args ?? undefined,
        raw: {
          ...parsed,
          tool_name: genericToolUse.toolName,
          ...(genericToolUse.args !== null ? { arguments: genericToolUse.args } : {}),
        },
      };
    }

    // Codex-specific: detect tool use from plain-text lines in assistant output.
    // Extract once and reuse to avoid redundant recursive traversal.
    const fallbackText = extractAssistantText(parsed);
    if (fallbackText) {
      for (const textLine of fallbackText.split(/\r?\n/)) {
        const lineToolUse = extractToolUseFromLine(textLine.trim());
        if (lineToolUse) {
          return {
            type: 'tool_use',
            content: `Using tool: ${lineToolUse.toolName}`,
            raw: { ...parsed, tool_name: lineToolUse.toolName },
          };
        }
      }
    }

    if (eventType === 'error') {
      const message = parsed.message as string | undefined;
      return { type: 'error', content: message ?? 'Unknown error', raw: parsed };
    }

    if (fallbackText) {
      return { type: 'text', content: fallbackText, raw: parsed };
    }

    return null;
  }

  parseStderr(line: string): DriverEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    if (isNonFatalStderr(NON_FATAL_STDERR_PATTERNS, trimmed)) {
      return { type: 'status', content: trimmed };
    }

    const toolUse = extractToolUseFromLine(trimmed);
    if (toolUse) {
      return {
        type: 'tool_use',
        content: `Using tool: ${toolUse.toolName}`,
        raw: {
          tool_name: toolUse.toolName,
        },
      };
    }

    // Some Codex variants emit JSONL events on stderr.
    const stderrEvent = tryParseStderrAsEvent(trimmed, (l) => this.parseEvent(l));
    if (stderrEvent) return stderrEvent;

    return { type: 'error', content: trimmed };
  }

  extractSessionState(events: DriverEvent[]): ToolState {
    for (const event of events) {
      if (event.type === 'status' && event.content.startsWith('thread:')) {
        return { thread_id: event.content.slice('thread:'.length) };
      }
    }
    return {};
  }
}
