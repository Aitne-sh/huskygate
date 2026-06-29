/** Coverage tests for webhook-shared.ts — targeting 100% statement and branch coverage. */
import { describe, expect, it, type vi } from 'vitest';
import type { WebhookEndpoint } from '../../event/types.js';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import {
  InlineSubscriptionEndpointNotFoundError,
  MAX_EVENT_SUBSCRIPTION_TEST_BODY_BYTES,
  MAX_WEBHOOK_BODY_BYTES,
  MIN_WEBHOOK_BODY_BYTES,
  applyPresetDefaults,
  buildEndpointResponse,
  endpointPath,
  ensureInlineSubscriptionEndpointExists,
  eventSubscriptionConflictMessage,
  isInlineSubscriptionEndpointMissingError,
  isPublisherPreset,
  isVerificationType,
  normalizeNullableString,
  normalizeSubscriptionTargets,
  refreshRouter,
  validateEndpointPatch,
  validateSubscriptionShape,
  validateSubscriptionTargets,
} from './webhook-shared.js';

// ── Constants ──────────────────────────────────────────────────
describe('constants', () => {
  it('exports expected constant values', () => {
    expect(MIN_WEBHOOK_BODY_BYTES).toBe(64 * 1024);
    expect(MAX_WEBHOOK_BODY_BYTES).toBe(1024 * 1024);
    expect(MAX_EVENT_SUBSCRIPTION_TEST_BODY_BYTES).toBe(16 * 1024);
  });
});

// ── endpointPath ───────────────────────────────────────────────
describe('endpointPath', () => {
  it('returns /webhooks/<token>', () => {
    expect(endpointPath('abc123')).toBe('/webhooks/abc123');
  });
});

