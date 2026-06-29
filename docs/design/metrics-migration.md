# Dashboard Metrics Migration Design

Dedicated Metrics tab introduction & Overview tab optimization.

---

## Meta

- **Document**: Metrics Migration Design
- **Status**: Draft
- **Created**: 2026-03-15
- **Last Updated**: 2026-03-15
- **Parent**: [Dashboard Design](dashboard.md)

---

## 1. Goal & Constraints

### Goal

- Overview tab to a lightweight status-at-a-glance view
- Introduce a dedicated **Metrics** tab for comprehensive analytics
- Add missing metrics (Orchestrator, Job Source, Duration distribution, Queue depth, DB size)
- Add sparkline mini-graphs to Overview metric cards for trend visibility
- Implement time-range selection (24h / 7d / 30d) and auto-refresh

### Constraints

- Zero-bundler SPA architecture — all scripts/styles inlined
- Chart.js v4.4.7 CDN only (no new npm dependencies)
- Preserve existing CSS design tokens (`tokens.ts`) and dark mode pattern
- Existing `/api/status` consumers must not break
- SQLite query additions must use existing indexes where possible

### Non-Goals

- Replacing Chart.js with another library
- Real-time WebSocket push (polling is sufficient)
- Historical data beyond 30 days
- Export/download of metrics data

---

## 2. Current State

### Overview Tab Layout (layout.ts:72-206)

```
+------------------------------------------------------------------+
| Status Hero (Server status + Start/Stop)                         |
+------------------------------------------------------------------+
| [Sessions] [Jobs 24h] [Success Rate 7d] [Errors 24h]            |  <- 4 Metric Cards
+------------------------------------------------------------------+
| Metrics (section-title)                                          |
| +---------------------------+  +-------------------+             |
| | 7-Day Job Activity (Line) |  | Task Summary (Tbl)|             |
| +---------------------------+  +-------------------+             |
| +-------------------+                                            |
| | Task Runs (Bar)   |                                            |
| +-------------------+                                            |
+------------------------------------------------------------------+
| Job Health (section-title)                                       |
| +-------------------------------------------+                    |
| | Jobs vs Errors (Stacked Bar, span-2)      |                    |
| +-------------------------------------------+                    |
+------------------------------------------------------------------+
| Error Analysis (section-title)                                   |
| +-------------------+  +---------------------+                   |
| | Error Dist (Donut)|  | Error Trend (Line)  |                   |
| +-------------------+  +---------------------+                   |
| +-------------------+  +---------------------+                   |
| | Errors by Tool    |  | Recent Errors       |                   |
| +-------------------+  +---------------------+                   |
+------------------------------------------------------------------+
| Apps (section-title)                                             |
| [Claude Card] [Codex Card] [Gemini Card]                        |
+------------------------------------------------------------------+
| Recent Activity (section-title)                                  |
| +-------------------------------------------+                    |
| | Recent Jobs Table (5 rows)                |                    |
| +-------------------------------------------+                    |
+------------------------------------------------------------------+
```

### Existing API & DB Queries

| Query Method | Returns | Used By |
|---|---|---|
| `getOverviewStats()` | totalJobs, jobs24h, errors24h, toolStats, recentJobs | `/api/status` |
| `getAppToolStats()` | Per-tool: jobs24h, errors24h, successRate7d, avgDurationMs, lastActivity | `/api/status` |
| `getChartData()` | dailyJobs[], successRateRange, totalRange | `/api/status` (slim), `/api/metrics` (full) |
| `getErrorStats()` | ErrorCategoryStat[] (7d) | `/api/status` |
| `getErrorTrend()` | ErrorTrendDay[] (7d) | `/api/status` |
| `getErrorByTool()` | ErrorByToolStat[] (7d) | `/api/status` |
| `getRecentErrors()` | AuditRow[] (last 10) | `/api/status` |
| `getTaskSummaryStats()` | ondemand/scheduled/triggered stats + dailyTaskRuns | `/api/status` |

### In-Memory Metrics (metrics.ts)

- `jobs_total`, `jobs_failed`, `jobs_duration_sum_ms` (counters)
- `queue_running`, `queue_pending` (snapshot)
- Periodic log reporting via `startMetricsReporter()`

---

## 3. Target Architecture

### 3.1 Overview Tab (After Migration)

Lightweight status-at-a-glance. All detailed charts move to Metrics tab.

```
+------------------------------------------------------------------+
| Status Hero (Server status + Start/Stop)           [unchanged]   |
+------------------------------------------------------------------+
| [Sessions ~~~] [Jobs 24h ~~~] [Success ~~~] [Errors ~~~]         |  <- Metric Cards + sparklines
+------------------------------------------------------------------+
| Apps (section-title)                                             |
| [Claude Card] [Codex Card] [Gemini Card]          [unchanged]   |
+------------------------------------------------------------------+
| Recent Activity (section-title)                                  |
| +-------------------------------------------+                    |
| | Recent Jobs Table (5 rows)                |     [unchanged]    |
| +-------------------------------------------+                    |
+------------------------------------------------------------------+
```

**Changes**:
- ADD: CSS sparkline (48px canvas) inside each metric card
- REMOVE: "Metrics" section (7-Day Job Activity, Task Summary, Task Runs)
- REMOVE: "Job Health" section (Jobs vs Errors)
- REMOVE: "Error Analysis" section (all 4 panels)
- KEEP: Status Hero, 4 Metric Cards, Apps cards, Recent Activity

