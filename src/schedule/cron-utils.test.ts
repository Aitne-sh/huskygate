import { describe, expect, it } from 'vitest';
import { getNextCronRun, validateCronExpr } from './cron-utils.js';

describe('cron-utils', () => {
  it('validates cron expressions', () => {
    expect(validateCronExpr('0 9 * * *')).toBeNull();

    const invalid = validateCronExpr('invalid');
    expect(typeof invalid).toBe('string');
    expect(invalid).not.toBeNull();
  });

  it('calculates next run for valid expressions', () => {
    const next = getNextCronRun('0 9 * * *', 'UTC', new Date('2026-01-01T08:00:00.000Z'));
    expect(next).toBe('2026-01-01T09:00:00.000Z');
  });

  it('returns null for invalid next run calculation', () => {
    expect(getNextCronRun('bad cron', 'UTC')).toBeNull();
  });
});
