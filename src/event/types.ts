/** @module event/types — Type definitions for webhook endpoints, event subscriptions, and triggered tasks */
import type { ToolName } from '../config.js';
import type { RunTrigger } from '../orchestrator/types.js';
import type { Mode } from '../session/types.js';
import type { TriggeredTaskRunStatus } from '../shared/status.js';
import type { SkillRef } from '../skills/catalog.js';

// ─── Status types (canonical source: ../shared/status.ts) ────
export type { TriggeredTaskRunStatus } from '../shared/status.js';

export type PublisherPreset = 'generic' | 'github' | 'slack' | 'jira';
export type VerificationType = 'none' | 'hmac-sha256' | 'hmac-sha1' | 'bearer' | 'slack-v0';
export type EventTargetType = 'orchestrator' | 'triggered_task' | 'triggered_node';
export type EventFilterPrimitive = string | number | boolean;

export type EventFilterClause =
  | { path: string; eq: EventFilterPrimitive }
  | { path: string; in: EventFilterPrimitive[] }
  | { path: string; exists: boolean }
  | { path: string; prefix: string };

export interface EventFilterDefinition {
  match: EventFilterClause[];
}

export type EventContextMapping = Record<string, string>;

export interface WebhookEndpoint {
  id: string;
  token: string;
  publisherPreset: PublisherPreset;
  verificationType: VerificationType;
  signatureHeader: string | null;
  signaturePrefix: string | null;
  deliveryIdHeader: string | null;
  eventNameHeader: string | null;
  secretRef: string | null;
  maxBodyBytes: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWebhookEndpoint {
  id?: string;
  token?: string;
  publisherPreset?: PublisherPreset;
  verificationType?: VerificationType;
  signatureHeader?: string | null;
  signaturePrefix?: string | null;
  deliveryIdHeader?: string | null;
  eventNameHeader?: string | null;
  secretRef?: string | null;
  maxBodyBytes?: number;
  enabled?: boolean;
}

export interface EventSubscription {
  id: string;
  endpointId: string;
  targetType: EventTargetType;
  orchestratorId: string | null;
  triggeredTaskId: string | null;
  nodeId: string | null;
  filterJson: string | null;
  contextMappingJson: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEventSubscription {
  endpointId: string;
  targetType: EventTargetType;
  orchestratorId?: string | null;
  triggeredTaskId?: string | null;
  nodeId?: string | null;
  filterJson?: string | null;
  contextMappingJson?: string | null;
  enabled?: boolean;
}

export interface EventMetadata {
  deliveryId?: string;
  sourceIp?: string;
  headers: Record<string, string>;
}

export interface TriggerEnvelope {
  _trigger: {
    publisher: PublisherPreset;
    event: string | null;
    deliveryId: string | null;
  };
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

export type TriggeredTaskConcurrencyPolicy = 'allow' | 'skip_if_running';

export interface TriggeredTask {
  id: string;
  name: string;
  description: string | null;
  userId: string;
  tool: ToolName;
  model: string | null;
  mode: Mode;
  prompt: string;
  workdir: string | null;
  maxRetries: number;
  allowMcp: boolean;
  enabledSkills: SkillRef[] | null;
  instructionFile: string | null;
  agentId: string | null;
  notifyChannel: string | null;
  notifyThread: string | null;
  enabled: boolean;
  runCount: number;
  lastRunAt: string | null;
  concurrencyPolicy: TriggeredTaskConcurrencyPolicy;
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTriggeredTask {
  name: string;
  description?: string | null;
  userId?: string;
  tool: ToolName;
  model?: string | null;
  mode?: Mode;
  prompt: string;
  workdir?: string | null;
  maxRetries?: number;
  allowMcp?: boolean;
  enabledSkills?: SkillRef[] | null;
  instructionFile?: string | null;
  agentId?: string | null;
  notifyChannel?: string | null;
  notifyThread?: string | null;
  enabled?: boolean;
  concurrencyPolicy?: TriggeredTaskConcurrencyPolicy;
}

export interface TriggeredTaskRun {
  id: string;
  triggeredTaskId: string;
  status: TriggeredTaskRunStatus;
  triggeredBy: RunTrigger;
  triggerContextJson: string | null;
  sessionKey: string | null;
  jobId: string | null;
  exitCode: number | null;
  outputSummary: string | null;
  errorMessage: string | null;
  retryCount: number;
  startedAt: string;
  endedAt: string | null;
}
