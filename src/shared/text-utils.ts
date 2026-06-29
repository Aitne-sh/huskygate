/** @module text-utils — Message splitting, size-limit enforcement, and Slack mention formatting utilities */
import { SIZE_LIMITS } from './constants.js';
import { SLACK_USER_ID_RE } from './field-limits.js';

export const MAX_CHARS = SIZE_LIMITS.maxTextChars;
export const MAX_BYTES = SIZE_LIMITS.maxTextBytes;
const MARKDOWN_FENCE_PATTERN = /(^|\n)([ \t]{0,3}```[^\n]*)/g;

export function shouldSplit(text: string): boolean {
  if (text.length >= MAX_CHARS) return true;
  if (Buffer.byteLength(text, 'utf-8') >= MAX_BYTES) return true;
  return false;
}

export function findSplitPoint(text: string): number {
  let splitAt = Math.min(text.length, MAX_CHARS);
  // Shrink split point via binary search if UTF-8 byte size exceeds limit (multibyte text)
  if (splitAt > 0 && Buffer.byteLength(text.slice(0, splitAt), 'utf-8') > MAX_BYTES) {
    let lo = 1;
    let hi = splitAt;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (Buffer.byteLength(text.slice(0, mid), 'utf-8') <= MAX_BYTES) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    splitAt = lo;
  }
  const lastNewline = text.lastIndexOf('\n', splitAt);
  const candidateSplit = lastNewline > splitAt * 0.5 ? lastNewline + 1 : splitAt;
  return adjustSplitPointForMarkdownFence(text, candidateSplit, splitAt);
}

/** @internal Exported for reuse by markdown-blocks splitter. */
export function adjustSplitPointForMarkdownFence(
  text: string,
  candidateSplit: number,
  hardLimit: number,
): number {
  const beforeSplit = text.slice(0, candidateSplit);
  const fenceLineStarts = Array.from(
    beforeSplit.matchAll(new RegExp(MARKDOWN_FENCE_PATTERN)),
    (match) => {
      return (match.index ?? 0) + (match[1]?.length ?? 0);
    },
  );
  if (fenceLineStarts.length % 2 === 0) return candidateSplit;

  const lastFenceLineStart = fenceLineStarts.at(-1) ?? -1;
  // If a code block started only recently, keep the whole fence in the next chunk.
  // For oversized fences that began much earlier, fall back to the hard limit so we still progress.
  return lastFenceLineStart > hardLimit * 0.5 ? lastFenceLineStart : candidateSplit;
}

/**
 * Split text into chunks that respect message size limits.
 * Each chunk is at most MAX_CHARS characters and MAX_BYTES UTF-8 bytes.
 */
export function splitTextToChunks(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining) {
    if (!shouldSplit(remaining)) {
      chunks.push(remaining);
      break;
    }
    const splitAt = findSplitPoint(remaining);
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

/**
 * Format a Slack user mention.  Returns `<@USER_ID>` when userId looks like a
 * valid Slack user ID (e.g. "U01ABC23DEF"), otherwise returns an empty string.
 * This prevents broken mentions for non-Slack origins like `'dashboard'`.
 */
export function formatMention(userId: string | undefined | null): string {
  if (!userId) return '';
  if (!SLACK_USER_ID_RE.test(userId)) return '';
  return `<@${userId}>`;
}

/** Max display length for tool input in Slack/Dashboard messages. */
const TOOL_INPUT_DISPLAY_MAX = 300;

/**
 * Format tool input for display in Slack/Dashboard messages.
 * Returns an empty string when toolInput is absent or empty.
 * Large inputs are truncated with an ellipsis.
 */
export function formatToolInputSummary(
  toolInput: unknown,
  maxLen = TOOL_INPUT_DISPLAY_MAX,
): string {
  if (toolInput === undefined || toolInput === null) return '';
  const str = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);
  if (!str || str === '{}' || str === 'null' || str === 'undefined') return '';
  return str.length > maxLen ? `${str.slice(0, maxLen)}\u2026` : str;
}
