import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../context/app-context.js';
import { StaleUpdateError } from '../../store/store-utils.js';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import { UUID, createInvoker } from './_test-utils.js';
import { handleScheduleApiRoutes, matchesScheduleApiPath } from './schedule-api.js';

const invoke = createInvoker(handleScheduleApiRoutes as Parameters<typeof createInvoker>[0]);
const T = UUID.task1;
const R = UUID.run1;
const M = UUID.missing;
const TASK = {
  id: T,
  status: 'active',
  scheduleType: 'recurring',
  cronExpr: '0 * * * *',
  timezone: 'UTC',
  runAt: null,
  notifyChannel: 'C1',
};

function ctx(): AppContext {
  const c = makeTestAppContext({
    config: { scheduleEnabled: true, scheduleDefaultNotifyChannel: 'C_DEFAULT' },
  });
  c.scheduleStore = {
    create: vi.fn((i: Record<string, unknown>) => ({ id: 't-new', ...i })),
    list: vi.fn(() => [TASK]),
    getById: vi.fn((id: string) => (id === T ? { ...TASK } : null)),
    update: vi.fn(),
    softDelete: vi.fn(),
    getRunsByTask: vi.fn(() => []),
    getRunById: vi.fn(() => null),
  } as unknown as AppContext['scheduleStore'];
  return c;
}

