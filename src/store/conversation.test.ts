import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationStore } from './conversation.js';

describe('ConversationStore', () => {
  let db: Database.Database;
  let store: ConversationStore;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE sessions (
        session_key TEXT PRIMARY KEY,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE dashboard_messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key TEXT NOT NULL,
        role        TEXT NOT NULL,
        content     TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        job_id      TEXT
      );
    `);
    store = new ConversationStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('saves a user message', () => {
    db.prepare('INSERT INTO sessions (session_key, updated_at) VALUES (?, ?)').run(
      'sk_1',
      '2026-03-01T00:00:00.000Z',
    );
    store.saveMessage('sk_1', 'user', 'Hello');
    const rows = db.prepare('SELECT * FROM dashboard_messages').all() as {
      session_key: string;
      role: string;
      content: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.session_key).toBe('sk_1');
    expect(rows[0]?.role).toBe('user');
    expect(rows[0]?.content).toBe('Hello');
    const session = db
      .prepare('SELECT updated_at FROM sessions WHERE session_key = ?')
      .get('sk_1') as { updated_at: string };
    expect(session.updated_at).not.toBe('2026-03-01T00:00:00.000Z');
  });

  it('saves an assistant message', () => {
    db.prepare('INSERT INTO sessions (session_key, updated_at) VALUES (?, ?)').run(
      'sk_1',
      '2026-03-01T00:00:00.000Z',
    );
    store.saveMessage('sk_1', 'assistant', 'Hi there!');
    const rows = db.prepare('SELECT * FROM dashboard_messages').all() as {
      role: string;
      content: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe('assistant');
    expect(rows[0]?.content).toBe('Hi there!');
  });

  it('saves a message with jobId', () => {
    db.prepare('INSERT INTO sessions (session_key, updated_at) VALUES (?, ?)').run(
      'sk_1',
      '2026-03-01T00:00:00.000Z',
    );
    store.saveMessage('sk_1', 'user', 'Hello', 'job-abc');
    const rows = db.prepare('SELECT * FROM dashboard_messages').all() as {
      session_key: string;
      role: string;
      content: string;
      job_id: string | null;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.job_id).toBe('job-abc');
  });

  it('saves a message without jobId (null)', () => {
    db.prepare('INSERT INTO sessions (session_key, updated_at) VALUES (?, ?)').run(
      'sk_1',
      '2026-03-01T00:00:00.000Z',
    );
    store.saveMessage('sk_1', 'system', 'sys msg');
    const rows = db.prepare('SELECT * FROM dashboard_messages').all() as {
      job_id: string | null;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.job_id).toBeNull();
  });

  it('saves multiple messages across sessions', () => {
    db.prepare('INSERT INTO sessions (session_key, updated_at) VALUES (?, ?)').run(
      'sk_1',
      '2026-03-01T00:00:00.000Z',
    );
    db.prepare('INSERT INTO sessions (session_key, updated_at) VALUES (?, ?)').run(
      'sk_2',
      '2026-03-01T00:00:00.000Z',
    );
    store.saveMessage('sk_1', 'user', 'msg1');
    store.saveMessage('sk_2', 'user', 'msg2');
    store.saveMessage('sk_1', 'assistant', 'reply1');

    const sk1 = db
      .prepare('SELECT * FROM dashboard_messages WHERE session_key = ? ORDER BY id')
      .all('sk_1') as { role: string; content: string }[];
    expect(sk1).toHaveLength(2);
    expect(sk1[0]?.content).toBe('msg1');
    expect(sk1[1]?.content).toBe('reply1');

    const sk2 = db
      .prepare('SELECT * FROM dashboard_messages WHERE session_key = ?')
      .all('sk_2') as { content: string }[];
    expect(sk2).toHaveLength(1);
    expect(sk2[0]?.content).toBe('msg2');
  });
});
