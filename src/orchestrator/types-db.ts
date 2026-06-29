/** @module types-db — Raw SQLite row interfaces for orchestrator, node, edge, run, and node-run tables */
/**
 * Task Orchestrator — DB Row Types (snake_case)
 *
 * Raw SQLite row shapes returned by better-sqlite3 queries.
 * Used exclusively by OrchestratorStore and shared mappers.
 */

export interface OrchestratorRow {
  id: string;
  name: string;
  alias: string | null;
  description: string | null;
  user_id: string;
  workdir: string | null;
  start_node_id: string | null;
  trigger_mode: string;
  schedule_type: string | null;
  run_at: string | null;
  cron_expr: string | null;
  timezone: string;
  notify_channel: string | null;
  max_parallelism: number;
  max_total_nodes: number;
  error_policy: string;
  timeout_sec: number | null;
  instruction_file: string | null;
  enabled_skills_json: string | null;
  summary_enabled: number;
  summary_tool: string | null;
  max_run_workdirs: number;
  status: string;
  dag_validated: number;
  last_run_at: string | null;
  run_count: number;
  next_run_at: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiAgentRow {
  id: string;
  name: string;
  description: string | null;
  tool: string;
  model: string | null;
  system_instruction: string | null;
  enabled_skills_json: string | null;
  enabled_mcp_server_ids: string | null;
  allow_mcp: number;
  created_at: string;
  updated_at: string;
}

export interface NodeRow {
  id: string;
  orchestrator_id: string;
  label: string;
  node_type: string;
  agent_id: string | null;
  tool: string | null;
  model: string | null;
  mode: string;
  prompt: string | null;
  instruction_file: string | null;
  workdir: string | null;
  write_instruction_file: number;
  args: string | null;
  max_retries: number;
  timeout_sec: number | null;
  allow_mcp: number;
  enabled_mcp_server_ids: string | null;
  enabled_skills_json: string | null;
  output_mode: string;
  return_conditions: string | null;
  return_values: string | null;
  gate_condition: string | null;
  triggered_config_json: string | null;
  notify_enabled: number;
  notify_channel: string | null;
  notify_on_error: number;
  position_x: number;
  position_y: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface EdgeRow {
  id: string;
  orchestrator_id: string;
  from_node_id: string;
  to_node_id: string;
  condition_value: string | null;
  condition_operator: string;
  sort_order: number;
  created_at: string;
}

export interface RunRow {
  id: string;
  orchestrator_id: string;
  status: string;
  triggered_by: string;
  triggered_user_id: string | null;
  trigger_context_json: string | null;
  started_at: string | null;
  ended_at: string | null;
  error_message: string | null;
  rerun_from_run_id: string | null;
  rerun_from_node_id: string | null;
  created_at: string;
}

export interface NodeRunRow {
  id: string;
  orchestration_run_id: string;
  node_id: string;
  job_id: string | null;
  session_key: string | null;
  status: string;
  prompt: string | null;
  return_value: string | null;
  exit_code: number | null;
  output_summary: string | null;
  output_full: string | null;
  error_message: string | null;
  gate_evaluation: string | null;
  retry_count: number;
  started_at: string | null;
  ended_at: string | null;
}
