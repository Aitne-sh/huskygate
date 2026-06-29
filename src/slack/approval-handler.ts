/** @module approval-handler — Processes tool and MCP-auth approval/rejection decisions from Slack interactions */
import crypto from 'node:crypto';
import type { AppContext } from '../context/app-context.js';
import type { PendingMcpAuthBypassApproval, PendingToolApproval } from '../context/app-types.js';
import type { Job } from '../queue/types.js';
import type { ToolState } from '../session/types.js';
import {
  buildClaudeMcpToolRerunPrompt,
  buildCodexMcpToolRerunPrompt,
  buildGeminiSingleToolRerunPrompt,
  formatToolApprovalPrompt,
  isWildcardToolApprovalTarget,
  resolveApprovedToolName,
  sanitizeStickyApprovalState,
} from '../shared/approval.js';
import {
  TOOL_APPROVAL_RERUN_KEY,
  extractMcpShortToolName,
  mergeApprovedAllowlistTools,
} from '../shared/tool-approval.js';
import { logSlackCommandError, postMessageWithContext } from './app-helpers.js';
import { parseApprovalDecision } from './approval.js';
import type { HandlerContext } from './handler-context.js';
import {
  CLAUDE_MCP_AUTH_APPROVAL_ACTION_KEY,
  CLAUDE_MCP_AUTH_APPROVAL_RERUN_KEY,
  CLAUDE_MCP_AUTH_BYPASS_SERVER_KEY,
  formatClaudeMcpApprovalPrompt,
} from './tools/claude.js';
import {
  appendCodexApprovedToolCall,
  buildCodexApprovalToolStateOverridesForCalls,
} from './tools/codex.js';
import {
  GEMINI_MCP_AUTH_APPROVAL_ACTION_KEY,
  GEMINI_MCP_AUTH_APPROVAL_RERUN_KEY,
  GEMINI_MCP_AUTH_BYPASS_SERVER_KEY,
  formatGeminiMcpApprovalPrompt,
} from './tools/gemini.js';

// ---------------------------------------------------------------------------
// Shared approval decision processors
// Used by both text-based handlers and Block Kit action handlers.
// ---------------------------------------------------------------------------

export interface ApprovalOutcome {
  message: string;
  target: string; // tool name or server name
}

/**
 * Execute the "approve" path for a pending tool approval.
 * Deletes the pending entry, prepares the retry job, and enqueues it.
 * Returns a result message for display.
 */
