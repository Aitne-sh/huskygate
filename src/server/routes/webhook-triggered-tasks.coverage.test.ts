/** Coverage tests for webhook-triggered-tasks.ts — targeting 100% statement and branch coverage. */
import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../context/app-context.js';
import type { TriggeredTask, WebhookEndpoint } from '../../event/types.js';
import { buildSkillRef } from '../../skills/catalog.js';
import { StaleUpdateError } from '../../store/store-utils.js';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import { UUID, createInvoker } from './_test-utils.js';
import { handleTriggeredTaskRoutes } from './webhook-triggered-tasks.js';

const invoke = createInvoker(handleTriggeredTaskRoutes as Parameters<typeof createInvoker>[0]);

const TASK_ID = UUID.task1;
const ENDPOINT_ID = UUID.endpoint1;

function makeTask(overrides: Partial<TriggeredTask> = {}): TriggeredTask {
  return {
    id: TASK_ID,
    name: 'Test Task',
    description: null,
    userId: 'dashboard',
    tool: 'claude',
    model: null,
    mode: 'write',
    prompt: 'do something',
    workdir: null,
    maxRetries: 0,
    allowMcp: false,
    enabledSkills: null,
    instructionFile: null,
    agentId: null,
    notifyChannel: null,
    notifyThread: null,
    enabled: true,
    runCount: 0,
    lastRunAt: null,
    concurrencyPolicy: 'skip_if_running',
    claimedAt: null,
    createdAt: '2026-03-08T00:00:00.000Z',
    updatedAt: '2026-03-08T00:00:00.000Z',
    ...overrides,
  };
}

function makeEndpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: ENDPOINT_ID,
    token: 'token123456789ab',
    publisherPreset: 'github',
    verificationType: 'hmac-sha256',
    signatureHeader: 'x-hub-signature-256',
    signaturePrefix: 'sha256=',
    deliveryIdHeader: 'x-github-delivery',
    eventNameHeader: 'x-github-event',
    secretRef: 'secret:endpoint-1',
    maxBodyBytes: 131072,
    enabled: true,
    createdAt: '2026-03-08T00:00:00.000Z',
    updatedAt: '2026-03-08T00:00:00.000Z',
    ...overrides,
  };
}

