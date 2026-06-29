/** @module event/event-router — Webhook ingestion, signature verification, and subscription dispatch. */
import crypto from 'node:crypto';
import type { OrchestratorEngine } from '../orchestrator/engine.js';
import { SIZE_LIMITS, TTLS } from '../shared/constants.js';
import { timingSafeEqualString } from '../shared/security.js';
import type { EventSubscriptionStore } from '../store/event-subscription.js';
import type { WebhookDeliveryStore } from '../store/webhook-delivery.js';
import type { WebhookEndpointStore } from '../store/webhook-endpoint.js';
import { errorMessage } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import type { TriggeredTaskExecutor } from './triggered-task-executor.js';
import type {
  EventMetadata,
  EventSubscription,
  TriggerEnvelope,
  VerificationType,
  WebhookEndpoint,
} from './types.js';
import {
  buildTriggerContext,
  evaluateEventFilter,
  parseStoredContextMappingResult,
  parseStoredEventFilterDefinitionResult,
} from './webhook-filter.js';
import type { WebhookSecretStore } from './webhook-secret-store.js';

const DELIVERY_TTL_MS = TTLS.eventDelivery;
const MAX_TRIGGER_CONTEXT_BYTES = SIZE_LIMITS.maxTriggerContext;
const SLACK_TIMESTAMP_HEADER = 'x-slack-request-timestamp';
const SLACK_TIMESTAMP_MAX_AGE_S = TTLS.slackTimestampMaxAgeSec;

export class WebhookDispatchError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.error ?? 'webhook_dispatch_error'));
  }
}

interface ActiveTriggeredWaiter {
  runId: string;
  nodeId: string;
  subscriptionId: string;
  onEvent: (payload: Record<string, unknown> | null) => void;
  onTimeout: () => void;
}

interface EventRouterDeps {
  webhookEndpointStore: WebhookEndpointStore;
  eventSubscriptionStore: EventSubscriptionStore;
  webhookSecretStore: WebhookSecretStore;
  webhookDeliveryStore: WebhookDeliveryStore;
  orchestratorEngine: OrchestratorEngine;
  triggeredTaskExecutor: TriggeredTaskExecutor;
}

interface PreparedDispatch {
  subscription: EventSubscription;
  triggerContext: Record<string, unknown> | null;
}

interface DeliveryState {
  updatedAt: number;
  completed: boolean;
  dispatching: boolean;
  successfulSubscriptionIds: Set<string>;
}

export interface WebhookDispatchResult {
  ok: true;
  endpointId: string;
  duplicate: boolean;
  matchedSubscriptions: number;
  dispatched: number;
  skipped: number;
  /** Slack url_verification challenge — route handler must return this with HTTP 200 */
  challenge?: string;
}

function normalizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      normalized[key.toLowerCase()] = value;
    } else if (Array.isArray(value) && value.length > 0) {
      normalized[key.toLowerCase()] = value.join(', ');
    }
  }
  return normalized;
}

function ensureObjectBody(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new WebhookDispatchError(400, { error: 'invalid_json' });
  }
  return payload as Record<string, unknown>;
}

function computeHmac(
  algorithm: Extract<VerificationType, 'hmac-sha256' | 'hmac-sha1'>,
  secret: string,
  rawBody: Buffer,
): string {
  const algo = algorithm === 'hmac-sha1' ? 'sha1' : 'sha256';
  return crypto.createHmac(algo, secret).update(rawBody).digest('hex');
}

function ensureTriggerContextSize(triggerContext: Record<string, unknown> | null): void {
  if (!triggerContext) return;
  const size = Buffer.byteLength(JSON.stringify(triggerContext), 'utf-8');
  if (size > MAX_TRIGGER_CONTEXT_BYTES) {
    throw new WebhookDispatchError(400, {
      error: 'trigger_context_too_large',
      maxBytes: MAX_TRIGGER_CONTEXT_BYTES,
    });
  }
}

/** Routes incoming webhook payloads to matching subscriptions (orchestrators, triggered tasks, triggered nodes). */
export class EventRouter {
  private endpointsByToken = new Map<string, WebhookEndpoint>();
  private subscriptionsByEndpointId = new Map<string, EventSubscription[]>();
  private triggeredNodeSubscriptionsByNodeId = new Map<string, EventSubscription>();
  private activeWaitersBySubscriptionId = new Map<string, Map<string, ActiveTriggeredWaiter>>();
  private recentDeliveries = new Map<string, DeliveryState>();

  constructor(private readonly deps: EventRouterDeps) {}

