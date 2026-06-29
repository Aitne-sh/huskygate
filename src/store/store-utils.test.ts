import { describe, expect, it } from 'vitest';
import {
  BOOL_TRANSFORM,
  JSON_TRANSFORM,
  SKILLS_TRANSFORM,
  StaleUpdateError,
  TRIM_OR_NULL_TRANSFORM,
  TRIM_TRANSFORM,
  buildDynamicUpdate,
} from './store-utils.js';

describe('store-utils', () => {
  it('StaleUpdateError', () => {
    const err = new StaleUpdateError('Test', '123');
    expect(err.message).toBe('Test 123 was modified by another request. Refresh and try again.');
    expect(err.name).toBe('StaleUpdateError');
  });

  it('TRIM_TRANSFORM', () => {
    expect(TRIM_TRANSFORM('  hello  ')).toBe('hello');
    expect(TRIM_TRANSFORM(123)).toBe(123);
  });

  it('TRIM_OR_NULL_TRANSFORM', () => {
    expect(TRIM_OR_NULL_TRANSFORM('  hello  ')).toBe('hello');
    expect(TRIM_OR_NULL_TRANSFORM('    ')).toBeNull();
    expect(TRIM_OR_NULL_TRANSFORM(123)).toBeNull();
  });

  it('JSON_TRANSFORM', () => {
    expect(JSON_TRANSFORM({ a: 1 })).toBe('{"a":1}');
    expect(JSON_TRANSFORM(null)).toBeNull();
  });

  it('SKILLS_TRANSFORM', () => {
    expect(SKILLS_TRANSFORM(['skill1'])).toBe('["skill1"]');
    expect(SKILLS_TRANSFORM(null)).toBeNull();
    expect(SKILLS_TRANSFORM('not-array')).toBeNull();
  });

  it('BOOL_TRANSFORM', () => {
    expect(BOOL_TRANSFORM(true)).toBe(1);
    expect(BOOL_TRANSFORM(false)).toBe(0);
  });

  it('buildDynamicUpdate', () => {
    const res = buildDynamicUpdate(
      { a: 1, b: undefined, c: 2 }, // c is not in fieldMap
      { fieldMap: { a: 'col_a', b: 'col_b' }, autoTimestamp: false },
    );
    expect(res?.sets).toEqual(['col_a = ?', 'col_b = ?']);
    expect(res?.params).toEqual([1, null]);

    const res2 = buildDynamicUpdate(
      { a: ' 1 ' },
      { fieldMap: { a: 'col_a' }, transforms: { a: TRIM_TRANSFORM }, autoTimestamp: true },
    );
    expect(res2?.sets).toEqual(['col_a = ?', 'updated_at = ?']);
    expect(res2?.params[0]).toBe('1');
    expect(typeof res2?.params[1]).toBe('string');
  });

  it('buildDynamicUpdate expectedUpdatedAt', () => {
    const res = buildDynamicUpdate(
      { a: 1 },
      { fieldMap: { a: 'col_a' }, expectedUpdatedAt: '2020' },
    );
    expect(res?.extraWhere).toBe('AND updated_at = ?');
    expect(res?.extraWhereParams).toEqual(['2020']);
  });

  it('buildDynamicUpdate appendSets', () => {
    const res = buildDynamicUpdate({}, { fieldMap: {}, appendSets: ['claimed_at = NULL'] });
    expect(res?.sets).toEqual(['claimed_at = NULL', 'updated_at = ?']);
  });

  it('buildDynamicUpdate rejects unsafe appendSets clauses', () => {
    expect(() => buildDynamicUpdate({}, { fieldMap: {}, appendSets: ['foo = 1'] })).toThrow(
      'Invalid appendSets clause: foo = 1',
    );
    expect(() => buildDynamicUpdate({}, { fieldMap: {}, appendSets: ['claimed_at = ?'] })).toThrow(
      'Invalid appendSets clause: claimed_at = ?',
    );
  });

  it('buildDynamicUpdate returns null if no changes', () => {
    expect(buildDynamicUpdate({}, { fieldMap: {} })).toBeNull();
    expect(buildDynamicUpdate({}, { fieldMap: {}, appendSets: [] })).toBeNull();
  });
});
