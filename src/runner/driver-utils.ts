/** @module driver-utils — Shared utilities for AI drivers: env builder, text extraction, tool-use parsing, and command resolution */
import type { ToolName } from '../config.js';
import type { Session, ToolState } from '../session/types.js';
import { type SkillCatalogEntry, buildSkillRef } from '../skills/catalog.js';
import type { DriverEvent } from './types.js';

// ---------------------------------------------------------------------------
// Shared helpers extracted from driver-claude, driver-gemini, driver-codex
// ---------------------------------------------------------------------------

/**
 * Remove a leading "Error: " prefix (case-insensitive) from a stderr line.
 * Used by claude and gemini drivers before pattern matching.
 * @internal Exported for unit testing.
 */
export function stripErrorPrefix(line: string): string {
  return line
    .trim()
    .replace(/^Error:\s*/i, '')
    .trim();
}

/**
 * Normalise an environment/config value: trims whitespace, rejects
 * sentinel strings ("undefined", "null"), and returns null for empties.
 */
export function normalizeCommand(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === 'undefined' || trimmed === 'null') return null;
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve a model override from session state or an environment variable.
 * Returns null when the default should be used.
 */
export function resolveModel(session: Session, envKey: string): string | null {
  const sessionModel = session.toolState.model;
  if (
    typeof sessionModel === 'string' &&
    sessionModel.trim() &&
    sessionModel.trim().toLowerCase() !== 'default'
  )
    return sessionModel.trim();
  const envModel = process.env[envKey];
  if (
    typeof envModel === 'string' &&
    envModel.trim() &&
    envModel.trim().toLowerCase() !== 'default'
  )
    return envModel.trim();
  return null;
}

/**
 * Push a non-empty string into a buffer (used when extracting assistant text).
 * @internal Exported for test access only.
 */
export function pushIfNonEmpty(buffer: string[], value: unknown): void {
  if (typeof value !== 'string') return;
  if (!value) return;
  buffer.push(value);
}

/** @internal Exported for test access only. */
export const COLLECT_MAX_DEPTH = 20;

/**
 * Recursively extract visible assistant text from a nested API response.
 * Handles Claude, Codex, and Gemini response shapes.
 * Skips thinking, tool_use, and tool_result blocks.
 */
export function collectAssistantText(value: unknown, buffer: string[], depth = 0): void {
  if (!value || depth > COLLECT_MAX_DEPTH) return;
  if (typeof value === 'string') {
    buffer.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectAssistantText(item, buffer, depth + 1);
    }
    return;
  }

  if (typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : null;
  const role = typeof record.role === 'string' ? record.role : null;

  // Skip non-text content blocks: thinking, tool calls, and tool results.
  // Only extract text from 'text' / 'output_text' blocks and assistant messages.
  if (type === 'thinking' || type === 'tool_use' || type === 'tool_result') return;

  if (type === 'output_text' || type === 'text' || type === 'text_delta') {
    pushIfNonEmpty(buffer, record.text);
  }
  if (type === 'output_text_delta') {
    pushIfNonEmpty(buffer, record.delta);
  }
  if (type === 'result') {
    pushIfNonEmpty(buffer, record.result);
  }

  if (role === 'assistant') {
    if (typeof record.content === 'string') {
      pushIfNonEmpty(buffer, record.content);
    } else if (record.content) {
      collectAssistantText(record.content, buffer, depth + 1);
    }
  }

  if (record.item) collectAssistantText(record.item, buffer, depth + 1);
  if (record.message) collectAssistantText(record.message, buffer, depth + 1);
  if (record.turn) collectAssistantText(record.turn, buffer, depth + 1);
  if (record.output) collectAssistantText(record.output, buffer, depth + 1);
  if (record.response) collectAssistantText(record.response, buffer, depth + 1);
  if (record.content && role !== 'assistant')
    collectAssistantText(record.content, buffer, depth + 1);
  if (record.parts) collectAssistantText(record.parts, buffer, depth + 1);
}

/**
 * Extract all visible assistant text from a response payload, joining with newlines.
 */
export function extractAssistantText(value: unknown): string | null {
  const texts: string[] = [];
  collectAssistantText(value, texts);
  if (texts.length === 0) return null;
  return texts.join('\n');
}