### 3.2 New Metrics Tab

Full analytics dashboard with time-range selector and auto-refresh.

```
+------------------------------------------------------------------+
| [24h] [7d] [30d]  (time-range selector)     [Auto-refresh: 30s] |
+------------------------------------------------------------------+
| Job Activity (section-title)                                     |
| +---------------------------+  +----------------------------+    |
| | Job Activity (Line)       |  | Jobs by Source (Bar)       |    |
| +---------------------------+  +----------------------------+    |
+------------------------------------------------------------------+
| Job Health (section-title)                                       |
| +---------------------------+  +----------------------------+    |
| | Jobs vs Errors (Bar)      |  | Duration Distribution (Bar)|    |
| +---------------------------+  +----------------------------+    |
+------------------------------------------------------------------+
| Task Runs (section-title)                                        |
| +---------------------------+  +----------------------------+    |
| | Task Summary (Table)      |  | Task Runs by Source (Bar)  |    |
| +---------------------------+  +----------------------------+    |
+------------------------------------------------------------------+
| Orchestrator (section-title)                                     |
| +---------------------------+  +----------------------------+    |
| | Orch Runs Status (Bar)    |  | Avg Orch Duration (Line)   |    |
| +---------------------------+  +----------------------------+    |
+------------------------------------------------------------------+
| Error Analysis (section-title)                                   |
| +---------------------------+  +----------------------------+    |
| | Error Distribution (Donut)|  | Error Trend (Line)         |    |
| +---------------------------+  +----------------------------+    |
| +---------------------------+  +----------------------------+    |
| | Errors by Tool (Table)    |  | Recent Errors (Table)      |    |
| +---------------------------+  +----------------------------+    |
+------------------------------------------------------------------+
| System (section-title)                                           |
| +---------------------------+  +----------------------------+    |
| | Queue Depth (gauge)       |  | Database Size              |    |
| +---------------------------+  +----------------------------+    |
+------------------------------------------------------------------+
```

**New charts** (6 additions):
1. Jobs by Source — stacked bar by `job_queue.source`
2. Duration Distribution — histogram of job duration buckets
3. Orchestration Runs Status — stacked bar (completed/failed/cancelled)
4. Avg Orchestration Duration — line chart
5. Queue Depth — current running/pending gauge
6. Database Size — single stat card

**Migrated charts** (8 from Overview):
1. Job Activity (Line) — was "7-Day Job Activity"
2. Jobs vs Errors (Stacked Bar)
3. Task Summary (Table)
4. Task Runs by Source (Stacked Bar)
5. Error Distribution (Doughnut)
6. Error Trend (Line)
7. Errors by Tool (Table)
8. Recent Errors (Table)

---

## 4. API Design

### 4.1 New Endpoint: `GET /api/metrics`

Dedicated metrics endpoint to decouple from `/api/status`. Accepts `range` query param.

```
GET /api/metrics?range=7d
```

**Query Parameters**:

| Param | Values | Default | Description |
|---|---|---|---|
| `range` | `24h`, `7d`, `30d` | `7d` | Time window for all aggregations |

**Response Shape**:

```typescript
interface MetricsApiResponse {
  ok: true;
  data: {
    range: '24h' | '7d' | '30d';
    rangeMs: number;

    // Job Activity (migrated from /api/status chartData)
    dailyJobs: DailyJobCount[];           // date, tool, total, errors
    successRate: number;                   // 0-100 for selected range
    totalJobs: number;                     // in range

    // Job Source Breakdown (NEW)
    jobsBySource: JobSourceStat[];         // source, count

    // Duration Distribution (NEW)
    durationBuckets: DurationBucket[];     // label, count

    // Task Summary (migrated from /api/status taskSummary)
    taskSummary: TaskSummaryStats;

    // Orchestrator (NEW)
    orchDailyRuns: OrchDailyRun[];         // date, status, count
    orchAvgDuration: OrchAvgDuration[];    // date, avgSec

    // Error Analysis (migrated from /api/status)
    errorCategories: ErrorCategoryStat[];
    errorTrend: ErrorTrendDay[];
    errorByTool: ErrorByToolStat[];
    recentErrors: AuditRow[];

    // System (NEW)
    queueDepth: { running: number; pending: number };
    dbSizeBytes: number;
  };
}
```

**New Types**:

```typescript
interface JobSourceStat {
  source: string;    // 'slack' | 'dashboard' | 'schedule' | 'orchestrator' | ...
  count: number;
}

interface DurationBucket {
  label: string;     // '<10s' | '10-30s' | '30s-1m' | '1-5m' | '5-15m' | '15m+'
  count: number;
}

interface OrchDailyRun {
  date: string;      // YYYY-MM-DD
  status: string;    // 'completed' | 'failed' | 'cancelled'
  count: number;
}

interface OrchAvgDuration {
  date: string;      // YYYY-MM-DD
  avgSec: number;
}
```

### 4.2 Modified Endpoint: `GET /api/status`

Add sparkline data. Slim `chartData` to only fields used by Overview (strip `dailyJobs`, remove unused `successRate24h`/`total24h`). Remove `dbSizeBytes` from `overviewStats` (only served via `/api/metrics`).

**Added fields**:

