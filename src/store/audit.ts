/** @module audit — Immutable audit trail for job executions and mode changes. */
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

export interface AuditEntry {
  jobId: string;
  sessionKey: string;
  userId: string;
  tool: string;
  mode: string;
  workdir: string;
  prompt: string;
  /** Job source (e.g. 'slack', 'dashboard', 'schedule', 'orchestrator'). */
  source?: string;
  /** When true, MCP tool calls were auto-approved without user confirmation. */
  autoApprove?: boolean;
}

export interface ModeChangeEntry {
  sessionKey: string;
  userId: string;
  fromMode: string;
  toMode: string;
  expiresAt: string | null;
}

/** Write-only store for job start/complete events and mode-change history. */
export class AuditStore {
  private readonly stmts: {
    insertJob: Database.Statement;
    updateJob: Database.Statement;
    insertModeChange: Database.Statement;
  };

  constructor(db: Database.Database) {
    this.stmts = {
      insertJob: db.prepare(
        `INSERT INTO audit (job_id, session_key, user_id, tool, mode, workdir, prompt_hash, source, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      updateJob: db.prepare(
        'UPDATE audit SET ended_at = ?, exit_code = ?, error_kind = ? WHERE job_id = ?',
      ),
      insertModeChange: db.prepare(
        `INSERT INTO mode_changes (session_key, user_id, from_mode, to_mode, changed_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ),
    };
  }

  logJobStart(entry: AuditEntry): void {
    const promptHash = crypto.createHash('sha256').update(entry.prompt).digest('hex');
    this.stmts.insertJob.run(
      entry.jobId,
      entry.sessionKey,
      entry.userId,
      entry.tool,
      entry.mode,
      entry.workdir,
      promptHash,
      entry.source ?? null,
      new Date().toISOString(),
    );
  }

  logJobComplete(jobId: string, exitCode: number | null, errorKind: string | null): void {
    this.stmts.updateJob.run(new Date().toISOString(), exitCode, errorKind, jobId);
  }

  logModeChange(entry: ModeChangeEntry): void {
    this.stmts.insertModeChange.run(
      entry.sessionKey,
      entry.userId,
      entry.fromMode,
      entry.toMode,
      new Date().toISOString(),
      entry.expiresAt,
    );
  }
}
