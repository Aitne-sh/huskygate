import { describe, expect, it } from 'vitest';
import {
  MAX_TRIGGER_CONTEXT_BYTES,
  appendTriggerContext,
  parseTriggerContext,
  serializeTriggerContext,
} from './trigger-context.js';

describe('trigger context helpers', () => {
  it('serializes nullish values as null and round-trips plain objects', () => {
    expect(serializeTriggerContext(null)).toBeNull();
    expect(serializeTriggerContext(undefined)).toBeNull();

    const json = serializeTriggerContext({ event: 'push', deliveryId: 1 });
    expect(json).toBe('{"event":"push","deliveryId":1}');
    expect(parseTriggerContext(json)).toEqual({ event: 'push', deliveryId: 1 });
  });

  it('rejects oversized payloads and invalid/non-object JSON', () => {
    const oversized = { value: 'x'.repeat(MAX_TRIGGER_CONTEXT_BYTES) };
    expect(() => serializeTriggerContext(oversized)).toThrow(
      `Trigger context exceeds ${MAX_TRIGGER_CONTEXT_BYTES} bytes`,
    );

    expect(parseTriggerContext(null)).toBeNull();
    expect(parseTriggerContext(undefined)).toBeNull();
    expect(parseTriggerContext('not-json')).toBeNull();
    expect(parseTriggerContext('["array"]')).toBeNull();
    expect(parseTriggerContext('"string"')).toBeNull();
  });

  it('appends formatted context blocks only when context exists', () => {
    expect(appendTriggerContext('Base prompt', 'Trigger Event Context', null)).toBe('Base prompt');
    expect(
      appendTriggerContext('Base prompt', 'Trigger Event Context', {
        publisher: 'github',
        event: 'pull_request',
      }),
    ).toBe(
      'Base prompt\n\n--- Trigger Event Context ---\nUse this only if relevant.\n{\n  "publisher": "github",\n  "event": "pull_request"\n}',
    );
  });
});
