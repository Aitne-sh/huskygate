/** Coverage tests for webhook-subscriptions.ts — targeting 100% statement and branch coverage. */
import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../context/app-context.js';
import type { EventSubscription, WebhookEndpoint } from '../../event/types.js';
import { StaleUpdateError } from '../../store/store-utils.js';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import { UUID, createInvoker } from './_test-utils.js';
import { handleSubscriptionRoutes } from './webhook-subscriptions.js';

const invoke = createInvoker(handleSubscriptionRoutes as Parameters<typeof createInvoker>[0]);

const ENDPOINT_ID = UUID.endpoint1;
const SUB_ID = UUID.sub1;

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

function makeSub(overrides: Partial<EventSubscription> = {}): EventSubscription {
  return {
    id: SUB_ID,
    endpointId: ENDPOINT_ID,
    targetType: 'orchestrator',
    orchestratorId: 'orch-1',
    triggeredTaskId: null,
    nodeId: null,
    filterJson: null,
    contextMappingJson: null,
    enabled: true,
    createdAt: '2026-03-08T00:00:00.000Z',
    updatedAt: '2026-03-08T00:00:00.000Z',
    ...overrides,
  };
}

function createCtx(): AppContext {
  const endpoint = makeEndpoint();
  const sub = makeSub();
  const ctx = makeTestAppContext();
  ctx.webhookEndpointStore = {
    getById: vi.fn((id: string) => (id === ENDPOINT_ID ? endpoint : null)),
    list: vi.fn(() => [endpoint]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as AppContext['webhookEndpointStore'];
  ctx.eventSubscriptionStore = {
    getById: vi.fn((id: string) => (id === SUB_ID ? sub : null)),
    list: vi.fn(() => [sub]),
    create: vi.fn((input: Record<string, unknown>) => ({
      ...sub,
      ...input,
      id: SUB_ID,
    })),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as AppContext['eventSubscriptionStore'];
  ctx.orchestratorStore = {
    getById: vi.fn(() => ({ id: 'orch-1', triggerMode: 'webhook' })),
    getNodeById: vi.fn(() => ({ id: 'node-1', nodeType: 'triggered' })),
  } as unknown as AppContext['orchestratorStore'];
  ctx.triggeredTaskStore = {
    getById: vi.fn(() => ({ id: 'task-1' })),
    list: vi.fn(() => []),
    getRunsByTask: vi.fn(() => []),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(<T>(fn: () => T) => fn()),
  } as unknown as AppContext['triggeredTaskStore'];
  return ctx;
}

describe('handleSubscriptionRoutes', () => {
  // ── GET /api/event-subscriptions ────────────────────────────
  describe('GET /api/event-subscriptions', () => {
    it('lists all subscriptions', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, { method: 'GET', path: '/api/event-subscriptions' });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(200);
      expect((r.body as Record<string, unknown>).ok).toBe(true);
    });
  });

  // ── POST /api/event-subscriptions ───────────────────────────
  describe('POST /api/event-subscriptions', () => {
    it('creates an orchestrator subscription', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/event-subscriptions',
        body: {
          endpointId: ENDPOINT_ID,
          targetType: 'orchestrator',
          orchestratorId: 'orch-1',
        },
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(201);
      expect(ctx.eventSubscriptionStore.create).toHaveBeenCalled();
      expect(ctx.eventRouter.reload).toHaveBeenCalled();
    });

    it('creates a triggered_task subscription', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/event-subscriptions',
        body: {
          endpointId: ENDPOINT_ID,
          targetType: 'triggered_task',
          triggeredTaskId: 'task-1',
        },
      });
      expect(r.status).toBe(201);
    });

    it('creates a triggered_node subscription', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/event-subscriptions',
        body: {
          endpointId: ENDPOINT_ID,
          targetType: 'triggered_node',
          nodeId: 'node-1',
        },
      });
      expect(r.status).toBe(201);
    });

    it('rejects invalid JSON', async () => {
      const ctx = createCtx();
      const { MockRequest, MockResponse } = await import('./_test-utils.js');
      const req = new MockRequest('POST', '/api/event-subscriptions');
      const res = new MockResponse();
      const promise = handleSubscriptionRoutes(
        ctx,
        req as unknown as import('node:http').IncomingMessage,
        res as unknown as import('node:http').ServerResponse,
        '/api/event-subscriptions',
      );
      req.emit('data', Buffer.from('not json'));
      req.emit('end');
      await promise;
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ error: 'Invalid JSON' });
    });

    it('rejects invalid targetType', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/event-subscriptions',
        body: { endpointId: ENDPOINT_ID, targetType: 'invalid' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'targetType is invalid' });
    });

    it('rejects missing endpointId', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/event-subscriptions',
        body: { targetType: 'orchestrator', orchestratorId: 'orch-1' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'endpointId not found' });
    });

    it('rejects endpointId not found', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/event-subscriptions',
        body: { endpointId: UUID.missing, targetType: 'orchestrator', orchestratorId: 'orch-1' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'endpointId not found' });
    });

    it('rejects empty endpointId string', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/event-subscriptions',
        body: { endpointId: '', targetType: 'orchestrator', orchestratorId: 'orch-1' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'endpointId not found' });
    });

    it('rejects invalid filterJson', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/event-subscriptions',
        body: {
          endpointId: ENDPOINT_ID,
          targetType: 'orchestrator',
          orchestratorId: 'orch-1',
          filterJson: '{bad',
        },
      });
      expect(r.status).toBe(400);
    });

    it('rejects invalid contextMappingJson', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/event-subscriptions',
        body: {
          endpointId: ENDPOINT_ID,
          targetType: 'orchestrator',
          orchestratorId: 'orch-1',
          contextMappingJson: '{bad',
        },
      });
      expect(r.status).toBe(400);
    });

    it('accepts filter alias', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/event-subscriptions',
        body: {
          endpointId: ENDPOINT_ID,
          targetType: 'orchestrator',
          orchestratorId: 'orch-1',
          filter: { match: [{ path: '_trigger.event', eq: 'push' }] },
        },
      });
      expect(r.status).toBe(201);
    });

    it('accepts contextMapping alias', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/event-subscriptions',
        body: {
          endpointId: ENDPOINT_ID,
          targetType: 'orchestrator',
          orchestratorId: 'orch-1',
          contextMapping: { key: 'body.value' },
        },
      });
      expect(r.status).toBe(201);
    });

    it('rejects shape errors (e.g. missing orchestratorId)', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/event-subscriptions',
        body: {
          endpointId: ENDPOINT_ID,
          targetType: 'orchestrator',
        },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({
        error: 'orchestratorId is required for orchestrator subscriptions',
      });
    });

    it('rejects target validation errors (e.g. orchestrator not found)', async () => {
      const ctx = createCtx();
      (ctx.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/event-subscriptions',
        body: {
          endpointId: ENDPOINT_ID,
          targetType: 'orchestrator',
          orchestratorId: 'orch-missing',
        },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'orchestratorId not found' });
    });

    it('returns 409 on unique constraint violation', async () => {
      const ctx = createCtx();
      (ctx.eventSubscriptionStore.create as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('UNIQUE constraint failed: event_subscriptions.orchestrator_id');
      });
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/event-subscriptions',
        body: {
          endpointId: ENDPOINT_ID,
          targetType: 'orchestrator',
          orchestratorId: 'orch-1',
        },
      });
      expect(r.status).toBe(409);
    });

    it('re-throws non-conflict errors during create', async () => {
      const ctx = createCtx();
      (ctx.eventSubscriptionStore.create as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('unexpected DB error');
      });
      await expect(
        invoke(ctx, {
          method: 'POST',
          path: '/api/event-subscriptions',
          body: {
            endpointId: ENDPOINT_ID,
            targetType: 'orchestrator',
            orchestratorId: 'orch-1',
          },
        }),
      ).rejects.toThrow('unexpected DB error');
    });

    it('handles enabled field', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/event-subscriptions',
        body: {
          endpointId: ENDPOINT_ID,
          targetType: 'orchestrator',
          orchestratorId: 'orch-1',
          enabled: false,
        },
      });
      expect(r.status).toBe(201);
    });
  });

  // ── PATCH /api/event-subscriptions/:id ──────────────────────
  describe('PATCH /api/event-subscriptions/:id', () => {
    it('patches a subscription', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { enabled: false },
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(200);
      expect(ctx.eventSubscriptionStore.update).toHaveBeenCalled();
    });

    it('returns 404 when subscription not found', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${UUID.missing}`,
        body: { enabled: false },
      });
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: 'Subscription not found' });
    });

    it('rejects invalid JSON in patch', async () => {
      const ctx = createCtx();
      const { MockRequest, MockResponse } = await import('./_test-utils.js');
      const req = new MockRequest('PATCH', `/api/event-subscriptions/${SUB_ID}`);
      const res = new MockResponse();
      const promise = handleSubscriptionRoutes(
        ctx,
        req as unknown as import('node:http').IncomingMessage,
        res as unknown as import('node:http').ServerResponse,
        `/api/event-subscriptions/${SUB_ID}`,
      );
      req.emit('data', Buffer.from('not json'));
      req.emit('end');
      await promise;
      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid targetType in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { targetType: 'invalid' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'targetType is invalid' });
    });

    it('uses current targetType when not in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { enabled: false },
      });
      expect(r.status).toBe(200);
    });

    it('rejects endpointId not found in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { endpointId: UUID.missing },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'endpointId not found' });
    });

    it('rejects empty endpointId string in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { endpointId: '' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'endpointId not found' });
    });

    it('rejects whitespace-only endpointId string in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { endpointId: '  ' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'endpointId not found' });
    });

    it('uses current endpointId when not provided in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { enabled: false },
      });
      expect(r.status).toBe(200);
    });

    it('patches orchestratorId', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { orchestratorId: 'orch-1' },
      });
      expect(r.status).toBe(200);
    });

    it('patches triggeredTaskId', async () => {
      const ctx = createCtx();
      const sub = makeSub({
        targetType: 'triggered_task',
        triggeredTaskId: 'task-1',
        orchestratorId: null,
      });
      (ctx.eventSubscriptionStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(sub);
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { triggeredTaskId: 'task-1' },
      });
      expect(r.status).toBe(200);
    });

    it('patches nodeId', async () => {
      const ctx = createCtx();
      const sub = makeSub({ targetType: 'triggered_node', nodeId: 'node-1', orchestratorId: null });
      (ctx.eventSubscriptionStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(sub);
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { nodeId: 'node-1' },
      });
      expect(r.status).toBe(200);
    });

    it('rejects shape errors in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: {
          targetType: 'triggered_task',
          orchestratorId: null,
          triggeredTaskId: null,
        },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({
        error: 'triggeredTaskId is required for triggered_task subscriptions',
      });
    });

    it('rejects target validation errors in patch', async () => {
      const ctx = createCtx();
      (ctx.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { orchestratorId: 'missing' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'orchestratorId not found' });
    });

    it('patches filterJson', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: {
          filterJson: { match: [{ path: '_trigger.event', eq: 'push' }] },
        },
      });
      expect(r.status).toBe(200);
    });

    it('patches filter alias', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { filter: { match: [{ path: '_trigger.event', eq: 'push' }] } },
      });
      expect(r.status).toBe(200);
    });

    it('patches contextMappingJson', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: {
          contextMappingJson: { repo: 'body.repository.full_name' },
        },
      });
      expect(r.status).toBe(200);
    });

    it('patches contextMapping alias', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { contextMapping: { key: 'body.value' } },
      });
      expect(r.status).toBe(200);
    });

    it('rejects invalid filterJson in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { filterJson: '{bad' },
      });
      expect(r.status).toBe(400);
    });

    it('rejects invalid contextMappingJson in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { contextMappingJson: '{bad' },
      });
      expect(r.status).toBe(400);
    });

    it('handles updatedAt for optimistic concurrency', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { updatedAt: '2026-03-08T00:00:00.000Z', enabled: false },
      });
      expect(r.status).toBe(200);
      expect(ctx.eventSubscriptionStore.update).toHaveBeenCalledWith(
        SUB_ID,
        expect.any(Object),
        '2026-03-08T00:00:00.000Z',
      );
    });

    it('returns 409 on StaleUpdateError', async () => {
      const ctx = createCtx();
      (ctx.eventSubscriptionStore.update as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new StaleUpdateError('event_subscriptions', '2026-03-08T00:00:00.000Z');
      });
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { updatedAt: '2026-03-07T00:00:00.000Z' },
      });
      expect(r.status).toBe(409);
    });

    it('returns 409 on unique constraint conflict in patch', async () => {
      const ctx = createCtx();
      (ctx.eventSubscriptionStore.update as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('UNIQUE constraint failed: event_subscriptions.orchestrator_id');
      });
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { orchestratorId: 'orch-1' },
      });
      expect(r.status).toBe(409);
    });

    it('re-throws non-conflict, non-stale errors in patch', async () => {
      const ctx = createCtx();
      (ctx.eventSubscriptionStore.update as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('unexpected');
      });
      await expect(
        invoke(ctx, {
          method: 'PATCH',
          path: `/api/event-subscriptions/${SUB_ID}`,
          body: { enabled: false },
        }),
      ).rejects.toThrow('unexpected');
    });

    it('does not update filterJson when neither filterJson nor filter provided', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { enabled: false },
      });
      expect(r.status).toBe(200);
      // filterJson should not be in the patch
      const updateCall = (ctx.eventSubscriptionStore.update as ReturnType<typeof vi.fn>).mock
        .calls[0];
      if (!updateCall) throw new Error('expected updateCall');
      const patch = updateCall[1] as Record<string, unknown>;
      expect('filterJson' in patch).toBe(false);
    });

    it('does not update contextMappingJson when neither provided', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { enabled: false },
      });
      expect(r.status).toBe(200);
      const updateCall = (ctx.eventSubscriptionStore.update as ReturnType<typeof vi.fn>).mock
        .calls[0];
      if (!updateCall) throw new Error('expected updateCall');
      const patch = updateCall[1] as Record<string, unknown>;
      expect('contextMappingJson' in patch).toBe(false);
    });

    it('patches enabled field', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: { enabled: false },
      });
      expect(r.status).toBe(200);
    });

    it('uses current enabled when not provided', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: {},
      });
      expect(r.status).toBe(200);
    });

    it('uses current values for target IDs not provided in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/event-subscriptions/${SUB_ID}`,
        body: {},
      });
      expect(r.status).toBe(200);
    });
  });

  // ── DELETE /api/event-subscriptions/:id ─────────────────────
  describe('DELETE /api/event-subscriptions/:id', () => {
    it('deletes a subscription', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'DELETE',
        path: `/api/event-subscriptions/${SUB_ID}`,
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(200);
      expect(ctx.eventSubscriptionStore.delete).toHaveBeenCalledWith(SUB_ID);
      expect(ctx.eventRouter.reload).toHaveBeenCalled();
    });

    it('returns 404 when subscription not found for delete', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'DELETE',
        path: `/api/event-subscriptions/${UUID.missing}`,
      });
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: 'Subscription not found' });
    });
  });

  // ── POST /api/event-subscriptions/:id/test ──────────────────
  describe('POST /api/event-subscriptions/:id/test', () => {
    it('tests a subscription with matching filter', async () => {
      const ctx = createCtx();
      const sub = makeSub({
        filterJson: JSON.stringify({
          match: [{ path: '_trigger.event', eq: 'push' }],
        }),
        contextMappingJson: JSON.stringify({
          repo: 'body.repository.full_name',
        }),
      });
      (ctx.eventSubscriptionStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(sub);
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/event-subscriptions/${SUB_ID}/test`,
        body: {
          _trigger: { publisher: 'github', event: 'push', deliveryId: 'd-1' },
          body: { repository: { full_name: 'org/repo' } },
          headers: { 'x-github-event': 'push' },
        },
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(200);
      expect((r.body as Record<string, unknown>).matched).toBe(true);
      expect((r.body as Record<string, unknown>).triggerContext).toBeTruthy();
    });

    it('tests a subscription with non-matching filter', async () => {
      const ctx = createCtx();
      const sub = makeSub({
        filterJson: JSON.stringify({
          match: [{ path: '_trigger.event', eq: 'push' }],
        }),
        contextMappingJson: null,
      });
      (ctx.eventSubscriptionStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(sub);
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/event-subscriptions/${SUB_ID}/test`,
        body: {
          _trigger: { publisher: 'github', event: 'pull_request' },
          body: {},
        },
      });
      expect(r.status).toBe(200);
      expect((r.body as Record<string, unknown>).matched).toBe(false);
      expect((r.body as Record<string, unknown>).triggerContext).toBeNull();
    });

    it('returns 404 when subscription not found for test', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/event-subscriptions/${UUID.missing}/test`,
        body: { body: {} },
      });
      expect(r.status).toBe(404);
    });

    it('rejects invalid JSON in test body', async () => {
      const ctx = createCtx();
      const { MockRequest, MockResponse } = await import('./_test-utils.js');
      const req = new MockRequest('POST', `/api/event-subscriptions/${SUB_ID}/test`);
      const res = new MockResponse();
      const promise = handleSubscriptionRoutes(
        ctx,
        req as unknown as import('node:http').IncomingMessage,
        res as unknown as import('node:http').ServerResponse,
        `/api/event-subscriptions/${SUB_ID}/test`,
      );
      req.emit('data', Buffer.from('not json'));
      req.emit('end');
      await promise;
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ error: 'Invalid JSON' });
    });

    it('rejects oversized test payloads with 413', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/event-subscriptions/${SUB_ID}/test`,
        body: { body: { huge: 'x'.repeat(20_000) } },
      });
      expect(r.status).toBe(413);
    });

    it('handles test body with missing _trigger (uses defaults)', async () => {
      const ctx = createCtx();
      const sub = makeSub({ filterJson: null, contextMappingJson: null });
      (ctx.eventSubscriptionStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(sub);
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/event-subscriptions/${SUB_ID}/test`,
        body: {},
      });
      expect(r.status).toBe(200);
      expect((r.body as Record<string, unknown>).matched).toBe(true);
    });

    it('handles test body with array _trigger (uses defaults)', async () => {
      const ctx = createCtx();
      const sub = makeSub({ filterJson: null, contextMappingJson: null });
      (ctx.eventSubscriptionStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(sub);
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/event-subscriptions/${SUB_ID}/test`,
        body: { _trigger: [1, 2, 3] },
      });
      expect(r.status).toBe(200);
    });

    it('handles test body with non-object body (uses empty)', async () => {
      const ctx = createCtx();
      const sub = makeSub({ filterJson: null, contextMappingJson: null });
      (ctx.eventSubscriptionStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(sub);
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/event-subscriptions/${SUB_ID}/test`,
        body: { body: 'not an object' },
      });
      expect(r.status).toBe(200);
    });

    it('handles test body with array body (uses empty)', async () => {
      const ctx = createCtx();
      const sub = makeSub({ filterJson: null, contextMappingJson: null });
      (ctx.eventSubscriptionStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(sub);
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/event-subscriptions/${SUB_ID}/test`,
        body: { body: [1, 2] },
      });
      expect(r.status).toBe(200);
    });

    it('handles test body with non-object headers (uses empty)', async () => {
      const ctx = createCtx();
      const sub = makeSub({ filterJson: null, contextMappingJson: null });
      (ctx.eventSubscriptionStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(sub);
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/event-subscriptions/${SUB_ID}/test`,
        body: { headers: 'not an object' },
      });
      expect(r.status).toBe(200);
    });

    it('handles test body with array headers (uses empty)', async () => {
      const ctx = createCtx();
      const sub = makeSub({ filterJson: null, contextMappingJson: null });
      (ctx.eventSubscriptionStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(sub);
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/event-subscriptions/${SUB_ID}/test`,
        body: { headers: [1, 2] },
      });
      expect(r.status).toBe(200);
    });

    it('lowercases header keys and filters non-string values', async () => {
      const ctx = createCtx();
      const sub = makeSub({ filterJson: null, contextMappingJson: null });
      (ctx.eventSubscriptionStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(sub);
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/event-subscriptions/${SUB_ID}/test`,
        body: {
          headers: {
            'X-Custom': 'value',
            'X-Number': 42,
          },
        },
      });
      expect(r.status).toBe(200);
    });

    it('returns 400 when stored filterJson is malformed', async () => {
      const ctx = createCtx();
      const sub = makeSub({ filterJson: '{bad stored json' });
      (ctx.eventSubscriptionStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(sub);
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/event-subscriptions/${SUB_ID}/test`,
        body: { body: {} },
      });
      expect(r.status).toBe(400);
    });

    it('returns 400 when stored contextMappingJson is malformed', async () => {
      const ctx = createCtx();
      const sub = makeSub({
        filterJson: null,
        contextMappingJson: '{bad stored json',
      });
      (ctx.eventSubscriptionStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(sub);
      const r = await invoke(ctx, {
        method: 'POST',
        path: `/api/event-subscriptions/${SUB_ID}/test`,
        body: { body: {} },
      });
      expect(r.status).toBe(400);
    });
  });

  // ── Unmatched routes ────────────────────────────────────────
  describe('unmatched routes', () => {
    it('returns false for unmatched paths', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'GET',
        path: '/api/other-route',
      });
      expect(r.handled).toBe(false);
    });

    it('returns false for PUT on subscriptions', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PUT',
        path: '/api/event-subscriptions',
      });
      expect(r.handled).toBe(false);
    });
  });
});
