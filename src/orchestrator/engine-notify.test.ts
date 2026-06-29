/**
 * Tests for engine-notify — Slack notifications for node completions, run summaries, and artifact uploads.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  sendCompletionNotification,
  sendNodeNotification,
  uploadRunArtifacts,
} from './engine-notify.js';
import type { EngineContext } from './engine.js';
import type {
  ActiveOrchestrationRun,
  OrchestrationNodeRun,
  Orchestrator,
  OrchestratorNode,
} from './types.js';

vi.mock('../shared/file-attachment.js', () => ({
  MAX_FILE_UPLOADS: 3,
  listAllArtifacts: vi.fn(() => []),
}));

vi.mock('../shared/text-utils.js', () => ({
  formatMention: vi.fn((userId: string) => `<@${userId}>`),
  splitTextToChunks: vi.fn((text: string) => [text]),
}));

function makeOrchestrator(overrides: Partial<Orchestrator> = {}): Orchestrator {
  return {
    id: 'orch-1',
    name: 'Test Pipeline',
    alias: null,
    description: null,
    userId: 'user-1',
    workdir: '/tmp/workdir',
    startNodeId: 'node-1',
    triggerMode: 'ondemand',
    scheduleType: null,
    runAt: null,
    cronExpr: null,
    timezone: 'UTC',
    notifyChannel: 'C123',
    maxParallelism: 3,
    maxTotalNodes: 50,
    errorPolicy: 'continue',
    timeoutSec: null,
    instructionFile: null,
    enabledSkills: null,
    summaryEnabled: false,
    summaryTool: null,
    maxRunWorkdirs: 20,
    status: 'active',
    dagValidated: true,
    lastRunAt: null,
    runCount: 0,
    nextRunAt: null,
    claimedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeNode(overrides: Partial<OrchestratorNode> = {}): OrchestratorNode {
  return {
    id: 'node-1',
    orchestratorId: 'orch-1',
    label: 'Task A',
    nodeType: 'task',
    tool: 'claude',
    mode: 'write',
    prompt: 'test',
    maxRetries: 0,
    timeoutSec: null,
    allowMcp: true,
    workdir: null,
    writeInstructionFile: true,
    instructionFile: null,
    outputMode: 'auto',
    returnConditions: null,
    returnValues: null,
    gateCondition: null,
    notifyEnabled: false,
    notifyChannel: null,
    notifyOnError: false,
    positionX: 0,
    positionY: 0,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as OrchestratorNode;
}

function makeNodeRun(overrides: Partial<OrchestrationNodeRun> = {}): OrchestrationNodeRun {
  return {
    id: 'nr-1',
    orchestrationRunId: 'run-1',
    nodeId: 'node-1',
    jobId: 'job-1',
    sessionKey: 'sess-1',
    status: 'completed',
    prompt: null,
    returnValue: 'done',
    exitCode: 0,
    outputSummary: null,
    outputFull: null,
    errorMessage: null,
    gateEvaluation: null,
    retryCount: 0,
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: '2026-01-01T00:00:05Z',
    ...overrides,
  };
}

function makeActive(overrides: Partial<ActiveOrchestrationRun> = {}): ActiveOrchestrationRun {
  const node = makeNode();
  return {
    runId: 'run-1',
    orchestrator: makeOrchestrator(),
    dag: {
      nodes: new Map([['node-1', node]]),
      edges: [],
      incoming: new Map(),
      outgoing: new Map(),
      roots: ['node-1'],
      topologicalOrder: ['node-1'],
    },
    nodeRuns: new Map([['node-1', makeNodeRun()]]),
    runningCount: 0,
    startedAt: Date.now() - 5000,
    triggerContext: null,
    waitingTriggeredNodes: new Map(),
    pendingTriggeredPayloads: new Map(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendNodeNotification', () => {
  it('does nothing when postNotification is not set', async () => {
    const ctx = { postNotification: undefined } as unknown as EngineContext;
    await sendNodeNotification(ctx, makeActive(), makeNodeRun(), makeNode());
  });

  it('does nothing when node notification is not enabled', async () => {
    const postNotification = vi.fn(async () => null);
    const ctx = { postNotification } as unknown as EngineContext;
    await sendNodeNotification(
      ctx,
      makeActive(),
      makeNodeRun({ status: 'completed' }),
      makeNode({ notifyEnabled: false }),
    );
    expect(postNotification).not.toHaveBeenCalled();
  });

  it('sends notification when notifyEnabled and node completed', async () => {
    const postNotification = vi.fn(async () => null);
    const ctx = { postNotification, defaultNotifyChannel: 'C-default' } as unknown as EngineContext;
    const node = makeNode({ notifyEnabled: true, notifyChannel: 'C-node' });
    await sendNodeNotification(ctx, makeActive(), makeNodeRun({ status: 'completed' }), node);
    expect(postNotification).toHaveBeenCalledWith('C-node', expect.stringContaining('Task A'));
  });

  it('sends notification when notifyOnError and node failed', async () => {
    const postNotification = vi.fn(async () => null);
    const ctx = { postNotification, defaultNotifyChannel: 'C-default' } as unknown as EngineContext;
    const node = makeNode({ notifyOnError: true });
    const nodeRun = makeNodeRun({
      status: 'failed',
      errorMessage: 'Something broke',
      retryCount: 0,
    });
    await sendNodeNotification(ctx, makeActive(), nodeRun, node);
    expect(postNotification).toHaveBeenCalledWith(
      'C123',
      expect.stringContaining('Something broke'),
    );
  });

  it('includes retry info when retries remain', async () => {
    const postNotification = vi.fn(async () => null);
    const ctx = { postNotification } as unknown as EngineContext;
    const node = makeNode({ notifyOnError: true, maxRetries: 3 });
    const nodeRun = makeNodeRun({ status: 'failed', retryCount: 1 });
    await sendNodeNotification(ctx, makeActive(), nodeRun, node);
    expect(postNotification).toHaveBeenCalledWith('C123', expect.stringContaining('Retry: 2/3'));
  });

  it('truncates long error messages', async () => {
    const postNotification = vi.fn(async () => null);
    const ctx = { postNotification } as unknown as EngineContext;
    const node = makeNode({ notifyOnError: true });
    const longError = 'x'.repeat(2000);
    const nodeRun = makeNodeRun({ status: 'failed', errorMessage: longError });
    await sendNodeNotification(ctx, makeActive(), nodeRun, node);
    const call = (postNotification.mock.calls as unknown[][])[0];
    if (!call) throw new Error('expected call');
    expect((call[1] as string).length).toBeLessThan(2000);
  });

  it('does not send when no channel is available', async () => {
    const postNotification = vi.fn(async () => null);
    const ctx = { postNotification, defaultNotifyChannel: undefined } as unknown as EngineContext;
    const active = makeActive({
      orchestrator: makeOrchestrator({ notifyChannel: null }),
    });
    const node = makeNode({ notifyEnabled: true, notifyChannel: null });
    await sendNodeNotification(ctx, active, makeNodeRun({ status: 'completed' }), node);
    expect(postNotification).not.toHaveBeenCalled();
  });

  it('catches postNotification errors', async () => {
    const postNotification = vi.fn(async () => {
      throw new Error('Slack API down');
    });
    const ctx = { postNotification } as unknown as EngineContext;
    const node = makeNode({ notifyEnabled: true });
    // Should not throw
    await sendNodeNotification(ctx, makeActive(), makeNodeRun({ status: 'completed' }), node);
  });

  it('uses default notify channel when no node or orchestrator channel', async () => {
    const postNotification = vi.fn(async () => null);
    const ctx = { postNotification, defaultNotifyChannel: 'C-default' } as unknown as EngineContext;
    const active = makeActive({
      orchestrator: makeOrchestrator({ notifyChannel: null }),
    });
    const node = makeNode({ notifyEnabled: true, notifyChannel: null });
    await sendNodeNotification(ctx, active, makeNodeRun({ status: 'completed' }), node);
    expect(postNotification).toHaveBeenCalledWith('C-default', expect.any(String));
  });

  it('shows N/A duration when startedAt or endedAt is missing', async () => {
    const postNotification = vi.fn(async () => null);
    const ctx = { postNotification } as unknown as EngineContext;
    const node = makeNode({ notifyEnabled: true });
    const nodeRun = makeNodeRun({ status: 'completed', startedAt: null, endedAt: null });
    await sendNodeNotification(ctx, makeActive(), nodeRun, node);
    expect(postNotification).toHaveBeenCalledWith('C123', expect.stringContaining('N/A'));
  });
});

describe('sendCompletionNotification', () => {
  it('returns null when postNotification is not set', async () => {
    const ctx = { postNotification: undefined } as unknown as EngineContext;
    const result = await sendCompletionNotification(ctx, makeActive(), 'completed');
    expect(result).toBeNull();
  });

  it('returns null when no channel available', async () => {
    const postNotification = vi.fn(async () => null);
    const ctx = { postNotification, defaultNotifyChannel: undefined } as unknown as EngineContext;
    const active = makeActive({
      orchestrator: makeOrchestrator({ notifyChannel: null }),
    });
    const result = await sendCompletionNotification(ctx, active, 'completed');
    expect(result).toBeNull();
  });

  it('posts completion notification for successful run', async () => {
    const postNotification = vi.fn(async () => ({ channelId: 'C123', ts: '1234.5678' }));
    const ctx = { postNotification } as unknown as EngineContext;
    const result = await sendCompletionNotification(ctx, makeActive(), 'completed');
    expect(result).toEqual({ channelId: 'C123', ts: '1234.5678' });
  });

  it('posts completion notification for failed run', async () => {
    const postNotification = vi.fn(async () => ({ channelId: 'C123', ts: '1234.5678' }));
    const ctx = { postNotification } as unknown as EngineContext;
    await sendCompletionNotification(ctx, makeActive(), 'failed');
    expect(postNotification).toHaveBeenCalledWith('C123', expect.stringContaining('failed'));
  });

  it('posts completion notification for cancelled run', async () => {
    const postNotification = vi.fn(async () => ({ channelId: 'C123', ts: '1234.5678' }));
    const ctx = { postNotification } as unknown as EngineContext;
    await sendCompletionNotification(ctx, makeActive(), 'cancelled');
    expect(postNotification).toHaveBeenCalledWith('C123', expect.stringContaining('cancelled'));
  });

  it('handles nodeRun with various statuses in summary', async () => {
    const nodes = [
      makeNode({ id: 'n1', label: 'A' }),
      makeNode({ id: 'n2', label: 'B' }),
      makeNode({ id: 'n3', label: 'C' }),
      makeNode({ id: 'n4', label: 'D' }),
    ];
    const nodeRuns = new Map<string, OrchestrationNodeRun>([
      [
        'n1',
        makeNodeRun({
          nodeId: 'n1',
          status: 'completed',
          returnValue: 'ok',
          startedAt: '2026-01-01T00:00:00Z',
          endedAt: '2026-01-01T00:00:05Z',
        }),
      ],
      ['n2', makeNodeRun({ nodeId: 'n2', status: 'failed' })],
      ['n3', makeNodeRun({ nodeId: 'n3', status: 'skipped' })],
      ['n4', makeNodeRun({ nodeId: 'n4', status: 'cancelled' })],
    ]);
    const active = makeActive({
      dag: {
        nodes: new Map(nodes.map((n) => [n.id, n])),
        edges: [],
        incoming: new Map(),
        outgoing: new Map(),
        roots: ['n1'],
        topologicalOrder: ['n1', 'n2', 'n3', 'n4'],
      },
      nodeRuns,
    });

    const postNotification = vi.fn(async () => ({ channelId: 'C123', ts: '1234.5678' }));
    const ctx = { postNotification } as unknown as EngineContext;
    await sendCompletionNotification(ctx, active, 'failed');
    const text = (postNotification.mock.calls as unknown[][])[0]?.[1] as string;
    expect(text).toContain('1/4');
  });

  it('catches error from postNotification during completion', async () => {
    const postNotification = vi.fn(async () => {
      throw new Error('API error');
    });
    const ctx = { postNotification } as unknown as EngineContext;
    const result = await sendCompletionNotification(ctx, makeActive(), 'completed');
    expect(result).toBeNull();
  });

  it('posts node outputs in thread when posted successfully', async () => {
    const postNotification = vi.fn(async () => ({ channelId: 'C123', ts: '1234.5678' }));
    const active = makeActive({
      nodeRuns: new Map([
        ['node-1', makeNodeRun({ nodeId: 'node-1', outputFull: 'full node output' })],
      ]),
    });
    const ctx = { postNotification } as unknown as EngineContext;
    await sendCompletionNotification(ctx, active, 'completed');
    // Should have called postNotification at least twice (completion + output)
    expect(postNotification.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('catches error from postNodeOutputs', async () => {
    let callCount = 0;
    const postNotification = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return { channelId: 'C123', ts: '1234.5678' };
      throw new Error('Output post failed');
    });
    const active = makeActive({
      nodeRuns: new Map([['node-1', makeNodeRun({ nodeId: 'node-1', outputFull: 'output' })]]),
    });
    const ctx = { postNotification } as unknown as EngineContext;
    // Should not throw
    await sendCompletionNotification(ctx, active, 'completed');
  });

  it('handles missing node in topologicalOrder gracefully', async () => {
    const active = makeActive({
      dag: {
        nodes: new Map(),
        edges: [],
        incoming: new Map(),
        outgoing: new Map(),
        roots: [],
        topologicalOrder: ['nonexistent-node'],
      },
      nodeRuns: new Map(),
    });
    const postNotification = vi.fn(async () => ({ channelId: 'C123', ts: '1234.5678' }));
    const ctx = { postNotification } as unknown as EngineContext;
    await sendCompletionNotification(ctx, active, 'completed');
    expect(postNotification).toHaveBeenCalled();
  });
});

describe('uploadRunArtifacts', () => {
  it('returns early when uploadFile is not set', async () => {
    const ctx = { uploadFile: undefined } as unknown as EngineContext;
    await uploadRunArtifacts(ctx, makeActive(), 'C123', '1234.5678');
  });

  it('returns early when no job IDs exist', async () => {
    const uploadFile = vi.fn(async () => {});
    const ctx = { uploadFile } as unknown as EngineContext;
    const active = makeActive({
      nodeRuns: new Map([['node-1', makeNodeRun({ jobId: null })]]),
    });
    await uploadRunArtifacts(ctx, active, 'C123', '1234.5678');
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('returns early when no task workdirs exist', async () => {
    const uploadFile = vi.fn(async () => {});
    const ctx = { uploadFile } as unknown as EngineContext;
    const active = makeActive({
      dag: {
        nodes: new Map([['node-1', makeNode({ nodeType: 'gate' })]]),
        edges: [],
        incoming: new Map(),
        outgoing: new Map(),
        roots: ['node-1'],
        topologicalOrder: ['node-1'],
      },
    });
    await uploadRunArtifacts(ctx, active, 'C123', '1234.5678');
    expect(uploadFile).not.toHaveBeenCalled();
  });
});
