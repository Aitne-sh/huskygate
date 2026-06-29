# Server Internal API

## Overview

`createApiServer()` operates as a central dispatcher, handling only health check / Bearer authentication / 404-500 handling and route dispatch. Domain-specific HTTP contracts, input validation, and SSE control are moved to `src/server/routes/*.ts`, and the chat job stream buffer is separated into `src/server/state.ts`.

Authentication: `Authorization: Bearer <SERVER_API_SECRET>` required (for all endpoints except `/health` and `POST /webhooks/:token`). When `SERVER_API_SECRET` is not set, it is auto-generated with `crypto.randomUUID()` on each startup.

`HUSKYGATE_API_SECRET` is a separate skill-scoped bearer token. It is accepted only for `/api/schedules*` so the built-in `schedule-manager` skill can manage schedule CRUD/history without receiving full Server API access.

---

## Route Table

### Core

- **GET /health** — Health check (no authentication required)
- **POST /api/sessions** — Create standalone session
- **DELETE /api/sessions** — Delete all sessions + in-memory cleanup
- **DELETE /api/sessions/:id** — Delete session + in-memory cleanup
- **POST /api/jobs/:sessionKey/stop** — Kill activeRunner

### Chat

- **POST /api/chat/:id/send** — Execute chat via JobQueue (SSE streaming)
- **POST /api/chat/:id/stop** — Stop session
- **GET /api/chat/:id/status** — Get session status
- **POST /api/chat/:id/tool-approval** — Tool approval (approve/deny) -> submit retry job on approval
- **GET /api/chat/:id/messages** — Read messages
- **GET /api/chat/:id/messages/new?after=N** — Read new messages
- **GET /api/chat/sessions?tool=<tool>** — Session list by tool
- **GET /api/chat/:id/artifacts** — Artifact list
- **GET /api/chat/:id/artifacts/:jobId/:filename** — Get artifact file
- **GET /api/chat/:id/job-stream/:jobId** — Job output stream (SSE)

### Settings

- **GET /api/settings/keychain-status** — Keychain availability check
- **POST /api/settings/apply** — Apply settings hot-reload

### Schedule

- **POST /api/schedules** — Create schedule task
- **GET /api/schedules** — Schedule task list
- **GET /api/schedules/:id** — Schedule task details
- **PATCH /api/schedules/:id** — Update schedule task
- **DELETE /api/schedules/:id** — Delete schedule task
- **GET /api/schedules/:id/runs** — Schedule execution history
- **GET /api/schedules/:taskId/runs/:runId** — Schedule execution details

### On-Demand

- **POST /api/ondemand-tasks** — Create on-demand task
- **GET /api/ondemand-tasks** — On-demand task list
- **GET /api/ondemand-tasks/:id** — On-demand task details
- **PATCH /api/ondemand-tasks/:id** — Update on-demand task
- **DELETE /api/ondemand-tasks/:id** — Delete on-demand task
- **POST /api/ondemand-tasks/:id/execute** — Execute on-demand task
- **GET /api/ondemand-tasks/:id/runs** — On-demand execution history

### Orchestrator

- **GET /api/orchestrators** — Orchestrator list
- **POST /api/orchestrators** — Create orchestrator
- **GET /api/orchestrators/:id** — Orchestrator details (including nodes + edges)
- **PATCH /api/orchestrators/:id** — Update orchestrator
- **DELETE /api/orchestrators/:id** — Delete orchestrator (soft)
- **POST /api/orchestrators/:id/nodes** — Create node
- **PATCH /api/orchestrators/:oid/nodes/:nid** — Update node
- **DELETE /api/orchestrators/:oid/nodes/:nid** — Delete node (cascade)
- **POST /api/orchestrators/:id/edges** — Create edge
- **PATCH /api/orchestrators/:oid/edges/:eid** — Update edge
- **DELETE /api/orchestrators/:oid/edges/:eid** — Delete edge
- **POST /api/orchestrators/:id/validate** — DAG validation
- **POST /api/orchestrators/:id/revert** — Restore to validated snapshot
- **POST /api/orchestrators/:id/execute** — Start orchestration execution
- **GET /api/orchestrators/:id/runs/overview** — Execution history overview (aggregated runs + node runs)
- **POST /api/orchestrators/:id/rerun/:runId** — Rerun
- **POST /api/orchestrators/:id/cancel/:runId** — Cancel run
- **GET /api/orchestrators/:id/runs/:runId/stream** — Run status SSE stream

### Webhook / Event Trigger

