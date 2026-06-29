/** Coverage tests for session/types: isMode function. */
import { describe, expect, it } from 'vitest';
import { isMode } from './types.js';

describe('session/types coverage', () => {
  describe('isMode', () => {
    it('returns true for readonly', () => {
      expect(isMode('readonly')).toBe(true);
    });

    it('returns true for write', () => {
      expect(isMode('write')).toBe(true);
    });

    it('returns false for invalid mode', () => {
      expect(isMode('read')).toBe(false);
      expect(isMode('')).toBe(false);
      expect(isMode('admin')).toBe(false);
    });
  });
});
