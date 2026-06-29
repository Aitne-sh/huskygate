/**
 * Coverage tests for validation.ts — targets branches at lines 13-14:
 * - Empty issues array
 * - Single issue with no message (undefined → fallback)
 */
import { describe, expect, it } from 'vitest';
import type { ZodError } from 'zod';
import { formatZodError } from './validation.js';

describe('formatZodError branch coverage', () => {
  it('returns fallback for empty issues array', () => {
    const error = { issues: [] } as unknown as ZodError;
    expect(formatZodError(error)).toBe('Validation error');
  });

  it('returns fallback when single issue has undefined message', () => {
    const error = { issues: [{}] } as unknown as ZodError;
    expect(formatZodError(error)).toBe('Validation error');
  });

  it('returns message for single issue', () => {
    const error = { issues: [{ message: 'Field required' }] } as unknown as ZodError;
    expect(formatZodError(error)).toBe('Field required');
  });

  it('joins multiple issue messages', () => {
    const error = {
      issues: [{ message: 'Too short' }, { message: 'Invalid format' }],
    } as unknown as ZodError;
    expect(formatZodError(error)).toBe('Too short; Invalid format');
  });
});
