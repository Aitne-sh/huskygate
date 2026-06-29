/** @module dashboard/db — Read-only SQLite facade for dashboard queries. */
import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { isToolName } from '../config.js';
import type {
  OrchestrationNodeRun,
  OrchestrationRun,
  Orchestrator,
  OrchestratorEdge,
  OrchestratorNode,
} from '../orchestrator/types.js';
import type { ToolState } from '../session/types.js';
import { mapNodeRun, mapRun } from '../shared/mappers/orchestrator-run.js';
import { resolveSessionMcpServerSelection } from '../shared/mcp-server-selection.js';
import { SESSION_LIST_BY_TOOL_QUERY, SESSION_LIST_QUERY } from '../shared/queries.js';
import { safeParseToolState } from '../shared/tool-state.js';
import { ConfigStore } from '../store/config-store.js';
import { ensureSchema } from '../store/database.js';
import { DefaultInstructionStore } from '../store/default-instruction.js';
import { type DevAlias, DevAliasStore } from '../store/dev-alias.js';
import {
  type McpServerRecord,
  McpServerStore,
  type McpServerTool,
  type McpServerTransport,
} from '../store/mcp-server.js';
import { OndemandTaskStore } from '../store/ondemand-task.js';
import type { OndemandTask, OndemandTaskRun } from '../store/ondemand-task.js';
import { OrchestratorStore } from '../store/orchestrator.js';
import { ScheduleStore } from '../store/schedule.js';
import type { ScheduledTask, ScheduledTaskRun } from '../store/schedule.js';
import { SessionMcpServerStore } from '../store/session-mcp-server.js';
import { SkillEnablementStore } from '../store/skill-enablement.js';
import { boolFromDb } from '../utils/db.js';
import {
  applySqliteConnectionPragmas,
  tightenSqliteRuntimeFilePermissions,
} from '../utils/sqlite.js';

/* ── Enriched types (dashboard-specific extra fields) ── */

interface OrchestratorListItem extends Orchestrator {
  nodeCount: number;
  lastRunStatus: string | null;
  lastRunEndedAt: string | null;
  lastRunError: string | null;
}

interface OrchestratorDetail extends Orchestrator {
  nodes: OrchestratorNode[];
  edges: OrchestratorEdge[];
}

interface OrchestrationRunDetail extends OrchestrationRun {
  nodeRuns: OrchestrationNodeRun[];
}

export interface DashboardSession {
  sessionKey: string;
  sessionId: string;
  threadKey: string;
  userId: string;
  tool: string;
  mode: string;
  workdir: string;
  runningJobId: string | null;
  startedAt: string;
  updatedAt: string;
  active: boolean;
}

export interface SessionMcpServerState {
  sessionId: string;
  sessionKey: string;
  tool: McpServerTool;
  mode: string;
  filterActive: boolean;
  servers: Array<
    Pick<McpServerRecord, 'id' | 'name' | 'tool' | 'transport'> & {
      enabled: boolean;
    }
  >;
}

export interface AuditRow {
  jobId: string;
  sessionKey: string;
  userId: string;
  tool: string;
  mode: string;
  workdir: string;
  promptHash: string | null;
  source: string | null;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  errorKind: string | null;
}

export interface ChatMessage {
  id: number;
  sessionKey: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

interface SessionListDbRow {
  session_key: string;
  session_id: string;
  thread_key: string;
  user_id: string;
  tool: string;
  mode: string;
  workdir: string;
  running_job_id: string | null;
  started_at: string;
  updated_at: string;
  is_active: number;
}

interface AuditDbRow {
  job_id: string;
  session_key: string;
  user_id: string;
  tool: string;
  mode: string;
  workdir: string;
  prompt_hash: string | null;
  source: string | null;
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  error_kind: string | null;
}

interface ChatMessageDbRow {
  id: number;
  session_key: string;
  role: string;
  content: string;
  created_at: string;
}

interface ToolStateDbRow {
  session_key: string;
  tool_state: string;
}

interface SessionMcpContextRow {
  session_key: string;
  tool: string;
  mode: string;
}

export interface DailyJobCount {
  date: string; // 'YYYY-MM-DD'
  tool: string; // 'claude' | 'codex' | 'gemini'
  total: number;
  errors: number;
}

export interface ChartData {
  dailyJobs: DailyJobCount[];
  successRateRange: number; // 0–100 for the selected range
  totalRange: number;
}

export interface OverviewStats {
  totalJobs: number;
  jobs24h: number;
  errors24h: number;
  toolStats: { tool: string; count: number }[];
  recentJobs: AuditRow[];
}

export interface AppToolStat {
  tool: string;
  jobs24h: number;
  errors24h: number;
  successRate7d: number; // 0–100
  avgDurationMs: number | null;
  lastActivityAt: string | null;
}

export interface ErrorCategoryStat {
  category: string;
  count: number;
}

export interface ErrorTrendDay {
  date: string;
  category: string;
  count: number;
}

export interface ErrorByToolStat {
  tool: string;
  category: string;
  count: number;
}

export interface TraceJob {
  jobId: string;
  tool: string;
  mode: string;
  source: string | null;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  errorKind: string | null;
  durationMs: number | null;
  messageCount: number;
}

export interface SessionTrace {
  sessionId: string;
  tool: string;
  jobs: TraceJob[];
}

/* ── Metrics types (Phase 1) ── */

export interface JobSourceStat {
  source: string;
  count: number;
}

export interface DurationBucket {
  label: string;
  count: number;
}

export interface OrchDailyRun {
  date: string;
  status: string;
  count: number;
}

export interface OrchAvgDuration {
  date: string;
  avgSec: number;
}

export interface SparklineData {
  sessions: number[];
  jobs: number[];
  successRate: number[];
  errors: number[];
}

export interface MetricsData {
  range: '24h' | '7d' | '30d';
  rangeMs: number;
  dailyJobs: DailyJobCount[];
  successRate: number;
  totalJobs: number;
  jobsBySource: JobSourceStat[];
  durationBuckets: DurationBucket[];
  taskSummary: ReturnType<DashboardDb['getTaskSummaryStats']>;
  orchDailyRuns: OrchDailyRun[];
  orchAvgDuration: OrchAvgDuration[];
  errorCategories: ErrorCategoryStat[];
  errorTrend: ErrorTrendDay[];
  errorByTool: ErrorByToolStat[];
  recentErrors: AuditRow[];
  queueDepth: { running: number; pending: number };
  dbSizeBytes: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_MS = 7 * DAY_MS;

function classifyErrorKind(errorKind: string): string {
  if (errorKind.startsWith('exit_')) return 'Exit Error';
  if (errorKind === 'no_output_timeout' || errorKind === 'max_runtime_timeout') return 'Timeout';
  if (errorKind === 'mcp_auth_required' || errorKind === 'mcp_tool_unavailable') return 'MCP Issue';
  if (
    errorKind === 'user_exit' ||
    errorKind === 'user_stop' ||
    errorKind === 'reset' ||
    errorKind === 'dashboard_stop'
  )
    return 'User Stopped';
  if (errorKind.startsWith('spawn_error')) return 'Spawn Error';
  if (errorKind === 'orchestrator_shutdown' || errorKind === 'permission_approval_needed')
    return 'System';
  return 'Other';
}

/** Read-only SQLite facade exposing typed queries for all dashboard views. */
export class DashboardDb {
  private readonly db: Database.Database;
  private readonly dbPath: string;
  private readonly devAliases: DevAliasStore;
  private readonly mcpServers: McpServerStore;
  private readonly sessionMcpServers: SessionMcpServerStore;
  private readonly schedules: ScheduleStore;
  private readonly ondemandTasks: OndemandTaskStore;
  private readonly orchestrators: OrchestratorStore;
  readonly config: ConfigStore;
  readonly defaultInstructions: DefaultInstructionStore;
  readonly skillEnablement: SkillEnablementStore;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    applySqliteConnectionPragmas(this.db);
    // Run the same schema + migrations as the full server to ensure
    // all tables/columns exist even when dashboard starts standalone.
    ensureSchema(this.db);
    this.devAliases = new DevAliasStore(this.db);
    this.mcpServers = new McpServerStore(this.db);
    this.sessionMcpServers = new SessionMcpServerStore(this.db);
    this.schedules = new ScheduleStore(this.db);
    this.ondemandTasks = new OndemandTaskStore(this.db);
    this.orchestrators = new OrchestratorStore(this.db, dirname(dbPath));
    this.config = new ConfigStore(this.db);
    this.skillEnablement = new SkillEnablementStore(this.db);
    this.mcpServers.importFromGlobalConfigs();
    this.defaultInstructions = new DefaultInstructionStore(this.db);
    tightenSqliteRuntimeFilePermissions(this.dbPath);
  }

