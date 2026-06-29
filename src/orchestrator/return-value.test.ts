import { describe, expect, it, vi } from 'vitest';
import {
  MAX_RETURN_VALUE_LENGTH,
  RETURN_VALUE_SAMPLE_TEMPLATE,
  buildFallbackReturnTemplate,
  buildReturnTemplateFromConditions,
  parseReturnValue,
} from './return-value.js';

// ---------------------------------------------------------------------------
// parseReturnValue
// ---------------------------------------------------------------------------
describe('parseReturnValue', () => {
  // --- Basic matching ---

  it('returns null when output contains no return tag', () => {
    expect(parseReturnValue('')).toBeNull();
    expect(parseReturnValue('plain text with no tags')).toBeNull();
    expect(parseReturnValue('<other:tag>')).toBeNull();
  });

  it('extracts value from a single <return:value> tag', () => {
    expect(parseReturnValue('<return:success>')).toBe('success');
  });

  it('returns the LAST value when multiple tags are present', () => {
    const output = '<return:first> some text <return:second> more text <return:third>';
    expect(parseReturnValue(output)).toBe('third');
  });

  // --- Case insensitivity ---

  it('matches uppercase <RETURN:done>', () => {
    expect(parseReturnValue('<RETURN:done>')).toBe('done');
  });

  it('matches mixed case <Return:OK>', () => {
    expect(parseReturnValue('<Return:OK>')).toBe('OK');
  });

  it('matches varied casing <rEtUrN:value>', () => {
    expect(parseReturnValue('<rEtUrN:value>')).toBe('value');
  });

  // --- Whitespace handling ---

  it('trims leading and trailing whitespace from captured value', () => {
    expect(parseReturnValue('<return:  success  >')).toBe('success');
  });

  it('returns null for whitespace-only value', () => {
    expect(parseReturnValue('<return:   >')).toBeNull();
    expect(parseReturnValue('<return: \t >')).toBeNull();
  });

  // --- Empty value ---

  it('returns null for empty value <return:> (regex requires [^>]+)', () => {
    // The regex `[^>]+` requires at least one character that is not '>',
    // so `<return:>` produces no match.
    expect(parseReturnValue('<return:>')).toBeNull();
  });

  // --- Values with spaces ---

  it('preserves internal spaces in the value', () => {
    expect(parseReturnValue('<return:needs review>')).toBe('needs review');
  });

  it('preserves multiple internal spaces', () => {
    expect(parseReturnValue('<return:some  multi  word  value>')).toBe('some  multi  word  value');
  });

  // --- Value embedded in longer output ---

  it('extracts value when tag is surrounded by other text', () => {
    const output =
      'Task completed successfully.\n' +
      'Files modified: 3\n' +
      '<return:success>\n' +
      'End of output.';
    expect(parseReturnValue(output)).toBe('success');
  });

  it('extracts the last tag when embedded among many lines', () => {
    const output = [
      'Step 1: Done <return:step1_done>',
      'Step 2: Processing...',
      'Step 2: Done <return:step2_done>',
      'Final cleanup complete.',
    ].join('\n');
    expect(parseReturnValue(output)).toBe('step2_done');
  });

  // --- Truncation (MAX_RETURN_VALUE_LENGTH) ---

  it('truncates value longer than MAX_RETURN_VALUE_LENGTH', () => {
    const longValue = 'a'.repeat(MAX_RETURN_VALUE_LENGTH + 100);
    const output = `<return:${longValue}>`;
    const result = parseReturnValue(output);
    expect(result).not.toBeNull();
    expect(result?.length).toBe(MAX_RETURN_VALUE_LENGTH);
    expect(result).toBe('a'.repeat(MAX_RETURN_VALUE_LENGTH));
  });

  it('does NOT truncate value at exactly MAX_RETURN_VALUE_LENGTH', () => {
    const exactValue = 'b'.repeat(MAX_RETURN_VALUE_LENGTH);
    const output = `<return:${exactValue}>`;
    const result = parseReturnValue(output);
    expect(result).toBe(exactValue);
    expect(result?.length).toBe(MAX_RETURN_VALUE_LENGTH);
  });

  it('does NOT truncate value shorter than MAX_RETURN_VALUE_LENGTH', () => {
    const shortValue = 'c'.repeat(MAX_RETURN_VALUE_LENGTH - 1);
    const output = `<return:${shortValue}>`;
    expect(parseReturnValue(output)).toBe(shortValue);
  });

  // --- Tag inside code block ---

  it('matches tag inside a markdown code block (no special treatment)', () => {
    const output = ['```', 'output: <return:from_code_block>', '```'].join('\n');
    expect(parseReturnValue(output)).toBe('from_code_block');
  });

  it('matches tag inside an inline code span', () => {
    const output = 'The result is `<return:inline_code>`';
    expect(parseReturnValue(output)).toBe('inline_code');
  });

  // --- Nested / malformed tags ---

  it('handles nested tags <return:<return:inner>> by matching greedily up to first >', () => {
    // Regex `[^>]+` captures everything up to the first `>`.
    // Input: <return:<return:inner>>
    // The first `>` closes at `<return:<return:inner>`, capturing `<return:inner`.
    // The regex [^>]+ captures everything up to the first >.
    // For `<return:<return:inner>>`, matchAll finds:
    //   Match 1: `<return:<return:inner>` capturing `<return:inner`
    // The trailing `>` is not part of a valid tag. Only one match exists.
    const output = '<return:<return:inner>>';
    const result = parseReturnValue(output);
    expect(result).toBe('<return:inner');
  });

  it('handles unclosed tag (no >) — no match', () => {
    expect(parseReturnValue('<return:no_close')).toBeNull();
  });

  // --- Special characters in value ---

  it('captures values containing special characters', () => {
    expect(parseReturnValue('<return:error_404>')).toBe('error_404');
    expect(parseReturnValue('<return:done!>')).toBe('done!');
    expect(parseReturnValue('<return:a/b/c>')).toBe('a/b/c');
    expect(parseReturnValue('<return:key=value>')).toBe('key=value');
  });

  it('captures values with colons', () => {
    expect(parseReturnValue('<return:status:ok>')).toBe('status:ok');
  });

  // --- Multiline output ---

  it('finds tag on last line of multiline output', () => {
    const output = 'line1\nline2\nline3\n<return:final>';
    expect(parseReturnValue(output)).toBe('final');
  });

  it('returns null for output with only non-return XML-like tags', () => {
    const output = '<result:ok> <output:done> <status:complete>';
    expect(parseReturnValue(output)).toBeNull();
  });

  it('returns null when matchAll yields a captureless entry', () => {
    const spy = vi.spyOn(String.prototype, 'matchAll').mockImplementation((() => {
      return [][Symbol.iterator].call([['<return:broken>']]);
    }) as typeof String.prototype.matchAll);

    expect(parseReturnValue('<return:broken>')).toBeNull();

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// MAX_RETURN_VALUE_LENGTH
// ---------------------------------------------------------------------------
describe('MAX_RETURN_VALUE_LENGTH', () => {
  it('is exported and equals 500', () => {
    expect(MAX_RETURN_VALUE_LENGTH).toBe(500);
  });

  it('is a positive integer', () => {
    expect(Number.isInteger(MAX_RETURN_VALUE_LENGTH)).toBe(true);
    expect(MAX_RETURN_VALUE_LENGTH).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// RETURN_VALUE_SAMPLE_TEMPLATE
// ---------------------------------------------------------------------------
describe('RETURN_VALUE_SAMPLE_TEMPLATE', () => {
  it('is a non-empty string', () => {
    expect(typeof RETURN_VALUE_SAMPLE_TEMPLATE).toBe('string');
    expect(RETURN_VALUE_SAMPLE_TEMPLATE.length).toBeGreaterThan(0);
  });

  it("contains '<return:' instruction text", () => {
    expect(RETURN_VALUE_SAMPLE_TEMPLATE).toContain('<return:');
  });

  it('mentions the LAST tag convention', () => {
    expect(RETURN_VALUE_SAMPLE_TEMPLATE.toLowerCase()).toContain('last');
  });
});

describe('buildFallbackReturnTemplate', () => {
  it('returns empty string for empty array', () => {
    expect(buildFallbackReturnTemplate([])).toBe('');
  });

  it('returns empty string when only other_return is present', () => {
    expect(buildFallbackReturnTemplate(['other_return'])).toBe('');
  });

  it('builds template from return values (filters out other_return)', () => {
    const template = buildFallbackReturnTemplate(['success', 'error', 'other_return']);
    expect(template).toContain('IMPORTANT: Follow these output rules exactly.');
    expect(template).toContain('<return:success>');
    expect(template).toContain('<return:error>');
    expect(template).not.toContain('other_return');
    expect(template).toContain('Example: <return:success>');
  });

  it('filters out both other_return and error_return from template', () => {
    const template = buildFallbackReturnTemplate(['success', 'error_return', 'other_return']);
    expect(template).toContain('<return:success>');
    expect(template).not.toContain('error_return');
    expect(template).not.toContain('other_return');
  });

  it('returns empty string when only system return values are present', () => {
    expect(buildFallbackReturnTemplate(['other_return', 'error_return'])).toBe('');
  });

  it('builds template with a single return value', () => {
    const template = buildFallbackReturnTemplate(['done']);
    expect(template).toContain('<return:done>');
    expect(template).toContain('Example: <return:done>');
  });
});

describe('buildReturnTemplateFromConditions', () => {
  it('returns an empty string when no conditions are configured', () => {
    expect(buildReturnTemplateFromConditions([])).toBe('');
  });

  it('builds instructions from the configured conditions', () => {
    const template = buildReturnTemplateFromConditions([
      { condition: 'all checks passed', value: 'success' },
      { condition: 'manual review is needed', value: 'needs_review' },
    ]);

    expect(template).toContain('IMPORTANT: Follow these output rules exactly.');
    expect(template).toContain('- Use <return:success> when: all checks passed');
    expect(template).toContain('- Use <return:needs_review> when: manual review is needed');
    expect(template).toContain(
      'Example: <return:success> Completed the requested work and verified the result.',
    );
  });
});