// ── buildEndpointResponse ──────────────────────────────────────
describe('buildEndpointResponse', () => {
  const endpoint: WebhookEndpoint = {
    id: 'ep-1',
    token: 'tok-1',
    publisherPreset: 'generic',
    verificationType: 'none',
    signatureHeader: null,
    signaturePrefix: null,
    deliveryIdHeader: null,
    eventNameHeader: null,
    secretRef: null,
    maxBodyBytes: 131072,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('includes publicUrl when webhookPublicBaseUrl is set', () => {
    const ctx = makeTestAppContext({
      config: { webhookPublicBaseUrl: 'https://hooks.example.com' },
    });
    const result = buildEndpointResponse(ctx, endpoint);
    expect(result.path).toBe('/webhooks/tok-1');
    expect(result.publicUrl).toBe('https://hooks.example.com/webhooks/tok-1');
    expect(result.publicUrlConfigured).toBe(true);
  });

  it('returns publicUrl null when webhookPublicBaseUrl is null', () => {
    const ctx = makeTestAppContext({ config: { webhookPublicBaseUrl: null } });
    const result = buildEndpointResponse(ctx, endpoint);
    expect(result.publicUrl).toBeNull();
    expect(result.publicUrlConfigured).toBe(false);
  });

  it('spreads all endpoint fields', () => {
    const ctx = makeTestAppContext({ config: { webhookPublicBaseUrl: null } });
    const result = buildEndpointResponse(ctx, endpoint);
    expect(result.id).toBe('ep-1');
    expect(result.token).toBe('tok-1');
  });
});

// ── isPublisherPreset ──────────────────────────────────────────
describe('isPublisherPreset', () => {
  it('returns true for valid presets', () => {
    expect(isPublisherPreset('generic')).toBe(true);
    expect(isPublisherPreset('github')).toBe(true);
    expect(isPublisherPreset('slack')).toBe(true);
    expect(isPublisherPreset('jira')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isPublisherPreset('invalid')).toBe(false);
    expect(isPublisherPreset(null)).toBe(false);
    expect(isPublisherPreset(42)).toBe(false);
    expect(isPublisherPreset(undefined)).toBe(false);
  });
});

// ── isVerificationType ─────────────────────────────────────────
describe('isVerificationType', () => {
  it('returns true for valid verification types', () => {
    expect(isVerificationType('none')).toBe(true);
    expect(isVerificationType('hmac-sha256')).toBe(true);
    expect(isVerificationType('hmac-sha1')).toBe(true);
    expect(isVerificationType('bearer')).toBe(true);
    expect(isVerificationType('slack-v0')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isVerificationType('invalid')).toBe(false);
    expect(isVerificationType(null)).toBe(false);
    expect(isVerificationType(123)).toBe(false);
  });
});

// ── normalizeNullableString ────────────────────────────────────
describe('normalizeNullableString', () => {
  it('returns trimmed string for non-empty strings', () => {
    expect(normalizeNullableString(' hello ')).toBe('hello');
    expect(normalizeNullableString('world')).toBe('world');
  });

  it('returns null for empty/whitespace strings', () => {
    expect(normalizeNullableString('')).toBeNull();
    expect(normalizeNullableString('  ')).toBeNull();
  });

  it('returns null for non-string values', () => {
    expect(normalizeNullableString(null)).toBeNull();
    expect(normalizeNullableString(undefined)).toBeNull();
    expect(normalizeNullableString(42)).toBeNull();
    expect(normalizeNullableString(true)).toBeNull();
  });
});

// ── applyPresetDefaults ────────────────────────────────────────
describe('applyPresetDefaults', () => {
  it('applies github preset defaults for new endpoint (no current)', () => {
    const result = applyPresetDefaults('github', {});
    expect(result.publisherPreset).toBe('github');
    expect(result.verificationType).toBe('hmac-sha256');
    expect(result.signatureHeader).toBe('x-hub-signature-256');
    expect(result.signaturePrefix).toBe('sha256=');
    expect(result.deliveryIdHeader).toBe('x-github-delivery');
    expect(result.eventNameHeader).toBe('x-github-event');
  });

  it('applies generic preset defaults for new endpoint (no current)', () => {
    const result = applyPresetDefaults('generic', {});
    expect(result.publisherPreset).toBe('generic');
    expect(result.verificationType).toBe('none');
    expect(result.signatureHeader).toBeNull();
    expect(result.deliveryIdHeader).toBeNull();
    expect(result.eventNameHeader).toBeNull();
  });

  it('applies slack preset defaults for new endpoint (no current)', () => {
    const result = applyPresetDefaults('slack', {});
    expect(result.verificationType).toBe('slack-v0');
    expect(result.signatureHeader).toBe('x-slack-signature');
    expect(result.signaturePrefix).toBe('v0=');
  });

  it('applies jira preset defaults for new endpoint (no current)', () => {
    const result = applyPresetDefaults('jira', {});
    expect(result.verificationType).toBe('hmac-sha256');
    expect(result.signatureHeader).toBe('x-hub-signature');
    expect(result.deliveryIdHeader).toBe('x-atlassian-webhook-identifier');
  });

  it('uses parsed values when explicitly provided (overriding preset)', () => {
    const result = applyPresetDefaults('github', {
      verificationType: 'bearer',
      signatureHeader: 'x-custom-sig',
      signaturePrefix: 'custom=',
      deliveryIdHeader: 'x-custom-delivery',
      eventNameHeader: 'x-custom-event',
    });
    expect(result.verificationType).toBe('bearer');
    expect(result.signatureHeader).toBe('x-custom-sig');
    expect(result.signaturePrefix).toBe('custom=');
    expect(result.deliveryIdHeader).toBe('x-custom-delivery');
    expect(result.eventNameHeader).toBe('x-custom-event');
  });

  it('uses current endpoint values when preset unchanged and no parsed override', () => {
    const current: WebhookEndpoint = {
      id: 'ep-1',
      token: 'tok-1',
      publisherPreset: 'github',
      verificationType: 'hmac-sha256',
      signatureHeader: 'x-hub-signature-256',
      signaturePrefix: 'sha256=',
      deliveryIdHeader: 'x-github-delivery',
      eventNameHeader: 'x-github-event',
      secretRef: 'secret:ep-1',
      maxBodyBytes: 131072,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const result = applyPresetDefaults('github', {}, current);
    expect(result.verificationType).toBe('hmac-sha256');
    expect(result.signatureHeader).toBe('x-hub-signature-256');
    expect(result.signaturePrefix).toBe('sha256=');
    expect(result.deliveryIdHeader).toBe('x-github-delivery');
    expect(result.eventNameHeader).toBe('x-github-event');
  });

  it('resets to preset defaults when preset changes from current', () => {
    const current: WebhookEndpoint = {
      id: 'ep-1',
      token: 'tok-1',
      publisherPreset: 'generic',
      verificationType: 'none',
      signatureHeader: null,
      signaturePrefix: null,
      deliveryIdHeader: null,
      eventNameHeader: null,
      secretRef: null,
      maxBodyBytes: 131072,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const result = applyPresetDefaults('github', {}, current);
    // Preset changed from generic -> github, should use github preset defaults
    expect(result.signatureHeader).toBe('x-hub-signature-256');
    expect(result.deliveryIdHeader).toBe('x-github-delivery');
    expect(result.eventNameHeader).toBe('x-github-event');
  });

  it('uses current verificationType when parsed.verificationType is undefined and current exists', () => {
    const current: WebhookEndpoint = {
      id: 'ep-1',
      token: 'tok-1',
      publisherPreset: 'github',
      verificationType: 'bearer',
      signatureHeader: 'x-hub-signature-256',
      signaturePrefix: 'sha256=',
      deliveryIdHeader: 'x-github-delivery',
      eventNameHeader: 'x-github-event',
      secretRef: null,
      maxBodyBytes: 131072,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const result = applyPresetDefaults('github', {}, current);
    expect(result.verificationType).toBe('bearer');
  });

  it('normalizes nullable string fields to null when empty', () => {
    const result = applyPresetDefaults('generic', {
      signatureHeader: '',
      signaturePrefix: '  ',
      deliveryIdHeader: '',
      eventNameHeader: '',
    });
    expect(result.signatureHeader).toBeNull();
    expect(result.signaturePrefix).toBeNull();
    expect(result.deliveryIdHeader).toBeNull();
    expect(result.eventNameHeader).toBeNull();
  });
});

// ── validateEndpointPatch ──────────────────────────────────────
describe('validateEndpointPatch', () => {
  it('returns null for valid patch', () => {
    expect(
      validateEndpointPatch({
        maxBodyBytes: 131072,
        verificationType: 'none',
      }),
    ).toBeNull();
  });

  it('rejects maxBodyBytes below minimum', () => {
    const err = validateEndpointPatch({ maxBodyBytes: 100 });
    expect(err).toContain('maxBodyBytes must be between');
  });

  it('rejects maxBodyBytes above maximum', () => {
    const err = validateEndpointPatch({ maxBodyBytes: 10_000_000 });
    expect(err).toContain('maxBodyBytes must be between');
  });

  it('rejects non-integer maxBodyBytes', () => {
    const err = validateEndpointPatch({ maxBodyBytes: 131072.5 });
    expect(err).toContain('maxBodyBytes must be between');
  });

  it('requires signatureHeader when verificationType is not none', () => {
    const err = validateEndpointPatch({
      verificationType: 'hmac-sha256',
      signatureHeader: null,
    });
    expect(err).toBe('signatureHeader is required when verificationType is enabled');
  });

  it('passes when verificationType is set with signatureHeader', () => {
    const err = validateEndpointPatch({
      verificationType: 'hmac-sha256',
      signatureHeader: 'x-sig',
      maxBodyBytes: 131072,
    });
    expect(err).toBeNull();
  });

  it('validates github preset requirements', () => {
    expect(
      validateEndpointPatch({
        publisherPreset: 'github',
        verificationType: 'hmac-sha256',
        signatureHeader: 'x-sig',
        deliveryIdHeader: null,
        eventNameHeader: null,
      }),
    ).toBe('github preset requires signatureHeader, deliveryIdHeader, and eventNameHeader');
  });

  it('passes github preset with all required fields', () => {
    expect(
      validateEndpointPatch({
        publisherPreset: 'github',
        verificationType: 'hmac-sha256',
        signatureHeader: 'x-sig',
        deliveryIdHeader: 'x-delivery',
        eventNameHeader: 'x-event',
        maxBodyBytes: 131072,
      }),
    ).toBeNull();
  });

  it('validates slack preset requirements (signatureHeader required by verificationType)', () => {
    expect(
      validateEndpointPatch({
        publisherPreset: 'slack',
        verificationType: 'slack-v0',
        signatureHeader: null,
      }),
    ).toBe('signatureHeader is required when verificationType is enabled');
  });

  it('validates slack preset requirements (signatureHeader required by preset itself)', () => {
    // Use verificationType 'none' to bypass the generic signatureHeader check,
    // then verify the slack-specific validation still fires.
    expect(
      validateEndpointPatch({
        publisherPreset: 'slack',
        verificationType: 'none',
        signatureHeader: null,
      }),
    ).toBe('slack preset requires signatureHeader');
  });

  it('passes slack preset with signatureHeader', () => {
    expect(
      validateEndpointPatch({
        publisherPreset: 'slack',
        verificationType: 'slack-v0',
        signatureHeader: 'x-slack-signature',
        maxBodyBytes: 131072,
      }),
    ).toBeNull();
  });

  it('validates jira preset requirements', () => {
    expect(
      validateEndpointPatch({
        publisherPreset: 'jira',
        verificationType: 'hmac-sha256',
        signatureHeader: 'x-sig',
        deliveryIdHeader: null,
      }),
    ).toBe('jira preset requires signatureHeader and deliveryIdHeader');
  });

  it('passes jira preset with required fields', () => {
    expect(
      validateEndpointPatch({
        publisherPreset: 'jira',
        verificationType: 'hmac-sha256',
        signatureHeader: 'x-sig',
        deliveryIdHeader: 'x-delivery',
        maxBodyBytes: 131072,
      }),
    ).toBeNull();
  });

  it('returns null when maxBodyBytes is undefined', () => {
    expect(validateEndpointPatch({ verificationType: 'none' })).toBeNull();
  });

  it('validates github preset without signatureHeader', () => {
    expect(
      validateEndpointPatch({
        publisherPreset: 'github',
        verificationType: 'hmac-sha256',
        signatureHeader: null,
        deliveryIdHeader: 'x-delivery',
        eventNameHeader: 'x-event',
      }),
    ).toBe('signatureHeader is required when verificationType is enabled');
  });
});

// ── validateSubscriptionShape ──────────────────────────────────
describe('validateSubscriptionShape', () => {
  it('returns null for valid orchestrator subscription', () => {
    expect(
      validateSubscriptionShape({ targetType: 'orchestrator', orchestratorId: 'orch-1' }),
    ).toBeNull();
  });

  it('requires orchestratorId for orchestrator subscriptions', () => {
    expect(validateSubscriptionShape({ targetType: 'orchestrator' })).toBe(
      'orchestratorId is required for orchestrator subscriptions',
    );
  });

  it('returns null for valid triggered_task subscription', () => {
    expect(
      validateSubscriptionShape({ targetType: 'triggered_task', triggeredTaskId: 'task-1' }),
    ).toBeNull();
  });

  it('requires triggeredTaskId for triggered_task subscriptions', () => {
    expect(validateSubscriptionShape({ targetType: 'triggered_task' })).toBe(
      'triggeredTaskId is required for triggered_task subscriptions',
    );
  });

  it('returns null for valid triggered_node subscription', () => {
    expect(
      validateSubscriptionShape({ targetType: 'triggered_node', nodeId: 'node-1' }),
    ).toBeNull();
  });

  it('requires nodeId for triggered_node subscriptions', () => {
    expect(validateSubscriptionShape({ targetType: 'triggered_node' })).toBe(
      'nodeId is required for triggered_node subscriptions',
    );
  });
});

// ── validateSubscriptionTargets ────────────────────────────────
describe('validateSubscriptionTargets', () => {
  it('returns null when all targets exist and are valid', () => {
    const ctx = makeTestAppContext();
    (ctx.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'orch-1',
      triggerMode: 'webhook',
    });
    expect(
      validateSubscriptionTargets(ctx, {
        targetType: 'orchestrator',
        orchestratorId: 'orch-1',
      }),
    ).toBeNull();
  });

  it('returns error when orchestratorId not found', () => {
    const ctx = makeTestAppContext();
    (ctx.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(null);
    expect(
      validateSubscriptionTargets(ctx, {
        targetType: 'orchestrator',
        orchestratorId: 'missing',
      }),
    ).toBe('orchestratorId not found');
  });

  it('returns error when orchestrator is not webhook-triggered', () => {
    const ctx = makeTestAppContext();
    (ctx.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'orch-1',
      triggerMode: 'ondemand',
    });
    expect(
      validateSubscriptionTargets(ctx, {
        targetType: 'orchestrator',
        orchestratorId: 'orch-1',
      }),
    ).toBe('orchestratorId must reference a webhook-triggered orchestrator');
  });

  it('returns error when triggeredTaskId not found', () => {
    const ctx = makeTestAppContext();
    expect(
      validateSubscriptionTargets(ctx, {
        targetType: 'triggered_task',
        triggeredTaskId: 'missing',
      }),
    ).toBe('triggeredTaskId not found');
  });

  it('returns null when triggeredTaskId exists', () => {
    const ctx = makeTestAppContext();
    (ctx.triggeredTaskStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'task-1' });
    expect(
      validateSubscriptionTargets(ctx, {
        targetType: 'triggered_task',
        triggeredTaskId: 'task-1',
      }),
    ).toBeNull();
  });

  it('returns error when nodeId does not reference a triggered node', () => {
    const ctx = makeTestAppContext();
    (ctx.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'node-1',
      nodeType: 'task',
    });
    expect(
      validateSubscriptionTargets(ctx, { targetType: 'triggered_node', nodeId: 'node-1' }),
    ).toBe('nodeId must reference a triggered node');
  });

  it('returns error when nodeId not found', () => {
    const ctx = makeTestAppContext();
    (ctx.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue(null);
    expect(
      validateSubscriptionTargets(ctx, { targetType: 'triggered_node', nodeId: 'missing' }),
    ).toBe('nodeId must reference a triggered node');
  });

  it('returns null when nodeId references a triggered node', () => {
    const ctx = makeTestAppContext();
    (ctx.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'node-1',
      nodeType: 'triggered',
    });
    expect(
      validateSubscriptionTargets(ctx, { targetType: 'triggered_node', nodeId: 'node-1' }),
    ).toBeNull();
  });

  it('returns null when no target IDs are set', () => {
    const ctx = makeTestAppContext();
    expect(validateSubscriptionTargets(ctx, {})).toBeNull();
  });

  it('validates orchestratorId for non-orchestrator targetType (no triggerMode check)', () => {
    const ctx = makeTestAppContext();
    (ctx.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'orch-1',
      triggerMode: 'ondemand',
    });
    // For targetType triggered_node, nodeId must reference a triggered node
    // When getNodeById returns a non-triggered node, validation fails
    expect(
      validateSubscriptionTargets(ctx, {
        targetType: 'triggered_node',
        orchestratorId: 'orch-1',
        nodeId: 'node-1',
      }),
    ).toBe('nodeId must reference a triggered node');
  });
});