function createCtx(): AppContext {
  const task = makeTask();
  const endpoint = makeEndpoint();
  const ctx = makeTestAppContext();
  ctx.triggeredTaskStore = {
    getById: vi.fn((id: string) => (id === TASK_ID ? task : null)),
    list: vi.fn(() => [task]),
    getRunsByTask: vi.fn(() => []),
    create: vi.fn((input: Record<string, unknown>) => ({
      ...task,
      ...input,
      id: TASK_ID,
    })),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(<T>(fn: () => T) => fn()),
  } as unknown as AppContext['triggeredTaskStore'];
  ctx.webhookEndpointStore = {
    getById: vi.fn((id: string) => (id === ENDPOINT_ID ? endpoint : null)),
    list: vi.fn(() => [endpoint]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as AppContext['webhookEndpointStore'];
  ctx.eventSubscriptionStore = {
    getById: vi.fn(() => null),
    list: vi.fn(() => []),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as AppContext['eventSubscriptionStore'];
  return ctx;
}

describe('handleTriggeredTaskRoutes', () => {
  // ── GET /api/triggered-tasks ────────────────────────────────
  describe('GET /api/triggered-tasks', () => {
    it('lists all triggered tasks', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, { method: 'GET', path: '/api/triggered-tasks' });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(200);
      expect((r.body as Record<string, unknown>).ok).toBe(true);
    });
  });

  // ── POST /api/triggered-tasks ───────────────────────────────
  describe('POST /api/triggered-tasks', () => {
    it('creates a triggered task with minimal fields', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'My Task', prompt: 'run this' },
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(201);
      expect(ctx.triggeredTaskStore.create).toHaveBeenCalled();
    });

    it('creates a task with all optional fields', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: {
          name: 'Full Task',
          prompt: 'run everything',
          description: 'A description',
          tool: 'gemini',
          enabled: false,
          maxRetries: 3,
          allowMcp: true,
          enabledSkills: [buildSkillRef('builtin', 'playwright-runner')],
          instructionFile: 'path/to/file',
          notifyChannel: 'C123',
          workdir: '/some/path',
          concurrencyPolicy: 'allow',
        },
      });
      expect(r.status).toBe(201);
      expect(ctx.triggeredTaskStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Full Task',
          prompt: 'run everything',
          tool: 'gemini',
          maxRetries: 3,
          allowMcp: true,
          concurrencyPolicy: 'allow',
        }),
      );
    });

    it('rejects invalid JSON', async () => {
      const ctx = createCtx();
      const { MockRequest, MockResponse } = await import('./_test-utils.js');
      const req = new MockRequest('POST', '/api/triggered-tasks');
      const res = new MockResponse();
      const promise = handleTriggeredTaskRoutes(
        ctx,
        req as unknown as import('node:http').IncomingMessage,
        res as unknown as import('node:http').ServerResponse,
        '/api/triggered-tasks',
      );
      req.emit('data', Buffer.from('not json'));
      req.emit('end');
      await promise;
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ error: 'Invalid JSON' });
    });

    it('rejects missing name', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { prompt: 'run' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'name is required' });
    });

    it('rejects empty name after trim', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: '  ', prompt: 'run' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'name is required' });
    });

    it('rejects missing prompt', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'prompt is required' });
    });

    it('rejects empty prompt after trim', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: '   ' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'prompt is required' });
    });

    it('rejects invalid tool name', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', tool: 'invalid' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'tool must be claude, codex, or gemini' });
    });

    it('defaults tool to claude when not a string', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', tool: 123 },
      });
      expect(r.status).toBe(201);
      expect(ctx.triggeredTaskStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ tool: 'claude' }),
      );
    });

    it('rejects invalid enabledSkills', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', enabledSkills: 'not-array' },
      });
      expect(r.status).toBe(400);
      expect((r.body as Record<string, string>).error).toContain('enabledSkills');
    });

    it('accepts enabled_skills (snake_case alias)', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: {
          name: 'Test',
          prompt: 'run',
          enabled_skills: [buildSkillRef('builtin', 'playwright-runner')],
        },
      });
      expect(r.status).toBe(201);
    });

    it('rejects maxRetries out of range', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', maxRetries: 99 },
      });
      expect(r.status).toBe(400);
      expect((r.body as Record<string, string>).error).toContain('maxRetries');
    });

    it('rejects non-number maxRetries', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', maxRetries: 'five' },
      });
      expect(r.status).toBe(400);
      expect((r.body as Record<string, string>).error).toContain('maxRetries');
    });

    it('accepts max_retries snake_case alias', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', max_retries: 2 },
      });
      expect(r.status).toBe(201);
    });

    it('rejects non-finite maxRetries', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', maxRetries: 'not-a-number' },
      });
      expect(r.status).toBe(400);
    });

    it('rejects invalid concurrencyPolicy', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', concurrencyPolicy: 'invalid' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({
        error: 'concurrencyPolicy must be allow or skip_if_running',
      });
    });

    it('accepts concurrency_policy snake_case alias', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', concurrency_policy: 'allow' },
      });
      expect(r.status).toBe(201);
    });

    it('rejects instructionFile too long', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', instructionFile: 'x'.repeat(60_000) },
      });
      expect(r.status).toBe(400);
      expect((r.body as Record<string, string>).error).toContain('instructionFile');
    });

    it('accepts instruction_file snake_case alias', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', instruction_file: 'path/to/file' },
      });
      expect(r.status).toBe(201);
    });

    it('rejects user_id not in allowlist', async () => {
      const ctx = createCtx();
      ctx.config.allowedUserIds = ['U_ALLOWED'];
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', userId: 'U_BLOCKED', notifyChannel: 'C123' },
      });
      expect(r.status).toBe(403);
      expect(r.body).toEqual({ error: 'user_id not in allowlist' });
    });

    it('resolves userId from snake_case user_id and notify_channel', async () => {
      const ctx = createCtx();
      ctx.config.allowedUserIds = ['U1'];
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', user_id: 'U1', notify_channel: 'C123' },
      });
      expect(r.status).toBe(201);
    });

    it('creates task with inline subscription', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: {
          name: 'Test',
          prompt: 'run',
          subscription: { endpointId: ENDPOINT_ID },
        },
      });
      expect(r.status).toBe(201);
      expect(ctx.eventSubscriptionStore.create).toHaveBeenCalled();
      expect(ctx.eventRouter.reload).toHaveBeenCalled();
    });

    it('creates task without subscription (no router refresh)', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run' },
      });
      expect(r.status).toBe(201);
      expect(ctx.eventRouter.reload).not.toHaveBeenCalled();
    });

    it('rejects inline subscription with invalid filterJson', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: {
          name: 'Test',
          prompt: 'run',
          subscription: { endpointId: ENDPOINT_ID, filterJson: '{bad' },
        },
      });
      expect(r.status).toBe(400);
    });

    it('rejects subscription with missing endpointId', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: {
          name: 'Test',
          prompt: 'run',
          subscription: { enabled: true },
        },
      });
      expect(r.status).toBe(400);
    });

    it('rejects subscription with endpointId not found', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: {
          name: 'Test',
          prompt: 'run',
          subscription: { endpointId: UUID.missing },
        },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'endpointId not found' });
    });

    it('returns 400 when endpoint disappears during transaction (InlineSubscriptionEndpointMissingError)', async () => {
      const ctx = createCtx();
      // First call for pre-check passes, then disappears inside transaction
      (ctx.webhookEndpointStore.getById as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(makeEndpoint())
        .mockReturnValueOnce(null);
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: {
          name: 'Test',
          prompt: 'run',
          subscription: { endpointId: ENDPOINT_ID },
        },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'endpointId not found' });
    });

    it('re-throws unknown errors during create with subscription', async () => {
      const ctx = createCtx();
      (ctx.triggeredTaskStore.transaction as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('unexpected');
      });
      await expect(
        invoke(ctx, {
          method: 'POST',
          path: '/api/triggered-tasks',
          body: {
            name: 'Test',
            prompt: 'run',
            subscription: { endpointId: ENDPOINT_ID },
          },
        }),
      ).rejects.toThrow('unexpected');
    });

    it('handles non-string name gracefully', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 123, prompt: 'run' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'name is required' });
    });

    it('handles non-string prompt gracefully', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 123 },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'prompt is required' });
    });

    it('uses allow_mcp snake_case alias', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', allow_mcp: true },
      });
      expect(r.status).toBe(201);
      expect(ctx.triggeredTaskStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ allowMcp: true }),
      );
    });

    it('defaults concurrencyPolicy to skip_if_running', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run' },
      });
      expect(r.status).toBe(201);
      expect(ctx.triggeredTaskStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ concurrencyPolicy: 'skip_if_running' }),
      );
    });

    it('sets description to null for non-string description', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', description: 123 },
      });
      expect(r.status).toBe(201);
      expect(ctx.triggeredTaskStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: null }),
      );
    });

    it('handles non-string instructionFile (sets to null)', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', instructionFile: 123 },
      });
      expect(r.status).toBe(201);
      expect(ctx.triggeredTaskStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ instructionFile: null }),
      );
    });
  });

  // ── GET /api/triggered-tasks/:id ────────────────────────────
  describe('GET /api/triggered-tasks/:id', () => {
    it('returns a task with recent runs', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'GET',
        path: `/api/triggered-tasks/${TASK_ID}`,
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(200);
      const data = (r.body as Record<string, unknown>).data as Record<string, unknown>;
      expect(data.recentRuns).toBeDefined();
    });

    it('returns 404 when task not found', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'GET',
        path: `/api/triggered-tasks/${UUID.missing}`,
      });
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: 'Task not found' });
    });
  });

  // ── PATCH /api/triggered-tasks/:id ──────────────────────────
  describe('PATCH /api/triggered-tasks/:id', () => {
    it('patches a task with basic fields', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { name: 'Updated', prompt: 'new prompt' },
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(200);
      expect(ctx.triggeredTaskStore.update).toHaveBeenCalled();
    });

    it('returns 404 when task not found for patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${UUID.missing}`,
        body: { name: 'New Name' },
      });
      expect(r.status).toBe(404);
    });

    it('rejects invalid JSON in patch', async () => {
      const ctx = createCtx();
      const { MockRequest, MockResponse } = await import('./_test-utils.js');
      const req = new MockRequest('PATCH', `/api/triggered-tasks/${TASK_ID}`);
      const res = new MockResponse();
      const promise = handleTriggeredTaskRoutes(
        ctx,
        req as unknown as import('node:http').IncomingMessage,
        res as unknown as import('node:http').ServerResponse,
        `/api/triggered-tasks/${TASK_ID}`,
      );
      req.emit('data', Buffer.from('not json'));
      req.emit('end');
      await promise;
      expect(res.statusCode).toBe(400);
    });

    it('patches description to null', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { description: null },
      });
      expect(r.status).toBe(200);
    });

    it('rejects invalid tool in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { tool: 'invalid' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'tool must be claude, codex, or gemini' });
    });

    it('patches tool with a valid value', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { tool: 'codex' },
      });
      expect(r.status).toBe(200);
    });

    it('patches workdir', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { workdir: '/new/path' },
      });
      expect(r.status).toBe(200);
    });

    it('patches workdir to null', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { workdir: null },
      });
      expect(r.status).toBe(200);
    });

    it('rejects maxRetries out of range in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { maxRetries: 99 },
      });
      expect(r.status).toBe(400);
    });

    it('accepts max_retries snake_case alias in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { max_retries: 2 },
      });
      expect(r.status).toBe(200);
    });

    it('patches allowMcp', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { allowMcp: true },
      });
      expect(r.status).toBe(200);
    });

    it('patches allow_mcp snake_case alias', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { allow_mcp: true },
      });
      expect(r.status).toBe(200);
    });

    it('patches enabled', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { enabled: false },
      });
      expect(r.status).toBe(200);
    });

    it('patches notifyChannel', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { notifyChannel: 'C456' },
      });
      expect(r.status).toBe(200);
    });

    it('patches notify_channel snake_case alias', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { notify_channel: 'C456' },
      });
      expect(r.status).toBe(200);
    });

    it('rejects instructionFile too long in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { instructionFile: 'x'.repeat(60_000) },
      });
      expect(r.status).toBe(400);
    });

    it('patches instruction_file snake_case alias', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { instruction_file: 'path/to/file' },
      });
      expect(r.status).toBe(200);
    });

    it('sets instructionFile to null when non-string', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { instructionFile: null },
      });
      expect(r.status).toBe(200);
    });

    it('rejects invalid enabledSkills in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { enabledSkills: 'not-array' },
      });
      expect(r.status).toBe(400);
    });

    it('patches enabled_skills snake_case alias', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { enabled_skills: [buildSkillRef('builtin', 'playwright-runner')] },
      });
      expect(r.status).toBe(200);
    });

    it('rejects invalid concurrencyPolicy in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { concurrencyPolicy: 'invalid' },
      });
      expect(r.status).toBe(400);
    });

    it('patches concurrency_policy snake_case alias', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { concurrency_policy: 'allow' },
      });
      expect(r.status).toBe(200);
    });

    it('rejects user_id not in allowlist on patch', async () => {
      const ctx = createCtx();
      ctx.config.allowedUserIds = ['U_ALLOWED'];
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { userId: 'U_BLOCKED' },
      });
      expect(r.status).toBe(403);
    });

    it('resolves userId from notify_channel on patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { notify_channel: 'C999' },
      });
      expect(r.status).toBe(200);
    });

    it('resolves userId from user_id on patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { user_id: 'dashboard' },
      });
      expect(r.status).toBe(200);
    });

    it('does not resolve userId when neither userId nor notifyChannel are provided', async () => {
      const ctx = createCtx();
      ctx.config.allowedUserIds = ['U_ALLOWED'];
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { name: 'Updated' },
      });
      expect(r.status).toBe(200);
    });

    it('rejects inline subscription errors on patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: {
          subscription: { endpointId: ENDPOINT_ID, filterJson: '{bad' },
        },
      });
      expect(r.status).toBe(400);
    });

    it('rejects subscription with endpointId not found on patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: {
          subscription: { endpointId: UUID.missing },
        },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'endpointId not found' });
    });

    it('upserts inline subscription (creates new when none exists)', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: {
          subscription: { endpointId: ENDPOINT_ID },
        },
      });
      expect(r.status).toBe(200);
      expect(ctx.eventSubscriptionStore.create).toHaveBeenCalled();
      expect(ctx.eventRouter.reload).toHaveBeenCalled();
    });

    it('upserts inline subscription (updates existing)', async () => {
      const ctx = createCtx();
      (ctx.eventSubscriptionStore.list as ReturnType<typeof vi.fn>).mockReturnValue([
        {
          id: 'sub-1',
          endpointId: ENDPOINT_ID,
          targetType: 'triggered_task',
          orchestratorId: null,
          triggeredTaskId: TASK_ID,
          nodeId: null,
          filterJson: null,
          contextMappingJson: null,
          enabled: true,
          createdAt: '2026-03-08T00:00:00.000Z',
          updatedAt: '2026-03-08T00:00:00.000Z',
        },
      ]);
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: {
          subscription: { endpointId: ENDPOINT_ID },
        },
      });
      expect(r.status).toBe(200);
      expect(ctx.eventSubscriptionStore.update).toHaveBeenCalled();
    });

    it('removes inline subscription when subscription is null', async () => {
      const ctx = createCtx();
      (ctx.eventSubscriptionStore.list as ReturnType<typeof vi.fn>).mockReturnValue([
        {
          id: 'sub-1',
          endpointId: ENDPOINT_ID,
          targetType: 'triggered_task',
          orchestratorId: null,
          triggeredTaskId: TASK_ID,
          nodeId: null,
          filterJson: null,
          contextMappingJson: null,
          enabled: true,
          createdAt: '2026-03-08T00:00:00.000Z',
          updatedAt: '2026-03-08T00:00:00.000Z',
        },
      ]);
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { subscription: null },
      });
      expect(r.status).toBe(200);
      expect(ctx.eventSubscriptionStore.delete).toHaveBeenCalledWith('sub-1');
      expect(ctx.eventRouter.reload).toHaveBeenCalled();
    });

    it('does nothing when removing subscription that does not exist', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { subscription: null },
      });
      expect(r.status).toBe(200);
      expect(ctx.eventSubscriptionStore.delete).not.toHaveBeenCalled();
    });

    it('returns 409 on StaleUpdateError', async () => {
      const ctx = createCtx();
      (ctx.triggeredTaskStore.update as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new StaleUpdateError('triggered_tasks', '2026-03-08T00:00:00.000Z');
      });
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { updatedAt: '2026-03-07T00:00:00.000Z' },
      });
      expect(r.status).toBe(409);
    });

    it('handles updatedAt for optimistic concurrency', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { updatedAt: '2026-03-08T00:00:00.000Z', name: 'Updated' },
      });
      expect(r.status).toBe(200);
      expect(ctx.triggeredTaskStore.update).toHaveBeenCalledWith(
        TASK_ID,
        expect.any(Object),
        '2026-03-08T00:00:00.000Z',
      );
    });

    it('returns 400 when endpoint disappears during patch transaction', async () => {
      const ctx = createCtx();
      (ctx.webhookEndpointStore.getById as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(makeEndpoint())
        .mockReturnValueOnce(null);
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: {
          subscription: { endpointId: ENDPOINT_ID },
        },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'endpointId not found' });
    });

    it('returns 409 on subscription conflict (triggered task unique)', async () => {
      const ctx = createCtx();
      (ctx.triggeredTaskStore.transaction as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('UNIQUE constraint failed: event_subscriptions.triggered_task_id');
      });
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: {
          subscription: { endpointId: ENDPOINT_ID },
        },
      });
      expect(r.status).toBe(409);
      expect(r.body).toEqual({ error: 'Triggered task subscription already exists' });
    });

    it('re-throws unknown errors during patch', async () => {
      const ctx = createCtx();
      (ctx.triggeredTaskStore.update as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('unexpected');
      });
      await expect(
        invoke(ctx, {
          method: 'PATCH',
          path: `/api/triggered-tasks/${TASK_ID}`,
          body: { name: 'Updated' },
        }),
      ).rejects.toThrow('unexpected');
    });

    it('patches without subscription (omit) does not refresh router', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { name: 'Updated' },
      });
      expect(r.status).toBe(200);
      expect(ctx.eventRouter.reload).not.toHaveBeenCalled();
    });
  });

  // ── DELETE /api/triggered-tasks/:id ─────────────────────────
  describe('DELETE /api/triggered-tasks/:id', () => {
    it('deletes a task', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'DELETE',
        path: `/api/triggered-tasks/${TASK_ID}`,
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(200);
      expect(ctx.triggeredTaskStore.delete).toHaveBeenCalledWith(TASK_ID);
      expect(ctx.eventRouter.reload).toHaveBeenCalled();
    });

    it('returns 404 when task not found for delete', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'DELETE',
        path: `/api/triggered-tasks/${UUID.missing}`,
      });
      expect(r.status).toBe(404);
    });
  });

  // ── GET /api/triggered-tasks/:id/runs ───────────────────────
  describe('GET /api/triggered-tasks/:id/runs', () => {
    it('returns runs for a task', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'GET',
        path: `/api/triggered-tasks/${TASK_ID}/runs`,
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(200);
      expect((r.body as Record<string, unknown>).ok).toBe(true);
    });

    it('returns 404 when task not found for runs', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'GET',
        path: `/api/triggered-tasks/${UUID.missing}/runs`,
      });
      expect(r.status).toBe(404);
    });

    it('parses limit query parameter', async () => {
      const ctx = createCtx();
      const { MockRequest, MockResponse } = await import('./_test-utils.js');
      const req = new MockRequest('GET', `/api/triggered-tasks/${TASK_ID}/runs?limit=5`);
      const res = new MockResponse();
      const handled = await handleTriggeredTaskRoutes(
        ctx,
        req as unknown as import('node:http').IncomingMessage,
        res as unknown as import('node:http').ServerResponse,
        `/api/triggered-tasks/${TASK_ID}/runs`,
      );
      expect(handled).toBe(true);
      expect(ctx.triggeredTaskStore.getRunsByTask).toHaveBeenCalledWith(
        TASK_ID,
        expect.any(Number),
      );
    });
  });

  // ── POST /api/triggered-tasks — additional validation edge cases ──
  describe('POST /api/triggered-tasks (validation edge cases)', () => {
    it('rejects name exceeding max length', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'x'.repeat(201), prompt: 'run' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'name must be <= 200 characters' });
    });

    it('rejects prompt exceeding max length', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'x'.repeat(50_001) },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'prompt must be <= 50000 characters' });
    });

    it('rejects invalid model type (normalizeModel error)', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', model: 12345 },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'model must be a string' });
    });

    it('rejects model exceeding max length', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', model: 'x'.repeat(101) },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'model must be <= 100 characters' });
    });

    it('rejects agentId not found', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', agentId: 'nonexistent-agent' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'agentId not found' });
    });

    it('accepts agent_id snake_case alias when agent exists', async () => {
      const ctx = createCtx();
      (ctx.agentStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'agent-1',
        name: 'Test Agent',
        tool: 'claude',
        model: null,
        allowMcp: false,
        enabledSkills: null,
        enabledMcpServerIds: null,
        systemInstruction: null,
      });
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/triggered-tasks',
        body: { name: 'Test', prompt: 'run', agent_id: 'agent-1' },
      });
      expect(r.status).toBe(201);
    });
  });

  // ── PATCH /api/triggered-tasks/:id — additional validation edge cases ──
  describe('PATCH /api/triggered-tasks/:id (validation edge cases)', () => {
    it('rejects name exceeding max length in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { name: 'x'.repeat(201) },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'name must be <= 200 characters' });
    });

    it('rejects invalid model type in patch (normalizeModel error)', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { model: 12345 },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'model must be a string' });
    });

    it('rejects model exceeding max length in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { model: 'x'.repeat(101) },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'model must be <= 100 characters' });
    });

    it('rejects prompt exceeding max length in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { prompt: 'x'.repeat(50_001) },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'prompt must be <= 50000 characters' });
    });

    it('patches notifyThread', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { notifyThread: 'thread-123' },
      });
      expect(r.status).toBe(200);
      expect(ctx.triggeredTaskStore.update).toHaveBeenCalled();
    });

    it('patches notify_thread snake_case alias', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { notify_thread: 'thread-456' },
      });
      expect(r.status).toBe(200);
      expect(ctx.triggeredTaskStore.update).toHaveBeenCalled();
    });

    it('rejects agentId not found in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { agentId: 'nonexistent-agent' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'agentId not found' });
    });

    it('accepts valid agentId in patch', async () => {
      const ctx = createCtx();
      (ctx.agentStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'agent-1',
        name: 'Test Agent',
        tool: 'claude',
        model: null,
        allowMcp: false,
        enabledSkills: null,
        enabledMcpServerIds: null,
        systemInstruction: null,
      });
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { agentId: 'agent-1' },
      });
      expect(r.status).toBe(200);
    });

    it('clears agentId to null in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { agentId: null },
      });
      expect(r.status).toBe(200);
    });

    it('clears agent_id via snake_case alias in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/triggered-tasks/${TASK_ID}`,
        body: { agent_id: null },
      });
      expect(r.status).toBe(200);
    });
  });

  // ── POST /api/triggered-tasks/:id/execute ─────────────────────
  describe('POST /api/triggered-tasks/:id/execute', () => {
    /** Extended createCtx with execute-specific store methods. */
    function createExecuteCtx(taskOverrides: Partial<TriggeredTask> = {}): AppContext {
      const ctx = createCtx();
      const task = makeTask(taskOverrides);

      // Override triggeredTaskStore with execute-related methods
      const store = ctx.triggeredTaskStore as Record<string, unknown>;
      store.getById = vi.fn((id: string) => (id === TASK_ID ? task : null));
      store.claimTask = vi.fn(() => true);
      store.releaseClaim = vi.fn();
      store.recordRun = vi.fn();
      store.updateRun = vi.fn();
      return ctx;
    }

    it('returns 404 when task not found', async () => {
      const ctx = createExecuteCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/triggered-tasks/${UUID.missing}/execute`,
      });
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: 'Task not found' });
    });

    it('returns 409 when skip_if_running claim fails', async () => {
      const ctx = createExecuteCtx({ concurrencyPolicy: 'skip_if_running' });
      (ctx.triggeredTaskStore as unknown as Record<string, ReturnType<typeof vi.fn>>).claimTask.mockReturnValue(false);
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/triggered-tasks/${TASK_ID}/execute`,
      });
      expect(r.status).toBe(409);
      expect(r.body).toEqual({ error: 'Task is currently running (skip_if_running policy)' });
    });

    it('executes successfully and returns runId and sessionKey', async () => {
      const ctx = createExecuteCtx({ concurrencyPolicy: 'allow' });
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/triggered-tasks/${TASK_ID}/execute`,
      });
      expect(r.status).toBe(200);
      const data = (r.body as Record<string, unknown>).data as Record<string, unknown>;
      expect((r.body as Record<string, unknown>).ok).toBe(true);
      expect(data.runId).toBeDefined();
      expect(data.sessionKey).toBeDefined();
      expect(ctx.triggeredTaskStore.recordRun).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'running', triggeredBy: 'dashboard' }),
      );
      expect(ctx.jobQueue.enqueue).toHaveBeenCalled();
    });

    it('executes successfully with skip_if_running and claims the task', async () => {
      const ctx = createExecuteCtx({ concurrencyPolicy: 'skip_if_running' });
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/triggered-tasks/${TASK_ID}/execute`,
      });
      expect(r.status).toBe(200);
      expect(ctx.triggeredTaskStore.claimTask).toHaveBeenCalledWith(TASK_ID, expect.any(String));
    });

    it('returns 500 and releases claim on setup failure (with session)', async () => {
      const ctx = createExecuteCtx({ concurrencyPolicy: 'skip_if_running' });
      // Make prepareWorkdirSkillsOnly throw after session is created
      (ctx.workdirManager.prepareWorkdirSkillsOnly as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('workdir setup boom');
      });
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/triggered-tasks/${TASK_ID}/execute`,
      });
      expect(r.status).toBe(500);
      expect(r.body).toEqual({ error: 'Failed to prepare task execution' });
      // Claim must be released
      expect(ctx.triggeredTaskStore.releaseClaim).toHaveBeenCalledWith(TASK_ID);
      // A failed run should be recorded since session was created
      expect(ctx.triggeredTaskStore.recordRun).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', errorMessage: 'Setup failed' }),
      );
    });

    it('returns 500 on setup failure without releasing claim when policy is allow', async () => {
      const ctx = createExecuteCtx({ concurrencyPolicy: 'allow' });
      (ctx.workdirManager.prepareWorkdirSkillsOnly as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('workdir setup boom');
      });
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/triggered-tasks/${TASK_ID}/execute`,
      });
      expect(r.status).toBe(500);
      expect(r.body).toEqual({ error: 'Failed to prepare task execution' });
      // releaseClaim should NOT be called for 'allow' policy
      expect(ctx.triggeredTaskStore.releaseClaim).not.toHaveBeenCalled();
    });

    it('returns 503 and releases claim on enqueue failure', async () => {
      const ctx = createExecuteCtx({ concurrencyPolicy: 'skip_if_running' });
      (ctx.jobQueue.enqueue as ReturnType<typeof vi.fn>).mockReturnValue({ error: 'queue full' });
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/triggered-tasks/${TASK_ID}/execute`,
      });
      expect(r.status).toBe(503);
      expect(r.body).toEqual({ error: 'Failed to enqueue job: queue full' });
      // updateRun should record failure
      expect(ctx.triggeredTaskStore.updateRun).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'failed' }),
      );
      // Claim must be released
      expect(ctx.triggeredTaskStore.releaseClaim).toHaveBeenCalledWith(TASK_ID);
    });

    it('returns 503 on enqueue failure without releasing claim when policy is allow', async () => {
      const ctx = createExecuteCtx({ concurrencyPolicy: 'allow' });
      (ctx.jobQueue.enqueue as ReturnType<typeof vi.fn>).mockReturnValue({ error: 'queue full' });
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/triggered-tasks/${TASK_ID}/execute`,
      });
      expect(r.status).toBe(503);
      // releaseClaim should NOT be called for 'allow' policy
      expect(ctx.triggeredTaskStore.releaseClaim).not.toHaveBeenCalled();
    });

    it('returns 500 on setup failure without session (createStandaloneSession throws)', async () => {
      const ctx = createExecuteCtx({ concurrencyPolicy: 'skip_if_running' });
      (ctx.sessionManager.createStandaloneSession as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('session creation failed');
      });
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/triggered-tasks/${TASK_ID}/execute`,
      });
      expect(r.status).toBe(500);
      expect(r.body).toEqual({ error: 'Failed to prepare task execution' });
      // Claim must be released
      expect(ctx.triggeredTaskStore.releaseClaim).toHaveBeenCalledWith(TASK_ID);
      // No run recorded since session was never created
      expect(ctx.triggeredTaskStore.recordRun).not.toHaveBeenCalled();
    });
  });

  // ── Unmatched routes ────────────────────────────────────────
  describe('unmatched routes', () => {
    it('returns false for unmatched path', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'GET',
        path: '/api/something-else',
      });
      expect(r.handled).toBe(false);
    });

    it('returns false for PUT on triggered-tasks base path', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PUT',
        path: '/api/triggered-tasks',
      });
      expect(r.handled).toBe(false);
    });
  });
});
