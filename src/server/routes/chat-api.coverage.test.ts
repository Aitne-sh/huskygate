/**
 * Coverage tests for chat-api — targets uncovered branches in exported functions.
 * Covers: findProcessBoundary, injectProcessSeparator, matchesChatApiPath,
 * PROCESS_END_SEPARATOR, CODEX_ANSWER_MARKER.
 */
import { describe, expect, it } from 'vitest';
import {
  CODEX_ANSWER_MARKER,
  PROCESS_END_SEPARATOR,
  findProcessBoundary,
  injectProcessSeparator,
  matchesChatApiPath,
} from './chat-api.js';

describe('chat-api coverage', () => {
  describe('matchesChatApiPath', () => {
    it('matches /api/chat/sessions', () => {
      expect(matchesChatApiPath('/api/chat/sessions')).toBe(true);
    });

    it('does not match unrelated paths', () => {
      expect(matchesChatApiPath('/api/other')).toBe(false);
    });
  });

  describe('findProcessBoundary', () => {
    it('returns -1 for text without boundary patterns', () => {
      expect(findProcessBoundary('short text')).toBe(-1);
    });

    it('returns -1 for short text even with pattern', () => {
      // Pattern match before MIN_PROCESS_PREAMBLE (80 chars) is ignored
      expect(findProcessBoundary('\n# Heading')).toBe(-1);
    });

    it('detects heading boundary after sufficient preamble', () => {
      const preamble = 'x'.repeat(90);
      const text = `${preamble}\n## Answer`;
      const result = findProcessBoundary(text);
      expect(result).toBeGreaterThanOrEqual(80);
    });

    it('detects "What you asked" pattern', () => {
      const preamble = 'x'.repeat(90);
      const text = `${preamble}\n**What you asked**`;
      const result = findProcessBoundary(text);
      expect(result).toBeGreaterThanOrEqual(80);
    });

    it('detects Conclusion pattern', () => {
      const preamble = 'x'.repeat(90);
      const text = `${preamble}\n**Conclusion:** stuff`;
      const result = findProcessBoundary(text);
      expect(result).toBeGreaterThanOrEqual(80);
    });

    it('detects Summary pattern', () => {
      const preamble = 'x'.repeat(90);
      const text = `${preamble}\nSummary: stuff`;
      const result = findProcessBoundary(text);
      expect(result).toBeGreaterThanOrEqual(80);
    });

    it('detects Answer pattern', () => {
      const preamble = 'x'.repeat(90);
      const text = `${preamble}\nAnswer: stuff`;
      const result = findProcessBoundary(text);
      expect(result).toBeGreaterThanOrEqual(80);
    });

    it('detects Insight star pattern', () => {
      const preamble = 'x'.repeat(90);
      const text = `${preamble}\n★ Insight: stuff`;
      const result = findProcessBoundary(text);
      expect(result).toBeGreaterThanOrEqual(80);
    });

    it('returns earliest match when multiple patterns exist', () => {
      const preamble = 'x'.repeat(90);
      const text = `${preamble}\n## Heading\n\nConclusion: stuff`;
      const result = findProcessBoundary(text);
      expect(result).toBe(90);
    });
  });

  describe('injectProcessSeparator', () => {
    it('returns text unchanged for non-codex/claude/gemini driver', () => {
      const text = 'some text with <!-- answer --> marker';
      expect(injectProcessSeparator(text, 'other', false, -1)).toBe(text);
    });

    it('handles codex answer marker with both parts', () => {
      const text = `Process narration here\n${CODEX_ANSWER_MARKER}\nFinal answer`;
      const result = injectProcessSeparator(text, 'codex', false, -1);
      expect(result).toContain(PROCESS_END_SEPARATOR);
      expect(result).toContain('Process narration here');
      expect(result).toContain('Final answer');
    });

    it('handles answer marker with empty process part', () => {
      const text = `${CODEX_ANSWER_MARKER}\nOnly answer part`;
      const result = injectProcessSeparator(text, 'codex', false, -1);
      // When process part is empty, returns cleaned text without separator
      expect(result).not.toContain(PROCESS_END_SEPARATOR);
      expect(result).toContain('Only answer part');
    });

    it('handles answer marker with empty answer part', () => {
      const text = `Some process${CODEX_ANSWER_MARKER}`;
      const result = injectProcessSeparator(text, 'codex', false, -1);
      // When answer part is empty, returns cleaned text without separator
      expect(result).not.toContain(PROCESS_END_SEPARATOR);
    });

    it('cleans up multiple answer markers', () => {
      const text = `Process ${CODEX_ANSWER_MARKER} middle ${CODEX_ANSWER_MARKER}\nFinal`;
      const result = injectProcessSeparator(text, 'codex', false, -1);
      expect(result).not.toContain(CODEX_ANSWER_MARKER);
    });

    it('uses tool event offset when available', () => {
      const preamble = 'x'.repeat(100);
      const text = `${preamble}answer part here`;
      const result = injectProcessSeparator(text, 'claude', true, 100);
      expect(result).toContain(PROCESS_END_SEPARATOR);
    });

    it('uses heuristic boundary when no tool events and no marker', () => {
      const preamble = 'x'.repeat(90);
      const text = `${preamble}\n## Answer\nSome answer`;
      const result = injectProcessSeparator(text, 'claude', false, -1);
      expect(result).toContain(PROCESS_END_SEPARATOR);
    });

    it('returns text unchanged when no boundary found', () => {
      const text = 'short text without boundary';
      expect(injectProcessSeparator(text, 'claude', false, -1)).toBe(text);
    });

    it('returns text unchanged when split produces empty process part', () => {
      // splitOffset at 0 means process part is empty
      const text = '\n## Answer\nSome content';
      const result = injectProcessSeparator(text, 'codex', true, 0);
      // process part is empty after trim, so returns original
      expect(result).toBe(text);
    });

    it('handles gemini driver the same as codex', () => {
      const preamble = 'x'.repeat(90);
      const text = `${preamble}\n## Answer\nSome answer`;
      const result = injectProcessSeparator(text, 'gemini', false, -1);
      expect(result).toContain(PROCESS_END_SEPARATOR);
    });

    it('collapses excess newlines around answer marker', () => {
      const text = `Process text\n\n\n\n${CODEX_ANSWER_MARKER}\n\n\nFinal answer`;
      const result = injectProcessSeparator(text, 'codex', false, -1);
      expect(result).not.toContain('\n\n\n');
    });
  });
});
