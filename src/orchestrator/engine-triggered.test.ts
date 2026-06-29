/**
 * OrchestratorEngine — Triggered Node Lifecycle Tests
 *
 * Tests cover: event waiting, timeout handling (fail / skip), retry after failure,
 * crash recovery of waiting nodes, missing eventRouter, missing subscription,
 * event-before-timeout guard, downstream gate evaluation, prepareWorkdir failure,
 * enqueue failure, and multiple parallel triggered nodes.
 *
 * Real DAG validation / buildValidatedDAG / evaluateEdgeCondition / evaluateGateCondition
 * are NOT mocked — they run as-is so we verify real DAG semantics.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks (must come before vi.mock) ──────────────

const mocked = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  randomUUID: vi.fn(() => 'mock-uuid-1'),
  listAllArtifacts: vi.fn(
    () =>
      [] as Array<{
        jobId: string;
        files: Array<{ localPath: string; filename: string; size: number; mimeType: string }>;
      }>,
  ),
}));

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    mkdirSync: mocked.mkdirSync,
    writeFileSync: mocked.writeFileSync,
    default: {
      ...original,
      mkdirSync: mocked.mkdirSync,
      writeFileSync: mocked.writeFileSync,
    },
  };
});

vi.mock('node:crypto', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:crypto')>();
  return {
    ...original,
    randomUUID: mocked.randomUUID,
    default: {
      ...original,
      randomUUID: mocked.randomUUID,
    },
  };
});

vi.mock('../shared/file-attachment.js', () => ({
  listAllArtifacts: mocked.listAllArtifacts,
  MAX_FILE_UPLOADS: 10,
}));

vi.mock('../shared/text-utils.js', () => ({
  formatMention: vi.fn((userId: string | undefined | null) => (userId ? `<@${userId}>` : '')),
  splitTextToChunks: (text: string) => [text],
}));

// ─── Imports (after mocks) ──────────────────────────────────

import type { EventRouter } from '../event/event-router.js';
import type { NodeRunStatus } from '../shared/status.js';
import { buildValidatedDAG } from './dag.js';
import { executeTaskNode, executeTriggeredNode, handleNodeJobComplete } from './engine-executor.js';
import { OrchestratorEngine } from './engine.js';
import type { EngineContext } from './engine.js';
import type {
  ActiveOrchestrationRun,
  OrchestrationNodeRun,
  OrchestrationRun,
  Orchestrator,
  OrchestratorEdge,
  OrchestratorNode,
} from './types.js';

// ─── Test-only type helpers ─────────────────────────────────

/** Shape of a single createNodeRun input argument in mock calls */
interface MockNodeRunInput {
  nodeId: string;
  status?: NodeRunStatus;
  retryCount?: number;
  returnValue?: string;
  exitCode?: number;
  outputSummary?: string;
  errorMessage?: string;
  startedAt?: string;
  endedAt?: string;
}

/** Type alias for mock.calls tuple from createNodeRun */
type MockCallTuple = [MockNodeRunInput];

/** Type for updateNodeRun mock call tuples */
type UpdateNodeRunCallTuple = [string, Record<string, unknown>];

/** Type for writeFileSync mock call tuples */
type WriteFileCallTuple = [string, string, ...unknown[]];

// (MockEventRouterShape type removed — unused in tests)

// ─── Helper Factories ───────────────────────────────────────

function createMockStore() {
  return {
    getFullOrchestrator: vi.fn(),
    createRun: vi.fn(),
    incrementRunCount: vi.fn(),
    updateRun: vi.fn(),
    getRunById: vi.fn(),
    getRunningRuns: vi.fn(),
    createNodeRun: vi.fn(),
    getNodeRunById: vi.fn(),
    getNodeRunByJobId: vi.fn(),
    getNodeRunsByRun: vi.fn(),
    updateNodeRun: vi.fn(),
    offloadRunOutputs: vi.fn(() => ({ offloadedCount: 0, errors: [] })),
    getCompletedRunIds: vi.fn<(orchestratorId: string) => string[]>(() => []),
  };
}

function makeOrchestrator(overrides?: Partial<Orchestrator>): Orchestrator {
  return {
    id: 'orch-1',
    name: 'Test Orch',
    alias: null,
    description: null,
    userId: 'user-1',
    workdir: '/tmp/test-workdir',
    startNodeId: '',
    triggerMode: 'ondemand',
    scheduleType: null,
    runAt: null,
    cronExpr: null,
    timezone: 'UTC',
    notifyChannel: null,
    maxParallelism: 3,
    maxTotalNodes: 50,
    errorPolicy: 'continue' as const,
    timeoutSec: null,
    instructionFile: null,
    enabledSkills: null,
    summaryEnabled: false,
    summaryTool: null,
    maxRunWorkdirs: 20,
    status: 'active' as const,
    dagValidated: true,
    lastRunAt: null,
    runCount: 0,
    nextRunAt: null,
    claimedAt: null,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    ...overrides,
  };
}

function makeNode(overrides?: Partial<OrchestratorNode>): OrchestratorNode {
  return {
    id: 'node-1',
    orchestratorId: 'orch-1',
    label: 'Task 1',
    nodeType: 'task',
    tool: 'claude',
    mode: 'write',
    prompt: 'Do something',
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
    triggeredConfig: null,
    notifyEnabled: false,
    notifyChannel: null,
    notifyOnError: false,
    positionX: 0,
    positionY: 0,
    sortOrder: 0,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    ...overrides,
  } as OrchestratorNode;
}

function makeEdge(overrides?: Partial<OrchestratorEdge>): OrchestratorEdge {
  return {
    id: 'edge-1',
    orchestratorId: 'orch-1',
    fromNodeId: 'node-1',
    toNodeId: 'node-2',
    conditionValue: null,
    conditionOperator: 'eq',
    sortOrder: 0,
    createdAt: '2024-01-01',
    ...overrides,
  };
}

function makeRun(overrides?: Partial<OrchestrationRun>): OrchestrationRun {
  return {
    id: 'run-1',
    orchestratorId: 'orch-1',
    status: 'running',
    triggeredBy: 'dashboard',
    triggeredUserId: 'user-1',
    triggerContextJson: null,
    startedAt: '2024-01-01T00:00:00Z',
    endedAt: null,
    errorMessage: null,
    rerunFromRunId: null,
    rerunFromNodeId: null,
    createdAt: '2024-01-01T00:00:00Z',
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
    status: 'pending',
    prompt: null,
    returnValue: null,
    exitCode: null,
    outputSummary: null,
    outputFull: null,
    errorMessage: null,
    gateEvaluation: null,
    retryCount: 0,
    startedAt: null,
    endedAt: null,
    ...overrides,
  };
}

function createContext(storeOverride?: ReturnType<typeof createMockStore>) {
  const store = storeOverride ?? createMockStore();
  const ctx = {
    orchestratorStore: store as unknown as EngineContext['orchestratorStore'],
    createSession: vi.fn<EngineContext['createSession']>(() => ({
      sessionKey: 'sess-1',
      workdir: '/tmp/sess-workdir',
    })),
    prepareWorkdir: vi.fn<EngineContext['prepareWorkdir']>(),
    enqueueJob: vi.fn<EngineContext['enqueueJob']>(() => ({ position: 1 })),
    cleanupSession: vi.fn<EngineContext['cleanupSession']>(),
    validateWorkdir: vi.fn<NonNullable<EngineContext['validateWorkdir']>>((workdir) => workdir),
    cancelJob: vi.fn<NonNullable<EngineContext['cancelJob']>>(),
    postNotification: vi.fn<NonNullable<EngineContext['postNotification']>>(async () => ({
      channelId: 'C-resolved',
      ts: 'mock-ts',
    })),
    defaultNotifyChannel: undefined,
  } satisfies EngineContext;
  return { store, ctx };
}

// ─── Mock Event Router ──────────────────────────────────────

