/** @module notification-service — Interface for posting notifications and listing targets (e.g. Slack channels) */
export interface NotifyTarget {
  id: string;
  name: string;
  type: 'user' | 'channel';
}

export interface NotificationResult {
  ts?: string;
  channel?: string;
}

export interface NotificationService {
  postNotification(channel: string, text: string, threadTs?: string): Promise<NotificationResult>;
  listTargets(): Promise<NotifyTarget[]>;
}
