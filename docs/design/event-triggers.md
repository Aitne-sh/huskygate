# Event Triggers

## Overview

A mechanism that automatically starts Orchestrator Runs or Triggered Tasks based on external webhook events.
It receives HTTP webhooks and processes them in order: signature verification, event routing, filter matching, and target dispatch.

### Goals
- Automatically execute AI tasks triggered by events from external services (GitHub, Slack, CI/CD, etc.)
- Start specific nodes of an Orchestrator DAG via incoming webhooks (triggered nodes)
- Selectively process only necessary events through filtering and context mapping

### Non-Goals
- Managing the webhook publisher side
- Complex event stream processing (CEP)

## Architecture Flow

```
External Service
    |
    v
POST /webhooks/:token
    |
    +-- Body size check (max_body_bytes, default 256KB, max 1MB)
    |
    v
EventRouter.dispatchWebhook()
    |
    +-- Endpoint lookup (token -> WebhookEndpoint)
    +-- Signature verification (HMAC-SHA256 / HMAC-SHA1 / Bearer / none)
    +-- JSON parse + object validation
    +-- Idempotency check (delivery ID-based deduplication)
    |   +-- L1: in-memory cache (Map<deliveryKey, DeliveryState>)
    |   +-- L2: DB (webhook_deliveries table)
    |
    v
Build TriggerEnvelope
    {
      _trigger: { publisher, event, deliveryId },
      body: <parsed webhook body>,
      headers: <normalized lowercase headers>
    }
    |
    v
For each enabled EventSubscription (on this endpoint):
    |
    +-- Filter evaluation (AND logic: all match clauses must pass)
    +-- Context mapping (dot-path extraction -> trigger context object)
    +-- Size check (trigger context <= 8KB)
    |
    v
Dispatch to target:
    +-- orchestrator    -> OrchestratorEngine.startRun(id, 'webhook', { triggerContext })
    +-- triggered_task  -> TriggeredTaskExecutor.execute(id, 'webhook', context)
    +-- triggered_node  -> ActiveTriggeredWaiter.onEvent(context)
```

## Key Components

### 1. Webhook Endpoints (`src/event/types.ts`, `src/store/webhook-endpoint.ts`)

Endpoints that receive events via token-based URLs.

```typescript
interface WebhookEndpoint {
  id: string;                        // UUID
  token: string;                     // Random token embedded in URL (18 bytes hex)
  publisherPreset: PublisherPreset;  // 'generic' | 'github' | 'slack' | 'jira'
  verificationType: VerificationType; // 'none' | 'hmac-sha256' | 'hmac-sha1' | 'bearer' | 'slack-v0'
  signatureHeader: string | null;    // Signature header name (e.g. 'x-hub-signature-256')
  signaturePrefix: string | null;    // Signature prefix (e.g. 'sha256=')
  deliveryIdHeader: string | null;   // Delivery ID header (used for idempotency)
  eventNameHeader: string | null;    // Event name header (e.g. 'x-github-event')
  secretRef: string | null;          // Secret reference name on Keychain
  maxBodyBytes: number;              // Body size limit (64KB - 1MB, default 256KB)
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
```

**Public URL**: The dashboard constructs webhook URLs client-side using a mode toggle (localStorage):
- **localhost mode** (default): `http://localhost:{port}/webhooks/{token}` (port defaults to 3738)
- **Custom URL mode**: `{user-provided base URL}/webhooks/{token}` (for ngrok, production, etc.)

The server-side `WEBHOOK_PUBLIC_BASE_URL` env var remains available for API consumers — when set, the API response includes a `publicUrl` field.

### 2. Publisher Presets (`src/event/publisher-presets.ts`)

When a preset is specified during endpoint creation, header settings are automatically applied.

- **`generic` preset**
  - verificationType: `none`
  - signatureHeader: (null)
  - signaturePrefix: (null)
  - deliveryIdHeader: (null)
  - eventNameHeader: (null)

- **`github` preset**
  - verificationType: `hmac-sha256`
  - signatureHeader: `x-hub-signature-256`
  - signaturePrefix: `sha256=`
  - deliveryIdHeader: `x-github-delivery`
  - eventNameHeader: `x-github-event`

