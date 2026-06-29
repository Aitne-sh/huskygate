/** Coverage2 tests for webhook-filter: uncovered lines 160-161 (parseEventFilterInput validation error),
 * 190-191 (parseContextMappingInput validation error) */
import { describe, expect, it } from 'vitest';
import { parseContextMappingInput, parseEventFilterInput } from './webhook-filter.js';

describe('webhook-filter coverage2', () => {
  describe('parseEventFilterInput — validation error (lines 160-161)', () => {
    it('returns error for object with invalid filter structure', () => {
      // Pass an object (not a string) that fails filter validation
      const result = parseEventFilterInput({ match: 'not-an-array' });
      expect(result.value).toBeNull();
      expect(result.serialized).toBeNull();
      expect(result.error).toBeDefined();
    });

    it('returns error for empty match array condition', () => {
      const result = parseEventFilterInput({ match: [{ path: '' }] });
      expect(result.error).toBeDefined();
    });
  });

  describe('parseContextMappingInput — validation error (lines 190-191)', () => {
    it('returns error for object with invalid mapping values', () => {
      // Pass an object where values are not dot-path strings
      const result = parseContextMappingInput({ key: 123 });
      expect(result.value).toBeNull();
      expect(result.serialized).toBeNull();
      expect(result.error).toBeDefined();
    });

    it('returns null for null input', () => {
      const result = parseContextMappingInput(null);
      expect(result.value).toBeNull();
      expect(result.serialized).toBeNull();
      expect(result.error).toBeUndefined();
    });
  });
});
