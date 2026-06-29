/** @module block-kit — Builds Slack Block Kit payloads for approval prompts, menus, and session controls */
import type {
  ActionsBlock,
  Button,
  ContextBlock,
  HeaderBlock,
  KnownBlock,
  MarkdownBlock,
  SectionBlock,
} from '@slack/types';
import type { ToolName } from '../config.js';
import type { PendingMcpAuthBypassApproval, PendingToolApproval } from '../context/app-types.js';
import type { SessionSummary } from '../session/manager.js';
import { formatApprovalArgsForMarkdown, resolveApprovedToolName } from '../shared/approval.js';
import type { DevAlias } from '../store/dev-alias.js';

// ---------------------------------------------------------------------------
// Action IDs — used by both block-kit builders and action-handlers
// ---------------------------------------------------------------------------

export const ACTION_TOOL_APPROVE = 'proxy_tool_approve';
export const ACTION_TOOL_REJECT = 'proxy_tool_reject';
export const ACTION_MCP_AUTH_APPROVE = 'proxy_mcp_auth_approve';
export const ACTION_MCP_AUTH_REJECT = 'proxy_mcp_auth_reject';
export const ACTION_SESSION_RESUME = 'proxy_session_resume';
export const ACTION_MODE_SELECT = 'proxy_mode_select';
export const ACTION_MENU_TOOL_SELECT = 'proxy_menu_tool_select';
export const ACTION_MENU_EXIT = 'proxy_menu_exit';
export const ACTION_MENU_STOP = 'proxy_menu_stop';
export const ACTION_MENU_NEW_SESSION = 'proxy_menu_new_session';
export const ACTION_MENU_RESET = 'proxy_menu_reset';
export const ACTION_MENU_DEV_SELECT = 'proxy_menu_dev_select';
export const ACTION_MENU_SESSION_LIST = 'proxy_menu_session_list';
export const ACTION_MENU_SESSION_CLEAR = 'proxy_menu_session_clear';
export const ACTION_MENU_SESSION_DELETE = 'proxy_menu_session_delete';
export const ACTION_MENU_SESSION_CLEAR_ALL = 'proxy_menu_session_clear_all';

// ---------------------------------------------------------------------------
// Value encoding — threadKey + requestId/sessionId packed into button value
// ---------------------------------------------------------------------------

export interface ActionValue {
  /** threadKey = channelId:threadTs */
  tk: string;
  /** requestId (approval) or sessionId (resume) */
  rid: string;
}

export function encodeActionValue(threadKey: string, id: string): string {
  return JSON.stringify({ tk: threadKey, rid: id } satisfies ActionValue);
}

export function decodeActionValue(raw: string): ActionValue {
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as ActionValue).tk !== 'string' ||
    typeof (parsed as ActionValue).rid !== 'string'
  ) {
    throw new TypeError(`Invalid action value: ${raw.slice(0, 200)}`);
  }
  return parsed as ActionValue;
}

// ---------------------------------------------------------------------------
// Block Kit Builders
// ---------------------------------------------------------------------------

/**
 * Tool approval prompt — [Approve] [Reject] buttons.
 * Displayed when a tool call needs user permission.
 */
export function buildToolApprovalBlocks(
  pending: PendingToolApproval,
  threadKey: string,
  expiresInSec: number,
): KnownBlock[] {
  const requestedTool = resolveApprovedToolName(pending) ?? 'unknown_tool';

  const infoSection: SectionBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*\`${pending.tool}\` needs permission for the next tool execution.*\nTool call: \`${requestedTool}\``,
    },
  };

  const argsBlock: MarkdownBlock = {
    type: 'markdown',
    text: formatApprovalArgsForMarkdown(pending.requestedToolArgs),
  };

  const actionsBlock: ActionsBlock = {
    type: 'actions',
    elements: [
      approveButton(ACTION_TOOL_APPROVE, encodeActionValue(threadKey, pending.requestId)),
      rejectButton(ACTION_TOOL_REJECT, encodeActionValue(threadKey, pending.requestId)),
    ],
  };

  const expiryContext: ContextBlock = {
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `Expires in ${expiresInSec}s — or reply \`!yes\` / \`!no\`` },
    ],
  };

  return [infoSection, argsBlock, actionsBlock, expiryContext];
}

