import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { AuditStore } from './audit.js';

let db: Database.Database | null = null;

function createStore(): AuditStore {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE audit (
      job_id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      mode TEXT NOT NULL,
      workdir TEXT NOT NULL,
      prompt_hash TEXT,
      source TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      exit_code INTEGER,
      error_kind TEXT
    );
    CREATE TABLE mode_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      from_mode TEXT NOT NULL,
      to_mode TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      expires_at TEXT
    );
  `);
  return new AuditStore(db);
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('AuditStore', () => {
  it('records job start with prompt hash', () => {
    const store = createStore();
    const prompt = 'summarize this thread';

    store.logJobStart({
      jobId: 'job-1',
      sessionKey: 'sess-1',
      userId: 'U1',
      tool: 'claude',
      mode: 'readonly',
      workdir: '/tmp/workdir',
      prompt,
    });

    const row = (db as NonNullable<typeof db>)
      .prepare('SELECT * FROM audit WHERE job_id = ?')
      .get('job-1') as
      | {
          session_key: string;
          prompt_hash: string;
          started_at: string;
        }
      | undefined;

    expect(row?.session_key).toBe('sess-1');
    expect(row?.prompt_hash).toBe(crypto.createHash('sha256').update(prompt).digest('hex'));
    expect(typeof row?.started_at).toBe('string');
  });

  it('records completion result for existing job', () => {
    const store = createStore();
    store.logJobStart({
      jobId: 'job-2',
      sessionKey: 'sess-2',
      userId: 'U2',
      tool: 'gemini',
      mode: 'write',
      workdir: '/tmp/workdir',
      prompt: 'do task',
    });

    store.logJobComplete('job-2', 42, 'exit_42');
    const row = (db as NonNullable<typeof db>)
      .prepare('SELECT ended_at, exit_code, error_kind FROM audit WHERE job_id = ?')
      .get('job-2') as
      | {
          ended_at: string;
          exit_code: number;
          error_kind: string;
        }
      | undefined;

    expect(typeof row?.ended_at).toBe('string');
    expect(row?.exit_code).toBe(42);
    expect(row?.error_kind).toBe('exit_42');
  });

  it('records mode change history', () => {
    const store = createStore();
    store.logModeChange({
      sessionKey: 'sess-3',
      userId: 'U3',
      fromMode: 'readonly',
      toMode: 'write',
      expiresAt: '2030-01-01T00:00:00.000Z',
    });

    const row = (db as NonNullable<typeof db>)
      .prepare(
        'SELECT session_key, user_id, from_mode, to_mode, expires_at FROM mode_changes ORDER BY id DESC LIMIT 1',
      )
      .get() as
      | {
          session_key: string;
          user_id: string;
          from_mode: string;
          to_mode: string;
          expires_at: string | null;
        }
      | undefined;

    expect(row).toEqual({
      session_key: 'sess-3',
      user_id: 'U3',
      from_mode: 'readonly',
      to_mode: 'write',
      expires_at: '2030-01-01T00:00:00.000Z',
    });
  });
});
