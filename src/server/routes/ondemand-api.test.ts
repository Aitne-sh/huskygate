import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../context/app-context.js';
import { StaleUpdateError } from '../../store/store-utils.js';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import { handleOndemandApiRoutes, matchesOndemandApiPath } from './ondemand-api.js';

class MockRequest extends EventEmitter {
  public method: string;
  public url?: string;
  public headers: Record<string, string>;

  constructor(method: string, url: string, headers?: Record<string, string>) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers ?? {};
  }

  destroy(): this {
    this.emit('close');
    return this;
  }
}

class MockResponse {
  public statusCode = 200;
  public body = '';
  public headers: Record<string, string> = {};

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.statusCode = statusCode;
    if (headers) this.headers = { ...headers };
    return this;
  }

  end(chunk?: string): this {
    if (chunk) this.body += chunk;
    return this;
  }
}

async function invoke(
  ctx: AppContext,
  options: { method: string; path: string; body?: unknown },
): Promise<{ handled: boolean; status: number; body: unknown }> {
  const req = new MockRequest(options.method, options.path, { 'content-type': 'application/json' });
  const res = new MockResponse();
  const promise = handleOndemandApiRoutes(
    ctx,
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse,
    options.path,
  );
  if (options.body !== undefined) {
    req.emit('data', Buffer.from(JSON.stringify(options.body), 'utf-8'));
  }
  req.emit('end');
  const handled = await promise;
  return {
    handled,
    status: res.statusCode,
    body: res.body ? JSON.parse(res.body) : null,
  };
}

const tempRoots: string[] = [];

function createContext() {
  const ctx = makeTestAppContext();
  const workdirRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ondemand-api-route-'));
  tempRoots.push(workdirRoot);
  const sessionWorkdir = path.join(workdirRoot, 'session-1');
  const taskWorkdir = path.join(workdirRoot, 'task-1');
  fs.mkdirSync(sessionWorkdir, { recursive: true });

  const task = {
    id: '11111111-1111-1111-1111-111111111111',
    status: 'active',
    userId: 'dashboard',
    tool: 'claude',
    prompt: 'run',
    workdir: taskWorkdir,
    allowMcp: false,
    enabledSkills: null,
    instructionFile: null,
  };

  ctx.config = { ...ctx.config, workdirRoot };
  ctx.ondemandTaskStore = {
    getById: vi.fn(() => task),
    recordRun: vi.fn(),
    updateRun: vi.fn(),
  } as unknown as AppContext['ondemandTaskStore'];
  ctx.sessionManager = {
    ...ctx.sessionManager,
    createStandaloneSession: vi.fn(() => ({ sessionKey: 'sess-1', workdir: sessionWorkdir })),
    deleteSessionByKeyWithCleanup: vi.fn(() => ({ threadKey: 'dashboard_1' })),
  } as unknown as AppContext['sessionManager'];
  ctx.workdirManager = {
    ...ctx.workdirManager,
    prepareWorkdirSkillsOnly: vi.fn(),
  } as unknown as AppContext['workdirManager'];
  ctx.jobQueue = {
    ...ctx.jobQueue,
    enqueue: vi.fn(() => ({ position: 1 })),
  } as unknown as AppContext['jobQueue'];

  return { ctx, sessionWorkdir, taskWorkdir };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('handleOndemandApiRoutes', () => {
  it('cleans up standalone resources when workdir preparation fails', async () => {
    const { ctx, sessionWorkdir, taskWorkdir } = createContext();
    (ctx.workdirManager.prepareWorkdirSkillsOnly as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        throw new Error('prepare failed');
      },
    );

    const response = await invoke(ctx, {
      method: 'POST',
      path: '/api/ondemand-tasks/11111111-1111-1111-1111-111111111111/execute',
    });

    expect(response.handled).toBe(true);
    expect(response.status).toBe(500);
    expect(ctx.sessionManager.deleteSessionByKeyWithCleanup).toHaveBeenCalledWith('sess-1');
    expect(fs.existsSync(sessionWorkdir)).toBe(false);
    expect(fs.existsSync(taskWorkdir)).toBe(false);
  });

  it('cleans up standalone resources when enqueue fails', async () => {
    const { ctx, sessionWorkdir, taskWorkdir } = createContext();
    (ctx.jobQueue.enqueue as ReturnType<typeof vi.fn>).mockReturnValue({ error: 'queue full' });

    const response = await invoke(ctx, {
      method: 'POST',
      path: '/api/ondemand-tasks/11111111-1111-1111-1111-111111111111/execute',
    });

    expect(response.handled).toBe(true);
    expect(response.status).toBe(503);
    expect(ctx.sessionManager.deleteSessionByKeyWithCleanup).toHaveBeenCalledWith('sess-1');
    expect(fs.existsSync(sessionWorkdir)).toBe(false);
    expect(fs.existsSync(taskWorkdir)).toBe(false);
  });
});

