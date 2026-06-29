/** @module expiring-map — TTL-backed Map with lazy and sweep-based eviction. */

/** Map wrapper with per-entry TTL; entries evict lazily on `get()` and eagerly via `evict()`. */
export class ExpiringMap<K, V> {
  private store = new Map<K, { value: V; expiresAt: number }>();

  /** Number of non-expired entries (lazy — may include some expired entries not yet evicted). */
  get size(): number {
    return this.store.size;
  }

  /** Store a value with an optional TTL in milliseconds. If ttlMs is omitted, the entry never expires. */
  set(key: K, value: V, ttlMs?: number): this {
    const expiresAt = ttlMs !== undefined ? Date.now() + ttlMs : Number.POSITIVE_INFINITY;
    this.store.set(key, { value, expiresAt });
    return this;
  }

  /** Retrieve a value. Returns undefined if the entry is missing or expired (lazy eviction). */
  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Check if a non-expired entry exists for the given key. */
  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  /** Delete an entry regardless of expiry. Returns true if the entry existed. */
  delete(key: K): boolean {
    return this.store.delete(key);
  }

  /** Remove all entries. */
  clear(): void {
    this.store.clear();
  }

  /** Sweep all expired entries. Call this periodically for defense-in-depth eviction. */
  evict(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.store) {
      if (now >= entry.expiresAt) {
        this.store.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  /** Iterate over non-expired entries. Expired entries are collected and deleted after iteration. */
  *entries(): IterableIterator<[K, V]> {
    const now = Date.now();
    const expiredKeys: K[] = [];
    for (const [key, entry] of this.store) {
      if (now >= entry.expiresAt) {
        expiredKeys.push(key);
        continue;
      }
      yield [key, entry.value];
    }
    for (const key of expiredKeys) {
      this.store.delete(key);
    }
  }

  /** Iterate over non-expired values. */
  *values(): IterableIterator<V> {
    for (const [, value] of this.entries()) {
      yield value;
    }
  }

  /** Iterate over non-expired keys. */
  *keys(): IterableIterator<K> {
    for (const [key] of this.entries()) {
      yield key;
    }
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }
}
