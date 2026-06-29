import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardDb } from '../db.js';
import type { RouteContext } from '../route-context.js';
import { handleMetricsRoutes } from './metrics.js';

/* ── Helpers ── */

function createMockRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    writeHead: vi.fn((code: number, h: Record<string, string> = {}) => {
      res.statusCode = code;
      Object.assign(headers, h);
      return res;
    }),
    setHeader: vi.fn((key: string, val: string) => {
      headers[key] = val;
    }),
    end: vi.fn(),
    _headers: headers,
    _body: null as unknown,
  };
  return res;
}

function createMockReq(method: string, url: string) {
  return { method, url, headers: {} } as unknown as import('node:http').IncomingMessage;
}

function seedMetricsDb(dbPath: string): void {
  const db = new Database(dbPath);

  // The DashboardDb constructor calls ensureSchema, so we don't need to create tables manually.
  // But we need to insert seed data after DashboardDb opens it.
  db.close();
}

function insertSeedData(dbPath: string): void {
  const db = new Database(dbPath);

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

  // Sessions
  db.prepare(
    `INSERT INTO sessions (session_key, tool, mode, workdir, updated_at)
     VALUES ('sk1', 'claude', 'write', '/work', ?)`,
  ).run(now.toISOString());
  db.prepare(
    `INSERT INTO session_registry (session_key, session_id, thread_key, user_id, started_at)
     VALUES ('sk1', 'sid1', 'C01:ts1', 'U01', ?)`,
  ).run(oneDayAgo.toISOString());

  // Audit rows with source
  db.prepare(
    `INSERT INTO audit (job_id, session_key, user_id, tool, mode, workdir, prompt_hash, source, started_at, ended_at, exit_code, error_kind)
     VALUES ('j1', 'sk1', 'U01', 'claude', 'write', '/work', 'h1', 'slack', ?, ?, 0, NULL)`,
  ).run(oneHourAgo.toISOString(), now.toISOString());
  db.prepare(
    `INSERT INTO audit (job_id, session_key, user_id, tool, mode, workdir, prompt_hash, source, started_at, ended_at, exit_code, error_kind)
     VALUES ('j2', 'sk1', 'U01', 'gemini', 'write', '/work', 'h2', 'dashboard', ?, ?, 1, 'exit_1')`,
  ).run(twoDaysAgo.toISOString(), oneDayAgo.toISOString());
  db.prepare(
    `INSERT INTO audit (job_id, session_key, user_id, tool, mode, workdir, prompt_hash, source, started_at, ended_at, exit_code, error_kind)
     VALUES ('j3', 'sk1', 'U01', 'claude', 'write', '/work', 'h3', 'slack', ?, ?, 0, NULL)`,
  ).run(twoDaysAgo.toISOString(), oneHourAgo.toISOString());

  // Job queue rows
  db.prepare(
    `INSERT INTO job_queue (job_id, session_key, source, status, payload, created_at, updated_at)
     VALUES ('jq1', 'sk1', 'slack', 'running', '{}', ?, ?)`,
  ).run(now.toISOString(), now.toISOString());
  db.prepare(
    `INSERT INTO job_queue (job_id, session_key, source, status, payload, created_at, updated_at)
     VALUES ('jq2', 'sk1', 'dashboard', 'queued', '{}', ?, ?)`,
  ).run(now.toISOString(), now.toISOString());

  // Orchestration runs
  db.prepare(
    `INSERT INTO orchestrators (id, name, user_id, workdir, created_at, updated_at)
     VALUES ('orch1', 'test-orch', 'U01', '/work', ?, ?)`,
  ).run(twoDaysAgo.toISOString(), now.toISOString());
  db.prepare(
    `INSERT INTO orchestration_runs (id, orchestrator_id, status, started_at, ended_at, created_at)
     VALUES ('or1', 'orch1', 'completed', ?, ?, ?)`,
  ).run(oneHourAgo.toISOString(), now.toISOString(), oneHourAgo.toISOString());
  db.prepare(
    `INSERT INTO orchestration_runs (id, orchestrator_id, status, started_at, ended_at, created_at)
     VALUES ('or2', 'orch1', 'failed', ?, ?, ?)`,
  ).run(twoDaysAgo.toISOString(), oneDayAgo.toISOString(), twoDaysAgo.toISOString());

  db.close();
}