- **`slack` preset**
  - verificationType: `slack-v0`
  - signatureHeader: `x-slack-signature`
  - signaturePrefix: `v0=`
  - deliveryIdHeader: (null) — deduplication uses body `event_id` via filter
  - eventNameHeader: (null) — event type is at `body.event.type`
  - **URL verification**: When `body.type === "url_verification"`, returns `{ challenge }` with HTTP 200 (required for Slack app setup)
  - **Filter examples**: `{ "path": "body.event.type", "eq": "message" }`, `{ "path": "body.event.text", "prefix": "[deploy]" }`

- **`jira` preset**
  - verificationType: `hmac-sha256`
  - signatureHeader: `x-hub-signature`
  - signaturePrefix: `sha256=`
  - deliveryIdHeader: `x-atlassian-webhook-identifier`
  - eventNameHeader: (null) — event type is at `body.webhookEvent`
  - **Filter examples**: `{ "path": "body.webhookEvent", "eq": "jira:issue_updated" }`, status change: `{ "path": "body.changelog.items.0", "exists": true }`

### 3. Signature Verification (`EventRouter.verifyEndpoint()`)

Behavior per verification type:

- **`none`**: Skipped
- **`hmac-sha256`**: Computes `HMAC(sha256, secret, rawBody)` and performs timing-safe comparison with the `signatureHeader` value
- **`hmac-sha1`**: Computes `HMAC(sha1, secret, rawBody)` and performs timing-safe comparison with the `signatureHeader` value
- **`bearer`**: Performs timing-safe comparison of the `Authorization` (or `signatureHeader`) header value against `{signaturePrefix}{secret}`
- **`slack-v0`**: Slack-proprietary HMAC. Validates `x-slack-request-timestamp` is within 5 minutes (replay attack prevention), then computes `HMAC(sha256, secret, "v0:{timestamp}:{rawBody}")` and performs timing-safe comparison with the `signatureHeader` value

Secrets are stored in the OS Keychain (macOS Keychain / Windows Credential Store) via `WebhookSecretStore`.
- Reference name: `webhook-endpoint:{endpointId}`
- Auto-generated: `crypto.randomBytes(32).toString('hex')` (64 characters)
- Custom values can be specified via the `secret` field during endpoint creation/update

### 4. Event Subscriptions (`src/store/event-subscription.ts`)

Links endpoints to targets. Multiple subscriptions can be configured per endpoint.

```typescript
interface EventSubscription {
  id: string;
  endpointId: string;
  targetType: EventTargetType;       // 'orchestrator' | 'triggered_task' | 'triggered_node'
  orchestratorId: string | null;     // Required when targetType === 'orchestrator'
  triggeredTaskId: string | null;    // Required when targetType === 'triggered_task'
  nodeId: string | null;             // Required when targetType === 'triggered_node'
  filterJson: string | null;         // JSON of EventFilterDefinition
  contextMappingJson: string | null; // JSON of EventContextMapping
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
```

**Constraints (DB CHECK)**:
- Only the corresponding ID field is NOT NULL depending on the targetType
- `triggered_node` has a UNIQUE constraint on nodeId (only 1 subscription per node)

**Behavior per target type**:

- **`orchestrator`**: Target is an Orchestrator DAG. Only `triggerMode='webhook'` orchestrators are valid targets. API writes reject `ondemand` orchestrators, and dispatch re-checks the stored target before calling `OrchestratorEngine.startRun()`.
- **`triggered_task`**: Target is a Triggered Task (standalone). Dispatched via `TriggeredTaskExecutor.execute()` to queue a job.
- **`triggered_node`**: Target is a triggered node within a DAG. Dispatched via `ActiveTriggeredWaiter.onEvent()` to activate a waiting node.

### 5. Webhook Filter (`src/event/webhook-filter.ts`)

Selectively matches events based on filter definitions set on subscriptions.

```typescript
type EventFilterClause =
  | { path: string; eq: string | number | boolean }     // Exact match
  | { path: string; in: (string | number | boolean)[] } // Match any
  | { path: string; exists: boolean }                    // Field existence/non-existence
  | { path: string; prefix: string };                    // Prefix match

interface EventFilterDefinition {
  match: EventFilterClause[];  // AND conjunction: all clauses must match
}
```

