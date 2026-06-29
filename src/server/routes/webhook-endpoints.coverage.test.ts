/** Coverage tests for webhook-endpoints.ts — targeting 100% statement and branch coverage. */
import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../context/app-context.js';
import type { WebhookEndpoint } from '../../event/types.js';
import { StaleUpdateError } from '../../store/store-utils.js';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import { UUID, createInvoker } from './_test-utils.js';
import { handleEndpointRoutes } from './webhook-endpoints.js';

const invoke = createInvoker(handleEndpointRoutes as Parameters<typeof createInvoker>[0]);

const ENDPOINT_ID = UUID.endpoint1;

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

function createCtx(overrides: Partial<WebhookEndpoint> = {}): AppContext {
  const endpoint = makeEndpoint(overrides);
  const ctx = makeTestAppContext({
    config: { webhookPublicBaseUrl: 'https://hooks.example.com' },
  });
  ctx.webhookEndpointStore = {
    create: vi.fn(() => endpoint),
    getById: vi.fn((id: string) => (id === ENDPOINT_ID ? endpoint : null)),
    list: vi.fn(() => [endpoint]),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as AppContext['webhookEndpointStore'];
  return ctx;
}

describe('handleEndpointRoutes', () => {
  // ── GET /api/webhook-endpoints ──────────────────────────────
  describe('GET /api/webhook-endpoints', () => {
    it('lists all endpoints', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, { method: 'GET', path: '/api/webhook-endpoints' });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(200);
      expect((r.body as Record<string, unknown>).ok).toBe(true);
      expect(Array.isArray((r.body as Record<string, unknown>).data)).toBe(true);
    });
  });

  // ── POST /api/webhook-endpoints ─────────────────────────────
  describe('POST /api/webhook-endpoints', () => {
    it('creates a github endpoint with defaults', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/webhook-endpoints',
        body: { publisherPreset: 'github' },
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(201);
      expect(ctx.webhookEndpointStore.create).toHaveBeenCalled();
      expect(ctx.webhookSecretStore.setSecret).toHaveBeenCalled();
      expect(ctx.eventRouter.reload).toHaveBeenCalled();
    });

    it('creates a generic endpoint with verificationType none (no secret)', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/webhook-endpoints',
        body: { publisherPreset: 'generic', verificationType: 'none' },
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(201);
      // verificationType none => no secret set
    });

    it('creates endpoint with user-provided secret', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/webhook-endpoints',
        body: { publisherPreset: 'github', secret: 'my-secret' },
      });
      expect(r.status).toBe(201);
      expect(ctx.webhookSecretStore.setSecret).toHaveBeenCalledWith(
        expect.any(String),
        'my-secret',
      );
    });

    it('defaults publisherPreset to generic when omitted', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/webhook-endpoints',
        body: { verificationType: 'none' },
      });
      expect(r.status).toBe(201);
      expect(ctx.webhookEndpointStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ publisherPreset: 'generic' }),
      );
    });

    it('uses provided maxBodyBytes', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/webhook-endpoints',
        body: { verificationType: 'none', maxBodyBytes: 262144 },
      });
      expect(r.status).toBe(201);
      expect(ctx.webhookEndpointStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ maxBodyBytes: 262144 }),
      );
    });

    it('defaults maxBodyBytes to 262144 when not provided', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/webhook-endpoints',
        body: { verificationType: 'none' },
      });
      expect(r.status).toBe(201);
      expect(ctx.webhookEndpointStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ maxBodyBytes: 262144 }),
      );
    });

    it('rejects invalid JSON body', async () => {
      const ctx = createCtx();
      // Manually construct a request with invalid JSON
      const { MockRequest, MockResponse } = await import('./_test-utils.js');
      const req = new MockRequest('POST', '/api/webhook-endpoints');
      const res = new MockResponse();
      const promise = handleEndpointRoutes(
        ctx,
        req as unknown as import('node:http').IncomingMessage,
        res as unknown as import('node:http').ServerResponse,
        '/api/webhook-endpoints',
      );
      req.emit('data', Buffer.from('not json'));
      req.emit('end');
      const handled = await promise;
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ error: 'Invalid JSON' });
    });

    it('rejects invalid publisherPreset', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/webhook-endpoints',
        body: { publisherPreset: 'invalid' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'publisherPreset must be generic, github, slack, or jira' });
    });

    it('rejects invalid verificationType', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/webhook-endpoints',
        body: { verificationType: 'bad-type' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'verificationType is invalid' });
    });

    it('rejects endpoint patch validation errors (e.g. out-of-range maxBodyBytes)', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/webhook-endpoints',
        body: { verificationType: 'none', maxBodyBytes: 10 },
      });
      expect(r.status).toBe(400);
      expect((r.body as Record<string, string>).error).toContain('maxBodyBytes must be between');
    });

    it('returns 400 when keychain unavailable for verification types other than none', async () => {
      const ctx = createCtx();
      (ctx.webhookSecretStore.isAvailable as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/webhook-endpoints',
        body: { publisherPreset: 'github' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'keychain_unavailable' });
    });

    it('cleans up secret ref on create error after secret was stored', async () => {
      const ctx = createCtx();
      (ctx.webhookEndpointStore.create as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('DB write failed');
      });
      await expect(
        invoke(ctx, {
          method: 'POST',
          path: '/api/webhook-endpoints',
          body: { publisherPreset: 'github' },
        }),
      ).rejects.toThrow('DB write failed');
      expect(ctx.webhookSecretStore.deleteSecret).toHaveBeenCalled();
    });

    it('suppresses deleteSecret errors during cleanup', async () => {
      const ctx = createCtx();
      (ctx.webhookEndpointStore.create as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('DB write failed');
      });
      (ctx.webhookSecretStore.deleteSecret as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('delete failed'),
      );
      await expect(
        invoke(ctx, {
          method: 'POST',
          path: '/api/webhook-endpoints',
          body: { publisherPreset: 'github' },
        }),
      ).rejects.toThrow('DB write failed');
    });

    it('does not attempt to delete secret if secretRef is null (none verification)', async () => {
      const ctx = createCtx();
      (ctx.webhookEndpointStore.create as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('DB write failed');
      });
      await expect(
        invoke(ctx, {
          method: 'POST',
          path: '/api/webhook-endpoints',
          body: { verificationType: 'none' },
        }),
      ).rejects.toThrow('DB write failed');
      expect(ctx.webhookSecretStore.deleteSecret).not.toHaveBeenCalled();
    });

    it('logs debug when webhookPublicBaseUrl is not set', async () => {
      const ctx = createCtx();
      ctx.config = { ...ctx.config, webhookPublicBaseUrl: null };
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/webhook-endpoints',
        body: { publisherPreset: 'github' },
      });
      expect(r.status).toBe(201);
    });

    it('handles enabled field normalization', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/webhook-endpoints',
        body: { verificationType: 'none', enabled: false },
      });
      expect(r.status).toBe(201);
      expect(ctx.webhookEndpointStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false }),
      );
    });
  });

  // ── GET /api/webhook-endpoints/:id ──────────────────────────
  describe('GET /api/webhook-endpoints/:id', () => {
    it('returns a single endpoint by ID', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'GET',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(200);
      expect((r.body as Record<string, unknown>).ok).toBe(true);
    });

    it('returns 404 when endpoint not found', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'GET',
        path: `/api/webhook-endpoints/${UUID.missing}`,
      });
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: 'Endpoint not found' });
    });
  });

  // ── PATCH /api/webhook-endpoints/:id ────────────────────────
  describe('PATCH /api/webhook-endpoints/:id', () => {
    it('patches an endpoint successfully', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: { enabled: false },
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(200);
      expect(ctx.webhookEndpointStore.update).toHaveBeenCalled();
    });

    it('returns 404 when endpoint not found for patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${UUID.missing}`,
        body: { enabled: false },
      });
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: 'Endpoint not found' });
    });

    it('rejects invalid JSON in patch', async () => {
      const ctx = createCtx();
      const { MockRequest, MockResponse } = await import('./_test-utils.js');
      const req = new MockRequest('PATCH', `/api/webhook-endpoints/${ENDPOINT_ID}`);
      const res = new MockResponse();
      const promise = handleEndpointRoutes(
        ctx,
        req as unknown as import('node:http').IncomingMessage,
        res as unknown as import('node:http').ServerResponse,
        `/api/webhook-endpoints/${ENDPOINT_ID}`,
      );
      req.emit('data', Buffer.from('not json'));
      req.emit('end');
      await promise;
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ error: 'Invalid JSON' });
    });

    it('rejects invalid publisherPreset in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: { publisherPreset: 'invalid' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({
        error: 'publisherPreset must be generic, github, slack, or jira',
      });
    });

    it('rejects non-finite maxBodyBytes in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: { maxBodyBytes: 'not-a-number' },
      });
      expect(r.status).toBe(400);
      expect((r.body as Record<string, string>).error).toContain('maxBodyBytes must be between');
    });

    it('rejects NaN maxBodyBytes in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: { maxBodyBytes: Number.NaN },
      });
      expect(r.status).toBe(400);
    });

    it('rejects Infinity maxBodyBytes in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: { maxBodyBytes: Number.POSITIVE_INFINITY },
      });
      expect(r.status).toBe(400);
    });

    it('uses current maxBodyBytes when not provided in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: {},
      });
      expect(r.status).toBe(200);
    });

    it('uses current enabled when not provided in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: {},
      });
      expect(r.status).toBe(200);
    });

    it('patches maxBodyBytes when provided', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: { maxBodyBytes: 262144 },
      });
      expect(r.status).toBe(200);
    });

    it('patches enabled when provided', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: { enabled: false },
      });
      expect(r.status).toBe(200);
    });

    it('rejects invalid verificationType in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: { verificationType: 'invalid-type' },
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'verificationType is invalid' });
    });

    it('rejects endpoint validation errors in patch', async () => {
      const ctx = createCtx();
      // Create endpoint with generic preset so validation detects change
      const endpoint = makeEndpoint({
        publisherPreset: 'slack',
        verificationType: 'slack-v0',
        signatureHeader: 'x-slack-signature',
      });
      (ctx.webhookEndpointStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(endpoint);

      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: { signatureHeader: '' },
      });
      expect(r.status).toBe(400);
      expect((r.body as Record<string, string>).error).toContain('signatureHeader');
    });

    it('deletes old secret when switching to verificationType none', async () => {
      const ctx = createCtx({ publisherPreset: 'generic' });
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: { publisherPreset: 'generic', verificationType: 'none' },
      });
      expect(r.status).toBe(200);
      expect(ctx.webhookSecretStore.deleteSecret).toHaveBeenCalledWith('secret:endpoint-1');
    });

    it('suppresses error when deleting old secret on switch to none', async () => {
      const ctx = createCtx({ publisherPreset: 'generic' });
      (ctx.webhookSecretStore.deleteSecret as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('delete failed'),
      );
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: { publisherPreset: 'generic', verificationType: 'none' },
      });
      // Should not throw, error is caught
      expect(r.status).toBe(200);
    });

    it('skips secret deletion when switching to none and no existing secretRef', async () => {
      const endpoint = makeEndpoint({
        publisherPreset: 'generic',
        secretRef: null,
        verificationType: 'hmac-sha256',
        signatureHeader: 'x-sig',
      });
      const ctx = createCtx({ publisherPreset: 'generic' });
      (ctx.webhookEndpointStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(endpoint);
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: { publisherPreset: 'generic', verificationType: 'none' },
      });
      expect(r.status).toBe(200);
      expect(ctx.webhookSecretStore.deleteSecret).not.toHaveBeenCalled();
    });

    it('returns 400 when keychain unavailable for non-none verificationType patch', async () => {
      const ctx = createCtx();
      (ctx.webhookSecretStore.isAvailable as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: {},
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'keychain_unavailable' });
    });

    it('sets user-provided secret on patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: { secret: 'new-secret' },
      });
      expect(r.status).toBe(200);
      expect(ctx.webhookSecretStore.setSecret).toHaveBeenCalledWith(
        'secret:endpoint-1',
        'new-secret',
      );
      const body = r.body as Record<string, unknown>;
      expect(body.secret).toBe('new-secret');
    });

    it('generates new secret when endpoint has no secretRef and no user secret provided', async () => {
      const endpoint = makeEndpoint({ secretRef: null });
      const ctx = createCtx();
      (ctx.webhookEndpointStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(endpoint);
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: {},
      });
      expect(r.status).toBe(200);
      expect(ctx.webhookSecretStore.generateSecret).toHaveBeenCalled();
      expect(ctx.webhookSecretStore.setSecret).toHaveBeenCalled();
      const body = r.body as Record<string, unknown>;
      expect(body.secret).toBe('generated-secret');
    });

    it('does not generate a new secret when endpoint already has secretRef and no user secret', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: {},
      });
      expect(r.status).toBe(200);
      expect(ctx.webhookSecretStore.generateSecret).not.toHaveBeenCalled();
      const body = r.body as Record<string, unknown>;
      expect(body.secret).toBeNull();
    });

    it('uses updatedAt for optimistic concurrency', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: { updatedAt: '2026-03-08T00:00:00.000Z', enabled: false },
      });
      expect(r.status).toBe(200);
      expect(ctx.webhookEndpointStore.update).toHaveBeenCalledWith(
        ENDPOINT_ID,
        expect.any(Object),
        '2026-03-08T00:00:00.000Z',
      );
    });

    it('returns 409 on StaleUpdateError', async () => {
      const ctx = createCtx();
      (ctx.webhookEndpointStore.update as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new StaleUpdateError('webhook_endpoints', '2026-03-08T00:00:00.000Z');
      });
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: { updatedAt: '2026-03-07T00:00:00.000Z' },
      });
      expect(r.status).toBe(409);
    });

    it('re-throws non-StaleUpdateError', async () => {
      const ctx = createCtx();
      (ctx.webhookEndpointStore.update as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('unexpected DB error');
      });
      await expect(
        invoke(ctx, {
          method: 'PATCH',
          path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
          body: {},
        }),
      ).rejects.toThrow('unexpected DB error');
    });

    it('handles updated being null after update', async () => {
      const ctx = createCtx();
      // Simulate getById returning null after update (edge case)
      let callCount = 0;
      (ctx.webhookEndpointStore.getById as ReturnType<typeof vi.fn>).mockImplementation(
        (id: string) => {
          callCount++;
          // First call: endpoint found (PATCH entry), second call: null (after update)
          if (callCount === 1 && id === ENDPOINT_ID) return makeEndpoint();
          return null;
        },
      );
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: {},
      });
      expect(r.status).toBe(200);
      const body = r.body as Record<string, unknown>;
      expect(body.data).toBeNull();
    });

    it('preserves current publisherPreset when not provided in patch', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PATCH',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
        body: { enabled: false },
      });
      expect(r.status).toBe(200);
    });
  });

  // ── DELETE /api/webhook-endpoints/:id ───────────────────────
  describe('DELETE /api/webhook-endpoints/:id', () => {
    it('deletes an endpoint and cleans up secret', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'DELETE',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(200);
      expect(ctx.webhookSecretStore.deleteSecret).toHaveBeenCalledWith('secret:endpoint-1');
      expect(ctx.webhookEndpointStore.delete).toHaveBeenCalledWith(ENDPOINT_ID);
      expect(ctx.eventRouter.reload).toHaveBeenCalled();
    });

    it('returns 404 when endpoint not found for delete', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'DELETE',
        path: `/api/webhook-endpoints/${UUID.missing}`,
      });
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: 'Endpoint not found' });
    });

    it('handles endpoint without secretRef on delete', async () => {
      const endpoint = makeEndpoint({ secretRef: null });
      const ctx = createCtx();
      (ctx.webhookEndpointStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(endpoint);
      const r = await invoke(ctx, {
        method: 'DELETE',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
      });
      expect(r.status).toBe(200);
      expect(ctx.webhookSecretStore.deleteSecret).not.toHaveBeenCalled();
    });

    it('suppresses deleteSecret errors during deletion', async () => {
      const ctx = createCtx();
      (ctx.webhookSecretStore.deleteSecret as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('delete failed'),
      );
      const r = await invoke(ctx, {
        method: 'DELETE',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
      });
      expect(r.status).toBe(200);
    });
  });

  // ── Unmatched routes ────────────────────────────────────────
  describe('unmatched routes', () => {
    it('returns false for unmatched method on base path', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PUT',
        path: '/api/webhook-endpoints',
      });
      expect(r.handled).toBe(false);
    });

    it('returns false for unmatched path', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'GET',
        path: '/api/something-else',
      });
      expect(r.handled).toBe(false);
    });

    it('returns false for PUT on specific endpoint', async () => {
      const ctx = createCtx();
      const r = await invoke(ctx, {
        method: 'PUT',
        path: `/api/webhook-endpoints/${ENDPOINT_ID}`,
      });
      expect(r.handled).toBe(false);
    });
  });
});