// ── normalizeSubscriptionTargets ───────────────────────────────
describe('normalizeSubscriptionTargets', () => {
  it('nullifies non-applicable fields for orchestrator', () => {
    const result = normalizeSubscriptionTargets({
      targetType: 'orchestrator',
      orchestratorId: 'orch-1',
      triggeredTaskId: 'task-1',
      nodeId: 'node-1',
    });
    expect(result.orchestratorId).toBe('orch-1');
    expect(result.triggeredTaskId).toBeNull();
    expect(result.nodeId).toBeNull();
  });

  it('nullifies non-applicable fields for triggered_task', () => {
    const result = normalizeSubscriptionTargets({
      targetType: 'triggered_task',
      orchestratorId: 'orch-1',
      triggeredTaskId: 'task-1',
      nodeId: 'node-1',
    });
    expect(result.orchestratorId).toBeNull();
    expect(result.triggeredTaskId).toBe('task-1');
    expect(result.nodeId).toBeNull();
  });

  it('nullifies non-applicable fields for triggered_node', () => {
    const result = normalizeSubscriptionTargets({
      targetType: 'triggered_node',
      orchestratorId: 'orch-1',
      triggeredTaskId: 'task-1',
      nodeId: 'node-1',
    });
    expect(result.orchestratorId).toBeNull();
    expect(result.triggeredTaskId).toBeNull();
    expect(result.nodeId).toBe('node-1');
  });

  it('returns subscription unchanged for unknown targetType', () => {
    const sub = { orchestratorId: 'orch-1', triggeredTaskId: 'task-1', nodeId: 'node-1' };
    const result = normalizeSubscriptionTargets(sub);
    expect(result).toEqual(sub);
  });
});

