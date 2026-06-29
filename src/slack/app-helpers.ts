/** @module slack/app-helpers — Shared constants, pure utilities, and Slack API wrappers for the Slack domain. */
import crypto from 'node:crypto';
import type { KnownBlock } from '@slack/types';
import type { Config, ToolName } from '../config.js';
import type { AppContext } from '../context/app-context.js';
import type { SessionLookupSlice } from '../context/context-slices.js';
import { type DriverEvent, isAggregateTextEvent } from '../runner/types.js';
import type { SessionSummary } from '../session/manager.js';
import { SIZE_LIMITS, TIMEOUTS } from '../shared/constants.js';
import { errorMessage } from '../utils/error.js';
import type { ExpiringMap } from '../utils/expiring-map.js';
import { logger } from '../utils/logger.js';
import type { ChatClient, ContextTool, SlackApiErrorShape } from './app-types.js';
import { detectMcpAuthRequiredResourceUrl } from './mcp-auth.js';
import { CLAUDE_MCP_AUTH_BYPASS_SERVER_KEY } from './tools/claude.js';
import { GEMINI_MCP_AUTH_BYPASS_SERVER_KEY } from './tools/gemini.js';

// ── Constants ──

export const CHALLENGE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CHALLENGE_TIMEOUT_MS = TIMEOUTS.slackChallenge;
export const TOOL_APPROVAL_TIMEOUT_MS = TIMEOUTS.toolApproval;
export const MCP_AUTH_BYPASS_TIMEOUT_MS = TIMEOUTS.mcpAuthBypass;
export const CLAUDE_MCP_AUTH_AUTO_RERUN_KEY = 'claude_mcp_auth_auto_rerun';
export const CODEX_MCP_AUTH_AUTO_RERUN_KEY = 'codex_mcp_auth_auto_rerun';
export const MCP_CONN_RETRY_COUNT_KEY = 'mcp_conn_retry_count';
export const MAX_CHARS_FOR_LOG = SIZE_LIMITS.maxCharsForLog;

// ── Pure functions ──

export function generateChallengeCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CHALLENGE_CHARS.charAt(crypto.randomInt(CHALLENGE_CHARS.length));
  }
  return code;
}

export function getDefaultModelForTool(config: Config, tool: ToolName): string | null {
  switch (tool) {
    case 'claude':
      return config.claudeModel;
    case 'codex':
      return config.codexModel;
    case 'gemini':
      return config.geminiModel;
  }
}

/**
 * Schedule automatic expiry of a pending entry in an ExpiringMap.
 * After `timeoutMs`, if the entry still exists and matches `matchFn`, it is deleted.
 */
export function scheduleExpiry<T>(
  store: ExpiringMap<string, T>,
  sessionKey: string,
  matchFn: (item: T) => boolean,
  timeoutMs: number,
  label: string,
): void {
  setTimeout(() => {
    try {
      const pending = store.get(sessionKey);
      if (pending && matchFn(pending)) {
        store.delete(sessionKey);
      }
    } catch (err) {
      logger.warn(`${label}_expiry_cleanup_failed`, {
        error: errorMessage(err),
      });
    }
  }, timeoutMs);
}

export function getSlackApiError(err: unknown): SlackApiErrorShape | null {
  if (!err || typeof err !== 'object') return null;
  const maybe = err as SlackApiErrorShape;
  if (!maybe.code) return null;
  return maybe;
}

export function logSlackCommandError(
  err: unknown,
  context: { command: string; sessionKey: string },
): void {
  const slackErr = getSlackApiError(err);
  if (
    slackErr?.code === 'slack_webapi_platform_error' &&
    slackErr.data?.error === 'missing_scope'
  ) {
    logger.error('slack_missing_scope', {
      command: context.command,
      session_key: context.sessionKey,
      needed_scope: slackErr.data.needed ?? 'unknown',
      provided_scopes: slackErr.data.provided ?? 'unknown',
      hint: 'Use a bot token (xoxb) and add chat:write scope, then reinstall the app.',
    });
    return;
  }

  logger.error('slack_command_error', {
    command: context.command,
    session_key: context.sessionKey,
    error: errorMessage(err),
  });
}