export async function processToolApprove(
  ctx: AppContext,
  pending: PendingToolApproval,
  threadKey: string,
  channelId: string,
  threadTs: string,
  userId: string,
): Promise<ApprovalOutcome> {
  ctx.pendingToolApprovals.delete(threadKey);

  const session = ctx.sessionManager.get(pending.sessionKey);
  if (!session) {
    return { message: 'Cannot rerun: the source session no longer exists.', target: pending.tool };
  }

  // P2: readonly sessions must never approve MCP tools (defense-in-depth)
  if (session.mode === 'readonly') {
    const toolName = resolveApprovedToolName(pending) ?? pending.tool;
    const isMcp =
      typeof pending.requestedToolName === 'string' &&
      (pending.requestedToolName.startsWith('mcp__') ||
        pending.requestedToolName.startsWith('mcp_'));
    if (isMcp) {
      ctx.conversationStore.saveMessage(
        pending.sessionKey,
        'system',
        JSON.stringify({
          type: 'tool_approval_result',
          requestId: pending.requestId,
          decision: 'denied',
        }),
      );
      return {
        message: `MCP tool \`${toolName}\` cannot be approved in readonly mode.`,
        target: toolName,
      };
    }
  }
  ctx.sessionManager.setActiveSessionKey(threadKey, pending.sessionKey);

  let nextToolState: ToolState;

  if (session.tool !== pending.tool) {
    // Tool switch: updateTool() resets tool_state and clears session_mcp_servers
    ctx.sessionManager.updateTool(pending.sessionKey, pending.tool);
    nextToolState = {};
  } else {
    // Same tool: sanitize stale approval entries
    const sanitizedState = sanitizeStickyApprovalState(session.toolState);
    if (sanitizedState.changed) {
      ctx.sessionManager.updateToolState(pending.sessionKey, sanitizedState.toolState);
    }
    nextToolState = sanitizedState.changed ? sanitizedState.toolState : session.toolState;
  }

  const approvedToolName = resolveApprovedToolName(pending);
  const requiresAllowlist = pending.tool === 'claude' || pending.tool === 'gemini';
  if (requiresAllowlist && !approvedToolName) {
    return {
      message: `Approval was accepted for \`${pending.tool}\`, but denied tool names could not be identified. Please run the request again with more specific instructions.`,
      target: pending.tool,
    };
  }

  if (pending.tool === 'codex' && !approvedToolName) {
    return {
      message:
        'Approval was accepted for `codex`, but the tool name could not be identified. Please retry with a more specific request.',
      target: pending.tool,
    };
  }
  if (approvedToolName && isWildcardToolApprovalTarget(approvedToolName)) {
    return {
      message:
        'Approval was accepted, but wildcard tool patterns are not allowed for one-shot reruns. Please retry and approve a concrete tool call instead.',
      target: approvedToolName,
    };
  }
  let toolStateOverrides: ToolState | undefined;

  if (pending.tool === 'codex' && approvedToolName) {
    let withApprovedCall = appendCodexApprovedToolCall(
      pending.approvedCodexToolCalls,
      approvedToolName,
      pending.requestedToolArgs,
    );
    const mcpShortName = extractMcpShortToolName(approvedToolName);
    if (mcpShortName) {
      withApprovedCall = appendCodexApprovedToolCall(
        withApprovedCall,
        mcpShortName,
        pending.requestedToolArgs,
      );
    }
    toolStateOverrides = buildCodexApprovalToolStateOverridesForCalls(withApprovedCall);
  } else if (approvedToolName) {
    const shortName = extractMcpShortToolName(approvedToolName);
    const toolsToApprove = shortName ? [approvedToolName, shortName] : [approvedToolName];
    toolStateOverrides = mergeApprovedAllowlistTools(pending.tool, {}, toolsToApprove);
  }

  if (pending.tool === 'gemini' && pending.skipGeminiMcpPreflightOnce) {
    toolStateOverrides = {
      ...(toolStateOverrides ?? {}),
      gemini_skip_mcp_preflight_once: true,
    };
  }

  // Mark as tool-approval rerun so the job executor can skip saving
  // the generated retry prompt as a user message.
  toolStateOverrides = {
    ...(toolStateOverrides ?? {}),
    [TOOL_APPROVAL_RERUN_KEY]: true,
  };

  let retryPrompt = pending.prompt;
  if (pending.tool === 'gemini' && approvedToolName) {
    retryPrompt = buildGeminiSingleToolRerunPrompt(
      pending.prompt,
      approvedToolName,
      pending.requestedToolArgs,
    );
  } else if (pending.tool === 'claude' && approvedToolName?.startsWith('mcp__')) {
    retryPrompt = buildClaudeMcpToolRerunPrompt(approvedToolName, pending.requestedToolArgs);
  } else if (pending.tool === 'codex' && approvedToolName) {
    retryPrompt = buildCodexMcpToolRerunPrompt(
      pending.prompt,
      approvedToolName,
      pending.requestedToolArgs,
    );
  }

  ctx.workdirManager.prepareWorkdirSkillsOnly(session.workdir, pending.tool);

  const retryJob: Job = {
    id: crypto.randomUUID(),
    sessionKey: pending.sessionKey,
    channelId,
    threadTs,
    userId,
    tool: pending.tool,
    mode: session.mode,
    prompt: retryPrompt,
    workdir: session.workdir,
    toolState: nextToolState,
    toolStateOverrides,
    createdAt: Date.now(),
  };

  const enqueueResult = ctx.jobQueue.enqueue(retryJob);
  const approvedText = approvedToolName ?? 'requested operation';

  // Sync decision to dashboard — the dashboard polls for new system messages
  // and replaces Approve/Deny buttons with a resolved badge.
  ctx.conversationStore.saveMessage(
    pending.sessionKey,
    'system',
    JSON.stringify({
      type: 'tool_approval_result',
      requestId: pending.requestId,
      decision: 'approved',
    }),
  );

  if ('error' in enqueueResult) {
    return {
      message: `Approval accepted for \`${pending.tool}\` tool call \`${approvedText}\`, but enqueue failed: ${enqueueResult.error}`,
      target: approvedText,
    };
  }
  if (enqueueResult.position > 0) {
    return {
      message: `Approved \`${pending.tool}\` tool call \`${approvedText}\` for one execution. Re-running previous request (queued: ${enqueueResult.position}).`,
      target: approvedText,
    };
  }
  return {
    message: `Approved \`${pending.tool}\` tool call \`${approvedText}\` for one execution. Re-running previous request now.`,
    target: approvedText,
  };
}

/**
 * Execute the "reject" path for a pending tool approval.
 */
