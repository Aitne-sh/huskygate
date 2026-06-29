import { describe, expect, it, vi } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  it('allows actions within the limit', () => {
    const limiter = new RateLimiter(3, 10_000);
    expect(limiter.allow('user1')).toBe(true);
    expect(limiter.allow('user1')).toBe(true);
    expect(limiter.allow('user1')).toBe(true);
  });

  it('blocks actions exceeding the limit', () => {
    const limiter = new RateLimiter(2, 10_000);
    expect(limiter.allow('user1')).toBe(true);
    expect(limiter.allow('user1')).toBe(true);
    expect(limiter.allow('user1')).toBe(false);
  });

  it('tracks users independently', () => {
    const limiter = new RateLimiter(1, 10_000);
    expect(limiter.allow('user1')).toBe(true);
    expect(limiter.allow('user2')).toBe(true);
    expect(limiter.allow('user1')).toBe(false);
    expect(limiter.allow('user2')).toBe(false);
  });

  it('resets after the window expires', () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter(1, 1000);
      expect(limiter.allow('user1')).toBe(true);
      expect(limiter.allow('user1')).toBe(false);

      vi.advanceTimersByTime(1001);
      expect(limiter.allow('user1')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts stale entries', () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter(1, 1000);
      limiter.allow('user1');
      limiter.allow('user2');

      vi.advanceTimersByTime(1001);
      limiter.evict();

      // After eviction, both users should be allowed again
      expect(limiter.allow('user1')).toBe(true);
      expect(limiter.allow('user2')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('compacts partially stale window entries', () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter(3, 1000);
      expect(limiter.allow('user1')).toBe(true); // t=0
      vi.advanceTimersByTime(900);
      expect(limiter.allow('user1')).toBe(true); // t=900
      vi.advanceTimersByTime(600); // t=1500, cutoff=500, first entry stale only

      expect(limiter.allow('user1')).toBe(true); // triggers slice(firstValid)
      expect(limiter.allow('user1')).toBe(true);
      expect(limiter.allow('user1')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
