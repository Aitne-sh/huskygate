import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeTaskNode, executeTriggeredNode, handleNodeJobComplete } from './engine-executor.js';
import type { EngineContext } from './engine.js';
import type {
  ActiveOrchestrationRun,
  OrchestrationNodeRun,
  Orchestrator,
  OrchestratorNode,
  ValidatedDAG,
} from './types.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-orch-mcp-'));
  tempDirs.push(dir);
  return dir;
}

function makeOrchestrator(overrides?: Partial<Orchestrator>): Orchestrator {
  return {
    id: 'orch-1',
    name: 'Test Orch',
    alias: null,
    description: null,
    userId: 'user-1',
    workdir: null,
    startNodeId: '',
    triggerMode: 'ondemand',
    scheduleType: null,
    runAt: null,
    cronExpr: null,
    timezone: 'UTC',
    notifyChannel: null,
    maxParallelism: 1,
    maxTotalNodes: 10,
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
    createdAt: '2026-03-10T00:00:00.000Z',
    updatedAt: '2026-03-10T00:00:00.000Z',
    ...overrides,
  };
}

function makeNode(overrides?: Partial<OrchestratorNode>): OrchestratorNode {
  return {
    id: 'node-1',
    orchestratorId: 'orch-1',
    label: 'Node 1',
    nodeType: 'task',
    agentId: null,
    tool: 'claude',
    model: null,
    mode: 'write',
    prompt: 'Run task',
    maxRetries: 0,
    timeoutSec: null,
    allowMcp: true,
    enabledMcpServerIds: null,
    workdir: null,
    writeInstructionFile: true,
    instructionFile: null,
    outputMode: 'manual',
    returnConditions: null,
    returnValues: null,
    gateCondition: null,
    triggeredConfig: null,
    notifyEnabled: false,
    notifyChannel: null,
    notifyOnError: false,
    positionX: 0,
    positionY: 0,
    sortOrder: 0,
    createdAt: '2026-03-10T00:00:00.000Z',
    updatedAt: '2026-03-10T00:00:00.000Z',
    ...overrides,
  };
}

function makeNodeRun(overrides?: Partial<OrchestrationNodeRun>): OrchestrationNodeRun {
  return {
    id: 'nr-1',
    orchestrationRunId: 'run-1',
    nodeId: 'node-1',
    jobId: null,
    sessionKey: null,
    status: 'running',
    prompt: null,
    returnValue: null,
    exitCode: null,
    outputSummary: null,
    outputFull: null,
    errorMessage: null,
    gateEvaluation: null,
    retryCount: 0,
    startedAt: '2026-03-10T00:00:00.000Z',
    endedAt: null,
    ...overrides,
  };
}

function makeDag(nodes: OrchestratorNode[]): ValidatedDAG {
  return {
    nodes: new Map(nodes.map((node) => [node.id, node])),
    edges: [],
    outgoing: new Map(),
    incoming: new Map(),
    roots: nodes.map((node) => node.id),
    topologicalOrder: nodes.map((node) => node.id),
  };
}

