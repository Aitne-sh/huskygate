/** @module dashboard/routes/chat — Dashboard API routes for interactive chat sessions. */
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type DownloadedFile,
  MAX_FILE_SIZE_BYTES,
  buildArtifactResponseHeaders,
  saveLocalFile,
  validateArtifactFile,
} from '../../shared/file-attachment.js';
import { errorMessage } from '../../utils/error.js';
import { dashLog, json, readBinaryBody, readBody } from '../http.js';
import type { RouteContext } from '../route-context.js';
import {
  matchArtifactFile,
  matchArtifacts,
  matchChatMessages,
  matchChatMessagesNew,
  matchChatSend,
  matchChatStatus,
  matchChatStop,
  matchChatUpload,
  matchJobStop,
  matchJobStream,
  matchToolApproval,
} from '../route-context.js';

function decodeURIComponentSafe(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export async function handleChatRoutes(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  query: URLSearchParams,
): Promise<boolean> {
  // GET /api/chat/sessions?tool=claude — local DB read
  if (req.method === 'GET' && pathname === '/api/chat/sessions') {
    const tool = query.get('tool');
    try {
      const sessions = tool ? ctx.getDb().listSessionsByTool(tool) : ctx.getDb().listSessions();
      json(res, 200, sessions);
    } catch (err) {
      dashLog('warn', 'api_chat_sessions_list_error', { error: errorMessage(err) });
      json(res, 200, []);
    }
    return true;
  }

  // POST /api/chat/sessions → proxy to Server API
  if (req.method === 'POST' && pathname === '/api/chat/sessions') {
    const body = await readBody(req);
    const result = await ctx.proxyToServerApi('POST', '/api/sessions', body);
    json(res, result.status, result.data);
    return true;
  }

  // GET /api/chat/:id/messages/new?after=123 — local DB read
  const chatNewMsgId = matchChatMessagesNew(pathname);
  if (req.method === 'GET' && chatNewMsgId) {
    const afterRaw = query.get('after');
    const afterId = afterRaw ? Number.parseInt(afterRaw, 10) : 0;
    if (Number.isNaN(afterId)) {
      json(res, 400, { error: 'Invalid "after" parameter' });
      return true;
    }
    const toolState = ctx.getDb().getSessionToolState(chatNewMsgId);
    if (!toolState) {
      json(res, 404, { error: 'Session not found' });
      return true;
    }
    const messages = ctx.getDb().getNewMessages(toolState.sessionKey, afterId);
    json(res, 200, { messages });
    return true;
  }

  // GET /api/chat/:id/messages?limit=50&before=123 — local DB read
  const chatMsgId = matchChatMessages(pathname);
  if (req.method === 'GET' && chatMsgId) {
    const limit = Math.min(Math.max(Number.parseInt(query.get('limit') ?? '50', 10) || 50, 1), 200);
    const beforeRaw = query.get('before');
    const before = beforeRaw ? Number.parseInt(beforeRaw, 10) : undefined;
    if (before !== undefined && Number.isNaN(before)) {
      json(res, 400, { error: 'Invalid "before" parameter' });
      return true;
    }
    const toolState = ctx.getDb().getSessionToolState(chatMsgId);
    if (!toolState) {
      json(res, 404, { error: 'Session not found' });
      return true;
    }
    const messages = ctx.getDb().getMessages(toolState.sessionKey, limit, before);
    const hasMore = messages.length === limit;
    json(res, 200, { messages, hasMore });
    return true;
  }

  // POST /api/jobs/:sessionKey/stop → proxy to Server API
  const stopSessionKey = matchJobStop(pathname);
  if (req.method === 'POST' && stopSessionKey) {
    const result = await ctx.proxyToServerApi('POST', `/api/jobs/${stopSessionKey}/stop`);
    json(res, result.status, result.data);
    return true;
  }

  // POST /api/chat/:id/stop → proxy to Server API (session-id based stop)
  const stopChatSessionId = matchChatStop(pathname);
  if (req.method === 'POST' && stopChatSessionId) {
    const result = await ctx.proxyToServerApi('POST', `/api/chat/${stopChatSessionId}/stop`);
    json(res, result.status, result.data);
    return true;
  }

  // GET /api/chat/:id/status → proxy to Server API
  const chatStatusId = matchChatStatus(pathname);
  if (req.method === 'GET' && chatStatusId) {
    const { status, data } = await ctx.proxyToServerApi('GET', `/api/chat/${chatStatusId}/status`);
    json(res, status, data);
    return true;
  }

  // POST /api/chat/:id/tool-approval → proxy to Server API
  const toolApprovalId = matchToolApproval(pathname);
  if (req.method === 'POST' && toolApprovalId) {
    const body = await readBody(req);
    const result = await ctx.proxyToServerApi(
      'POST',
      `/api/chat/${toolApprovalId}/tool-approval`,
      body,
    );
    json(res, result.status, result.data);
    return true;
  }

  // POST /api/chat/:id/upload → save file to session workdir
  const chatUploadId = matchChatUpload(pathname);
  if (req.method === 'POST' && chatUploadId) {
    const toolState = ctx.getDb().getSessionToolState(chatUploadId);
    if (!toolState) {
      json(res, 404, { error: 'Session not found' });
      return true;
    }
    const fileNameRaw = (req.headers['x-file-name'] as string) || 'attachment';
    const fileName = decodeURIComponentSafe(fileNameRaw);
    if (fileName === null) {
      json(res, 400, { error: 'Invalid x-file-name header encoding' });
      return true;
    }
    const mimetype = (req.headers['x-file-mime'] as string) || 'application/octet-stream';
    const buffer = await readBinaryBody(req, MAX_FILE_SIZE_BYTES);
    const batchId = `dash_${Date.now()}`;
    const file: DownloadedFile = await saveLocalFile(
      buffer,
      fileName,
      mimetype,
      toolState.workdir,
      batchId,
    );
    dashLog('info', 'chat_file_uploaded', {
      sessionId: chatUploadId,
      fileName: file.originalName,
      size: file.size,
    });
    json(res, 200, file);
    return true;
  }

  // POST /api/chat/:id/send → proxy SSE to Server API
  const chatSendId = matchChatSend(pathname);
  if (req.method === 'POST' && chatSendId) {
    const body = await readBody(req);
    dashLog('info', 'chat_send_proxy', { sessionId: chatSendId });
    await ctx.proxySSE(`/api/chat/${chatSendId}/send`, body, req, res);
    return true;
  }

  // GET /api/chat/:id/job-stream/:jobId → proxy SSE to Server API
  const jobStreamMatch = matchJobStream(pathname);
  if (req.method === 'GET' && jobStreamMatch) {
    await ctx.proxySSEGet(
      `/api/chat/${jobStreamMatch.sessionId}/job-stream/${jobStreamMatch.jobId}`,
      req,
      res,
    );
    return true;
  }

  // GET /api/chat/:id/artifacts → list all archived artifacts for session
  const artifactsListId = matchArtifacts(pathname);
  if (req.method === 'GET' && artifactsListId) {
    const sessionInfo = ctx.getDb().getSessionToolState(artifactsListId);
    if (!sessionInfo) {
      json(res, 404, { error: 'Session not found' });
      return true;
    }
    // Proxy to API server for the JSON listing (non-binary)
    const { status, data } = await ctx.proxyToServerApi('GET', pathname);
    json(res, status, data);
    return true;
  }

  // GET /api/chat/:id/artifacts/:jobId/:filename → serve artifact file
  const artifactFileInfo = matchArtifactFile(pathname);
  if (req.method === 'GET' && artifactFileInfo) {
    const sessionInfo = ctx.getDb().getSessionToolState(artifactFileInfo.sessionId);
    if (!sessionInfo) {
      json(res, 404, { error: 'Session not found' });
      return true;
    }

    const validation = await validateArtifactFile(
      sessionInfo.workdir,
      artifactFileInfo.jobId,
      artifactFileInfo.filename,
    );
    if (!validation.ok) {
      json(res, validation.status, { error: validation.error });
      return true;
    }

    const { filePath, stat, contentType } = validation;
    const fileBuffer = readFileSync(filePath);

    res.writeHead(
      200,
      buildArtifactResponseHeaders(artifactFileInfo.filename, contentType, stat.size),
    );
    res.end(fileBuffer);
    return true;
  }

  return false;
}
