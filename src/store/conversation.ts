/** @module conversation — Persistence for dashboard chat messages. */
import type Database from 'better-sqlite3';

/** Append-only store for user/assistant/system messages per session. */
export class ConversationStore {
  private readonly insertStmt: Database.Statement;
  private readonly touchSessionStmt: Database.Statement;
  private readonly saveMessageTxn: Database.Transaction<
    (sessionKey: string, role: string, content: string, now: string, jobId: string | null) => void
  >;

  constructor(db: Database.Database) {
    this.insertStmt = db.prepare(
      'INSERT INTO dashboard_messages (session_key, role, content, created_at, job_id) VALUES (?, ?, ?, ?, ?)',
    );
    this.touchSessionStmt = db.prepare('UPDATE sessions SET updated_at = ? WHERE session_key = ?');
    this.saveMessageTxn = db.transaction(
      (sessionKey: string, role: string, content: string, now: string, jobId: string | null) => {
        this.insertStmt.run(sessionKey, role, content, now, jobId);
        this.touchSessionStmt.run(now, sessionKey);
      },
    );
  }

  saveMessage(
    sessionKey: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    jobId?: string,
  ): void {
    const now = new Date().toISOString();
    this.saveMessageTxn(sessionKey, role, content, now, jobId ?? null);
  }
}