function makeActive(
  nodes: OrchestratorNode[],
  overrides?: Partial<ActiveOrchestrationRun>,
): ActiveOrchestrationRun {
  return {
    runId: 'run-1',
    orchestrator: makeOrchestrator(),
    dag: makeDag(nodes),
    nodeRuns: new Map(),
    runningCount: 0,
    startedAt: Date.now(),
    triggerContext: null,
    waitingTriggeredNodes: new Map(),
    pendingTriggeredPayloads: new Map(),
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<EngineContext>): EngineContext {
  return {
    orchestratorStore: {
      createNodeRun: vi.fn(),
      updateNodeRun: vi.fn(),
      getNodeRunById: vi.fn(),
    } as unknown as EngineContext['orchestratorStore'],
    createSession: vi.fn(() => ({
      sessionKey: 'sess-1',
      workdir: '/tmp/unused',
    })),
    prepareWorkdir: vi.fn(),
    enqueueJob: vi.fn(() => ({ position: 1 })),
    cleanupSession: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('engine executor MCP propagation', () => {
  it('passes enabledMcpServerIds when executing a task node', async () => {
    const workdir = createTempDir();
    const node = makeNode({
      enabledMcpServerIds: ['srv-1', 'srv-missing'],
    });
    const nodeRun = makeNodeRun({ nodeId: node.id });
    const ctx = makeCtx();
    const store = ctx.orchestratorStore as unknown as {
      createNodeRun: ReturnType<typeof vi.fn>;
    };
    store.createNodeRun.mockReturnValue(nodeRun);
    const active = makeActive([node], {
      orchestrator: makeOrchestrator({ workdir }),
    });

    await executeTaskNode(ctx, active, node);

    expect(ctx.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        executionPolicy: expect.objectContaining({
          allowMcp: true,
          enabledMcpServerIds: ['srv-1', 'srv-missing'],
        }),
      }),
    );
  });

  it('passes enabledMcpServerIds when resuming a triggered node after an event arrives', async () => {
    const workdir = createTempDir();
    const node = makeNode({
      nodeType: 'triggered',
      enabledMcpServerIds: ['srv-2'],
      triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
    });
    const waitingRun = makeNodeRun({
      id: 'nr-waiting',
      nodeId: node.id,
      status: 'waiting',
      retryCount: 0,
    });
    const resumedRun = makeNodeRun({
      ...waitingRun,
      status: 'running',
      jobId: 'job-resumed',
      sessionKey: 'sess-triggered',
    });
    const ctx = makeCtx({
      createSession: vi.fn(() => ({ sessionKey: 'sess-triggered', workdir: '/tmp/unused' })),
    });
    const store = ctx.orchestratorStore as unknown as {
      updateNodeRun: ReturnType<typeof vi.fn>;
      getNodeRunById: ReturnType<typeof vi.fn>;
    };
    store.getNodeRunById.mockReturnValue(resumedRun);
    const active = makeActive([node], {
      orchestrator: makeOrchestrator({ workdir }),
      nodeRuns: new Map([[node.id, waitingRun]]),
      pendingTriggeredPayloads: new Map([[node.id, { repo: 'org/repo' }]]),
    });

    await executeTriggeredNode(ctx, active, node, vi.fn(), vi.fn());

    expect(ctx.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        executionPolicy: expect.objectContaining({
          allowMcp: true,
          enabledMcpServerIds: ['srv-2'],
        }),
      }),
    );
  });

  it('cleans up resumed triggered-node sessions when enqueue fails', async () => {
    const workdir = createTempDir();
    const node = makeNode({
      nodeType: 'triggered',
      enabledMcpServerIds: ['srv-2'],
      triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
    });
    const waitingRun = makeNodeRun({
      id: 'nr-waiting',
      nodeId: node.id,
      status: 'waiting',
      retryCount: 0,
    });
    const failedRun = makeNodeRun({
      ...waitingRun,
      status: 'failed',
      sessionKey: 'sess-triggered',
      errorMessage: 'Enqueue failed: Queue full',
    });
    const ctx = makeCtx({
      createSession: vi.fn(() => ({ sessionKey: 'sess-triggered', workdir: '/tmp/unused' })),
      enqueueJob: vi.fn(() => ({ error: 'Queue full' })),
    });
    const store = ctx.orchestratorStore as unknown as {
      getNodeRunById: ReturnType<typeof vi.fn>;
    };
    store.getNodeRunById.mockReturnValue(failedRun);
    const active = makeActive([node], {
      orchestrator: makeOrchestrator({ workdir }),
      nodeRuns: new Map([[node.id, waitingRun]]),
      pendingTriggeredPayloads: new Map([[node.id, { repo: 'org/repo' }]]),
      runningCount: 1,
    });

    await executeTriggeredNode(ctx, active, node, vi.fn(), vi.fn());

    expect(ctx.cleanupSession).toHaveBeenCalledWith('sess-triggered');
    expect(active.runningCount).toBe(1);
  });

  it('passes enabledMcpServerIds when retrying a triggered node after failure', async () => {
    const workdir = createTempDir();
    const node = makeNode({
      nodeType: 'triggered',
      enabledMcpServerIds: ['srv-3'],
      maxRetries: 1,
      triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
    });
    const failedRun = makeNodeRun({
      id: 'nr-1',
      nodeId: node.id,
      jobId: 'job-1',
      status: 'running',
      retryCount: 0,
    });
    const retryRun = makeNodeRun({
      id: 'nr-2',
      nodeId: node.id,
      status: 'running',
      retryCount: 1,
    });
    const updatedFailedRun = makeNodeRun({
      ...failedRun,
      status: 'failed',
      errorMessage: 'timeout',
      endedAt: '2026-03-10T00:01:00.000Z',
    });
    const updatedRetryRun = makeNodeRun({
      ...retryRun,
      jobId: 'job-retry',
      sessionKey: 'sess-retry',
      prompt: 'Run task',
    });
    const ctx = makeCtx({
      createSession: vi.fn(() => ({ sessionKey: 'sess-retry', workdir: '/tmp/unused' })),
    });
    const store = ctx.orchestratorStore as unknown as {
      createNodeRun: ReturnType<typeof vi.fn>;
      updateNodeRun: ReturnType<typeof vi.fn>;
      getNodeRunById: ReturnType<typeof vi.fn>;
    };
    store.createNodeRun.mockReturnValue(retryRun);
    store.getNodeRunById.mockImplementation((id: string) => {
      if (id === failedRun.id) return updatedFailedRun;
      if (id === retryRun.id) return updatedRetryRun;
      return null;
    });
    const active = makeActive([node], {
      orchestrator: makeOrchestrator({ workdir }),
      nodeRuns: new Map([[node.id, failedRun]]),
      runningCount: 1,
    });

    await handleNodeJobComplete(
      ctx,
      active,
      failedRun,
      { exitCode: 1, events: [], errorKind: 'timeout' },
      'no return tag',
      vi.fn(),
      vi.fn(),
    );

    expect(ctx.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        executionPolicy: expect.objectContaining({
          allowMcp: true,
          enabledMcpServerIds: ['srv-3'],
        }),
      }),
    );
  });

  it('cleans up retried triggered-node sessions when enqueue fails', async () => {
    const workdir = createTempDir();
    const node = makeNode({
      nodeType: 'triggered',
      enabledMcpServerIds: ['srv-3'],
      maxRetries: 1,
      triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
    });
    const failedRun = makeNodeRun({
      id: 'nr-1',
      nodeId: node.id,
      jobId: 'job-1',
      status: 'running',
      retryCount: 0,
    });
    const retryRun = makeNodeRun({
      id: 'nr-2',
      nodeId: node.id,
      status: 'failed',
      retryCount: 1,
      sessionKey: 'sess-retry',
      errorMessage: 'Enqueue failed: Queue full',
    });
    const updatedFailedRun = makeNodeRun({
      ...failedRun,
      status: 'failed',
      errorMessage: 'timeout',
      endedAt: '2026-03-10T00:01:00.000Z',
    });
    const ctx = makeCtx({
      createSession: vi.fn(() => ({ sessionKey: 'sess-retry', workdir: '/tmp/unused' })),
      enqueueJob: vi.fn(() => ({ error: 'Queue full' })),
    });
    const store = ctx.orchestratorStore as unknown as {
      createNodeRun: ReturnType<typeof vi.fn>;
      getNodeRunById: ReturnType<typeof vi.fn>;
    };
    store.createNodeRun.mockReturnValue(retryRun);
    store.getNodeRunById.mockImplementation((id: string) => {
      if (id === failedRun.id) return updatedFailedRun;
      if (id === retryRun.id) return retryRun;
      return null;
    });
    const active = makeActive([node], {
      orchestrator: makeOrchestrator({ workdir }),
      nodeRuns: new Map([[node.id, failedRun]]),
      runningCount: 1,
    });

    await handleNodeJobComplete(
      ctx,
      active,
      failedRun,
      { exitCode: 1, events: [], errorKind: 'timeout' },
      'no return tag',
      vi.fn(),
      vi.fn(),
    );

    expect(ctx.cleanupSession).toHaveBeenCalledWith('sess-retry');
    expect(active.runningCount).toBe(0);
  });
});