/**
 * Check whether a stderr line matches any of the non-fatal patterns.
 * Strips the "Error: " prefix before matching.
 */
export function isNonFatalStderr(patterns: RegExp[], line: string): boolean {
  const normalized = stripErrorPrefix(line);
  return patterns.some((pattern) => pattern.test(normalized));
}

// ---------------------------------------------------------------------------
// Shared tool-use extraction helpers
// ---------------------------------------------------------------------------

/**
 * Union of `type` values that indicate a tool-call event across all drivers.
 * Claude uses `tool_use` and `input_json_delta`; Codex uses the rest.
 */
export const TOOL_CALL_TYPES = new Set([
  'tool_use',
  'input_json_delta', // Claude
  'function_call',
  'tool_call',
  'mcp_tool_call',
  'custom_tool_call',
  'call_tool', // Codex
]);

/**
 * Safely narrow an unknown value to a plain object (not an array).
 * @internal Exported for unit testing.
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Extract tool name and arguments from a parsed JSON event.
 *
 * Searches candidate sub-objects (`item`, `content_block`, `delta`,
 * `tool_use`, and the root itself) for tool-call indicators.
 *
 * @param options.requireToolName  When `true` (Codex), candidates without a
 *   tool name are skipped and the returned `toolName` is guaranteed non-null.
 *   When `false` or omitted (Claude), a candidate with only `args` is valid.
 */