  async reload(): Promise<void> {
    const endpoints = this.deps.webhookEndpointStore.list();
    const subscriptions = this.deps.eventSubscriptionStore.list();
    this.endpointsByToken = new Map(endpoints.map((endpoint) => [endpoint.token, endpoint]));
    this.subscriptionsByEndpointId = new Map();
    this.triggeredNodeSubscriptionsByNodeId = new Map();
    const activeSubscriptionIds = new Set<string>();
    for (const subscription of subscriptions) {
      activeSubscriptionIds.add(subscription.id);
      const bucket = this.subscriptionsByEndpointId.get(subscription.endpointId) ?? [];
      bucket.push(subscription);
      this.subscriptionsByEndpointId.set(subscription.endpointId, bucket);
      if (
        subscription.enabled &&
        subscription.targetType === 'triggered_node' &&
        subscription.nodeId
      ) {
        this.triggeredNodeSubscriptionsByNodeId.set(subscription.nodeId, subscription);
      }
    }

    // Prune orphaned waiters whose subscriptions no longer exist
    for (const subscriptionId of this.activeWaitersBySubscriptionId.keys()) {
      if (!activeSubscriptionIds.has(subscriptionId)) {
        const waiters = this.activeWaitersBySubscriptionId.get(subscriptionId);
        if (waiters) {
          for (const waiter of waiters.values()) {
            try {
              waiter.onTimeout();
            } catch (err) {
              logger.warn('orphaned_waiter_timeout_failed', {
                subscriptionId,
                runId: waiter.runId,
                nodeId: waiter.nodeId,
                error: errorMessage(err),
              });
            }
          }
        }
        this.activeWaitersBySubscriptionId.delete(subscriptionId);
      }
    }
  }

  getEndpointByToken(token: string): WebhookEndpoint | null {
    return this.endpointsByToken.get(token) ?? null;
  }

  getTriggeredNodeSubscription(nodeId: string): EventSubscription | null {
    return this.triggeredNodeSubscriptionsByNodeId.get(nodeId) ?? null;
  }

  registerTriggeredWaiter(
    subscriptionId: string,
    waiterKey: string,
    waiter: ActiveTriggeredWaiter,
  ): () => void {
    const bucket = this.activeWaitersBySubscriptionId.get(subscriptionId) ?? new Map();
    bucket.set(waiterKey, waiter);
    this.activeWaitersBySubscriptionId.set(subscriptionId, bucket);
    return () => {
      const current = this.activeWaitersBySubscriptionId.get(subscriptionId);
      if (!current) return;
      current.delete(waiterKey);
      if (current.size === 0) {
        this.activeWaitersBySubscriptionId.delete(subscriptionId);
      }
    };
  }

