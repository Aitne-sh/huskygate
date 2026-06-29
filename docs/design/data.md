# Data & Schema

## Database Schema (SQLite)

HuskyGate persists all state in a single SQLite database (`orchestrator.db`).
The schema is defined in `SCHEMA_SQL` within `src/store/database.ts` and is progressively extended via migration functions.

---

### Core Tables

#### sessions

Session state management. Tracks tool type, mode, workdir, and running jobs.

```sql
CREATE TABLE sessions (
    session_key     TEXT PRIMARY KEY,
    tool            TEXT NOT NULL DEFAULT 'claude',
    mode            TEXT NOT NULL DEFAULT 'write',
    mode_expires_at TEXT,
    tool_state      TEXT NOT NULL DEFAULT '{}',
    workdir         TEXT NOT NULL,
    running_job_id  TEXT,
    dev_alias       TEXT,                          -- migration: migrateDevAlias
    updated_at      TEXT NOT NULL
);
```

Notes:
- `updated_at` is the durable session-activity signal used for retention. Runtime writes that materially indicate activity must refresh it.
- Dashboard/Slack conversation writes refresh `updated_at` for the owning session when `dashboard_messages` rows are appended.
- Slack thread activity also refreshes `updated_at` for the active session on that thread, even when the interaction does not append a stored chat message.

#### session_registry

Mapping between session IDs and thread keys. Indexed by user and start time.

```sql
CREATE TABLE session_registry (
    session_key TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL UNIQUE,
    thread_key  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    started_at  TEXT NOT NULL
);

CREATE INDEX idx_session_registry_thread ON session_registry(thread_key);
CREATE INDEX idx_session_registry_started ON session_registry(started_at DESC);
CREATE INDEX idx_session_registry_started_asc ON session_registry(started_at);
```

#### thread_contexts

Active session tracking per thread.

```sql
CREATE TABLE thread_contexts (
    thread_key         TEXT PRIMARY KEY,
    active_session_key TEXT,
    last_activity_at   TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);

CREATE INDEX idx_thread_contexts_active_session ON thread_contexts(active_session_key);
CREATE INDEX idx_thread_contexts_last_activity ON thread_contexts(last_activity_at);
```

Notes:
- `thread_contexts` rows are retained after session deletion with `active_session_key = NULL` so thread routing history survives.
- Housekeeping deletes only rows where `active_session_key IS NULL` and `last_activity_at` exceeds the 90-day retention threshold.
- If `active_session_key` points at a missing session, housekeeping NULLs it instead of deleting the row.

#### dedupe

Slack event deduplication. Automatically cleaned up based on TTL.

```sql
CREATE TABLE dedupe (
    event_id       TEXT PRIMARY KEY,
    received_at    TEXT NOT NULL,
    ttl_expires_at TEXT NOT NULL
);

CREATE INDEX idx_dedupe_ttl ON dedupe(ttl_expires_at);
```

#### audit

Audit log for job execution. Prompts are stored as hashes.

```sql
CREATE TABLE audit (
    job_id      TEXT PRIMARY KEY,
    session_key TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    tool        TEXT NOT NULL,
    mode        TEXT NOT NULL,
    workdir     TEXT NOT NULL,
    prompt_hash TEXT,
    started_at  TEXT NOT NULL,
    ended_at    TEXT,
    exit_code   INTEGER,
    error_kind  TEXT
);

CREATE INDEX idx_audit_session ON audit(session_key);
CREATE INDEX idx_audit_started ON audit(started_at);
```

#### dashboard_messages

Unified storage for conversation messages from both Slack and Dashboard.

```sql
CREATE TABLE dashboard_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_key TEXT NOT NULL,
    role        TEXT NOT NULL,        -- 'user' | 'assistant' | 'system'
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE INDEX idx_dash_msg_session ON dashboard_messages(session_key, created_at DESC);
CREATE INDEX idx_dash_msg_created ON dashboard_messages(created_at);
```

Notes:
- `dashboard_messages` is append-only and has shorter retention than `sessions`.
- Housekeeping backfills `sessions.updated_at` from the latest retained message timestamp before pruning old `dashboard_messages` rows so 30-day message retention cannot incorrectly force 90-day session deletion.