/**
 * MCP auth bypass approval prompt — [Approve] [Reject] buttons.
 */
export function buildMcpAuthApprovalBlocks(
  pending: PendingMcpAuthBypassApproval,
  threadKey: string,
  expiresInSec: number,
): KnownBlock[] {
  const actionLabel =
    pending.action === 'retry_with_preauth'
      ? `Re-authenticate \`${pending.server}\` and retry`
      : `Skip MCP auth check for \`${pending.server}\` and retry`;

  const infoSection: SectionBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*\`${pending.tool}\` MCP auth required*\nServer: \`${pending.server}\`\nAction: ${actionLabel}`,
    },
  };

  const actionsBlock: ActionsBlock = {
    type: 'actions',
    elements: [
      approveButton(ACTION_MCP_AUTH_APPROVE, encodeActionValue(threadKey, pending.requestId)),
      rejectButton(ACTION_MCP_AUTH_REJECT, encodeActionValue(threadKey, pending.requestId)),
    ],
  };

  const expiryContext: ContextBlock = {
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `Expires in ${expiresInSec}s — or reply \`!yes\` / \`!no\`` },
    ],
  };

  return [infoSection, actionsBlock, expiryContext];
}

/**
 * Session list with [Resume] buttons.
 */
export function buildSessionListBlocks(
  sessions: SessionSummary[],
  threadKey: string,
): KnownBlock[] {
  if (sessions.length === 0) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'No sessions found for this thread. Start one with `!gemini`, `!claude`, or `!codex`.',
        },
      } satisfies SectionBlock,
    ];
  }

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Sessions' },
    },
  ];

  for (const session of sessions) {
    const activeLabel = session.active ? '  :large_green_circle:' : '';
    const originLabel = session.threadKey.startsWith('dashboard_') ? '  :computer: dashboard' : '';
    const sectionBlock: SectionBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `\`${session.sessionId}\` | *${session.tool}*${activeLabel}${originLabel}\nstarted: ${session.startedAt} | updated: ${session.updatedAt}`,
      },
    };

    if (!session.active) {
      sectionBlock.accessory = {
        type: 'button',
        text: { type: 'plain_text', text: 'Resume' },
        action_id: ACTION_SESSION_RESUME,
        value: encodeActionValue(threadKey, session.sessionId),
      };
    }

    blocks.push(sectionBlock);
  }

  return blocks;
}

/**
 * Session clear view with [Delete] buttons per session + [Clear All].
 * Posted as a follow-up message when the user clicks the "Clear" button on the dashboard.
 */
export function buildSessionClearBlocks(
  sessions: SessionSummary[],
  threadKey: string,
): KnownBlock[] {
  if (sessions.length === 0) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'No sessions to clear.',
        },
      } satisfies SectionBlock,
    ];
  }

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Session Cleanup' },
    } satisfies HeaderBlock,
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Choose sessions to delete, or clear all.',
      },
    } satisfies SectionBlock,
  ];

  for (const session of sessions) {
    const activeLabel = session.active ? '  :large_green_circle: active' : '';
    const originLabel = session.threadKey.startsWith('dashboard_') ? '  :computer: dashboard' : '';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `\`${session.sessionId}\` | *${session.tool}*${activeLabel}${originLabel}\nstarted: ${session.startedAt}`,
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: ':wastebasket: Delete' },
        style: 'danger',
        action_id: ACTION_MENU_SESSION_DELETE,
        value: encodeActionValue(threadKey, session.sessionId),
      },
    } satisfies SectionBlock);
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: ':wastebasket: Clear All Sessions' },
        style: 'danger',
        action_id: ACTION_MENU_SESSION_CLEAR_ALL,
        value: JSON.stringify({ tk: threadKey }),
      } satisfies Button,
    ],
  } satisfies ActionsBlock);

  return blocks;
}

/**
 * Mode selection — static_select with readonly / write options.
 * readonly is immediate; write triggers a challenge code.
 */
export function buildModeSelectBlocks(currentMode: string, threadKey: string): KnownBlock[] {
  const section: SectionBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `Current mode: *${currentMode}*`,
    },
    accessory: {
      type: 'static_select',
      action_id: ACTION_MODE_SELECT,
      placeholder: { type: 'plain_text', text: 'Switch mode...' },
      options: [
        {
          text: { type: 'plain_text', text: 'readonly' },
          value: JSON.stringify({ tk: threadKey, mode: 'readonly' }),
        },
        {
          text: { type: 'plain_text', text: 'write' },
          value: JSON.stringify({ tk: threadKey, mode: 'write' }),
        },
      ],
    },
  };

  return [section];
}