// ── eventSubscriptionConflictMessage ───────────────────────────
describe('eventSubscriptionConflictMessage', () => {
  it('detects triggered node unique constraint violations', () => {
    expect(
      eventSubscriptionConflictMessage('UNIQUE constraint failed: event_subscriptions.node_id'),
    ).toBe('Triggered node subscription already exists');
    expect(
      eventSubscriptionConflictMessage('idx_event_subscriptions_triggered_node_unique violation'),
    ).toBe('Triggered node subscription already exists');
  });

  it('detects triggered task unique constraint violations', () => {
    expect(
      eventSubscriptionConflictMessage(
        'UNIQUE constraint failed: event_subscriptions.triggered_task_id',
      ),
    ).toBe('Triggered task subscription already exists');
    expect(
      eventSubscriptionConflictMessage('idx_event_subscriptions_triggered_task_unique violation'),
    ).toBe('Triggered task subscription already exists');
  });

  it('detects orchestrator unique constraint violations', () => {
    expect(
      eventSubscriptionConflictMessage(
        'UNIQUE constraint failed: event_subscriptions.orchestrator_id',
      ),
    ).toBe('Webhook endpoint subscription already exists for this orchestrator');
    expect(
      eventSubscriptionConflictMessage('idx_event_subscriptions_orchestrator_unique violation'),
    ).toBe('Webhook endpoint subscription already exists for this orchestrator');
  });

  it('returns null for non-conflict messages', () => {
    expect(eventSubscriptionConflictMessage('some other error')).toBeNull();
    expect(eventSubscriptionConflictMessage('')).toBeNull();
  });
});

