/** @module dedupe — TTL-based event deduplication to prevent double-processing. */
import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

const TTL_HOURS = 24;

/** Idempotency guard backed by a dedupe table with automatic TTL expiry. */
export class DedupeStore {
  private readonly stmts: {
    check: Database.Statement;
    insert: Database.Statement;
    cleanup: Database.Statement;
  };

  constructor(db: Database.Database) {
    this.stmts = {
      check: db.prepare('SELECT 1 FROM dedupe WHERE event_id = ?'),
      insert: db.prepare(
        'INSERT OR IGNORE INTO dedupe (event_id, received_at, ttl_expires_at) VALUES (?, ?, ?)',
      ),
      cleanup: db.prepare('DELETE FROM dedupe WHERE ttl_expires_at < ?'),
    };
  }

  isDuplicate(eventId: string): boolean {
    return this.stmts.check.get(eventId) !== undefined;
  }

  isDuplicateAndRegister(eventId: string): boolean {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL_HOURS * 60 * 60 * 1000);
    const result = this.stmts.insert.run(eventId, now.toISOString(), expiresAt.toISOString());
    return result.changes === 0;
  }

  register(eventId: string): void {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL_HOURS * 60 * 60 * 1000);
    this.stmts.insert.run(eventId, now.toISOString(), expiresAt.toISOString());
  }

  cleanup(): number {
    const result = this.stmts.cleanup.run(new Date().toISOString());
    if (result.changes > 0) {
      logger.info('dedupe_cleanup', { removed: result.changes });
    }
    return result.changes;
  }
}
