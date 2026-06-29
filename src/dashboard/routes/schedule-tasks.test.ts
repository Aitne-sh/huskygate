import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteContext } from '../route-context.js';

const { jsonMock, readBodyMock } = vi.hoisted(() => ({
  jsonMock: vi.fn(),
  readBodyMock: vi.fn(),
}));

vi.mock('../../shared/http.js', () => ({
  json: jsonMock,
  readBody: readBodyMock,
}));

import { handleScheduleTaskRoutes } from './schedule-tasks.js';

function makeReq(method: string): IncomingMessage {
  return { method } as IncomingMessage;
}

function makeRes(): ServerResponse {
  return {} as ServerResponse;
}

function makeCtx(overrides?: Record<string, unknown>): RouteContext {
  const db = {
    getScheduledTasks: vi.fn().mockReturnValue([]),
    getScheduledTaskById: vi.fn(),
    getScheduledTaskRuns: vi.fn().mockReturnValue([]),
  };

  return {
    getDb: vi.fn(() => db),
    proxyToServerApi: vi.fn().mockResolvedValue({ status: 200, data: { ok: true } }),
    ...overrides,
  } as unknown as RouteContext;
}

describe('handleScheduleTaskRoutes', () => {
  const taskId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    jsonMock.mockReset();
    readBodyMock.mockReset();
  });

  it('lists scheduled tasks', async () => {
    const tasks = [{ id: taskId, name: 'daily report' }];
    const db = {
      getScheduledTasks: vi.fn().mockReturnValue(tasks),
      getScheduledTaskById: vi.fn(),
      getScheduledTaskRuns: vi.fn(),
    };
    const ctx = makeCtx({ getDb: vi.fn(() => db) });

    const handled = await handleScheduleTaskRoutes(
      ctx,
      makeReq('GET'),
      makeRes(),
      '/api/schedule-tasks',
      new URLSearchParams(),
    );

    expect(handled).toBe(true);
    expect(db.getScheduledTasks).toHaveBeenCalledTimes(1);
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, { ok: true, data: tasks });
  });

  it('returns 404 when task detail is missing', async () => {
    const db = {
      getScheduledTasks: vi.fn(),
      getScheduledTaskById: vi.fn().mockReturnValue(null),
      getScheduledTaskRuns: vi.fn(),
    };
    const ctx = makeCtx({ getDb: vi.fn(() => db) });

    const handled = await handleScheduleTaskRoutes(
      ctx,
      makeReq('GET'),
      makeRes(),
      `/api/schedule-tasks/${taskId}`,
      new URLSearchParams(),
    );

    expect(handled).toBe(true);
    expect(db.getScheduledTaskById).toHaveBeenCalledWith(taskId);
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 404, { error: 'Task not found' });
  });

  it('returns task detail with recent runs', async () => {
    const task = { id: taskId, name: 'daily report' };
    const runs = [{ id: 'run-1' }];
    const db = {
      getScheduledTasks: vi.fn(),
      getScheduledTaskById: vi.fn().mockReturnValue(task),
      getScheduledTaskRuns: vi.fn().mockReturnValue(runs),
    };
    const ctx = makeCtx({ getDb: vi.fn(() => db) });

    const handled = await handleScheduleTaskRoutes(
      ctx,
      makeReq('GET'),
      makeRes(),
      `/api/schedule-tasks/${taskId}`,
      new URLSearchParams(),
    );

    expect(handled).toBe(true);
    expect(db.getScheduledTaskRuns).toHaveBeenCalledWith(taskId, 10);
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      ok: true,
      data: { ...task, recentRuns: runs },
    });
  });

  it('returns runs with clamped limit query', async () => {
    const db = {
      getScheduledTasks: vi.fn(),
      getScheduledTaskById: vi.fn(),
      getScheduledTaskRuns: vi.fn().mockReturnValue([{ id: 'run-1' }]),
    };
    const ctx = makeCtx({ getDb: vi.fn(() => db) });

    const handled = await handleScheduleTaskRoutes(
      ctx,
      makeReq('GET'),
      makeRes(),
      `/api/schedule-tasks/${taskId}/runs`,
      new URLSearchParams('limit=999'),
    );

    expect(handled).toBe(true);
    expect(db.getScheduledTaskRuns).toHaveBeenCalledWith(taskId, 100);
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      ok: true,
      data: [{ id: 'run-1' }],
    });
  });

  it('proxies create/update/delete operations to server API', async () => {
    readBodyMock
      .mockResolvedValueOnce('{"name":"new"}')
      .mockResolvedValueOnce('{"name":"patched"}');
    const proxyToServerApi = vi
      .fn()
      .mockResolvedValueOnce({ status: 201, data: { created: true } })
      .mockResolvedValueOnce({ status: 200, data: { updated: true } })
      .mockResolvedValueOnce({ status: 200, data: { deleted: true } });
    const ctx = makeCtx({ proxyToServerApi });

    const postHandled = await handleScheduleTaskRoutes(
      ctx,
      makeReq('POST'),
      makeRes(),
      '/api/schedule-tasks',
      new URLSearchParams(),
    );
    const patchHandled = await handleScheduleTaskRoutes(
      ctx,
      makeReq('PATCH'),
      makeRes(),
      `/api/schedule-tasks/${taskId}`,
      new URLSearchParams(),
    );
    const deleteHandled = await handleScheduleTaskRoutes(
      ctx,
      makeReq('DELETE'),
      makeRes(),
      `/api/schedule-tasks/${taskId}`,
      new URLSearchParams(),
    );

    expect(postHandled).toBe(true);
    expect(patchHandled).toBe(true);
    expect(deleteHandled).toBe(true);
    expect(proxyToServerApi).toHaveBeenNthCalledWith(1, 'POST', '/api/schedules', '{"name":"new"}');
    expect(proxyToServerApi).toHaveBeenNthCalledWith(
      2,
      'PATCH',
      `/api/schedules/${taskId}`,
      '{"name":"patched"}',
    );
    expect(proxyToServerApi).toHaveBeenNthCalledWith(3, 'DELETE', `/api/schedules/${taskId}`);
  });

  it('proxies slack targets and notify', async () => {
    readBodyMock.mockResolvedValue('{"text":"hello"}');
    const proxyToServerApi = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, data: [{ id: 'T1' }] })
      .mockResolvedValueOnce({ status: 202, data: { queued: true } });
    const ctx = makeCtx({ proxyToServerApi });

    const targetsHandled = await handleScheduleTaskRoutes(
      ctx,
      makeReq('GET'),
      makeRes(),
      '/api/slack/targets',
      new URLSearchParams(),
    );
    const notifyHandled = await handleScheduleTaskRoutes(
      ctx,
      makeReq('POST'),
      makeRes(),
      '/api/notify',
      new URLSearchParams(),
    );

    expect(targetsHandled).toBe(true);
    expect(notifyHandled).toBe(true);
    expect(proxyToServerApi).toHaveBeenNthCalledWith(1, 'GET', '/api/slack/targets');
    expect(proxyToServerApi).toHaveBeenNthCalledWith(2, 'POST', '/api/notify', '{"text":"hello"}');
  });

  it('returns false for unmatched route', async () => {
    const ctx = makeCtx();

    const handled = await handleScheduleTaskRoutes(
      ctx,
      makeReq('GET'),
      makeRes(),
      '/api/not-handled',
      new URLSearchParams(),
    );

    expect(handled).toBe(false);
    expect(jsonMock).not.toHaveBeenCalled();
  });
});