**Path specification**:
- Dot-separated: `body.action`, `_trigger.event`, `headers.x-github-event`
- Root is one of 3 types: `body`, `headers`, `_trigger`
- Regex: `/^(body|headers|_trigger)\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/`
- Leading/trailing whitespace is trimmed before validation/persistence
- `headers.*` paths are automatically lowercased
- Array index access (`[0]`) is not supported
- Reserved prototype segments (`__proto__`, `constructor`, `prototype`) are rejected
- Path traversal resolves own-properties only; prototype-chain values must not affect filter evaluation

**Example: GitHub push events on main branch only**
```json
{
  "match": [
    { "path": "_trigger.event", "eq": "push" },
    { "path": "body.ref", "eq": "refs/heads/main" }
  ]
}
```

### 6. Context Mapping

Extracts necessary fields from the webhook payload and passes them to the target as trigger context.

```typescript
// Definition: { output key: dot path }
type EventContextMapping = Record<string, string>;

// Example
{
  "repo": "body.repository.full_name",
  "branch": "body.ref",
  "author": "body.pusher.name"
}
```

**Output**: `_trigger` metadata is automatically appended to the context mapping result.

```json
{
  "repo": "owner/repo",
  "branch": "refs/heads/main",
  "author": "shuto",
  "_trigger": {
    "publisher": "github",
    "event": "push",
    "deliveryId": "abc-123"
  }
}
```

**Size limit**: Trigger context is limited to 8KB total (`MAX_TRIGGER_CONTEXT_BYTES`).

**Safety rules**:
- Mapping output keys reject reserved prototype names (`__proto__`, `constructor`, `prototype`) and `_trigger`
- Malformed stored filter/context JSON is treated as invalid configuration; dispatch skips that subscription and dry-run APIs return a validation error
- Stored subscriptions whose target no longer satisfies routing invariants (for example, an orchestrator target no longer in webhook mode) are skipped with warning logs instead of being dispatched

### Inline Subscription Contract

- `POST /api/triggered-tasks` and triggered-node create APIs accept inline subscription objects only when `endpointId` is present and non-empty
- `POST` / `PATCH` for explicit event subscriptions must reject orchestrator targets whose referenced orchestrator is not in `triggerMode='webhook'`
- `PATCH` semantics are fail-closed:
  - omitted field: leave the existing subscription unchanged
  - `null`: explicitly remove the subscription
  - object: upsert, with `endpointId` required
- Invalid inline payloads must return `400` and must not delete or overwrite an existing subscription implicitly

### 7. Trigger Context Injection (`src/event/trigger-context.ts`)

Trigger context is appended to the prompt and passed to the agent.

```
<original prompt>

--- Trigger Event Context ---
Use this only if relevant.
{
  "repo": "owner/repo",
  "branch": "refs/heads/main",
  ...
}
```

Utility functions:
- `serializeTriggerContext()`: JSON serialization + 8KB size validation
- `parseTriggerContext()`: JSON deserialization (returns null on error)
- `appendTriggerContext()`: Appends to the prompt string

### 8. Triggered Tasks (`src/store/triggered-task.ts`, `src/event/triggered-task-executor.ts`)

Standalone task definitions that are executed in an event-driven manner.

```typescript
interface TriggeredTask {
  id: string;
  name: string;
  description: string | null;
  userId: string;                             // Session owner (default: 'dashboard')
  tool: ToolName;                             // 'claude' | 'codex' | 'gemini'
  mode: Mode;                                 // 'readonly' | 'write'
  prompt: string;
  workdir: string | null;                     // Auto-assigned if null
  maxRetries: number;                         // 0-10
  allowMcp: boolean;
  enabledSkills: SkillRef[] | null;
  instructionFile: string | null;
  notifyChannel: string | null;               // Slack notification channel
  enabled: boolean;
  runCount: number;                           // Cumulative execution count
  lastRunAt: string | null;
  concurrencyPolicy: 'allow' | 'skip_if_running';
  claimedAt: string | null;                   // Timestamp for exclusive control
  createdAt: string;
  updatedAt: string;
}

Triggered-task create/update APIs may include an inline webhook subscription payload for atomic save, but the embedded `filterJson` / `contextMappingJson` strings are re-parsed and validated before persistence. Invalid serialized JSON is rejected with `400` instead of being stored.
```

**Concurrency control (`concurrencyPolicy`)**:
- `allow`: Always permits new executions
- `skip_if_running`: Permits execution only when `claimedAt IS NULL` (optimistic locking). Released via `releaseClaim()` on completion/failure. `recoverStaleClaims()` automatically recovers timed-out claims.

