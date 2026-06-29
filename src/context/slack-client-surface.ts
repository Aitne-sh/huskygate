/** @module slack-client-surface — Narrow subset of Slack WebClient methods used across shared layers */
import type { WebClient } from '@slack/web-api';

/**
 * Narrow subset of Slack Web API features used across shared layers.
 * `filesUploadV2` is a top-level WebClient helper, not `client.files.*`.
 */
export type SlackClientSurface = Pick<
  WebClient,
  'chat' | 'users' | 'conversations' | 'assistant' | 'filesUploadV2'
>;
