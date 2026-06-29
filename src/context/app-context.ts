/** @module app-context — Shared application context: config, stores, and in-memory state maps. */
import type { Config } from '../config.js';
import type { EventRouter } from '../event/event-router.js';
import type { TriggeredTaskExecutor } from '../event/triggered-task-executor.js';
import type { WebhookSecretStore } from '../event/webhook-secret-store.js';
import type { OrchestratorEngine } from '../orchestrator/engine.js';
import type { JobQueue } from '../queue/job-queue.js';
import type { GitHubIpAllowlist } from '../server/github-ip-allowlist.js';
import type { CloudflareTunnel } from '../server/tunnel.js';
import type { SessionManager } from '../session/manager.js';
import type { AgentStore } from '../store/agent-store.js';
import type { AuditStore } from '../store/audit.js';
import type { ConversationStore } from '../store/conversation.js';
import type { DedupeStore } from '../store/dedupe.js';
import type { DefaultInstructionStore } from '../store/default-instruction.js';
import type { DevAliasStore } from '../store/dev-alias.js';
import type { EventSubscriptionStore } from '../store/event-subscription.js';
import type { McpServerStore } from '../store/mcp-server.js';
import type { OndemandTaskStore } from '../store/ondemand-task.js';
import type { OrchestratorStore } from '../store/orchestrator.js';
import type { ScheduleStore } from '../store/schedule.js';
import type { SessionMcpServerStore } from '../store/session-mcp-server.js';
import type { TriggeredTaskStore } from '../store/triggered-task.js';
import type { WebhookDeliveryStore } from '../store/webhook-delivery.js';
import type { WebhookEndpointStore } from '../store/webhook-endpoint.js';
import { ExpiringMap } from '../utils/expiring-map.js';
import type { WorkdirManager } from '../workdir/manager.js';
import type {
  ActiveRunner,
  PendingConfirmation,
  PendingMcpAuthBypassApproval,
  PendingToolApproval,
} from './app-types.js';
import type { SlackClientSurface } from './slack-client-surface.js';

/**
 * Shared application context — holds config, stores, and in-memory Maps.
 */
export interface AppContext {
  // Core
  config: Config;
  webClient: SlackClientSurface;

  // Domain services
  sessionManager: SessionManager;
  jobQueue: JobQueue;
  workdirManager: WorkdirManager;

  // Persistence
  agentStore: AgentStore;
  dedupeStore: DedupeStore;
  auditStore: AuditStore;
  conversationStore: ConversationStore;
  defaultInstructionStore: DefaultInstructionStore;
  devAliasStore: DevAliasStore;
  mcpServerStore: McpServerStore;
  sessionMcpServerStore: SessionMcpServerStore;
  scheduleStore: ScheduleStore;
  ondemandTaskStore: OndemandTaskStore;
  triggeredTaskStore: TriggeredTaskStore;
  orchestratorStore: OrchestratorStore;
  webhookEndpointStore: WebhookEndpointStore;
  eventSubscriptionStore: EventSubscriptionStore;
  webhookSecretStore: WebhookSecretStore;
  webhookDeliveryStore: WebhookDeliveryStore;
  orchestratorEngine: OrchestratorEngine;
  triggeredTaskExecutor: TriggeredTaskExecutor;
  eventRouter: EventRouter;

  // Webhook security
  githubIpAllowlist: GitHubIpAllowlist | null;
  tunnelEnabled: boolean;
  /** Mutable: set/cleared by tunnel API routes at runtime. */
  tunnel: CloudflareTunnel | null;

  // In-memory state (ExpiringMap for defense-in-depth TTL)
  pendingConfirmations: ExpiringMap<string, PendingConfirmation>;
  pendingToolApprovals: ExpiringMap<string, PendingToolApproval>;
  pendingMcpAuthBypassApprovals: ExpiringMap<string, PendingMcpAuthBypassApproval>;

  // Plain Maps (different semantics — no TTL expiry)
  activeRunners: Map<string, ActiveRunner>;
  inactivityTimers: Map<string, ReturnType<typeof setTimeout>>;

  // Tracked assistant thread IDs (channelId:threadTs) — messages in these
  // threads are routed to the assistant handler instead of normal DM processing.
  // Uses ExpiringMap with 24h TTL since Slack has no thread closure event.
  assistantThreads: ExpiringMap<string, true>;

  // Tracks in-progress switch preflights by sessionKey. The job executor
  // awaits these promises before deciding whether to run its own preflight,
  // preventing concurrent CLI processes on the same workdir.
  switchPreflightBarriers: Map<string, Promise<void>>;

  // Dashboard SSE streaming: job.id → event callback
  jobEventStreams: Map<
    string,
    {
      onEvent: (event: { type: string; content: string }) => void;
      onDone: (result: { exitCode: number | null; sessionState: Record<string, unknown> }) => void;
    }
  >;
}

export type AppContextSeed = Omit<
  AppContext,
  | 'pendingConfirmations'
  | 'pendingToolApprovals'
  | 'pendingMcpAuthBypassApprovals'
  | 'activeRunners'
  | 'inactivityTimers'
  | 'assistantThreads'
  | 'switchPreflightBarriers'
  | 'jobEventStreams'
>;

export function createAppContext(seed: AppContextSeed): AppContext {
  return {
    ...seed,
    pendingConfirmations: new ExpiringMap<string, PendingConfirmation>(),
    pendingToolApprovals: new ExpiringMap<string, PendingToolApproval>(),
    pendingMcpAuthBypassApprovals: new ExpiringMap<string, PendingMcpAuthBypassApproval>(),
    activeRunners: new Map<string, ActiveRunner>(),
    inactivityTimers: new Map<string, ReturnType<typeof setTimeout>>(),
    assistantThreads: new ExpiringMap<string, true>(),
    switchPreflightBarriers: new Map<string, Promise<void>>(),
    jobEventStreams: new Map(),
  };
}