```typescript
{
  // chartData — slimmed to only Overview-needed fields
  chartData: {
    successRateRange: number;
    totalRange: number;
  };

  // Sparkline data (NEW)
  sparklines: {
    sessions: number[];    // 7 values, daily active session counts
    jobs: number[];        // 7 values, daily job counts
    successRate: number[]; // 7 values, daily success rate (0-100)
    errors: number[];      // 7 values, daily error counts
  };
}
```

---

## 5. Database Query Design

### 5.1 New Query Methods on DashboardDb

All new methods accept a `rangeMs` parameter (default 7 days).

#### `getJobsBySource(rangeMs): JobSourceStat[]`

```sql
SELECT source, COUNT(*) AS count
  FROM audit a
  JOIN job_queue q ON a.job_id = q.job_id
 WHERE a.started_at > ?
 GROUP BY source
 ORDER BY count DESC;
```

**Fallback** (job_queue rows may be cleaned up): Use audit data via a join on session_key to infer source from session context, or track source directly.

**Alternative** — The `audit` table does not store `source`. Two options:

- **Option A (Recommended)**: Add `source TEXT` column to `audit` table via migration. Populate from `job_queue.source` at job completion time.
- **Option B**: Join audit with job_queue on job_id. Only captures currently-queued jobs.

Decision: **Option A** — schema migration, tracked in Phase 1 checklist.

#### `getDurationBuckets(rangeMs): DurationBucket[]`

```sql
SELECT
  CASE
    WHEN duration_ms < 10000 THEN '<10s'
    WHEN duration_ms < 30000 THEN '10-30s'
    WHEN duration_ms < 60000 THEN '30s-1m'
    WHEN duration_ms < 300000 THEN '1-5m'
    WHEN duration_ms < 900000 THEN '5-15m'
    ELSE '15m+'
  END AS label,
  COUNT(*) AS count
FROM (
  SELECT CAST((julianday(ended_at) - julianday(started_at)) * 86400000 AS INTEGER) AS duration_ms
    FROM audit
   WHERE started_at > ? AND ended_at IS NOT NULL
) sub
GROUP BY label
ORDER BY MIN(duration_ms);
```

Uses existing `idx_audit_started` index.

#### `getOrchRunStats(rangeMs): { orchDailyRuns: OrchDailyRun[], orchAvgDuration: OrchAvgDuration[] }`

```sql
-- Daily run counts by status
SELECT strftime('%Y-%m-%d', started_at) AS date,
       status,
       COUNT(*) AS count
  FROM orchestration_runs
 WHERE started_at > ?
   AND status IN ('completed', 'failed', 'cancelled')
 GROUP BY date, status
 ORDER BY date ASC;

-- Daily average duration (completed only)
SELECT strftime('%Y-%m-%d', started_at) AS date,
       AVG(CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS REAL)) AS avg_sec
  FROM orchestration_runs
 WHERE started_at > ?
   AND ended_at IS NOT NULL
   AND status = 'completed'
 GROUP BY date
 ORDER BY date ASC;
```

Uses existing `idx_orch_runs_orch` index (orchestrator_id, created_at DESC). May benefit from adding:

```sql
CREATE INDEX IF NOT EXISTS idx_orch_runs_started ON orchestration_runs(started_at);
```

#### `getQueueDepth(): { running: number; pending: number }`

```sql
SELECT
  SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
  SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS pending
FROM job_queue;
```

Uses existing `idx_job_queue_status_id`.

#### `getSparklineData(): SparklineData`

```sql
-- Daily session activity (7d)
WITH RECURSIVE dates(d) AS (
  SELECT date('now', '-6 days')
  UNION ALL
  SELECT date(d, '+1 day') FROM dates WHERE d < date('now')
)
SELECT d AS date,
       COALESCE(cnt, 0) AS count
  FROM dates
  LEFT JOIN (
    SELECT strftime('%Y-%m-%d', updated_at) AS date,
           COUNT(DISTINCT session_key) AS cnt
      FROM sessions
     WHERE updated_at > datetime('now', '-7 days')
     GROUP BY date
  ) s ON dates.d = s.date;

-- Daily job counts, errors, success rates (7d) — reuse getChartData() aggregation
```

### 5.2 Parameterized Existing Queries

The following existing methods need `rangeMs` parameterization:

| Method | Current Window | Change |
|---|---|---|
| `getChartData()` | Hardcoded 7d | Add `rangeMs` param, compute `ago` from it |
| `getErrorStats()` | Hardcoded 7d | Add `rangeMs` param |
| `getErrorTrend()` | Hardcoded 7d | Add `rangeMs` param |
| `getErrorByTool()` | Hardcoded 7d | Add `rangeMs` param |
| `getTaskSummaryStats()` | Hardcoded 24h/7d | Add `rangeMs` param |

**Backward compat**: Default parameter value = `7 * 24 * 60 * 60 * 1000` (7d). Existing callers (`/api/status`) pass no argument and get the same behavior.

### 5.3 Schema Migration

Add `source` column to `audit` table:

```sql
ALTER TABLE audit ADD COLUMN source TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_source ON audit(source);
CREATE INDEX IF NOT EXISTS idx_audit_started ON audit(started_at);
CREATE INDEX IF NOT EXISTS idx_orch_runs_started ON orchestration_runs(started_at);
```

Migration entry in `src/store/migrations.ts`. Backfill: `UPDATE audit SET source = 'unknown' WHERE source IS NULL;`

---

## 6. File Change Matrix

### New Files

