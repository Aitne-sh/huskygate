/** @module server/routes/webhook-endpoints — Webhook endpoint CRUD handlers. */
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../../context/app-context.js';
import type { PublisherPreset } from '../../event/types.js';
import { normalizeBool } from '../../queue/types.js';
import { json, readBody } from '../../shared/http.js';
import { matchWebhookEndpointId } from '../../shared/route-matchers.js';
import { StaleUpdateError } from '../../store/store-utils.js';
import { logger } from '../../utils/logger.js';
import {
  MAX_WEBHOOK_BODY_BYTES,
  MIN_WEBHOOK_BODY_BYTES,
  applyPresetDefaults,
  buildEndpointResponse,
  isPublisherPreset,
  isVerificationType,
  normalizeNullableString,
  refreshRouter,
  validateEndpointPatch,
} from './webhook-shared.js';

export async function handleEndpointRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (req.method === 'GET' && pathname === '/api/webhook-endpoints') {
    json(res, 200, {
      ok: true,
      data: ctx.webhookEndpointStore.list().map((endpoint) => buildEndpointResponse(ctx, endpoint)),
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/webhook-endpoints') {
    const body = await readBody(req);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }

    const presetId = parsed.publisherPreset;
    if (presetId !== undefined && !isPublisherPreset(presetId)) {
      json(res, 400, { error: 'publisherPreset must be generic, github, slack, or jira' });
      return true;
    }
    const publisherPreset = (presetId as PublisherPreset | undefined) ?? 'generic';
    const patch = applyPresetDefaults(publisherPreset, parsed);
    patch.maxBodyBytes =
      typeof parsed.maxBodyBytes === 'number' ? Math.floor(parsed.maxBodyBytes) : 262144;
    patch.enabled = normalizeBool(parsed.enabled, true);

    if (!isVerificationType(patch.verificationType)) {
      json(res, 400, { error: 'verificationType is invalid' });
      return true;
    }
    const endpointValidationError = validateEndpointPatch(patch);
    if (endpointValidationError) {
      json(res, 400, { error: endpointValidationError });
      return true;
    }

    const id = crypto.randomUUID();
    let revealedSecret: string | null = null;
    try {
      if (patch.verificationType !== 'none') {
        if (!(await ctx.webhookSecretStore.isAvailable())) {
          json(res, 400, { error: 'keychain_unavailable' });
          return true;
        }
        const secret =
          normalizeNullableString(parsed.secret) ?? ctx.webhookSecretStore.generateSecret();
        const secretRef = ctx.webhookSecretStore.buildSecretRef(id);
        await ctx.webhookSecretStore.setSecret(secretRef, secret);
        patch.secretRef = secretRef;
        revealedSecret = secret;
      } else {
        patch.secretRef = null;
      }

      const endpoint = ctx.webhookEndpointStore.create({
        id,
        publisherPreset,
        verificationType: patch.verificationType,
        signatureHeader: patch.signatureHeader ?? null,
        signaturePrefix: patch.signaturePrefix ?? null,
        deliveryIdHeader: patch.deliveryIdHeader ?? null,
        eventNameHeader: patch.eventNameHeader ?? null,
        secretRef: patch.secretRef ?? null,
        maxBodyBytes: patch.maxBodyBytes ?? 262144,
        enabled: patch.enabled ?? true,
      });
      if (!ctx.config.webhookPublicBaseUrl) {
        logger.debug('webhook_endpoint_created_without_public_base_url', {
          endpointId: id,
          hint: 'Set WEBHOOK_PUBLIC_BASE_URL for API publicUrl field, or configure the URL in the dashboard Webhooks page',
        });
      }
      await refreshRouter(ctx);
      json(res, 201, {
        ok: true,
        data: buildEndpointResponse(ctx, endpoint),
        secret: revealedSecret,
      });
      return true;
    } catch (err) {
      if (patch.secretRef) {
        await ctx.webhookSecretStore.deleteSecret(patch.secretRef).catch(() => false);
      }
      throw err;
    }
  }

  const endpointId = matchWebhookEndpointId(pathname);
  if (endpointId && req.method === 'GET') {
    const endpoint = ctx.webhookEndpointStore.getById(endpointId);
    if (!endpoint) {
      json(res, 404, { error: 'Endpoint not found' });
      return true;
    }
    json(res, 200, { ok: true, data: buildEndpointResponse(ctx, endpoint) });
    return true;
  }

  if (endpointId && req.method === 'PATCH') {
    const endpoint = ctx.webhookEndpointStore.getById(endpointId);
    if (!endpoint) {
      json(res, 404, { error: 'Endpoint not found' });
      return true;
    }
    const body = await readBody(req);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }

    const nextPreset =
      parsed.publisherPreset !== undefined ? parsed.publisherPreset : endpoint.publisherPreset;
    if (!isPublisherPreset(nextPreset)) {
      json(res, 400, { error: 'publisherPreset must be generic, github, slack, or jira' });
      return true;
    }
    const patch = applyPresetDefaults(nextPreset, parsed, endpoint);
    if (parsed.maxBodyBytes !== undefined) {
      if (typeof parsed.maxBodyBytes !== 'number' || !Number.isFinite(parsed.maxBodyBytes)) {
        json(res, 400, {
          error: `maxBodyBytes must be between ${MIN_WEBHOOK_BODY_BYTES} and ${MAX_WEBHOOK_BODY_BYTES}`,
        });
        return true;
      }
      patch.maxBodyBytes = Math.floor(parsed.maxBodyBytes);
    } else {
      patch.maxBodyBytes = endpoint.maxBodyBytes;
    }
    if (parsed.enabled !== undefined) {
      patch.enabled = normalizeBool(parsed.enabled, true);
    } else {
      patch.enabled = endpoint.enabled;
    }
    const verificationType = patch.verificationType ?? endpoint.verificationType;
    if (!isVerificationType(verificationType)) {
      json(res, 400, { error: 'verificationType is invalid' });
      return true;
    }
    patch.verificationType = verificationType;
    const endpointValidationError = validateEndpointPatch(patch);
    if (endpointValidationError) {
      json(res, 400, { error: endpointValidationError });
      return true;
    }

    let revealedSecret: string | null = null;
    const requestedSecret = normalizeNullableString(parsed.secret);
    if (verificationType === 'none') {
      if (endpoint.secretRef) {
        await ctx.webhookSecretStore.deleteSecret(endpoint.secretRef).catch(() => false);
      }
      patch.secretRef = null;
    } else {
      if (!(await ctx.webhookSecretStore.isAvailable())) {
        json(res, 400, { error: 'keychain_unavailable' });
        return true;
      }
      const secretRef = endpoint.secretRef ?? ctx.webhookSecretStore.buildSecretRef(endpoint.id);
      if (requestedSecret) {
        await ctx.webhookSecretStore.setSecret(secretRef, requestedSecret);
        revealedSecret = requestedSecret;
      } else if (!endpoint.secretRef) {
        const generated = ctx.webhookSecretStore.generateSecret();
        await ctx.webhookSecretStore.setSecret(secretRef, generated);
        revealedSecret = generated;
      }
      patch.secretRef = secretRef;
    }

    try {
      const expectedUpdatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined;
      ctx.webhookEndpointStore.update(endpointId, patch, expectedUpdatedAt);
      const updated = ctx.webhookEndpointStore.getById(endpointId);
      await refreshRouter(ctx);
      json(res, 200, {
        ok: true,
        data: updated ? buildEndpointResponse(ctx, updated) : null,
        secret: revealedSecret,
      });
      return true;
    } catch (err) {
      if (err instanceof StaleUpdateError) {
        json(res, 409, { error: err.message });
        return true;
      }
      throw err;
    }
  }

  if (endpointId && req.method === 'DELETE') {
    const endpoint = ctx.webhookEndpointStore.getById(endpointId);
    if (!endpoint) {
      json(res, 404, { error: 'Endpoint not found' });
      return true;
    }
    if (endpoint.secretRef) {
      await ctx.webhookSecretStore.deleteSecret(endpoint.secretRef).catch(() => false);
    }
    ctx.webhookEndpointStore.delete(endpointId);
    await refreshRouter(ctx);
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
