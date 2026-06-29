import { describe, expect, it } from 'vitest';
import { errorMessage } from './error.js';

describe('errorMessage', () => {
  it('returns message for Error instances', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies non-Error values', () => {
    expect(errorMessage('oops')).toBe('oops');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage({ ok: true })).toBe('[object Object]');
  });
});