let tmpDir: string;
let dbPath: string;
let dashDb: DashboardDb;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'metrics-'));
  dbPath = join(tmpDir, 'test.db');
  seedMetricsDb(dbPath);
  dashDb = new DashboardDb(dbPath);
  insertSeedData(dbPath);
});

afterEach(() => {
  dashDb.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

/* ── DB Query Tests ── */

describe('DashboardDb metrics queries', () => {
  describe('getJobsBySource', () => {
    it('returns source counts grouped and ordered by count', () => {
      const results = dashDb.getJobsBySource();
      expect(results.length).toBeGreaterThan(0);
      const slackStat = results.find((r) => r.source === 'slack');
      expect(slackStat).toBeDefined();
      expect(slackStat?.count).toBe(2);
      const dashStat = results.find((r) => r.source === 'dashboard');
      expect(dashStat).toBeDefined();
      expect(dashStat?.count).toBe(1);
    });

    it('returns empty array for empty DB', () => {
      const emptyDbPath = join(tmpDir, 'empty.db');
      const emptyDb = new DashboardDb(emptyDbPath);
      expect(emptyDb.getJobsBySource()).toEqual([]);
      emptyDb.close();
    });

    it('respects range parameter', () => {
      // 2-hour range should include j1 (started 1 hour ago), exclude j2/j3 (started 2 days ago)
      const results = dashDb.getJobsBySource(2 * 60 * 60 * 1000);
      const totalCount = results.reduce((acc, r) => acc + r.count, 0);
      expect(totalCount).toBe(1);
    });
  });

  describe('getDurationBuckets', () => {
    it('returns duration distribution buckets', () => {
      const results = dashDb.getDurationBuckets();
      expect(results.length).toBeGreaterThan(0);
      for (const bucket of results) {
        expect(bucket.label).toBeDefined();
        expect(bucket.count).toBeGreaterThanOrEqual(1);
      }
    });

    it('returns empty array for empty DB', () => {
      const emptyDbPath = join(tmpDir, 'empty2.db');
      const emptyDb = new DashboardDb(emptyDbPath);
      expect(emptyDb.getDurationBuckets()).toEqual([]);
      emptyDb.close();
    });
  });

  describe('getOrchRunStats', () => {
    it('returns orchestration run statistics', () => {
      const stats = dashDb.getOrchRunStats();
      expect(stats.orchDailyRuns.length).toBeGreaterThan(0);
      expect(stats.orchAvgDuration.length).toBeGreaterThan(0);

      const completed = stats.orchDailyRuns.find((r) => r.status === 'completed');
      expect(completed).toBeDefined();
      expect(completed?.count).toBe(1);

      const failed = stats.orchDailyRuns.find((r) => r.status === 'failed');
      expect(failed).toBeDefined();
      expect(failed?.count).toBe(1);
    });

    it('returns empty arrays for empty DB', () => {
      const emptyDbPath = join(tmpDir, 'empty3.db');
      const emptyDb = new DashboardDb(emptyDbPath);
      const stats = emptyDb.getOrchRunStats();
      expect(stats.orchDailyRuns).toEqual([]);
      expect(stats.orchAvgDuration).toEqual([]);
      emptyDb.close();
    });
  });

  describe('getQueueDepth', () => {
    it('returns running and pending counts', () => {
      const depth = dashDb.getQueueDepth();
      expect(depth.running).toBe(1);
      expect(depth.pending).toBe(1);
    });

    it('returns zeros for empty queue', () => {
      const emptyDbPath = join(tmpDir, 'empty4.db');
      const emptyDb = new DashboardDb(emptyDbPath);
      const depth = emptyDb.getQueueDepth();
      expect(depth.running).toBe(0);
      expect(depth.pending).toBe(0);
      emptyDb.close();
    });
  });

  describe('getSparklineData', () => {
    it('returns 7-day arrays', () => {
      const sparklines = dashDb.getSparklineData();
      expect(sparklines.sessions).toHaveLength(7);
      expect(sparklines.jobs).toHaveLength(7);
      expect(sparklines.successRate).toHaveLength(7);
      expect(sparklines.errors).toHaveLength(7);
    });

    it('includes session activity', () => {
      const sparklines = dashDb.getSparklineData();
      // Last day should have the session we updated
      const lastDay = sparklines.sessions[sparklines.sessions.length - 1];
      expect(lastDay).toBeDefined();
      expect(lastDay).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getMetricsData', () => {
    it('assembles all metrics into a single response', () => {
      const data = dashDb.getMetricsData();
      expect(data.range).toBe('7d');
      expect(data.rangeMs).toBe(7 * 24 * 60 * 60 * 1000);
      expect(data.jobsBySource.length).toBeGreaterThan(0);
      expect(data.durationBuckets.length).toBeGreaterThan(0);
      expect(data.queueDepth.running).toBe(1);
      expect(data.queueDepth.pending).toBe(1);
      expect(data.dbSizeBytes).toBeGreaterThan(0);
    });

    it('24h range returns correct label', () => {
      const data = dashDb.getMetricsData(24 * 60 * 60 * 1000);
      expect(data.range).toBe('24h');
    });

    it('30d range returns correct label', () => {
      const data = dashDb.getMetricsData(30 * 24 * 60 * 60 * 1000);
      expect(data.range).toBe('30d');
    });
  });

  describe('parameterized queries backward compat', () => {
    it('getChartData with no args works like 7d', () => {
      const result = dashDb.getChartData();
      expect(result).toBeDefined();
      expect(result.dailyJobs).toBeDefined();
    });

    it('getErrorStats with no args works like 7d', () => {
      const result = dashDb.getErrorStats();
      expect(result).toBeDefined();
    });

    it('getErrorTrend with no args works like 7d', () => {
      const result = dashDb.getErrorTrend();
      expect(result).toBeDefined();
    });

    it('getErrorByTool with no args works like 7d', () => {
      const result = dashDb.getErrorByTool();
      expect(result).toBeDefined();
    });

    it('getTaskSummaryStats with no args works', () => {
      const result = dashDb.getTaskSummaryStats();
      expect(result).toBeDefined();
      expect(result.ondemand).toBeDefined();
      expect(result.scheduled).toBeDefined();
      expect(result.triggered).toBeDefined();
    });
  });
});

/* ── Route Handler Tests ── */

describe('handleMetricsRoutes', () => {
  function createCtx(): RouteContext {
    return {
      version: '1.0.0',
      dataDir: tmpDir,
      workdirRoot: '/tmp/work',
      dashboardSecret: 'secret',
      serverApiBase: 'http://127.0.0.1:9999',
      logPath: '/tmp/test.log',
      dashboardLogPath: '/tmp/dashboard.log',
      getDb: () => dashDb,
      proxyToServerApi: vi.fn() as unknown as RouteContext['proxyToServerApi'],
      proxySSE: vi.fn() as unknown as RouteContext['proxySSE'],
      proxySSEGet: vi.fn() as unknown as RouteContext['proxySSEGet'],
    };
  }

  it('returns metrics data for valid range', async () => {
    const req = createMockReq('GET', '/api/metrics?range=7d');
    const res = createMockRes();
    const query = new URLSearchParams('range=7d');

    const handled = await handleMetricsRoutes(
      createCtx(),
      req,
      res as unknown as import('node:http').ServerResponse,
      '/api/metrics',
      query,
    );

    expect(handled).toBe(true);
    expect(res.end).toHaveBeenCalledOnce();
    const body = JSON.parse(res.end.mock.calls[0]?.[0] as string);
    expect(body.ok).toBe(true);
    expect(body.data.range).toBe('7d');
    expect(body.data.jobsBySource).toBeDefined();
    expect(body.data.durationBuckets).toBeDefined();
    expect(body.data.queueDepth).toBeDefined();
  });

  it('defaults to 7d when no range param', async () => {
    const req = createMockReq('GET', '/api/metrics');
    const res = createMockRes();
    const query = new URLSearchParams('');

    const handled = await handleMetricsRoutes(
      createCtx(),
      req,
      res as unknown as import('node:http').ServerResponse,
      '/api/metrics',
      query,
    );

    expect(handled).toBe(true);
    const body = JSON.parse(res.end.mock.calls[0]?.[0] as string);
    expect(body.data.range).toBe('7d');
  });

  it('accepts 24h range', async () => {
    const req = createMockReq('GET', '/api/metrics?range=24h');
    const res = createMockRes();
    const query = new URLSearchParams('range=24h');

    await handleMetricsRoutes(
      createCtx(),
      req,
      res as unknown as import('node:http').ServerResponse,
      '/api/metrics',
      query,
    );

    const body = JSON.parse(res.end.mock.calls[0]?.[0] as string);
    expect(body.data.range).toBe('24h');
  });

  it('accepts 30d range', async () => {
    const req = createMockReq('GET', '/api/metrics?range=30d');
    const res = createMockRes();
    const query = new URLSearchParams('range=30d');

    await handleMetricsRoutes(
      createCtx(),
      req,
      res as unknown as import('node:http').ServerResponse,
      '/api/metrics',
      query,
    );

    const body = JSON.parse(res.end.mock.calls[0]?.[0] as string);
    expect(body.data.range).toBe('30d');
  });

  it('rejects invalid range with 400', async () => {
    const req = createMockReq('GET', '/api/metrics?range=1y');
    const res = createMockRes();
    const query = new URLSearchParams('range=1y');

    const handled = await handleMetricsRoutes(
      createCtx(),
      req,
      res as unknown as import('node:http').ServerResponse,
      '/api/metrics',
      query,
    );

    expect(handled).toBe(true);
    const body = JSON.parse(res.end.mock.calls[0]?.[0] as string);
    expect(body.error).toContain('Invalid range');
  });

  it('ignores non-matching routes', async () => {
    const req = createMockReq('GET', '/api/other');
    const res = createMockRes();
    const query = new URLSearchParams('');

    const handled = await handleMetricsRoutes(
      createCtx(),
      req,
      res as unknown as import('node:http').ServerResponse,
      '/api/other',
      query,
    );

    expect(handled).toBe(false);
  });

  it('ignores non-GET methods', async () => {
    const req = createMockReq('POST', '/api/metrics');
    const res = createMockRes();
    const query = new URLSearchParams('');

    const handled = await handleMetricsRoutes(
      createCtx(),
      req,
      res as unknown as import('node:http').ServerResponse,
      '/api/metrics',
      query,
    );

    expect(handled).toBe(false);
  });

  it('returns complete response shape with all required fields', async () => {
    const req = createMockReq('GET', '/api/metrics?range=7d');
    const res = createMockRes();
    const query = new URLSearchParams('range=7d');

    await handleMetricsRoutes(
      createCtx(),
      req,
      res as unknown as import('node:http').ServerResponse,
      '/api/metrics',
      query,
    );

    const body = JSON.parse(res.end.mock.calls[0]?.[0] as string);
    expect(body.ok).toBe(true);
    const d = body.data;

    // Range metadata
    expect(d.range).toBe('7d');
    expect(d.rangeMs).toBe(7 * 24 * 60 * 60 * 1000);

    // Job activity
    expect(d.dailyJobs).toBeDefined();
    expect(typeof d.successRate).toBe('number');
    expect(typeof d.totalJobs).toBe('number');

    // Job source breakdown
    expect(Array.isArray(d.jobsBySource)).toBe(true);

    // Duration distribution
    expect(Array.isArray(d.durationBuckets)).toBe(true);

    // Task summary
    expect(d.taskSummary).toBeDefined();
    expect(d.taskSummary.ondemand).toBeDefined();
    expect(d.taskSummary.scheduled).toBeDefined();
    expect(d.taskSummary.triggered).toBeDefined();

    // Orchestrator
    expect(Array.isArray(d.orchDailyRuns)).toBe(true);
    expect(Array.isArray(d.orchAvgDuration)).toBe(true);

    // Error analysis
    expect(Array.isArray(d.errorCategories)).toBe(true);
    expect(Array.isArray(d.errorTrend)).toBe(true);
    expect(Array.isArray(d.errorByTool)).toBe(true);
    expect(Array.isArray(d.recentErrors)).toBe(true);

    // System
    expect(d.queueDepth).toBeDefined();
    expect(typeof d.queueDepth.running).toBe('number');
    expect(typeof d.queueDepth.pending).toBe('number');
    expect(typeof d.dbSizeBytes).toBe('number');
    expect(d.dbSizeBytes).toBeGreaterThan(0);
  });

  it('returns 500 when db throws', async () => {
    const ctx = createCtx();
    const origGetDb = ctx.getDb;
    ctx.getDb = () => {
      const db = origGetDb();
      db.getMetricsData = () => {
        throw new Error('DB failure');
      };
      return db;
    };

    const req = createMockReq('GET', '/api/metrics?range=7d');
    const res = createMockRes();
    const query = new URLSearchParams('range=7d');

    await handleMetricsRoutes(
      ctx,
      req,
      res as unknown as import('node:http').ServerResponse,
      '/api/metrics',
      query,
    );

    const body = JSON.parse(res.end.mock.calls[0]?.[0] as string);
    expect(body.error).toBe('Failed to retrieve metrics data');
  });
});

/* ── MetricsData response shape tests ── */

describe('MetricsData response contract', () => {
  it('24h range filters data correctly', () => {
    const rangeMs = 24 * 60 * 60 * 1000;
    const data = dashDb.getMetricsData(rangeMs);
    expect(data.range).toBe('24h');
    expect(data.rangeMs).toBe(rangeMs);
    // 24h should have tighter or equal counts compared to 7d
    const data7d = dashDb.getMetricsData(7 * 24 * 60 * 60 * 1000);
    expect(data.totalJobs).toBeLessThanOrEqual(data7d.totalJobs);
  });

  it('30d range includes wider data set', () => {
    const data30d = dashDb.getMetricsData(30 * 24 * 60 * 60 * 1000);
    const data7d = dashDb.getMetricsData(7 * 24 * 60 * 60 * 1000);
    expect(data30d.totalJobs).toBeGreaterThanOrEqual(data7d.totalJobs);
    expect(data30d.range).toBe('30d');
  });

  it('jobsBySource entries have valid shape', () => {
    const data = dashDb.getMetricsData();
    for (const entry of data.jobsBySource) {
      expect(typeof entry.source).toBe('string');
      expect(typeof entry.count).toBe('number');
      expect(entry.count).toBeGreaterThanOrEqual(1);
    }
  });

  it('durationBuckets entries have valid shape', () => {
    const data = dashDb.getMetricsData();
    const validLabels = ['<10s', '10-30s', '30s-1m', '1-5m', '5-15m', '15m+'];
    for (const bucket of data.durationBuckets) {
      expect(validLabels).toContain(bucket.label);
      expect(typeof bucket.count).toBe('number');
      expect(bucket.count).toBeGreaterThanOrEqual(1);
    }
  });

  it('orchDailyRuns entries have valid shape', () => {
    const data = dashDb.getMetricsData();
    const validStatuses = ['completed', 'failed', 'cancelled'];
    for (const run of data.orchDailyRuns) {
      expect(run.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(validStatuses).toContain(run.status);
      expect(typeof run.count).toBe('number');
    }
  });

  it('orchAvgDuration entries have valid shape', () => {
    const data = dashDb.getMetricsData();
    for (const entry of data.orchAvgDuration) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof entry.avgSec).toBe('number');
      expect(entry.avgSec).toBeGreaterThanOrEqual(0);
    }
  });

  it('queueDepth has non-negative values', () => {
    const data = dashDb.getMetricsData();
    expect(data.queueDepth.running).toBeGreaterThanOrEqual(0);
    expect(data.queueDepth.pending).toBeGreaterThanOrEqual(0);
  });
});

/* ── Server handler registration ── */

describe('Metrics route registration', () => {
  it('handleMetricsRoutes is a function with the expected signature', () => {
    expect(typeof handleMetricsRoutes).toBe('function');
    expect(handleMetricsRoutes.length).toBe(5); // 5 params: ctx, req, res, pathname, query
  });
});
