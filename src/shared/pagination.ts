/** @module shared/pagination — Centralized pagination defaults for API endpoints */

export const PAGINATION = {
  /** Standard API default limit */
  defaultLimit: 20,
  /** Standard API max limit */
  maxLimit: 100,
  /** Chat sessions default limit (higher due to listing nature) */
  chatDefaultLimit: 50,
  /** Chat sessions max limit */
  chatMaxLimit: 200,
} as const;

/**
 * Parse and clamp a `limit` query parameter.
 * @param raw - The raw query string value (e.g. from `searchParams.get('limit')`)
 * @param defaultLimit - Default when raw is missing or invalid
 * @param maxLimit - Upper bound to clamp to
 */
export function parseLimit(
  raw: string | null | undefined,
  defaultLimit: number = PAGINATION.defaultLimit,
  maxLimit: number = PAGINATION.maxLimit,
): number {
  return Math.min(
    Math.max(Number.parseInt(raw ?? String(defaultLimit), 10) || defaultLimit, 1),
    maxLimit,
  );
}
