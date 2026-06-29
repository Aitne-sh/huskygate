/** @module dashboard/route-context — Shared context and handler signature for dashboard routes. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DashboardDb } from './db.js';

/**
 * Shared context passed to all route handler modules.
 * Created once in createDashboardServer and passed to each route handler.
 */
export interface RouteContext {
  /* ── options ── */
  version: string;
  dataDir: string;
  workdirRoot: string;
  dashboardSecret: string;
  serverApiBase: string;

  /* ── derived paths ── */
  logPath: string;
  dashboardLogPath: string;

  /* ── DB accessor ── */
  getDb: () => DashboardDb;

  /* ── proxy functions ── */
  proxyToServerApi: (
    method: string,
    path: string,
    body?: string,
  ) => Promise<{ status: number; data: unknown }>;
  proxySSE: (
    serverPath: string,
    body: string,
    req: IncomingMessage,
    res: ServerResponse,
  ) => Promise<void>;
  proxySSEGet: (serverPath: string, req: IncomingMessage, res: ServerResponse) => Promise<void>;
}

/**
 * Unified route handler signature.
 * Returns `true` if the route was handled, `false` to continue matching.
 */
export type RouteHandler = (
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  query: URLSearchParams,
) => Promise<boolean>;

/* ── route matching helpers (re-exported from shared module) ── */

export {
  matchArtifactFile,
  matchArtifacts,
  matchChatMessages,
  matchChatMessagesNew,
  matchChatSend,
  matchChatStatus,
  matchChatStop,
  matchChatUpload,
  matchDevAliasAudit,
  matchDevAliasName,
  matchJobStop,
  matchJobStream,
  matchSessionAudit,
  matchSessionAuditJobMessages,
  matchSessionId,
  matchSessionMcpServerId,
  matchSessionMcpServers,
  matchSessionTrace,
  matchToolApproval,
} from '../shared/route-matchers.js';
