/** @module helpers — Primitive type coercion helpers (str, num, parseJson) for DB row-to-domain mappers */

export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function num(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

export function parseJson<T>(v: unknown): T | null {
  if (!v || typeof v !== 'string') return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}
