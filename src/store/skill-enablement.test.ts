import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSkillRef } from '../skills/catalog.js';
import { SkillEnablementStore } from './skill-enablement.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE metadata (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE skill_enablement (
      skill_ref   TEXT NOT NULL,
      tool        TEXT NOT NULL,
      enabled     INTEGER NOT NULL,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (skill_ref, tool)
    );
  `);
  return db;
}

describe('SkillEnablementStore', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('sets and reads per-skill per-tool enablement', () => {
    db = createDb();
    const store = new SkillEnablementStore(db);
    const skillRef = buildSkillRef('builtin', 'playwright-runner');

    expect(store.getEnabled(skillRef, 'claude')).toBeNull();
    store.set(skillRef, 'claude', true);
    expect(store.getEnabled(skillRef, 'claude')).toBe(true);
    store.set(skillRef, 'claude', false);
    expect(store.getEnabled(skillRef, 'claude')).toBe(false);
  });

  it('deletes per-tool and per-skill enablement rows', () => {
    db = createDb();
    const store = new SkillEnablementStore(db);
    const skillRef = buildSkillRef('project', 'project-helper');
    store.set(skillRef, 'claude', true);
    store.set(skillRef, 'codex', false);

    expect(store.delete(skillRef, 'claude')).toBe(1);
    expect(store.getEnabled(skillRef, 'claude')).toBeNull();
    expect(store.getEnabled(skillRef, 'codex')).toBe(false);
    expect(store.deleteBySkillRef(skillRef)).toBe(1);
    expect(store.getEnabled(skillRef, 'codex')).toBeNull();
  });

  it('lists all enablement records', () => {
    db = createDb();
    const store = new SkillEnablementStore(db);
    const ref1 = buildSkillRef('builtin', 'aws-cli');
    const ref2 = buildSkillRef('local', 'my-skill');
    store.set(ref1, 'claude', true);
    store.set(ref2, 'gemini', false);

    const all = store.listAll();
    expect(all).toHaveLength(2);
    expect(all[0]?.skillRef).toBe(ref1);
    expect(all[1]?.skillRef).toBe(ref2);
  });

  it('lists enablement records by skill ref', () => {
    db = createDb();
    const store = new SkillEnablementStore(db);
    const ref = buildSkillRef('builtin', 'gcp-cli');
    store.set(ref, 'claude', true);
    store.set(ref, 'codex', false);
    store.set(buildSkillRef('builtin', 'aws-cli'), 'claude', true);

    const records = store.listBySkillRef(ref);
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.skillRef === ref)).toBe(true);
  });
});
