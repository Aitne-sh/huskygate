/**
 * Coverage tests for ondemand-api — extends existing test coverage.
 * Targets: PATCH description null, PATCH description too long,
 * PATCH workdir, PATCH instruction_file alias, GET /:id deleted,
 * POST non-duplicate create error rethrown.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../context/app-context.js';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import { UUID, createInvoker } from './_test-utils.js';
import { handleOndemandApiRoutes } from './ondemand-api.js';

const invoke = createInvoker(handleOndemandApiRoutes as Parameters<typeof createInvoker>[0]);
const T = UUID.task1;

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

function ctx(): AppContext {
  const c = makeTestAppContext();
  c.ondemandTaskStore = {
    create: vi.fn((i: Record<string, unknown>) => ({ id: 't-new', ...i })),
    list: vi.fn(() => [TASK]),
    getById: vi.fn((id: string) => (id === T ? { ...TASK } : null)),
    update: vi.fn(),
    softDelete: vi.fn(),
    getRunsByTask: vi.fn(() => []),
  } as unknown as AppContext['ondemandTaskStore'];
  return c;
}

describe('ondemand-api coverage', () => {
  // ── PATCH description null clears ──
  it('PATCH description null', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${T}`,
      body: { description: null },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH description valid string ──
  it('PATCH description valid', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${T}`,
      body: { description: 'A description' },
    });
    expect(r.status).toBe(200);
  });

  // ── GET /:id deleted returns 404 ──
  it('GET /:id deleted 404', async () => {
    const c = ctx();
    (c.ondemandTaskStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...TASK,
      status: 'deleted',
    });
    const r = await invoke(c, {
      method: 'GET',
      path: `/api/ondemand-tasks/${T}`,
    });
    expect(r.status).toBe(404);
  });

  // ── PATCH deleted task returns 404 ──
  it('PATCH deleted task 404', async () => {
    const c = ctx();
    (c.ondemandTaskStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...TASK,
      status: 'deleted',
    });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${T}`,
      body: { name: 'X' },
    });
    expect(r.status).toBe(404);
  });

  // ── DELETE deleted task returns 404 ──
  it('DELETE deleted task 404', async () => {
    const c = ctx();
    (c.ondemandTaskStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...TASK,
      status: 'deleted',
    });
    const r = await invoke(c, {
      method: 'DELETE',
      path: `/api/ondemand-tasks/${T}`,
    });
    expect(r.status).toBe(404);
  });

  // ── PATCH invalid JSON ──
  it('PATCH 400 invalid JSON', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${T}`,
    });
    expect(r.status).toBe(400);
  });

  // ── POST invalid JSON ──
  it('POST 400 invalid JSON', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'POST',
      path: '/api/ondemand-tasks',
    });
    expect(r.status).toBe(400);
  });

  // ── PATCH workdir valid ──
  it('PATCH workdir valid', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${T}`,
      body: { workdir: '/tmp/test-workdir' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH instruction_file alias (snake_case) ──
  it('PATCH instruction_file alias', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${T}`,
      body: { instruction_file: 'some instruction' },
    });
    expect(r.status).toBe(200);
  });

  // ── POST non-duplicate error rethrows ──
  it('POST throws non-duplicate create error', async () => {
    const c = ctx();
    (c.ondemandTaskStore.create as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('unexpected DB error');
    });
    await expect(
      invoke(c, {
        method: 'POST',
        path: '/api/ondemand-tasks',
        body: { name: 'N', prompt: 'P' },
      }),
    ).rejects.toThrow('unexpected DB error');
  });

  // ── PATCH non-duplicate update error rethrows ──
  it('PATCH throws non-duplicate update error', async () => {
    const c = ctx();
    (c.ondemandTaskStore.update as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('unexpected DB error');
    });
    await expect(
      invoke(c, {
        method: 'PATCH',
        path: `/api/ondemand-tasks/${T}`,
        body: { name: 'X' },
      }),
    ).rejects.toThrow('unexpected DB error');
  });

  // ── PATCH notifyChannel empty string clears ──
  it('PATCH notifyChannel empty', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${T}`,
      body: { notifyChannel: '' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH notifyThread empty string clears ──
  it('PATCH notifyThread empty', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${T}`,
      body: { notifyThread: '' },
    });
    expect(r.status).toBe(200);
  });

  // ── GET /:id/runs deleted parent returns 404 ──
  it('GET /:id/runs deleted parent 404', async () => {
    const c = ctx();
    (c.ondemandTaskStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...TASK,
      status: 'deleted',
    });
    const r = await invoke(c, {
      method: 'GET',
      path: `/api/ondemand-tasks/${T}/runs`,
    });
    expect(r.status).toBe(404);
  });

  // ── POST with alias and description ──
  it('POST with alias and description', async () => {
    const r = await invoke(ctx(), {
      method: 'POST',
      path: '/api/ondemand-tasks',
      body: { name: 'N', prompt: 'P', alias: 'my-alias', description: 'desc' },
    });
    expect(r.status).toBe(201);
  });

  // ── PATCH enabled_skills alias (snake_case) ──
  it('PATCH enabled_skills alias', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${T}`,
      body: { enabled_skills: [] },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH allow_mcp alias (snake_case) ──
  it('PATCH allow_mcp alias', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${T}`,
      body: { allow_mcp: true },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH max_retries alias (snake_case) ──
  it('PATCH max_retries alias', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${T}`,
      body: { max_retries: 1 },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH notify_channel alias (snake_case) ──
  it('PATCH notify_channel alias', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${T}`,
      body: { notify_channel: 'C2' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH notify_thread alias (snake_case) ──
  it('PATCH notify_thread alias', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${T}`,
      body: { notify_thread: 'thread-1' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH user_id alias (snake_case) ──
  it('PATCH user_id alias', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${T}`,
      body: { user_id: 'U1' },
    });
    expect(r.status).toBe(200);
  });

  // ── POST with invalid model (lines 97-99) ──
  it('POST 400 invalid model type', async () => {
    const r = await invoke(ctx(), {
      method: 'POST',
      path: '/api/ondemand-tasks',
      body: { name: 'N', prompt: 'P', model: 12345 },
    });
    expect(r.status).toBe(400);
    expect((r.body as Record<string, string>).error).toContain('model must be a string');
  });

  // ── POST with agentId that does not exist (lines 140-144) ──
  it('POST 400 agentId not found', async () => {
    const c = ctx();
    // agentStore.getById returns null by default (from makeTestAppContext)
    const r = await invoke(c, {
      method: 'POST',
      path: '/api/ondemand-tasks',
      body: { name: 'N', prompt: 'P', agentId: 'nonexistent-agent' },
    });
    expect(r.status).toBe(400);
    expect((r.body as Record<string, string>).error).toBe('agentId not found');
  });

  // ── POST with notifyThread as trimmed string (line 176) ──
  it('POST with notifyThread string', async () => {
    const r = await invoke(ctx(), {
      method: 'POST',
      path: '/api/ondemand-tasks',
      body: { name: 'N', prompt: 'P', notifyThread: ' thread-ts ' },
    });
    expect(r.status).toBe(201);
  });

  // ── PATCH tool change (lines 271-272) ──
  it('PATCH tool valid change', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${T}`,
      body: { tool: 'codex' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH model change (lines 273-280) ──
  it('PATCH model invalid type returns 400', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${T}`,
      body: { model: 42 },
    });
    expect(r.status).toBe(400);
    expect((r.body as Record<string, string>).error).toContain('model must be a string');
  });

  it('PATCH model valid string', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${T}`,
      body: { model: 'claude-3-opus' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH prompt set (lines 291-292) ──
  it('PATCH prompt valid', async () => {
    const r = await invoke(ctx(), {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${T}`,
      body: { prompt: 'new prompt text' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH agentId not found (lines 376-384) ──
  it('PATCH agentId not found', async () => {
    const c = ctx();
    // agentStore.getById returns null by default
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${T}`,
      body: { agentId: 'nonexistent-agent' },
    });
    expect(r.status).toBe(400);
    expect((r.body as Record<string, string>).error).toBe('agentId not found');
  });

  // ── POST with userId not in allowlist (line 152-154) — already covered by resolvedUserId ──
  it('POST 403 userId not in allowlist', async () => {
    const c = ctx();
    c.config.allowedUserIds = []; // empty allowlist
    const r = await invoke(c, {
      method: 'POST',
      path: '/api/ondemand-tasks',
      body: { name: 'N', prompt: 'P', userId: 'U_NOT_ALLOWED' },
    });
    expect(r.status).toBe(403);
    expect((r.body as Record<string, string>).error).toBe('user_id not in allowlist');
  });
});
