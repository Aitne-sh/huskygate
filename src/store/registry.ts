/** @module store/registry — Factory for creating all Store instances from a database handle. */
import type Database from 'better-sqlite3';
import { AgentStore } from './agent-store.js';
import { AuditStore } from './audit.js';
import { ConfigStore } from './config-store.js';
import { ConversationStore } from './conversation.js';
import { DedupeStore } from './dedupe.js';
import { DefaultInstructionStore } from './default-instruction.js';
import { DevAliasStore } from './dev-alias.js';
import { EventSubscriptionStore } from './event-subscription.js';
import { JobQueueStore } from './job-queue-store.js';
import { McpServerStore } from './mcp-server.js';
import { OndemandTaskStore } from './ondemand-task.js';
import { OrchestratorStore } from './orchestrator.js';
import { ScheduleStore } from './schedule.js';
import { SessionMcpServerStore } from './session-mcp-server.js';
import { SkillEnablementStore } from './skill-enablement.js';
import { TriggeredTaskStore } from './triggered-task.js';
import { WebhookDeliveryStore } from './webhook-delivery.js';
import { WebhookEndpointStore } from './webhook-endpoint.js';

/** Create all Store instances from a single database handle. */
export function createStores(db: Database.Database, dataDir: string) {
  return {
    agentStore: new AgentStore(db),
    configStore: new ConfigStore(db),
    dedupeStore: new DedupeStore(db),
    auditStore: new AuditStore(db),
    conversationStore: new ConversationStore(db),
    defaultInstructionStore: new DefaultInstructionStore(db),
    devAliasStore: new DevAliasStore(db),
    mcpServerStore: new McpServerStore(db),
    sessionMcpServerStore: new SessionMcpServerStore(db),
    skillEnablementStore: new SkillEnablementStore(db),
    scheduleStore: new ScheduleStore(db),
    ondemandTaskStore: new OndemandTaskStore(db),
    triggeredTaskStore: new TriggeredTaskStore(db),
    orchestratorStore: new OrchestratorStore(db, dataDir),
    jobQueueStore: new JobQueueStore(db),
    webhookEndpointStore: new WebhookEndpointStore(db),
    eventSubscriptionStore: new EventSubscriptionStore(db),
    webhookDeliveryStore: new WebhookDeliveryStore(db),
  } as const;
}

export type Stores = ReturnType<typeof createStores>;
