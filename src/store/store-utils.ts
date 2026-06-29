/** @module store-utils — SQLite boolean/JSON encoding, dynamic UPDATE builder, and optimistic concurrency helpers */
/**
 * Shared utilities for Store classes — SQLite boolean/JSON encoding,
 * dynamic UPDATE builder, and atomic increment helpers.
 */

/* ── Boolean ↔ SQLite INTEGER ── */

import { boolFromDb, boolToDb } from '../utils/db.js';

export { boolFromDb, boolToDb };

/* ── JSON field serialisation ── */

export function skillsToDb(skills: unknown): string | null {
  return Array.isArray(skills) ? JSON.stringify(skills) : null;
}

export function jsonToDb(value: unknown): string | null {
  return value != null ? JSON.stringify(value) : null;
}

/* ── Standard transform presets ── */

export const BOOL_TRANSFORM = (v: unknown): 0 | 1 => boolToDb(v);
export const SKILLS_TRANSFORM = (v: unknown): string | null => skillsToDb(v);
export const JSON_TRANSFORM = (v: unknown): string | null => jsonToDb(v);
export const TRIM_TRANSFORM = (v: unknown): unknown => (typeof v === 'string' ? v.trim() : v);
export const TRIM_OR_NULL_TRANSFORM = (v: unknown): string | null =>
  typeof v === 'string' ? v.trim() || null : null;

/* ── Dynamic UPDATE builder ── */

export interface DynamicUpdateConfig {
  /** camelCase key → snake_case column mapping */
  fieldMap: Record<string, string>;
  /** Per-key value transformers (applied before pushing to params) */
  transforms?: Record<string, (v: unknown) => unknown>;
  /** Extra SET clauses to append unconditionally (e.g. 'claimed_at = NULL') */
  appendSets?: string[];
  /** Automatically append `updated_at = ?` with current ISO timestamp (default: true) */
  autoTimestamp?: boolean;
  /** When set, adds `AND updated_at = ?` to WHERE for optimistic concurrency. */
  expectedUpdatedAt?: string;
}

export interface DynamicUpdateResult {
  /** SET clause fragments (e.g. ['name = ?', 'status = ?', 'updated_at = ?']) */
  sets: string[];
  /** Positional parameter values matching sets (does NOT include the WHERE id param) */
  params: unknown[];
  /** Extra WHERE clause for optimistic concurrency (e.g. 'AND updated_at = ?') */
  extraWhere?: string;
  /** Extra WHERE param values (appended after the WHERE id param) */
  extraWhereParams?: unknown[];
}

const APPEND_SET_CLAUSE_RE = /^[A-Za-z_][A-Za-z0-9_]*\s*=\s*NULL$/;

/**
 * Build SET clause + params from a partial patch object.
 * Returns `null` when the patch contains no matching fields (nothing to update).
 *
 * The caller is responsible for appending the WHERE id param and executing the SQL.
 */
export function buildDynamicUpdate(
  patch: Record<string, unknown>,
  config: DynamicUpdateConfig,
): DynamicUpdateResult | null {
  const { fieldMap, transforms, appendSets, autoTimestamp = true, expectedUpdatedAt } = config;

  const sets: string[] = [];
  const params: unknown[] = [];

  for (const [key, value] of Object.entries(patch)) {
    const col = fieldMap[key];
    if (!col) continue;

    const transform = transforms?.[key];
    const dbValue = transform ? transform(value) : value === undefined ? null : value;

    sets.push(`${col} = ?`);
    params.push(dbValue);
  }

  const noSets = sets.length === 0;
  const noAppend = !appendSets || appendSets.length === 0;
  if (noSets && noAppend) {
    return null;
  }

  if (appendSets) {
    for (const clause of appendSets) {
      if (!APPEND_SET_CLAUSE_RE.test(clause)) {
        throw new Error(`Invalid appendSets clause: ${clause}`);
      }
      sets.push(clause);
    }
  }

  if (autoTimestamp) {
    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
  }

  const result: DynamicUpdateResult = { sets, params };

  if (expectedUpdatedAt) {
    result.extraWhere = 'AND updated_at = ?';
    result.extraWhereParams = [expectedUpdatedAt];
  }

  return result;
}

/**
 * Thrown when an optimistic concurrency check fails (stale updatedAt).
 */
export class StaleUpdateError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} was modified by another request. Refresh and try again.`);
    this.name = 'StaleUpdateError';
  }
}
