import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../context/app-context.js';
import { StaleUpdateError } from '../../store/store-utils.js';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import { UUID, createInvoker } from './_test-utils.js';
import { handleOrchestratorCrudRoutes } from './orchestrator-crud.js';

const invoke = createInvoker(handleOrchestratorCrudRoutes as Parameters<typeof createInvoker>[0]);
const O = UUID.orch1;
const R = UUID.run1;
const M = UUID.missing;

const ORCH = {
  id: O,
  name: 'Test',
  status: 'active',
  triggerMode: 'ondemand',
  scheduleType: null,
  runAt: null,
  cronExpr: null,
  timezone: 'UTC',
  startNodeId: UUID.node1,
  dagValidated: false,
  summaryEnabled: false,
  summaryTool: null,
  maxRunWorkdirs: 5,
  workdir: null,
  errorPolicy: 'fail_fast',
  maxParallelism: 2,
  maxTotalNodes: 50,
};

function ctx(): AppContext {
  const c = makeTestAppContext();
  c.orchestratorStore = {
    listEnriched: vi.fn(() => [ORCH]),
    getById: vi.fn((id: string) => (id === O ? { ...ORCH } : null)),
    getNodesByOrchestrator: vi.fn(() => []),
    getEdgesByOrchestrator: vi.fn(() => []),
    create: vi.fn((i: Record<string, unknown>) => ({ id: 'o-new', ...i })),
    update: vi.fn(),
    softDelete: vi.fn(),
    isNameAvailable: vi.fn(() => true),
    isAliasAvailable: vi.fn(() => true),
    getRunsByOrchestrator: vi.fn(() => []),
    getRunById: vi.fn(() => null),
    getNodeRunsByRun: vi.fn(() => []),
    getAllRunIds: vi.fn(() => []),
    invalidateDag: vi.fn(),
  } as unknown as AppContext['orchestratorStore'];
  c.eventRouter = { reload: vi.fn(async () => undefined) } as unknown as AppContext['eventRouter'];
  return c;
}

