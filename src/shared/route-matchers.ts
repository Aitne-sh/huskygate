/** @module route-matchers — URL pattern matchers for API routes shared by Server API and Dashboard */

function decodeURIComponentSafe(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/* ── chat routes ── */

export function matchChatSend(pathname: string): string | null {
  const m = pathname.match(/^\/api\/chat\/([a-f0-9]{8})\/send$/);
  return m?.[1] ?? null;
}

export function matchChatStop(pathname: string): string | null {
  const m = pathname.match(/^\/api\/chat\/([a-f0-9]{8})\/stop$/);
  return m?.[1] ?? null;
}

export function matchChatStatus(pathname: string): string | null {
  const m = pathname.match(/^\/api\/chat\/([a-f0-9]{8})\/status$/);
  return m?.[1] ?? null;
}

export function matchChatMessages(pathname: string): string | null {
  const m = pathname.match(/^\/api\/chat\/([a-f0-9]{8})\/messages$/);
  return m?.[1] ?? null;
}

export function matchChatMessagesNew(pathname: string): string | null {
  const m = pathname.match(/^\/api\/chat\/([a-f0-9]{8})\/messages\/new$/);
  return m?.[1] ?? null;
}

export function matchChatUpload(pathname: string): string | null {
  const m = pathname.match(/^\/api\/chat\/([a-f0-9]{8})\/upload$/);
  return m?.[1] ?? null;
}

export function matchToolApproval(pathname: string): string | null {
  const m = pathname.match(/^\/api\/chat\/([a-f0-9]{8})\/tool-approval$/);
  return m?.[1] ?? null;
}

export function matchJobStream(pathname: string): { sessionId: string; jobId: string } | null {
  const m = pathname.match(/^\/api\/chat\/([a-f0-9]{8})\/job-stream\/([a-f0-9-]+)$/);
  return m?.[1] && m[2] ? { sessionId: m[1], jobId: m[2] } : null;
}

export function matchArtifacts(pathname: string): string | null {
  const m = pathname.match(/^\/api\/chat\/([a-f0-9]{8})\/artifacts$/);
  return m?.[1] ?? null;
}

export function matchArtifactFile(
  pathname: string,
): { sessionId: string; jobId: string; filename: string } | null {
  const m = pathname.match(/^\/api\/chat\/([a-f0-9]{8})\/artifacts\/([a-f0-9-]+)\/(.+)$/);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const filename = decodeURIComponentSafe(m[3]);
  if (filename === null) return null;
  return { sessionId: m[1], jobId: m[2], filename };
}

/* ── session routes ── */

export function matchSessionId(pathname: string): string | null {
  const m = pathname.match(/^\/api\/sessions\/([a-f0-9]{8})$/);
  return m?.[1] ?? null;
}

export function matchSessionAudit(pathname: string): string | null {
  const m = pathname.match(/^\/api\/sessions\/([a-f0-9]{8})\/audit$/);
  return m?.[1] ?? null;
}

export function matchSessionAuditJobMessages(
  pathname: string,
): { sessionId: string; jobId: string } | null {
  const m = pathname.match(/^\/api\/sessions\/([a-f0-9]{8})\/audit\/([a-f0-9-]{36})\/messages$/);
  return m?.[1] && m[2] ? { sessionId: m[1], jobId: m[2] } : null;
}

export function matchSessionTrace(pathname: string): string | null {
  const m = pathname.match(/^\/api\/sessions\/([a-f0-9]{8})\/trace$/);
  return m?.[1] ?? null;
}

export function matchSessionMcpServers(pathname: string): string | null {
  const m = pathname.match(/^\/api\/sessions\/([a-f0-9]{8})\/mcp-servers$/);
  return m?.[1] ?? null;
}

export function matchSessionMcpServerId(
  pathname: string,
): { sessionId: string; serverId: string } | null {
  const m = pathname.match(/^\/api\/sessions\/([a-f0-9]{8})\/mcp-servers\/([a-f0-9-]{36})$/);
  return m?.[1] && m[2] ? { sessionId: m[1], serverId: m[2] } : null;
}

/* ── job routes ── */

export function matchJobStop(pathname: string): string | null {
  const m = pathname.match(/^\/api\/jobs\/(sess_[a-f0-9]+)\/stop$/);
  return m?.[1] ?? null;
}

/* ── dev-alias routes ── */

export function matchDevAliasName(pathname: string): string | null {
  const m = pathname.match(/^\/api\/dev-aliases\/([a-zA-Z0-9_-]{1,64})$/);
  return m?.[1] ?? null;
}

export function matchDevAliasAudit(pathname: string): string | null {
  const m = pathname.match(/^\/api\/dev-aliases\/([a-zA-Z0-9_-]{1,64})\/audit$/);
  return m?.[1] ?? null;
}

/* ── schedule routes ── */

export function matchScheduleTaskId(pathname: string): string | null {
  const m = pathname.match(/^\/api\/schedules\/([a-f0-9-]{36})$/);
  return m?.[1] ?? null;
}

export function matchScheduleTaskRuns(pathname: string): string | null {
  const m = pathname.match(/^\/api\/schedules\/([a-f0-9-]{36})\/runs$/);
  return m?.[1] ?? null;
}

export function matchScheduleTaskExecute(pathname: string): string | null {
  const m = pathname.match(/^\/api\/schedules\/([a-f0-9-]{36})\/execute$/);
  return m?.[1] ?? null;
}

export function matchScheduleTaskRunDetail(
  pathname: string,
): { taskId: string; runId: string } | null {
  const m = pathname.match(/^\/api\/schedules\/([a-f0-9-]{36})\/runs\/([a-f0-9-]{36})$/);
  return m?.[1] && m[2] ? { taskId: m[1], runId: m[2] } : null;
}

/* ── on-demand task routes ── */

export function matchOndemandTaskId(pathname: string): string | null {
  const m = pathname.match(/^\/api\/ondemand-tasks\/([a-f0-9-]{36})$/);
  return m?.[1] ?? null;
}

export function matchOndemandTaskRuns(pathname: string): string | null {
  const m = pathname.match(/^\/api\/ondemand-tasks\/([a-f0-9-]{36})\/runs$/);
  return m?.[1] ?? null;
}

export function matchOndemandTaskExecute(pathname: string): string | null {
  const m = pathname.match(/^\/api\/ondemand-tasks\/([a-f0-9-]{36})\/execute$/);
  return m?.[1] ?? null;
}

/* ── webhook / event routes ── */

export function matchWebhookToken(pathname: string): string | null {
  const m = pathname.match(/^\/webhooks\/([a-z0-9]{16,})$/i);
  return m?.[1] ?? null;
}

export function matchWebhookEndpointId(pathname: string): string | null {
  const m = pathname.match(/^\/api\/webhook-endpoints\/([a-f0-9-]{36})$/);
  return m?.[1] ?? null;
}

export function matchEventSubscriptionId(pathname: string): string | null {
  const m = pathname.match(/^\/api\/event-subscriptions\/([a-f0-9-]{36})$/);
  return m?.[1] ?? null;
}

export function matchEventSubscriptionTest(pathname: string): string | null {
  const m = pathname.match(/^\/api\/event-subscriptions\/([a-f0-9-]{36})\/test$/);
  return m?.[1] ?? null;
}

export function matchTriggeredTaskId(pathname: string): string | null {
  const m = pathname.match(/^\/api\/triggered-tasks\/([a-f0-9-]{36})$/);
  return m?.[1] ?? null;
}

export function matchTriggeredTaskRuns(pathname: string): string | null {
  const m = pathname.match(/^\/api\/triggered-tasks\/([a-f0-9-]{36})\/runs$/);
  return m?.[1] ?? null;
}

export function matchTriggeredTaskExecute(pathname: string): string | null {
  const m = pathname.match(/^\/api\/triggered-tasks\/([a-f0-9-]{36})\/execute$/);
  return m?.[1] ?? null;
}

// ── Orchestrator ─────────────────────────────────────────────

export function matchOrchestratorId(pathname: string): string | null {
  const m = pathname.match(/^\/api\/orchestrators\/([a-f0-9-]{36})$/);
  return m?.[1] ?? null;
}

export function matchOrchestratorNodes(pathname: string): string | null {
  const m = pathname.match(/^\/api\/orchestrators\/([a-f0-9-]{36})\/nodes$/);
  return m?.[1] ?? null;
}

export function matchOrchestratorNodeId(
  pathname: string,
): { orchestratorId: string; nodeId: string } | null {
  const m = pathname.match(/^\/api\/orchestrators\/([a-f0-9-]{36})\/nodes\/([a-f0-9-]{36})$/);
  return m?.[1] && m[2] ? { orchestratorId: m[1], nodeId: m[2] } : null;
}

export function matchOrchestratorEdges(pathname: string): string | null {
  const m = pathname.match(/^\/api\/orchestrators\/([a-f0-9-]{36})\/edges$/);
  return m?.[1] ?? null;
}

export function matchOrchestratorEdgeId(
  pathname: string,
): { orchestratorId: string; edgeId: string } | null {
  const m = pathname.match(/^\/api\/orchestrators\/([a-f0-9-]{36})\/edges\/([a-f0-9-]{36})$/);
  return m?.[1] && m[2] ? { orchestratorId: m[1], edgeId: m[2] } : null;
}

export function matchOrchestratorValidate(pathname: string): string | null {
  const m = pathname.match(/^\/api\/orchestrators\/([a-f0-9-]{36})\/validate$/);
  return m?.[1] ?? null;
}

export function matchOrchestratorRevertSnapshot(pathname: string): string | null {
  const m = pathname.match(/^\/api\/orchestrators\/([a-f0-9-]{36})\/revert$/);
  return m?.[1] ?? null;
}

export function matchOrchestratorExecute(pathname: string): string | null {
  const m = pathname.match(/^\/api\/orchestrators\/([a-f0-9-]{36})\/execute$/);
  return m?.[1] ?? null;
}

export function matchOrchestratorRunsOverview(pathname: string): string | null {
  const m = pathname.match(/^\/api\/orchestrators\/([a-f0-9-]{36})\/runs-overview$/);
  return m?.[1] ?? null;
}

export function matchOrchestratorRuns(pathname: string): string | null {
  const m = pathname.match(/^\/api\/orchestrators\/([a-f0-9-]{36})\/runs$/);
  return m?.[1] ?? null;
}

export function matchOrchestratorRunId(
  pathname: string,
): { orchestratorId: string; runId: string } | null {
  const m = pathname.match(/^\/api\/orchestrators\/([a-f0-9-]{36})\/runs\/([a-f0-9-]{36})$/);
  return m?.[1] && m[2] ? { orchestratorId: m[1], runId: m[2] } : null;
}

export function matchOrchestratorRerun(
  pathname: string,
): { orchestratorId: string; runId: string } | null {
  const m = pathname.match(/^\/api\/orchestrators\/([a-f0-9-]{36})\/rerun\/([a-f0-9-]{36})$/);
  return m?.[1] && m[2] ? { orchestratorId: m[1], runId: m[2] } : null;
}

export function matchOrchestratorCancel(
  pathname: string,
): { orchestratorId: string; runId: string } | null {
  const m = pathname.match(/^\/api\/orchestrators\/([a-f0-9-]{36})\/cancel\/([a-f0-9-]{36})$/);
  return m?.[1] && m[2] ? { orchestratorId: m[1], runId: m[2] } : null;
}

export function matchOrchestratorRunStream(
  pathname: string,
): { orchestratorId: string; runId: string } | null {
  const m = pathname.match(
    /^\/api\/orchestrators\/([a-f0-9-]{36})\/runs\/([a-f0-9-]{36})\/stream$/,
  );
  return m?.[1] && m[2] ? { orchestratorId: m[1], runId: m[2] } : null;
}
