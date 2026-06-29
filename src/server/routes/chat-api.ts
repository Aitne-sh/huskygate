/** @module server/routes/chat-api — Server API routes for interactive chat message exchange and streaming. */
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../../context/app-context.js';
import type { Job } from '../../queue/types.js';
import {
  buildClaudeMcpToolRerunPrompt,
  buildCodexMcpToolRerunPrompt,
  buildGeminiSingleToolRerunPrompt,
  findPendingApprovalBySessionKey,
  isWildcardToolApprovalTarget,
  resolveApprovedToolName,
  sanitizeStickyApprovalState,
} from '../../shared/approval.js';
import {
  appendCodexApprovedToolCall,
  buildCodexApprovalToolStateOverridesForCalls,
} from '../../shared/codex-tool-approval.js';
import { INTERVALS } from '../../shared/constants.js';
import { type DownloadedFile, buildFileReferenceBlock } from '../../shared/file-attachment.js';
import { json, parseUrl, readBody } from '../../shared/http.js';
import { PAGINATION, parseLimit } from '../../shared/pagination.js';
import {
  matchChatMessages,
  matchChatMessagesNew,
  matchChatSend,
  matchChatStatus,
  matchChatStop,
  matchJobStop,
  matchJobStream,
  matchToolApproval,
} from '../../shared/route-matchers.js';
import { writeSseHeaders } from '../../shared/sse.js';
import {
  TOOL_APPROVAL_RERUN_KEY,
  extractMcpShortToolName,
  mergeApprovedAllowlistTools,
} from '../../shared/tool-approval.js';
import { getDb } from '../../store/database.js';
import { logger } from '../../utils/logger.js';
import { type JobStreamBuffer, MAX_BUFFER_EVENTS, jobStreamBuffers } from '../state.js';

/** Separator injected between Codex process narration and final answer. */
export const PROCESS_END_SEPARATOR = '<!-- process-end -->';

/** Marker that Codex is instructed to emit via AGENTS.md / SKILL files. */
export const CODEX_ANSWER_MARKER = '<!-- answer -->';

/** Minimum chars of text before a boundary marker for it to qualify as
 *  "process narration" worth collapsing. Prevents false positives on
 *  short responses that start directly with structured content. */
const MIN_PROCESS_PREAMBLE = 80;

/** Monotonic event ID counter (resets on server restart — acceptable). */
let sseEventIdCounter = 0;

/**
 * Heuristic fallback: find the char offset where process narration (Codex /
 * Claude) ends and the structured answer begins. Returns -1 if no boundary
 * is detected.
 *
 * NOTE: The explicit `<!-- answer -->` marker is handled by the caller
 * (`injectProcessSeparator`) before this function is reached.
 */
