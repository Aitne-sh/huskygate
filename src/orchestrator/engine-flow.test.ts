/**
 * OrchestratorEngine — Complex Flow Tests
 *
 * Tests cover: complex DAG topologies, parallel execution boundaries,
 * condition branching patterns, gate combinations, error policies, and rerun scenarios.
 *
 * Real validateDAG / buildValidatedDAG / evaluateEdgeCondition / evaluateGateCondition
 * functions are NOT mocked — they run as-is so we verify real DAG semantics.
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

const notifyMocks = vi.hoisted(() => ({
  sendCompletionNotification: vi.fn<
    (...args: unknown[]) => Promise<{ channelId: string; ts: string } | null>
  >(async () => null),
  sendNodeNotification: vi.fn(async () => {}),
  startSummaryJob: vi.fn(() => true),
}));

vi.mock('./engine-notify.js', () => ({
  sendCompletionNotification: notifyMocks.sendCompletionNotification,
  sendNodeNotification: notifyMocks.sendNodeNotification,
}));

vi.mock('./engine-summary.js', () => ({
  startSummaryJob: notifyMocks.startSummaryJob,
}));

// ─── Imports (after mocks) ──────────────────────────────────

import { OrchestratorEngine } from './engine.js';
import type { EngineContext } from './engine.js';
import type {
  OrchestrationNodeRun,
  OrchestrationRun,
  Orchestrator,
  OrchestratorEdge,
  OrchestratorNode,
} from './types.js';

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

/**
 * Helper to complete a task node by simulating job completion.
 * Sets up the store mocks for getNodeRunByJobId and getNodeRunById,
 * optionally queues createNodeRun mocks for downstream nodes, then
 * calls engine.onNodeJobComplete.
 */
async function completeNode(
  engine: OrchestratorEngine,
  store: ReturnType<typeof createMockStore>,
  nodeId: string,
  jobId: string,
  returnValue: string,
  nextNodeRuns?: Array<{ nodeId: string; status?: string }>,
): Promise<void> {
  store.getNodeRunByJobId.mockReturnValue(
    makeNodeRun({
      id: `nr-${nodeId}`,
      nodeId,
      orchestrationRunId: 'run-1',
      status: 'running',
      jobId,
      retryCount: 0,
    }),
  );
  store.getNodeRunById.mockReturnValue(
    makeNodeRun({
      id: `nr-${nodeId}`,
      nodeId,
      orchestrationRunId: 'run-1',
      status: 'completed',
      returnValue,
    }),
  );
  if (nextNodeRuns) {
    for (const nr of nextNodeRuns) {
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({
          id: `nr-${nr.nodeId}`,
          nodeId: nr.nodeId,
          orchestrationRunId: 'run-1',
          status: (nr.status ?? 'running') as OrchestrationNodeRun['status'],
          jobId: `job-${nr.nodeId}`,
        }),
      );
    }
  }
  await engine.onNodeJobComplete(
    jobId,
    { exitCode: 0, events: [], errorKind: null },
    `output <return:${returnValue}>`,
    `output <return:${returnValue}>`,
  );
}

// ─── Tests ──────────────────────────────────────────────────

