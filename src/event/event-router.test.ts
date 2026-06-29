import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { EventRouter, type WebhookDispatchError } from './event-router.js';
import type { EventSubscription, WebhookEndpoint } from './types.js';

function makeEndpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: 'endpoint-1',
    token: 'token-1',
    publisherPreset: 'github',
    verificationType: 'none',
    signatureHeader: null,
    signaturePrefix: null,
    deliveryIdHeader: 'x-github-delivery',
    eventNameHeader: 'x-github-event',
    secretRef: null,
    maxBodyBytes: 262_144,
    enabled: true,
    createdAt: '2026-03-08T00:00:00.000Z',
    updatedAt: '2026-03-08T00:00:00.000Z',
    ...overrides,
  };
}

function makeSubscription(overrides: Partial<EventSubscription> = {}): EventSubscription {
  return {
    id: 'subscription-1',
    endpointId: 'endpoint-1',
    targetType: 'orchestrator',
    orchestratorId: 'orch-1',
    triggeredTaskId: null,
    nodeId: null,
    filterJson: JSON.stringify({
      match: [
        { path: '_trigger.event', eq: 'pull_request' },
        { path: 'body.action', in: ['opened', 'synchronize'] },
      ],
    }),
    contextMappingJson: JSON.stringify({
      repo: 'body.repository.full_name',
      action: 'body.action',
    }),
    enabled: true,
    createdAt: '2026-03-08T00:00:00.000Z',
    updatedAt: '2026-03-08T00:00:00.000Z',
    ...overrides,
  };
}

function createRouter(
  endpoints: WebhookEndpoint[],
  subscriptions: EventSubscription[],
  secret = 'test-secret',
) {
  const execute = vi.fn<
    (
      taskId: string,
      triggeredBy: string,
      triggerContext: Record<string, unknown> | null,
    ) => Promise<{ dispatched: boolean; runId?: string; reason?: string }>
  >(async () => ({ dispatched: true, runId: 'tt-run-1' }));
  const deps = {
    webhookEndpointStore: {
      list: vi.fn(() => endpoints),
    },
    eventSubscriptionStore: {
      list: vi.fn(() => subscriptions),
    },
    webhookSecretStore: {
      getSecret: vi.fn(async () => secret),
    },
    orchestratorEngine: {
      startRun: vi.fn(async () => 'run-1'),
    },
    triggeredTaskExecutor: {
      execute,
    },
    webhookDeliveryStore: {
      tryClaimDelivery: vi.fn(() => ({ result: 'claimed', successfulSubIds: [] })),
      markCompleted: vi.fn(),
      markPartial: vi.fn(),
    },
  };
  return {
    router: new EventRouter(deps as never),
    deps,
  };
}