function createMockEventRouter() {
  const waiters = new Map<
    string,
    {
      onEvent: (payload: Record<string, unknown> | null) => void;
      onTimeout: () => void;
    }
  >();

  return {
    router: {
      getTriggeredNodeSubscription: vi.fn((nodeId: string): { id: string } | null => ({
        id: `sub-${nodeId}`,
      })),
      registerTriggeredWaiter: vi.fn(
        (
          _subscriptionId: string,
          waiterKey: string,
          opts: {
            runId: string;
            nodeId: string;
            subscriptionId: string;
            onEvent: (payload: Record<string, unknown> | null) => void;
            onTimeout: () => void;
          },
        ) => {
          waiters.set(waiterKey, { onEvent: opts.onEvent, onTimeout: opts.onTimeout });
          return vi.fn(); // unsubscribe
        },
      ),
    },
    waiters,
    fireEvent(runId: string, nodeId: string, payload: Record<string, unknown> | null) {
      const key = `${runId}:${nodeId}`;
      const waiter = waiters.get(key);
      if (waiter) waiter.onEvent(payload);
    },
    fireTimeout(runId: string, nodeId: string) {
      const key = `${runId}:${nodeId}`;
      const waiter = waiters.get(key);
      if (waiter) waiter.onTimeout();
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────

describe('triggered node lifecycle', () => {
  let store: ReturnType<typeof createMockStore>;
  let ctx: ReturnType<typeof createContext>['ctx'];
  let engine: OrchestratorEngine;
  let mockEventRouter: ReturnType<typeof createMockEventRouter>;

  beforeEach(() => {
    vi.useFakeTimers();
    const created = createContext();
    store = created.store;
    ctx = created.ctx;
    engine = new OrchestratorEngine(ctx);
    mockEventRouter = createMockEventRouter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── 5.1 Normal flow: event received → task execution → completion ──

  it('5.1 normal flow — event fires → triggered node runs → downstream enqueued', async () => {
    // DAG: taskA → triggeredB → taskC
    const orchestrator = makeOrchestrator();
    const taskA = makeNode({ id: 'taskA', label: 'Task A', nodeType: 'task' });
    const triggeredB = makeNode({
      id: 'triggeredB',
      label: 'Triggered B',
      nodeType: 'triggered',
      triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
    });
    const taskC = makeNode({ id: 'taskC', label: 'Task C', nodeType: 'task' });
    const edges = [
      makeEdge({ id: 'e1', fromNodeId: 'taskA', toNodeId: 'triggeredB' }),
      makeEdge({ id: 'e2', fromNodeId: 'triggeredB', toNodeId: 'taskC' }),
    ];
    const run = makeRun({ id: 'run-1' });

    // Set eventRouter before startRun so DAG validation sees triggered subscriptions
    engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

    store.getFullOrchestrator.mockReturnValue({
      orchestrator,
      nodes: [taskA, triggeredB, taskC],
      edges,
    });
    store.createRun.mockReturnValue(run);

    let nodeRunCounter = 0;
    store.createNodeRun.mockImplementation(
      (input: { nodeId: string; status?: string; retryCount?: number }) => {
        nodeRunCounter++;
        return makeNodeRun({
          id: `nr-${nodeRunCounter}`,
          nodeId: input.nodeId,
          orchestrationRunId: 'run-1',
          status: (input.status as NodeRunStatus | undefined) ?? 'running',
          retryCount: input.retryCount ?? 0,
        });
      },
    );

    // startRun → taskA should be enqueued (root task node)
    const runId = await engine.startRun('orch-1', 'dashboard', 'user-1');
    expect(runId).toBe('run-1');
    expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

    // Complete taskA → triggeredB should enter waiting state
    const taskANodeRun = makeNodeRun({
      id: 'nr-1',
      nodeId: 'taskA',
      orchestrationRunId: 'run-1',
      status: 'running',
      jobId: 'mock-uuid-1',
      sessionKey: 'sess-1',
    });
    store.getNodeRunByJobId.mockReturnValue(taskANodeRun);

    // After completion, getNodeRunById returns the completed taskA nodeRun
    store.getNodeRunById.mockImplementation((id: string) => {
      if (id === 'nr-1') {
        return makeNodeRun({
          id: 'nr-1',
          nodeId: 'taskA',
          orchestrationRunId: 'run-1',
          status: 'completed',
          returnValue: null,
          jobId: 'mock-uuid-1',
          sessionKey: 'sess-1',
        });
      }
      return null;
    });

    await engine.onNodeJobComplete(
      'mock-uuid-1',
      { exitCode: 0, events: [], errorKind: null },
      'done',
      'done',
    );

    // triggeredB should now be waiting — registerTriggeredWaiter called
    expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);
    expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledWith(
      'sub-triggeredB',
      'run-1:triggeredB',
      expect.objectContaining({
        runId: 'run-1',
        nodeId: 'triggeredB',
        subscriptionId: 'sub-triggeredB',
      }),
    );

    // The waiting nodeRun was created for triggeredB
    const waitingNodeRunId = store.createNodeRun.mock.results.find(
      (_r: unknown, i: number) =>
        (store.createNodeRun.mock.calls[i]?.[0] as MockNodeRunInput | undefined)?.nodeId ===
        'triggeredB',
    )?.value?.id;
    expect(waitingNodeRunId).toBeDefined();

    // Now set up mock for resumeTriggeredNode flow:
    // After updateNodeRun sets triggeredB to 'running', getNodeRunById returns the running version
    const triggeredBRunningNodeRun = makeNodeRun({
      id: waitingNodeRunId ?? '',
      nodeId: 'triggeredB',
      orchestrationRunId: 'run-1',
      status: 'running',
      jobId: 'mock-uuid-1',
      sessionKey: 'sess-1',
    });
    store.getNodeRunById.mockImplementation((id: string) => {
      if (id === 'nr-1') {
        return makeNodeRun({
          id: 'nr-1',
          nodeId: 'taskA',
          orchestrationRunId: 'run-1',
          status: 'completed',
          returnValue: null,
        });
      }
      if (id === waitingNodeRunId) {
        return triggeredBRunningNodeRun;
      }
      return null;
    });

    // Fire event for triggeredB
    ctx.enqueueJob.mockClear();
    mockEventRouter.fireEvent('run-1', 'triggeredB', { key: 'value' });

    // Let async advanceExecution complete
    await vi.advanceTimersByTimeAsync(0);

    // triggeredB should have a job enqueued (resumeTriggeredNode creates session + enqueues)
    expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);
    expect(ctx.createSession).toHaveBeenCalled();

    // Now complete triggeredB → taskC should be enqueued
    store.getNodeRunByJobId.mockReturnValue(triggeredBRunningNodeRun);
    store.getNodeRunById.mockImplementation((id: string) => {
      if (id === 'nr-1') {
        return makeNodeRun({
          id: 'nr-1',
          nodeId: 'taskA',
          orchestrationRunId: 'run-1',
          status: 'completed',
        });
      }
      if (id === waitingNodeRunId) {
        return makeNodeRun({
          id: waitingNodeRunId ?? '',
          nodeId: 'triggeredB',
          orchestrationRunId: 'run-1',
          status: 'completed',
          returnValue: null,
        });
      }
      return null;
    });

    ctx.enqueueJob.mockClear();
    await engine.onNodeJobComplete(
      'mock-uuid-1',
      { exitCode: 0, events: [], errorKind: null },
      'done',
      'done',
    );

    // taskC should be enqueued
    expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);
    // Verify taskC nodeRun was created
    const taskCCreated = (store.createNodeRun.mock.calls as MockCallTuple[]).some(
      (call: MockCallTuple) => call[0]?.nodeId === 'taskC',
    );
    expect(taskCCreated).toBe(true);
  });

  // ── 5.2 Timeout with onTimeout='fail' and fail_fast ──

  it('5.2 timeout with onTimeout=fail and fail_fast → node failed → run failed', async () => {
    // DAG: triggeredA (root, waitTimeoutSec=5, onTimeout='fail')
    const orchestrator = makeOrchestrator({ errorPolicy: 'fail_fast' });
    const triggeredA = makeNode({
      id: 'triggeredA',
      label: 'Triggered A',
      nodeType: 'triggered',
      triggeredConfig: { waitTimeoutSec: 5, onTimeout: 'fail' },
    });
    const run = makeRun({ id: 'run-1' });

    engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

    store.getFullOrchestrator.mockReturnValue({
      orchestrator,
      nodes: [triggeredA],
      edges: [],
    });
    store.createRun.mockReturnValue(run);

    const waitingNodeRun = makeNodeRun({
      id: 'nr-triggered-a',
      nodeId: 'triggeredA',
      orchestrationRunId: 'run-1',
      status: 'waiting',
    });
    store.createNodeRun.mockReturnValue(waitingNodeRun);

    const failedNodeRun = makeNodeRun({
      id: 'nr-triggered-a',
      nodeId: 'triggeredA',
      orchestrationRunId: 'run-1',
      status: 'failed',
      errorMessage: 'Triggered node timed out after 5s',
    });
    store.getNodeRunById.mockReturnValue(failedNodeRun);

    await engine.startRun('orch-1', 'dashboard', 'user-1');

    // triggeredA should be in waiting state
    expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

    // Advance timers by 5 seconds to trigger timeout
    await vi.advanceTimersByTimeAsync(5000);

    // Node should be updated to failed
    expect(store.updateNodeRun).toHaveBeenCalledWith(
      'nr-triggered-a',
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'Triggered node timed out after 5s',
      }),
    );

    // Run should be finalized as failed (fail_fast)
    expect(store.updateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'failed',
      }),
    );
  });

  // ── 5.3 Timeout with onTimeout='skip' and continue ──

  it('5.3 timeout with onTimeout=skip and continue → node skipped → run completes', async () => {
    // DAG: triggeredA(root, waitTimeoutSec=5, onTimeout='skip') → taskB
    const orchestrator = makeOrchestrator({ errorPolicy: 'continue' });
    const triggeredA = makeNode({
      id: 'triggeredA',
      label: 'Triggered A',
      nodeType: 'triggered',
      triggeredConfig: { waitTimeoutSec: 5, onTimeout: 'skip' },
    });
    const taskB = makeNode({ id: 'taskB', label: 'Task B', nodeType: 'task' });
    const edges = [makeEdge({ id: 'e1', fromNodeId: 'triggeredA', toNodeId: 'taskB' })];
    const run = makeRun({ id: 'run-1' });

    engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

    store.getFullOrchestrator.mockReturnValue({
      orchestrator,
      nodes: [triggeredA, taskB],
      edges,
    });
    store.createRun.mockReturnValue(run);

    const waitingNodeRun = makeNodeRun({
      id: 'nr-triggered-a',
      nodeId: 'triggeredA',
      orchestrationRunId: 'run-1',
      status: 'waiting',
    });
    store.createNodeRun.mockReturnValue(waitingNodeRun);

    // Track updateNodeRun so getNodeRunById reflects the engine's real timeout decision
    let lastUpdate: Record<string, unknown> = {};
    store.updateNodeRun.mockImplementation((_id: string, update: Record<string, unknown>) => {
      lastUpdate = { ...lastUpdate, ...update };
    });
    store.getNodeRunById.mockImplementation((id: string) => {
      if (id === 'nr-triggered-a') {
        return makeNodeRun({
          id: 'nr-triggered-a',
          nodeId: 'triggeredA',
          orchestrationRunId: 'run-1',
          status: (lastUpdate.status as NodeRunStatus | undefined) ?? 'waiting',
        });
      }
      return null;
    });

    await engine.startRun('orch-1', 'dashboard', 'user-1');

    expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

    // Advance timers by 5 seconds to trigger timeout
    await vi.advanceTimersByTimeAsync(5000);

    // handleTimeout decides 'skipped' based on onTimeout='skip' (real decision)
    expect(store.updateNodeRun).toHaveBeenCalledWith(
      'nr-triggered-a',
      expect.objectContaining({
        status: 'skipped',
      }),
    );

    // Run should complete (triggeredA skipped → taskB is skippable as its only source is dead)
    // checkRunCompletion reads the tracked 'skipped' status → anyFailed=false → 'completed'
    expect(store.updateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'completed',
      }),
    );
  });

  // ── 5.4 Triggered node with retry after failure ──

  it('5.4 triggered node failure with maxRetries=1 → retry with new nodeRun', async () => {
    // DAG: triggeredA (root, maxRetries=1, waitTimeoutSec=30)
    const orchestrator = makeOrchestrator({ errorPolicy: 'continue' });
    const triggeredA = makeNode({
      id: 'triggeredA',
      label: 'Triggered A',
      nodeType: 'triggered',
      maxRetries: 1,
      triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
    });
    const run = makeRun({ id: 'run-1' });

    engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

    store.getFullOrchestrator.mockReturnValue({
      orchestrator,
      nodes: [triggeredA],
      edges: [],
    });
    store.createRun.mockReturnValue(run);

    let nodeRunCounter = 0;
    store.createNodeRun.mockImplementation(
      (input: { nodeId: string; status?: string; retryCount?: number }) => {
        nodeRunCounter++;
        return makeNodeRun({
          id: `nr-${nodeRunCounter}`,
          nodeId: input.nodeId,
          orchestrationRunId: 'run-1',
          status: (input.status as NodeRunStatus | undefined) ?? 'running',
          retryCount: input.retryCount ?? 0,
        });
      },
    );

    await engine.startRun('orch-1', 'dashboard', 'user-1');

    // triggeredA enters waiting state
    expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

    // Set up getNodeRunById for the running triggeredA after event
    const runningNodeRun = makeNodeRun({
      id: 'nr-1',
      nodeId: 'triggeredA',
      orchestrationRunId: 'run-1',
      status: 'running',
      jobId: 'mock-uuid-1',
      sessionKey: 'sess-1',
      retryCount: 0,
    });
    store.getNodeRunById.mockReturnValue(runningNodeRun);

    // Fire event → triggeredA runs
    mockEventRouter.fireEvent('run-1', 'triggeredA', { data: 'test' });
    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

    // Simulate job failure (errorKind='timeout')
    store.getNodeRunByJobId.mockReturnValue(runningNodeRun);

    // After the first failure update, getNodeRunById returns the failed nodeRun
    const failedNodeRun = makeNodeRun({
      id: 'nr-1',
      nodeId: 'triggeredA',
      orchestrationRunId: 'run-1',
      status: 'failed',
      errorMessage: 'timeout',
      retryCount: 0,
    });
    store.getNodeRunById.mockReturnValue(failedNodeRun);

    // On retry, createNodeRun is called with retryCount=1 (for triggered nodes, retryTriggeredNodeExecution)
    ctx.enqueueJob.mockClear();
    await engine.onNodeJobComplete(
      'mock-uuid-1',
      { exitCode: 1, events: [], errorKind: 'timeout' },
      '',
      '',
    );

    // retryTriggeredNodeExecution should have been called → createNodeRun with retryCount=1
    const retryCall = (store.createNodeRun.mock.calls as MockCallTuple[]).find(
      (call: MockCallTuple) => call[0]?.nodeId === 'triggeredA' && call[0]?.retryCount === 1,
    );
    expect(retryCall).toBeDefined();
    // A new job should be enqueued for the retry
    expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);
  });

  // ── 5.5 Crash recovery of waiting triggered node ──

  it('5.5 recovery re-registers waiter with remaining time', async () => {
    // Setup: a run with a triggered node in 'waiting' status
    const orchestrator = makeOrchestrator();
    const triggeredA = makeNode({
      id: 'triggeredA',
      label: 'Triggered A',
      nodeType: 'triggered',
      triggeredConfig: { waitTimeoutSec: 60, onTimeout: 'fail' },
    });
    const run = makeRun({ id: 'run-1', startedAt: new Date(Date.now() - 20000).toISOString() });

    engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

    // The waiting nodeRun was started 20 seconds ago, timeout is 60s
    const waitingNodeRun = makeNodeRun({
      id: 'nr-waiting',
      nodeId: 'triggeredA',
      orchestrationRunId: 'run-1',
      status: 'waiting',
      startedAt: new Date(Date.now() - 20000).toISOString(),
    });

    store.getRunningRuns.mockReturnValue([run]);
    store.getFullOrchestrator.mockReturnValue({
      orchestrator,
      nodes: [triggeredA],
      edges: [],
    });
    store.getNodeRunsByRun.mockReturnValue([waitingNodeRun]);

    const recovered = await engine.recoverActiveRuns();

    expect(recovered).toBe(1);
    // registerTriggeredWaiter should be called for recovery
    expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);
    // The waiter should be registered with the run-1:triggeredA key
    expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledWith(
      'sub-triggeredA',
      'run-1:triggeredA',
      expect.objectContaining({
        runId: 'run-1',
        nodeId: 'triggeredA',
      }),
    );
  });

  // ── 5.6 No eventRouter (fail_fast) ──

  it('5.6 no eventRouter + fail_fast → node fails with "Event router is not configured" → run fails', async () => {
    // Do NOT set eventRouter
    const orchestrator = makeOrchestrator({ errorPolicy: 'fail_fast' });
    const triggeredA = makeNode({
      id: 'triggeredA',
      label: 'Triggered A',
      nodeType: 'triggered',
      triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
    });
    const run = makeRun({ id: 'run-1' });

    // For DAG validation to pass, we still need the triggered node subscription check
    // but since there's no eventRouter, buildTriggeredNodeSubscriptionIds returns empty set
    // which means DAG validation will fail with TRIGGERED_NO_SUBSCRIPTION.
    // We need to set eventRouter for DAG validation only, then remove it.
    // Actually, let's set the eventRouter for validation, then the engine code
    // checks ctx.eventRouter at runtime in beginTriggeredNodeWait.
    //
    // Alternative approach: set eventRouter to pass validation, then clear it.
    engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

    store.getFullOrchestrator.mockReturnValue({
      orchestrator,
      nodes: [triggeredA],
      edges: [],
    });
    store.createRun.mockReturnValue(run);

    const failedNodeRun = makeNodeRun({
      id: 'nr-triggered-a',
      nodeId: 'triggeredA',
      orchestrationRunId: 'run-1',
      status: 'failed',
      errorMessage: 'Event router is not configured',
    });
    store.createNodeRun.mockReturnValue(failedNodeRun);

    // Clear eventRouter after getFullOrchestrator is called but before execution.
    // We intercept by clearing it after createRun is called (which happens after DAG validation).
    store.createRun.mockImplementation(() => {
      // Clear the event router so that beginTriggeredNodeWait sees it as undefined
      (ctx as unknown as Record<string, unknown>).eventRouter = undefined;
      return run;
    });

    const runId = await engine.startRun('orch-1', 'dashboard', 'user-1');

    expect(runId).toBe('run-1');
    // Node should be created as failed
    expect(store.createNodeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'triggeredA',
        status: 'failed',
        errorMessage: 'Event router is not configured',
      }),
    );
    // Run should be finalized as failed
    expect(store.updateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'Event router is not configured',
      }),
    );
  });

  // ── 5.7 No eventRouter (continue) ──

  it('5.7 no eventRouter + continue → node fails → run completes', async () => {
    const orchestrator = makeOrchestrator({ errorPolicy: 'continue' });
    const triggeredA = makeNode({
      id: 'triggeredA',
      label: 'Triggered A',
      nodeType: 'triggered',
      triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
    });
    const run = makeRun({ id: 'run-1' });

    engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

    store.getFullOrchestrator.mockReturnValue({
      orchestrator,
      nodes: [triggeredA],
      edges: [],
    });

    // Pass-through mock so checkRunCompletion sees the engine's real decision
    let nodeRunCounter = 0;
    store.createNodeRun.mockImplementation(
      (input: {
        nodeId: string;
        status?: string;
        retryCount?: number;
        errorMessage?: string;
        startedAt?: string;
        endedAt?: string;
      }) => {
        nodeRunCounter++;
        return makeNodeRun({
          id: `nr-5.7-${nodeRunCounter}`,
          nodeId: input.nodeId,
          orchestrationRunId: 'run-1',
          status: (input.status as NodeRunStatus | undefined) ?? 'running',
          retryCount: input.retryCount ?? 0,
          errorMessage: input.errorMessage ?? null,
        });
      },
    );

    store.createRun.mockImplementation(() => {
      (ctx as unknown as Record<string, unknown>).eventRouter = undefined;
      return run;
    });

    await engine.startRun('orch-1', 'dashboard', 'user-1');

    // Node fails but errorPolicy=continue → run should complete (as failed, since anyFailed=true)
    expect(store.createNodeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'triggeredA',
        status: 'failed',
      }),
    );
    // Run finalized — with anyFailed=true it should be 'failed'
    expect(store.updateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'failed',
      }),
    );
  });

  // ── 5.8 No subscription for triggered node ──

  it('5.8 no subscription for triggered node → node fails', async () => {
    const orchestrator = makeOrchestrator({ errorPolicy: 'fail_fast' });
    const triggeredA = makeNode({
      id: 'triggeredA',
      label: 'Triggered A',
      nodeType: 'triggered',
      triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
    });
    const run = makeRun({ id: 'run-1' });

    // Set eventRouter with subscription for triggeredA for DAG validation
    engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

    store.getFullOrchestrator.mockReturnValue({
      orchestrator,
      nodes: [triggeredA],
      edges: [],
    });
    store.createRun.mockReturnValue(run);

    const failedNodeRun = makeNodeRun({
      id: 'nr-triggered-a',
      nodeId: 'triggeredA',
      orchestrationRunId: 'run-1',
      status: 'failed',
      errorMessage: 'Triggered node has no event subscription',
    });
    store.createNodeRun.mockReturnValue(failedNodeRun);

    // After DAG validation passes, make getTriggeredNodeSubscription return null
    // for the actual execution. We intercept at createRun time.
    store.createRun.mockImplementation(() => {
      mockEventRouter.router.getTriggeredNodeSubscription.mockReturnValue(null);
      return run;
    });

    await engine.startRun('orch-1', 'dashboard', 'user-1');

    // Node should fail with subscription error
    expect(store.createNodeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'triggeredA',
        status: 'failed',
        errorMessage: 'Triggered node has no event subscription',
      }),
    );
    // fail_fast → run fails
    expect(store.updateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'Triggered node has no event subscription',
      }),
    );
  });

  // ── 5.9 Event arrives before timeout ──

  it('5.9 event arrives before timeout — timeout does not double-fire', async () => {
    // DAG: triggeredA (root, waitTimeoutSec=60)
    const orchestrator = makeOrchestrator({ errorPolicy: 'continue' });
    const triggeredA = makeNode({
      id: 'triggeredA',
      label: 'Triggered A',
      nodeType: 'triggered',
      triggeredConfig: { waitTimeoutSec: 60, onTimeout: 'fail' },
    });
    const run = makeRun({ id: 'run-1' });

    engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

    store.getFullOrchestrator.mockReturnValue({
      orchestrator,
      nodes: [triggeredA],
      edges: [],
    });
    store.createRun.mockReturnValue(run);

    const waitingNodeRun = makeNodeRun({
      id: 'nr-triggered-a',
      nodeId: 'triggeredA',
      orchestrationRunId: 'run-1',
      status: 'waiting',
    });
    store.createNodeRun.mockReturnValue(waitingNodeRun);

    const runningNodeRun = makeNodeRun({
      id: 'nr-triggered-a',
      nodeId: 'triggeredA',
      orchestrationRunId: 'run-1',
      status: 'running',
      jobId: 'mock-uuid-1',
      sessionKey: 'sess-1',
    });
    store.getNodeRunById.mockReturnValue(runningNodeRun);

    await engine.startRun('orch-1', 'dashboard', 'user-1');
    expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

    // Advance time by 10s (not enough for timeout)
    await vi.advanceTimersByTimeAsync(10_000);

    // Fire event
    mockEventRouter.fireEvent('run-1', 'triggeredA', { arrived: true });
    await vi.advanceTimersByTimeAsync(0);

    // Job should be enqueued (resumeTriggeredNode)
    expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

    // Record how many updateNodeRun calls exist now
    const updateCallsBefore = store.updateNodeRun.mock.calls.length;

    // Advance past the original timeout (50s more, total 60s from start)
    await vi.advanceTimersByTimeAsync(50_000);

    // The timeout handler should not fire again (fired flag prevents it)
    // No additional updateNodeRun calls with status='failed' for timeout
    const timeoutFailCalls = (store.updateNodeRun.mock.calls as UpdateNodeRunCallTuple[])
      .slice(updateCallsBefore)
      .filter(
        (call: UpdateNodeRunCallTuple) =>
          call[1]?.status === 'failed' &&
          (call[1]?.errorMessage as string | undefined)?.includes('timed out'),
      );
    expect(timeoutFailCalls).toHaveLength(0);
  });

  // ── 5.10 Triggered node with downstream gate ──

  it('5.10 triggered node → downstream tasks → gate(AND, "ok") → final task', async () => {
    // DAG: triggeredA → taskB → gate(AND,"ok") → taskC
    //      triggeredA → taskD → gate
    const orchestrator = makeOrchestrator({ errorPolicy: 'continue' });
    const triggeredA = makeNode({
      id: 'triggeredA',
      label: 'Triggered A',
      nodeType: 'triggered',
      triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
    });
    const taskB = makeNode({ id: 'taskB', label: 'Task B', nodeType: 'task' });
    const taskD = makeNode({ id: 'taskD', label: 'Task D', nodeType: 'task' });
    const gateNode = makeNode({
      id: 'gate-1',
      label: 'Gate',
      nodeType: 'gate',
      tool: null,
      prompt: null,
      gateCondition: { mode: 'and', matchValue: 'ok' },
    });
    const taskC = makeNode({ id: 'taskC', label: 'Task C', nodeType: 'task' });
    const edges = [
      makeEdge({ id: 'e1', fromNodeId: 'triggeredA', toNodeId: 'taskB' }),
      makeEdge({ id: 'e2', fromNodeId: 'triggeredA', toNodeId: 'taskD' }),
      makeEdge({ id: 'e3', fromNodeId: 'taskB', toNodeId: 'gate-1' }),
      makeEdge({ id: 'e4', fromNodeId: 'taskD', toNodeId: 'gate-1' }),
      makeEdge({ id: 'e5', fromNodeId: 'gate-1', toNodeId: 'taskC' }),
    ];
    const run = makeRun({ id: 'run-1' });

    engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

    store.getFullOrchestrator.mockReturnValue({
      orchestrator,
      nodes: [triggeredA, taskB, taskD, gateNode, taskC],
      edges,
    });
    store.createRun.mockReturnValue(run);

    let nodeRunCounter = 0;
    store.createNodeRun.mockImplementation(
      (input: { nodeId: string; status?: string; retryCount?: number; returnValue?: string }) => {
        nodeRunCounter++;
        return makeNodeRun({
          id: `nr-${nodeRunCounter}`,
          nodeId: input.nodeId,
          orchestrationRunId: 'run-1',
          status: (input.status as NodeRunStatus | undefined) ?? 'running',
          retryCount: input.retryCount ?? 0,
          returnValue: input.returnValue ?? null,
        });
      },
    );

    await engine.startRun('orch-1', 'dashboard', 'user-1');

    // triggeredA enters waiting
    expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

    // Set up for resumeTriggeredNode
    const runningTriggeredA = makeNodeRun({
      id: 'nr-1',
      nodeId: 'triggeredA',
      orchestrationRunId: 'run-1',
      status: 'running',
      jobId: 'mock-uuid-1',
      sessionKey: 'sess-1',
    });
    store.getNodeRunById.mockReturnValue(runningTriggeredA);

    // Fire event
    mockEventRouter.fireEvent('run-1', 'triggeredA', { action: 'deploy' });
    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

    // Complete triggeredA with "ok" → taskB and taskD should be enqueued
    store.getNodeRunByJobId.mockReturnValue(runningTriggeredA);
    store.getNodeRunById.mockReturnValue(
      makeNodeRun({
        id: 'nr-1',
        nodeId: 'triggeredA',
        orchestrationRunId: 'run-1',
        status: 'completed',
        returnValue: 'ok',
      }),
    );

    ctx.enqueueJob.mockClear();
    mocked.randomUUID.mockReturnValueOnce('uuid-taskB').mockReturnValueOnce('uuid-taskD');
    await engine.onNodeJobComplete(
      'mock-uuid-1',
      { exitCode: 0, events: [], errorKind: null },
      'ok',
      '<return>ok</return>',
    );

    // taskB and taskD should both be enqueued
    expect(ctx.enqueueJob).toHaveBeenCalledTimes(2);

    // Complete taskB with "ok"
    const taskBRun = makeNodeRun({
      id: `nr-${nodeRunCounter - 1}`,
      nodeId: 'taskB',
      orchestrationRunId: 'run-1',
      status: 'running',
      jobId: 'uuid-taskB',
      sessionKey: 'sess-1',
    });
    store.getNodeRunByJobId.mockReturnValue(taskBRun);
    store.getNodeRunById.mockReturnValue(
      makeNodeRun({
        ...taskBRun,
        status: 'completed',
        returnValue: 'ok',
      }),
    );

    ctx.enqueueJob.mockClear();
    await engine.onNodeJobComplete(
      'uuid-taskB',
      { exitCode: 0, events: [], errorKind: null },
      'ok',
      '<return>ok</return>',
    );

    // Gate not ready yet — taskD still running
    // taskC should NOT be enqueued yet
    expect(ctx.enqueueJob).toHaveBeenCalledTimes(0);

    // Complete taskD with "ok"
    const taskDRun = makeNodeRun({
      id: `nr-${nodeRunCounter}`,
      nodeId: 'taskD',
      orchestrationRunId: 'run-1',
      status: 'running',
      jobId: 'uuid-taskD',
      sessionKey: 'sess-1',
    });
    store.getNodeRunByJobId.mockReturnValue(taskDRun);
    store.getNodeRunById.mockReturnValue(
      makeNodeRun({
        ...taskDRun,
        status: 'completed',
        returnValue: 'ok',
      }),
    );

    ctx.enqueueJob.mockClear();
    await engine.onNodeJobComplete(
      'uuid-taskD',
      { exitCode: 0, events: [], errorKind: null },
      'ok',
      '<return>ok</return>',
    );

    // Gate should evaluate (AND: both "ok") → pass → taskC should be enqueued
    expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);
    const taskCCreated = (store.createNodeRun.mock.calls as MockCallTuple[]).some(
      (call: MockCallTuple) => call[0]?.nodeId === 'taskC',
    );
    expect(taskCCreated).toBe(true);
  });

  // ── 5.11 Triggered node prepareWorkdir failure ──

  it('5.11 prepareWorkdir throws → node fails, session cleaned up', async () => {
    const orchestrator = makeOrchestrator({ errorPolicy: 'continue' });
    const triggeredA = makeNode({
      id: 'triggeredA',
      label: 'Triggered A',
      nodeType: 'triggered',
      triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
    });
    const run = makeRun({ id: 'run-1' });

    engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

    store.getFullOrchestrator.mockReturnValue({
      orchestrator,
      nodes: [triggeredA],
      edges: [],
    });
    store.createRun.mockReturnValue(run);

    const waitingNodeRun = makeNodeRun({
      id: 'nr-triggered-a',
      nodeId: 'triggeredA',
      orchestrationRunId: 'run-1',
      status: 'waiting',
    });
    store.createNodeRun.mockReturnValue(waitingNodeRun);

    // After event fires and resumeTriggeredNode runs, prepareWorkdir throws
    ctx.prepareWorkdir.mockImplementation(() => {
      throw new Error('disk full');
    });

    const failedNodeRun = makeNodeRun({
      id: 'nr-triggered-a',
      nodeId: 'triggeredA',
      orchestrationRunId: 'run-1',
      status: 'failed',
      errorMessage: 'Workdir preparation failed: disk full',
    });
    store.getNodeRunById.mockReturnValue(failedNodeRun);

    await engine.startRun('orch-1', 'dashboard', 'user-1');

    // Fire event
    mockEventRouter.fireEvent('run-1', 'triggeredA', { data: 'test' });
    await vi.advanceTimersByTimeAsync(0);

    // Node should be updated to failed with workdir error
    expect(store.updateNodeRun).toHaveBeenCalledWith(
      'nr-triggered-a',
      expect.objectContaining({
        status: 'failed',
        errorMessage: expect.stringContaining('Workdir preparation failed'),
      }),
    );

    // Session should be cleaned up
    expect(ctx.cleanupSession).toHaveBeenCalledWith('sess-1');
  });

  // ── 5.12 Triggered node enqueue failure after event ──

  it('5.12 enqueueJob fails → node marked as failed, session cleaned up', async () => {
    const orchestrator = makeOrchestrator({ errorPolicy: 'continue' });
    const triggeredA = makeNode({
      id: 'triggeredA',
      label: 'Triggered A',
      nodeType: 'triggered',
      triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
    });
    const run = makeRun({ id: 'run-1' });

    engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

    store.getFullOrchestrator.mockReturnValue({
      orchestrator,
      nodes: [triggeredA],
      edges: [],
    });
    store.createRun.mockReturnValue(run);

    const waitingNodeRun = makeNodeRun({
      id: 'nr-triggered-a',
      nodeId: 'triggeredA',
      orchestrationRunId: 'run-1',
      status: 'waiting',
    });
    store.createNodeRun.mockReturnValue(waitingNodeRun);

    // After the event fires, enqueueJob returns an error
    ctx.enqueueJob.mockReturnValue({ error: 'queue full' });

    const failedNodeRun = makeNodeRun({
      id: 'nr-triggered-a',
      nodeId: 'triggeredA',
      orchestrationRunId: 'run-1',
      status: 'failed',
      errorMessage: 'Enqueue failed: queue full',
    });
    store.getNodeRunById.mockReturnValue(failedNodeRun);

    await engine.startRun('orch-1', 'dashboard', 'user-1');

    // Fire event
    mockEventRouter.fireEvent('run-1', 'triggeredA', { data: 'test' });
    await vi.advanceTimersByTimeAsync(0);

    // Node should be updated to failed with enqueue error
    expect(store.updateNodeRun).toHaveBeenCalledWith(
      'nr-triggered-a',
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'Enqueue failed: queue full',
      }),
    );

    // Session should be cleaned up
    expect(ctx.cleanupSession).toHaveBeenCalledWith('sess-1');
  });

  // ── 5.13 Multiple triggered nodes in parallel ──

  it('5.13 multiple triggered root nodes → both wait → both receive events → both execute', async () => {
    // DAG: triggeredA (root), triggeredB (root) — no edges between them
    const orchestrator = makeOrchestrator({ errorPolicy: 'continue' });
    const triggeredA = makeNode({
      id: 'triggeredA',
      label: 'Triggered A',
      nodeType: 'triggered',
      triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
    });
    const triggeredB = makeNode({
      id: 'triggeredB',
      label: 'Triggered B',
      nodeType: 'triggered',
      triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
    });
    const run = makeRun({ id: 'run-1' });

    engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

    store.getFullOrchestrator.mockReturnValue({
      orchestrator,
      nodes: [triggeredA, triggeredB],
      edges: [],
    });
    store.createRun.mockReturnValue(run);

    let nodeRunCounter = 0;
    store.createNodeRun.mockImplementation(
      (input: { nodeId: string; status?: string; retryCount?: number }) => {
        nodeRunCounter++;
        return makeNodeRun({
          id: `nr-${nodeRunCounter}`,
          nodeId: input.nodeId,
          orchestrationRunId: 'run-1',
          status: (input.status as NodeRunStatus | undefined) ?? 'running',
          retryCount: input.retryCount ?? 0,
        });
      },
    );

    await engine.startRun('orch-1', 'dashboard', 'user-1');

    // Both triggered nodes should enter waiting state
    expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(2);
    expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledWith(
      'sub-triggeredA',
      'run-1:triggeredA',
      expect.objectContaining({ nodeId: 'triggeredA' }),
    );
    expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledWith(
      'sub-triggeredB',
      'run-1:triggeredB',
      expect.objectContaining({ nodeId: 'triggeredB' }),
    );

    // Set up getNodeRunById to return running node runs after events fire
    store.getNodeRunById.mockImplementation((id: string) => {
      if (id === 'nr-1') {
        return makeNodeRun({
          id: 'nr-1',
          nodeId: 'triggeredA',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'mock-uuid-1',
          sessionKey: 'sess-1',
        });
      }
      if (id === 'nr-2') {
        return makeNodeRun({
          id: 'nr-2',
          nodeId: 'triggeredB',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'mock-uuid-1',
          sessionKey: 'sess-1',
        });
      }
      return null;
    });

    // Fire events for both
    mockEventRouter.fireEvent('run-1', 'triggeredA', { source: 'A' });
    mockEventRouter.fireEvent('run-1', 'triggeredB', { source: 'B' });
    await vi.advanceTimersByTimeAsync(0);

    // Both nodes should have jobs enqueued
    // Initial startRun doesn't enqueue jobs (triggered nodes go to waiting)
    // After events fire, resumeTriggeredNode enqueues jobs
    expect(ctx.enqueueJob).toHaveBeenCalledTimes(2);
    expect(ctx.createSession).toHaveBeenCalledTimes(2);
  });

  // ── Triggered node edge cases ─────────────────────────────

  describe('triggered node edge cases', () => {
    // ── Edge-1: resolveRunnableNodes skips waiting triggered node without pending payload ──

    it('waiting triggered node without pending payload stays waiting — no job enqueued', async () => {
      // DAG: triggeredA (root, waitTimeoutSec=30, onTimeout='fail')
      const orchestrator = makeOrchestrator();
      const triggeredA = makeNode({
        id: 'triggeredA',
        label: 'Triggered A',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const run = makeRun({ id: 'run-1' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [triggeredA],
        edges: [],
      });
      store.createRun.mockReturnValue(run);

      const waitingNodeRun = makeNodeRun({
        id: 'nr-triggered-a',
        nodeId: 'triggeredA',
        orchestrationRunId: 'run-1',
        status: 'waiting',
      });
      store.createNodeRun.mockReturnValue(waitingNodeRun);

      await engine.startRun('orch-1', 'dashboard', 'user-1');

      // triggeredA should be in waiting state — registerTriggeredWaiter called
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

      // No job should be enqueued — triggered nodes don't enqueue on initial wait
      expect(ctx.enqueueJob).not.toHaveBeenCalled();

      // Advance time partially (not enough for timeout) to let any pending microtasks settle
      await vi.advanceTimersByTimeAsync(5000);

      // Still no job enqueued — node remains waiting without an event
      expect(ctx.enqueueJob).not.toHaveBeenCalled();

      // Verify the node run was created with 'waiting' status
      expect(store.createNodeRun).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeId: 'triggeredA',
          status: 'waiting',
        }),
      );

      // The run should NOT be finalized — the waiting node keeps it alive
      expect(store.updateRun).not.toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
      expect(store.updateRun).not.toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'failed' }),
      );
    });

    // ── Edge-2: checkRunCompletion treats waiting triggered node as not done ──

    it('run does not finalize while triggered node is still waiting — finalizes after event completion', async () => {
      // DAG: taskA(root), triggeredB(root, waitTimeoutSec=60, onTimeout='fail')
      const orchestrator = makeOrchestrator({ maxParallelism: 3 });
      const taskA = makeNode({ id: 'taskA', label: 'Task A', nodeType: 'task' });
      const triggeredB = makeNode({
        id: 'triggeredB',
        label: 'Triggered B',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 60, onTimeout: 'fail' },
      });
      const run = makeRun({ id: 'run-1' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [taskA, triggeredB],
        edges: [],
      });
      store.createRun.mockReturnValue(run);

      let nodeRunCounter = 0;
      store.createNodeRun.mockImplementation(
        (input: { nodeId: string; status?: string; retryCount?: number }) => {
          nodeRunCounter++;
          return makeNodeRun({
            id: `nr-${nodeRunCounter}`,
            nodeId: input.nodeId,
            orchestrationRunId: 'run-1',
            status: (input.status as NodeRunStatus | undefined) ?? 'running',
            retryCount: input.retryCount ?? 0,
          });
        },
      );

      await engine.startRun('orch-1', 'dashboard', 'user-1');

      // taskA should be enqueued, triggeredB should be waiting
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

      // Complete taskA
      const taskANodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'taskA',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunByJobId.mockReturnValue(taskANodeRun);
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id === 'nr-1') {
          return makeNodeRun({
            id: 'nr-1',
            nodeId: 'taskA',
            orchestrationRunId: 'run-1',
            status: 'completed',
            returnValue: null,
            jobId: 'mock-uuid-1',
            sessionKey: 'sess-1',
          });
        }
        return null;
      });

      await engine.onNodeJobComplete(
        'mock-uuid-1',
        { exitCode: 0, events: [], errorKind: null },
        'done',
        'done',
      );

      // Run should NOT be finalized — triggeredB is still waiting
      const finalizeCallsAfterTaskA = (
        store.updateRun.mock.calls as UpdateNodeRunCallTuple[]
      ).filter(
        (call: UpdateNodeRunCallTuple) =>
          call[1]?.status === 'completed' || call[1]?.status === 'failed',
      );
      expect(finalizeCallsAfterTaskA).toHaveLength(0);

      // Now fire event for triggeredB
      const triggeredBRunningNodeRun = makeNodeRun({
        id: 'nr-2',
        nodeId: 'triggeredB',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id === 'nr-1') {
          return makeNodeRun({
            id: 'nr-1',
            nodeId: 'taskA',
            orchestrationRunId: 'run-1',
            status: 'completed',
            returnValue: null,
          });
        }
        if (id === 'nr-2') return triggeredBRunningNodeRun;
        return null;
      });

      ctx.enqueueJob.mockClear();
      mockEventRouter.fireEvent('run-1', 'triggeredB', { data: 'triggered' });
      await vi.advanceTimersByTimeAsync(0);

      // triggeredB job should be enqueued
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Complete triggeredB
      store.getNodeRunByJobId.mockReturnValue(triggeredBRunningNodeRun);
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id === 'nr-1') {
          return makeNodeRun({
            id: 'nr-1',
            nodeId: 'taskA',
            orchestrationRunId: 'run-1',
            status: 'completed',
          });
        }
        if (id === 'nr-2') {
          return makeNodeRun({
            id: 'nr-2',
            nodeId: 'triggeredB',
            orchestrationRunId: 'run-1',
            status: 'completed',
            returnValue: null,
          });
        }
        return null;
      });

      await engine.onNodeJobComplete(
        'mock-uuid-1',
        { exitCode: 0, events: [], errorKind: null },
        'done',
        'done',
      );

      // Now the run should be finalized as completed
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    // ── Edge-3: Mixed node types at same DAG level (task + triggered + task) ──

    it('mixed task + triggered nodes at same level — all execute correctly with dependencies', async () => {
      // DAG:
      //   root(task) → A(task), root → B(triggered, waitTimeoutSec=30), root → C(task)
      //   A → D(task), B → D, C → D
      const orchestrator = makeOrchestrator({ maxParallelism: 5 });
      const root = makeNode({ id: 'root', label: 'Root', nodeType: 'task' });
      const nodeA = makeNode({ id: 'nodeA', label: 'A', nodeType: 'task' });
      const nodeB = makeNode({
        id: 'nodeB',
        label: 'B',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const nodeC = makeNode({ id: 'nodeC', label: 'C', nodeType: 'task' });
      const nodeD = makeNode({ id: 'nodeD', label: 'D', nodeType: 'task' });
      const edges = [
        makeEdge({ id: 'e1', fromNodeId: 'root', toNodeId: 'nodeA' }),
        makeEdge({ id: 'e2', fromNodeId: 'root', toNodeId: 'nodeB' }),
        makeEdge({ id: 'e3', fromNodeId: 'root', toNodeId: 'nodeC' }),
        makeEdge({ id: 'e4', fromNodeId: 'nodeA', toNodeId: 'nodeD' }),
        makeEdge({ id: 'e5', fromNodeId: 'nodeB', toNodeId: 'nodeD' }),
        makeEdge({ id: 'e6', fromNodeId: 'nodeC', toNodeId: 'nodeD' }),
      ];
      const run = makeRun({ id: 'run-1' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [root, nodeA, nodeB, nodeC, nodeD],
        edges,
      });
      store.createRun.mockReturnValue(run);

      let nodeRunCounter = 0;
      store.createNodeRun.mockImplementation(
        (input: { nodeId: string; status?: string; retryCount?: number; returnValue?: string }) => {
          nodeRunCounter++;
          return makeNodeRun({
            id: `nr-${nodeRunCounter}`,
            nodeId: input.nodeId,
            orchestrationRunId: 'run-1',
            status: (input.status as NodeRunStatus | undefined) ?? 'running',
            retryCount: input.retryCount ?? 0,
            returnValue: input.returnValue ?? null,
          });
        },
      );

      // startRun → root is enqueued
      await engine.startRun('orch-1', 'dashboard', 'user-1');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Complete root → A, B (waiting), C should all become ready
      const rootNodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'root',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunByJobId.mockReturnValue(rootNodeRun);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'root',
          orchestrationRunId: 'run-1',
          status: 'completed',
          returnValue: null,
        }),
      );

      ctx.enqueueJob.mockClear();
      mocked.randomUUID.mockReturnValueOnce('uuid-A').mockReturnValueOnce('uuid-C');
      await engine.onNodeJobComplete(
        'mock-uuid-1',
        { exitCode: 0, events: [], errorKind: null },
        'done',
        'done',
      );

      // A and C should be enqueued (task nodes), B enters waiting (triggered)
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(2);
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

      // Complete A
      const nodeARunId = store.createNodeRun.mock.results.find(
        (_r: unknown, i: number) =>
          (store.createNodeRun.mock.calls[i]?.[0] as MockNodeRunInput | undefined)?.nodeId ===
          'nodeA',
      )?.value?.id;
      const nodeARun = makeNodeRun({
        id: nodeARunId ?? '',
        nodeId: 'nodeA',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'uuid-A',
        sessionKey: 'sess-1',
      });
      store.getNodeRunByJobId.mockReturnValue(nodeARun);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          ...nodeARun,
          status: 'completed',
          returnValue: null,
        }),
      );

      ctx.enqueueJob.mockClear();
      await engine.onNodeJobComplete(
        'uuid-A',
        { exitCode: 0, events: [], errorKind: null },
        'done',
        'done',
      );

      // D should NOT be ready yet — B waiting, C still running
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(0);

      // Fire event for B → B runs
      const nodeBWaitingId = store.createNodeRun.mock.results.find(
        (_r: unknown, i: number) =>
          (store.createNodeRun.mock.calls[i]?.[0] as MockNodeRunInput | undefined)?.nodeId ===
          'nodeB',
      )?.value?.id;
      const nodeBRunning = makeNodeRun({
        id: nodeBWaitingId ?? '',
        nodeId: 'nodeB',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunById.mockReturnValue(nodeBRunning);

      ctx.enqueueJob.mockClear();
      mocked.randomUUID.mockReturnValueOnce('uuid-B');
      mockEventRouter.fireEvent('run-1', 'nodeB', { event: 'fired' });
      await vi.advanceTimersByTimeAsync(0);

      // B's job should be enqueued
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Complete B
      store.getNodeRunByJobId.mockReturnValue(nodeBRunning);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          ...nodeBRunning,
          status: 'completed',
          returnValue: null,
        }),
      );

      ctx.enqueueJob.mockClear();
      await engine.onNodeJobComplete(
        'uuid-B',
        { exitCode: 0, events: [], errorKind: null },
        'done',
        'done',
      );

      // D still not ready — C still running
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(0);

      // Complete C
      const nodeCRunId = store.createNodeRun.mock.results.find(
        (_r: unknown, i: number) =>
          (store.createNodeRun.mock.calls[i]?.[0] as MockNodeRunInput | undefined)?.nodeId ===
          'nodeC',
      )?.value?.id;
      const nodeCRun = makeNodeRun({
        id: nodeCRunId ?? '',
        nodeId: 'nodeC',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'uuid-C',
        sessionKey: 'sess-1',
      });
      store.getNodeRunByJobId.mockReturnValue(nodeCRun);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          ...nodeCRun,
          status: 'completed',
          returnValue: null,
        }),
      );

      ctx.enqueueJob.mockClear();
      await engine.onNodeJobComplete(
        'uuid-C',
        { exitCode: 0, events: [], errorKind: null },
        'done',
        'done',
      );

      // Now D should be ready — all 3 sources (A, B, C) completed
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);
      const nodeDCreated = (store.createNodeRun.mock.calls as MockCallTuple[]).some(
        (call: MockCallTuple) => call[0]?.nodeId === 'nodeD',
      );
      expect(nodeDCreated).toBe(true);
    });

    // ── Edge-4: fail_fast with running task + waiting triggered node ──

    it('fail_fast — running task fails while triggered node is waiting → run finalized, triggered cleanup', async () => {
      // DAG: taskA(root), triggeredB(root, waitTimeoutSec=60, onTimeout='fail')
      const orchestrator = makeOrchestrator({
        maxParallelism: 3,
        errorPolicy: 'fail_fast',
      });
      const taskA = makeNode({ id: 'taskA', label: 'Task A', nodeType: 'task' });
      const triggeredB = makeNode({
        id: 'triggeredB',
        label: 'Triggered B',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 60, onTimeout: 'fail' },
      });
      const run = makeRun({ id: 'run-1' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [taskA, triggeredB],
        edges: [],
      });
      store.createRun.mockReturnValue(run);

      let nodeRunCounter = 0;
      store.createNodeRun.mockImplementation(
        (input: { nodeId: string; status?: string; retryCount?: number }) => {
          nodeRunCounter++;
          return makeNodeRun({
            id: `nr-${nodeRunCounter}`,
            nodeId: input.nodeId,
            orchestrationRunId: 'run-1',
            status: (input.status as NodeRunStatus | undefined) ?? 'running',
            retryCount: input.retryCount ?? 0,
            sessionKey: input.nodeId === 'taskA' ? 'sess-taskA' : null,
          });
        },
      );

      await engine.startRun('orch-1', 'dashboard', 'user-1');

      // taskA should be enqueued, triggeredB should be waiting
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

      // Capture the unsubscribe function that was returned by registerTriggeredWaiter
      const unsubscribeFn = mockEventRouter.router.registerTriggeredWaiter.mock.results[0]?.value;
      expect(unsubscribeFn).toBeDefined();

      // Fail taskA with errorKind='timeout'
      const taskANodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'taskA',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-taskA',
        retryCount: 0,
      });
      store.getNodeRunByJobId.mockReturnValue(taskANodeRun);

      const failedTaskARun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'taskA',
        orchestrationRunId: 'run-1',
        status: 'failed',
        errorMessage: 'timeout',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-taskA',
      });
      store.getNodeRunById.mockReturnValue(failedTaskARun);

      await engine.onNodeJobComplete(
        'mock-uuid-1',
        { exitCode: 1, events: [], errorKind: 'timeout' },
        '',
        '',
      );

      // fail_fast → run should be finalized as failed
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'failed' }),
      );

      // The triggered node's unsubscribe function should have been called during finalizeRun
      // (finalizeRun iterates waitingTriggeredNodes and calls unsubscribe for each)
      expect(unsubscribeFn).toHaveBeenCalled();

      // Verify no further timeout fires after finalization
      store.updateRun.mockClear();
      await vi.advanceTimersByTimeAsync(60_000);

      // No additional updateRun calls for the triggered node timeout
      const timeoutFinalizeCalls = (store.updateRun.mock.calls as UpdateNodeRunCallTuple[]).filter(
        (call: UpdateNodeRunCallTuple) => call[1]?.status === 'failed',
      );
      expect(timeoutFinalizeCalls).toHaveLength(0);
    });
  });

  // ── Triggered node remaining branches (direct function calls) ──

  describe('triggered node remaining branches', () => {
    function makeActiveRun(
      nodes: OrchestratorNode[],
      edges: OrchestratorEdge[],
      overrides?: Partial<ActiveOrchestrationRun>,
    ): ActiveOrchestrationRun {
      return {
        runId: 'run-1',
        orchestrator: makeOrchestrator(),
        dag: buildValidatedDAG(nodes, edges),
        nodeRuns: new Map<string, OrchestrationNodeRun>(),
        runningCount: 0,
        startedAt: Date.now(),
        triggerContext: null,
        waitingTriggeredNodes: new Map(),
        pendingTriggeredPayloads: new Map(),
        ...overrides,
      };
    }

    // ── Gap B.1: cleanupSynchronousNodeSession calls cleanupRunWorkdir when workdirs are null ──

    it('B.1 cleanupSynchronousNodeSession calls cleanupRunWorkdir when node.workdir and orchestrator.workdir are null', async () => {
      const { ctx, store } = createContext();
      const cleanupRunWorkdir = vi.fn();
      (ctx as unknown as Record<string, unknown>).cleanupRunWorkdir = cleanupRunWorkdir;

      const node = makeNode({ id: 'task-b1', workdir: null });
      const failedNodeRun = makeNodeRun({
        id: 'nr-b1',
        nodeId: 'task-b1',
        status: 'failed',
        errorMessage: 'Workdir preparation failed: boom',
      });
      store.createNodeRun.mockReturnValue(
        makeNodeRun({ id: 'nr-b1', nodeId: 'task-b1', status: 'running' }),
      );
      store.getNodeRunById.mockReturnValue(failedNodeRun);
      ctx.prepareWorkdir.mockImplementation(() => {
        throw new Error('boom');
      });

      const active = makeActiveRun([node], [], {
        orchestrator: makeOrchestrator({ workdir: null }),
      });

      const result = await executeTaskNode(ctx, active, node);
      expect(result).toBe(true);
      expect(ctx.cleanupSession).toHaveBeenCalledWith('sess-1');
      expect(cleanupRunWorkdir).toHaveBeenCalledWith('run-1');
    });

    // ── Gap B.2: cleanupSynchronousNodeSession handles cleanupRunWorkdir error ──

    it('B.2 cleanupSynchronousNodeSession swallows cleanupRunWorkdir error', async () => {
      const { ctx, store } = createContext();
      const cleanupRunWorkdir = vi.fn(() => {
        throw new Error('cleanup also fails');
      });
      (ctx as unknown as Record<string, unknown>).cleanupRunWorkdir = cleanupRunWorkdir;

      const node = makeNode({ id: 'task-b2', workdir: null });
      const failedNodeRun = makeNodeRun({
        id: 'nr-b2',
        nodeId: 'task-b2',
        status: 'failed',
      });
      store.createNodeRun.mockReturnValue(
        makeNodeRun({ id: 'nr-b2', nodeId: 'task-b2', status: 'running' }),
      );
      store.getNodeRunById.mockReturnValue(failedNodeRun);
      ctx.prepareWorkdir.mockImplementation(() => {
        throw new Error('prepare fails');
      });

      const active = makeActiveRun([node], [], {
        orchestrator: makeOrchestrator({ workdir: null }),
      });

      // Should not throw even though cleanupRunWorkdir throws
      const result = await executeTaskNode(ctx, active, node);
      expect(result).toBe(true);
      expect(cleanupRunWorkdir).toHaveBeenCalledWith('run-1');
    });

    // ── Gap C: resumeTriggeredNode returns false for node without tool ──

    it('C resumeTriggeredNode returns false for node without tool — no session or job created', async () => {
      const { ctx, store } = createContext();
      const advanceExecution = vi.fn(async () => {});
      const finalizeRun = vi.fn();

      const triggeredNode = makeNode({
        id: 'triggered-c',
        nodeType: 'triggered',
        tool: null,
        prompt: null,
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const waitingNodeRun = makeNodeRun({
        id: 'nr-c',
        nodeId: 'triggered-c',
        status: 'waiting',
      });

      const active = makeActiveRun([triggeredNode], [], {
        nodeRuns: new Map([['triggered-c', waitingNodeRun]]),
      });
      active.pendingTriggeredPayloads.set('triggered-c', { event: 'test' });

      const result = await executeTriggeredNode(
        ctx,
        active,
        triggeredNode,
        advanceExecution,
        finalizeRun,
      );
      expect(result).toBe(false);
      expect(ctx.createSession).not.toHaveBeenCalled();
      expect(ctx.enqueueJob).not.toHaveBeenCalled();
      expect(store.createNodeRun).not.toHaveBeenCalled();
    });

    // ── Gap D: retryTriggeredNodeExecution returns early for node without tool ──

    it('D retryTriggeredNodeExecution returns early for node without tool — no retry nodeRun created', async () => {
      const { ctx, store } = createContext();
      const advanceExecution = vi.fn(async () => {});
      const finalizeRun = vi.fn();

      const triggeredNode = makeNode({
        id: 'triggered-d',
        nodeType: 'triggered',
        tool: null,
        prompt: null,
        maxRetries: 1,
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const failedNodeRun = makeNodeRun({
        id: 'nr-d',
        nodeId: 'triggered-d',
        status: 'running',
        retryCount: 0,
        jobId: 'job-d',
        sessionKey: 'sess-d',
      });

      const active = makeActiveRun([triggeredNode], [], {
        nodeRuns: new Map([['triggered-d', failedNodeRun]]),
        runningCount: 1,
      });

      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-d',
          nodeId: 'triggered-d',
          status: 'failed',
          errorMessage: 'timeout',
          retryCount: 0,
        }),
      );

      // Call handleNodeJobComplete which triggers retryNode → retryTriggeredNodeExecution
      await handleNodeJobComplete(
        ctx,
        active,
        failedNodeRun,
        { exitCode: 1, errorKind: 'timeout', events: [] },
        '',
        advanceExecution,
        finalizeRun,
      );

      // retryTriggeredNodeExecution should bail due to !tool → no new createNodeRun for retryCount=1
      const retryCall = (store.createNodeRun.mock.calls as MockCallTuple[]).find(
        (call: MockCallTuple) => call[0]?.nodeId === 'triggered-d' && call[0]?.retryCount === 1,
      );
      expect(retryCall).toBeUndefined();
      // advanceExecution should NOT have been called (retry path returns without advancing)
      expect(advanceExecution).not.toHaveBeenCalled();
    });

    // ── Gap E: retryTriggeredNodeExecution prepareWorkdir failure ──

    it('E retryTriggeredNodeExecution marks node as failed when prepareWorkdir throws', async () => {
      const { ctx, store } = createContext();
      const advanceExecution = vi.fn(async () => {});
      const finalizeRun = vi.fn();

      const triggeredNode = makeNode({
        id: 'triggered-e',
        nodeType: 'triggered',
        tool: 'claude',
        prompt: 'Do something',
        maxRetries: 1,
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const failedNodeRun = makeNodeRun({
        id: 'nr-e',
        nodeId: 'triggered-e',
        status: 'running',
        retryCount: 0,
        jobId: 'job-e',
        sessionKey: 'sess-e',
      });

      const active = makeActiveRun([triggeredNode], [], {
        orchestrator: makeOrchestrator({ workdir: '/tmp/orch-e' }),
        nodeRuns: new Map([['triggered-e', failedNodeRun]]),
        runningCount: 1,
      });
      active.pendingTriggeredPayloads.set('triggered-e', { data: 'test' });

      // First handleNodeJobComplete call will see errorKind and trigger retry
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-e',
          nodeId: 'triggered-e',
          status: 'failed',
          errorMessage: 'timeout',
          retryCount: 0,
        }),
      );

      // On retry, createNodeRun returns the new retry nodeRun
      const retryNodeRun = makeNodeRun({
        id: 'nr-e-retry',
        nodeId: 'triggered-e',
        status: 'running',
        retryCount: 1,
      });
      store.createNodeRun.mockReturnValue(retryNodeRun);

      // prepareWorkdir throws during retry
      let prepareCallCount = 0;
      ctx.prepareWorkdir.mockImplementation(() => {
        prepareCallCount++;
        throw new Error('disk full on retry');
      });

      // After retry failure, getNodeRunById returns the retry nodeRun as failed
      const retryFailedNodeRun = makeNodeRun({
        id: 'nr-e-retry',
        nodeId: 'triggered-e',
        status: 'failed',
        errorMessage: 'Workdir preparation failed: disk full on retry',
        retryCount: 1,
      });
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id === 'nr-e-retry') return retryFailedNodeRun;
        return makeNodeRun({
          id: 'nr-e',
          nodeId: 'triggered-e',
          status: 'failed',
          retryCount: 0,
        });
      });

      await handleNodeJobComplete(
        ctx,
        active,
        failedNodeRun,
        { exitCode: 1, errorKind: 'timeout', events: [] },
        '',
        advanceExecution,
        finalizeRun,
      );

      // Retry was attempted — createNodeRun called with retryCount=1
      const retryCall = (store.createNodeRun.mock.calls as MockCallTuple[]).find(
        (call: MockCallTuple) => call[0]?.nodeId === 'triggered-e' && call[0]?.retryCount === 1,
      );
      expect(retryCall).toBeDefined();

      // Node should be marked as failed due to prepareWorkdir failure
      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-e-retry',
        expect.objectContaining({
          status: 'failed',
          errorMessage: expect.stringContaining('Workdir preparation failed'),
        }),
      );

      // Session should be cleaned up
      expect(ctx.cleanupSession).toHaveBeenCalledWith('sess-1');
    });

    // ── Gap F: retryTriggeredNodeExecution enqueueJob failure ──

    it('F retryTriggeredNodeExecution marks node as failed when enqueueJob returns error', async () => {
      const { ctx, store } = createContext();
      const advanceExecution = vi.fn(async () => {});
      const finalizeRun = vi.fn();

      const triggeredNode = makeNode({
        id: 'triggered-f',
        nodeType: 'triggered',
        tool: 'claude',
        prompt: 'Do something',
        maxRetries: 1,
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const failedNodeRun = makeNodeRun({
        id: 'nr-f',
        nodeId: 'triggered-f',
        status: 'running',
        retryCount: 0,
        jobId: 'job-f',
        sessionKey: 'sess-f',
      });

      const active = makeActiveRun([triggeredNode], [], {
        orchestrator: makeOrchestrator({ workdir: '/tmp/orch-f' }),
        nodeRuns: new Map([['triggered-f', failedNodeRun]]),
        runningCount: 1,
      });

      // First call to getNodeRunById for the original failure
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-f',
          nodeId: 'triggered-f',
          status: 'failed',
          errorMessage: 'timeout',
          retryCount: 0,
        }),
      );

      // On retry, createNodeRun returns the retry nodeRun
      const retryNodeRun = makeNodeRun({
        id: 'nr-f-retry',
        nodeId: 'triggered-f',
        status: 'running',
        retryCount: 1,
      });
      store.createNodeRun.mockReturnValue(retryNodeRun);

      // enqueueJob returns error on retry
      let enqueueCallCount = 0;
      ctx.enqueueJob.mockImplementation(() => {
        enqueueCallCount++;
        if (enqueueCallCount > 0) {
          return { error: 'queue full' };
        }
        return { position: 1 };
      });

      // After retry failure, getNodeRunById returns the retry nodeRun as failed
      const retryFailedNodeRun = makeNodeRun({
        id: 'nr-f-retry',
        nodeId: 'triggered-f',
        status: 'failed',
        errorMessage: 'Enqueue failed: queue full',
        retryCount: 1,
      });
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id === 'nr-f-retry') return retryFailedNodeRun;
        return makeNodeRun({
          id: 'nr-f',
          nodeId: 'triggered-f',
          status: 'failed',
          retryCount: 0,
        });
      });

      await handleNodeJobComplete(
        ctx,
        active,
        failedNodeRun,
        { exitCode: 1, errorKind: 'timeout', events: [] },
        '',
        advanceExecution,
        finalizeRun,
      );

      // Retry was attempted
      const retryCall = (store.createNodeRun.mock.calls as MockCallTuple[]).find(
        (call: MockCallTuple) => call[0]?.nodeId === 'triggered-f' && call[0]?.retryCount === 1,
      );
      expect(retryCall).toBeDefined();

      // Node should be marked as failed due to enqueue failure
      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-f-retry',
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'Enqueue failed: queue full',
        }),
      );

      // Session should be cleaned up
      expect(ctx.cleanupSession).toHaveBeenCalledWith('sess-1');
    });

    // ── Gap 6: fired=true guard — timeout fires BEFORE event, event is ignored ──

    it('Gap 6 timeout fires before event — event callback is ignored', async () => {
      // DAG: triggeredA (root, waitTimeoutSec=5, onTimeout='fail')
      // errorPolicy=continue so the run does not finalize immediately
      const orchestrator = makeOrchestrator({ errorPolicy: 'continue' });
      const triggeredA = makeNode({
        id: 'triggeredA',
        label: 'Triggered A',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 5, onTimeout: 'fail' },
      });
      const run = makeRun({ id: 'run-1' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [triggeredA],
        edges: [],
      });
      store.createRun.mockReturnValue(run);

      const waitingNodeRun = makeNodeRun({
        id: 'nr-triggered-a',
        nodeId: 'triggeredA',
        orchestrationRunId: 'run-1',
        status: 'waiting',
      });
      store.createNodeRun.mockReturnValue(waitingNodeRun);

      const failedNodeRun = makeNodeRun({
        id: 'nr-triggered-a',
        nodeId: 'triggeredA',
        orchestrationRunId: 'run-1',
        status: 'failed',
        errorMessage: 'Triggered node timed out after 5s',
      });
      store.getNodeRunById.mockReturnValue(failedNodeRun);

      await engine.startRun('orch-1', 'dashboard', 'user-1');

      // triggeredA should be in waiting state
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

      // Advance time by 5000ms → timeout fires → node marked as failed
      await vi.advanceTimersByTimeAsync(5000);

      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-triggered-a',
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'Triggered node timed out after 5s',
        }),
      );

      // Record the state of enqueueJob and updateNodeRun call counts after timeout
      const enqueueCallsAfterTimeout = ctx.enqueueJob.mock.calls.length;
      const updateCallsAfterTimeout = store.updateNodeRun.mock.calls.length;

      // Now fire the event AFTER timeout — the fired=true guard should prevent any action
      mockEventRouter.fireEvent('run-1', 'triggeredA', { late: true });
      await vi.advanceTimersByTimeAsync(0);

      // enqueueJob should NOT have been called again (event was ignored)
      expect(ctx.enqueueJob.mock.calls.length).toBe(enqueueCallsAfterTimeout);
      // No new updateNodeRun calls — node status stays 'failed', not overwritten
      expect(store.updateNodeRun.mock.calls.length).toBe(updateCallsAfterTimeout);
      // Confirm the nodeRun in the active map is still 'failed'
      // (getNodeRunById returns the failed version)
      expect(store.getNodeRunById('nr-triggered-a')?.status).toBe('failed');
    });

    // ── Gap 7: resumeTriggeredNode getNodeRunById returns null after updating status to 'running' ──

    it('Gap 7 resumeTriggeredNode continues when getNodeRunById returns null after status update', async () => {
      const { ctx: localCtx, store: localStore } = createContext();

      const triggeredNode = makeNode({
        id: 'triggered-7',
        nodeType: 'triggered',
        tool: 'claude',
        prompt: 'Do something',
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const waitingNodeRun = makeNodeRun({
        id: 'nr-7',
        nodeId: 'triggered-7',
        status: 'waiting',
      });

      const active = makeActiveRun([triggeredNode], [], {
        nodeRuns: new Map([['triggered-7', waitingNodeRun]]),
      });
      active.pendingTriggeredPayloads.set('triggered-7', { event: 'data' });

      // getNodeRunById returns null → the defensive guard at line 490-493
      localStore.getNodeRunById.mockReturnValue(null);
      localStore.createNodeRun.mockReturnValue(waitingNodeRun);

      const advanceExecution = vi.fn(async () => {});
      const finalizeRun = vi.fn();

      const result = await executeTriggeredNode(
        localCtx,
        active,
        triggeredNode,
        advanceExecution,
        finalizeRun,
      );

      // Job should still be enqueued successfully
      expect(result).toBe(false);
      expect(localCtx.enqueueJob).toHaveBeenCalledTimes(1);
      // The nodeRuns map should NOT have been updated (getNodeRunById returned null)
      // It should still have the original waiting nodeRun set before the call
      // (resumeTriggeredNode sets nodeRuns only if updatedNodeRun is truthy)
      expect(active.nodeRuns.get('triggered-7')).toBe(waitingNodeRun);
    });

    // ── Gap 8: retryTriggeredNodeExecution getNodeRunById returns null after update ──

    it('Gap 8 retryTriggeredNodeExecution continues when getNodeRunById returns null after update', async () => {
      const { ctx: localCtx, store: localStore } = createContext();
      const advanceExecution = vi.fn(async () => {});
      const finalizeRun = vi.fn();

      const triggeredNode = makeNode({
        id: 'triggered-8',
        nodeType: 'triggered',
        tool: 'claude',
        prompt: 'Do something',
        maxRetries: 1,
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const failedNodeRun = makeNodeRun({
        id: 'nr-8',
        nodeId: 'triggered-8',
        status: 'running',
        retryCount: 0,
        jobId: 'job-8',
        sessionKey: 'sess-8',
      });

      const active = makeActiveRun([triggeredNode], [], {
        orchestrator: makeOrchestrator({ workdir: '/tmp/orch-8' }),
        nodeRuns: new Map([['triggered-8', failedNodeRun]]),
        runningCount: 1,
      });
      active.pendingTriggeredPayloads.set('triggered-8', { payload: 'retry' });

      // The retry nodeRun created by retryTriggeredNodeExecution
      const retryNodeRun = makeNodeRun({
        id: 'nr-8-retry',
        nodeId: 'triggered-8',
        status: 'running',
        retryCount: 1,
      });
      localStore.createNodeRun.mockReturnValue(retryNodeRun);

      // getNodeRunById returns null for the retry nodeRun → defensive guard at line 600-601
      // For the initial handleNodeJobComplete call it returns the failed nodeRun
      let getNodeRunByIdCallCount = 0;
      localStore.getNodeRunById.mockImplementation((id: string) => {
        getNodeRunByIdCallCount++;
        // First call: from handleNodeJobComplete after updateNodeRun (line 831)
        if (id === 'nr-8' && getNodeRunByIdCallCount <= 1) {
          return makeNodeRun({
            id: 'nr-8',
            nodeId: 'triggered-8',
            status: 'failed',
            errorMessage: 'timeout',
            retryCount: 0,
          });
        }
        // Subsequent calls: from retryTriggeredNodeExecution (line 600) → return null
        return null;
      });

      await handleNodeJobComplete(
        localCtx,
        active,
        failedNodeRun,
        { exitCode: 1, errorKind: 'timeout', events: [] },
        '',
        advanceExecution,
        finalizeRun,
      );

      // Retry was attempted — createNodeRun called with retryCount=1
      const retryCall = (localStore.createNodeRun.mock.calls as MockCallTuple[]).find(
        (call: MockCallTuple) => call[0]?.nodeId === 'triggered-8' && call[0]?.retryCount === 1,
      );
      expect(retryCall).toBeDefined();

      // Job should still be enqueued (the null guard doesn't prevent enqueue)
      expect(localCtx.enqueueJob).toHaveBeenCalled();

      // nodeRuns map should have retryNodeRun from createNodeRun (set at line 574),
      // but NOT updated by getNodeRunById (since it returned null at line 600)
      expect(active.nodeRuns.get('triggered-8')).toEqual(retryNodeRun);
    });

    // ── Gap 9: error_return routing for triggered node — payload cleanup ──

    it('Gap 9 triggered node with returnValues and errorKind → error_return routing + payload cleanup', async () => {
      const { ctx: localCtx, store: localStore } = createContext();
      const advanceExecution = vi.fn(async () => {});
      const finalizeRun = vi.fn();

      const triggeredNode = makeNode({
        id: 'triggered-9',
        nodeType: 'triggered',
        tool: 'claude',
        prompt: 'Do something',
        maxRetries: 0,
        returnValues: ['success', 'failure'],
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const runningNodeRun = makeNodeRun({
        id: 'nr-9',
        nodeId: 'triggered-9',
        status: 'running',
        retryCount: 0,
        jobId: 'job-9',
        sessionKey: 'sess-9',
      });

      const active = makeActiveRun([triggeredNode], [], {
        nodeRuns: new Map([['triggered-9', runningNodeRun]]),
        runningCount: 1,
      });
      // Simulate that pendingTriggeredPayloads was set when the event arrived
      active.pendingTriggeredPayloads.set('triggered-9', { event: 'data' });

      localStore.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-9',
          nodeId: 'triggered-9',
          status: 'completed',
          returnValue: 'error_return',
        }),
      );

      await handleNodeJobComplete(
        localCtx,
        active,
        runningNodeRun,
        { exitCode: 1, errorKind: 'timeout', events: [] },
        '',
        advanceExecution,
        finalizeRun,
      );

      // Status should be 'completed' with error_return (not 'failed')
      expect(localStore.updateNodeRun).toHaveBeenCalledWith(
        'nr-9',
        expect.objectContaining({
          status: 'completed',
          returnValue: 'error_return',
        }),
      );

      // pendingTriggeredPayloads should be cleared (line 843-844)
      expect(active.pendingTriggeredPayloads.has('triggered-9')).toBe(false);

      // finalizeRun should NOT have been called (status is 'completed', not fail_fast)
      expect(finalizeRun).not.toHaveBeenCalled();

      // advanceExecution should have been called
      expect(advanceExecution).toHaveBeenCalledWith(active);
    });

    // ── Gap G: handleNodeJobComplete clears pendingTriggeredPayloads for triggered nodes ──

    it('G handleNodeJobComplete clears pendingTriggeredPayloads after triggered node completion', async () => {
      const { ctx, store } = createContext();
      const advanceExecution = vi.fn(async () => {});
      const finalizeRun = vi.fn();

      const triggeredNode = makeNode({
        id: 'triggered-g',
        nodeType: 'triggered',
        tool: 'claude',
        prompt: 'Do something',
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const runningNodeRun = makeNodeRun({
        id: 'nr-g',
        nodeId: 'triggered-g',
        status: 'running',
        retryCount: 0,
        jobId: 'job-g',
        sessionKey: 'sess-g',
      });

      const active = makeActiveRun([triggeredNode], [], {
        nodeRuns: new Map([['triggered-g', runningNodeRun]]),
        runningCount: 1,
      });
      // Simulate that pendingTriggeredPayloads was set when the event arrived
      active.pendingTriggeredPayloads.set('triggered-g', { event: 'data' });
      expect(active.pendingTriggeredPayloads.has('triggered-g')).toBe(true);

      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-g',
          nodeId: 'triggered-g',
          status: 'completed',
          returnValue: null,
        }),
      );

      await handleNodeJobComplete(
        ctx,
        active,
        runningNodeRun,
        { exitCode: 0, errorKind: null, events: [] },
        'output text',
        advanceExecution,
        finalizeRun,
      );

      // pendingTriggeredPayloads should be cleared
      expect(active.pendingTriggeredPayloads.has('triggered-g')).toBe(false);
      // advanceExecution should have been called (non-retry, non-fail_fast path)
      expect(advanceExecution).toHaveBeenCalledWith(active);
    });
  });

  // ── Orchestrator Trigger Modes ──────────────────────────────

  describe('orchestrator trigger modes', () => {
    // A.2: ondemand + triggeredBy='slack'
    it('A.2 ondemand + triggeredBy=slack — run created successfully', async () => {
      const orchestrator = makeOrchestrator({ triggerMode: 'ondemand' });
      const taskA = makeNode({ id: 'taskA', label: 'Task A', nodeType: 'task' });
      const run = makeRun({ id: 'run-a2', triggeredBy: 'slack' });

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [taskA],
        edges: [],
      });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(
        makeNodeRun({
          id: 'nr-a2',
          nodeId: 'taskA',
          orchestrationRunId: 'run-a2',
          status: 'running',
        }),
      );

      const runId = await engine.startRun('orch-1', 'slack', 'user-1');
      expect(runId).toBe('run-a2');
      expect(store.createRun).toHaveBeenCalledWith(
        expect.objectContaining({ triggeredBy: 'slack' }),
      );
    });

    // A.3: ondemand + triggeredBy='schedule'
    it('A.3 ondemand + triggeredBy=schedule — run created successfully', async () => {
      const orchestrator = makeOrchestrator({ triggerMode: 'ondemand' });
      const taskA = makeNode({ id: 'taskA', label: 'Task A', nodeType: 'task' });
      const run = makeRun({ id: 'run-a3', triggeredBy: 'schedule' });

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [taskA],
        edges: [],
      });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(
        makeNodeRun({
          id: 'nr-a3',
          nodeId: 'taskA',
          orchestrationRunId: 'run-a3',
          status: 'running',
        }),
      );

      const runId = await engine.startRun('orch-1', 'schedule', 'user-1');
      expect(runId).toBe('run-a3');
      expect(store.createRun).toHaveBeenCalledWith(
        expect.objectContaining({ triggeredBy: 'schedule' }),
      );
    });

    // A.6: webhook + triggeredBy='dashboard' (no restriction)
    it('A.6 webhook + triggeredBy=dashboard — no restriction, run created', async () => {
      const orchestrator = makeOrchestrator({ triggerMode: 'webhook' });
      const taskA = makeNode({ id: 'taskA', label: 'Task A', nodeType: 'task' });
      const run = makeRun({ id: 'run-a6', triggeredBy: 'dashboard' });

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [taskA],
        edges: [],
      });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(
        makeNodeRun({
          id: 'nr-a6',
          nodeId: 'taskA',
          orchestrationRunId: 'run-a6',
          status: 'running',
        }),
      );

      const runId = await engine.startRun('orch-1', 'dashboard', 'user-1');
      expect(runId).toBe('run-a6');
      expect(store.createRun).toHaveBeenCalledWith(
        expect.objectContaining({ triggeredBy: 'dashboard' }),
      );
    });
  });

  // ── Triggered Nodes in Complex Flows ────────────────────────

  describe('triggered nodes in complex flows', () => {
    // B.10: triggered node as sole root (no incoming edges) — enters waiting → event fires → runs → downstream enqueued
    it('B.10 triggered node as root — enters waiting → event fires with payload → prompt includes "Triggered Event Context" → downstream enqueued', async () => {
      // DAG: triggeredA(root, no incoming edges) → taskB
      // Note: startNodeId must be a task node per DAG validation, so it is left empty.
      // triggeredA is the sole root because it has no incoming edges.
      const orchestrator = makeOrchestrator();
      const triggeredA = makeNode({
        id: 'triggeredA',
        label: 'Triggered A',
        nodeType: 'triggered',
        prompt: 'Start task',
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const taskB = makeNode({ id: 'taskB', label: 'Task B', nodeType: 'task' });
      const edges = [makeEdge({ id: 'e1', fromNodeId: 'triggeredA', toNodeId: 'taskB' })];
      const run = makeRun({ id: 'run-b10' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [triggeredA, taskB],
        edges,
      });
      store.createRun.mockReturnValue(run);

      let nodeRunCounter = 0;
      store.createNodeRun.mockImplementation(
        (input: { nodeId: string; status?: string; retryCount?: number }) => {
          nodeRunCounter++;
          return makeNodeRun({
            id: `nr-b10-${nodeRunCounter}`,
            nodeId: input.nodeId,
            orchestrationRunId: 'run-b10',
            status: (input.status as NodeRunStatus | undefined) ?? 'running',
            retryCount: input.retryCount ?? 0,
          });
        },
      );

      await engine.startRun('orch-1', 'dashboard', 'user-1');

      // triggeredA (root) should enter waiting state — no jobs enqueued
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);
      expect(ctx.enqueueJob).not.toHaveBeenCalled();

      // Set up for resumeTriggeredNode flow
      const runningTriggeredA = makeNodeRun({
        id: 'nr-b10-1',
        nodeId: 'triggeredA',
        orchestrationRunId: 'run-b10',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunById.mockReturnValue(runningTriggeredA);

      // Fire event for triggeredA with a non-null payload
      const eventPayload = { source: 'webhook', action: 'deploy' };
      mockEventRouter.fireEvent('run-b10', 'triggeredA', eventPayload);
      await vi.advanceTimersByTimeAsync(0);

      // triggeredA should have a job enqueued
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Verify the job prompt includes "Triggered Event Context"
      // since triggeredA is a triggered node with non-null payload
      // biome-ignore lint/style/noNonNullAssertion: test assertion guaranteed by prior expect
      const enqueueCall = ctx.enqueueJob.mock.calls[0]!;
      const jobArg = enqueueCall[0] as { prompt?: string };
      expect(jobArg.prompt).toBeDefined();
      expect(jobArg.prompt).toContain('Triggered Event Context');
      expect(jobArg.prompt).toContain('"source"');
      expect(jobArg.prompt).toContain('"deploy"');

      // Complete triggeredA → taskB should be enqueued
      store.getNodeRunByJobId.mockReturnValue(runningTriggeredA);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-b10-1',
          nodeId: 'triggeredA',
          orchestrationRunId: 'run-b10',
          status: 'completed',
          returnValue: null,
        }),
      );

      ctx.enqueueJob.mockClear();
      await engine.onNodeJobComplete(
        'mock-uuid-1',
        { exitCode: 0, events: [], errorKind: null },
        'done',
        'done',
      );

      // taskB should be enqueued
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);
      const taskBCreated = (store.createNodeRun.mock.calls as MockCallTuple[]).some(
        (call: MockCallTuple) => call[0]?.nodeId === 'taskB',
      );
      expect(taskBCreated).toBe(true);
    });

    // B.13: triggered node at END of flow
    it('B.13 triggered node at end of flow — taskA completes → triggeredB waits → event → runs → run completes', async () => {
      const orchestrator = makeOrchestrator();
      const taskA = makeNode({ id: 'taskA', label: 'Task A', nodeType: 'task' });
      const triggeredB = makeNode({
        id: 'triggeredB',
        label: 'Triggered B',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const edges = [makeEdge({ id: 'e1', fromNodeId: 'taskA', toNodeId: 'triggeredB' })];
      const run = makeRun({ id: 'run-b13' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [taskA, triggeredB],
        edges,
      });
      store.createRun.mockReturnValue(run);

      let nodeRunCounter = 0;
      store.createNodeRun.mockImplementation(
        (input: { nodeId: string; status?: string; retryCount?: number }) => {
          nodeRunCounter++;
          return makeNodeRun({
            id: `nr-b13-${nodeRunCounter}`,
            nodeId: input.nodeId,
            orchestrationRunId: 'run-b13',
            status: (input.status as NodeRunStatus | undefined) ?? 'running',
            retryCount: input.retryCount ?? 0,
          });
        },
      );

      await engine.startRun('orch-1', 'dashboard', 'user-1');

      // taskA should be enqueued
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Complete taskA → triggeredB should enter waiting
      const taskANodeRun = makeNodeRun({
        id: 'nr-b13-1',
        nodeId: 'taskA',
        orchestrationRunId: 'run-b13',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunByJobId.mockReturnValue(taskANodeRun);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-b13-1',
          nodeId: 'taskA',
          orchestrationRunId: 'run-b13',
          status: 'completed',
          returnValue: null,
          jobId: 'mock-uuid-1',
          sessionKey: 'sess-1',
        }),
      );

      await engine.onNodeJobComplete(
        'mock-uuid-1',
        { exitCode: 0, events: [], errorKind: null },
        'done',
        'done',
      );

      // triggeredB should enter waiting
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

      // Set up for resume
      const triggeredBRunning = makeNodeRun({
        id: 'nr-b13-2',
        nodeId: 'triggeredB',
        orchestrationRunId: 'run-b13',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id === 'nr-b13-1')
          return makeNodeRun({
            id: 'nr-b13-1',
            nodeId: 'taskA',
            orchestrationRunId: 'run-b13',
            status: 'completed',
          });
        if (id === 'nr-b13-2') return triggeredBRunning;
        return null;
      });

      // Fire event for triggeredB
      ctx.enqueueJob.mockClear();
      mockEventRouter.fireEvent('run-b13', 'triggeredB', { data: 'end-event' });
      await vi.advanceTimersByTimeAsync(0);

      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Complete triggeredB → run should finalize as 'completed' (no downstream)
      store.getNodeRunByJobId.mockReturnValue(triggeredBRunning);
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id === 'nr-b13-1')
          return makeNodeRun({
            id: 'nr-b13-1',
            nodeId: 'taskA',
            orchestrationRunId: 'run-b13',
            status: 'completed',
          });
        if (id === 'nr-b13-2')
          return makeNodeRun({
            id: 'nr-b13-2',
            nodeId: 'triggeredB',
            orchestrationRunId: 'run-b13',
            status: 'completed',
            returnValue: null,
          });
        return null;
      });

      await engine.onNodeJobComplete(
        'mock-uuid-1',
        { exitCode: 0, events: [], errorKind: null },
        'done',
        'done',
      );

      // Run should be finalized as completed
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-b13',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    // B.14: MULTIPLE triggered nodes in SEQUENCE
    it('B.14 multiple triggered nodes in sequence — triggeredA → triggeredB → taskC', async () => {
      const orchestrator = makeOrchestrator();
      const triggeredA = makeNode({
        id: 'triggeredA',
        label: 'Triggered A',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const triggeredB = makeNode({
        id: 'triggeredB',
        label: 'Triggered B',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const taskC = makeNode({ id: 'taskC', label: 'Task C', nodeType: 'task' });
      const edges = [
        makeEdge({ id: 'e1', fromNodeId: 'triggeredA', toNodeId: 'triggeredB' }),
        makeEdge({ id: 'e2', fromNodeId: 'triggeredB', toNodeId: 'taskC' }),
      ];
      const run = makeRun({ id: 'run-b14' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [triggeredA, triggeredB, taskC],
        edges,
      });
      store.createRun.mockReturnValue(run);

      let nodeRunCounter = 0;
      store.createNodeRun.mockImplementation(
        (input: { nodeId: string; status?: string; retryCount?: number }) => {
          nodeRunCounter++;
          return makeNodeRun({
            id: `nr-b14-${nodeRunCounter}`,
            nodeId: input.nodeId,
            orchestrationRunId: 'run-b14',
            status: (input.status as NodeRunStatus | undefined) ?? 'running',
            retryCount: input.retryCount ?? 0,
          });
        },
      );

      await engine.startRun('orch-1', 'dashboard', 'user-1');

      // triggeredA (root) should enter waiting — no jobs enqueued
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);
      expect(ctx.enqueueJob).not.toHaveBeenCalled();

      // Set up for resumeTriggeredNode(triggeredA)
      const triggeredARunning = makeNodeRun({
        id: 'nr-b14-1',
        nodeId: 'triggeredA',
        orchestrationRunId: 'run-b14',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunById.mockReturnValue(triggeredARunning);

      // Fire event for triggeredA
      mockEventRouter.fireEvent('run-b14', 'triggeredA', { step: 1 });
      await vi.advanceTimersByTimeAsync(0);

      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Complete triggeredA → triggeredB should enter waiting
      store.getNodeRunByJobId.mockReturnValue(triggeredARunning);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-b14-1',
          nodeId: 'triggeredA',
          orchestrationRunId: 'run-b14',
          status: 'completed',
          returnValue: null,
        }),
      );

      ctx.enqueueJob.mockClear();
      mockEventRouter.router.registerTriggeredWaiter.mockClear();
      await engine.onNodeJobComplete(
        'mock-uuid-1',
        { exitCode: 0, events: [], errorKind: null },
        'done',
        'done',
      );

      // triggeredB should now be waiting
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledWith(
        'sub-triggeredB',
        'run-b14:triggeredB',
        expect.objectContaining({ nodeId: 'triggeredB' }),
      );

      // Set up for resumeTriggeredNode(triggeredB)
      const triggeredBRunning = makeNodeRun({
        id: 'nr-b14-2',
        nodeId: 'triggeredB',
        orchestrationRunId: 'run-b14',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id === 'nr-b14-1')
          return makeNodeRun({
            id: 'nr-b14-1',
            nodeId: 'triggeredA',
            orchestrationRunId: 'run-b14',
            status: 'completed',
          });
        if (id === 'nr-b14-2') return triggeredBRunning;
        return null;
      });

      // Fire event for triggeredB
      ctx.enqueueJob.mockClear();
      mockEventRouter.fireEvent('run-b14', 'triggeredB', { step: 2 });
      await vi.advanceTimersByTimeAsync(0);

      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Complete triggeredB → taskC should be enqueued
      store.getNodeRunByJobId.mockReturnValue(triggeredBRunning);
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id === 'nr-b14-1')
          return makeNodeRun({
            id: 'nr-b14-1',
            nodeId: 'triggeredA',
            orchestrationRunId: 'run-b14',
            status: 'completed',
          });
        if (id === 'nr-b14-2')
          return makeNodeRun({
            id: 'nr-b14-2',
            nodeId: 'triggeredB',
            orchestrationRunId: 'run-b14',
            status: 'completed',
            returnValue: null,
          });
        return null;
      });

      ctx.enqueueJob.mockClear();
      await engine.onNodeJobComplete(
        'mock-uuid-1',
        { exitCode: 0, events: [], errorKind: null },
        'done',
        'done',
      );

      // taskC should be enqueued
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);
      const taskCCreated = (store.createNodeRun.mock.calls as MockCallTuple[]).some(
        (call: MockCallTuple) => call[0]?.nodeId === 'taskC',
      );
      expect(taskCCreated).toBe(true);
    });

    // B.18: triggered node after CONDITIONAL branch
    it('B.18 triggered node after conditional branch — matching condition activates triggered node', async () => {
      // DAG: taskA →(eq "go")→ triggeredB → taskC, taskA →(eq "stop")→ taskD
      const orchestrator = makeOrchestrator();
      const taskA = makeNode({ id: 'taskA', label: 'Task A', nodeType: 'task' });
      const triggeredB = makeNode({
        id: 'triggeredB',
        label: 'Triggered B',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const taskC = makeNode({ id: 'taskC', label: 'Task C', nodeType: 'task' });
      const taskD = makeNode({ id: 'taskD', label: 'Task D', nodeType: 'task' });
      const edges = [
        makeEdge({
          id: 'e1',
          fromNodeId: 'taskA',
          toNodeId: 'triggeredB',
          conditionValue: 'go',
          conditionOperator: 'eq',
        }),
        makeEdge({ id: 'e2', fromNodeId: 'triggeredB', toNodeId: 'taskC' }),
        makeEdge({
          id: 'e3',
          fromNodeId: 'taskA',
          toNodeId: 'taskD',
          conditionValue: 'stop',
          conditionOperator: 'eq',
        }),
      ];
      const run = makeRun({ id: 'run-b18' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [taskA, triggeredB, taskC, taskD],
        edges,
      });
      store.createRun.mockReturnValue(run);

      let nodeRunCounter = 0;
      store.createNodeRun.mockImplementation(
        (input: { nodeId: string; status?: string; retryCount?: number }) => {
          nodeRunCounter++;
          return makeNodeRun({
            id: `nr-b18-${nodeRunCounter}`,
            nodeId: input.nodeId,
            orchestrationRunId: 'run-b18',
            status: (input.status as NodeRunStatus | undefined) ?? 'running',
            retryCount: input.retryCount ?? 0,
          });
        },
      );

      await engine.startRun('orch-1', 'dashboard', 'user-1');

      // taskA should be enqueued
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Complete taskA with returnValue='go' → triggeredB should enter waiting, taskD should be skipped
      const taskANodeRun = makeNodeRun({
        id: 'nr-b18-1',
        nodeId: 'taskA',
        orchestrationRunId: 'run-b18',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunByJobId.mockReturnValue(taskANodeRun);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-b18-1',
          nodeId: 'taskA',
          orchestrationRunId: 'run-b18',
          status: 'completed',
          returnValue: 'go',
          jobId: 'mock-uuid-1',
          sessionKey: 'sess-1',
        }),
      );

      ctx.enqueueJob.mockClear();
      await engine.onNodeJobComplete(
        'mock-uuid-1',
        { exitCode: 0, events: [], errorKind: null },
        'go',
        '<return>go</return>',
      );

      // triggeredB should enter waiting (condition 'go' matches)
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

      // taskD should NOT be enqueued (condition 'stop' does not match)
      const taskDCreated = (store.createNodeRun.mock.calls as MockCallTuple[]).some(
        (call: MockCallTuple) => call[0]?.nodeId === 'taskD' && call[0]?.status !== 'skipped',
      );
      expect(taskDCreated).toBe(false);

      // Set up for resume
      const triggeredBRunning = makeNodeRun({
        id: 'nr-b18-2',
        nodeId: 'triggeredB',
        orchestrationRunId: 'run-b18',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id === 'nr-b18-1')
          return makeNodeRun({
            id: 'nr-b18-1',
            nodeId: 'taskA',
            orchestrationRunId: 'run-b18',
            status: 'completed',
            returnValue: 'go',
          });
        if (id === 'nr-b18-2') return triggeredBRunning;
        return null;
      });

      // Fire event for triggeredB
      ctx.enqueueJob.mockClear();
      mockEventRouter.fireEvent('run-b18', 'triggeredB', { action: 'proceed' });
      await vi.advanceTimersByTimeAsync(0);

      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Complete triggeredB → taskC should be enqueued
      store.getNodeRunByJobId.mockReturnValue(triggeredBRunning);
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id === 'nr-b18-1')
          return makeNodeRun({
            id: 'nr-b18-1',
            nodeId: 'taskA',
            orchestrationRunId: 'run-b18',
            status: 'completed',
            returnValue: 'go',
          });
        if (id === 'nr-b18-2')
          return makeNodeRun({
            id: 'nr-b18-2',
            nodeId: 'triggeredB',
            orchestrationRunId: 'run-b18',
            status: 'completed',
            returnValue: null,
          });
        return null;
      });

      ctx.enqueueJob.mockClear();
      await engine.onNodeJobComplete(
        'mock-uuid-1',
        { exitCode: 0, events: [], errorKind: null },
        'done',
        'done',
      );

      // taskC should be enqueued
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);
      const taskCCreated = (store.createNodeRun.mock.calls as MockCallTuple[]).some(
        (call: MockCallTuple) => call[0]?.nodeId === 'taskC',
      );
      expect(taskCCreated).toBe(true);
    });

    // B.19: triggered in DIAMOND pattern with merge
    it('B.19 diamond pattern — taskA → triggeredB + triggeredC → taskD (waits for both)', async () => {
      // DAG: taskA → triggeredB, taskA → triggeredC, triggeredB → taskD, triggeredC → taskD
      const orchestrator = makeOrchestrator({ maxParallelism: 5 });
      const taskA = makeNode({ id: 'taskA', label: 'Task A', nodeType: 'task' });
      const triggeredB = makeNode({
        id: 'triggeredB',
        label: 'Triggered B',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const triggeredC = makeNode({
        id: 'triggeredC',
        label: 'Triggered C',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const taskD = makeNode({ id: 'taskD', label: 'Task D', nodeType: 'task' });
      const edges = [
        makeEdge({ id: 'e1', fromNodeId: 'taskA', toNodeId: 'triggeredB' }),
        makeEdge({ id: 'e2', fromNodeId: 'taskA', toNodeId: 'triggeredC' }),
        makeEdge({ id: 'e3', fromNodeId: 'triggeredB', toNodeId: 'taskD' }),
        makeEdge({ id: 'e4', fromNodeId: 'triggeredC', toNodeId: 'taskD' }),
      ];
      const run = makeRun({ id: 'run-b19' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [taskA, triggeredB, triggeredC, taskD],
        edges,
      });
      store.createRun.mockReturnValue(run);

      let nodeRunCounter = 0;
      store.createNodeRun.mockImplementation(
        (input: { nodeId: string; status?: string; retryCount?: number }) => {
          nodeRunCounter++;
          return makeNodeRun({
            id: `nr-b19-${nodeRunCounter}`,
            nodeId: input.nodeId,
            orchestrationRunId: 'run-b19',
            status: (input.status as NodeRunStatus | undefined) ?? 'running',
            retryCount: input.retryCount ?? 0,
          });
        },
      );

      // startRun → taskA enqueued
      await engine.startRun('orch-1', 'dashboard', 'user-1');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Complete taskA → triggeredB and triggeredC both enter waiting
      const taskANodeRun = makeNodeRun({
        id: 'nr-b19-1',
        nodeId: 'taskA',
        orchestrationRunId: 'run-b19',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunByJobId.mockReturnValue(taskANodeRun);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-b19-1',
          nodeId: 'taskA',
          orchestrationRunId: 'run-b19',
          status: 'completed',
          returnValue: null,
        }),
      );

      ctx.enqueueJob.mockClear();
      await engine.onNodeJobComplete(
        'mock-uuid-1',
        { exitCode: 0, events: [], errorKind: null },
        'done',
        'done',
      );

      // Both triggered nodes should enter waiting
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(2);
      // No jobs enqueued yet (triggered nodes wait)
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(0);

      // Set up triggeredB to run after event
      const triggeredBNodeRunId = store.createNodeRun.mock.results.find(
        // biome-ignore lint/suspicious/noExplicitAny: test mock typing
        (_r: any, i: number) =>
          // biome-ignore lint/suspicious/noExplicitAny: test mock typing
          (store.createNodeRun.mock.calls[i]?.[0] as any)?.nodeId === 'triggeredB',
      )?.value?.id;
      const triggeredCNodeRunId = store.createNodeRun.mock.results.find(
        // biome-ignore lint/suspicious/noExplicitAny: test mock typing
        (_r: any, i: number) =>
          // biome-ignore lint/suspicious/noExplicitAny: test mock typing
          (store.createNodeRun.mock.calls[i]?.[0] as any)?.nodeId === 'triggeredC',
      )?.value?.id;

      const triggeredBRunning = makeNodeRun({
        id: triggeredBNodeRunId ?? '',
        nodeId: 'triggeredB',
        orchestrationRunId: 'run-b19',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id === 'nr-b19-1')
          return makeNodeRun({
            id: 'nr-b19-1',
            nodeId: 'taskA',
            orchestrationRunId: 'run-b19',
            status: 'completed',
          });
        if (id === triggeredBNodeRunId) return triggeredBRunning;
        return null;
      });

      // Fire event for triggeredB
      ctx.enqueueJob.mockClear();
      mockEventRouter.fireEvent('run-b19', 'triggeredB', { b: true });
      await vi.advanceTimersByTimeAsync(0);

      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Complete triggeredB → taskD NOT ready (triggeredC still waiting)
      store.getNodeRunByJobId.mockReturnValue(triggeredBRunning);
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id === 'nr-b19-1')
          return makeNodeRun({
            id: 'nr-b19-1',
            nodeId: 'taskA',
            orchestrationRunId: 'run-b19',
            status: 'completed',
          });
        if (id === triggeredBNodeRunId)
          return makeNodeRun({
            id: triggeredBNodeRunId ?? '',
            nodeId: 'triggeredB',
            orchestrationRunId: 'run-b19',
            status: 'completed',
            returnValue: null,
          });
        return null;
      });

      ctx.enqueueJob.mockClear();
      await engine.onNodeJobComplete(
        'mock-uuid-1',
        { exitCode: 0, events: [], errorKind: null },
        'done',
        'done',
      );

      // taskD should NOT be enqueued — triggeredC still waiting
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(0);

      // Now fire event for triggeredC
      const triggeredCRunning = makeNodeRun({
        // biome-ignore lint/style/noNonNullAssertion: test assertion guaranteed by prior expect
        id: triggeredCNodeRunId!,
        nodeId: 'triggeredC',
        orchestrationRunId: 'run-b19',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id === 'nr-b19-1')
          return makeNodeRun({
            id: 'nr-b19-1',
            nodeId: 'taskA',
            orchestrationRunId: 'run-b19',
            status: 'completed',
          });
        if (id === triggeredBNodeRunId)
          return makeNodeRun({
            id: triggeredBNodeRunId ?? '',
            nodeId: 'triggeredB',
            orchestrationRunId: 'run-b19',
            status: 'completed',
            returnValue: null,
          });
        if (id === triggeredCNodeRunId) return triggeredCRunning;
        return null;
      });

      ctx.enqueueJob.mockClear();
      mockEventRouter.fireEvent('run-b19', 'triggeredC', { c: true });
      await vi.advanceTimersByTimeAsync(0);

      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Complete triggeredC → taskD should now be enqueued (both sources completed)
      store.getNodeRunByJobId.mockReturnValue(triggeredCRunning);
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id === 'nr-b19-1')
          return makeNodeRun({
            id: 'nr-b19-1',
            nodeId: 'taskA',
            orchestrationRunId: 'run-b19',
            status: 'completed',
          });
        if (id === triggeredBNodeRunId)
          return makeNodeRun({
            id: triggeredBNodeRunId ?? '',
            nodeId: 'triggeredB',
            orchestrationRunId: 'run-b19',
            status: 'completed',
            returnValue: null,
          });
        if (id === triggeredCNodeRunId)
          return makeNodeRun({
            // biome-ignore lint/style/noNonNullAssertion: test assertion guaranteed by prior expect
            id: triggeredCNodeRunId!,
            nodeId: 'triggeredC',
            orchestrationRunId: 'run-b19',
            status: 'completed',
            returnValue: null,
          });
        return null;
      });

      ctx.enqueueJob.mockClear();
      await engine.onNodeJobComplete(
        'mock-uuid-1',
        { exitCode: 0, events: [], errorKind: null },
        'done',
        'done',
      );

      // taskD should be enqueued — both triggeredB and triggeredC completed
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);
      const taskDCreated = (store.createNodeRun.mock.calls as MockCallTuple[]).some(
        (call: MockCallTuple) => call[0]?.nodeId === 'taskD',
      );
      expect(taskDCreated).toBe(true);
    });
  });

  // ── Triggered Node Error Patterns — Remaining ──────────────

  describe('triggered node error patterns - remaining', () => {
    // C.21: timeout (onTimeout='fail') + errorPolicy='continue'
    it('C.21 timeout onTimeout=fail + errorPolicy=continue → node failed, taskB skipped, run failed', async () => {
      // DAG: triggeredA(root, waitTimeoutSec=5, onTimeout='fail') → taskB
      const orchestrator = makeOrchestrator({ errorPolicy: 'continue' });
      const triggeredA = makeNode({
        id: 'triggeredA',
        label: 'Triggered A',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 5, onTimeout: 'fail' },
      });
      const taskB = makeNode({ id: 'taskB', label: 'Task B', nodeType: 'task' });
      const edges = [makeEdge({ id: 'e1', fromNodeId: 'triggeredA', toNodeId: 'taskB' })];
      const run = makeRun({ id: 'run-c21' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [triggeredA, taskB],
        edges,
      });
      store.createRun.mockReturnValue(run);

      const waitingNodeRun = makeNodeRun({
        id: 'nr-c21-1',
        nodeId: 'triggeredA',
        orchestrationRunId: 'run-c21',
        status: 'waiting',
      });
      store.createNodeRun.mockReturnValue(waitingNodeRun);

      // Track updateNodeRun so getNodeRunById reflects the engine's real timeout decision
      let lastUpdate: Record<string, unknown> = {};
      store.updateNodeRun.mockImplementation((_id: string, update: Record<string, unknown>) => {
        lastUpdate = { ...lastUpdate, ...update };
      });
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id === 'nr-c21-1') {
          return makeNodeRun({
            id: 'nr-c21-1',
            nodeId: 'triggeredA',
            orchestrationRunId: 'run-c21',
            status: (lastUpdate.status as NodeRunStatus | undefined) ?? 'waiting',
            errorMessage: (lastUpdate.errorMessage as string | undefined) ?? null,
          });
        }
        return null;
      });

      await engine.startRun('orch-1', 'dashboard', 'user-1');

      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

      // Advance timers to trigger timeout
      await vi.advanceTimersByTimeAsync(5000);

      // handleTimeout decides status based on onTimeout='fail' (real decision)
      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-c21-1',
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'Triggered node timed out after 5s',
        }),
      );

      // continue → checkRunCompletion sees anyFailed=true (from tracked update) → run failed
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-c21',
        expect.objectContaining({ status: 'failed' }),
      );
    });

    // C.23: timeout (onTimeout='skip') + errorPolicy='fail_fast'
    it('C.23 timeout onTimeout=skip + errorPolicy=fail_fast — node skipped, run completes (skip is not failure)', async () => {
      // DAG: triggeredA(root, waitTimeoutSec=5, onTimeout='skip')
      const orchestrator = makeOrchestrator({ errorPolicy: 'fail_fast' });
      const triggeredA = makeNode({
        id: 'triggeredA',
        label: 'Triggered A',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 5, onTimeout: 'skip' },
      });
      const run = makeRun({ id: 'run-c23' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [triggeredA],
        edges: [],
      });
      store.createRun.mockReturnValue(run);

      const waitingNodeRun = makeNodeRun({
        id: 'nr-c23-1',
        nodeId: 'triggeredA',
        orchestrationRunId: 'run-c23',
        status: 'waiting',
      });
      store.createNodeRun.mockReturnValue(waitingNodeRun);

      const skippedNodeRun = makeNodeRun({
        id: 'nr-c23-1',
        nodeId: 'triggeredA',
        orchestrationRunId: 'run-c23',
        status: 'skipped',
      });
      store.getNodeRunById.mockReturnValue(skippedNodeRun);

      await engine.startRun('orch-1', 'dashboard', 'user-1');

      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

      // Advance timers to trigger timeout
      await vi.advanceTimersByTimeAsync(5000);

      // Node should be skipped
      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-c23-1',
        expect.objectContaining({ status: 'skipped' }),
      );

      // Run should complete (skipped is NOT failure, fail_fast should NOT trigger)
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-c23',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    // C.31: no subscription + fail_fast
    it('C.31 no subscription + fail_fast — node fails, run fails via fail_fast', async () => {
      const orchestrator = makeOrchestrator({ errorPolicy: 'fail_fast' });
      const triggeredA = makeNode({
        id: 'triggeredA',
        label: 'Triggered A',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const run = makeRun({ id: 'run-c31' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [triggeredA],
        edges: [],
      });
      store.createRun.mockReturnValue(run);

      const failedNodeRun = makeNodeRun({
        id: 'nr-c31-1',
        nodeId: 'triggeredA',
        orchestrationRunId: 'run-c31',
        status: 'failed',
        errorMessage: 'Triggered node has no event subscription',
      });
      store.createNodeRun.mockReturnValue(failedNodeRun);

      // After DAG validation passes, make getTriggeredNodeSubscription return null
      store.createRun.mockImplementation(() => {
        mockEventRouter.router.getTriggeredNodeSubscription.mockReturnValue(null);
        return run;
      });

      await engine.startRun('orch-1', 'dashboard', 'user-1');

      // Node should fail with no subscription
      expect(store.createNodeRun).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeId: 'triggeredA',
          status: 'failed',
          errorMessage: 'Triggered node has no event subscription',
        }),
      );

      // fail_fast → run fails
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-c31',
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'Triggered node has no event subscription',
        }),
      );
    });

    // C.34: crash recovery when eventRouter is gone
    it('C.34 crash recovery without eventRouter — waiting triggered node stays in nodeRuns (not re-registered)', async () => {
      const orchestrator = makeOrchestrator();
      const triggeredA = makeNode({
        id: 'triggeredA',
        label: 'Triggered A',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 60, onTimeout: 'fail' },
      });
      const run = makeRun({ id: 'run-c34', startedAt: new Date(Date.now() - 10000).toISOString() });

      // Do NOT set eventRouter — engine has no event router
      const waitingNodeRun = makeNodeRun({
        id: 'nr-c34-1',
        nodeId: 'triggeredA',
        orchestrationRunId: 'run-c34',
        status: 'waiting',
        startedAt: new Date(Date.now() - 10000).toISOString(),
      });

      store.getRunningRuns.mockReturnValue([run]);
      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [triggeredA],
        edges: [],
      });
      store.getNodeRunsByRun.mockReturnValue([waitingNodeRun]);

      const recovered = await engine.recoverActiveRuns();

      expect(recovered).toBe(1);

      // When beginTriggeredNodeWait detects no eventRouter with an existingNodeRun,
      // the existing waiting nodeRun is placed into active.nodeRuns as-is (not updated to failed).
      // advanceExecution is called (errorPolicy=continue) but checkRunCompletion sees
      // status='waiting' → allDone=false, so the run stays active (stuck without eventRouter).
      //
      // The key assertion: registerTriggeredWaiter was NOT called (no eventRouter available)
      // and no new createNodeRun was issued (existingNodeRun was re-used).
      expect(store.createNodeRun).not.toHaveBeenCalled();

      // The run is recovered into activeRuns but not finalized — it remains in 'running' state
      // (no updateRun call to 'failed' or 'completed')
      const finalizeCalls = (store.updateRun.mock.calls as UpdateNodeRunCallTuple[]).filter(
        (call: UpdateNodeRunCallTuple) =>
          call[1]?.status === 'failed' || call[1]?.status === 'completed',
      );
      expect(finalizeCalls).toHaveLength(0);
    });

    // C.35: cancelRun with waiting triggered nodes
    it('C.35 cancelRun with waiting triggered nodes — unsubscribe called, timer cleared, node cancelled', async () => {
      const orchestrator = makeOrchestrator();
      const triggeredA = makeNode({
        id: 'triggeredA',
        label: 'Triggered A',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 60, onTimeout: 'fail' },
      });
      const run = makeRun({ id: 'run-c35' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [triggeredA],
        edges: [],
      });
      store.createRun.mockReturnValue(run);

      const waitingNodeRun = makeNodeRun({
        id: 'nr-c35-1',
        nodeId: 'triggeredA',
        orchestrationRunId: 'run-c35',
        status: 'waiting',
      });
      store.createNodeRun.mockReturnValue(waitingNodeRun);

      await engine.startRun('orch-1', 'dashboard', 'user-1');

      // triggeredA should be in waiting state
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

      // Capture the unsubscribe function
      const unsubscribeFn = mockEventRouter.router.registerTriggeredWaiter.mock.results[0]?.value;
      expect(unsubscribeFn).toBeDefined();

      // Cancel the run while triggered node is waiting
      await engine.cancelRun('run-c35');

      // unsubscribe should be called (finalizeRun iterates waitingTriggeredNodes)
      expect(unsubscribeFn).toHaveBeenCalled();

      // Node should be marked as cancelled
      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-c35-1',
        expect.objectContaining({ status: 'cancelled' }),
      );

      // Run should be cancelled
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-c35',
        expect.objectContaining({ status: 'cancelled' }),
      );

      // Verify no timeout fires after cancellation
      store.updateRun.mockClear();
      store.updateNodeRun.mockClear();
      await vi.advanceTimersByTimeAsync(60_000);

      // No additional timeout-related calls
      const timeoutNodeCalls = (store.updateNodeRun.mock.calls as UpdateNodeRunCallTuple[]).filter(
        (call: UpdateNodeRunCallTuple) =>
          (call[1]?.errorMessage as string | undefined)?.includes('timed out'),
      );
      expect(timeoutNodeCalls).toHaveLength(0);
    });

    // D.44: triggered node with null payload
    it('D.44 triggered node with null payload — prompt does NOT contain "Triggered Event Context"', async () => {
      // DAG: taskA → triggeredB → taskC
      const orchestrator = makeOrchestrator();
      const taskA = makeNode({ id: 'taskA', label: 'Task A', nodeType: 'task' });
      const triggeredB = makeNode({
        id: 'triggeredB',
        label: 'Triggered B',
        nodeType: 'triggered',
        prompt: 'Handle event',
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const taskC = makeNode({ id: 'taskC', label: 'Task C', nodeType: 'task' });
      const edges = [
        makeEdge({ id: 'e1', fromNodeId: 'taskA', toNodeId: 'triggeredB' }),
        makeEdge({ id: 'e2', fromNodeId: 'triggeredB', toNodeId: 'taskC' }),
      ];
      const run = makeRun({ id: 'run-d44' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [taskA, triggeredB, taskC],
        edges,
      });
      store.createRun.mockReturnValue(run);

      let nodeRunCounter = 0;
      store.createNodeRun.mockImplementation(
        (input: { nodeId: string; status?: string; retryCount?: number }) => {
          nodeRunCounter++;
          return makeNodeRun({
            id: `nr-d44-${nodeRunCounter}`,
            nodeId: input.nodeId,
            orchestrationRunId: 'run-d44',
            status: (input.status as NodeRunStatus | undefined) ?? 'running',
            retryCount: input.retryCount ?? 0,
          });
        },
      );

      await engine.startRun('orch-1', 'dashboard', 'user-1');

      // Complete taskA → triggeredB enters waiting
      const taskANodeRun = makeNodeRun({
        id: 'nr-d44-1',
        nodeId: 'taskA',
        orchestrationRunId: 'run-d44',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunByJobId.mockReturnValue(taskANodeRun);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-d44-1',
          nodeId: 'taskA',
          orchestrationRunId: 'run-d44',
          status: 'completed',
          returnValue: null,
          jobId: 'mock-uuid-1',
          sessionKey: 'sess-1',
        }),
      );

      await engine.onNodeJobComplete(
        'mock-uuid-1',
        { exitCode: 0, events: [], errorKind: null },
        'done',
        'done',
      );

      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

      // Set up for resume
      const triggeredBRunning = makeNodeRun({
        id: 'nr-d44-2',
        nodeId: 'triggeredB',
        orchestrationRunId: 'run-d44',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunById.mockReturnValue(triggeredBRunning);

      // Fire event with NULL payload
      ctx.enqueueJob.mockClear();
      mockEventRouter.fireEvent('run-d44', 'triggeredB', null);
      await vi.advanceTimersByTimeAsync(0);

      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Verify the written instruction file does NOT contain "Triggered Event Context"
      // The prompt is written to the instruction file via writeFileSync
      const writeFileCalls = mocked.writeFileSync.mock.calls as WriteFileCallTuple[];
      const triggeredBWriteCall = writeFileCalls.find(
        (call: WriteFileCallTuple) =>
          typeof call[1] === 'string' && call[1].includes('Handle event'),
      );
      if (triggeredBWriteCall) {
        const writtenContent = triggeredBWriteCall[1] as string;
        expect(writtenContent).not.toContain('Triggered Event Context');
      }
    });
  });

  // ── Rerun with Triggered Nodes ──────────────────────────────

  describe('rerun with triggered nodes', () => {
    // E.45: rerun from triggered node
    it('E.45 rerun from triggered node — ancestor copied, triggered node enters waiting', async () => {
      // DAG: taskA → triggeredB → taskC
      const orchestrator = makeOrchestrator();
      const taskA = makeNode({ id: 'taskA', label: 'Task A', nodeType: 'task' });
      const triggeredB = makeNode({
        id: 'triggeredB',
        label: 'Triggered B',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const taskC = makeNode({ id: 'taskC', label: 'Task C', nodeType: 'task' });
      const edges = [
        makeEdge({ id: 'e1', fromNodeId: 'taskA', toNodeId: 'triggeredB' }),
        makeEdge({ id: 'e2', fromNodeId: 'triggeredB', toNodeId: 'taskC' }),
      ];

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      // Original run data
      const originalRun = makeRun({
        id: 'original-run-e45',
        orchestratorId: 'orch-1',
        status: 'completed',
      });
      const originalNodeRuns = [
        makeNodeRun({
          id: 'orig-nr-1',
          nodeId: 'taskA',
          orchestrationRunId: 'original-run-e45',
          status: 'completed',
          returnValue: 'ok',
          exitCode: 0,
          outputSummary: 'A done',
        }),
        makeNodeRun({
          id: 'orig-nr-2',
          nodeId: 'triggeredB',
          orchestrationRunId: 'original-run-e45',
          status: 'completed',
          returnValue: null,
        }),
        makeNodeRun({
          id: 'orig-nr-3',
          nodeId: 'taskC',
          orchestrationRunId: 'original-run-e45',
          status: 'completed',
          returnValue: null,
        }),
      ];

      store.getRunById.mockReturnValue(originalRun);
      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [taskA, triggeredB, taskC],
        edges,
      });
      store.getNodeRunsByRun.mockReturnValue(originalNodeRuns);

      const newRun = makeRun({
        id: 'rerun-e45',
        rerunFromRunId: 'original-run-e45',
        rerunFromNodeId: 'triggeredB',
      });
      store.createRun.mockReturnValue(newRun);

      let nodeRunCounter = 0;
      store.createNodeRun.mockImplementation(
        (input: {
          nodeId: string;
          status?: string;
          retryCount?: number;
          returnValue?: string;
          exitCode?: number;
          outputSummary?: string;
        }) => {
          nodeRunCounter++;
          return makeNodeRun({
            id: `rerun-nr-${nodeRunCounter}`,
            nodeId: input.nodeId,
            orchestrationRunId: 'rerun-e45',
            status: (input.status as NodeRunStatus | undefined) ?? 'running',
            retryCount: input.retryCount ?? 0,
            returnValue: input.returnValue ?? null,
            exitCode: input.exitCode ?? null,
            outputSummary: input.outputSummary ?? null,
          });
        },
      );

      const rerunId = await engine.startRerun(
        'original-run-e45',
        'triggeredB',
        'dashboard',
        'user-1',
      );

      expect(rerunId).toBe('rerun-e45');

      // taskA should be copied as completed ancestor
      const taskACopyCall = (store.createNodeRun.mock.calls as MockCallTuple[]).find(
        (call: MockCallTuple) => call[0]?.nodeId === 'taskA' && call[0]?.status === 'completed',
      );
      expect(taskACopyCall).toBeDefined();

      // triggeredB should enter waiting (registerTriggeredWaiter called)
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledWith(
        'sub-triggeredB',
        'rerun-e45:triggeredB',
        expect.objectContaining({ nodeId: 'triggeredB' }),
      );
    });

    // E.46: rerun from node after triggered (ancestor copy)
    it('E.46 rerun from taskC — both taskA and triggeredB copied as completed ancestors', async () => {
      // DAG: taskA → triggeredB → taskC
      const orchestrator = makeOrchestrator();
      const taskA = makeNode({ id: 'taskA', label: 'Task A', nodeType: 'task' });
      const triggeredB = makeNode({
        id: 'triggeredB',
        label: 'Triggered B',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const taskC = makeNode({ id: 'taskC', label: 'Task C', nodeType: 'task' });
      const edges = [
        makeEdge({ id: 'e1', fromNodeId: 'taskA', toNodeId: 'triggeredB' }),
        makeEdge({ id: 'e2', fromNodeId: 'triggeredB', toNodeId: 'taskC' }),
      ];

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      // Original run data
      const originalRun = makeRun({
        id: 'original-run-e46',
        orchestratorId: 'orch-1',
        status: 'completed',
      });
      const originalNodeRuns = [
        makeNodeRun({
          id: 'orig-nr-1',
          nodeId: 'taskA',
          orchestrationRunId: 'original-run-e46',
          status: 'completed',
          returnValue: 'ok',
          exitCode: 0,
          outputSummary: 'A done',
        }),
        makeNodeRun({
          id: 'orig-nr-2',
          nodeId: 'triggeredB',
          orchestrationRunId: 'original-run-e46',
          status: 'completed',
          returnValue: 'triggered-result',
          exitCode: 0,
          outputSummary: 'B done',
        }),
        makeNodeRun({
          id: 'orig-nr-3',
          nodeId: 'taskC',
          orchestrationRunId: 'original-run-e46',
          status: 'completed',
          returnValue: null,
        }),
      ];

      store.getRunById.mockReturnValue(originalRun);
      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [taskA, triggeredB, taskC],
        edges,
      });
      store.getNodeRunsByRun.mockReturnValue(originalNodeRuns);

      const newRun = makeRun({
        id: 'rerun-e46',
        rerunFromRunId: 'original-run-e46',
        rerunFromNodeId: 'taskC',
      });
      store.createRun.mockReturnValue(newRun);

      let nodeRunCounter = 0;
      store.createNodeRun.mockImplementation(
        (input: {
          nodeId: string;
          status?: string;
          retryCount?: number;
          returnValue?: string;
          exitCode?: number;
          outputSummary?: string;
        }) => {
          nodeRunCounter++;
          return makeNodeRun({
            id: `rerun-nr-${nodeRunCounter}`,
            nodeId: input.nodeId,
            orchestrationRunId: 'rerun-e46',
            status: (input.status as NodeRunStatus | undefined) ?? 'running',
            retryCount: input.retryCount ?? 0,
            returnValue: input.returnValue ?? null,
            exitCode: input.exitCode ?? null,
            outputSummary: input.outputSummary ?? null,
          });
        },
      );

      const rerunId = await engine.startRerun('original-run-e46', 'taskC', 'dashboard', 'user-1');

      expect(rerunId).toBe('rerun-e46');

      // Both taskA and triggeredB should be copied as completed ancestors
      const taskACopyCall = (store.createNodeRun.mock.calls as MockCallTuple[]).find(
        (call: MockCallTuple) => call[0]?.nodeId === 'taskA' && call[0]?.status === 'completed',
      );
      expect(taskACopyCall).toBeDefined();

      const triggeredBCopyCall = (store.createNodeRun.mock.calls as MockCallTuple[]).find(
        (call: MockCallTuple) =>
          call[0]?.nodeId === 'triggeredB' && call[0]?.status === 'completed',
      );
      expect(triggeredBCopyCall).toBeDefined();

      // taskC should be re-executed (enqueued as new job, not copied)
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);
      const taskCRunCall = (store.createNodeRun.mock.calls as MockCallTuple[]).find(
        (call: MockCallTuple) => call[0]?.nodeId === 'taskC' && call[0]?.status !== 'completed',
      );
      expect(taskCRunCall).toBeDefined();
    });
  });

  // ── Coverage Gap Tests ─────────────────────────────────────

  describe('triggered node coverage gaps', () => {
    // Gap A: no subscription + continue policy
    // Verifies: beginTriggeredNodeWait → no subscription → errorPolicy=continue branch
    //   → advanceExecution (not finalizeRun) → checkRunCompletion → anyFailed=true → run failed
    it('Gap-A no subscription + continue → node fails, advanceExecution continues, run fails (anyFailed)', async () => {
      const orchestrator = makeOrchestrator({ errorPolicy: 'continue' });
      const triggeredA = makeNode({
        id: 'triggeredA',
        label: 'Triggered A',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const run = makeRun({ id: 'run-gapA' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [triggeredA],
        edges: [],
      });

      // Pass-through mock: createNodeRun returns what the engine actually passes,
      // so checkRunCompletion reads the engine's real decision from active.nodeRuns.
      let nodeRunCounter = 0;
      store.createNodeRun.mockImplementation(
        (input: {
          nodeId: string;
          status?: string;
          retryCount?: number;
          errorMessage?: string;
          startedAt?: string;
          endedAt?: string;
        }) => {
          nodeRunCounter++;
          return makeNodeRun({
            id: `nr-gapA-${nodeRunCounter}`,
            nodeId: input.nodeId,
            orchestrationRunId: 'run-gapA',
            status: (input.status as NodeRunStatus | undefined) ?? 'running',
            retryCount: input.retryCount ?? 0,
            errorMessage: input.errorMessage ?? null,
          });
        },
      );

      // After DAG validation passes, make getTriggeredNodeSubscription return null
      store.createRun.mockImplementation(() => {
        mockEventRouter.router.getTriggeredNodeSubscription.mockReturnValue(null);
        return run;
      });

      await engine.startRun('orch-1', 'dashboard', 'user-1');

      // 1. Engine should have decided to create a failed nodeRun (real decision in beginTriggeredNodeWait)
      expect(store.createNodeRun).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeId: 'triggeredA',
          status: 'failed',
          errorMessage: 'Triggered node has no event subscription',
        }),
      );

      // 2. continue policy → checkRunCompletion sees anyFailed=true → run finalized as 'failed'
      //    (if the engine incorrectly passed status='completed' to createNodeRun,
      //     the pass-through mock would store 'completed' in active.nodeRuns,
      //     and this assertion would fail — proving the test is not a mock tautology)
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-gapA',
        expect.objectContaining({ status: 'failed' }),
      );

      // 3. Verify finalization came from checkRunCompletion (no errorMessage),
      //    NOT from fail_fast (which passes an errorMessage string)
      const finalizeCall = (store.updateRun.mock.calls as UpdateNodeRunCallTuple[]).find(
        (call: UpdateNodeRunCallTuple) => call[0] === 'run-gapA' && call[1]?.status === 'failed',
      );
      expect(finalizeCall?.[1]?.errorMessage).toBeNull();
    });

    // Gap B: crash recovery with timeout already exceeded (remainingMs = 0)
    // Verifies: recoverTriggeredNodeWait calculates remainingMs = max(startedAt + timeout - now, 0) = 0
    //   → beginTriggeredNodeWait sets setTimeout(..., 0) → immediate handleTimeout
    //   → handleTimeout decides 'failed' (onTimeout='fail') → fail_fast → finalizeRun
    it('Gap-B recovery with elapsed > timeout → remainingMs=0 → immediate timeout fires', async () => {
      const orchestrator = makeOrchestrator({ errorPolicy: 'fail_fast' });
      const triggeredA = makeNode({
        id: 'triggeredA',
        label: 'Triggered A',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      // Node started 60 seconds ago but timeout is only 30s → already exceeded
      const run = makeRun({
        id: 'run-gapB',
        startedAt: new Date(Date.now() - 60000).toISOString(),
      });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      const waitingNodeRun = makeNodeRun({
        id: 'nr-gapB-1',
        nodeId: 'triggeredA',
        orchestrationRunId: 'run-gapB',
        status: 'waiting',
        startedAt: new Date(Date.now() - 60000).toISOString(),
      });

      store.getRunningRuns.mockReturnValue([run]);
      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [triggeredA],
        edges: [],
      });
      store.getNodeRunsByRun.mockReturnValue([waitingNodeRun]);

      // Track updateNodeRun calls so getNodeRunById returns the engine's real update
      let lastUpdate: Record<string, unknown> = {};
      store.updateNodeRun.mockImplementation((_id: string, update: Record<string, unknown>) => {
        lastUpdate = { ...lastUpdate, ...update };
      });
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id === 'nr-gapB-1') {
          return makeNodeRun({
            id: 'nr-gapB-1',
            nodeId: 'triggeredA',
            orchestrationRunId: 'run-gapB',
            status: (lastUpdate.status as NodeRunStatus | undefined) ?? 'waiting',
            errorMessage: (lastUpdate.errorMessage as string | undefined) ?? null,
          });
        }
        return null;
      });

      const recovered = await engine.recoverActiveRuns();

      expect(recovered).toBe(1);
      // Waiter is registered even with remainingMs=0 (setTimeout(..., 0))
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

      // Advance tick to fire the immediate setTimeout(..., 0)
      await vi.advanceTimersByTimeAsync(0);

      // handleTimeout should decide 'failed' based on onTimeout='fail' (real decision)
      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-gapB-1',
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'Triggered node timed out after 30s',
        }),
      );

      // fail_fast → finalizeRun called directly from handleTimeout (not via checkRunCompletion)
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-gapB',
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'Triggered node timed out after 30s',
        }),
      );
    });

    // Gap C: run-level timeoutSec triggers finalizeRun while triggered node is waiting
    it('Gap-C run timeout while triggered node is waiting → triggered cleanup + run failed', async () => {
      const orchestrator = makeOrchestrator({
        errorPolicy: 'continue',
        timeoutSec: 10, // run-level timeout
      });
      const triggeredA = makeNode({
        id: 'triggeredA',
        label: 'Triggered A',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 300, onTimeout: 'fail' }, // node timeout much longer
      });
      const run = makeRun({ id: 'run-gapC' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [triggeredA],
        edges: [],
      });
      store.createRun.mockReturnValue(run);

      const waitingNodeRun = makeNodeRun({
        id: 'nr-gapC-1',
        nodeId: 'triggeredA',
        orchestrationRunId: 'run-gapC',
        status: 'waiting',
      });
      store.createNodeRun.mockReturnValue(waitingNodeRun);

      await engine.startRun('orch-1', 'dashboard', 'user-1');

      // triggeredA should be in waiting state
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

      // Get the unsubscribe function that was passed to registerTriggeredWaiter
      const unsubscribeFn = mockEventRouter.router.registerTriggeredWaiter.mock.results[0]?.value;
      expect(unsubscribeFn).toBeDefined();

      // Advance time to run-level timeout (10s), which is before node timeout (300s)
      await vi.advanceTimersByTimeAsync(10_000);

      // Run should be finalized as failed with overall timeout message
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-gapC',
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'Overall timeout (10s) exceeded',
        }),
      );

      // The unsubscribe function should have been called (triggered cleanup)
      expect(unsubscribeFn).toHaveBeenCalled();

      // Waiting node should be marked as skipped (finalizeRun marks waiting/running/pending as skipped)
      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-gapC-1',
        expect.objectContaining({ status: 'skipped' }),
      );
    });

    // Gap D: verify event payload is actually injected into the prompt
    it('Gap-D event payload content is present in enqueued job prompt', async () => {
      const orchestrator = makeOrchestrator();
      const triggeredA = makeNode({
        id: 'triggeredA',
        label: 'Triggered A',
        nodeType: 'triggered',
        prompt: 'Handle the event',
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const run = makeRun({ id: 'run-gapD' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [triggeredA],
        edges: [],
      });
      store.createRun.mockReturnValue(run);

      const waitingNodeRun = makeNodeRun({
        id: 'nr-gapD-1',
        nodeId: 'triggeredA',
        orchestrationRunId: 'run-gapD',
        status: 'waiting',
      });
      store.createNodeRun.mockReturnValue(waitingNodeRun);

      const runningNodeRun = makeNodeRun({
        id: 'nr-gapD-1',
        nodeId: 'triggeredA',
        orchestrationRunId: 'run-gapD',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunById.mockReturnValue(runningNodeRun);

      await engine.startRun('orch-1', 'dashboard', 'user-1');

      // Fire event with specific payload
      const eventPayload = { webhook_id: 'wh-123', action: 'deploy', region: 'us-east-1' };
      mockEventRouter.fireEvent('run-gapD', 'triggeredA', eventPayload);
      await vi.advanceTimersByTimeAsync(0);

      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Verify the prompt contains both the original prompt and the event payload
      const jobArg = vi.mocked(ctx.enqueueJob).mock.calls[0]?.[0];
      if (!jobArg) throw new Error('expected jobArg');
      expect(jobArg.prompt).toContain('Handle the event');
      expect(jobArg.prompt).toContain('Triggered Event Context');
      expect(jobArg.prompt).toContain('webhook_id');
      expect(jobArg.prompt).toContain('wh-123');
      expect(jobArg.prompt).toContain('deploy');
      expect(jobArg.prompt).toContain('us-east-1');
    });

    // (Gap-E removed: START_NODE_NOT_TASK already covered in dag.test.ts:321)

    // Gap E2: triggered node in webhook-triggered run gets only "Triggered Event Context" (not "Trigger Event Context")
    it('Gap-E2 triggered node (non-start) in webhook run → only Triggered Event Context, not Trigger Event Context', async () => {
      const orchestrator = makeOrchestrator({ startNodeId: 'taskA', triggerMode: 'webhook' });
      const taskA = makeNode({ id: 'taskA', label: 'Task A', nodeType: 'task', prompt: 'Init' });
      const triggeredB = makeNode({
        id: 'triggeredB',
        label: 'Triggered B',
        nodeType: 'triggered',
        prompt: 'Handle event',
        triggeredConfig: { waitTimeoutSec: 30, onTimeout: 'fail' },
      });
      const edges = [makeEdge({ id: 'e1', fromNodeId: 'taskA', toNodeId: 'triggeredB' })];
      const run = makeRun({
        id: 'run-gapE2',
        triggerContextJson: JSON.stringify({ source: 'github', repo: 'my-repo' }),
      });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [taskA, triggeredB],
        edges,
      });
      store.createRun.mockReturnValue(run);

      let nodeRunCounter = 0;
      store.createNodeRun.mockImplementation(
        (input: { nodeId: string; status?: string; retryCount?: number }) => {
          nodeRunCounter++;
          return makeNodeRun({
            id: `nr-e2-${nodeRunCounter}`,
            nodeId: input.nodeId,
            orchestrationRunId: 'run-gapE2',
            status: (input.status as NodeRunStatus | undefined) ?? 'running',
            retryCount: input.retryCount ?? 0,
          });
        },
      );

      await engine.startRun('orch-1', 'webhook', {
        userId: 'user-1',
        triggerContext: { source: 'github', repo: 'my-repo' },
      });

      // taskA should be enqueued — verify its prompt contains "Trigger Event Context" (it's the startNode)
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);
      const taskAJob = vi.mocked(ctx.enqueueJob).mock.calls[0]?.[0];
      if (!taskAJob) throw new Error('expected taskAJob');
      expect(taskAJob.prompt).toContain('Trigger Event Context');
      expect(taskAJob.prompt).toContain('github');

      // Complete taskA → triggeredB enters waiting
      const taskANodeRun = makeNodeRun({
        id: 'nr-e2-1',
        nodeId: 'taskA',
        orchestrationRunId: 'run-gapE2',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunByJobId.mockReturnValue(taskANodeRun);
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id === 'nr-e2-1') {
          return makeNodeRun({
            id: 'nr-e2-1',
            nodeId: 'taskA',
            orchestrationRunId: 'run-gapE2',
            status: 'completed',
          });
        }
        return null;
      });

      await engine.onNodeJobComplete(
        'mock-uuid-1',
        { exitCode: 0, events: [], errorKind: null },
        'done',
        'done',
      );
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

      // Set up for resumeTriggeredNode
      const waitingId = store.createNodeRun.mock.results.find(
        // biome-ignore lint/suspicious/noExplicitAny: test mock typing
        (_r: any, i: number) =>
          // biome-ignore lint/suspicious/noExplicitAny: test mock typing
          (store.createNodeRun.mock.calls[i]?.[0] as any)?.nodeId === 'triggeredB',
      )?.value?.id;

      const runningTriggeredB = makeNodeRun({
        // biome-ignore lint/style/noNonNullAssertion: test assertion guaranteed by prior expect
        id: waitingId!,
        nodeId: 'triggeredB',
        orchestrationRunId: 'run-gapE2',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id === 'nr-e2-1') {
          return makeNodeRun({
            id: 'nr-e2-1',
            nodeId: 'taskA',
            orchestrationRunId: 'run-gapE2',
            status: 'completed',
          });
        }
        if (id === waitingId) return runningTriggeredB;
        return null;
      });

      // Fire event with node-specific payload
      ctx.enqueueJob.mockClear();
      mockEventRouter.fireEvent('run-gapE2', 'triggeredB', { pr_number: 42 });
      await vi.advanceTimersByTimeAsync(0);

      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      const triggeredBJob = vi.mocked(ctx.enqueueJob).mock.calls[0]?.[0];
      if (!triggeredBJob) throw new Error('expected triggeredBJob');
      // triggeredB is NOT the startNode → should NOT get "Trigger Event Context"
      expect(triggeredBJob.prompt).not.toContain('Trigger Event Context');
      // But SHOULD get "Triggered Event Context" with its event payload
      expect(triggeredBJob.prompt).toContain('Triggered Event Context');
      expect(triggeredBJob.prompt).toContain('pr_number');
      expect(triggeredBJob.prompt).toContain('42');
    });

    // Gap F: multiple waiting triggered nodes recovered simultaneously
    it('Gap-F recovery of multiple waiting triggered nodes — both re-registered', async () => {
      const orchestrator = makeOrchestrator();
      const triggeredA = makeNode({
        id: 'triggeredA',
        label: 'Triggered A',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 60, onTimeout: 'fail' },
      });
      const triggeredB = makeNode({
        id: 'triggeredB',
        label: 'Triggered B',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 120, onTimeout: 'skip' },
      });
      const run = makeRun({
        id: 'run-gapF',
        startedAt: new Date(Date.now() - 20000).toISOString(),
      });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      const waitingA = makeNodeRun({
        id: 'nr-gapF-a',
        nodeId: 'triggeredA',
        orchestrationRunId: 'run-gapF',
        status: 'waiting',
        startedAt: new Date(Date.now() - 20000).toISOString(),
      });
      const waitingB = makeNodeRun({
        id: 'nr-gapF-b',
        nodeId: 'triggeredB',
        orchestrationRunId: 'run-gapF',
        status: 'waiting',
        startedAt: new Date(Date.now() - 20000).toISOString(),
      });

      store.getRunningRuns.mockReturnValue([run]);
      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [triggeredA, triggeredB],
        edges: [],
      });
      store.getNodeRunsByRun.mockReturnValue([waitingA, waitingB]);

      const recovered = await engine.recoverActiveRuns();

      expect(recovered).toBe(1);
      // Both triggered nodes should be re-registered
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(2);
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledWith(
        'sub-triggeredA',
        'run-gapF:triggeredA',
        expect.objectContaining({ nodeId: 'triggeredA' }),
      );
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledWith(
        'sub-triggeredB',
        'run-gapF:triggeredB',
        expect.objectContaining({ nodeId: 'triggeredB' }),
      );
    });

    // Gap G: timeout with maxRetries — timeout does NOT trigger retry
    // Verifies: handleTimeout directly fails the node (via updateNodeRun) without entering
    //   the retry path (retryTriggeredNodeExecution), even when maxRetries > 0.
    //   The continue→advanceExecution→checkRunCompletion flow uses a pass-through mock
    //   to ensure the run status reflects the engine's real decision.
    it('Gap-G timeout on triggered node with maxRetries=2 → no retry, node directly fails, run fails', async () => {
      const orchestrator = makeOrchestrator({ errorPolicy: 'continue' });
      const triggeredA = makeNode({
        id: 'triggeredA',
        label: 'Triggered A',
        nodeType: 'triggered',
        maxRetries: 2,
        triggeredConfig: { waitTimeoutSec: 5, onTimeout: 'fail' },
      });
      const run = makeRun({ id: 'run-gapG' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [triggeredA],
        edges: [],
      });
      store.createRun.mockReturnValue(run);

      // Pass-through mock: returns what the engine passes, so active.nodeRuns
      // reflects the engine's real decisions throughout the flow.
      let nodeRunCounter = 0;
      store.createNodeRun.mockImplementation(
        (input: {
          nodeId: string;
          status?: string;
          retryCount?: number;
          errorMessage?: string;
        }) => {
          nodeRunCounter++;
          return makeNodeRun({
            id: `nr-gapG-${nodeRunCounter}`,
            nodeId: input.nodeId,
            orchestrationRunId: 'run-gapG',
            status: (input.status as NodeRunStatus | undefined) ?? 'running',
            retryCount: input.retryCount ?? 0,
            errorMessage: input.errorMessage ?? null,
          });
        },
      );

      // getNodeRunById after updateNodeRun: simulate DB reflecting the timeout update
      // by tracking the last updateNodeRun call's status for triggeredA.
      let lastTriggeredStatus = 'waiting';
      store.updateNodeRun.mockImplementation((_id: string, update: { status?: string }) => {
        if (update.status) lastTriggeredStatus = update.status;
      });
      store.getNodeRunById.mockImplementation((id: string) => {
        if (id.startsWith('nr-gapG-')) {
          return makeNodeRun({
            id,
            nodeId: 'triggeredA',
            orchestrationRunId: 'run-gapG',
            status: lastTriggeredStatus as NodeRunStatus,
            retryCount: 0,
          });
        }
        return null;
      });

      await engine.startRun('orch-1', 'dashboard', 'user-1');

      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

      // Advance to trigger timeout
      await vi.advanceTimersByTimeAsync(5000);

      // 1. handleTimeout should have decided to fail (onTimeout='fail'), not skip
      expect(store.updateNodeRun).toHaveBeenCalledWith(
        expect.stringContaining('nr-gapG-'),
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'Triggered node timed out after 5s',
        }),
      );

      // 2. No retry: timeout bypasses handleNodeJobComplete's retry path entirely.
      //    With pass-through mock, any retry would create a new nodeRun with retryCount > 0.
      const retryCalls = (store.createNodeRun.mock.calls as MockCallTuple[]).filter(
        (call: MockCallTuple) => call[0]?.nodeId === 'triggeredA' && (call[0]?.retryCount ?? 0) > 0,
      );
      expect(retryCalls).toHaveLength(0);

      // 3. No job enqueued (timeout doesn't trigger execution)
      expect(ctx.enqueueJob).not.toHaveBeenCalled();

      // 4. continue policy → checkRunCompletion → anyFailed=true → run finalized as 'failed'
      //    This assertion depends on getNodeRunById returning 'failed' (tracked via updateNodeRun),
      //    proving the pass-through mock chain works end-to-end.
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-gapG',
        expect.objectContaining({ status: 'failed' }),
      );
    });

    // Gap H: duplicate events on same triggered node — second event ignored
    it('Gap-H second event on same triggered node is ignored (fired guard)', async () => {
      const orchestrator = makeOrchestrator();
      const triggeredA = makeNode({
        id: 'triggeredA',
        label: 'Triggered A',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 60, onTimeout: 'fail' },
      });
      const run = makeRun({ id: 'run-gapH' });

      engine.setEventRouter(mockEventRouter.router as unknown as EventRouter);

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [triggeredA],
        edges: [],
      });
      store.createRun.mockReturnValue(run);

      const waitingNodeRun = makeNodeRun({
        id: 'nr-gapH-1',
        nodeId: 'triggeredA',
        orchestrationRunId: 'run-gapH',
        status: 'waiting',
      });
      store.createNodeRun.mockReturnValue(waitingNodeRun);

      const runningNodeRun = makeNodeRun({
        id: 'nr-gapH-1',
        nodeId: 'triggeredA',
        orchestrationRunId: 'run-gapH',
        status: 'running',
        jobId: 'mock-uuid-1',
        sessionKey: 'sess-1',
      });
      store.getNodeRunById.mockReturnValue(runningNodeRun);

      await engine.startRun('orch-1', 'dashboard', 'user-1');
      expect(mockEventRouter.router.registerTriggeredWaiter).toHaveBeenCalledTimes(1);

      // Fire first event
      mockEventRouter.fireEvent('run-gapH', 'triggeredA', { seq: 1 });
      await vi.advanceTimersByTimeAsync(0);

      // First event should trigger resumeTriggeredNode
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Fire second event — should be ignored (fired=true already)
      ctx.enqueueJob.mockClear();
      mockEventRouter.fireEvent('run-gapH', 'triggeredA', { seq: 2 });
      await vi.advanceTimersByTimeAsync(0);

      // No additional job should be enqueued
      expect(ctx.enqueueJob).not.toHaveBeenCalled();

      // Also verify timeout doesn't fire after the event was consumed
      await vi.advanceTimersByTimeAsync(60_000);
      const timeoutFailCalls = (store.updateNodeRun.mock.calls as UpdateNodeRunCallTuple[]).filter(
        (call: UpdateNodeRunCallTuple) =>
          call[1]?.status === 'failed' &&
          (call[1]?.errorMessage as string | undefined)?.includes('timed out'),
      );
      expect(timeoutFailCalls).toHaveLength(0);
    });
  });
});
