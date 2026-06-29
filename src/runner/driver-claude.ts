/** @module driver-claude — Driver implementation for the Claude Code CLI. */
import crypto from 'node:crypto';
import type { Mode, Session, ToolState } from '../session/types.js';
import { CORE_READONLY_TOOLS, CORE_WRITE_TOOLS } from '../shared/core-tools.js';
import { logger } from '../utils/logger.js';
import {
  SHARED_NON_FATAL_STDERR_PATTERNS,
  buildDriverEnv,
  createDriverCommandResolver,
  extractAndValidateAllowedTools,
  extractAssistantText,
  extractToolUseInfo,
  isNonFatalStderr,
  resolveModel,
} from './driver-utils.js';
import type { Driver, DriverBuildOptions, DriverEvent } from './types.js';

const CLAUDE_ALLOWED_TOOL_PATTERN = /^[A-Za-z0-9_.*:()/-]+$/;

const NON_FATAL_STDERR_PATTERNS: RegExp[] = [
  ...SHARED_NON_FATAL_STDERR_PATTERNS,
  /^Failed to refresh auth token/i,
  /^requires authentication using:/i,
  /^AuthRequired\(AuthRequiredError/i,
  /^Auth\(TokenRefreshFailed\(/i,
  /^upstream_token_error/i,
  /^token refresh failed/i,
  /^MCP connection error/i,
  /^MCP server .+ disconnected/i,
];

const resolveClaudeCommand = createDriverCommandResolver({
  envKeys: ['CLAUDE_COMMAND', 'CLAUDE_BIN'],
  binaryName: 'claude',
});
const CLAUDE_SETTING_SOURCES = new Set(['user', 'project', 'local']);

export function buildClaudeMcpConfigArgs(mcpConfigPath?: string | null): string[] {
  if (!mcpConfigPath) return [];
  return ['--mcp-config', mcpConfigPath, '--strict-mcp-config'];
}

function extractAllowedTools(toolState: ToolState): string[] {
  return extractAndValidateAllowedTools(
    toolState,
    'claude_runtime_allowed_tools',
    CLAUDE_ALLOWED_TOOL_PATTERN,
  );
}

function resolveReadonlyPermissionMode(): 'plan' | 'default' {
  const raw = process.env.CLAUDE_READONLY_PERMISSION_MODE;
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (normalized === 'plan') return 'plan';
  if (normalized && normalized !== 'default') {
    logger.warn('claude_readonly_permission_mode_unrecognized', {
      value: raw,
      fallback: 'default',
    });
  }
  return 'default';
}

function extractSettingSources(toolState: ToolState): string | null {
  const raw = toolState.claude_setting_sources;
  if (typeof raw !== 'string') return null;

  const parts = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.some((part) => !CLAUDE_SETTING_SOURCES.has(part))) return null;

  return [...new Set(parts)].join(',');
}

/** Drives Claude Code CLI via stream-json output, managing session resumption and tool approval. */
export class ClaudeDriver implements Driver {
  readonly name = 'claude' as const;

  buildCommand(): string {
    return resolveClaudeCommand();
  }

  buildArgs(prompt: string, session: Session, mode: Mode, options: DriverBuildOptions): string[] {
    const args = [...buildClaudeMcpConfigArgs(options.mcpConfigPath)];
    args.push('-p', prompt, '--output-format', 'stream-json', '--verbose');
    const settingSources = extractSettingSources(session.toolState) ?? 'project';

    const model = resolveModel(session, 'CLAUDE_MODEL');
    if (model) {
      args.push('--model', model);
    }

    args.push('--setting-sources', settingSources);

    const sessionId = session.toolState.session_id;
    if (sessionId) {
      args.push('--resume', sessionId);
    } else {
      const newSessionId = crypto.randomUUID();
      args.push('--session-id', newSessionId);
    }

    if (mode === 'readonly') {
      args.push('--permission-mode', resolveReadonlyPermissionMode());
    } else {
      args.push('--permission-mode', 'default');
    }

    // Pre-approve mode-appropriate core tools — Claude Code runs non-interactively
    // (stdin is ignored in headless mode), so it cannot respond to permission prompts.
    const coreTools = mode === 'readonly' ? CORE_READONLY_TOOLS : CORE_WRITE_TOOLS;
    const userTools = extractAllowedTools(session.toolState);
    const deduped = new Set([...coreTools, ...userTools]);

    if (mode === 'readonly') {
      // Readonly whitelist enforcement: ONLY core read tools are allowed.
      // Everything else (write tools, MCP, Skill, user-injected tools) is
      // stripped regardless of what operators put in claude_runtime_allowed_tools.
      // Claude CLI's --permission-mode provides a second layer of enforcement.
      const readToolSet = new Set<string>(CORE_READONLY_TOOLS);
      for (const tool of deduped) {
        if (!readToolSet.has(tool)) deduped.delete(tool);
      }
    } else {
      // Write mode additions
      if (options.skillsEnabled) {
        deduped.add('Skill');
      }
      if (options.autoApproveEnabled && options.allowMcp !== false) {
        deduped.add('mcp__*');
      }
    }

    for (const tool of deduped) {
      args.push('--allowed-tools', tool);
    }

    return args;
  }

  buildEnv(): Record<string, string> {
    return buildDriverEnv('claude');
  }

  parseEvent(line: string): DriverEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return { type: 'text', content: trimmed };
    }

    const eventType = parsed.type as string | undefined;

    // Skip internal system events (hooks, init) and rate-limit events.
    // These carry no assistant text; their nested string fields (output,
    // stdout) would be incorrectly captured by the extractAssistantText
    // fallback and leak hook configuration into the text stream.
    if (eventType === 'system' || eventType === 'rate_limit_event') {
      return null;
    }

    // New CLI format: assistant messages carry text, tool_use, or thinking
    // in message.content[].  Tool-use blocks must be detected early so that
    // extractAnswerText() Tier 1 (post-tool text) works correctly and the
    // Layer 4 approval gate can evaluate tool calls.
    if (eventType === 'assistant') {
      const message = parsed.message as Record<string, unknown> | undefined;
      const content = message?.content;
      if (Array.isArray(content)) {
        for (const block of content as Array<Record<string, unknown>>) {
          if (block?.type === 'tool_use') {
            return {
              type: 'tool_use',
              content: typeof block.name === 'string' ? `Using tool: ${block.name}` : trimmed,
              toolInput: block.input ?? undefined,
              raw: parsed,
            };
          }
        }
      }
      // Text / thinking-only messages fall through to extractAssistantText.
    }

    // New CLI format: user messages carry tool_result in message.content[].
    if (eventType === 'user') {
      const message = parsed.message as Record<string, unknown> | undefined;
      const content = message?.content;
      if (Array.isArray(content)) {
        for (const block of content as Array<Record<string, unknown>>) {
          if (block?.type === 'tool_result') {
            const output = block.content;
            return {
              type: 'tool_result',
              content: typeof output === 'string' ? output : '',
              raw: parsed,
            };
          }
        }
      }
      return null; // Discard user events without tool_result
    }

    if (eventType === 'content_block_delta') {
      const delta = parsed.delta as Record<string, unknown> | undefined;
      if (delta?.type === 'text_delta') {
        return { type: 'text', content: delta.text as string, raw: parsed };
      }
      if (delta?.type === 'input_json_delta') {
        return { type: 'tool_use', content: delta.partial_json as string, raw: parsed };
      }
    }

    if (eventType === 'content_block_start') {
      const contentBlock = parsed.content_block as Record<string, unknown> | undefined;
      if (contentBlock?.type === 'tool_use') {
        return {
          type: 'tool_use',
          content: `Using tool: ${contentBlock.name as string}`,
          toolInput: contentBlock.input ?? undefined,
          raw: parsed,
        };
      }
    }

    if (eventType === 'result') {
      const result = parsed.result as string | undefined;
      if (typeof result === 'string' && result) {
        return { type: 'text', content: result, raw: parsed };
      }
      const fallback = extractAssistantText(parsed.result);
      if (fallback) {
        return { type: 'text', content: fallback, raw: parsed };
      }
      const subtype = parsed.subtype as string | undefined;
      if (subtype === 'error_max_turns') {
        return { type: 'error', content: 'Max turns reached', raw: parsed };
      }
    }

    if (eventType === 'tool_use') {
      const toolUse = extractToolUseInfo(parsed);
      return {
        type: 'tool_use',
        content: toolUse?.toolName ? `Using tool: ${toolUse.toolName}` : trimmed,
        toolInput: toolUse?.args ?? undefined,
        raw: parsed,
      };
    }

    if (eventType === 'tool_result') {
      const output = parsed.output as string | undefined;
      const result = output ?? (parsed.result as string | undefined);
      return {
        type: 'tool_result',
        content: result ?? '',
        raw: parsed,
      };
    }

    if (eventType === 'message_start') {
      const sessionId = parsed.session_id as string | undefined;
      if (sessionId) {
        return { type: 'status', content: `session:${sessionId}`, raw: parsed };
      }
    }

    if (eventType === 'message_stop') {
      return { type: 'done', content: '', raw: parsed };
    }

    if (eventType === 'error') {
      const message = parsed.message as string | undefined;
      return { type: 'error', content: message ?? 'Unknown error', raw: parsed };
    }

    const toolUse = extractToolUseInfo(parsed);
    if (toolUse) {
      return {
        type: 'tool_use',
        content: toolUse.toolName ? `Using tool: ${toolUse.toolName}` : trimmed,
        toolInput: toolUse.args ?? undefined,
        raw: parsed,
      };
    }

    const fallbackText = extractAssistantText(parsed);
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

    return { type: 'error', content: trimmed };
  }

  extractSessionState(events: DriverEvent[]): ToolState {
    for (const event of events) {
      if (event.type === 'status' && event.content.startsWith('session:')) {
        return { session_id: event.content.slice('session:'.length) };
      }
    }
    return {};
  }
}