const T = '11111111-1111-1111-1111-111111111111';
const M = '99999999-9999-9999-9999-999999999999';
const TASK = {
  id: T,
  status: 'active',
  userId: 'dashboard',
  tool: 'claude',
  name: 'Test',
  prompt: 'run',
  workdir: null,
  allowMcp: false,
  enabledSkills: null,
  instructionFile: null,
  notifyChannel: null,
};

function createCrudCtx(): AppContext {
  const ctx = makeTestAppContext();
  ctx.ondemandTaskStore = {
    create: vi.fn((i: Record<string, unknown>) => ({ id: 't-new', ...i })),
    list: vi.fn(() => [TASK]),
    getById: vi.fn((id: string) => (id === T ? { ...TASK } : null)),
    update: vi.fn(),
    softDelete: vi.fn(),
    getRunsByTask: vi.fn(() => []),
  } as unknown as AppContext['ondemandTaskStore'];
  return ctx;
}

describe('matchesOndemandApiPath', () => {
  it('matches', () => {
    expect(matchesOndemandApiPath('/api/ondemand-tasks')).toBe(true);
    expect(matchesOndemandApiPath('/api/ondemand-tasks/x')).toBe(true);
    expect(matchesOndemandApiPath('/api/other')).toBe(false);
  });
});

