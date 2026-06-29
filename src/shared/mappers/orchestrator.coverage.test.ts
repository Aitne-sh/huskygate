/** Coverage tests for orchestrator mapper: edge cases in mapNode with return values. */
import { describe, expect, it } from 'vitest';
import { mapEdge, mapNode, mapOrchestrator } from './orchestrator.js';

describe('orchestrator mapper coverage', () => {
  describe('mapNode', () => {
    it('auto-injects system return values when not present', () => {
      const row = {
        id: 'n1',
        orchestrator_id: 'o1',
        label: 'Task',
        node_type: 'task',
        tool: 'claude',
        mode: 'write',
        prompt: 'do stuff',
        max_retries: 0,
        timeout_sec: null,
        allow_mcp: 0,
        enabled_mcp_server_ids: null,
        workdir: null,
        write_instruction_file: 1,
        instruction_file: null,
        output_mode: 'auto',
        return_conditions: null,
        return_values: JSON.stringify(['done', 'failed']),
        gate_condition: null,
        triggered_config_json: null,
        notify_enabled: 0,
        notify_channel: null,
        notify_on_error: 0,
        position_x: 0,
        position_y: 0,
        sort_order: 0,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      const node = mapNode(row);
      expect(node.returnValues).toContain('done');
      expect(node.returnValues).toContain('failed');
      expect(node.returnValues).toContain('other_return');
      expect(node.returnValues).toContain('error_return');
    });

    it('does not duplicate system return values if already present', () => {
      const row = {
        id: 'n1',
        orchestrator_id: 'o1',
        label: 'Task',
        node_type: 'task',
        tool: 'claude',
        mode: 'write',
        prompt: null,
        max_retries: 0,
        timeout_sec: null,
        allow_mcp: 0,
        enabled_mcp_server_ids: null,
        workdir: null,
        write_instruction_file: null,
        instruction_file: null,
        output_mode: 'auto',
        return_conditions: null,
        return_values: JSON.stringify(['done', 'other_return', 'error_return']),
        gate_condition: null,
        triggered_config_json: null,
        notify_enabled: 0,
        notify_channel: null,
        notify_on_error: 0,
        position_x: 0,
        position_y: 0,
        sort_order: 0,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      const node = mapNode(row);
      const otherCount = node.returnValues?.filter((v) => v === 'other_return').length;
      expect(otherCount).toBe(1);
    });

    it('handles gate_condition with or mode', () => {
      const row = {
        id: 'n1',
        orchestrator_id: 'o1',
        label: 'Gate',
        node_type: 'gate',
        tool: null,
        mode: 'write',
        prompt: null,
        max_retries: 0,
        timeout_sec: null,
        allow_mcp: 0,
        enabled_mcp_server_ids: null,
        workdir: null,
        write_instruction_file: null,
        instruction_file: null,
        output_mode: 'auto',
        return_conditions: null,
        return_values: null,
        gate_condition: JSON.stringify({ mode: 'or', matchValue: 'done' }),
        triggered_config_json: null,
        notify_enabled: 0,
        notify_channel: null,
        notify_on_error: 0,
        position_x: 0,
        position_y: 0,
        sort_order: 0,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      const node = mapNode(row);
      expect(node.gateCondition).toEqual({ mode: 'or', matchValue: 'done' });
    });

    it('handles gate_condition with "or" mode', () => {
      const row = {
        id: 'n1',
        orchestrator_id: 'o1',
        label: 'Gate',
        node_type: 'gate',
        tool: null,
        mode: 'write',
        prompt: null,
        max_retries: 0,
        timeout_sec: null,
        allow_mcp: 0,
        enabled_mcp_server_ids: null,
        workdir: null,
        write_instruction_file: null,
        instruction_file: null,
        output_mode: 'auto',
        return_conditions: null,
        return_values: null,
        gate_condition: JSON.stringify({ mode: 'or' }),
        triggered_config_json: null,
        notify_enabled: 0,
        notify_channel: null,
        notify_on_error: 0,
        position_x: 0,
        position_y: 0,
        sort_order: 0,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      const node = mapNode(row);
      expect(node.gateCondition?.mode).toBe('or');
    });
  });

  describe('mapEdge', () => {
    it('maps edge with condition_operator default', () => {
      const row = {
        id: 'e1',
        orchestrator_id: 'o1',
        from_node_id: 'n1',
        to_node_id: 'n2',
        condition_value: 'done',
        condition_operator: null,
        sort_order: 0,
        created_at: '2026-01-01T00:00:00Z',
      };
      const edge = mapEdge(row);
      expect(edge.conditionOperator).toBe('eq');
    });
  });

  describe('mapOrchestrator', () => {
    it('throws when start_node_id is missing', () => {
      const row = {
        id: 'o1',
        name: 'Test',
        start_node_id: null,
      };
      expect(() => mapOrchestrator(row)).toThrow('missing start_node_id');
    });
  });
});
