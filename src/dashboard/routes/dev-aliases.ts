/** @module dashboard/routes/dev-aliases — Dashboard API routes for developer alias management. */
import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { errorMessage } from '../../utils/error.js';
import { dashLog, json, parseJson, readBody } from '../http.js';
import type { RouteContext } from '../route-context.js';
import { matchDevAliasAudit, matchDevAliasName } from '../route-context.js';

const BLOCKED_PATH_PREFIXES = ['/etc', '/proc', '/sys', '/root', '/var/run'];

const TOOL_INSTRUCTION_FILE: Record<string, string> = {
  claude: 'CLAUDE.md',
  codex: 'AGENTS.md',
  gemini: 'GEMINI.md',
};

/**
 * Validate and resolve a filesystem path for dev alias use.
 *
 * Returns `{ ok: true, resolvedPath }` on success, or `{ ok: false, status, body }` on failure.
 * Uses `realpathSync` on existing paths to defend against symlink-based traversal.
 */
function validatePath(
  rawPath: string,
  createPath: boolean,
):
  | { ok: true; resolvedPath: string }
  | { ok: false; status: number; body: Record<string, unknown> } {
  let resolvedPath = resolve(rawPath);

  if (existsSync(resolvedPath)) {
    // Resolve symlinks to check the real destination against blocked prefixes
    try {
      resolvedPath = realpathSync(resolvedPath);
    } catch {
      return { ok: false, status: 400, body: { error: `Cannot access path: ${resolvedPath}` } };
    }
  }

  if (BLOCKED_PATH_PREFIXES.some((p) => resolvedPath === p || resolvedPath.startsWith(`${p}/`))) {
    return { ok: false, status: 400, body: { error: `Path is not allowed: ${resolvedPath}` } };
  }

  if (!existsSync(resolvedPath)) {
    if (createPath) {
      try {
        mkdirSync(resolvedPath, { recursive: true });
      } catch (mkdirErr) {
        return {
          ok: false,
          status: 400,
          body: { error: `Failed to create directory: ${errorMessage(mkdirErr)}` },
        };
      }
      // Re-check with realpathSync after creation (parent may contain symlinks)
      try {
        resolvedPath = realpathSync(resolvedPath);
      } catch {
        return { ok: false, status: 400, body: { error: `Cannot access path: ${resolvedPath}` } };
      }
      if (
        BLOCKED_PATH_PREFIXES.some((p) => resolvedPath === p || resolvedPath.startsWith(`${p}/`))
      ) {
        return { ok: false, status: 400, body: { error: `Path is not allowed: ${resolvedPath}` } };
      }
    } else {
      return {
        ok: false,
        status: 400,
        body: { error: `Path does not exist: ${resolvedPath}`, pathNotFound: true, resolvedPath },
      };
    }
  } else {
    try {
      if (!statSync(resolvedPath).isDirectory()) {
        return {
          ok: false,
          status: 400,
          body: { error: `Path is not a directory: ${resolvedPath}` },
        };
      }
    } catch {
      return { ok: false, status: 400, body: { error: `Cannot access path: ${resolvedPath}` } };
    }
  }

  return { ok: true, resolvedPath };
}

