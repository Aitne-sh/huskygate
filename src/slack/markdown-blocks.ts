/** @module markdown-blocks — Builds Slack Block Kit payloads using the `markdown` block type for LLM output */
import type { ContextBlock, KnownBlock, MarkdownBlock, SectionBlock } from '@slack/types';
import { SIZE_LIMITS } from '../shared/constants.js';
import { adjustSplitPointForMarkdownFence } from '../shared/text-utils.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MARKDOWN_BODY_MAX = SIZE_LIMITS.markdownBodyMaxChars;
const FILE_UPLOAD_THRESHOLD = SIZE_LIMITS.markdownFileUploadThreshold;
const MAX_BLOCKS_PER_MESSAGE = 50;

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface MarkdownMessageOptions {
  /** Header text in mrkdwn format (supports mentions, Slack-specific syntax) */
  header?: string;
  /** Body text in standard Markdown (rendered via markdown block) */
  body: string;
  /** Optional footer text in mrkdwn format */
  footer?: string;
  /** Additional Block Kit elements to prepend (e.g., action buttons) */
  prependBlocks?: KnownBlock[];
  /** Additional Block Kit elements to append (e.g., action buttons) */
  appendBlocks?: KnownBlock[];
}

export interface SlackBlockMessage {
  blocks: KnownBlock[];
  /** Plain-text fallback for clients that don't support Block Kit */
  text: string;
}

export interface TaskCompletionOptions {
  emoji: string;
  taskType: string;
  taskName: string;
  tool: string;
  status: string;
  exitCode: number | string | null;
  mention?: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Splitting — Markdown-structure-aware splitting for markdown blocks
// ---------------------------------------------------------------------------

const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;

/**
 * Detect if the candidate split point falls inside a Markdown table.
 * If so, move the split to just before the table starts.
 */
function adjustSplitPointForTable(text: string, candidateSplit: number): number {
  const beforeSplit = text.slice(0, candidateSplit);
  const afterSplit = text.slice(candidateSplit);

  const linesBefore = beforeSplit.split('\n');
  const firstLineAfter = afterSplit.split('\n', 1)[0] ?? '';

  // Find the last non-empty line before the split
  let lastNonEmptyIdx = linesBefore.length - 1;
  while (lastNonEmptyIdx >= 0 && (linesBefore[lastNonEmptyIdx] ?? '').trim() === '') {
    lastNonEmptyIdx--;
  }
  if (lastNonEmptyIdx < 0) return candidateSplit;

  const lastLineBefore = linesBefore[lastNonEmptyIdx] ?? '';
  if (!TABLE_ROW_RE.test(lastLineBefore) || !TABLE_ROW_RE.test(firstLineAfter)) {
    return candidateSplit;
  }

  // We're inside a table — walk backwards to find where it starts
  let tableStartIdx = lastNonEmptyIdx;
  while (tableStartIdx > 0 && TABLE_ROW_RE.test(linesBefore[tableStartIdx - 1] ?? '')) {
    tableStartIdx--;
  }

  // Calculate char offset at the table start
  let offset = 0;
  for (let i = 0; i < tableStartIdx; i++) {
    offset += (linesBefore[i] ?? '').length + 1; // +1 for newline
  }

  // Only retreat if the table didn't start too early (>30% of content before it)
  if (offset > candidateSplit * 0.3) return offset;
  return candidateSplit;
}

/**
 * Find the best split point within a Markdown text, respecting structure.
 * Priority: heading boundaries > newline boundaries > hard limit.
 * Constraints: never split inside code fences or tables.
 */
function findMarkdownSplitPoint(text: string, limit: number): number {
  const hardLimit = Math.min(text.length, limit);

  // Step 1: Find base candidate at last newline
  const lastNewline = text.lastIndexOf('\n', hardLimit);
  let candidate = lastNewline > hardLimit * 0.5 ? lastNewline + 1 : hardLimit;

  // Step 2: Prefer heading boundaries — look for `\n#` in the last 30% of candidate range
  const searchStart = Math.max(0, Math.floor(candidate * 0.7));
  const searchRegion = text.slice(searchStart, candidate);
  const headingIdx = searchRegion.lastIndexOf('\n#');
  if (headingIdx >= 0) {
    const headingPos = searchStart + headingIdx + 1; // position of `#`
    // Verify it's a real heading (# followed by space or more #)
    if (/^#{1,6}\s/.test(text.slice(headingPos, headingPos + 7))) {
      candidate = headingPos;
    }
  }

  // Step 3: Correctness — never split inside code fences
  candidate = adjustSplitPointForMarkdownFence(text, candidate, hardLimit);

  // Step 4: Correctness — never split inside tables
  candidate = adjustSplitPointForTable(text, candidate);

  // Ensure progress
  return Math.max(1, candidate);
}

/**
 * Split Markdown text into chunks for Slack markdown blocks.
 * Each chunk respects the 12K cumulative limit and preserves
 * code fences, tables, and heading boundaries.
 */
export function splitMarkdownForBlocks(text: string, limit: number = MARKDOWN_BODY_MAX): string[] {
  if (!text) return [''];
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    const splitAt = findMarkdownSplitPoint(remaining, limit);
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Count cumulative characters used by all `markdown` blocks in a block array. */
export function estimateMarkdownBlockChars(blocks: KnownBlock[]): number {
  let total = 0;
  for (const block of blocks) {
    if (block.type === 'markdown') {
      total += (block as MarkdownBlock).text.length;
    }
  }
  return total;
}

/** Generate a plain-text fallback string from message options. */
export function generateFallbackText(
  opts: Pick<MarkdownMessageOptions, 'header' | 'body'>,
): string {
  const parts: string[] = [];
  if (opts.header) parts.push(opts.header);
  const bodyPreview = opts.body.slice(0, 300);
  parts.push(bodyPreview);
  if (opts.body.length > 300) parts.push('...');
  return parts.join('\n\n');
}

/** Whether the body exceeds the file-upload threshold. */
export function exceedsFileUploadThreshold(body: string): boolean {
  return body.length > FILE_UPLOAD_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Build one or more Slack Block Kit messages with `markdown` blocks.
 *
 * - Body <= 11,500 chars: single message (header + markdown + footer)
 * - Body > 11,500 chars: first message gets header; subsequent get continuation label
 * - Body > 40,000 chars: preview in first message, caller should upload .md file
 */
export function buildMarkdownMessage(opts: MarkdownMessageOptions): SlackBlockMessage[] {
  const { header, footer, prependBlocks, appendBlocks } = opts;
  // Safety net: callers (e.g. Messenger.postFinal) typically guard empty input,
  // but this ensures a meaningful body if buildMarkdownMessage is called directly.
  const body = opts.body.trim() || 'Completed.';
  const fallbackText = generateFallbackText({ header, body });

  // For very large output, truncate to a preview.
  // The truncation point must respect Markdown structure (code fences, tables)
  // to avoid producing malformed output.
  const isFileUpload = exceedsFileUploadThreshold(body);
  const truncationSuffix = '\n\n---\n*... output truncated. Full content attached as file.*';
  let effectiveBody: string;
  if (isFileUpload) {
    const rawLimit = MARKDOWN_BODY_MAX - truncationSuffix.length;
    let safeLimit = adjustSplitPointForMarkdownFence(body, rawLimit, rawLimit);
    safeLimit = adjustSplitPointForTable(body, safeLimit);
    effectiveBody = `${body.slice(0, safeLimit)}${truncationSuffix}`;
  } else {
    effectiveBody = body;
  }

  const bodyChunks = splitMarkdownForBlocks(effectiveBody);
  const messages: SlackBlockMessage[] = [];

  for (const [index, chunk] of bodyChunks.entries()) {
    const blocks: KnownBlock[] = [];

    // First message gets header + prepend blocks
    if (index === 0) {
      if (prependBlocks) blocks.push(...prependBlocks);
      if (header) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: header },
        } satisfies SectionBlock);
      }
    }

