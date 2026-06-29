# Config & Lifecycle

Design for environment variables, startup/shutdown sequences, job queue, and process management.

---

## Runner & Timeout

### Process Management

Child processes create a process group with `detached: true`, and the entire group is controlled.

```typescript
spawn(command, args, {
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: workdir,
  env,
});
```

- `stdin: 'ignore'` -- No interactive input
- `stdout/stderr: 'pipe'` -- Line-by-line parsing via readline
- `detached: true` -- Group kill by specifying `-pid` via `killProcessTree()`
- On Windows, replaced with `taskkill /T` (`src/utils/platform.ts`)

### Timeouts

- **No-output timeout**
  - Environment variable: `NO_OUTPUT_TIMEOUT_SEC`
  - Default: 90 seconds
  - Retry: Up to `RETRY_LIMITS.noOutput` (3) extensions
  - Description: Triggered when stdout has no output for a sustained period. stderr does not reset the timer (to prevent API retry loop issues).

- **Max runtime**
  - Environment variable: `MAX_RUNTIME_SEC`
  - Default: 900 seconds (15 minutes)
  - Retry: None
  - Description: Absolute upper limit on total execution time

**No-output timeout behavior**:
1. Timer resets each time output appears on stdout
2. When timeout fires: if retry count < 3, the timer is extended (process continues running)
3. If no output after 3 extensions: `kill('no_output_timeout')`

**Reason stderr does not reset the timer**: When the CLI enters an API retry loop, it continuously outputs error lines, but this is not forward progress. Resetting the timer on stderr would allow the process to survive indefinitely.

### Kill Sequence

- **Normal termination (timeout / user cancel)**: SIGINT, then **5000ms** wait, then SIGKILL
- **Waiting for approval (`permission_approval_needed`)**: SIGINT, then **2000ms** wait, then SIGKILL

```typescript
const gracePeriodMs = this.killReason === 'permission_approval_needed' ? 2000 : 5000;
```

- SIGINT attempts graceful shutdown (gives the process a chance to terminate voluntarily)
- If still alive after the grace period, SIGKILL forces termination
- `ESRCH` (process already gone) is treated as a normal case and ignored

### Event Limits

- `MAX_EVENTS` / `MAX_JOB_EVENTS`: `SIZE_LIMITS.maxEventsPerRun` (50,000) -- Upper limit of events held by the Runner and Slack job-runtime. Both reference the centralized constant in `src/shared/constants.ts`. Excess events are dropped (`eventsDropped` flag)

---

## Queue

### Per-Session Serialization

Only one job per session (`sessionKey`) is executed at a time. Subsequent jobs enter the `pending` queue.

### Global Concurrency Control

- **Max concurrency**
  - Environment variable: `MAX_CONCURRENCY`
  - Default: 2
  - Description: Upper limit on the number of concurrently executing jobs

- When `running.size >= maxConcurrency`, new jobs go to the pending queue
- Return value on enqueue: `{ position: 0 }` = immediate execution, `{ position: N }` = queued
- On the Slack side, `Queued (position: N)` is returned as a reply

### Durable Persistence

- `JobQueue` persists active jobs through a `QueueStore` abstraction
- The default backend is SQLite `job_queue`
- Immediate jobs are inserted as `running`; deferred jobs are inserted as `queued`
- Completion deletes the row; pending cancellation deletes only `queued` rows for that session

### Drain Strategy

`drainGlobal()`: Scans the pending queue in FIFO order upon job completion.
- Jobs whose session is already running are skipped; the next runnable job is found
- Repeats until concurrency slots are filled

### Restart Recovery

- Startup restores persisted queue state before new external work is accepted
- Durable queue recovery runs before `orchestratorEngine.recoverActiveRuns()`
- Persisted `queued` rows are replayed in FIFO order only after current session/workdir/task policy revalidation
- Persisted `running` rows are treated as interrupted leases
- Persisted `orchestrator` rows are never replayed directly; they are removed and handed off to orchestrator engine recovery
- Restart-safe retry is intentionally narrow:
  - `orchestrator-summary` jobs may be re-enqueued with a fresh `job.id`
  - all other interrupted `running` jobs are failed explicitly to avoid duplicate side effects
- Recovery clears stale `sessions.running_job_id` and releases task claims where applicable
- Malformed `job_queue.payload` rows are discarded one-by-one so a single bad row cannot block daemon startup

### Shutdown Behavior