  async dispatchWebhook(
    endpoint: WebhookEndpoint,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    sourceIp?: string,
  ): Promise<WebhookDispatchResult> {
    if (!endpoint.enabled) {
      throw new WebhookDispatchError(404, { error: 'endpoint_not_found' });
    }

    const normalizedHeaders = normalizeHeaders(headers);
    await this.verifyEndpoint(endpoint, rawBody, normalizedHeaders);

    let parsedBody: Record<string, unknown>;
    try {
      parsedBody = ensureObjectBody(JSON.parse(rawBody.toString('utf-8')));
    } catch (err) {
      if (err instanceof WebhookDispatchError) throw err;
      throw new WebhookDispatchError(400, { error: 'invalid_json' });
    }

    // Slack URL verification challenge — must respond with the challenge value before dispatch
    if (
      endpoint.publisherPreset === 'slack' &&
      parsedBody.type === 'url_verification' &&
      typeof parsedBody.challenge === 'string' &&
      parsedBody.challenge.length <= 256
    ) {
      return {
        ok: true,
        endpointId: endpoint.id,
        duplicate: false,
        matchedSubscriptions: 0,
        dispatched: 0,
        skipped: 0,
        challenge: parsedBody.challenge as string,
      };
    }

    const eventName = endpoint.eventNameHeader
      ? (normalizedHeaders[endpoint.eventNameHeader.toLowerCase()] ?? null)
      : null;
    const deliveryId = endpoint.deliveryIdHeader
      ? (normalizedHeaders[endpoint.deliveryIdHeader.toLowerCase()] ?? null)
      : null;
    const metadata: EventMetadata = {
      deliveryId: deliveryId ?? undefined,
      sourceIp,
      headers: normalizedHeaders,
    };

    let deliveryState: DeliveryState | null = null;
    if (metadata.deliveryId) {
      this.pruneRecentDeliveries();
      const deliveryKey = `${endpoint.id}:${metadata.deliveryId}`;

      // L1: in-memory check (same-process fast path)
      const currentState = this.recentDeliveries.get(deliveryKey);
      if (currentState?.completed || currentState?.dispatching) {
        return {
          ok: true,
          endpointId: endpoint.id,
          duplicate: true,
          matchedSubscriptions: 0,
          dispatched: 0,
          skipped: 0,
        };
      }

      // L2: DB check (survives restarts, works across instances)
      const dbClaim = this.deps.webhookDeliveryStore.tryClaimDelivery(
        endpoint.id,
        metadata.deliveryId,
      );
      if (dbClaim.result === 'duplicate') {
        // Populate in-memory cache so future checks skip DB
        this.recentDeliveries.set(deliveryKey, {
          updatedAt: Date.now(),
          completed: true,
          dispatching: false,
          successfulSubscriptionIds: new Set(dbClaim.successfulSubIds),
        });
        return {
          ok: true,
          endpointId: endpoint.id,
          duplicate: true,
          matchedSubscriptions: 0,
          dispatched: 0,
          skipped: 0,
        };
      }

      // claimed or retry — proceed with dispatch
      deliveryState = currentState ?? {
        updatedAt: Date.now(),
        completed: false,
        dispatching: false,
        successfulSubscriptionIds: new Set(dbClaim.successfulSubIds),
      };
      deliveryState.dispatching = true;
      this.recentDeliveries.set(deliveryKey, deliveryState);
    }

    try {
      const envelope: TriggerEnvelope = {
        _trigger: {
          publisher: endpoint.publisherPreset,
          event: eventName,
          deliveryId,
        },
        body: parsedBody,
        headers: normalizedHeaders,
      };
      const subscriptions = (this.subscriptionsByEndpointId.get(endpoint.id) ?? []).filter(
        (subscription) => subscription.enabled,
      );
      const prepared: PreparedDispatch[] = [];
      for (const subscription of subscriptions) {
        const filter = parseStoredEventFilterDefinitionResult(subscription.filterJson);
        if (filter.error) {
          logger.warn('event_router_invalid_subscription_filter', {
            subscriptionId: subscription.id,
            targetType: subscription.targetType,
            error: filter.error,
          });
          continue;
        }
        if (!evaluateEventFilter(filter.value, envelope)) continue;
        const mapping = parseStoredContextMappingResult(subscription.contextMappingJson);
        if (mapping.error) {
          logger.warn('event_router_invalid_subscription_context_mapping', {
            subscriptionId: subscription.id,
            targetType: subscription.targetType,
            error: mapping.error,
          });
          continue;
        }
        try {
          const context = buildTriggerContext(mapping.value, envelope);
          ensureTriggerContextSize(context);
          prepared.push({ subscription, triggerContext: context });
        } catch (err) {
          logger.warn('event_router_prepare_subscription_skipped', {
            subscriptionId: subscription.id,
            targetType: subscription.targetType,
            error: errorMessage(err),
          });
        }
      }

      let dispatched = 0;
      let skipped = 0;
      let failed = 0;
      for (const item of prepared) {
        if (deliveryState?.successfulSubscriptionIds.has(item.subscription.id)) {
          skipped++;
          continue;
        }
        try {
          if (item.subscription.targetType === 'orchestrator' && item.subscription.orchestratorId) {
            await this.deps.orchestratorEngine.startRun(
              item.subscription.orchestratorId,
              'webhook',
              { triggerContext: item.triggerContext ?? undefined },
            );
            deliveryState?.successfulSubscriptionIds.add(item.subscription.id);
            dispatched++;
            continue;
          }
          if (
            item.subscription.targetType === 'triggered_task' &&
            item.subscription.triggeredTaskId
          ) {
            const result = await this.deps.triggeredTaskExecutor.execute(
              item.subscription.triggeredTaskId,
              'webhook',
              item.triggerContext,
            );
            if (result.dispatched) {
              deliveryState?.successfulSubscriptionIds.add(item.subscription.id);
              dispatched++;
            } else if (result.reason === 'setup_failed' || result.reason === 'enqueue_failed') {
              throw new Error(`Triggered task dispatch failed: ${result.reason}`);
            } else {
              skipped++;
            }
            continue;
          }
          if (item.subscription.targetType === 'triggered_node') {
            const waiters = this.activeWaitersBySubscriptionId.get(item.subscription.id);
            if (!waiters || waiters.size === 0) {
              skipped++;
              continue;
            }
            const callbacks = [...waiters.values()];
            for (const waiter of callbacks) {
              try {
                waiter.onEvent(item.triggerContext);
              } catch (err) {
                logger.warn('triggered_waiter_callback_failed', {
                  runId: waiter.runId,
                  nodeId: waiter.nodeId,
                  error: errorMessage(err),
                });
              }
            }
            deliveryState?.successfulSubscriptionIds.add(item.subscription.id);
            dispatched += callbacks.length;
          }
        } catch (err) {
          logger.error('event_router_dispatch_failed', {
            subscriptionId: item.subscription.id,
            targetType: item.subscription.targetType,
            error: errorMessage(err),
          });
          failed++;
          skipped++;
        }
      }

      if (failed > 0) {
        if (deliveryState && metadata.deliveryId) {
          deliveryState.updatedAt = Date.now();
          this.deps.webhookDeliveryStore.markPartial(endpoint.id, metadata.deliveryId, [
            ...deliveryState.successfulSubscriptionIds,
          ]);
        }
        throw new WebhookDispatchError(503, {
          error: 'dispatch_failed',
          endpointId: endpoint.id,
          matchedSubscriptions: prepared.length,
          dispatched,
          skipped,
          failed,
        });
      }

      if (deliveryState && metadata.deliveryId) {
        deliveryState.completed = true;
        deliveryState.updatedAt = Date.now();
        this.deps.webhookDeliveryStore.markCompleted(endpoint.id, metadata.deliveryId, [
          ...deliveryState.successfulSubscriptionIds,
        ]);
      }

      return {
        ok: true,
        endpointId: endpoint.id,
        duplicate: false,
        matchedSubscriptions: prepared.length,
        dispatched,
        skipped,
      };
    } finally {
      if (deliveryState) {
        deliveryState.dispatching = false;
      }
    }
  }