describe('engine executor model injection', () => {
  it('injects node model into toolStateOverrides when node has model', async () => {
    const workdir = createTempDir();
    const node = makeNode({ model: 'claude-opus-4-6' });
    const nodeRun = makeNodeRun({ nodeId: node.id });
    const ctx = makeCtx();
    const store = ctx.orchestratorStore as unknown as {
      createNodeRun: ReturnType<typeof vi.fn>;
    };
    store.createNodeRun.mockReturnValue(nodeRun);
    const active = makeActive([node], {
      orchestrator: makeOrchestrator({ workdir }),
    });

    await executeTaskNode(ctx, active, node);

    expect(ctx.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        toolStateOverrides: { model: 'claude-opus-4-6' },
      }),
    );
  });

  it('does not include toolStateOverrides when model is null', async () => {
    const workdir = createTempDir();
    const node = makeNode({ model: null });
    const nodeRun = makeNodeRun({ nodeId: node.id });
    const ctx = makeCtx();
    const store = ctx.orchestratorStore as unknown as {
      createNodeRun: ReturnType<typeof vi.fn>;
    };
    store.createNodeRun.mockReturnValue(nodeRun);
    const active = makeActive([node], {
      orchestrator: makeOrchestrator({ workdir }),
    });

    await executeTaskNode(ctx, active, node);

    const jobArg = (ctx.enqueueJob as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(jobArg).toBeDefined();
    expect(jobArg.toolStateOverrides).toBeUndefined();
  });

  it('falls back to agent model when node model is null', async () => {
    const workdir = createTempDir();
    const node = makeNode({
      model: null,
      agentId: 'agent-1',
    });
    const nodeRun = makeNodeRun({ nodeId: node.id });
    const agentStore = {
      getById: vi.fn(() => ({
        id: 'agent-1',
        name: 'Test Agent',
        description: null,
        tool: 'claude' as const,
        model: 'claude-sonnet-4-6',
        systemInstruction: null,
        enabledSkills: null,
        enabledMcpServerIds: null,
        allowMcp: true,
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
      })),
    };
    const ctx = makeCtx({
      agentStore: agentStore as unknown as EngineContext['agentStore'],
    });
    const store = ctx.orchestratorStore as unknown as {
      createNodeRun: ReturnType<typeof vi.fn>;
    };
    store.createNodeRun.mockReturnValue(nodeRun);
    const active = makeActive([node], {
      orchestrator: makeOrchestrator({ workdir }),
    });

    await executeTaskNode(ctx, active, node);

    expect(ctx.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        toolStateOverrides: { model: 'claude-sonnet-4-6' },
      }),
    );
  });

  it('node model takes priority over agent model', async () => {
    const workdir = createTempDir();
    const node = makeNode({
      model: 'gemini-2.5-pro',
      agentId: 'agent-1',
    });
    const nodeRun = makeNodeRun({ nodeId: node.id });
    const agentStore = {
      getById: vi.fn(() => ({
        id: 'agent-1',
        name: 'Test Agent',
        description: null,
        tool: 'claude' as const,
        model: 'claude-sonnet-4-6',
        systemInstruction: null,
        enabledSkills: null,
        enabledMcpServerIds: null,
        allowMcp: true,
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
      })),
    };
    const ctx = makeCtx({
      agentStore: agentStore as unknown as EngineContext['agentStore'],
    });
    const store = ctx.orchestratorStore as unknown as {
      createNodeRun: ReturnType<typeof vi.fn>;
    };
    store.createNodeRun.mockReturnValue(nodeRun);
    const active = makeActive([node], {
      orchestrator: makeOrchestrator({ workdir }),
    });

    await executeTaskNode(ctx, active, node);

    expect(ctx.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        toolStateOverrides: { model: 'gemini-2.5-pro' },
      }),
    );
  });
});
