import { describe, expect, it } from 'vitest';
import { SIZE_LIMITS } from '../shared/constants.js';
import {
  buildMarkdownMessage,
  buildSummaryBlocks,
  buildTaskCompletionBlocks,
  estimateMarkdownBlockChars,
  exceedsFileUploadThreshold,
  generateFallbackText,
  splitMarkdownForBlocks,
} from './markdown-blocks.js';

const BODY_MAX = SIZE_LIMITS.markdownBodyMaxChars; // 11_500
const FILE_THRESHOLD = SIZE_LIMITS.markdownFileUploadThreshold; // 40_000

// ---------------------------------------------------------------------------
// splitMarkdownForBlocks
// ---------------------------------------------------------------------------

describe('splitMarkdownForBlocks', () => {
  it('returns single chunk for short text', () => {
    const chunks = splitMarkdownForBlocks('Hello world');
    expect(chunks).toEqual(['Hello world']);
  });

  it('returns [""] for empty string', () => {
    expect(splitMarkdownForBlocks('')).toEqual(['']);
  });

  it('returns single chunk at exactly the limit', () => {
    const text = 'a'.repeat(BODY_MAX);
    const chunks = splitMarkdownForBlocks(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it('splits text exceeding the limit', () => {
    const text = 'a'.repeat(BODY_MAX + 100);
    const chunks = splitMarkdownForBlocks(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(BODY_MAX);
    }
  });

  it('preserves all content across splits', () => {
    const text = 'x'.repeat(BODY_MAX * 3);
    const chunks = splitMarkdownForBlocks(text);
    expect(chunks.join('')).toBe(text);
  });

  it('prefers splitting at newline boundaries', () => {
    const half = Math.floor(BODY_MAX * 0.7);
    const text = `${'a'.repeat(half)}\n${'b'.repeat(BODY_MAX)}`;
    const chunks = splitMarkdownForBlocks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]?.endsWith('\n') || chunks[0] === `${'a'.repeat(half)}\n`).toBe(true);
  });

  it('does not split inside a code fence', () => {
    // beforeFence (~8050) + fencedCode (~5760) > BODY_MAX, so a split is required.
    // The split point should retreat to before the fence.
    const beforeFence = 'x'.repeat(Math.floor(BODY_MAX * 0.7));
    const fencedCode = `\`\`\`ts\n${'y'.repeat(Math.floor(BODY_MAX * 0.5))}\n\`\`\``;
    const text = `${beforeFence}\n${fencedCode}\nafter`;
    const chunks = splitMarkdownForBlocks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // First chunk should end before the fence
    expect(chunks[0]?.includes('```ts')).toBe(false);
    expect(chunks.join('')).toBe(text);
  });

  it('falls back when code fence starts too early', () => {
    // Fence starts at the very beginning — can't retreat that far
    const text = `\`\`\`ts\n${'y'.repeat(BODY_MAX + 500)}\n\`\`\``;
    const chunks = splitMarkdownForBlocks(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(text);
  });

  it('does not split inside a Markdown table', () => {
    // Before the table: enough text so the natural split falls inside the table
    const before = `${'x'.repeat(BODY_MAX - 500)}\n`;
    const table = [
      '| Col A | Col B |',
      '|-------|-------|',
      ...Array.from({ length: 20 }, (_, i) => `| val ${i * 2 + 1} | val ${i * 2 + 2} |`),
    ].join('\n');
    const after = `\n${'z'.repeat(1000)}`;
    const text = before + table + after;
    // Total exceeds BODY_MAX, and the natural split falls inside the table
    expect(text.length).toBeGreaterThan(BODY_MAX);
    const chunks = splitMarkdownForBlocks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // The table should be entirely in one chunk
    const tableChunk = chunks.find((c) => c.includes('| Col A | Col B |'));
    expect(tableChunk).toBeDefined();
    expect(tableChunk?.includes(`| val ${20 * 2 - 1} | val ${20 * 2} |`)).toBe(true);
  });

  it('prefers splitting at heading boundaries', () => {
    const beforeHeading = `${'a'.repeat(Math.floor(BODY_MAX * 0.8))}\n`;
    const heading = '## Section Two\n';
    const afterHeading = 'b'.repeat(Math.floor(BODY_MAX * 0.3));
    const text = beforeHeading + heading + afterHeading;
    const chunks = splitMarkdownForBlocks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Second chunk should start with the heading
    expect(chunks[1]?.startsWith('## Section Two')).toBe(true);
  });

  it('accepts custom limit parameter', () => {
    const text = 'a'.repeat(200);
    const chunks = splitMarkdownForBlocks(text, 100);
    expect(chunks.length).toBe(2);
    expect(chunks.join('')).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// estimateMarkdownBlockChars
// ---------------------------------------------------------------------------

describe('estimateMarkdownBlockChars', () => {
  it('counts chars in markdown blocks only', () => {
    const blocks = [
      { type: 'section' as const, text: { type: 'mrkdwn' as const, text: 'header text' } },
      { type: 'markdown' as const, text: 'body text here' },
      { type: 'context' as const, elements: [{ type: 'mrkdwn' as const, text: 'footer' }] },
    ];
    expect(estimateMarkdownBlockChars(blocks)).toBe('body text here'.length);
  });

  it('sums multiple markdown blocks', () => {
    const blocks = [
      { type: 'markdown' as const, text: 'aaa' },
      { type: 'markdown' as const, text: 'bbbbb' },
    ];
    expect(estimateMarkdownBlockChars(blocks)).toBe(8);
  });

  it('returns 0 when no markdown blocks exist', () => {
    const blocks = [{ type: 'section' as const, text: { type: 'mrkdwn' as const, text: 'hello' } }];
    expect(estimateMarkdownBlockChars(blocks)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(estimateMarkdownBlockChars([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// generateFallbackText
// ---------------------------------------------------------------------------

describe('generateFallbackText', () => {
  it('includes header and body preview', () => {
    const result = generateFallbackText({ header: 'Header', body: 'Body text' });
    expect(result).toContain('Header');
    expect(result).toContain('Body text');
  });

  it('truncates body beyond 300 chars with ellipsis', () => {
    const longBody = 'x'.repeat(500);
    const result = generateFallbackText({ body: longBody });
    expect(result.length).toBeLessThan(500);
    expect(result).toContain('...');
  });

  it('works without header', () => {
    const result = generateFallbackText({ body: 'Just body' });
    expect(result).toBe('Just body');
  });

  it('includes full body when <=300 chars', () => {
    const body = 'Short body';
    const result = generateFallbackText({ body });
    expect(result).toBe(body);
  });
});

// ---------------------------------------------------------------------------
// exceedsFileUploadThreshold
// ---------------------------------------------------------------------------

describe('exceedsFileUploadThreshold', () => {
  it('returns false for small text', () => {
    expect(exceedsFileUploadThreshold('hello')).toBe(false);
  });

  it('returns false at exactly the threshold', () => {
    expect(exceedsFileUploadThreshold('a'.repeat(FILE_THRESHOLD))).toBe(false);
  });

  it('returns true above the threshold', () => {
    expect(exceedsFileUploadThreshold('a'.repeat(FILE_THRESHOLD + 1))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildMarkdownMessage
// ---------------------------------------------------------------------------

describe('buildMarkdownMessage', () => {
  it('returns single message for short body', () => {
    const messages = buildMarkdownMessage({ body: 'Hello **world**' });
    expect(messages).toHaveLength(1);
    const msg = messages[0];
    if (!msg) throw new Error('expected message');
    expect(msg.blocks).toHaveLength(1); // just markdown block
    expect(msg.blocks[0]?.type).toBe('markdown');
    expect((msg.blocks[0] as { text: string }).text).toBe('Hello **world**');
  });

  it('includes header as section block', () => {
    const messages = buildMarkdownMessage({
      header: ':white_check_mark: *Task completed*',
      body: 'Done',
    });
    expect(messages).toHaveLength(1);
    const msg = messages[0];
    if (!msg) throw new Error('expected message');
    expect(msg.blocks[0]?.type).toBe('section');
    expect(msg.blocks[1]?.type).toBe('markdown');
  });

  it('includes footer as context block', () => {
    const messages = buildMarkdownMessage({
      body: 'Body',
      footer: ':gear: claude',
    });
    expect(messages).toHaveLength(1);
    const lastBlock = messages[0]?.blocks.at(-1);
    expect(lastBlock?.type).toBe('context');
  });

  it('places header and footer in first/last messages respectively', () => {
    const body = 'x'.repeat(BODY_MAX + 500);
    const messages = buildMarkdownMessage({
      header: 'Header',
      body,
      footer: 'Footer',
    });
    expect(messages.length).toBeGreaterThan(1);
    // First message has header
    expect(messages[0]?.blocks[0]?.type).toBe('section');
    // Last message has footer
    const lastMsg = messages.at(-1);
    if (!lastMsg) throw new Error('expected last message');
    expect(lastMsg.blocks.at(-1)?.type).toBe('context');
  });

  it('prepends and appends extra blocks', () => {
    const prepend = [{ type: 'divider' as const }];
    const append = [{ type: 'divider' as const }];
    const messages = buildMarkdownMessage({
      body: 'Body',
      prependBlocks: prepend,
      appendBlocks: append,
    });
    expect(messages).toHaveLength(1);
    const msg = messages[0];
    if (!msg) throw new Error('expected message');
    expect(msg.blocks[0]?.type).toBe('divider');
    expect(msg.blocks.at(-1)?.type).toBe('divider');
  });

  it('uses "Completed." for empty body', () => {
    const messages = buildMarkdownMessage({ body: '' });
    expect(messages).toHaveLength(1);
    expect((messages[0]?.blocks[0] as { text: string }).text).toBe('Completed.');
  });

  it('uses "Completed." for whitespace-only body', () => {
    const messages = buildMarkdownMessage({ body: '   \n  \n  ' });
    expect(messages).toHaveLength(1);
    expect((messages[0]?.blocks[0] as { text: string }).text).toBe('Completed.');
  });

  it('always includes text fallback', () => {
    const messages = buildMarkdownMessage({ body: 'Test body' });
    expect(messages[0]?.text).toBeTruthy();
    expect(typeof messages[0]?.text).toBe('string');
  });

  it('continuation messages have numbered fallback text', () => {
    const body = 'x'.repeat(BODY_MAX + 500);
    const messages = buildMarkdownMessage({ body });
    expect(messages.length).toBeGreaterThan(1);
    expect(messages[1]?.text).toMatch(/continued 2\/\d+/);
  });

  it('splits body exceeding BODY_MAX into multiple messages', () => {
    const body = 'x'.repeat(BODY_MAX * 2 + 100);
    const messages = buildMarkdownMessage({ body });
    expect(messages.length).toBeGreaterThanOrEqual(3);
    // Each message has a markdown block
    for (const msg of messages) {
      const mdBlock = msg.blocks.find((b) => b.type === 'markdown');
      expect(mdBlock).toBeDefined();
    }
  });

  it('truncates body > 40K with file upload note', () => {
    const body = 'x'.repeat(FILE_THRESHOLD + 1000);
    const messages = buildMarkdownMessage({ body });
    // Should contain truncation note
    const allText = messages
      .flatMap((m) =>
        m.blocks.filter((b) => b.type === 'markdown').map((b) => (b as { text: string }).text),
      )
      .join('');
    expect(allText).toContain('output truncated');
  });

  it('file upload truncation does not cut inside a code fence', () => {
    // Build body > 40K where a code fence straddles the truncation boundary (~11,439 chars)
    const truncationSuffix = '\n\n---\n*... output truncated. Full content attached as file.*';
    const rawLimit = BODY_MAX - truncationSuffix.length; // ~11,439
    // Place a code fence starting just before rawLimit so naive slicing would cut inside it
    const beforeFence = 'x'.repeat(rawLimit - 50);
    const fencedCode = `\`\`\`python\n${'y'.repeat(5000)}\n\`\`\``;
    const afterFence = 'z'.repeat(FILE_THRESHOLD); // ensure > 40K total
    const body = `${beforeFence}\n${fencedCode}\n${afterFence}`;
    expect(body.length).toBeGreaterThan(FILE_THRESHOLD);

    const messages = buildMarkdownMessage({ body });
    // The markdown block in the first message should NOT have an unclosed code fence
    const mdText = messages[0]?.blocks
      .filter((b) => b.type === 'markdown')
      .map((b) => (b as { text: string }).text)
      .join('');
    // Count fence markers (excluding the suffix) — should be even (0 or matched pairs)
    if (!mdText) throw new Error('expected mdText');
    const withoutSuffix = mdText.replace(truncationSuffix, '');
    const fenceCount = (withoutSuffix.match(/```/g) ?? []).length;
    expect(fenceCount % 2).toBe(0);
  });

  it('file upload truncation does not cut mid-row inside a table', () => {
    const truncationSuffix = '\n\n---\n*... output truncated. Full content attached as file.*';
    const rawLimit = BODY_MAX - truncationSuffix.length;
    // Place a table straddling the truncation boundary.
    // The table may be partially included (truncated at row boundary is OK for a preview),
    // but it must NEVER be cut in the middle of a row.
    const beforeTable = `${'x'.repeat(rawLimit - 100)}\n`;
    const table = [
      '| Col A | Col B |',
      '|-------|-------|',
      ...Array.from({ length: 10 }, (_, i) => `| val${i} | val${i} |`),
    ].join('\n');
    const afterTable = `\n${'z'.repeat(FILE_THRESHOLD)}`;
    const body = beforeTable + table + afterTable;
    expect(body.length).toBeGreaterThan(FILE_THRESHOLD);

    const messages = buildMarkdownMessage({ body });
    const mdText = messages[0]?.blocks
      .filter((b) => b.type === 'markdown')
      .map((b) => (b as { text: string }).text)
      .join('');

    // If the table appears in the preview, every included row must be complete
    // (header + separator present, no partial row lines)
    if (!mdText) throw new Error('expected mdText');
    if (mdText.includes('| Col A | Col B |')) {
      expect(mdText).toContain('|-------|-------|');
      // Every line matching table row pattern should end with |
      const tableLines = mdText.split('\n').filter((l) => l.includes('|'));
      for (const line of tableLines) {
        expect(line.trim()).toMatch(/^\|.*\|$/);
      }
    }
  });

  it('enforces max 50 blocks per message', () => {
    const manyBlocks = Array.from({ length: 60 }, () => ({
      type: 'divider' as const,
    }));
    const messages = buildMarkdownMessage({
      body: 'Test',
      prependBlocks: manyBlocks,
    });
    expect(messages[0]?.blocks.length).toBeLessThanOrEqual(50);
  });
});

// ---------------------------------------------------------------------------
// buildTaskCompletionBlocks
// ---------------------------------------------------------------------------

describe('buildTaskCompletionBlocks', () => {
  const baseOpts = {
    emoji: ':white_check_mark:',
    taskType: 'Schedule Task',
    taskName: 'daily-report',
    tool: 'claude',
    status: 'completed',
    exitCode: 0 as number | string | null,
    body: '## Report\nAll systems operational.',
  };

  it('returns messages with header section + markdown body + footer context', () => {
    const messages = buildTaskCompletionBlocks(baseOpts);
    expect(messages).toHaveLength(1);
    const blocks = messages[0]?.blocks;
    if (!blocks) throw new Error('expected blocks');
    expect(blocks[0]?.type).toBe('section'); // header
    expect(blocks[1]?.type).toBe('markdown'); // body
    expect(blocks[2]?.type).toBe('context'); // footer
  });

  it('includes task metadata in header', () => {
    const messages = buildTaskCompletionBlocks(baseOpts);
    const headerText = (messages[0]?.blocks[0] as { text: { text: string } }).text.text;
    expect(headerText).toContain('Schedule Task');
    expect(headerText).toContain('daily-report');
    expect(headerText).toContain('claude');
    expect(headerText).toContain('completed');
  });

  it('prepends mention when provided', () => {
    const messages = buildTaskCompletionBlocks({
      ...baseOpts,
      mention: '<@U012ABC>',
    });
    const headerText = (messages[0]?.blocks[0] as { text: { text: string } }).text.text;
    expect(headerText).toMatch(/^<@U012ABC>/);
  });

  it('omits mention line when not provided', () => {
    const messages = buildTaskCompletionBlocks(baseOpts);
    const headerText = (messages[0]?.blocks[0] as { text: { text: string } }).text.text;
    expect(headerText).toMatch(/^:white_check_mark:/);
  });

  it('handles null exit code', () => {
    const messages = buildTaskCompletionBlocks({
      ...baseOpts,
      exitCode: null,
    });
    const headerText = (messages[0]?.blocks[0] as { text: { text: string } }).text.text;
    expect(headerText).toContain('unknown');
  });

  it('renders markdown body content', () => {
    const messages = buildTaskCompletionBlocks(baseOpts);
    const mdBlock = messages[0]?.blocks.find((b) => b.type === 'markdown');
    expect(mdBlock).toBeDefined();
    expect((mdBlock as { text: string }).text).toContain('## Report');
  });

  it('includes footer with tool info', () => {
    const messages = buildTaskCompletionBlocks(baseOpts);
    const ctxBlock = messages[0]?.blocks.find((b) => b.type === 'context');
    expect(ctxBlock).toBeDefined();
    const footerText = (ctxBlock as { elements: { text: string }[] }).elements[0]?.text;
    expect(footerText).toContain('claude');
    expect(footerText).toContain('exit 0');
  });
});

// ---------------------------------------------------------------------------
// buildSummaryBlocks
// ---------------------------------------------------------------------------

describe('buildSummaryBlocks', () => {
  it('returns messages with summary header and body', () => {
    const messages = buildSummaryBlocks('## Overview\nAll nodes completed.');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.blocks[0]?.type).toBe('section');
    const headerText = (messages[0]?.blocks[0] as { text: { text: string } }).text.text;
    expect(headerText).toContain('Execution Summary');
  });

  it('renders body in markdown block', () => {
    const messages = buildSummaryBlocks('Summary body content');
    const mdBlock = messages[0]?.blocks.find((b) => b.type === 'markdown');
    expect(mdBlock).toBeDefined();
    expect((mdBlock as { text: string }).text).toBe('Summary body content');
  });

  it('handles very long summaries via splitting', () => {
    const longBody = 'x'.repeat(BODY_MAX * 2);
    const messages = buildSummaryBlocks(longBody);
    expect(messages.length).toBeGreaterThan(1);
  });

  it('always includes text fallback', () => {
    const messages = buildSummaryBlocks('test');
    expect(messages[0]?.text).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Integration: block count and char estimation
// ---------------------------------------------------------------------------

describe('integration', () => {
  it('markdown block chars stay within limit for single-message output', () => {
    const body = 'a'.repeat(BODY_MAX);
    const messages = buildMarkdownMessage({ header: 'H', body, footer: 'F' });
    expect(messages).toHaveLength(1);
    const firstMsg = messages[0];
    if (!firstMsg) throw new Error('expected message');
    const mdChars = estimateMarkdownBlockChars(firstMsg.blocks);
    expect(mdChars).toBeLessThanOrEqual(SIZE_LIMITS.markdownBlockMaxChars);
  });

  it('each message individually respects markdown char limit', () => {
    const body = 'a'.repeat(BODY_MAX * 3);
    const messages = buildMarkdownMessage({ body });
    for (const msg of messages) {
      const mdChars = estimateMarkdownBlockChars(msg.blocks);
      expect(mdChars).toBeLessThanOrEqual(SIZE_LIMITS.markdownBlockMaxChars);
    }
  });

  it('block count never exceeds 50 per message', () => {
    const body = 'a'.repeat(BODY_MAX * 2);
    const messages = buildMarkdownMessage({
      header: 'Header',
      body,
      footer: 'Footer',
    });
    for (const msg of messages) {
      expect(msg.blocks.length).toBeLessThanOrEqual(50);
    }
  });

  it('round-trip: all body content preserved across splits', () => {
    const original = Array.from(
      { length: 50 },
      (_, i) => `## Section ${i}\n${'content '.repeat(100)}`,
    ).join('\n\n');
    const chunks = splitMarkdownForBlocks(original);
    expect(chunks.join('')).toBe(original);
  });
});
