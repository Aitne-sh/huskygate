/** Coverage2 tests for event-router: uncovered lines 168-170, 207-208, 222-225, 232-236,
 * 250, 252-254, 295-300, 307 */
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventRouter, WebhookDispatchError } from './event-router.js';
import type { EventSubscription, WebhookEndpoint } from './types.js';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/error.js', () => ({
  errorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
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

describe('event-router coverage2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('reload — orphaned waiter with onTimeout error (lines 168-170)', () => {
    it('catches error from orphaned waiter onTimeout', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      // Register a waiter that throws on timeout
      router.registerTriggeredWaiter('sub-orphan', 'key-1', {
        runId: 'run-1',
        nodeId: 'node-1',
        subscriptionId: 'sub-orphan',
        onEvent: vi.fn(),
        onTimeout: () => {
          throw new Error('timeout handler crashed');
        },
      });

      // Reload with no subscriptions — orphaned waiter should be pruned, error caught
      vi.mocked(deps.eventSubscriptionStore.list).mockReturnValue([]);
      vi.mocked(deps.webhookEndpointStore.list).mockReturnValue([]);
      await router.reload(); // Should not throw
    });
  });

  describe('dispatchWebhook — ensureObjectBody null/undefined (line 96)', () => {
    it('rejects null body parsed from JSON "null"', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint();
      await expect(router.dispatchWebhook(ep, Buffer.from('null'), {})).rejects.toThrow(
        WebhookDispatchError,
      );
    });
  });

  describe('verification — slack-v0 (lines 488-508)', () => {
    it('verifies slack-v0 signature', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const bodyStr = '{"key":"value"}';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const baseString = `v0:${timestamp}:${bodyStr}`;
      const digest = crypto.createHmac('sha256', 'test-secret').update(baseString).digest('hex');

      const ep = makeEndpoint({
        verificationType: 'slack-v0',
        secretRef: 'ref-1',
      });
      const headers = {
        'x-slack-signature': `v0=${digest}`,
        'x-slack-request-timestamp': timestamp,
      };
      const result = await router.dispatchWebhook(ep, Buffer.from(bodyStr), headers);
      expect(result.ok).toBe(true);
    });

    it('rejects slack-v0 with missing timestamp', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint({
        verificationType: 'slack-v0',
        secretRef: 'ref-1',
      });
      const headers = { 'x-slack-signature': 'v0=abc' };
      await expect(router.dispatchWebhook(ep, Buffer.from('{}'), headers)).rejects.toThrow(
        WebhookDispatchError,
      );
    });

    it('rejects slack-v0 with expired timestamp', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint({
        verificationType: 'slack-v0',
        secretRef: 'ref-1',
      });
      const headers = {
        'x-slack-signature': 'v0=abc',
        'x-slack-request-timestamp': '1000000',
      };
      await expect(router.dispatchWebhook(ep, Buffer.from('{}'), headers)).rejects.toThrow(
        WebhookDispatchError,
      );
    });

    it('rejects slack-v0 with missing signature header', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint({
        verificationType: 'slack-v0',
        secretRef: 'ref-1',
      });
      await expect(router.dispatchWebhook(ep, Buffer.from('{}'), {})).rejects.toThrow(
        WebhookDispatchError,
      );
    });
  });

  describe('verification — hmac-sha1 (line 107)', () => {
    it('verifies hmac-sha1 signature', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const bodyStr = '{"key":"value"}';
      const digest = crypto
        .createHmac('sha1', 'test-secret')
        .update(Buffer.from(bodyStr))
        .digest('hex');

      const ep = makeEndpoint({
        verificationType: 'hmac-sha1',
        secretRef: 'ref-1',
        signatureHeader: 'x-hub-signature',
        signaturePrefix: 'sha1=',
      });
      const headers = { 'x-hub-signature': `sha1=${digest}` };
      const result = await router.dispatchWebhook(ep, Buffer.from(bodyStr), headers);
      expect(result.ok).toBe(true);
    });

    it('rejects hmac with missing actual header value', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint({
        verificationType: 'hmac-sha256',
        secretRef: 'ref-1',
        signatureHeader: 'x-sig',
      });
      // Header exists but actual value is missing
      await expect(router.dispatchWebhook(ep, Buffer.from('{}'), {})).rejects.toThrow(
        WebhookDispatchError,
      );
    });
  });

  describe('dispatch — triggered_task failure branches (lines 383-388)', () => {
    it('throws when triggered task dispatch fails with setup_failed', async () => {
      const sub = makeSubscription({
        targetType: 'triggered_task',
        orchestratorId: null,
        triggeredTaskId: 'task-1',
      });
      const deps = makeDeps({
        eventSubscriptionStore: { list: vi.fn(() => [sub]) },
        triggeredTaskExecutor: {
          execute: vi.fn(async () => ({ dispatched: false, reason: 'setup_failed' })),
        },
      });
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint({ deliveryIdHeader: 'x-del-id' });
      await expect(
        router.dispatchWebhook(ep, Buffer.from('{}'), { 'x-del-id': 'del1' }),
      ).rejects.toThrow(WebhookDispatchError);
    });

    it('skips when triggered task is not dispatched for other reason', async () => {
      const sub = makeSubscription({
        targetType: 'triggered_task',
        orchestratorId: null,
        triggeredTaskId: 'task-1',
      });
      const deps = makeDeps({
        eventSubscriptionStore: { list: vi.fn(() => [sub]) },
        triggeredTaskExecutor: {
          execute: vi.fn(async () => ({ dispatched: false, reason: 'disabled' })),
        },
      });
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint();
      const result = await router.dispatchWebhook(ep, Buffer.from('{}'), {});
      expect(result.skipped).toBe(1);
    });
  });

  describe('dispatch — waiter callback error (lines 400-405)', () => {
    it('catches error from waiter.onEvent callback', async () => {
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

      router.registerTriggeredWaiter('sub-1', 'waiter-1', {
        runId: 'run-1',
        nodeId: 'node-1',
        subscriptionId: 'sub-1',
        onEvent: () => {
          throw new Error('callback failed');
        },
        onTimeout: vi.fn(),
      });

      const ep = makeEndpoint();
      const result = await router.dispatchWebhook(ep, Buffer.from('{}'), {});
      // Should still count as dispatched even with callback error
      expect(result.dispatched).toBe(1);
    });
  });

  describe('dispatch — delivery retry path (lines 295-300)', () => {
    it('handles retry delivery (already attempted, not duplicate)', async () => {
      const deps = makeDeps({
        webhookDeliveryStore: {
          tryClaimDelivery: vi.fn(() => ({
            result: 'retry',
            successfulSubIds: ['sub-already-done'],
          })),
          markPartial: vi.fn(),
          markCompleted: vi.fn(),
        },
      });
      const router = new EventRouter(deps);
      await router.reload();

      const ep = makeEndpoint({ deliveryIdHeader: 'x-delivery-id' });
      const body = JSON.stringify({ key: 'value' });
      const headers = { 'x-delivery-id': 'retry-del-1' };

      const result = await router.dispatchWebhook(ep, Buffer.from(body), headers);
      expect(result.ok).toBe(true);
      // sub-1 is the subscription, but sub-already-done was already successful so sub-1 should dispatch
    });
  });

  describe('getTriggeredNodeSubscription', () => {
    it('returns subscription for node ID', async () => {
      const sub = makeSubscription({
        targetType: 'triggered_node',
        orchestratorId: null,
        nodeId: 'node-99',
      });
      const deps = makeDeps({
        eventSubscriptionStore: { list: vi.fn(() => [sub]) },
      });
      const router = new EventRouter(deps);
      await router.reload();

      const found = router.getTriggeredNodeSubscription('node-99');
      expect(found).not.toBeNull();
      expect(found?.id).toBe('sub-1');
    });

    it('returns null for unknown node ID', async () => {
      const deps = makeDeps();
      const router = new EventRouter(deps);
      await router.reload();

      expect(router.getTriggeredNodeSubscription('nonexistent')).toBeNull();
    });
  });
});
