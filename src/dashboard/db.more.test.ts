import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardDb } from './db.js';

const AUDIT_SCHEMA = `
CREATE TABLE audit (
  job_id         TEXT PRIMARY KEY,
  session_key    TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  tool           TEXT NOT NULL,
  mode           TEXT NOT NULL,
  workdir        TEXT NOT NULL,
  prompt_hash    TEXT,
  source         TEXT,
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  exit_code      INTEGER,
  error_kind     TEXT
);
`;

let tmpDir: string;
let dbPath: string;
let dashDb: DashboardDb;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'dashdb-more-'));
  dbPath = join(tmpDir, 'test.db');
  const raw = new Database(dbPath);
  raw.exec(AUDIT_SCHEMA);
  raw.close();
  dashDb = new DashboardDb(dbPath);
});

afterEach(() => {
  dashDb.close();
  rmSync(tmpDir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('DashboardDb additional coverage', () => {
  it('applies sqlite busy_timeout and private file permissions on open', () => {
    const internal = dashDb as unknown as { db: Database.Database };

    expect(internal.db.pragma('busy_timeout', { simple: true })).toBe(5000);
    if (process.platform !== 'win32') {
      expect(statSync(dbPath).mode & 0o777).toBe(0o600);
    }
  });

  it('supports dev alias CRUD and fallback on closed DB', () => {
    const created = dashDb.createDevAlias('proj', '/tmp/proj', 'claude', 'hello');
    expect(created).toMatchObject({
      name: 'proj',
      path: '/tmp/proj',
      tool: 'claude',
      instructionContent: 'hello',
    });

    const listed = dashDb.listDevAliases();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      name: 'proj',
      path: '/tmp/proj',
      tool: 'claude',
      instructionContent: 'hello',
    });

    const updated = dashDb.updateDevAlias('proj', {
      path: '/tmp/new-proj',
      tool: 'gemini',
      instructionContent: null,
    });
    expect(updated).not.toBeNull();
    expect(updated).toMatchObject({
      name: 'proj',
      path: '/tmp/new-proj',
      tool: 'gemini',
      instructionContent: null,
    });

    expect(dashDb.updateDevAlias('missing', { tool: 'codex' })).toBeNull();

    dashDb.createDevAlias('proj2', '/tmp/proj2', 'codex');
    expect(dashDb.updateDevAlias('proj2', { path: '/tmp/proj2b' })).not.toBeNull();
    expect(dashDb.updateDevAlias('proj2', { tool: 'claude' })).not.toBeNull();
    expect(dashDb.listDevAliases().find((alias) => alias.name === 'proj2')?.path).toBe(
      '/tmp/proj2b',
    );

    expect(dashDb.deleteDevAlias('proj')).toBe(true);
    expect(dashDb.deleteDevAlias('proj')).toBe(false);

    dashDb.close();
    expect(dashDb.listDevAliases()).toEqual([]);
  });

  it('computes overview stats from audit/dev_aliases data', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'));

    const raw = new Database(dbPath);
    raw
      .prepare(
        `INSERT INTO audit (job_id, session_key, user_id, tool, mode, workdir, prompt_hash, source, started_at, ended_at, exit_code, error_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'j1',
        'sk1',
        'U1',
        'claude',
        'write',
        '/tmp/work-a',
        'h1',
        'slack',
        '2026-01-10T11:00:00.000Z',
        '2026-01-10T11:10:00.000Z',
        0,
        null,
      );
    raw
      .prepare(
        `INSERT INTO audit (job_id, session_key, user_id, tool, mode, workdir, prompt_hash, source, started_at, ended_at, exit_code, error_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'j2',
        'sk2',
        'U2',
        'gemini',
        'readonly',
        '/tmp/work-b',
        'h2',
        'dashboard',
        '2026-01-08T11:00:00.000Z',
        null,
        null,
        'exit_1',
      );
    raw
      .prepare(
        `INSERT INTO dev_aliases (name, path, tool, instruction_content, created_at)
       VALUES ('alpha', '/tmp/alpha', 'claude', NULL, '2026-01-10T11:00:00.000Z')`,
      )
      .run();
    raw.close();

    const stats = dashDb.getOverviewStats();
    expect(stats.totalJobs).toBe(2);
    expect(stats.jobs24h).toBe(1);
    expect(stats.errors24h).toBe(0);
    expect(stats.toolStats).toEqual(
      expect.arrayContaining([
        { tool: 'claude', count: 1 },
        { tool: 'gemini', count: 1 },
      ]),
    );
    expect(stats.recentJobs[0]?.jobId).toBe('j1');
  });

  it('falls back to zero when aggregate query values are nullish', () => {
    const internal = dashDb as unknown as { db: Database.Database };
    const originalPrepare = internal.db.prepare.bind(internal.db);
    const prepareSpy = vi.spyOn(internal.db, 'prepare').mockImplementation(((sql: string) => {
      if (sql.includes('SELECT COUNT(*) AS total')) {
        return { get: () => ({ total: null, jobs24h: null, errors24h: null }) } as never;
      }
      return originalPrepare(sql);
    }) as never);

    const stats = dashDb.getOverviewStats();
    prepareSpy.mockRestore();

    expect(stats.totalJobs).toBe(0);
    expect(stats.jobs24h).toBe(0);
    expect(stats.errors24h).toBe(0);
  });

  it('returns default overview stats when DB operations fail', () => {
    dashDb.close();
    const stats = dashDb.getOverviewStats();
    expect(stats).toMatchObject({
      totalJobs: 0,
      jobs24h: 0,
      errors24h: 0,
      toolStats: [],
      recentJobs: [],
    });
  });

  it('computes chart data with daily job counts and success rates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'));

    const raw = new Database(dbPath);
    const insert = raw.prepare(
      `INSERT INTO audit (job_id, session_key, user_id, tool, mode, workdir, prompt_hash, source, started_at, ended_at, exit_code, error_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // Success job within 24h
    insert.run(
      'j1',
      'sk1',
      'U1',
      'claude',
      'write',
      '/tmp/w',
      'h1',
      'slack',
      '2026-01-10T11:00:00.000Z',
      '2026-01-10T11:10:00.000Z',
      0,
      null,
    );
    // Error job within 24h
    insert.run(
      'j2',
      'sk1',
      'U1',
      'codex',
      'write',
      '/tmp/w',
      'h2',
      'dashboard',
      '2026-01-10T10:00:00.000Z',
      '2026-01-10T10:05:00.000Z',
      1,
      'timeout',
    );
    // Success job within 7d but not 24h
    insert.run(
      'j3',
      'sk1',
      'U1',
      'gemini',
      'readonly',
      '/tmp/w',
      'h3',
      'schedule',
      '2026-01-05T10:00:00.000Z',
      '2026-01-05T10:15:00.000Z',
      0,
      null,
    );
    // Error job within 7d (exit_code != 0 but no error_kind)
    insert.run(
      'j4',
      'sk1',
      'U1',
      'claude',
      'write',
      '/tmp/w',
      'h4',
      'slack',
      '2026-01-06T10:00:00.000Z',
      '2026-01-06T10:15:00.000Z',
      2,
      null,
    );
    raw.close();

    const chart = dashDb.getChartData();

    // dailyJobs should contain entries for 4 jobs across different dates/tools
    expect(chart.dailyJobs.length).toBeGreaterThanOrEqual(3);

    // 7d: j1+j2+j3+j4 = 4 total, j1+j3 success → 50%
    expect(chart.totalRange).toBe(4);
    expect(chart.successRateRange).toBe(50);
  });

  it('returns default chart data when audit table does not exist', () => {
    dashDb.close();
    // Reopen with a fresh DB that has no audit table
    const freshPath = join(tmpDir, 'fresh.db');
    const freshDb = new DashboardDb(freshPath);
    const chart = freshDb.getChartData();
    expect(chart).toMatchObject({
      dailyJobs: [],
      successRateRange: 100,
      totalRange: 0,
    });
    freshDb.close();
  });

  it('returns 100% success rate when no jobs exist in audit', () => {
    // Audit table exists but is empty
    const chart = dashDb.getChartData();
    expect(chart.successRateRange).toBe(100);
    expect(chart.totalRange).toBe(0);
    expect(chart.dailyJobs).toEqual([]);
  });

  it('retrieves audit rows by workdir and falls back on errors', () => {
    const raw = new Database(dbPath);
    raw
      .prepare(
        `INSERT INTO audit (job_id, session_key, user_id, tool, mode, workdir, prompt_hash, source, started_at, ended_at, exit_code, error_kind)
       VALUES ('job-w1', 'sk1', 'U1', 'claude', 'write', '/tmp/work-a', 'h', 'slack', '2026-01-10T10:00:00.000Z', NULL, NULL, NULL)`,
      )
      .run();
    raw.close();

    const rows = dashDb.getAuditByWorkdir('/tmp/work-a');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      jobId: 'job-w1',
      workdir: '/tmp/work-a',
    });

    dashDb.close();
    expect(dashDb.getAuditByWorkdir('/tmp/work-a')).toEqual([]);
  });

  it('computes per-tool stats with getAppToolStats', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'));

    const raw = new Database(dbPath);
    const insert = raw.prepare(
      `INSERT INTO audit (job_id, session_key, user_id, tool, mode, workdir, prompt_hash, source, started_at, ended_at, exit_code, error_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // Claude: 2 jobs in 24h (1 success, 1 error), avg duration 5m
    insert.run(
      'at1',
      'sk1',
      'U1',
      'claude',
      'write',
      '/tmp/w',
      null,
      'slack',
      '2026-01-10T10:00:00.000Z',
      '2026-01-10T10:05:00.000Z',
      0,
      null,
    );
    insert.run(
      'at2',
      'sk1',
      'U1',
      'claude',
      'write',
      '/tmp/w',
      null,
      'slack',
      '2026-01-10T11:00:00.000Z',
      '2026-01-10T11:05:00.000Z',
      1,
      'exit_1',
    );
    // Codex: 1 old job (>24h but within 7d)
    insert.run(
      'at3',
      'sk2',
      'U1',
      'codex',
      'write',
      '/tmp/w',
      null,
      'dashboard',
      '2026-01-08T10:00:00.000Z',
      '2026-01-08T10:10:00.000Z',
      0,
      null,
    );
    raw.close();

    const stats = dashDb.getAppToolStats();
    expect(stats).toHaveLength(3);

    const claude = stats.find((s) => s.tool === 'claude');
    expect(claude).toBeDefined();
    if (!claude) throw new Error('claude stats missing');
    expect(claude.jobs24h).toBe(2);
    expect(claude.errors24h).toBe(1);
    expect(claude.successRate7d).toBe(50);
    expect(claude.avgDurationMs).toBeGreaterThan(0);
    expect(claude.lastActivityAt).toBe('2026-01-10T11:00:00.000Z');

    const codex = stats.find((s) => s.tool === 'codex');
    expect(codex).toBeDefined();
    if (!codex) throw new Error('codex stats missing');
    expect(codex.jobs24h).toBe(0);
    expect(codex.errors24h).toBe(0);
    expect(codex.successRate7d).toBe(100);
    expect(codex.lastActivityAt).toBe('2026-01-08T10:00:00.000Z');

    const gemini = stats.find((s) => s.tool === 'gemini');
    expect(gemini).toBeDefined();
    if (!gemini) throw new Error('gemini stats missing');
    expect(gemini.jobs24h).toBe(0);
    expect(gemini.successRate7d).toBe(100);
    expect(gemini.avgDurationMs).toBeNull();
    expect(gemini.lastActivityAt).toBeNull();
  });

  it('returns safe defaults for getAppToolStats on closed DB', () => {
    dashDb.close();
    const stats = dashDb.getAppToolStats();
    expect(stats).toHaveLength(3);
    for (const s of stats) {
      expect(s.jobs24h).toBe(0);
      expect(s.errors24h).toBe(0);
      expect(s.successRate7d).toBe(100);
      expect(s.avgDurationMs).toBeNull();
      expect(s.lastActivityAt).toBeNull();
    }
  });
});