describe('EventRouter', () => {
  it('dispatches orchestrator runs with mapped context and _trigger metadata', async () => {
    const endpoint = makeEndpoint();
    const subscription = makeSubscription();
    const { router, deps } = createRouter([endpoint], [subscription]);
    await router.reload();

    const rawBody = Buffer.from(
      JSON.stringify({
        action: 'opened',
        repository: { full_name: 'org/repo' },
      }),
      'utf-8',
    );

    const result = await router.dispatchWebhook(endpoint, rawBody, {
      'x-github-event': 'pull_request',
      'x-github-delivery': 'delivery-1',
    });

    expect(result).toEqual({
      ok: true,
      endpointId: 'endpoint-1',
      duplicate: false,
      matchedSubscriptions: 1,
      dispatched: 1,
      skipped: 0,
    });
    expect(deps.orchestratorEngine.startRun).toHaveBeenCalledWith('orch-1', 'webhook', {
      triggerContext: {
        repo: 'org/repo',
        action: 'opened',
        _trigger: {
          publisher: 'github',
          event: 'pull_request',
          deliveryId: 'delivery-1',
        },
      },
    });
  });

  it('suppresses duplicate deliveries per endpoint and delivery id', async () => {
    const endpoint = makeEndpoint();
    const subscription = makeSubscription();
    const { router, deps } = createRouter([endpoint], [subscription]);
    await router.reload();
    const rawBody = Buffer.from(
      JSON.stringify({
        action: 'opened',
        repository: { full_name: 'org/repo' },
      }),
      'utf-8',
    );

    await router.dispatchWebhook(endpoint, rawBody, {
      'x-github-event': 'pull_request',
      'x-github-delivery': 'delivery-1',
    });
    const result = await router.dispatchWebhook(endpoint, rawBody, {
      'x-github-event': 'pull_request',
      'x-github-delivery': 'delivery-1',
    });

    expect(result.duplicate).toBe(true);
    expect(deps.orchestratorEngine.startRun).toHaveBeenCalledTimes(1);
  });

  it('fans out triggered-node payloads to every registered waiter', async () => {
    const endpoint = makeEndpoint();
    const subscription = makeSubscription({
      id: 'subscription-triggered',
      targetType: 'triggered_node',
      orchestratorId: null,
      nodeId: 'node-triggered',
    });
    const { router } = createRouter([endpoint], [subscription]);
    await router.reload();

    const payloads: Array<Record<string, unknown> | null> = [];
    router.registerTriggeredWaiter(subscription.id, 'run-1:node-triggered', {
      runId: 'run-1',
      nodeId: 'node-triggered',
      subscriptionId: subscription.id,
      onEvent: (payload) => payloads.push(payload),
      onTimeout: vi.fn(),
    });
    router.registerTriggeredWaiter(subscription.id, 'run-2:node-triggered', {
      runId: 'run-2',
      nodeId: 'node-triggered',
      subscriptionId: subscription.id,
      onEvent: (payload) => payloads.push(payload),
      onTimeout: vi.fn(),
    });

    const result = await router.dispatchWebhook(
      endpoint,
      Buffer.from(
        JSON.stringify({
          action: 'synchronize',
          repository: { full_name: 'org/repo' },
        }),
        'utf-8',
      ),
      {
        'x-github-event': 'pull_request',
        'x-github-delivery': 'delivery-2',
      },
    );

    expect(result.dispatched).toBe(2);
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toEqual({
      repo: 'org/repo',
      action: 'synchronize',
      _trigger: {
        publisher: 'github',
        event: 'pull_request',
        deliveryId: 'delivery-2',
      },
    });
  });

  it('rejects invalid HMAC signatures', async () => {
    const endpoint = makeEndpoint({
      verificationType: 'hmac-sha256',
      signatureHeader: 'x-hub-signature-256',
      signaturePrefix: 'sha256=',
      secretRef: 'secret:endpoint-1',
    });
    const subscription = makeSubscription();
    const { router } = createRouter([endpoint], [subscription], 'topsecret');
    await router.reload();
    const rawBody = Buffer.from(
      JSON.stringify({
        action: 'opened',
        repository: { full_name: 'org/repo' },
      }),
      'utf-8',
    );

    await expect(
      router.dispatchWebhook(endpoint, rawBody, {
        'x-github-event': 'pull_request',
        'x-github-delivery': 'delivery-3',
        'x-hub-signature-256': 'sha256=not-valid',
      }),
    ).rejects.toMatchObject({
      status: 401,
      body: { error: 'invalid_signature' },
    } satisfies Partial<WebhookDispatchError>);

    const valid = `sha256=${crypto.createHmac('sha256', 'topsecret').update(rawBody).digest('hex')}`;
    const result = await router.dispatchWebhook(endpoint, rawBody, {
      'x-github-event': 'pull_request',
      'x-github-delivery': 'delivery-4',
      'x-hub-signature-256': valid,
    });
    expect(result.dispatched).toBe(1);
  });

  it('blocks concurrent dispatches for the same delivery id', async () => {
    const endpoint = makeEndpoint();
    const subscription = makeSubscription();
    const { router, deps } = createRouter([endpoint], [subscription]);
    await router.reload();

    // Make startRun slow so the first dispatch is still in-flight when the second arrives
    let resolveFirst!: (value: string) => void;
    deps.orchestratorEngine.startRun.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const rawBody = Buffer.from(
      JSON.stringify({
        action: 'opened',
        repository: { full_name: 'org/repo' },
      }),
      'utf-8',
    );

    const firstPromise = router.dispatchWebhook(endpoint, rawBody, {
      'x-github-event': 'pull_request',
      'x-github-delivery': 'delivery-concurrent',
    });

    // Second request arrives while first is still dispatching
    const secondResult = await router.dispatchWebhook(endpoint, rawBody, {
      'x-github-event': 'pull_request',
      'x-github-delivery': 'delivery-concurrent',
    });

    // Second should be treated as duplicate (in-progress)
    expect(secondResult.duplicate).toBe(true);
    expect(secondResult.dispatched).toBe(0);

    // Let the first complete
    resolveFirst('run-1');
    const firstResult = await firstPromise;
    expect(firstResult.dispatched).toBe(1);

    // After first completes (dispatching=false, completed=true), still duplicate
    const thirdResult = await router.dispatchWebhook(endpoint, rawBody, {
      'x-github-event': 'pull_request',
      'x-github-delivery': 'delivery-concurrent',
    });
    expect(thirdResult.duplicate).toBe(true);

    // Only dispatched once total
    expect(deps.orchestratorEngine.startRun).toHaveBeenCalledTimes(1);
  });

  it('isolates oversized trigger context to the offending subscription only', async () => {
    const endpoint = makeEndpoint({ deliveryIdHeader: null });
    // subscription-ok maps a small context
    const okSubscription = makeSubscription({
      id: 'subscription-ok',
      contextMappingJson: JSON.stringify({ action: 'body.action' }),
    });
    // subscription-big maps a field that will produce a large context
    const bigSubscription = makeSubscription({
      id: 'subscription-big',
      contextMappingJson: JSON.stringify({ huge: 'body.huge_field' }),
    });
    const { router, deps } = createRouter([endpoint], [okSubscription, bigSubscription]);
    await router.reload();

    // Build a payload where body.huge_field exceeds 8KB
    const hugeValue = 'x'.repeat(9 * 1024);
    const rawBody = Buffer.from(
      JSON.stringify({
        action: 'opened',
        repository: { full_name: 'org/repo' },
        huge_field: hugeValue,
      }),
      'utf-8',
    );

    const result = await router.dispatchWebhook(endpoint, rawBody, {
      'x-github-event': 'pull_request',
    });

    // The ok subscription should still dispatch
    expect(result.dispatched).toBe(1);
    expect(deps.orchestratorEngine.startRun).toHaveBeenCalledTimes(1);
  });

  it('skips subscriptions with malformed stored filters instead of dispatching them', async () => {
    const endpoint = makeEndpoint();
    const validSubscription = makeSubscription({
      id: 'subscription-valid',
      orchestratorId: 'orch-valid',
    });
    const malformedSubscription = makeSubscription({
      id: 'subscription-bad-filter',
      orchestratorId: 'orch-bad',
      filterJson: '{bad json',
    });
    const { router, deps } = createRouter([endpoint], [validSubscription, malformedSubscription]);
    await router.reload();

    const rawBody = Buffer.from(
      JSON.stringify({
        action: 'opened',
        repository: { full_name: 'org/repo' },
      }),
      'utf-8',
    );

    const result = await router.dispatchWebhook(endpoint, rawBody, {
      'x-github-event': 'pull_request',
      'x-github-delivery': 'delivery-invalid-filter',
    });

    expect(result).toEqual({
      ok: true,
      endpointId: 'endpoint-1',
      duplicate: false,
      matchedSubscriptions: 1,
      dispatched: 1,
      skipped: 0,
    });
    expect(deps.orchestratorEngine.startRun).toHaveBeenCalledTimes(1);
    expect(deps.orchestratorEngine.startRun).toHaveBeenCalledWith('orch-valid', 'webhook', {
      triggerContext: {
        repo: 'org/repo',
        action: 'opened',
        _trigger: {
          publisher: 'github',
          event: 'pull_request',
          deliveryId: 'delivery-invalid-filter',
        },
      },
    });
  });

  describe('slack-v0 verification', () => {
    function slackSignature(secret: string, timestamp: string, body: string): string {
      const baseString = `v0:${timestamp}:${body}`;
      return `v0=${crypto.createHmac('sha256', secret).update(baseString).digest('hex')}`;
    }

    function makeSlackEndpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
      return makeEndpoint({
        publisherPreset: 'slack',
        verificationType: 'slack-v0',
        signatureHeader: 'x-slack-signature',
        signaturePrefix: 'v0=',
        deliveryIdHeader: null,
        eventNameHeader: null,
        secretRef: 'secret:slack-1',
        ...overrides,
      });
    }

    it('accepts a valid slack-v0 signature', async () => {
      const secret = 'slack-signing-secret';
      const endpoint = makeSlackEndpoint();
      const subscription = makeSubscription({
        filterJson: JSON.stringify({ match: [{ path: 'body.event.type', eq: 'message' }] }),
        contextMappingJson: JSON.stringify({
          text: 'body.event.text',
          channel: 'body.event.channel',
        }),
      });
      const { router } = createRouter([endpoint], [subscription], secret);
      await router.reload();

      const bodyObj = {
        type: 'event_callback',
        event: { type: 'message', text: 'hello', channel: 'C123' },
      };
      const bodyStr = JSON.stringify(bodyObj);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const sig = slackSignature(secret, timestamp, bodyStr);

      const result = await router.dispatchWebhook(endpoint, Buffer.from(bodyStr, 'utf-8'), {
        'x-slack-signature': sig,
        'x-slack-request-timestamp': timestamp,
      });
      expect(result.dispatched).toBe(1);
    });

    it('rejects an invalid slack-v0 signature', async () => {
      const endpoint = makeSlackEndpoint();
      const { router } = createRouter([endpoint], [], 'real-secret');
      await router.reload();

      const bodyStr = JSON.stringify({ type: 'event_callback', event: { type: 'message' } });
      const timestamp = String(Math.floor(Date.now() / 1000));

      await expect(
        router.dispatchWebhook(endpoint, Buffer.from(bodyStr, 'utf-8'), {
          'x-slack-signature': 'v0=invalid',
          'x-slack-request-timestamp': timestamp,
        }),
      ).rejects.toMatchObject({ status: 401, body: { error: 'invalid_signature' } });
    });

    it('rejects when timestamp is missing', async () => {
      const endpoint = makeSlackEndpoint();
      const { router } = createRouter([endpoint], [], 'secret');
      await router.reload();

      const bodyStr = JSON.stringify({ type: 'event_callback' });
      await expect(
        router.dispatchWebhook(endpoint, Buffer.from(bodyStr, 'utf-8'), {
          'x-slack-signature': 'v0=abc',
        }),
      ).rejects.toMatchObject({ status: 401, body: { error: 'missing_timestamp' } });
    });

    it('rejects when timestamp is older than 5 minutes', async () => {
      const secret = 'slack-secret';
      const endpoint = makeSlackEndpoint();
      const { router } = createRouter([endpoint], [], secret);
      await router.reload();

      const bodyStr = JSON.stringify({ type: 'event_callback' });
      const staleTimestamp = String(Math.floor(Date.now() / 1000) - 400);
      const sig = slackSignature(secret, staleTimestamp, bodyStr);

      await expect(
        router.dispatchWebhook(endpoint, Buffer.from(bodyStr, 'utf-8'), {
          'x-slack-signature': sig,
          'x-slack-request-timestamp': staleTimestamp,
        }),
      ).rejects.toMatchObject({ status: 401, body: { error: 'timestamp_expired' } });
    });
  });

  describe('slack url_verification challenge', () => {
    it('returns challenge for url_verification requests on slack endpoints', async () => {
      const endpoint = makeEndpoint({
        publisherPreset: 'slack',
        verificationType: 'none',
        signatureHeader: null,
        deliveryIdHeader: null,
        eventNameHeader: null,
      });
      const { router } = createRouter([endpoint], []);
      await router.reload();

      const bodyStr = JSON.stringify({
        type: 'url_verification',
        challenge: 'test-challenge-token',
        token: 'deprecated-token',
      });

      const result = await router.dispatchWebhook(endpoint, Buffer.from(bodyStr, 'utf-8'), {});
      expect(result.challenge).toBe('test-challenge-token');
      expect(result.dispatched).toBe(0);
    });

    it('accepts url_verification when challenge is exactly 256 characters', async () => {
      const endpoint = makeEndpoint({
        publisherPreset: 'slack',
        verificationType: 'none',
        signatureHeader: null,
        deliveryIdHeader: null,
        eventNameHeader: null,
      });
      const { router } = createRouter([endpoint], []);
      await router.reload();

      const challenge256 = 'a'.repeat(256);
      const bodyStr = JSON.stringify({
        type: 'url_verification',
        challenge: challenge256,
      });

      const result = await router.dispatchWebhook(endpoint, Buffer.from(bodyStr, 'utf-8'), {});
      expect(result.challenge).toBe(challenge256);
    });

    it('ignores url_verification when challenge exceeds 256 characters', async () => {
      const endpoint = makeEndpoint({
        publisherPreset: 'slack',
        verificationType: 'none',
        signatureHeader: null,
        deliveryIdHeader: null,
        eventNameHeader: null,
      });
      const { router } = createRouter([endpoint], []);
      await router.reload();

      const bodyStr = JSON.stringify({
        type: 'url_verification',
        challenge: 'x'.repeat(257),
      });

      const result = await router.dispatchWebhook(endpoint, Buffer.from(bodyStr, 'utf-8'), {});
      expect(result.challenge).toBeUndefined();
    });

    it('does not trigger challenge for non-slack presets even with url_verification body', async () => {
      const endpoint = makeEndpoint({
        publisherPreset: 'generic',
        verificationType: 'none',
        deliveryIdHeader: null,
        eventNameHeader: null,
      });
      const { router } = createRouter([endpoint], []);
      await router.reload();

      const bodyStr = JSON.stringify({
        type: 'url_verification',
        challenge: 'should-not-trigger',
      });

      const result = await router.dispatchWebhook(endpoint, Buffer.from(bodyStr, 'utf-8'), {});
      expect(result.challenge).toBeUndefined();
    });
  });

  describe('jira preset', () => {
    it('verifies and dispatches a jira webhook with hmac-sha256 and deduplication header', async () => {
      const secret = 'jira-webhook-secret';
      const endpoint = makeEndpoint({
        publisherPreset: 'jira',
        verificationType: 'hmac-sha256',
        signatureHeader: 'x-hub-signature',
        signaturePrefix: 'sha256=',
        deliveryIdHeader: 'x-atlassian-webhook-identifier',
        eventNameHeader: null,
        secretRef: 'secret:jira-1',
      });
      const subscription = makeSubscription({
        filterJson: JSON.stringify({
          match: [{ path: 'body.webhookEvent', eq: 'jira:issue_updated' }],
        }),
        contextMappingJson: JSON.stringify({
          issueKey: 'body.issue.key',
          event: 'body.webhookEvent',
        }),
      });
      const { router, deps } = createRouter([endpoint], [subscription], secret);
      await router.reload();

      const bodyObj = {
        webhookEvent: 'jira:issue_updated',
        issue: { key: 'PROJ-123', fields: { status: { name: 'In Progress' } } },
        changelog: { items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }] },
      };
      const bodyStr = JSON.stringify(bodyObj);
      const rawBody = Buffer.from(bodyStr, 'utf-8');
      const sig = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;

      const result = await router.dispatchWebhook(endpoint, rawBody, {
        'x-hub-signature': sig,
        'x-atlassian-webhook-identifier': 'jira-delivery-1',
      });

      expect(result.dispatched).toBe(1);
      expect(deps.orchestratorEngine.startRun).toHaveBeenCalledWith('orch-1', 'webhook', {
        triggerContext: {
          issueKey: 'PROJ-123',
          event: 'jira:issue_updated',
          _trigger: {
            publisher: 'jira',
            event: null,
            deliveryId: 'jira-delivery-1',
          },
        },
      });
    });
  });

  it('retries only the failed subscriptions for a duplicate delivery until the delivery completes', async () => {
    const endpoint = makeEndpoint();
    const orchestratorSubscription = makeSubscription({
      id: 'subscription-orch',
      targetType: 'orchestrator',
      orchestratorId: 'orch-1',
    });
    const taskSubscription = makeSubscription({
      id: 'subscription-task',
      targetType: 'triggered_task',
      orchestratorId: null,
      triggeredTaskId: 'task-1',
    });
    const { router, deps } = createRouter([endpoint], [orchestratorSubscription, taskSubscription]);
    deps.triggeredTaskExecutor.execute
      .mockResolvedValueOnce({ dispatched: false, reason: 'enqueue_failed' })
      .mockResolvedValueOnce({ dispatched: true, runId: 'tt-run-2' });
    await router.reload();
    const rawBody = Buffer.from(
      JSON.stringify({
        action: 'opened',
        repository: { full_name: 'org/repo' },
      }),
      'utf-8',
    );

    await expect(
      router.dispatchWebhook(endpoint, rawBody, {
        'x-github-event': 'pull_request',
        'x-github-delivery': 'delivery-5',
      }),
    ).rejects.toMatchObject({
      status: 503,
      body: {
        error: 'dispatch_failed',
        dispatched: 1,
        failed: 1,
      },
    } satisfies Partial<WebhookDispatchError>);

    await expect(
      router.dispatchWebhook(endpoint, rawBody, {
        'x-github-event': 'pull_request',
        'x-github-delivery': 'delivery-5',
      }),
    ).resolves.toEqual({
      ok: true,
      endpointId: 'endpoint-1',
      duplicate: false,
      matchedSubscriptions: 2,
      dispatched: 1,
      skipped: 1,
    });

    await expect(
      router.dispatchWebhook(endpoint, rawBody, {
        'x-github-event': 'pull_request',
        'x-github-delivery': 'delivery-5',
      }),
    ).resolves.toEqual({
      ok: true,
      endpointId: 'endpoint-1',
      duplicate: true,
      matchedSubscriptions: 0,
      dispatched: 0,
      skipped: 0,
    });

    expect(deps.orchestratorEngine.startRun).toHaveBeenCalledTimes(1);
    expect(deps.triggeredTaskExecutor.execute).toHaveBeenCalledTimes(2);
  });
});