    // Markdown body block
    blocks.push({ type: 'markdown', text: chunk } satisfies MarkdownBlock);

    // Last message gets footer + append blocks
    if (index === bodyChunks.length - 1) {
      if (footer) {
        blocks.push({
          type: 'context',
          elements: [{ type: 'mrkdwn', text: footer }],
        } satisfies ContextBlock);
      }
      if (appendBlocks) blocks.push(...appendBlocks);
    }

    // Safety: enforce 50-block limit
    const safeBlocks = blocks.slice(0, MAX_BLOCKS_PER_MESSAGE);

    messages.push({
      blocks: safeBlocks,
      text: index === 0 ? fallbackText : `(continued ${index + 1}/${bodyChunks.length})`,
    });
  }

  return messages;
}

/**
 * Build messages for a task completion notification (schedule, on-demand, triggered).
 * Header in mrkdwn section block, body in markdown block, footer in context block.
 */
export function buildTaskCompletionBlocks(opts: TaskCompletionOptions): SlackBlockMessage[] {
  const { emoji, taskType, taskName, tool, status, exitCode, mention, body } = opts;

  const mentionLine = mention ? `${mention}\n` : '';
  const header = `${mentionLine}${emoji} *${taskType}:* \`${taskName}\`\n*Tool:* ${tool} | *Status:* ${status} | *Exit:* ${exitCode ?? 'unknown'}`;
  const footer = `:gear: ${tool} \u00b7 ${status} \u00b7 exit ${exitCode ?? 'unknown'}`;

  return buildMarkdownMessage({ header, body, footer });
}

/**
 * Build messages for an orchestrator execution summary.
 * `:clipboard: *Execution Summary*` header with summary body in markdown block.
 */
export function buildSummaryBlocks(body: string): SlackBlockMessage[] {
  return buildMarkdownMessage({
    header: ':clipboard: *Execution Summary*',
    body,
  });
}