// ── InlineSubscriptionEndpointNotFoundError ────────────────────
describe('InlineSubscriptionEndpointNotFoundError', () => {
  it('creates error with expected message and name', () => {
    const err = new InlineSubscriptionEndpointNotFoundError('ep-123');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('InlineSubscriptionEndpointNotFoundError');
    expect(err.message).toBe('endpointId not found: ep-123');
  });
});

// ── isInlineSubscriptionEndpointMissingError ───────────────────
describe('isInlineSubscriptionEndpointMissingError', () => {
  it('returns true for InlineSubscriptionEndpointNotFoundError', () => {
    expect(
      isInlineSubscriptionEndpointMissingError(new InlineSubscriptionEndpointNotFoundError('ep-1')),
    ).toBe(true);
  });

  it('returns true for FOREIGN KEY constraint failed error', () => {
    expect(
      isInlineSubscriptionEndpointMissingError(new Error('FOREIGN KEY constraint failed')),
    ).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isInlineSubscriptionEndpointMissingError(new Error('other error'))).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isInlineSubscriptionEndpointMissingError(null)).toBe(false);
    expect(isInlineSubscriptionEndpointMissingError('string')).toBe(false);
  });
});

// ── ensureInlineSubscriptionEndpointExists ─────────────────────
describe('ensureInlineSubscriptionEndpointExists', () => {
  it('does not throw when endpoint exists', () => {
    const ctx = makeTestAppContext();
    (ctx.webhookEndpointStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'ep-1' });
    expect(() => ensureInlineSubscriptionEndpointExists(ctx, 'ep-1')).not.toThrow();
  });

  it('throws InlineSubscriptionEndpointNotFoundError when endpoint missing', () => {
    const ctx = makeTestAppContext();
    expect(() => ensureInlineSubscriptionEndpointExists(ctx, 'missing')).toThrow(
      InlineSubscriptionEndpointNotFoundError,
    );
  });
});

// ── refreshRouter ──────────────────────────────────────────────
describe('refreshRouter', () => {
  it('calls eventRouter.reload', async () => {
    const ctx = makeTestAppContext();
    await refreshRouter(ctx);
    expect(ctx.eventRouter.reload).toHaveBeenCalledOnce();
  });
});