#### mode_changes

Mode change history tracking. Supports time-limited mode elevation.

```sql
CREATE TABLE mode_changes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_key TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    from_mode   TEXT NOT NULL,
    to_mode     TEXT NOT NULL,
    changed_at  TEXT NOT NULL,
    expires_at  TEXT
);

CREATE INDEX idx_mode_changes_changed ON mode_changes(changed_at);
```

#### dev_aliases

Development alias (workdir shortcut) definitions.

```sql
CREATE TABLE dev_aliases (
    name                TEXT PRIMARY KEY,
    path                TEXT NOT NULL,
    tool                TEXT NOT NULL DEFAULT 'claude',
    instruction_content TEXT,                      -- migration: migrateDevAliasInstructionContent
    created_at          TEXT NOT NULL
);
```

#### mcp_servers

All HuskyGate-managed MCP server definitions. Phase 2 promotes SQLite to the single source of truth for Claude, Gemini, and Codex. Runtime homes are generated from these rows per job; global CLI config files remain read-only inputs for import/bootstrap and for preserving non-MCP settings.

```sql
CREATE TABLE mcp_servers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    tool        TEXT NOT NULL,                     -- 'claude' | 'gemini' | 'codex'
    transport   TEXT NOT NULL,                     -- 'stdio' | 'http' | 'sse'
    definition  TEXT NOT NULL,                     -- JSON blob
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE(name, tool)
);
```

Notes:
- `definition` stores the tool-specific payload as JSON and may include secrets such as bearer tokens or environment variables.
- Secrets are stored in plaintext in SQLite and must be masked before returning API responses to the dashboard.
- Claude execution never mutates project-owned `.mcp.json`; it renders a generated config file inside the managed workdir and falls back to a unique generated path when the canonical path is already user-owned.
- Gemini execution merges DB-backed `mcpServers` with non-MCP keys from the global `settings.json`, then copies CLI-managed OAuth files into the runtime home.
- Codex execution merges DB-backed `[mcp_servers.*]` sections with non-MCP sections from the global `config.toml`, then copies CLI-managed auth/instruction files into the runtime home.
- Bootstrap import from global CLI config is additive-only: if a DB row with the same `(tool, name)` already exists, HuskyGate preserves the DB row and skips the imported duplicate instead of overwriting it.
- Tool-specific transport inference is part of the data boundary:
  - Gemini treats file-backed `url` / `httpUrl` server entries as SSE unless `type` explicitly says otherwise.
  - Codex treats file-backed `url` / `httpUrl` server entries as HTTP unless `type` explicitly says otherwise.
- Codex-specific HTTP metadata such as `envHttpHeaders` must survive the full round-trip: global TOML import -> SQLite `definition` -> generated runtime `config.toml`.
- Secret-bearing HTTP header maps in `headers`, `httpHeaders`, or `http_headers` must be masked before dashboard API responses and must round-trip masked updates without replacing the stored secret with `***`.

#### session_mcp_servers

Per-session MCP server allowlist overrides. Absence of rows means "all servers enabled" for backward compatibility with Phase 1/2 sessions. Once any row exists for a session, only rows with `enabled = 1` are materialized into runtime MCP configs.

```sql
CREATE TABLE session_mcp_servers (
    session_key TEXT NOT NULL,
    server_id   TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (session_key, server_id)
);
```

Notes:
- This table is an override layer on top of `mcp_servers`; it never stores server definitions.
- HuskyGate explicitly deletes `session_mcp_servers` rows when a session or MCP server is removed, rather than relying on SQLite foreign-key cascades.
- `session_mcp_servers` is the single source of truth for session-scoped MCP filtering; no duplicate "filter active" flag is persisted in `tool_state`.

#### metadata

Small key/value metadata used for one-time migrations and bootstrap flags.

