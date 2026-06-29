/**
 * Coverage test for cron-utils.ts — targets line 13:
 * catch block where err is not an Error instance.
 */
import { describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  parse: vi.fn(),
}));

vi.mock('cron-parser', () => ({
  CronExpressionParser: {
    parse: mocked.parse,
  },
}));

import { validateCronExpr } from './cron-utils.js';

describe('validateCronExpr branch coverage', () => {
  it('returns error message when Error is thrown', () => {
    mocked.parse.mockImplementation(() => {
      throw new Error('bad cron');
    });
    expect(validateCronExpr('invalid')).toBe('bad cron');
  });

  it('returns fallback message when non-Error is thrown', () => {
    mocked.parse.mockImplementation(() => {
      throw 'string_error';
    });
    expect(validateCronExpr('invalid')).toBe('Invalid cron expression');
  });
});
