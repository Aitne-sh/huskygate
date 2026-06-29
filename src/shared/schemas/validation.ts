/** @module shared/schemas/validation — Zod error formatting helpers for HTTP API responses. */
import type { ZodError } from 'zod';

/**
 * Format a ZodError into a human-readable string suitable for an API 400 response.
 *
 * Returns the first issue's message when there is a single error.
 * When multiple issues exist, joins all messages with "; ".
 * Messages are expected to be self-descriptive (custom messages in schemas should
 * include the field name when needed).
 */
export function formatZodError(error: ZodError): string {
  if (error.issues.length === 0) return 'Validation error';
  if (error.issues.length === 1) return error.issues[0]?.message ?? 'Validation error';
  return error.issues.map((issue) => issue.message).join('; ');
}