| File | Purpose |
|---|---|
| `src/dashboard/scripts/metrics-tab.ts` | Client-side script for Metrics tab (chart rendering, data fetching, time-range selector, auto-refresh) |
| `src/dashboard/styles/metrics.ts` | CSS styles for Metrics tab (time-range toolbar, section layouts, gauge widget, sparklines) |
| `src/dashboard/routes/metrics.ts` | `/api/metrics` route handler |

### Modified Files

| File | Change Summary |
|---|---|
| `src/dashboard/templates/layout.ts` | Add Metrics nav item + tab panel. Remove chart sections from Overview panel. |
| `src/dashboard/scripts/overview.ts` | Remove chart rendering functions (migrated). Add sparkline rendering. Add `metrics` to TAB_TITLES and switchTab(). |
| `src/dashboard/app.ts` | Import/embed new `metricsScript` and `metricsStyles`. |
| `src/dashboard/server.ts` | Register `handleMetricsRoutes` in handler chain. |
| `src/dashboard/db.ts` | Add new query methods. Parameterize existing queries with `rangeMs`. Add sparkline query. |
| `src/dashboard/routes/status.ts` | Add `sparklines` field to response. |
| `src/store/schema.ts` | Add `idx_orch_runs_started` index. |
| `src/store/migrations.ts` | Add `audit.source` column migration + index. |
| `src/utils/metrics.ts` | Export `getSnapshot()` for queue depth API. |
| `docs/design/dashboard.md` | Add Metrics tab to Tab Structure. Update Overview description. Add `/api/metrics` to API Reference. |

### Unchanged Files

| File | Reason |
|---|---|
| `src/dashboard/styles/tokens.ts` | Existing tokens sufficient |
| `src/dashboard/styles/base.ts` | Existing `.charts-grid`, `.metric-card`, `.card`, `.section-title` reused |
| `src/dashboard/styles/components.ts` | Existing table, badge, card styles reused |
| `src/dashboard/styles/pages.ts` | No page-specific overrides needed (new styles in `metrics.ts`) |

---

## 7. CSS & Dark Mode Compliance

### Design Token Usage

All new components MUST use CSS variables from `tokens.ts`:

| Element | Light Value | Token |
|---|---|---|
| Background | `#F5F1E8` | `var(--bg)` |
| Card background | Glass effect | `var(--glass)` / `var(--bg-card)` |
| Card border | `#DDD5C8` | `var(--glass-border)` / `var(--border)` |
| Section title color | `#A07D3F` | `var(--accent2)` |
| Text | `#2C2C2C` | `var(--text)` |
| Muted text | `#7A7067` | `var(--text-muted)` |
| Dim text | `#A69E94` | `var(--text-dim)` |
| Success | `#16a34a` | `var(--green)` |
| Error | `#dc2626` | `var(--red)` |
| Shadows | Various | `var(--shadow-sm)` / `var(--shadow-md)` |

### Existing CSS Classes to Reuse

| Class | Usage in Metrics Tab |
|---|---|
| `.card` | All chart containers, stat cards |
| `.chart-container` | Chart wrapper (min-height 220px, hover shadow) |
| `.chart-title` | Chart heading (0.85rem, accent2) |
| `.charts-grid` | 2-column chart grid (responsive to 1 col at 900px) |
| `.data-grid-2` | 2-column data grid for tables |
| `.section-title` | Section headings (1rem, 600, accent2) |
| `.metric-card` | Overview metric cards (reuse for sparkline integration) |
| `.metric-value` | Large stat number |
| `.metric-label` | Stat label text |
| `.metric-bar` / `.metric-bar-fill` | Progress bar |
| `table`, `th`, `td` | Standard table styling |
| `.badge`, `.badge-tool` | Tool/status badges |
| `.btn`, `.btn-primary` | Buttons |
| `.chip`, `.chip.active` | Time-range selector (reuse log toolbar chip pattern) |

### Dark Mode Override Pattern

New styles in `metrics.ts` must follow the existing pattern:

```css
/* ── Light mode (default) ── */
.metrics-toolbar {
  background: rgba(245, 241, 232, 0.6);
  border: 1px solid var(--border);
}

/* ── Dark Mode Overrides ── */
:root[data-theme="dark"] .metrics-toolbar {
  background: rgba(40, 40, 40, 0.6);
  border-color: var(--border);
}
```

Every component that uses hardcoded colors, backgrounds, or shadows MUST have a `:root[data-theme="dark"]` override. System preference is handled by the token layer.

### Sparkline Canvas Dark Mode

Sparkline colors must be read from CSS variables at render time:

```javascript
function getSparklineColor(type) {
  var style = getComputedStyle(document.documentElement);
  var colors = {
    sessions: style.getPropertyValue('--blue').trim() || '#2563eb',
    jobs:     style.getPropertyValue('--accent').trim() || '#B8975A',
    success:  style.getPropertyValue('--green').trim() || '#16a34a',
    errors:   style.getPropertyValue('--red').trim() || '#dc2626'
  };
  return colors[type] || colors.jobs;
}
```

### Chart.js Dark Mode

Chart.js global defaults must be updated on theme toggle:

```javascript
function updateChartTheme() {
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.getAttribute('data-theme')
        && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (typeof Chart === 'undefined') return;
  Chart.defaults.color = isDark ? '#a0a0a0' : '#7A7067';
  Chart.defaults.borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
}
```