describe('orchestrator engine flow tests', () => {
  let store: ReturnType<typeof createMockStore>;
  let ctx: ReturnType<typeof createContext>['ctx'];
  let engine: OrchestratorEngine;
  let sessCounter: number;
  let nrCounter: number;

  beforeEach(() => {
    vi.useFakeTimers();
    notifyMocks.sendCompletionNotification.mockReset();
    notifyMocks.sendCompletionNotification.mockResolvedValue(null);
    notifyMocks.sendNodeNotification.mockReset();
    notifyMocks.sendNodeNotification.mockResolvedValue(undefined);
    notifyMocks.startSummaryJob.mockReset();
    notifyMocks.startSummaryJob.mockReturnValue(true);

    const created = createContext();
    store = created.store;
    ctx = created.ctx;
    engine = new OrchestratorEngine(ctx);

    sessCounter = 0;
    ctx.createSession.mockImplementation(() => {
      sessCounter++;
      return { sessionKey: `sess-${sessCounter}`, workdir: `/tmp/sess-${sessCounter}` };
    });

    nrCounter = 0;
    store.createNodeRun.mockImplementation((input: { nodeId: string; status?: string }) => {
      nrCounter++;
      return makeNodeRun({
        id: `nr-${input.nodeId}`,
        nodeId: input.nodeId,
        orchestrationRunId: 'run-1',
        status: (input.status as OrchestrationNodeRun['status']) ?? 'running',
        jobId: `job-${input.nodeId}`,
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Complex DAG Topologies ─────────────────────────────────

  describe('complex DAG topologies', () => {
    it('1.1 nested diamond (A→B,C→D→E,F→G)', async () => {
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
        makeNode({ id: 'D', label: 'D' }),
        makeNode({ id: 'E', label: 'E' }),
        makeNode({ id: 'F', label: 'F' }),
        makeNode({ id: 'G', label: 'G' }),
      ];
      const edges = [
        makeEdge({ id: 'e-AB', fromNodeId: 'A', toNodeId: 'B' }),
        makeEdge({ id: 'e-AC', fromNodeId: 'A', toNodeId: 'C' }),
        makeEdge({ id: 'e-BD', fromNodeId: 'B', toNodeId: 'D' }),
        makeEdge({ id: 'e-CD', fromNodeId: 'C', toNodeId: 'D' }),
        makeEdge({ id: 'e-DE', fromNodeId: 'D', toNodeId: 'E' }),
        makeEdge({ id: 'e-DF', fromNodeId: 'D', toNodeId: 'F' }),
        makeEdge({ id: 'e-EG', fromNodeId: 'E', toNodeId: 'G' }),
        makeEdge({ id: 'e-FG', fromNodeId: 'F', toNodeId: 'G' }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');

      // A should be enqueued
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Complete A → B,C should run in parallel
      await completeNode(engine, store, 'A', 'job-A', 'ok', [{ nodeId: 'B' }, { nodeId: 'C' }]);
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(3); // A + B + C

      // Complete B → D waits for C
      await completeNode(engine, store, 'B', 'job-B', 'ok');
      // No new enqueueJob yet — D waits for C
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(3);

      // Complete C → D runs
      await completeNode(engine, store, 'C', 'job-C', 'ok', [{ nodeId: 'D' }]);
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(4); // + D

      // Complete D → E,F run in parallel
      await completeNode(engine, store, 'D', 'job-D', 'ok', [{ nodeId: 'E' }, { nodeId: 'F' }]);
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(6); // + E + F

      // Complete E → G waits for F
      await completeNode(engine, store, 'E', 'job-E', 'ok');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(6);

      // Complete F → G runs
      await completeNode(engine, store, 'F', 'job-F', 'ok', [{ nodeId: 'G' }]);
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(7); // + G

      // Complete G → run finalizes as completed
      await completeNode(engine, store, 'G', 'job-G', 'ok');
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('1.2 wide fan-out with maxParallelism=2', async () => {
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
        makeNode({ id: 'D', label: 'D' }),
        makeNode({ id: 'E', label: 'E' }),
        makeNode({ id: 'F', label: 'F' }),
      ];
      const edges = [
        makeEdge({ id: 'e-AB', fromNodeId: 'A', toNodeId: 'B' }),
        makeEdge({ id: 'e-AC', fromNodeId: 'A', toNodeId: 'C' }),
        makeEdge({ id: 'e-AD', fromNodeId: 'A', toNodeId: 'D' }),
        makeEdge({ id: 'e-AE', fromNodeId: 'A', toNodeId: 'E' }),
        makeEdge({ id: 'e-AF', fromNodeId: 'A', toNodeId: 'F' }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 2 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');

      // A runs (1 slot)
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Complete A → B,C start (2 slots full), D,E,F wait
      await completeNode(engine, store, 'A', 'job-A', 'ok', [{ nodeId: 'B' }, { nodeId: 'C' }]);
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(3); // A + B + C

      // Complete B → D starts (slot freed by B, C still running = 1 slot, D fills to 2)
      await completeNode(engine, store, 'B', 'job-B', 'ok', [{ nodeId: 'D' }]);
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(4); // + D

      // Complete C → E starts
      await completeNode(engine, store, 'C', 'job-C', 'ok', [{ nodeId: 'E' }]);
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(5); // + E

      // Complete D → F starts
      await completeNode(engine, store, 'D', 'job-D', 'ok', [{ nodeId: 'F' }]);
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(6); // + F

      // Complete E, F → run completes
      await completeNode(engine, store, 'E', 'job-E', 'ok');
      await completeNode(engine, store, 'F', 'job-F', 'ok');

      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('1.3 multiple end nodes with branching', async () => {
      const nodes = [
        makeNode({ id: 'A', label: 'A', returnValues: ['success', 'error'] }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
        makeNode({ id: 'end1', label: 'End 1', nodeType: 'end', tool: null, prompt: null }),
        makeNode({ id: 'end2', label: 'End 2', nodeType: 'end', tool: null, prompt: null }),
      ];
      const edges = [
        makeEdge({
          id: 'e-AB',
          fromNodeId: 'A',
          toNodeId: 'B',
          conditionValue: 'success',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'e-AC',
          fromNodeId: 'A',
          toNodeId: 'C',
          conditionValue: 'error',
          conditionOperator: 'eq',
        }),
        makeEdge({ id: 'e-Bend1', fromNodeId: 'B', toNodeId: 'end1' }),
        makeEdge({ id: 'e-Cend2', fromNodeId: 'C', toNodeId: 'end2' }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 5 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1); // A

      // A returns "success" → B runs (C skipped)
      // end1 will be created synchronously after B completes
      await completeNode(engine, store, 'A', 'job-A', 'success', [{ nodeId: 'B' }]);
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(2); // + B

      // Complete B → end1 completes synchronously → run finalizes
      // end1 will be created via createNodeRun in the synchronous loop
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({
          id: 'nr-end1',
          nodeId: 'end1',
          orchestrationRunId: 'run-1',
          status: 'completed',
          returnValue: 'workflow_ended',
        }),
      );
      // Skipped nodes: C and end2 will be persisted as skipped during finalization
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({
          id: 'nr-C',
          nodeId: 'C',
          orchestrationRunId: 'run-1',
          status: 'skipped',
        }),
      );
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({
          id: 'nr-end2',
          nodeId: 'end2',
          orchestrationRunId: 'run-1',
          status: 'skipped',
        }),
      );
      await completeNode(engine, store, 'B', 'job-B', 'ok');

      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );

      // Verify end1 was created with workflow_ended
      const end1Calls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string }>) => call[0]?.nodeId === 'end1',
      );
      expect(end1Calls.length).toBeGreaterThanOrEqual(1);
    });

    it('1.4 deep chain (10 nodes)', async () => {
      const nodes = Array.from({ length: 10 }, (_, i) =>
        makeNode({ id: `n${i}`, label: `Node ${i}` }),
      );
      const edges = Array.from({ length: 9 }, (_, i) =>
        makeEdge({ id: `e-${i}`, fromNodeId: `n${i}`, toNodeId: `n${i + 1}` }),
      );

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10, maxTotalNodes: 50 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1); // n0

      // Complete each node sequentially
      for (let i = 0; i < 9; i++) {
        const nextNodeRuns = [{ nodeId: `n${i + 1}` }];
        await completeNode(engine, store, `n${i}`, `job-n${i}`, 'ok', nextNodeRuns);
        expect(ctx.enqueueJob).toHaveBeenCalledTimes(i + 2);
      }

      // Complete n9 → run finalizes
      await completeNode(engine, store, 'n9', 'job-n9', 'ok');

      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('1.5 W-shape DAG (2 merge points)', async () => {
      // A→B, A→C (parallel), B→D, C→D (merge 1), B→E, C→E (merge 2)
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
        makeNode({ id: 'D', label: 'D' }),
        makeNode({ id: 'E', label: 'E' }),
      ];
      const edges = [
        makeEdge({ id: 'e-AB', fromNodeId: 'A', toNodeId: 'B' }),
        makeEdge({ id: 'e-AC', fromNodeId: 'A', toNodeId: 'C' }),
        makeEdge({ id: 'e-BD', fromNodeId: 'B', toNodeId: 'D' }),
        makeEdge({ id: 'e-CD', fromNodeId: 'C', toNodeId: 'D' }),
        makeEdge({ id: 'e-BE', fromNodeId: 'B', toNodeId: 'E' }),
        makeEdge({ id: 'e-CE', fromNodeId: 'C', toNodeId: 'E' }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1); // A

      // Complete A → B,C parallel
      await completeNode(engine, store, 'A', 'job-A', 'ok', [{ nodeId: 'B' }, { nodeId: 'C' }]);
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(3); // + B, C

      // Complete B → D waits for C, E waits for C
      await completeNode(engine, store, 'B', 'job-B', 'ok');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(3); // no new enqueues

      // Complete C → D and E both become runnable (both merge points satisfied)
      await completeNode(engine, store, 'C', 'job-C', 'ok', [{ nodeId: 'D' }, { nodeId: 'E' }]);
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(5); // + D, E

      // Complete D, E → run finalizes
      await completeNode(engine, store, 'D', 'job-D', 'ok');
      await completeNode(engine, store, 'E', 'job-E', 'ok');

      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('1.6 diamond + gate merge (both pass)', async () => {
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
        makeNode({
          id: 'gate',
          label: 'Gate',
          nodeType: 'gate',
          tool: null,
          prompt: null,
          gateCondition: { mode: 'and', matchValue: 'ok' },
        }),
        makeNode({ id: 'D', label: 'D' }),
      ];
      const edges = [
        makeEdge({ id: 'e-AB', fromNodeId: 'A', toNodeId: 'B' }),
        makeEdge({ id: 'e-AC', fromNodeId: 'A', toNodeId: 'C' }),
        makeEdge({ id: 'e-Bgate', fromNodeId: 'B', toNodeId: 'gate' }),
        makeEdge({ id: 'e-Cgate', fromNodeId: 'C', toNodeId: 'gate' }),
        makeEdge({
          id: 'e-gateD',
          fromNodeId: 'gate',
          toNodeId: 'D',
          conditionValue: 'pass',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');

      // Complete A → B,C parallel
      await completeNode(engine, store, 'A', 'job-A', 'ok', [{ nodeId: 'B' }, { nodeId: 'C' }]);

      // Complete B → gate waits for C
      await completeNode(engine, store, 'B', 'job-B', 'ok');

      // Complete C → gate evaluates (AND, both "ok") → pass → D runs
      // Gate is synchronous, then D is created
      store.createNodeRun
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-gate',
            nodeId: 'gate',
            orchestrationRunId: 'run-1',
            status: 'completed',
            returnValue: 'pass',
          }),
        )
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-D',
            nodeId: 'D',
            orchestrationRunId: 'run-1',
            status: 'running',
            jobId: 'job-D',
          }),
        );
      await completeNode(engine, store, 'C', 'job-C', 'ok');

      // D should have been enqueued
      const dCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string }>) => call[0]?.nodeId === 'D',
      );
      expect(dCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('1.6 diamond + gate merge (one fails → gate fail → D skipped)', async () => {
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
        makeNode({
          id: 'gate',
          label: 'Gate',
          nodeType: 'gate',
          tool: null,
          prompt: null,
          gateCondition: { mode: 'and', matchValue: 'ok' },
        }),
        makeNode({ id: 'D', label: 'D' }),
      ];
      const edges = [
        makeEdge({ id: 'e-AB', fromNodeId: 'A', toNodeId: 'B' }),
        makeEdge({ id: 'e-AC', fromNodeId: 'A', toNodeId: 'C' }),
        makeEdge({ id: 'e-Bgate', fromNodeId: 'B', toNodeId: 'gate' }),
        makeEdge({ id: 'e-Cgate', fromNodeId: 'C', toNodeId: 'gate' }),
        makeEdge({
          id: 'e-gateD',
          fromNodeId: 'gate',
          toNodeId: 'D',
          conditionValue: 'pass',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');

      await completeNode(engine, store, 'A', 'job-A', 'ok', [{ nodeId: 'B' }, { nodeId: 'C' }]);

      await completeNode(engine, store, 'B', 'job-B', 'ok');

      // Complete C with "ng" → gate evaluates AND("ok","ng") → fail
      // Gate is synchronous. D is skipped since gate returns "fail" but edge requires "pass".
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({
          id: 'nr-gate',
          nodeId: 'gate',
          orchestrationRunId: 'run-1',
          status: 'completed',
          returnValue: 'fail',
        }),
      );
      // D will be persisted as skipped during finalization
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({
          id: 'nr-D',
          nodeId: 'D',
          orchestrationRunId: 'run-1',
          status: 'skipped',
        }),
      );
      await completeNode(engine, store, 'C', 'job-C', 'ng');

      // Run should complete (not failed — gate "failed" in the gate sense but the DAG completed)
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );

      // D should not have been enqueued as a running task
      const dRunningCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'D' && call[0]?.status === 'running',
      );
      expect(dRunningCalls).toHaveLength(0);
    });
  });

  // ── Parallel Execution Boundaries ──────────────────────────

  describe('parallel execution boundaries', () => {
    it('2.1 maxParallelism=1 serialization', async () => {
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
      ];
      // All root nodes (no edges between them)
      const edges: OrchestratorEdge[] = [];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 1 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');

      // Only 1 node should start
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Complete A → B starts
      await completeNode(engine, store, 'A', 'job-A', 'ok');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(2);

      // Complete B → C starts
      await completeNode(engine, store, 'B', 'job-B', 'ok');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(3);

      // Complete C → run completes
      await completeNode(engine, store, 'C', 'job-C', 'ok');
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('2.2 parallelism slot release', async () => {
      // A,B,C → D, maxParallelism=2
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
        makeNode({ id: 'D', label: 'D' }),
      ];
      const edges = [
        makeEdge({ id: 'e-AD', fromNodeId: 'A', toNodeId: 'D' }),
        makeEdge({ id: 'e-BD', fromNodeId: 'B', toNodeId: 'D' }),
        makeEdge({ id: 'e-CD', fromNodeId: 'C', toNodeId: 'D' }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 2 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');

      // A,B start (2 slots). C waits.
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(2);

      // Complete A → C starts (B still running)
      await completeNode(engine, store, 'A', 'job-A', 'ok');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(3); // + C

      // Complete B → no new starts (C still running, D needs A,B,C all done)
      await completeNode(engine, store, 'B', 'job-B', 'ok');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(3);

      // Complete C → D starts (all predecessors done)
      await completeNode(engine, store, 'C', 'job-C', 'ok', [{ nodeId: 'D' }]);
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(4); // + D

      // Complete D → run completes
      await completeNode(engine, store, 'D', 'job-D', 'ok');
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('2.3 all parallel nodes fail (continue policy)', async () => {
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 3, errorPolicy: 'continue' }),
        nodes,
        edges: [],
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(3);

      // Fail all three with errorKind='timeout'
      for (const id of ['A', 'B', 'C']) {
        store.getNodeRunByJobId.mockReturnValue(
          makeNodeRun({
            id: `nr-${id}`,
            nodeId: id,
            orchestrationRunId: 'run-1',
            status: 'running',
            jobId: `job-${id}`,
            retryCount: 0,
          }),
        );
        store.getNodeRunById.mockReturnValue(
          makeNodeRun({
            id: `nr-${id}`,
            nodeId: id,
            orchestrationRunId: 'run-1',
            status: 'failed',
            errorMessage: 'timeout',
          }),
        );
        await engine.onNodeJobComplete(
          `job-${id}`,
          { exitCode: 1, events: [], errorKind: 'timeout' },
          'failed output',
          'failed output',
        );
      }

      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'failed' }),
      );
    });

    it('2.4 all parallel nodes fail (fail_fast policy)', async () => {
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 3, errorPolicy: 'fail_fast' }),
        nodes,
        edges: [],
      });
      store.createRun.mockReturnValue(makeRun());

      // createNodeRun must include sessionKey so that finalizeRun can call cancelJob.
      // In the real engine, createNodeRun stores the initial record, then updateNodeRun
      // sets sessionKey, but the active.nodeRuns map keeps the createNodeRun result.
      // The mock must return sessionKey to simulate what the in-memory map would hold
      // after the engine updates it.
      let sessIdx = 0;
      store.createNodeRun.mockImplementation((input: { nodeId: string }) => {
        sessIdx++;
        return makeNodeRun({
          id: `nr-${input.nodeId}`,
          nodeId: input.nodeId,
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: `job-${input.nodeId}`,
          sessionKey: `sess-${sessIdx}`,
        });
      });

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(3);

      // First node fails → finalizeRun called → other 2 cancelled
      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-A',
          nodeId: 'A',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-A',
          sessionKey: 'sess-1',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-A',
          nodeId: 'A',
          orchestrationRunId: 'run-1',
          status: 'failed',
          errorMessage: 'timeout',
        }),
      );

      await engine.onNodeJobComplete(
        'job-A',
        { exitCode: 1, events: [], errorKind: 'timeout' },
        'failed',
        'failed',
      );

      // fail_fast should finalize the run
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'failed' }),
      );

      // cancelJob should be called for B and C's sessions (running nodes)
      expect(ctx.cancelJob).toHaveBeenCalled();
    });
  });

  // ── Condition Branching Patterns ───────────────────────────

  describe('condition branching patterns', () => {
    it('3.1 multi-value branching (3-way switch)', async () => {
      const nodes = [
        makeNode({ id: 'A', label: 'A', returnValues: ['success', 'error', 'timeout'] }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
        makeNode({ id: 'D', label: 'D' }),
      ];
      const edges = [
        makeEdge({
          id: 'e-AB',
          fromNodeId: 'A',
          toNodeId: 'B',
          conditionValue: 'success',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'e-AC',
          fromNodeId: 'A',
          toNodeId: 'C',
          conditionValue: 'error',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'e-AD',
          fromNodeId: 'A',
          toNodeId: 'D',
          conditionValue: 'timeout',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 5 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');

      // A returns "error" → C runs, B and D skipped
      await completeNode(engine, store, 'A', 'job-A', 'error', [{ nodeId: 'C' }]);

      // C should be created
      const cCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'C' && call[0]?.status !== 'skipped',
      );
      expect(cCalls.length).toBeGreaterThanOrEqual(1);

      // Complete C → run should finalize
      // B and D will be persisted as skipped during finalization
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({ id: 'nr-B-skip', nodeId: 'B', status: 'skipped' }),
      );
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({ id: 'nr-D-skip', nodeId: 'D', status: 'skipped' }),
      );
      await completeNode(engine, store, 'C', 'job-C', 'done');

      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('3.2 neq condition branching', async () => {
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
      ];
      const edges = [
        makeEdge({
          id: 'e-AB',
          fromNodeId: 'A',
          toNodeId: 'B',
          conditionValue: 'error',
          conditionOperator: 'neq',
        }),
        makeEdge({
          id: 'e-AC',
          fromNodeId: 'A',
          toNodeId: 'C',
          conditionValue: 'error',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 5 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');

      // A returns "success" → B runs (neq "error" matches), C skipped
      await completeNode(engine, store, 'A', 'job-A', 'success', [{ nodeId: 'B' }]);

      const bCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'B' && call[0]?.status !== 'skipped',
      );
      expect(bCalls.length).toBeGreaterThanOrEqual(1);

      // Complete B → C persisted as skipped during finalization
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({ id: 'nr-C-skip', nodeId: 'C', status: 'skipped' }),
      );
      await completeNode(engine, store, 'B', 'job-B', 'done');

      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('3.3 in condition branching', async () => {
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
      ];
      const edges = [
        makeEdge({
          id: 'e-AB',
          fromNodeId: 'A',
          toNodeId: 'B',
          conditionValue: 'pass,success,done',
          conditionOperator: 'in',
        }),
        makeEdge({
          id: 'e-AC',
          fromNodeId: 'A',
          toNodeId: 'C',
          conditionValue: 'error',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 5 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');

      // A returns "done" → B runs (in CSV matches "done"), C skipped
      await completeNode(engine, store, 'A', 'job-A', 'done', [{ nodeId: 'B' }]);

      const bCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'B' && call[0]?.status !== 'skipped',
      );
      expect(bCalls.length).toBeGreaterThanOrEqual(1);

      // Complete B → run finalizes
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({ id: 'nr-C-skip', nodeId: 'C', status: 'skipped' }),
      );
      await completeNode(engine, store, 'B', 'job-B', 'ok');

      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('3.4 regex condition branching', async () => {
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
      ];
      const edges = [
        makeEdge({
          id: 'e-AB',
          fromNodeId: 'A',
          toNodeId: 'B',
          conditionValue: '^v\\d+\\.',
          conditionOperator: 'regex',
        }),
        makeEdge({
          id: 'e-AC',
          fromNodeId: 'A',
          toNodeId: 'C',
          conditionValue: '^error:',
          conditionOperator: 'regex',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 5 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');

      // A returns "v2.1-rc" → B runs (regex ^v\d+\. matches), C skipped
      await completeNode(engine, store, 'A', 'job-A', 'v2.1-rc', [{ nodeId: 'B' }]);

      const bCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'B' && call[0]?.status !== 'skipped',
      );
      expect(bCalls.length).toBeGreaterThanOrEqual(1);

      // Complete B → run finalizes
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({ id: 'nr-C-skip', nodeId: 'C', status: 'skipped' }),
      );
      await completeNode(engine, store, 'B', 'job-B', 'ok');

      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('3.5 wildcard * plus named condition — non-error value triggers wildcard', async () => {
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
      ];
      const edges = [
        makeEdge({
          id: 'e-AC',
          fromNodeId: 'A',
          toNodeId: 'C',
          conditionValue: 'error',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'e-AB',
          fromNodeId: 'A',
          toNodeId: 'B',
          conditionValue: '*',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 5 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');

      // A returns "success" → B runs (wildcard matches any non-null), C skipped
      await completeNode(engine, store, 'A', 'job-A', 'success', [{ nodeId: 'B' }]);

      const bCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'B' && call[0]?.status !== 'skipped',
      );
      expect(bCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('3.5 wildcard * plus named condition — "error" triggers both paths', async () => {
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
      ];
      const edges = [
        makeEdge({
          id: 'e-AC',
          fromNodeId: 'A',
          toNodeId: 'C',
          conditionValue: 'error',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'e-AB',
          fromNodeId: 'A',
          toNodeId: 'B',
          conditionValue: '*',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 5 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');

      // A returns "error" → both B (wildcard) and C (eq "error") become runnable
      await completeNode(engine, store, 'A', 'job-A', 'error', [{ nodeId: 'B' }, { nodeId: 'C' }]);

      // Both B and C should be created as running
      const bCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'B' && call[0]?.status !== 'skipped',
      );
      const cCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'C' && call[0]?.status !== 'skipped',
      );
      expect(bCalls.length).toBeGreaterThanOrEqual(1);
      expect(cCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('3.6 all conditions unmatched (all paths die)', async () => {
      const nodes = [
        makeNode({ id: 'A', label: 'A', returnValues: ['pass', 'fail'] }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
        makeNode({ id: 'end', label: 'End', nodeType: 'end', tool: null, prompt: null }),
      ];
      const edges = [
        makeEdge({
          id: 'e-AB',
          fromNodeId: 'A',
          toNodeId: 'B',
          conditionValue: 'pass',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'e-AC',
          fromNodeId: 'A',
          toNodeId: 'C',
          conditionValue: 'fail',
          conditionOperator: 'eq',
        }),
        makeEdge({ id: 'e-Bend', fromNodeId: 'B', toNodeId: 'end' }),
        makeEdge({ id: 'e-Cend', fromNodeId: 'C', toNodeId: 'end' }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 5 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');

      // A returns "unknown" → no conditions match "pass" or "fail"
      // returnValue "unknown" is not in returnValues so it becomes "other_return"
      // Neither "pass" nor "fail" edge matches "other_return" → B,C,end all skipped
      //
      // NOTE: We do NOT use completeNode() here because it would set
      // getNodeRunById to return { returnValue: 'unknown' }, whereas the engine
      // actually transforms it to 'other_return'.  The mock must reflect the
      // effective value so that downstream edge evaluation uses the correct state.
      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-A',
          nodeId: 'A',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-A',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-A',
          nodeId: 'A',
          orchestrationRunId: 'run-1',
          status: 'completed',
          returnValue: 'other_return',
        }),
      );
      // Skipped nodes will be persisted during finalization
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({ id: 'nr-B-skip', nodeId: 'B', status: 'skipped' }),
      );
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({ id: 'nr-C-skip', nodeId: 'C', status: 'skipped' }),
      );
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({ id: 'nr-end-skip', nodeId: 'end', status: 'skipped' }),
      );
      await engine.onNodeJobComplete(
        'job-A',
        { exitCode: 0, events: [], errorKind: null },
        'output <return:unknown>',
        'output <return:unknown>',
      );

      // Verify the engine correctly mapped 'unknown' → 'other_return'
      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-A',
        expect.objectContaining({
          status: 'completed',
          returnValue: 'other_return',
        }),
      );

      // Run should complete (all nodes are skippable)
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });
  });

  // ── Gate Combinations ──────────────────────────────────────

  describe('gate combinations', () => {
    it('4.1 OR gate (1 of 3 sources pass)', async () => {
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
        makeNode({
          id: 'gate',
          label: 'Gate',
          nodeType: 'gate',
          tool: null,
          prompt: null,
          gateCondition: { mode: 'or', matchValue: 'ok' },
        }),
        makeNode({ id: 'D', label: 'D' }),
      ];
      const edges = [
        makeEdge({ id: 'e-Agate', fromNodeId: 'A', toNodeId: 'gate' }),
        makeEdge({ id: 'e-Bgate', fromNodeId: 'B', toNodeId: 'gate' }),
        makeEdge({ id: 'e-Cgate', fromNodeId: 'C', toNodeId: 'gate' }),
        makeEdge({
          id: 'e-gateD',
          fromNodeId: 'gate',
          toNodeId: 'D',
          conditionValue: 'pass',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(3); // A, B, C are roots

      // Complete A with "ok"
      await completeNode(engine, store, 'A', 'job-A', 'ok');
      // Gate not yet ready — B and C still running

      // Complete B with "ng"
      await completeNode(engine, store, 'B', 'job-B', 'ng');
      // Gate still not ready — C still running

      // Complete C with "ng" → all sources terminal → gate evaluates
      // OR gate: A="ok" matches → pass → D runs
      store.createNodeRun
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-gate',
            nodeId: 'gate',
            orchestrationRunId: 'run-1',
            status: 'completed',
            returnValue: 'pass',
          }),
        )
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-D',
            nodeId: 'D',
            orchestrationRunId: 'run-1',
            status: 'running',
            jobId: 'job-D',
          }),
        );
      await completeNode(engine, store, 'C', 'job-C', 'ng');

      // D should have been created
      const dCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'D' && call[0]?.status !== 'skipped',
      );
      expect(dCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('4.2 AND gate fail → branching', async () => {
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({
          id: 'gate',
          label: 'Gate',
          nodeType: 'gate',
          tool: null,
          prompt: null,
          gateCondition: { mode: 'and', matchValue: 'ok' },
        }),
        makeNode({ id: 'C', label: 'C (happy)' }),
        makeNode({ id: 'D', label: 'D (fallback)' }),
      ];
      const edges = [
        makeEdge({ id: 'e-Agate', fromNodeId: 'A', toNodeId: 'gate' }),
        makeEdge({ id: 'e-Bgate', fromNodeId: 'B', toNodeId: 'gate' }),
        makeEdge({
          id: 'e-gateC',
          fromNodeId: 'gate',
          toNodeId: 'C',
          conditionValue: 'pass',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'e-gateD',
          fromNodeId: 'gate',
          toNodeId: 'D',
          conditionValue: 'fail',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(2); // A, B

      await completeNode(engine, store, 'A', 'job-A', 'ok');
      // B still running, gate not ready

      // Complete B with "ng" → gate evaluates AND("ok","ng") → fail
      // Gate: fail → edge to D matches, edge to C does not
      store.createNodeRun
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-gate',
            nodeId: 'gate',
            orchestrationRunId: 'run-1',
            status: 'completed',
            returnValue: 'fail',
          }),
        )
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-D',
            nodeId: 'D',
            orchestrationRunId: 'run-1',
            status: 'running',
            jobId: 'job-D',
          }),
        );
      await completeNode(engine, store, 'B', 'job-B', 'ng');

      // D should have been created (fallback path)
      const dCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'D' && call[0]?.status !== 'skipped',
      );
      expect(dCalls.length).toBeGreaterThanOrEqual(1);

      // C should not have been created as running
      const cRunningCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'C' && call[0]?.status === 'running',
      );
      expect(cRunningCalls).toHaveLength(0);
    });

    it('4.3 fan-out → gate → fan-out (3 stages)', async () => {
      // A→B,C (parallel), B,C→gate(AND,"ok"), gate→(pass)→D,E (parallel)
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
        makeNode({
          id: 'gate',
          label: 'Gate',
          nodeType: 'gate',
          tool: null,
          prompt: null,
          gateCondition: { mode: 'and', matchValue: 'ok' },
        }),
        makeNode({ id: 'D', label: 'D' }),
        makeNode({ id: 'E', label: 'E' }),
      ];
      const edges = [
        makeEdge({ id: 'e-AB', fromNodeId: 'A', toNodeId: 'B' }),
        makeEdge({ id: 'e-AC', fromNodeId: 'A', toNodeId: 'C' }),
        makeEdge({ id: 'e-Bgate', fromNodeId: 'B', toNodeId: 'gate' }),
        makeEdge({ id: 'e-Cgate', fromNodeId: 'C', toNodeId: 'gate' }),
        makeEdge({
          id: 'e-gateD',
          fromNodeId: 'gate',
          toNodeId: 'D',
          conditionValue: 'pass',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'e-gateE',
          fromNodeId: 'gate',
          toNodeId: 'E',
          conditionValue: 'pass',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1); // A

      await completeNode(engine, store, 'A', 'job-A', 'ok', [{ nodeId: 'B' }, { nodeId: 'C' }]);
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(3); // + B, C

      await completeNode(engine, store, 'B', 'job-B', 'ok');
      // Gate not ready, C still running

      // Complete C → gate evaluates AND("ok","ok") → pass → D,E both created
      store.createNodeRun
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-gate',
            nodeId: 'gate',
            orchestrationRunId: 'run-1',
            status: 'completed',
            returnValue: 'pass',
          }),
        )
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-D',
            nodeId: 'D',
            orchestrationRunId: 'run-1',
            status: 'running',
            jobId: 'job-D',
          }),
        )
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-E',
            nodeId: 'E',
            orchestrationRunId: 'run-1',
            status: 'running',
            jobId: 'job-E',
          }),
        );
      await completeNode(engine, store, 'C', 'job-C', 'ok');

      // D and E both should have been created
      const dCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'D' && call[0]?.status !== 'skipped',
      );
      const eCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'E' && call[0]?.status !== 'skipped',
      );
      expect(dCalls.length).toBeGreaterThanOrEqual(1);
      expect(eCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('4.4 all sources dead → gate skipped (cascading skip)', async () => {
      // X→(eq "go")→A, X→(eq "go")→B, A→gate(AND,"ok"), B→gate, gate→C
      const nodes = [
        makeNode({ id: 'X', label: 'X' }),
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({
          id: 'gate',
          label: 'Gate',
          nodeType: 'gate',
          tool: null,
          prompt: null,
          gateCondition: { mode: 'and', matchValue: 'ok' },
        }),
        makeNode({ id: 'C', label: 'C' }),
      ];
      const edges = [
        makeEdge({
          id: 'e-XA',
          fromNodeId: 'X',
          toNodeId: 'A',
          conditionValue: 'go',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'e-XB',
          fromNodeId: 'X',
          toNodeId: 'B',
          conditionValue: 'go',
          conditionOperator: 'eq',
        }),
        makeEdge({ id: 'e-Agate', fromNodeId: 'A', toNodeId: 'gate' }),
        makeEdge({ id: 'e-Bgate', fromNodeId: 'B', toNodeId: 'gate' }),
        makeEdge({
          id: 'e-gateC',
          fromNodeId: 'gate',
          toNodeId: 'C',
          conditionValue: 'pass',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1); // X

      // X returns "stop" → A,B skipped → gate skipped → C skipped
      // All downstream persisted as skipped during finalization
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({ id: 'nr-A-skip', nodeId: 'A', status: 'skipped' }),
      );
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({ id: 'nr-B-skip', nodeId: 'B', status: 'skipped' }),
      );
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({ id: 'nr-gate-skip', nodeId: 'gate', status: 'skipped' }),
      );
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({ id: 'nr-C-skip', nodeId: 'C', status: 'skipped' }),
      );
      await completeNode(engine, store, 'X', 'job-X', 'stop');

      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });
  });

  // ── Error Policy Combinations ──────────────────────────────

  describe('error policy combinations', () => {
    it('6.1 continue + mixed failure/success → downstream runs', async () => {
      // A→B(fails), A→C(succeeds), B→D, C→D
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
        makeNode({ id: 'D', label: 'D' }),
      ];
      const edges = [
        makeEdge({ id: 'e-AB', fromNodeId: 'A', toNodeId: 'B' }),
        makeEdge({ id: 'e-AC', fromNodeId: 'A', toNodeId: 'C' }),
        makeEdge({ id: 'e-BD', fromNodeId: 'B', toNodeId: 'D' }),
        makeEdge({ id: 'e-CD', fromNodeId: 'C', toNodeId: 'D' }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10, errorPolicy: 'continue' }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');

      // Complete A → B,C in parallel
      await completeNode(engine, store, 'A', 'job-A', 'ok', [{ nodeId: 'B' }, { nodeId: 'C' }]);

      // B fails
      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-B',
          nodeId: 'B',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-B',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-B',
          nodeId: 'B',
          orchestrationRunId: 'run-1',
          status: 'failed',
          errorMessage: 'timeout',
        }),
      );
      await engine.onNodeJobComplete(
        'job-B',
        { exitCode: 1, events: [], errorKind: 'timeout' },
        'failed',
        'failed',
      );

      // C succeeds → D should run (has one live path from C even though B failed)
      await completeNode(engine, store, 'C', 'job-C', 'ok', [{ nodeId: 'D' }]);

      // D should have been created
      const dCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'D' && call[0]?.status !== 'skipped',
      );
      expect(dCalls.length).toBeGreaterThanOrEqual(1);

      // Complete D → run finalizes as 'failed' (anyFailed=true from B)
      await completeNode(engine, store, 'D', 'job-D', 'ok');

      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'failed' }),
      );
    });

    it('6.2 fail_fast + running sibling cancelled', async () => {
      // Roots: A, B. maxParallelism=2, errorPolicy=fail_fast
      const nodes = [makeNode({ id: 'A', label: 'A' }), makeNode({ id: 'B', label: 'B' })];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 2, errorPolicy: 'fail_fast' }),
        nodes,
        edges: [],
      });
      store.createRun.mockReturnValue(makeRun());

      // createNodeRun must include sessionKey so that finalizeRun can call cancelJob
      let sessIdx = 0;
      store.createNodeRun.mockImplementation((input: { nodeId: string }) => {
        sessIdx++;
        return makeNodeRun({
          id: `nr-${input.nodeId}`,
          nodeId: input.nodeId,
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: `job-${input.nodeId}`,
          sessionKey: `sess-ff-${sessIdx}`,
        });
      });

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(2); // A and B

      // A fails
      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-A',
          nodeId: 'A',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-A',
          sessionKey: 'sess-ff-1',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-A',
          nodeId: 'A',
          orchestrationRunId: 'run-1',
          status: 'failed',
          errorMessage: 'timeout',
        }),
      );

      await engine.onNodeJobComplete(
        'job-A',
        { exitCode: 1, events: [], errorKind: 'timeout' },
        'failed',
        'failed',
      );

      // fail_fast should finalize the run as failed
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'failed' }),
      );

      // B should be cancelled (cancelJob called) and its nodeRun marked as skipped
      // Note: finalizeRun marks running nodes as 'cancelled' only when the run itself is cancelled;
      // for fail_fast (status='failed'), running siblings get 'skipped' but still get cancelJob called.
      expect(ctx.cancelJob).toHaveBeenCalledWith('sess-ff-2');
      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-B',
        expect.objectContaining({ status: 'skipped' }),
      );
    });

    it('6.3 error_return → downstream success', async () => {
      // A(returnValues=["ok"], maxRetries=0) →(eq "error_return")→ error-handler →end
      // A →(eq "ok")→ happy-path →end
      const nodes = [
        makeNode({ id: 'A', label: 'A', returnValues: ['ok', 'error_return'], maxRetries: 0 }),
        makeNode({ id: 'error-handler', label: 'Error Handler' }),
        makeNode({ id: 'happy-path', label: 'Happy Path' }),
        makeNode({ id: 'end', label: 'End', nodeType: 'end', tool: null, prompt: null }),
      ];
      const edges = [
        makeEdge({
          id: 'e-A-error',
          fromNodeId: 'A',
          toNodeId: 'error-handler',
          conditionValue: 'error_return',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'e-A-happy',
          fromNodeId: 'A',
          toNodeId: 'happy-path',
          conditionValue: 'ok',
          conditionOperator: 'eq',
        }),
        makeEdge({ id: 'e-error-end', fromNodeId: 'error-handler', toNodeId: 'end' }),
        makeEdge({ id: 'e-happy-end', fromNodeId: 'happy-path', toNodeId: 'end' }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 5, errorPolicy: 'continue' }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1); // A

      // A fails with errorKind="timeout", retries=0, has returnValues → error_return routing
      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-A',
          nodeId: 'A',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-A',
          retryCount: 0,
        }),
      );
      // After update, status becomes 'completed' with returnValue='error_return'
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-A',
          nodeId: 'A',
          orchestrationRunId: 'run-1',
          status: 'completed',
          returnValue: 'error_return',
        }),
      );

      // error-handler should be created
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({
          id: 'nr-error-handler',
          nodeId: 'error-handler',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-error-handler',
        }),
      );

      await engine.onNodeJobComplete(
        'job-A',
        { exitCode: 1, events: [], errorKind: 'timeout' },
        'no output',
        'no output',
      );

      // The node should have been updated with status='completed' and returnValue='error_return'
      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-A',
        expect.objectContaining({
          status: 'completed',
          returnValue: 'error_return',
        }),
      );

      // error-handler should have been created
      const errorHandlerCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'error-handler' && call[0]?.status !== 'skipped',
      );
      expect(errorHandlerCalls.length).toBeGreaterThanOrEqual(1);

      // Complete error-handler → end completes synchronously → run completes
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({
          id: 'nr-end',
          nodeId: 'end',
          orchestrationRunId: 'run-1',
          status: 'completed',
          returnValue: 'workflow_ended',
        }),
      );
      // happy-path skipped during finalization
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({ id: 'nr-happy-skip', nodeId: 'happy-path', status: 'skipped' }),
      );
      await completeNode(engine, store, 'error-handler', 'job-error-handler', 'ok');

      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });
  });

  // ── Rerun Scenarios ────────────────────────────────────────

  describe('rerun scenarios', () => {
    it('7.1 rerun from middle node with gate re-evaluation', async () => {
      // DAG: A→B→gate(AND,"ok")→C
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({
          id: 'gate',
          label: 'Gate',
          nodeType: 'gate',
          tool: null,
          prompt: null,
          gateCondition: { mode: 'and', matchValue: 'ok' },
        }),
        makeNode({ id: 'C', label: 'C' }),
      ];
      const edges = [
        makeEdge({ id: 'e-AB', fromNodeId: 'A', toNodeId: 'B' }),
        makeEdge({ id: 'e-Bgate', fromNodeId: 'B', toNodeId: 'gate' }),
        makeEdge({
          id: 'e-gateC',
          fromNodeId: 'gate',
          toNodeId: 'C',
          conditionValue: 'pass',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10 }),
        nodes,
        edges,
      });

      // Original run data
      const originalRun = makeRun({ id: 'original-run', status: 'completed' });
      store.getRunById.mockReturnValue(originalRun);

      // Original node runs — A and B completed
      store.getNodeRunsByRun.mockReturnValue([
        makeNodeRun({
          id: 'nr-orig-A',
          nodeId: 'A',
          orchestrationRunId: 'original-run',
          status: 'completed',
          returnValue: 'ok',
          exitCode: 0,
          outputSummary: 'A output',
        }),
        makeNodeRun({
          id: 'nr-orig-B',
          nodeId: 'B',
          orchestrationRunId: 'original-run',
          status: 'completed',
          returnValue: 'ok',
          exitCode: 0,
          outputSummary: 'B output',
        }),
      ]);

      // New run for rerun
      store.createRun.mockReturnValue(makeRun({ id: 'rerun-1' }));

      // A's nodeRun is copied (ancestor of B)
      store.createNodeRun
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-rerun-A',
            nodeId: 'A',
            orchestrationRunId: 'rerun-1',
            status: 'completed',
            returnValue: 'ok',
          }),
        )
        // B is re-executed
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-rerun-B',
            nodeId: 'B',
            orchestrationRunId: 'rerun-1',
            status: 'running',
            jobId: 'job-B-rerun',
          }),
        );

      const rerunId = await engine.startRerun('original-run', 'B');
      expect(rerunId).toBe('rerun-1');

      // A should be copied with completed status
      expect(store.createNodeRun).toHaveBeenCalledWith(
        expect.objectContaining({
          orchestrationRunId: 'rerun-1',
          nodeId: 'A',
          status: 'completed',
          returnValue: 'ok',
        }),
      );

      // B should be re-executed (running)
      expect(store.createNodeRun).toHaveBeenCalledWith(
        expect.objectContaining({
          orchestrationRunId: 'rerun-1',
          nodeId: 'B',
          status: 'running',
        }),
      );
    });

    it('7.2 rerun from failed node', async () => {
      // DAG: A→B→C
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
      ];
      const edges = [
        makeEdge({ id: 'e-AB', fromNodeId: 'A', toNodeId: 'B' }),
        makeEdge({ id: 'e-BC', fromNodeId: 'B', toNodeId: 'C' }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10 }),
        nodes,
        edges,
      });

      // Original run data
      const originalRun = makeRun({ id: 'original-run', status: 'failed' });
      store.getRunById.mockReturnValue(originalRun);

      // Original node runs — A completed, B failed
      store.getNodeRunsByRun.mockReturnValue([
        makeNodeRun({
          id: 'nr-orig-A',
          nodeId: 'A',
          orchestrationRunId: 'original-run',
          status: 'completed',
          returnValue: 'ok',
          exitCode: 0,
          outputSummary: 'A output',
        }),
        makeNodeRun({
          id: 'nr-orig-B',
          nodeId: 'B',
          orchestrationRunId: 'original-run',
          status: 'failed',
          errorMessage: 'timeout',
        }),
      ]);

      // New run
      store.createRun.mockReturnValue(makeRun({ id: 'rerun-2' }));

      // A copied, B re-executed
      store.createNodeRun
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-rerun-A',
            nodeId: 'A',
            orchestrationRunId: 'rerun-2',
            status: 'completed',
            returnValue: 'ok',
          }),
        )
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-rerun-B',
            nodeId: 'B',
            orchestrationRunId: 'rerun-2',
            status: 'running',
            jobId: 'job-B-rerun',
          }),
        );

      const rerunId = await engine.startRerun('original-run', 'B');
      expect(rerunId).toBe('rerun-2');

      // A should be copied
      expect(store.createNodeRun).toHaveBeenCalledWith(
        expect.objectContaining({
          orchestrationRunId: 'rerun-2',
          nodeId: 'A',
          status: 'completed',
        }),
      );

      // B should be re-executed
      expect(store.createNodeRun).toHaveBeenCalledWith(
        expect.objectContaining({
          orchestrationRunId: 'rerun-2',
          nodeId: 'B',
          status: 'running',
        }),
      );
    });

    it('7.3 rerun with timeout', async () => {
      // DAG: A→B, timeoutSec=5
      const nodes = [makeNode({ id: 'A', label: 'A' }), makeNode({ id: 'B', label: 'B' })];
      const edges = [makeEdge({ id: 'e-AB', fromNodeId: 'A', toNodeId: 'B' })];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10, timeoutSec: 5 }),
        nodes,
        edges,
      });

      const originalRun = makeRun({ id: 'original-run', status: 'completed' });
      store.getRunById.mockReturnValue(originalRun);
      store.getNodeRunsByRun.mockReturnValue([]);

      store.createRun.mockReturnValue(makeRun({ id: 'rerun-3' }));

      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({
          id: 'nr-rerun-A',
          nodeId: 'A',
          orchestrationRunId: 'rerun-3',
          status: 'running',
          jobId: 'job-A-rerun',
        }),
      );

      const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      await engine.startRerun('original-run', undefined, 'dashboard', 'user-1');

      // setTimeout should have been called with 5000ms for the timeout
      const timeoutCalls = timeoutSpy.mock.calls.filter(
        (call) => typeof call[1] === 'number' && call[1] === 5000,
      );
      expect(timeoutCalls.length).toBeGreaterThanOrEqual(1);

      // Advancing time should trigger timeout
      vi.advanceTimersByTime(5000);

      expect(store.updateRun).toHaveBeenCalledWith(
        'rerun-3',
        expect.objectContaining({
          status: 'failed',
          errorMessage: expect.stringContaining('timeout'),
        }),
      );
    });
  });

  // ── Edge Cases: Gate Readiness, Edge Evaluation, and Parallelism ──

  describe('edge cases: gate readiness, edge evaluation, and parallelism', () => {
    it('8.1 gate with single incoming edge (single source)', async () => {
      // DAG: A(task) → gate(AND, matchValue="ok") → B(task)
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({
          id: 'gate',
          label: 'Gate',
          nodeType: 'gate',
          tool: null,
          prompt: null,
          gateCondition: { mode: 'and', matchValue: 'ok' },
        }),
        makeNode({ id: 'B', label: 'B' }),
      ];
      const edges = [
        makeEdge({ id: 'e-Agate', fromNodeId: 'A', toNodeId: 'gate' }),
        makeEdge({
          id: 'e-gateB',
          fromNodeId: 'gate',
          toNodeId: 'B',
          conditionValue: 'pass',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1); // A

      // Complete A with "ok" → gate evaluates with single source → pass → B runs
      store.createNodeRun
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-gate',
            nodeId: 'gate',
            orchestrationRunId: 'run-1',
            status: 'completed',
            returnValue: 'pass',
          }),
        )
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-B',
            nodeId: 'B',
            orchestrationRunId: 'run-1',
            status: 'running',
            jobId: 'job-B',
          }),
        );
      await completeNode(engine, store, 'A', 'job-A', 'ok');

      // Gate should have been created with returnValue='pass'
      const gateCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; returnValue?: string }>) =>
          call[0]?.nodeId === 'gate' && call[0]?.returnValue === 'pass',
      );
      expect(gateCalls.length).toBeGreaterThanOrEqual(1);

      // B should have been enqueued
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(2); // A + B
    });

    it('8.2 pure gate→gate→gate synchronous cascade', async () => {
      // DAG: A(task) → gate1(AND,"ok") → gate2(AND,"pass") → gate3(AND,"pass") → B(task)
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({
          id: 'gate1',
          label: 'Gate 1',
          nodeType: 'gate',
          tool: null,
          prompt: null,
          gateCondition: { mode: 'and', matchValue: 'ok' },
        }),
        makeNode({
          id: 'gate2',
          label: 'Gate 2',
          nodeType: 'gate',
          tool: null,
          prompt: null,
          gateCondition: { mode: 'and', matchValue: 'pass' },
        }),
        makeNode({
          id: 'gate3',
          label: 'Gate 3',
          nodeType: 'gate',
          tool: null,
          prompt: null,
          gateCondition: { mode: 'and', matchValue: 'pass' },
        }),
        makeNode({ id: 'B', label: 'B' }),
      ];
      const edges = [
        makeEdge({ id: 'e-Agate1', fromNodeId: 'A', toNodeId: 'gate1' }),
        makeEdge({
          id: 'e-gate1gate2',
          fromNodeId: 'gate1',
          toNodeId: 'gate2',
          conditionValue: 'pass',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'e-gate2gate3',
          fromNodeId: 'gate2',
          toNodeId: 'gate3',
          conditionValue: 'pass',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'e-gate3B',
          fromNodeId: 'gate3',
          toNodeId: 'B',
          conditionValue: 'pass',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1); // A

      // Complete A with "ok" → gate1(pass) → gate2(pass) → gate3(pass) → B enqueued
      // All 3 gates + B creation happen synchronously in one advanceExecution loop
      store.createNodeRun
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-gate1',
            nodeId: 'gate1',
            orchestrationRunId: 'run-1',
            status: 'completed',
            returnValue: 'pass',
          }),
        )
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-gate2',
            nodeId: 'gate2',
            orchestrationRunId: 'run-1',
            status: 'completed',
            returnValue: 'pass',
          }),
        )
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-gate3',
            nodeId: 'gate3',
            orchestrationRunId: 'run-1',
            status: 'completed',
            returnValue: 'pass',
          }),
        )
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-B',
            nodeId: 'B',
            orchestrationRunId: 'run-1',
            status: 'running',
            jobId: 'job-B',
          }),
        );
      await completeNode(engine, store, 'A', 'job-A', 'ok');

      // All 3 gates should have been created with returnValue='pass'
      for (const gateId of ['gate1', 'gate2', 'gate3']) {
        const calls = store.createNodeRun.mock.calls.filter(
          (call: Array<{ nodeId: string; returnValue?: string }>) =>
            call[0]?.nodeId === gateId && call[0]?.returnValue === 'pass',
        );
        expect(calls.length).toBeGreaterThanOrEqual(1);
      }

      // enqueueJob called exactly 2 times: A (startRun) + B (after gate cascade)
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(2);
    });

    it('8.3 deep recursive isNodeSkippable chain (4 levels)', async () => {
      // DAG: X(task) → (eq "go")→ A → B → C → D
      const nodes = [
        makeNode({ id: 'X', label: 'X' }),
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
        makeNode({ id: 'D', label: 'D' }),
      ];
      const edges = [
        makeEdge({
          id: 'e-XA',
          fromNodeId: 'X',
          toNodeId: 'A',
          conditionValue: 'go',
          conditionOperator: 'eq',
        }),
        makeEdge({ id: 'e-AB', fromNodeId: 'A', toNodeId: 'B' }),
        makeEdge({ id: 'e-BC', fromNodeId: 'B', toNodeId: 'C' }),
        makeEdge({ id: 'e-CD', fromNodeId: 'C', toNodeId: 'D' }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1); // X

      // X completes with "stop" (doesn't match "go")
      // A is skippable → B is skippable → C is skippable → D is skippable
      // Run should finalize as 'completed' with all 4 nodes persisted as skipped
      await completeNode(engine, store, 'X', 'job-X', 'stop');

      // Verify createNodeRun was called with status='skipped' for A, B, C, D
      for (const nodeId of ['A', 'B', 'C', 'D']) {
        const skippedCalls = store.createNodeRun.mock.calls.filter(
          (call: Array<{ nodeId: string; status?: string }>) =>
            call[0]?.nodeId === nodeId && call[0]?.status === 'skipped',
        );
        expect(skippedCalls.length).toBeGreaterThanOrEqual(1);
      }

      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('8.4 isTaskReady with mixed source states (one completed+unmatched, one still running)', async () => {
      // DAG: A(task) → (eq "right")→ D(task), B(task) → D
      // Roots: A, B (both roots)
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'D', label: 'D' }),
      ];
      const edges = [
        makeEdge({
          id: 'e-AD',
          fromNodeId: 'A',
          toNodeId: 'D',
          conditionValue: 'right',
          conditionOperator: 'eq',
        }),
        makeEdge({ id: 'e-BD', fromNodeId: 'B', toNodeId: 'D' }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(2); // A, B (both roots)

      // A completes with "left" (doesn't match edge condition "right")
      // B is still running → D should NOT be ready yet
      await completeNode(engine, store, 'A', 'job-A', 'left');
      // D should not have been created (B hasn't completed)
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(2); // no new enqueues

      // B completes with "ok" → unconditional edge from B matches → D should run
      await completeNode(engine, store, 'B', 'job-B', 'ok', [{ nodeId: 'D' }]);
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(3); // + D
    });

    it('8.5 multiple edges from same source to same target with different conditions', async () => {
      // DAG: A(task) with 2 edges to B(task): A→(eq "left")→B, A→(eq "right")→B
      const nodes = [makeNode({ id: 'A', label: 'A' }), makeNode({ id: 'B', label: 'B' })];
      const edges = [
        makeEdge({
          id: 'e-AB-left',
          fromNodeId: 'A',
          toNodeId: 'B',
          conditionValue: 'left',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'e-AB-right',
          fromNodeId: 'A',
          toNodeId: 'B',
          conditionValue: 'right',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1); // A

      // A completes with "left" → first edge matches → B should run
      await completeNode(engine, store, 'A', 'job-A', 'left', [{ nodeId: 'B' }]);
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(2); // + B

      const bCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'B' && call[0]?.status !== 'skipped',
      );
      expect(bCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('8.6 fan-in with different edge conditions from different sources', async () => {
      // DAG: A(task) → (eq "ok")→ D(task), B(task) → (eq "fail")→ D
      // Roots: A, B
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'D', label: 'D' }),
      ];
      const edges = [
        makeEdge({
          id: 'e-AD',
          fromNodeId: 'A',
          toNodeId: 'D',
          conditionValue: 'ok',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'e-BD',
          fromNodeId: 'B',
          toNodeId: 'D',
          conditionValue: 'fail',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(2); // A, B

      // A returns "ok" (matches A→D edge)
      await completeNode(engine, store, 'A', 'job-A', 'ok');

      // B returns "ok" (doesn't match B→D "fail" edge)
      // D should run because at least one edge matched (A→D)
      await completeNode(engine, store, 'B', 'job-B', 'ok', [{ nodeId: 'D' }]);

      // D should have been created
      const dCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'D' && call[0]?.status !== 'skipped',
      );
      expect(dCalls.length).toBeGreaterThanOrEqual(1);
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(3); // A + B + D
    });

    it('8.7 maxParallelism blocks gate upstream, then releases', async () => {
      // DAG: A(task)→gate(AND,"ok"), B(task)→gate, C(task)→gate, gate→D(task)
      // Roots: A, B, C; maxParallelism=2
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
        makeNode({
          id: 'gate',
          label: 'Gate',
          nodeType: 'gate',
          tool: null,
          prompt: null,
          gateCondition: { mode: 'and', matchValue: 'ok' },
        }),
        makeNode({ id: 'D', label: 'D' }),
      ];
      const edges = [
        makeEdge({ id: 'e-Agate', fromNodeId: 'A', toNodeId: 'gate' }),
        makeEdge({ id: 'e-Bgate', fromNodeId: 'B', toNodeId: 'gate' }),
        makeEdge({ id: 'e-Cgate', fromNodeId: 'C', toNodeId: 'gate' }),
        makeEdge({
          id: 'e-gateD',
          fromNodeId: 'gate',
          toNodeId: 'D',
          conditionValue: 'pass',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 2 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');
      // A,B start (2 slots full). C waits.
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(2);

      // A completes "ok" → C starts (slot freed). Gate not ready (B,C not done).
      await completeNode(engine, store, 'A', 'job-A', 'ok', [{ nodeId: 'C' }]);
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(3); // + C

      // B completes "ok" → gate not ready (C still running)
      await completeNode(engine, store, 'B', 'job-B', 'ok');
      // Gate should NOT have been evaluated yet
      const gateCallsBeforeC = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string }>) => call[0]?.nodeId === 'gate',
      );
      expect(gateCallsBeforeC).toHaveLength(0);

      // C completes "ok" → gate evaluates → pass → D starts
      store.createNodeRun
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-gate',
            nodeId: 'gate',
            orchestrationRunId: 'run-1',
            status: 'completed',
            returnValue: 'pass',
          }),
        )
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-D',
            nodeId: 'D',
            orchestrationRunId: 'run-1',
            status: 'running',
            jobId: 'job-D',
          }),
        );
      await completeNode(engine, store, 'C', 'job-C', 'ok');

      // Gate should now be evaluated
      const gateCallsAfterC = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; returnValue?: string }>) =>
          call[0]?.nodeId === 'gate' && call[0]?.returnValue === 'pass',
      );
      expect(gateCallsAfterC.length).toBeGreaterThanOrEqual(1);

      // D should have been enqueued
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(4); // A + B + C + D
    });

    it('8.8 gate OR with all sources returning null (no return tag)', async () => {
      // DAG: A(task)→gate(OR,"ok"), B(task)→gate, C(task)→gate,
      //      gate→(eq "pass")→D(task), gate→(eq "fail")→E(task)
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
        makeNode({
          id: 'gate',
          label: 'Gate',
          nodeType: 'gate',
          tool: null,
          prompt: null,
          gateCondition: { mode: 'or', matchValue: 'ok' },
        }),
        makeNode({ id: 'D', label: 'D' }),
        makeNode({ id: 'E', label: 'E' }),
      ];
      const edges = [
        makeEdge({ id: 'e-Agate', fromNodeId: 'A', toNodeId: 'gate' }),
        makeEdge({ id: 'e-Bgate', fromNodeId: 'B', toNodeId: 'gate' }),
        makeEdge({ id: 'e-Cgate', fromNodeId: 'C', toNodeId: 'gate' }),
        makeEdge({
          id: 'e-gateD',
          fromNodeId: 'gate',
          toNodeId: 'D',
          conditionValue: 'pass',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'e-gateE',
          fromNodeId: 'gate',
          toNodeId: 'E',
          conditionValue: 'fail',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(3); // A, B, C (all roots)

      // A, B complete with "other_return" (no return tag → OTHER_RETURN in handleNodeJobComplete)
      // We simulate this by having their nodeRuns show returnValue='other_return'
      await completeNode(engine, store, 'A', 'job-A', 'other_return');
      await completeNode(engine, store, 'B', 'job-B', 'other_return');

      // C completes with "other_return" → gate evaluates OR with ['other_return','other_return','other_return']
      // matchValue="ok" → none match → fail
      // Gate fail → D skipped (edge requires "pass"), E runs (edge requires "fail")
      store.createNodeRun
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-gate',
            nodeId: 'gate',
            orchestrationRunId: 'run-1',
            status: 'completed',
            returnValue: 'fail',
          }),
        )
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-E',
            nodeId: 'E',
            orchestrationRunId: 'run-1',
            status: 'running',
            jobId: 'job-E',
          }),
        );
      await completeNode(engine, store, 'C', 'job-C', 'other_return');

      // Gate should have returnValue='fail'
      const gateCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; returnValue?: string }>) =>
          call[0]?.nodeId === 'gate' && call[0]?.returnValue === 'fail',
      );
      expect(gateCalls.length).toBeGreaterThanOrEqual(1);

      // E should have been enqueued (fail path)
      const eCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'E' && call[0]?.status !== 'skipped',
      );
      expect(eCalls.length).toBeGreaterThanOrEqual(1);

      // D should NOT have been created as running (pass path dead)
      const dRunningCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'D' && call[0]?.status === 'running',
      );
      expect(dRunningCalls).toHaveLength(0);
    });

    it('8.9 maxParallelism=2 with fan-out→gate→fan-out (slot constraint throughout)', async () => {
      // DAG: A(task)→B(task), A→C(task), B→gate(AND,"ok"), C→gate, gate→(pass)→D(task), gate→(pass)→E(task)
      // maxParallelism=2
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
        makeNode({
          id: 'gate',
          label: 'Gate',
          nodeType: 'gate',
          tool: null,
          prompt: null,
          gateCondition: { mode: 'and', matchValue: 'ok' },
        }),
        makeNode({ id: 'D', label: 'D' }),
        makeNode({ id: 'E', label: 'E' }),
      ];
      const edges = [
        makeEdge({ id: 'e-AB', fromNodeId: 'A', toNodeId: 'B' }),
        makeEdge({ id: 'e-AC', fromNodeId: 'A', toNodeId: 'C' }),
        makeEdge({ id: 'e-Bgate', fromNodeId: 'B', toNodeId: 'gate' }),
        makeEdge({ id: 'e-Cgate', fromNodeId: 'C', toNodeId: 'gate' }),
        makeEdge({
          id: 'e-gateD',
          fromNodeId: 'gate',
          toNodeId: 'D',
          conditionValue: 'pass',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'e-gateE',
          fromNodeId: 'gate',
          toNodeId: 'E',
          conditionValue: 'pass',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 2 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1); // A

      // A completes → B,C start (2 slots)
      await completeNode(engine, store, 'A', 'job-A', 'ok', [{ nodeId: 'B' }, { nodeId: 'C' }]);
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(3); // A + B + C

      // B completes "ok" → slot freed, gate not ready (C running)
      await completeNode(engine, store, 'B', 'job-B', 'ok');

      // C completes "ok" → gate evaluates (pass) → D,E both start (2 slots available)
      store.createNodeRun
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-gate',
            nodeId: 'gate',
            orchestrationRunId: 'run-1',
            status: 'completed',
            returnValue: 'pass',
          }),
        )
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-D',
            nodeId: 'D',
            orchestrationRunId: 'run-1',
            status: 'running',
            jobId: 'job-D',
          }),
        )
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-E',
            nodeId: 'E',
            orchestrationRunId: 'run-1',
            status: 'running',
            jobId: 'job-E',
          }),
        );
      await completeNode(engine, store, 'C', 'job-C', 'ok');

      // D and E both enqueued (no slot starvation)
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(5); // A + B + C + D + E

      const dCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'D' && call[0]?.status !== 'skipped',
      );
      const eCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'E' && call[0]?.status !== 'skipped',
      );
      expect(dCalls.length).toBeGreaterThanOrEqual(1);
      expect(eCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('8.10 all conditions unmatched with gate downstream — cascading skip', async () => {
      // DAG: A(task) → (eq "yes")→ B(task) → gate(AND,"ok"), A → (eq "no")→ C(task) → gate, gate → D
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
        makeNode({
          id: 'gate',
          label: 'Gate',
          nodeType: 'gate',
          tool: null,
          prompt: null,
          gateCondition: { mode: 'and', matchValue: 'ok' },
        }),
        makeNode({ id: 'D', label: 'D' }),
      ];
      const edges = [
        makeEdge({
          id: 'e-AB',
          fromNodeId: 'A',
          toNodeId: 'B',
          conditionValue: 'yes',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'e-AC',
          fromNodeId: 'A',
          toNodeId: 'C',
          conditionValue: 'no',
          conditionOperator: 'eq',
        }),
        makeEdge({ id: 'e-Bgate', fromNodeId: 'B', toNodeId: 'gate' }),
        makeEdge({ id: 'e-Cgate', fromNodeId: 'C', toNodeId: 'gate' }),
        makeEdge({
          id: 'e-gateD',
          fromNodeId: 'gate',
          toNodeId: 'D',
          conditionValue: 'pass',
          conditionOperator: 'eq',
        }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard');
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1); // A

      // A returns "maybe" → neither "yes" nor "no" matches
      // B skippable, C skippable → gate becomes ready (all sources terminal/skippable)
      // Gate evaluates with [null, null] (skipped sources have no completed nodeRun) → fail
      // D skippable (gate returned 'fail' but edge requires 'pass')
      // Gate is created synchronously by completeGateNode during advanceExecution
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({
          id: 'nr-gate',
          nodeId: 'gate',
          orchestrationRunId: 'run-1',
          status: 'completed',
          returnValue: 'fail',
        }),
      );
      await completeNode(engine, store, 'A', 'job-A', 'maybe');

      // Gate should have been created with status='completed' and returnValue='fail'
      const gateCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string; returnValue?: string }>) =>
          call[0]?.nodeId === 'gate' && call[0]?.status === 'completed',
      );
      expect(gateCalls.length).toBeGreaterThanOrEqual(1);

      // B, C should be persisted as skipped during finalization
      for (const nodeId of ['B', 'C']) {
        const skippedCalls = store.createNodeRun.mock.calls.filter(
          (call: Array<{ nodeId: string; status?: string }>) =>
            call[0]?.nodeId === nodeId && call[0]?.status === 'skipped',
        );
        expect(skippedCalls.length).toBeGreaterThanOrEqual(1);
      }

      // D should be persisted as skipped (gate returned 'fail', edge requires 'pass')
      const dSkippedCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'D' && call[0]?.status === 'skipped',
      );
      expect(dSkippedCalls.length).toBeGreaterThanOrEqual(1);

      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });
  });

  // ── trimRunWorkdirs Coverage (Gap A) ─────────────────────────

  describe('trimRunWorkdirs', () => {
    /**
     * Helper: create a single end-node DAG that completes synchronously,
     * triggering finalizeRun → trimRunWorkdirs immediately from startRun.
     */
    function setupSingleEndNodeDag(orchOverrides?: Partial<Orchestrator>) {
      const nodes = [
        makeNode({
          id: 'end-node',
          label: 'End',
          nodeType: 'end',
          tool: null,
          prompt: null,
        }),
      ];
      const edges: OrchestratorEdge[] = [];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator(orchOverrides),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      // End node will be created synchronously
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({
          id: 'nr-end-node',
          nodeId: 'end-node',
          orchestrationRunId: 'run-1',
          status: 'completed',
          returnValue: 'workflow_ended',
        }),
      );
    }

    it('A.1 skips when cleanupRunWorkdir is not provided', async () => {
      // ctx does NOT have cleanupRunWorkdir (default from createContext)
      setupSingleEndNodeDag();

      await engine.startRun('orch-1', 'dashboard');

      // Run should complete
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
      // getCompletedRunIds should NOT be called since cleanupRunWorkdir is undefined
      expect(store.getCompletedRunIds).not.toHaveBeenCalled();
    });

    it('A.2 skips when orchestrator has custom workdir', async () => {
      const cleanupRunWorkdir = vi.fn();
      // biome-ignore lint/suspicious/noExplicitAny: test-only property injection
      (ctx as any).cleanupRunWorkdir = cleanupRunWorkdir;
      // Recreate engine with updated ctx
      engine = new OrchestratorEngine(ctx);

      // Default makeOrchestrator has workdir: '/tmp/test-workdir'
      setupSingleEndNodeDag({ workdir: '/tmp/test-workdir' });

      await engine.startRun('orch-1', 'dashboard');

      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
      // Should return early because orchestrator.workdir is set
      expect(store.getCompletedRunIds).not.toHaveBeenCalled();
      expect(cleanupRunWorkdir).not.toHaveBeenCalled();
    });

    it('A.3 deletes all workdirs when maxRunWorkdirs=0', async () => {
      const cleanupRunWorkdir = vi.fn();
      // biome-ignore lint/suspicious/noExplicitAny: test-only property injection
      (ctx as any).cleanupRunWorkdir = cleanupRunWorkdir;
      engine = new OrchestratorEngine(ctx);

      setupSingleEndNodeDag({ workdir: null, maxRunWorkdirs: 0 });
      store.getCompletedRunIds.mockReturnValue(['run-old-1', 'run-old-2']);

      await engine.startRun('orch-1', 'dashboard');

      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
      expect(store.getCompletedRunIds).toHaveBeenCalledWith('orch-1');
      expect(cleanupRunWorkdir).toHaveBeenCalledWith('run-old-1');
      expect(cleanupRunWorkdir).toHaveBeenCalledWith('run-old-2');
      expect(cleanupRunWorkdir).toHaveBeenCalledTimes(2);
    });

    it('A.4 deletes excess workdirs beyond limit', async () => {
      const cleanupRunWorkdir = vi.fn();
      // biome-ignore lint/suspicious/noExplicitAny: test-only property injection
      (ctx as any).cleanupRunWorkdir = cleanupRunWorkdir;
      engine = new OrchestratorEngine(ctx);

      setupSingleEndNodeDag({ workdir: null, maxRunWorkdirs: 1 });
      store.getCompletedRunIds.mockReturnValue(['run-keep', 'run-old']);

      await engine.startRun('orch-1', 'dashboard');

      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
      expect(store.getCompletedRunIds).toHaveBeenCalledWith('orch-1');
      // Only 'run-old' should be deleted (slice(1) removes it)
      expect(cleanupRunWorkdir).toHaveBeenCalledWith('run-old');
      expect(cleanupRunWorkdir).not.toHaveBeenCalledWith('run-keep');
      expect(cleanupRunWorkdir).toHaveBeenCalledTimes(1);
    });

    it('A.5 handles cleanupRunWorkdir errors gracefully', async () => {
      const cleanupRunWorkdir = vi.fn(() => {
        throw new Error('cleanup error');
      });
      // biome-ignore lint/suspicious/noExplicitAny: test-only property injection
      (ctx as any).cleanupRunWorkdir = cleanupRunWorkdir;
      engine = new OrchestratorEngine(ctx);

      setupSingleEndNodeDag({ workdir: null, maxRunWorkdirs: 0 });
      store.getCompletedRunIds.mockReturnValue(['run-err']);

      // Should not throw
      await engine.startRun('orch-1', 'dashboard');

      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
      expect(cleanupRunWorkdir).toHaveBeenCalledWith('run-err');
    });
  });

  // ── Rerun: skip non-completed ancestor nodeRuns (Gap H) ────

  describe('rerun edge cases', () => {
    it('H: startRerun skips non-completed ancestor nodeRuns', async () => {
      // DAG: A → B → C
      // Original run: A completed, B failed
      // Rerun from C: only A (completed) should be copied as an ancestor.
      // B (failed) is NOT copied — it becomes a re-executed task during advanceExecution.
      const nodes = [
        makeNode({ id: 'A', label: 'A' }),
        makeNode({ id: 'B', label: 'B' }),
        makeNode({ id: 'C', label: 'C' }),
      ];
      const edges = [
        makeEdge({ id: 'e-AB', fromNodeId: 'A', toNodeId: 'B' }),
        makeEdge({ id: 'e-BC', fromNodeId: 'B', toNodeId: 'C' }),
      ];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 10 }),
        nodes,
        edges,
      });

      // Original run: A completed, B failed
      store.getRunById.mockReturnValue(
        makeRun({ id: 'original-run', status: 'failed', orchestratorId: 'orch-1' }),
      );
      store.getNodeRunsByRun.mockReturnValue([
        makeNodeRun({
          id: 'nr-orig-A',
          nodeId: 'A',
          orchestrationRunId: 'original-run',
          status: 'completed',
          returnValue: 'ok',
          exitCode: 0,
          outputSummary: 'A output',
        }),
        makeNodeRun({
          id: 'nr-orig-B',
          nodeId: 'B',
          orchestrationRunId: 'original-run',
          status: 'failed',
          returnValue: null,
          errorMessage: 'timeout',
        }),
      ]);

      // New run for rerun
      store.createRun.mockReturnValue(makeRun({ id: 'rerun-h' }));

      // A is copied (completed ancestor of C).
      // B is NOT copied (failed) — instead it becomes ready via advanceExecution
      // and is re-executed as a running task.
      store.createNodeRun
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-rerun-A',
            nodeId: 'A',
            orchestrationRunId: 'rerun-h',
            status: 'completed',
            returnValue: 'ok',
          }),
        )
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-rerun-B',
            nodeId: 'B',
            orchestrationRunId: 'rerun-h',
            status: 'running',
            jobId: 'job-B-rerun',
          }),
        );

      const rerunId = await engine.startRerun('original-run', 'C');
      expect(rerunId).toBe('rerun-h');

      // A should be copied with status='completed' (ancestor copy in the rerun loop)
      expect(store.createNodeRun).toHaveBeenCalledWith(
        expect.objectContaining({
          orchestrationRunId: 'rerun-h',
          nodeId: 'A',
          status: 'completed',
          returnValue: 'ok',
        }),
      );

      // B should NOT be copied as a completed ancestor — instead it is re-executed as 'running'.
      // Verify no createNodeRun call for B with status='completed' (i.e., not an ancestor copy).
      const bCompletedCopyCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'B' && call[0]?.status === 'completed',
      );
      expect(bCompletedCopyCalls).toHaveLength(0);

      // B should have been created as 'running' (re-executed by advanceExecution)
      const bRunningCalls = store.createNodeRun.mock.calls.filter(
        (call: Array<{ nodeId: string; status?: string }>) =>
          call[0]?.nodeId === 'B' && call[0]?.status === 'running',
      );
      expect(bRunningCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── normalizeStartRunOptions with string userId (Gap I) ────

  describe('normalizeStartRunOptions', () => {
    it('I: startRun with string userId sets triggeredUserId', async () => {
      const nodes = [makeNode({ id: 'A', label: 'A' })];
      const edges: OrchestratorEdge[] = [];

      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ maxParallelism: 5 }),
        nodes,
        edges,
      });
      store.createRun.mockReturnValue(makeRun());

      await engine.startRun('orch-1', 'dashboard', 'string-user-id');

      // createRun should be called with triggeredUserId set to the string value
      expect(store.createRun).toHaveBeenCalledWith(
        expect.objectContaining({
          triggeredUserId: 'string-user-id',
        }),
      );
    });
  });
});
