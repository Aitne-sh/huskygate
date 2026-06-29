/** @module rate-limiter — Sliding-window rate limiter keyed by arbitrary string identifiers */
/**
 * Sliding-window rate limiter.
 *
 * Tracks timestamps of recent actions per key and rejects when the count
 * exceeds `maxCount` within `windowMs`.
 */
export class RateLimiter {
  private readonly windows = new Map<string, number[]>();

  constructor(
    private readonly maxCount: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Check whether the action is allowed.
   * If allowed, records the action and returns `true`.
   * If rate-limited, returns `false` without recording.
   */
  allow(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.windows.get(key);
    if (timestamps) {
      // Remove entries outside the window
      const firstValid = timestamps.findIndex((t) => t > cutoff);
      if (firstValid > 0) {
        timestamps = timestamps.slice(firstValid);
        this.windows.set(key, timestamps);
      } else if (firstValid === -1) {
        timestamps = [];
        this.windows.set(key, timestamps);
      }
    } else {
      timestamps = [];
      this.windows.set(key, timestamps);
    }

    if (timestamps.length >= this.maxCount) {
      return false;
    }

    timestamps.push(now);
    return true;
  }

  /**
   * Evict stale entries to prevent memory growth.
   * Call periodically (e.g., every few minutes).
   */
  evict(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, timestamps] of this.windows) {
      const valid = timestamps.filter((t) => t > cutoff);
      if (valid.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, valid);
      }
    }
  }
}
