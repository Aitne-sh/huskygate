import { describe, expect, it } from 'vitest';
import {
  applyContextMapping,
  buildTriggerContext,
  evaluateEventFilter,
  getByDotPath,
  parseContextMappingInput,
  parseEventFilterInput,
  parseStoredContextMappingResult,
  parseStoredEventFilterDefinitionResult,
  serializeContextMapping,
  serializeEventFilterDefinition,
  validateContextMapping,
  validateEventFilterDefinition,
} from './webhook-filter.js';

const envelope = {
  _trigger: {
    publisher: 'github',
    event: 'pull_request',
    deliveryId: 'delivery-1',
  },
  headers: {
    'x-github-event': 'pull_request',
  },
  body: {
    action: 'opened',
    ref: 'refs/heads/release/v1',
    repository: {
      full_name: 'org/repo',
    },
    pull_request: {
      head: {
        ref: 'feature/test',
      },
    },
    sender: {
      login: 'shuto',
    },
    deployment: {
      id: 1,
    },
  },
};

describe('validateEventFilterDefinition', () => {
  it('accepts null and rejects non-object or malformed match payloads', () => {
    expect(validateEventFilterDefinition(null)).toEqual({ value: null });
    expect(validateEventFilterDefinition('bad')).toEqual({
      value: null,
      error: 'filterJson must be an object',
    });
    expect(validateEventFilterDefinition({})).toEqual({
      value: null,
      error: 'filterJson.match must be an array',
    });
    expect(validateEventFilterDefinition({ match: ['bad'] })).toEqual({
      value: null,
      error: 'filterJson.match[0] must be an object',
    });
    expect(
      validateEventFilterDefinition({
        match: [{ path: 'body.action', eq: 'opened', exists: true }],
      }),
    ).toEqual({
      value: null,
      error: 'filterJson.match[0] must specify exactly one operator',
    });
  });

  it('rejects empty match arrays and invalid root paths', () => {
    expect(validateEventFilterDefinition({ match: [] })).toEqual({
      value: null,
      error: 'filterJson.match must not be empty',
    });
    expect(validateEventFilterDefinition({ match: [{ path: 'repo.name', eq: 'x' }] })).toEqual({
      value: null,
      error: 'filterJson.match[0].path must be a dot-path string',
    });
    expect(
      validateEventFilterDefinition({
        match: [{ path: 'body.__proto__.polluted', exists: true }],
      }),
    ).toEqual({
      value: null,
      error: 'filterJson.match[0].path must be a dot-path string',
    });
  });

  it('normalizes header paths to lowercase in filter clauses', () => {
    const result = validateEventFilterDefinition({
      match: [{ path: 'headers.X-GitHub-Event', eq: 'push' }],
    });
    expect(result.value).toEqual({
      match: [{ path: 'headers.x-github-event', eq: 'push' }],
    });
    // body paths remain unchanged
    const bodyResult = validateEventFilterDefinition({
      match: [{ path: 'body.Action', eq: 'opened' }],
    });
    expect(bodyResult.value).toEqual({
      match: [{ path: 'body.Action', eq: 'opened' }],
    });
  });

  it('trims surrounding whitespace before persisting filter paths', () => {
    expect(
      validateEventFilterDefinition({
        match: [{ path: '  headers.X-GitHub-Event  ', eq: 'push' }],
      }),
    ).toEqual({
      value: {
        match: [{ path: 'headers.x-github-event', eq: 'push' }],
      },
    });
  });

  it('rejects array-index syntax and empty in/prefix operators', () => {
    expect(
      validateEventFilterDefinition({
        match: [{ path: 'body.commits[0].id', exists: true }],
      }),
    ).toEqual({
      value: null,
      error: 'filterJson.match[0].path must be a dot-path string',
    });
    expect(
      validateEventFilterDefinition({
        match: [{ path: 'body.action', in: [] }],
      }),
    ).toEqual({
      value: null,
      error: 'filterJson.match[0].in must be an array of primitive values',
    });
    expect(
      validateEventFilterDefinition({
        match: [{ path: 'body.ref', prefix: '' }],
      }),
    ).toEqual({
      value: null,
      error: 'filterJson.match[0].prefix must be a string',
    });
    expect(
      validateEventFilterDefinition({
        match: [{ path: 'body.repository..full_name', exists: true }],
      }),
    ).toEqual({
      value: null,
      error: 'filterJson.match[0].path must be a dot-path string',
    });
    expect(
      validateEventFilterDefinition({
        match: [{ path: 'body.repository.', exists: true }],
      }),
    ).toEqual({
      value: null,
      error: 'filterJson.match[0].path must be a dot-path string',
    });
    expect(
      validateEventFilterDefinition({
        match: [{ path: 'body.action', eq: { bad: true } }],
      }),
    ).toEqual({
      value: null,
      error: 'filterJson.match[0].eq must be a primitive value',
    });
    expect(
      validateEventFilterDefinition({
        match: [{ path: 'body.action', exists: 'yes' }],
      }),
    ).toEqual({
      value: null,
      error: 'filterJson.match[0].exists must be a boolean',
    });
  });

  it('accepts valid in, exists, and prefix clauses', () => {
    expect(
      validateEventFilterDefinition({
        match: [
          { path: 'body.action', in: ['opened', 'closed', 1, true] },
          { path: 'body.deployment', exists: false },
          { path: 'body.ref', prefix: 'refs/heads/' },
        ],
      }),
    ).toEqual({
      value: {
        match: [
          { path: 'body.action', in: ['opened', 'closed', 1, true] },
          { path: 'body.deployment', exists: false },
          { path: 'body.ref', prefix: 'refs/heads/' },
        ],
      },
    });
  });
});