- **POST /webhooks/:token** — Public webhook receive endpoint (**no Bearer authentication required**)
- **GET /api/webhook-endpoints** — Webhook endpoint list
- **POST /api/webhook-endpoints** — Create webhook endpoint
- **GET /api/webhook-endpoints/:id** — Webhook endpoint details
- **PATCH /api/webhook-endpoints/:id** — Update webhook endpoint
- **DELETE /api/webhook-endpoints/:id** — Delete webhook endpoint
- **GET /api/event-subscriptions** — Event subscription list
- **POST /api/event-subscriptions** — Create event subscription
- **GET /api/event-subscriptions/:id** — Event subscription details
- **PATCH /api/event-subscriptions/:id** — Update event subscription
- **DELETE /api/event-subscriptions/:id** — Delete event subscription
- **POST /api/event-subscriptions/:id/test** — Event filter test (dry-run)
- **GET /api/triggered-tasks** — Triggered task list
- **POST /api/triggered-tasks** — Create triggered task (inline subscription support)
- **GET /api/triggered-tasks/:id** — Triggered task details (including recentRuns)
- **PATCH /api/triggered-tasks/:id** — Update triggered task (inline subscription upsert/delete support)
- **DELETE /api/triggered-tasks/:id** — Delete triggered task
- **GET /api/triggered-tasks/:id/runs** — Triggered task execution history

### Notification

- **GET /api/slack/targets** — Slack notification target candidate list
- **POST /api/notify** — Send Slack notification

### Notes

> **`mode` field**: The `mode` included in responses is always `'write'` (fixed in P3 change). It is read-only and cannot be changed via the API or Dashboard.

> **Deprecated DB columns**: `orchestrator_nodes.args`, `orchestrator_nodes.instruction_file`, `orchestrator_nodes.enabled_skills_json` are legacy columns. They are not used in the code, and `mapNode()` does not read them either. They are not deleted because SQLite column deletion requires a table rebuild.

> **Webhook subscription dry-run size cap**: `POST /api/event-subscriptions/:id/test` is a diagnostic endpoint and must enforce a tighter request cap than the shared 64KB API body limit. Oversized test payloads return `413` before filter evaluation.

> **Inline subscription endpoint revalidation**: `POST /api/triggered-tasks` and `PATCH /api/triggered-tasks/:id` can mutate an inline event subscription together with the task record. The referenced webhook endpoint must be rechecked inside the task transaction so concurrent endpoint deletion returns `400` instead of surfacing a DB `500`.

> **Inline subscription JSON validation**: Inline webhook subscription upserts accept serialized `filterJson` / `contextMappingJson` strings from the dashboard, but the server must parse and validate those payloads before persistence. Malformed JSON or invalid filter/mapping shapes return `400`, and stored parse failures must not be treated as match-all at dispatch time.

> **Inline subscription mutation contract**: Inline webhook subscription payloads are fail-closed. On `PATCH`, an omitted inline subscription field means "leave unchanged", `null` means explicit deletion, and an object means upsert with a required non-empty `endpointId`. Partial object payloads must not silently delete an existing subscription.

> **Response hardening**: Shared JSON responses, SSE streams, and artifact delivery send `X-Content-Type-Options: nosniff`. Artifact routes force download for active-content MIME types (`text/html`, `application/xhtml+xml`, `image/svg+xml`) and add a sandboxed CSP header as defense in depth.

---

## Module Boundaries

- **api.ts** (`src/server/api.ts`) — auth, central dispatcher, route matching, injected notification route wiring
- **notification-service.ts** (`src/server/notification-service.ts`) — Notification contract for Server API
- **slack-notification-service.ts** (`src/server/slack-notification-service.ts`) — Slack-backed implementation for `/api/notify` and `/api/slack/targets`
- **state.ts** (`src/server/state.ts`) — Shared in-memory state (JobStreamBuffer)
- **session-api.ts** (`src/server/routes/session-api.ts`) — Session CRUD + cleanup
- **chat-api.ts** (`src/server/routes/chat-api.ts`) — Chat SSE/job-stream, tool approval rerun
- **artifact-api.ts** (`src/server/routes/artifact-api.ts`) — Artifact list/serve
- **settings-api.ts** (`src/server/routes/settings-api.ts`) — Keychain + runtime config hot-reload
- **schedule-api.ts** (`src/server/routes/schedule-api.ts`) — Schedule CRUD + validation
- **ondemand-api.ts** (`src/server/routes/ondemand-api.ts`) — On-demand CRUD + execute
- **task-api-shared.ts** (`src/server/routes/task-api-shared.ts`) — `resolveTaskUserId()`, `instructionFile` constraint
- **webhook-api.ts** (`src/server/routes/webhook-api.ts`) — Public webhook receive + event trigger management
- **orchestrator-api.ts** (`src/server/routes/orchestrator-api.ts`) — Orchestrator CRUD + node/edge/runs/SSE

