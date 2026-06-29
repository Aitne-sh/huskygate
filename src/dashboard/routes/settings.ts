/** @module dashboard/routes/settings — Dashboard API routes for configuration and prompt management. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getEditableSettingsSchema, isToolName } from '../../config.js';
import { buildInstruction } from '../../instructions/builder.js';
import { getKeychainProvider } from '../../utils/keychain.js';
import { json, parseJson, readBody } from '../http.js';
import type { RouteContext } from '../route-context.js';
import {
  type SettingPatch,
  applySettingsPatches,
  createDashboardResolver,
  isSettingPatch,
} from '../settings-service.js';

export async function handleSettingsRoutes(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  _query: URLSearchParams,
): Promise<boolean> {
  if (req.method === 'GET' && pathname === '/api/settings/schema') {
    json(res, 200, { schema: getEditableSettingsSchema() });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/settings/keychain-status') {
    const kc = getKeychainProvider();
    const available = await kc.isAvailable();
    json(res, 200, { available, platform: kc.platform });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/settings') {
    const { resolver } = await createDashboardResolver(ctx.getDb().config, ctx.dataDir);
    json(res, 200, { entries: resolver.getEditableSettings() });
    return true;
  }

  if (req.method === 'PUT' && pathname === '/api/settings') {
    const body = await readBody(req);
    const parsed = parseJson<{ patches?: unknown[] }>(body);
    if (!parsed) {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    if (!Array.isArray(parsed.patches)) {
      json(res, 400, { error: 'Invalid body: patches array required' });
      return true;
    }
    const patches: SettingPatch[] = [];
    for (const patch of parsed.patches) {
      if (!isSettingPatch(patch)) {
        json(res, 400, { error: 'Invalid body: malformed setting patch' });
        return true;
      }
      patches.push(patch);
    }

    let result: Awaited<ReturnType<typeof applySettingsPatches>>;
    try {
      result = await applySettingsPatches(ctx.getDb().config, patches);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }

    const applied: string[] = [];
    let unappliedRuntimeKeys: string[] = [];
    if (Object.keys(result.runtimeValues).length > 0) {
      const hotResult = await ctx.proxyToServerApi(
        'POST',
        '/api/settings/apply',
        JSON.stringify({ values: result.runtimeValues }),
      );
      if (hotResult.status === 200) {
        const data = hotResult.data as { applied?: string[] };
        if (Array.isArray(data.applied)) {
          applied.push(...data.applied);
        }
        unappliedRuntimeKeys = Object.keys(result.runtimeValues).filter(
          (key) => !applied.includes(key),
        );
      } else {
        unappliedRuntimeKeys = Object.keys(result.runtimeValues);
      }
    }

    const requiresRestart = [...result.requiresRestart];
    for (const key of unappliedRuntimeKeys) {
      if (!requiresRestart.includes(key)) {
        requiresRestart.push(key);
      }
    }

    json(res, 200, {
      success: true,
      applied,
      requiresRestart,
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/settings/prompts') {
    const store = ctx.getDb().defaultInstructions;
    const tools: Array<'claude' | 'codex' | 'gemini'> = ['claude', 'codex', 'gemini'];
    const prompts = tools.map((tool) => {
      const di = store.getWithEnabled(tool);
      return {
        tool,
        preview: buildInstruction({
          tool,
          source: 'chat',
          autoApprove: false,
          allowMcp: true,
        }),
        previewAutorun: buildInstruction({
          tool,
          source: 'chat',
          autoApprove: true,
          allowMcp: true,
        }),
        defaultContent: di.content,
        enabled: di.enabled,
      };
    });
    json(res, 200, { prompts });
    return true;
  }

  if (req.method === 'PUT' && pathname === '/api/settings/prompts/defaults') {
    const body = await readBody(req);
    const parsed = parseJson<{ tool?: string; content?: string; enabled?: boolean }>(body);
    if (!parsed || typeof parsed.tool !== 'string') {
      json(res, 400, { error: 'Invalid body: { tool, content?, enabled? } required' });
      return true;
    }
    if (!isToolName(parsed.tool)) {
      json(res, 400, { error: `Invalid tool: ${parsed.tool}` });
      return true;
    }
    const store = ctx.getDb().defaultInstructions;
    if (typeof parsed.content === 'string') {
      store.set(parsed.tool, parsed.content);
    }
    if (typeof parsed.enabled === 'boolean') {
      store.setEnabled(parsed.tool, parsed.enabled);
    }
    json(res, 200, { success: true, tool: parsed.tool });
    return true;
  }

  return false;
}