export function processToolReject(
  ctx: AppContext,
  pending: PendingToolApproval,
  threadKey: string,
): ApprovalOutcome {
  ctx.pendingToolApprovals.delete(threadKey);

  const resolvedName = resolveApprovedToolName(pending);
  const toolName = resolvedName ?? pending.tool;

  // Store the denied tool name in session state so the next user message can
  // include denial context in the prompt.  This avoids an immediate re-run
  // (infinite approval loop) while preserving --resume history for follow-up.
  {
    const session = ctx.sessionManager.get(pending.sessionKey);
    if (session) {
      const existing = Array.isArray(session.toolState.denied_tools)
        ? session.toolState.denied_tools
        : [];
      // Use the resolved tool name, or a sentinel when the specific tool
      // could not be identified (prevents the loop even on parse failures).
      const denialEntry = resolvedName ?? '_previous_request_';
      if (!existing.includes(denialEntry)) {
        ctx.sessionManager.mergeToolState(pending.sessionKey, {
          denied_tools: [...existing, denialEntry],
        });
      }
    }
  }

  // Sync decision to dashboard
  ctx.conversationStore.saveMessage(
    pending.sessionKey,
    'system',
    JSON.stringify({
      type: 'tool_approval_result',
      requestId: pending.requestId,
      decision: 'denied',
    }),
  );
  return {
    message: `Approval rejected. The previous \`${pending.tool}\` request was not rerun.`,
    target: toolName,
  };
}

/**
 * Execute the "approve" path for a pending MCP auth bypass approval.
 */
