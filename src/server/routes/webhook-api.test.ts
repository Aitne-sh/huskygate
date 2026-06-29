import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../context/app-context.js';
import type { TriggeredTask } from '../../event/types.js';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import { handleWebhookApiRoutes } from './webhook-api.js';

const SUBSCRIPTION_ID = '11111111-1111-4111-8111-111111111111';

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
  options: {
    method: string;
    path: string;
    body?: unknown;
  },
): Promise<{ handled: boolean; status: number; body: unknown }> {
  const req = new MockRequest(options.method, options.path, { 'content-type': 'application/json' });
  const res = new MockResponse();
  const promise = handleWebhookApiRoutes(
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

function createContext(): AppContext {
  const endpoint = {
    id: 'endpoint-1',
    token: 'token-1',
    publisherPreset: 'github',
    verificationType: 'hmac-sha256',
    signatureHeader: 'x-hub-signature-256',
    signaturePrefix: 'sha256=',
    deliveryIdHeader: 'x-github-delivery',
    eventNameHeader: 'x-github-event',
    secretRef: 'secret:endpoint-1',
    maxBodyBytes: 131_072,
    enabled: true,
    createdAt: '2026-03-08T00:00:00.000Z',
    updatedAt: '2026-03-08T00:00:00.000Z',
  };
  const ctx = makeTestAppContext();
  ctx.config = {
    ...ctx.config,
    webhookPublicBaseUrl: 'https://hooks.example.com/base/',
  };
  ctx.webhookEndpointStore = {
    create: vi.fn(() => endpoint),
    getById: vi.fn(() => endpoint),
    list: vi.fn(() => [endpoint]),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as AppContext['webhookEndpointStore'];
  ctx.eventSubscriptionStore = {
    getById: vi.fn((id: string) =>
      id === SUBSCRIPTION_ID
        ? {
            id,
            endpointId: 'endpoint-1',
            targetType: 'orchestrator',
            orchestratorId: 'orch-1',
            triggeredTaskId: null,
            nodeId: null,
            filterJson: JSON.stringify({
              match: [
                { path: '_trigger.event', eq: 'pull_request' },
                { path: 'body.action', in: ['opened'] },
              ],
            }),
            contextMappingJson: JSON.stringify({
              repo: 'body.repository.full_name',
              sender: 'body.sender.login',
            }),
            enabled: true,
            createdAt: '2026-03-08T00:00:00.000Z',
            updatedAt: '2026-03-08T00:00:00.000Z',
          }
        : null,
    ),
    list: vi.fn(() => []),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as AppContext['eventSubscriptionStore'];
  ctx.webhookSecretStore = {
    isAvailable: vi.fn(async () => true),
    generateSecret: vi.fn(() => 'generated-secret'),
    buildSecretRef: vi.fn((id: string) => `secret:${id}`),
    setSecret: vi.fn(async () => true),
    deleteSecret: vi.fn(async () => true),
  } as unknown as AppContext['webhookSecretStore'];
  ctx.eventRouter = {
    reload: vi.fn(async () => undefined),
  } as unknown as AppContext['eventRouter'];
  ctx.orchestratorStore = {
    getById: vi.fn(() => ({ id: 'orch-1', triggerMode: 'webhook' })),
    getNodeById: vi.fn(() => null),
  } as unknown as AppContext['orchestratorStore'];
  ctx.triggeredTaskStore = {
    getById: vi.fn(() => null),
    list: vi.fn(() => []),
    getRunsByTask: vi.fn(() => []),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(<T>(fn: () => T) => fn()),
  } as unknown as AppContext['triggeredTaskStore'];
  return ctx;
}

describe('handleWebhookApiRoutes', () => {
  it('creates github endpoints with preset defaults and publicUrl', async () => {
    const ctx = createContext();

    const response = await invoke(ctx, {
      method: 'POST',
      path: '/api/webhook-endpoints',
      body: {
        publisherPreset: 'github',
        maxBodyBytes: 131072,
      },
    });

    expect(response.handled).toBe(true);
    expect(response.status).toBe(201);
    expect(ctx.webhookSecretStore.setSecret).toHaveBeenCalledWith(
      expect.stringContaining('secret:'),
      'generated-secret',
    );
    expect(ctx.webhookEndpointStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        publisherPreset: 'github',
        verificationType: 'hmac-sha256',
        signatureHeader: 'x-hub-signature-256',
        deliveryIdHeader: 'x-github-delivery',
        eventNameHeader: 'x-github-event',
        maxBodyBytes: 131072,
      }),
    );
    expect(response.body).toEqual({
      ok: true,
      data: expect.objectContaining({
        path: '/webhooks/token-1',
        publicUrl: 'https://hooks.example.com/webhooks/token-1',
        publicUrlConfigured: true,
      }),
      secret: 'generated-secret',
    });
  });

  it('returns publicUrl: null and publicUrlConfigured: false when WEBHOOK_PUBLIC_BASE_URL is unset', async () => {
    const ctx = createContext();
    ctx.config.webhookPublicBaseUrl = null;

    const response = await invoke(ctx, {
      method: 'GET',
      path: '/api/webhook-endpoints',
    });

    expect(response.handled).toBe(true);
    expect(response.status).toBe(200);
    const data = (response.body as { ok: boolean; data: Record<string, unknown>[] }).data;
    expect(data[0]).toMatchObject({
      path: '/webhooks/token-1',
      publicUrl: null,
      publicUrlConfigured: false,
    });
  });

  it('dry-runs subscription mapping and always includes _trigger in the trigger context', async () => {
    const ctx = createContext();

    const response = await invoke(ctx, {
      method: 'POST',
      path: `/api/event-subscriptions/${SUBSCRIPTION_ID}/test`,
      body: {
        _trigger: {
          publisher: 'github',
          event: 'pull_request',
          deliveryId: 'delivery-1',
        },
        body: {
          action: 'opened',
          repository: { full_name: 'org/repo' },
          sender: { login: 'shuto' },
        },
        headers: {
          'x-github-event': 'pull_request',
        },
      },
    });

    expect(response.handled).toBe(true);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      matched: true,
      triggerContext: {
        repo: 'org/repo',
        sender: 'shuto',
        _trigger: {
          publisher: 'github',
          event: 'pull_request',
          deliveryId: 'delivery-1',
        },
      },
    });
  });

  it('rejects oversized subscription dry-run payloads with 413', async () => {
    const ctx = createContext();

    const response = await invoke(ctx, {
      method: 'POST',
      path: `/api/event-subscriptions/${SUBSCRIPTION_ID}/test`,
      body: {
        body: {
          huge: 'x'.repeat(20_000),
        },
      },
    });

    expect(response.handled).toBe(true);
    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: 'Body too large' });
  });

  it('persists filterJson and contextMappingJson on subscription patch', async () => {
    const ctx = createContext();

    const response = await invoke(ctx, {
      method: 'PATCH',
      path: `/api/event-subscriptions/${SUBSCRIPTION_ID}`,
      body: {
        updatedAt: '2026-03-08T00:00:00.000Z',
        filterJson: {
          match: [
            { path: '_trigger.event', eq: 'push' },
            { path: 'body.action', prefix: 'sync' },
          ],
        },
        contextMappingJson: {
          repo: 'body.repository.full_name',
          branch: 'body.pull_request.head.ref',
        },
      },
    });

    expect(response.handled).toBe(true);
    expect(response.status).toBe(200);
    expect(ctx.eventSubscriptionStore.update).toHaveBeenCalledWith(
      SUBSCRIPTION_ID,
      expect.objectContaining({
        filterJson:
          '{"match":[{"path":"_trigger.event","eq":"push"},{"path":"body.action","prefix":"sync"}]}',
        contextMappingJson:
          '{"repo":"body.repository.full_name","branch":"body.pull_request.head.ref"}',
      }),
      '2026-03-08T00:00:00.000Z',
    );
  });

  it('rejects non-finite maxBodyBytes values on endpoint patch before validation', async () => {
    const ctx = createContext();

    const response = await invoke(ctx, {
      method: 'PATCH',
      path: '/api/webhook-endpoints/11111111-1111-4111-8111-111111111112',
      body: {
        maxBodyBytes: 'oops',
      },
    });

    expect(response.handled).toBe(true);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'maxBodyBytes must be between 65536 and 1048576',
    });
  });

  it('returns 409 when creating a duplicate triggered task subscription', async () => {
    const ctx = createContext();
    ctx.eventSubscriptionStore.create = vi.fn(() => {
      throw new Error('UNIQUE constraint failed: event_subscriptions.triggered_task_id');
    });
    ctx.triggeredTaskStore.getById = vi.fn(
      () =>
        ({
          id: 'task-1',
          name: 'Task 1',
          description: null,
          userId: 'dashboard',
          tool: 'claude',
          model: null,
          mode: 'write',
          prompt: 'run',
          workdir: null,
          maxRetries: 0,
          allowMcp: true,
          enabledSkills: null,
          instructionFile: null,
          agentId: null,
          notifyChannel: null,
          notifyThread: null,
          enabled: true,
          runCount: 0,
          lastRunAt: null,
          claimedAt: null,
          createdAt: '2026-03-08T00:00:00.000Z',
          updatedAt: '2026-03-08T00:00:00.000Z',
          concurrencyPolicy: 'skip_if_running',
        }) satisfies TriggeredTask,
    );

    const response = await invoke(ctx, {
      method: 'POST',
      path: '/api/event-subscriptions',
      body: {
        endpointId: 'endpoint-1',
        targetType: 'triggered_task',
        triggeredTaskId: 'task-1',
      },
    });

    expect(response.handled).toBe(true);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'Triggered task subscription already exists',
    });
  });

  it('returns 409 when patching into a duplicate orchestrator subscription', async () => {
    const ctx = createContext();
    ctx.eventSubscriptionStore.update = vi.fn(() => {
      throw new Error('UNIQUE constraint failed: event_subscriptions.orchestrator_id');
    });

    const response = await invoke(ctx, {
      method: 'PATCH',
      path: `/api/event-subscriptions/${SUBSCRIPTION_ID}`,
      body: {
        endpointId: 'endpoint-1',
        targetType: 'orchestrator',
        orchestratorId: 'orch-1',
        updatedAt: '2026-03-08T00:00:00.000Z',
      },
    });

    expect(response.handled).toBe(true);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: 'Webhook endpoint subscription already exists for this orchestrator',
    });
  });

  it('rejects orchestrator subscriptions for non-webhook orchestrators', async () => {
    const ctx = createContext();
    (ctx.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      id: 'orch-ondemand',
      triggerMode: 'ondemand',
    }));

    const response = await invoke(ctx, {
      method: 'POST',
      path: '/api/event-subscriptions',
      body: {
        endpointId: 'endpoint-1',
        targetType: 'orchestrator',
        orchestratorId: 'orch-ondemand',
      },
    });

    expect(response.handled).toBe(true);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'orchestratorId must reference a webhook-triggered orchestrator',
    });
    expect(ctx.eventSubscriptionStore.create).not.toHaveBeenCalled();
  });

  it('rejects patching subscriptions to non-webhook orchestrators', async () => {
    const ctx = createContext();
    (ctx.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string) => ({
        id,
        triggerMode: id === 'orch-ondemand' ? 'ondemand' : 'webhook',
      }),
    );

    const response = await invoke(ctx, {
      method: 'PATCH',
      path: `/api/event-subscriptions/${SUBSCRIPTION_ID}`,
      body: {
        endpointId: 'endpoint-1',
        targetType: 'orchestrator',
        orchestratorId: 'orch-ondemand',
      },
    });

    expect(response.handled).toBe(true);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'orchestratorId must reference a webhook-triggered orchestrator',
    });
    expect(ctx.eventSubscriptionStore.update).not.toHaveBeenCalled();
  });

  it('returns 400 when inline triggered-task create loses its endpoint during the transaction', async () => {
    const ctx = createContext();
    const endpoint = {
      id: 'endpoint-1',
      token: 'token-1',
      publisherPreset: 'github',
      verificationType: 'hmac-sha256',
      signatureHeader: 'x-hub-signature-256',
      signaturePrefix: 'sha256=',
      deliveryIdHeader: 'x-github-delivery',
      eventNameHeader: 'x-github-event',
      secretRef: 'secret:endpoint-1',
      maxBodyBytes: 131_072,
      enabled: true,
      createdAt: '2026-03-08T00:00:00.000Z',
      updatedAt: '2026-03-08T00:00:00.000Z',
    };
    (ctx.webhookEndpointStore.getById as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(endpoint)
      .mockReturnValueOnce(null);

    const response = await invoke(ctx, {
      method: 'POST',
      path: '/api/triggered-tasks',
      body: {
        name: 'task',
        prompt: 'run',
        subscription: {
          endpointId: 'endpoint-1',
        },
      },
    });

    expect(response.handled).toBe(true);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'endpointId not found' });
    expect(ctx.eventSubscriptionStore.create).not.toHaveBeenCalled();
  });

  it('returns 400 when inline triggered-task create receives malformed filter JSON', async () => {
    const ctx = createContext();

    const response = await invoke(ctx, {
      method: 'POST',
      path: '/api/triggered-tasks',
      body: {
        name: 'task',
        prompt: 'run',
        subscription: {
          endpointId: 'endpoint-1',
          filterJson: '{bad json',
        },
      },
    });

    expect(response.handled).toBe(true);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'filterJson must be valid JSON' });
    expect(ctx.triggeredTaskStore.create).not.toHaveBeenCalled();
    expect(ctx.eventSubscriptionStore.create).not.toHaveBeenCalled();
  });

  it('returns 400 when inline triggered-task create omits endpointId', async () => {
    const ctx = createContext();

    const response = await invoke(ctx, {
      method: 'POST',
      path: '/api/triggered-tasks',
      body: {
        name: 'task',
        prompt: 'run',
        subscription: {
          enabled: false,
        },
      },
    });

    expect(response.handled).toBe(true);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error:
        'subscription.endpointId is required when subscription is provided; use null to remove the subscription',
    });
    expect(ctx.triggeredTaskStore.create).not.toHaveBeenCalled();
    expect(ctx.eventSubscriptionStore.create).not.toHaveBeenCalled();
  });

  it('returns 400 when inline triggered-task patch loses its endpoint during the transaction', async () => {
    const ctx = createContext();
    const taskId = '11111111-1111-4111-8111-111111111111';
    const endpoint = {
      id: 'endpoint-1',
      token: 'token-1',
      publisherPreset: 'github',
      verificationType: 'hmac-sha256',
      signatureHeader: 'x-hub-signature-256',
      signaturePrefix: 'sha256=',
      deliveryIdHeader: 'x-github-delivery',
      eventNameHeader: 'x-github-event',
      secretRef: 'secret:endpoint-1',
      maxBodyBytes: 131_072,
      enabled: true,
      createdAt: '2026-03-08T00:00:00.000Z',
      updatedAt: '2026-03-08T00:00:00.000Z',
    };
    (ctx.webhookEndpointStore.getById as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(endpoint)
      .mockReturnValueOnce(null);
    (ctx.triggeredTaskStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: taskId,
      name: 'Task 1',
      description: null,
      userId: 'dashboard',
      tool: 'claude',
      model: null,
      mode: 'write',
      prompt: 'run',
      workdir: null,
      maxRetries: 0,
      allowMcp: false,
      enabledSkills: null,
      instructionFile: null,
      agentId: null,
      notifyChannel: 'C123',
      notifyThread: null,
      enabled: true,
      runCount: 0,
      lastRunAt: null,
      claimedAt: null,
      createdAt: '2026-03-08T00:00:00.000Z',
      updatedAt: '2026-03-08T00:00:00.000Z',
      concurrencyPolicy: 'skip_if_running',
    });
    (ctx.eventSubscriptionStore.list as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        id: 'sub-1',
        endpointId: 'endpoint-1',
        targetType: 'triggered_task',
        orchestratorId: null,
        triggeredTaskId: taskId,
        nodeId: null,
        filterJson: null,
        contextMappingJson: null,
        enabled: true,
        createdAt: '2026-03-08T00:00:00.000Z',
        updatedAt: '2026-03-08T00:00:00.000Z',
      },
    ]);

    const response = await invoke(ctx, {
      method: 'PATCH',
      path: `/api/triggered-tasks/${taskId}`,
      body: {
        subscription: {
          endpointId: 'endpoint-1',
        },
      },
    });

    expect(response.handled).toBe(true);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'endpointId not found' });
    expect(ctx.eventSubscriptionStore.update).not.toHaveBeenCalled();
  });

  it('returns 400 when inline triggered-task patch receives malformed filter JSON', async () => {
    const ctx = createContext();
    const taskId = '11111111-1111-4111-8111-111111111111';
    (ctx.triggeredTaskStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: taskId,
      name: 'Task 1',
      description: null,
      userId: 'dashboard',
      tool: 'claude',
      model: null,
      mode: 'write',
      prompt: 'run',
      workdir: null,
      maxRetries: 0,
      allowMcp: false,
      enabledSkills: null,
      instructionFile: null,
      agentId: null,
      notifyChannel: 'C123',
      notifyThread: null,
      enabled: true,
      runCount: 0,
      lastRunAt: null,
      claimedAt: null,
      createdAt: '2026-03-08T00:00:00.000Z',
      updatedAt: '2026-03-08T00:00:00.000Z',
      concurrencyPolicy: 'skip_if_running',
    });

    const response = await invoke(ctx, {
      method: 'PATCH',
      path: `/api/triggered-tasks/${taskId}`,
      body: {
        subscription: {
          endpointId: 'endpoint-1',
          filterJson: '{bad json',
        },
      },
    });

    expect(response.handled).toBe(true);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'filterJson must be valid JSON' });
    expect(ctx.triggeredTaskStore.update).not.toHaveBeenCalled();
    expect(ctx.eventSubscriptionStore.update).not.toHaveBeenCalled();
  });

  it('returns 400 when inline triggered-task patch omits endpointId instead of deleting', async () => {
    const ctx = createContext();
    const taskId = '11111111-1111-4111-8111-111111111111';
    (ctx.triggeredTaskStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: taskId,
      name: 'Task 1',
      description: null,
      userId: 'dashboard',
      tool: 'claude',
      model: null,
      mode: 'write',
      prompt: 'run',
      workdir: null,
      maxRetries: 0,
      allowMcp: false,
      enabledSkills: null,
      instructionFile: null,
      agentId: null,
      notifyChannel: 'C123',
      notifyThread: null,
      enabled: true,
      runCount: 0,
      lastRunAt: null,
      claimedAt: null,
      createdAt: '2026-03-08T00:00:00.000Z',
      updatedAt: '2026-03-08T00:00:00.000Z',
      concurrencyPolicy: 'skip_if_running',
    });

    const response = await invoke(ctx, {
      method: 'PATCH',
      path: `/api/triggered-tasks/${taskId}`,
      body: {
        subscription: {
          enabled: false,
        },
      },
    });

    expect(response.handled).toBe(true);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error:
        'subscription.endpointId is required when subscription is provided; use null to remove the subscription',
    });
    expect(ctx.triggeredTaskStore.update).not.toHaveBeenCalled();
    expect(ctx.eventSubscriptionStore.delete).not.toHaveBeenCalled();
  });

  it('enforces allowedUserIds when creating and patching triggered tasks', async () => {
    const ctx = createContext();
    const taskId = '11111111-1111-4111-8111-111111111111';
    ctx.config.allowedUserIds = ['U_ALLOWED'];
    ctx.triggeredTaskStore = {
      ...ctx.triggeredTaskStore,
      create: vi.fn((input: Record<string, unknown>) => ({
        id: taskId,
        name: String(input.name),
        description: input.description ?? null,
        userId: String(input.userId),
        tool: input.tool,
        mode: 'write',
        prompt: String(input.prompt),
        workdir: input.workdir ?? null,
        maxRetries: input.maxRetries ?? 0,
        allowMcp: input.allowMcp ?? false,
        enabledSkills: input.enabledSkills ?? null,
        instructionFile: input.instructionFile ?? null,
        notifyChannel: input.notifyChannel ?? null,
        enabled: input.enabled ?? true,
        runCount: 0,
        lastRunAt: null,
        claimedAt: null,
        createdAt: '2026-03-08T00:00:00.000Z',
        updatedAt: '2026-03-08T00:00:00.000Z',
        concurrencyPolicy: input.concurrencyPolicy ?? 'skip_if_running',
      })),
      getById: vi.fn(() => ({
        id: taskId,
        name: 'Task 1',
        description: null,
        userId: 'dashboard',
        tool: 'claude',
        model: null,
        mode: 'write',
        prompt: 'run',
        workdir: null,
        maxRetries: 0,
        allowMcp: false,
        enabledSkills: null,
        instructionFile: null,
        agentId: null,
        notifyChannel: 'C123',
        notifyThread: null,
        enabled: true,
        runCount: 0,
        lastRunAt: null,
        claimedAt: null,
        createdAt: '2026-03-08T00:00:00.000Z',
        updatedAt: '2026-03-08T00:00:00.000Z',
        concurrencyPolicy: 'skip_if_running',
      })),
      update: vi.fn(),
    } as unknown as AppContext['triggeredTaskStore'];

    const rejectedCreate = await invoke(ctx, {
      method: 'POST',
      path: '/api/triggered-tasks',
      body: {
        name: 'blocked',
        prompt: 'run',
        notify_channel: 'C123',
        user_id: 'U_BLOCKED',
      },
    });

    expect(rejectedCreate.status).toBe(403);
    expect(rejectedCreate.body).toEqual({ error: 'user_id not in allowlist' });
    expect(ctx.triggeredTaskStore.create).not.toHaveBeenCalled();

    const dashboardCreate = await invoke(ctx, {
      method: 'POST',
      path: '/api/triggered-tasks',
      body: {
        name: 'dashboard',
        prompt: 'run',
        notifyChannel: 'C123',
      },
    });

    expect(dashboardCreate.status).toBe(201);
    expect(ctx.triggeredTaskStore.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: 'dashboard' }),
    );

    const trimmedCreate = await invoke(ctx, {
      method: 'POST',
      path: '/api/triggered-tasks',
      body: {
        name: 'trimmed',
        prompt: 'run',
        notify_channel: ' C123 ',
        user_id: ' U_ALLOWED ',
      },
    });

    expect(trimmedCreate.status).toBe(201);
    expect(ctx.triggeredTaskStore.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: 'U_ALLOWED' }),
    );

    const rejectedPatch = await invoke(ctx, {
      method: 'PATCH',
      path: `/api/triggered-tasks/${taskId}`,
      body: {
        userId: 'U_BLOCKED',
      },
    });

    expect(rejectedPatch.status).toBe(403);
    expect(rejectedPatch.body).toEqual({ error: 'user_id not in allowlist' });
    expect(ctx.triggeredTaskStore.update).not.toHaveBeenCalled();
  });
});
