/** @module session/manager — CRUD and lifecycle management for sessions, threads, and registries. */
import crypto from 'node:crypto';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { type Config, type ToolName, isToolName } from '../config.js';
import { SESSION_LIST_BY_THREAD_QUERY, SESSION_LIST_STAR_QUERY } from '../shared/queries.js';
import { safeParseToolState } from '../shared/tool-state.js';
import type { DevAlias } from '../store/dev-alias.js';
import { boolFromDb } from '../utils/db.js';
import { logger } from '../utils/logger.js';
import { type Mode, type Session, type ToolState, isMode } from './types.js';

interface SessionRow {
  session_key: string;
  tool: string;
  mode: string;
  mode_expires_at: string | null;
  tool_state: string;
  workdir: string;
  running_job_id: string | null;
  updated_at: string;
  dev_alias: string | null;
}

interface SessionRegistryRow {
  session_key: string;
  session_id: string;
  thread_key: string;
  user_id: string;
  started_at: string;
}

interface ThreadContextRow {
  thread_key: string;
  active_session_key: string | null;
  last_activity_at: string;
  updated_at: string;
}

interface SessionListRow extends SessionRow, SessionRegistryRow {
  is_active: number;
}

interface SessionDeleteRow {
  session_key: string;
  session_id: string | null;
  thread_key: string | null;
  tool: string;
  workdir: string;
}

export interface SessionSummary {
  sessionKey: string;
  sessionId: string;
  threadKey: string;
  userId: string;
  tool: ToolName;
  mode: Mode;
  modeExpiresAt: string | null;
  workdir: string;
  runningJobId: string | null;
  startedAt: string;
  updatedAt: string;
  active: boolean;
  devAlias: string | null;
}

export interface SessionDeletionSummary {
  sessionKey: string;
  sessionId: string | null;
  threadKey: string | null;
  tool: ToolName;
  workdir: string;
}

const SESSION_ID_LEN = 8;
const SESSION_KEY_HASH_LEN = 12;

function serializeToolStatePatch(patch: Partial<ToolState>): string {
  return JSON.stringify(patch, (_key, value) => (value === undefined ? null : value));
}

/** Provides transactional session CRUD, thread-context tracking, and registry operations backed by SQLite. */
export class SessionManager {
  private readonly stmts;