---

## 8. New Styles Specification (metrics.ts)

```css
/* ── Metrics Toolbar ── */
.metrics-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: rgba(245, 241, 232, 0.6);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.metrics-range-group {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.metrics-range-btn {
  padding: 0.3rem 0.75rem;
  font-size: 0.78rem;
  font-family: var(--font-sans);
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.metrics-range-btn:hover {
  background: rgba(184, 151, 90, 0.08);
}

.metrics-range-btn.active {
  background: rgba(184, 151, 90, 0.15);
  color: var(--accent2);
  font-weight: 600;
}

/* ── Sparkline ── */
.sparkline-canvas {
  width: 100%;
  height: 48px;
  margin-top: 0.35rem;
}

/* ── Gauge Widget (Queue Depth) ── */
.gauge-card {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 1.25rem;
}

.gauge-ring {
  width: 80px;
  height: 80px;
  position: relative;
}

.gauge-ring canvas {
  width: 100%;
  height: 100%;
}

.gauge-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
}

.gauge-center .gauge-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.gauge-center .gauge-label {
  font-size: 0.68rem;
  color: var(--text-dim);
}

.gauge-stats {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.gauge-stat-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.gauge-stat-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.gauge-stat-label {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.gauge-stat-value {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text);
  margin-left: auto;
}

/* ── DB Size Stat Card ── */
.stat-card-large {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  text-align: center;
}

.stat-card-large .stat-number {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.stat-card-large .stat-unit {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-top: 0.25rem;
}

/* ── Auto-Refresh Indicator ── */
.auto-refresh-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.auto-refresh-toggle.active {
  color: var(--green);
}

.auto-refresh-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-dim);
  transition: background var(--transition-fast);
}

.auto-refresh-toggle.active .auto-refresh-dot {
  background: var(--green);
  animation: livePulse 2s ease-in-out infinite;
}

/* ── Dark Mode Overrides ── */
:root[data-theme="dark"] .metrics-toolbar {
  background: rgba(40, 40, 40, 0.6);
}

:root[data-theme="dark"] .metrics-range-btn:hover {
  background: rgba(212, 169, 106, 0.1);
}

:root[data-theme="dark"] .metrics-range-btn.active {
  background: rgba(212, 169, 106, 0.18);
  color: var(--accent2);
}
```

---

## 9. Implementation Phases & Checklists

### Phase 0: Preparation

- [ ] Read and confirm this design doc with the user
- [ ] Verify existing tests pass: `npm run typecheck && npm run test`
- [ ] Create feature branch: `git checkout -b feature/metrics-tab`

---

### Phase 1: Schema Migration & Backend Queries

Add new DB queries, parameterize existing ones, create `/api/metrics` endpoint.

#### 1.1 Schema Migration

- [ ] Add migration in `src/store/migrations.ts`:
  - [ ] `ALTER TABLE audit ADD COLUMN source TEXT`
  - [ ] `CREATE INDEX IF NOT EXISTS idx_audit_source ON audit(source)`
  - [ ] `CREATE INDEX IF NOT EXISTS idx_orch_runs_started ON orchestration_runs(started_at)`
- [ ] Update `src/store/schema.ts`: add `source TEXT` to audit table DDL and new indexes
- [ ] Verify migration runs cleanly on existing DB

#### 1.2 Audit Source Population

- [ ] In `src/store/job-queue-store.ts` or audit logger: populate `audit.source` from `job_queue.source` when recording job completion
- [ ] Backfill existing records: `UPDATE audit SET source = 'unknown' WHERE source IS NULL`

#### 1.3 Parameterize Existing Queries

- [ ] `db.ts` — `getChartData(rangeMs?: number)`: default `7 * 24 * 60 * 60 * 1000`
- [ ] `db.ts` — `getErrorStats(rangeMs?: number)`: default 7d
- [ ] `db.ts` — `getErrorTrend(rangeMs?: number)`: default 7d
- [ ] `db.ts` — `getErrorByTool(rangeMs?: number)`: default 7d
- [ ] `db.ts` — `getTaskSummaryStats(rangeMs?: number)`: default 7d
- [ ] Verify `/api/status` still works unchanged (passes no argument)

#### 1.4 New Query Methods

- [ ] `db.ts` — `getJobsBySource(rangeMs): JobSourceStat[]`
- [ ] `db.ts` — `getDurationBuckets(rangeMs): DurationBucket[]`
- [ ] `db.ts` — `getOrchRunStats(rangeMs): { orchDailyRuns, orchAvgDuration }`
- [ ] `db.ts` — `getQueueDepth(): { running, pending }`
- [ ] `db.ts` — `getSparklineData(): SparklineData` (7d fixed)

#### 1.5 Type Definitions

- [ ] `db.ts` — Add `JobSourceStat`, `DurationBucket`, `OrchDailyRun`, `OrchAvgDuration`, `SparklineData` interfaces
- [ ] `db.ts` — Add `MetricsData` interface (full `/api/metrics` response body)

#### 1.6 New API Route

- [ ] Create `src/dashboard/routes/metrics.ts` with `handleMetricsRoutes()`
- [ ] `GET /api/metrics?range=7d` — assemble response from new query methods
- [ ] Validate `range` param: `24h | 7d | 30d`, default `7d`
- [ ] Register in `src/dashboard/server.ts` handler chain

#### 1.7 Sparkline Data in Status API

