import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { DevAliasStore } from './dev-alias.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dev_aliases (
      name                TEXT PRIMARY KEY,
      path                TEXT NOT NULL,
      tool                TEXT NOT NULL DEFAULT 'claude',
      instruction_content TEXT,
      created_at          TEXT NOT NULL
    );
  `);
  return db;
}

describe('DevAliasStore', () => {
  it('creates and retrieves an alias', () => {
    const db = createDb();
    const store = new DevAliasStore(db);

    const alias = store.create('my-project', '/Users/test/project', 'claude');
    expect(alias.name).toBe('my-project');
    expect(alias.path).toBe('/Users/test/project');
    expect(alias.tool).toBe('claude');
    expect(alias.instructionContent).toBeNull();
    expect(alias.createdAt).toBeTruthy();

    const fetched = store.get('my-project');
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe('my-project');
    expect(fetched?.instructionContent).toBeNull();

    db.close();
  });

  it('returns null for non-existent alias', () => {
    const db = createDb();
    const store = new DevAliasStore(db);

    expect(store.get('nonexistent')).toBeNull();

    db.close();
  });

  it('lists all aliases ordered by name', () => {
    const db = createDb();
    const store = new DevAliasStore(db);

    store.create('beta', '/path/beta', 'gemini');
    store.create('alpha', '/path/alpha', 'claude');

    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list[0]?.name).toBe('alpha');
    expect(list[1]?.name).toBe('beta');

    db.close();
  });

  it('updates an existing alias', () => {
    const db = createDb();
    const store = new DevAliasStore(db);

    store.create('proj', '/old/path', 'claude');
    const updated = store.update('proj', { path: '/new/path', tool: 'codex' });

    expect(updated).not.toBeNull();
    expect(updated?.path).toBe('/new/path');
    expect(updated?.tool).toBe('codex');

    const fetched = store.get('proj');
    expect(fetched?.path).toBe('/new/path');
    expect(fetched?.tool).toBe('codex');

    db.close();
  });

  it('returns null when updating non-existent alias', () => {
    const db = createDb();
    const store = new DevAliasStore(db);

    const result = store.update('nope', { path: '/foo' });
    expect(result).toBeNull();

    db.close();
  });

  it('deletes an alias', () => {
    const db = createDb();
    const store = new DevAliasStore(db);

    store.create('to-delete', '/path', 'claude');
    expect(store.delete('to-delete')).toBe(true);
    expect(store.get('to-delete')).toBeNull();

    db.close();
  });

  it('returns false when deleting non-existent alias', () => {
    const db = createDb();
    const store = new DevAliasStore(db);

    expect(store.delete('nope')).toBe(false);

    db.close();
  });

  it('partial update preserves unchanged fields', () => {
    const db = createDb();
    const store = new DevAliasStore(db);

    store.create('proj', '/path', 'claude');
    const updated = store.update('proj', { tool: 'gemini' });

    expect(updated?.path).toBe('/path');
    expect(updated?.tool).toBe('gemini');

    db.close();
  });

  it('creates alias with instruction content', () => {
    const db = createDb();
    const store = new DevAliasStore(db);

    const alias = store.create('proj', '/path', 'claude', 'Custom instructions');
    expect(alias.instructionContent).toBe('Custom instructions');

    const fetched = store.get('proj');
    expect(fetched?.instructionContent).toBe('Custom instructions');

    db.close();
  });

  it('updates instruction content', () => {
    const db = createDb();
    const store = new DevAliasStore(db);

    store.create('proj', '/path', 'claude', 'Original');
    const updated = store.update('proj', { instructionContent: 'Updated' });
    expect(updated?.instructionContent).toBe('Updated');

    const fetched = store.get('proj');
    expect(fetched?.instructionContent).toBe('Updated');

    db.close();
  });

  it('clears instruction content with null', () => {
    const db = createDb();
    const store = new DevAliasStore(db);

    store.create('proj', '/path', 'claude', 'Some content');
    const updated = store.update('proj', { instructionContent: null });
    expect(updated?.instructionContent).toBeNull();

    db.close();
  });

  it('preserves instruction content on unrelated update', () => {
    const db = createDb();
    const store = new DevAliasStore(db);

    store.create('proj', '/path', 'claude', 'Keep this');
    const updated = store.update('proj', { tool: 'gemini' });
    expect(updated?.instructionContent).toBe('Keep this');

    db.close();
  });

  it('falls back to claude when DB row has invalid tool value', () => {
    const db = createDb();
    const store = new DevAliasStore(db);

    db.prepare(
      'INSERT INTO dev_aliases (name, path, tool, instruction_content, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('invalid-tool', '/tmp/path', 'not-a-tool', null, new Date().toISOString());

    const fetched = store.get('invalid-tool');
    expect(fetched?.tool).toBe('claude');

    db.close();
  });
});
