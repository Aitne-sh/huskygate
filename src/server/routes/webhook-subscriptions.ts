/** @module server/routes/webhook-subscriptions — Event subscription CRUD handlers. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../../context/app-context.js';
import type {
  EventContextMapping,
  EventFilterDefinition,
  EventSubscription,
} from '../../event/types.js';
import {
  buildTriggerContext,
  evaluateEventFilter,
  parseContextMappingInput,
  parseEventFilterInput,
  parseStoredContextMappingResult,
  parseStoredEventFilterDefinitionResult,
} from '../../event/webhook-filter.js';
import { normalizeBool } from '../../queue/types.js';
import { json, readBody, readBodyBuffer } from '../../shared/http.js';
import {
  matchEventSubscriptionId,
  matchEventSubscriptionTest,
} from '../../shared/route-matchers.js';
import { StaleUpdateError } from '../../store/store-utils.js';
import { errorMessage } from '../../utils/error.js';
import {
  MAX_EVENT_SUBSCRIPTION_TEST_BODY_BYTES,
  eventSubscriptionConflictMessage,
  normalizeNullableString,
  normalizeSubscriptionTargets,
  refreshRouter,
  validateSubscriptionShape,
  validateSubscriptionTargets,
} from './webhook-shared.js';

export async function handleSubscriptionRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  // ── Event Subscription routes ──────────────────────────────────────────────

  if (req.method === 'GET' && pathname === '/api/event-subscriptions') {
    json(res, 200, { ok: true, data: ctx.eventSubscriptionStore.list() });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/event-subscriptions') {
    const body = await readBody(req);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    const targetType = parsed.targetType;
    if (
      targetType !== 'orchestrator' &&
      targetType !== 'triggered_task' &&
      targetType !== 'triggered_node'
    ) {
      json(res, 400, { error: 'targetType is invalid' });
      return true;
    }
    const endpoint = normalizeNullableString(parsed.endpointId);
    if (!endpoint || !ctx.webhookEndpointStore.getById(endpoint)) {
      json(res, 400, { error: 'endpointId not found' });
      return true;
    }

    const filterInput = parseEventFilterInput(
      (parsed.filterJson ?? parsed.filter) as EventFilterDefinition | string | undefined,
    );
    if (filterInput.error) {
      json(res, 400, { error: filterInput.error });
      return true;
    }
    const mappingInput = parseContextMappingInput(
      (parsed.contextMappingJson ?? parsed.contextMapping) as
        | EventContextMapping
        | string
        | undefined,
    );
    if (mappingInput.error) {
      json(res, 400, { error: mappingInput.error });
      return true;
    }

    const subscriptionShape: Partial<EventSubscription> = {
      endpointId: endpoint,
      targetType,
      orchestratorId: normalizeNullableString(parsed.orchestratorId),
      triggeredTaskId: normalizeNullableString(parsed.triggeredTaskId),
      nodeId: normalizeNullableString(parsed.nodeId),
    };
    const normalizedTargets = normalizeSubscriptionTargets(subscriptionShape);
    const shapeError = validateSubscriptionShape(normalizedTargets);
    if (shapeError) {
      json(res, 400, { error: shapeError });
      return true;
    }
    const targetError = validateSubscriptionTargets(ctx, normalizedTargets);
    if (targetError) {
      json(res, 400, { error: targetError });
      return true;
    }

    try {
      const created = ctx.eventSubscriptionStore.create({
        endpointId: endpoint,
        targetType,
        orchestratorId: normalizedTargets.orchestratorId ?? null,
        triggeredTaskId: normalizedTargets.triggeredTaskId ?? null,
        nodeId: normalizedTargets.nodeId ?? null,
        filterJson: filterInput.serialized,
        contextMappingJson: mappingInput.serialized,
        enabled: normalizeBool(parsed.enabled, true),
      });
      await refreshRouter(ctx);
      json(res, 201, { ok: true, data: created });
      return true;
    } catch (err) {
      const msg = errorMessage(err);
      const conflict = eventSubscriptionConflictMessage(msg);
      if (conflict) {
        json(res, 409, { error: conflict });
        return true;
      }
      throw err;
    }
  }

  const subscriptionId = matchEventSubscriptionId(pathname);
  if (subscriptionId && req.method === 'PATCH') {
    const current = ctx.eventSubscriptionStore.getById(subscriptionId);
    if (!current) {
      json(res, 404, { error: 'Subscription not found' });
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

    const nextTargetType = parsed.targetType !== undefined ? parsed.targetType : current.targetType;
    if (
      nextTargetType !== 'orchestrator' &&
      nextTargetType !== 'triggered_task' &&
      nextTargetType !== 'triggered_node'
    ) {
      json(res, 400, { error: 'targetType is invalid' });
      return true;
    }
    const patch: Partial<EventSubscription> = {
      endpointId:
        parsed.endpointId !== undefined
          ? typeof parsed.endpointId === 'string' && parsed.endpointId.trim()
            ? parsed.endpointId.trim()
            : undefined
          : current.endpointId,
      targetType: nextTargetType,
      orchestratorId:
        parsed.orchestratorId !== undefined
          ? normalizeNullableString(parsed.orchestratorId)
          : current.orchestratorId,
      triggeredTaskId:
        parsed.triggeredTaskId !== undefined
          ? normalizeNullableString(parsed.triggeredTaskId)
          : current.triggeredTaskId,
      nodeId: parsed.nodeId !== undefined ? normalizeNullableString(parsed.nodeId) : current.nodeId,
      enabled: parsed.enabled !== undefined ? normalizeBool(parsed.enabled, true) : current.enabled,
    };
    if (!patch.endpointId || !ctx.webhookEndpointStore.getById(patch.endpointId)) {
      json(res, 400, { error: 'endpointId not found' });
      return true;
    }
    let normalizedPatch = normalizeSubscriptionTargets(patch);
    const shapeError = validateSubscriptionShape(normalizedPatch);
    if (shapeError) {
      json(res, 400, { error: shapeError });
      return true;
    }

    const targetError = validateSubscriptionTargets(ctx, normalizedPatch);
    if (targetError) {
      json(res, 400, { error: targetError });
      return true;
    }

    const filterRaw =
      parsed.filterJson !== undefined || parsed.filter !== undefined
        ? (parsed.filterJson ?? parsed.filter)
        : undefined;
    const mappingRaw =
      parsed.contextMappingJson !== undefined || parsed.contextMapping !== undefined
        ? (parsed.contextMappingJson ?? parsed.contextMapping)
        : undefined;
    if (filterRaw !== undefined) {
      const filterInput = parseEventFilterInput(filterRaw);
      if (filterInput.error) {
        json(res, 400, { error: filterInput.error });
        return true;
      }
      patch.filterJson = filterInput.serialized;
    }
    if (mappingRaw !== undefined) {
      const mappingInput = parseContextMappingInput(mappingRaw);
      if (mappingInput.error) {
        json(res, 400, { error: mappingInput.error });
        return true;
      }
      patch.contextMappingJson = mappingInput.serialized;
    }
    normalizedPatch = normalizeSubscriptionTargets(patch);

    try {
      const expectedUpdatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined;
      ctx.eventSubscriptionStore.update(subscriptionId, normalizedPatch, expectedUpdatedAt);
      await refreshRouter(ctx);
      json(res, 200, { ok: true, data: ctx.eventSubscriptionStore.getById(subscriptionId) });
      return true;
    } catch (err) {
      if (err instanceof StaleUpdateError) {
        json(res, 409, { error: err.message });
        return true;
      }
      const conflict = eventSubscriptionConflictMessage(errorMessage(err));
      if (conflict) {
        json(res, 409, { error: conflict });
        return true;
      }
      throw err;
    }
  }

  if (subscriptionId && req.method === 'DELETE') {
    const current = ctx.eventSubscriptionStore.getById(subscriptionId);
    if (!current) {
      json(res, 404, { error: 'Subscription not found' });
      return true;
    }
    ctx.eventSubscriptionStore.delete(subscriptionId);
    await refreshRouter(ctx);
    json(res, 200, { ok: true });
    return true;
  }

  const subscriptionTestId = matchEventSubscriptionTest(pathname);
  if (subscriptionTestId && req.method === 'POST') {
    const current = ctx.eventSubscriptionStore.getById(subscriptionTestId);
    if (!current) {
      json(res, 404, { error: 'Subscription not found' });
      return true;
    }
    let body: string;
    try {
      body = (await readBodyBuffer(req, MAX_EVENT_SUBSCRIPTION_TEST_BODY_BYTES)).toString('utf-8');
    } catch (err) {
      json(res, 413, { error: errorMessage(err) });
      return true;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    const envelope = {
      _trigger:
        parsed._trigger && typeof parsed._trigger === 'object' && !Array.isArray(parsed._trigger)
          ? parsed._trigger
          : { publisher: 'generic', event: null, deliveryId: null },
      body:
        parsed.body && typeof parsed.body === 'object' && !Array.isArray(parsed.body)
          ? parsed.body
          : {},
      headers:
        parsed.headers && typeof parsed.headers === 'object' && !Array.isArray(parsed.headers)
          ? Object.fromEntries(
              Object.entries(parsed.headers as Record<string, unknown>)
                .filter(([, v]) => typeof v === 'string')
                .map(([k, v]) => [k.toLowerCase(), v]),
            )
          : {},
    } as Record<string, unknown>;
    const filter = parseStoredEventFilterDefinitionResult(current.filterJson);
    if (filter.error) {
      json(res, 400, { error: filter.error });
      return true;
    }
    const mapping = parseStoredContextMappingResult(current.contextMappingJson);
    if (mapping.error) {
      json(res, 400, { error: mapping.error });
      return true;
    }
    const matched = evaluateEventFilter(filter.value, envelope);
    const triggerContext = matched ? buildTriggerContext(mapping.value, envelope) : null;
    json(res, 200, {
      ok: true,
      matched,
      triggerContext,
    });
    return true;
  }

  return false;
}