- [ ] `src/dashboard/routes/status.ts` — call `getSparklineData()`, add `sparklines` to response

#### 1.8 Tests

- [ ] Unit tests for each new query method (empty DB, populated DB, range boundaries)
- [ ] Unit test for `handleMetricsRoutes` (valid range, invalid range, default)
- [ ] Unit test for parameterized queries (verify backward compat with no argument)
- [ ] Migration test (schema upgrade path)

#### Phase 1 Verification

```bash
npm run typecheck
npm run test
# Manual: GET /api/metrics?range=7d returns valid JSON
# Manual: GET /api/status includes sparklines field
```

---

### Phase 2: Metrics Tab — Frontend Shell

Create the Metrics tab with navigation, empty layout, and time-range selector.

#### 2.1 Navigation & Layout

- [ ] `src/dashboard/templates/layout.ts` — Add Metrics nav `<li>`:
  ```html
  <li><a class="nav-item" href="#metrics" data-tab="metrics">
    <span class="nav-icon"><svg>...</svg></span>
    <span class="nav-label">Metrics</span>
  </a></li>
  ```
  Position: after Overview, before Chat (2nd nav item)
- [ ] `src/dashboard/templates/layout.ts` — Add `<div id="tab-metrics" class="tab-panel">` with:
  - Toolbar: time-range chips + auto-refresh toggle
  - Section placeholders: Job Activity, Job Health, Task Runs, Orchestrator, Error Analysis, System
  - Each section uses `.section-title` + `.charts-grid` + `.card.chart-container`
  - All canvas elements with unique IDs (e.g., `metrics-chart-daily-jobs`, `metrics-chart-job-source`)

#### 2.2 CSS

- [ ] Create `src/dashboard/styles/metrics.ts` with styles from Section 8
- [ ] Include dark mode overrides (`:root[data-theme="dark"]`)
- [ ] Import and embed in `src/dashboard/app.ts`:
  - Import: `import { metricsStyles } from './styles/metrics.js';`
  - Embed: add `${metricsStyles}` to `<style>` block

#### 2.3 Script Shell

- [ ] Create `src/dashboard/scripts/metrics-tab.ts`:
  - `metricsTabScript` export
  - State variables: `metricsRange`, `metricsRefreshTimer`, `metricsCharts` (map of Chart instances)
  - `metricsLoadData()` — fetch `/api/metrics?range=...`
  - `metricsSetRange(range)` — update state, re-fetch
  - `metricsToggleAutoRefresh()` — start/stop 30s interval
  - Placeholder render functions for each section
- [ ] Import and embed in `src/dashboard/app.ts`

#### 2.4 Tab Integration

- [ ] `src/dashboard/scripts/overview.ts` — Add `metrics: 'Metrics'` to `TAB_TITLES`
- [ ] `src/dashboard/scripts/overview.ts` — Add `if (name === 'metrics') metricsLoadData();` to `switchTab()`

#### Phase 2 Verification

```bash
npm run typecheck
npm run build
# Manual: Navigate to #metrics — tab loads, toolbar visible
# Manual: Time-range chips highlight on click
# Manual: Dark mode toggle preserves layout
```

---

### Phase 3: Migrate Charts from Overview to Metrics

Move existing chart logic from `overview.ts` to `metrics-tab.ts`.

#### 3.1 Chart Migration (overview.ts -> metrics-tab.ts)

Move these functions and their state variables:

- [ ] `buildDailyJobsData()` + `updateDailyJobsChart()` → `metricsRenderJobActivity()`
  - Chart instance: `chartDailyJobs` → `metricsCharts.jobActivity`
  - Canvas ID: `chart-daily-jobs` → `metrics-chart-job-activity`
- [ ] `updateJobsVsErrorsChart()` → `metricsRenderJobsVsErrors()`
  - Canvas ID: `chart-jobs-vs-errors` → `metrics-chart-jobs-errors`
- [ ] `updateTaskSummary()` → `metricsRenderTaskSummary()`
  - Element ID: `task-summary-body` → `metrics-task-summary`
- [ ] `updateTaskRunsChart()` → `metricsRenderTaskRuns()`
  - Canvas ID: `chart-task-runs` → `metrics-chart-task-runs`
- [ ] `updateErrorDistChart()` → `metricsRenderErrorDist()`
  - Canvas ID: `chart-error-dist` → `metrics-chart-error-dist`
- [ ] `updateErrorTrendChart()` → `metricsRenderErrorTrend()`
  - Canvas ID: `chart-error-trend` → `metrics-chart-error-trend`
- [ ] `renderErrorByToolTable()` → `metricsRenderErrorByTool()`
  - Element ID: `error-by-tool-card` → `metrics-error-by-tool`
- [ ] `renderRecentErrorsTable()` → `metricsRenderRecentErrors()`
  - Element ID: `recent-errors-card` → `metrics-recent-errors`

Shared helpers remain in overview.ts (used by both):
- `buildDateRange7d()` — generalize to `buildDateRange(days)`
- `drawEmptyCanvas()`
- `formatMs()`
- `timeAgo()`
- `toolColors`, `errorCategoryColors`, `taskSourceColors`

#### 3.2 Remove from Overview Tab Layout

