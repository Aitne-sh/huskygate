/** @module setup/welcome — Post-setup welcome DM sender for first-run onboarding. */

import type { WebClient } from '@slack/web-api';
import type { ConfigStore } from '../store/config-store.js';
import { errorMessage } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import { getStrings } from './i18n.js';
import { WELCOME_DM_SENT_KEY } from './setup-command.js';

/**
 * Send a welcome DM to all allowed users if this is the first run after setup.
 *
 * Idempotent: uses `metadata.WELCOME_DM_SENT` as a guard. Once set, subsequent
 * calls are no-ops. This is safe to call on every server startup.
 *
 * Guards against premature firing: skips if setup is not complete (no
 * SLACK_BOT_TOKEN in config DB), preventing the flag from being set before
 * the user has run `huskygate setup`.
 */
export async function sendWelcomeDmIfFirstRun(
  client: WebClient,
  configStore: ConfigStore,
  allowedUserIds: readonly string[],
): Promise<void> {
  // Guard: already sent
  const sent = configStore.getMetadata(WELCOME_DM_SENT_KEY);
  if (sent !== null) return;

  // Guard: setup not yet complete — don't set the flag prematurely
  const botTokenRecord = configStore.get('SLACK_BOT_TOKEN');
  if (
    botTokenRecord == null ||
    (botTokenRecord.storage !== 'keychain_ref' &&
      (botTokenRecord.value == null || botTokenRecord.value.length === 0))
  ) {
    return;
  }

  // Guard: no users to message
  if (allowedUserIds.length === 0) {
    logger.info('welcome_dm_skip', { reason: 'no_allowed_users' });
    configStore.setMetadata(WELCOME_DM_SENT_KEY, new Date().toISOString());
    return;
  }

  const strings = getStrings();
  const text = `*${strings.welcomeTitle}*\n\n${strings.welcomeBody}`;

  let successCount = 0;
  const errors: string[] = [];

  for (const userId of allowedUserIds) {
    try {
      await client.chat.postMessage({
        channel: userId,
        text,
      });
      successCount++;
    } catch (err) {
      errors.push(`${userId}: ${errorMessage(err)}`);
    }
  }

  logger.info('welcome_dm_sent', {
    total: allowedUserIds.length,
    success: successCount,
    errors: errors.length,
  });

  if (errors.length > 0) {
    logger.warn('welcome_dm_errors', { errors });
  }

  // Mark as sent regardless of partial failures to avoid repeated DM spam
  configStore.setMetadata(WELCOME_DM_SENT_KEY, new Date().toISOString());
}
