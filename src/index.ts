/** @module index — Application entry point: bootstraps stores, services, Slack app, and lifecycle. */
declare const __APP_VERSION__: string;
import fs from 'node:fs';
import path from 'node:path';
import { App } from '@slack/bolt';
import {
  SENSITIVE_KEYS,
  createConfigResolver,
  loadConfig,
  syncProcessEnvFromResolver,
} from './config.js';
import { createAppContext } from './context/app-context.js';
import { EventRouter } from './event/event-router.js';
import { TriggeredTaskExecutor } from './event/triggered-task-executor.js';
import { WebhookSecretStore } from './event/webhook-secret-store.js';
import { OrchestratorEngine } from './orchestrator/engine.js';
import { JobQueue } from './queue/job-queue.js';
import { recoverDurableQueue } from './queue/recovery.js';
import { Scheduler } from './schedule/scheduler.js';
import { startApiServer } from './server/api.js';
import { GitHubIpAllowlist } from './server/github-ip-allowlist.js';
import { SlackNotificationService } from './server/slack-notification-service.js';
import { CloudflareTunnel } from './server/tunnel.js';
import { SessionManager } from './session/manager.js';
import { INTERVALS, TIMEOUTS } from './shared/constants.js';
import { createApp } from './slack/app.js';
import { closeDatabase, initDatabase } from './store/database.js';
import { runHousekeeping } from './store/housekeeping.js';
import { createStores } from './store/registry.js';
import { errorMessage } from './utils/error.js';
import { loadKeychainSecrets } from './utils/keychain.js';
import { logger, setLogLevel, setShowStacks } from './utils/logger.js';
import { startMetricsReporter, stopMetricsReporter } from './utils/metrics.js';
import { cleanupWorkdir } from './utils/workdir.js';
import { WorkdirManager } from './workdir/manager.js';

