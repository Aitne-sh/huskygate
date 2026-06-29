/** @module slack/app-types — Shared type aliases for the Slack domain layer. */
import type { App } from '@slack/bolt';
import type { ToolName } from '../config.js';
import type { AppContext } from '../context/app-context.js';
import type { SlackClientSurface } from '../context/slack-client-surface.js';

export interface SlackApiErrorData {
  error?: string;
  needed?: string;
  provided?: string;
}

/** Shape of errors thrown by Slack Web API client (used for scope/permission diagnostics). */
export interface SlackApiErrorShape {
  code?: string;
  message?: string;
  data?: SlackApiErrorData;
}

/** Handle returned by {@link createApp} for lifecycle management. */
export interface AppRuntime {
  app: App;
  ctx: AppContext;
  shutdownRunningJobs: () => Promise<number>;
}

/** Minimal Slack client surface needed for posting/updating messages. */
export type ChatClient = Pick<SlackClientSurface, 'chat'>;

/** Tool identifier or 'none' when no session is active. */
export type ContextTool = ToolName | 'none';