```sql
CREATE TABLE metadata (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

Notes:
- Phase 2 uses `metadata` to record completion of the one-time MCP global-config import.
- The import marker is written after a best-effort additive import pass, even when some tools already have DB rows from an earlier phase.
- This prevents accidental re-import after operators intentionally clear `mcp_servers`, while still allowing phase2 bootstrap to import Gemini/Codex into a phase1-populated DB.

#### skill_enablement

Per-skill per-driver global enablement state. This is the Phase 3 source of truth
for global skill seeding behavior.

```sql
CREATE TABLE skill_enablement (
    skill_ref  TEXT NOT NULL,
    tool       TEXT NOT NULL,
    enabled    INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (skill_ref, tool)
);
```

Notes:
- `skill_ref` uses the catalog-stable identifier (`builtin:<dirName>`, `local:<dirName>`, `project:<dirName>`).
- `enabled` is stored as `0/1` for SQLite compatibility and mapped to booleans in the store layer.
- missing rows are meaningful: built-in skills fall back to legacy config during the compatibility window, while custom skills default to enabled.
- the table stores mutable execution policy only; it never stores skill manifests or secret env var values.
- dashboard built-in toggles and runtime workdir seeding both read this table, so there is no separate in-memory enablement cache to keep in sync.

#### job_queue

Durable queue mirror for active jobs. This table persists queue order and lease state across restarts while SQLite remains the single-process source of truth.

```sql
CREATE TABLE job_queue (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     TEXT NOT NULL UNIQUE,
    session_key TEXT NOT NULL,
    source     TEXT,
    status     TEXT NOT NULL,                  -- 'queued' | 'running'
    payload    TEXT NOT NULL,                  -- serialized Job JSON
    leased_at  TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_job_queue_status_id ON job_queue(status, id);
CREATE INDEX idx_job_queue_session_status ON job_queue(session_key, status);
```

Notes:
- `job_queue` stores only active work. Rows are deleted when a job finishes or when recovery marks the job non-retriable.
- FIFO ordering is the stable `id` insertion order. Recovery preserves this order for `queued` jobs and for restart-safe replacements.
- `payload` is an internal serialization boundary for `src/queue/types.ts::Job`; it is never accepted directly from external API input.
- Recovery treats malformed `payload` rows as corrupt internal state, logs them, and deletes them row-by-row instead of aborting process startup.
- `leased_at` is set only while a job is executing. On restart, `running` rows are treated as interrupted leases.
- `source='orchestrator'` rows are a temporary handoff to the process-local executor; after restart they are cleared and rebuilt from orchestration run state instead of being replayed directly from `job_queue`.
- Auto-retry after restart is intentionally narrow: only `orchestrator-summary` jobs in readonly, MCP-disabled mode are retried automatically. All other interrupted `running` jobs are failed explicitly to avoid duplicate side effects.

---

### Scheduled / On-demand Task Tables

#### scheduled_tasks

Schedule task definitions. Supports 3 types via `schedule_type`: cron, run_at, and interval.

```sql
CREATE TABLE scheduled_tasks (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    description      TEXT,                         -- migration: migrateScheduledTaskDescription
    user_id          TEXT NOT NULL,
    tool             TEXT NOT NULL DEFAULT 'claude',
    mode             TEXT NOT NULL DEFAULT 'readonly',
    prompt           TEXT NOT NULL,
    workdir          TEXT,
    dev_alias        TEXT,
    schedule_type    TEXT NOT NULL,
    run_at           TEXT,
    cron_expr        TEXT,
    timezone         TEXT NOT NULL DEFAULT 'default',
    notify_channel   TEXT,
    notify_thread    TEXT,
    status           TEXT NOT NULL DEFAULT 'active',
    last_run_at      TEXT,
    next_run_at      TEXT,
    run_count        INTEGER NOT NULL DEFAULT 0,
    max_runs         INTEGER,
    max_retries      INTEGER DEFAULT 0,            -- migration: migrateScheduledTaskRetries
    allow_mcp        INTEGER NOT NULL DEFAULT 1,   -- migration: migrateTaskExecutionPolicy
    enabled_skills_json TEXT,                      -- migration: migrateTaskExecutionPolicy
    instruction_file TEXT,                         -- migration: migrateTaskInstructionFile
    claimed_at       TEXT,                         -- migration: migrateScheduledTaskClaimedAt
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE INDEX idx_sched_next_run ON scheduled_tasks(next_run_at, status);
CREATE INDEX idx_sched_user ON scheduled_tasks(user_id);
```

#### scheduled_task_runs

Execution history for scheduled tasks.

```sql
CREATE TABLE scheduled_task_runs (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL,
    session_key     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    exit_code       INTEGER,
    output_summary  TEXT,
    error_message   TEXT,
    started_at      TEXT NOT NULL,
    ended_at        TEXT,
    artifacts       TEXT,
    retry_count     INTEGER NOT NULL DEFAULT 0,    -- migration: migrateScheduledTaskRetries
    source          TEXT NOT NULL DEFAULT 'schedule' -- migration: migrateScheduledTaskRunSource
);

CREATE INDEX idx_sched_runs_task ON scheduled_task_runs(task_id, started_at DESC);
CREATE INDEX idx_sched_runs_started ON scheduled_task_runs(started_at);
```

#### ondemand_tasks

On-demand task definitions. Has a unique constraint on alias.

```sql
CREATE TABLE ondemand_tasks (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    alias            TEXT,
    description      TEXT,
    user_id          TEXT NOT NULL DEFAULT 'dashboard',
    tool             TEXT NOT NULL DEFAULT 'claude',
    mode             TEXT NOT NULL DEFAULT 'write',
    prompt           TEXT NOT NULL,
    workdir          TEXT,                         -- migration: migrateOndemandTaskWorkdir
    max_retries      INTEGER NOT NULL DEFAULT 0,
    notify_channel   TEXT,
    notify_thread    TEXT,                         -- migration: migrateOndemandTaskNotifyThread
    status           TEXT NOT NULL DEFAULT 'active',
    run_count        INTEGER NOT NULL DEFAULT 0,
    last_run_at      TEXT,
    allow_mcp        INTEGER NOT NULL DEFAULT 1,   -- migration: migrateTaskExecutionPolicy
    enabled_skills_json TEXT,                      -- migration: migrateTaskExecutionPolicy
    instruction_file TEXT,                         -- migration: migrateTaskInstructionFile
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_ondemand_task_key
    ON ondemand_tasks(COALESCE(alias, name)) WHERE status != 'deleted';
```

#### ondemand_task_runs

Execution history for on-demand tasks.

```sql
CREATE TABLE ondemand_task_runs (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL,
    session_key     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    exit_code       INTEGER,
    output_summary  TEXT,
    error_message   TEXT,
    started_at      TEXT NOT NULL,
    ended_at        TEXT,
    retry_count     INTEGER NOT NULL DEFAULT 0,
    source          TEXT NOT NULL DEFAULT 'dashboard'
);

CREATE INDEX idx_ondemand_runs_task ON ondemand_task_runs(task_id, started_at DESC);
CREATE INDEX idx_ondemand_runs_started ON ondemand_task_runs(started_at);
```

---

### Orchestrator Tables

#### orchestrators

DAG orchestration definitions. Includes settings for scheduling, concurrency control, and summary generation.

```sql
CREATE TABLE orchestrators (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    alias               TEXT,
    description         TEXT,
    user_id             TEXT NOT NULL DEFAULT 'dashboard',
    workdir             TEXT,
    start_node_id       TEXT,                      -- migration: migrateOrchestratorStartNode
    trigger_mode        TEXT NOT NULL DEFAULT 'ondemand', -- migration: migrateOrchestratorTriggerMode
    schedule_type       TEXT,
    run_at              TEXT,
    cron_expr           TEXT,
    timezone            TEXT NOT NULL DEFAULT 'default',
    notify_channel      TEXT,
    max_parallelism     INTEGER NOT NULL DEFAULT 3,
    max_total_nodes     INTEGER NOT NULL DEFAULT 50,
    max_run_workdirs    INTEGER NOT NULL DEFAULT 20, -- migration: migrateOrchestratorMaxRunWorkdirs
    error_policy        TEXT NOT NULL DEFAULT 'continue',
    timeout_sec         INTEGER,
    instruction_file    TEXT,                      -- migration: migrateOrchestratorInstructionFile
    enabled_skills_json TEXT,                      -- migration: migrateTaskExecutionPolicy
    summary_enabled     INTEGER NOT NULL DEFAULT 0, -- migration: migrateOrchestratorSummary
    summary_tool        TEXT,                      -- migration: migrateOrchestratorSummary
    status              TEXT NOT NULL DEFAULT 'active',
    dag_validated       INTEGER NOT NULL DEFAULT 0, -- migration: migrateOrchestratorDagValidated
    validated_snapshot   TEXT,                     -- migration: migrateOrchestratorValidatedSnapshot
    last_run_at         TEXT,
    run_count           INTEGER NOT NULL DEFAULT 0,
    next_run_at         TEXT,
    claimed_at          TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_orchestrator_alias
    ON orchestrators(alias) WHERE alias IS NOT NULL AND status != 'deleted';
CREATE INDEX idx_orchestrators_start_node_id ON orchestrators(start_node_id);
```

#### orchestrator_nodes

DAG node definitions. Three types: task, gate, and end. Includes return value, notification, and position information.

```sql
CREATE TABLE orchestrator_nodes (
    id                    TEXT PRIMARY KEY,
    orchestrator_id       TEXT NOT NULL,
    label                 TEXT NOT NULL,
    node_type             TEXT NOT NULL DEFAULT 'task',
    tool                  TEXT,
    mode                  TEXT DEFAULT 'write',
    prompt                TEXT,
    instruction_file      TEXT,
    workdir               TEXT,                    -- migration: migrateOrchestratorNodeWorkdirInstruction
    write_instruction_file INTEGER NOT NULL DEFAULT 1, -- migration: migrateOrchestratorNodeWorkdirInstruction
    args                  TEXT,
    max_retries           INTEGER NOT NULL DEFAULT 0,
    timeout_sec           INTEGER,
    allow_mcp             INTEGER NOT NULL DEFAULT 1, -- migration: migrateTaskExecutionPolicy
    enabled_mcp_server_ids TEXT,                   -- migration: migrateOrchestratorNodeMcpServerIds
    enabled_skills_json   TEXT,                    -- migration: migrateTaskExecutionPolicy
    output_mode           TEXT NOT NULL DEFAULT 'auto', -- migration: migrateOrchestratorNodeOutputMode
    return_conditions     TEXT,                    -- migration: migrateOrchestratorNodeOutputMode
    on_missing_return     TEXT NOT NULL DEFAULT 'fail',
    return_values         TEXT,                    -- migration: migrateOrchestratorNodeReturnValues
    gate_condition        TEXT,
    triggered_config_json TEXT,                    -- migration: migrateOrchestratorNodeTriggeredConfig
    notify_enabled        INTEGER NOT NULL DEFAULT 0,
    notify_channel        TEXT,
    notify_on_error       INTEGER NOT NULL DEFAULT 1,
    position_x            REAL NOT NULL DEFAULT 0,
    position_y            REAL NOT NULL DEFAULT 0,
    sort_order            INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);

CREATE INDEX idx_orch_nodes_orch ON orchestrator_nodes(orchestrator_id);
```

Notes:
- `enabled_mcp_server_ids` stores a JSON array of MCP server IDs. `null` means "inherit session MCP allowlist".
- Node-level MCP selection only narrows the session-scoped allowlist; it cannot re-enable a server disabled at the session level.

#### orchestrator_edges

DAG edge definitions. Has `condition_value` / `condition_operator` for conditional branching.

```sql
CREATE TABLE orchestrator_edges (
    id                  TEXT PRIMARY KEY,
    orchestrator_id     TEXT NOT NULL,
    from_node_id        TEXT NOT NULL,
    to_node_id          TEXT NOT NULL,
    condition_value     TEXT,
    condition_operator  TEXT NOT NULL DEFAULT 'eq',
    sort_order          INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL
);

CREATE INDEX idx_orch_edges_orch ON orchestrator_edges(orchestrator_id);
CREATE INDEX idx_orch_edges_from ON orchestrator_edges(from_node_id);
CREATE INDEX idx_orch_edges_to ON orchestrator_edges(to_node_id);
```

#### orchestration_runs

Orchestration execution history. Includes rerun information.

```sql
CREATE TABLE orchestration_runs (
    id                   TEXT PRIMARY KEY,
    orchestrator_id      TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'pending',
    triggered_by         TEXT NOT NULL DEFAULT 'dashboard',
    triggered_user_id    TEXT,
    trigger_context_json TEXT,                     -- migration: migrateOrchestrationRunTriggerContext
    started_at           TEXT,
    ended_at             TEXT,
    error_message        TEXT,
    rerun_from_run_id    TEXT,
    rerun_from_node_id   TEXT,
    created_at           TEXT NOT NULL
);

CREATE INDEX idx_orch_runs_orch ON orchestration_runs(orchestrator_id, created_at DESC);
CREATE INDEX idx_orch_runs_created ON orchestration_runs(created_at);
```

#### orchestration_node_runs

Per-node execution results. Records prompt, return value, and gate evaluation results.

```sql
CREATE TABLE orchestration_node_runs (
    id                    TEXT PRIMARY KEY,
    orchestration_run_id  TEXT NOT NULL,
    node_id               TEXT NOT NULL,
    job_id                TEXT,
    session_key           TEXT,
    status                TEXT NOT NULL DEFAULT 'pending',
    prompt                TEXT,                    -- migration: migrateNodeRunPrompt
    return_value          TEXT,
    exit_code             INTEGER,
    output_summary        TEXT,
    output_full           TEXT,                    -- migration: migrateOrchestrationNodeRunOutputFull
    output_path           TEXT,                    -- migration: migrateOrchestrationNodeRunOutputMetadata
    output_bytes          INTEGER,                 -- migration: migrateOrchestrationNodeRunOutputMetadata
    output_sha256         TEXT,                    -- migration: migrateOrchestrationNodeRunOutputMetadata
    error_message         TEXT,
    gate_evaluation       TEXT,
    retry_count           INTEGER NOT NULL DEFAULT 0,
    started_at            TEXT,
    ended_at              TEXT
);

CREATE INDEX idx_node_runs_run ON orchestration_node_runs(orchestration_run_id);
CREATE INDEX idx_node_runs_job ON orchestration_node_runs(job_id);
CREATE INDEX idx_node_runs_ended ON orchestration_node_runs(ended_at);
```

Notes:
- `output_full` is written to SQLite at node completion so notification and summary hot paths can read it immediately.
- After completion notification and summary snapshot materialization, HuskyGate offloads the raw payload to `data/job-logs/<run_id>/<node_run_id>.log`, stores `output_path`/`output_bytes`/`output_sha256`, and NULLs `output_full`.
- Offload verifies the file before NULLing `output_full`, and read paths verify `output_bytes` / `output_sha256` before returning file-backed content.
- Read paths dual-read for compatibility: verified file via `output_path` first when offloaded, otherwise the legacy `output_full` column.

---

### Event Trigger Tables

#### webhook_endpoints

External webhook reception endpoint definitions. Includes signature verification and preset configuration.

```sql
CREATE TABLE webhook_endpoints (
    id                  TEXT PRIMARY KEY,
    token               TEXT NOT NULL UNIQUE,
    publisher_preset    TEXT NOT NULL DEFAULT 'generic',
    verification_type   TEXT NOT NULL DEFAULT 'none',
    signature_header    TEXT,
    signature_prefix    TEXT,
    delivery_id_header  TEXT,
    event_name_header   TEXT,
    secret_ref          TEXT,
    max_body_bytes      INTEGER NOT NULL DEFAULT 262144,
    enabled             INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE INDEX idx_webhook_endpoints_token ON webhook_endpoints(token);
```

#### event_subscriptions

Routing definitions from webhook endpoints to targets (orchestrator / triggered_task / triggered_node).
A CHECK constraint ensures exclusive NOT NULL based on `target_type`.

```sql
CREATE TABLE event_subscriptions (
    id                   TEXT PRIMARY KEY,
    endpoint_id          TEXT NOT NULL,
    target_type          TEXT NOT NULL CHECK (target_type IN ('orchestrator', 'triggered_task', 'triggered_node')),
    orchestrator_id      TEXT,
    triggered_task_id    TEXT,
    node_id              TEXT,
    filter_json          TEXT,
    context_mapping_json TEXT,
    enabled              INTEGER NOT NULL DEFAULT 1,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    CHECK (
        (target_type = 'orchestrator'    AND orchestrator_id   IS NOT NULL AND triggered_task_id IS NULL AND node_id IS NULL) OR
        (target_type = 'triggered_task'  AND orchestrator_id   IS NULL     AND triggered_task_id IS NOT NULL AND node_id IS NULL) OR
        (target_type = 'triggered_node'  AND orchestrator_id   IS NULL     AND triggered_task_id IS NULL AND node_id IS NOT NULL)
    )
);

CREATE INDEX idx_event_subscriptions_endpoint ON event_subscriptions(endpoint_id, enabled);
CREATE UNIQUE INDEX idx_event_subscriptions_triggered_node_unique
    ON event_subscriptions(node_id) WHERE target_type = 'triggered_node';
CREATE UNIQUE INDEX idx_event_subscriptions_triggered_task_unique
    ON event_subscriptions(triggered_task_id) WHERE target_type = 'triggered_task';
CREATE UNIQUE INDEX idx_event_subscriptions_orchestrator_unique
    ON event_subscriptions(orchestrator_id) WHERE target_type = 'orchestrator';
```

#### triggered_tasks

Task definitions launched by event triggers. Includes concurrency policy control.

```sql
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
```

#### triggered_task_runs

Execution history for triggered tasks. Cascade-deleted when the parent task is deleted.

```sql
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
CREATE INDEX idx_triggered_task_runs_started ON triggered_task_runs(started_at);
```

#### webhook_deliveries

Webhook delivery log. Composite primary key of endpoint + delivery_id.

```sql
CREATE TABLE webhook_deliveries (
    endpoint_id        TEXT NOT NULL,
    delivery_id        TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'dispatching',
    successful_sub_ids TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    PRIMARY KEY (endpoint_id, delivery_id)
);

CREATE INDEX idx_webhook_deliveries_updated ON webhook_deliveries(updated_at);
```

---

### Settings Tables

#### config

Persistent key/value store for dashboard-managed settings. Secrets use `keychain_ref` storage (actual values in OS secure store, not SQLite).

```sql
CREATE TABLE config (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    storage    TEXT NOT NULL CHECK (storage IN ('db', 'keychain_ref')),
    source     TEXT NOT NULL CHECK (source IN ('user', 'migration')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (
        (storage = 'db' AND value IS NOT NULL) OR
        (storage = 'keychain_ref' AND value IS NULL)
    )
);
```

Notes:
- `storage='db'` stores the value in SQLite; `storage='keychain_ref'` stores only a reference (actual secret in OS keychain)
- `source='migration'` marks values imported from `.env` during one-time migration; `source='user'` marks dashboard-set values
- Generated/derived keys (`SERVER_API_SECRET`, `DASHBOARD_SECRET`, `HUSKYGATE_API_*`) never get `config` rows

#### default_instructions

Default instruction text per tool. Supports enable/disable toggling.

```sql
CREATE TABLE default_instructions (
    tool    TEXT PRIMARY KEY,
    content TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 0
);
```

---

### Pragma Settings

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

- On server/dashboard/bootstrap open paths: Sets `busy_timeout = 5000` so transient writer contention fails closed after a bounded wait instead of immediate `SQLITE_BUSY`
- On server/dashboard write-capable open paths: Sets `journal_mode = WAL`
- On server/dashboard/bootstrap open paths: re-tightens `orchestrator.db`, `orchestrator.db-wal`, and `orchestrator.db-shm` to `0600`
- On shutdown: Executes `wal_checkpoint(TRUNCATE)` before `close()`

---

## Data Boundaries & Ownership

- **Slack event**
  - Primary owner: Slack API
  - Boundary: External input, gated by auth/dedupe

- **Session state**
  - Primary owner: Server (SessionManager)
  - Boundary: DB persistence, operated via Server API

- **Tool state (JSON)**
  - Primary owner: Server (each Driver + job-executor)
  - Boundary: Stored in sessions.tool_state

- **Job audit**
  - Primary owner: Server (AuditStore)
  - Boundary: Write-only for start records plus a single completion update, prompts are hashed

- **CLI stdout/stderr**
  - Primary owner: Server (Runner)
  - Boundary: Transient, delivered via Messenger/SSE

- **Workdir files**
  - Primary owner: Each CLI tool
  - Boundary: On the filesystem, isolated per session

- **Dashboard messages**
  - Primary owner: Server (ConversationStore)
  - Boundary: Unified storage for conversations from both Slack and Dashboard

- **Artifact files**
  - Primary owner: Server (archiveOutputFiles)
  - Boundary: Archived from `_output/` to `_artifacts/{jobId}/`

- **Schedule/On-demand/Triggered task metadata**
  - Primary owner: Dashboard + Server
  - Boundary: Dashboard reads DB directly, execution goes through Server API

- **Orchestrator definitions**
  - Primary owner: Dashboard + Server
  - Boundary: Nodes/edges/validation/snapshots

- **Orchestration runs**
  - Primary owner: Server (OrchestratorEngine)
  - Boundary: DB persistence, SSE stream delivery

- **Webhook endpoints**
  - Primary owner: Server (WebhookEndpointStore)
  - Boundary: DB persistence, secret management

- **Event subscriptions**
  - Primary owner: Server (EventSubscriptionStore)
  - Boundary: Routing definitions from endpoint to target

- **Webhook deliveries**
  - Primary owner: Server (WebhookDeliveryStore)
  - Boundary: Delivery log audit trail

- **Dashboard admin data**
  - Primary owner: Dashboard
  - Boundary: Direct DB/FS updates

---

## Store & Database Utilities

### Store Utilities (`src/store/store-utils.ts`)

Shared SQLite helpers for all Store classes:

- **Boolean mappers**: `boolToDb(value) → 0 | 1`, `boolFromDb(value) → boolean`
- **JSON serializers**: `jsonToDb(value) → string | null`, `jsonFromDb<T>(value) → T | null`
- **Transform presets**: `BOOL_TRANSFORM`, `JSON_TRANSFORM`, `TRIM_TRANSFORM` — used with `buildDynamicUpdate`
- **`buildDynamicUpdate(patch, config)`** — Builds parameterized `SET` clauses from a partial patch object. Supports optimistic concurrency via `expectedUpdatedAt` comparison.
- **`StaleUpdateError`** — Thrown when an optimistic lock conflict is detected (expected `updated_at` mismatch)

### Database Utilities (`src/utils/db.ts`)

Minimal SQLite boolean conversion helpers:

- **`boolToDb(value) → 0 | 1`** — Converts JS boolean to SQLite INTEGER
- **`boolFromDb(value) → boolean`** — Inverse conversion (truthy check)

> Note: `store-utils.ts` contains a superset of these conversions plus dynamic UPDATE building. `db.ts` exists for modules that only need boolean conversion without the full store dependency.

---

## Deprecated Columns

The following columns on `orchestrator_nodes` are retained for SQLite schema compatibility but are no longer read or written by application code:

| Column | Status | Rationale |
|--------|--------|-----------|
| `args` | Deprecated | Legacy field from earlier architecture; no replacement needed |
| `enabled_skills_json` | Deprecated | Migrated to orchestrator-level via `migrateTaskExecutionPolicy()` |

**Why not removed**: SQLite does not support `DROP COLUMN` without a full table rebuild (`CREATE new → INSERT INTO new SELECT ... → DROP old → ALTER RENAME`). The columns are harmless (~4-8 bytes per row of NULL storage) and the rebuild is operationally risky for production databases.

**Note**: `instruction_file` on `orchestrator_nodes` is **not** deprecated — it is actively used for node-level custom instruction content.
