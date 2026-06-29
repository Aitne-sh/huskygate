/** Coverage tests for webhook-filter: parseStoredContextMappingResult, parseStoredEventFilterDefinitionResult invalid JSON. */
import { describe, expect, it } from 'vitest';
import {
  buildTriggerContext,
  evaluateEventFilter,
  getByDotPath,
  parseContextMappingInput,
  parseEventFilterInput,
  parseStoredContextMappingResult,
  parseStoredEventFilterDefinitionResult,
} from './webhook-filter.js';

describe('webhook-filter coverage', () => {
  describe('parseStoredEventFilterDefinitionResult', () => {
    it('returns null for null input', () => {
      expect(parseStoredEventFilterDefinitionResult(null)).toEqual({ value: null });
    });

    it('returns error for invalid JSON', () => {
      const result = parseStoredEventFilterDefinitionResult('not json');
      expect(result.error).toContain('valid JSON');
    });

    it('returns error for invalid filter structure', () => {
      const result = parseStoredEventFilterDefinitionResult('{"match":"not array"}');
      expect(result.error).toContain('invalid');
    });

    it('parses valid stored filter', () => {
      const filter = JSON.stringify({ match: [{ path: 'body.action', eq: 'push' }] });
      const result = parseStoredEventFilterDefinitionResult(filter);
      expect(result.value).not.toBeNull();
      expect(result.error).toBeUndefined();
    });
  });

  describe('parseStoredContextMappingResult', () => {
    it('returns null for null input', () => {
      expect(parseStoredContextMappingResult(null)).toEqual({ value: null });
    });

    it('returns error for invalid JSON', () => {
      const result = parseStoredContextMappingResult('not json');
      expect(result.error).toContain('valid JSON');
    });

    it('returns error for invalid mapping', () => {
      const result = parseStoredContextMappingResult('"not an object"');
      expect(result.error).toContain('invalid');
    });

    it('parses valid stored mapping', () => {
      const mapping = JSON.stringify({ repo: 'body.repository.name' });
      const result = parseStoredContextMappingResult(mapping);
      expect(result.value).not.toBeNull();
      expect(result.error).toBeUndefined();
    });
  });

  describe('parseEventFilterInput', () => {
    it('handles string JSON input', () => {
      const result = parseEventFilterInput('{"match":[{"path":"body.x","eq":"y"}]}');
      expect(result.value).not.toBeNull();
      expect(result.serialized).not.toBeNull();
    });

    it('returns error for invalid JSON string', () => {
      const result = parseEventFilterInput('not json');
      expect(result.error).toContain('valid JSON');
    });
  });

  describe('parseContextMappingInput', () => {
    it('handles string JSON input', () => {
      const result = parseContextMappingInput('{"key":"body.value"}');
      expect(result.value).not.toBeNull();
      expect(result.serialized).not.toBeNull();
    });

    it('returns error for invalid JSON string', () => {
      const result = parseContextMappingInput('not json');
      expect(result.error).toContain('valid JSON');
    });
  });

  describe('evaluateEventFilter prefix operator', () => {
    it('matches prefix', () => {
      const filter = { match: [{ path: 'body.ref', prefix: 'refs/heads/' }] };
      const root = { body: { ref: 'refs/heads/main' } };
      expect(evaluateEventFilter(filter, root)).toBe(true);
    });

    it('rejects non-matching prefix', () => {
      const filter = { match: [{ path: 'body.ref', prefix: 'refs/tags/' }] };
      const root = { body: { ref: 'refs/heads/main' } };
      expect(evaluateEventFilter(filter, root)).toBe(false);
    });
  });

  describe('getByDotPath edge cases', () => {
    it('returns undefined for empty segment', () => {
      expect(getByDotPath({ a: 1 }, 'a..b')).toBeUndefined();
    });

    it('returns undefined for __proto__ segment', () => {
      expect(getByDotPath({}, '__proto__.toString')).toBeUndefined();
    });
  });

  describe('buildTriggerContext', () => {
    it('returns null when mapping is null', () => {
      expect(buildTriggerContext(null, {})).toBeNull();
    });

    it('includes _trigger from root', () => {
      const root = {
        _trigger: { publisher: 'github', event: 'push' },
        body: { action: 'opened' },
      };
      const result = buildTriggerContext({ action: 'body.action' }, root);
      expect(result).not.toBeNull();
      expect(result?.action).toBe('opened');
      expect(result?._trigger).toEqual({ publisher: 'github', event: 'push' });
    });

    it('sets _trigger to null when not present', () => {
      const result = buildTriggerContext({ key: 'body.val' }, { body: { val: 1 } });
      expect(result?._trigger).toBeNull();
    });
  });
});