1. `stopAccepting()` -- Rejects new enqueues (`{ error: 'Queue is not accepting new jobs (shutting down).' }`)
2. Running jobs are killed via `shutdownRunningJobs()`
3. If there are interrupted jobs, waits 5.5 seconds (to allow kill sequence completion)

---

## Config

### Registry Policy

`ENV_REGISTRY` is the authoritative policy source for dashboard-editable settings.

Each key carries:

- UI placement (`cat`, `sub`)
- hot-reloadability (`mutable`)
- masking (`sensitive`)
- subprocess forwarding (`skill`)
- editability (`editable`)
- persistence policy (`config-db` / `secure-store` / `generated` / `derived` / `env-only`)

Derived sets such as `KNOWN_ENV_KEYS`, `SETTINGS_EDITABLE_KEYS`, `PERSISTED_CONFIG_KEYS`,
`SECURE_STORE_KEYS`, and `INTERNAL_OR_DERIVED_KEYS` are computed from the registry rather than
hand-maintained.

### Setting Classes

- **User-editable plain config** -- Persisted in SQLite `config` (`storage='db'`)
- **User-editable secret config** -- Persisted only in OS secure storage; SQLite stores metadata only (`storage='keychain_ref'`)
- **Internal/generated config** -- Not editable in the dashboard; stays file-backed or runtime-derived
- **Env-only compatibility config** -- Still readable from `process.env` during transition, but not written back by the app

Representative mapping:

- plain config: `DEFAULT_TOOL`, `MAX_CONCURRENCY`, `SERVER_API_PORT`
- secure-store secrets: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `OPENAI_API_KEY`, `AWS_SECRET_ACCESS_KEY`
- generated: `SERVER_API_SECRET`, `DASHBOARD_SECRET`
- derived: `HUSKYGATE_API_BASE`, `HUSKYGATE_API_SECRET`

### Resolution Order

For dashboard-managed keys, the resolver order is:

```text
SQLite / Secure Store -> process.env fallback -> code default
```

Notes:

- persisted values always win over stale ambient environment variables
- `process.env` is a compatibility fallback only when no persisted value exists
- explicit operator override, if introduced in the future, must use a distinct mechanism rather than ambient `process.env`

### Persistent Model

Editable settings live in a dedicated `config` table:

```sql
CREATE TABLE IF NOT EXISTS config (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  storage    TEXT NOT NULL CHECK (storage IN ('db', 'keychain_ref')),
  source     TEXT NOT NULL CHECK (source = 'user'),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (storage = 'db' AND value IS NOT NULL) OR
    (storage = 'keychain_ref' AND value IS NULL)
  )
);
```

Rules:

- secret values are never stored in SQLite plaintext
- `storage='keychain_ref'` records intent/reference only; the actual secret lives in the OS secure store
- generated/derived keys never get `config` rows
- dashboard-managed persisted keys in `.env` are always ignored; all managed keys use DB/keychain
- `.env` is supported only for non-managed compatibility entries as fallback

### Resolver Surfaces

`ConfigResolver` is shared by:

- `loadConfig()`
- `loadDashboardConfig()`
- CLI bootstrap for `start` / `stop` / `restart` / `dashboard-serve`
- dashboard settings routes
- unified skill env-var helpers

The resolver returns both the value and its source (`db`, `keychain`, `env_fallback`, `default`, `generated`, `derived`) so APIs can mask correctly and explain read-only behavior.

### Editable Keys

#### Required for full daemon startup

- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN`
- `ALLOWED_USER_IDS`

#### Tool-specific secrets (required if the tool/skill is used)

- Claude: `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX`)
- Codex: `OPENAI_API_KEY` (or `CODEX_HOME`)
- Gemini: `GEMINI_API_KEY` or `GOOGLE_API_KEY`

#### Editable plain config (selected examples)

- `DEFAULT_TOOL`
- `MAX_CONCURRENCY`
- `MAX_RUNTIME_SEC`
- `NO_OUTPUT_TIMEOUT_SEC`
- `WORKDIR_ROOT`
- `ALLOWED_WORKDIR_ROOTS`
- `LOG_LEVEL`
- `SERVER_API_PORT`
- `SERVER_API_HOST`
- `WEBHOOK_PUBLIC_BASE_URL`
- `SCHEDULE_*`

#### Not editable in Dashboard

- `SERVER_API_SECRET`
- `DASHBOARD_SECRET`
- `HUSKYGATE_API_BASE`
- `HUSKYGATE_API_SECRET`

### Hardcoded Constants

### Skill Enablement State

Global skill enablement is stored in SQLite `skill_enablement`, not in mutable config.

Runtime rules:

- built-in skills default to disabled when no `skill_enablement` row exists
- local/project custom skills default to enabled when no `skill_enablement` row exists
- dashboard toggles write only to `skill_enablement`
- workdir seeding reads only `skill_enablement` plus the defaults above
- stale custom-skill enablement rows are deleted when the skill is removed through dashboard CRUD

Cross-module constants are centralized in `src/shared/` to eliminate duplication and ensure consistency:

- **`src/shared/constants.ts`** — Timeouts, intervals, TTLs, size limits, retry limits
- **`src/shared/field-limits.ts`** — API field validation constraints and shared regex patterns
- **`src/shared/pagination.ts`** — Pagination defaults and `parseLimit()` helper

Each consuming file imports and aliases the centralized value (e.g. `const MAX_EVENTS = SIZE_LIMITS.maxEventsPerRun`), keeping local readability while ensuring a single source of truth.

#### TIMEOUTS (one-shot durations)

| Key | Value | Description |
|-----|-------|-------------|
| `sqliteBusy` | 5,000ms | SQLite busy timeout |
| `keychainOp` | 10,000ms | OS keychain operation |
| `taskkill` | 5,000ms | Windows process kill |
| `platformProbe` | 3,000ms | findPidOnPort / resolveCommand |
| `venvCreate` | 30,000ms | Python venv creation |
| `pipInstall` | 120,000ms | pip install |
| `download` | 30,000ms | File download |
| `tunnelUrl` | 30,000ms | Tunnel URL readiness |
| `githubIpFetch` | 10,000ms | GitHub IP allowlist fetch |
| `mcpTokenExpiryMargin` | 60,000ms | MCP token pre-expiry refresh margin |
| `mcpConnFailureGrace` | 10,000ms | MCP connection failure grace period |
| `filePicker` | 300,000ms (5min) | Dashboard file picker dialog |
| `slackChallenge` | 30,000ms | Challenge code expiration |
| `toolApproval` | 120,000ms (2min) | Tool approval wait |
| `mcpAuthBypass` | 120,000ms (2min) | MCP auth bypass wait |
| `summaryGenerationSec` | 180s | Orchestrator summary generation |
| `shutdownHard` | 15,000ms | Graceful shutdown forced termination |

#### INTERVALS (recurring durations)

| Key | Value | Description |
|-----|-------|-------------|
| `heartbeat` | 60,000ms | Main process heartbeat |
| `sseHeartbeat` | 30,000ms | SSE heartbeat (chat, orchestrator) |
| `schedulePoll` | 30,000ms | Scheduler polling |
| `bufferCleanup` | 60,000ms | SSE buffer cleanup |
| `githubIpRefresh` | 21,600,000ms (6h) | GitHub IP allowlist refresh |
| `tunnelRestart` | 5,000ms | Tunnel restart delay |
| `metricsReport` | 300,000ms (5min) | Metrics report |
| `logTailPoll` | 2,000ms | Log tail SSE poll |
| `logTailHeartbeat` | 15,000ms | Log tail SSE heartbeat |

#### TTLS (expiry / retention durations)

| Key | Value | Description |
|-----|-------|-------------|
| `sessionIdle` | 86,400,000ms (24h) | Session auto-termination (compile-time fallback; runtime: `SESSION_IDLE_TIMEOUT_SEC`) |
| `assistantThread` | 86,400,000ms (24h) | Assistant thread lifetime |
| `eventDelivery` | 86,400,000ms (24h) | Webhook delivery TTL |
| `dashboardCookieSec` | 28,800s (8h) | Dashboard cookie max age |
| `slackTimestampMaxAgeSec` | 300s (5min) | Slack timestamp max age |
| `bufferRetainAfterDone` | 60,000ms | SSE buffer retention after completion |
| `staleClaimMinutes` | 30min | Stale schedule claim timeout |
| `workdirCleanup` | 604,800,000ms (7d) | Workdir cleanup max age |
| `bootstrapWindow` | 900,000ms (15min) | Dashboard bootstrap window |
| `artifactCache` | 5,000ms | Artifact cache TTL |

#### SIZE_LIMITS

| Key | Value | Description |
|-----|-------|-------------|
| `maxHttpBody` | 64KB | HTTP request body |
| `maxTextChars` | 4,000 | Slack message split threshold (chars) |
| `maxTextBytes` | 12,288 | Slack message split threshold (bytes) |
| `maxFileSize` | 50MB | Single file upload |
| `maxTotalFileSize` | 100MB | Total file uploads |
| `maxFileUploads` | 10 | File upload count |
| `maxFilenameLength` | 200 | Filename length |
| `maxEventsPerRun` | 50,000 | Runner/job event buffer |
| `maxBufferEvents` | 10,000 | SSE buffer events |
| `maxWebhookBody` | 1MB | Webhook body |
| `maxTriggerContext` | 8KB | Trigger context |
| `maxOutputPerNode` | 8,000 | Orchestrator node output (chars) |
| `maxRunReportChars` | 80,000 | Orchestrator run report (chars) |
| `maxCharsForLog` | 8,000 | Job log truncation threshold |

#### RETRY_LIMITS

| Key | Value | Description |
|-----|-------|-------------|
| `tunnelRestart` | 5 | Tunnel max restart attempts |
| `markRunning` | 3 | Queue mark-running retries |
| `mcpConn` | 2 | MCP connection retries |
| `slackMessenger` | 2 | Slack messenger retries |
| `noOutput` | 3 | No-output timeout extensions |
| `logRotations` | 3 | Log max rotations |
| `backupGenerations` | 7 | DB backup generations |
| `httpRedirects` | 5 | HTTP max redirects |

#### FIELD_LIMITS (API field validation)

| Key | Max | Description |
|-----|-----|-------------|
| `name` | 200 | Task/schedule/orchestrator name |
| `prompt` | 50,000 | Prompt text |
| `description` | 2,000 | Description text |
| `alias` | 100 | Task alias |
| `instructionFile` | 50,000 | Instruction file content |
| `returnConditionText` | 2,000 | Return condition text |
| `returnValue` | 100 | Return value identifier (API input) |
| `returnConditionsCount` | 20 | Return conditions per orchestrator |
| `regexPattern` | 200 | DAG regex pattern |

Shared regex patterns: `RETURN_VALUE_RE`, `SLACK_USER_ID_RE` (in `field-limits.ts`).

#### PAGINATION

| Key | Value | Description |
|-----|-------|-------------|
| `defaultLimit` | 20 | Standard API default |
| `maxLimit` | 100 | Standard API max |
| `chatDefaultLimit` | 50 | Chat sessions default |
| `chatMaxLimit` | 200 | Chat sessions max |

#### Non-centralized constants (module-local by design)

- `RETRY_BASE_MS`: 500 (in `messenger.ts`) -- Rate limit retry base interval
- User rate limit: 5 msg / 10s (in `message-handler.ts`) -- Per-user message rate limit
- Shutdown job wait: 5,500ms (in `index.ts`) -- Interrupted job kill completion wait
- `MAX_RETURN_VALUE_LENGTH`: 500 (in `return-value.ts`) -- Runtime parse safety truncation (distinct from API field limit of 100)

---

## Secret Persistence

`resolvePersistedSecret()` (`src/config.ts`) manages the lifecycle of secrets.

### Resolution Priority

```
1. Environment variable (process.env[envKey])
   | (unset)
