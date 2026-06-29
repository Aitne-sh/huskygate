/** @module slack/app — Bootstraps the Slack Bolt app with handlers, plugins, and lifecycle hooks. */
import type { App } from '@slack/bolt';
import type { AppContext } from '../context/app-context.js';
import { errorMessage } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import { registerActionHandlers } from './actions/register.js';
import { postMessageWithContext } from './app-helpers.js';
import type { AppRuntime } from './app-types.js';
import { registerAssistantHandlers } from './assistant.js';
import { registerJobExecutor } from './job-executor.js';
import { evictUserRateLimiter, registerMessageHandler } from './message-handler.js';
import { registerToolPlugin } from './tool-plugin.js';
import claudePlugin from './tools/claude-plugin.js';
import codexPlugin from './tools/codex-plugin.js';
import geminiPlugin from './tools/gemini-plugin.js';

export type { AppRuntime } from './app-types.js';

/** Wire all Slack handlers, register tool plugins, and return a runtime handle with graceful shutdown. */
export function createApp(ctx: AppContext, app: App): AppRuntime {
  registerToolPlugin(claudePlugin);
  registerToolPlugin(geminiPlugin);
  registerToolPlugin(codexPlugin);

  registerJobExecutor(ctx);
  registerMessageHandler(ctx, app);
  registerActionHandlers(ctx, app);

  // Uses app.event() instead of app.assistant() — the latter registers global
  // middleware that consumes all threaded DM messages, breaking existing !menu/!help etc.
  registerAssistantHandlers(ctx, app);

  // Defense-in-depth eviction (primary expiry is via setTimeout; this catches stragglers)
  const evictInterval = setInterval(() => {
    ctx.pendingConfirmations.evict();
    ctx.pendingToolApprovals.evict();
    ctx.pendingMcpAuthBypassApprovals.evict();
    ctx.assistantThreads.evict();
    evictUserRateLimiter();
  }, 60_000);

  const shutdownRunningJobs = async (): Promise<number> => {
    clearInterval(evictInterval);
    for (const timer of ctx.inactivityTimers.values()) {
      clearTimeout(timer);
    }
    ctx.inactivityTimers.clear();

    const running = [...ctx.activeRunners.values()];
    for (const active of running) {
      active.runner.kill('orchestrator_shutdown');
      ctx.jobQueue.cancelSession(active.job.sessionKey);
      // Skip Slack notification for dashboard/assistant-sourced jobs
      if (active.job.source === 'dashboard' || active.job.source === 'assistant') continue;
      try {
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          active.job.channelId,
          active.job.threadTs,
          'Orchestrator is shutting down. The running job was interrupted.',
          { sessionKey: active.job.sessionKey, tool: active.job.tool },
        );
      } catch (err) {
        logger.error('shutdown_notification_failed', {
          job_id: active.job.id,
          error: errorMessage(err),
        });
      }
    }
    return running.length;
  };

  return { app, ctx, shutdownRunningJobs };
}