  listMcpServers(tool?: McpServerTool): McpServerRecord[] {
    return tool ? this.mcpServers.listByTool(tool) : this.mcpServers.listAll();
  }

  getMcpServerById(id: string): McpServerRecord | null {
    return this.mcpServers.getById(id);
  }

  getMcpServerByName(name: string, tool: McpServerTool): McpServerRecord | null {
    return this.mcpServers.getByName(name, tool);
  }

  createMcpServer(input: {
    name: string;
    tool: McpServerTool;
    transport: McpServerTransport;
    definition: Record<string, unknown>;
  }): McpServerRecord {
    return this.mcpServers.create(input);
  }

  updateMcpServer(
    id: string,
    input: {
      transport: McpServerTransport;
      definition: Record<string, unknown>;
    },
  ): McpServerRecord | null {
    return this.mcpServers.update(id, input);
  }

  replaceMcpServersForTool(
    tool: McpServerTool,
    servers: ReadonlyArray<{
      name: string;
      transport: McpServerTransport;
      definition: Record<string, unknown>;
    }>,
  ): McpServerRecord[] {
    return this.mcpServers.replaceAllForTool(tool, servers);
  }

  deleteMcpServer(id: string): boolean {
    return this.mcpServers.delete(id);
  }

  private getSessionMcpContext(sessionId: string): {
    sessionKey: string;
    tool: McpServerTool;
    mode: string;
  } | null {
    try {
      const row = this.db
        .prepare(
          `SELECT s.session_key, s.tool, s.mode
             FROM sessions s
             JOIN session_registry r ON r.session_key = s.session_key
            WHERE r.session_id = ?`,
        )
        .get(sessionId) as SessionMcpContextRow | undefined;
      if (!row || !isToolName(row.tool)) {
        return null;
      }
      return {
        sessionKey: row.session_key,
        tool: row.tool,
        mode: row.mode,
      };
    } catch {
      return null;
    }
  }

  getSessionMcpServers(sessionId: string): SessionMcpServerState | null {
    const session = this.getSessionMcpContext(sessionId);
    if (!session) {
      return null;
    }
    const allServers = this.mcpServers.listByTool(session.tool);
    const selection = resolveSessionMcpServerSelection(
      allServers,
      this.sessionMcpServers.listBySession(session.sessionKey),
    );
    return {
      sessionId,
      sessionKey: session.sessionKey,
      tool: session.tool,
      mode: session.mode,
      filterActive: selection.filterActive,
      servers: allServers.map((server) => ({
        id: server.id,
        name: server.name,
        tool: server.tool,
        transport: server.transport,
        enabled: selection.enabledServerIds.has(server.id),
      })),
    };
  }

  setSessionMcpServerEnabled(
    sessionId: string,
    serverId: string,
    enabled: boolean,
  ): SessionMcpServerState | null {
    const session = this.getSessionMcpContext(sessionId);
    if (!session) {
      return null;
    }
    const allServers = this.mcpServers.listByTool(session.tool);
    const target = allServers.find((server) => server.id === serverId);
    if (!target) {
      throw new Error('Server not found for session tool');
    }
    this.sessionMcpServers.setEnabled(
      session.sessionKey,
      serverId,
      enabled,
      allServers.map((server) => server.id),
    );
    return this.getSessionMcpServers(sessionId);
  }

  resetSessionMcpServers(sessionId: string): SessionMcpServerState | null {
    const session = this.getSessionMcpContext(sessionId);
    if (!session) {
      return null;
    }
    this.sessionMcpServers.reset(session.sessionKey);
    return this.getSessionMcpServers(sessionId);
  }

  listSessions(): DashboardSession[] {
    try {
      const rows = this.db.prepare(SESSION_LIST_QUERY).all() as SessionListDbRow[];
      return rows.map((r) => this.toSession(r));
    } catch {
      // sessions/session_registry tables may not exist yet (created by Server API)
      return [];
    }
  }