export function extractToolUseInfo(
  parsed: Record<string, unknown>,
  options: { requireToolName: true },
): { toolName: string; args: unknown | null } | null;
export function extractToolUseInfo(
  parsed: Record<string, unknown>,
  options?: { requireToolName?: boolean },
): { toolName: string | null; args: unknown | null } | null;
export function extractToolUseInfo(
  parsed: Record<string, unknown>,
  options?: { requireToolName?: boolean },
): { toolName: string | null; args: unknown | null } | null {
  const candidates = [
    asRecord(parsed.item),
    asRecord(parsed.content_block),
    asRecord(parsed.delta),
    asRecord(parsed.tool_use),
    asRecord(parsed),
  ].filter((c): c is Record<string, unknown> => c !== null);

  for (const candidate of candidates) {
    const functionInfo = asRecord(candidate.function);
    const candidateType = typeof candidate.type === 'string' ? candidate.type : functionInfo?.type;
    const isToolCallCandidate =
      (typeof candidateType === 'string' && TOOL_CALL_TYPES.has(candidateType)) ||
      typeof candidate.tool_name === 'string' ||
      typeof candidate.tool === 'string' ||
      typeof candidate.call_id === 'string' ||
      typeof functionInfo?.name === 'string';
    if (!isToolCallCandidate) continue;

    const toolName =
      (candidate.name as string | undefined) ??
      (candidate.tool_name as string | undefined) ??
      (candidate.tool as string | undefined) ??
      (functionInfo?.tool_name as string | undefined) ??
      (functionInfo?.tool as string | undefined) ??
      (functionInfo?.name as string | undefined) ??
      null;

    if (options?.requireToolName && !toolName) continue;

    const args =
      candidate.arguments ??
      candidate.args ??
      candidate.input ??
      candidate.parameters ??
      candidate.partial_json ??
      candidate.payload ??
      functionInfo?.arguments ??
      functionInfo?.args ??
      functionInfo?.input ??
      null;

    if (toolName || args !== null) {
      return { toolName, args };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Shared stderr JSON fallback
// ---------------------------------------------------------------------------

/**
 * Attempt to parse a stderr line as a JSON event.
 *
 * Both Codex and Gemini may emit JSONL on stderr in certain environments.
 * This helper validates the line is valid JSON before delegating to the
 * driver's `parseEvent` to avoid creating spurious error events.
 */
export function tryParseStderrAsEvent(
  trimmed: string,
  parseEvent: (line: string) => DriverEvent | null,
): DriverEvent | null {
  try {
    JSON.parse(trimmed);
    return parseEvent(trimmed);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Safe system environment builder
// ---------------------------------------------------------------------------

/**
 * Exact-match system env var keys safe to forward to driver subprocesses.
 * Covers shell/terminal, locale, XDG, macOS, and proxy/TLS.
 */
const SAFE_SYSTEM_ENV_EXACT_KEYS: ReadonlySet<string> = new Set([
  // Shell / Terminal
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'TMPDIR',
  'SECURITYSESSIONID',
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'COLORTERM',
  'FORCE_COLOR',
  // Locale
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  // XDG
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_CACHE_HOME',
  'XDG_RUNTIME_DIR',
  // macOS
  '__CFBundleIdentifier',
  '__CF_USER_TEXT_ENCODING',
  // Proxy / TLS
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'all_proxy',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
]);

/**
 * Prefix patterns for system env vars that should be forwarded.
 */
const SAFE_SYSTEM_ENV_PREFIXES: readonly string[] = [
  'LC_', // LC_MESSAGES, LC_TIME, etc.
];

/**
 * Build a safe base environment for driver subprocesses.
 *
 * Whitelists only system-level keys (shell, locale, proxy, TLS) —
 * no application secrets, no daemon tokens, no other-driver API keys.
 * Driver-specific keys (ANTHROPIC_API_KEY, GEMINI_API_KEY, etc.) must be
 * added by each driver's `buildEnv()` explicitly.
 * @internal Exported for unit testing.
 */
export function buildSafeSystemEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (SAFE_SYSTEM_ENV_EXACT_KEYS.has(key)) {
      env[key] = value;
      continue;
    }
    if (SAFE_SYSTEM_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      env[key] = value;
    }
  }
  return env;
}

/**
 * Collect exact-match env vars from process.env.
 * Empty strings are treated as unset.
 */
function collectExactEnv(keys: readonly string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

// ---------------------------------------------------------------------------
// Skill environment variable collection
// ---------------------------------------------------------------------------

export function collectSkillEnv(
  skillEntries: readonly Pick<SkillCatalogEntry, 'manifest'>[],
): Record<string, string> {
  const env: Record<string, string> = {};
  const keys = new Set<string>();
  for (const entry of skillEntries) {
    for (const key of entry.manifest.envVars) {
      keys.add(key);
    }
  }
  Object.assign(env, collectExactEnv([...keys]));
  return env;
}

// ---------------------------------------------------------------------------
// Cloud provider environment variable forwarding
// ---------------------------------------------------------------------------

/**
 * Prefix-based patterns for cloud provider env vars that should be forwarded
 * to driver subprocesses so that CLI skills (aws-cli, azure-cli, gcp-cli)
 * and MCP servers can authenticate.
 */
const CLOUD_ENV_PREFIXES = ['AWS_', 'AZURE_', 'CLOUDSDK_', 'GOOGLE_CLOUD_'] as const;

/**
 * Exact-match env var names that don't fit a prefix pattern but are
 * required by cloud provider tooling.
 */
const CLOUD_ENV_EXACT_KEYS = ['GOOGLE_APPLICATION_CREDENTIALS'] as const;

/**
 * Collect cloud provider environment variables from `process.env`.
 *
 * Matches:
 * - `AWS_*`           – AWS CLI / SDK credentials & config
 * - `AZURE_*`         – Azure CLI / SDK credentials & config
 * - `CLOUDSDK_*`      – Google Cloud SDK config
 * - `GOOGLE_CLOUD_*`  – GCP project, region, quota (e.g. GOOGLE_CLOUD_PROJECT)
 * - `GOOGLE_APPLICATION_CREDENTIALS` – GCP service account key path
 *
 * Called by every driver's `buildEnv()` to ensure skills & MCP servers
 * can authenticate regardless of which AI backend is in use.
 */
export function collectCloudProviderEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of Object.keys(process.env)) {
    const val = process.env[key];
    if (!val) continue;
    if (CLOUD_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      env[key] = val;
    }
  }
  for (const key of CLOUD_ENV_EXACT_KEYS) {
    const val = process.env[key];
    if (val) env[key] = val;
  }
  return env;
}

const DRIVER_ENV_EXACT_KEYS: Readonly<Record<ToolName, readonly string[]>> = {
  claude: [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CONFIG_DIR',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
  ],
  codex: ['OPENAI_API_KEY', 'CODEX_HOME'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_CLI_HOME'],
};

/**
 * Collect driver-specific env vars that each CLI legitimately depends on.
 * @internal Exported for unit testing.
 */
export function collectDriverSpecificEnv(tool: ToolName): Record<string, string> {
  return collectExactEnv(DRIVER_ENV_EXACT_KEYS[tool]);
}

/** Cloud CLI skill IDs — used to check if cloud env vars should be forwarded. */
export const CLOUD_SKILL_IDS: ReadonlySet<string> = new Set([
  buildSkillRef('builtin', 'aws-cli'),
  buildSkillRef('builtin', 'azure-cli'),
  buildSkillRef('builtin', 'gcp-cli'),
]);

/**
 * Build the base env for a driver subprocess.
 *
 * Includes:
 * - safe system/runtime keys
 * - tool-specific auth/config keys
 *
 * Cloud provider env vars (AWS_*, AZURE_*, GOOGLE_*) are NOT included here.
 * They are conditionally merged by the job executor based on the task's
 * execution policy (enabledSkills + allowMcp).
 *
 * Non-cloud skill env vars are also merged later by the job executor.
 */
export function buildDriverEnv(tool: ToolName): Record<string, string> {
  const env = buildSafeSystemEnv();
  Object.assign(env, collectDriverSpecificEnv(tool));
  return env;
}

// ---------------------------------------------------------------------------
// 4-1: Shared driver command resolver factory
// ---------------------------------------------------------------------------

import { findInFallbackDirs, resolveCommand } from '../utils/platform.js';

export interface CommandResolverConfig {
  /** Environment variable names to check for overrides (e.g. ['CLAUDE_COMMAND', 'CLAUDE_BIN']) */
  envKeys: readonly string[];
  /** The CLI binary name (e.g. 'claude', 'gemini') */
  binaryName: string;
  /** Optional fallback function for platform-specific resolution (e.g. app bundles) */
  platformFallback?: () => string | null;
  /** Optional npx fallback package (e.g. '@google/gemini-cli') */
  npxPackage?: string;
}

/**
 * Create a cached command resolver for a driver binary.
 * Eliminates the repeated env-override → cache → resolveCommand → fallback pattern
 * across claude, codex, and gemini drivers.
 */
export function createDriverCommandResolver(config: CommandResolverConfig): () => string {
  let cached: string | null = null;
  return () => {
    // 1. Check env overrides (always re-checked so removal takes effect immediately;
    //    result is NOT cached to avoid stale values when env vars are unset)
    for (const key of config.envKeys) {
      const override = normalizeCommand(process.env[key]);
      if (override) return override;
    }

    // 2. Return cached non-env result
    if (cached) return cached;

    // 3. Platform-specific fallback (e.g. macOS app bundle for Codex)
    if (config.platformFallback) {
      const result = config.platformFallback();
      if (result) {
        cached = result;
        return result;
      }
    }

    // 4. PATH-based resolution
    const resolved = resolveCommand(config.binaryName);
    if (resolved) {
      cached = resolved;
      return resolved;
    }

    // 5. Known install directories
    const fallback = findInFallbackDirs(config.binaryName);
    if (fallback) {
      cached = fallback;
      return fallback;
    }

    // 6. npx fallback (Gemini only — returns npx command, prefix args handled by caller)
    // Skip here: callers needing npx handle it themselves since they need prefixArgs

    cached = config.binaryName;
    return config.binaryName;
  };
}

// ---------------------------------------------------------------------------
// 4-2: Shared allowed-tools extractor
// ---------------------------------------------------------------------------

/**
 * Extract and validate allowed tools from toolState.
 * Shared by Claude and Gemini drivers which have identical logic.
 */
export function extractAndValidateAllowedTools(
  toolState: ToolState,
  key: string,
  pattern: RegExp,
): string[] {
  const raw = toolState[key];
  if (!Array.isArray(raw)) return [];
  const deduped = new Set<string>();
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const tool = value.trim();
    if (!tool || !pattern.test(tool) || deduped.has(tool)) continue;
    deduped.add(tool);
  }
  return [...deduped];
}

// ---------------------------------------------------------------------------
// 4-4: Shared MCP auth non-fatal stderr patterns
// ---------------------------------------------------------------------------

/**
 * Common MCP auth/discovery stderr patterns shared across all drivers.
 * Each driver spreads these into their own NON_FATAL_STDERR_PATTERNS array
 * and adds driver-specific patterns.
 */
export const SHARED_NON_FATAL_STDERR_PATTERNS: readonly RegExp[] = [
  /^Error during discovery for MCP server/i,
  /^Refreshing expired token for MCP server/i,
  /^MCP server '.+' requires authentication/i,
];
