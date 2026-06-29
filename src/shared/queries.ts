/** @module queries — Shared SQL query fragments for session listing across SessionManager and DashboardDb */

// ---------------------------------------------------------------------------
// Column lists
// ---------------------------------------------------------------------------

/** Explicit column list used by DashboardDb (avoids `s.*` for clarity). */
const SESSION_LIST_COLUMNS = `s.session_key, s.tool, s.mode, s.workdir, s.running_job_id, s.updated_at,
       r.session_id, r.thread_key, r.user_id, r.started_at,
       CASE WHEN tc.active_session_key = s.session_key THEN 1 ELSE 0 END AS is_active`;

/** Column list using `s.*` (used by SessionManager which reads all session columns). */
const SESSION_LIST_COLUMNS_STAR = `s.*,
       r.session_id, r.thread_key, r.user_id, r.started_at,
       CASE WHEN tc.active_session_key = s.session_key THEN 1 ELSE 0 END AS is_active`;

// ---------------------------------------------------------------------------
// FROM / JOIN / ORDER clause
// ---------------------------------------------------------------------------

const SESSION_LIST_FROM = `FROM sessions s
  JOIN session_registry r ON r.session_key = s.session_key
  LEFT JOIN thread_contexts tc ON tc.thread_key = r.thread_key`;

const SESSION_LIST_ORDER = 'ORDER BY datetime(s.updated_at) DESC';

// ---------------------------------------------------------------------------
// Full queries
// ---------------------------------------------------------------------------

/** All sessions ordered by most-recent update. Uses explicit columns. */
export const SESSION_LIST_QUERY = `SELECT ${SESSION_LIST_COLUMNS} ${SESSION_LIST_FROM} ${SESSION_LIST_ORDER}`;

/** All sessions filtered by tool. Uses explicit columns. */
export const SESSION_LIST_BY_TOOL_QUERY = `SELECT ${SESSION_LIST_COLUMNS} ${SESSION_LIST_FROM} WHERE s.tool = ? ${SESSION_LIST_ORDER}`;

/** All sessions — `s.*` variant for SessionManager. */
export const SESSION_LIST_STAR_QUERY = `SELECT ${SESSION_LIST_COLUMNS_STAR} ${SESSION_LIST_FROM} ${SESSION_LIST_ORDER}`;

/** Sessions filtered by thread_key — `s.*` variant for SessionManager. */
export const SESSION_LIST_BY_THREAD_QUERY = `SELECT ${SESSION_LIST_COLUMNS_STAR}
  FROM session_registry r
  JOIN sessions s ON s.session_key = r.session_key
  LEFT JOIN thread_contexts tc ON tc.thread_key = r.thread_key
 WHERE r.thread_key = ?
 ${SESSION_LIST_ORDER}`;
