/** @module store/schema — SQLite schema DDL (CREATE TABLE + CREATE INDEX). */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  session_key    TEXT PRIMARY KEY,
  tool           TEXT NOT NULL DEFAULT 'claude',
  mode           TEXT NOT NULL DEFAULT 'write',
  mode_expires_at TEXT,
  tool_state     TEXT NOT NULL DEFAULT '{}',
  workdir        TEXT NOT NULL,
  running_job_id TEXT,
  dev_alias      TEXT,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
  ON sessions(updated_at);

CREATE TABLE IF NOT EXISTS session_registry (
  session_key    TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL UNIQUE,
  thread_key     TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  started_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_registry_thread ON session_registry(thread_key);
CREATE INDEX IF NOT EXISTS idx_session_registry_started ON session_registry(started_at DESC);

CREATE TABLE IF NOT EXISTS thread_contexts (
  thread_key      TEXT PRIMARY KEY,
  active_session_key TEXT,
  last_activity_at TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_thread_contexts_active_session
  ON thread_contexts(active_session_key);
CREATE INDEX IF NOT EXISTS idx_thread_contexts_last_activity
  ON thread_contexts(last_activity_at);

CREATE TABLE IF NOT EXISTS dedupe (
  event_id       TEXT PRIMARY KEY,
  received_at    TEXT NOT NULL,
  ttl_expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dedupe_ttl ON dedupe(ttl_expires_at);

CREATE TABLE IF NOT EXISTS audit (
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

CREATE INDEX IF NOT EXISTS idx_audit_session ON audit(session_key);
CREATE INDEX IF NOT EXISTS idx_audit_source ON audit(source);

CREATE TABLE IF NOT EXISTS dashboard_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key TEXT NOT NULL,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  job_id      TEXT
);

CREATE INDEX IF NOT EXISTS idx_dash_msg_session
  ON dashboard_messages(session_key, created_at DESC);

CREATE TABLE IF NOT EXISTS mode_changes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key    TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  from_mode      TEXT NOT NULL,
  to_mode        TEXT NOT NULL,
  changed_at     TEXT NOT NULL,
  expires_at     TEXT
);

CREATE TABLE IF NOT EXISTS dev_aliases (
  name                TEXT PRIMARY KEY,
  path                TEXT NOT NULL,
  tool                TEXT NOT NULL DEFAULT 'claude',
  instruction_content TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  tool        TEXT NOT NULL,
  transport   TEXT NOT NULL,
  definition  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(name, tool)
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_tool_name
  ON mcp_servers(tool, name);

CREATE TABLE IF NOT EXISTS session_mcp_servers (
  session_key TEXT NOT NULL,
  server_id   TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (session_key, server_id)
);

CREATE INDEX IF NOT EXISTS idx_session_mcp_servers_session
  ON session_mcp_servers(session_key);

CREATE TABLE IF NOT EXISTS metadata (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_enablement (
  skill_ref   TEXT NOT NULL,
  tool        TEXT NOT NULL,
  enabled     INTEGER NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (skill_ref, tool)
);

CREATE TABLE IF NOT EXISTS job_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL UNIQUE,
  session_key TEXT NOT NULL,
  source      TEXT,
  status      TEXT NOT NULL CHECK (status IN ('queued', 'running')),
  payload     TEXT NOT NULL,
  leased_at   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_job_queue_status_id
  ON job_queue(status, id);

CREATE INDEX IF NOT EXISTS idx_job_queue_session_status
  ON job_queue(session_key, status);

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

CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  user_id         TEXT NOT NULL,
  tool            TEXT NOT NULL DEFAULT 'claude',
  model           TEXT,
  mode            TEXT NOT NULL DEFAULT 'readonly',
  prompt          TEXT NOT NULL,
  workdir         TEXT,
  dev_alias       TEXT,
  instruction_file TEXT,
  schedule_type   TEXT NOT NULL,
  run_at          TEXT,
  cron_expr       TEXT,
  timezone        TEXT NOT NULL DEFAULT 'default',
  max_retries     INTEGER NOT NULL DEFAULT 0,
  allow_mcp       INTEGER NOT NULL DEFAULT 1,
  enabled_skills_json TEXT,
  notify_channel  TEXT,
  notify_thread   TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  last_run_at     TEXT,
  next_run_at     TEXT,
  run_count       INTEGER NOT NULL DEFAULT 0,
  max_runs        INTEGER,
  agent_id        TEXT REFERENCES ai_agents(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sched_next_run ON scheduled_tasks(next_run_at, status);
CREATE INDEX IF NOT EXISTS idx_sched_user ON scheduled_tasks(user_id);

CREATE TABLE IF NOT EXISTS scheduled_task_runs (
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
  retry_count     INTEGER NOT NULL DEFAULT 0,
  source          TEXT NOT NULL DEFAULT 'schedule'
);

CREATE INDEX IF NOT EXISTS idx_sched_runs_task ON scheduled_task_runs(task_id, started_at DESC);

CREATE TABLE IF NOT EXISTS ondemand_tasks (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  alias           TEXT,
  description     TEXT,
  user_id         TEXT NOT NULL DEFAULT 'dashboard',
  tool            TEXT NOT NULL DEFAULT 'claude',
  model           TEXT,
  mode            TEXT NOT NULL DEFAULT 'write',
  prompt          TEXT NOT NULL,
  workdir         TEXT,
  instruction_file TEXT,
  max_retries     INTEGER NOT NULL DEFAULT 0,
  allow_mcp       INTEGER NOT NULL DEFAULT 1,
  enabled_skills_json TEXT,
  notify_channel  TEXT,
  notify_thread   TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  run_count       INTEGER NOT NULL DEFAULT 0,
  last_run_at     TEXT,
  agent_id        TEXT REFERENCES ai_agents(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ondemand_task_key
  ON ondemand_tasks(COALESCE(alias, name)) WHERE status != 'deleted';

CREATE TABLE IF NOT EXISTS ondemand_task_runs (
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

CREATE INDEX IF NOT EXISTS idx_ondemand_runs_task
  ON ondemand_task_runs(task_id, started_at DESC);

CREATE TABLE IF NOT EXISTS orchestrators (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  alias           TEXT,
  description     TEXT,
  user_id         TEXT NOT NULL DEFAULT 'dashboard',
  workdir         TEXT,
  start_node_id   TEXT,
  trigger_mode    TEXT NOT NULL DEFAULT 'ondemand',
  schedule_type   TEXT,
  run_at          TEXT,
  cron_expr       TEXT,
  timezone        TEXT NOT NULL DEFAULT 'default',
  notify_channel  TEXT,
  max_parallelism INTEGER NOT NULL DEFAULT 3,
  max_total_nodes INTEGER NOT NULL DEFAULT 50,
  error_policy    TEXT NOT NULL DEFAULT 'continue',
  timeout_sec     INTEGER,
  instruction_file TEXT,
  enabled_skills_json TEXT,
  validated_snapshot TEXT,
  summary_enabled INTEGER NOT NULL DEFAULT 0,
  summary_tool    TEXT,
  max_run_workdirs INTEGER NOT NULL DEFAULT 20,
  status          TEXT NOT NULL DEFAULT 'active',
  dag_validated   INTEGER NOT NULL DEFAULT 0,
  last_run_at     TEXT,
  run_count       INTEGER NOT NULL DEFAULT 0,
  next_run_at     TEXT,
  claimed_at      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orchestrator_alias
  ON orchestrators(alias) WHERE alias IS NOT NULL AND status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_orchestrators_start_node_id
  ON orchestrators(start_node_id);

CREATE TABLE IF NOT EXISTS orchestrator_nodes (
  id                TEXT PRIMARY KEY,
  orchestrator_id   TEXT NOT NULL,
  label             TEXT NOT NULL,
  node_type         TEXT NOT NULL DEFAULT 'task',
  tool              TEXT,
  model             TEXT,
  mode              TEXT DEFAULT 'write',
  prompt            TEXT,
  instruction_file  TEXT,
  workdir           TEXT,
  write_instruction_file INTEGER NOT NULL DEFAULT 1,
  output_mode       TEXT NOT NULL DEFAULT 'auto',
  return_conditions TEXT,
  args              TEXT,              -- DEPRECATED: retained for schema compat (SQLite cannot drop columns without table rebuild)
  max_retries       INTEGER NOT NULL DEFAULT 0,
  timeout_sec       INTEGER,
  allow_mcp         INTEGER NOT NULL DEFAULT 1,
  enabled_mcp_server_ids TEXT,
  enabled_skills_json TEXT,      -- DEPRECATED: retained for schema compat (SQLite cannot drop columns without table rebuild)
  agent_id          TEXT REFERENCES ai_agents(id) ON DELETE SET NULL,
  on_missing_return TEXT NOT NULL DEFAULT 'fail',
  return_values     TEXT,
  gate_condition    TEXT,
  triggered_config_json TEXT,
  notify_enabled    INTEGER NOT NULL DEFAULT 0,
  notify_channel    TEXT,
  notify_on_error   INTEGER NOT NULL DEFAULT 1,
  position_x        REAL NOT NULL DEFAULT 0,
  position_y        REAL NOT NULL DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orch_nodes_orch
  ON orchestrator_nodes(orchestrator_id);

CREATE TABLE IF NOT EXISTS orchestrator_edges (
  id                  TEXT PRIMARY KEY,
  orchestrator_id     TEXT NOT NULL,
  from_node_id        TEXT NOT NULL,
  to_node_id          TEXT NOT NULL,
  condition_value     TEXT,
  condition_operator  TEXT NOT NULL DEFAULT 'eq',
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orch_edges_orch
  ON orchestrator_edges(orchestrator_id);
CREATE INDEX IF NOT EXISTS idx_orch_edges_from
  ON orchestrator_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_orch_edges_to
  ON orchestrator_edges(to_node_id);

CREATE TABLE IF NOT EXISTS orchestration_runs (
  id                  TEXT PRIMARY KEY,
  orchestrator_id     TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  triggered_by        TEXT NOT NULL DEFAULT 'dashboard',
  triggered_user_id   TEXT,
  trigger_context_json TEXT,
  started_at          TEXT,
  ended_at            TEXT,
  error_message       TEXT,
  rerun_from_run_id   TEXT,
  rerun_from_node_id  TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orch_runs_orch
  ON orchestration_runs(orchestrator_id, created_at DESC);

CREATE TABLE IF NOT EXISTS orchestration_node_runs (
  id                    TEXT PRIMARY KEY,
  orchestration_run_id  TEXT NOT NULL,
  node_id               TEXT NOT NULL,
  job_id                TEXT,
  session_key           TEXT,
  status                TEXT NOT NULL DEFAULT 'pending',
  prompt                TEXT,
  return_value          TEXT,
  exit_code             INTEGER,
  output_summary        TEXT,
  output_full           TEXT,
  output_path           TEXT,
  output_bytes          INTEGER,
  output_sha256         TEXT,
  error_message         TEXT,
  gate_evaluation       TEXT,
  retry_count           INTEGER NOT NULL DEFAULT 0,
  started_at            TEXT,
  ended_at              TEXT
);

CREATE INDEX IF NOT EXISTS idx_node_runs_run
  ON orchestration_node_runs(orchestration_run_id);
CREATE INDEX IF NOT EXISTS idx_node_runs_job
  ON orchestration_node_runs(job_id);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
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

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_token
  ON webhook_endpoints(token);

CREATE TABLE IF NOT EXISTS triggered_tasks (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  description         TEXT,
  user_id             TEXT NOT NULL DEFAULT 'dashboard',
  tool                TEXT NOT NULL DEFAULT 'claude',
  model               TEXT,
  mode                TEXT NOT NULL DEFAULT 'write',
  prompt              TEXT NOT NULL,
  workdir             TEXT,
  max_retries         INTEGER NOT NULL DEFAULT 0,
  allow_mcp           INTEGER NOT NULL DEFAULT 1,
  enabled_skills_json TEXT,
  instruction_file    TEXT,
  agent_id            TEXT REFERENCES ai_agents(id) ON DELETE SET NULL,
  notify_channel      TEXT,
  notify_thread       TEXT,
  enabled             INTEGER NOT NULL DEFAULT 1,
  run_count           INTEGER NOT NULL DEFAULT 0,
  last_run_at         TEXT,
  concurrency_policy  TEXT NOT NULL DEFAULT 'skip_if_running',
  claimed_at          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_triggered_tasks_enabled
  ON triggered_tasks(enabled, created_at DESC);

CREATE TABLE IF NOT EXISTS triggered_task_runs (
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

CREATE INDEX IF NOT EXISTS idx_triggered_task_runs_task
  ON triggered_task_runs(triggered_task_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_triggered_task_runs_job
  ON triggered_task_runs(job_id);

CREATE TABLE IF NOT EXISTS event_subscriptions (
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
    (target_type = 'orchestrator' AND orchestrator_id IS NOT NULL AND triggered_task_id IS NULL AND node_id IS NULL) OR
    (target_type = 'triggered_task' AND orchestrator_id IS NULL AND triggered_task_id IS NOT NULL AND node_id IS NULL) OR
    (target_type = 'triggered_node' AND orchestrator_id IS NULL AND triggered_task_id IS NULL AND node_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_event_subscriptions_endpoint
  ON event_subscriptions(endpoint_id, enabled);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_subscriptions_triggered_task_unique
  ON event_subscriptions(triggered_task_id)
  WHERE target_type = 'triggered_task';
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_subscriptions_orchestrator_unique
  ON event_subscriptions(orchestrator_id)
  WHERE target_type = 'orchestrator';
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_subscriptions_triggered_node_unique
  ON event_subscriptions(node_id)
  WHERE target_type = 'triggered_node';
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  endpoint_id          TEXT NOT NULL,
  delivery_id          TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'dispatching',
  successful_sub_ids   TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  PRIMARY KEY (endpoint_id, delivery_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_updated
  ON webhook_deliveries(updated_at);

CREATE TABLE IF NOT EXISTS default_instructions (
  tool    TEXT PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ai_agents (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL UNIQUE,
  description             TEXT,
  tool                    TEXT NOT NULL,
  model                   TEXT,
  system_instruction      TEXT,
  enabled_skills_json     TEXT,
  enabled_mcp_server_ids  TEXT,
  allow_mcp               INTEGER NOT NULL DEFAULT 1,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Retention cleanup indexes (housekeeping)
CREATE INDEX IF NOT EXISTS idx_audit_started
  ON audit(started_at);
CREATE INDEX IF NOT EXISTS idx_orch_runs_started
  ON orchestration_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_dash_msg_created
  ON dashboard_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_mode_changes_changed
  ON mode_changes(changed_at);
CREATE INDEX IF NOT EXISTS idx_sched_runs_started
  ON scheduled_task_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_ondemand_runs_started
  ON ondemand_task_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_triggered_task_runs_started
  ON triggered_task_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_orch_runs_created
  ON orchestration_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_node_runs_ended
  ON orchestration_node_runs(ended_at);
CREATE INDEX IF NOT EXISTS idx_session_registry_started_asc
  ON session_registry(started_at);
`;
