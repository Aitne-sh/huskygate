/** @module server/routes/webhook-shared — Shared helpers, constants, and validators for webhook API routes. */
import type { AppContext } from '../../context/app-context.js';
import { getPublisherPreset } from '../../event/publisher-presets.js';
import type {
  EventSubscription,
  PublisherPreset,
  VerificationType,
  WebhookEndpoint,
} from '../../event/types.js';
import { SIZE_LIMITS } from '../../shared/constants.js';
import { PublisherPresetSchema, VerificationTypeSchema } from '../../shared/schemas/common.js';
import { errorMessage } from '../../utils/error.js';

// ── Constants ──────────────────────────────────────────────────────────────────

export const MIN_WEBHOOK_BODY_BYTES = SIZE_LIMITS.minWebhookBody;
export const MAX_WEBHOOK_BODY_BYTES = SIZE_LIMITS.maxWebhookBody;
export const MAX_EVENT_SUBSCRIPTION_TEST_BODY_BYTES = SIZE_LIMITS.maxEventSubTestBody;

// ── Helper functions ───────────────────────────────────────────────────────────

export function endpointPath(token: string): string {
  return `/webhooks/${token}`;
}

export function buildEndpointResponse(
  ctx: AppContext,
  endpoint: WebhookEndpoint,
): Record<string, unknown> {
  const path = endpointPath(endpoint.token);
  const baseUrl = ctx.config.webhookPublicBaseUrl;
  return {
    ...endpoint,
    path,
    publicUrl: baseUrl ? new URL(path, baseUrl).toString() : null,
    publicUrlConfigured: baseUrl != null,
  };
}

export function isPublisherPreset(value: unknown): value is PublisherPreset {
  return PublisherPresetSchema.safeParse(value).success;
}

export function isVerificationType(value: unknown): value is VerificationType {
  return VerificationTypeSchema.safeParse(value).success;
}

export function applyPresetDefaults(
  presetId: PublisherPreset,
  parsed: Record<string, unknown>,
  current?: WebhookEndpoint,
): Partial<WebhookEndpoint> {
  const preset = getPublisherPreset(presetId);
  return {
    publisherPreset: presetId,
    verificationType:
      parsed.verificationType !== undefined
        ? (parsed.verificationType as VerificationType)
        : current
          ? current.verificationType
          : preset.verificationType,
    signatureHeader:
      parsed.signatureHeader !== undefined
        ? normalizeNullableString(parsed.signatureHeader)
        : current?.publisherPreset !== presetId
          ? preset.signatureHeader
          : current.signatureHeader,
    signaturePrefix:
      parsed.signaturePrefix !== undefined
        ? normalizeNullableString(parsed.signaturePrefix)
        : current?.publisherPreset !== presetId
          ? preset.signaturePrefix
          : (current?.signaturePrefix ?? null),
    deliveryIdHeader:
      parsed.deliveryIdHeader !== undefined
        ? normalizeNullableString(parsed.deliveryIdHeader)
        : current?.publisherPreset !== presetId
          ? preset.deliveryIdHeader
          : (current?.deliveryIdHeader ?? null),
    eventNameHeader:
      parsed.eventNameHeader !== undefined
        ? normalizeNullableString(parsed.eventNameHeader)
        : current?.publisherPreset !== presetId
          ? preset.eventNameHeader
          : (current?.eventNameHeader ?? null),
  };
}

export function normalizeNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// ── Validation functions ───────────────────────────────────────────────────────

export function validateEndpointPatch(patch: Partial<WebhookEndpoint>): string | null {
  if (
    patch.maxBodyBytes !== undefined &&
    (!Number.isInteger(patch.maxBodyBytes) ||
      patch.maxBodyBytes < MIN_WEBHOOK_BODY_BYTES ||
      patch.maxBodyBytes > MAX_WEBHOOK_BODY_BYTES)
  ) {
    return `maxBodyBytes must be between ${MIN_WEBHOOK_BODY_BYTES} and ${MAX_WEBHOOK_BODY_BYTES}`;
  }
  const verificationType = patch.verificationType;
  if (verificationType && verificationType !== 'none' && !patch.signatureHeader) {
    return 'signatureHeader is required when verificationType is enabled';
  }
  if (patch.publisherPreset === 'github') {
    if (!patch.signatureHeader || !patch.deliveryIdHeader || !patch.eventNameHeader) {
      return 'github preset requires signatureHeader, deliveryIdHeader, and eventNameHeader';
    }
  }
  if (patch.publisherPreset === 'slack') {
    if (!patch.signatureHeader) {
      return 'slack preset requires signatureHeader';
    }
  }
  if (patch.publisherPreset === 'jira') {
    if (!patch.signatureHeader || !patch.deliveryIdHeader) {
      return 'jira preset requires signatureHeader and deliveryIdHeader';
    }
  }
  return null;
}

