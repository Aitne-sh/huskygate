/** Coverage2 tests for queue/types: uncovered lines 46-48 (parseEnabledSkills without catalog) */
import { describe, expect, it } from 'vitest';
import { parseEnabledSkills } from './types.js';

describe('parseEnabledSkills coverage2', () => {
  it('returns error when catalog is not provided and input is non-null (lines 46-48)', () => {
    // catalogEntries is undefined, and raw is a non-null value
    const result = parseEnabledSkills(['builtin:playwright-runner'], undefined);
    expect(result.skills).toBeNull();
    expect(result.error).toContain('requires a skill catalog');
  });

  it('returns null skills when catalog is undefined and input is null', () => {
    const result = parseEnabledSkills(null, undefined);
    expect(result.skills).toBeNull();
    expect(result.error).toBeUndefined();
  });

  it('returns null skills when catalog is undefined and input is undefined', () => {
    const result = parseEnabledSkills(undefined, undefined);
    expect(result.skills).toBeNull();
    expect(result.error).toBeUndefined();
  });
});