  listSessionsByTool(tool: string): DashboardSession[] {
    try {
      const rows = this.db.prepare(SESSION_LIST_BY_TOOL_QUERY).all(tool) as SessionListDbRow[];
      return rows.map((r) => this.toSession(r));
    } catch {
      // sessions/session_registry tables may not exist yet (created by Server API)
      return [];
    }
  }

  getSessionToolState(sessionId: string): {
    sessionKey: string;
    tool: string;
    workdir: string;
    toolState: ToolState;
  } | null {
    try {
      const row = this.db
        .prepare(
          `SELECT s.session_key, s.tool, s.workdir, s.tool_state
             FROM sessions s
             JOIN session_registry r ON r.session_key = s.session_key
            WHERE r.session_id = ?`,
        )
        .get(sessionId) as (ToolStateDbRow & { tool: string; workdir: string }) | undefined;
      if (!row) return null;

      return {
        sessionKey: row.session_key,
        tool: row.tool,
        workdir: row.workdir,
        toolState: safeParseToolState(row.tool_state),
      };
    } catch {
      // sessions/session_registry tables may not exist yet (created by Server API)
      return null;
    }
  }

  getMessages(sessionKey: string, limit: number, before?: number): ChatMessage[] {
    let rows: ChatMessageDbRow[];
    if (before !== undefined) {
      rows = this.db
        .prepare(
          `SELECT id, session_key, role, content, created_at
             FROM dashboard_messages
            WHERE session_key = ? AND id < ?
            ORDER BY id DESC
            LIMIT ?`,
        )
        .all(sessionKey, before, limit) as ChatMessageDbRow[];
    } else {
      rows = this.db
        .prepare(
          `SELECT id, session_key, role, content, created_at
             FROM dashboard_messages
            WHERE session_key = ?
            ORDER BY id DESC
            LIMIT ?`,
        )
        .all(sessionKey, limit) as ChatMessageDbRow[];
    }
    return rows.map((r) => this.toChatMessage(r));
  }

  getSessionThreadInfo(
    sessionId: string,
  ): { channelId: string; threadTs: string; tool: string; sessionKey: string } | null {
    try {
      const row = this.db
        .prepare(
          `SELECT r.thread_key, s.tool, s.session_key
             FROM session_registry r
             JOIN sessions s ON s.session_key = r.session_key
            WHERE r.session_id = ?`,
        )
        .get(sessionId) as { thread_key: string; tool: string; session_key: string } | undefined;
      if (!row) return null;

      const colonIdx = row.thread_key.indexOf(':');
      if (colonIdx === -1) return null;

      return {
        channelId: row.thread_key.slice(0, colonIdx),
        threadTs: row.thread_key.slice(colonIdx + 1),
        tool: row.tool,
        sessionKey: row.session_key,
      };
    } catch {
      // sessions/session_registry tables may not exist yet (created by Server API)
      return null;
    }
  }