/**
 * Replaces approval buttons with a resolved status (approved / rejected).
 * Used after a user clicks [Approve] or [Reject] to update the original message.
 */
export function buildApprovalResolvedBlocks(
  action: 'approved' | 'rejected',
  toolOrServer: string,
  userId: string,
): KnownBlock[] {
  const emoji = action === 'approved' ? ':white_check_mark:' : ':x:';
  const label = action === 'approved' ? 'Approved' : 'Rejected';

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *${label}* — \`${toolOrServer}\` by <@${userId}>`,
      },
    } satisfies SectionBlock,
  ];
}

// ---------------------------------------------------------------------------
// Dashboard / Menu Builders
// ---------------------------------------------------------------------------

/** Tool selection info for the active session context. */
export interface ActiveSessionInfo {
  sessionId: string;
  tool: ToolName;
  mode: string;
  modeExpiresAt: string | null;
  model: string | null;
  workdir: string;
  runningJobId: string | null;
}

/**
 * Dashboard shown when NO active session exists.
 * Focus: tool selection + dev aliases + existing session list.
 */
export function buildMenuNoSessionBlocks(
  sessions: SessionSummary[],
  threadKey: string,
  devAliases: DevAlias[] = [],
): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // Header
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: ':zap: HuskyGate Dashboard' },
  } satisfies HeaderBlock);

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: ':wave: *Welcome back to HuskyGate!*\nAn AI gateway to run Claude / Gemini / Codex CLI from Slack.\nSelect a tool to start a session:',
    },
  } satisfies SectionBlock);

  // Tool selection + session management buttons (single ActionsBlock)
  const actionElements: Button[] = (['gemini', 'claude', 'codex'] as ToolName[]).map((tool) => ({
    type: 'button' as const,
    text: { type: 'plain_text' as const, text: tool },
    action_id: `${ACTION_MENU_TOOL_SELECT}_${tool}`,
    value: JSON.stringify({ tk: threadKey, tool }),
  }));

  // Session management buttons (only when sessions exist)
  if (sessions.length > 0) {
    actionElements.push({
      type: 'button',
      text: { type: 'plain_text', text: ':clipboard: Sessions' },
      action_id: ACTION_MENU_SESSION_LIST,
      value: JSON.stringify({ tk: threadKey }),
    });
    actionElements.push({
      type: 'button',
      text: { type: 'plain_text', text: ':wastebasket: Clear' },
      style: 'danger',
      action_id: ACTION_MENU_SESSION_CLEAR,
      value: JSON.stringify({ tk: threadKey }),
    });
  }

  blocks.push({
    type: 'actions',
    elements: actionElements,
  } satisfies ActionsBlock);

  // Dev aliases section (if any)
  blocks.push(...buildDevAliasBlocks(devAliases, threadKey));

  // Footer hint
  const footerParts = ['Type `!help` for a full command list.'];
  if (sessions.length > 0) {
    footerParts.push(`${sessions.length} session${sessions.length === 1 ? '' : 's'} available`);
  }
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: footerParts.join(' | '),
      },
    ],
  } satisfies ContextBlock);

  return blocks;
}

/**
 * Dashboard shown when an active session EXISTS.
 * Focus: session info + quick actions (exit, stop, mode, model display).
 */
