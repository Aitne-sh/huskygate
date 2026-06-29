/** @module shared/normalize-model — Shared model string normalizer for task/agent/node definitions. */

/** Maximum length for a model identifier string. */
export const MODEL_MAX_LENGTH = 100;

/**
 * Normalize a model input value from an API request body.
 *
 * - `undefined`, `null`, empty string → `null` (use system default)
 * - `"default"` → `null` (sentinel value for "use default")
 * - Otherwise: trimmed string, enforced max length
 *
 * Returns `null` when the CLI should use its built-in default (no `--model` flag).
 * Throws on invalid type or length violation.
 */
export function normalizeModel(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new Error('model must be a string');
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === 'default') return null;
  if (trimmed.length > MODEL_MAX_LENGTH) {
    throw new Error(`model must be <= ${MODEL_MAX_LENGTH} characters`);
  }
  return trimmed;
}