describe('ondemand-api CRUD', () => {
  it('POST create 201', async () => {
    const r = await invoke(createCrudCtx(), {
      method: 'POST',
      path: '/api/ondemand-tasks',
      body: { name: 'N', prompt: 'P' },
    });
    expect(r.status).toBe(201);
  });
  it('POST 400 empty name', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'POST',
          path: '/api/ondemand-tasks',
          body: { name: '', prompt: 'P' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 long name', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'POST',
          path: '/api/ondemand-tasks',
          body: { name: 'x'.repeat(201), prompt: 'P' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 empty prompt', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'POST',
          path: '/api/ondemand-tasks',
          body: { name: 'N', prompt: '' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 long prompt', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'POST',
          path: '/api/ondemand-tasks',
          body: { name: 'N', prompt: 'x'.repeat(50001) },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 long alias', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'POST',
          path: '/api/ondemand-tasks',
          body: { name: 'N', prompt: 'P', alias: 'x'.repeat(201) },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 long desc', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'POST',
          path: '/api/ondemand-tasks',
          body: { name: 'N', prompt: 'P', description: 'x'.repeat(2001) },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad tool', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'POST',
          path: '/api/ondemand-tasks',
          body: { name: 'N', prompt: 'P', tool: 'bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad maxRetries', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'POST',
          path: '/api/ondemand-tasks',
          body: { name: 'N', prompt: 'P', maxRetries: 999 },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad skills', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'POST',
          path: '/api/ondemand-tasks',
          body: { name: 'N', prompt: 'P', enabledSkills: 123 },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 long instruction', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'POST',
          path: '/api/ondemand-tasks',
          body: { name: 'N', prompt: 'P', instructionFile: 'x'.repeat(50001) },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 403 blocked user', async () => {
    const c = createCrudCtx();
    c.config.allowedUserIds = ['U_OK'];
    expect(
      (
        await invoke(c, {
          method: 'POST',
          path: '/api/ondemand-tasks',
          body: { name: 'N', prompt: 'P', userId: 'U_BAD' },
        })
      ).status,
    ).toBe(403);
  });
  it('POST 400 bad workdir', async () => {
    const c = createCrudCtx();
    (c.workdirManager.validateCustomWorkdir as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('bad');
    });
    expect(
      (
        await invoke(c, {
          method: 'POST',
          path: '/api/ondemand-tasks',
          body: { name: 'N', prompt: 'P', workdir: '/bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 409 dup', async () => {
    const c = createCrudCtx();
    (c.ondemandTaskStore.create as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('already in use');
    });
    expect(
      (
        await invoke(c, {
          method: 'POST',
          path: '/api/ondemand-tasks',
          body: { name: 'N', prompt: 'P' },
        })
      ).status,
    ).toBe(409);
  });

  it('GET list 200', async () => {
    expect(
      (await invoke(createCrudCtx(), { method: 'GET', path: '/api/ondemand-tasks' })).status,
    ).toBe(200);
  });
  it('GET /:id 200', async () => {
    expect(
      (await invoke(createCrudCtx(), { method: 'GET', path: `/api/ondemand-tasks/${T}` })).status,
    ).toBe(200);
  });
  it('GET /:id 404', async () => {
    expect(
      (await invoke(createCrudCtx(), { method: 'GET', path: `/api/ondemand-tasks/${M}` })).status,
    ).toBe(404);
  });

  it('PATCH 200', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'PATCH',
          path: `/api/ondemand-tasks/${T}`,
          body: { name: 'U' },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH 404', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'PATCH',
          path: `/api/ondemand-tasks/${M}`,
          body: { name: 'X' },
        })
      ).status,
    ).toBe(404);
  });
  it('PATCH 400 long name', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'PATCH',
          path: `/api/ondemand-tasks/${T}`,
          body: { name: 'x'.repeat(201) },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 long alias', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'PATCH',
          path: `/api/ondemand-tasks/${T}`,
          body: { alias: 'x'.repeat(201) },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 long desc', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'PATCH',
          path: `/api/ondemand-tasks/${T}`,
          body: { description: 'x'.repeat(2001) },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad tool', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'PATCH',
          path: `/api/ondemand-tasks/${T}`,
          body: { tool: 'bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 empty prompt', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'PATCH',
          path: `/api/ondemand-tasks/${T}`,
          body: { prompt: '  ' },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 long prompt', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'PATCH',
          path: `/api/ondemand-tasks/${T}`,
          body: { prompt: 'x'.repeat(50001) },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad maxRetries', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'PATCH',
          path: `/api/ondemand-tasks/${T}`,
          body: { maxRetries: 999 },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad skills', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'PATCH',
          path: `/api/ondemand-tasks/${T}`,
          body: { enabledSkills: 123 },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad workdir', async () => {
    const c = createCrudCtx();
    (c.workdirManager.validateCustomWorkdir as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('bad');
    });
    expect(
      (
        await invoke(c, {
          method: 'PATCH',
          path: `/api/ondemand-tasks/${T}`,
          body: { workdir: '/bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 long instruction', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'PATCH',
          path: `/api/ondemand-tasks/${T}`,
          body: { instructionFile: 'x'.repeat(50001) },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 409 stale', async () => {
    const c = createCrudCtx();
    (c.ondemandTaskStore.update as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new StaleUpdateError('ondemand_tasks', 'stale');
    });
    expect(
      (
        await invoke(c, {
          method: 'PATCH',
          path: `/api/ondemand-tasks/${T}`,
          body: { name: 'X', updatedAt: '2026-01-01' },
        })
      ).status,
    ).toBe(409);
  });
  it('PATCH 409 dup', async () => {
    const c = createCrudCtx();
    (c.ondemandTaskStore.update as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('already in use');
    });
    expect(
      (await invoke(c, { method: 'PATCH', path: `/api/ondemand-tasks/${T}`, body: { name: 'X' } }))
        .status,
    ).toBe(409);
  });
  it('PATCH 403 blocked user', async () => {
    const c = createCrudCtx();
    c.config.allowedUserIds = ['U_OK'];
    expect(
      (
        await invoke(c, {
          method: 'PATCH',
          path: `/api/ondemand-tasks/${T}`,
          body: { userId: 'U_BAD' },
        })
      ).status,
    ).toBe(403);
  });
  it('PATCH notifyChannel', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'PATCH',
          path: `/api/ondemand-tasks/${T}`,
          body: { notifyChannel: 'C1' },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH notifyThread', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'PATCH',
          path: `/api/ondemand-tasks/${T}`,
          body: { notifyThread: 'thread-1' },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH allowMcp', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'PATCH',
          path: `/api/ondemand-tasks/${T}`,
          body: { allowMcp: true },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH alias null', async () => {
    expect(
      (
        await invoke(createCrudCtx(), {
          method: 'PATCH',
          path: `/api/ondemand-tasks/${T}`,
          body: { alias: null },
        })
      ).status,
    ).toBe(200);
  });

  it('DELETE 200', async () => {
    expect(
      (await invoke(createCrudCtx(), { method: 'DELETE', path: `/api/ondemand-tasks/${T}` }))
        .status,
    ).toBe(200);
  });
  it('DELETE 404', async () => {
    expect(
      (await invoke(createCrudCtx(), { method: 'DELETE', path: `/api/ondemand-tasks/${M}` }))
        .status,
    ).toBe(404);
  });

  it('execute 200', async () => {
    const { ctx } = createContext();
    (ctx.ondemandTaskStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...TASK,
      workdir: null,
    });
    const r = await invoke(ctx, { method: 'POST', path: `/api/ondemand-tasks/${T}/execute` });
    expect(r.status).toBe(200);
  });
  it('execute 404 missing', async () => {
    const { ctx } = createContext();
    (ctx.ondemandTaskStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(null);
    expect(
      (await invoke(ctx, { method: 'POST', path: `/api/ondemand-tasks/${M}/execute` })).status,
    ).toBe(404);
  });

  it('GET /:id/runs 200', async () => {
    expect(
      (await invoke(createCrudCtx(), { method: 'GET', path: `/api/ondemand-tasks/${T}/runs` }))
        .status,
    ).toBe(200);
  });
  it('GET /:id/runs 404', async () => {
    expect(
      (await invoke(createCrudCtx(), { method: 'GET', path: `/api/ondemand-tasks/${M}/runs` }))
        .status,
    ).toBe(404);
  });

  it('unmatched false', async () => {
    expect((await invoke(createCrudCtx(), { method: 'GET', path: '/api/other' })).handled).toBe(
      false,
    );
  });
});