**Execution flow** (`TriggeredTaskExecutor.execute()`):
1. Retrieve task + validity check
2. Acquire claim based on concurrency policy
3. Create session via `SessionManager.createStandaloneSession()`
4. Prepare working directory via `WorkdirManager.prepareWorkdirSkillsOnly()`
5. Create execution record via `TriggeredTaskStore.recordRun()` (status: `running`)
6. Submit job via `JobQueue.enqueue()`
7. On failure: cleanup session/working directory + release claim

### 9. Triggered Task Runs

History records of task executions.

```typescript
interface TriggeredTaskRun {
  id: string;
  triggeredTaskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  triggeredBy: RunTrigger;          // 'webhook' | 'manual' | 'schedule', etc.
  triggerContextJson: string | null;
  sessionKey: string | null;
  jobId: string | null;
  exitCode: number | null;
  outputSummary: string | null;
  errorMessage: string | null;
  retryCount: number;
  startedAt: string;
  endedAt: string | null;
}
```

### 10. Webhook Deliveries (`src/store/webhook-delivery.ts`)

Idempotency guarantee and audit log based on delivery IDs.

**Status lifecycle**:
```
tryClaimDelivery()
    +-- New            -> INSERT status='dispatching'  -> result='claimed'
    +-- status='completed' or 'dispatching' -> result='duplicate' (skipped)
    +-- status='partial'  -> UPDATE status='dispatching' -> result='retry'

After dispatch completion:
    +-- All subscriptions succeeded -> markCompleted() (status='completed')
    +-- Some failed                -> markPartial()   (status='partial', successful_sub_ids saved)
```

**2-layer cache**:
- L1: `EventRouter.recentDeliveries` (in-memory Map, TTL 24h)
- L2: `webhook_deliveries` DB table (restart-safe, cross-instance)

## Event Router (`src/event/event-router.ts`)

Core class. Reconstructs state via `reload()` at startup and on configuration changes.

### Internal Cache
- `endpointsByToken: Map<string, WebhookEndpoint>` -- token to endpoint
- `subscriptionsByEndpointId: Map<string, EventSubscription[]>` -- endpoint ID to subscription array
- `triggeredNodeSubscriptionsByNodeId: Map<string, EventSubscription>` -- node ID to triggered_node subscription
- `activeWaitersBySubscriptionId: Map<string, Map<string, ActiveTriggeredWaiter>>` -- subscription ID to waiting waiters

### Triggered Node Waiter

Orchestrator DAG `triggered` nodes wait until a webhook event arrives.

```typescript
interface ActiveTriggeredWaiter {
  runId: string;
  nodeId: string;
  subscriptionId: string;
  onEvent: (payload: Record<string, unknown> | null) => void;
  onTimeout: () => void;
}
```

- Register a waiter via `registerTriggeredWaiter()`; the returned function deregisters it
- On `reload()`, orphaned waiters from deleted subscriptions are forcefully terminated via `onTimeout()`
- On webhook arrival, `onEvent()` is broadcast to all waiters for the matching subscription

## Database Schema

