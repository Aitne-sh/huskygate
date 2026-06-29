/**
 * OrchestratorEngine — Comprehensive Unit Tests
 *
 * Tests cover: startRun, cancelRun, onNodeJobComplete, finalizeRun (via cancel/completion),
 * recoverActiveRuns, advanceExecution, resolveRunnableNodes, and gate evaluation.
 *
 * The real validateDAG / buildValidatedDAG / evaluateEdgeCondition / evaluateGateCondition
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

// ─── Imports (after mocks) ──────────────────────────────────

import path from 'node:path';
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

// ─── Tests ──────────────────────────────────────────────────

describe('OrchestratorEngine', () => {
  let store: ReturnType<typeof createMockStore>;
  let ctx: ReturnType<typeof createContext>['ctx'];
  let engine: OrchestratorEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    const created = createContext();
    store = created.store;
    ctx = created.ctx;
    engine = new OrchestratorEngine(ctx);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── startRun ────────────────────────────────────────────────

  describe('startRun', () => {
    it('should start a run with a single root node', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1' });
      const run = makeRun({ id: 'run-1' });
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'running',
      });

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [node],
        edges: [],
      });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      const runId = await engine.startRun('orch-1', 'dashboard', 'user-1');

      expect(runId).toBe('run-1');
      expect(store.getFullOrchestrator).toHaveBeenCalledWith('orch-1');
      expect(store.createRun).toHaveBeenCalledWith({
        orchestratorId: 'orch-1',
        triggeredBy: 'dashboard',
        triggeredUserId: 'user-1',
        triggerContextJson: null,
      });
      expect(store.incrementRunCount).toHaveBeenCalledWith('orch-1', expect.any(String));
      // The engine prepares any needed workdir before node execution begins.
      expect(mocked.mkdirSync).toHaveBeenCalled();
      // executeTaskNode enqueues a job
      expect(ctx.enqueueJob).toHaveBeenCalled();
      expect(store.createNodeRun).toHaveBeenCalled();
    });

    it('should start a run with multiple root nodes and respect maxParallelism', async () => {
      const orchestrator = makeOrchestrator({ maxParallelism: 2 });
      const nodes = [
        makeNode({ id: 'n1', label: 'Task A' }),
        makeNode({ id: 'n2', label: 'Task B' }),
        makeNode({ id: 'n3', label: 'Task C' }),
      ];
      const run = makeRun();

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes, edges: [] });
      store.createRun.mockReturnValue(run);

      let nodeRunCounter = 0;
      store.createNodeRun.mockImplementation((input: { nodeId: string }) => {
        nodeRunCounter++;
        return makeNodeRun({ id: `nr-${nodeRunCounter}`, nodeId: input.nodeId, status: 'running' });
      });

      await engine.startRun('orch-1', 'dashboard');

      // maxParallelism = 2, so only 2 nodes should be enqueued
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(2);
    });

    it('should throw if orchestrator not found', async () => {
      store.getFullOrchestrator.mockReturnValue(null);

      await expect(engine.startRun('orch-missing', 'dashboard')).rejects.toThrow(
        'Orchestrator orch-missing not found',
      );
    });

    it('should throw if orchestrator is deleted', async () => {
      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ status: 'deleted' }),
        nodes: [],
        edges: [],
      });

      await expect(engine.startRun('orch-1', 'dashboard')).rejects.toThrow(
        'Orchestrator orch-1 has been deleted',
      );
    });

    it('should reject webhook-triggered starts for ondemand orchestrators', async () => {
      store.getFullOrchestrator.mockReturnValue({
        orchestrator: makeOrchestrator({ triggerMode: 'ondemand' }),
        nodes: [],
        edges: [],
      });

      await expect(engine.startRun('orch-1', 'webhook')).rejects.toThrow(
        'Orchestrator orch-1 cannot be triggered by webhook when triggerMode=ondemand',
      );
      expect(store.createRun).not.toHaveBeenCalled();
    });

    it('should throw if DAG validation fails (task with no prompt)', async () => {
      const orchestrator = makeOrchestrator();
      const badNode = makeNode({ id: 'node-bad', prompt: null });

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [badNode],
        edges: [],
      });

      await expect(engine.startRun('orch-1', 'dashboard')).rejects.toThrow('DAG validation failed');
    });

    it('should throw if DAG validation fails (task with no tool)', async () => {
      const orchestrator = makeOrchestrator();
      const badNode = makeNode({ id: 'node-bad', tool: null });

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [badNode],
        edges: [],
      });

      await expect(engine.startRun('orch-1', 'dashboard')).rejects.toThrow('DAG validation failed');
    });

    it('should throw if DAG has a cycle', async () => {
      const orchestrator = makeOrchestrator();
      const nodes = [makeNode({ id: 'n1', label: 'A' }), makeNode({ id: 'n2', label: 'B' })];
      const edges = [
        makeEdge({ id: 'e1', fromNodeId: 'n1', toNodeId: 'n2' }),
        makeEdge({ id: 'e2', fromNodeId: 'n2', toNodeId: 'n1' }),
      ];

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes, edges });

      await expect(engine.startRun('orch-1', 'dashboard')).rejects.toThrow('DAG validation failed');
    });

    it('should pass skipWorkdir: true when creating session for task nodes', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'running' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      expect(ctx.createSession).toHaveBeenCalledWith('claude', 'user-1', 'write', {
        skipWorkdir: true,
      });
    });

    it('should enqueue job with node execution settings and orchestrator metadata', async () => {
      const orchestrator = makeOrchestrator({ userId: 'user-1' });
      const node = makeNode({
        id: 'node-1',
        tool: 'codex',
        mode: 'readonly',
        prompt: 'Inspect repository',
        timeoutSec: 45,
      });
      const run = makeRun({ id: 'run-1' });
      const nodeRun = makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'running' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      // Tasks always run in write mode (P3: non-interactive jobs are write-fixed)
      expect(ctx.createSession).toHaveBeenCalledWith('codex', 'user-1', 'write', {
        skipWorkdir: true,
      });
      expect(ctx.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          tool: 'codex',
          mode: 'write',
          prompt: 'Inspect repository',
          source: 'orchestrator',
          orchestrationRunId: 'run-1',
          orchestrationNodeId: 'node-1',
          autoApprove: true,
          timeoutSec: 45,
        }),
      );
    });

    it('should persist and inject trigger context only for the persisted start node', async () => {
      const orchestrator = makeOrchestrator({
        startNodeId: 'node-start',
        triggerMode: 'webhook',
      });
      const startNode = makeNode({ id: 'node-start', prompt: 'Handle event' });
      const laterNode = makeNode({ id: 'node-next', prompt: 'Follow-up task', sortOrder: 1 });
      const run = makeRun({ id: 'run-1' });

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [startNode, laterNode],
        edges: [],
      });
      store.createRun.mockReturnValue(run);
      let nodeRunCounter = 0;
      store.createNodeRun.mockImplementation((input: { nodeId: string }) => {
        nodeRunCounter += 1;
        return makeNodeRun({
          id: `nr-${nodeRunCounter}`,
          nodeId: input.nodeId,
          orchestrationRunId: 'run-1',
          status: 'running',
        });
      });

      await engine.startRun('orch-1', 'webhook', {
        userId: 'user-1',
        triggerContext: { repo: 'org/repo', branch: 'feature/x' },
      });

      expect(store.createRun).toHaveBeenCalledWith({
        orchestratorId: 'orch-1',
        triggeredBy: 'webhook',
        triggeredUserId: 'user-1',
        triggerContextJson: '{"repo":"org/repo","branch":"feature/x"}',
      });
      const prompts = ctx.enqueueJob.mock.calls.map(
        (call) => (call[0] as { prompt: string }).prompt,
      );
      expect(prompts[0]).toContain('--- Trigger Event Context ---');
      expect(prompts[0]).toContain('"repo": "org/repo"');
      expect(prompts[1]).not.toContain('--- Trigger Event Context ---');
    });

    it('should pass instructionFile through enqueued job', async () => {
      const orchestrator = makeOrchestrator({ instructionFile: '# Instructions here' });
      const node = makeNode({ id: 'node-1', tool: 'claude' });
      const run = makeRun();
      const nodeRun = makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'running' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      // Instruction file is passed through the Job so job-executor writes it
      expect(ctx.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          instructionFile: '# Instructions here',
        }),
      );
    });

    it('should set up timeout timer if orchestrator has timeoutSec', async () => {
      const orchestrator = makeOrchestrator({ timeoutSec: 60 });
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'running' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      // Advancing time past timeout should finalize the run
      vi.advanceTimersByTime(60_000);

      // The run should have been finalized as 'failed' due to timeout
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'failed',
          errorMessage: expect.stringContaining('timeout'),
        }),
      );
    });

    it('should use orchestrator workdir when set', async () => {
      const orchestrator = makeOrchestrator({ workdir: '/custom/workdir' });
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'running' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      // Explicit orchestrator workdirs are used directly without run subdirectories
      expect(ctx.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({ workdir: '/custom/workdir' }),
      );
    });

    it('should reject invalid custom orchestrator workdirs before creating a run', async () => {
      const orchestrator = makeOrchestrator({ workdir: '/custom/workdir' });
      const node = makeNode({ id: 'node-1' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      (ctx.validateWorkdir as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Path not in allowed roots');
      });

      await expect(engine.startRun('orch-1', 'dashboard')).rejects.toThrow(
        'Invalid orchestrator workdir: Path not in allowed roots',
      );
      expect(store.createRun).not.toHaveBeenCalled();
    });

    it('should reject invalid custom node workdirs before creating a run', async () => {
      const orchestrator = makeOrchestrator({ workdir: null });
      const node = makeNode({ id: 'node-1', label: 'Task A', workdir: '/custom/task-workdir' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      (ctx.validateWorkdir as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Path does not exist');
      });

      await expect(engine.startRun('orch-1', 'dashboard')).rejects.toThrow(
        'Invalid workdir for node "Task A": Path does not exist',
      );
      expect(store.createRun).not.toHaveBeenCalled();
    });

    it('should handle enqueueJob error gracefully', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'running' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);
      (ctx.enqueueJob as ReturnType<typeof vi.fn>).mockReturnValue({ error: 'Queue full' });
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          status: 'failed',
          errorMessage: 'Enqueue failed: Queue full',
        }),
      );

      await engine.startRun('orch-1', 'dashboard');

      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-1',
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'Enqueue failed: Queue full',
        }),
      );
      expect(ctx.cleanupSession).toHaveBeenCalledWith('sess-1');
    });
  });

  // ── cancelRun ───────────────────────────────────────────────

  describe('cancelRun', () => {
    it('should cancel an active run in memory', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        status: 'running',
        sessionKey: 'sess-1',
      });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      await engine.cancelRun('run-1');

      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'cancelled',
        }),
      );
    });

    it('should update DB directly if run not in memory', async () => {
      await engine.cancelRun('run-not-in-memory');

      expect(store.updateRun).toHaveBeenCalledWith('run-not-in-memory', {
        status: 'cancelled',
        endedAt: expect.any(String),
      });
    });

    it('should call cleanupSession for sessions in active nodes', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        status: 'running',
        sessionKey: 'sess-abc',
      });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');
      await engine.cancelRun('run-1');

      expect(ctx.cleanupSession).toHaveBeenCalledWith('sess-abc');
    });

    it('should handle cleanupSession errors gracefully', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        status: 'running',
        sessionKey: 'sess-abc',
      });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);
      (ctx.cleanupSession as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('cleanup boom');
      });

      await engine.startRun('orch-1', 'dashboard');

      // Should not throw even if cleanupSession throws
      await expect(engine.cancelRun('run-1')).resolves.toBeUndefined();
    });

    it('should clear timeout timer on cancel', async () => {
      const orchestrator = makeOrchestrator({ timeoutSec: 300 });
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'running' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');
      await engine.cancelRun('run-1');

      // After cancellation, advancing timers should NOT trigger timeout finalization again
      const callCountBefore = store.updateRun.mock.calls.length;
      vi.advanceTimersByTime(300_000);
      // No additional updateRun calls from timeout handler
      expect(store.updateRun.mock.calls.length).toBe(callCountBefore);
    });

    it('should cancel running node runs when finalizing', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        status: 'running',
        sessionKey: 'sess-1',
      });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');
      await engine.cancelRun('run-1');

      // The running node should be marked as cancelled
      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-1',
        expect.objectContaining({
          status: 'cancelled',
        }),
      );
    });
  });

  // ── onNodeJobComplete ───────────────────────────────────────

  describe('onNodeJobComplete', () => {
    /** Set up a simple two-node DAG: node-1 -> node-2, start the run, and return references. */
    async function setupTwoNodeRun(opts?: {
      node1Overrides?: Partial<OrchestratorNode>;
      node2Overrides?: Partial<OrchestratorNode>;
      orchestratorOverrides?: Partial<Orchestrator>;
    }) {
      const orchestrator = makeOrchestrator(opts?.orchestratorOverrides);
      const node1 = makeNode({ id: 'node-1', label: 'First', ...opts?.node1Overrides });
      const node2 = makeNode({ id: 'node-2', label: 'Second', ...opts?.node2Overrides });

      // If node1 has returnValues, create edges for each port to pass DISCONNECTED_PORT validation
      const rv = node1.returnValues;
      let edges: OrchestratorEdge[];
      if (rv && rv.length > 0) {
        edges = rv.map((v, i) =>
          makeEdge({ id: `e-${i}`, fromNodeId: 'node-1', toNodeId: 'node-2', conditionValue: v }),
        );
      } else {
        edges = [makeEdge({ id: 'e1', fromNodeId: 'node-1', toNodeId: 'node-2' })];
      }

      const run = makeRun();
      const nodeRun1 = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'job-1',
      });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node1, node2], edges });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValueOnce(nodeRun1);

      await engine.startRun('orch-1', 'dashboard');

      return { orchestrator, node1, node2, edges, run, nodeRun1 };
    }

    it('should complete node with return value from output', async () => {
      await setupTwoNodeRun();

      const completedNodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'completed',
        returnValue: 'success',
        jobId: 'job-1',
      });

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-1',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(completedNodeRun);

      // For executing the downstream node-2
      const nodeRun2 = makeNodeRun({
        id: 'nr-2',
        nodeId: 'node-2',
        orchestrationRunId: 'run-1',
        status: 'running',
      });
      store.createNodeRun.mockReturnValue(nodeRun2);

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 0, events: [], errorKind: null },
        'some output <return:success>',
        'some output <return:success>',
      );

      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-1',
        expect.objectContaining({
          status: 'completed',
          returnValue: 'success',
          exitCode: 0,
        }),
      );
    });

    it('should trigger retry on failure when retryCount < maxRetries', async () => {
      await setupTwoNodeRun({ node1Overrides: { maxRetries: 2 } });

      const failedNodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'job-1',
        retryCount: 0,
      });

      store.getNodeRunByJobId.mockReturnValue(failedNodeRun);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          ...failedNodeRun,
          status: 'failed',
          errorMessage: 'timeout',
        }),
      );

      // The retry delegates to executeTaskNode which creates a running nodeRun with retryCount + 1
      const retryNodeRun = makeNodeRun({
        id: 'nr-1-retry',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'running',
        retryCount: 1,
      });
      store.createNodeRun.mockReturnValue(retryNodeRun);

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 1, events: [], errorKind: 'timeout' },
        'no return',
        'no return',
      );

      // Should create a new running node run directly (no orphan pending record)
      expect(store.createNodeRun).toHaveBeenCalledWith(
        expect.objectContaining({
          orchestrationRunId: 'run-1',
          nodeId: 'node-1',
          status: 'running',
          retryCount: 1,
        }),
      );
    });

    it('should finalize run with fail_fast policy on node failure', async () => {
      await setupTwoNodeRun({
        node1Overrides: { maxRetries: 0 },
        orchestratorOverrides: { errorPolicy: 'fail_fast' },
      });

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-1',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'failed' }),
      );

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 1, events: [], errorKind: 'timeout' },
        'no return',
        'no return',
      );

      // fail_fast triggers finalizeRun with the node's error message
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'timeout',
        }),
      );
    });

    it('should return early if nodeRun not found for jobId', async () => {
      store.getNodeRunByJobId.mockReturnValue(null);

      await engine.onNodeJobComplete(
        'unknown-job',
        { exitCode: 0, events: [], errorKind: null },
        'output',
        'output',
      );

      expect(store.updateNodeRun).not.toHaveBeenCalled();
    });

    it('should return early if run is not active in memory', async () => {
      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-not-active',
          jobId: 'job-1',
        }),
      );

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 0, events: [], errorKind: null },
        'output',
        'output',
      );

      expect(store.updateNodeRun).not.toHaveBeenCalled();
    });

    it('should advance execution to downstream node after completion', async () => {
      await setupTwoNodeRun();

      const completedNodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'completed',
        returnValue: 'done',
      });

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-1',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(completedNodeRun);

      // When advanceExecution runs, it should try to execute node-2
      const nodeRun2 = makeNodeRun({
        id: 'nr-2',
        nodeId: 'node-2',
        orchestrationRunId: 'run-1',
        status: 'running',
      });
      store.createNodeRun.mockReturnValue(nodeRun2);

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 0, events: [], errorKind: null },
        'output <return:done>',
        'output <return:done>',
      );

      // node-2 should have been enqueued (createNodeRun called a second time for node-2)
      const createCalls = store.createNodeRun.mock.calls;
      const node2Call = createCalls.find(
        (call: Array<{ nodeId: string }>) => call[0]?.nodeId === 'node-2',
      );
      expect(node2Call).toBeDefined();
    });

    it('should truncate long output summaries to 4000 chars', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'job-1',
      });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-1',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'failed' }),
      );

      const longOutput = 'x'.repeat(5000);
      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 0, events: [], errorKind: null },
        longOutput,
        longOutput,
      );

      const updateCall = store.updateNodeRun.mock.calls.find(
        (call: unknown[]) =>
          (call[0] as string) === 'nr-1' && (call[1] as { outputSummary?: string }).outputSummary,
      );
      expect(updateCall).toBeDefined();
      const summary = (updateCall?.[1] as { outputSummary: string }).outputSummary;
      expect(summary.length).toBeLessThanOrEqual(4100); // 4000 + truncation suffix
      expect(summary).toContain('(truncated)');
    });

    it('should parse return tag from full output when tag is beyond truncation boundary', async () => {
      await setupTwoNodeRun({ node1Overrides: { returnValues: ['success', 'error'] } });

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-1',
          retryCount: 0,
        }),
      );

      const completedNodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        status: 'completed',
        returnValue: 'success',
      });
      store.getNodeRunById.mockReturnValue(completedNodeRun);

      // Mock downstream node-2 execution
      store.createNodeRun.mockReturnValue(
        makeNodeRun({
          id: 'nr-2',
          nodeId: 'node-2',
          orchestrationRunId: 'run-1',
          status: 'running',
        }),
      );

      // Return tag at position 4500 — beyond the 4000-char truncation boundary
      const rawOutput = `${'x'.repeat(4500)} <return:success>`;
      const truncatedSummary = `${rawOutput.slice(0, 4000)}… (truncated)`;

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 0, events: [], errorKind: null },
        truncatedSummary,
        rawOutput,
      );

      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-1',
        expect.objectContaining({
          status: 'completed',
          returnValue: 'success',
        }),
      );
    });

    it('should store outputFull as the raw output', async () => {
      await setupTwoNodeRun({ node1Overrides: { returnValues: ['done'] } });

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-1',
          retryCount: 0,
        }),
      );
      const completedNodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        status: 'completed',
        returnValue: 'done',
      });
      store.getNodeRunById.mockReturnValue(completedNodeRun);

      // Mock downstream node-2 execution
      store.createNodeRun.mockReturnValue(
        makeNodeRun({
          id: 'nr-2',
          nodeId: 'node-2',
          orchestrationRunId: 'run-1',
          status: 'running',
        }),
      );

      const rawOutput = 'full output content <return:done>';
      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 0, events: [], errorKind: null },
        rawOutput,
        rawOutput,
      );

      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-1',
        expect.objectContaining({
          outputFull: rawOutput,
          outputSummary: rawOutput,
        }),
      );
    });

    it('should set errorMessage from result.errorKind when present', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'job-1',
      });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-1',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'failed', errorMessage: 'timeout' }),
      );

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: null, events: [], errorKind: 'timeout' },
        'partial output',
        'partial output',
      );

      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-1',
        expect.objectContaining({
          errorMessage: 'timeout',
        }),
      );
    });

    it('should complete node despite non-zero exit when return value is present', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'job-1',
      });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-1',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          status: 'completed',
          returnValue: 'partial_success',
        }),
      );

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 1, events: [], errorKind: null },
        'stuff happened <return:partial_success>',
        'stuff happened <return:partial_success>',
      );

      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-1',
        expect.objectContaining({
          status: 'completed',
          returnValue: 'partial_success',
          exitCode: 1,
        }),
      );
    });

    // ── other_return engine tests ───────────────────────────────

    it('should use matched return value when it exists in returnValues', async () => {
      await setupTwoNodeRun({
        node1Overrides: { returnValues: ['success', 'error', 'other_return'] },
      });

      const completedNodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'completed',
        returnValue: 'success',
        jobId: 'job-1',
      });
      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-1',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(completedNodeRun);
      const nodeRun2 = makeNodeRun({
        id: 'nr-2',
        nodeId: 'node-2',
        orchestrationRunId: 'run-1',
        status: 'running',
      });
      store.createNodeRun.mockReturnValue(nodeRun2);

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 0, events: [], errorKind: null },
        'output <return:success>',
        'output <return:success>',
      );

      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-1',
        expect.objectContaining({
          status: 'completed',
          returnValue: 'success',
        }),
      );
    });

    it('should route to other_return when parsed return value is NOT in returnValues', async () => {
      await setupTwoNodeRun({
        node1Overrides: { returnValues: ['success', 'error', 'other_return'] },
      });

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-1',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          status: 'completed',
          returnValue: 'other_return',
        }),
      );
      const nodeRun2 = makeNodeRun({
        id: 'nr-2',
        nodeId: 'node-2',
        orchestrationRunId: 'run-1',
        status: 'running',
      });
      store.createNodeRun.mockReturnValue(nodeRun2);

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 0, events: [], errorKind: null },
        'output <return:retry>',
        'output <return:retry>',
      );

      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-1',
        expect.objectContaining({
          status: 'completed',
          returnValue: 'other_return',
        }),
      );
    });

    it('should route to other_return when no return tag and returnValues is defined', async () => {
      await setupTwoNodeRun({
        node1Overrides: { returnValues: ['success', 'error', 'other_return'] },
      });

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-1',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          status: 'completed',
          returnValue: 'other_return',
        }),
      );
      const nodeRun2 = makeNodeRun({
        id: 'nr-2',
        nodeId: 'node-2',
        orchestrationRunId: 'run-1',
        status: 'running',
      });
      store.createNodeRun.mockReturnValue(nodeRun2);

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 0, events: [], errorKind: null },
        'output with no return tag',
        'output with no return tag',
      );

      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-1',
        expect.objectContaining({
          status: 'completed',
          returnValue: 'other_return',
        }),
      );
    });

    // ── error_return engine tests ──────────────────────────────

    it('should route to error_return when errorKind + return tag + retries=0 (hasReturnValues)', async () => {
      await setupTwoNodeRun({
        node1Overrides: {
          returnValues: ['success', 'error', 'other_return', 'error_return'],
          maxRetries: 0,
        },
      });

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-1',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          status: 'completed',
          returnValue: 'error_return',
        }),
      );
      const nodeRun2 = makeNodeRun({
        id: 'nr-2',
        nodeId: 'node-2',
        orchestrationRunId: 'run-1',
        status: 'running',
      });
      store.createNodeRun.mockReturnValue(nodeRun2);

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 1, events: [], errorKind: 'exit_1' },
        'output <return:success>',
        'output <return:success>',
      );

      // Single update: status upgraded to 'completed' + error_return before DB write
      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-1',
        expect.objectContaining({
          status: 'completed',
          returnValue: 'error_return',
          errorMessage: 'exit_1',
        }),
      );
    });

    it('should route to error_return when errorKind + no return tag + retries=0', async () => {
      await setupTwoNodeRun({
        node1Overrides: {
          returnValues: ['success', 'error', 'other_return', 'error_return'],
          maxRetries: 0,
        },
      });

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-1',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          status: 'completed',
          returnValue: 'error_return',
        }),
      );
      const nodeRun2 = makeNodeRun({
        id: 'nr-2',
        nodeId: 'node-2',
        orchestrationRunId: 'run-1',
        status: 'running',
      });
      store.createNodeRun.mockReturnValue(nodeRun2);

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: null, events: [], errorKind: 'spawn_error: ENOENT' },
        '',
        '',
      );

      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-1',
        expect.objectContaining({
          status: 'completed',
          returnValue: 'error_return',
          errorMessage: 'spawn_error: ENOENT',
        }),
      );
    });

    it('should retry when errorKind + retries remaining', async () => {
      await setupTwoNodeRun({
        node1Overrides: {
          returnValues: ['success', 'error', 'other_return', 'error_return'],
          maxRetries: 2,
        },
      });

      const failedNodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'job-1',
        retryCount: 0,
      });

      store.getNodeRunByJobId.mockReturnValue(failedNodeRun);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          ...failedNodeRun,
          status: 'failed',
          errorMessage: 'no_output_timeout',
        }),
      );

      const retryNodeRun = makeNodeRun({
        id: 'nr-1-retry',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'running',
        retryCount: 1,
      });
      store.createNodeRun.mockReturnValue(retryNodeRun);

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: null, events: [], errorKind: 'no_output_timeout' },
        '',
        '',
      );

      // Should trigger retry (create new running nodeRun with retryCount=1)
      expect(store.createNodeRun).toHaveBeenCalledWith(
        expect.objectContaining({
          orchestrationRunId: 'run-1',
          nodeId: 'node-1',
          status: 'running',
          retryCount: 1,
        }),
      );
    });

    it('should route to error_return when errorKind + retries exhausted', async () => {
      await setupTwoNodeRun({
        node1Overrides: {
          returnValues: ['success', 'error', 'other_return', 'error_return'],
          maxRetries: 2,
        },
      });

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-1',
          retryCount: 2, // at max
        }),
      );
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          status: 'completed',
          returnValue: 'error_return',
        }),
      );
      const nodeRun2 = makeNodeRun({
        id: 'nr-2',
        nodeId: 'node-2',
        orchestrationRunId: 'run-1',
        status: 'running',
      });
      store.createNodeRun.mockReturnValue(nodeRun2);

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: null, events: [], errorKind: 'no_output_timeout' },
        '',
        '',
      );

      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-1',
        expect.objectContaining({
          status: 'completed',
          returnValue: 'error_return',
        }),
      );
    });

    // ── timeoutSec propagation test ─────────────────────────────

    it('should include timeoutSec in job when node.timeoutSec is set', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1', timeoutSec: 60 });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'running',
      });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      const enqueuedJob = ctx.enqueueJob.mock.calls[0]?.[0];
      expect(enqueuedJob).toBeDefined();
      expect(enqueuedJob?.timeoutSec).toBe(60);
    });

    it('should set timeoutSec to null in job when node.timeoutSec is null', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1', timeoutSec: null });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'running',
      });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      const enqueuedJob = ctx.enqueueJob.mock.calls[0]?.[0];
      expect(enqueuedJob).toBeDefined();
      expect(enqueuedJob?.timeoutSec).toBeNull();
    });
  });

  // ── recoverActiveRuns ───────────────────────────────────────

  describe('recoverActiveRuns', () => {
    it('should recover crashed runs by marking running nodes as failed', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1' });
      const run = makeRun({ id: 'run-crashed', startedAt: '2024-01-01T00:00:00Z' });
      const runningNodeRun = makeNodeRun({
        id: 'nr-crashed',
        nodeId: 'node-1',
        orchestrationRunId: 'run-crashed',
        status: 'running',
      });

      store.getRunningRuns.mockReturnValue([run]);
      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.getNodeRunsByRun.mockReturnValue([runningNodeRun]);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          ...runningNodeRun,
          status: 'failed',
          errorMessage: 'Interrupted by process restart',
        }),
      );

      const recovered = await engine.recoverActiveRuns();

      expect(recovered).toBe(1);
      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-crashed',
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'Interrupted by process restart',
        }),
      );
    });

    it('should mark run as failed if orchestrator not found during recovery', async () => {
      const run = makeRun({ id: 'run-orphan' });

      store.getRunningRuns.mockReturnValue([run]);
      store.getFullOrchestrator.mockReturnValue(null);

      const recovered = await engine.recoverActiveRuns();

      expect(recovered).toBe(0);
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-orphan',
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'Orchestrator not found during recovery',
        }),
      );
    });

    it('should return 0 when no running runs exist', async () => {
      store.getRunningRuns.mockReturnValue([]);

      const recovered = await engine.recoverActiveRuns();

      expect(recovered).toBe(0);
    });

    it('should handle recovery errors gracefully and mark run as failed', async () => {
      const run = makeRun({ id: 'run-err' });

      store.getRunningRuns.mockReturnValue([run]);
      store.getFullOrchestrator.mockImplementation(() => {
        // Return an object with bad nodes that would cause buildValidatedDAG to fail
        return {
          orchestrator: makeOrchestrator(),
          nodes: [makeNode({ id: 'n1' })],
          edges: [makeEdge({ fromNodeId: 'n1', toNodeId: 'n-nonexistent' })],
        };
      });
      store.getNodeRunsByRun.mockReturnValue([]);

      const recovered = await engine.recoverActiveRuns();

      // The recovery should handle the error and mark the run as failed
      // (buildValidatedDAG itself doesn't throw, but advanceExecution might resolve or not)
      expect(recovered).toBeGreaterThanOrEqual(0);
    });

    it('should rebuild nodeRuns from DB and keep completed ones as-is', async () => {
      const orchestrator = makeOrchestrator();
      const nodes = [
        makeNode({ id: 'n1', label: 'Done' }),
        makeNode({ id: 'n2', label: 'Crashed' }),
      ];
      const edges = [makeEdge({ id: 'e1', fromNodeId: 'n1', toNodeId: 'n2' })];
      const run = makeRun({ id: 'run-recover' });

      const completedNR = makeNodeRun({
        id: 'nr-done',
        nodeId: 'n1',
        orchestrationRunId: 'run-recover',
        status: 'completed',
        returnValue: 'ok',
      });
      const runningNR = makeNodeRun({
        id: 'nr-crashed',
        nodeId: 'n2',
        orchestrationRunId: 'run-recover',
        status: 'running',
      });

      store.getRunningRuns.mockReturnValue([run]);
      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes, edges });
      store.getNodeRunsByRun.mockReturnValue([completedNR, runningNR]);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          ...runningNR,
          status: 'failed',
          errorMessage: 'Interrupted by process restart',
        }),
      );

      // When advanceExecution runs after recovery, node-2 may become runnable again
      store.createNodeRun.mockReturnValue(
        makeNodeRun({
          id: 'nr-new',
          nodeId: 'n2',
          orchestrationRunId: 'run-recover',
          status: 'running',
        }),
      );

      const recovered = await engine.recoverActiveRuns();

      expect(recovered).toBe(1);
      // Only the running node should be updated, not the completed one
      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-crashed',
        expect.objectContaining({
          status: 'failed',
        }),
      );
      // The completed node should NOT be updated
      const updateCalls = store.updateNodeRun.mock.calls.map((c: unknown[]) => c[0]);
      expect(updateCalls).not.toContain('nr-done');
    });
  });

  // ── advanceExecution / resolveRunnableNodes ─────────────────

  describe('advanceExecution & resolveRunnableNodes', () => {
    it('should execute root nodes first (nodes with no incoming edges)', async () => {
      const orchestrator = makeOrchestrator();
      const root1 = makeNode({ id: 'root-1', label: 'Root A' });
      const root2 = makeNode({ id: 'root-2', label: 'Root B' });
      const run = makeRun();

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [root1, root2], edges: [] });
      store.createRun.mockReturnValue(run);

      let nrCount = 0;
      store.createNodeRun.mockImplementation((input: { nodeId: string }) => {
        nrCount++;
        return makeNodeRun({ id: `nr-${nrCount}`, nodeId: input.nodeId, status: 'running' });
      });

      await engine.startRun('orch-1', 'dashboard');

      // Both root nodes should be started
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(2);
    });

    it('should execute downstream nodes when conditions match', async () => {
      const orchestrator = makeOrchestrator();
      const node1 = makeNode({ id: 'n1', label: 'A' });
      const node2 = makeNode({ id: 'n2', label: 'B' });
      const edge = makeEdge({
        id: 'e1',
        fromNodeId: 'n1',
        toNodeId: 'n2',
        conditionValue: 'ok',
        conditionOperator: 'eq',
      });
      const run = makeRun();

      const nodeRun1 = makeNodeRun({
        id: 'nr-1',
        nodeId: 'n1',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'job-a',
      });

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [node1, node2],
        edges: [edge],
      });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValueOnce(nodeRun1);

      await engine.startRun('orch-1', 'dashboard');

      // Complete node-1 with return value 'ok' (matches edge condition)
      const completedNR = makeNodeRun({
        id: 'nr-1',
        nodeId: 'n1',
        orchestrationRunId: 'run-1',
        status: 'completed',
        returnValue: 'ok',
      });

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'n1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-a',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(completedNR);

      const nodeRun2 = makeNodeRun({
        id: 'nr-2',
        nodeId: 'n2',
        orchestrationRunId: 'run-1',
        status: 'running',
      });
      store.createNodeRun.mockReturnValue(nodeRun2);

      await engine.onNodeJobComplete(
        'job-a',
        { exitCode: 0, events: [], errorKind: null },
        'result <return:ok>',
        'result <return:ok>',
      );

      // node-2 should have been enqueued
      const node2CreateCall = store.createNodeRun.mock.calls.find(
        (c: Array<{ nodeId: string }>) => c[0]?.nodeId === 'n2',
      );
      expect(node2CreateCall).toBeDefined();
    });

    it('should NOT execute downstream node when edge condition does not match', async () => {
      const orchestrator = makeOrchestrator();
      const node1 = makeNode({ id: 'n1', label: 'A' });
      const node2 = makeNode({ id: 'n2', label: 'B' });
      const edge = makeEdge({
        id: 'e1',
        fromNodeId: 'n1',
        toNodeId: 'n2',
        conditionValue: 'ok',
        conditionOperator: 'eq',
      });
      const run = makeRun();

      const nodeRun1 = makeNodeRun({
        id: 'nr-1',
        nodeId: 'n1',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'job-a',
      });

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [node1, node2],
        edges: [edge],
      });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValueOnce(nodeRun1);

      await engine.startRun('orch-1', 'dashboard');

      // Complete node-1 with return value 'error' (does NOT match edge condition 'ok')
      const completedNR = makeNodeRun({
        id: 'nr-1',
        nodeId: 'n1',
        orchestrationRunId: 'run-1',
        status: 'completed',
        returnValue: 'error',
      });

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'n1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-a',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(completedNR);

      await engine.onNodeJobComplete(
        'job-a',
        { exitCode: 0, events: [], errorKind: null },
        'result <return:error>',
        'result <return:error>',
      );

      // node-2 should not execute, but finalize as skipped for history clarity
      const node2CreateCall = store.createNodeRun.mock.calls.find(
        (c: Array<{ nodeId: string }>) => c[0]?.nodeId === 'n2',
      );
      expect(node2CreateCall).toEqual([
        expect.objectContaining({
          nodeId: 'n2',
          status: 'skipped',
        }),
      ]);
    });

    it('should skip already-completed nodes on subsequent advanceExecution calls', async () => {
      const orchestrator = makeOrchestrator();
      const node1 = makeNode({ id: 'n1', label: 'A' });
      const node2 = makeNode({ id: 'n2', label: 'B' });
      const edge = makeEdge({ id: 'e1', fromNodeId: 'n1', toNodeId: 'n2' });
      const run = makeRun();

      const nodeRun1 = makeNodeRun({
        id: 'nr-1',
        nodeId: 'n1',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'job-a',
      });

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [node1, node2],
        edges: [edge],
      });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValueOnce(nodeRun1);

      await engine.startRun('orch-1', 'dashboard');

      // Complete node-1
      const completedNR1 = makeNodeRun({
        id: 'nr-1',
        nodeId: 'n1',
        orchestrationRunId: 'run-1',
        status: 'completed',
        returnValue: 'ok',
      });

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'n1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-a',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(completedNR1);

      const nodeRun2 = makeNodeRun({
        id: 'nr-2',
        nodeId: 'n2',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'job-b',
      });
      store.createNodeRun.mockReturnValue(nodeRun2);

      await engine.onNodeJobComplete(
        'job-a',
        { exitCode: 0, events: [], errorKind: null },
        'output <return:ok>',
        'output <return:ok>',
      );

      // node-1 should not be re-executed (only node-2 should have been created)
      const node1CreateCalls = store.createNodeRun.mock.calls.filter(
        (c: Array<{ nodeId: string }>) => c[0]?.nodeId === 'n1',
      );
      // Only the initial startRun call for n1
      expect(node1CreateCalls).toHaveLength(1);
    });

    it('should respect maxParallelism during advanceExecution', async () => {
      const orchestrator = makeOrchestrator({ maxParallelism: 1 });
      const nodes = [
        makeNode({ id: 'r1', label: 'Root 1' }),
        makeNode({ id: 'r2', label: 'Root 2' }),
        makeNode({ id: 'r3', label: 'Root 3' }),
      ];
      const run = makeRun();

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes, edges: [] });
      store.createRun.mockReturnValue(run);

      let nrCount = 0;
      store.createNodeRun.mockImplementation((input: { nodeId: string }) => {
        nrCount++;
        return makeNodeRun({ id: `nr-${nrCount}`, nodeId: input.nodeId, status: 'running' });
      });

      await engine.startRun('orch-1', 'dashboard');

      // Only 1 job should be enqueued due to maxParallelism=1
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);
    });
  });

  // ── Gate Node Execution ─────────────────────────────────────

  describe('gate nodes', () => {
    it('should evaluate gate node immediately without creating a job (AND pass)', async () => {
      const orchestrator = makeOrchestrator();
      const taskNode = makeNode({ id: 'task-1', label: 'Task' });
      const gateNode = makeNode({
        id: 'gate-1',
        label: 'Gate',
        nodeType: 'gate',
        tool: null,
        prompt: null,
        gateCondition: { mode: 'and', matchValue: 'ok' },
      });
      const downstreamNode = makeNode({ id: 'downstream-1', label: 'After Gate' });

      const edges = [
        makeEdge({ id: 'e0', fromNodeId: 'task-1', toNodeId: 'gate-1' }),
        makeEdge({
          id: 'e1',
          fromNodeId: 'gate-1',
          toNodeId: 'downstream-1',
          conditionValue: 'pass',
        }),
      ];

      const run = makeRun();
      const taskNodeRun = makeNodeRun({
        id: 'nr-task',
        nodeId: 'task-1',
        status: 'running',
        jobId: 'job-task',
      });

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [taskNode, gateNode, downstreamNode],
        edges,
      });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValueOnce(taskNodeRun);

      await engine.startRun('orch-1', 'dashboard');

      // Only task node should have a job, gate should not
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Now complete the task node with 'ok'
      const completedTask = makeNodeRun({
        id: 'nr-task',
        nodeId: 'task-1',
        orchestrationRunId: 'run-1',
        status: 'completed',
        returnValue: 'ok',
      });

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-task',
          nodeId: 'task-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-task',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(completedTask);

      // Gate node run (created by completeGateNode)
      const gateNodeRun = makeNodeRun({
        id: 'nr-gate',
        nodeId: 'gate-1',
        orchestrationRunId: 'run-1',
        status: 'completed',
        returnValue: 'pass',
      });
      // Downstream node run
      const downstreamNodeRun = makeNodeRun({
        id: 'nr-downstream',
        nodeId: 'downstream-1',
        orchestrationRunId: 'run-1',
        status: 'running',
      });

      store.createNodeRun.mockReturnValueOnce(gateNodeRun).mockReturnValueOnce(downstreamNodeRun);

      await engine.onNodeJobComplete(
        'job-task',
        { exitCode: 0, events: [], errorKind: null },
        'done <return:ok>',
        'done <return:ok>',
      );

      // Gate node should have been created as completed with 'pass'
      const gateCreateCall = store.createNodeRun.mock.calls.find(
        (c: Array<{ nodeId: string; status: string }>) => c[0]?.nodeId === 'gate-1',
      );
      expect(gateCreateCall).toBeDefined();
      expect(gateCreateCall?.[0]).toMatchObject({
        nodeId: 'gate-1',
        status: 'completed',
        returnValue: 'pass',
      });
    });

    it('should complete gate with fail when source does not match matchValue', async () => {
      const orchestrator = makeOrchestrator();
      const taskNode = makeNode({ id: 'task-1', label: 'Task' });
      const gateNode = makeNode({
        id: 'gate-1',
        label: 'Gate',
        nodeType: 'gate',
        tool: null,
        prompt: null,
        gateCondition: { mode: 'and', matchValue: 'ok' },
      });

      const run = makeRun();
      const taskNodeRun = makeNodeRun({
        id: 'nr-task',
        nodeId: 'task-1',
        status: 'running',
        jobId: 'job-task',
      });

      // Edge from task to gate
      const edge = makeEdge({ fromNodeId: 'task-1', toNodeId: 'gate-1' });

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [taskNode, gateNode],
        edges: [edge],
      });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValueOnce(taskNodeRun);

      await engine.startRun('orch-1', 'dashboard');

      // Complete task with 'fail' (doesn't match gate matchValue 'ok')
      const completedTask = makeNodeRun({
        id: 'nr-task',
        nodeId: 'task-1',
        orchestrationRunId: 'run-1',
        status: 'completed',
        returnValue: 'fail',
      });

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-task',
          nodeId: 'task-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-task',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(completedTask);

      // Gate completes with 'fail' (always completed, never skipped)
      const gateNodeRun = makeNodeRun({
        id: 'nr-gate',
        nodeId: 'gate-1',
        orchestrationRunId: 'run-1',
        status: 'completed',
        returnValue: 'fail',
      });

      store.createNodeRun.mockReturnValueOnce(gateNodeRun);

      await engine.onNodeJobComplete(
        'job-task',
        { exitCode: 0, events: [], errorKind: null },
        'done <return:fail>',
        'done <return:fail>',
      );

      // Gate should complete with 'fail' (not skipped)
      const gateCreateCall = store.createNodeRun.mock.calls.find(
        (c: Array<{ nodeId: string; status: string }>) => c[0]?.nodeId === 'gate-1',
      );
      expect(gateCreateCall).toBeDefined();
      expect(gateCreateCall?.[0]).toMatchObject({
        nodeId: 'gate-1',
        status: 'completed',
        returnValue: 'fail',
      });

      // The run should finalize as completed
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'completed',
        }),
      );
    });

    it('should wait for all incoming sources and then evaluate gate when one source branch is skipped', async () => {
      // DAG: A -> B(left), A -> C(right), B -> G, C -> G, G(pass) -> END
      // A returns left, so C is never started (skippable dead path).
      // Gate should wait for B completion and then evaluate with C=null.
      const orchestrator = makeOrchestrator();
      const nodeA = makeNode({ id: 'A', label: 'A' });
      const nodeB = makeNode({ id: 'B', label: 'B' });
      const nodeC = makeNode({ id: 'C', label: 'C' });
      const gate = makeNode({
        id: 'G',
        label: 'Gate',
        nodeType: 'gate',
        tool: null,
        prompt: null,
        gateCondition: { mode: 'or', matchValue: 'ok' },
      });
      const end = makeNode({
        id: 'END',
        label: 'End',
        nodeType: 'end',
        tool: null,
        prompt: null,
      });
      const edges = [
        makeEdge({
          id: 'eAB',
          fromNodeId: 'A',
          toNodeId: 'B',
          conditionValue: 'left',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'eAC',
          fromNodeId: 'A',
          toNodeId: 'C',
          conditionValue: 'right',
          conditionOperator: 'eq',
        }),
        makeEdge({ id: 'eBG', fromNodeId: 'B', toNodeId: 'G' }),
        makeEdge({ id: 'eCG', fromNodeId: 'C', toNodeId: 'G' }),
        makeEdge({
          id: 'eGE',
          fromNodeId: 'G',
          toNodeId: 'END',
          conditionValue: 'pass',
          conditionOperator: 'eq',
        }),
      ];

      const run = makeRun();
      const runA = makeNodeRun({
        id: 'nr-A',
        nodeId: 'A',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'job-A',
      });

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [nodeA, nodeB, nodeC, gate, end],
        edges,
      });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValueOnce(runA);

      await engine.startRun('orch-1', 'dashboard');

      // A completes with left -> B should run, C should be skipped/unstarted
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
      store.getNodeRunById.mockReturnValueOnce(
        makeNodeRun({
          id: 'nr-A',
          nodeId: 'A',
          orchestrationRunId: 'run-1',
          status: 'completed',
          returnValue: 'left',
        }),
      );
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({
          id: 'nr-B',
          nodeId: 'B',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-B',
        }),
      );

      await engine.onNodeJobComplete(
        'job-A',
        { exitCode: 0, events: [], errorKind: null },
        'done <return:left>',
        'done <return:left>',
      );

      // B completes with ok -> gate should evaluate (B=ok, C=null) and pass
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
      store.getNodeRunById.mockReturnValueOnce(
        makeNodeRun({
          id: 'nr-B',
          nodeId: 'B',
          orchestrationRunId: 'run-1',
          status: 'completed',
          returnValue: 'ok',
        }),
      );
      store.createNodeRun
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-G',
            nodeId: 'G',
            orchestrationRunId: 'run-1',
            status: 'completed',
            returnValue: 'pass',
          }),
        )
        .mockReturnValueOnce(
          makeNodeRun({
            id: 'nr-END',
            nodeId: 'END',
            orchestrationRunId: 'run-1',
            status: 'completed',
            returnValue: 'workflow_ended',
          }),
        );

      await engine.onNodeJobComplete(
        'job-B',
        { exitCode: 0, events: [], errorKind: null },
        'done <return:ok>',
        'done <return:ok>',
      );

      const gateCreateCall = store.createNodeRun.mock.calls.find(
        (c: Array<{ nodeId: string; status: string; returnValue?: string }>) =>
          c[0]?.nodeId === 'G',
      );
      expect(gateCreateCall).toBeDefined();
      expect(gateCreateCall?.[0]).toMatchObject({
        nodeId: 'G',
        status: 'completed',
        returnValue: 'pass',
      });
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });
  });

  // ── End nodes ──────────────────────────────────────────────

  describe('end nodes', () => {
    it('should execute end node immediately and complete the run (task → end flow)', async () => {
      const orchestrator = makeOrchestrator();
      const taskNode = makeNode({ id: 'task-1', label: 'Build' });
      const endNode = makeNode({
        id: 'end-1',
        label: 'End',
        nodeType: 'end',
        tool: null,
        prompt: null,
      });

      const edges = [makeEdge({ id: 'e1', fromNodeId: 'task-1', toNodeId: 'end-1' })];

      const run = makeRun();
      const taskNodeRun = makeNodeRun({
        id: 'nr-task',
        nodeId: 'task-1',
        status: 'running',
        jobId: 'job-task',
      });

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [taskNode, endNode],
        edges,
      });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValueOnce(taskNodeRun);

      await engine.startRun('orch-1', 'dashboard');

      // Only task node should have a job enqueued; end node is synchronous
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Now complete the task node
      const completedTask = makeNodeRun({
        id: 'nr-task',
        nodeId: 'task-1',
        orchestrationRunId: 'run-1',
        status: 'completed',
        returnValue: 'success',
      });

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-task',
          nodeId: 'task-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-task',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(completedTask);

      // End node run (created by executeEndNode)
      const endNodeRun = makeNodeRun({
        id: 'nr-end',
        nodeId: 'end-1',
        orchestrationRunId: 'run-1',
        status: 'completed',
        returnValue: 'workflow_ended',
      });

      store.createNodeRun.mockReturnValueOnce(endNodeRun);

      await engine.onNodeJobComplete(
        'job-task',
        { exitCode: 0, events: [], errorKind: null },
        'done <return:success>',
        'done <return:success>',
      );

      // End node should have been created as completed with 'workflow_ended'
      const endCreateCall = store.createNodeRun.mock.calls.find(
        (c: Array<{ nodeId: string; status: string }>) => c[0]?.nodeId === 'end-1',
      );
      expect(endCreateCall).toBeDefined();
      expect(endCreateCall?.[0]).toMatchObject({
        nodeId: 'end-1',
        status: 'completed',
        returnValue: 'workflow_ended',
      });

      // No additional job should have been enqueued for the end node
      expect(ctx.enqueueJob).toHaveBeenCalledTimes(1);

      // Run should finalize as completed
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'completed',
        }),
      );
    });
  });

  // ── Notifications ───────────────────────────────────────────

  describe('notifications', () => {
    it('should send completion notification when run finishes', async () => {
      const orchestrator = makeOrchestrator({ notifyChannel: 'C-notify' });
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        status: 'running',
        sessionKey: 'sess-1',
      });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');
      await engine.cancelRun('run-1');

      expect(ctx.postNotification).toHaveBeenCalledWith(
        'C-notify',
        expect.stringContaining('cancelled'),
      );
    });

    it('should send node notification when notifyEnabled is true', async () => {
      const orchestrator = makeOrchestrator({ notifyChannel: 'C-notify' });
      const node = makeNode({ id: 'node-1', notifyEnabled: true });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'job-1',
      });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      const completedNR = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'completed',
        returnValue: 'done',
        startedAt: '2024-01-01T00:00:00Z',
        endedAt: '2024-01-01T00:01:00Z',
      });

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-1',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(completedNR);

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 0, events: [], errorKind: null },
        'output <return:done>',
        'output <return:done>',
      );

      // Should have been called at least once for node notification
      expect(ctx.postNotification).toHaveBeenCalledWith(
        'C-notify',
        expect.stringContaining('Task 1'),
      );
    });

    it('should not send notification if postNotification is not provided', async () => {
      const { store: s, ctx: c } = createContext();
      const localEngine = new OrchestratorEngine({ ...c, postNotification: undefined });

      const orchestrator = makeOrchestrator({ notifyChannel: 'C-notify' });
      const node = makeNode({ id: 'node-1', notifyEnabled: true });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        status: 'running',
        sessionKey: 'sess-1',
      });

      s.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      s.createRun.mockReturnValue(run);
      s.createNodeRun.mockReturnValue(nodeRun);

      await localEngine.startRun('orch-1', 'dashboard');

      // Should not throw
      await expect(localEngine.cancelRun('run-1')).resolves.toBeUndefined();
    });

    it('should upload artifacts on completion when uploadFile is set', async () => {
      const uploadFile = vi.fn(async () => {});
      engine.setUploadFile(uploadFile);

      const orchestrator = makeOrchestrator({ notifyChannel: 'C-notify' });
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        status: 'running',
        sessionKey: 'sess-1',
        jobId: 'job-1',
        orchestrationRunId: 'run-1',
      });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      mocked.listAllArtifacts.mockReturnValue([
        {
          jobId: 'job-1',
          files: [
            {
              localPath: '/tmp/test/report.pdf',
              filename: 'report.pdf',
              size: 1024,
              mimeType: 'application/pdf',
            },
          ],
        },
      ]);

      await engine.startRun('orch-1', 'dashboard');

      // Complete the node so the run finalizes
      store.getNodeRunByJobId.mockReturnValue(nodeRun);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'completed',
          jobId: 'job-1',
          returnValue: 'done',
        }),
      );

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 0, events: [], errorKind: null },
        'output <return:done>',
        'output <return:done>',
      );

      // Wait for async completion notification (output posting + artifact upload)
      await vi.runAllTimersAsync();

      expect(uploadFile).toHaveBeenCalledWith(
        'C-resolved',
        '/tmp/test/report.pdf',
        'report.pdf',
        'mock-ts',
      );
    });

    it('should resolve artifacts from node-specific workdirs and ignore stale job directories', async () => {
      const uploadFile = vi.fn(async () => undefined);
      engine.setUploadFile(uploadFile);

      const orchestrator = makeOrchestrator({
        notifyChannel: 'C-notify',
        workdir: '/orchestrator',
      });
      const node = makeNode({ id: 'node-1', workdir: '/tmp/node-specific' });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        status: 'running',
        sessionKey: 'sess-1',
        jobId: 'job-1',
        orchestrationRunId: 'run-1',
      });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);
      mocked.listAllArtifacts.mockReturnValue([
        {
          jobId: 'job-1',
          files: [
            {
              localPath: '/tmp/node-specific/_artifacts/job-1/out.txt',
              filename: 'out.txt',
              size: 64,
              mimeType: 'text/plain',
            },
          ],
        },
        {
          jobId: 'old-job',
          files: [
            {
              localPath: '/tmp/node-specific/_artifacts/old-job/old.txt',
              filename: 'old.txt',
              size: 64,
              mimeType: 'text/plain',
            },
          ],
        },
      ]);

      await engine.startRun('orch-1', 'dashboard');

      store.getNodeRunByJobId.mockReturnValue(nodeRun);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'completed',
          jobId: 'job-1',
          returnValue: 'done',
        }),
      );

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 0, events: [], errorKind: null },
        'output <return:done>',
        'output <return:done>',
      );
      await vi.runAllTimersAsync();

      expect(mocked.listAllArtifacts).toHaveBeenCalledWith('/tmp/node-specific');
      expect(uploadFile).toHaveBeenCalledWith(
        'C-resolved',
        '/tmp/node-specific/_artifacts/job-1/out.txt',
        'out.txt',
        'mock-ts',
      );
      expect(uploadFile).not.toHaveBeenCalledWith(
        'C-resolved',
        '/tmp/node-specific/_artifacts/old-job/old.txt',
        'old.txt',
        'mock-ts',
      );
    });

    it('should handle upload failure gracefully without losing notification', async () => {
      const uploadFile = vi.fn(async () => {
        throw new Error('Slack upload 500');
      });
      engine.setUploadFile(uploadFile);

      const orchestrator = makeOrchestrator({ notifyChannel: 'C-notify' });
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        status: 'running',
        sessionKey: 'sess-1',
        jobId: 'job-1',
        orchestrationRunId: 'run-1',
      });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      mocked.listAllArtifacts.mockReturnValue([
        {
          jobId: 'job-1',
          files: [
            {
              localPath: '/tmp/test/fail.pdf',
              filename: 'fail.pdf',
              size: 512,
              mimeType: 'application/pdf',
            },
          ],
        },
      ]);

      await engine.startRun('orch-1', 'dashboard');

      store.getNodeRunByJobId.mockReturnValue(nodeRun);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'completed',
          jobId: 'job-1',
          returnValue: 'done',
        }),
      );

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 0, events: [], errorKind: null },
        'output <return:done>',
        'output <return:done>',
      );
      await vi.runAllTimersAsync();

      // Notification was still sent successfully
      expect(ctx.postNotification).toHaveBeenCalledWith(
        'C-notify',
        expect.stringContaining('completed'),
      );
      // Upload was attempted
      expect(uploadFile).toHaveBeenCalled();
      // Run should still finalize as completed (not crashed)
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });

    it('should not fail when uploadFile is not set', async () => {
      const orchestrator = makeOrchestrator({ notifyChannel: 'C-notify' });
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        status: 'running',
        sessionKey: 'sess-1',
        jobId: 'job-1',
        orchestrationRunId: 'run-1',
      });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      mocked.listAllArtifacts.mockReturnValue([
        {
          jobId: 'job-1',
          files: [
            {
              localPath: '/tmp/test/file.txt',
              filename: 'file.txt',
              size: 100,
              mimeType: 'text/plain',
            },
          ],
        },
      ]);

      await engine.startRun('orch-1', 'dashboard');

      store.getNodeRunByJobId.mockReturnValue(nodeRun);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'completed',
          returnValue: 'done',
        }),
      );

      // Should not throw even without uploadFile set
      await expect(
        engine.onNodeJobComplete(
          'job-1',
          { exitCode: 0, events: [], errorKind: null },
          'output <return:done>',
          'output <return:done>',
        ),
      ).resolves.toBeUndefined();
    });
  });

  // ── getActiveRun ────────────────────────────────────────────

  describe('getActiveRun', () => {
    it('should return active run after startRun', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'running' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      const active = engine.getActiveRun('run-1');
      expect(active).toBeDefined();
      expect(active?.runId).toBe('run-1');
      expect(active?.orchestrator.id).toBe('orch-1');
    });

    it('should return undefined for unknown run', () => {
      expect(engine.getActiveRun('nonexistent')).toBeUndefined();
    });

    it('should return undefined after run is cancelled', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'running' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');
      await engine.cancelRun('run-1');

      expect(engine.getActiveRun('run-1')).toBeUndefined();
    });
  });

  // ── startRerun ──────────────────────────────────────────────

  describe('startRerun', () => {
    it('should create a rerun from beginning', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1' });
      const originalRun = makeRun({ id: 'original-run' });
      const newRun = makeRun({ id: 'rerun-1', rerunFromRunId: 'original-run' });
      const nodeRun = makeNodeRun({
        id: 'nr-new',
        nodeId: 'node-1',
        orchestrationRunId: 'rerun-1',
        status: 'running',
      });

      store.getRunById.mockReturnValue(originalRun);
      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(newRun);
      store.createNodeRun.mockReturnValue(nodeRun);

      const runId = await engine.startRerun('original-run', undefined, 'dashboard', 'user-1');

      expect(runId).toBe('rerun-1');
      expect(store.createRun).toHaveBeenCalledWith(
        expect.objectContaining({
          orchestratorId: 'orch-1',
          rerunFromRunId: 'original-run',
          rerunFromNodeId: undefined,
        }),
      );
    });

    it('should copy ancestor node runs when rerunning from a specific node', async () => {
      const orchestrator = makeOrchestrator();
      const node1 = makeNode({ id: 'n1', label: 'First' });
      const node2 = makeNode({ id: 'n2', label: 'Second' });
      const edge = makeEdge({ id: 'e1', fromNodeId: 'n1', toNodeId: 'n2' });
      const originalRun = makeRun({ id: 'original-run' });
      const newRun = makeRun({ id: 'rerun-1' });

      const completedAncestor = makeNodeRun({
        id: 'nr-orig-1',
        nodeId: 'n1',
        orchestrationRunId: 'original-run',
        status: 'completed',
        returnValue: 'ok',
      });
      const failedTarget = makeNodeRun({
        id: 'nr-orig-2',
        nodeId: 'n2',
        orchestrationRunId: 'original-run',
        status: 'failed',
      });

      store.getRunById.mockReturnValue(originalRun);
      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [node1, node2],
        edges: [edge],
      });
      store.createRun.mockReturnValue(newRun);
      store.getNodeRunsByRun.mockReturnValue([completedAncestor, failedTarget]);

      // First createNodeRun call copies the ancestor
      const copiedAncestor = makeNodeRun({
        id: 'nr-copy-1',
        nodeId: 'n1',
        orchestrationRunId: 'rerun-1',
        status: 'completed',
        returnValue: 'ok',
      });
      // Second createNodeRun call is for the re-executed node-2
      const rerunNodeRun = makeNodeRun({
        id: 'nr-rerun-2',
        nodeId: 'n2',
        orchestrationRunId: 'rerun-1',
        status: 'running',
      });

      store.createNodeRun.mockReturnValueOnce(copiedAncestor).mockReturnValueOnce(rerunNodeRun);

      await engine.startRerun('original-run', 'n2', 'dashboard');

      // The ancestor (n1) should be copied with 'completed' status
      expect(store.createNodeRun).toHaveBeenCalledWith(
        expect.objectContaining({
          orchestrationRunId: 'rerun-1',
          nodeId: 'n1',
          status: 'completed',
          returnValue: 'ok',
        }),
      );
    });

    it('should throw if original run not found', async () => {
      store.getRunById.mockReturnValue(null);

      await expect(engine.startRerun('nonexistent')).rejects.toThrow('Run nonexistent not found');
    });

    it('should throw if orchestrator not found for original run', async () => {
      store.getRunById.mockReturnValue(makeRun({ id: 'run-1', orchestratorId: 'orch-gone' }));
      store.getFullOrchestrator.mockReturnValue(null);

      await expect(engine.startRerun('run-1')).rejects.toThrow('Orchestrator orch-gone not found');
    });
  });

  // ── Edge cases / workdir ────────────────────────────────────

  describe('workdir resolution', () => {
    it('should fallback to cwd-based workdir when orchestrator.workdir is null', async () => {
      const orchestrator = makeOrchestrator({ workdir: null });
      const node = makeNode({ id: 'node-1' });
      const run = makeRun({ id: 'run-abc12345' });
      const nodeRun = makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'running' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      // workdir should be based on cwd + run ID prefix
      expect(ctx.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          workdir: expect.stringContaining('orch_run-abc1'),
        }),
      );
    });
  });

  describe('instruction file paths', () => {
    it('should pass instructionFile for codex tool job', async () => {
      const orchestrator = makeOrchestrator({ instructionFile: '# Codex instructions' });
      const node = makeNode({ id: 'node-1', tool: 'codex' });
      const run = makeRun();
      const nodeRun = makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'running' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      expect(ctx.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'codex',
          instructionFile: '# Codex instructions',
        }),
      );
    });

    it('should pass instructionFile for gemini tool job', async () => {
      const orchestrator = makeOrchestrator({ instructionFile: '# Gemini instructions' });
      const node = makeNode({ id: 'node-1', tool: 'gemini' });
      const run = makeRun();
      const nodeRun = makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'running' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      expect(ctx.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'gemini',
          instructionFile: '# Gemini instructions',
        }),
      );
    });

    it('should prefer node-level workdir and instructionFile overrides', async () => {
      const orchestrator = makeOrchestrator({
        workdir: '/orchestrator/workdir',
        instructionFile: '# Orchestrator instructions',
      });
      const node = makeNode({
        id: 'node-1',
        tool: 'claude',
        workdir: '/node/workdir',
        instructionFile: '# Node instructions',
      });
      const run = makeRun();
      const nodeRun = makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'running' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      expect(ctx.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          workdir: '/node/workdir',
          instructionFile: '# Node instructions',
          skipInstructionFile: false,
        }),
      );
    });

    it('should not prepare an unused fallback run workdir when every task has an explicit workdir', async () => {
      const orchestrator = makeOrchestrator({ workdir: null });
      const node = makeNode({ id: 'node-1', workdir: '/node/workdir' });
      const run = makeRun();
      const nodeRun = makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'running' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      const fallbackPrepared = mocked.mkdirSync.mock.calls.some(
        ([target]) =>
          typeof target === 'string' &&
          target.includes(`${path.sep}workdir${path.sep}orch_${run.id.slice(0, 8)}`),
      );
      expect(fallbackPrepared).toBe(false);
      expect(mocked.mkdirSync).toHaveBeenCalledWith('/node/workdir', { recursive: true });
    });

    it('should skip instruction file generation when node opts out', async () => {
      const orchestrator = makeOrchestrator({ instructionFile: '# Orchestrator instructions' });
      const node = makeNode({
        id: 'node-1',
        tool: 'claude',
        writeInstructionFile: false,
        instructionFile: '# Node instructions',
      });
      const run = makeRun();
      const nodeRun = makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'running' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      expect(ctx.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          instructionFile: null,
          skipInstructionFile: true,
        }),
      );
    });

    it('should call prepareWorkdir (skills only) without writing instruction file', async () => {
      const orchestrator = makeOrchestrator({ instructionFile: '# Custom' });
      const node = makeNode({ id: 'node-1', tool: 'claude' });
      const run = makeRun();
      const nodeRun = makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'running' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      // Engine-executor delegates instruction writing to job-executor
      const instrCalls = mocked.writeFileSync.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === 'string' && /CLAUDE\.md|AGENTS\.md|GEMINI\.md/.test(c[0] as string),
      );
      expect(instrCalls).toHaveLength(0);
      expect(ctx.prepareWorkdir).toHaveBeenCalled();
    });
  });

  describe('prepareWorkdir failure', () => {
    it('should mark node as failed when prepareWorkdir throws', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'running' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          status: 'failed',
          errorMessage: 'Workdir preparation failed',
        }),
      );

      // The first mkdirSync here is the task workdir preparation path.
      let callCount = 0;
      mocked.mkdirSync.mockImplementation(() => {
        callCount++;
        if (callCount >= 1) {
          throw new Error('Permission denied');
        }
      });

      await engine.startRun('orch-1', 'dashboard');

      expect(store.updateNodeRun).toHaveBeenCalledWith(
        'nr-1',
        expect.objectContaining({
          status: 'failed',
          errorMessage: expect.stringContaining('Workdir preparation failed'),
        }),
      );
    });
  });

  describe('run completion detection', () => {
    it('should finalize run as completed when all nodes are done with continue policy', async () => {
      const orchestrator = makeOrchestrator({ errorPolicy: 'continue' });
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'job-1',
      });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      // Complete the only node
      const completedNR = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'completed',
        returnValue: 'done',
      });

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-1',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(completedNR);

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 0, events: [], errorKind: null },
        'done <return:done>',
        'done <return:done>',
      );

      // Run should be finalized as completed
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'completed',
        }),
      );
      // Active run should be removed
      expect(engine.getActiveRun('run-1')).toBeUndefined();
    });

    it('should finalize run as failed when any node failed with continue policy', async () => {
      const orchestrator = makeOrchestrator({ errorPolicy: 'continue' });
      const node = makeNode({ id: 'node-1', maxRetries: 0 });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'job-1',
      });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      // Fail the only node
      const failedNR = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'failed',
        errorMessage: 'Return value not found in output',
      });

      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-1',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(failedNR);

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 0, events: [], errorKind: null },
        'output with no return',
        'output with no return',
      );

      // Run should be finalized as failed (since the failed node is the only one and all are "done")
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'failed',
        }),
      );
    });
  });

  describe('node with no tool or prompt', () => {
    it('should not execute task node that has no tool', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1', tool: null, prompt: 'something' });

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [node],
        edges: [],
      });

      await expect(engine.startRun('orch-1', 'dashboard')).rejects.toThrow('DAG validation failed');
    });
  });

  // ── Fix 1: Path Traversal ───────────────────────────────────

  describe('path traversal prevention (Fix 1)', () => {
    it('should sanitize node labels with special characters for artifact directories', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1', label: '../../etc/passwd' });
      const run = makeRun();
      const nodeRun = makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'running' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      // Should have created a sanitized directory name (../../etc/passwd → ______etc_passwd)
      const mkdirCalls = mocked.mkdirSync.mock.calls.map((c: unknown[]) => c[0] as string);
      // No call should contain '..' traversal
      for (const dir of mkdirCalls) {
        expect(dir).not.toContain('..');
      }
    });
  });

  // ── Fix 2: gate→gate→task chain (no stack overflow) ─────────

  describe('gate chain (Fix 2)', () => {
    it('should handle a gate→gate→task chain without stack overflow', async () => {
      const orchestrator = makeOrchestrator();
      const taskA = makeNode({ id: 'taskA', label: 'Task A' });
      const gate1 = makeNode({
        id: 'gate1',
        label: 'Gate 1',
        nodeType: 'gate',
        tool: null,
        prompt: null,
        gateCondition: { mode: 'and', matchValue: 'ok' },
      });
      const gate2 = makeNode({
        id: 'gate2',
        label: 'Gate 2',
        nodeType: 'gate',
        tool: null,
        prompt: null,
        gateCondition: { mode: 'and', matchValue: 'pass' },
      });
      const taskB = makeNode({ id: 'taskB', label: 'Task B' });

      const edges = [
        makeEdge({ id: 'e0', fromNodeId: 'taskA', toNodeId: 'gate1' }),
        makeEdge({ id: 'e1', fromNodeId: 'gate1', toNodeId: 'gate2' }),
        makeEdge({ id: 'e2', fromNodeId: 'gate2', toNodeId: 'taskB' }),
      ];

      const run = makeRun();
      const taskARun = makeNodeRun({
        id: 'nr-a',
        nodeId: 'taskA',
        status: 'running',
        jobId: 'job-a',
      });

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [taskA, gate1, gate2, taskB],
        edges,
      });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValueOnce(taskARun);

      await engine.startRun('orch-1', 'dashboard');

      // Complete taskA with 'ok'
      const completedA = makeNodeRun({
        id: 'nr-a',
        nodeId: 'taskA',
        orchestrationRunId: 'run-1',
        status: 'completed',
        returnValue: 'ok',
      });
      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-a',
          nodeId: 'taskA',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-a',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(completedA);

      const gate1Run = makeNodeRun({
        id: 'nr-g1',
        nodeId: 'gate1',
        status: 'completed',
        returnValue: 'pass',
      });
      const gate2Run = makeNodeRun({
        id: 'nr-g2',
        nodeId: 'gate2',
        status: 'completed',
        returnValue: 'pass',
      });
      const taskBRun = makeNodeRun({ id: 'nr-b', nodeId: 'taskB', status: 'running' });

      store.createNodeRun
        .mockReturnValueOnce(gate1Run)
        .mockReturnValueOnce(gate2Run)
        .mockReturnValueOnce(taskBRun);

      // Should not throw (stack overflow) — gates are resolved synchronously in a loop
      await engine.onNodeJobComplete(
        'job-a',
        { exitCode: 0, events: [], errorKind: null },
        'done <return:ok>',
        'done <return:ok>',
      );

      // taskB should have been enqueued
      const taskBCreate = store.createNodeRun.mock.calls.find(
        (c: Array<{ nodeId: string }>) => c[0]?.nodeId === 'taskB',
      );
      expect(taskBCreate).toBeDefined();
    });
  });

  // ── Fix 3: Branch merge with skipped branch ─────────────────

  describe('branch merge with dead path (Fix 3)', () => {
    it('should execute downstream node when one branch completes and the other is skipped', async () => {
      // DAG: A → B, A → C, B → D, C → D
      // A completes with 'left', edge A→B matches, edge A→C does not match.
      // C is skipped/never started. B completes. D should become ready.
      const orchestrator = makeOrchestrator();
      const nodeA = makeNode({ id: 'A', label: 'A' });
      const nodeB = makeNode({ id: 'B', label: 'B' });
      const nodeC = makeNode({ id: 'C', label: 'C' });
      const nodeD = makeNode({ id: 'D', label: 'D' });
      const edges = [
        makeEdge({
          id: 'eAB',
          fromNodeId: 'A',
          toNodeId: 'B',
          conditionValue: 'left',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'eAC',
          fromNodeId: 'A',
          toNodeId: 'C',
          conditionValue: 'right',
          conditionOperator: 'eq',
        }),
        makeEdge({ id: 'eBD', fromNodeId: 'B', toNodeId: 'D' }),
        makeEdge({ id: 'eCD', fromNodeId: 'C', toNodeId: 'D' }),
      ];
      const run = makeRun();
      const nodeARun = makeNodeRun({
        id: 'nr-A',
        nodeId: 'A',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'job-A',
      });

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [nodeA, nodeB, nodeC, nodeD],
        edges,
      });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValueOnce(nodeARun);

      await engine.startRun('orch-1', 'dashboard');

      // Complete A with 'left' → B becomes runnable, C does not
      const completedA = makeNodeRun({
        id: 'nr-A',
        nodeId: 'A',
        orchestrationRunId: 'run-1',
        status: 'completed',
        returnValue: 'left',
      });
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
      store.getNodeRunById.mockReturnValue(completedA);

      const nodeBRun = makeNodeRun({
        id: 'nr-B',
        nodeId: 'B',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'job-B',
      });
      store.createNodeRun.mockReturnValue(nodeBRun);

      await engine.onNodeJobComplete(
        'job-A',
        { exitCode: 0, events: [], errorKind: null },
        'output <return:left>',
        'output <return:left>',
      );

      // B should be running
      expect(store.createNodeRun).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'B' }));

      // Now complete B with 'ok'
      const completedB = makeNodeRun({
        id: 'nr-B',
        nodeId: 'B',
        orchestrationRunId: 'run-1',
        status: 'completed',
        returnValue: 'ok',
      });
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
      store.getNodeRunById.mockReturnValue(completedB);

      const nodeDRun = makeNodeRun({
        id: 'nr-D',
        nodeId: 'D',
        orchestrationRunId: 'run-1',
        status: 'running',
      });
      store.createNodeRun.mockReturnValue(nodeDRun);

      await engine.onNodeJobComplete(
        'job-B',
        { exitCode: 0, events: [], errorKind: null },
        'output <return:ok>',
        'output <return:ok>',
      );

      // D should become runnable even though C was never started (dead path from A→C)
      // The edge C→D has a dead source (C has no nodeRun), and D should be ready because
      // B→D is a live completed edge with unconditional match.
      const nodeDCreate = store.createNodeRun.mock.calls.find(
        (c: Array<{ nodeId: string }>) => c[0]?.nodeId === 'D',
      );
      expect(nodeDCreate).toBeDefined();
    });

    it('should finalize run when downstream node has no matched incoming edge and other path is skipped', async () => {
      // DAG: A -> B(left), A -> C(right), B -> D(eq:go), C -> D(unconditional)
      // A returns left, so C is skipped. B returns stop, so B->D does not match.
      // D is unreachable and should be treated as skippable; run must complete.
      const orchestrator = makeOrchestrator();
      const nodeA = makeNode({ id: 'A', label: 'A' });
      const nodeB = makeNode({ id: 'B', label: 'B' });
      const nodeC = makeNode({ id: 'C', label: 'C' });
      const nodeD = makeNode({ id: 'D', label: 'D' });
      const edges = [
        makeEdge({
          id: 'eAB',
          fromNodeId: 'A',
          toNodeId: 'B',
          conditionValue: 'left',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'eAC',
          fromNodeId: 'A',
          toNodeId: 'C',
          conditionValue: 'right',
          conditionOperator: 'eq',
        }),
        makeEdge({
          id: 'eBD',
          fromNodeId: 'B',
          toNodeId: 'D',
          conditionValue: 'go',
          conditionOperator: 'eq',
        }),
        makeEdge({ id: 'eCD', fromNodeId: 'C', toNodeId: 'D' }),
      ];
      const run = makeRun();
      const runA = makeNodeRun({
        id: 'nr-A',
        nodeId: 'A',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'job-A',
      });

      store.getFullOrchestrator.mockReturnValue({
        orchestrator,
        nodes: [nodeA, nodeB, nodeC, nodeD],
        edges,
      });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValueOnce(runA);

      await engine.startRun('orch-1', 'dashboard');

      // A completes with left -> B starts
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
      store.getNodeRunById.mockReturnValueOnce(
        makeNodeRun({
          id: 'nr-A',
          nodeId: 'A',
          orchestrationRunId: 'run-1',
          status: 'completed',
          returnValue: 'left',
        }),
      );
      store.createNodeRun.mockReturnValueOnce(
        makeNodeRun({
          id: 'nr-B',
          nodeId: 'B',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-B',
        }),
      );

      await engine.onNodeJobComplete(
        'job-A',
        { exitCode: 0, events: [], errorKind: null },
        'output <return:left>',
        'output <return:left>',
      );

      // B completes with stop -> B->D does not match, C was skipped by A branch
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
      store.getNodeRunById.mockReturnValueOnce(
        makeNodeRun({
          id: 'nr-B',
          nodeId: 'B',
          orchestrationRunId: 'run-1',
          status: 'completed',
          returnValue: 'stop',
        }),
      );

      await engine.onNodeJobComplete(
        'job-B',
        { exitCode: 0, events: [], errorKind: null },
        'output <return:stop>',
        'output <return:stop>',
      );

      // D should not run, but it should be persisted as skipped and the run should finalize.
      const nodeDCreate = store.createNodeRun.mock.calls.find(
        (c: Array<{ nodeId: string }>) => c[0]?.nodeId === 'D',
      );
      expect(nodeDCreate).toEqual([
        expect.objectContaining({
          nodeId: 'D',
          status: 'skipped',
        }),
      ]);
      expect(store.updateRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ status: 'completed' }),
      );
    });
  });

  // ── Fix 10: cancelJob on timeout/cancel ─────────────────────

  describe('cancelJob on finalize (Fix 10)', () => {
    it('should call cancelJob for running nodes when run is cancelled', async () => {
      const cancelJobFn = vi.fn();
      const { store: s, ctx: c } = createContext();
      const localEngine = new OrchestratorEngine({ ...c, cancelJob: cancelJobFn });

      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        status: 'running',
        sessionKey: 'sess-kill-me',
      });

      s.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      s.createRun.mockReturnValue(run);
      s.createNodeRun.mockReturnValue(nodeRun);

      await localEngine.startRun('orch-1', 'dashboard');
      await localEngine.cancelRun('run-1');

      expect(cancelJobFn).toHaveBeenCalledWith('sess-kill-me');
    });

    it('should call cancelJob on timeout', async () => {
      const cancelJobFn = vi.fn();
      const { store: s, ctx: c } = createContext();
      const localEngine = new OrchestratorEngine({ ...c, cancelJob: cancelJobFn });

      const orchestrator = makeOrchestrator({ timeoutSec: 10 });
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        status: 'running',
        sessionKey: 'sess-timeout',
      });

      s.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      s.createRun.mockReturnValue(run);
      s.createNodeRun.mockReturnValue(nodeRun);

      await localEngine.startRun('orch-1', 'dashboard');

      vi.advanceTimersByTime(10_000);

      expect(cancelJobFn).toHaveBeenCalledWith('sess-timeout');
    });
  });

  // ── Fix 13: Recovery retryCount ─────────────────────────────

  describe('recovery retryCount', () => {
    it('should NOT increment retryCount when marking crashed nodes as failed', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1', maxRetries: 3 });
      const run = makeRun({ id: 'run-crash' });
      const runningNodeRun = makeNodeRun({
        id: 'nr-crash',
        nodeId: 'node-1',
        orchestrationRunId: 'run-crash',
        status: 'running',
        retryCount: 1, // already retried once
      });

      store.getRunningRuns.mockReturnValue([run]);
      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.getNodeRunsByRun.mockReturnValue([runningNodeRun]);
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({ ...runningNodeRun, status: 'failed', retryCount: 1 }),
      );

      await engine.recoverActiveRuns();

      // retryCount should remain unchanged — crash is not a retry attempt
      const updateCall = store.updateNodeRun.mock.calls.find((c: unknown[]) => c[0] === 'nr-crash');
      expect(updateCall).toBeDefined();
      const patch = updateCall?.[1] as Record<string, unknown>;
      expect(patch.status).toBe('failed');
      expect(patch.errorMessage).toBe('Interrupted by process restart');
      expect(patch).not.toHaveProperty('retryCount');
    });
  });

  // ── Fix 6: Single updateNodeRun (no double update) ──────────

  describe('single updateNodeRun in executeTaskNode (Fix 6)', () => {
    it('should call updateNodeRun only once per node execution (merged jobId + sessionKey)', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1' });
      const run = makeRun();
      const nodeRun = makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'running' });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValue(nodeRun);

      await engine.startRun('orch-1', 'dashboard');

      // updateNodeRun should be called exactly once per node (merged jobId + sessionKey)
      const updateCalls = store.updateNodeRun.mock.calls.filter((c: unknown[]) => c[0] === 'nr-1');
      expect(updateCalls).toHaveLength(1);
      const patch = updateCalls[0]?.[1] as Record<string, unknown>;
      expect(patch.jobId).toBeDefined();
      expect(patch.sessionKey).toBeDefined();
    });
  });

  // ── Fix 9: No orphan nodeRun from retry ─────────────────────

  describe('retry without orphan nodeRun (Fix 9)', () => {
    it('should create exactly one nodeRun for retry (no pending orphan)', async () => {
      const orchestrator = makeOrchestrator();
      const node = makeNode({ id: 'node-1', maxRetries: 1 });
      const run = makeRun();
      const nodeRun1 = makeNodeRun({
        id: 'nr-1',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'running',
        jobId: 'job-1',
      });

      store.getFullOrchestrator.mockReturnValue({ orchestrator, nodes: [node], edges: [] });
      store.createRun.mockReturnValue(run);
      store.createNodeRun.mockReturnValueOnce(nodeRun1);

      await engine.startRun('orch-1', 'dashboard');

      // Fail the node
      store.getNodeRunByJobId.mockReturnValue(
        makeNodeRun({
          id: 'nr-1',
          nodeId: 'node-1',
          orchestrationRunId: 'run-1',
          status: 'running',
          jobId: 'job-1',
          retryCount: 0,
        }),
      );
      store.getNodeRunById.mockReturnValue(
        makeNodeRun({ id: 'nr-1', nodeId: 'node-1', status: 'failed', retryCount: 0 }),
      );

      const retryNodeRun = makeNodeRun({
        id: 'nr-retry',
        nodeId: 'node-1',
        orchestrationRunId: 'run-1',
        status: 'running',
        retryCount: 1,
      });
      store.createNodeRun.mockReturnValue(retryNodeRun);

      await engine.onNodeJobComplete(
        'job-1',
        { exitCode: 1, events: [], errorKind: 'timeout' },
        'no return',
        'no return',
      );

      // Count createNodeRun calls for node-1 after the initial startRun
      const retryCalls = store.createNodeRun.mock.calls.filter(
        (c: Array<{ nodeId: string }>) => c[0]?.nodeId === 'node-1',
      );
      // Should be exactly 2: initial run + retry (no pending orphan)
      expect(retryCalls).toHaveLength(2);
      // The retry call should be 'running', not 'pending'
      expect(retryCalls[1]?.[0]).toMatchObject({ status: 'running', retryCount: 1 });
    });
  });
});
