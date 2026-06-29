/** Coverage tests for event-router: dispatch, verification, deduplication, triggered nodes. */
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventRouter, WebhookDispatchError } from './event-router.js';
import type { EventSubscription, WebhookEndpoint } from './types.js';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../shared/security.js', () => ({
  timingSafeEqualString: (a: string, b: string) => a === b,
}));

type EventRouterDeps = ConstructorParameters<typeof EventRouter>[0];

function makeEndpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  const timestamp = new Date().toISOString();
  return {
    id: 'ep-1',
    token: 'tok-1',
    enabled: true,
    publisherPreset: 'generic',
    verificationType: 'none',
    secretRef: null,
    signatureHeader: null,
    signaturePrefix: null,
    eventNameHeader: null,
    deliveryIdHeader: null,
    maxBodyBytes: 262144,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function makeSubscription(overrides: Partial<EventSubscription> = {}): EventSubscription {
  const timestamp = new Date().toISOString();
  return {
    id: 'sub-1',
    endpointId: 'ep-1',
    enabled: true,
    targetType: 'orchestrator',
    orchestratorId: 'orch-1',
    triggeredTaskId: null,
    nodeId: null,
    filterJson: null,
    contextMappingJson: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    webhookEndpointStore: {
      list: vi.fn(() => [makeEndpoint()]),
    },
    eventSubscriptionStore: {
      list: vi.fn(() => [makeSubscription()]),
    },
    webhookSecretStore: {
      getSecret: vi.fn(async () => 'test-secret'),
    },
    webhookDeliveryStore: {
      tryClaimDelivery: vi.fn(() => ({ result: 'claimed', successfulSubIds: [] })),
      markPartial: vi.fn(),
      markCompleted: vi.fn(),
    },
    orchestratorEngine: {
      startRun: vi.fn(async () => ({ runId: 'run-1' })),
    },
    triggeredTaskExecutor: {
      execute: vi.fn(async () => ({ dispatched: true })),
    },
    ...overrides,
  } as unknown as EventRouterDeps;
}

describe('event-router coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('WebhookDispatchError', () => {
    it('creates error with status and body', () => {
      const err = new WebhookDispatchError(400, { error: 'bad_request' });
      expect(err.status).toBe(400);
      expect(err.body).toEqual({ error: 'bad_request' });
      expect(err.message).toBe('bad_request');
    });
  });

  describe('reload', () => {
    it('loads endpoints and subscriptions', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const ep = router.getEndpointByToken('tok-1');
      expect(ep).not.toBeNull();
      expect(ep?.id).toBe('ep-1');
    });

    it('returns null for unknown token', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      expect(router.getEndpointByToken('nonexistent')).toBeNull();
    });

    it('prunes orphaned waiters on reload', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      // Register a waiter for a subscription that will be removed
      const onEvent = vi.fn();
      const onTimeout = vi.fn();
      router.registerTriggeredWaiter('sub-orphan', 'key-1', {
        runId: 'run-1',
        nodeId: 'node-1',
        subscriptionId: 'sub-orphan',
        onEvent,
        onTimeout,
      });

      // Reload with no subscriptions - waiter should be pruned
      vi.mocked(deps.eventSubscriptionStore.list).mockReturnValue([]);
      vi.mocked(deps.webhookEndpointStore.list).mockReturnValue([]);
      await router.reload();

      expect(onTimeout).toHaveBeenCalled();
    });
  });

  describe('registerTriggeredWaiter', () => {
    it('registers and unregisters waiter', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const onEvent = vi.fn();
      const onTimeout = vi.fn();
      const unregister = router.registerTriggeredWaiter('sub-1', 'key-1', {
        runId: 'run-1',
        nodeId: 'node-1',
        subscriptionId: 'sub-1',
        onEvent,
        onTimeout,
      });

      expect(typeof unregister).toBe('function');
      unregister();
      // Should not throw when called again
      unregister();
    });
  });

  describe('dispatchWebhook', () => {
    it('rejects disabled endpoint', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint({ enabled: false });
      await expect(router.dispatchWebhook(ep, Buffer.from('{}'), {})).rejects.toThrow(
        WebhookDispatchError,
      );
    });

    it('rejects invalid JSON body', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint();
      await expect(router.dispatchWebhook(ep, Buffer.from('not json'), {})).rejects.toThrow(
        WebhookDispatchError,
      );
    });

    it('rejects array body', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint();
      await expect(router.dispatchWebhook(ep, Buffer.from('[]'), {})).rejects.toThrow(
        WebhookDispatchError,
      );
    });

    it('handles Slack URL verification challenge', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint({ publisherPreset: 'slack' });
      const body = JSON.stringify({ type: 'url_verification', challenge: 'test-challenge' });
      const result = await router.dispatchWebhook(ep, Buffer.from(body), {});
      expect(result.challenge).toBe('test-challenge');
      expect(result.dispatched).toBe(0);
    });

    it('dispatches to orchestrator subscription', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint();
      const body = JSON.stringify({ key: 'value' });
      const result = await router.dispatchWebhook(ep, Buffer.from(body), {});
      expect(result.ok).toBe(true);
      expect(result.dispatched).toBe(1);
    });

    it('dispatches to triggered_task subscription', async () => {
      const sub = makeSubscription({
        targetType: 'triggered_task',
        orchestratorId: null,
        triggeredTaskId: 'task-1',
      });
      const deps = makeDeps({
        eventSubscriptionStore: { list: vi.fn(() => [sub]) },
      });
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint();
      const body = JSON.stringify({ key: 'value' });
      const result = await router.dispatchWebhook(ep, Buffer.from(body), {});
      expect(result.dispatched).toBe(1);
    });

    it('dispatches to triggered_node with active waiter', async () => {
      const sub = makeSubscription({
        targetType: 'triggered_node',
        orchestratorId: null,
        nodeId: 'node-1',
      });
      const deps = makeDeps({
        eventSubscriptionStore: { list: vi.fn(() => [sub]) },
      });
      const router = new EventRouter(deps);
      await router.reload();

      const onEvent = vi.fn();
      router.registerTriggeredWaiter('sub-1', 'waiter-1', {
        runId: 'run-1',
        nodeId: 'node-1',
        subscriptionId: 'sub-1',
        onEvent,
        onTimeout: vi.fn(),
      });

      const ep = makeEndpoint();
      const body = JSON.stringify({ key: 'value' });
      const result = await router.dispatchWebhook(ep, Buffer.from(body), {});
      expect(result.dispatched).toBe(1);
      expect(onEvent).toHaveBeenCalled();
    });

    it('skips triggered_node when no waiter is registered', async () => {
      const sub = makeSubscription({
        targetType: 'triggered_node',
        orchestratorId: null,
        nodeId: 'node-1',
      });
      const deps = makeDeps({
        eventSubscriptionStore: { list: vi.fn(() => [sub]) },
      });
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint();
      const body = JSON.stringify({ key: 'value' });
      const result = await router.dispatchWebhook(ep, Buffer.from(body), {});
      expect(result.dispatched).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('handles deduplication with deliveryIdHeader', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint({ deliveryIdHeader: 'x-delivery-id' });
      const body = JSON.stringify({ key: 'value' });
      const headers = { 'x-delivery-id': 'delivery-1' };

      // First dispatch
      const result1 = await router.dispatchWebhook(ep, Buffer.from(body), headers);
      expect(result1.ok).toBe(true);
      expect(result1.duplicate).toBe(false);

      // Second dispatch with same delivery ID - should be deduplicated (in-memory)
      const result2 = await router.dispatchWebhook(ep, Buffer.from(body), headers);
      expect(result2.duplicate).toBe(true);
    });

    it('handles DB duplicate detection', async () => {
      const deps = makeDeps({
        webhookDeliveryStore: {
          tryClaimDelivery: vi.fn(() => ({
            result: 'duplicate',
            successfulSubIds: ['sub-1'],
          })),
          markPartial: vi.fn(),
          markCompleted: vi.fn(),
        },
      });
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint({ deliveryIdHeader: 'x-delivery-id' });
      const body = JSON.stringify({ key: 'value' });
      const headers = { 'x-delivery-id': 'db-dup' };

      const result = await router.dispatchWebhook(ep, Buffer.from(body), headers);
      expect(result.duplicate).toBe(true);
    });
  });

  describe('verification', () => {
    it('verifies bearer token', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint({
        verificationType: 'bearer',
        secretRef: 'ref-1',
      });
      const body = JSON.stringify({ key: 'value' });
      const headers = { authorization: 'Bearer test-secret' };
      const result = await router.dispatchWebhook(ep, Buffer.from(body), headers);
      expect(result.ok).toBe(true);
    });

    it('rejects invalid bearer token', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint({
        verificationType: 'bearer',
        secretRef: 'ref-1',
      });
      const body = JSON.stringify({ key: 'value' });
      const headers = { authorization: 'Bearer wrong-secret' };
      await expect(router.dispatchWebhook(ep, Buffer.from(body), headers)).rejects.toThrow(
        WebhookDispatchError,
      );
    });

    it('rejects missing secret ref', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint({
        verificationType: 'bearer',
        secretRef: null,
      });
      const body = JSON.stringify({ key: 'value' });
      await expect(router.dispatchWebhook(ep, Buffer.from(body), {})).rejects.toThrow(
        WebhookDispatchError,
      );
    });

    it('rejects when secret not found in store', async () => {
      const deps = makeDeps({
        webhookSecretStore: { getSecret: vi.fn(async () => null) },
      });
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint({
        verificationType: 'bearer',
        secretRef: 'ref-1',
      });
      const body = JSON.stringify({ key: 'value' });
      await expect(router.dispatchWebhook(ep, Buffer.from(body), {})).rejects.toThrow(
        WebhookDispatchError,
      );
    });

    it('verifies HMAC-SHA256 signature', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const bodyStr = '{"key":"value"}';
      const digest = crypto
        .createHmac('sha256', 'test-secret')
        .update(Buffer.from(bodyStr))
        .digest('hex');

      const ep = makeEndpoint({
        verificationType: 'hmac-sha256',
        secretRef: 'ref-1',
        signatureHeader: 'x-signature',
        signaturePrefix: 'sha256=',
      });
      const headers = { 'x-signature': `sha256=${digest}` };
      const result = await router.dispatchWebhook(ep, Buffer.from(bodyStr), headers);
      expect(result.ok).toBe(true);
    });

    it('rejects HMAC when no signature header configured', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint({
        verificationType: 'hmac-sha256',
        secretRef: 'ref-1',
        signatureHeader: null,
      });
      await expect(router.dispatchWebhook(ep, Buffer.from('{}'), {})).rejects.toThrow(
        WebhookDispatchError,
      );
    });
  });

  describe('header normalization', () => {
    it('normalizes array headers', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint({ eventNameHeader: 'X-Event-Name' });
      const body = JSON.stringify({ key: 'value' });
      const headers = { 'X-Event-Name': ['push', 'tag'] };
      const result = await router.dispatchWebhook(ep, Buffer.from(body), headers);
      expect(result.ok).toBe(true);
    });
  });
});
