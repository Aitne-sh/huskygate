import { describe, expect, it } from 'vitest';
import { makeTestAppContextSeed } from '../test-helpers/app-context-builder.js';
import { ExpiringMap } from '../utils/expiring-map.js';
import type { AppContextSeed } from './app-context.js';
import { createAppContext } from './app-context.js';

function makeSeed(): AppContextSeed {
  return makeTestAppContextSeed();
}

describe('createAppContext', () => {
  it('passes through all seed fields', () => {
    const seed = makeSeed();
    const ctx = createAppContext(seed);

    expect(ctx.config).toBe(seed.config);
    expect(ctx.webClient).toBe(seed.webClient);
    expect(ctx.sessionManager).toBe(seed.sessionManager);
    expect(ctx.jobQueue).toBe(seed.jobQueue);
    expect(ctx.workdirManager).toBe(seed.workdirManager);
    expect(ctx.dedupeStore).toBe(seed.dedupeStore);
    expect(ctx.auditStore).toBe(seed.auditStore);
    expect(ctx.conversationStore).toBe(seed.conversationStore);
    expect(ctx.defaultInstructionStore).toBe(seed.defaultInstructionStore);
    expect(ctx.devAliasStore).toBe(seed.devAliasStore);
    expect(ctx.mcpServerStore).toBe(seed.mcpServerStore);
    expect(ctx.sessionMcpServerStore).toBe(seed.sessionMcpServerStore);
    expect(ctx.scheduleStore).toBe(seed.scheduleStore);
    expect(ctx.ondemandTaskStore).toBe(seed.ondemandTaskStore);
    expect(ctx.triggeredTaskStore).toBe(seed.triggeredTaskStore);
    expect(ctx.orchestratorStore).toBe(seed.orchestratorStore);
    expect(ctx.webhookEndpointStore).toBe(seed.webhookEndpointStore);
    expect(ctx.eventSubscriptionStore).toBe(seed.eventSubscriptionStore);
    expect(ctx.webhookSecretStore).toBe(seed.webhookSecretStore);
    expect(ctx.webhookDeliveryStore).toBe(seed.webhookDeliveryStore);
    expect(ctx.orchestratorEngine).toBe(seed.orchestratorEngine);
    expect(ctx.triggeredTaskExecutor).toBe(seed.triggeredTaskExecutor);
    expect(ctx.eventRouter).toBe(seed.eventRouter);
  });

  it('initializes in-memory ExpiringMap fields as empty instances', () => {
    const ctx = createAppContext(makeSeed());

    expect(ctx.pendingConfirmations).toBeInstanceOf(ExpiringMap);
    expect(ctx.pendingConfirmations.size).toBe(0);

    expect(ctx.pendingToolApprovals).toBeInstanceOf(ExpiringMap);
    expect(ctx.pendingToolApprovals.size).toBe(0);

    expect(ctx.pendingMcpAuthBypassApprovals).toBeInstanceOf(ExpiringMap);
    expect(ctx.pendingMcpAuthBypassApprovals.size).toBe(0);

    expect(ctx.assistantThreads).toBeInstanceOf(ExpiringMap);
    expect(ctx.assistantThreads.size).toBe(0);
  });

  it('initializes in-memory Map fields as empty instances', () => {
    const ctx = createAppContext(makeSeed());

    expect(ctx.activeRunners).toBeInstanceOf(Map);
    expect(ctx.activeRunners.size).toBe(0);

    expect(ctx.inactivityTimers).toBeInstanceOf(Map);
    expect(ctx.inactivityTimers.size).toBe(0);

    expect(ctx.switchPreflightBarriers).toBeInstanceOf(Map);
    expect(ctx.switchPreflightBarriers.size).toBe(0);

    expect(ctx.jobEventStreams).toBeInstanceOf(Map);
    expect(ctx.jobEventStreams.size).toBe(0);
  });

  it('creates independent instances across calls', () => {
    const seed = makeSeed();
    const ctx1 = createAppContext(seed);
    const ctx2 = createAppContext(seed);

    expect(ctx1.pendingConfirmations).not.toBe(ctx2.pendingConfirmations);
    expect(ctx1.activeRunners).not.toBe(ctx2.activeRunners);
    expect(ctx1.jobEventStreams).not.toBe(ctx2.jobEventStreams);
  });
});