```sql
-- Webhook endpoints
CREATE TABLE webhook_endpoints (
  id                 TEXT PRIMARY KEY,
  token              TEXT NOT NULL UNIQUE,
  publisher_preset   TEXT NOT NULL DEFAULT 'generic',
  verification_type  TEXT NOT NULL DEFAULT 'none',
  signature_header   TEXT,
  signature_prefix   TEXT,
  delivery_id_header TEXT,
  event_name_header  TEXT,
  secret_ref         TEXT,
  max_body_bytes     INTEGER NOT NULL DEFAULT 262144,
  enabled            INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX idx_webhook_endpoints_token ON webhook_endpoints(token);

-- Event subscriptions
CREATE TABLE event_subscriptions (
  id                   TEXT PRIMARY KEY,
  endpoint_id          TEXT NOT NULL,
  target_type          TEXT NOT NULL
    CHECK (target_type IN ('orchestrator','triggered_task','triggered_node')),
  orchestrator_id      TEXT,
  triggered_task_id    TEXT,
  node_id              TEXT,
  filter_json          TEXT,
  context_mapping_json TEXT,
  enabled              INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  CHECK (
    (target_type='orchestrator'    AND orchestrator_id IS NOT NULL AND triggered_task_id IS NULL AND node_id IS NULL) OR
    (target_type='triggered_task'  AND orchestrator_id IS NULL AND triggered_task_id IS NOT NULL AND node_id IS NULL) OR
    (target_type='triggered_node'  AND orchestrator_id IS NULL AND triggered_task_id IS NULL AND node_id IS NOT NULL)
  )
);
CREATE INDEX idx_event_subscriptions_endpoint ON event_subscriptions(endpoint_id, enabled);
CREATE UNIQUE INDEX idx_event_subscriptions_triggered_node_unique
  ON event_subscriptions(node_id) WHERE target_type = 'triggered_node';

-- Triggered task definitions
CREATE TABLE triggered_tasks (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  description         TEXT,
  user_id             TEXT NOT NULL DEFAULT 'dashboard',
  tool                TEXT NOT NULL DEFAULT 'claude',
  mode                TEXT NOT NULL DEFAULT 'write',
  prompt              TEXT NOT NULL,
  workdir             TEXT,
  max_retries         INTEGER NOT NULL DEFAULT 0,
  allow_mcp           INTEGER NOT NULL DEFAULT 1,
  enabled_skills_json TEXT,
  instruction_file    TEXT,
  notify_channel      TEXT,
  enabled             INTEGER NOT NULL DEFAULT 1,
  run_count           INTEGER NOT NULL DEFAULT 0,
  last_run_at         TEXT,
  concurrency_policy  TEXT NOT NULL DEFAULT 'skip_if_running',
  claimed_at          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_triggered_tasks_enabled ON triggered_tasks(enabled, created_at DESC);

-- Triggered task execution history
CREATE TABLE triggered_task_runs (
  id                   TEXT PRIMARY KEY,
  triggered_task_id    TEXT NOT NULL REFERENCES triggered_tasks(id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'pending',
  triggered_by         TEXT NOT NULL DEFAULT 'webhook',
  trigger_context_json TEXT,
  session_key          TEXT,
  job_id               TEXT,
  exit_code            INTEGER,
  output_summary       TEXT,
  error_message        TEXT,
  retry_count          INTEGER NOT NULL DEFAULT 0,
  started_at           TEXT NOT NULL,
  ended_at             TEXT
);
CREATE INDEX idx_triggered_task_runs_task ON triggered_task_runs(triggered_task_id, started_at DESC);
CREATE INDEX idx_triggered_task_runs_job ON triggered_task_runs(job_id);

-- Webhook delivery records (idempotency)
CREATE TABLE webhook_deliveries (
  endpoint_id          TEXT NOT NULL,
  delivery_id          TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'dispatching',
  successful_sub_ids   TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  PRIMARY KEY (endpoint_id, delivery_id)
);
CREATE INDEX idx_webhook_deliveries_updated ON webhook_deliveries(updated_at);
```

## REST API (`src/server/routes/webhook-api.ts`)

### Public Webhook Receiver

- `POST /webhooks/:token` -- Receives webhook events. Performs verification, filtering, and dispatch. Returns `202 Accepted` on success. For Slack `url_verification` requests, returns `200` with the challenge value.

### Webhook Endpoint CRUD

- `GET /api/webhook-endpoints` -- List all endpoints
- `POST /api/webhook-endpoints` -- Create an endpoint. Secret can be specified via the `secret` field. The response returns the `secret` only once.
- `GET /api/webhook-endpoints/:id` -- Get a single endpoint
- `PATCH /api/webhook-endpoints/:id` -- Update an endpoint. Supports optimistic locking via `updatedAt`.
- `DELETE /api/webhook-endpoints/:id` -- Delete an endpoint (related subscriptions are also CASCADE deleted)

### Event Subscription CRUD

- `GET /api/event-subscriptions` -- List all subscriptions
- `POST /api/event-subscriptions` -- Create a subscription. Accepts `filter` / `filterJson` and `contextMapping` / `contextMappingJson`.
- `PATCH /api/event-subscriptions/:id` -- Update a subscription
- `DELETE /api/event-subscriptions/:id` -- Delete a subscription
- `POST /api/event-subscriptions/:id/test` -- Test: Send body/headers to check filter match and context mapping results

### Triggered Task CRUD