  private async verifyEndpoint(
    endpoint: WebhookEndpoint,
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<void> {
    if (endpoint.verificationType === 'none') return;

    const secretRef = endpoint.secretRef;
    if (!secretRef) {
      throw new WebhookDispatchError(500, { error: 'endpoint_secret_missing' });
    }
    const secret = await this.deps.webhookSecretStore.getSecret(secretRef);
    if (!secret) {
      throw new WebhookDispatchError(500, { error: 'endpoint_secret_missing' });
    }

    if (endpoint.verificationType === 'bearer') {
      const headerName = (endpoint.signatureHeader ?? 'authorization').toLowerCase();
      const actual = headers[headerName];
      const expected = `${endpoint.signaturePrefix ?? 'Bearer '}${secret}`;
      if (!actual || !timingSafeEqualString(actual, expected)) {
        throw new WebhookDispatchError(401, { error: 'invalid_signature' });
      }
      return;
    }

    if (endpoint.verificationType === 'slack-v0') {
      const headerName = (endpoint.signatureHeader ?? 'x-slack-signature').toLowerCase();
      const actual = headers[headerName];
      if (!actual) {
        throw new WebhookDispatchError(401, { error: 'invalid_signature' });
      }
      const timestamp = headers[SLACK_TIMESTAMP_HEADER];
      if (!timestamp) {
        throw new WebhookDispatchError(401, { error: 'missing_timestamp' });
      }
      const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
      if (Number.isNaN(age) || age > SLACK_TIMESTAMP_MAX_AGE_S) {
        throw new WebhookDispatchError(401, { error: 'timestamp_expired' });
      }
      const baseString = `v0:${timestamp}:${rawBody.toString('utf-8')}`;
      const digest = crypto.createHmac('sha256', secret).update(baseString).digest('hex');
      const expected = `${endpoint.signaturePrefix ?? 'v0='}${digest}`;
      if (!timingSafeEqualString(actual, expected)) {
        throw new WebhookDispatchError(401, { error: 'invalid_signature' });
      }
      return;
    }

    const headerName = endpoint.signatureHeader?.toLowerCase();
    if (!headerName) {
      throw new WebhookDispatchError(500, { error: 'signature_header_missing' });
    }
    const actual = headers[headerName];
    if (!actual) {
      throw new WebhookDispatchError(401, { error: 'invalid_signature' });
    }
    const digest = computeHmac(endpoint.verificationType, secret, rawBody);
    const expected = `${endpoint.signaturePrefix ?? ''}${digest}`;
    if (!timingSafeEqualString(actual, expected)) {
      throw new WebhookDispatchError(401, { error: 'invalid_signature' });
    }
  }

  private pruneRecentDeliveries(): void {
    const cutoff = Date.now() - DELIVERY_TTL_MS;
    for (const [key, delivery] of this.recentDeliveries) {
      if (delivery.updatedAt < cutoff) this.recentDeliveries.delete(key);
    }
  }
}