Each route module exports:

- `handleXxxRoutes(ctx, req, res, pathname)` — route handler
- `matchesXxxApiPath(pathname)` — path matcher (used by dispatcher)

The SSOT for path determination is in the route module side. `api.ts` only routes based on the matcher results.

Notification endpoints are intentionally mediated through an injected `NotificationService` rather than calling Slack directly from `api.ts`. This keeps the dispatcher transport-agnostic and isolates Slack-specific pagination / user lookup behavior behind a narrow interface.

---

## Server State (`src/server/state.ts`)

Shared in-memory state for the Server API. Manages buffering for Chat SSE / job-stream.

### `JobStreamBuffer`

SSE event buffer per job. Enables replaying SSE events from the beginning even for retry jobs after Dashboard tool approval.

```typescript
export interface JobStreamBuffer {
  events: Array<{ type: string; content: string; eventId: number }>;
  sseRes: ServerResponse | null;
  done: boolean;
  doneAt: number;               // timestamp (ms) when job completed
  assistantChunks: string[];
  toolApprovalReceived: boolean;
  lastToolCharOffset: number;
  currentCharOffset: number;
  sawToolEvent: boolean;
}
```

### Overflow Protection

- `MAX_BUFFER_EVENTS = 10_000` — Maximum buffer events per job
- Automatic sweep at 60-second intervals deleting buffers where `done && now - doneAt >= 60s`

### `Last-Event-ID` Header

References the `Last-Event-ID` header during SSE reconnect to perform partial replay from the buffer. Prevents event loss during client disconnect -> reconnect.

---

## Chat Execution Flow (`POST /api/chat/:id/send`)

1. Resolve session via `SessionManager.getSessionSummaryById()`
2. Create job with `source: 'dashboard'`
3. Register SSE callback in `ctx.jobEventStreams`
4. Submit via `ctx.jobQueue.enqueue(job)`
5. `job-executor.ts` detects `isDashboard` -> uses `NullMessenger`, transfers via `dashboardStream` to SSE
6. On completion: save messages to `ConversationStore`, end SSE

---

## Tool Approval Flow (`POST /api/chat/:id/tool-approval`)

- Tool approval is shared between Slack/Dashboard: when `job-executor.ts` detects `permissionDenied`, it registers an entry in `pendingToolApprovals` and saves it as a `system` message in `dashboard_messages`
- Dashboard displays the approval bubble via `tool_approval` SSE event or polling
- `POST /api/chat/:id/tool-approval` sends `{ decision: 'approve'|'deny', requestId }`
- On approval: builds `toolStateOverrides` with logic equivalent to `approval-handler.ts` and submits a retry job
- On denial: saves a `tool_approval_result` system message
- Concurrent approval prevention: `pendingToolApprovals.delete(key)` for first-come-first-served

---

## Schedule / On-Demand Notification Spec

### Notification Timing

`job-executor.ts` sends Slack notifications upon execution completion (success/failure/retry).

### Mention Specification

Auto-inserts mention at the first line: `formatMention(job.userId) || formatMention(task.notifyChannel)`

- When `job.userId` is a valid Slack user ID (`U...`/`W...`): `<@userId>`
- When invalid, only if `notifyChannel` is a Slack user ID: `<@notifyChannel>`
- No mention for notifications to channel IDs (`C...`/`G...`)

### Thread Posting

- For Schedule: posts to the thread if `notifyThread` is set; if not set, replies with output split to the header post's thread
- Long output body is split and replied in code blocks as thread replies

### `user_id` Resolution

Unified in `resolveTaskUserId()`. Priority order:

1. `user_id` is a valid Slack user ID
2. `notify_channel` is a valid Slack user ID
3. Raw value of `user_id` (non-empty string)
4. `'dashboard'`

### API Validation

- `maxRetries`: `0..10`
- `name`: `<= 200` characters
- `alias`: `<= 100` characters
- `description`: `<= 2000` characters
- `prompt`: `<= 50000` characters
- Task create/update routes must reject resolved `user_id` values that are neither `'dashboard'` nor present in `ALLOWED_USER_IDS`

### API Field Naming Convention

camelCase is the official name. snake_case is accepted as a backward-compatible alias (`parsed.maxRetries ?? parsed.max_retries` pattern).