describe('validateContextMapping', () => {
  it('accepts null and rejects non-object mappings', () => {
    expect(validateContextMapping(null)).toEqual({ value: null });
    expect(validateContextMapping('bad')).toEqual({
      value: null,
      error: 'contextMappingJson must be an object',
    });
  });

  it('restricts mappings to supported webhook document roots', () => {
    expect(
      validateContextMapping({
        repo: 'body.repository.full_name',
        sender: 'body.sender.login',
      }),
    ).toEqual({
      value: {
        repo: 'body.repository.full_name',
        sender: 'body.sender.login',
      },
    });
    expect(validateContextMapping({ repo: 'repository.full_name' })).toEqual({
      value: null,
      error: 'contextMappingJson.repo must be a dot-path string',
    });
    expect(validateContextMapping({ repo: 'body.repository.' })).toEqual({
      value: null,
      error: 'contextMappingJson.repo must be a dot-path string',
    });
  });

  it('normalizes header paths to lowercase', () => {
    expect(
      validateContextMapping({
        event: 'headers.X-GitHub-Event',
        repo: 'body.repository.full_name',
      }),
    ).toEqual({
      value: {
        event: 'headers.x-github-event',
        repo: 'body.repository.full_name',
      },
    });
  });

  it('trims surrounding whitespace before persisting mapping paths', () => {
    expect(
      validateContextMapping({
        event: '  headers.X-GitHub-Event  ',
      }),
    ).toEqual({
      value: {
        event: 'headers.x-github-event',
      },
    });
  });

  it('rejects reserved output keys and reserved source paths', () => {
    expect(
      validateContextMapping({
        constructor: 'body.action',
      }),
    ).toEqual({
      value: null,
      error: 'contextMappingJson.constructor is reserved',
    });
    expect(
      validateContextMapping({
        _trigger: 'body.action',
      }),
    ).toEqual({
      value: null,
      error: 'contextMappingJson._trigger is reserved',
    });
    expect(
      validateContextMapping({
        repo: 'body.prototype.value',
      }),
    ).toEqual({
      value: null,
      error: 'contextMappingJson.repo must be a dot-path string',
    });
  });
});

