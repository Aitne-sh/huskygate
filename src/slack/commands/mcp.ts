/** @module commands/mcp — MCP server management handlers */
import { postMessageWithContext } from '../app-helpers.js';
import type { HandlerContext } from '../handler-context.js';
import { getActiveSessionRef } from '../handler-context.js';
import { resolveSessionMcpSelection } from '../mcp-selection.js';
import type { CommandType } from '../parser.js';

function formatMcpServerListMessage(input: {
  sessionId: string;
  tool: string;
  mode: string;
  filterActive: boolean;
  allServers: ReadonlyArray<{ id: string; name: string; transport: string }>;
  enabledServerIds: ReadonlySet<string>;
  statusLine?: string;
}): string {
  const lines = [`*MCP Servers* (session: \`${input.sessionId}\`, tool: \`${input.tool}\`)`];
  if (input.statusLine) {
    lines.push(input.statusLine);
  }

  if (input.allServers.length === 0) {
    lines.push('No MCP servers are configured for this tool.');
  } else {
    for (const server of input.allServers) {
      const state = input.enabledServerIds.has(server.id) ? 'on ' : 'off';
      lines.push(`- ${state} ${server.name} (${server.transport})`);
    }
  }

  lines.push(
    input.filterActive
      ? 'Session filter is active. Changes apply to new jobs in this session.'
      : 'Using the default policy: all configured servers are enabled.',
  );
  lines.push('Use `!mcp + <name>`, `!mcp - <name>`, or `!mcp reset`.');
  if (input.mode === 'readonly') {
    lines.push('Readonly note: MCP stays blocked at runtime until `!mode=write`.');
  }
  return lines.join('\n');
}

async function postActiveSessionMcpMessage(
  hctx: HandlerContext,
  statusLine?: string,
): Promise<void> {
  const active = getActiveSessionRef(hctx.ctx, hctx.threadKey, hctx.userId);
  if (!active) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'No active session. Select one first with `!gemini`, `!claude`, or `!codex`.',
    );
    return;
  }

  const summary = hctx.ctx.sessionManager.getSessionSummary(active.sessionKey);
  const selection = resolveSessionMcpSelection(hctx.ctx, active.sessionKey, active.session.tool);
  await postMessageWithContext(
    hctx.ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    formatMcpServerListMessage({
      sessionId: summary?.sessionId ?? 'unknown',
      tool: active.session.tool,
      mode: active.session.mode,
      filterActive: selection.filterActive,
      allServers: selection.allServers,
      enabledServerIds: selection.enabledServerIds,
      statusLine,
    }),
    {
      sessionKey: active.sessionKey,
      tool: active.session.tool,
    },
  );
}

export async function handleMcp(
  hctx: HandlerContext,
  _command: Extract<CommandType, { kind: 'mcp' }>,
): Promise<void> {
  await postActiveSessionMcpMessage(hctx);
}

export async function handleMcpToggle(
  hctx: HandlerContext,
  command: Extract<CommandType, { kind: 'mcp_toggle' }>,
): Promise<void> {
  const active = getActiveSessionRef(hctx.ctx, hctx.threadKey, hctx.userId);
  if (!active) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'No active session. Select one first with `!gemini`, `!claude`, or `!codex`.',
    );
    return;
  }

  const selection = resolveSessionMcpSelection(hctx.ctx, active.sessionKey, active.session.tool);
  const target = selection.allServers.find(
    (server) => server.name.toLowerCase() === command.serverName.toLowerCase(),
  );
  if (!target) {
    const available =
      selection.allServers.length > 0
        ? selection.allServers.map((server) => `\`${server.name}\``).join(', ')
        : 'none';
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `MCP server \`${command.serverName}\` was not found for \`${active.session.tool}\`. Available: ${available}.`,
      {
        sessionKey: active.sessionKey,
        tool: active.session.tool,
      },
    );
    return;
  }

  hctx.ctx.sessionMcpServerStore.setEnabled(
    active.sessionKey,
    target.id,
    command.enabled,
    selection.allServers.map((server) => server.id),
  );

  await postActiveSessionMcpMessage(
    hctx,
    `Server \`${target.name}\` ${command.enabled ? 'enabled' : 'disabled'} for this session.`,
  );
}

export async function handleMcpReset(
  hctx: HandlerContext,
  _command: Extract<CommandType, { kind: 'mcp_reset' }>,
): Promise<void> {
  const active = getActiveSessionRef(hctx.ctx, hctx.threadKey, hctx.userId);
  if (!active) {
    await postMessageWithContext(
      hctx.ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'No active session. Select one first with `!gemini`, `!claude`, or `!codex`.',
    );
    return;
  }

  hctx.ctx.sessionMcpServerStore.reset(active.sessionKey);
  await postActiveSessionMcpMessage(hctx, 'Session MCP filter reset to the default (all enabled).');
}
