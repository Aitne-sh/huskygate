/** @module standalone-session-cleanup — Shared cleanup for temporary standalone sessions and workdirs. */
import path from 'node:path';
import { errorMessage } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import { cleanupWorkdir } from '../utils/workdir.js';

export interface StandaloneSessionCleanupContext {
  config: { workdirRoot: string };
  sessionManager: {
    get?: (sessionKey: string) => { workdir: string | null } | null;
    deleteSessionByKeyWithCleanup: (sessionKey: string) => { threadKey: string } | null;
  };
}

export interface StandaloneSessionCleanupInput {
  sessionKey: string;
  sessionWorkdir?: string | null;
  jobWorkdir?: string | null;
}

export function cleanupStandaloneSessionResources(
  ctx: StandaloneSessionCleanupContext,
  input: StandaloneSessionCleanupInput,
): void {
  const sessionWorkdir =
    input.sessionWorkdir ?? ctx.sessionManager.get?.(input.sessionKey)?.workdir ?? null;

  try {
    ctx.sessionManager.deleteSessionByKeyWithCleanup(input.sessionKey);
  } catch (err) {
    logger.warn('standalone_session_delete_failed', {
      sessionKey: input.sessionKey,
      error: errorMessage(err),
    });
  }

  const cleanupTargets = new Set<string>();
  if (sessionWorkdir) cleanupTargets.add(sessionWorkdir);
  if (input.jobWorkdir) cleanupTargets.add(input.jobWorkdir);

  for (const target of cleanupTargets) {
    try {
      cleanupWorkdir(ctx.config.workdirRoot, target);
    } catch (err) {
      logger.warn('standalone_workdir_cleanup_failed', {
        sessionKey: input.sessionKey,
        workdir: path.resolve(target),
        error: errorMessage(err),
      });
    }
  }
}
