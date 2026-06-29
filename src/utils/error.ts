/** @module error — Safely extract error messages from unknown thrown values. */
export function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
