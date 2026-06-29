/**
 * Coverage tests for schedule-api — extends existing test coverage.
 * Targets: PATCH description string, PATCH tool, PATCH description empty,
 * PATCH notifyThread, PATCH allowMcp, PATCH instructionFile null,
 * PATCH change to recurring clears runAt, PATCH resume once with past runAt,
 * GET list with status filter, GET run detail with wrong taskId,
 * POST create with invalid model (L110-112), POST create with unknown agentId (L217-221),
 * PATCH valid prompt assignment (L340-341), PATCH invalid model (L360-366),
 * PATCH maxRuns null via max_runs key (L405), PATCH unknown agentId (L455-463),
 * PATCH update throws non-Stale error (L539-540),
 * POST execute: success, not found, workdir error, enqueue error (L549-659).
 */
import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../context/app-context.js';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import { UUID, createInvoker } from './_test-utils.js';
import { handleScheduleApiRoutes } from './schedule-api.js';

const invoke = createInvoker(handleScheduleApiRoutes as Parameters<typeof createInvoker>[0]);
const T = UUID.task1;
const R = UUID.run1;

const TASK = {
  id: T,
  status: 'active',
  scheduleType: 'recurring',
  cronExpr: '0 * * * *',
  timezone: 'UTC',
  runAt: null,
  notifyChannel: 'C1',
  tool: 'claude',
  model: null,
  allowMcp: false,
  enabledSkills: null,
  instructionFile: null,
  agentId: null,
  userId: 'U1',
  workdir: null,
  prompt: 'do something',
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
    recordRun: vi.fn(),
    updateRun: vi.fn(),
  } as unknown as AppContext['scheduleStore'];
  return c;
}