describe('orchestrator-crud', () => {
  it('GET /api/orchestrators', async () => {
    expect((await invoke(ctx(), { method: 'GET', path: '/api/orchestrators' })).status).toBe(200);
  });
  it('GET /:id 200', async () => {
    expect((await invoke(ctx(), { method: 'GET', path: `/api/orchestrators/${O}` })).status).toBe(
      200,
    );
  });
  it('GET /:id 404 missing', async () => {
    expect((await invoke(ctx(), { method: 'GET', path: `/api/orchestrators/${M}` })).status).toBe(
      404,
    );
  });
  it('GET /:id 404 deleted', async () => {
    const c = ctx();
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      status: 'deleted',
    });
    expect((await invoke(c, { method: 'GET', path: `/api/orchestrators/${O}` })).status).toBe(404);
  });

  // POST create
  it('POST 201', async () => {
    expect(
      (await invoke(ctx(), { method: 'POST', path: '/api/orchestrators', body: { name: 'New' } }))
        .status,
    ).toBe(201);
  });
  it('POST 400 empty name', async () => {
    expect(
      (await invoke(ctx(), { method: 'POST', path: '/api/orchestrators', body: { name: '' } }))
        .status,
    ).toBe(400);
  });
  it('POST 400 bad trigger', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/orchestrators',
          body: { name: 'N', triggerMode: 'bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad scheduleType', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/orchestrators',
          body: { name: 'N', scheduleType: 'bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad errorPolicy', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/orchestrators',
          body: { name: 'N', errorPolicy: 'bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad timezone', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/orchestrators',
          body: { name: 'N', timezone: 'Bad/TZ' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad limits', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/orchestrators',
          body: { name: 'N', maxParallelism: -1 },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad enabledSkills', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/orchestrators',
          body: { name: 'N', enabledSkills: 123 },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad summaryTool', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/orchestrators',
          body: { name: 'N', summaryTool: 'bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 summaryEnabled without tool', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/orchestrators',
          body: { name: 'N', summaryEnabled: true },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad workdir', async () => {
    const c = ctx();
    (c.workdirManager.validateCustomWorkdir as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('bad');
    });
    expect(
      (
        await invoke(c, {
          method: 'POST',
          path: '/api/orchestrators',
          body: { name: 'N', workdir: '/bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad maxRunWorkdirs', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/orchestrators',
          body: { name: 'N', maxRunWorkdirs: -1 },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 409 dup name', async () => {
    const c = ctx();
    (c.orchestratorStore.create as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('already in use');
    });
    expect(
      (await invoke(c, { method: 'POST', path: '/api/orchestrators', body: { name: 'D' } })).status,
    ).toBe(409);
  });
  it('POST nextRunAt once', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/orchestrators',
          body: {
            name: 'N',
            scheduleType: 'once',
            runAt: new Date(Date.now() + 86400000).toISOString(),
          },
        })
      ).status,
    ).toBe(201);
  });
  it('POST nextRunAt recurring', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/orchestrators',
          body: { name: 'N', scheduleType: 'recurring', cronExpr: '0 * * * *' },
        })
      ).status,
    ).toBe(201);
  });
  it('POST webhook nullifies schedule', async () => {
    const c = ctx();
    await invoke(c, {
      method: 'POST',
      path: '/api/orchestrators',
      body: { name: 'N', triggerMode: 'webhook' },
    });
    expect(c.orchestratorStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleType: null }),
    );
  });

  // PATCH
  it('PATCH 200', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}`,
          body: { name: 'U' },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH 404', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${M}`,
          body: { name: 'X' },
        })
      ).status,
    ).toBe(404);
  });
  it('PATCH 400 empty name', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}`,
          body: { name: '  ' },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 409 dup name', async () => {
    const c = ctx();
    (c.orchestratorStore.isNameAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);
    expect(
      (await invoke(c, { method: 'PATCH', path: `/api/orchestrators/${O}`, body: { name: 'T' } }))
        .status,
    ).toBe(409);
  });
  it('PATCH 409 dup alias', async () => {
    const c = ctx();
    (c.orchestratorStore.isAliasAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);
    expect(
      (await invoke(c, { method: 'PATCH', path: `/api/orchestrators/${O}`, body: { alias: 'a' } }))
        .status,
    ).toBe(409);
  });
  it('PATCH 400 bad timezone type', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}`,
          body: { timezone: 123 },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad timezone', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}`,
          body: { timezone: 'X/Y' },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad scheduleType type', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}`,
          body: { scheduleType: 123 },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad scheduleType', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}`,
          body: { scheduleType: 'bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad errorPolicy type', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}`,
          body: { errorPolicy: 123 },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad errorPolicy', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}`,
          body: { errorPolicy: 'bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad enabledSkills', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}`,
          body: { enabledSkills: 123 },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad summaryTool', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}`,
          body: { summaryTool: 'bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 summaryEnabled no tool', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}`,
          body: { summaryEnabled: true },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad maxRunWorkdirs', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}`,
          body: { maxRunWorkdirs: -1 },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad workdir', async () => {
    const c = ctx();
    (c.workdirManager.validateCustomWorkdir as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('bad');
    });
    expect(
      (
        await invoke(c, {
          method: 'PATCH',
          path: `/api/orchestrators/${O}`,
          body: { workdir: '/bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad limits', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}`,
          body: { maxParallelism: -1 },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 409 stale', async () => {
    const c = ctx();
    (c.orchestratorStore.update as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new StaleUpdateError('orchestrators', 'stale');
    });
    expect(
      (
        await invoke(c, {
          method: 'PATCH',
          path: `/api/orchestrators/${O}`,
          body: { name: 'X', updatedAt: '2026-01-01' },
        })
      ).status,
    ).toBe(409);
  });
  it('PATCH 409 already in use', async () => {
    const c = ctx();
    (c.orchestratorStore.update as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('already in use');
    });
    expect(
      (await invoke(c, { method: 'PATCH', path: `/api/orchestrators/${O}`, body: { name: 'X' } }))
        .status,
    ).toBe(409);
  });
  it('PATCH strips webhook fields', async () => {
    const c = ctx();
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      triggerMode: 'webhook',
    });
    expect(
      (await invoke(c, { method: 'PATCH', path: `/api/orchestrators/${O}`, body: { alias: 'x' } }))
        .status,
    ).toBe(200);
  });
  it('PATCH recomputes nextRunAt', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}`,
          body: { scheduleType: 'recurring', cronExpr: '0 * * * *' },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH null schedule', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}`,
          body: { scheduleType: null },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH alias empty', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}`,
          body: { alias: '' },
        })
      ).status,
    ).toBe(200);
  });

  // DELETE
  it('DELETE 200', async () => {
    const c = ctx();
    await invoke(c, { method: 'DELETE', path: `/api/orchestrators/${O}` });
    expect(c.orchestratorStore.softDelete).toHaveBeenCalledWith(O);
  });
  it('DELETE 404', async () => {
    expect(
      (await invoke(ctx(), { method: 'DELETE', path: `/api/orchestrators/${M}` })).status,
    ).toBe(404);
  });
  it('DELETE cleanup workdirs', async () => {
    const c = ctx();
    (c.orchestratorStore.getAllRunIds as ReturnType<typeof vi.fn>).mockReturnValue([
      'run-12345678',
    ]);
    expect((await invoke(c, { method: 'DELETE', path: `/api/orchestrators/${O}` })).status).toBe(
      200,
    );
  });

  // Run queries
  it('GET runs 200', async () => {
    expect(
      (await invoke(ctx(), { method: 'GET', path: `/api/orchestrators/${O}/runs` })).status,
    ).toBe(200);
  });
  it('GET runs 404', async () => {
    expect(
      (await invoke(ctx(), { method: 'GET', path: `/api/orchestrators/${M}/runs` })).status,
    ).toBe(404);
  });
  it('GET run detail 200', async () => {
    const c = ctx();
    (c.orchestratorStore.getRunById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: R,
      orchestratorId: O,
    });
    expect(
      (await invoke(c, { method: 'GET', path: `/api/orchestrators/${O}/runs/${R}` })).status,
    ).toBe(200);
  });
  it('GET run detail 404', async () => {
    expect(
      (await invoke(ctx(), { method: 'GET', path: `/api/orchestrators/${O}/runs/${M}` })).status,
    ).toBe(404);
  });
  it('GET run detail wrong orch', async () => {
    const c = ctx();
    (c.orchestratorStore.getRunById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: R,
      orchestratorId: 'other',
    });
    expect(
      (await invoke(c, { method: 'GET', path: `/api/orchestrators/${O}/runs/${R}` })).status,
    ).toBe(404);
  });
  it('GET runs-overview 200', async () => {
    expect(
      (await invoke(ctx(), { method: 'GET', path: `/api/orchestrators/${O}/runs-overview` }))
        .status,
    ).toBe(200);
  });
  it('GET runs-overview 404', async () => {
    expect(
      (await invoke(ctx(), { method: 'GET', path: `/api/orchestrators/${M}/runs-overview` }))
        .status,
    ).toBe(404);
  });
  it('unmatched false', async () => {
    expect((await invoke(ctx(), { method: 'GET', path: '/api/other' })).handled).toBe(false);
  });
});
