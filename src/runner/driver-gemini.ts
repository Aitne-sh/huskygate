/** @module driver-gemini — Driver implementation for the Gemini CLI. */
import type { Mode, Session, ToolState } from '../session/types.js';
import { logger } from '../utils/logger.js';
import { findInFallbackDirs, resolveCommand } from '../utils/platform.js';
import {
  SHARED_NON_FATAL_STDERR_PATTERNS,
  buildDriverEnv,
  extractAndValidateAllowedTools,
  extractAssistantText,
  isNonFatalStderr,
  normalizeCommand,
  resolveModel,
  tryParseStderrAsEvent,
} from './driver-utils.js';
import type { Driver, DriverBuildOptions, DriverEvent } from './types.js';

const NON_FATAL_STDERR_PATTERNS: RegExp[] = [
  ...SHARED_NON_FATAL_STDERR_PATTERNS,
  /^Loaded cached credentials\.?$/i,
  /^Found stored OAuth token for server /i,
  /^Loading extension:/i,
  /^Attempt \d+ failed: .*Retrying after .*$/i,
  /^Error executing tool .*: Tool execution denied by policy\.?$/i,
  /^No www-authenticate header in error/i,
  /^Attempting OAuth discovery for /i,
  /^Dynamic client registration is supported at:/i,
  /^Discovered OAuth configuration from base URL for server/i,
  /^Starting OAuth authentication for server/i,
  /^OAuth callback server listening on port /i,
  /^Skill conflict detected:/i,
  /^Hook registry initialized with \d+ hook entries$/i,
  /^strict mode: use allowUnionTypes to allow union type keyword/i,
  /^YOLO mode is enabled/i,
  /has been cached/i,
  /supports tool updates/i,
  /^Listening for changes/i,
  /^Bash command parsing error/i,
  /You have exhausted your capacity on this model/i,
  /No capacity available for model/i,
  /^Warning:.*--allowed-tools.*deprecated/i,
  // Gemini CLI wraps MCP errors with [MCP error] prefix (e.g. Connection closed during discovery)
  /^\[MCP error\]/i,
  /^McpError:/i,
  // JS stack trace lines and error object fragments emitted alongside MCP errors
  /^at\s+\S+\s*\(/,
  /^code:\s*-?\d+/,
  /^data:\s*(undefined|null)\s*,?\s*$/,
  /^[{}]\s*$/,
];

const GEMINI_ALLOWED_TOOL_PATTERN = /^[A-Za-z0-9_.*-]+$/;

function extractAllowedTools(toolState: ToolState): string[] {
  return extractAndValidateAllowedTools(
    toolState,
    'gemini_runtime_allowed_tools',
    GEMINI_ALLOWED_TOOL_PATTERN,
  );
}

interface ResolvedGeminiCommand {
  command: string;
  prefixArgs: string[];
}

let cachedResolved: ResolvedGeminiCommand | null = null;

function resolveGeminiCommand(): ResolvedGeminiCommand {
  // Env overrides are always re-read (cheap and may change between calls)
  const override =
    normalizeCommand(process.env.GEMINI_COMMAND) ?? normalizeCommand(process.env.GEMINI_BIN);
  if (override) {
    return { command: override, prefixArgs: [] };
  }

  // Return cached result from the first successful resolution
  if (cachedResolved) return cachedResolved;

  // Cross-platform: resolveCommand uses login shell on Unix, where.exe on Windows
  const resolved = resolveCommand('gemini');
  if (resolved) {
    cachedResolved = { command: resolved, prefixArgs: [] };
    return cachedResolved;
  }

  // Fallback: check known install directories (e.g. ~/.local/bin, %APPDATA%\npm)
  const fallback = findInFallbackDirs('gemini');
  if (fallback) {
    cachedResolved = { command: fallback, prefixArgs: [] };
    return cachedResolved;
  }

  // Fall back to npx to run @google/gemini-cli (always gets latest cached version)
  const npxPath = resolveCommand('npx');
  if (npxPath) {
    cachedResolved = { command: npxPath, prefixArgs: ['--yes', '@google/gemini-cli'] };
    return cachedResolved;
  }

  cachedResolved = { command: 'gemini', prefixArgs: [] };
  return cachedResolved;
}

/**
 * Resolve the readonly approval mode for Gemini CLI from env.
 * Returns `'plan'` when explicitly set; `null` otherwise (default sandbox behavior).
 * Logs a warning for unrecognized values.
 */
function resolveGeminiReadonlyApprovalMode(): 'plan' | null {
  const raw = process.env.GEMINI_READONLY_APPROVAL_MODE;
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (normalized === 'plan') return 'plan';
  if (normalized && normalized !== 'default') {
    logger.warn('gemini_readonly_approval_mode_unrecognized', {
      value: raw,
      fallback: 'default',
    });
  }
  return null;
}

/** Drives Gemini CLI via stream-json output, with npx fallback resolution and sandbox/yolo mode selection. */
export class GeminiDriver implements Driver {
  readonly name = 'gemini' as const;

  buildCommand(): string {
    return resolveGeminiCommand().command;
  }

  /** Prefix args needed when command is npx (e.g. ['--yes', '@google/gemini-cli']). */
  getCommandPrefixArgs(): string[] {
    return resolveGeminiCommand().prefixArgs;
  }

  buildArgs(prompt: string, session: Session, mode: Mode, options: DriverBuildOptions): string[] {
    const args = [...this.getCommandPrefixArgs(), '-p', prompt, '--output-format', 'stream-json'];

    const model = resolveModel(session, 'GEMINI_MODEL');
    if (model) {
      args.push('--model', model);
    }

    if (mode === 'write') {
      // write mode: full tool access (read, write, shell)
      args.push('--approval-mode', 'yolo');

      if (options.allowMcp === false) {
        // Gemini CLI's yolo mode auto-approves ALL tools including MCP.
        // There is no CLI flag to restrict MCP tools in yolo mode (--allowed-tools
        // is deprecated in ≥1.0). Defense-in-depth is enforced at other layers:
        // - Cloud env vars are not forwarded (buildDriverEnv)
        // - Skill files are not seeded (seedBuiltinSkills)
        // - Job executor post-hoc kill on MCP tool use
        logger.info('gemini_allowMcp_false_limitation', {
          note: 'Gemini CLI yolo mode cannot restrict MCP tools via CLI args; relying on env/skill/post-hoc layers',
        });
      }
    } else {
      // readonly mode: sandbox restricts tools to read_file, grep_search, cli_help
      args.push('--sandbox');
      const readonlyApprovalMode = resolveGeminiReadonlyApprovalMode();
      if (readonlyApprovalMode === 'plan') {
        args.push('--approval-mode', 'plan');
      }
    }

    const rawSessionIndex = session.toolState.session_index;
    const sessionIndex = typeof rawSessionIndex === 'string' ? rawSessionIndex : undefined;
    const resumeReady = session.toolState.gemini_resume_ready === true;
    if (sessionIndex && resumeReady) {
      args.push('--resume', sessionIndex);
    }

    // In write mode, --approval-mode yolo already approves all tools.
    // Skip --allowed-tools to avoid deprecated flag warning in Gemini CLI ≥1.0.
    if (mode === 'readonly') {
      // Defense-in-depth for readonly: strip MCP tools that leaked in via
      // gemini_runtime_allowed_tools.  MCP tools operate outside the sandbox
      // and can perform writes/mutations on external systems.
      const allowedTools = extractAllowedTools(session.toolState).filter(
        (t) => !t.startsWith('mcp_') && !t.startsWith('mcp__'),
      );

      for (const tool of allowedTools) {
        args.push('--allowed-tools', tool);
      }
    }

    return args;
  }

  buildEnv(): Record<string, string> {
    return buildDriverEnv('gemini');
  }

  parseEvent(line: string): DriverEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // Gemini CLI is invoked with --output-format stream-json, so all
      // legitimate content (messages, tool_use, tool_result, init, done)
      // arrives as JSONL objects.  Any non-JSON stdout line is CLI noise —
      // MCP warnings, startup messages, status lines, etc.
      //
      // When a noise prefix is concatenated with valid JSON on the same
      // line (e.g. "MCP issues detected.{"type":"init",...}"), try to
      // extract the embedded JSON and parse it normally.
      // Iterate through '{' positions to handle noise that contains '{'.
      let pos = trimmed.indexOf('{', 1);
      while (pos > 0) {
        try {
          const embedded = trimmed.slice(pos);
          JSON.parse(embedded); // validate before recursing
          return this.parseEvent(embedded);
        } catch {
          // Try next '{' position
        }
        pos = trimmed.indexOf('{', pos + 1);
      }
      return null;
    }

    const eventType = parsed.type as string | undefined;

    // Capture session init event (emitted first, contains session UUID)
    if (eventType === 'init') {
      const sessionId = parsed.session_id as string | undefined;
      return { type: 'status', content: `Session: ${sessionId ?? 'unknown'}`, raw: parsed };
    }

    // Current stream-json schema (gemini-cli v0.28.x)
    if (eventType === 'message') {
      const role = parsed.role as string | undefined;
      const content = parsed.content as string | undefined;
      if (role === 'assistant' && content) {
        return { type: 'text', content, raw: parsed };
      }
      return null;
    }

    if (eventType === 'tool_use') {
      const name = parsed.tool_name as string | undefined;
      const args = parsed.arguments ?? parsed.input ?? parsed.args;
      return {
        type: 'tool_use',
        content: `Using tool: ${name ?? 'unknown'}`,
        toolInput: args ?? undefined,
        raw: parsed,
      };
    }

    if (eventType === 'tool_result') {
      const output = parsed.output as string | undefined;
      const error = parsed.error as Record<string, unknown> | undefined;
      const errorMessage = error?.message as string | undefined;
      return {
        type: 'tool_result',
        content: output ?? errorMessage ?? '',
        raw: parsed,
      };
    }

    if (eventType === 'result') {
      const status = parsed.status as string | undefined;
      if (status === 'error') {
        const error = parsed.error as Record<string, unknown> | undefined;
        const message = error?.message as string | undefined;
        return { type: 'error', content: message ?? 'Unknown error', raw: parsed };
      }
      // Extract final response text embedded in the result event.
      // Gemini CLI may include the final assistant response only in the
      // result event (not streamed via separate message events), especially
      // in sandbox mode.  Without this, post-tool response text is lost.
      // Returning as type 'text' with raw.type 'result' marks it as an
      // aggregate event (see AGGREGATE_TEXT_RAW_TYPES), so it won't
      // duplicate already-streamed message events.
      const responseText = extractAssistantText(parsed);
      if (responseText) {
        return { type: 'text', content: responseText, raw: parsed };
      }
      return { type: 'done', content: '', raw: parsed };
    }

    if (eventType === 'error') {
      const severity = parsed.severity as string | undefined;
      const message = parsed.message as string | undefined;
      if (severity === 'warning') {
        return { type: 'status', content: message ?? '', raw: parsed };
      }
      return { type: 'error', content: message ?? 'Unknown error', raw: parsed };
    }

    // Legacy schema compatibility
    if (eventType === 'partialResponse' || eventType === 'response') {
      const text = parsed.text as string | undefined;
      if (text) {
        return { type: 'text', content: text, raw: parsed };
      }
    }

    if (eventType === 'toolCall') {
      const name = parsed.name as string | undefined;
      const args = parsed.arguments ?? parsed.input ?? parsed.args;
      return {
        type: 'tool_use',
        content: `Using tool: ${name ?? 'unknown'}`,
        toolInput: args ?? undefined,
        raw: parsed,
      };
    }

    if (eventType === 'toolResult') {
      const output = parsed.output as string | undefined;
      return {
        type: 'tool_result',
        content: output ?? '',
        raw: parsed,
      };
    }

    if (eventType === 'done' || eventType === 'end') {
      return { type: 'done', content: '', raw: parsed };
    }

    // Fallback: try extracting text from content array
    const parts = parsed.parts as Array<Record<string, unknown>> | undefined;
    if (parts) {
      const texts = parts.filter((p) => p.text !== undefined).map((p) => p.text as string);
      if (texts.length > 0) {
        return { type: 'text', content: texts.join('\n'), raw: parsed };
      }
    }

    return null;
  }

  parseStderr(line: string): DriverEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    if (isNonFatalStderr(NON_FATAL_STDERR_PATTERNS, trimmed)) {
      return { type: 'status', content: trimmed };
    }

    // Gemini may emit JSON events to stderr in some environments.
    const event = tryParseStderrAsEvent(trimmed, (l) => this.parseEvent(l));
    if (event) return event;

    return { type: 'error', content: trimmed };
  }

  extractSessionState(events: DriverEvent[]): ToolState {
    // Prefer session UUID from init event (available even when process is killed).
    for (const event of events) {
      const raw = event.raw as Record<string, unknown> | undefined;
      if (raw?.type === 'init' && typeof raw.session_id === 'string') {
        return { session_index: raw.session_id, gemini_resume_ready: true };
      }
    }
    // Fallback for older Gemini CLI that may not emit init events.
    const completed = events.some((event) => event.type === 'done');
    if (!completed) return {};
    return { session_index: 'latest', gemini_resume_ready: true };
  }
}
