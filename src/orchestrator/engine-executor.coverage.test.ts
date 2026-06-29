/**
 * Coverage tests for engine-executor — targets uncovered lines 40-46:
 * cleanupSynchronousNodeSession: logger.warn path when cleanupSession throws.
 */
import { describe, expect, it, vi } from 'vitest';

// We need to test the private function indirectly via executeTaskNode.
// The cleanupSynchronousNodeSession function is called when workdir prep fails
// or enqueue fails, and the catch block on cleanupSession and cleanupRunWorkdir
// logs warnings.

import fs from 'node:fs';
import { executeTaskNode } from './engine-executor.js';
import type { EngineContext } from './engine.js';
import type { ActiveOrchestrationRun, OrchestratorNode } from './types.js';

function makeNode(overrides: Partial<OrchestratorNode> = {}): OrchestratorNode {
  return {
    id: 'node-1',
    orchestratorId: 'orch-1',
    label: 'Task',
    nodeType: 'task',
    tool: 'claude',
    mode: 'write',
    prompt: 'do something',
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

function makeActive(overrides: Partial<ActiveOrchestrationRun> = {}): ActiveOrchestrationRun {
  return {
    runId: 'run-1',
    startedAt: Date.now(),
    orchestrator: {
      id: 'orch-1',
      name: 'Test',
      userId: 'user-1',
      workdir: null,
      startNodeId: 'node-1',
      enabledSkills: null,
      errorPolicy: 'continue',
      summaryEnabled: false,
      summaryTool: null,
      notifyChannel: null,
      triggerMode: 'ondemand',
      maxParallelism: 3,
      maxTotalNodes: 50,
    } as ActiveOrchestrationRun['orchestrator'],
    dag: {
      nodes: new Map(),
      incoming: new Map(),
      outgoing: new Map(),
      edgeMap: new Map(),
      startNodeId: 'node-1',
    } as unknown as ActiveOrchestrationRun['dag'],
    nodeRuns: new Map(),
    runningCount: 0,
    triggerContext: null,
    waitingTriggeredNodes: new Map(),
    pendingTriggeredPayloads: new Map(),
    ...overrides,
  };
}

function makeEngineCtx(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    orchestratorStore: {
      createNodeRun: vi.fn(() => ({
        id: 'nr-1',
        orchestrationRunId: 'run-1',
        nodeId: 'node-1',
        status: 'running',
        retryCount: 0,
        startedAt: new Date().toISOString(),
      })),
      updateNodeRun: vi.fn(),
      getNodeRunById: vi.fn(() => ({
        id: 'nr-1',
        nodeId: 'node-1',
        status: 'failed',
        retryCount: 0,
      })),
    } as unknown as EngineContext['orchestratorStore'],
    createSession: vi.fn(() => ({
      sessionKey: 'sess-1',
      workdir: '/tmp/test',
    })),
    prepareWorkdir: vi.fn(() => {
      throw new Error('prepare failed');
    }),
    enqueueJob: vi.fn(() => ({ position: 1 })),
    cleanupSession: vi.fn(() => {
      throw new Error('cleanup session failed');
    }),
    cleanupRunWorkdir: vi.fn(() => {
      throw new Error('cleanup run workdir failed');
    }),
    ...overrides,
  } as unknown as EngineContext;
}

describe('engine-executor coverage', () => {
  it('cleanupSynchronousNodeSession logs warn when cleanupSession throws (lines 40-46)', async () => {
    // Mock fs.mkdirSync to succeed
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);

    const engineCtx = makeEngineCtx();
    const active = makeActive();
    const node = makeNode();

    // prepareWorkdir throws, triggering cleanupSynchronousNodeSession
    // cleanupSession also throws, hitting the logger.warn path (lines 39-46)
    const result = await executeTaskNode(engineCtx, active, node);
    expect(result).toBe(true); // synchronous failure
    expect(engineCtx.cleanupSession).toHaveBeenCalledWith('sess-1');

    vi.restoreAllMocks();
  });

  it('cleanupSynchronousNodeSession also calls cleanupRunWorkdir when no workdir set (line 47-57)', async () => {
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);

    const cleanupRunWorkdir = vi.fn(() => {
      throw new Error('cleanup run workdir failed');
    });
    const engineCtx = makeEngineCtx({
      cleanupSession: vi.fn(), // does not throw
      cleanupRunWorkdir,
    });
    const active = makeActive(); // orchestrator.workdir is null, node.workdir is null
    const node = makeNode();

    const result = await executeTaskNode(engineCtx, active, node);
    expect(result).toBe(true);
    // cleanupRunWorkdir should have been called and its error caught
    expect(cleanupRunWorkdir).toHaveBeenCalledWith('run-1');

    vi.restoreAllMocks();
  });

  it('cleanupSynchronousNodeSession skips cleanupRunWorkdir when orchestrator has workdir', async () => {
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);

    const cleanupRunWorkdir = vi.fn();
    const engineCtx = makeEngineCtx({
      cleanupSession: vi.fn(),
      cleanupRunWorkdir,
    });
    const active = makeActive({
      orchestrator: {
        ...makeActive().orchestrator,
        workdir: '/some/custom',
      } as ActiveOrchestrationRun['orchestrator'],
    });
    const node = makeNode();

    await executeTaskNode(engineCtx, active, node);
    // cleanupRunWorkdir should NOT be called because orchestrator has custom workdir
    expect(cleanupRunWorkdir).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('cleanupSynchronousNodeSession skips cleanupRunWorkdir when node has workdir', async () => {
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);

    const cleanupRunWorkdir = vi.fn();
    const engineCtx = makeEngineCtx({
      cleanupSession: vi.fn(),
      cleanupRunWorkdir,
    });
    const active = makeActive();
    const node = makeNode({ workdir: '/node/custom' });

    await executeTaskNode(engineCtx, active, node);
    expect(cleanupRunWorkdir).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('falls back to claude when node has no tool and no agent', async () => {
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    const engineCtx = makeEngineCtx({
      cleanupSession: vi.fn(),
    });
    const active = makeActive();
    const node = makeNode({ tool: null });

    // With agent resolution, tool defaults to 'claude' — node proceeds to execution
    // prepareWorkdir throws (default mock), causing sync failure
    const result = await executeTaskNode(engineCtx, active, node);
    expect(result).toBe(true); // synchronous failure from prepareWorkdir
    vi.restoreAllMocks();
  });

  it('returns false when node has no prompt', async () => {
    const engineCtx = makeEngineCtx();
    const active = makeActive();
    const node = makeNode({ prompt: null });

    const result = await executeTaskNode(engineCtx, active, node);
    expect(result).toBe(false);
  });
});
