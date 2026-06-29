import { describe, expect, it } from 'vitest';

describe('slack/app-types module', () => {
  it('loads as runtime-safe type-only module', async () => {
    const mod = await import('./app-types.js');
    expect(typeof mod).toBe('object');
  });
});
