/** @module server/slack-notification-service — Slack-backed implementation of NotificationService. */
import type { Config } from '../config.js';
import type { SlackClientSurface } from '../context/slack-client-surface.js';
import type {
  NotificationResult,
  NotificationService,
  NotifyTarget,
} from './notification-service.js';

/** Sends notifications and discovers targets via the Slack Web API. */
export class SlackNotificationService implements NotificationService {
  constructor(
    private readonly client: SlackClientSurface,
    private readonly config: Pick<Config, 'allowedUserIds'>,
  ) {}

  async postNotification(
    channel: string,
    text: string,
    threadTs?: string,
  ): Promise<NotificationResult> {
    const result = await this.client.chat.postMessage({
      channel,
      text,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
    return { ts: result.ts, channel: result.channel };
  }

  async listTargets(): Promise<NotifyTarget[]> {
    const targets = new Map<string, NotifyTarget>();
    const upsertTarget = (target: NotifyTarget): void => {
      const key = `${target.type}:${target.id}`;
      const existing = targets.get(key);
      if (!existing) {
        targets.set(key, target);
        return;
      }
      if (existing.name === existing.id && target.name !== target.id) {
        targets.set(key, target);
      }
    };
    const uniqueUserIds = [
      ...new Set(this.config.allowedUserIds.map((uid) => uid.trim()).filter(Boolean)),
    ];

    for (const uid of uniqueUserIds) {
      try {
        const info = await this.client.users.info({ user: uid });
        const displayName = info.user?.profile?.display_name || info.user?.real_name || uid;
        upsertTarget({ id: uid, name: displayName, type: 'user' });
      } catch {
        upsertTarget({ id: uid, name: uid, type: 'user' });
      }
    }

    try {
      let cursor: string | undefined;
      for (let page = 0; page < 3; page++) {
        const result = await this.client.conversations.list({
          types: 'public_channel,private_channel',
          exclude_archived: true,
          limit: 200,
          cursor,
        });
        for (const channel of result.channels ?? []) {
          if (channel.is_member && channel.id && channel.name) {
            upsertTarget({ id: channel.id, name: channel.name, type: 'channel' });
          }
        }
        cursor = result.response_metadata?.next_cursor;
        if (!cursor) break;
      }
    } catch {
      /* channels:read scope missing — skip channels */
    }

    return [...targets.values()].sort((left, right) => {
      if (left.type !== right.type) return left.type === 'user' ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  }
}
