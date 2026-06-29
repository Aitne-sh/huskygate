/** @module shared/normalize-model.test — Unit tests for normalizeModel() */
import { describe, expect, it } from 'vitest';
import { MODEL_MAX_LENGTH, normalizeModel } from './normalize-model.js';

describe('normalizeModel', () => {
  it('returns null for undefined', () => {
    expect(normalizeModel(undefined)).toBeNull();
  });

  it('returns null for null', () => {
    expect(normalizeModel(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalizeModel('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(normalizeModel('   ')).toBeNull();
  });

  it('returns null for "default" (case-insensitive)', () => {
    expect(normalizeModel('default')).toBeNull();
    expect(normalizeModel('Default')).toBeNull();
    expect(normalizeModel('DEFAULT')).toBeNull();
    expect(normalizeModel('  default  ')).toBeNull();
  });

  it('trims whitespace from valid model', () => {
    expect(normalizeModel('  claude-opus-4-6  ')).toBe('claude-opus-4-6');
  });

  it('passes through valid model names', () => {
    expect(normalizeModel('claude-opus-4-6')).toBe('claude-opus-4-6');
    expect(normalizeModel('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(normalizeModel('o3')).toBe('o3');
    expect(normalizeModel('gpt-4.1')).toBe('gpt-4.1');
    expect(normalizeModel('gemini-2.5-pro')).toBe('gemini-2.5-pro');
  });

  it('throws on non-string input', () => {
    expect(() => normalizeModel(123)).toThrow('model must be a string');
    expect(() => normalizeModel(true)).toThrow('model must be a string');
    expect(() => normalizeModel({})).toThrow('model must be a string');
  });

  it('throws on string exceeding max length', () => {
    const longModel = 'a'.repeat(MODEL_MAX_LENGTH + 1);
    expect(() => normalizeModel(longModel)).toThrow(`model must be <= ${MODEL_MAX_LENGTH} characters`);
  });

  it('accepts string at exactly max length', () => {
    const exactModel = 'a'.repeat(MODEL_MAX_LENGTH);
    expect(normalizeModel(exactModel)).toBe(exactModel);
  });
});