export function buildSlackContextPrefix(tool: string, sessionId: string): string {
  return `[app:${tool}/session-id:${sessionId}]`;
}

export function withSlackContext(prefix: string, text: string): string {
  return `${prefix}\n${text}`;
}

export function hasGeminiResumeStateError(events: DriverEvent[]): boolean {
  return events.some((event) => {
    if (event.type !== 'error') return false;
    const normalized = event.content.replace(/^Error:\s*/i, '').trim();
    return /No previous sessions found for this project/i.test(normalized);
  });
}

export function detectMcpAuthRequiredResourceFromEvents(events: DriverEvent[]): string | null {
  for (const event of events) {
    if (event.type !== 'status' && event.type !== 'error' && event.type !== 'text') continue;
    const resourceUrl = detectMcpAuthRequiredResourceUrl(event.content);
    if (resourceUrl) return resourceUrl;
  }
  return null;
}

/** Extract the final human-readable answer from a sequence of driver events, stripping tool artifacts. */
export function extractAnswerText(events: DriverEvent[] | undefined | null): string {
  if (!events || events.length === 0) return '';
  let lastToolIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event && (event.type === 'tool_use' || event.type === 'tool_result')) {
      lastToolIdx = i;
      break;
    }
  }

  // Tier 1: Collect non-aggregate text after the last tool event.
  if (lastToolIdx >= 0) {
    const parts: string[] = [];
    for (let i = lastToolIdx + 1; i < events.length; i++) {
      const event = events[i];
      if (!event || event.type !== 'text') continue;
      if (isAggregateTextEvent(event)) continue;
      parts.push(event.content);
    }
    if (parts.join('').trim()) {
      return stripAnswerMarker(parts.join(''));
    }
  }

  // Tier 2: Fallback to the last aggregate text event (e.g. when no deltas
  // were emitted and the CLI only produced a 'result' / 'turn.completed').
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event || event.type !== 'text') continue;
    if (isAggregateTextEvent(event) && event.content.trim()) {
      return stripAnswerMarker(event.content);
    }
  }

  // Tier 3: All non-aggregate text events (no tools were called).
  const parts: string[] = [];
  for (const event of events) {
    if (event.type !== 'text') continue;
    if (isAggregateTextEvent(event)) continue;
    parts.push(event.content);
  }
  return stripAnswerMarker(parts.join(''));
}

/** Split at the **last** `<!-- answer -->` marker and return only the answer portion.
 *  When Gemini retries tool calls multiple times the marker accumulates;
 *  using `lastIndexOf` ensures we always take the final (correct) answer.
 *  Earlier markers in the discarded prefix are stripped so no artifacts leak. */
