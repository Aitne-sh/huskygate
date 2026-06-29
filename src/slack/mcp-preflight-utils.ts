/** @module mcp-preflight-utils — Shared helpers for MCP preflight: tool-state merging, retry jobs, and approval flows */
/**
 * Shared helpers for MCP preflight implementations (Claude, Codex, Gemini).
 *
 * Eliminates copy-paste duplication of:
 * - "no auth server" early-return result construction
 * - Tool state merge after preflight success/failure
 * - Preflight failure cleanup (active runner, audit, messenger)
 * - Success completion logging
 * - Retry job creation
 * - Retry enqueue message posting
 */

import crypto from 'node:crypto';
import type { AppContext } from '../context/app-context.js';
import type { PendingMcpAuthBypassApproval } from '../context/app-types.js';
import type { SessionLookupSlice } from '../context/context-slices.js';
import type { Job } from '../queue/types.js';
import type { ToolState } from '../session/types.js';
import { errorMessage } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import {
  MCP_AUTH_BYPASS_TIMEOUT_MS,
  postMessageWithBlocks,
  postMessageWithContext,
  scheduleExpiry,
} from './app-helpers.js';
import { buildMcpAuthApprovalBlocks } from './block-kit.js';
import type {
  JobPreflightAbortResult,
  JobPreflightContext,
  JobPreflightResult,
} from './mcp-preflight.js';
import type { Messenger } from './messenger.js';

/* ── Early-return for unconfigured auth server ── */

export function noAuthServerResult(jpc: JobPreflightContext): JobPreflightResult {
  return {
    shouldReturn: false,
    env: jpc.env,
    sessionToolState: jpc.session.toolState,
    effectiveToolState: jpc.effectiveToolState,
  };
}

export function buildPreflightAbortResult(
  exitCode: number | null,
  errorKind: string,
  failureMessage: string,
): JobPreflightAbortResult {
  return {
    exitCode: exitCode ?? 1,
    errorKind,
    outputRaw: failureMessage,
    outputSummary:
      failureMessage.length > 4000
        ? `${failureMessage.slice(0, 4000)}… (truncated)`
        : failureMessage,
  };
}

/* ── Tool state merge after preflight ── */

export interface PreflightStateKeys {
  /** Primary verified key — all drivers have this */
  verified: string;
  /** Additional keys to set on success (e.g. initialized, clear bypass) */
  onSuccess?: Record<string, unknown>;
  /** Additional keys to clear on failure */
  clearOnFailure?: string[];
}

export function mergePreflightToolState(
  sessionToolState: ToolState,
  effectiveToolState: ToolState,
  preflightOk: boolean,
  authServer: string,
  keys: PreflightStateKeys,
): { sessionToolState: ToolState; effectiveToolState: ToolState } {
  const updated = { ...sessionToolState };
  let effective = { ...effectiveToolState };

  if (preflightOk) {
    updated[keys.verified] = authServer;
    effective = { ...effective, [keys.verified]: authServer };
    if (keys.onSuccess) {
      for (const [k, v] of Object.entries(keys.onSuccess)) {
        updated[k] = v;
        effective = { ...effective, [k]: v };
      }
    }
  } else {
    updated[keys.verified] = undefined;
    effective = { ...effective, [keys.verified]: undefined };
    if (keys.clearOnFailure) {
      for (const k of keys.clearOnFailure) {
        updated[k] = undefined;
        effective = { ...effective, [k]: undefined };
      }
    }
  }

  return { sessionToolState: updated, effectiveToolState: effective };
}

export function diffToolStatePatch(before: ToolState, after: ToolState): Partial<ToolState> {
  const patch: Partial<ToolState> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const beforeHas = Object.prototype.hasOwnProperty.call(before, key);
    const afterHas = Object.prototype.hasOwnProperty.call(after, key);
    if (!afterHas) {
      if (beforeHas) {
        patch[key] = undefined;
      }
      continue;
    }
    if (!beforeHas || !Object.is(before[key], after[key])) {
      patch[key] = after[key];
    }
  }
  return patch;
}

/* ── Preflight failure cleanup ── */

export async function handlePreflightFailure(
  ctx: Pick<AppContext, 'activeRunners' | 'sessionManager' | 'auditStore'>,
  job: Job,
  messenger: Messenger,
  exitCode: number | null,
  failureKind: string,
  failureMessage: string,
): Promise<void> {
  ctx.activeRunners.delete(job.sessionKey);
  ctx.sessionManager.setRunningJob(job.sessionKey, null);
  ctx.auditStore.logJobComplete(job.id, exitCode, failureKind);
  await messenger.postFinal(`\n*Error:* ${failureMessage}`);
}

/* ── Success completion logging ── */

export function logPreflightCompletion(
  tool: string,
  job: Job,
  authServer: string,
  eventsCount: number,
  messenger: Messenger,
): void {
  messenger.appendText(`MCP auth check for \`${authServer}\` completed.\n`);
  logger.info(`${tool}_mcp_auth_preflight_completed`, {
    job_id: job.id,
    session_key: job.sessionKey,
    server: authServer,
    events_count: eventsCount,
  });
}

/* ── Retry job creation ── */

