import { describe, expect, it } from 'vitest';
import { getOsTimezone } from '../../utils/timezone.js';
import { mapOndemandTask, mapOndemandTaskRun } from './ondemand-task.js';
import { mapNodeRun, mapRun } from './orchestrator-run.js';
import { mapEdge, mapNode, mapOrchestrator } from './orchestrator.js';
import { mapScheduledTask, mapScheduledTaskRun } from './scheduled-task.js';

describe('shared mappers', () => {
  it('maps orchestrators with defaults', () => {
    expect(
      mapOrchestrator({
        id: 'orch-1',
        name: 'Pipeline',
        user_id: 'user-1',
        start_node_id: 'node-start',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    ).toMatchObject({
      id: 'orch-1',
      startNodeId: 'node-start',
      timezone: getOsTimezone(),
      maxParallelism: 3,
      maxTotalNodes: 50,
      errorPolicy: 'continue',
      timeoutSec: null,
      summaryEnabled: false,
      summaryTool: null,
      status: 'active',
      dagValidated: false,
      runCount: 0,
      scheduleType: null,
      cronExpr: null,
    });
  });

  it('maps nodes with gate-condition aliases and defaults', () => {
    expect(
      mapNode({
        id: 'node-1',
        orchestrator_id: 'orch-1',
        label: 'Gate',
        gate_condition: JSON.stringify({ mode: 'or' }),
        return_conditions: JSON.stringify([{ condition: 'ok', value: 'pass' }]),
        return_values: JSON.stringify(['pass', 'fail']),
        notify_enabled: 1,
        notify_on_error: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    ).toMatchObject({
      nodeType: 'task',
      tool: null,
      mode: 'write',
      timeoutSec: null,
      workdir: null,
      writeInstructionFile: true,
      instructionFile: null,
      outputMode: 'auto',
      gateCondition: { mode: 'or', matchValue: 'done' },
      returnConditions: [{ condition: 'ok', value: 'pass' }],
      returnValues: ['pass', 'fail', 'other_return', 'error_return'],
      notifyEnabled: true,
      notifyOnError: true,
    });
  });

  it('maps orchestrator summary settings when present', () => {
    expect(
      mapOrchestrator({
        id: 'orch-summary',
        name: 'Summary pipeline',
        user_id: 'user-1',
        start_node_id: 'node-start',
        summary_enabled: 1,
        summary_tool: 'gemini',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    ).toMatchObject({
      summaryEnabled: true,
      summaryTool: 'gemini',
    });
  });

  it('drops invalid summary tool values instead of propagating them', () => {
    expect(
      mapOrchestrator({
        id: 'orch-invalid-summary',
        name: 'Summary pipeline',
        user_id: 'user-1',
        start_node_id: 'node-start',
        summary_enabled: 1,
        summary_tool: 'invalid-tool',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    ).toMatchObject({
      summaryEnabled: true,
      summaryTool: null,
    });
  });

  it('throws when the orchestrator row is missing start_node_id', () => {
    expect(() =>
      mapOrchestrator({
        id: 'orch-missing-start',
        name: 'Broken',
        user_id: 'user-1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    ).toThrow('Orchestrator orch-missing-start is missing start_node_id');
  });

  it('uses "unknown" in the missing start-node error when the row id is absent', () => {
    expect(() =>
      mapOrchestrator({
        name: 'Broken',
        user_id: 'user-1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    ).toThrow('Orchestrator unknown is missing start_node_id');
  });

  it('maps nodes with explicit values and invalid gate-condition JSON safely', () => {
    expect(
      mapNode({
        id: 'node-2',
        orchestrator_id: 'orch-1',
        label: 'Task',
        node_type: 'gate',
        tool: 'claude',
        mode: 'readonly',
        prompt: 'Do work',
        max_retries: 2,
        timeout_sec: 30,
        workdir: '/tmp/node-workdir',
        write_instruction_file: 0,
        instruction_file: '# node instructions',
        output_mode: 'manual',
        gate_condition: '{bad json}',
        notify_enabled: 0,
        notify_channel: 'C123',
        notify_on_error: 0,
        position_x: 10,
        position_y: 20,
        sort_order: 3,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    ).toMatchObject({
      nodeType: 'gate',
      tool: 'claude',
      mode: 'readonly',
      timeoutSec: 30,
      workdir: '/tmp/node-workdir',
      writeInstructionFile: false,
      instructionFile: '# node instructions',
      outputMode: 'manual',
      gateCondition: null,
      notifyEnabled: false,
      notifyChannel: 'C123',
      notifyOnError: false,
      positionX: 10,
      positionY: 20,
      sortOrder: 3,
    });
  });

  it('defaults gate-condition mode when the stored payload omits it', () => {
    expect(
      mapNode({
        id: 'node-3',
        orchestrator_id: 'orch-1',
        label: 'Fallback gate',
        gate_condition: JSON.stringify({ matchValue: 'custom' }),
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    ).toMatchObject({
      gateCondition: { mode: 'and', matchValue: 'custom' },
    });
  });

  it('maps edges with the default operator', () => {
    expect(
      mapEdge({
        id: 'edge-1',
        orchestrator_id: 'orch-1',
        from_node_id: 'node-a',
        to_node_id: 'node-b',
        created_at: '2026-01-01T00:00:00Z',
      }),
    ).toMatchObject({
      conditionValue: null,
      conditionOperator: 'eq',
      sortOrder: 0,
    });
  });

  it('maps orchestration runs and node runs with defaults', () => {
    expect(
      mapRun({
        id: 'run-1',
        orchestrator_id: 'orch-1',
        trigger_context_json: '{"repo":"org/repo"}',
        created_at: '2026-01-01T00:00:00Z',
      }),
    ).toMatchObject({
      status: 'pending',
      triggeredBy: 'dashboard',
      triggeredUserId: null,
      triggerContextJson: '{"repo":"org/repo"}',
    });

    expect(
      mapNodeRun({
        id: 'node-run-1',
        orchestration_run_id: 'run-1',
        node_id: 'node-1',
        retry_count: 0,
      }),
    ).toMatchObject({
      status: 'pending',
      exitCode: null,
      jobId: null,
      sessionKey: null,
    });
  });

  it('maps on-demand tasks and runs with defaults', () => {
    expect(
      mapOndemandTask({
        id: 'task-1',
        name: 'Daily report',
        user_id: 'user-1',
        prompt: 'Summarize changes',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    ).toMatchObject({
      tool: 'claude',
      mode: 'write',
      status: 'active',
      runCount: 0,
    });

    expect(
      mapOndemandTaskRun({
        id: 'task-run-1',
        task_id: 'task-1',
        session_key: 'sess-1',
        started_at: '2026-01-01T00:00:00Z',
        retry_count: 0,
      }),
    ).toMatchObject({
      status: 'pending',
      exitCode: null,
      source: 'dashboard',
    });
  });

  it('maps scheduled tasks and runs with defaults', () => {
    expect(
      mapScheduledTask({
        id: 'sched-1',
        name: 'Nightly sync',
        user_id: 'user-1',
        prompt: 'Run sync',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    ).toMatchObject({
      tool: 'claude',
      mode: 'write',
      scheduleType: 'once',
      timezone: getOsTimezone(),
      status: 'active',
      maxRuns: null,
      maxRetries: 0,
    });

    expect(
      mapScheduledTaskRun({
        id: 'sched-run-1',
        task_id: 'sched-1',
        session_key: 'sess-1',
        started_at: '2026-01-01T00:00:00Z',
        retry_count: 1,
      }),
    ).toMatchObject({
      status: 'pending',
      exitCode: null,
      artifacts: null,
      retryCount: 1,
    });
  });
});
