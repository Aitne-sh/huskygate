/**
 * Coverage tests for webhook-api.ts — targets uncovered branches:
 * - handlePublicWebhookRoute: body too large (413), challenge response, unhandled dispatch error
 * - handleWebhookApiRoutes: event-subscriptions routing, triggered-tasks routing
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import { createInvoker } from './_test-utils.js';
import {
  handlePublicWebhookRoute,
  handleWebhookApiRoutes,
  matchesWebhookApiPath,
} from './webhook-api.js';

const mocked = vi.hoisted(() => ({
  extractClientIp: vi.fn(() => '1.2.3.4'),
  readBodyBuffer: vi.fn().mockResolvedValue(Buffer.from('{"test":true}')),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  handleEndpointRoutes: vi.fn().mockResolvedValue(false),
  handleSubscriptionRoutes: vi.fn().mockResolvedValue(false),
  handleTriggeredTaskRoutes: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: mocked.loggerInfo, warn: mocked.loggerWarn, error: mocked.loggerError },
}));

vi.mock('../github-ip-allowlist.js', () => ({
  extractClientIp: mocked.extractClientIp,
}));

vi.mock('../../shared/http.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/http.js')>();
  return { ...actual, readBodyBuffer: mocked.readBodyBuffer };
});

vi.mock('./webhook-endpoints.js', () => ({
  handleEndpointRoutes: mocked.handleEndpointRoutes,
}));
vi.mock('./webhook-subscriptions.js', () => ({
  handleSubscriptionRoutes: mocked.handleSubscriptionRoutes,
}));
vi.mock('./webhook-triggered-tasks.js', () => ({
  handleTriggeredTaskRoutes: mocked.handleTriggeredTaskRoutes,
}));

const invokePublic = createInvoker(handlePublicWebhookRoute as Parameters<typeof createInvoker>[0]);
const invokeApi = createInvoker(handleWebhookApiRoutes as Parameters<typeof createInvoker>[0]);

function expectBody(body: unknown): Record<string, unknown> {
  expect(body).not.toBeNull();
  return body as Record<string, unknown>;
}

describe('matchesWebhookApiPath', () => {
  it('matches webhook-endpoints path', () => {
    expect(matchesWebhookApiPath('/api/webhook-endpoints')).toBe(true);
    expect(matchesWebhookApiPath('/api/webhook-endpoints/some-id')).toBe(true);
  });

  it('matches event-subscriptions path', () => {
    expect(matchesWebhookApiPath('/api/event-subscriptions')).toBe(true);
    expect(matchesWebhookApiPath('/api/event-subscriptions/some-id')).toBe(true);
  });

  it('matches triggered-tasks path', () => {
    expect(matchesWebhookApiPath('/api/triggered-tasks')).toBe(true);
    expect(matchesWebhookApiPath('/api/triggered-tasks/some-id')).toBe(true);
  });

  it('does not match unrelated paths', () => {
    expect(matchesWebhookApiPath('/api/settings')).toBe(false);
    expect(matchesWebhookApiPath('/api/chat/sessions')).toBe(false);
    expect(matchesWebhookApiPath('/webhooks/token')).toBe(false);
  });
});

describe('handlePublicWebhookRoute coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false for non-POST methods', async () => {
    const ctx = makeTestAppContext();
    const r = await invokePublic(ctx, { method: 'GET', path: '/webhooks/abcdef0123456789' });
    expect(r.handled).toBe(false);
  });

  it('returns false for non-webhook paths', async () => {
    const ctx = makeTestAppContext();
    const r = await invokePublic(ctx, { method: 'POST', path: '/api/other' });
    expect(r.handled).toBe(false);
  });

  it('returns 404 for unknown endpoint token', async () => {
    const ctx = makeTestAppContext();
    ctx.eventRouter = {
      ...ctx.eventRouter,
      getEndpointByToken: vi.fn(() => null),
    } as unknown as typeof ctx.eventRouter;

    const r = await invokePublic(ctx, { method: 'POST', path: '/webhooks/abcdef0123456789' });
    expect(r.status).toBe(404);
    expect(expectBody(r.body).error).toBe('endpoint_not_found');
  });

  it('rejects IP when GitHub IP allowlist is enabled and IP is not allowed', async () => {
    const ctx = makeTestAppContext();
    ctx.tunnelEnabled = true;
    ctx.githubIpAllowlist = {
      isAllowed: vi.fn(() => false),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as NonNullable<typeof ctx.githubIpAllowlist>;
    ctx.eventRouter = {
      ...ctx.eventRouter,
      getEndpointByToken: vi.fn(() => ({
        id: 'ep-1',
        token: 'tok',
        publisherPreset: 'github',
        maxBodyBytes: 262144,
        enabled: true,
      })),
    } as unknown as typeof ctx.eventRouter;

    const r = await invokePublic(ctx, { method: 'POST', path: '/webhooks/abcdef0123456789' });
    expect(r.status).toBe(403);
    expect(expectBody(r.body).error).toBe('ip_not_allowed');
  });

  it('returns 202 for successful non-challenge dispatch', async () => {
    const ctx = makeTestAppContext();
    ctx.eventRouter = {
      ...ctx.eventRouter,
      getEndpointByToken: vi.fn(() => ({
        id: 'ep-1',
        token: 'tok',
        publisherPreset: 'generic',
        maxBodyBytes: 262144,
        enabled: true,
      })),
      dispatchWebhook: vi.fn().mockResolvedValue({ deliveryId: 'd1', triggeredCount: 1 }),
    } as unknown as typeof ctx.eventRouter;
    mocked.readBodyBuffer.mockResolvedValue(Buffer.from('{}'));

    const r = await invokePublic(ctx, { method: 'POST', path: '/webhooks/abcdef0123456789' });
    expect(r.status).toBe(202);
    expect(expectBody(r.body).deliveryId).toBe('d1');
  });

  it('returns WebhookDispatchError status and body', async () => {
    const { WebhookDispatchError } = await import('../../event/event-router.js');
    const ctx = makeTestAppContext();
    ctx.eventRouter = {
      ...ctx.eventRouter,
      getEndpointByToken: vi.fn(() => ({
        id: 'ep-1',
        token: 'tok',
        publisherPreset: 'generic',
        maxBodyBytes: 262144,
        enabled: true,
      })),
      dispatchWebhook: vi
        .fn()
        .mockRejectedValue(new WebhookDispatchError(401, { error: 'signature_mismatch' })),
    } as unknown as typeof ctx.eventRouter;
    mocked.readBodyBuffer.mockResolvedValue(Buffer.from('{}'));

    const r = await invokePublic(ctx, { method: 'POST', path: '/webhooks/abcdef0123456789' });
    expect(r.status).toBe(401);
    expect(expectBody(r.body).error).toBe('signature_mismatch');
  });

  it('returns 413 when body exceeds maxBodyBytes', async () => {
    const ctx = makeTestAppContext();
    ctx.eventRouter = {
      ...ctx.eventRouter,
      getEndpointByToken: vi.fn(() => ({
        id: 'ep-1',
        token: 'tok',
        publisherPreset: 'generic',
        maxBodyBytes: 100,
        enabled: true,
      })),
    } as unknown as typeof ctx.eventRouter;
    mocked.readBodyBuffer.mockRejectedValueOnce(new Error('Body too large'));

    const r = await invokePublic(ctx, { method: 'POST', path: '/webhooks/abcdef0123456789' });
    expect(r.status).toBe(413);
  });

  it('returns challenge response', async () => {
    const ctx = makeTestAppContext();
    ctx.eventRouter = {
      ...ctx.eventRouter,
      getEndpointByToken: vi.fn(() => ({
        id: 'ep-1',
        token: 'tok',
        publisherPreset: 'generic',
        maxBodyBytes: 262144,
        enabled: true,
      })),
      dispatchWebhook: vi.fn().mockResolvedValue({ challenge: 'abc123' }),
    } as unknown as typeof ctx.eventRouter;
    mocked.readBodyBuffer.mockResolvedValue(Buffer.from('{}'));

    const r = await invokePublic(ctx, { method: 'POST', path: '/webhooks/abcdef0123456789' });
    expect(r.status).toBe(200);
    expect(expectBody(r.body).challenge).toBe('abc123');
  });

  it('returns 500 for unhandled dispatch error', async () => {
    const ctx = makeTestAppContext();
    ctx.eventRouter = {
      ...ctx.eventRouter,
      getEndpointByToken: vi.fn(() => ({
        id: 'ep-1',
        token: 'tok',
        publisherPreset: 'generic',
        maxBodyBytes: 262144,
        enabled: true,
      })),
      dispatchWebhook: vi.fn().mockRejectedValue(new Error('unknown')),
    } as unknown as typeof ctx.eventRouter;
    mocked.readBodyBuffer.mockResolvedValue(Buffer.from('{}'));

    const r = await invokePublic(ctx, { method: 'POST', path: '/webhooks/abcdef0123456789' });
    expect(r.status).toBe(500);
    expect(expectBody(r.body).error).toBe('internal_error');
  });
});

describe('handleWebhookApiRoutes coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes to subscription handler for /api/event-subscriptions', async () => {
    mocked.handleSubscriptionRoutes.mockResolvedValueOnce(true);
    const ctx = makeTestAppContext();
    await invokeApi(ctx, { method: 'GET', path: '/api/event-subscriptions' });
    expect(mocked.handleSubscriptionRoutes).toHaveBeenCalled();
  });

  it('routes to triggered-tasks handler for /api/triggered-tasks', async () => {
    mocked.handleTriggeredTaskRoutes.mockResolvedValueOnce(true);
    const ctx = makeTestAppContext();
    await invokeApi(ctx, { method: 'GET', path: '/api/triggered-tasks' });
    expect(mocked.handleTriggeredTaskRoutes).toHaveBeenCalled();
  });

  it('routes to endpoint handler for /api/webhook-endpoints', async () => {
    mocked.handleEndpointRoutes.mockResolvedValueOnce(true);
    const ctx = makeTestAppContext();
    await invokeApi(ctx, { method: 'GET', path: '/api/webhook-endpoints' });
    expect(mocked.handleEndpointRoutes).toHaveBeenCalled();
  });

  it('routes to subscription handler for /api/event-subscriptions/{id}', async () => {
    mocked.handleSubscriptionRoutes.mockResolvedValueOnce(true);
    const ctx = makeTestAppContext();
    await invokeApi(ctx, {
      method: 'GET',
      path: '/api/event-subscriptions/11111111-1111-4111-8111-111111111111',
    });
    expect(mocked.handleSubscriptionRoutes).toHaveBeenCalled();
  });

  it('routes to endpoint handler for /api/webhook-endpoints/{id}', async () => {
    mocked.handleEndpointRoutes.mockResolvedValueOnce(true);
    const ctx = makeTestAppContext();
    await invokeApi(ctx, {
      method: 'GET',
      path: '/api/webhook-endpoints/some-id',
    });
    expect(mocked.handleEndpointRoutes).toHaveBeenCalled();
  });

  it('routes to triggered-tasks handler for /api/triggered-tasks/{id}', async () => {
    mocked.handleTriggeredTaskRoutes.mockResolvedValueOnce(true);
    const ctx = makeTestAppContext();
    await invokeApi(ctx, {
      method: 'GET',
      path: '/api/triggered-tasks/some-id',
    });
    expect(mocked.handleTriggeredTaskRoutes).toHaveBeenCalled();
  });

  it('falls through to triggered-tasks handler for unmatched paths', async () => {
    mocked.handleTriggeredTaskRoutes.mockResolvedValueOnce(false);
    const ctx = makeTestAppContext();
    const r = await invokeApi(ctx, {
      method: 'GET',
      path: '/api/triggered-tasks',
    });
    expect(r.handled).toBe(false);
    expect(mocked.handleTriggeredTaskRoutes).toHaveBeenCalled();
  });
});
