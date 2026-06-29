import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { DefaultInstructionStore } from './default-instruction.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE default_instructions (
      tool TEXT PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

describe('DefaultInstructionStore', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('returns defaults when no row exists', () => {
    db = createDb();
    const store = new DefaultInstructionStore(db);

    expect(store.getWithEnabled('claude')).toEqual({
      content: '',
      enabled: false,
    });
  });

  it('stores content and toggles full-replace mode', () => {
    db = createDb();
    const store = new DefaultInstructionStore(db);

    store.set('claude', 'Follow the runbook');
    expect(store.getWithEnabled('claude')).toEqual({
      content: 'Follow the runbook',
      enabled: false,
    });

    store.setEnabled('claude', true);
    expect(store.getWithEnabled('claude')).toEqual({
      content: 'Follow the runbook',
      enabled: true,
    });

    store.set('claude', 'Updated instructions');
    store.setEnabled('claude', false);
    expect(store.getWithEnabled('claude')).toEqual({
      content: 'Updated instructions',
      enabled: false,
    });
  });
});
