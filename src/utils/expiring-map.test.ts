import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpiringMap } from './expiring-map.js';

describe('ExpiringMap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and retrieves values without TTL', () => {
    const map = new ExpiringMap<string, number>();
    map.set('a', 1);
    expect(map.get('a')).toBe(1);
    expect(map.has('a')).toBe(true);
    expect(map.size).toBe(1);
  });

  it('returns undefined for missing keys', () => {
    const map = new ExpiringMap<string, number>();
    expect(map.get('missing')).toBeUndefined();
    expect(map.has('missing')).toBe(false);
  });

  it('evicts entries lazily on get() after TTL expires', () => {
    const map = new ExpiringMap<string, number>();
    map.set('a', 1, 1000);
    expect(map.get('a')).toBe(1);

    vi.advanceTimersByTime(999);
    expect(map.get('a')).toBe(1);

    vi.advanceTimersByTime(1);
    expect(map.get('a')).toBeUndefined();
    expect(map.has('a')).toBe(false);
  });

  it('evicts entries eagerly via evict()', () => {
    const map = new ExpiringMap<string, number>();
    map.set('a', 1, 500);
    map.set('b', 2, 1500);
    map.set('c', 3); // no TTL

    vi.advanceTimersByTime(1000);
    const evicted = map.evict();
    expect(evicted).toBe(1); // only 'a' expired
    expect(map.get('a')).toBeUndefined();
    expect(map.get('b')).toBe(2);
    expect(map.get('c')).toBe(3);
  });

  it('delete() removes entries regardless of expiry', () => {
    const map = new ExpiringMap<string, number>();
    map.set('a', 1, 10_000);
    expect(map.delete('a')).toBe(true);
    expect(map.get('a')).toBeUndefined();
    expect(map.delete('a')).toBe(false);
  });

  it('clear() removes all entries', () => {
    const map = new ExpiringMap<string, number>();
    map.set('a', 1);
    map.set('b', 2);
    map.clear();
    expect(map.size).toBe(0);
    expect(map.get('a')).toBeUndefined();
  });

  it('entries() skips expired entries', () => {
    const map = new ExpiringMap<string, number>();
    map.set('a', 1, 500);
    map.set('b', 2, 1500);
    map.set('c', 3);

    vi.advanceTimersByTime(1000);
    const entries = [...map.entries()];
    expect(entries).toEqual([
      ['b', 2],
      ['c', 3],
    ]);
  });

  it('values() skips expired entries', () => {
    const map = new ExpiringMap<string, number>();
    map.set('a', 1, 500);
    map.set('b', 2);

    vi.advanceTimersByTime(1000);
    expect([...map.values()]).toEqual([2]);
  });

  it('keys() skips expired entries', () => {
    const map = new ExpiringMap<string, number>();
    map.set('a', 1, 500);
    map.set('b', 2);

    vi.advanceTimersByTime(1000);
    expect([...map.keys()]).toEqual(['b']);
  });

  it('is iterable via for...of', () => {
    const map = new ExpiringMap<string, number>();
    map.set('x', 10);
    map.set('y', 20);

    const result: [string, number][] = [];
    for (const entry of map) {
      result.push(entry);
    }
    expect(result).toEqual([
      ['x', 10],
      ['y', 20],
    ]);
  });

  it('set() overwrites existing entry with new TTL', () => {
    const map = new ExpiringMap<string, number>();
    map.set('a', 1, 500);

    vi.advanceTimersByTime(300);
    map.set('a', 2, 500); // reset TTL

    vi.advanceTimersByTime(300);
    expect(map.get('a')).toBe(2); // still alive (300ms into new 500ms TTL)

    vi.advanceTimersByTime(200);
    expect(map.get('a')).toBeUndefined(); // expired
  });

  it('evict() returns 0 when nothing expired', () => {
    const map = new ExpiringMap<string, number>();
    map.set('a', 1, 10_000);
    expect(map.evict()).toBe(0);
  });

  it('handles mixed TTL and no-TTL entries', () => {
    const map = new ExpiringMap<string, string>();
    map.set('temp', 'will expire', 100);
    map.set('perm', 'forever');

    vi.advanceTimersByTime(200);
    expect(map.get('temp')).toBeUndefined();
    expect(map.get('perm')).toBe('forever');
  });
});
