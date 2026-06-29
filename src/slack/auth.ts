/** @module auth — Authorizes Slack users by DM channel type, user allowlist, and team membership */
import type { Config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface AuthContext {
  userId: string;
  channelId: string;
  channelType: string;
  teamId?: string;
}

export function isAuthorized(ctx: AuthContext, config: Config): boolean {
  // DM only
  if (ctx.channelType !== 'im') {
    logger.debug('auth_rejected_not_dm', { channel_type: ctx.channelType, user: ctx.userId });
    return false;
  }

  return isUserAllowed(ctx, config);
}

/**
 * Check user/team allowlist without requiring a specific channel type.
 * Used by Assistant threads which are not DMs but still need authorization.
 */
export function isUserAllowed(
  ctx: Pick<AuthContext, 'userId' | 'teamId'>,
  config: Config,
): boolean {
  // Allowlist check
  if (!config.allowedUserIds.includes(ctx.userId)) {
    logger.warn('auth_rejected_user', { user: ctx.userId });
    return false;
  }

  // Team check (if configured)
  if (config.allowedTeamId) {
    if (!ctx.teamId || ctx.teamId !== config.allowedTeamId) {
      logger.warn('auth_rejected_team', { team: ctx.teamId ?? 'unknown', user: ctx.userId });
      return false;
    }
  }

  return true;
}
