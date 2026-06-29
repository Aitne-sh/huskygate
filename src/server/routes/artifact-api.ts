/** @module server/routes/artifact-api — Server API routes for session artifact listing and download. */
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../../context/app-context.js';
import {
  buildArtifactResponseHeaders,
  listAllArtifacts,
  validateArtifactFile,
} from '../../shared/file-attachment.js';
import { json } from '../../shared/http.js';
import { matchArtifactFile, matchArtifacts } from '../../shared/route-matchers.js';

export function matchesArtifactApiPath(pathname: string): boolean {
  return matchArtifacts(pathname) !== null || matchArtifactFile(pathname) !== null;
}

export async function handleArtifactApiRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  // GET /api/chat/:id/artifacts → list all archived artifacts for session
  const artifactsId = matchArtifacts(pathname);
  if (req.method === 'GET' && artifactsId) {
    const session = ctx.sessionManager.getSessionSummaryById(artifactsId);
    if (!session) {
      json(res, 404, { error: 'Session not found' });
      return true;
    }
    const current = ctx.sessionManager.get(session.sessionKey);
    if (!current) {
      json(res, 404, { error: 'Session not found' });
      return true;
    }
    const groups = listAllArtifacts(current.workdir);
    const result = groups.map((group) => ({
      jobId: group.jobId,
      files: group.files.map((file) => ({
        filename: file.filename,
        size: file.size,
        mimeType: file.mimeType,
      })),
    }));
    json(res, 200, { artifacts: result });
    return true;
  }

  // GET /api/chat/:id/artifacts/:jobId/:filename → serve artifact file
  const artifactFile = matchArtifactFile(pathname);
  if (req.method === 'GET' && artifactFile) {
    const session = ctx.sessionManager.getSessionSummaryById(artifactFile.sessionId);
    if (!session) {
      json(res, 404, { error: 'Session not found' });
      return true;
    }
    const current = ctx.sessionManager.get(session.sessionKey);
    if (!current) {
      json(res, 404, { error: 'Session not found' });
      return true;
    }

    const validation = await validateArtifactFile(
      current.workdir,
      artifactFile.jobId,
      artifactFile.filename,
    );
    if (!validation.ok) {
      json(res, validation.status, { error: validation.error });
      return true;
    }

    const { filePath, stat, contentType } = validation;
    const fileBuffer = readFileSync(filePath);

    res.writeHead(200, buildArtifactResponseHeaders(artifactFile.filename, contentType, stat.size));
    res.end(fileBuffer);
    return true;
  }

  return false;
}
