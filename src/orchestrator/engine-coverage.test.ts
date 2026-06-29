import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { buildValidatedDAG } from './dag.js';
import {
  completeGateNode,
  executeTaskNode,
  handleNodeJobComplete,
  isGateReady,
  isNodeSkippable,
} from './engine-executor.js';
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

type EngineInternals = {
  advanceExecution(active: ActiveOrchestrationRun): Promise<void>;
  checkRunCompletion(active: ActiveOrchestrationRun): void;
  finalizeRun(
    active: ActiveOrchestrationRun,
    status: 'completed' | 'failed' | 'cancelled',
    errorMessage?: string,
  ): void;
  handleTimeout(runId: string): void;
  resolveRunnableNodes(active: ActiveOrchestrationRun): OrchestratorNode[];
};

function getEngineInternals(engine: OrchestratorEngine): EngineInternals {
  return engine as unknown as EngineInternals;
}

function makeOrchestrator(overrides?: Partial<Orchestrator>): Orchestrator {
  return {
    id: 'orch-1',
    name: 'Pipeline',
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

function makeNode(overrides?: Partial<OrchestratorNode>): OrchestratorNode {
  return {
    id: 'node-1',
    orchestratorId: 'orch-1',
    label: 'Task',
    nodeType: 'task',
    tool: 'claude',
    mode: 'write',
    prompt: 'Run task',
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

function makeEdge(
  overrides: Partial<OrchestratorEdge> & { fromNodeId: string; toNodeId: string },
): OrchestratorEdge {
  const { fromNodeId, toNodeId, ...rest } = overrides;
  return {
    id: `${fromNodeId}-${toNodeId}`,
    orchestratorId: 'orch-1',
    fromNodeId,
    toNodeId,
    conditionValue: null,
    conditionOperator: 'eq',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    ...rest,
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
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: null,
    errorMessage: null,
    rerunFromRunId: null,
    rerunFromNodeId: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeNodeRun(overrides?: Partial<OrchestrationNodeRun>): OrchestrationNodeRun {
  return {
    id: 'node-run-1',
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

function createMockStore() {
  return {
    getFullOrchestrator: vi.fn(),
    createRun: vi.fn(),
    incrementRunCount: vi.fn(),
    getCompletedRunIds: vi.fn(() => []),
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

function createContext(store = createMockStore()) {
  const ctx = {
    orchestratorStore: store as unknown as EngineContext['orchestratorStore'],
    createSession: vi.fn(() => ({ sessionKey: 'sess-1', workdir: '/tmp/session' })),
    prepareWorkdir: vi.fn(),
    enqueueJob: vi.fn(() => ({ position: 1 })),
    cleanupSession: vi.fn(),
    cleanupRunWorkdir: vi.fn(),
    cancelJob: vi.fn(),
    postNotification: vi.fn(async () => null),
    uploadFile: vi.fn(async () => {}),
    defaultNotifyChannel: undefined,
  } satisfies EngineContext;

  return {
    store,
    ctx,
  };
}

function makeActive(
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

describe('engine coverage branches', () => {
  const tmpDirs: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    notifyMocks.sendCompletionNotification.mockReset();
    notifyMocks.sendCompletionNotification.mockResolvedValue(null);
    notifyMocks.sendNodeNotification.mockReset();
    notifyMocks.sendNodeNotification.mockResolvedValue(undefined);
    notifyMocks.startSummaryJob.mockReset();
    notifyMocks.startSummaryJob.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects startRun and startRerun when the orchestrator has not been validated', async () => {
    const { ctx, store } = createContext();
    const engine = new OrchestratorEngine(ctx);

    store.getFullOrchestrator.mockReturnValue({
      orchestrator: makeOrchestrator({ dagValidated: false }),
      nodes: [makeNode()],
      edges: [],
    });
    await expect(engine.startRun('orch-1', 'dashboard')).rejects.toThrow('has not been validated');

    store.getRunById.mockReturnValue(makeRun());
    await expect(engine.startRerun('run-1')).rejects.toThrow('has not been validated');
  });

  it('sets a timeout when rerunning an orchestrator with timeoutSec configured', async () => {
    const { ctx, store } = createContext();
    const engine = new OrchestratorEngine(ctx);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-rerun-'));
    tmpDirs.push(tmpDir);

    store.getRunById.mockReturnValue(makeRun({ id: 'original-run' }));
    store.getFullOrchestrator.mockReturnValue({
      orchestrator: makeOrchestrator({ timeoutSec: 5, workdir: tmpDir }),
      nodes: [makeNode({ id: 'task-1' })],
      edges: [],
    });
    store.createRun.mockReturnValue(makeRun({ id: 'rerun-1' }));
    store.createNodeRun.mockReturnValue(
      makeNodeRun({ id: 'task-run', nodeId: 'task-1', status: 'running' }),
    );
    store.getNodeRunById.mockReturnValue(
      makeNodeRun({ id: 'task-run', nodeId: 'task-1', status: 'running' }),
    );

    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const handleTimeoutSpy = vi.spyOn(engine as never, 'handleTimeout' as never);
    await engine.startRerun('original-run');
    vi.advanceTimersByTime(5000);

    expect(timeoutSpy).toHaveBeenCalled();
    expect(handleTimeoutSpy).toHaveBeenCalledWith('rerun-1');
  });

  it('recovers runs that have a null startedAt timestamp', async () => {
    const { ctx, store } = createContext();
    const engine = new OrchestratorEngine(ctx);

    store.getRunningRuns.mockReturnValue([makeRun({ id: 'run-null-start', startedAt: null })]);
    store.getFullOrchestrator.mockReturnValue({
      orchestrator: makeOrchestrator(),
      nodes: [makeNode({ id: 'end-1', nodeType: 'end', tool: null, prompt: null })],
      edges: [],
    });
    store.getNodeRunsByRun.mockReturnValue([]);
    store.createNodeRun.mockReturnValue(
      makeNodeRun({ id: 'end-node-run', nodeId: 'end-1', status: 'completed' }),
    );

    await expect(engine.recoverActiveRuns()).resolves.toBe(1);
  });

  it('marks recovery failures using non-Error throwables', async () => {
    const { ctx, store } = createContext();
    const engine = new OrchestratorEngine(ctx);

    store.getRunningRuns.mockReturnValue([makeRun({ id: 'run-bad-recovery' })]);
    store.getFullOrchestrator.mockReturnValue({
      orchestrator: makeOrchestrator(),
      nodes: [makeNode()],
      edges: [],
    });
    store.getNodeRunsByRun.mockImplementation(() => {
      throw 'boom';
    });

    await expect(engine.recoverActiveRuns()).resolves.toBe(0);
    expect(store.updateRun).toHaveBeenCalledWith(
      'run-bad-recovery',
      expect.objectContaining({ errorMessage: 'Recovery failed: boom' }),
    );
  });

  it('marks recovery failures using Error instances', async () => {
    const { ctx, store } = createContext();
    const engine = new OrchestratorEngine(ctx);

    store.getRunningRuns.mockReturnValue([makeRun({ id: 'run-error-recovery' })]);
    store.getFullOrchestrator.mockReturnValue({
      orchestrator: makeOrchestrator(),
      nodes: [makeNode()],
      edges: [],
    });
    store.getNodeRunsByRun.mockImplementation(() => {
      throw new Error('recover failed');
    });

    await expect(engine.recoverActiveRuns()).resolves.toBe(0);
    expect(store.updateRun).toHaveBeenCalledWith(
      'run-error-recovery',
      expect.objectContaining({ errorMessage: 'Recovery failed: recover failed' }),
    );
  });

  it('skips already-started and missing nodes when resolving runnable nodes', () => {
    const { ctx } = createContext();
    const engine = new OrchestratorEngine(ctx);
    const internals = getEngineInternals(engine);
    const node = makeNode();

    const active = makeActive([node], [], {
      nodeRuns: new Map([[node.id, makeNodeRun({ nodeId: node.id, status: 'running' })]]),
    });
    expect(internals.resolveRunnableNodes(active)).toEqual([]);

    const missingNodeActive = {
      ...active,
      dag: {
        ...active.dag,
        nodes: new Map<string, OrchestratorNode>(),
        topologicalOrder: ['missing-node'],
      },
      nodeRuns: new Map(),
    };
    expect(internals.resolveRunnableNodes(missingNodeActive)).toEqual([]);
  });

  it('returns early when completion checks still have active or unresolved work', () => {
    const { ctx } = createContext();
    const engine = new OrchestratorEngine(ctx);
    const internals = getEngineInternals(engine);
    const finalizeSpy = vi.spyOn(engine as never, 'finalizeRun' as never);

    const runningActive = makeActive([makeNode()], [], { runningCount: 1 });
    internals.checkRunCompletion(runningActive);

    const nodeA = makeNode({ id: 'node-a' });
    const nodeB = makeNode({ id: 'node-b' });
    const unresolvedActive = makeActive(
      [nodeA, nodeB],
      [makeEdge({ fromNodeId: 'node-a', toNodeId: 'node-b' })],
    );
    unresolvedActive.nodeRuns.set(nodeB.id, makeNodeRun({ nodeId: nodeB.id, status: 'completed' }));
    internals.checkRunCompletion(unresolvedActive);

    expect(finalizeSpy).not.toHaveBeenCalled();
  });

  it('skips nodes that become started while advanceExecution is yielding', async () => {
    const { ctx, store } = createContext();
    const engine = new OrchestratorEngine(ctx);
    const internals = getEngineInternals(engine);
    const endNode = makeNode({ id: 'end-1', nodeType: 'end', tool: null, prompt: null });
    const active = makeActive([endNode], []);

    vi.spyOn(engine as never, 'resolveRunnableNodes' as never).mockReturnValue([endNode, endNode]);

    await internals.advanceExecution(active);

    expect(store.createNodeRun).toHaveBeenCalledTimes(1);
  });

  it('swallows cancel, cleanup, and completion-notification failures during finalizeRun', async () => {
    const { ctx, store } = createContext();
    const engine = new OrchestratorEngine(ctx);
    const internals = getEngineInternals(engine);
    notifyMocks.sendCompletionNotification.mockRejectedValueOnce('notify failed');
    (ctx.cancelJob as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw 'cancel failed';
    });
    (ctx.cleanupSession as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw 'cleanup failed';
    });

    const node = makeNode();
    const active = makeActive([node], [], {
      nodeRuns: new Map([
        [
          node.id,
          makeNodeRun({
            id: 'node-run-1',
            nodeId: node.id,
            status: 'running',
            sessionKey: 'sess-1',
          }),
        ],
      ]),
    });

    internals.finalizeRun(active, 'cancelled');
    await Promise.resolve();

    expect(store.updateNodeRun).toHaveBeenCalled();
    expect(ctx.cancelJob).toHaveBeenCalledWith('sess-1');
    expect(ctx.cleanupSession).toHaveBeenCalledWith('sess-1');
  });

  it('logs finalize failures when cancel, cleanup, and notification throw Error instances', async () => {
    const { ctx } = createContext();
    const engine = new OrchestratorEngine(ctx);
    const internals = getEngineInternals(engine);
    notifyMocks.sendCompletionNotification.mockRejectedValueOnce(new Error('notify error'));
    (ctx.cancelJob as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('cancel error');
    });
    (ctx.cleanupSession as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('cleanup error');
    });

    const node = makeNode();
    const active = makeActive([node], [], {
      nodeRuns: new Map([
        [
          node.id,
          makeNodeRun({
            id: 'node-run-error',
            nodeId: node.id,
            status: 'running',
            sessionKey: 'sess-error',
          }),
        ],
      ]),
    });

    internals.finalizeRun(active, 'cancelled');
    await Promise.resolve();

    expect(ctx.cancelJob).toHaveBeenCalledWith('sess-error');
    expect(ctx.cleanupSession).toHaveBeenCalledWith('sess-error');
  });

  it('starts a summary job after completion notification when summary is enabled', async () => {
    const { ctx, store } = createContext();
    const engine = new OrchestratorEngine(ctx);
    const internals = getEngineInternals(engine);
    notifyMocks.sendCompletionNotification.mockResolvedValueOnce({
      channelId: 'C123',
      ts: '123.456',
    });
    store.getNodeRunsByRun.mockReturnValue([
      makeNodeRun({ nodeId: 'node-1', status: 'completed' }),
    ]);

    const node = makeNode({ id: 'node-1' });
    const active = makeActive([node], [], {
      orchestrator: makeOrchestrator({
        summaryEnabled: true,
        summaryTool: 'claude',
        notifyChannel: 'C123',
      }),
      nodeRuns: new Map([
        [
          node.id,
          makeNodeRun({
            id: 'node-run-summary',
            nodeId: node.id,
            status: 'completed',
          }),
        ],
      ]),
    });

    internals.finalizeRun(active, 'completed');
    await Promise.resolve();
    await Promise.resolve();

    expect(notifyMocks.startSummaryJob).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        runId: 'run-1',
        notifyChannelId: 'C123',
        notifyThreadTs: '123.456',
        nodeOrder: ['node-1'],
      }),
    );
    await vi.waitFor(() => {
      expect(store.offloadRunOutputs).toHaveBeenCalledWith('run-1');
    });
    const summaryCallOrder = store.getNodeRunsByRun.mock.invocationCallOrder[0];
    const offloadCallOrder = store.offloadRunOutputs.mock.invocationCallOrder[0];
    expect(summaryCallOrder).toBeDefined();
    expect(offloadCallOrder).toBeDefined();
    expect(summaryCallOrder ?? Number.POSITIVE_INFINITY).toBeLessThan(
      offloadCallOrder ?? Number.POSITIVE_INFINITY,
    );
  });

  it('does not start a summary job when notification posting returns null', async () => {
    const { ctx, store } = createContext();
    const engine = new OrchestratorEngine(ctx);
    const internals = getEngineInternals(engine);
    notifyMocks.sendCompletionNotification.mockResolvedValueOnce(null);

    const node = makeNode({ id: 'node-1' });
    const active = makeActive([node], [], {
      orchestrator: makeOrchestrator({
        summaryEnabled: true,
        summaryTool: 'claude',
      }),
      nodeRuns: new Map([
        [
          node.id,
          makeNodeRun({
            id: 'node-run-summary-null',
            nodeId: node.id,
            status: 'completed',
          }),
        ],
      ]),
    });

    internals.finalizeRun(active, 'completed');
    await Promise.resolve();
    await Promise.resolve();

    expect(notifyMocks.startSummaryJob).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(store.offloadRunOutputs).toHaveBeenCalledWith('run-1');
    });
  });

  it('still offloads outputs when completion notification fails', async () => {
    const { ctx, store } = createContext();
    const engine = new OrchestratorEngine(ctx);
    const internals = getEngineInternals(engine);
    notifyMocks.sendCompletionNotification.mockRejectedValueOnce(new Error('notify exploded'));

    const node = makeNode({ id: 'node-1' });
    const active = makeActive([node], [], {
      nodeRuns: new Map([
        [
          node.id,
          makeNodeRun({
            id: 'node-run-offload-on-error',
            nodeId: node.id,
            status: 'completed',
          }),
        ],
      ]),
    });

    internals.finalizeRun(active, 'completed');
    await Promise.resolve();
    await Promise.resolve();

    await vi.waitFor(() => {
      expect(store.offloadRunOutputs).toHaveBeenCalledWith('run-1');
    });
  });

  it('persists skipped node runs for unreachable nodes during finalize', () => {
    const { ctx, store } = createContext();
    const engine = new OrchestratorEngine(ctx);
    const internals = getEngineInternals(engine);
    const source = makeNode({ id: 'source', label: 'Source' });
    const skipped = makeNode({ id: 'skipped', label: 'Skipped' });
    const active = makeActive(
      [source, skipped],
      [makeEdge({ fromNodeId: 'source', toNodeId: 'skipped', conditionValue: 'right' })],
      {
        nodeRuns: new Map([
          [
            source.id,
            makeNodeRun({
              id: 'node-run-source',
              nodeId: source.id,
              status: 'completed',
              returnValue: 'left',
              startedAt: '2026-01-01T00:00:00Z',
              endedAt: '2026-01-01T00:00:01Z',
            }),
          ],
        ]),
      },
    );

    store.createNodeRun.mockReturnValueOnce(
      makeNodeRun({
        id: 'node-run-skipped',
        nodeId: skipped.id,
        status: 'skipped',
        startedAt: '2026-01-01T00:00:02Z',
        endedAt: '2026-01-01T00:00:02Z',
      }),
    );

    internals.finalizeRun(active, 'completed');

    expect(store.createNodeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        orchestrationRunId: 'run-1',
        nodeId: skipped.id,
        status: 'skipped',
      }),
    );
    expect(active.nodeRuns.get(skipped.id)?.status).toBe('skipped');
  });

  it('ignores timeouts for inactive runs', () => {
    const { ctx } = createContext();
    const engine = new OrchestratorEngine(ctx);
    const internals = getEngineInternals(engine);

    expect(() => internals.handleTimeout('missing-run')).not.toThrow();
  });

  it('covers gate readiness and skippable-node negative cases', () => {
    const source = makeNode({ id: 'source' });
    const gate = makeNode({
      id: 'gate',
      nodeType: 'gate',
      tool: null,
      prompt: null,
      gateCondition: { mode: 'and', matchValue: 'ok' },
    });
    const edge = makeEdge({ fromNodeId: 'source', toNodeId: 'gate' });

    expect(
      isGateReady(makeActive([gate], []), makeNode({ id: 'plain-gate', tool: null, prompt: null })),
    ).toBe(false);
    expect(isGateReady(makeActive([gate], []), gate)).toBe(false);

    const pendingActive = makeActive([source, gate], [edge], {
      nodeRuns: new Map([[source.id, makeNodeRun({ nodeId: source.id, status: 'running' })]]),
    });
    expect(isGateReady(pendingActive, gate)).toBe(false);
    expect(isNodeSkippable(pendingActive, gate)).toBe(false);
  });

  it('handles executeTaskNode edge cases and auto return-template prompts', async () => {
    const { ctx, store } = createContext();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-execute-'));
    tmpDirs.push(tmpDir);
    const active = makeActive([makeNode()], [], {
      orchestrator: makeOrchestrator({ workdir: tmpDir }),
    });

    // With agent resolution, tool=null defaults to 'claude'. Test prompt=null for early return.
    await expect(executeTaskNode(ctx, active, makeNode({ prompt: null }))).resolves.toBe(false);

    const runningNodeRun = makeNodeRun({ id: 'nr-auto', nodeId: 'node-auto', status: 'running' });
    store.createNodeRun.mockReturnValue(runningNodeRun);
    store.getNodeRunById.mockReturnValue(runningNodeRun);

    const autoNode = makeNode({
      id: 'node-auto',
      label: 'Auto node',
      returnConditions: [{ condition: 'done', value: 'success' }],
    });
    await expect(executeTaskNode(ctx, active, autoNode)).resolves.toBe(false);
    expect(ctx.enqueueJob).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('IMPORTANT: Follow these output rules exactly.'),
      }),
    );

    // Fallback: auto mode with returnValues but no returnConditions
    const fallbackNodeRun = makeNodeRun({ id: 'nr-fb', nodeId: 'node-fb', status: 'running' });
    store.createNodeRun.mockReturnValue(fallbackNodeRun);
    store.getNodeRunById.mockReturnValue(fallbackNodeRun);

    const fallbackNode = makeNode({
      id: 'node-fb',
      label: 'Fallback node',
      outputMode: 'auto',
      returnConditions: null,
      returnValues: ['success', 'error', 'other_return'],
    });
    await expect(executeTaskNode(ctx, active, fallbackNode)).resolves.toBe(false);
    expect(ctx.enqueueJob).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('IMPORTANT: Follow these output rules exactly.'),
      }),
    );

    (ctx.prepareWorkdir as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw 'prepare failed';
    });
    const failedNodeRun = makeNodeRun({ id: 'nr-fail', nodeId: 'node-fail', status: 'running' });
    store.createNodeRun.mockReturnValueOnce(failedNodeRun);
    store.getNodeRunById.mockReturnValueOnce(
      makeNodeRun({ id: 'nr-fail', nodeId: 'node-fail', status: 'failed' }),
    );
    const failingNode = makeNode({ id: 'node-fail' });
    await expect(executeTaskNode(ctx, active, failingNode)).resolves.toBe(true);
    expect(ctx.cleanupSession).toHaveBeenCalledWith('sess-1');
  });

  it('covers gate completion branches for missing and non-completed sources', async () => {
    const { ctx, store } = createContext();
    const gate = makeNode({
      id: 'gate',
      nodeType: 'gate',
      tool: null,
      prompt: null,
      gateCondition: { mode: 'and', matchValue: 'ok' },
    });
    const source = makeNode({ id: 'source' });
    const activeWithoutIncoming = makeActive([gate], []);
    activeWithoutIncoming.dag.incoming.delete(gate.id);

    await expect(
      completeGateNode(
        ctx,
        activeWithoutIncoming,
        makeNode({ id: 'plain', tool: null, prompt: null }),
      ),
    ).resolves.toBeUndefined();

    store.createNodeRun.mockReturnValueOnce(
      makeNodeRun({ id: 'gate-run-1', nodeId: 'gate', status: 'completed' }),
    );
    await completeGateNode(ctx, activeWithoutIncoming, gate);
    expect(store.createNodeRun).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: 'gate', returnValue: 'fail' }),
    );

    const activeWithMissingSource = makeActive(
      [source, gate],
      [makeEdge({ fromNodeId: 'source', toNodeId: 'gate' })],
    );
    store.createNodeRun.mockReturnValueOnce(
      makeNodeRun({ id: 'gate-run-missing', nodeId: 'gate', status: 'completed' }),
    );
    await completeGateNode(ctx, activeWithMissingSource, gate);
    expect(store.createNodeRun).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: 'gate', returnValue: 'fail' }),
    );

    const activeWithFailedSource = makeActive(
      [source, gate],
      [makeEdge({ fromNodeId: 'source', toNodeId: 'gate' })],
      {
        nodeRuns: new Map([
          [source.id, makeNodeRun({ nodeId: source.id, status: 'failed', returnValue: 'ok' })],
        ]),
      },
    );
    store.createNodeRun.mockReturnValueOnce(
      makeNodeRun({ id: 'gate-run-2', nodeId: 'gate', status: 'completed' }),
    );
    await completeGateNode(ctx, activeWithFailedSource, gate);
    expect(store.createNodeRun).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: 'gate', returnValue: 'fail' }),
    );
  });

  it('returns early when node completion cannot resolve a node and stores empty output as null', async () => {
    const { ctx, store } = createContext();
    const finalizeRun = vi.fn();
    const advanceExecution = vi.fn(async () => {});

    const missingNodeActive = makeActive([makeNode()], [], {
      dag: {
        ...makeActive([makeNode()], []).dag,
        nodes: new Map(),
      },
      runningCount: 1,
    });
    store.getNodeRunByJobId.mockReturnValue(
      makeNodeRun({ nodeId: 'missing-node', status: 'running' }),
    );
    await handleNodeJobComplete(
      ctx,
      missingNodeActive,
      makeNodeRun({ nodeId: 'missing-node', status: 'running' }),
      { exitCode: 0, errorKind: null, events: [] },
      'output',
      advanceExecution,
      finalizeRun,
    );

    const node = makeNode({ returnValues: null });
    const active = makeActive([node], [], {
      orchestrator: makeOrchestrator({ errorPolicy: 'fail_fast' }),
      runningCount: 1,
    });
    const nodeRun = makeNodeRun({ id: 'node-run-fail-fast', nodeId: node.id, status: 'running' });
    store.getNodeRunById.mockReturnValueOnce(makeNodeRun({ ...nodeRun, status: 'failed' }));

    await handleNodeJobComplete(
      ctx,
      active,
      nodeRun,
      { exitCode: 1, errorKind: 'timeout', events: [] },
      '',
      advanceExecution,
      finalizeRun,
    );

    expect(store.updateNodeRun).toHaveBeenLastCalledWith(
      'node-run-fail-fast',
      expect.objectContaining({
        outputSummary: null,
        outputFull: null,
      }),
    );
    expect(finalizeRun).toHaveBeenCalledWith(active, 'failed', 'timeout');
  });
});
