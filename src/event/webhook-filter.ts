/** @module webhook-filter — Webhook event filter validation, evaluation, and context mapping */
import type {
  EventContextMapping,
  EventFilterClause,
  EventFilterDefinition,
  EventFilterPrimitive,
} from './types.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is EventFilterPrimitive {
  return ['string', 'number', 'boolean'].includes(typeof value);
}

const RESERVED_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function hasReservedSegment(path: string): boolean {
  return path.split('.').some((part) => RESERVED_SEGMENTS.has(part));
}

function normalizeValidatedPath(path: string): string {
  return normalizeDotPath(path.trim());
}

function isValidPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.includes('[')) return false;
  if (hasReservedSegment(trimmed)) return false;
  return /^(body|headers|_trigger)\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(trimmed);
}

/**
 * Normalize a dot-path so that segments under `headers.` are lowercased.
 * HTTP headers are normalized to lowercase at ingress, so filter/mapping
 * paths must match in a case-insensitive manner for the `headers` root.
 */
function normalizeDotPath(path: string): string {
  if (!path.startsWith('headers.')) return path;
  return path.toLowerCase();
}

export function validateEventFilterDefinition(input: unknown): {
  value: EventFilterDefinition | null;
  error?: string;
} {
  if (input == null) return { value: null };
  if (!isPlainObject(input)) {
    return { value: null, error: 'filterJson must be an object' };
  }
  const match = input.match;
  if (!Array.isArray(match)) {
    return { value: null, error: 'filterJson.match must be an array' };
  }
  if (match.length === 0) {
    return { value: null, error: 'filterJson.match must not be empty' };
  }
  const clauses: EventFilterClause[] = [];
  for (const [index, rawClause] of match.entries()) {
    if (!isPlainObject(rawClause)) {
      return { value: null, error: `filterJson.match[${index}] must be an object` };
    }
    if (!isValidPath(rawClause.path)) {
      return { value: null, error: `filterJson.match[${index}].path must be a dot-path string` };
    }
    const normalizedPath = normalizeValidatedPath(rawClause.path as string);
    const operators = ['eq', 'in', 'exists', 'prefix'].filter((key) => key in rawClause);
    if (operators.length !== 1) {
      return {
        value: null,
        error: `filterJson.match[${index}] must specify exactly one operator`,
      };
    }
    if ('eq' in rawClause) {
      if (!isPrimitive(rawClause.eq)) {
        return {
          value: null,
          error: `filterJson.match[${index}].eq must be a primitive value`,
        };
      }
      clauses.push({ path: normalizedPath, eq: rawClause.eq });
      continue;
    }
    if ('in' in rawClause) {
      if (
        !Array.isArray(rawClause.in) ||
        rawClause.in.length === 0 ||
        rawClause.in.some((value) => !isPrimitive(value))
      ) {
        return {
          value: null,
          error: `filterJson.match[${index}].in must be an array of primitive values`,
        };
      }
      clauses.push({ path: normalizedPath, in: rawClause.in });
      continue;
    }
    if ('exists' in rawClause) {
      if (typeof rawClause.exists !== 'boolean') {
        return {
          value: null,
          error: `filterJson.match[${index}].exists must be a boolean`,
        };
      }
      clauses.push({ path: normalizedPath, exists: rawClause.exists });
      continue;
    }
    if (typeof rawClause.prefix !== 'string' || rawClause.prefix.length === 0) {
      return {
        value: null,
        error: `filterJson.match[${index}].prefix must be a string`,
      };
    }
    clauses.push({ path: normalizedPath, prefix: rawClause.prefix });
  }
  return { value: { match: clauses } };
}

export function validateContextMapping(input: unknown): {
  value: EventContextMapping | null;
  error?: string;
} {
  if (input == null) return { value: null };
  if (!isPlainObject(input)) {
    return { value: null, error: 'contextMappingJson must be an object' };
  }
  const mapping: EventContextMapping = {};
  for (const [key, value] of Object.entries(input)) {
    if (RESERVED_SEGMENTS.has(key) || key === '_trigger') {
      return { value: null, error: `contextMappingJson.${key} is reserved` };
    }
    if (!isValidPath(value)) {
      return { value: null, error: `contextMappingJson.${key} must be a dot-path string` };
    }
    mapping[key] = normalizeValidatedPath(value);
  }
  return { value: mapping };
}