function stripAnswerMarker(text: string): string {
  const marker = '<!-- answer -->';
  const idx = text.lastIndexOf(marker);
  if (idx < 0) return text;
  const after = text.slice(idx + marker.length).trim();
  // If marker is at the very end (no answer after it), fall back to pre-marker text.
  if (after) return after;
  return text
    .slice(0, idx)
    .replaceAll(marker, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeForMrkdwn(input: string, maxLen = 200): string {
  return input.slice(0, maxLen).replaceAll('`', '\uFF40');
}

export function formatUnknownBangCommandError(input: string): string {
  return `Unknown system command: \`${sanitizeForMrkdwn(input)}\`\nRun \`!help\` to see available commands.`;
}

export function formatCommandListMessage(): string {
  return [
    '*Commands*',
    'All commands start with `!`.',
    '',
    '*Help*',
    '`!help` Show this command list',
    '`!menu` Open the interactive dashboard',
    '',
    '*Session*',
    '`!s` / `!session` Show session list',
    '`!current` Show current active session',
    '`!session <sessionId>` Resume the specified session',
    '`!session-clear <sessionId>` Delete the specified session',
    '`!session-clear all` Delete all sessions',
    '`!exit` Leave the active session',
    '',
    '*Apps*',
    '`!gemini` / `!claude` / `!codex` Connect to latest session (creates new if none)',
    '`!new gemini` / `!new claude` / `!new codex` Start a new session',
    '`!gemini <prompt>` / `!claude <prompt>` / `!codex <prompt>` Execute with prompt',
    '',
    '*Model*',
    '`!model` / `!m` Show current model',
    '`!model <name>` / `!m <name>` / `!m=<name>` Set model for this session',
    '`!model default` Reset to default',
    '',
    '*Run Control*',
    '`!stop` Stop the running job',
    '`!status` Show queue, mode, model, and workdir status',
    '`!reset` Reset the active session',
    '',
    '*Approval*',
    '`!yes` / `!y` Approve',
    '`!no` / `!n` Reject',
    '`!autorun` Toggle auto-approve mode for MCP tools',
    '`!autorun on` / `!autorun off` Explicitly enable or disable',
    '',
    '*Tasks*',
    '`!task <name|alias>` / `!t <name|alias>` Execute an on-demand task',
    '',
    '*Orchestrator*',
    '`!orch <alias|id>` / `!o <alias|id>` Start an orchestrator run',
    '`!orch list` / `!o list` List active orchestrators',
    '`!orch status <alias|id>` / `!o status <alias|id>` Show recent runs',
    '`!orch cancel <runId>` / `!o cancel <runId>` Cancel a running orchestration',
    '',
    '*Dev Mode*',
    '`!dev` Show dev alias list',
    '`!dev <alias>` Start or resume a dev session',
    '`!new-dev <alias>` Clear existing dev session and start fresh',
    '',
    '*Mode*',
    '`!mode=readonly` Switch to read-only mode',
    '`!mode=write` Request write mode (requires `!confirm XXXX`)',
    '`!mode=net` Disabled (Phase 1); use `!mode=readonly` or `!mode=write`',
    '',
    '*Workdir*',
    '`!workdir` Show current working directory',
    '`!workdir=<path>` Request directory change (requires `!confirm XXXX`)',
    '`!workdir=reset` Reset to default',
    '',
    '*MCP*',
    '`!mcp` Show MCP servers enabled for this session',
    '`!mcp + <name>` / `!mcp - <name>` Enable or disable a server for this session',
    '`!mcp reset` Restore the default (all servers enabled)',
    '',
    '*Confirm*',
    '`!confirm XXXX` Confirm a pending mode or workdir change (30s timeout)',
    '',
    '*Notes*',
    '- You must `!exit` before switching to another tool.',
    '- Auto `!exit` after 30 minutes of inactivity.',
  ].join('\n');
}

export function formatSessionListMessage(sessions: SessionSummary[]): string {
  if (sessions.length === 0) {
    return 'No sessions found for this thread. Start one with `!gemini`, `!claude`, or `!codex`.';
  }

  const lines = ['*Sessions*'];
  for (const session of sessions) {
    const activeLabel = session.active ? ' [active]' : '';
    lines.push(
      `- id=${session.sessionId} | app=${session.tool} | started=${session.startedAt} | updated=${session.updatedAt}${activeLabel}`,
    );
  }
  return lines.join('\n');
}

// ── Context-dependent helpers ──

export function toThreadKey(channelId: string, threadTs: string): string {
  if (channelId.includes(':')) {
    logger.warn('thread_key_invalid_channel_id', { channelId });
  }
  if (threadTs.includes(':')) {
    logger.warn('thread_key_invalid_thread_ts', { threadTs });
  }
  return `${channelId}:${threadTs}`;
}

export function fallbackSessionId(sessionKey: string): string {
  return crypto.createHash('sha256').update(sessionKey).digest('hex').slice(0, 8);
}

export function resolveContext(
  ctx: SessionLookupSlice,
  threadKey: string,
  options?: { sessionKey?: string; tool?: ContextTool },
): { tool: string; sessionId: string } {
  if (options?.sessionKey) {
    const summary = ctx.sessionManager.getSessionSummary(options.sessionKey);
    if (summary) {
      return { tool: summary.tool, sessionId: summary.sessionId };
    }
    return {
      tool: options.tool ?? 'none',
      sessionId: fallbackSessionId(options.sessionKey),
    };
  }

  const active = ctx.sessionManager.getActiveSessionSummary(threadKey);
  if (active) {
    return { tool: active.tool, sessionId: active.sessionId };
  }
  return { tool: options?.tool ?? 'none', sessionId: 'none' };
}

export async function postMessageWithContext(
  ctx: SessionLookupSlice,
  slackClient: ChatClient,
  channelId: string,
  threadTs: string,
  text: string,
  options?: { sessionKey?: string; tool?: ContextTool },
): Promise<void> {
  const threadKey = toThreadKey(channelId, threadTs);
  const context = resolveContext(ctx, threadKey, options);
  await slackClient.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: withSlackContext(buildSlackContextPrefix(context.tool, context.sessionId), text),
  });
}

