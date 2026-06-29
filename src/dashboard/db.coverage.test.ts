/**
 * Extended coverage tests for DashboardDb.
 * Covers: MCP servers, error analysis, session trace, job messages,
 * task summary stats, scheduled tasks, on-demand tasks, orchestrator queries.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardDb } from './db.js';

let tmpDir: string;
let dbPath: string;
let dashDb: DashboardDb;

function rawDb(): Database.Database {
  return new Database(dbPath);
}

function insertAuditRow(
  db: Database.Database,
  opts: {
    jobId: string;
    sessionKey: string;
    userId?: string;
    tool?: string;
    mode?: string;
    workdir?: string;
    promptHash?: string | null;
    source?: string | null;
    startedAt: string;
    endedAt?: string | null;
    exitCode?: number | null;
    errorKind?: string | null;
  },
) {
  db.prepare(
    `INSERT INTO audit (job_id, session_key, user_id, tool, mode, workdir, prompt_hash, source, started_at, ended_at, exit_code, error_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.jobId,
    opts.sessionKey,
    opts.userId ?? 'U1',
    opts.tool ?? 'claude',
    opts.mode ?? 'write',
    opts.workdir ?? '/tmp/w',
    opts.promptHash ?? null,
    opts.source ?? 'slack',
    opts.startedAt,
    opts.endedAt ?? null,
    opts.exitCode ?? null,
    opts.errorKind ?? null,
  );
}

function insertSession(
  db: Database.Database,
  opts: {
    sessionKey: string;
    sessionId: string;
    tool?: string;
    mode?: string;
    workdir?: string;
    threadKey?: string;
    toolState?: string;
  },
) {
  db.prepare(
    `INSERT OR IGNORE INTO sessions (session_key, tool, mode, tool_state, workdir, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    opts.sessionKey,
    opts.tool ?? 'claude',
    opts.mode ?? 'write',
    opts.toolState ?? '{}',
    opts.workdir ?? '/tmp/w',
  );
  db.prepare(
    `INSERT OR IGNORE INTO session_registry (session_key, session_id, thread_key, user_id, started_at)
     VALUES (?, ?, ?, 'U1', datetime('now'))`,
  ).run(opts.sessionKey, opts.sessionId, opts.threadKey ?? 'C01:ts1');
}

function insertMessage(
  db: Database.Database,
  sessionKey: string,
  role: string,
  content: string,
  createdAt: string,
  jobId?: string,
) {
  db.prepare(
    'INSERT INTO dashboard_messages (session_key, role, content, created_at, job_id) VALUES (?, ?, ?, ?, ?)',
  ).run(sessionKey, role, content, createdAt, jobId ?? null);
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'dashdb-cov-'));
  dbPath = join(tmpDir, 'test.db');
  dashDb = new DashboardDb(dbPath);
});

afterEach(() => {
  dashDb.close();
  rmSync(tmpDir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('DashboardDb — MCP server methods', () => {
  it('listMcpServers with no tool returns all', () => {
    const all = dashDb.listMcpServers();
    expect(Array.isArray(all)).toBe(true);
  });

  it('listMcpServers with tool filter returns filtered', () => {
    const servers = dashDb.listMcpServers('claude');
    expect(Array.isArray(servers)).toBe(true);
  });

  it('getMcpServerById returns null for missing id', () => {
    expect(dashDb.getMcpServerById('nonexistent')).toBeNull();
  });

  it('getMcpServerByName returns null for missing name', () => {
    expect(dashDb.getMcpServerByName('nonexistent', 'claude')).toBeNull();
  });

  it('CRUD flow for MCP server', () => {
    const created = dashDb.createMcpServer({
      name: 'test-server',
      tool: 'claude',
      transport: 'stdio',
      definition: { command: 'echo' },
    });
    expect(created.name).toBe('test-server');
    expect(created.tool).toBe('claude');

    const byId = dashDb.getMcpServerById(created.id);
    expect(byId).not.toBeNull();
    expect(byId?.name).toBe('test-server');

    const byName = dashDb.getMcpServerByName('test-server', 'claude');
    expect(byName).not.toBeNull();

    const updated = dashDb.updateMcpServer(created.id, {
      transport: 'stdio',
      definition: { command: 'cat' },
    });
    expect(updated).not.toBeNull();
    expect(updated?.definition).toEqual({ command: 'cat' });

    expect(
      dashDb.updateMcpServer('nonexistent', { transport: 'stdio', definition: {} }),
    ).toBeNull();

    const deleted = dashDb.deleteMcpServer(created.id);
    expect(deleted).toBe(true);
    expect(dashDb.deleteMcpServer(created.id)).toBe(false);
  });

  it('replaceMcpServersForTool replaces all for tool', () => {
    dashDb.createMcpServer({
      name: 'old-server',
      tool: 'claude',
      transport: 'stdio',
      definition: { command: 'old' },
    });
    const replaced = dashDb.replaceMcpServersForTool('claude', [
      { name: 'new-server', transport: 'stdio', definition: { command: 'new' } },
    ]);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.name).toBe('new-server');
    expect(dashDb.listMcpServers('claude').length).toBe(1);
  });
});

describe('DashboardDb — getSessionMcpServers', () => {
  it('returns null for unknown session', () => {
    expect(dashDb.getSessionMcpServers('unknown-id')).toBeNull();
  });

  it('returns MCP server state for valid session', () => {
    const db = rawDb();
    insertSession(db, { sessionKey: 'sk1', sessionId: 'sid1', tool: 'claude' });
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    dashDb.createMcpServer({
      name: 'test-mcp',
      tool: 'claude',
      transport: 'stdio',
      definition: { command: 'echo' },
    });

    const state = dashDb.getSessionMcpServers('sid1');
    expect(state).not.toBeNull();
    expect(state?.sessionId).toBe('sid1');
    expect(state?.tool).toBe('claude');
    // At least our created server, possibly more from global configs
    expect(state?.servers.some((s) => s.name === 'test-mcp')).toBe(true);
  });
});

describe('DashboardDb — setSessionMcpServerEnabled', () => {
  it('returns null for unknown session', () => {
    expect(dashDb.setSessionMcpServerEnabled('unknown', 'server-id', true)).toBeNull();
  });

  it('throws when server not found for session tool', () => {
    const db = rawDb();
    insertSession(db, { sessionKey: 'sk1', sessionId: 'sid1', tool: 'claude' });
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    expect(() => dashDb.setSessionMcpServerEnabled('sid1', 'nonexistent', true)).toThrow(
      'Server not found for session tool',
    );
  });

  it('toggles server enabled state', () => {
    const db = rawDb();
    insertSession(db, { sessionKey: 'sk1', sessionId: 'sid1', tool: 'claude' });
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    const server = dashDb.createMcpServer({
      name: 'test-mcp',
      tool: 'claude',
      transport: 'stdio',
      definition: { command: 'echo' },
    });

    const result = dashDb.setSessionMcpServerEnabled('sid1', server.id, false);
    expect(result).not.toBeNull();
    expect(result?.servers.find((s) => s.id === server.id)?.enabled).toBe(false);
  });
});

describe('DashboardDb — resetSessionMcpServers', () => {
  it('returns null for unknown session', () => {
    expect(dashDb.resetSessionMcpServers('unknown')).toBeNull();
  });

  it('resets session MCP server selection', () => {
    const db = rawDb();
    insertSession(db, { sessionKey: 'sk1', sessionId: 'sid1', tool: 'claude' });
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    dashDb.createMcpServer({
      name: 'test-mcp',
      tool: 'claude',
      transport: 'stdio',
      definition: { command: 'echo' },
    });

    const result = dashDb.resetSessionMcpServers('sid1');
    expect(result).not.toBeNull();
    expect(result?.filterActive).toBe(false);
  });
});

describe('DashboardDb — getSessionMcpContext with bad tool', () => {
  it('returns null when session has non-tool value', () => {
    const db = rawDb();
    db.prepare(
      `INSERT INTO sessions (session_key, tool, mode, tool_state, workdir, updated_at)
       VALUES ('sk_bad', 'invalid_tool', 'write', '{}', '/tmp', datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO session_registry (session_key, session_id, thread_key, user_id, started_at)
       VALUES ('sk_bad', 'bad-sid', 'C:T', 'U1', datetime('now'))`,
    ).run();
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    expect(dashDb.getSessionMcpServers('bad-sid')).toBeNull();
  });
});

describe('DashboardDb — error analysis', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'));
  });

  function seedErrors() {
    const db = rawDb();
    insertAuditRow(db, {
      jobId: 'e1',
      sessionKey: 'sk1',
      tool: 'claude',
      startedAt: '2026-01-10T10:00:00.000Z',
      errorKind: 'exit_1',
    });
    insertAuditRow(db, {
      jobId: 'e2',
      sessionKey: 'sk1',
      tool: 'gemini',
      startedAt: '2026-01-09T10:00:00.000Z',
      errorKind: 'no_output_timeout',
    });
    insertAuditRow(db, {
      jobId: 'e3',
      sessionKey: 'sk1',
      tool: 'claude',
      startedAt: '2026-01-08T10:00:00.000Z',
      errorKind: 'mcp_auth_required',
    });
    insertAuditRow(db, {
      jobId: 'e4',
      sessionKey: 'sk1',
      tool: 'codex',
      startedAt: '2026-01-07T10:00:00.000Z',
      errorKind: 'user_exit',
    });
    insertAuditRow(db, {
      jobId: 'e5',
      sessionKey: 'sk1',
      tool: 'claude',
      startedAt: '2026-01-06T10:00:00.000Z',
      errorKind: 'spawn_error_foo',
    });
    insertAuditRow(db, {
      jobId: 'e6',
      sessionKey: 'sk1',
      tool: 'gemini',
      startedAt: '2026-01-05T10:00:00.000Z',
      errorKind: 'orchestrator_shutdown',
    });
    insertAuditRow(db, {
      jobId: 'e7',
      sessionKey: 'sk1',
      tool: 'gemini',
      startedAt: '2026-01-04T10:00:00.000Z',
      errorKind: 'something_unknown',
    });
    // Also: user_stop, reset, dashboard_stop, max_runtime_timeout, mcp_tool_unavailable, permission_approval_needed
    insertAuditRow(db, {
      jobId: 'e8',
      sessionKey: 'sk1',
      tool: 'claude',
      startedAt: '2026-01-10T09:00:00.000Z',
      errorKind: 'user_stop',
    });
    insertAuditRow(db, {
      jobId: 'e9',
      sessionKey: 'sk1',
      tool: 'claude',
      startedAt: '2026-01-10T08:00:00.000Z',
      errorKind: 'reset',
    });
    insertAuditRow(db, {
      jobId: 'e10',
      sessionKey: 'sk1',
      tool: 'claude',
      startedAt: '2026-01-10T07:00:00.000Z',
      errorKind: 'dashboard_stop',
    });
    insertAuditRow(db, {
      jobId: 'e11',
      sessionKey: 'sk1',
      tool: 'claude',
      startedAt: '2026-01-10T06:00:00.000Z',
      errorKind: 'max_runtime_timeout',
    });
    insertAuditRow(db, {
      jobId: 'e12',
      sessionKey: 'sk1',
      tool: 'claude',
      startedAt: '2026-01-10T05:00:00.000Z',
      errorKind: 'mcp_tool_unavailable',
    });
    insertAuditRow(db, {
      jobId: 'e13',
      sessionKey: 'sk1',
      tool: 'claude',
      startedAt: '2026-01-10T04:00:00.000Z',
      errorKind: 'permission_approval_needed',
    });
    db.close();
  }

  it('getErrorStats returns categorized error counts', () => {
    seedErrors();
    const stats = dashDb.getErrorStats();
    expect(stats.length).toBeGreaterThan(0);
    const categories = stats.map((s) => s.category);
    expect(categories).toContain('Exit Error');
    expect(categories).toContain('Timeout');
    expect(categories).toContain('MCP Issue');
    expect(categories).toContain('User Stopped');
    expect(categories).toContain('Spawn Error');
    expect(categories).toContain('System');
    expect(categories).toContain('Other');
  });

  it('getErrorStats returns empty on closed db', () => {
    dashDb.close();
    expect(dashDb.getErrorStats()).toEqual([]);
  });

  it('getErrorTrend returns daily error categories', () => {
    seedErrors();
    const trend = dashDb.getErrorTrend();
    expect(trend.length).toBeGreaterThan(0);
    for (const entry of trend) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.category).toBeTruthy();
      expect(entry.count).toBeGreaterThan(0);
    }
  });

  it('getErrorTrend returns empty on closed db', () => {
    dashDb.close();
    expect(dashDb.getErrorTrend()).toEqual([]);
  });

  it('getErrorByTool returns per-tool error categories', () => {
    seedErrors();
    const stats = dashDb.getErrorByTool();
    expect(stats.length).toBeGreaterThan(0);
    for (const entry of stats) {
      expect(entry.tool).toBeTruthy();
      expect(entry.category).toBeTruthy();
      expect(entry.count).toBeGreaterThan(0);
    }
  });

  it('getErrorByTool returns empty on closed db', () => {
    dashDb.close();
    expect(dashDb.getErrorByTool()).toEqual([]);
  });

  it('getRecentErrors returns recent error audit rows', () => {
    seedErrors();
    const errors = dashDb.getRecentErrors(3);
    expect(errors).toHaveLength(3);
    expect(errors[0]?.errorKind).not.toBeNull();
  });

  it('getRecentErrors uses default limit', () => {
    seedErrors();
    const errors = dashDb.getRecentErrors();
    expect(errors.length).toBeLessThanOrEqual(10);
  });

  it('getRecentErrors returns empty on closed db', () => {
    dashDb.close();
    expect(dashDb.getRecentErrors()).toEqual([]);
  });
});

describe('DashboardDb — session trace', () => {
  it('returns null for unknown session', () => {
    expect(dashDb.getSessionTrace('unknown-id')).toBeNull();
  });

  it('returns trace with jobs and message counts', () => {
    const db = rawDb();
    insertSession(db, { sessionKey: 'sk1', sessionId: 'sid1', tool: 'claude' });
    insertAuditRow(db, {
      jobId: 'j1',
      sessionKey: 'sk1',
      tool: 'claude',
      startedAt: '2026-01-10T10:00:00.000Z',
      endedAt: '2026-01-10T10:30:00.000Z',
      exitCode: 0,
    });
    insertAuditRow(db, {
      jobId: 'j2',
      sessionKey: 'sk1',
      tool: 'claude',
      startedAt: '2026-01-10T11:00:00.000Z',
      endedAt: null,
      errorKind: 'exit_1',
    });
    insertMessage(db, 'sk1', 'user', 'hello', '2026-01-10T10:10:00.000Z');
    insertMessage(db, 'sk1', 'assistant', 'hi', '2026-01-10T10:20:00.000Z');
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    const trace = dashDb.getSessionTrace('sid1');
    expect(trace).not.toBeNull();
    expect(trace?.sessionId).toBe('sid1');
    expect(trace?.tool).toBe('claude');
    expect(trace?.jobs).toHaveLength(2);

    // First job has 2 messages, duration
    const j1 = trace?.jobs.find((j) => j.jobId === 'j1');
    expect(j1?.messageCount).toBe(2);
    expect(j1?.durationMs).toBeGreaterThan(0);
    expect(j1?.errorKind).toBeNull();

    // Second job has no ended_at, durationMs should be null
    const j2 = trace?.jobs.find((j) => j.jobId === 'j2');
    expect(j2?.durationMs).toBeNull();
    expect(j2?.errorKind).toBe('exit_1');
  });

  it('handles missing session table in trace', () => {
    const db = rawDb();
    insertSession(db, { sessionKey: 'sk1', sessionId: 'sid1', tool: 'claude' });
    // Insert audit but no sessions row for that session_key
    const reg = db
      .prepare('SELECT session_key FROM session_registry WHERE session_id = ?')
      .get('sid1') as { session_key: string };
    db.prepare('DELETE FROM sessions WHERE session_key = ?').run(reg.session_key);
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    // Should return trace with tool='unknown'
    const trace = dashDb.getSessionTrace('sid1');
    expect(trace).not.toBeNull();
    expect(trace?.tool).toBe('unknown');
  });

  it('returns null on db error', () => {
    dashDb.close();
    expect(dashDb.getSessionTrace('sid1')).toBeNull();
  });

  it('handles NaN/negative duration gracefully', () => {
    const db = rawDb();
    insertSession(db, { sessionKey: 'sk1', sessionId: 'sid1', tool: 'claude' });
    insertAuditRow(db, {
      jobId: 'j-bad',
      sessionKey: 'sk1',
      tool: 'claude',
      startedAt: 'invalid-date',
      endedAt: 'also-invalid',
    });
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    const trace = dashDb.getSessionTrace('sid1');
    expect(trace).not.toBeNull();
    const job = trace?.jobs[0];
    expect(job?.durationMs).toBeNull();
  });
});

describe('DashboardDb — getJobMessages', () => {
  it('returns empty for unknown session', () => {
    expect(dashDb.getJobMessages('unknown', 'j1')).toEqual([]);
  });

  it('returns empty for unknown job', () => {
    const db = rawDb();
    insertSession(db, { sessionKey: 'sk1', sessionId: 'sid1' });
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    expect(dashDb.getJobMessages('sid1', 'nonexistent')).toEqual([]);
  });

  it('falls back to time-window query for legacy messages without job_id', () => {
    const db = rawDb();
    insertSession(db, { sessionKey: 'sk1', sessionId: 'sid1' });
    insertAuditRow(db, {
      jobId: 'j1',
      sessionKey: 'sk1',
      startedAt: '2026-01-10T10:00:00.000Z',
      endedAt: '2026-01-10T11:00:00.000Z',
    });
    // Messages without job_id (legacy data) — falls back to time-window filter
    insertMessage(db, 'sk1', 'user', 'before job', '2026-01-10T09:00:00.000Z');
    insertMessage(db, 'sk1', 'user', 'during job', '2026-01-10T10:30:00.000Z');
    insertMessage(db, 'sk1', 'assistant', 'reply', '2026-01-10T10:45:00.000Z');
    insertMessage(db, 'sk1', 'user', 'after job', '2026-01-10T12:00:00.000Z');
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    const msgs = dashDb.getJobMessages('sid1', 'j1');
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.content).toBe('during job');
    expect(msgs[1]?.content).toBe('reply');
  });

  it('falls back to time-window with 9999 end bound when ended_at is null', () => {
    const db = rawDb();
    insertSession(db, { sessionKey: 'sk1', sessionId: 'sid1' });
    insertAuditRow(db, {
      jobId: 'j1',
      sessionKey: 'sk1',
      startedAt: '2026-01-10T10:00:00.000Z',
      endedAt: null,
    });
    insertMessage(db, 'sk1', 'user', 'msg', '2026-01-10T10:30:00.000Z');
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    const msgs = dashDb.getJobMessages('sid1', 'j1');
    expect(msgs).toHaveLength(1);
  });

  it('returns messages by job_id (primary path)', () => {
    const db = rawDb();
    insertSession(db, { sessionKey: 'sk1', sessionId: 'sid1' });
    insertAuditRow(db, {
      jobId: 'j1',
      sessionKey: 'sk1',
      startedAt: '2026-01-10T10:00:00.000Z',
      endedAt: '2026-01-10T11:00:00.000Z',
    });
    // Messages with job_id — these should be found via the primary path
    insertMessage(db, 'sk1', 'user', 'user msg', '2026-01-10T09:59:00.000Z', 'j1');
    insertMessage(db, 'sk1', 'assistant', 'reply', '2026-01-10T10:45:00.000Z', 'j1');
    // Message without job_id in same time window — should NOT appear in primary path
    insertMessage(db, 'sk1', 'user', 'other msg', '2026-01-10T10:30:00.000Z');
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    const msgs = dashDb.getJobMessages('sid1', 'j1');
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.content).toBe('user msg');
    expect(msgs[1]?.content).toBe('reply');
  });

  it('returns empty on db error', () => {
    dashDb.close();
    expect(dashDb.getJobMessages('sid1', 'j1')).toEqual([]);
  });
});

describe('DashboardDb — getTaskSummaryStats', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'));
  });

  it('returns zeroed stats on empty db', () => {
    const stats = dashDb.getTaskSummaryStats();
    expect(stats.ondemand.total).toBe(0);
    expect(stats.ondemand.active).toBe(0);
    expect(stats.ondemand.totalRuns).toBe(0);
    expect(stats.scheduled.total).toBe(0);
    expect(stats.scheduled.active).toBe(0);
    expect(stats.scheduled.paused).toBe(0);
    expect(stats.triggered.total).toBe(0);
    expect(stats.triggered.enabled).toBe(0);
    expect(stats.dailyTaskRuns).toEqual([]);
  });

  it('computes on-demand task stats', () => {
    const db = rawDb();
    // Seed ondemand tasks
    db.prepare(
      `INSERT INTO ondemand_tasks (id, name, tool, mode, prompt, workdir, status, created_at, updated_at)
       VALUES ('od1', 'task1', 'claude', 'write', 'do stuff', '/tmp', 'active', datetime('now'), datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO ondemand_tasks (id, name, tool, mode, prompt, workdir, status, created_at, updated_at)
       VALUES ('od2', 'task2', 'claude', 'write', 'do more', '/tmp', 'active', datetime('now'), datetime('now'))`,
    ).run();
    // Seed ondemand runs (session_key is required)
    db.prepare(
      `INSERT INTO ondemand_task_runs (id, task_id, session_key, status, started_at)
       VALUES ('odr1', 'od1', 'sk1', 'completed', '2026-01-10T10:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO ondemand_task_runs (id, task_id, session_key, status, started_at)
       VALUES ('odr2', 'od1', 'sk1', 'failed', '2026-01-10T11:00:00.000Z')`,
    ).run();
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    const stats = dashDb.getTaskSummaryStats();
    expect(stats.ondemand.total).toBe(2);
    expect(stats.ondemand.active).toBe(2);
    expect(stats.ondemand.totalRuns).toBe(2);
    expect(stats.ondemand.runs24h).toBe(2);
    expect(stats.ondemand.failed24h).toBe(1);
  });

  it('computes scheduled task stats', () => {
    const db = rawDb();
    db.prepare(
      `INSERT INTO scheduled_tasks (id, name, user_id, tool, mode, prompt, workdir, schedule_type, cron_expr, status, created_at, updated_at)
       VALUES ('sch1', 'sched1', 'U1', 'claude', 'write', 'do', '/tmp', 'cron', '0 * * * *', 'active', datetime('now'), datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO scheduled_tasks (id, name, user_id, tool, mode, prompt, workdir, schedule_type, cron_expr, status, created_at, updated_at)
       VALUES ('sch2', 'sched2', 'U1', 'claude', 'write', 'do', '/tmp', 'cron', '0 * * * *', 'paused', datetime('now'), datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO scheduled_task_runs (id, task_id, session_key, status, started_at)
       VALUES ('schr1', 'sch1', 'sk1', 'completed', '2026-01-10T10:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO scheduled_task_runs (id, task_id, session_key, status, started_at)
       VALUES ('schr2', 'sch1', 'sk1', 'failed', '2026-01-10T11:00:00.000Z')`,
    ).run();
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    const stats = dashDb.getTaskSummaryStats();
    expect(stats.scheduled.total).toBe(2);
    expect(stats.scheduled.active).toBe(1);
    expect(stats.scheduled.paused).toBe(1);
    expect(stats.scheduled.totalRuns).toBe(2);
    expect(stats.scheduled.runs24h).toBe(2);
    expect(stats.scheduled.failed24h).toBe(1);
  });

  it('computes triggered task stats', () => {
    const db = rawDb();
    db.prepare(
      `INSERT INTO triggered_tasks (id, name, tool, mode, prompt, workdir, enabled, created_at, updated_at)
       VALUES ('tt1', 'trig1', 'claude', 'write', 'do', '/tmp', 1, datetime('now'), datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO triggered_tasks (id, name, tool, mode, prompt, workdir, enabled, created_at, updated_at)
       VALUES ('tt2', 'trig2', 'claude', 'write', 'do', '/tmp', 0, datetime('now'), datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO triggered_task_runs (id, triggered_task_id, status, started_at)
       VALUES ('ttr1', 'tt1', 'completed', '2026-01-10T10:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO triggered_task_runs (id, triggered_task_id, status, started_at)
       VALUES ('ttr2', 'tt1', 'failed', '2026-01-10T11:00:00.000Z')`,
    ).run();
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    const stats = dashDb.getTaskSummaryStats();
    expect(stats.triggered.total).toBe(2);
    expect(stats.triggered.enabled).toBe(1);
    expect(stats.triggered.totalRuns).toBe(2);
    expect(stats.triggered.runs24h).toBe(2);
    expect(stats.triggered.failed24h).toBe(1);
  });

  it('computes daily task runs from all sources', () => {
    const db = rawDb();
    db.prepare(
      `INSERT INTO ondemand_task_runs (id, task_id, session_key, status, started_at)
       VALUES ('odr1', 'od1', 'sk1', 'completed', '2026-01-09T10:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO scheduled_task_runs (id, task_id, session_key, status, started_at)
       VALUES ('schr1', 'sch1', 'sk1', 'failed', '2026-01-09T10:00:00.000Z')`,
    ).run();
    // Need parent triggered_task for FK
    db.prepare(
      `INSERT INTO triggered_tasks (id, name, tool, mode, prompt, enabled, created_at, updated_at)
       VALUES ('tt1', 'trig1', 'claude', 'write', 'do', 1, datetime('now'), datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO triggered_task_runs (id, triggered_task_id, status, started_at)
       VALUES ('ttr1', 'tt1', 'completed', '2026-01-09T10:00:00.000Z')`,
    ).run();
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    const stats = dashDb.getTaskSummaryStats();
    expect(stats.dailyTaskRuns.length).toBeGreaterThan(0);
    const sources = new Set(stats.dailyTaskRuns.map((d) => d.source));
    expect(sources).toContain('on-demand');
    expect(sources).toContain('scheduled');
    expect(sources).toContain('triggered');
  });

  it('returns defaults on closed db', () => {
    dashDb.close();
    const stats = dashDb.getTaskSummaryStats();
    expect(stats.ondemand.total).toBe(0);
    expect(stats.scheduled.total).toBe(0);
    expect(stats.triggered.total).toBe(0);
  });
});

describe('DashboardDb — scheduled task methods', () => {
  it('getScheduledTasks returns empty on fresh db', () => {
    expect(dashDb.getScheduledTasks()).toEqual([]);
  });

  it('getScheduledTasks returns tasks', () => {
    const db = rawDb();
    db.prepare(
      `INSERT INTO scheduled_tasks (id, name, user_id, tool, mode, prompt, workdir, schedule_type, cron_expr, status, created_at, updated_at)
       VALUES ('s1', 'sched1', 'U1', 'claude', 'write', 'prompt', '/tmp', 'cron', '* * * * *', 'active', datetime('now'), datetime('now'))`,
    ).run();
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    const tasks = dashDb.getScheduledTasks();
    expect(tasks.length).toBeGreaterThan(0);
  });

  it('getScheduledTasks returns empty on closed db', () => {
    dashDb.close();
    expect(dashDb.getScheduledTasks()).toEqual([]);
  });

  it('getScheduledTaskById returns task', () => {
    const db = rawDb();
    db.prepare(
      `INSERT INTO scheduled_tasks (id, name, user_id, tool, mode, prompt, workdir, schedule_type, cron_expr, status, created_at, updated_at)
       VALUES ('s1', 'sched1', 'U1', 'claude', 'write', 'prompt', '/tmp', 'cron', '* * * * *', 'active', datetime('now'), datetime('now'))`,
    ).run();
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    const task = dashDb.getScheduledTaskById('s1');
    expect(task).not.toBeNull();
    expect(task?.id).toBe('s1');
  });

  it('getScheduledTaskById returns null for deleted task', () => {
    const db = rawDb();
    db.prepare(
      `INSERT INTO scheduled_tasks (id, name, user_id, tool, mode, prompt, workdir, schedule_type, cron_expr, status, created_at, updated_at)
       VALUES ('s1', 'sched1', 'U1', 'claude', 'write', 'prompt', '/tmp', 'cron', '* * * * *', 'deleted', datetime('now'), datetime('now'))`,
    ).run();
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    expect(dashDb.getScheduledTaskById('s1')).toBeNull();
  });

  it('getScheduledTaskById returns null for missing id', () => {
    expect(dashDb.getScheduledTaskById('nonexistent')).toBeNull();
  });

  it('getScheduledTaskById returns null on closed db', () => {
    dashDb.close();
    expect(dashDb.getScheduledTaskById('s1')).toBeNull();
  });

  it('getScheduledTaskRuns returns runs', () => {
    const db = rawDb();
    db.prepare(
      `INSERT INTO scheduled_task_runs (id, task_id, session_key, status, started_at)
       VALUES ('sr1', 's1', 'sk1', 'completed', datetime('now'))`,
    ).run();
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    const runs = dashDb.getScheduledTaskRuns('s1');
    expect(runs.length).toBeGreaterThan(0);
  });

  it('getScheduledTaskRuns returns empty on closed db', () => {
    dashDb.close();
    expect(dashDb.getScheduledTaskRuns('s1')).toEqual([]);
  });
});

describe('DashboardDb — on-demand task methods', () => {
  it('getOndemandTasks returns empty on fresh db', () => {
    expect(dashDb.getOndemandTasks()).toEqual([]);
  });

  it('getOndemandTasks returns tasks', () => {
    const db = rawDb();
    db.prepare(
      `INSERT INTO ondemand_tasks (id, name, tool, mode, prompt, workdir, status, created_at, updated_at)
       VALUES ('od1', 'task1', 'claude', 'write', 'prompt', '/tmp', 'active', datetime('now'), datetime('now'))`,
    ).run();
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    const tasks = dashDb.getOndemandTasks();
    expect(tasks.length).toBeGreaterThan(0);
  });

  it('getOndemandTasks returns empty on closed db', () => {
    dashDb.close();
    expect(dashDb.getOndemandTasks()).toEqual([]);
  });

  it('getOndemandTaskById returns task', () => {
    const db = rawDb();
    db.prepare(
      `INSERT INTO ondemand_tasks (id, name, tool, mode, prompt, workdir, status, created_at, updated_at)
       VALUES ('od1', 'task1', 'claude', 'write', 'prompt', '/tmp', 'active', datetime('now'), datetime('now'))`,
    ).run();
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    const task = dashDb.getOndemandTaskById('od1');
    expect(task).not.toBeNull();
    expect(task?.id).toBe('od1');
  });

  it('getOndemandTaskById returns null for deleted task', () => {
    const db = rawDb();
    db.prepare(
      `INSERT INTO ondemand_tasks (id, name, tool, mode, prompt, workdir, status, created_at, updated_at)
       VALUES ('od1', 'task1', 'claude', 'write', 'prompt', '/tmp', 'deleted', datetime('now'), datetime('now'))`,
    ).run();
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    expect(dashDb.getOndemandTaskById('od1')).toBeNull();
  });

  it('getOndemandTaskById returns null for missing id', () => {
    expect(dashDb.getOndemandTaskById('nonexistent')).toBeNull();
  });

  it('getOndemandTaskById returns null on closed db', () => {
    dashDb.close();
    expect(dashDb.getOndemandTaskById('od1')).toBeNull();
  });

  it('getOndemandTaskRuns returns runs', () => {
    const db = rawDb();
    db.prepare(
      `INSERT INTO ondemand_task_runs (id, task_id, session_key, status, started_at)
       VALUES ('odr1', 'od1', 'sk1', 'completed', datetime('now'))`,
    ).run();
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    const runs = dashDb.getOndemandTaskRuns('od1');
    expect(runs.length).toBeGreaterThan(0);
  });

  it('getOndemandTaskRuns returns empty on closed db', () => {
    dashDb.close();
    expect(dashDb.getOndemandTaskRuns('od1')).toEqual([]);
  });
});

describe('DashboardDb — orchestrator methods', () => {
  it('getOrchestrators returns empty on fresh db', () => {
    expect(dashDb.getOrchestrators()).toEqual([]);
  });

  it('getOrchestrators returns empty on closed db', () => {
    dashDb.close();
    expect(dashDb.getOrchestrators()).toEqual([]);
  });

  it('getOrchestratorById returns null for missing id', () => {
    expect(dashDb.getOrchestratorById('nonexistent')).toBeNull();
  });

  it('getOrchestratorById returns null on closed db', () => {
    dashDb.close();
    expect(dashDb.getOrchestratorById('orch1')).toBeNull();
  });

  it('getOrchestratorById returns null for deleted orchestrator', () => {
    const db = rawDb();
    db.prepare(
      `INSERT INTO orchestrators (id, name, description, status, created_at, updated_at)
       VALUES ('orch1', 'test', 'desc', 'deleted', datetime('now'), datetime('now'))`,
    ).run();
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    expect(dashDb.getOrchestratorById('orch1')).toBeNull();
  });

  it('getOrchestratorById returns orchestrator with nodes and edges', () => {
    const db = rawDb();
    db.prepare(
      `INSERT INTO orchestrators (id, name, description, status, start_node_id, created_at, updated_at)
       VALUES ('orch1', 'test', 'desc', 'active', 'n1', datetime('now'), datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO orchestrator_nodes (id, orchestrator_id, label, tool, mode, prompt, workdir, position_x, position_y, created_at, updated_at)
       VALUES ('n1', 'orch1', 'node1', 'claude', 'write', 'prompt', '/tmp', 0, 0, datetime('now'), datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO orchestrator_edges (id, orchestrator_id, from_node_id, to_node_id, created_at)
       VALUES ('e1', 'orch1', 'n1', 'n1', datetime('now'))`,
    ).run();
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    const orch = dashDb.getOrchestratorById('orch1');
    expect(orch).not.toBeNull();
    expect(orch?.nodes.length).toBeGreaterThanOrEqual(1);
    expect(orch?.edges.length).toBeGreaterThanOrEqual(1);
  });

  it('getOrchestratorRuns returns runs', () => {
    expect(dashDb.getOrchestratorRuns('orch1')).toEqual([]);
  });

  it('getOrchestratorRuns returns empty on closed db', () => {
    dashDb.close();
    expect(dashDb.getOrchestratorRuns('orch1')).toEqual([]);
  });

  it('getOrchestratorRunById returns null for missing id', () => {
    expect(dashDb.getOrchestratorRunById('nonexistent')).toBeNull();
  });

  it('getOrchestratorRunById returns null on closed db', () => {
    dashDb.close();
    expect(dashDb.getOrchestratorRunById('r1')).toBeNull();
  });

  it('getOrchestratorRunsOverview returns null for missing orchestrator', () => {
    expect(dashDb.getOrchestratorRunsOverview('nonexistent')).toBeNull();
  });

  it('getOrchestratorRunsOverview returns null on closed db', () => {
    dashDb.close();
    expect(dashDb.getOrchestratorRunsOverview('orch1')).toBeNull();
  });

  it('getOrchestratorRunsOverview returns runs with node runs', () => {
    const db = rawDb();
    db.prepare(
      `INSERT INTO orchestrators (id, name, description, status, start_node_id, created_at, updated_at)
       VALUES ('orch1', 'test', 'desc', 'active', 'n1', datetime('now'), datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO orchestration_runs (id, orchestrator_id, status, created_at)
       VALUES ('r1', 'orch1', 'completed', datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO orchestration_node_runs (id, orchestration_run_id, node_id, status, started_at)
       VALUES ('nr1', 'r1', 'n1', 'completed', datetime('now'))`,
    ).run();
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    const overview = dashDb.getOrchestratorRunsOverview('orch1');
    expect(overview).not.toBeNull();
    expect(overview?.runs).toHaveLength(1);
    expect(overview?.runs[0]?.nodeRuns).toHaveLength(1);
  });

  it('getOrchestratorRunById returns run with node runs', () => {
    const db = rawDb();
    db.prepare(
      `INSERT INTO orchestrators (id, name, description, status, created_at, updated_at)
       VALUES ('orch1', 'test', 'desc', 'active', datetime('now'), datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO orchestration_runs (id, orchestrator_id, status, created_at)
       VALUES ('r1', 'orch1', 'completed', datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO orchestration_node_runs (id, orchestration_run_id, node_id, status, started_at)
       VALUES ('nr1', 'r1', 'n1', 'completed', datetime('now'))`,
    ).run();
    db.close();
    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    const run = dashDb.getOrchestratorRunById('r1');
    expect(run).not.toBeNull();
    expect(run?.nodeRuns).toHaveLength(1);
  });
});

describe('DashboardDb — dev alias methods', () => {
  it('getDevAlias returns alias', () => {
    dashDb.createDevAlias('proj', '/tmp/proj', 'claude');
    expect(dashDb.getDevAlias('proj')).not.toBeNull();
  });

  it('getDevAlias returns null for missing', () => {
    expect(dashDb.getDevAlias('nope')).toBeNull();
  });

  it('getDevAlias returns null on closed db', () => {
    dashDb.close();
    expect(dashDb.getDevAlias('proj')).toBeNull();
  });

  it('createDevAlias defaults invalid tool to claude', () => {
    const alias = dashDb.createDevAlias('proj', '/tmp/proj', 'invalidtool');
    expect(alias.tool).toBe('claude');
  });

  it('updateDevAlias defaults invalid tool to claude', () => {
    dashDb.createDevAlias('proj', '/tmp/proj', 'claude');
    const updated = dashDb.updateDevAlias('proj', { tool: 'invalidtool' });
    expect(updated?.tool).toBe('claude');
  });

  it('clearSessionDevAlias runs without error', () => {
    // Just ensure it doesn't throw
    dashDb.clearSessionDevAlias('nonexistent');
  });

  it('clearSessionDevAlias handles closed db gracefully', () => {
    dashDb.close();
    // Should not throw
    dashDb.clearSessionDevAlias('nonexistent');
  });
});

describe('DashboardDb — close', () => {
  it('close does not throw', () => {
    expect(() => dashDb.close()).not.toThrow();
  });
});

/**
 * Coverage tests targeting catch branches that return defaults when the DB is closed
 * or tables are missing. These cover lines that were previously uncovered.
 */