export async function handleDevAliasRoutes(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  _query: URLSearchParams,
): Promise<boolean> {
  // GET /api/dev-aliases
  if (req.method === 'GET' && pathname === '/api/dev-aliases') {
    try {
      const aliases = ctx.getDb().listDevAliases();
      json(res, 200, aliases);
    } catch (err) {
      dashLog('warn', 'api_dev_aliases_list_error', { error: errorMessage(err) });
      json(res, 200, []);
    }
    return true;
  }

  // GET /api/dev-aliases/:name/audit — gate regex behind method check
  if (req.method === 'GET') {
    const devAuditName = matchDevAliasAudit(pathname);
    if (devAuditName) {
      try {
        const alias = ctx.getDb().getDevAlias(devAuditName);
        if (!alias) {
          json(res, 404, { error: 'Alias not found' });
          return true;
        }
        const jobs = ctx.getDb().getAuditByWorkdir(alias.path);
        const total = jobs.length;
        const failed = jobs.filter((j) => j.errorKind !== null).length;
        const succeeded = total - failed;
        const lastRun = jobs.length > 0 ? jobs[0]?.startedAt : null;
        json(res, 200, { summary: { total, succeeded, failed, lastRun }, jobs });
      } catch (err) {
        dashLog('warn', 'api_dev_alias_audit_error', { error: errorMessage(err) });
        json(res, 200, {
          summary: { total: 0, succeeded: 0, failed: 0, lastRun: null },
          jobs: [],
        });
      }
      return true;
    }
  }

  // POST /api/dev-aliases
  if (req.method === 'POST' && pathname === '/api/dev-aliases') {
    const body = await readBody(req);
    const parsed = parseJson<{
      name?: string;
      path?: string;
      tool?: string;
      instructionContent?: string | null;
      createPath?: boolean;
    }>(body);
    if (!parsed) {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    if (!parsed.name || !parsed.path) {
      json(res, 400, { error: 'name and path are required' });
      return true;
    }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(parsed.name)) {
      json(res, 400, {
        error: 'Invalid alias name. Use 1-64 alphanumeric, dash, or underscore characters.',
      });
      return true;
    }
    const tool = parsed.tool ?? 'claude';
    if (tool !== 'claude' && tool !== 'codex' && tool !== 'gemini') {
      json(res, 400, { error: 'tool must be claude, codex, or gemini' });
      return true;
    }

    const pathResult = validatePath(parsed.path, !!parsed.createPath);
    if (!pathResult.ok) {
      json(res, pathResult.status, pathResult.body);
      return true;
    }

    const instructionContent =
      typeof parsed.instructionContent === 'string'
        ? parsed.instructionContent.trim() || null
        : null;
    try {
      const alias = ctx
        .getDb()
        .createDevAlias(parsed.name, pathResult.resolvedPath, tool, instructionContent);
      json(res, 201, alias);
    } catch (err) {
      const message = errorMessage(err);
      if (message.includes('UNIQUE constraint') || message.includes('PRIMARY KEY')) {
        json(res, 409, { error: `Alias '${parsed.name}' already exists` });
      } else {
        throw err;
      }
    }
    return true;
  }

  // Compute name match once for PUT and DELETE
  const aliasName = matchDevAliasName(pathname);

  // PUT /api/dev-aliases/:name
  if (req.method === 'PUT' && aliasName) {
    const body = await readBody(req);
    const parsed = parseJson<{
      path?: string;
      tool?: string;
      instructionContent?: string | null;
      createPath?: boolean;
    }>(body);
    if (!parsed) {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    if (
      parsed.tool &&
      parsed.tool !== 'claude' &&
      parsed.tool !== 'codex' &&
      parsed.tool !== 'gemini'
    ) {
      json(res, 400, { error: 'tool must be claude, codex, or gemini' });
      return true;
    }

    const updatePayload: { path?: string; tool?: string; instructionContent?: string | null } = {};

    if (parsed.path) {
      const pathResult = validatePath(parsed.path, !!parsed.createPath);
      if (!pathResult.ok) {
        json(res, pathResult.status, pathResult.body);
        return true;
      }
      updatePayload.path = pathResult.resolvedPath;
    }
    if (parsed.tool) updatePayload.tool = parsed.tool;
    if (parsed.instructionContent !== undefined) {
      updatePayload.instructionContent =
        typeof parsed.instructionContent === 'string'
          ? parsed.instructionContent.trim() || null
          : null;
    }
    const updated = ctx.getDb().updateDevAlias(aliasName, updatePayload);
    if (!updated) {
      json(res, 404, { error: 'Alias not found' });
      return true;
    }

    // Sync instruction file to alias path when instructionContent changes
    if (updatePayload.instructionContent !== undefined) {
      const filename = TOOL_INSTRUCTION_FILE[updated.tool] ?? 'CLAUDE.md';
      const targetPath = join(updated.path, filename);
      try {
        if (updatePayload.instructionContent) {
          writeFileSync(targetPath, updatePayload.instructionContent, 'utf-8');
        }
      } catch (syncErr) {
        dashLog('warn', 'dev_alias_instruction_sync_failed', {
          alias: aliasName,
          target: targetPath,
          error: errorMessage(syncErr),
        });
      }
    }

    json(res, 200, { success: true });
    return true;
  }

  // DELETE /api/dev-aliases/:name
  if (req.method === 'DELETE' && aliasName) {
    const deleted = ctx.getDb().deleteDevAlias(aliasName);
    if (!deleted) {
      json(res, 404, { error: 'Alias not found' });
      return true;
    }
    // Clear orphaned session references
    ctx.getDb().clearSessionDevAlias(aliasName);
    json(res, 200, { success: true });
    return true;
  }

  return false;
}
