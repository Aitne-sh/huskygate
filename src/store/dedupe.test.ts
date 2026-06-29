import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { DedupeStore } from './dedupe.js';

let db: Database.Database | null = null;

function createStore(): DedupeStore {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dedupe (
      event_id TEXT PRIMARY KEY,
      received_at TEXT NOT NULL,
      ttl_expires_at TEXT NOT NULL
    );
  `);
  return new DedupeStore(db);
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('DedupeStore', () => {
  it('registers and detects duplicate events', () => {
    const store = createStore();

    expect(store.isDuplicate('evt-1')).toBe(false);
    store.register('evt-1');
    expect(store.isDuplicate('evt-1')).toBe(true);
  });

  it('atomically registers events and reports duplicates', () => {
    const store = createStore();

    expect(store.isDuplicateAndRegister('evt-atomic')).toBe(false);
    expect(store.isDuplicateAndRegister('evt-atomic')).toBe(true);
  });

  it('cleanup removes only expired rows', () => {
    const store = createStore();

    (db as NonNullable<typeof db>)
      .prepare('INSERT INTO dedupe (event_id, received_at, ttl_expires_at) VALUES (?, ?, ?)')
      .run(
        'expired',
        new Date(Date.now() - 20_000).toISOString(),
        new Date(Date.now() - 10_000).toISOString(),
      );
    store.register('active');

    const removed = store.cleanup();
    expect(removed).toBe(1);
    expect(store.isDuplicate('expired')).toBe(false);
    expect(store.isDuplicate('active')).toBe(true);
  });

  it('cleanup returns zero when no expired rows exist', () => {
    const store = createStore();
    store.register('active-1');
    store.register('active-2');

    expect(store.cleanup()).toBe(0);
  });
});
