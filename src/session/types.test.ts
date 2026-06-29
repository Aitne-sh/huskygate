import { describe, expect, it } from 'vitest';

describe('session/types module', () => {
  it('loads as runtime-safe type-only module', async () => {
    const mod = await import('./types.js');
    expect(typeof mod).toBe('object');
  });
});
