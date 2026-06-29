/** @module server/routes/inline-event-subscription — Shared parsing for inline webhook subscription payloads. */
import { parseContextMappingInput, parseEventFilterInput } from '../../event/webhook-filter.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export type ParsedInlineEventSubscription =
  | { kind: 'omit' }
  | { kind: 'remove' }
  | {
      kind: 'upsert';
      endpointId: string;
      filterJson: string | null;
      contextMappingJson: string | null;
      enabled: boolean;
    };

export function parseInlineEventSubscriptionInput(
  input: unknown,
  fieldName: string,
): {
  value: ParsedInlineEventSubscription;
  error?: string;
} {
  if (input === undefined) {
    return { value: { kind: 'omit' } };
  }
  if (input === null) {
    return { value: { kind: 'remove' } };
  }
  if (!isPlainObject(input)) {
    return { value: { kind: 'omit' }, error: `${fieldName} must be an object or null` };
  }

  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    return {
      value: { kind: 'omit' },
      error: `${fieldName}.enabled must be a boolean`,
    };
  }

  if (typeof input.endpointId !== 'string' || input.endpointId.trim().length === 0) {
    return {
      value: { kind: 'omit' },
      error: `${fieldName}.endpointId is required when ${fieldName} is provided; use null to remove the subscription`,
    };
  }

  const filter = parseEventFilterInput(input.filterJson);
  if (filter.error) {
    return { value: { kind: 'omit' }, error: filter.error };
  }
  const mapping = parseContextMappingInput(input.contextMappingJson);
  if (mapping.error) {
    return { value: { kind: 'omit' }, error: mapping.error };
  }

  return {
    value: {
      kind: 'upsert',
      endpointId: input.endpointId.trim(),
      filterJson: filter.serialized,
      contextMappingJson: mapping.serialized,
      enabled: input.enabled !== false,
    },
  };
}