export function parseEventFilterInput(input: unknown): {
  value: EventFilterDefinition | null;
  serialized: string | null;
  error?: string;
} {
  if (input == null) {
    return { value: null, serialized: null };
  }
  let parsed: unknown = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch {
      return { value: null, serialized: null, error: 'filterJson must be valid JSON' };
    }
  }
  const result = validateEventFilterDefinition(parsed);
  if (result.error) {
    return { value: null, serialized: null, error: result.error };
  }
  return {
    value: result.value,
    serialized: serializeEventFilterDefinition(result.value),
  };
}

export function parseContextMappingInput(input: unknown): {
  value: EventContextMapping | null;
  serialized: string | null;
  error?: string;
} {
  if (input == null) {
    return { value: null, serialized: null };
  }
  let parsed: unknown = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch {
      return {
        value: null,
        serialized: null,
        error: 'contextMappingJson must be valid JSON',
      };
    }
  }
  const result = validateContextMapping(parsed);
  if (result.error) {
    return { value: null, serialized: null, error: result.error };
  }
  return {
    value: result.value,
    serialized: serializeContextMapping(result.value),
  };
}

export function serializeEventFilterDefinition(
  filter: EventFilterDefinition | null,
): string | null {
  return filter ? JSON.stringify(filter) : null;
}

export function serializeContextMapping(mapping: EventContextMapping | null): string | null {
  return mapping ? JSON.stringify(mapping) : null;
}

export function parseStoredEventFilterDefinitionResult(json: string | null): {
  value: EventFilterDefinition | null;
  error?: string;
} {
  if (!json) return { value: null };
  try {
    const parsed = JSON.parse(json) as unknown;
    const result = validateEventFilterDefinition(parsed);
    if (result.error) {
      return { value: null, error: `Stored filterJson is invalid: ${result.error}` };
    }
    return { value: result.value };
  } catch {
    return { value: null, error: 'Stored filterJson must be valid JSON' };
  }
}

export function parseStoredContextMappingResult(json: string | null): {
  value: EventContextMapping | null;
  error?: string;
} {
  if (!json) return { value: null };
  try {
    const parsed = JSON.parse(json) as unknown;
    const result = validateContextMapping(parsed);
    if (result.error) {
      return { value: null, error: `Stored contextMappingJson is invalid: ${result.error}` };
    }
    return { value: result.value };
  } catch {
    return { value: null, error: 'Stored contextMappingJson must be valid JSON' };
  }
}

export function getByDotPath(root: unknown, path: string): unknown {
  const normalized = normalizeDotPath(path);
  const parts = normalized.split('.');
  if (parts.some((part) => part.length === 0 || RESERVED_SEGMENTS.has(part))) return undefined;
  let current: unknown = root;
  for (const part of parts) {
    if (!isPlainObject(current) || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function matchesClause(clause: EventFilterClause, root: unknown): boolean {
  const value = getByDotPath(root, clause.path);
  if ('eq' in clause) return value === clause.eq;
  if ('in' in clause) return clause.in.includes(value as EventFilterPrimitive);
  if ('exists' in clause) return clause.exists ? value !== undefined : value === undefined;
  return typeof value === 'string' && value.startsWith(clause.prefix);
}

export function evaluateEventFilter(filter: EventFilterDefinition | null, root: unknown): boolean {
  if (!filter) return true;
  return filter.match.every((clause) => matchesClause(clause, root));
}

export function applyContextMapping(mapping: null, root: unknown): null;
export function applyContextMapping(
  mapping: EventContextMapping,
  root: unknown,
): Record<string, unknown>;
export function applyContextMapping(
  mapping: EventContextMapping | null,
  root: unknown,
): Record<string, unknown> | null {
  if (!mapping) return null;
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, path] of Object.entries(mapping)) {
    const value = getByDotPath(root, path);
    output[key] = value === undefined ? null : value;
  }
  return output;
}

export function buildTriggerContext(
  mapping: EventContextMapping | null,
  root: unknown,
): Record<string, unknown> | null {
  if (!mapping) return null;
  const output = applyContextMapping(mapping, root);
  const trigger = getByDotPath(root, '_trigger');
  return { ...output, _trigger: trigger ?? null };
}
