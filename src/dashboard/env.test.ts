import { describe, expect, it } from 'vitest';
import { MASK } from './env.js';

describe('dashboard/env', () => {
  it('exports MASK constant', () => {
    expect(MASK).toBe('***');
  });
});