describe('DashboardDb — catch branches on closed DB', () => {
  // getSessionMcpContext catch (lines 394-396)
  it('getSessionMcpServers returns null on closed db (getSessionMcpContext catch)', () => {
    dashDb.close();
    expect(dashDb.getSessionMcpServers('any-session-id')).toBeNull();
  });

  // listSessions catch (lines 462-464)
  it('listSessions returns [] on closed db', () => {
    dashDb.close();
    expect(dashDb.listSessions()).toEqual([]);
  });

  // listSessionsByTool catch (lines 472-474)
  it('listSessionsByTool returns [] on closed db', () => {
    dashDb.close();
    expect(dashDb.listSessionsByTool('claude')).toEqual([]);
  });

  // getSessionToolState catch (lines 500-503)
  it('getSessionToolState returns null on closed db', () => {
    dashDb.close();
    expect(dashDb.getSessionToolState('any-id')).toBeNull();
  });

  // getSessionThreadInfo catch (lines 555-558)
  it('getSessionThreadInfo returns null on closed db', () => {
    dashDb.close();
    expect(dashDb.getSessionThreadInfo('any-id')).toBeNull();
  });

  // getSessionAudit catch (lines 584-587)
  it('getSessionAudit returns [] on closed db', () => {
    dashDb.close();
    expect(dashDb.getSessionAudit('any-id')).toEqual([]);
  });

  // getAppToolStats — fallback to default for unknown tool (lines 765-772)
  it('getAppToolStats returns default stat for tools with no audit rows', () => {
    // On a fresh DB with no audit rows, getAppToolStats returns defaults for each tool
    const stats = dashDb.getAppToolStats();
    expect(stats).toHaveLength(3);
    for (const stat of stats) {
      expect(stat.jobs24h).toBe(0);
      expect(stat.errors24h).toBe(0);
      expect(stat.successRate7d).toBe(100);
      expect(stat.avgDurationMs).toBeNull();
      expect(stat.lastActivityAt).toBeNull();
    }
  });

  // getChartData — dailyJobs catch (lines 804-806) and rates catch (lines 829-831)
  it('getChartData returns defaults on closed db', () => {
    dashDb.close();
    const data = dashDb.getChartData();
    expect(data.dailyJobs).toEqual([]);
    expect(data.successRateRange).toBe(100);
    expect(data.totalRange).toBe(0);
  });

  // getJobsBySource catch (lines 1062-1064)
  it('getJobsBySource returns [] on closed db', () => {
    dashDb.close();
    expect(dashDb.getJobsBySource()).toEqual([]);
  });

  // getDurationBuckets catch (lines 1092-1094)
  it('getDurationBuckets returns [] on closed db', () => {
    dashDb.close();
    expect(dashDb.getDurationBuckets()).toEqual([]);
  });

  // getOrchRunStats — orchDailyRuns catch (line 1128) and orchAvgDuration catch (line 1149)
  it('getOrchRunStats returns empty arrays on closed db', () => {
    dashDb.close();
    const stats = dashDb.getOrchRunStats();
    expect(stats.orchDailyRuns).toEqual([]);
    expect(stats.orchAvgDuration).toEqual([]);
  });

  // getQueueDepth catch (lines 1168-1170)
  it('getQueueDepth returns zeros on closed db', () => {
    dashDb.close();
    const depth = dashDb.getQueueDepth();
    expect(depth.running).toBe(0);
    expect(depth.pending).toBe(0);
  });

  // getSparklineData — sessions catch (lines 1203-1205) and jobs catch (lines 1237-1240)
  it('getSparklineData returns default arrays on closed db', () => {
    dashDb.close();
    const data = dashDb.getSparklineData();
    expect(data.sessions).toEqual(new Array(7).fill(0));
    expect(data.jobs).toEqual(new Array(7).fill(0));
    expect(data.errors).toEqual(new Array(7).fill(0));
    expect(data.successRate).toEqual(new Array(7).fill(100));
  });

  // getDbSizeBytes catch (lines 1274-1276)
  it('getDbSizeBytes returns 0 when db file path is non-existent (lines 1274-1276)', () => {
    // Create a DashboardDb with a path that won't exist for statSync
    // The constructor creates the file, but if we construct with a fake path
    // component that doesn't match the actual file location, getDbSizeBytes will fail.
    // Approach: use the DashboardDb with a path, close it, rename the file,
    // but keep the in-memory reference. Problem: close closes the db connection.
    //
    // Instead, construct a DashboardDb at a known path, then rename the db file
    // *before* calling getMetricsData. The db connection is still open in WAL mode
    // (works on the fd), but statSync on the original path will fail.
    const specialPath = join(tmpDir, 'stat-test.db');
    const specialDb = new DashboardDb(specialPath);

    // Rename the db file so statSync on specialPath fails
    const { renameSync } = require('node:fs');
    renameSync(specialPath, `${specialPath}.bak`);

    const metrics = specialDb.getMetricsData();
    expect(metrics.dbSizeBytes).toBe(0);

    // Rename back and close
    renameSync(`${specialPath}.bak`, specialPath);
    specialDb.close();
  });

  // getOrchestratorRunsOverview catch (lines 1671-1673)
  // When db is closed, getOrchestratorById has its own try-catch returning null,
  // causing early return before the outer catch fires. We need to drop the runs table
  // AFTER the DashboardDb is constructed (since ensureSchema recreates it).
  it('getOrchestratorRunsOverview returns null when orchestration_runs is dropped post-construction (lines 1671-1673)', () => {
    // First, insert an orchestrator so getOrchestratorById returns non-null
    const db = rawDb();
    db.prepare(
      `INSERT INTO orchestrators (id, name, description, status, start_node_id, created_at, updated_at)
       VALUES ('orch-catch', 'test', 'desc', 'active', 'n1', datetime('now'), datetime('now'))`,
    ).run();
    db.close();

    dashDb.close();
    dashDb = new DashboardDb(dbPath);

    // Now drop the orchestration_runs table via a separate connection AFTER construction
    const db2 = rawDb();
    db2.prepare('DROP TABLE IF EXISTS orchestration_runs').run();
    db2.close();

    // getOrchestratorById succeeds, but the runs query on the dropped table throws
    expect(dashDb.getOrchestratorRunsOverview('orch-catch')).toBeNull();
  });
});
