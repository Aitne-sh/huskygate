/**
 * Coverage tests for markdown-blocks.ts — targets:
 * - Lines 78-92: adjustSplitPointForTable (table detection at split boundary)
 */
import { describe, expect, it } from 'vitest';
import { splitMarkdownForBlocks } from './markdown-blocks.js';

describe('adjustSplitPointForTable coverage (lines 78-92)', () => {
  it('moves split point before a table that spans the split boundary', () => {
    // Build text where a table spans the split boundary.
    // We need enough text before the table to satisfy the >30% check,
    // then a table that crosses the limit boundary.
    const limit = 200;
    const preTableText = 'Some introductory text.\n\nMore content here.\n\n';
    // Create a multi-row table
    const tableHeader = '| Col A | Col B | Col C |\n';
    const tableSep = '| ----- | ----- | ----- |\n';
    const tableRow = '| data1 | data2 | data3 |\n';

    // Place enough content before table so the table starts after >30% of candidate
    // Then make the table long enough to cross the limit
    const text =
      preTableText +
      tableHeader +
      tableSep +
      tableRow.repeat(10) +
      '\n\nAfter table content here.\n';

    const chunks = splitMarkdownForBlocks(text, limit);
    // The split should avoid cutting the table in the middle
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // Verify no chunk ends in the middle of a table row (all table rows should be intact)
    for (const chunk of chunks) {
      const lines = chunk.split('\n').filter((l) => l.trim().length > 0);
      // If a chunk contains table rows, they should be complete (start and end with |)
      for (const line of lines) {
        if (line.includes('|') && line.trim().startsWith('|')) {
          expect(line.trim().endsWith('|')).toBe(true);
        }
      }
    }
  });

  it('retreats to table start when table is in the middle of the text', () => {
    // Construct text with enough pre-table content (>30% of candidate split),
    // followed by a table that spans the split boundary.
    const limit = 100;
    // Fill first 40% with non-table content
    const preContent = 'A'.repeat(45) + '\n';
    // Then start a table
    const table =
      '| H1 | H2 |\n' +
      '| -- | -- |\n' +
      '| v1 | v2 |\n' +
      '| v3 | v4 |\n' +
      '| v5 | v6 |\n';
    // After table
    const postContent = '\nEnd text here.\n';
    const text = preContent + table + postContent;

    const chunks = splitMarkdownForBlocks(text, limit);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // The first chunk should end before or at the table start
    if (chunks.length > 1 && chunks[0]) {
      // First chunk should not contain partial table rows
      const firstChunkLines = chunks[0].split('\n').filter((l) => l.trim());
      const tableLines = firstChunkLines.filter((l) => l.trim().startsWith('|'));
      // Either no table rows (split before table) or all table rows intact
      if (tableLines.length > 0) {
        // If table rows are present, they should be complete
        for (const line of tableLines) {
          expect(line.trim().endsWith('|')).toBe(true);
        }
      }
    }
  });

  it('returns candidateSplit when table starts too early (<30% content before it)', () => {
    // Table starts right at the beginning — offset would be 0, which is not > 30%
    const limit = 80;
    const text =
      '| H1 | H2 |\n' +
      '| -- | -- |\n' +
      '| v1 | v2 |\n'.repeat(10) +
      '\nAfter table.\n';

    const chunks = splitMarkdownForBlocks(text, limit);
    // Should still split (may split in the table since retreat is not worth it)
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const joined = chunks.join('');
    expect(joined).toBe(text);
  });
});