export function findProcessBoundary(text: string): number {
  const patterns: RegExp[] = [
    /\n(?:\*\*)?What you asked(?:\*\*)?/i,
    /\n(?:\*\*)?(?:Conclusion|Summary|Answer)[:：\s]/i,
    /\n#{1,3}\s/,
    /\n[`\s]*★\s*Insight/,
  ];
  let earliest = -1;
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match !== null && match.index >= MIN_PROCESS_PREAMBLE) {
      if (earliest < 0 || match.index < earliest) {
        earliest = match.index;
      }
    }
  }
  return earliest;
}

/**
 * For Codex and Claude responses, insert a process/answer separator.
 *
 * Detection priority (shared by Codex and Claude):
 *   1. Explicit `<!-- answer -->` marker
 *   2. Tool-event char offset
 *   3. Text heuristic
 */
export function injectProcessSeparator(
  fullText: string,
  driverTool: string,
  sawToolEvent: boolean,
  lastToolCharOffset: number,
): string {
  if (driverTool !== 'codex' && driverTool !== 'claude' && driverTool !== 'gemini') {
    return fullText;
  }

  const markerIdx = fullText.lastIndexOf(CODEX_ANSWER_MARKER);
  if (markerIdx >= 0) {
    const processPart = fullText
      .slice(0, markerIdx)
      .replaceAll(CODEX_ANSWER_MARKER, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const answerPart = fullText.slice(markerIdx + CODEX_ANSWER_MARKER.length).trim();
    if (processPart && answerPart) {
      return `${processPart}\n\n${PROCESS_END_SEPARATOR}\n\n${answerPart}`;
    }
    return fullText
      .replaceAll(CODEX_ANSWER_MARKER, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  let splitOffset: number;
  if (sawToolEvent && lastToolCharOffset >= 0) {
    splitOffset = lastToolCharOffset;
  } else {
    splitOffset = findProcessBoundary(fullText);
    if (splitOffset < 0) return fullText;
  }

  const processPart = fullText.slice(0, splitOffset).trim();
  const answerPart = fullText.slice(splitOffset).trim();
  if (!processPart || !answerPart) return fullText;
  return `${processPart}\n\n${PROCESS_END_SEPARATOR}\n\n${answerPart}`;
}

function sseWrite(res: ServerResponse, data: unknown): boolean {
  if (res.writableEnded) return false;
  try {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    const id = ++sseEventIdCounter;
    return res.write(`id: ${id}\ndata: ${payload}\n\n`);
  } catch (err) {
    logger.warn('sse_write_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function sseRetry(res: ServerResponse, ms: number): void {
  if (res.writableEnded) return;
  try {
    res.write(`retry: ${ms}\n\n`);
  } catch {
    /* ignore — connection may already be closed */
  }
}

const HEARTBEAT_INTERVAL_MS = INTERVALS.sseHeartbeat;

export function matchesChatApiPath(pathname: string): boolean {
  return (
    pathname === '/api/chat/sessions' ||
    matchJobStop(pathname) !== null ||
    matchChatStop(pathname) !== null ||
    matchChatStatus(pathname) !== null ||
    matchChatSend(pathname) !== null ||
    matchChatMessages(pathname) !== null ||
    matchChatMessagesNew(pathname) !== null ||
    matchToolApproval(pathname) !== null ||
    matchJobStream(pathname) !== null
  );
}

function startHeartbeat(res: ServerResponse): ReturnType<typeof setInterval> {
  return setInterval(() => {
    if (res.writableEnded) return;
    try {
      res.write(': heartbeat\n\n');
    } catch {
      /* ignore — connection may already be closed */
    }
  }, HEARTBEAT_INTERVAL_MS);
}

interface ChatMessageRow {
  id: number;
  session_key: string;
  role: string;
  content: string;
  created_at: string;
}

function getMessagesFromDb(
  sessionKey: string,
  limit: number,
  before?: number,
): { id: number; sessionKey: string; role: string; content: string; createdAt: string }[] {
  const db = getDb();

  let rows: ChatMessageRow[];
  if (before !== undefined) {
    rows = db
      .prepare(
        `SELECT id, session_key, role, content, created_at
           FROM dashboard_messages
          WHERE session_key = ? AND id < ?
          ORDER BY id DESC
          LIMIT ?`,
      )
      .all(sessionKey, before, limit) as ChatMessageRow[];
  } else {
    rows = db
      .prepare(
        `SELECT id, session_key, role, content, created_at
           FROM dashboard_messages
          WHERE session_key = ?
          ORDER BY id DESC
          LIMIT ?`,
      )
      .all(sessionKey, limit) as ChatMessageRow[];
  }
  return rows.map((row) => ({
    id: row.id,
    sessionKey: row.session_key,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  }));
}

function getNewMessagesFromDb(
  sessionKey: string,
  afterId: number,
): { id: number; sessionKey: string; role: string; content: string; createdAt: string }[] {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT id, session_key, role, content, created_at
         FROM dashboard_messages
        WHERE session_key = ? AND id > ?
        ORDER BY id ASC`,
    )
    .all(sessionKey, afterId) as ChatMessageRow[];
  return rows.map((row) => ({
    id: row.id,
    sessionKey: row.session_key,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  }));
}

export async function handleChatApiRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const { query } = parseUrl(req.url);

  // POST /api/jobs/:sessionKey/stop — kill active runner
  const stopSessionKey = matchJobStop(pathname);
  if (req.method === 'POST' && stopSessionKey) {
    const active = ctx.activeRunners.get(stopSessionKey);
    if (active) {
      active.runner.kill('dashboard_stop');
      json(res, 200, { success: true });
    } else {
      json(res, 200, { success: false, error: 'No active runner for session' });
    }
    return true;
  }

  // POST /api/chat/:id/stop — kill active runner by session ID
  const stopChatId = matchChatStop(pathname);
  if (req.method === 'POST' && stopChatId) {
    const session = ctx.sessionManager.getSessionSummaryById(stopChatId);
    if (!session) {
      json(res, 404, { error: 'Session not found' });
      return true;
    }
    const active = ctx.activeRunners.get(session.sessionKey);
    if (active) {
      active.runner.kill('dashboard_stop');
      json(res, 200, { success: true });
    } else {
      json(res, 200, { success: false, error: 'No active runner for session' });
    }
    return true;
  }

  // GET /api/chat/:id/status — check if session runner is active
  const chatStatusId = matchChatStatus(pathname);
  if (req.method === 'GET' && chatStatusId) {
    const session = ctx.sessionManager.getSessionSummaryById(chatStatusId);
    if (!session) {
      json(res, 404, { error: 'Session not found' });
      return true;
    }
    const active = ctx.activeRunners.get(session.sessionKey);
    const running = active ? active.runner.isRunning() : false;
    const approval = findPendingApprovalBySessionKey(ctx.pendingToolApprovals, session.sessionKey);
    json(res, 200, {
      running,
      pendingApproval: approval !== null,
      jobId: active?.job.id ?? null,
    });
    return true;
  }

  // POST /api/chat/:id/send → SSE stream
  const chatSendId = matchChatSend(pathname);
  if (req.method === 'POST' && chatSendId) {
    const session = ctx.sessionManager.getSessionSummaryById(chatSendId);
    if (!session) {
      json(res, 404, { error: 'Session not found' });
      return true;
    }

    const body = await readBody(req);
    let parsed: { prompt?: string; files?: DownloadedFile[] };
    try {
      parsed = JSON.parse(body) as { prompt?: string; files?: DownloadedFile[] };
    } catch {
      logger.debug('api_invalid_json', { endpoint: pathname });
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    if (!parsed.prompt || typeof parsed.prompt !== 'string') {
      json(res, 400, { error: 'prompt is required' });
      return true;
    }

    const userPrompt = parsed.prompt;
    let finalPrompt = userPrompt;
    if (Array.isArray(parsed.files) && parsed.files.length > 0) {
      finalPrompt = userPrompt + buildFileReferenceBlock(parsed.files);
    }

    const tool = session.tool;
    const jobId = crypto.randomUUID();

    ctx.conversationStore.saveMessage(session.sessionKey, 'user', userPrompt, jobId);

    writeSseHeaders(res);
    sseRetry(res, 3000);
    const heartbeatHandle = startHeartbeat(res);

    const assistantChunks: string[] = [];
    let toolApprovalReceived = false;
    let lastToolCharOffset = -1;
    let currentCharOffset = 0;
    let sawToolEvent = false;

    ctx.jobEventStreams.set(jobId, {
      onEvent: (event) => {
        if (event.type === 'text') {
          assistantChunks.push(event.content);
          currentCharOffset += event.content.length;
        }
        if (event.type === 'tool_use' || event.type === 'tool_result') {
          lastToolCharOffset = currentCharOffset;
          sawToolEvent = true;
        }
        if (event.type === 'tool_approval') {
          toolApprovalReceived = true;
        }
        if (res.writableEnded) return;
        sseWrite(res, event);
      },
      onDone: (result) => {
        clearInterval(heartbeatHandle);
        const rawResponse = assistantChunks.join('');
        const fullResponse = injectProcessSeparator(
          rawResponse,
          tool,
          sawToolEvent,
          lastToolCharOffset,
        );
        if (!toolApprovalReceived && fullResponse) {
          ctx.conversationStore.saveMessage(session.sessionKey, 'assistant', fullResponse, jobId);
        }

        logger.info('api_chat_done', {
          sessionId: chatSendId,
          tool,
          exitCode: result.exitCode,
          responseLength: fullResponse.length,
        });

        sseWrite(res, { type: 'done', content: '' });
        if (!res.writableEnded) {
          res.end();
        }
        ctx.jobEventStreams.delete(jobId);
      },
    });

    req.on('close', () => {
      clearInterval(heartbeatHandle);
      logger.debug('api_sse_client_disconnected', { sessionId: chatSendId, jobId });
    });

    const currentSession = ctx.sessionManager.get(session.sessionKey);
    const job: Job = {
      id: jobId,
      sessionKey: session.sessionKey,
      channelId: '',
      threadTs: '',
      userId: session.userId,
      tool,
      mode: session.mode,
      prompt: finalPrompt,
      workdir: session.workdir,
      toolState: currentSession?.toolState ?? {},
      createdAt: Date.now(),
      source: 'dashboard',
    };

    const enqueueResult = ctx.jobQueue.enqueue(job);
    if ('error' in enqueueResult) {
      clearInterval(heartbeatHandle);
      ctx.jobEventStreams.delete(jobId);
      sseWrite(res, { type: 'error', content: enqueueResult.error });
      sseWrite(res, { type: 'done', content: '' });
      if (!res.writableEnded) res.end();
      return true;
    }

    return true;
  }

  // GET /api/chat/:id/messages
  const chatMessageId = matchChatMessages(pathname);
  if (req.method === 'GET' && chatMessageId) {
    const session = ctx.sessionManager.getSessionSummaryById(chatMessageId);
    if (!session) {
      json(res, 404, { error: 'Session not found' });
      return true;
    }
    const limit = parseLimit(
      query.get('limit'),
      PAGINATION.chatDefaultLimit,
      PAGINATION.chatMaxLimit,
    );
    const beforeRaw = query.get('before');
    const beforeParsed = beforeRaw ? Number.parseInt(beforeRaw, 10) : undefined;
    if (beforeParsed !== undefined && Number.isNaN(beforeParsed)) {
      json(res, 400, { error: 'Invalid "before" parameter' });
      return true;
    }
    const fetchLimit = limit + 1;
    const rows = getMessagesFromDb(session.sessionKey, fetchLimit, beforeParsed);
    const hasMore = rows.length > limit;
    const messages = hasMore ? rows.slice(0, limit) : rows;
    json(res, 200, { messages, hasMore });
    return true;
  }

  // GET /api/chat/:id/messages/new?after=123
  const chatNewMessageId = matchChatMessagesNew(pathname);
  if (req.method === 'GET' && chatNewMessageId) {
    const session = ctx.sessionManager.getSessionSummaryById(chatNewMessageId);
    if (!session) {
      json(res, 404, { error: 'Session not found' });
      return true;
    }
    const afterRaw = query.get('after');
    const afterId = afterRaw ? Number.parseInt(afterRaw, 10) : 0;
    if (Number.isNaN(afterId)) {
      json(res, 400, { error: 'Invalid "after" parameter' });
      return true;
    }
    const messages = getNewMessagesFromDb(session.sessionKey, afterId);
    json(res, 200, { messages });
    return true;
  }

  // GET /api/chat/sessions?tool=claude
  if (req.method === 'GET' && pathname === '/api/chat/sessions') {
    const sessions = ctx.sessionManager.listAllSessions();
    const tool = query.get('tool');
    const filtered = tool ? sessions.filter((session) => session.tool === tool) : sessions;
    json(res, 200, filtered);
    return true;
  }

  // POST /api/chat/:id/tool-approval
  const toolApprovalId = matchToolApproval(pathname);
  if (req.method === 'POST' && toolApprovalId) {
    const session = ctx.sessionManager.getSessionSummaryById(toolApprovalId);
    if (!session) {
      json(res, 404, { error: 'Session not found' });
      return true;
    }

    const body = await readBody(req);
    let parsed: { decision?: string; requestId?: string };
    try {
      parsed = JSON.parse(body) as { decision?: string; requestId?: string };
    } catch {
      logger.debug('api_invalid_json', { endpoint: pathname });
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }

    const { decision, requestId } = parsed;
    if (decision !== 'approve' && decision !== 'deny') {
      json(res, 400, { error: 'decision must be "approve" or "deny"' });
      return true;
    }
    if (!requestId || typeof requestId !== 'string') {
      json(res, 400, { error: 'requestId is required' });
      return true;
    }

    const found = findPendingApprovalBySessionKey(ctx.pendingToolApprovals, session.sessionKey);
    if (!found) {
      json(res, 404, { error: 'No pending approval found for this session' });
      return true;
    }
    const { key: approvalKey, approval: pendingApproval } = found;

    if (pendingApproval.requestId !== requestId) {
      json(res, 400, { error: 'requestId does not match' });
      return true;
    }
    if (Date.now() > pendingApproval.expiresAt) {
      ctx.pendingToolApprovals.delete(approvalKey);
      json(res, 410, { error: 'Approval request has expired' });
      return true;
    }

    ctx.pendingToolApprovals.delete(approvalKey);

    if (decision === 'deny') {
      const resultPayload = JSON.stringify({
        type: 'tool_approval_result',
        requestId,
        decision: 'denied',
      });
      ctx.conversationStore.saveMessage(session.sessionKey, 'system', resultPayload);
      json(res, 200, { success: true, decision: 'denied' });
      return true;
    }

    const currentSession = ctx.sessionManager.get(session.sessionKey);
    if (!currentSession) {
      json(res, 404, { error: 'Session no longer exists' });
      return true;
    }

    if (currentSession.mode === 'readonly') {
      const isMcp =
        typeof pendingApproval.requestedToolName === 'string' &&
        (pendingApproval.requestedToolName.startsWith('mcp__') ||
          pendingApproval.requestedToolName.startsWith('mcp_'));
      if (isMcp) {
        const denyPayload = JSON.stringify({
          type: 'tool_approval_result',
          requestId,
          decision: 'denied',
        });
        ctx.conversationStore.saveMessage(session.sessionKey, 'system', denyPayload);
        json(res, 403, {
          error: 'MCP tool approval is not allowed in readonly mode',
        });
        return true;
      }
    }

    const sanitizedState = sanitizeStickyApprovalState(currentSession.toolState);
    if (sanitizedState.changed) {
      ctx.sessionManager.updateToolState(session.sessionKey, sanitizedState.toolState);
      currentSession.toolState = sanitizedState.toolState;
    }

    const approvedToolName = resolveApprovedToolName(pendingApproval);
    const requiresAllowlist =
      pendingApproval.tool === 'claude' || pendingApproval.tool === 'gemini';
    if ((requiresAllowlist || pendingApproval.tool === 'codex') && !approvedToolName) {
      json(res, 400, { error: 'Could not identify approved tool name' });
      return true;
    }
    if (approvedToolName && isWildcardToolApprovalTarget(approvedToolName)) {
      json(res, 400, {
        error:
          'Wildcard tool patterns are not allowed for one-shot approvals. Approve a concrete tool call instead.',
      });
      return true;
    }

    let toolStateOverrides: Record<string, unknown> | undefined;
    if (pendingApproval.tool === 'codex' && approvedToolName) {
      let withApprovedCall = appendCodexApprovedToolCall(
        pendingApproval.approvedCodexToolCalls,
        approvedToolName,
        pendingApproval.requestedToolArgs,
      );
      const mcpShortName = extractMcpShortToolName(approvedToolName);
      if (mcpShortName) {
        withApprovedCall = appendCodexApprovedToolCall(
          withApprovedCall,
          mcpShortName,
          pendingApproval.requestedToolArgs,
        );
      }
      toolStateOverrides = buildCodexApprovalToolStateOverridesForCalls(withApprovedCall);
    } else if (approvedToolName) {
      const shortName = extractMcpShortToolName(approvedToolName);
      const toolsToApprove = shortName ? [approvedToolName, shortName] : [approvedToolName];
      toolStateOverrides = mergeApprovedAllowlistTools(pendingApproval.tool, {}, toolsToApprove);
    }

    if (pendingApproval.tool === 'gemini' && pendingApproval.skipGeminiMcpPreflightOnce) {
      toolStateOverrides = {
        ...(toolStateOverrides ?? {}),
        gemini_skip_mcp_preflight_once: true,
      };
    }

    toolStateOverrides = {
      ...(toolStateOverrides ?? {}),
      [TOOL_APPROVAL_RERUN_KEY]: true,
    };

    let retryPrompt = pendingApproval.prompt;
    if (pendingApproval.tool === 'gemini' && approvedToolName) {
      retryPrompt = buildGeminiSingleToolRerunPrompt(
        pendingApproval.prompt,
        approvedToolName,
        pendingApproval.requestedToolArgs,
      );
    } else if (pendingApproval.tool === 'claude' && approvedToolName?.startsWith('mcp__')) {
      retryPrompt = buildClaudeMcpToolRerunPrompt(
        approvedToolName,
        pendingApproval.requestedToolArgs,
      );
    } else if (pendingApproval.tool === 'codex' && approvedToolName) {
      retryPrompt = buildCodexMcpToolRerunPrompt(
        pendingApproval.prompt,
        approvedToolName,
        pendingApproval.requestedToolArgs,
      );
    }

    ctx.workdirManager.prepareWorkdirSkillsOnly(currentSession.workdir, pendingApproval.tool);

    const isDashboardSession = session.threadKey.startsWith('dashboard_');
    const jobId = crypto.randomUUID();

    if (isDashboardSession) {
      const buffer: JobStreamBuffer = {
        events: [],
        sseRes: null,
        done: false,
        doneAt: 0,
        assistantChunks: [],
        toolApprovalReceived: false,
        lastToolCharOffset: -1,
        currentCharOffset: 0,
        sawToolEvent: false,
      };
      jobStreamBuffers.set(jobId, buffer);

      ctx.jobEventStreams.set(jobId, {
        onEvent: (event) => {
          if (buffer.events.length < MAX_BUFFER_EVENTS) {
            const eventId = ++sseEventIdCounter;
            buffer.events.push({ ...event, eventId });
          } else {
            logger.warn('job_stream_buffer_overflow', { jobId });
          }
          if (event.type === 'text') {
            buffer.assistantChunks.push(event.content);
            buffer.currentCharOffset += event.content.length;
          }
          if (event.type === 'tool_use' || event.type === 'tool_result') {
            buffer.lastToolCharOffset = buffer.currentCharOffset;
            buffer.sawToolEvent = true;
          }
          if (event.type === 'tool_approval') {
            buffer.toolApprovalReceived = true;
          }
          if (buffer.sseRes) {
            sseWrite(buffer.sseRes, event);
          }
        },
        onDone: () => {
          buffer.done = true;
          buffer.doneAt = Date.now();
          const rawResponse = buffer.assistantChunks.join('');
          const fullResponse = injectProcessSeparator(
            rawResponse,
            pendingApproval.tool,
            buffer.sawToolEvent,
            buffer.lastToolCharOffset,
          );
          if (!buffer.toolApprovalReceived && fullResponse) {
            ctx.conversationStore.saveMessage(session.sessionKey, 'assistant', fullResponse, jobId);
          }
          if (buffer.sseRes) {
            sseWrite(buffer.sseRes, { type: 'done', content: '' });
            if (!buffer.sseRes.writableEnded) buffer.sseRes.end();
          }
          ctx.jobEventStreams.delete(jobId);
        },
      });
    }

    const retryJob: Job = {
      id: jobId,
      sessionKey: session.sessionKey,
      channelId: isDashboardSession ? '' : (session.threadKey.split(':')[0] ?? ''),
      threadTs: isDashboardSession ? '' : (session.threadKey.split(':')[1] ?? ''),
      userId: session.userId,
      tool: pendingApproval.tool,
      mode: currentSession.mode,
      prompt: retryPrompt,
      workdir: currentSession.workdir,
      toolState: currentSession.toolState,
      toolStateOverrides,
      createdAt: Date.now(),
      source: isDashboardSession ? 'dashboard' : undefined,
    };

    const enqueueResult = ctx.jobQueue.enqueue(retryJob);
    if ('error' in enqueueResult) {
      if (isDashboardSession) {
        ctx.jobEventStreams.delete(jobId);
        jobStreamBuffers.delete(jobId);
      }
      json(res, 500, { error: `Enqueue failed: ${enqueueResult.error}` });
      return true;
    }

    const resultPayload = JSON.stringify({
      type: 'tool_approval_result',
      requestId,
      decision: 'approved',
    });
    ctx.conversationStore.saveMessage(session.sessionKey, 'system', resultPayload, jobId);
    json(res, 200, {
      success: true,
      decision: 'approved',
      jobId: isDashboardSession ? jobId : undefined,
    });
    return true;
  }

  // GET /api/chat/:id/job-stream/:jobId → SSE replay + live stream
  const jobStreamMatch = matchJobStream(pathname);
  if (req.method === 'GET' && jobStreamMatch) {
    const buffer = jobStreamBuffers.get(jobStreamMatch.jobId);
    if (!buffer) {
      json(res, 404, { error: 'Job stream not found' });
      return true;
    }

    writeSseHeaders(res);
    sseRetry(res, 3000);
    const heartbeatHandle = startHeartbeat(res);

    const lastEventId = req.headers['last-event-id'];
    let replayStart = 0;
    if (lastEventId) {
      const parsedId = Number(lastEventId);
      if (!Number.isNaN(parsedId)) {
        replayStart = buffer.events.findIndex((event) => event.eventId > parsedId);
        if (replayStart === -1) replayStart = buffer.events.length;
      }
    }

    const replayLength = buffer.events.length;
    for (let i = replayStart; i < replayLength; i++) {
      if (res.writableEnded) break;
      const event = buffer.events[i];
      if (!event) continue;
      try {
        res.write(
          `id: ${event.eventId}\ndata: ${JSON.stringify({ type: event.type, content: event.content })}\n\n`,
        );
      } catch {
        /* connection closed */
      }
    }

    if (buffer.done) {
      clearInterval(heartbeatHandle);
      sseWrite(res, { type: 'done', content: '' });
      if (!res.writableEnded) res.end();
      return true;
    }

    buffer.sseRes = res;
    req.on('close', () => {
      clearInterval(heartbeatHandle);
      if (buffer.sseRes === res) buffer.sseRes = null;
    });
    return true;
  }

  return false;
}