  getNewMessages(sessionKey: string, afterId: number): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_key, role, content, created_at
           FROM dashboard_messages
          WHERE session_key = ? AND id > ?
          ORDER BY id ASC`,
      )
      .all(sessionKey, afterId) as ChatMessageDbRow[];
    return rows.map((r) => this.toChatMessage(r));
  }

  getSessionAudit(sessionId: string): AuditRow[] {
    try {
      const reg = this.db
        .prepare('SELECT session_key FROM session_registry WHERE session_id = ?')
        .get(sessionId) as { session_key: string } | undefined;
      if (!reg) return [];

      const rows = this.db
        .prepare('SELECT * FROM audit WHERE session_key = ? ORDER BY datetime(started_at) DESC')
        .all(reg.session_key) as AuditDbRow[];
      return rows.map((r) => this.toAudit(r));
    } catch {
      // session_registry/audit tables may not exist yet (created by Server API)
      return [];
    }
  }

  listDevAliases(): DevAlias[] {
    try {
      return this.devAliases.list();
    } catch {
      return [];
    }
  }

  getDevAlias(name: string): DevAlias | null {
    try {
      return this.devAliases.get(name);
    } catch {
      return null;
    }
  }

  createDevAlias(
    name: string,
    path: string,
    tool: string,
    instructionContent?: string | null,
  ): DevAlias {
    const toolName = isToolName(tool) ? tool : 'claude';
    return this.devAliases.create(name, path, toolName, instructionContent);
  }

  updateDevAlias(
    name: string,
    updates: { path?: string; tool?: string; instructionContent?: string | null },
  ): DevAlias | null {
    const typedUpdates: {
      path?: string;
      tool?: import('../config.js').ToolName;
      instructionContent?: string | null;
    } = {};
    if (updates.path !== undefined) typedUpdates.path = updates.path;
    if (updates.tool !== undefined)
      typedUpdates.tool = isToolName(updates.tool) ? updates.tool : 'claude';
    if (updates.instructionContent !== undefined)
      typedUpdates.instructionContent = updates.instructionContent;
    return this.devAliases.update(name, typedUpdates);
  }

  deleteDevAlias(name: string): boolean {
    return this.devAliases.delete(name);
  }

  /**
   * Clear dev_alias references in sessions table when an alias is deleted.
   * Prevents orphaned session references.
   */
  clearSessionDevAlias(aliasName: string): void {
    try {
      this.db.prepare('UPDATE sessions SET dev_alias = NULL WHERE dev_alias = ?').run(aliasName);
    } catch {
      /* sessions table may not exist yet (created by Server API) */
    }
  }

  getOverviewStats(): OverviewStats {
    const defaults: OverviewStats = {
      totalJobs: 0,
      jobs24h: 0,
      errors24h: 0,
      toolStats: [],
      recentJobs: [],
    };

    const isError = 'error_kind IS NOT NULL OR (exit_code IS NOT NULL AND exit_code != 0)';

    try {
      const ago24h = new Date(Date.now() - DAY_MS).toISOString();
      const counts = this.db
        .prepare(
          `SELECT COUNT(*) AS total,
                SUM(CASE WHEN started_at > ? THEN 1 ELSE 0 END) AS jobs24h,
                SUM(CASE WHEN started_at > ? AND (${isError}) THEN 1 ELSE 0 END) AS errors24h
           FROM audit`,
        )
        .get(ago24h, ago24h) as { total: number; jobs24h: number; errors24h: number } | undefined;

      if (counts) {
        defaults.totalJobs = counts.total ?? 0;
        defaults.jobs24h = counts.jobs24h ?? 0;
        defaults.errors24h = counts.errors24h ?? 0;
      }
    } catch {
      /* audit table may not exist */
    }

    try {
      const toolRows = this.db
        .prepare('SELECT tool, COUNT(*) AS cnt FROM audit GROUP BY tool')
        .all() as { tool: string; cnt: number }[];
      defaults.toolStats = toolRows.map((r) => ({ tool: r.tool, count: r.cnt }));
    } catch {
      /* ignore */
    }

    try {
      const recentRows = this.db
        .prepare('SELECT * FROM audit ORDER BY datetime(started_at) DESC LIMIT 5')
        .all() as AuditDbRow[];
      defaults.recentJobs = recentRows.map((r) => this.toAudit(r));
    } catch {
      /* ignore */
    }

    return defaults;
  }

  getAppToolStats(): AppToolStat[] {
    const tools = ['claude', 'codex', 'gemini'] as const;
    const ago24h = new Date(Date.now() - DAY_MS).toISOString();
    const ago7d = new Date(Date.now() - DEFAULT_RANGE_MS).toISOString();

    const defaults = new Map<string, AppToolStat>(
      tools.map((t) => [
        t,
        {
          tool: t,
          jobs24h: 0,
          errors24h: 0,
          successRate7d: 100,
          avgDurationMs: null,
          lastActivityAt: null,
        },
      ]),
    );

    try {
      const isError = 'error_kind IS NOT NULL OR (exit_code IS NOT NULL AND exit_code != 0)';
      const rows = this.db
        .prepare(
          `SELECT tool,
                  SUM(CASE WHEN started_at > ? THEN 1 ELSE 0 END) AS jobs24h,
                  SUM(CASE WHEN (${isError}) AND started_at > ? THEN 1 ELSE 0 END) AS errors24h,
                  COUNT(*) AS total7d,
                  SUM(CASE WHEN ${isError} THEN 1 ELSE 0 END) AS errors7d,
                  AVG(CASE WHEN ended_at IS NOT NULL
                       THEN CAST((julianday(ended_at) - julianday(started_at)) * 86400000 AS INTEGER)
                       END) AS avg_ms,
                  MAX(started_at) AS last_activity
             FROM audit
            WHERE tool IN ('claude', 'codex', 'gemini') AND started_at > ?
            GROUP BY tool`,
        )
        .all(ago24h, ago24h, ago7d) as {
        tool: string;
        jobs24h: number;
        errors24h: number;
        total7d: number;
        errors7d: number;
        avg_ms: number | null;
        last_activity: string | null;
      }[];

      for (const r of rows) {
        const stat = defaults.get(r.tool);
        if (!stat) continue;
        stat.jobs24h = r.jobs24h ?? 0;
        stat.errors24h = r.errors24h ?? 0;
        if (r.total7d > 0) {
          stat.successRate7d = Math.round(((r.total7d - (r.errors7d ?? 0)) / r.total7d) * 100);
        }
        if (r.avg_ms != null) stat.avgDurationMs = Math.round(r.avg_ms);
        stat.lastActivityAt = r.last_activity;
      }
    } catch {
      /* audit table may not exist */
    }

    return tools.map((t) => {
      const stat = defaults.get(t);
      if (stat) return stat;
      return {
        tool: t,
        jobs24h: 0,
        errors24h: 0,
        successRate7d: 100,
        avgDurationMs: null,
        lastActivityAt: null,
      };
    });
  }

  getChartData(rangeMs: number = DEFAULT_RANGE_MS): ChartData {
    const defaults: ChartData = {
      dailyJobs: [],
      successRateRange: 100,
      totalRange: 0,
    };

    const agoRange = new Date(Date.now() - rangeMs).toISOString();

    try {
      const rows = this.db
        .prepare(
          `SELECT strftime('%Y-%m-%d', started_at) AS date,
                  tool,
                  COUNT(*) AS total,
                  SUM(CASE WHEN error_kind IS NOT NULL OR (exit_code IS NOT NULL AND exit_code != 0) THEN 1 ELSE 0 END) AS errors
             FROM audit
            WHERE started_at > ?
            GROUP BY date, tool
            ORDER BY date ASC`,
        )
        .all(agoRange) as { date: string; tool: string; total: number; errors: number }[];
      defaults.dailyJobs = rows.map((r) => ({
        date: r.date,
        tool: r.tool,
        total: r.total ?? 0,
        errors: r.errors ?? 0,
      }));
    } catch {
      /* audit table may not exist */
    }

    try {
      const rates = this.db
        .prepare(
          `SELECT COUNT(*) AS total_range,
                  SUM(CASE WHEN error_kind IS NULL AND (exit_code IS NULL OR exit_code = 0) THEN 1 ELSE 0 END) AS success_range
             FROM audit
            WHERE started_at > ?`,
        )
        .get(agoRange) as
        | {
            total_range: number;
            success_range: number;
          }
        | undefined;
      if (rates) {
        const tRange = rates.total_range ?? 0;
        if (tRange > 0) {
          defaults.totalRange = tRange;
          defaults.successRateRange = Math.round(((rates.success_range ?? 0) / tRange) * 100);
        }
      }
    } catch {
      /* audit table may not exist */
    }

    return defaults;
  }

  getJobMessages(sessionId: string, jobId: string): ChatMessage[] {
    try {
      const reg = this.db
        .prepare('SELECT session_key FROM session_registry WHERE session_id = ?')
        .get(sessionId) as { session_key: string } | undefined;
      if (!reg) return [];

      // Primary: query by direct job_id association
      const byJobId = this.db
        .prepare(
          `SELECT id, session_key, role, content, created_at
             FROM dashboard_messages
            WHERE job_id = ?
            ORDER BY id ASC
            LIMIT 50`,
        )
        .all(jobId) as ChatMessageDbRow[];
      if (byJobId.length > 0) {
        return byJobId.map((r) => this.toChatMessage(r));
      }

      // Fallback: time-window query for legacy data without job_id
      const audit = this.db
        .prepare('SELECT started_at, ended_at FROM audit WHERE job_id = ? AND session_key = ?')
        .get(jobId, reg.session_key) as { started_at: string; ended_at: string | null } | undefined;
      if (!audit) return [];

      const endBound = audit.ended_at ?? '9999-12-31T23:59:59.999Z';
      const rows = this.db
        .prepare(
          `SELECT id, session_key, role, content, created_at
             FROM dashboard_messages
            WHERE session_key = ? AND created_at >= ? AND created_at <= ?
            ORDER BY id ASC
            LIMIT 50`,
        )
        .all(reg.session_key, audit.started_at, endBound) as ChatMessageDbRow[];
      return rows.map((r) => this.toChatMessage(r));
    } catch {
      return [];
    }
  }

  getAuditByWorkdir(workdir: string): AuditRow[] {
    try {
      const rows = this.db
        .prepare(
          'SELECT * FROM audit WHERE workdir = ? ORDER BY datetime(started_at) DESC LIMIT 20',
        )
        .all(workdir) as AuditDbRow[];
      return rows.map((r) => this.toAudit(r));
    } catch {
      return [];
    }
  }

  /* ── Error Analysis ── */

  getErrorStats(rangeMs: number = DEFAULT_RANGE_MS): ErrorCategoryStat[] {
    try {
      const agoRange = new Date(Date.now() - rangeMs).toISOString();
      const rows = this.db
        .prepare(
          `SELECT error_kind, COUNT(*) AS cnt
             FROM audit
            WHERE error_kind IS NOT NULL AND started_at > ?
            GROUP BY error_kind`,
        )
        .all(agoRange) as { error_kind: string; cnt: number }[];

      const categoryMap = new Map<string, number>();
      for (const r of rows) {
        const cat = classifyErrorKind(r.error_kind);
        categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + r.cnt);
      }
      return Array.from(categoryMap, ([category, count]) => ({ category, count }));
    } catch {
      return [];
    }
  }

  getErrorTrend(rangeMs: number = DEFAULT_RANGE_MS): ErrorTrendDay[] {
    try {
      const agoRange = new Date(Date.now() - rangeMs).toISOString();
      const rows = this.db
        .prepare(
          `SELECT strftime('%Y-%m-%d', started_at) AS date, error_kind, COUNT(*) AS cnt
             FROM audit
            WHERE error_kind IS NOT NULL AND started_at > ?
            GROUP BY date, error_kind
            ORDER BY date`,
        )
        .all(agoRange) as { date: string; error_kind: string; cnt: number }[];

      const keyMap = new Map<string, number>();
      for (const r of rows) {
        const cat = classifyErrorKind(r.error_kind);
        const key = `${r.date}:${cat}`;
        keyMap.set(key, (keyMap.get(key) ?? 0) + r.cnt);
      }
      return Array.from(keyMap, ([key, count]) => {
        const colonIdx = key.indexOf(':');
        return {
          date: key.slice(0, colonIdx),
          category: key.slice(colonIdx + 1),
          count,
        };
      });
    } catch {
      return [];
    }
  }

  getErrorByTool(rangeMs: number = DEFAULT_RANGE_MS): ErrorByToolStat[] {
    try {
      const agoRange = new Date(Date.now() - rangeMs).toISOString();
      const rows = this.db
        .prepare(
          `SELECT tool, error_kind, COUNT(*) AS cnt
             FROM audit
            WHERE error_kind IS NOT NULL AND started_at > ?
            GROUP BY tool, error_kind`,
        )
        .all(agoRange) as { tool: string; error_kind: string; cnt: number }[];

      const keyMap = new Map<string, number>();
      for (const r of rows) {
        const cat = classifyErrorKind(r.error_kind);
        const key = `${r.tool}:${cat}`;
        keyMap.set(key, (keyMap.get(key) ?? 0) + r.cnt);
      }
      return Array.from(keyMap, ([key, count]) => {
        const colonIdx = key.indexOf(':');
        return { tool: key.slice(0, colonIdx), category: key.slice(colonIdx + 1), count };
      });
    } catch {
      return [];
    }
  }

  getRecentErrors(limit = 10): AuditRow[] {
    try {
      const rows = this.db
        .prepare(
          'SELECT * FROM audit WHERE error_kind IS NOT NULL ORDER BY datetime(started_at) DESC LIMIT ?',
        )
        .all(limit) as AuditDbRow[];
      return rows.map((r) => this.toAudit(r));
    } catch {
      return [];
    }
  }

  /* ── Session Trace ── */

  getSessionTrace(sessionId: string): SessionTrace | null {
    try {
      const reg = this.db
        .prepare('SELECT session_key FROM session_registry WHERE session_id = ?')
        .get(sessionId) as { session_key: string } | undefined;
      if (!reg) return null;

      const session = this.db
        .prepare('SELECT tool FROM sessions WHERE session_key = ?')
        .get(reg.session_key) as { tool: string } | undefined;

      // Single query with correlated subquery for message counts (avoids N+1)
      const rows = this.db
        .prepare(
          `SELECT a.*,
                  (SELECT COUNT(*) FROM dashboard_messages dm
                    WHERE dm.session_key = a.session_key
                      AND dm.created_at >= a.started_at
                      AND dm.created_at <= COALESCE(a.ended_at, '9999-12-31T23:59:59.999Z')
                  ) AS msg_count
             FROM audit a
            WHERE a.session_key = ?
            ORDER BY datetime(a.started_at) ASC`,
        )
        .all(reg.session_key) as (AuditDbRow & { msg_count: number })[];

      const jobs: TraceJob[] = rows.map((r) => {
        let durationMs: number | null = null;
        if (r.started_at && r.ended_at) {
          durationMs = new Date(r.ended_at).getTime() - new Date(r.started_at).getTime();
          if (Number.isNaN(durationMs) || durationMs < 0) durationMs = null;
        }
        return {
          jobId: r.job_id,
          tool: r.tool,
          mode: r.mode,
          source: r.source ?? null,
          startedAt: r.started_at,
          endedAt: r.ended_at,
          exitCode: r.exit_code,
          errorKind: r.error_kind,
          durationMs,
          messageCount: r.msg_count ?? 0,
        };
      });

      return {
        sessionId,
        tool: session?.tool ?? 'unknown',
        jobs,
      };
    } catch {
      return null;
    }
  }

  /* ── Metrics Queries (Phase 1) ── */

  getJobsBySource(rangeMs: number = DEFAULT_RANGE_MS): JobSourceStat[] {
    try {
      const agoRange = new Date(Date.now() - rangeMs).toISOString();
      const rows = this.db
        .prepare(
          `SELECT COALESCE(source, 'unknown') AS source, COUNT(*) AS count
             FROM audit
            WHERE started_at > ?
            GROUP BY source
            ORDER BY count DESC`,
        )
        .all(agoRange) as { source: string; count: number }[];
      return rows.map((r) => ({ source: r.source, count: r.count }));
    } catch {
      return [];
    }
  }

  getDurationBuckets(rangeMs: number = DEFAULT_RANGE_MS): DurationBucket[] {
    try {
      const agoRange = new Date(Date.now() - rangeMs).toISOString();
      const rows = this.db
        .prepare(
          `SELECT
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
           ORDER BY MIN(duration_ms)`,
        )
        .all(agoRange) as { label: string; count: number }[];
      return rows.map((r) => ({ label: r.label, count: r.count }));
    } catch {
      return [];
    }
  }

  getOrchRunStats(rangeMs: number = DEFAULT_RANGE_MS): {
    orchDailyRuns: OrchDailyRun[];
    orchAvgDuration: OrchAvgDuration[];
  } {
    const result: { orchDailyRuns: OrchDailyRun[]; orchAvgDuration: OrchAvgDuration[] } = {
      orchDailyRuns: [],
      orchAvgDuration: [],
    };

    const agoRange = new Date(Date.now() - rangeMs).toISOString();

    try {
      const dailyRows = this.db
        .prepare(
          `SELECT strftime('%Y-%m-%d', started_at) AS date,
                  status,
                  COUNT(*) AS count
             FROM orchestration_runs
            WHERE started_at > ?
              AND status IN ('completed', 'failed', 'cancelled')
            GROUP BY date, status
            ORDER BY date ASC`,
        )
        .all(agoRange) as { date: string; status: string; count: number }[];
      result.orchDailyRuns = dailyRows.map((r) => ({
        date: r.date,
        status: r.status,
        count: r.count,
      }));
    } catch {
      /* table may not exist */
    }

    try {
      const avgRows = this.db
        .prepare(
          `SELECT strftime('%Y-%m-%d', started_at) AS date,
                  AVG(CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS REAL)) AS avg_sec
             FROM orchestration_runs
            WHERE started_at > ?
              AND ended_at IS NOT NULL
              AND status = 'completed'
            GROUP BY date
            ORDER BY date ASC`,
        )
        .all(agoRange) as { date: string; avg_sec: number }[];
      result.orchAvgDuration = avgRows.map((r) => ({
        date: r.date,
        avgSec: Math.round(r.avg_sec ?? 0),
      }));
    } catch {
      /* table may not exist */
    }

    return result;
  }

  getQueueDepth(): { running: number; pending: number } {
    try {
      const row = this.db
        .prepare(
          `SELECT
             SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
             SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS pending
           FROM job_queue`,
        )
        .get() as { running: number | null; pending: number | null } | undefined;
      return {
        running: row?.running ?? 0,
        pending: row?.pending ?? 0,
      };
    } catch {
      return { running: 0, pending: 0 };
    }
  }

  getSparklineData(): SparklineData {
    const result: SparklineData = {
      sessions: [],
      jobs: [],
      successRate: [],
      errors: [],
    };

    // Daily session activity (7d)
    try {
      const rows = this.db
        .prepare(
          `WITH RECURSIVE dates(d) AS (
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
             ) s ON dates.d = s.date`,
        )
        .all() as { date: string; count: number }[];
      result.sessions = rows.map((r) => r.count);
    } catch {
      result.sessions = new Array(7).fill(0);
    }

    // Daily job counts, errors, and success rates (7d)
    try {
      const rows = this.db
        .prepare(
          `WITH RECURSIVE dates(d) AS (
             SELECT date('now', '-6 days')
             UNION ALL
             SELECT date(d, '+1 day') FROM dates WHERE d < date('now')
           )
           SELECT dates.d AS date,
                  COALESCE(total, 0) AS total,
                  COALESCE(errors, 0) AS errors
             FROM dates
             LEFT JOIN (
               SELECT strftime('%Y-%m-%d', started_at) AS date,
                      COUNT(*) AS total,
                      SUM(CASE WHEN error_kind IS NOT NULL OR (exit_code IS NOT NULL AND exit_code != 0) THEN 1 ELSE 0 END) AS errors
                 FROM audit
                WHERE started_at > datetime('now', '-7 days')
                GROUP BY date
             ) a ON dates.d = a.date`,
        )
        .all() as { date: string; total: number; errors: number }[];
      result.jobs = rows.map((r) => r.total);
      result.errors = rows.map((r) => r.errors);
      result.successRate = rows.map((r) => {
        if (r.total === 0) return 100;
        return Math.round(((r.total - r.errors) / r.total) * 100);
      });
    } catch {
      result.jobs = new Array(7).fill(0);
      result.errors = new Array(7).fill(0);
      result.successRate = new Array(7).fill(100);
    }

    return result;
  }

  getMetricsData(rangeMs: number = DEFAULT_RANGE_MS): MetricsData {
    const rangeLabel = rangeMs <= DAY_MS ? '24h' : rangeMs <= DEFAULT_RANGE_MS ? '7d' : '30d';

    const chartData = this.getChartData(rangeMs);
    const orchStats = this.getOrchRunStats(rangeMs);

    return {
      range: rangeLabel,
      rangeMs,
      dailyJobs: chartData.dailyJobs,
      successRate: chartData.successRateRange,
      totalJobs: chartData.totalRange,
      jobsBySource: this.getJobsBySource(rangeMs),
      durationBuckets: this.getDurationBuckets(rangeMs),
      taskSummary: this.getTaskSummaryStats(rangeMs),
      orchDailyRuns: orchStats.orchDailyRuns,
      orchAvgDuration: orchStats.orchAvgDuration,
      errorCategories: this.getErrorStats(rangeMs),
      errorTrend: this.getErrorTrend(rangeMs),
      errorByTool: this.getErrorByTool(rangeMs),
      recentErrors: this.getRecentErrors(),
      queueDepth: this.getQueueDepth(),
      dbSizeBytes: this.getDbSizeBytes(),
    };
  }

  private getDbSizeBytes(): number {
    try {
      return statSync(this.dbPath).size;
    } catch {
      return 0;
    }
  }

  close(): void {
    this.db.close();
  }

  private toSession(r: SessionListDbRow): DashboardSession {
    return {
      sessionKey: r.session_key,
      sessionId: r.session_id,
      threadKey: r.thread_key,
      userId: r.user_id,
      tool: r.tool,
      mode: r.mode,
      workdir: r.workdir,
      runningJobId: r.running_job_id,
      startedAt: r.started_at,
      updatedAt: r.updated_at,
      active: boolFromDb(r.is_active),
    };
  }

  private toAudit(r: AuditDbRow): AuditRow {
    return {
      jobId: r.job_id,
      sessionKey: r.session_key,
      userId: r.user_id,
      tool: r.tool,
      mode: r.mode,
      workdir: r.workdir,
      promptHash: r.prompt_hash,
      source: r.source ?? null,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      exitCode: r.exit_code,
      errorKind: r.error_kind,
    };
  }

  private toChatMessage(r: ChatMessageDbRow): ChatMessage {
    return {
      id: r.id,
      sessionKey: r.session_key,
      role: r.role as 'user' | 'assistant' | 'system',
      content: r.content,
      createdAt: r.created_at,
    };
  }

  /* ── Task Summary Stats (for overview dashboard) ── */

  getTaskSummaryStats(rangeMs: number = DEFAULT_RANGE_MS): {
    ondemand: {
      total: number;
      active: number;
      totalRuns: number;
      runs24h: number;
      failed24h: number;
    };
    scheduled: {
      total: number;
      active: number;
      paused: number;
      totalRuns: number;
      runs24h: number;
      failed24h: number;
    };
    triggered: {
      total: number;
      enabled: number;
      totalRuns: number;
      runs24h: number;
      failed24h: number;
    };
    dailyTaskRuns: { date: string; source: string; total: number; failed: number }[];
  } {
    const ago24h = new Date(Date.now() - DAY_MS).toISOString();
    const agoRange = new Date(Date.now() - rangeMs).toISOString();
    const result = {
      ondemand: { total: 0, active: 0, totalRuns: 0, runs24h: 0, failed24h: 0 },
      scheduled: { total: 0, active: 0, paused: 0, totalRuns: 0, runs24h: 0, failed24h: 0 },
      triggered: { total: 0, enabled: 0, totalRuns: 0, runs24h: 0, failed24h: 0 },
      dailyTaskRuns: [] as { date: string; source: string; total: number; failed: number }[],
    };

    // On-demand task counts
    try {
      const odCounts = this.db
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_cnt
             FROM ondemand_tasks WHERE status != 'deleted'`,
        )
        .get() as { total: number; active_cnt: number } | undefined;
      if (odCounts) {
        result.ondemand.total = odCounts.total ?? 0;
        result.ondemand.active = odCounts.active_cnt ?? 0;
      }
    } catch {
      /* table may not exist */
    }

    // On-demand run counts
    try {
      const odRuns = this.db
        .prepare(
          `SELECT COUNT(*) AS total_runs,
                  SUM(CASE WHEN started_at > ? THEN 1 ELSE 0 END) AS runs24h,
                  SUM(CASE WHEN started_at > ? AND status = 'failed' THEN 1 ELSE 0 END) AS failed24h
             FROM ondemand_task_runs`,
        )
        .get(ago24h, ago24h) as
        | { total_runs: number; runs24h: number; failed24h: number }
        | undefined;
      if (odRuns) {
        result.ondemand.totalRuns = odRuns.total_runs ?? 0;
        result.ondemand.runs24h = odRuns.runs24h ?? 0;
        result.ondemand.failed24h = odRuns.failed24h ?? 0;
      }
    } catch {
      /* table may not exist */
    }

    // Scheduled task counts
    try {
      const schCounts = this.db
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_cnt,
                  SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) AS paused_cnt
             FROM scheduled_tasks WHERE status NOT IN ('deleted')`,
        )
        .get() as { total: number; active_cnt: number; paused_cnt: number } | undefined;
      if (schCounts) {
        result.scheduled.total = schCounts.total ?? 0;
        result.scheduled.active = schCounts.active_cnt ?? 0;
        result.scheduled.paused = schCounts.paused_cnt ?? 0;
      }
    } catch {
      /* table may not exist */
    }

    // Scheduled run counts
    try {
      const schRuns = this.db
        .prepare(
          `SELECT COUNT(*) AS total_runs,
                  SUM(CASE WHEN started_at > ? THEN 1 ELSE 0 END) AS runs24h,
                  SUM(CASE WHEN started_at > ? AND status = 'failed' THEN 1 ELSE 0 END) AS failed24h
             FROM scheduled_task_runs`,
        )
        .get(ago24h, ago24h) as
        | { total_runs: number; runs24h: number; failed24h: number }
        | undefined;
      if (schRuns) {
        result.scheduled.totalRuns = schRuns.total_runs ?? 0;
        result.scheduled.runs24h = schRuns.runs24h ?? 0;
        result.scheduled.failed24h = schRuns.failed24h ?? 0;
      }
    } catch {
      /* table may not exist */
    }

    // Triggered task counts
    try {
      const triggeredCounts = this.db
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled_cnt
             FROM triggered_tasks`,
        )
        .get() as { total: number; enabled_cnt: number } | undefined;
      if (triggeredCounts) {
        result.triggered.total = triggeredCounts.total ?? 0;
        result.triggered.enabled = triggeredCounts.enabled_cnt ?? 0;
      }
    } catch {
      /* table may not exist */
    }

    // Triggered task run counts
    try {
      const triggeredRuns = this.db
        .prepare(
          `SELECT COUNT(*) AS total_runs,
                  SUM(CASE WHEN started_at > ? THEN 1 ELSE 0 END) AS runs24h,
                  SUM(CASE WHEN started_at > ? AND status = 'failed' THEN 1 ELSE 0 END) AS failed24h
             FROM triggered_task_runs`,
        )
        .get(ago24h, ago24h) as
        | { total_runs: number; runs24h: number; failed24h: number }
        | undefined;
      if (triggeredRuns) {
        result.triggered.totalRuns = triggeredRuns.total_runs ?? 0;
        result.triggered.runs24h = triggeredRuns.runs24h ?? 0;
        result.triggered.failed24h = triggeredRuns.failed24h ?? 0;
      }
    } catch {
      /* table may not exist */
    }

    // Daily task runs — combine on-demand + scheduled + triggered
    try {
      const odDaily = this.db
        .prepare(
          `SELECT strftime('%Y-%m-%d', started_at) AS date,
                  COUNT(*) AS total,
                  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
             FROM ondemand_task_runs
            WHERE started_at > ?
            GROUP BY date
            ORDER BY date ASC`,
        )
        .all(agoRange) as { date: string; total: number; failed: number }[];
      for (const r of odDaily) {
        result.dailyTaskRuns.push({
          date: r.date,
          source: 'on-demand',
          total: r.total ?? 0,
          failed: r.failed ?? 0,
        });
      }
    } catch {
      /* table may not exist */
    }

    try {
      const schDaily = this.db
        .prepare(
          `SELECT strftime('%Y-%m-%d', started_at) AS date,
                  COUNT(*) AS total,
                  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
             FROM scheduled_task_runs
            WHERE started_at > ?
            GROUP BY date
            ORDER BY date ASC`,
        )
        .all(agoRange) as { date: string; total: number; failed: number }[];
      for (const r of schDaily) {
        result.dailyTaskRuns.push({
          date: r.date,
          source: 'scheduled',
          total: r.total ?? 0,
          failed: r.failed ?? 0,
        });
      }
    } catch {
      /* table may not exist */
    }

    try {
      const triggeredDaily = this.db
        .prepare(
          `SELECT strftime('%Y-%m-%d', started_at) AS date,
                  COUNT(*) AS total,
                  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
             FROM triggered_task_runs
            WHERE started_at > ?
            GROUP BY date
            ORDER BY date ASC`,
        )
        .all(agoRange) as { date: string; total: number; failed: number }[];
      for (const r of triggeredDaily) {
        result.dailyTaskRuns.push({
          date: r.date,
          source: 'triggered',
          total: r.total ?? 0,
          failed: r.failed ?? 0,
        });
      }
    } catch {
      /* table may not exist */
    }

    return result;
  }

  /* ── Scheduled Tasks (delegated to Store layer) ── */

  getScheduledTasks(): ScheduledTask[] {
    try {
      return this.schedules.list();
    } catch {
      return [];
    }
  }

  getScheduledTaskById(id: string): ScheduledTask | null {
    try {
      const task = this.schedules.getById(id);
      return task && task.status !== 'deleted' ? task : null;
    } catch {
      return null;
    }
  }

  getScheduledTaskRuns(taskId: string, limit = 20): ScheduledTaskRun[] {
    try {
      return this.schedules.getRunsByTask(taskId, limit);
    } catch {
      return [];
    }
  }

  /* ── On-Demand Tasks (delegated to Store layer) ── */

  getOndemandTasks(): OndemandTask[] {
    try {
      return this.ondemandTasks.list();
    } catch {
      return [];
    }
  }

  getOndemandTaskById(id: string): OndemandTask | null {
    try {
      const task = this.ondemandTasks.getById(id);
      return task && task.status !== 'deleted' ? task : null;
    } catch {
      return null;
    }
  }

  getOndemandTaskRuns(taskId: string, limit = 20): OndemandTaskRun[] {
    try {
      return this.ondemandTasks.getRunsByTask(taskId, limit);
    } catch {
      return [];
    }
  }

  // ── Orchestrator Queries (delegated to Store layer) ───────────

  getOrchestrators(): OrchestratorListItem[] {
    try {
      return this.orchestrators.listEnriched();
    } catch {
      return [];
    }
  }

  getOrchestratorById(id: string): OrchestratorDetail | null {
    try {
      const result = this.orchestrators.getFullOrchestrator(id);
      if (!result || result.orchestrator.status === 'deleted') return null;
      return { ...result.orchestrator, nodes: result.nodes, edges: result.edges };
    } catch {
      return null;
    }
  }

  getOrchestratorRunsOverview(
    orchestratorId: string,
    limit = 50,
  ): { orchestrator: OrchestratorDetail; runs: OrchestrationRunDetail[] } | null {
    try {
      const orch = this.getOrchestratorById(orchestratorId);
      if (!orch) return null;

      const runs = this.db
        .prepare(
          'SELECT * FROM orchestration_runs WHERE orchestrator_id = ? ORDER BY created_at DESC LIMIT ?',
        )
        .all(orchestratorId, limit) as Record<string, unknown>[];

      const mappedRuns: OrchestrationRunDetail[] = runs.map((r) => ({
        ...mapRun(r),
        nodeRuns: [],
      }));

      // Bulk load all node runs for these runs
      const runIds = mappedRuns.map((r) => r.id);
      const nodeRunsByRun: Record<string, OrchestrationNodeRun[]> = {};
      if (runIds.length > 0) {
        const placeholders = runIds.map(() => '?').join(',');
        const allNodeRuns = this.db
          .prepare(
            `SELECT * FROM orchestration_node_runs WHERE orchestration_run_id IN (${placeholders}) ORDER BY started_at ASC`,
          )
          .all(...runIds) as Record<string, unknown>[];

        for (const nr of allNodeRuns) {
          const mapped = mapNodeRun(nr);
          const rid = mapped.orchestrationRunId;
          if (!nodeRunsByRun[rid]) nodeRunsByRun[rid] = [];
          nodeRunsByRun[rid]?.push(mapped);
        }
      }

      for (const run of mappedRuns) {
        run.nodeRuns = nodeRunsByRun[run.id] || [];
      }

      return { orchestrator: orch, runs: mappedRuns };
    } catch {
      return null;
    }
  }

  getOrchestratorRuns(orchestratorId: string, limit = 20): OrchestrationRun[] {
    try {
      return this.orchestrators.getRunsByOrchestrator(orchestratorId, limit);
    } catch {
      return [];
    }
  }

  getOrchestratorRunById(runId: string): OrchestrationRunDetail | null {
    try {
      const run = this.orchestrators.getRunById(runId);
      if (!run) return null;
      return { ...run, nodeRuns: this.orchestrators.getNodeRunsByRun(runId) };
    } catch {
      return null;
    }
  }
}
