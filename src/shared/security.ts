/** @module security — Constant-time string comparison for authentication token validation */
import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison.
 * Pads both inputs to equal length before timingSafeEqual to avoid leaking
 * length differences through an early return.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  const len = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.alloc(len);
  const paddedB = Buffer.alloc(len);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  return timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length;
}
