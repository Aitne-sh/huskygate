/** Coverage2 tests for schedule/cron-utils: uncovered lines 28-29 (getNextCronRun with invalid timezone) */
import { describe, expect, it } from 'vitest';
import { getNextCronRun } from './cron-utils.js';

describe('cron-utils coverage2', () => {
  describe('getNextCronRun — invalid timezone (lines 28-29)', () => {
    it('returns null for invalid timezone', () => {
      const result = getNextCronRun('*/5 * * * *', 'Invalid/Timezone');
      expect(result).toBeNull();
    });

    it('returns null for empty timezone', () => {
      const result = getNextCronRun('*/5 * * * *', '');
      expect(result).toBeNull();
    });
  });

  describe('getNextCronRun — invalid cron expression', () => {
    it('returns null for malformed cron expression', () => {
      const result = getNextCronRun('not a cron', 'UTC');
      expect(result).toBeNull();
    });
  });

  describe('getNextCronRun — valid inputs', () => {
    it('returns ISO string for valid cron and timezone', () => {
      const result = getNextCronRun('0 12 * * *', 'UTC');
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      // Should be a valid ISO date
      expect(new Date(result!).toISOString()).toBe(result);
    });

    it('accepts fromDate parameter', () => {
      const from = new Date('2026-01-01T00:00:00Z');
      const result = getNextCronRun('0 12 * * *', 'UTC', from);
      expect(result).not.toBeNull();
      expect(new Date(result!).getTime()).toBeGreaterThan(from.getTime());
    });
  });
});