- `GET /api/triggered-tasks` -- List all tasks
- `POST /api/triggered-tasks` -- Create a task. Inline subscription can be atomically created via the `subscription` field.
- `GET /api/triggered-tasks/:id` -- Get a single task + the 10 most recent execution history entries
- `PATCH /api/triggered-tasks/:id` -- Update a task. Inline subscription can be updated/deleted via the `subscription` field.
- `DELETE /api/triggered-tasks/:id` -- Delete a task (related subscriptions and runs are also CASCADE deleted)
- `GET /api/triggered-tasks/:id/runs` -- Execution history list (`?limit=N`, max 100)

## Error Handling

Structured errors via `WebhookDispatchError`:

- **`400` / `invalid_json`**: JSON parse error or non-object body
- **`400` / `trigger_context_too_large`**: Context mapping result exceeds 8KB
- **`401` / `invalid_signature`**: Signature verification failed
- **`401` / `missing_timestamp`**: Slack `x-slack-request-timestamp` header missing (slack-v0 only)
- **`401` / `timestamp_expired`**: Slack timestamp older than 5 minutes (replay attack prevention)
- **`404` / `endpoint_not_found`**: Invalid token or disabled endpoint
- **`409` / (conflict message)**: Subscription duplicate (already exists for the same target)
- **`413` / (body too large)**: Body size exceeds `maxBodyBytes`
- **`500` / `endpoint_secret_missing`**: Secret not configured
- **`503` / `dispatch_failed`**: Some subscription dispatches failed (partial failure)

## Security

- **Token-based URL**: The endpoint URL itself is a secret (18 bytes = 36 hex chars)
- **Signature verification**: HMAC-SHA256/SHA1 uses `timingSafeEqualString()` to prevent timing attacks
- **Secret storage**: Stored in OS Keychain (`KeychainProvider`). Secret values are not stored in the DB.
- **Body size limit**: Requests exceeding `maxBodyBytes` (min 64KB, max 1MB) are rejected with 413
- **Input validation**: Filter definition and context mapping paths are validated with regex (array access is prohibited)
- **Trigger context size limit**: 8KB (as part of prompt injection countermeasures)

## Secure Webhook Ingress (Cloudflare Tunnel)

### Overview

By default, the API server binds to `127.0.0.1:3738` and cannot receive external webhooks.
Cloudflare Tunnel provides a zero-trust transport layer that exposes the webhook endpoint without opening inbound firewall ports.

### Security Architecture

```
External Service (GitHub, Slack, etc.)
    |
    v
+-------------------------------------+
| Layer 1: Cloudflare Edge            |  DDoS protection, WAF, TLS termination
|   - Rate limiting (Cloudflare-side) |
|   - Quantum-safe encryption         |
+------------------+------------------+
                   | Encrypted tunnel (outbound-only from your host)
                   v
+-------------------------------------+
| Layer 2: cloudflared (local)        |  No inbound firewall rules needed
+------------------+------------------+
                   | localhost:3738
                   v
+-------------------------------------+
| Layer 3: HuskyGate Application      |
|   - GitHub IP allowlist (Meta API)  |  <- Defense-in-depth via CF-Connecting-IP
|   - HMAC-SHA256 signature verify    |  <- Primary authentication
|   - Timing-safe comparison          |
|   - Timestamp/replay protection     |
|   - Body size limits (256KB default)|
|   - Idempotency (2-layer cache)     |
|   - Secrets in OS Keychain          |
+-------------------------------------+
```

### Two Tunnel Modes

#### Quick Tunnel (Development)

No Cloudflare account required. Generates a random `trycloudflare.com` URL.

```bash
# Automatic: set CLOUDFLARE_TUNNEL_ENABLED=true
# HuskyGate spawns cloudflared and auto-sets WEBHOOK_PUBLIC_BASE_URL
```

- URL changes on every restart
- No custom domain
- No Cloudflare Access policies
- Suitable for development/testing only

#### Named Tunnel (Production)

Requires a Cloudflare account and domain.

```bash
# 1. Install cloudflared and authenticate
cloudflared tunnel login

# 2. Create a named tunnel
cloudflared tunnel create huskygate-webhooks

# 3. Route DNS to the tunnel
cloudflared tunnel route dns huskygate-webhooks hooks.example.com

# 4. Configure HuskyGate
CLOUDFLARE_TUNNEL_ENABLED=true
CLOUDFLARE_TUNNEL_TOKEN=<tunnel-token-from-dashboard>
WEBHOOK_PUBLIC_BASE_URL=https://hooks.example.com
```

