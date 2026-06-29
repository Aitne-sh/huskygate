import { describe, expect, it, vi } from 'vitest';
import { parseInlineEventSubscriptionInput } from './inline-event-subscription.js';

vi.mock('../../event/webhook-filter.js', () => ({
  parseEventFilterInput: vi.fn(),
  parseContextMappingInput: vi.fn(),
}));

import { parseContextMappingInput, parseEventFilterInput } from '../../event/webhook-filter.js';

const mockedParseEventFilter = vi.mocked(parseEventFilterInput);
const mockedParseContextMapping = vi.mocked(parseContextMappingInput);

function setupValidParsers() {
  mockedParseEventFilter.mockReturnValue({ value: null, serialized: null });
  mockedParseContextMapping.mockReturnValue({ value: null, serialized: null });
}

describe('parseInlineEventSubscriptionInput', () => {
  it('returns omit for undefined input', () => {
    const result = parseInlineEventSubscriptionInput(undefined, 'eventSubscription');
    expect(result).toEqual({ value: { kind: 'omit' } });
  });

  it('returns remove for null input', () => {
    const result = parseInlineEventSubscriptionInput(null, 'eventSubscription');
    expect(result).toEqual({ value: { kind: 'remove' } });
  });

  it('returns error for string input', () => {
    const result = parseInlineEventSubscriptionInput('bad', 'eventSubscription');
    expect(result.error).toBe('eventSubscription must be an object or null');
    expect(result.value).toEqual({ kind: 'omit' });
  });

  it('returns error for array input', () => {
    const result = parseInlineEventSubscriptionInput([1, 2], 'eventSubscription');
    expect(result.error).toBe('eventSubscription must be an object or null');
  });

  it('returns error for number input', () => {
    const result = parseInlineEventSubscriptionInput(42, 'eventSubscription');
    expect(result.error).toBe('eventSubscription must be an object or null');
  });

  it('returns error for missing endpointId', () => {
    setupValidParsers();
    const result = parseInlineEventSubscriptionInput({}, 'sub');
    expect(result.error).toBe(
      'sub.endpointId is required when sub is provided; use null to remove the subscription',
    );
    expect(result.value).toEqual({ kind: 'omit' });
  });

  it('returns error for empty endpointId', () => {
    setupValidParsers();
    const result = parseInlineEventSubscriptionInput({ endpointId: '  ' }, 'sub');
    expect(result.error).toBe(
      'sub.endpointId is required when sub is provided; use null to remove the subscription',
    );
  });

  it('returns error for non-boolean enabled', () => {
    const result = parseInlineEventSubscriptionInput({ endpointId: 'ep-1', enabled: 'yes' }, 'sub');
    expect(result.error).toBe('sub.enabled must be a boolean');
    expect(result.value).toEqual({ kind: 'omit' });
  });

  it('returns upsert for valid input with endpointId only', () => {
    setupValidParsers();
    const result = parseInlineEventSubscriptionInput({ endpointId: 'ep-1' }, 'sub');
    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({
      kind: 'upsert',
      endpointId: 'ep-1',
      filterJson: null,
      contextMappingJson: null,
      enabled: true,
    });
  });

  it('returns upsert for valid input with filterJson', () => {
    const serializedFilter = '{"match":[{"path":"body.action","value":"opened"}]}';
    mockedParseEventFilter.mockReturnValue({
      value: { match: [{ path: 'body.action', value: 'opened' }] } as never,
      serialized: serializedFilter,
    });
    mockedParseContextMapping.mockReturnValue({ value: null, serialized: null });

    const result = parseInlineEventSubscriptionInput(
      { endpointId: 'ep-2', filterJson: { match: [{ path: 'body.action', value: 'opened' }] } },
      'sub',
    );

    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({
      kind: 'upsert',
      endpointId: 'ep-2',
      filterJson: serializedFilter,
      contextMappingJson: null,
      enabled: true,
    });
    expect(mockedParseEventFilter).toHaveBeenCalledWith({
      match: [{ path: 'body.action', value: 'opened' }],
    });
  });

  it('returns error for invalid filterJson', () => {
    mockedParseEventFilter.mockReturnValue({
      value: null,
      serialized: null,
      error: 'filterJson.match must be an array',
    });
    mockedParseContextMapping.mockReturnValue({ value: null, serialized: null });

    const result = parseInlineEventSubscriptionInput(
      { endpointId: 'ep-3', filterJson: 'bad' },
      'sub',
    );

    expect(result.error).toBe('filterJson.match must be an array');
    expect(result.value).toEqual({ kind: 'omit' });
  });

  it('returns upsert for valid input with contextMappingJson', () => {
    const serializedMapping = '{"entries":[{"from":"body.repo","to":"repo_name"}]}';
    mockedParseEventFilter.mockReturnValue({ value: null, serialized: null });
    mockedParseContextMapping.mockReturnValue({
      value: { entries: [{ from: 'body.repo', to: 'repo_name' }] } as never,
      serialized: serializedMapping,
    });

    const result = parseInlineEventSubscriptionInput(
      {
        endpointId: 'ep-4',
        contextMappingJson: { entries: [{ from: 'body.repo', to: 'repo_name' }] },
      },
      'sub',
    );

    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({
      kind: 'upsert',
      endpointId: 'ep-4',
      filterJson: null,
      contextMappingJson: serializedMapping,
      enabled: true,
    });
    expect(mockedParseContextMapping).toHaveBeenCalledWith({
      entries: [{ from: 'body.repo', to: 'repo_name' }],
    });
  });

  it('returns error for invalid contextMappingJson', () => {
    mockedParseEventFilter.mockReturnValue({ value: null, serialized: null });
    mockedParseContextMapping.mockReturnValue({
      value: null,
      serialized: null,
      error: 'contextMappingJson.entries must be an array',
    });

    const result = parseInlineEventSubscriptionInput(
      { endpointId: 'ep-5', contextMappingJson: 'bad' },
      'sub',
    );

    expect(result.error).toBe('contextMappingJson.entries must be an array');
    expect(result.value).toEqual({ kind: 'omit' });
  });

  it('defaults enabled to true when not specified', () => {
    setupValidParsers();
    const result = parseInlineEventSubscriptionInput({ endpointId: 'ep-6' }, 'sub');
    expect(result.value).toMatchObject({ kind: 'upsert', enabled: true });
  });

  it('sets enabled to false when explicitly false', () => {
    setupValidParsers();
    const result = parseInlineEventSubscriptionInput({ endpointId: 'ep-7', enabled: false }, 'sub');
    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({
      kind: 'upsert',
      endpointId: 'ep-7',
      filterJson: null,
      contextMappingJson: null,
      enabled: false,
    });
  });

  it('sets enabled to true when explicitly true', () => {
    setupValidParsers();
    const result = parseInlineEventSubscriptionInput({ endpointId: 'ep-8', enabled: true }, 'sub');
    expect(result.value).toMatchObject({ kind: 'upsert', enabled: true });
  });

  it('trims endpointId whitespace', () => {
    setupValidParsers();
    const result = parseInlineEventSubscriptionInput({ endpointId: '  ep-9  ' }, 'sub');
    expect(result.value).toMatchObject({ kind: 'upsert', endpointId: 'ep-9' });
  });
});