2. Persisted file (data/<filename>)
   | (does not exist)
3. Generate new (crypto.randomUUID()) -> write to file -> return
```

### Design Considerations

- **Inter-process convergence**: Daemon and Dashboard share the same secret even when started independently
- **Race condition prevention**: `flag: 'wx'` (exclusive create) prevents simultaneous writes
- **Race loser recovery**: If the write fails, reads the file written by the winner
- **Permissions**: `mode: 0o600` (owner read/write only)

### Target Secrets

- `SERVER_API_SECRET` (filename: `data/.server-api-secret`) -- Server Internal API Bearer token
- `DASHBOARD_SECRET` (filename: `data/.dashboard-secret`) -- Dashboard authentication token

### HUSKYGATE_API_SECRET (for Schedule Skill)

Generated via `resolveScheduleSkillSecret()`. Uses a bearer token with a different scope than the Server API internal secret. The token is intentionally limited to `/api/schedules*` so schedule CRUD/history stays available to the built-in `schedule-manager` skill without exposing unrelated Server API routes.

```typescript
// Skill-scoped token forwarded to subprocesses
process.env.HUSKYGATE_API_SECRET = `hg_sched_${crypto.randomBytes(24).toString('hex')}`;
```

---

## Startup Sequence

- **Step 1** (`src/cli.ts`): Load `.env` via `loadCompatibilityEnvFile()` for compatibility only -- values become fallback input, not SSOT. Managed persisted keys are always skipped. This happens in `cli.ts` before `main()` is invoked.
- **Step 2** (`src/index.ts`): Initialize DB -- `initDatabase(dataDir)` creates schema, enables WAL mode
- **Step 3**: Build `ConfigStore` / `ConfigResolver`
- **Step 4**: Load Keychain secrets and resolve config through the resolver
- **Step 5**: Initialize stores -- DedupeStore, AuditStore, ConversationStore, DefaultInstructionStore, DevAliasStore, ScheduleStore, OndemandTaskStore, OrchestratorStore, ConfigStore
- **Step 6**: Initialize event trigger stores -- TriggeredTaskStore, WebhookEndpointStore, EventSubscriptionStore, WebhookDeliveryStore
- **Step 7**: Initialize Session/Queue/Workdir -- SessionManager, JobQueue, WorkdirManager, WebhookSecretStore
- **Step 9**: Inject runtime env -- `syncProcessEnvFromResolver()` sets keys with `skill: true` or `scope: 'driver'` (includes `HUSKYGATE_API_BASE` / `HUSKYGATE_API_SECRET`)
- **Step 10**: Restore all session workdirs -- `ensureSessionWorkdirs()`, archive legacy workdirs, cleanup unused workdirs
- **Step 11**: Initial Dedupe cleanup -- `dedupeStore.cleanup()` + stale session cleanup
- **Step 12**: Start periodic timers -- Heartbeat (60s), Dedupe cleanup (1h), output_full cleanup (6h), DB housekeeping (24h)
- **Step 13**: Initialize OrchestratorEngine -- Inject callbacks for session creation, workdir preparation, and job enqueue

## MCP Config Lifecycle

- `mcp_servers` is the SSOT for all three tools.
- Global CLI config files are treated as bootstrap/read-only sources:
  - Claude: import only
  - Gemini: import + non-MCP key merge (`settings.json`)
  - Codex: import + non-MCP section merge (`config.toml`)
- Runtime jobs materialize tool-specific config under the session workdir only when `allowMcp=true`.
- When `allowMcp=false`, HuskyGate still prepares isolated runtime homes for Gemini/Codex but writes an empty server set so MCP tools are unavailable by configuration as well as policy.
- **Step 14**: Initialize EventRouter + TriggeredTaskExecutor -- Webhook to subscription to task/orchestrator execution pipeline
- **Step 15**: Build Slack App -- `new App({ socketMode: true })` then `createApp(ctx)`
- **Step 16**: Notification/Upload wiring -- `setPostNotification()`, `setUploadFile()`, `setDefaultNotifyChannel()`
- **Step 17**: Durable queue recovery -- restore persisted `queued` jobs and fail/retry interrupted `running` jobs; hand off `source='orchestrator'` rows to engine recovery
- **Step 18**: Recover active runs -- `orchestratorEngine.recoverActiveRuns()` after durable queue has cleared stale orchestrator queue rows
- **Step 19**: Initialize Scheduler -- `new Scheduler(...)` (if `scheduleEnabled`)
- **Step 20**: Start Server Internal API -- `startApiServer(runtime.ctx)`
- **Step 21**: Start Slack app -- `runtime.app.start()`
- **Step 22**: Start Scheduler -- `scheduler?.start()`
- **Step 23**: Start Metrics reporter -- `startMetricsReporter()`

---

## Graceful Shutdown (`SIGINT` / `SIGTERM`)

- **Step 1**: Re-entry prevention -- `shuttingDown` flag prevents double execution
- **Step 2**: Hard timeout -- `setTimeout(() => process.exit(1), 15_000).unref()` forces exit after 15 seconds
- **Step 3**: Stop accepting new jobs -- `jobQueue.stopAccepting()`
- **Step 4**: Stop running jobs -- `runtime.shutdownRunningJobs()` -- waits **5.5 seconds** if there are interrupted jobs
- **Step 5**: Stop Scheduler -- `scheduler?.stop()`
- **Step 6**: Stop Metrics reporter -- `stopMetricsReporter()` + `clearInterval()` for all periodic timers
- **Step 7**: Stop Server Internal API -- `apiServer.close()`
- **Step 8**: Stop Slack app -- `runtime.app.stop()`
- **Step 9**: Close DB -- `closeDatabase()` with `wal_checkpoint(TRUNCATE)` to ensure data consistency
- **Step 10**: exit 0 -- Normal termination

### Error Handlers

- `uncaughtException` -> logger.error -> `process.exit(1)`
- `unhandledRejection` -> logger.error -> `process.exit(1)`
- If the logger itself throws an error, falls back to `stderr.write()`

---

## ENV Registry

The `ENV_REGISTRY` in `config.ts` manages metadata for all environment variable keys as the Single Source of Truth.

### EnvKeyMeta Structure

```typescript
interface EnvKeyMeta {
  cat: EnvCategory;     // 'mode' | 'messaging' | 'apps' | 'environment' | 'internal'
  sub: string | null;   // Subsection (e.g. 'slack', 'claude', 'gemini', 'codex', 'general')
  mutable: boolean;     // Whether hot-reload is possible (instantly reflected via PUT /api/settings)
  sensitive: boolean;   // Whether to mask in API responses
  skill: boolean;       // Whether to forward to subprocesses (skill / cloud provider)
  scope?: EnvScope;     // 'daemon' | 'driver' | 'skill' | 'system'
}
```

### EnvScope

- **`daemon`** (e.g., `SLACK_BOT_TOKEN`, `SERVER_API_SECRET`): Not forwarded to subprocesses
- **`driver`** (e.g., `CLAUDE_COMMAND`, `CLAUDE_MODEL`): Not forwarded (daemon config only)
- **`skill`** (e.g., `PERPLEXITY_API_KEY`, `AWS_ACCESS_KEY_ID`): Forwarded (via skill/cloud allowlists)
- **`system`** (e.g., `MAX_CONCURRENCY`, `LOG_LEVEL`): Not forwarded (daemon config only)

### Derived Sets

Constant sets automatically derived from the Registry:

- **`KNOWN_ENV_KEYS`** (derived from: `Object.keys(ENV_REGISTRY)`) -- Allowlist validation for `PUT /api/settings`
- **`RUNTIME_MUTABLE_KEYS`** (derived from: `mutable === true`) -- Keys eligible for hot-reload (no restart required)
- **`SKILL_ENV_KEYS`** (derived from: `skill === true`) -- Keys forwarded to subprocess `process.env`
- **`SENSITIVE_KEYS`** (derived from: `sensitive === true`) -- Keys masked (`****`) in API responses

### Sensitivity Detection

```typescript
function isSensitiveKey(key: string): boolean {
  const meta = ENV_REGISTRY[key];
  if (meta !== undefined) return meta.sensitive;
  return /TOKEN|KEY|SECRET|PASSWORD/i.test(key);  // fallback heuristic
}
```

Keys not registered in the Registry (e.g., custom keys added by users in `.env`) fall back to regex heuristic detection.

### Category to Dashboard UI Mapping

- **`mode`**: Mode settings (auto-approve, etc.)
- **`messaging`**: Slack connection settings
- **`apps`**: Tool-specific settings (claude / gemini / codex)
- **`environment`**: Runtime tunables (concurrency, timeout, skills, schedule)
- **`internal`**: Auto-generated secrets (normally hidden)

The insertion order of keys in `ENV_REGISTRY` determines the display order in the Dashboard settings UI.

---

## Cron & Timezone Utilities

### Cron Utilities (`src/schedule/cron-utils.ts`)

- **`validateCronExpr(expr)`** — Validates cron syntax (5-field or 6-field). Returns error message string on failure, `null` on success.
- **`getNextCronRun(expr, timezone, fromDate?)`** — Calculates next occurrence as ISO 8601 string. Uses `cron-parser` with timezone support. Returns `null` on invalid input.

### Timezone Utilities (`src/utils/timezone.ts`)

- **`getOsTimezone()`** — Detects system timezone via `Intl.DateTimeFormat().resolvedOptions()`. Falls back to `'UTC'`.
- **`resolveTimezone(tz?)`** — Returns given timezone or falls back to OS timezone.
- **`isValidTimezone(tz)`** — Validates by attempting `Intl.DateTimeFormat` construction.
- **`resolveAndValidateTimezone(tz?)`** — Combined resolution + validation; throws on invalid timezone.
