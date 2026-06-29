/** @module db — SQLite boolean conversion helpers shared across all layers */
/** SQLite boolean helpers — shared across all layers (store, session, dashboard). */

export function boolToDb(value: unknown): 0 | 1 {
  return value ? 1 : 0;
}

export function boolFromDb(value: unknown): boolean {
  return value !== 0 && value !== null && value !== undefined;
}