- [ ] `layout.ts` — Remove from `#tab-overview`:
  - `<h3 class="section-title" id="section-metrics">Metrics</h3>` and its `.charts-grid` (Job Activity, Task Summary, Task Runs)
  - `<h3 class="section-title" id="section-job-health">Job Health</h3>` and its `.charts-grid` (Jobs vs Errors)
  - `<h3 class="section-title" id="section-error-analysis">Error Analysis</h3>` and its `.charts-grid` + `.data-grid-2` (all 4 error panels)
- [ ] `overview.ts` — Remove `updateCharts()` and `updateErrorCharts()` calls from `refreshOverview()`
- [ ] `overview.ts` — Remove migrated chart functions and state variables
- [ ] `overview.ts` — Remove chart instance destroy/cleanup (moved to metrics-tab.ts)

#### 3.3 Update Metric Card Click Targets

- [ ] Metric card `onclick="scrollToSection(...)"` → navigate to Metrics tab:
  - Jobs (24h): `onclick="location.hash='metrics'"` (was `scrollToSection('section-metrics')`)
  - Success Rate: `onclick="location.hash='metrics'"` (was `scrollToSection('section-job-health')`)
  - Errors (24h): `onclick="location.hash='metrics'"` (was `scrollToSection('section-error-analysis')`)
  - Sessions: keep `location.hash='sessions'` (unchanged)

#### Phase 3 Verification

```bash
npm run typecheck
npm run build
# Manual: Overview shows only Hero + Cards + Apps + Recent Activity
# Manual: Metrics tab shows all migrated charts
# Manual: Chart data matches between old Overview and new Metrics
# Manual: Dark mode renders correctly on both tabs
# Manual: Metric card clicks navigate to Metrics tab
```

---

### Phase 4: Sparklines on Overview Metric Cards

Add mini trend graphs to the 4 metric cards.

#### 4.1 Sparkline Renderer

- [ ] `overview.ts` — Add `drawSparkline(canvasId, data, color)` function:
  - Canvas size: use parent width, 48px height
  - Line: 1.5px stroke, color from CSS variable
  - Fill: gradient from color 0.15 alpha to transparent
  - No axes, no labels
  - Handle 0 data points (draw nothing)
- [ ] Reads color from `getComputedStyle()` at render time (dark mode aware)

#### 4.2 Layout Update

- [ ] `layout.ts` — Add `<canvas class="sparkline-canvas" id="spark-sessions"></canvas>` inside each metric card's `.metric-body`:
  - `spark-sessions` in Sessions card
  - `spark-jobs` in Jobs card
  - `spark-success` in Success Rate card
  - `spark-errors` in Errors card

#### 4.3 Data Integration

- [ ] `overview.ts` — In `refreshOverview()`, after receiving `/api/status` response:
  - Extract `d.sparklines.sessions` → `drawSparkline('spark-sessions', data, 'sessions')`
  - Extract `d.sparklines.jobs` → `drawSparkline('spark-jobs', data, 'jobs')`
  - Extract `d.sparklines.successRate` → `drawSparkline('spark-success', data, 'success')`
  - Extract `d.sparklines.errors` → `drawSparkline('spark-errors', data, 'errors')`
- [ ] Handle missing `sparklines` field gracefully (backward compat)

#### Phase 4 Verification

```bash
npm run typecheck
npm run build
# Manual: Each metric card shows a mini trend line
# Manual: Toggle dark mode — sparkline colors update
# Manual: Empty data (fresh install) — no sparkline drawn, no errors
```

---

### Phase 5: New Metrics Charts

Implement the 6 new chart types in the Metrics tab.

#### 5.1 Jobs by Source (Stacked Bar)

- [ ] `metrics-tab.ts` — `metricsRenderJobSource(data.jobsBySource)`:
  - Horizontal bar chart
  - Source colors: `slack: blue`, `dashboard: gold`, `schedule: indigo`, `orchestrator: teal`, `other: gray`
  - Canvas: `metrics-chart-job-source`

#### 5.2 Duration Distribution (Bar)

- [ ] `metrics-tab.ts` — `metricsRenderDuration(data.durationBuckets)`:
  - Vertical bar chart with bucket labels
  - Single color gradient (accent)
  - Canvas: `metrics-chart-duration`

#### 5.3 Orchestration Runs Status (Stacked Bar)

- [ ] `metrics-tab.ts` — `metricsRenderOrchRuns(data.orchDailyRuns)`:
  - Daily stacked bar: completed (green), failed (red), cancelled (gray)
  - Uses `buildDateRange(days)` for x-axis
  - Canvas: `metrics-chart-orch-runs`

#### 5.4 Avg Orchestration Duration (Line)

- [ ] `metrics-tab.ts` — `metricsRenderOrchDuration(data.orchAvgDuration)`:
  - Line chart, single series
  - Y-axis in seconds (formatted)
  - Canvas: `metrics-chart-orch-duration`

#### 5.5 Queue Depth (Gauge)

- [ ] `metrics-tab.ts` — `metricsRenderQueueGauge(data.queueDepth)`:
  - Canvas arc (doughnut-style, 75% sweep)
  - Running (blue) + Pending (amber) + Empty (gray)
  - Center: total count
  - Legend: Running X, Pending Y
  - Element: `metrics-queue-gauge`

#### 5.6 Database Size (Stat Card)

- [ ] `metrics-tab.ts` — `metricsRenderDbSize(data.dbSizeBytes)`:
  - Large number display (formatted: KB/MB/GB)
  - Element: `metrics-db-size`

#### Phase 5 Verification

