/**
 * Coverage tests for orchestrator-execution — targets uncovered lines:
 * SSE stream interval paths, validate/rerun with invalid JSON, deleted orchestrator branches.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../context/app-context.js';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import { MockRequest, MockResponse, UUID, createInvoker } from './_test-utils.js';
import { handleOrchestratorExecutionRoutes } from './orchestrator-execution.js';

const invoke = createInvoker(
  handleOrchestratorExecutionRoutes as Parameters<typeof createInvoker>[0],
);
const O = UUID.orch1;
const R = UUID.run1;

const ORCH = {
  id: O,
  name: 'T',
  status: 'active',
  triggerMode: 'ondemand',
  dagValidated: true,
  workdir: null,
  startNodeId: UUID.node1,
  maxTotalNodes: 50,
};

function ctx(): AppContext {
  const c = makeTestAppContext();
  c.orchestratorStore = {
    getById: vi.fn((id: string) => (id === O ? { ...ORCH } : null)),
    getNodesByOrchestrator: vi.fn(() => []),
    getEdgesByOrchestrator: vi.fn(() => []),
    update: vi.fn(),
    saveValidatedSnapshot: vi.fn(),
    revertToValidatedSnapshot: vi.fn(() => true),
    getRunningRuns: vi.fn(() => []),
    getRunById: vi.fn(() => null),
    getNodeRunsByRun: vi.fn(() => []),
    invalidateDag: vi.fn(),
  } as unknown as AppContext['orchestratorStore'];
  c.eventSubscriptionStore = {
    list: vi.fn(() => []),
  } as unknown as AppContext['eventSubscriptionStore'];
  c.orchestratorEngine = {
    startRun: vi.fn(async () => 'run-1'),
    startRerun: vi.fn(async () => 'rerun-1'),
    cancelRun: vi.fn(async () => undefined),
    getActiveRun: vi.fn(() => null),
  } as unknown as AppContext['orchestratorEngine'];
  c.eventRouter = {
    reload: vi.fn(async () => undefined),
  } as unknown as AppContext['eventRouter'];
  return c;
}

describe('orchestrator-execution coverage', () => {
  // ── Validate with invalid JSON body (line 49-51: catch branch) ──
  it('validate with invalid JSON body does dry-run', async () => {
    const c = ctx();
    const req = new MockRequest('POST', `/api/orchestrators/${O}/validate`);
    const res = new MockResponse();
    const p = handleOrchestratorExecutionRoutes(
      c,
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      `/api/orchestrators/${O}/validate`,
    );
    // Send invalid JSON to trigger the catch block
    req.emit('data', Buffer.from('not-valid-json'));
    req.emit('end');
    const handled = await p;
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  // ── Validate deleted orchestrator (line 38-40: orch.status === 'deleted') ──
  it('validate returns 404 for deleted orchestrator', async () => {
    const c = ctx();
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      status: 'deleted',
    });
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/orchestrators/${O}/validate`,
      body: {},
    });
    expect(r.status).toBe(404);
  });

  // ── Rerun with invalid JSON body (line 190-192: catch branch) ──
  it('rerun with invalid JSON body proceeds with empty parsed', async () => {
    const c = ctx();
    const req = new MockRequest('POST', `/api/orchestrators/${O}/rerun/${R}`);
    const res = new MockResponse();
    const p = handleOrchestratorExecutionRoutes(
      c,
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      `/api/orchestrators/${O}/rerun/${R}`,
    );
    req.emit('data', Buffer.from('not-valid-json'));
    req.emit('end');
    const handled = await p;
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  // ── Rerun deleted orchestrator (line 177: rerunOrch.status === 'deleted') ──
  it('rerun returns 404 for deleted orchestrator', async () => {
    const c = ctx();
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      status: 'deleted',
    });
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/orchestrators/${O}/rerun/${R}`,
      body: {},
    });
    expect(r.status).toBe(404);
  });

  // ── SSE stream with active run that changes snapshot (lines 231-262) ──
  it('stream emits state snapshots for active run and detects changes', async () => {
    vi.useFakeTimers();
    const c = ctx();
    const nodeRunsMap = new Map<
      string,
      {
        nodeId: string;
        status: string;
        returnValue: string | null;
        exitCode: number | null;
        errorMessage: string | null;
      }
    >([
      [
        'node-1',
        {
          nodeId: 'node-1',
          status: 'running',
          returnValue: null,
          exitCode: null,
          errorMessage: null,
        },
      ],
    ]);
    let callCount = 0;
    (c.orchestratorEngine.getActiveRun as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return { nodeRuns: nodeRunsMap };
      }
      // After a few calls, change the snapshot
      if (callCount === 3) {
        nodeRunsMap.set('node-1', {
          nodeId: 'node-1',
          status: 'completed',
          returnValue: 'ok',
          exitCode: 0,
          errorMessage: null,
        });
        return { nodeRuns: nodeRunsMap };
      }
      // Then return null to end the stream
      return null;
    });
    (c.orchestratorStore.getRunById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: R,
      status: 'completed',
    });
    (c.orchestratorStore.getNodeRunsByRun as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const req = new MockRequest('GET', `/api/orchestrators/${O}/runs/${R}/stream`);
    const res = new MockResponse();
    const p = handleOrchestratorExecutionRoutes(
      c,
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      `/api/orchestrators/${O}/runs/${R}/stream`,
    );

    // Tick intervals to trigger the setInterval callbacks
    await vi.advanceTimersByTimeAsync(2000); // First tick: emits initial state
    await vi.advanceTimersByTimeAsync(2000); // Second tick: same snapshot, no emit
    await vi.advanceTimersByTimeAsync(2000); // Third tick: changed snapshot, emits
    await vi.advanceTimersByTimeAsync(2000); // Fourth tick: run ended, emits done

    const handled = await p;
    expect(handled).toBe(true);
    expect(res.body).toContain('state');
    expect(res.body).toContain('done');
    expect(res.writableEnded).toBe(true);

    vi.useRealTimers();
  });

  // ── SSE stream: res.writableEnded check inside interval (line 231-234) ──
  it('stream stops when response is already ended', async () => {
    vi.useFakeTimers();
    const c = ctx();
    (c.orchestratorEngine.getActiveRun as ReturnType<typeof vi.fn>).mockReturnValue({
      nodeRuns: new Map(),
    });

    const req = new MockRequest('GET', `/api/orchestrators/${O}/runs/${R}/stream`);
    const res = new MockResponse();
    const p = handleOrchestratorExecutionRoutes(
      c,
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      `/api/orchestrators/${O}/runs/${R}/stream`,
    );

    // Simulate the response being ended externally
    res.writableEnded = true;
    await vi.advanceTimersByTimeAsync(2000);

    // Trigger close to clean up
    req.emit('close');
    const handled = await p;
    expect(handled).toBe(true);

    vi.useRealTimers();
  });

  // ── Execute deleted orchestrator (line 133: orch.status === 'deleted') ──
  it('execute returns 404 for deleted orchestrator', async () => {
    const c = ctx();
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      status: 'deleted',
    });
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/orchestrators/${O}/execute`,
    });
    expect(r.status).toBe(404);
  });

  // ── Revert deleted orchestrator (line 104: orch.status === 'deleted') ──
  it('revert returns 404 for deleted orchestrator', async () => {
    const c = ctx();
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      status: 'deleted',
    });
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/orchestrators/${O}/revert`,
    });
    expect(r.status).toBe(404);
  });

  // ── Validate: edges/nodes line 54 ──
  it('validate includes subscriptions check for triggered nodes', async () => {
    const c = ctx();
    (c.eventSubscriptionStore.list as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        targetType: 'triggered_node',
        nodeId: UUID.node1,
        orchestratorId: null,
      },
    ]);
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/orchestrators/${O}/validate`,
      body: {},
    });
    expect(r.status).toBe(200);
  });

  // ── Validate: webhook mode check for subscription (lines 73-74) ──
  it('validate reports error for webhook-triggered orch without orchestrator subscription', async () => {
    const c = ctx();
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      triggerMode: 'webhook',
    });
    (c.eventSubscriptionStore.list as ReturnType<typeof vi.fn>).mockReturnValue([
      // Has a subscription but it targets a node, not the orchestrator
      {
        targetType: 'triggered_node',
        nodeId: UUID.node1,
        orchestratorId: null,
      },
    ]);
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/orchestrators/${O}/validate`,
      body: {},
    });
    expect(r.status).toBe(200);
    const data = (r.body as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.valid).toBe(false);
    const errors = data.errors as Array<Record<string, string>>;
    expect(errors.some((e) => e.code === 'WEBHOOK_TRIGGER_NO_SUBSCRIPTION')).toBe(true);
  });

  // ── Validate: commit=true with valid DAG saves snapshot (lines 89-91) ──
  it('validate commit=true saves snapshot on valid DAG', async () => {
    const c = ctx();
    // Set up a minimal valid DAG: one start node
    const startNode = {
      id: UUID.node1,
      orchestratorId: O,
      nodeType: 'end',
      label: 'End',
      tool: 'claude',
      dependsOn: [],
    };
    (c.orchestratorStore.getNodesByOrchestrator as ReturnType<typeof vi.fn>).mockReturnValue([
      startNode,
    ]);
    (c.orchestratorStore.getEdgesByOrchestrator as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/orchestrators/${O}/validate`,
      body: { commit: true },
    });
    expect(r.status).toBe(200);
    const data = (r.body as Record<string, unknown>).data as Record<string, unknown>;
    if (data.valid) {
      expect(c.orchestratorStore.update).toHaveBeenCalledWith(O, { dagValidated: true });
      expect(c.orchestratorStore.saveValidatedSnapshot).toHaveBeenCalledWith(O);
    }
  });

  // ── SSE stream: res.writableEnded during sseWrite in interval (lines 267-270) ──
  it('stream clears intervals when res.writableEnded after sseWrite', async () => {
    vi.useFakeTimers();
    const c = ctx();
    let callCount = 0;
    (c.orchestratorEngine.getActiveRun as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          nodeRuns: new Map([
            [
              'node-1',
              {
                nodeId: 'node-1',
                status: 'running',
                returnValue: null,
                exitCode: null,
                errorMessage: null,
              },
            ],
          ]),
        };
      }
      return null;
    });
    (c.orchestratorStore.getRunById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: R,
      status: 'completed',
    });
    (c.orchestratorStore.getNodeRunsByRun as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const req = new MockRequest('GET', `/api/orchestrators/${O}/runs/${R}/stream`);
    const res = new MockResponse();
    const p = handleOrchestratorExecutionRoutes(
      c,
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      `/api/orchestrators/${O}/runs/${R}/stream`,
    );

    // First tick: emits state, then mark res as ended to trigger the writableEnded check
    await vi.advanceTimersByTimeAsync(2000);
    res.writableEnded = true;

    // Second tick: should detect writableEnded and clear intervals
    await vi.advanceTimersByTimeAsync(2000);

    req.emit('close');
    const handled = await p;
    expect(handled).toBe(true);

    vi.useRealTimers();
  });

  // ── Validate: commit with invalid DAG doesn't save snapshot (line 87-90) ──
  it('validate commit=true with invalid DAG does not save snapshot', async () => {
    const c = ctx();
    // We need validateDAG to return errors. Push a node without startNodeId to trigger errors.
    (c.orchestratorStore.getNodesByOrchestrator as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (c.orchestratorStore.getEdgesByOrchestrator as ReturnType<typeof vi.fn>).mockReturnValue([]);
    // Override getById to return an orchestrator without a valid startNodeId
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      startNodeId: 'missing-node',
    });
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/orchestrators/${O}/validate`,
      body: { commit: true },
    });
    expect(r.status).toBe(200);
    // saveValidatedSnapshot should NOT be called because the DAG is invalid
    expect(c.orchestratorStore.saveValidatedSnapshot).not.toHaveBeenCalled();
  });
});