- Stable URL with custom domain
- Cloudflare Access policies available (identity-based, IP-based)
- Zero Trust integration (SAML/OIDC)
- Production-grade

### GitHub IP Allowlist

Defense-in-depth layer that validates webhook source IPs against GitHub's published hook IP ranges.

- **Source**: GitHub Meta API (`GET https://api.github.com/meta` → `hooks` array)
- **Refresh interval**: Every 6 hours (automatic)
- **Matching**: `node:net.BlockList` for O(1) CIDR matching (IPv4 + IPv6)
- **Fail-open**: If the Meta API is unreachable, all IPs are allowed (HMAC is the primary gate)
- **Scope**: Only applied to endpoints with `publisherPreset: 'github'` when tunnel is enabled

**IP extraction security**: The `CF-Connecting-IP` header is only trusted when `req.socket.remoteAddress` is loopback (`127.0.0.1` / `::1`). This prevents header spoofing from direct connections that bypass the tunnel.

### Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `CLOUDFLARE_TUNNEL_ENABLED` | boolean | `false` | Enable Cloudflare Tunnel. Requires `cloudflared` CLI. |
| `CLOUDFLARE_TUNNEL_TOKEN` | string (sensitive) | — | Named tunnel token. Empty = quick tunnel mode. |
| `GITHUB_WEBHOOK_IP_ALLOWLIST` | boolean | `true` | Enable GitHub webhook IP validation via Meta API. |
| `WEBHOOK_PUBLIC_BASE_URL` | string | — | Auto-set by quick tunnels. Set manually for named tunnels. |

### Cloudflare Access Setup (Optional, Named Tunnels Only)

For maximum security with named tunnels, configure Cloudflare Access policies:

1. Navigate to Cloudflare Zero Trust Dashboard → Access → Applications
2. Create an application for your webhook domain (e.g., `hooks.example.com`)
3. Add a policy:
   - **Name**: "GitHub Webhooks"
   - **Action**: Service Auth
   - **Selector**: IP Ranges
   - **Values**: Fetch from `https://api.github.com/meta` → `hooks` array
4. Repeat for Slack/Jira if needed (note: Slack does not publish fixed egress IPs)

> **Note**: GitHub's hook IPs change periodically. Monitor the Meta API or set up a scheduled task to update the Cloudflare Access policy.

## Environment Variables

- `WEBHOOK_PUBLIC_BASE_URL` -- (optional, server-side only) Public URL base for the `publicUrl` field in API responses. Auto-set by quick tunnels. The dashboard manages URL display client-side via localStorage.
- `CLOUDFLARE_TUNNEL_ENABLED` -- Enable Cloudflare Tunnel for secure webhook ingress.
- `CLOUDFLARE_TUNNEL_TOKEN` -- Named tunnel token (secure store). Leave empty for quick tunnels.
- `GITHUB_WEBHOOK_IP_ALLOWLIST` -- Enable GitHub webhook source IP validation.

## File Map

```
src/event/
+-- types.ts                    # All type definitions (WebhookEndpoint, EventSubscription, TriggeredTask, etc.)
+-- event-router.ts             # EventRouter: signature verification, routing, dispatch
+-- webhook-filter.ts           # Filter evaluation, context mapping, validation
+-- webhook-secret-store.ts     # WebhookSecretStore: secret management via OS Keychain
+-- publisher-presets.ts        # PublisherPreset definitions (generic, github, slack, jira)
+-- trigger-context.ts          # Trigger context serialization and prompt appending
+-- triggered-task-executor.ts  # TriggeredTaskExecutor: task execution lifecycle

src/store/
+-- webhook-endpoint.ts         # WebhookEndpointStore: endpoint CRUD
+-- event-subscription.ts       # EventSubscriptionStore: subscription CRUD
+-- triggered-task.ts           # TriggeredTaskStore: task + execution history CRUD
+-- webhook-delivery.ts         # WebhookDeliveryStore: idempotency management

src/server/
+-- tunnel.ts                   # CloudflareTunnel: cloudflared lifecycle management
+-- github-ip-allowlist.ts      # GitHubIpAllowlist: Meta API IP validation + client IP extraction
+-- routes/webhook-api.ts       # REST API handlers (public webhook + management API)
```
