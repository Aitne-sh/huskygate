import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigStore } from './config-store.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE config (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      storage    TEXT NOT NULL CHECK (storage IN ('db', 'keychain_ref')),
      source     TEXT NOT NULL CHECK (source = 'user'),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (
          (storage = 'db' AND value IS NOT NULL) OR
          (storage = 'keychain_ref' AND value IS NULL)
      )
    );

    CREATE TABLE metadata (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

describe('ConfigStore', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  describe('list', () => {
    it('returns empty array when no config records exist', () => {
      db = createDb();
      const store = new ConfigStore(db);
      expect(store.list()).toEqual([]);
    });

    it('returns all config records ordered by key', () => {
      db = createDb();
      const store = new ConfigStore(db);

      store.setDbValue('zeta', 'val-z');
      store.setDbValue('alpha', 'val-a');
      store.setDbValue('mid', 'val-m');

      const records = store.list();
      expect(records).toHaveLength(3);
      expect(records[0]?.key).toBe('alpha');
      expect(records[0]?.value).toBe('val-a');
      expect(records[0]?.storage).toBe('db');
      expect(records[0]?.source).toBe('user');
      expect(records[0]?.updatedAt).toBeTruthy();
      expect(records[1]?.key).toBe('mid');
      expect(records[2]?.key).toBe('zeta');
    });
  });

  describe('get', () => {
    it('returns null for non-existent key', () => {
      db = createDb();
      const store = new ConfigStore(db);
      expect(store.get('no-such-key')).toBeNull();
    });

    it('returns the config record for an existing key', () => {
      db = createDb();
      const store = new ConfigStore(db);

      store.setDbValue('my-key', 'my-value', 'user');
      const record = store.get('my-key');
      expect(record).not.toBeNull();
      expect(record?.key).toBe('my-key');
      expect(record?.value).toBe('my-value');
      expect(record?.storage).toBe('db');
      expect(record?.source).toBe('user');
      expect(record?.updatedAt).toBeTruthy();
    });
  });

  describe('getMetadata', () => {
    it('returns null for non-existent metadata key', () => {
      db = createDb();
      const store = new ConfigStore(db);
      expect(store.getMetadata('missing')).toBeNull();
    });

    it('returns the value for an existing metadata key', () => {
      db = createDb();
      const store = new ConfigStore(db);

      store.setMetadata('schema-version', '42');
      expect(store.getMetadata('schema-version')).toBe('42');
    });
  });

  describe('setMetadata', () => {
    it('inserts a new metadata entry', () => {
      db = createDb();
      const store = new ConfigStore(db);

      store.setMetadata('new-key', 'new-value');
      expect(store.getMetadata('new-key')).toBe('new-value');
    });

    it('updates an existing metadata entry (upsert)', () => {
      db = createDb();
      const store = new ConfigStore(db);

      store.setMetadata('key', 'first');
      expect(store.getMetadata('key')).toBe('first');

      store.setMetadata('key', 'second');
      expect(store.getMetadata('key')).toBe('second');
    });
  });

  describe('delete', () => {
    it('removes an existing config entry', () => {
      db = createDb();
      const store = new ConfigStore(db);

      store.setDbValue('TO_DELETE', 'val', 'user');
      expect(store.get('TO_DELETE')).not.toBeNull();

      store.delete('TO_DELETE');
      expect(store.get('TO_DELETE')).toBeNull();
    });

    it('does nothing when deleting a non-existent config key', () => {
      db = createDb();
      const store = new ConfigStore(db);

      store.delete('NONEXISTENT');
      expect(store.get('NONEXISTENT')).toBeNull();
    });
  });

  describe('deleteMetadata', () => {
    it('removes an existing metadata entry', () => {
      db = createDb();
      const store = new ConfigStore(db);

      store.setMetadata('to-delete', 'some-value');
      expect(store.getMetadata('to-delete')).toBe('some-value');

      store.deleteMetadata('to-delete');
      expect(store.getMetadata('to-delete')).toBeNull();
    });

    it('does nothing when deleting a non-existent metadata key', () => {
      db = createDb();
      const store = new ConfigStore(db);

      // Should not throw
      store.deleteMetadata('does-not-exist');
      expect(store.getMetadata('does-not-exist')).toBeNull();
    });
  });
});