export async function processMcpAuthApprove(
  ctx: AppContext,
  pending: PendingMcpAuthBypassApproval,
  threadKey: string,
  channelId: string,
  threadTs: string,
  userId: string,
): Promise<ApprovalOutcome> {
  ctx.pendingMcpAuthBypassApprovals.delete(threadKey);

  // P2: readonly sessions must never approve MCP auth (defense-in-depth)
  const mcpSession = ctx.sessionManager.get(pending.sessionKey);
  if (mcpSession?.mode === 'readonly') {
    ctx.conversationStore.saveMessage(
      pending.sessionKey,
      'system',
      JSON.stringify({
        type: 'tool_approval_result',
        requestId: pending.requestId,
        decision: 'denied',
      }),
    );
    return {
      message: `MCP auth for server \`${pending.server}\` cannot be approved in readonly mode.`,
      target: pending.server,
    };
  }

  // Sync decision to dashboard
  ctx.conversationStore.saveMessage(
    pending.sessionKey,
    'system',
    JSON.stringify({
      type: 'tool_approval_result',
      requestId: pending.requestId,
      decision: 'approved',
    }),
  );

  if (!pending.prompt) {
    const session = ctx.sessionManager.get(pending.sessionKey);
    if (session) {
      let nextToolState = session.toolState;
      let persistToolState = false;

      if (pending.tool === 'claude' && pending.action === 'retry_with_preauth') {
        nextToolState = {
          ...nextToolState,
          claude_mcp_auth_approval_completed: true,
        };
        persistToolState = true;
      }

      if (pending.action === 'skip_preflight_once') {
        if (pending.tool === 'claude') {
          nextToolState = {
            ...nextToolState,
            [CLAUDE_MCP_AUTH_BYPASS_SERVER_KEY]: pending.server,
          };
          persistToolState = true;
        } else if (pending.tool === 'gemini') {
          nextToolState = {
            ...nextToolState,
            [GEMINI_MCP_AUTH_BYPASS_SERVER_KEY]: pending.server,
          };
          persistToolState = true;
        }
      }

      if (persistToolState) {
        ctx.sessionManager.updateToolState(pending.sessionKey, nextToolState);
      }
    }
    ctx.sessionManager.setActiveSessionKey(threadKey, pending.sessionKey);
    const toolLabel = pending.tool === 'claude' ? 'Claude' : 'Gemini';
    return {
      message:
        pending.action === 'retry_with_preauth'
          ? `Approved MCP auth retry, but no prompt was attached. Send your next ${toolLabel} request.`
          : `Approved ${toolLabel} MCP auth bypass for this session. Send your next ${toolLabel} request.`,
      target: pending.server,
    };
  }

  const session = ctx.sessionManager.get(pending.sessionKey);
  if (!session) {
    return {
      message: 'Cannot rerun: the source session no longer exists.',
      target: pending.server,
    };
  }
  ctx.sessionManager.setActiveSessionKey(threadKey, pending.sessionKey);

  let nextToolState: ToolState;
  let persistToolState = false;

  if (session.tool !== pending.tool) {
    // Tool switch: updateTool() resets tool_state and clears session_mcp_servers
    ctx.sessionManager.updateTool(pending.sessionKey, pending.tool);
    nextToolState = {};
    persistToolState = true;
  } else {
    const sanitizedState = sanitizeStickyApprovalState(session.toolState);
    persistToolState = sanitizedState.changed;
    nextToolState = sanitizedState.changed ? sanitizedState.toolState : session.toolState;
  }

  const shouldMarkClaudeApprovalCompleted =
    pending.tool === 'claude' && pending.action === 'retry_with_preauth';

  if (persistToolState) {
    ctx.sessionManager.updateToolState(pending.sessionKey, nextToolState);
  }

  ctx.workdirManager.prepareWorkdirSkillsOnly(session.workdir, pending.tool);
  const mcpRetryOverrides: ToolState = {};
  if (pending.tool === 'claude') {
    mcpRetryOverrides[CLAUDE_MCP_AUTH_APPROVAL_RERUN_KEY] = true;
    mcpRetryOverrides[CLAUDE_MCP_AUTH_APPROVAL_ACTION_KEY] = pending.action;
    if (pending.action === 'skip_preflight_once') {
      mcpRetryOverrides.claude_skip_mcp_preflight_once = true;
    }
  } else {
    mcpRetryOverrides[GEMINI_MCP_AUTH_APPROVAL_RERUN_KEY] = true;
    mcpRetryOverrides[GEMINI_MCP_AUTH_APPROVAL_ACTION_KEY] = pending.action;
    if (pending.action === 'skip_preflight_once') {
      mcpRetryOverrides.gemini_skip_mcp_preflight_once = true;
    }
  }

  const retryJob: Job = {
    id: crypto.randomUUID(),
    sessionKey: pending.sessionKey,
    channelId,
    threadTs,
    userId,
    tool: pending.tool,
    mode: session.mode,
    prompt: pending.prompt,
    workdir: session.workdir,
    toolState: nextToolState,
    toolStateOverrides: mcpRetryOverrides,
    createdAt: Date.now(),
  };

  const enqueueResult = ctx.jobQueue.enqueue(retryJob);
  const approvedAction =
    pending.action === 'retry_with_preauth'
      ? 'Approved MCP auth retry.'
      : 'Approved MCP auth bypass for one run.';

  if ('error' in enqueueResult) {
    return {
      message: `${approvedAction} Enqueue failed: ${enqueueResult.error}`,
      target: pending.server,
    };
  }
  if (shouldMarkClaudeApprovalCompleted) {
    // Persist session-level rerun suppression only after the retry was accepted by the queue.
    ctx.sessionManager.mergeToolState(pending.sessionKey, {
      claude_mcp_auth_approval_completed: true,
    });
  }
  if (enqueueResult.position > 0) {
    return {
      message:
        pending.action === 'retry_with_preauth'
          ? `Approved MCP auth retry. Re-running previous request with MCP pre-auth check (queued: ${enqueueResult.position}).`
          : `Approved MCP auth bypass for one run. Re-running previous request (queued: ${enqueueResult.position}).`,
      target: pending.server,
    };
  }
  return {
    message:
      pending.action === 'retry_with_preauth'
        ? 'Approved MCP auth retry. Re-running previous request with MCP pre-auth check now.'
        : 'Approved MCP auth bypass for one run. Re-running previous request now.',
    target: pending.server,
  };
}

/**
 * Execute the "reject" path for a pending MCP auth bypass approval.
 */
export function processMcpAuthReject(
  ctx: AppContext,
  pending: PendingMcpAuthBypassApproval,
  threadKey: string,
): ApprovalOutcome {
  ctx.pendingMcpAuthBypassApprovals.delete(threadKey);

  // Sync decision to dashboard
  ctx.conversationStore.saveMessage(
    pending.sessionKey,
    'system',
    JSON.stringify({
      type: 'tool_approval_result',
      requestId: pending.requestId,
      decision: 'denied',
    }),
  );

  const rejectedAction =
    pending.action === 'retry_with_preauth' ? 'MCP auth retry' : 'MCP auth bypass';
  return {
    message: `${rejectedAction} rejected. The previous \`${pending.tool}\` request was not rerun.`,
    target: pending.server,
  };
}

/**
 * Handle a pending MCP auth bypass approval for the current thread.
 * Returns `true` if an approval was pending and handled (caller should return),
 * `false` if no pending approval existed.
 */