export function buildMenuActiveSessionBlocks(
  info: ActiveSessionInfo,
  sessions: SessionSummary[],
  threadKey: string,
  devAliases: DevAlias[] = [],
): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // Header
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: ':zap: HuskyGate Dashboard' },
  } satisfies HeaderBlock);

  // Current session info
  const modeDisplay = info.modeExpiresAt
    ? `${info.mode} (expires: ${info.modeExpiresAt})`
    : info.mode;
  const modelDisplay = info.model ?? 'default';

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: [
        `*Active Session*: \`${info.sessionId}\``,
        `*App*: ${info.tool}  |  *Mode*: ${modeDisplay}`,
        `*Model*: ${modelDisplay}`,
        `*Workdir*: \`${info.workdir}\``,
        info.runningJobId
          ? `:hourglass: Running: \`${info.runningJobId}\``
          : ':white_check_mark: Idle',
      ].join('\n'),
    },
  } satisfies SectionBlock);

  // Quick actions
  const actionElements: Button[] = [];

  if (info.runningJobId) {
    actionElements.push({
      type: 'button',
      text: { type: 'plain_text', text: ':octagonal_sign: Stop' },
      style: 'danger',
      action_id: ACTION_MENU_STOP,
      value: JSON.stringify({ tk: threadKey }),
    });
  }

  actionElements.push({
    type: 'button',
    text: { type: 'plain_text', text: ':door: Exit Session' },
    action_id: ACTION_MENU_EXIT,
    value: JSON.stringify({ tk: threadKey }),
  });

  actionElements.push({
    type: 'button',
    text: { type: 'plain_text', text: ':new: New Session' },
    action_id: ACTION_MENU_NEW_SESSION,
    value: JSON.stringify({ tk: threadKey }),
  });

  actionElements.push({
    type: 'button',
    text: { type: 'plain_text', text: ':wastebasket: Reset' },
    style: 'danger',
    action_id: ACTION_MENU_RESET,
    value: JSON.stringify({ tk: threadKey }),
  });

  blocks.push({
    type: 'actions',
    elements: actionElements,
  } satisfies ActionsBlock);

  // Mode selector
  blocks.push(...buildModeSelectBlocks(info.mode, threadKey));

  // Dev aliases section (if any)
  blocks.push(...buildDevAliasBlocks(devAliases, threadKey));

  // Other sessions
  const otherSessions = sessions.filter((s) => s.sessionId !== info.sessionId);
  if (otherSessions.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'header',
      text: { type: 'plain_text', text: 'Other Sessions' },
    } satisfies HeaderBlock);

    for (const session of otherSessions) {
      const originLabel = session.threadKey.startsWith('dashboard_')
        ? '  :computer: dashboard'
        : '';
      const sectionBlock: SectionBlock = {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `\`${session.sessionId}\` | *${session.tool}*${originLabel}\nupdated: ${session.updatedAt}`,
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Resume' },
          action_id: ACTION_SESSION_RESUME,
          value: encodeActionValue(threadKey, session.sessionId),
        },
      };
      blocks.push(sectionBlock);
    }
  }

  // Footer hint
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: 'Type `!help` for a full command list. Send a message to continue the conversation.',
      },
    ],
  } satisfies ContextBlock);

  return blocks;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function approveButton(actionId: string, value: string): Button {
  return {
    type: 'button',
    text: { type: 'plain_text', text: 'Approve' },
    style: 'primary',
    action_id: actionId,
    value,
  };
}

function rejectButton(actionId: string, value: string): Button {
  return {
    type: 'button',
    text: { type: 'plain_text', text: 'Reject' },
    style: 'danger',
    action_id: actionId,
    value,
  };
}

/** Max buttons per ActionsBlock row for dev aliases (keeps layout readable). */
const DEV_ALIAS_BUTTONS_PER_ROW = 5;

/**
 * Dev alias buttons section.
 * Renders a divider + header + buttons grouped into ActionsBlocks of DEV_ALIAS_BUTTONS_PER_ROW.
 * Returns empty array when no aliases exist.
 */
function buildDevAliasBlocks(devAliases: DevAlias[], threadKey: string): KnownBlock[] {
  if (devAliases.length === 0) return [];

  const blocks: KnownBlock[] = [
    { type: 'divider' },
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Dev Environments' },
    } satisfies HeaderBlock,
  ];

  // Chunk alias buttons into groups to keep rows compact
  for (let i = 0; i < devAliases.length; i += DEV_ALIAS_BUTTONS_PER_ROW) {
    const chunk = devAliases.slice(i, i + DEV_ALIAS_BUTTONS_PER_ROW);
    const buttons: Button[] = chunk.map((alias) => ({
      type: 'button' as const,
      text: { type: 'plain_text' as const, text: `${alias.name} (${alias.tool})` },
      action_id: `${ACTION_MENU_DEV_SELECT}_${alias.name}`,
      value: JSON.stringify({ tk: threadKey, alias: alias.name }),
    }));

    blocks.push({
      type: 'actions',
      elements: buttons,
    } satisfies ActionsBlock);
  }

  return blocks;
}
