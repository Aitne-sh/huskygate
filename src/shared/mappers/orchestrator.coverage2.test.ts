/** Coverage2 tests for shared/mappers/orchestrator: mapAiAgent, mapNode with agent_id/model,
 * mapOrchestrator with additional fields */
import { describe, expect, it } from 'vitest';
import { mapAiAgent, mapEdge, mapNode, mapOrchestrator } from './orchestrator.js';

describe('orchestrator mapper coverage2', () => {
  describe('mapAiAgent', () => {
    it('maps agent with valid tool', () => {
      const row = {
        id: 'agent-1',
        name: 'Test Agent',
        description: 'A test agent',
        tool: 'claude',
        model: 'claude-sonnet-4-20250514',
        system_instruction: 'Be helpful',
        enabled_skills_json: null,
        enabled_mcp_server_ids: null,
        allow_mcp: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      const agent = mapAiAgent(row);
      expect(agent.id).toBe('agent-1');
      expect(agent.tool).toBe('claude');
      expect(agent.model).toBe('claude-sonnet-4-20250514');
    });

    it('defaults to claude for invalid tool', () => {
      const row = {
        id: 'agent-2',
        name: 'Agent',
        description: null,
        tool: 'invalid-tool',
        model: null,
        system_instruction: null,
        enabled_skills_json: null,
        enabled_mcp_server_ids: null,
        allow_mcp: 0,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      const agent = mapAiAgent(row);
      expect(agent.tool).toBe('claude');
    });
  });

  describe('mapNode with triggered config', () => {
    it('parses triggered_config_json', () => {
      const row = {
        id: 'n1',
        orchestrator_id: 'o1',
        label: 'Triggered',
        node_type: 'triggered',
        agent_id: 'agent-1',
        tool: 'claude',
        model: 'claude-sonnet-4-20250514',
        mode: 'write',
        prompt: 'handle event',
        max_retries: 1,
        timeout_sec: 60,
        allow_mcp: 1,
        enabled_mcp_server_ids: JSON.stringify(['srv-1', 'srv-2']),
        workdir: '/custom/workdir',
        write_instruction_file: 1,
        instruction_file: null,
        output_mode: 'full',
        return_conditions: JSON.stringify([
          { returnValue: 'done', matchMode: 'contains', matchValue: 'DONE' },
        ]),
        return_values: null,
        gate_condition: null,
        triggered_config_json: JSON.stringify({
          subscriptionId: 'sub-1',
          timeoutSec: 300,
        }),
        notify_enabled: 1,
        notify_channel: 'C123',
        notify_on_error: 1,
        position_x: 100,
        position_y: 200,
        sort_order: 5,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      const node = mapNode(row);
      expect(node.triggeredConfig).toEqual({
        subscriptionId: 'sub-1',
        timeoutSec: 300,
      });
      expect(node.enabledMcpServerIds).toEqual(['srv-1', 'srv-2']);
      expect(node.agentId).toBe('agent-1');
      expect(node.model).toBe('claude-sonnet-4-20250514');
      expect(node.notifyEnabled).toBe(true);
      expect(node.notifyOnError).toBe(true);
    });
  });

  describe('mapOrchestrator with all fields', () => {
    it('maps orchestrator with schedule fields', () => {
      const row = {
        id: 'o1',
        name: 'Scheduled Orch',
        alias: 'sched',
        description: 'A scheduled orchestrator',
        user_id: 'U1',
        workdir: '/custom',
        start_node_id: 'start-1',
        trigger_mode: 'schedule',
        schedule_type: 'cron',
        run_at: null,
        cron_expr: '0 */6 * * *',
        timezone: 'America/New_York',
        notify_channel: 'C123',
        max_parallelism: 5,
        max_total_nodes: 100,
        error_policy: 'fail_fast',
        timeout_sec: 3600,
        instruction_file: 'INSTRUCTIONS.md',
        enabled_skills_json: null,
        summary_enabled: 1,
        summary_tool: 'claude',
        max_run_workdirs: 10,
        status: 'active',
        dag_validated: 1,
        last_run_at: '2026-03-01T00:00:00Z',
        run_count: 42,
        next_run_at: '2026-03-24T06:00:00Z',
        claimed_at: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-03-01T00:00:00Z',
      };
      const orch = mapOrchestrator(row);
      expect(orch.triggerMode).toBe('schedule');
      expect(orch.scheduleType).toBe('cron');
      expect(orch.cronExpr).toBe('0 */6 * * *');
      expect(orch.errorPolicy).toBe('fail_fast');
      expect(orch.summaryEnabled).toBe(true);
      expect(orch.summaryTool).toBe('claude');
      expect(orch.runCount).toBe(42);
    });
  });

  describe('mapEdge with explicit condition_operator', () => {
    it('maps edge with ne operator', () => {
      const row = {
        id: 'e1',
        orchestrator_id: 'o1',
        from_node_id: 'n1',
        to_node_id: 'n2',
        condition_value: 'error_return',
        condition_operator: 'ne',
        sort_order: 1,
        created_at: '2026-01-01T00:00:00Z',
      };
      const edge = mapEdge(row);
      expect(edge.conditionOperator).toBe('ne');
      expect(edge.conditionValue).toBe('error_return');
    });
  });
});
