/** @module sanitize — Strip ANSI, control chars, and redact secrets/tokens from text. */
import { SENSITIVE_KEYS } from '../config.js';

// biome-ignore lint/suspicious/noControlCharactersInRegex: Intentionally matching ANSI escape sequences
const ANSI_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

/**
 * Matches control characters that should be stripped from CLI output.
 * Preserves tab (\x09), newline (\x0A), and carriage return (\x0D).
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: Intentionally matching control characters
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

const TOKEN_PATTERNS = [
  /xoxb-[A-Za-z0-9-]+/g,
  /xoxp-[A-Za-z0-9-]+/g,
  /xapp-[A-Za-z0-9-]+/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /AIza[A-Za-z0-9_-]{30,}/g,
  /ghp_[A-Za-z0-9]{36,}/g,
  /gho_[A-Za-z0-9]{36,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[A-Z0-9]{16}/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
];

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SENSITIVE_KEY_PATTERN = [...SENSITIVE_KEYS].map(escapeRegex).join('|');
const JSON_SENSITIVE_VALUE_PATTERN = new RegExp(
  `("(${SENSITIVE_KEY_PATTERN})"\\s*:\\s*")([^"]*)(")`,
  'gi',
);
const DOUBLE_QUOTED_SENSITIVE_VALUE_PATTERN = new RegExp(
  `\\b(${SENSITIVE_KEY_PATTERN})\\b(\\s*[:=]\\s*")([^"]*)(")`,
  'gi',
);
const SINGLE_QUOTED_SENSITIVE_VALUE_PATTERN = new RegExp(
  `\\b(${SENSITIVE_KEY_PATTERN})\\b(\\s*[:=]\\s*')([^']*)(')`,
  'gi',
);
const PLAIN_SENSITIVE_VALUE_PATTERN = new RegExp(
  `\\b(${SENSITIVE_KEY_PATTERN})\\b(\\s*[:=]\\s*)([^\\s,;'"\\]]+)`,
  'gi',
);

/** @internal Exported for unit testing. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

/** @internal Exported for unit testing. */
export function stripControlChars(text: string): string {
  return text.replace(CONTROL_CHAR_REGEX, '');
}

/** @internal Exported for unit testing. */
export function maskTokens(text: string): string {
  let result = text;
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  result = result.replace(JSON_SENSITIVE_VALUE_PATTERN, '$1[REDACTED]$4');
  result = result.replace(DOUBLE_QUOTED_SENSITIVE_VALUE_PATTERN, '$1$2[REDACTED]$4');
  result = result.replace(SINGLE_QUOTED_SENSITIVE_VALUE_PATTERN, '$1$2[REDACTED]$4');
  result = result.replace(PLAIN_SENSITIVE_VALUE_PATTERN, '$1$2[REDACTED]');
  return result;
}

export function sanitize(text: string): string {
  return maskTokens(stripControlChars(stripAnsi(text)));
}

/**
 * Wrap untrusted text for safe embedding in Slack mrkdwn.
 * Single-line text → inline code (`...`).
 * Multi-line text → fenced code block (```...```).
 * Backtick sequences are replaced to prevent code-block breakout.
 */
export function wrapForMrkdwn(text: string): string {
  if (!text) return '`(empty)`';
  if (text.includes('\n')) {
    // Replace triple-backtick sequences to prevent code block breakout
    const safe = text.replace(/```/g, "'''");
    return `\`\`\`\n${safe}\n\`\`\``;
  }
  // For inline code, replace backticks with fullwidth variant (U+FF40)
  const safe = text.replace(/`/g, '\uFF40');
  return `\`${safe}\``;
}