export function createRetryJob(job: Job, extraOverrides: Record<string, unknown>): Job {
  return {
    id: crypto.randomUUID(),
    sessionKey: job.sessionKey,
    channelId: job.channelId,
    threadTs: job.threadTs,
    userId: job.userId,
    tool: job.tool,
    mode: job.mode,
    prompt: job.prompt,
    workdir: job.workdir,
    toolState: job.toolState,
    toolStateOverrides: {
      ...(job.toolStateOverrides ?? {}),
      ...extraOverrides,
    },
    createdAt: Date.now(),
  };
}

/* ── Retry enqueue messages ── */

export async function postRetryEnqueueMessages(
  ctx: SessionLookupSlice & Pick<AppContext, 'webClient'>,
  job: Job,
  server: string,
  toolLabel: string,
  enqueueResult: { position: number } | { error: string },
): Promise<void> {
  const meta = { sessionKey: job.sessionKey, tool: job.tool };

  if ('error' in enqueueResult) {
    await postMessageWithContext(
      ctx,
      ctx.webClient,
      job.channelId,
      job.threadTs,
      `${toolLabel} MCP authentication succeeded for \`${server}\`, but rerun enqueue failed: ${enqueueResult.error}`,
      meta,
    );
  } else if (enqueueResult.position > 0) {
    await postMessageWithContext(
      ctx,
      ctx.webClient,
      job.channelId,
      job.threadTs,
      `${toolLabel} MCP authentication succeeded for \`${server}\`. Re-running previous request (queued: ${enqueueResult.position}).`,
      meta,
    );
  } else {
    await postMessageWithContext(
      ctx,
      ctx.webClient,
      job.channelId,
      job.threadTs,
      `${toolLabel} MCP authentication succeeded for \`${server}\`. Re-running previous request now.`,
      meta,
    );
  }
}

/* ── Approval flow shared config ── */

export interface ApprovalFlowConfig {
  tool: PendingMcpAuthBypassApproval['tool'];
  action: PendingMcpAuthBypassApproval['action'];
  formatLoopMessage: (server: string) => string;
  formatApprovalText: (pending: PendingMcpAuthBypassApproval, timeoutSec: number) => string;
  formatFallbackText: (server: string, timeoutSec: number) => string;
}

/* ── Approval registration (shared by job-preflight + switch-preflight) ── */

export function registerMcpAuthApproval(
  ctx: Pick<AppContext, 'pendingMcpAuthBypassApprovals'>,
  threadKey: string,
  params: {
    sessionKey: string;
    tool: PendingMcpAuthBypassApproval['tool'];
    server: string;
    action: PendingMcpAuthBypassApproval['action'];
    prompt: string | null;
    userId: string;
  },
): PendingMcpAuthBypassApproval | null {
  const requestId = crypto.randomUUID().slice(0, 8);
  ctx.pendingMcpAuthBypassApprovals.set(
    threadKey,
    {
      ...params,
      requestId,
      expiresAt: Date.now() + MCP_AUTH_BYPASS_TIMEOUT_MS,
    },
    MCP_AUTH_BYPASS_TIMEOUT_MS,
  );
  scheduleExpiry(
    ctx.pendingMcpAuthBypassApprovals,
    threadKey,
    (p) => p.requestId === requestId,
    MCP_AUTH_BYPASS_TIMEOUT_MS,
    'mcp_auth_bypass',
  );
  return ctx.pendingMcpAuthBypassApprovals.get(threadKey) ?? null;
}

/* ── Full job-preflight approval flow (loop prevention + registration + Block Kit notification) ── */

export async function handleApprovalFlow(
  ctx: SessionLookupSlice & Pick<AppContext, 'pendingMcpAuthBypassApprovals' | 'webClient'>,
  job: Job,
  threadKey: string,
  authServer: string,
  isApprovalRerun: boolean,
  config: ApprovalFlowConfig,
): Promise<void> {
  if (isApprovalRerun) {
    try {
      await postMessageWithContext(
        ctx,
        ctx.webClient,
        job.channelId,
        job.threadTs,
        config.formatLoopMessage(authServer),
        { sessionKey: job.sessionKey, tool: job.tool },
      );
    } catch (err) {
      logger.error('mcp_auth_loop_prevention_notice_failed', {
        tool: job.tool,
        session_key: job.sessionKey,
        job_id: job.id,
        error: errorMessage(err),
      });
    }
    return;
  }

  const timeoutSec = Math.round(MCP_AUTH_BYPASS_TIMEOUT_MS / 1000);
  const pending = registerMcpAuthApproval(ctx, threadKey, {
    sessionKey: job.sessionKey,
    tool: config.tool,
    server: authServer,
    action: config.action,
    prompt: job.prompt,
    userId: job.userId,
  });

  const meta = { sessionKey: job.sessionKey, tool: job.tool };

  try {
    if (pending) {
      const blocks = buildMcpAuthApprovalBlocks(pending, threadKey, timeoutSec);
      await postMessageWithBlocks(
        ctx,
        ctx.webClient,
        job.channelId,
        job.threadTs,
        blocks,
        config.formatApprovalText(pending, timeoutSec),
        meta,
      );
    } else {
      await postMessageWithContext(
        ctx,
        ctx.webClient,
        job.channelId,
        job.threadTs,
        config.formatFallbackText(authServer, timeoutSec),
        meta,
      );
    }
  } catch (err) {
    logger.error('mcp_auth_bypass_request_failed', {
      tool: job.tool,
      session_key: job.sessionKey,
      job_id: job.id,
      error: errorMessage(err),
    });
  }
}