  constructor(
    private readonly db: Database.Database,
    private readonly config: Config,
  ) {
    this.stmts = {
      // ── Session CRUD ──
      insertSessionFull: db.prepare(
        `INSERT INTO sessions (session_key, tool, mode, mode_expires_at, tool_state, workdir, running_job_id, updated_at)
         VALUES (?, ?, ?, NULL, '{}', ?, NULL, ?)`,
      ),
      insertSessionWithAlias: db.prepare(
        `INSERT INTO sessions (session_key, tool, mode, mode_expires_at, tool_state, workdir, running_job_id, updated_at, dev_alias)
         VALUES (?, ?, ?, NULL, '{}', ?, NULL, ?, ?)`,
      ),
      getSession: db.prepare('SELECT * FROM sessions WHERE session_key = ?'),
      getSessionByAlias: db.prepare('SELECT * FROM sessions WHERE dev_alias = ? LIMIT 1'),
      deleteSession: db.prepare('DELETE FROM sessions WHERE session_key = ?'),
      deleteAllSessions: db.prepare('DELETE FROM sessions'),

      // ── Session updates ──
      updateTool: db.prepare(
        "UPDATE sessions SET tool = ?, tool_state = '{}', updated_at = ? WHERE session_key = ?",
      ),
      updateMode: db.prepare(
        'UPDATE sessions SET mode = ?, mode_expires_at = ?, updated_at = ? WHERE session_key = ?',
      ),
      updateToolState: db.prepare(
        'UPDATE sessions SET tool_state = ?, updated_at = ? WHERE session_key = ?',
      ),
      // Atomic merge via SQLite json_patch — eliminates read-modify-write race
      mergeToolState: db.prepare(
        'UPDATE sessions SET tool_state = json_patch(tool_state, ?), updated_at = ? WHERE session_key = ?',
      ),
      updateRunningJob: db.prepare(
        'UPDATE sessions SET running_job_id = ?, updated_at = ? WHERE session_key = ?',
      ),
      updateWorkdir: db.prepare(
        'UPDATE sessions SET workdir = ?, updated_at = ? WHERE session_key = ?',
      ),
      // ── Registry ──
      checkSessionId: db.prepare('SELECT 1 FROM session_registry WHERE session_id = ?'),
      checkSessionKey: db.prepare('SELECT 1 FROM sessions WHERE session_key = ?'),
      getRegistryByKey: db.prepare('SELECT session_id FROM session_registry WHERE session_key = ?'),
      insertRegistry: db.prepare(
        `INSERT INTO session_registry (session_key, session_id, thread_key, user_id, started_at)
         VALUES (?, ?, ?, ?, ?)`,
      ),
      deleteRegistry: db.prepare('DELETE FROM session_registry WHERE session_key = ?'),
      deleteAllRegistry: db.prepare('DELETE FROM session_registry'),

      // ── Thread contexts ──
      insertThreadContext: db.prepare(
        `INSERT INTO thread_contexts (thread_key, active_session_key, last_activity_at, updated_at)
         VALUES (?, NULL, ?, ?)
         ON CONFLICT(thread_key) DO NOTHING`,
      ),
      insertThreadContextFull: db.prepare(
        `INSERT INTO thread_contexts (thread_key, active_session_key, last_activity_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      ),
      getThreadContext: db.prepare('SELECT * FROM thread_contexts WHERE thread_key = ?'),
      getActiveSessionKey: db.prepare(
        'SELECT active_session_key FROM thread_contexts WHERE thread_key = ?',
      ),
      updateThreadActivity: db.prepare(
        'UPDATE thread_contexts SET last_activity_at = ?, updated_at = ? WHERE thread_key = ?',
      ),
      touchActiveSessionByThread: db.prepare(
        `UPDATE sessions
            SET updated_at = ?
          WHERE session_key = (
            SELECT active_session_key
              FROM thread_contexts
             WHERE thread_key = ?
          )`,
      ),
      updateActiveSession: db.prepare(
        'UPDATE thread_contexts SET active_session_key = ?, updated_at = ? WHERE thread_key = ?',
      ),
      clearActiveBySession: db.prepare(
        'UPDATE thread_contexts SET active_session_key = NULL, updated_at = ? WHERE active_session_key = ?',
      ),
      deleteAllThreadContexts: db.prepare('DELETE FROM thread_contexts'),

      // ── Dashboard messages ──
      deleteDashMessages: db.prepare('DELETE FROM dashboard_messages WHERE session_key = ?'),
      deleteAllDashMessages: db.prepare('DELETE FROM dashboard_messages'),
      deleteSessionMcpServers: db.prepare('DELETE FROM session_mcp_servers WHERE session_key = ?'),
      deleteAllSessionMcpServers: db.prepare('DELETE FROM session_mcp_servers'),

      // ── Session summary queries ──
      sessionSummary: db.prepare(
        `SELECT s.*,
                r.session_id,
                r.thread_key,
                r.user_id,
                r.started_at,
                CASE WHEN tc.active_session_key = s.session_key THEN 1 ELSE 0 END AS is_active
           FROM sessions s
           JOIN session_registry r ON r.session_key = s.session_key
           LEFT JOIN thread_contexts tc ON tc.thread_key = r.thread_key
          WHERE s.session_key = ?`,
      ),
      sessionSummaryById: db.prepare(
        `SELECT s.*,
                r.session_id,
                r.thread_key,
                r.user_id,
                r.started_at,
                CASE WHEN tc.active_session_key = s.session_key THEN 1 ELSE 0 END AS is_active
           FROM sessions s
           JOIN session_registry r ON r.session_key = s.session_key
           LEFT JOIN thread_contexts tc ON tc.thread_key = r.thread_key
          WHERE r.session_id = ?`,
      ),
      sessionsByThread: db.prepare(SESSION_LIST_BY_THREAD_QUERY),
      sessionsByThreadAndUser: db.prepare(
        `SELECT s.*,
                r.session_id,
                r.thread_key,
                r.user_id,
                r.started_at,
                CASE WHEN tc.active_session_key = s.session_key THEN 1 ELSE 0 END AS is_active
           FROM session_registry r
           JOIN sessions s ON s.session_key = r.session_key
           LEFT JOIN thread_contexts tc ON tc.thread_key = r.thread_key
          WHERE r.thread_key = ? AND r.user_id = ?
          ORDER BY datetime(s.updated_at) DESC, r.rowid DESC`,
      ),
      allSessions: db.prepare(SESSION_LIST_STAR_QUERY),

      // ── Delete helpers ──
      deleteRowById: db.prepare(
        `SELECT s.session_key, r.session_id, r.thread_key, s.tool, s.workdir
           FROM session_registry r
           JOIN sessions s ON s.session_key = r.session_key
          WHERE r.session_id = ?`,
      ),
      deleteCleanupById: db.prepare(
        `SELECT s.session_key, r.thread_key, s.workdir
           FROM session_registry r
           JOIN sessions s ON s.session_key = r.session_key
          WHERE r.session_id = ?`,
      ),
      deleteCleanupByKey: db.prepare(
        `SELECT r.thread_key
           FROM session_registry r
          WHERE r.session_key = ?`,
      ),
      allDeleteRows: db.prepare(
        `SELECT s.session_key,
                r.session_id,
                r.thread_key,
                s.tool,
                s.workdir
           FROM sessions s
           LEFT JOIN session_registry r ON r.session_key = s.session_key`,
      ),
      allCleanupRows: db.prepare(
        `SELECT s.session_key, r.thread_key, s.workdir
           FROM sessions s
           LEFT JOIN session_registry r ON r.session_key = s.session_key`,
      ),

      // ── Active session lookups (single-query, avoids N+1) ──
      activeSessionByThread: db.prepare(
        `SELECT s.*
           FROM thread_contexts tc
           JOIN sessions s ON s.session_key = tc.active_session_key
          WHERE tc.thread_key = ?`,
      ),
      activeSessionSummaryByThread: db.prepare(
        `SELECT s.*,
                r.session_id,
                r.thread_key,
                r.user_id,
                r.started_at,
                1 AS is_active
           FROM thread_contexts tc
           JOIN sessions s ON s.session_key = tc.active_session_key
           JOIN session_registry r ON r.session_key = s.session_key
          WHERE tc.thread_key = ?`,
      ),

      // ── Find by thread + tool ──
      sessionByIdForThread: db.prepare(
        `SELECT s.*
           FROM session_registry r
           JOIN sessions s ON s.session_key = r.session_key
          WHERE r.thread_key = ? AND r.session_id = ?`,
      ),
      sessionByIdForThreadAndUser: db.prepare(
        `SELECT s.*
           FROM session_registry r
           JOIN sessions s ON s.session_key = r.session_key
          WHERE r.thread_key = ? AND r.user_id = ? AND r.session_id = ?`,
      ),
      summaryByIdForThreadAndUser: db.prepare(
        `SELECT s.*,
                r.session_id,
                r.thread_key,
                r.user_id,
                r.started_at,
                CASE WHEN tc.active_session_key = s.session_key THEN 1 ELSE 0 END AS is_active
           FROM session_registry r
           JOIN sessions s ON s.session_key = r.session_key
           LEFT JOIN thread_contexts tc ON tc.thread_key = r.thread_key
          WHERE r.thread_key = ? AND r.user_id = ? AND r.session_id = ?`,
      ),
      latestByTool: db.prepare(
        `SELECT s.*
           FROM session_registry r
           JOIN sessions s ON s.session_key = r.session_key
          WHERE r.thread_key = ? AND s.tool = ?
          ORDER BY datetime(s.updated_at) DESC, r.rowid DESC
          LIMIT 1`,
      ),
      latestByToolAndUser: db.prepare(
        `SELECT s.*
           FROM session_registry r
           JOIN sessions s ON s.session_key = r.session_key
          WHERE r.thread_key = ? AND r.user_id = ? AND s.tool = ?
          ORDER BY datetime(s.updated_at) DESC, r.rowid DESC
          LIMIT 1`,
      ),
    };
  }

  private static safeParseToolState(raw: string): ToolState {
    return safeParseToolState(raw, (code, data) => logger.warn(code, data));
  }

  private static assertToolName(value: string): ToolName {
    if (isToolName(value)) return value;
    logger.warn('invalid_tool_name_in_db', { value });
    return 'claude'; // safe default
  }

  private static assertMode(value: string): Mode {
    if (isMode(value)) return value;
    logger.warn('invalid_mode_in_db', { value });
    return 'write'; // safe default
  }

  private rowToSession(row: SessionRow): Session {
    return {
      sessionKey: row.session_key,
      tool: SessionManager.assertToolName(row.tool),
      mode: SessionManager.assertMode(row.mode),
      modeExpiresAt: row.mode_expires_at,
      toolState: SessionManager.safeParseToolState(row.tool_state),
      workdir: row.workdir,
      runningJobId: row.running_job_id,
      updatedAt: row.updated_at,
      devAlias: row.dev_alias ?? null,
    };
  }

  private listRowToSummary(row: SessionListRow): SessionSummary {
    return {
      sessionKey: row.session_key,
      sessionId: row.session_id,
      threadKey: row.thread_key,
      userId: row.user_id,
      tool: SessionManager.assertToolName(row.tool),
      mode: SessionManager.assertMode(row.mode),
      modeExpiresAt: row.mode_expires_at,
      workdir: row.workdir,
      runningJobId: row.running_job_id,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      active: boolFromDb(row.is_active),
      devAlias: row.dev_alias ?? null,
    };
  }

  private deleteRowToSummary(row: SessionDeleteRow): SessionDeletionSummary {
    return {
      sessionKey: row.session_key,
      sessionId: row.session_id,
      threadKey: row.thread_key,
      tool: SessionManager.assertToolName(row.tool),
      workdir: row.workdir,
    };
  }

  private getSessionIdWorkdir(sessionId: string): string {
    return path.join(this.config.workdirRoot, sessionId);
  }

  private generateSessionId(): string {
    return crypto.randomUUID().replaceAll('-', '').slice(0, SESSION_ID_LEN);
  }

  private generateSessionKey(): string {
    return `sess_${crypto.randomUUID().replaceAll('-', '').slice(0, SESSION_KEY_HASH_LEN)}`;
  }

  private allocateUniqueSessionId(): string {
    for (let i = 0; i < 16; i++) {
      const candidate = this.generateSessionId();
      const exists = this.stmts.checkSessionId.get(candidate);
      if (!exists) return candidate;
    }
    throw new Error('Failed to allocate unique session id');
  }

  private allocateUniqueSessionKey(): string {
    for (let i = 0; i < 16; i++) {
      const candidate = this.generateSessionKey();
      const exists = this.stmts.checkSessionKey.get(candidate);
      if (!exists) return candidate;
    }
    throw new Error('Failed to allocate unique session key');
  }

  private ensureThreadContextRow(threadKey: string): void {
    const now = new Date().toISOString();
    this.stmts.insertThreadContext.run(threadKey, now, now);
  }

  /**
   * Resolve the initial mode for a new session based on tool-specific config.
   *
   * Each driver has its own default-mode env var:
   * - Claude:  CLAUDE_DEFAULT_MODE  (default: 'write')
   * - Codex:   CODEX_DEFAULT_SANDBOX_MODE (default: 'write')
   * - Gemini:  GEMINI_DEFAULT_MODE  (default: 'write')
   */
  resolveInitialMode(tool: ToolName): Mode {
    switch (tool) {
      case 'claude':
        return this.config.claudeDefaultMode;
      case 'codex':
        return this.config.codexDefaultSandboxMode;
      case 'gemini':
        return this.config.geminiDefaultMode;
      default:
        return 'write';
    }
  }

  get(sessionKey: string): Session | null {
    const row = this.stmts.getSession.get(sessionKey) as SessionRow | undefined;
    return row ? this.rowToSession(row) : null;
  }

  getSessionSummary(sessionKey: string): SessionSummary | null {
    const row = this.stmts.sessionSummary.get(sessionKey) as SessionListRow | undefined;
    return row ? this.listRowToSummary(row) : null;
  }

  getSessionSummaryById(sessionId: string): SessionSummary | null {
    const row = this.stmts.sessionSummaryById.get(sessionId) as SessionListRow | undefined;
    return row ? this.listRowToSummary(row) : null;
  }

  getSessionId(sessionKey: string): string | null {
    const row = this.stmts.getRegistryByKey.get(sessionKey) as { session_id: string } | undefined;
    return row?.session_id ?? null;
  }

  deleteSessionById(sessionId: string): SessionDeletionSummary | null {
    const row = this.stmts.deleteRowById.get(sessionId) as SessionDeleteRow | undefined;
    if (!row) return null;
    this._deleteSessionByKey(row.session_key);
    return this.deleteRowToSummary(row);
  }

  /** Delete multiple sessions atomically in a single transaction. */
  deleteSessionsByIds(sessionIds: string[]): SessionDeletionSummary[] {
    const tx = this.db.transaction(() => {
      const results: SessionDeletionSummary[] = [];
      for (const sessionId of sessionIds) {
        const row = this.stmts.deleteRowById.get(sessionId) as SessionDeleteRow | undefined;
        if (!row) continue;
        this._deleteSessionByKeyInner(row.session_key);
        results.push(this.deleteRowToSummary(row));
      }
      return results;
    });
    return tx();
  }

  clearAllSessions(): SessionDeletionSummary[] {
    const rows = this.stmts.allDeleteRows.all() as SessionDeleteRow[];
    this._clearAllSessions();
    return rows.map((row) => this.deleteRowToSummary(row));
  }

  createSessionForThread(threadKey: string, userId: string, tool: ToolName): Session {
    const now = new Date().toISOString();
    const sessionId = this.allocateUniqueSessionId();
    const sessionKey = this.allocateUniqueSessionKey();
    const workdir = this.getSessionIdWorkdir(sessionId);
    const initialMode = this.resolveInitialMode(tool);
    const tx = this.db.transaction(() => {
      this.stmts.insertSessionFull.run(sessionKey, tool, initialMode, workdir, now);
      this.stmts.insertRegistry.run(sessionKey, sessionId, threadKey, userId, now);
      this.setActiveSessionKey(threadKey, sessionKey);
    });
    tx();
    // Session was just inserted by insertSessionFull above — get() should not return null here.
    const created = this.get(sessionKey);
    if (!created) {
      throw new Error(`Failed to load newly created session: ${sessionKey}`);
    }
    return created;
  }

  listSessionsForThread(threadKey: string): SessionSummary[] {
    const rows = this.stmts.sessionsByThread.all(threadKey) as SessionListRow[];
    return rows.map((row) => this.listRowToSummary(row));
  }

  listSessionsForThreadOwned(threadKey: string, userId: string): SessionSummary[] {
    const rows = this.stmts.sessionsByThreadAndUser.all(threadKey, userId) as SessionListRow[];
    return rows.map((row) => this.listRowToSummary(row));
  }

  listAllSessions(): SessionSummary[] {
    const rows = this.stmts.allSessions.all() as SessionListRow[];
    return rows.map((row) => this.listRowToSummary(row));
  }

  getSessionByIdForThread(threadKey: string, sessionId: string): Session | null {
    const row = this.stmts.sessionByIdForThread.get(threadKey, sessionId) as SessionRow | undefined;
    return row ? this.rowToSession(row) : null;
  }

  getSessionByIdForThreadOwned(
    threadKey: string,
    userId: string,
    sessionId: string,
  ): Session | null {
    const row = this.stmts.sessionByIdForThreadAndUser.get(threadKey, userId, sessionId) as
      | SessionRow
      | undefined;
    return row ? this.rowToSession(row) : null;
  }

  getSessionSummaryByIdForThreadOwned(
    threadKey: string,
    userId: string,
    sessionId: string,
  ): SessionSummary | null {
    const row = this.stmts.summaryByIdForThreadAndUser.get(threadKey, userId, sessionId) as
      | SessionListRow
      | undefined;
    return row ? this.listRowToSummary(row) : null;
  }

  findLatestSessionByTool(threadKey: string, tool: ToolName): Session | null {
    const row = this.stmts.latestByTool.get(threadKey, tool) as SessionRow | undefined;
    return row ? this.rowToSession(row) : null;
  }

  findLatestSessionByToolOwned(threadKey: string, userId: string, tool: ToolName): Session | null {
    const row = this.stmts.latestByToolAndUser.get(threadKey, userId, tool) as
      | SessionRow
      | undefined;
    return row ? this.rowToSession(row) : null;
  }

  getThreadContext(threadKey: string): ThreadContextRow | null {
    const row = this.stmts.getThreadContext.get(threadKey) as ThreadContextRow | undefined;
    return row ?? null;
  }

  touchThreadActivity(threadKey: string): void {
    this.ensureThreadContextRow(threadKey);
    const now = new Date().toISOString();
    this.stmts.updateThreadActivity.run(now, now, threadKey);
    this.stmts.touchActiveSessionByThread.run(now, threadKey);
  }

  getActiveSessionKey(threadKey: string): string | null {
    const row = this.stmts.getActiveSessionKey.get(threadKey) as
      | { active_session_key: string | null }
      | undefined;
    return row?.active_session_key ?? null;
  }

  getActiveSession(threadKey: string): Session | null {
    const row = this.stmts.activeSessionByThread.get(threadKey) as SessionRow | undefined;
    return row ? this.rowToSession(row) : null;
  }

  getActiveSessionSummary(threadKey: string): SessionSummary | null {
    const row = this.stmts.activeSessionSummaryByThread.get(threadKey) as
      | SessionListRow
      | undefined;
    return row ? this.listRowToSummary(row) : null;
  }

  /**
   * Fetch the active session for a thread with ownership info in a single JOIN query.
   * Returns the full Session (including toolState) plus the userId from the registry.
   * Used by handler-context to avoid the 3-query pattern
   * (getActiveSessionKey → get → getSessionSummary).
   */
  getActiveSessionForThread(
    threadKey: string,
  ): { sessionKey: string; session: Session; userId: string } | null {
    const row = this.stmts.activeSessionSummaryByThread.get(threadKey) as
      | SessionListRow
      | undefined;
    if (!row) return null;
    return {
      sessionKey: row.session_key,
      session: this.rowToSession(row),
      userId: row.user_id,
    };
  }

  setActiveSessionKey(threadKey: string, sessionKey: string | null): void {
    this.ensureThreadContextRow(threadKey);
    const now = new Date().toISOString();
    this.stmts.updateActiveSession.run(sessionKey, now, threadKey);
  }

  clearActiveSession(threadKey: string): void {
    this.setActiveSessionKey(threadKey, null);
  }

  updateTool(sessionKey: string, tool: ToolName): void {
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.stmts.updateTool.run(tool, now, sessionKey);
      // Clear session MCP server overrides — old tool's server IDs are invalid for the new tool
      this.stmts.deleteSessionMcpServers.run(sessionKey);
    });
    tx();
  }

  updateMode(sessionKey: string, mode: Mode, expiresAt: string | null): void {
    this.stmts.updateMode.run(mode, expiresAt, new Date().toISOString(), sessionKey);
  }

  updateToolState(sessionKey: string, toolState: ToolState): void {
    this.stmts.updateToolState.run(JSON.stringify(toolState), new Date().toISOString(), sessionKey);
  }

  /**
   * Atomically merge partial fields into the existing toolState using SQLite json_patch.
   * `undefined` values are serialized as `null` so RFC 7396 merge-patch semantics delete keys.
   * Eliminates the read-modify-write race condition when concurrent jobs update toolState.
   */
  mergeToolState(sessionKey: string, patch: Partial<ToolState>): void {
    this.stmts.mergeToolState.run(
      serializeToolStatePatch(patch),
      new Date().toISOString(),
      sessionKey,
    );
  }

  setRunningJob(sessionKey: string, jobId: string | null): void {
    this.stmts.updateRunningJob.run(jobId, new Date().toISOString(), sessionKey);
  }

  updateWorkdir(sessionKey: string, workdir: string): void {
    this.stmts.updateWorkdir.run(workdir, new Date().toISOString(), sessionKey);
  }

  reset(sessionKey: string): void {
    this._deleteSessionByKey(sessionKey);
    logger.info('session_reset', { session_key: sessionKey });
  }

  /**
   * Create a standalone session for dashboard-originated chats (no real Slack thread).
   *
   * @param modeOverride - When provided, overrides the tool's default mode.
   *   Used by the dashboard UI to let users pick readonly/write at session creation.
   */
  createStandaloneSession(
    tool: ToolName,
    userId = 'dashboard',
    modeOverride?: Mode,
  ): SessionSummary {
    const now = new Date().toISOString();
    const sessionId = this.allocateUniqueSessionId();
    const sessionKey = this.allocateUniqueSessionKey();
    const threadKey = `dashboard_${sessionId}`;
    const workdir = this.getSessionIdWorkdir(sessionId);
    const initialMode = modeOverride ?? this.resolveInitialMode(tool);

    const tx = this.db.transaction(() => {
      this.stmts.insertSessionFull.run(sessionKey, tool, initialMode, workdir, now);
      this.stmts.insertRegistry.run(sessionKey, sessionId, threadKey, userId, now);
      this.stmts.insertThreadContextFull.run(threadKey, sessionKey, now, now);
    });
    tx();

    return {
      sessionKey,
      sessionId,
      threadKey,
      userId,
      tool,
      mode: initialMode,
      modeExpiresAt: null,
      workdir,
      runningJobId: null,
      startedAt: now,
      updatedAt: now,
      active: true,
      devAlias: null,
    };
  }

  createDevSession(threadKey: string, userId: string, alias: DevAlias): Session {
    const now = new Date().toISOString();
    const sessionId = this.allocateUniqueSessionId();
    const sessionKey = this.allocateUniqueSessionKey();
    const initialMode = this.resolveInitialMode(alias.tool);

    const tx = this.db.transaction(() => {
      this.stmts.insertSessionWithAlias.run(
        sessionKey,
        alias.tool,
        initialMode,
        alias.path,
        now,
        alias.name,
      );
      this.stmts.insertRegistry.run(sessionKey, sessionId, threadKey, userId, now);
      this.setActiveSessionKey(threadKey, sessionKey);
    });
    tx();

    return {
      sessionKey,
      tool: alias.tool,
      mode: initialMode,
      modeExpiresAt: null,
      toolState: {},
      workdir: alias.path,
      runningJobId: null,
      updatedAt: now,
      devAlias: alias.name,
    };
  }

  findDevSession(devAliasName: string): Session | null {
    const row = this.stmts.getSessionByAlias.get(devAliasName) as SessionRow | undefined;
    return row ? this.rowToSession(row) : null;
  }

  /**
   * Delete session by ID and clean up all related DB rows.
   * Returns sessionKey, threadKey, and workdir for in-memory + filesystem cleanup by caller.
   */
  deleteSessionByIdWithCleanup(
    sessionId: string,
  ): { sessionKey: string; threadKey: string; workdir: string | null } | null {
    const row = this.stmts.deleteCleanupById.get(sessionId) as
      | { session_key: string; thread_key: string; workdir: string | null }
      | undefined;
    if (!row) return null;
    this._deleteSessionByKey(row.session_key);
    return { sessionKey: row.session_key, threadKey: row.thread_key, workdir: row.workdir ?? null };
  }

  /**
   * Delete session by sessionKey and clean up all related DB rows.
   * Returns threadKey for in-memory cleanup by caller.
   */
  deleteSessionByKeyWithCleanup(sessionKey: string): { threadKey: string } | null {
    const row = this.stmts.deleteCleanupByKey.get(sessionKey) as { thread_key: string } | undefined;
    if (!row) return null;
    this._deleteSessionByKey(sessionKey);
    return { threadKey: row.thread_key };
  }

  /**
   * Clear all sessions and return list of deleted sessionKey/threadKey/workdir tuples
   * for in-memory + filesystem cleanup by caller.
   */
  clearAllSessionsWithCleanup(): {
    sessionKey: string;
    threadKey: string | null;
    workdir: string | null;
  }[] {
    const rows = this.stmts.allCleanupRows.all() as {
      session_key: string;
      thread_key: string | null;
      workdir: string | null;
    }[];
    this._clearAllSessions();
    return rows.map((r) => ({
      sessionKey: r.session_key,
      threadKey: r.thread_key,
      workdir: r.workdir ?? null,
    }));
  }

  /* ── private shared transaction helpers (Phase 4.1) ── */

  /** Delete a single session's DB rows. Must be called inside an active transaction or wrapped by _deleteSessionByKey. */
  private _deleteSessionByKeyInner(sessionKey: string): void {
    const now = new Date().toISOString();
    this.stmts.clearActiveBySession.run(now, sessionKey);
    this.stmts.deleteDashMessages.run(sessionKey);
    this.stmts.deleteSessionMcpServers.run(sessionKey);
    this.stmts.deleteSession.run(sessionKey);
    this.stmts.deleteRegistry.run(sessionKey);
  }

  private _deleteSessionByKey(sessionKey: string): void {
    const tx = this.db.transaction(() => {
      this._deleteSessionByKeyInner(sessionKey);
    });
    tx();
  }

  private _clearAllSessions(): void {
    const tx = this.db.transaction(() => {
      this.stmts.deleteAllDashMessages.run();
      this.stmts.deleteAllSessionMcpServers.run();
      this.stmts.deleteAllSessions.run();
      this.stmts.deleteAllRegistry.run();
      this.stmts.deleteAllThreadContexts.run();
    });
    tx();
  }
}