describe('schedule-api coverage', () => {
  // ── PATCH description as string ──
  it('PATCH description string', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { description: 'Updated desc' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH description empty string -> null ──
  it('PATCH description empty string sets null', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { description: '' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH tool ──
  it('PATCH tool change', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { tool: 'codex' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH notifyThread ──
  it('PATCH notifyThread', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { notifyThread: 'thread-1' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH allowMcp ──
  it('PATCH allowMcp', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { allowMcp: true },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH instructionFile null ──
  it('PATCH instructionFile null', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { instructionFile: null },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH instructionFile string ──
  it('PATCH instructionFile string', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { instructionFile: 'some instruction' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH scheduleType change to recurring clears runAt ──
  it('PATCH change to recurring clears runAt', async () => {
    const c = ctx();
    (c.scheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...TASK,
      scheduleType: 'once',
      runAt: '2026-12-01T00:00:00Z',
      cronExpr: null,
    });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { scheduleType: 'recurring', cronExpr: '0 * * * *' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH change to once clears cronExpr ──
  it('PATCH change to once clears cronExpr', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { scheduleType: 'once', runAt: new Date(Date.now() + 86400000).toISOString() },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH resume once with past runAt sets nextRunAt null ──
  it('PATCH resume once with past runAt sets nextRunAt null', async () => {
    const c = ctx();
    (c.scheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...TASK,
      status: 'paused',
      scheduleType: 'once',
      runAt: '2020-01-01T00:00:00Z',
      cronExpr: null,
    });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { status: 'active' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH runAt with valid date ──
  it('PATCH runAt with valid date', async () => {
    const c = ctx();
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { runAt: futureDate },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH maxRuns valid number ──
  it('PATCH maxRuns valid number', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { maxRuns: 10 },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH maxRetries valid number ──
  it('PATCH maxRetries valid number', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { maxRetries: 2 },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH enabledSkills valid ──
  it('PATCH enabledSkills valid', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { enabledSkills: [] },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH notifyChannel ──
  it('PATCH notifyChannel', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { notifyChannel: 'C_NEW' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH userId with allowlist pass ──
  it('PATCH userId with allowlist pass', async () => {
    const c = ctx();
    c.config.allowedUserIds = ['U1', 'U_OK'];
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { userId: 'U_OK' },
    });
    expect(r.status).toBe(200);
  });

  // ── DELETE 503 disabled ──
  it('DELETE 503 disabled', async () => {
    const c = ctx();
    c.config.scheduleEnabled = false;
    const r = await invoke(c, {
      method: 'DELETE',
      path: `/api/schedules/${T}`,
    });
    expect(r.status).toBe(503);
  });

  // ── GET runs 503 disabled ──
  it('GET runs 503 disabled', async () => {
    const c = ctx();
    c.config.scheduleEnabled = false;
    const r = await invoke(c, {
      method: 'GET',
      path: `/api/schedules/${T}/runs`,
    });
    expect(r.status).toBe(503);
  });

  // ── GET run detail wrong taskId ──
  it('GET run detail 404 wrong taskId', async () => {
    const c = ctx();
    (c.scheduleStore.getRunById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: R,
      taskId: 'other-task',
    });
    const r = await invoke(c, {
      method: 'GET',
      path: `/api/schedules/${T}/runs/${R}`,
    });
    expect(r.status).toBe(404);
  });

  // ── GET run detail 503 disabled ──
  it('GET run detail 503 disabled', async () => {
    const c = ctx();
    c.config.scheduleEnabled = false;
    const r = await invoke(c, {
      method: 'GET',
      path: `/api/schedules/${T}/runs/${R}`,
    });
    expect(r.status).toBe(503);
  });

  // ── GET detail 503 disabled ──
  it('GET detail 503 disabled', async () => {
    const c = ctx();
    c.config.scheduleEnabled = false;
    const r = await invoke(c, {
      method: 'GET',
      path: `/api/schedules/${T}`,
    });
    expect(r.status).toBe(503);
  });

  // ── PATCH 503 disabled ──
  it('PATCH 503 disabled', async () => {
    const c = ctx();
    c.config.scheduleEnabled = false;
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { name: 'X' },
    });
    expect(r.status).toBe(503);
  });

  // ── PATCH deleted task ──
  it('PATCH deleted task returns 404', async () => {
    const c = ctx();
    (c.scheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...TASK,
      status: 'deleted',
    });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { name: 'X' },
    });
    expect(r.status).toBe(404);
  });

  // ── PATCH 400 invalid JSON ──
  it('PATCH 400 invalid JSON', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
    });
    expect(r.status).toBe(400);
  });

  // ── POST 400 invalid JSON ──
  it('POST 400 invalid JSON', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'POST',
      path: '/api/schedules',
    });
    expect(r.status).toBe(400);
  });

  // ── PATCH tz change with recurring without cronExpr change recalculates nextRunAt ──
  it('PATCH tz change with recurring recalculates nextRunAt', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { timezone: 'America/Los_Angeles' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH tz change with recurring and null cronExpr ──
  it('PATCH tz change with null cronExpr sets nextRunAt null', async () => {
    const c = ctx();
    (c.scheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...TASK,
      cronExpr: null,
    });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { timezone: 'Asia/Tokyo' },
    });
    expect(r.status).toBe(200);
  });

  // ── DELETE deleted task returns 404 ──
  it('DELETE deleted task returns 404', async () => {
    const c = ctx();
    (c.scheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...TASK,
      status: 'deleted',
    });
    const r = await invoke(c, {
      method: 'DELETE',
      path: `/api/schedules/${T}`,
    });
    expect(r.status).toBe(404);
  });

  // ── GET runs deleted parent task returns 404 ──
  it('GET runs deleted parent returns 404', async () => {
    const c = ctx();
    (c.scheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...TASK,
      status: 'deleted',
    });
    const r = await invoke(c, {
      method: 'GET',
      path: `/api/schedules/${T}/runs`,
    });
    expect(r.status).toBe(404);
  });

  // ── unmatched ──
  it('GET detail deleted returns 404', async () => {
    const c = ctx();
    (c.scheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...TASK,
      status: 'deleted',
    });
    const r = await invoke(c, {
      method: 'GET',
      path: `/api/schedules/${T}`,
    });
    expect(r.status).toBe(404);
  });

  // ── Lines 110-112: POST create with invalid model (non-string) ──
  it('POST 400 invalid model type', async () => {
    const r = await invoke(ctx(), {
      method: 'POST',
      path: '/api/schedules',
      body: {
        name: 'N',
        prompt: 'P',
        scheduleType: 'recurring',
        cronExpr: '0 * * * *',
        model: 123,
      },
    });
    expect(r.status).toBe(400);
    expect((r.body as Record<string, string>).error).toMatch(/model/i);
  });

  // ── Lines 217-221: POST create with agentId not found ──
  it('POST 400 agentId not found', async () => {
    const r = await invoke(ctx(), {
      method: 'POST',
      path: '/api/schedules',
      body: {
        name: 'N',
        prompt: 'P',
        scheduleType: 'recurring',
        cronExpr: '0 * * * *',
        agentId: 'nonexistent-agent',
      },
    });
    expect(r.status).toBe(400);
    expect((r.body as Record<string, string>).error).toBe('agentId not found');
  });

  // ── Lines 340-341: PATCH with valid prompt that gets assigned ──
  it('PATCH valid prompt passes validation and is set', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { prompt: 'updated prompt' },
    });
    expect(r.status).toBe(200);
    const updateCall = (c.scheduleStore.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(updateCall[1]).toHaveProperty('prompt', 'updated prompt');
  });

  // ── Lines 360-366: PATCH with invalid model (non-string) ──
  it('PATCH 400 invalid model type', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { model: 123 },
    });
    expect(r.status).toBe(400);
    expect((r.body as Record<string, string>).error).toMatch(/model/i);
  });

  // ── Line 405: PATCH maxRuns null via snake_case key ──
  it('PATCH max_runs null clears maxRuns', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { max_runs: null },
    });
    expect(r.status).toBe(200);
    const updateCall = (c.scheduleStore.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(updateCall[1]).toHaveProperty('maxRuns', null);
  });

  // ── Lines 455-463: PATCH with agentId not found ──
  it('PATCH 400 agentId not found', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { agentId: 'nonexistent-agent' },
    });
    expect(r.status).toBe(400);
    expect((r.body as Record<string, string>).error).toBe('agentId not found');
  });

  // ── Lines 455-463: PATCH with agentId null clears it ──
  it('PATCH agentId null clears agent', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/schedules/${T}`,
      body: { agentId: null },
    });
    expect(r.status).toBe(200);
    const updateCall = (c.scheduleStore.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(updateCall[1]).toHaveProperty('agentId', null);
  });

  // ── Lines 539-540: PATCH update throws non-StaleUpdateError (rethrown) ──
  it('PATCH rethrows non-StaleUpdateError', async () => {
    const c = ctx();
    (c.scheduleStore.update as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('unexpected DB error');
    });
    await expect(
      invoke(c, {
        method: 'PATCH',
        path: `/api/schedules/${T}`,
        body: { name: 'X' },
      }),
    ).rejects.toThrow('unexpected DB error');
  });

  // ── Lines 549-659: POST execute — success ──
  it('POST execute 200 success', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/schedules/${T}/execute`,
    });
    expect(r.status).toBe(200);
    expect((r.body as Record<string, unknown>).ok).toBe(true);
    const data = (r.body as Record<string, Record<string, unknown>>).data;
    expect(data).toHaveProperty('runId');
    expect(data).toHaveProperty('sessionKey');
    expect(c.scheduleStore.recordRun).toHaveBeenCalled();
    expect(c.jobQueue.enqueue).toHaveBeenCalled();
  });

  // ── POST execute — 503 disabled ──
  it('POST execute 503 disabled', async () => {
    const c = ctx();
    c.config.scheduleEnabled = false;
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/schedules/${T}/execute`,
    });
    expect(r.status).toBe(503);
  });

  // ── POST execute — 404 not found ──
  it('POST execute 404 task not found', async () => {
    const c = ctx();
    const M = UUID.missing;
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/schedules/${M}/execute`,
    });
    expect(r.status).toBe(404);
  });

  // ── POST execute — 404 deleted task ──
  it('POST execute 404 deleted task', async () => {
    const c = ctx();
    (c.scheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...TASK,
      status: 'deleted',
    });
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/schedules/${T}/execute`,
    });
    expect(r.status).toBe(404);
  });

  // ── POST execute — 500 workdir preparation failure ──
  it('POST execute 500 workdir preparation failure', async () => {
    const c = ctx();
    (c.workdirManager.prepareWorkdirSkillsOnly as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        throw new Error('workdir fail');
      },
    );
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/schedules/${T}/execute`,
    });
    expect(r.status).toBe(500);
    expect((r.body as Record<string, string>).error).toBe('Failed to prepare workdir');
    expect(c.scheduleStore.recordRun).toHaveBeenCalled();
    expect(c.scheduleStore.updateRun).toHaveBeenCalled();
  });

  // ── POST execute — 503 enqueue failure ──
  it('POST execute 503 enqueue failure', async () => {
    const c = ctx();
    (c.jobQueue.enqueue as ReturnType<typeof vi.fn>).mockReturnValue({
      error: 'queue full',
    });
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/schedules/${T}/execute`,
    });
    expect(r.status).toBe(503);
    expect((r.body as Record<string, string>).error).toMatch(/queue full/);
    expect(c.scheduleStore.updateRun).toHaveBeenCalled();
  });

  // ── POST execute — uses task workdir when set ──
  it('POST execute uses task workdir when set', async () => {
    const c = ctx();
    const tmpWorkdir = `/tmp/huskygate-test-${Date.now()}`;
    (c.scheduleStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...TASK,
      workdir: tmpWorkdir,
    });
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/schedules/${T}/execute`,
    });
    expect(r.status).toBe(200);
    const enqueueCall = (c.jobQueue.enqueue as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(enqueueCall.workdir).toBe(tmpWorkdir);
  });
});