/**
 * Post a message with Block Kit blocks + fallback text.
 * Returns the message timestamp (ts) for later updates.
 */
export async function postMessageWithBlocks(
  ctx: SessionLookupSlice,
  slackClient: ChatClient,
  channelId: string,
  threadTs: string,
  blocks: KnownBlock[],
  fallbackText: string,
  options?: { sessionKey?: string; tool?: ContextTool },
): Promise<string | undefined> {
  const threadKey = toThreadKey(channelId, threadTs);
  const context = resolveContext(ctx, threadKey, options);
  const result = await slackClient.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    blocks,
    text: withSlackContext(buildSlackContextPrefix(context.tool, context.sessionId), fallbackText),
  });
  return result.ts;
}

/**
 * Update an existing message's blocks (e.g. replace buttons with resolved status).
 */
export async function updateMessageBlocks(
  slackClient: ChatClient,
  channelId: string,
  messageTs: string,
  blocks: KnownBlock[],
  fallbackText: string,
): Promise<void> {
  await slackClient.chat.update({
    channel: channelId,
    ts: messageTs,
    blocks,
    text: fallbackText,
  });
}

export function clearInactivityTimer(
  ctx: Pick<AppContext, 'inactivityTimers'>,
  threadKey: string,
): void {
  const timer = ctx.inactivityTimers.get(threadKey);
  if (timer) {
    clearTimeout(timer);
    ctx.inactivityTimers.delete(threadKey);
  }
}

export function scheduleInactivityAutoExit(
  ctx: AppContext,
  threadKey: string,
  channelId: string,
  threadTs: string,
): void {
  clearInactivityTimer(ctx, threadKey);
  const timer = setTimeout(() => {
    void (async () => {
      const activeSessionKey = ctx.sessionManager.getActiveSessionKey(threadKey);
      if (!activeSessionKey) return;

      const running = ctx.activeRunners.get(activeSessionKey);
      if (running?.runner.isRunning()) {
        scheduleInactivityAutoExit(ctx, threadKey, channelId, threadTs);
        return;
      }

      const activeSummary = ctx.sessionManager.getSessionSummary(activeSessionKey);
      const activeSession = ctx.sessionManager.get(activeSessionKey);
      if (activeSession?.tool === 'claude') {
        ctx.sessionManager.updateToolState(activeSessionKey, {
          ...activeSession.toolState,
          claude_mcp_auth_approval_completed: undefined,
          [CLAUDE_MCP_AUTH_BYPASS_SERVER_KEY]: undefined,
        });
      } else if (activeSession?.tool === 'gemini') {
        ctx.sessionManager.updateToolState(activeSessionKey, {
          ...activeSession.toolState,
          [GEMINI_MCP_AUTH_BYPASS_SERVER_KEY]: undefined,
        });
      }
      ctx.sessionManager.clearActiveSession(threadKey);
      ctx.pendingConfirmations.delete(threadKey);
      ctx.pendingToolApprovals.delete(threadKey);
      ctx.pendingMcpAuthBypassApprovals.delete(threadKey);

      const timeoutMin = Math.round(ctx.config.sessionIdleTimeoutSec / 60);
      const label =
        timeoutMin >= 60 ? `${Math.round(timeoutMin / 60)} hour(s)` : `${timeoutMin} minute(s)`;
      try {
        await postMessageWithContext(
          ctx,
          ctx.webClient,
          channelId,
          threadTs,
          `No user message for ${label}. Session exited automatically.`,
          { sessionKey: activeSessionKey, tool: activeSummary?.tool ?? 'none' },
        );
      } catch (err) {
        logger.error('auto_exit_notification_failed', {
          thread_key: threadKey,
          error: errorMessage(err),
        });
      }
    })();
  }, ctx.config.sessionIdleTimeoutSec * 1000);
  ctx.inactivityTimers.set(threadKey, timer);
}
