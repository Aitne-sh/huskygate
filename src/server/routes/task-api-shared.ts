/** @module server/routes/task-api-shared — Shared validation and helpers for task API routes. */
import type { AppContext } from '../../context/app-context.js';
import { FIELD_LIMITS, SLACK_USER_ID_RE } from '../../shared/field-limits.js';

/** Maximum length for instructionFile content (characters). */
export const MAX_INSTRUCTION_FILE_LENGTH = FIELD_LIMITS.instructionFile.max;

function normalizeOptionalTaskField(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

/**
 * Resolve the userId for a schedule / on-demand task.
 *
 * Priority:
 *  1. Explicit userId from the request (if valid Slack ID)
 *  2. notifyChannel when it is a Slack user ID (DM target)
 *  3. Fallback to 'dashboard'
 */
export function resolveTaskUserId(
  userIdInput: string | undefined,
  notifyChannel: string | undefined,
): string {
  const normalizedUserId = normalizeOptionalTaskField(userIdInput);
  const normalizedNotifyChannel = normalizeOptionalTaskField(notifyChannel);
  if (normalizedUserId && SLACK_USER_ID_RE.test(normalizedUserId)) return normalizedUserId;
  if (normalizedNotifyChannel && SLACK_USER_ID_RE.test(normalizedNotifyChannel)) {
    return normalizedNotifyChannel;
  }
  return normalizedUserId || 'dashboard';
}

export function resolvePatchedTaskUserId(
  parsed: Record<string, unknown>,
  currentNotifyChannel: string | null,
): string | undefined {
  const userIdProvided = 'userId' in parsed || 'user_id' in parsed;
  const notifyChannelProvided = 'notifyChannel' in parsed || 'notify_channel' in parsed;
  if (!userIdProvided && !notifyChannelProvided) return undefined;

  const rawUserId = parsed.userId ?? parsed.user_id;
  const explicitUserId =
    typeof rawUserId === 'string' ? normalizeOptionalTaskField(rawUserId) : undefined;
  const rawNotifyChannel = parsed.notifyChannel ?? parsed.notify_channel;
  const effectiveNotifyChannel = notifyChannelProvided
    ? typeof rawNotifyChannel === 'string'
      ? normalizeOptionalTaskField(rawNotifyChannel)
      : undefined
    : (currentNotifyChannel ?? undefined);

  return resolveTaskUserId(explicitUserId, effectiveNotifyChannel);
}

export function isAllowedTaskUserId(ctx: Pick<AppContext, 'config'>, userId: string): boolean {
  return userId === 'dashboard' || ctx.config.allowedUserIds.includes(userId);
}

export function validateCustomWorkdir(ctx: AppContext, rawWorkdir: unknown): string | null {
  if (typeof rawWorkdir !== 'string' || !rawWorkdir.trim()) return null;
  return ctx.workdirManager.validateCustomWorkdir(rawWorkdir.trim());
}
