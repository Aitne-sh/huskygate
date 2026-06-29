/**
 * Coverage tests for queue/types — parseEnabledSkills and normalizeBool.
 */
import { describe, expect, it } from 'vitest';
import { buildSkillRef } from '../skills/catalog.js';
import { discoverCatalogForSkillValidation } from '../skills/skill-refs.js';
import { normalizeBool, parseEnabledSkills } from './types.js';

const catalog = discoverCatalogForSkillValidation(
  { skillTemplateDir: 'skills', workdirRoot: '/tmp/huskygate-queue-types' },
  'claude',
);

describe('parseEnabledSkills', () => {
  it('returns null for undefined input', () => {
    expect(parseEnabledSkills(undefined, catalog)).toEqual({ skills: null });
  });

  it('returns null for null input', () => {
    expect(parseEnabledSkills(null, catalog)).toEqual({ skills: null });
  });

  it('returns error for non-array input', () => {
    const result = parseEnabledSkills('not-an-array', catalog);
    expect(result.error).toBeTruthy();
    expect(result.skills).toBeNull();
  });

  it('returns error for array with invalid skill ref', () => {
    const result = parseEnabledSkills(
      [buildSkillRef('builtin', 'playwright-runner'), 'invalid-skill'],
      catalog,
    );
    expect(result.error).toContain('invalid-skill');
    expect(result.skills).toBeNull();
  });

  it('returns error for array with non-string entries', () => {
    const result = parseEnabledSkills([42], catalog);
    expect(result.error).toContain('42');
    expect(result.skills).toBeNull();
  });

  it('returns empty array for explicit opt-out', () => {
    const result = parseEnabledSkills([], catalog);
    expect(result).toEqual({ skills: [] });
  });

  it('returns valid skill array', () => {
    const result = parseEnabledSkills(
      [buildSkillRef('builtin', 'playwright-runner'), buildSkillRef('builtin', 'aws-cli')],
      catalog,
    );
    expect(result).toEqual({
      skills: [buildSkillRef('builtin', 'playwright-runner'), buildSkillRef('builtin', 'aws-cli')],
    });
  });
});

describe('normalizeBool', () => {
  it('returns default for undefined', () => {
    expect(normalizeBool(undefined)).toBe(true);
    expect(normalizeBool(undefined, false)).toBe(false);
  });

  it('returns default for null', () => {
    expect(normalizeBool(null)).toBe(true);
    expect(normalizeBool(null, false)).toBe(false);
  });

  it('returns boolean as-is', () => {
    expect(normalizeBool(true)).toBe(true);
    expect(normalizeBool(false)).toBe(false);
  });

  it('converts numbers', () => {
    expect(normalizeBool(0)).toBe(false);
    expect(normalizeBool(1)).toBe(true);
    expect(normalizeBool(-1)).toBe(true);
  });

  it('converts strings', () => {
    expect(normalizeBool('true')).toBe(true);
    expect(normalizeBool('false')).toBe(false);
    expect(normalizeBool('0')).toBe(false);
    expect(normalizeBool('no')).toBe(false);
    expect(normalizeBool('')).toBe(false);
    expect(normalizeBool('yes')).toBe(true);
    expect(normalizeBool('  FALSE  ')).toBe(false);
    expect(normalizeBool('  NO  ')).toBe(false);
  });

  it('converts objects to true', () => {
    expect(normalizeBool({})).toBe(true);
    expect(normalizeBool([])).toBe(true);
  });
});
