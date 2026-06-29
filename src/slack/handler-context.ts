/** @module handler-context — Defines per-message HandlerContext and session lifecycle helpers for Slack handlers */
import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../context/app-context.js';
import type {
  ApprovalSlice,
  JobLifecycleSlice,
  SessionLookupSlice,
} from '../context/context-slices.js';
import type { Session } from '../session/types.js';
import type { SlackFileInfo } from '../shared/file-attachment.js';
import type { ChatClient } from './app-types.js';

/**
 * Per-message context passed to all command/approval handlers.
 */
export interface HandlerContext {
  ctx: AppContext;
  client: ChatClient;
  channelId: string;
  threadTs: string;
  userId: string;
  threadKey: string;
  slackFiles?: SlackFileInfo[];
}

export interface WorkdirDeletionResult {
  removed: boolean;
  skippedReason: string | null;
}

export function getActiveSessionRef(
  ctx: SessionLookupSlice,
  threadKey: string,
  userId: string,
): { sessionKey: string; session: Session } | null {
  // Single JOIN query returns session + registry data (1 query instead of 3)
  const result = ctx.sessionManager.getActiveSessionForThread(threadKey);
  if (!result) {
    // Clean up stale active pointer if the session was deleted
    const staleKey = ctx.sessionManager.getActiveSessionKey(threadKey);
    if (staleKey) ctx.sessionManager.clearActiveSession(threadKey);
    return null;
  }
  if (result.userId !== userId) return null;
  return { sessionKey: result.sessionKey, session: result.session };
}

export function stopSessionExecution(
  ctx: JobLifecycleSlice,
  sessionKey: string,
  reason: string,
): void {
  const activeRunner = ctx.activeRunners.get(sessionKey);
  if (activeRunner?.runner.isRunning()) {
    activeRunner.runner.kill(reason);
  }
  ctx.jobQueue.cancelSession(sessionKey);
  ctx.activeRunners.delete(sessionKey);
  ctx.sessionManager.setRunningJob(sessionKey, null);
}

export function clearPendingStateForSession(ctx: ApprovalSlice, sessionKey: string): void {
  for (const [pendingThreadKey, pending] of ctx.pendingConfirmations) {
    if (pending.sessionKey === sessionKey) {
      ctx.pendingConfirmations.delete(pendingThreadKey);
    }
  }
  for (const [pendingThreadKey, pending] of ctx.pendingToolApprovals) {
    if (pending.sessionKey === sessionKey) {
      ctx.pendingToolApprovals.delete(pendingThreadKey);
    }
  }
  for (const [pendingThreadKey, pending] of ctx.pendingMcpAuthBypassApprovals) {
    if (pending.sessionKey === sessionKey) {
      ctx.pendingMcpAuthBypassApprovals.delete(pendingThreadKey);
    }
  }
}

export function removeSessionWorkdir(
  ctx: Pick<AppContext, 'config'>,
  workdir: string,
): WorkdirDeletionResult {
  const resolvePathForDelete = (targetPath: string): string => {
    try {
      return fs.realpathSync(targetPath);
    } catch {
      return path.resolve(targetPath);
    }
  };

  const resolvedRoot = resolvePathForDelete(ctx.config.workdirRoot);
  const resolvedTarget = resolvePathForDelete(workdir);
  const isWithinRoot =
    resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
  if (!isWithinRoot) {
    return { removed: false, skippedReason: 'outside WORKDIR_ROOT' };
  }
  if (resolvedTarget === resolvedRoot) {
    return { removed: false, skippedReason: 'target is WORKDIR_ROOT' };
  }
  const existed = fs.existsSync(resolvedTarget);
  fs.rmSync(resolvedTarget, { recursive: true, force: true });
  return { removed: existed, skippedReason: null };
}

export function formatSessionWorkdirRemovalLine(
  workdir: string,
  workdirDeletion: WorkdirDeletionResult,
): string {
  if (workdirDeletion.skippedReason) {
    return `Workdir removal skipped (${workdirDeletion.skippedReason}): \`${workdir}\``;
  }
  if (workdirDeletion.removed) {
    return `Workdir removed: \`${workdir}\``;
  }
  return `Workdir already absent: \`${workdir}\``;
}

export function formatSessionClearedMessage(
  sessionId: string,
  tool: string,
  workdir: string,
  workdirDeletion: WorkdirDeletionResult,
): string {
  return [
    `Session cleared: id=\`${sessionId}\` app=\`${tool}\``,
    formatSessionWorkdirRemovalLine(workdir, workdirDeletion),
  ].join('\n');
}

export function formatSessionClearAllSummary(
  ctx: Pick<AppContext, 'config' | 'workdirManager'>,
  cleared: Array<{ workdir: string }>,
): string {
  const workdirs = Array.from(new Set(cleared.map((session) => session.workdir)));
  let removedWorkdirs = 0;
  const skippedWorkdirs: string[] = [];
  for (const workdir of workdirs) {
    const deletedWd = removeSessionWorkdir(ctx, workdir);
    if (deletedWd.skippedReason) {
      skippedWorkdirs.push(`\`${workdir}\` (${deletedWd.skippedReason})`);
      continue;
    }
    if (deletedWd.removed) removedWorkdirs += 1;
  }

  const orphanRemoved = ctx.workdirManager.cleanupUnusedSessionWorkdirs([]);
  const archivedDefault = ctx.workdirManager.archiveLegacyDefaultWorkdirIfUnused([]);
  const lines = [
    `Cleared all sessions: ${cleared.length}`,
    `Removed workdirs: ${removedWorkdirs + orphanRemoved}`,
  ];
  if (archivedDefault) {
    lines.push(`Archived legacy default workdir: \`${archivedDefault}\``);
  }
  if (skippedWorkdirs.length > 0) {
    lines.push(`Skipped workdir removals: ${skippedWorkdirs.join(', ')}`);
  }
  return lines.join('\n');
}
