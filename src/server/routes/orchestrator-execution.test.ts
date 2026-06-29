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
const M = UUID.missing;

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
  c.eventRouter = { reload: vi.fn(async () => undefined) } as unknown as AppContext['eventRouter'];
  return c;
}

describe('orchestrator-execution', () => {
  // Validate
  it('validate 200', async () => {
    expect(
      (await invoke(ctx(), { method: 'POST', path: `/api/orchestrators/${O}/validate`, body: {} }))
        .status,
    ).toBe(200);
  });
  it('validate 404', async () => {
    expect(
      (await invoke(ctx(), { method: 'POST', path: `/api/orchestrators/${M}/validate`, body: {} }))
        .status,
    ).toBe(404);
  });
  it('validate commit', async () => {
    await invoke(ctx(), {
      method: 'POST',
      path: `/api/orchestrators/${O}/validate`,
      body: { commit: true },
    });
  });
  it('validate webhook trigger no sub error', async () => {
    const c = ctx();
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      triggerMode: 'webhook',
    });
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/orchestrators/${O}/validate`,
      body: {},
    });
    expect(r.status).toBe(200);
  });

  // Revert
  it('revert 200', async () => {
    expect(
      (await invoke(ctx(), { method: 'POST', path: `/api/orchestrators/${O}/revert` })).status,
    ).toBe(200);
  });
  it('revert 404', async () => {
    expect(
      (await invoke(ctx(), { method: 'POST', path: `/api/orchestrators/${M}/revert` })).status,
    ).toBe(404);
  });
  it('revert 409 active run', async () => {
    const c = ctx();
    (c.orchestratorStore.getRunningRuns as ReturnType<typeof vi.fn>).mockReturnValue([
      { orchestratorId: O },
    ]);
    expect(
      (await invoke(c, { method: 'POST', path: `/api/orchestrators/${O}/revert` })).status,
    ).toBe(409);
  });
  it('revert 400 no snapshot', async () => {
    const c = ctx();
    (c.orchestratorStore.revertToValidatedSnapshot as ReturnType<typeof vi.fn>).mockReturnValue(
      false,
    );
    expect(
      (await invoke(c, { method: 'POST', path: `/api/orchestrators/${O}/revert` })).status,
    ).toBe(400);
  });
  it('revert 400 throws', async () => {
    const c = ctx();
    (c.orchestratorStore.revertToValidatedSnapshot as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        throw new Error('fail');
      },
    );
    expect(
      (await invoke(c, { method: 'POST', path: `/api/orchestrators/${O}/revert` })).status,
    ).toBe(400);
  });

  // Execute
  it('execute 200', async () => {
    expect(
      (await invoke(ctx(), { method: 'POST', path: `/api/orchestrators/${O}/execute` })).status,
    ).toBe(200);
  });
  it('execute 404', async () => {
    expect(
      (await invoke(ctx(), { method: 'POST', path: `/api/orchestrators/${M}/execute` })).status,
    ).toBe(404);
  });
  it('execute 400 webhook', async () => {
    const c = ctx();
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      triggerMode: 'webhook',
    });
    expect(
      (await invoke(c, { method: 'POST', path: `/api/orchestrators/${O}/execute` })).status,
    ).toBe(400);
  });
  it('execute 400 unvalidated', async () => {
    const c = ctx();
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      dagValidated: false,
    });
    expect(
      (await invoke(c, { method: 'POST', path: `/api/orchestrators/${O}/execute` })).status,
    ).toBe(400);
  });
  it('execute 400 bad workdir', async () => {
    const c = ctx();
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      workdir: '/nonexistent',
    });
    expect(
      (await invoke(c, { method: 'POST', path: `/api/orchestrators/${O}/execute` })).status,
    ).toBe(400);
  });
  it('execute 400 engine error', async () => {
    const c = ctx();
    (c.orchestratorEngine.startRun as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('fail'),
    );
    expect(
      (await invoke(c, { method: 'POST', path: `/api/orchestrators/${O}/execute` })).status,
    ).toBe(400);
  });

  // Rerun
  it('rerun 200', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: `/api/orchestrators/${O}/rerun/${R}`,
          body: {},
        })
      ).status,
    ).toBe(200);
  });
  it('rerun 404', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: `/api/orchestrators/${M}/rerun/${R}`,
          body: {},
        })
      ).status,
    ).toBe(404);
  });
  it('rerun 400 unvalidated', async () => {
    const c = ctx();
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      dagValidated: false,
    });
    expect(
      (await invoke(c, { method: 'POST', path: `/api/orchestrators/${O}/rerun/${R}`, body: {} }))
        .status,
    ).toBe(400);
  });
  it('rerun 400 error', async () => {
    const c = ctx();
    (c.orchestratorEngine.startRerun as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('fail'),
    );
    expect(
      (await invoke(c, { method: 'POST', path: `/api/orchestrators/${O}/rerun/${R}`, body: {} }))
        .status,
    ).toBe(400);
  });
  it('rerun with fromNodeId', async () => {
    const c = ctx();
    await invoke(c, {
      method: 'POST',
      path: `/api/orchestrators/${O}/rerun/${R}`,
      body: { fromNodeId: UUID.node2 },
    });
    expect(c.orchestratorEngine.startRerun).toHaveBeenCalledWith(R, UUID.node2, 'dashboard');
  });

  // Cancel
  it('cancel 200', async () => {
    expect(
      (await invoke(ctx(), { method: 'POST', path: `/api/orchestrators/${O}/cancel/${R}` })).status,
    ).toBe(200);
  });
  it('cancel 400 error', async () => {
    const c = ctx();
    (c.orchestratorEngine.cancelRun as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('fail'),
    );
    expect(
      (await invoke(c, { method: 'POST', path: `/api/orchestrators/${O}/cancel/${R}` })).status,
    ).toBe(400);
  });

  // SSE Stream
  it('stream sets up SSE', async () => {
    const c = ctx();
    const req = new MockRequest('GET', `/api/orchestrators/${O}/runs/${R}/stream`);
    const res = new MockResponse();
    const p = handleOrchestratorExecutionRoutes(
      c,
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      `/api/orchestrators/${O}/runs/${R}/stream`,
    );
    await new Promise((r) => setTimeout(r, 50));
    req.emit('close');
    await new Promise((r) => setTimeout(r, 50));
    const handled = await p;
    expect(handled).toBe(true);
  });

  it('unmatched false', async () => {
    expect((await invoke(ctx(), { method: 'GET', path: '/api/other' })).handled).toBe(false);
  });
});
