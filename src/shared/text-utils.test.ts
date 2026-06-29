import { describe, expect, it, vi } from 'vitest';
import {
  MAX_BYTES,
  MAX_CHARS,
  findSplitPoint,
  formatMention,
  formatToolInputSummary,
  shouldSplit,
  splitTextToChunks,
} from './text-utils.js';

// ---------------------------------------------------------------------------
// formatMention
// ---------------------------------------------------------------------------

describe('formatMention', () => {
  it('returns empty for falsy values', () => {
    expect(formatMention(undefined)).toBe('');
    expect(formatMention(null)).toBe('');
    expect(formatMention('')).toBe('');
  });

  it('returns empty for non-Slack user IDs', () => {
    expect(formatMention('dashboard')).toBe('');
    expect(formatMention('123ABC')).toBe('');
  });

  it('formats valid U-prefixed user IDs', () => {
    expect(formatMention('U123')).toBe('<@U123>');
    expect(formatMention('U01ABC23DEF')).toBe('<@U01ABC23DEF>');
  });

  it('formats valid W-prefixed user IDs', () => {
    expect(formatMention('W999')).toBe('<@W999>');
  });
});

// ---------------------------------------------------------------------------
// formatToolInputSummary
// ---------------------------------------------------------------------------

describe('formatToolInputSummary', () => {
  it('returns empty for undefined/null', () => {
    expect(formatToolInputSummary(undefined)).toBe('');
    expect(formatToolInputSummary(null)).toBe('');
  });

  it('returns empty for empty object', () => {
    expect(formatToolInputSummary({})).toBe('');
  });

  it('returns empty for "null" string', () => {
    expect(formatToolInputSummary('null')).toBe('');
  });

  it('formats a string input directly', () => {
    expect(formatToolInputSummary('npm test')).toBe('npm test');
  });

  it('JSON-stringifies an object input', () => {
    expect(formatToolInputSummary({ file_path: 'report.md' })).toBe('{"file_path":"report.md"}');
  });

  it('truncates long inputs with ellipsis', () => {
    const longInput = 'a'.repeat(400);
    const result = formatToolInputSummary(longInput);
    expect(result.length).toBe(301); // 300 + ellipsis char
    expect(result.endsWith('\u2026')).toBe(true);
  });

  it('respects custom maxLen', () => {
    const result = formatToolInputSummary('hello world', 5);
    expect(result).toBe('hello\u2026');
  });
});

// ---------------------------------------------------------------------------
// shouldSplit
// ---------------------------------------------------------------------------

describe('shouldSplit', () => {
  it('returns false for short text', () => {
    expect(shouldSplit('hello')).toBe(false);
  });

  it('returns true when character count reaches MAX_CHARS', () => {
    expect(shouldSplit('a'.repeat(MAX_CHARS))).toBe(true);
  });

  it('returns true when byte size reaches MAX_BYTES (multibyte)', () => {
    // 4-byte emoji × (MAX_BYTES / 4) = exactly MAX_BYTES
    const text = '😀'.repeat(MAX_BYTES / 4);
    expect(shouldSplit(text)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findSplitPoint
// ---------------------------------------------------------------------------

describe('findSplitPoint', () => {
  it('prefers newline boundary in the second half', () => {
    const text = `${'a'.repeat(3000)}\n${'b'.repeat(2000)}`;
    const point = findSplitPoint(text);
    expect(text[point - 1]).toBe('\n');
  });

  it('falls back to MAX_CHARS when no good newline exists', () => {
    const text = 'a'.repeat(5000);
    const point = findSplitPoint(text);
    expect(point).toBe(MAX_CHARS);
  });

  it('uses binary search for multibyte text exceeding byte limit', () => {
    const text = '😀'.repeat(4500);
    const point = findSplitPoint(text);
    expect(Buffer.byteLength(text.slice(0, point), 'utf-8')).toBeLessThanOrEqual(MAX_BYTES);
  });

  it('retreats to the start of a recent markdown code fence', () => {
    const text = `${'a'.repeat(2400)}\n\`\`\`ts\n${'b'.repeat(2200)}`;
    const point = findSplitPoint(text);
    expect(text.slice(0, point)).toBe(`${'a'.repeat(2400)}\n`);
    expect(text.slice(point).startsWith('```ts\n')).toBe(true);
  });

  it('falls back to the hard limit for oversized markdown code fences', () => {
    const text = `\`\`\`ts\n${'b'.repeat(5000)}`;
    const point = findSplitPoint(text);
    expect(point).toBe(MAX_CHARS);
  });

  it('returns the same split point across repeated markdown-aware calls', () => {
    const text = `${'a'.repeat(2400)}\n\`\`\`ts\n${'b'.repeat(2200)}`;
    expect(findSplitPoint(text)).toBe(findSplitPoint(text));
  });
});

// ---------------------------------------------------------------------------
// splitTextToChunks
// ---------------------------------------------------------------------------

describe('splitTextToChunks', () => {
  it('returns single chunk for short text', () => {
    expect(splitTextToChunks('hello')).toEqual(['hello']);
  });

  it('returns empty array for empty string', () => {
    expect(splitTextToChunks('')).toEqual([]);
  });

  it('splits long text preserving all content', () => {
    const text = 'a'.repeat(10000);
    const chunks = splitTextToChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_CHARS);
    }
  });

  it('preserves newline boundaries when splitting', () => {
    const text = `${'a'.repeat(2500)}\n${'b'.repeat(2000)}\n${'c'.repeat(2000)}`;
    const chunks = splitTextToChunks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]?.endsWith('\n')).toBe(true);
    expect(chunks.join('')).toBe(text);
  });

  it('respects byte limit for multibyte strings', () => {
    const text = '😀'.repeat(4500);
    const chunks = splitTextToChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(Buffer.byteLength(chunks[0] ?? '', 'utf-8')).toBeLessThanOrEqual(MAX_BYTES);
    expect(chunks.join('')).toBe(text);
  });

  it('handles byte-limit binary-search branch via mocked byteLength', () => {
    const original = Buffer.byteLength;
    const spy = vi.spyOn(Buffer, 'byteLength').mockImplementation((value, encoding) => {
      if (typeof value === 'string') return value.length * 4;
      return original(value, encoding);
    });
    try {
      const text = 'a'.repeat(5000);
      const chunks = splitTextToChunks(text);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join('')).toBe(text);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps markdown code fences intact across chunks when a safe boundary exists', () => {
    const text = `${'a'.repeat(2400)}\n\`\`\`ts\n${'b'.repeat(2200)}\n\`\`\`\n${'c'.repeat(600)}`;
    const chunks = splitTextToChunks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toBe(`${'a'.repeat(2400)}\n`);
    expect((chunks[1] ?? '').startsWith('```ts\n')).toBe(true);
    expect(chunks.join('')).toBe(text);
  });
});