export async function main(): Promise<void> {
  const dataDir = process.env.HUSKYGATE_DATA_DIR || path.resolve(process.cwd(), 'data');

  // Initialize database before config resolution so persisted settings can win
  // over compatibility env values.
  logger.info('database_path', { path: dataDir });
  const db = initDatabase(dataDir);
  const stores = createStores(db, dataDir);

  const keychainSecrets = await loadKeychainSecrets(SENSITIVE_KEYS);

  const resolver = createConfigResolver({
    configStore: stores.configStore,
    dataDir,
    secureStoreValues: keychainSecrets,
  });
  const config = loadConfig({ resolver });
  syncProcessEnvFromResolver(resolver);
  setLogLevel(config.logLevel);
  setShowStacks(config.logStacks);

  logger.info('starting', { version: __APP_VERSION__ });

  const {
    agentStore,
    dedupeStore,
    auditStore,
    conversationStore,
    defaultInstructionStore,
    devAliasStore,
    mcpServerStore,
    sessionMcpServerStore,
    skillEnablementStore,
    scheduleStore,
    ondemandTaskStore,
    triggeredTaskStore,
    orchestratorStore,
    jobQueueStore,
    webhookEndpointStore,
    eventSubscriptionStore,
    webhookDeliveryStore,
  } = stores;
  const sessionManager = new SessionManager(db, config);
  const jobQueue = new JobQueue(config, jobQueueStore);
  const workdirManager = new WorkdirManager(config, { skillEnablementStore });
  const webhookSecretStore = new WebhookSecretStore();

  const sessions = sessionManager.listAllSessions();
  workdirManager.ensureSessionWorkdirs(
    sessions.map((session) => ({
      workdir: session.workdir,
      tool: session.tool,
      mode: session.mode,
    })),
    config.toolAutoApproveMode,
  );
  const referencedWorkdirs = Array.from(new Set(sessions.map((session) => session.workdir)));
  workdirManager.archiveLegacyDefaultWorkdirIfUnused(referencedWorkdirs);
  workdirManager.cleanupUnusedSessionWorkdirs(referencedWorkdirs);

  dedupeStore.cleanup();
  workdirManager.cleanupStaleSessions();
  workdirManager.ensureWorkdir(config.workdirRoot);

  // ── Periodic tasks ──
  const startedAt = Date.now();
  const heartbeatInterval = setInterval(() => {
    const mem = process.memoryUsage();
    logger.info('heartbeat', {
      uptime_sec: Math.round((Date.now() - startedAt) / 1000),
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
    });
  }, INTERVALS.heartbeat);
  heartbeatInterval.unref();

  const dedupeCleanupInterval = setInterval(
    () => {
      dedupeStore.cleanup();
    },
    60 * 60 * 1000,
  );
  dedupeCleanupInterval.unref();

  const outputFullCleanup = () => {
    try {
      const result = orchestratorStore.archiveAndPruneOutputFull(dataDir);
      if (result.archivedCount > 0) {
        logger.info('output_full_cleanup', { archived: result.archivedCount });
      }
      if (result.errors.length > 0) {
        logger.warn('output_full_cleanup_errors', { errors: result.errors.slice(0, 10) });
      }
    } catch (err) {
      logger.error('output_full_cleanup_failed', { error: errorMessage(err) });
    }
  };
  outputFullCleanup(); // Run once on startup
  const outputFullCleanupInterval = setInterval(outputFullCleanup, 6 * 60 * 60 * 1000);
  outputFullCleanupInterval.unref();

  const dbHousekeeping = () => {
    try {
      const result = runHousekeeping(db, dataDir, config.workdirRoot, {
        sessionCleanupEnabled: config.sessionCleanupEnabled,
      });
      const totalDeleted = result.retention.reduce((sum, r) => sum + r.deletedCount, 0);
      const hasActivity =
        totalDeleted > 0 ||
        result.orphanedThreadContextsCleared > 0 ||
        result.orphanedSessionMcpRows > 0 ||
        result.jobLogsCleaned > 0 ||
        result.orphanJobLogsCleaned > 0 ||
        result.orchestratorsPurged > 0 ||
        result.orphanRunWorkdirsCleaned > 0 ||
        result.logsRotated > 0 ||
        result.backup ||
        result.backupsPruned > 0;
      if (hasActivity) {
        logger.info('db_housekeeping', {
          retention: result.retention,
          orphaned_thread_contexts_cleared: result.orphanedThreadContextsCleared,
          orphaned_session_mcp_rows: result.orphanedSessionMcpRows,
          cleaned_session_count: result.cleanedSessionKeys.length,
          job_logs_cleaned: result.jobLogsCleaned,
          orphan_job_logs_cleaned: result.orphanJobLogsCleaned,
          orchestrators_purged: result.orchestratorsPurged,
          orchestrator_runs_purged: result.orchestratorRunsPurged,
          orchestrator_workdirs_cleaned: result.orchestratorWorkdirsCleaned,
          orphan_run_workdirs_cleaned: result.orphanRunWorkdirsCleaned,
          logs_rotated: result.logsRotated,
          backup: result.backup?.path ?? null,
          backups_pruned: result.backupsPruned,
          duration_ms: result.durationMs,
        });
      }
    } catch (err) {
      logger.error('db_housekeeping_failed', { error: errorMessage(err) });
    }
  };
  dbHousekeeping(); // Run once on startup
  const dbHousekeepingInterval = setInterval(dbHousekeeping, 24 * 60 * 60 * 1000);
  dbHousekeepingInterval.unref();

  // ── Orchestrator & event routing ──
  const orchestratorEngine = new OrchestratorEngine({
    orchestratorStore,
    agentStore,
    createSession: (tool, userId, mode, options) => {
      const session = sessionManager.createStandaloneSession(tool, userId, mode ?? 'write');
      if (!options?.skipWorkdir) {
        workdirManager.ensureWorkdir(session.workdir);
      }
      return { sessionKey: session.sessionKey, workdir: session.workdir };
    },
    prepareWorkdir: (workdir, tool, enabledSkills) => {
      workdirManager.prepareWorkdirSkillsOnly(workdir, tool, enabledSkills);
    },
    enqueueJob: (job) => jobQueue.enqueue(job),
    cleanupSession: (sessionKey) => {
      const sessionWorkdir = sessionManager.get(sessionKey)?.workdir ?? null;
      sessionManager.deleteSessionByKeyWithCleanup(sessionKey);
      cleanupWorkdir(config.workdirRoot, sessionWorkdir);
    },
    cleanupRunWorkdir: (runId) => {
      const workdir = path.join(config.workdirRoot, `orch_${runId.slice(0, 8)}`);
      cleanupWorkdir(config.workdirRoot, workdir);
    },
    validateWorkdir: (workdir) => workdirManager.validateCustomWorkdir(workdir),
  });
  const triggeredTaskExecutor = new TriggeredTaskExecutor({
    triggeredTaskStore,
    sessionManager,
    jobQueue,
    workdirManager,
    workdirRoot: config.workdirRoot,
    agentStore,
  });
  const eventRouter = new EventRouter({
    webhookEndpointStore,
    eventSubscriptionStore,
    webhookSecretStore,
    webhookDeliveryStore,
    orchestratorEngine,
    triggeredTaskExecutor,
  });
  await eventRouter.reload();
  orchestratorEngine.setEventRouter(eventRouter);

  // ── Cloudflare Tunnel ──
  // Boot-time tunnel stored directly into initialTunnel; ctx.tunnel becomes the
  // single source of truth (also written by the /api/tunnel/start route at runtime).
  let initialTunnel: CloudflareTunnel | null = null;
  if (config.cloudflareTunnelEnabled) {
    const t = new CloudflareTunnel({
      localPort: config.serverApiPort,
      localHost: config.serverApiHost,
      token: config.cloudflareTunnelToken,
    });
    try {
      const tunnelUrl = await t.start();
      initialTunnel = t;
      // For quick tunnels, auto-set the webhook public URL.
      // Note: Direct mutation of config is intentional — Config is loaded once and
      // consumed by reference throughout the process lifetime. The resolver is not
      // re-read after startup, so this runtime override is safe.
      if (tunnelUrl && !config.webhookPublicBaseUrl) {
        config.webhookPublicBaseUrl = tunnelUrl;
        logger.info('tunnel_webhook_url_set', { url: tunnelUrl });
      }
    } catch (err) {
      logger.error('tunnel_start_failed', { error: errorMessage(err) });
    }
  }

  // ── GitHub webhook IP allowlist ──
  let githubIpAllowlist: GitHubIpAllowlist | null = null;
  if (config.githubWebhookIpAllowlist) {
    githubIpAllowlist = new GitHubIpAllowlist();
    await githubIpAllowlist.start();
  }

  const app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    socketMode: true,
  });

  // ── Slack app & notification wiring ──
  const ctx = createAppContext({
    config,
    webClient: app.client,
    sessionManager,
    jobQueue,
    workdirManager,
    agentStore,
    dedupeStore,
    auditStore,
    conversationStore,
    defaultInstructionStore,
    devAliasStore,
    mcpServerStore,
    sessionMcpServerStore,
    scheduleStore,
    ondemandTaskStore,
    triggeredTaskStore,
    orchestratorStore,
    webhookEndpointStore,
    eventSubscriptionStore,
    webhookSecretStore,
    webhookDeliveryStore,
    orchestratorEngine,
    triggeredTaskExecutor,
    eventRouter,
    githubIpAllowlist,
    tunnelEnabled: config.cloudflareTunnelEnabled,
    tunnel: initialTunnel,
  });
  const runtime = createApp(ctx, app);
  const notificationService = new SlackNotificationService(ctx.webClient, config);

  // Wire postNotification after runtime init — Slack app must exist before engine can post
  orchestratorEngine.setPostNotification(async (channel, text, threadTs) => {
    const result = await ctx.webClient.chat.postMessage({
      channel,
      text,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
    const ts = result.ts as string | undefined;
    const resolvedChannel = result.channel as string | undefined;
    if (!ts || !resolvedChannel) return null;
    return { channelId: resolvedChannel, ts };
  });

  orchestratorEngine.setUploadFile(async (channel, filePath, filename, threadTs) => {
    const data = fs.readFileSync(filePath);
    await ctx.webClient.filesUploadV2({
      channel_id: channel,
      file: data,
      filename,
      title: filename,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    } as Parameters<typeof ctx.webClient.filesUploadV2>[0]);
  });
  orchestratorEngine.setDefaultNotifyChannel(config.scheduleDefaultNotifyChannel ?? undefined);

  const queueRecovery = recoverDurableQueue(ctx, jobQueue, jobQueueStore);
  if (
    queueRecovery.restoredQueued > 0 ||
    queueRecovery.interruptedRunning > 0 ||
    queueRecovery.handedOffOrchestrator > 0 ||
    queueRecovery.discardedQueued > 0
  ) {
    logger.info('durable_queue_recovered', { ...queueRecovery });
  }
  await orchestratorEngine.recoverActiveRuns();

  let scheduler: Scheduler | null = null;
  if (config.scheduleEnabled) {
    scheduler = new Scheduler(
      {
        scheduleStore,
        sessionManager,
        jobQueue,
        workdirManager,
        config,
        orchestratorStore,
        orchestratorEngine,
        triggeredTaskStore,
        agentStore,
      },
      config.schedulePollIntervalSec * 1000,
    );
  }

  const apiServer = startApiServer(runtime.ctx, notificationService);

  // ── Graceful shutdown ──
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    setTimeout(() => process.exit(1), TIMEOUTS.shutdownHard).unref(); // Hard timeout fallback

    logger.info('shutdown_started', { signal });

    jobQueue.stopAccepting();
    try {
      const interrupted = await runtime.shutdownRunningJobs();
      if (interrupted > 0) {
        logger.info('killing_running_jobs', { count: interrupted });
        await new Promise((resolve) => setTimeout(resolve, 5500));
      }
    } catch (err) {
      logger.error('shutdown_jobs_error', { error: errorMessage(err) });
    }

    scheduler?.stop();
    // Use ctx.tunnel (source of truth) — covers both boot-time and API-started tunnels.
    runtime.ctx.tunnel?.stop();
    githubIpAllowlist?.stop();
    stopMetricsReporter(() => jobQueue.getStatus());
    clearInterval(heartbeatInterval);
    clearInterval(dedupeCleanupInterval);
    clearInterval(outputFullCleanupInterval);
    clearInterval(dbHousekeepingInterval);

    try {
      apiServer.close();
    } catch (err) {
      logger.error('api_server_close_error', { error: errorMessage(err) });
    }
    try {
      await runtime.app.stop();
    } catch (err) {
      logger.error('app_stop_error', { error: errorMessage(err) });
    }
    try {
      closeDatabase();
    } catch (err) {
      logger.error('database_close_error', { error: errorMessage(err) });
    }

    logger.info('shutdown_complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // SIGHUP: terminal disconnect (Unix) / console window close (Windows).
  process.on('SIGHUP', () => shutdown('SIGHUP'));

  // Global error handlers — ensure fatal crashes are logged before exit.
  // Wrap logger calls in try-catch: if the logger itself throws (e.g. circular
  // reference in error object), fall back to raw stderr so the crash is never silent.
  process.on('uncaughtException', (err) => {
    try {
      logger.error('uncaught_exception', { error: errorMessage(err), stack: err.stack });
    } catch {
      process.stderr.write(`FATAL uncaught_exception: ${err?.message ?? String(err)}\n`);
    }
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    try {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      logger.error('unhandled_rejection', { error: errorMessage(err), stack: err.stack });
    } catch {
      process.stderr.write(`FATAL unhandled_rejection: ${String(reason)}\n`);
    }
    process.exit(1);
  });

  await runtime.app.start();
  scheduler?.start();
  startMetricsReporter(() => jobQueue.getStatus());

  // Post-setup welcome DM — send once after first successful setup
  try {
    const { sendWelcomeDmIfFirstRun } = await import('./setup/welcome.js');
    await sendWelcomeDmIfFirstRun(app.client, stores.configStore, config.allowedUserIds);
  } catch (err) {
    logger.warn('welcome_dm_failed', { error: errorMessage(err) });
  }

  logger.info('app_started', {
    allowed_users: config.allowedUserIds.length,
    default_tool: config.defaultTool,
    max_concurrency: config.maxConcurrency,
    claude_mcp_auth_server: config.claudeMcpAuthServer ?? 'disabled',
    gemini_mcp_auth_server: config.geminiMcpAuthServer ?? 'disabled',
    codex_mcp_auth_server: config.codexMcpAuthServer ?? 'disabled',
    server_api_port: config.serverApiPort,
    server_api_host: config.serverApiHost,
    server_api_auth: 'bearer_token',
  });
}