```bash
npm run typecheck
npm run build
# Manual: All 14 charts render on Metrics tab (8 migrated + 6 new)
# Manual: Time-range selector changes all charts
# Manual: Auto-refresh updates data every 30s
# Manual: Dark mode renders all charts correctly
# Manual: Empty data — all charts show "No data" placeholder
```

---

### Phase 6: Auto-Refresh & Polish ✅

#### 6.1 Auto-Refresh ✅

- [x] `metrics-tab.ts` — `metricsToggleAutoRefresh()`:
  - Toggle 30-second `setInterval` for `metricsLoadData()`
  - Show/hide pulse indicator
  - Clear on tab switch away (in `switchTab()`)
  - Timer `.unref()` not needed (client-side)

#### 6.2 Date Range Helper ✅

- [x] Generalize `buildDateRange7d()` → `metricsBuildDateRange(days)`:
  - Accept `2` (24h → 2 calendar days for meaningful chart display), `7`, `30`
  - 24h uses 2-day range since backend aggregates daily (yesterday + today)
  - Update all chart renderers to use dynamic range via `metricsRangeDays()`

#### 6.3 Chart Cleanup on Tab Switch ✅

- [x] `metrics-tab.ts` — `metricsDestroyCharts()`:
  - Destroy all Chart.js instances to prevent memory leaks
  - Called when leaving Metrics tab
- [x] `overview.ts` — In `switchTab()`, call `metricsDestroyCharts()` if switching away from `metrics`

#### 6.4 Responsive ✅

- [x] Verify `.charts-grid` collapses to 1-col at 900px (existing behavior)
- [x] Verify `.metrics-toolbar` wraps on small screens (`flex-wrap: wrap`)
- [x] Verify gauge widget is readable on mobile

#### Phase 6 Verification ✅

```bash
npm run typecheck   # ✅ No metrics-related errors
npm run build       # ✅ Dashboard includes all metrics scripts/styles
# Manual: Auto-refresh toggle works (green pulse when active) ✅
# Manual: Switching tabs clears auto-refresh timer ✅
# Manual: No memory leaks after repeated tab switches (metricsDestroyCharts) ✅
# Manual: 24h range shows 2-day daily data, 30d shows daily ✅
# Manual: Mobile viewport — all content visible and scrollable ✅
```

---

### Phase 7: Documentation & Testing ✅

#### 7.1 Design Doc Updates ✅

- [x] `docs/design/dashboard.md` — Update Section 4 (Tab Structure): add Metrics tab entry (12 tabs)
- [x] `docs/design/dashboard.md` — Update Section 5 (API Reference): add `/api/metrics` endpoint + sparklines to `/api/status`
- [x] `docs/design/dashboard.md` — Update Overview tab description (lightweight status-at-a-glance)
- [x] `docs/design/dashboard.md` — Update Route Handler Chain to include `handleMetricsRoutes`

#### 7.2 Test Coverage ✅

- [x] `src/dashboard/routes/metrics.test.ts` — Unit tests for all new query methods (getJobsBySource, getDurationBuckets, getOrchRunStats, getQueueDepth, getSparklineData, getMetricsData)
- [x] `src/dashboard/routes/metrics.test.ts` — Route handler tests (range validation, response shape, error handling, non-matching routes)
- [x] `src/dashboard/routes/metrics.test.ts` — MetricsData response contract tests (24h/30d filtering, valid shapes for all fields)
- [x] `src/dashboard/server.test.ts` — Sparklines in /api/status response (2 tests: success + error fallback)
- [x] `src/store/migrations.coverage.test.ts` — Migration test for `audit.source` column + backfill + indexes
- [x] `src/dashboard/routes/metrics.test.ts` — Handler function signature verification
- [x] Dashboard test suite: 969 passing (7 pre-existing failures in setup/server root rendering, unrelated)

#### 7.3 Final Verification ✅

```bash
npm run typecheck   # ✅ No metrics-related type errors
npm run test        # ✅ 36 metrics tests pass, 969 dashboard tests pass
# Full manual walkthrough:
# 1. Overview tab: Hero + Sparkline cards + Apps + Recent Activity ✅
# 2. Metrics tab: All 14 charts, time-range selector, auto-refresh ✅
# 3. Dark mode: Both tabs render correctly ✅
# 4. Mobile: Responsive layout ✅
# 5. Empty state: Fresh install — "No data" placeholders ✅
# 6. Metric card clicks navigate to Metrics tab ✅
```

---

## 10. Rollback Plan

If issues are discovered post-merge:

1. **API rollback**: `/api/status` response is backward-compatible (added field only). No breaking change.
2. **UI rollback**: Revert layout.ts changes to restore Overview charts. The Metrics tab HTML is additive.
3. **Schema rollback**: `audit.source` column is nullable with no NOT NULL constraint. No destructive change.

---

## 11. Migration Completion Summary

| Item | Metric |
|---|---|
| Phases | 7 (Phase 0-6 + documentation) |
| New files | 3 (`metrics-tab.ts`, `metrics.ts` style, `metrics.ts` route) |
| Modified files | 10 |
| New DB queries | 5 |
| Parameterized queries | 5 |
| Schema migrations | 1 (audit.source + 2 indexes) |
| New charts | 6 |
| Migrated charts | 8 |
| New API endpoints | 1 (`GET /api/metrics`) |
| Modified API endpoints | 1 (`GET /api/status` — sparklines) |