describe('evaluateEventFilter', () => {
  it('treats a null filter as a match and handles invalid paths safely', () => {
    expect(evaluateEventFilter(null, envelope)).toBe(true);
    expect(getByDotPath(envelope, 'body..action')).toBeUndefined();
    expect(getByDotPath(envelope, 'body.repository.full_name')).toBe('org/repo');
    expect(getByDotPath({ body: 'not-an-object' }, 'body.action')).toBeUndefined();
  });

  it('does not traverse reserved or inherited properties', () => {
    const body = Object.create({ action: 'opened' }) as Record<string, unknown>;
    expect(getByDotPath({ body }, 'body.action')).toBeUndefined();
    expect(getByDotPath(envelope, 'body.__proto__.action')).toBeUndefined();
  });

  it('applies all operators with AND semantics', () => {
    const filter = {
      match: [
        { path: '_trigger.event', eq: 'pull_request' },
        { path: 'body.action', in: ['opened', 'synchronize'] },
        { path: 'body.deployment', exists: true },
        { path: 'body.ref', prefix: 'refs/heads/release/' },
      ],
    };

    expect(evaluateEventFilter(filter, envelope)).toBe(true);
    expect(
      evaluateEventFilter(
        {
          match: [
            { path: '_trigger.event', eq: 'push' },
            { path: 'body.action', in: ['opened'] },
          ],
        },
        envelope,
      ),
    ).toBe(false);
  });

  it('matches header paths case-insensitively via normalization', () => {
    expect(
      evaluateEventFilter(
        { match: [{ path: 'headers.X-GitHub-Event', eq: 'pull_request' }] },
        envelope,
      ),
    ).toBe(true);
    expect(
      evaluateEventFilter(
        { match: [{ path: 'headers.x-github-event', eq: 'pull_request' }] },
        envelope,
      ),
    ).toBe(true);
  });

  it('supports exists=false filters when the field is absent', () => {
    expect(
      evaluateEventFilter({ match: [{ path: 'body.sender.id', exists: false }] }, envelope),
    ).toBe(true);
  });
});

describe('buildTriggerContext', () => {
  it('returns null when applyContextMapping is called without a mapping', () => {
    expect(applyContextMapping(null, envelope)).toBeNull();
  });

  it('includes mapped values and the _trigger metadata block', () => {
    expect(
      buildTriggerContext(
        {
          repo: 'body.repository.full_name',
          branch: 'body.pull_request.head.ref',
          action: 'body.action',
          missing: 'body.sender.id',
        },
        envelope,
      ),
    ).toEqual({
      repo: 'org/repo',
      branch: 'feature/test',
      action: 'opened',
      missing: null,
      _trigger: {
        publisher: 'github',
        event: 'pull_request',
        deliveryId: 'delivery-1',
      },
    });
  });

  it('returns null when no mapping is configured', () => {
    expect(buildTriggerContext(null, envelope)).toBeNull();
  });

  it('sets _trigger to null when the trigger metadata block is absent', () => {
    expect(
      buildTriggerContext(
        {
          repo: 'body.repository.full_name',
        },
        {
          headers: envelope.headers,
          body: envelope.body,
        },
      ),
    ).toEqual({
      repo: 'org/repo',
      _trigger: null,
    });
  });
});

describe('stored webhook filter helpers', () => {
  it('serializes and parses stored filter/context payloads', () => {
    const filter = { match: [{ path: 'body.action', eq: 'opened' as const }] };
    const mapping = { repo: 'body.repository.full_name' };

    expect(serializeEventFilterDefinition(filter)).toBe(JSON.stringify(filter));
    expect(serializeEventFilterDefinition(null)).toBeNull();
    expect(parseStoredEventFilterDefinitionResult(JSON.stringify(filter))).toEqual({
      value: filter,
    });
    expect(parseStoredEventFilterDefinitionResult('{"match":"bad"}')).toEqual({
      value: null,
      error: expect.stringContaining('invalid'),
    });
    expect(parseStoredEventFilterDefinitionResult(null)).toEqual({ value: null });

    expect(serializeContextMapping(mapping)).toBe(JSON.stringify(mapping));
    expect(serializeContextMapping(null)).toBeNull();
    expect(parseStoredContextMappingResult(JSON.stringify(mapping))).toEqual({
      value: mapping,
    });
    expect(parseStoredContextMappingResult('{"repo":true}')).toEqual({
      value: null,
      error: expect.stringContaining('invalid'),
    });
    expect(parseStoredContextMappingResult(null)).toEqual({ value: null });
  });

  it('returns error for malformed stored JSON payloads', () => {
    expect(parseStoredEventFilterDefinitionResult('{bad json')).toEqual({
      value: null,
      error: expect.stringContaining('valid JSON'),
    });
    expect(parseStoredContextMappingResult('{bad json')).toEqual({
      value: null,
      error: expect.stringContaining('valid JSON'),
    });
  });

  it('rejects malformed JSON strings passed at input boundaries', () => {
    expect(parseEventFilterInput('{bad json')).toEqual({
      value: null,
      serialized: null,
      error: 'filterJson must be valid JSON',
    });
    expect(parseContextMappingInput('{bad json')).toEqual({
      value: null,
      serialized: null,
      error: 'contextMappingJson must be valid JSON',
    });
  });
});