describe('schedule-api', () => {
  it('matchesScheduleApiPath', () => {
    expect(matchesScheduleApiPath('/api/schedules')).toBe(true);
    expect(matchesScheduleApiPath('/api/schedules/x')).toBe(true);
    expect(matchesScheduleApiPath('/api/other')).toBe(false);
  });

  // POST create
  it('POST recurring 201', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/schedules',
          body: { name: 'N', prompt: 'P', scheduleType: 'recurring', cronExpr: '0 * * * *' },
        })
      ).status,
    ).toBe(201);
  });
  it('POST once 201', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/schedules',
          body: {
            name: 'N',
            prompt: 'P',
            scheduleType: 'once',
            runAt: new Date(Date.now() + 86400000).toISOString(),
          },
        })
      ).status,
    ).toBe(201);
  });
  it('POST 503 disabled', async () => {
    const c = ctx();
    c.config.scheduleEnabled = false;
    expect((await invoke(c, { method: 'POST', path: '/api/schedules', body: {} })).status).toBe(
      503,
    );
  });
  it('POST 400 empty name', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/schedules',
          body: { name: '', prompt: 'P', scheduleType: 'recurring', cronExpr: '0 * * * *' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 long name', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/schedules',
          body: {
            name: 'x'.repeat(300),
            prompt: 'P',
            scheduleType: 'recurring',
            cronExpr: '0 * * * *',
          },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 empty prompt', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/schedules',
          body: { name: 'N', prompt: '', scheduleType: 'recurring', cronExpr: '0 * * * *' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 long prompt', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/schedules',
          body: {
            name: 'N',
            prompt: 'x'.repeat(50001),
            scheduleType: 'recurring',
            cronExpr: '0 * * * *',
          },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 long desc', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/schedules',
          body: {
            name: 'N',
            prompt: 'P',
            description: 'x'.repeat(2001),
            scheduleType: 'recurring',
            cronExpr: '0 * * * *',
          },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad scheduleType', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/schedules',
          body: { name: 'N', prompt: 'P', scheduleType: 'bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad tool', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/schedules',
          body: {
            name: 'N',
            prompt: 'P',
            scheduleType: 'recurring',
            cronExpr: '0 * * * *',
            tool: 'bad',
          },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad tz', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/schedules',
          body: {
            name: 'N',
            prompt: 'P',
            scheduleType: 'recurring',
            cronExpr: '0 * * * *',
            timezone: 'Bad/TZ',
          },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad maxRuns', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/schedules',
          body: {
            name: 'N',
            prompt: 'P',
            scheduleType: 'recurring',
            cronExpr: '0 * * * *',
            maxRuns: 0,
          },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad maxRetries', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/schedules',
          body: {
            name: 'N',
            prompt: 'P',
            scheduleType: 'recurring',
            cronExpr: '0 * * * *',
            maxRetries: 999,
          },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 missing runAt', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/schedules',
          body: { name: 'N', prompt: 'P', scheduleType: 'once' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad date', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/schedules',
          body: { name: 'N', prompt: 'P', scheduleType: 'once', runAt: 'bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 past runAt', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/schedules',
          body: { name: 'N', prompt: 'P', scheduleType: 'once', runAt: '2020-01-01T00:00:00Z' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 missing cron', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/schedules',
          body: { name: 'N', prompt: 'P', scheduleType: 'recurring' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad cron', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/schedules',
          body: { name: 'N', prompt: 'P', scheduleType: 'recurring', cronExpr: 'bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 no channel', async () => {
    const c = ctx();
    c.config.scheduleDefaultNotifyChannel = null;
    expect(
      (
        await invoke(c, {
          method: 'POST',
          path: '/api/schedules',
          body: { name: 'N', prompt: 'P', scheduleType: 'recurring', cronExpr: '0 * * * *' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad skills', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/schedules',
          body: {
            name: 'N',
            prompt: 'P',
            scheduleType: 'recurring',
            cronExpr: '0 * * * *',
            enabledSkills: 123,
          },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 long instruction', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: '/api/schedules',
          body: {
            name: 'N',
            prompt: 'P',
            scheduleType: 'recurring',
            cronExpr: '0 * * * *',
            instructionFile: 'x'.repeat(50001),
          },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 403 blocked user', async () => {
    const c = ctx();
    c.config.allowedUserIds = ['U_OK'];
    expect(
      (
        await invoke(c, {
          method: 'POST',
          path: '/api/schedules',
          body: {
            name: 'N',
            prompt: 'P',
            scheduleType: 'recurring',
            cronExpr: '0 * * * *',
            userId: 'U_BAD',
          },
        })
      ).status,
    ).toBe(403);
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
          path: '/api/schedules',
          body: {
            name: 'N',
            prompt: 'P',
            scheduleType: 'recurring',
            cronExpr: '0 * * * *',
            workdir: '/bad',
          },
        })
      ).status,
    ).toBe(400);
  });

  // GET list
  it('GET 200', async () => {
    expect((await invoke(ctx(), { method: 'GET', path: '/api/schedules' })).status).toBe(200);
  });
  it('GET 503', async () => {
    const c = ctx();
    c.config.scheduleEnabled = false;
    expect((await invoke(c, { method: 'GET', path: '/api/schedules' })).status).toBe(503);
  });

  // GET detail
  it('GET /:id 200', async () => {
    expect((await invoke(ctx(), { method: 'GET', path: `/api/schedules/${T}` })).status).toBe(200);
  });
  it('GET /:id 404', async () => {
    expect((await invoke(ctx(), { method: 'GET', path: `/api/schedules/${M}` })).status).toBe(404);
  });

  // PATCH
  it('PATCH 200', async () => {
    expect(
      (await invoke(ctx(), { method: 'PATCH', path: `/api/schedules/${T}`, body: { name: 'U' } }))
        .status,
    ).toBe(200);
  });
  it('PATCH 404', async () => {
    expect(
      (await invoke(ctx(), { method: 'PATCH', path: `/api/schedules/${M}`, body: { name: 'X' } }))
        .status,
    ).toBe(404);
  });
  it('PATCH 400 empty name', async () => {
    expect(
      (await invoke(ctx(), { method: 'PATCH', path: `/api/schedules/${T}`, body: { name: '  ' } }))
        .status,
    ).toBe(400);
  });
  it('PATCH 400 long name', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/schedules/${T}`,
          body: { name: 'x'.repeat(300) },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 empty prompt', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/schedules/${T}`,
          body: { prompt: '  ' },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 long prompt', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/schedules/${T}`,
          body: { prompt: 'x'.repeat(50001) },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH description null', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/schedules/${T}`,
          body: { description: null },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH 400 bad tz', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/schedules/${T}`,
          body: { timezone: 'Bad/TZ' },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad maxRuns', async () => {
    expect(
      (await invoke(ctx(), { method: 'PATCH', path: `/api/schedules/${T}`, body: { maxRuns: 0 } }))
        .status,
    ).toBe(400);
  });
  it('PATCH null maxRuns', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/schedules/${T}`,
          body: { maxRuns: null },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH 400 bad maxRetries', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/schedules/${T}`,
          body: { maxRetries: 999 },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH pause', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/schedules/${T}`,
          body: { status: 'paused' },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH resume recurring', async () => {
    const c = ctx();
    (c.scheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...TASK,
      status: 'paused',
    });
    expect(
      (
        await invoke(c, {
          method: 'PATCH',
          path: `/api/schedules/${T}`,
          body: { status: 'active' },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH resume once', async () => {
    const c = ctx();
    const d = new Date(Date.now() + 86400000).toISOString();
    (c.scheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...TASK,
      status: 'paused',
      scheduleType: 'once',
      runAt: d,
      cronExpr: null,
    });
    expect(
      (
        await invoke(c, {
          method: 'PATCH',
          path: `/api/schedules/${T}`,
          body: { status: 'active' },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH 400 bad runAt', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/schedules/${T}`,
          body: { runAt: 'bad', scheduleType: 'once' },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad cron', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/schedules/${T}`,
          body: { cronExpr: 'bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH scheduleType change', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/schedules/${T}`,
          body: { scheduleType: 'once' },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH 409 stale', async () => {
    const c = ctx();
    (c.scheduleStore.update as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new StaleUpdateError('schedules', 'stale');
    });
    expect(
      (
        await invoke(c, {
          method: 'PATCH',
          path: `/api/schedules/${T}`,
          body: { name: 'X', updatedAt: '2026-01-01' },
        })
      ).status,
    ).toBe(409);
  });
  it('PATCH 400 bad workdir', async () => {
    const c = ctx();
    (c.workdirManager.validateCustomWorkdir as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('bad');
    });
    expect(
      (await invoke(c, { method: 'PATCH', path: `/api/schedules/${T}`, body: { workdir: '/bad' } }))
        .status,
    ).toBe(400);
  });
  it('PATCH 400 bad skills', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/schedules/${T}`,
          body: { enabledSkills: 123 },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 long instruction', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/schedules/${T}`,
          body: { instructionFile: 'x'.repeat(50001) },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 403 blocked user', async () => {
    const c = ctx();
    c.config.allowedUserIds = ['U_OK'];
    expect(
      (await invoke(c, { method: 'PATCH', path: `/api/schedules/${T}`, body: { userId: 'U_BAD' } }))
        .status,
    ).toBe(403);
  });
  it('PATCH tz change with recurring', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/schedules/${T}`,
          body: { timezone: 'America/New_York' },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH long desc', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/schedules/${T}`,
          body: { description: 'x'.repeat(2001) },
        })
      ).status,
    ).toBe(400);
  });

  // DELETE
  it('DELETE 200', async () => {
    expect((await invoke(ctx(), { method: 'DELETE', path: `/api/schedules/${T}` })).status).toBe(
      200,
    );
  });
  it('DELETE 404', async () => {
    expect((await invoke(ctx(), { method: 'DELETE', path: `/api/schedules/${M}` })).status).toBe(
      404,
    );
  });

  // Runs
  it('GET runs 200', async () => {
    expect((await invoke(ctx(), { method: 'GET', path: `/api/schedules/${T}/runs` })).status).toBe(
      200,
    );
  });
  it('GET runs 404', async () => {
    expect((await invoke(ctx(), { method: 'GET', path: `/api/schedules/${M}/runs` })).status).toBe(
      404,
    );
  });
  it('GET run detail 200', async () => {
    const c = ctx();
    (c.scheduleStore.getRunById as ReturnType<typeof vi.fn>).mockReturnValue({ id: R, taskId: T });
    expect((await invoke(c, { method: 'GET', path: `/api/schedules/${T}/runs/${R}` })).status).toBe(
      200,
    );
  });
  it('GET run detail 404', async () => {
    expect(
      (await invoke(ctx(), { method: 'GET', path: `/api/schedules/${T}/runs/${M}` })).status,
    ).toBe(404);
  });

  it('unmatched false', async () => {
    expect((await invoke(ctx(), { method: 'GET', path: '/api/other' })).handled).toBe(false);
  });
});