export async function handleMcpAuthBypassApproval(
  hctx: HandlerContext,
  text: string,
): Promise<boolean> {
  const { ctx, client, channelId, threadTs, userId, threadKey } = hctx;
  const pendingMcpAuthBypass = ctx.pendingMcpAuthBypassApprovals.get(threadKey);
  if (!pendingMcpAuthBypass) return false;

  try {
    if (Date.now() > pendingMcpAuthBypass.expiresAt) {
      ctx.pendingMcpAuthBypassApprovals.delete(threadKey);
      await postMessageWithContext(
        ctx,
        client,
        channelId,
        threadTs,
        'MCP auth approval request expired. Send your prompt again if you still want to proceed.',
        { sessionKey: pendingMcpAuthBypass.sessionKey, tool: pendingMcpAuthBypass.tool },
      );
      return true;
    }

    if (userId !== pendingMcpAuthBypass.userId) {
      await postMessageWithContext(
        ctx,
        client,
        channelId,
        threadTs,
        'Only the user who requested the previous run can approve this MCP auth action.',
        { sessionKey: pendingMcpAuthBypass.sessionKey, tool: pendingMcpAuthBypass.tool },
      );
      return true;
    }

    const decision = parseApprovalDecision(text);
    if (!decision) {
      const remainingSec = Math.max(
        1,
        Math.ceil((pendingMcpAuthBypass.expiresAt - Date.now()) / 1000),
      );
      const reminderMessage =
        pendingMcpAuthBypass.tool === 'claude'
          ? formatClaudeMcpApprovalPrompt(pendingMcpAuthBypass, remainingSec)
          : formatGeminiMcpApprovalPrompt(pendingMcpAuthBypass, remainingSec);
      await postMessageWithContext(ctx, client, channelId, threadTs, reminderMessage, {
        sessionKey: pendingMcpAuthBypass.sessionKey,
        tool: pendingMcpAuthBypass.tool,
      });
      return true;
    }

    const outcome =
      decision === 'reject'
        ? processMcpAuthReject(ctx, pendingMcpAuthBypass, threadKey)
        : await processMcpAuthApprove(
            ctx,
            pendingMcpAuthBypass,
            threadKey,
            channelId,
            threadTs,
            userId,
          );

    await postMessageWithContext(ctx, client, channelId, threadTs, outcome.message, {
      sessionKey: pendingMcpAuthBypass.sessionKey,
      tool: pendingMcpAuthBypass.tool,
    });
  } catch (err) {
    logSlackCommandError(err, { command: 'mcp_auth_bypass', sessionKey: threadKey });
  }
  return true;
}

/**
 * Handle a pending tool approval for the current thread.
 * Returns `true` if an approval was pending and handled (caller should return),
 * `false` if no pending approval existed.
 */
export async function handleToolApproval(hctx: HandlerContext, text: string): Promise<boolean> {
  const { ctx, client, channelId, threadTs, userId, threadKey } = hctx;
  const pendingToolApproval = ctx.pendingToolApprovals.get(threadKey);
  if (!pendingToolApproval) return false;

  try {
    if (Date.now() > pendingToolApproval.expiresAt) {
      ctx.pendingToolApprovals.delete(threadKey);
      await postMessageWithContext(
        ctx,
        client,
        channelId,
        threadTs,
        'Approval request expired. Send your prompt again if you still want to proceed.',
        { sessionKey: pendingToolApproval.sessionKey, tool: pendingToolApproval.tool },
      );
      return true;
    }

    if (userId !== pendingToolApproval.userId) {
      await postMessageWithContext(
        ctx,
        client,
        channelId,
        threadTs,
        'Only the user who requested the previous run can approve this tool execution.',
        { sessionKey: pendingToolApproval.sessionKey, tool: pendingToolApproval.tool },
      );
      return true;
    }

    const decision = parseApprovalDecision(text);
    if (!decision) {
      await postMessageWithContext(
        ctx,
        client,
        channelId,
        threadTs,
        formatToolApprovalPrompt(
          pendingToolApproval,
          Math.max(1, Math.ceil((pendingToolApproval.expiresAt - Date.now()) / 1000)),
        ),
        { sessionKey: pendingToolApproval.sessionKey, tool: pendingToolApproval.tool },
      );
      return true;
    }

    const outcome =
      decision === 'reject'
        ? processToolReject(ctx, pendingToolApproval, threadKey)
        : await processToolApprove(
            ctx,
            pendingToolApproval,
            threadKey,
            channelId,
            threadTs,
            userId,
          );

    await postMessageWithContext(ctx, client, channelId, threadTs, outcome.message, {
      sessionKey: pendingToolApproval.sessionKey,
      tool: pendingToolApproval.tool,
    });
  } catch (err) {
    logSlackCommandError(err, { command: 'tool_approval', sessionKey: threadKey });
  }
  return true;
}