export function validateSubscriptionShape(subscription: Partial<EventSubscription>): string | null {
  if (subscription.targetType === 'orchestrator' && !subscription.orchestratorId) {
    return 'orchestratorId is required for orchestrator subscriptions';
  }
  if (subscription.targetType === 'triggered_task' && !subscription.triggeredTaskId) {
    return 'triggeredTaskId is required for triggered_task subscriptions';
  }
  if (subscription.targetType === 'triggered_node' && !subscription.nodeId) {
    return 'nodeId is required for triggered_node subscriptions';
  }
  return null;
}

export function validateSubscriptionTargets(
  ctx: AppContext,
  subscription: Partial<EventSubscription>,
): string | null {
  if (subscription.orchestratorId) {
    const orchestrator = ctx.orchestratorStore.getById(subscription.orchestratorId);
    if (!orchestrator) return 'orchestratorId not found';
    if (subscription.targetType === 'orchestrator' && orchestrator.triggerMode !== 'webhook') {
      return 'orchestratorId must reference a webhook-triggered orchestrator';
    }
  }
  if (
    subscription.triggeredTaskId &&
    !ctx.triggeredTaskStore.getById(subscription.triggeredTaskId)
  ) {
    return 'triggeredTaskId not found';
  }
  if (subscription.nodeId) {
    const node = ctx.orchestratorStore.getNodeById(subscription.nodeId);
    if (!node || node.nodeType !== 'triggered') {
      return 'nodeId must reference a triggered node';
    }
  }
  return null;
}

export function normalizeSubscriptionTargets(
  subscription: Partial<EventSubscription>,
): Partial<EventSubscription> {
  if (subscription.targetType === 'orchestrator') {
    return {
      ...subscription,
      triggeredTaskId: null,
      nodeId: null,
    };
  }
  if (subscription.targetType === 'triggered_task') {
    return {
      ...subscription,
      orchestratorId: null,
      nodeId: null,
    };
  }
  if (subscription.targetType === 'triggered_node') {
    return {
      ...subscription,
      orchestratorId: null,
      triggeredTaskId: null,
    };
  }
  return subscription;
}

export function eventSubscriptionConflictMessage(message: string): string | null {
  if (
    message.includes('event_subscriptions.node_id') ||
    message.includes('idx_event_subscriptions_triggered_node_unique')
  ) {
    return 'Triggered node subscription already exists';
  }
  if (
    message.includes('event_subscriptions.triggered_task_id') ||
    message.includes('idx_event_subscriptions_triggered_task_unique')
  ) {
    return 'Triggered task subscription already exists';
  }
  if (
    message.includes('event_subscriptions.orchestrator_id') ||
    message.includes('idx_event_subscriptions_orchestrator_unique')
  ) {
    return 'Webhook endpoint subscription already exists for this orchestrator';
  }
  return null;
}

// ── Error class ────────────────────────────────────────────────────────────────

export class InlineSubscriptionEndpointNotFoundError extends Error {
  constructor(endpointId: string) {
    super(`endpointId not found: ${endpointId}`);
    this.name = 'InlineSubscriptionEndpointNotFoundError';
  }
}

export function isInlineSubscriptionEndpointMissingError(err: unknown): boolean {
  return (
    err instanceof InlineSubscriptionEndpointNotFoundError ||
    errorMessage(err).includes('FOREIGN KEY constraint failed')
  );
}

export function ensureInlineSubscriptionEndpointExists(ctx: AppContext, endpointId: string): void {
  if (!ctx.webhookEndpointStore.getById(endpointId)) {
    throw new InlineSubscriptionEndpointNotFoundError(endpointId);
  }
}

// ── Router refresh ─────────────────────────────────────────────────────────────

export async function refreshRouter(ctx: AppContext): Promise<void> {
  await ctx.eventRouter.reload();
}
