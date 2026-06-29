/** @module server/routes/agent-api — REST API for AI Agent CRUD operations. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type ToolName, isToolName } from '../../config.js';
import type { AppContext } from '../../context/app-context.js';
import { json, readBody } from '../../shared/http.js';
import {
  discoverCatalogForSkillValidation,
  validateRequestedSkillRefs,
} from '../../skills/skill-refs.js';
import { normalizeModel } from '../../shared/normalize-model.js';
import { StaleUpdateError } from '../../store/store-utils.js';
import { errorMessage } from '../../utils/error.js';
import { logger } from '../../utils/logger.js';

const AGENT_NAME_MAX = 100;
const SYSTEM_INSTRUCTION_MAX = 10_000;

export function matchesAgentApiPath(pathname: string): boolean {
  return pathname === '/api/agents' || pathname.startsWith('/api/agents/');
}

export async function handleAgentApiRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  // GET /api/agents — list all agents
  if (req.method === 'GET' && pathname === '/api/agents') {
    const agents = ctx.agentStore.list();
    json(res, 200, { ok: true, data: agents });
    return true;
  }

  // POST /api/agents — create agent
  if (req.method === 'POST' && pathname === '/api/agents') {
    const body = await readBody(req);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }

    // Validate name
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    if (!name) {
      json(res, 400, { error: 'name is required' });
      return true;
    }
    if (name.length > AGENT_NAME_MAX) {
      json(res, 400, { error: `name must be <= ${AGENT_NAME_MAX} chars` });
      return true;
    }

    // Validate tool
    const tool = typeof parsed.tool === 'string' ? parsed.tool : '';
    if (!isToolName(tool)) {
      json(res, 400, { error: 'tool must be claude, codex, or gemini' });
      return true;
    }

    // Validate model
    let model: string | null = null;
    try {
      model = normalizeModel(parsed.model);
    } catch (e) {
      json(res, 400, { error: (e as Error).message });
      return true;
    }

    // Validate systemInstruction
    const systemInstruction =
      typeof parsed.systemInstruction === 'string' ? parsed.systemInstruction.trim() || null : null;
    if (systemInstruction && systemInstruction.length > SYSTEM_INSTRUCTION_MAX) {
      json(res, 400, { error: `systemInstruction must be <= ${SYSTEM_INSTRUCTION_MAX} chars` });
      return true;
    }

    const skillCatalog = discoverCatalogForSkillValidation(ctx.config, tool);
    const enabledSkills = validateRequestedSkillRefs(
      parsed.enabledSkills,
      skillCatalog,
      'enabledSkills',
    );
    if (enabledSkills.error) {
      json(res, 400, { error: enabledSkills.error });
      return true;
    }

    // Validate enabledMcpServerIds
    const enabledMcpServerIds = validateMcpServerIds(parsed.enabledMcpServerIds, ctx, tool);
    if (enabledMcpServerIds === false) {
      json(res, 400, { error: 'enabledMcpServerIds contains invalid server IDs' });
      return true;
    }

    const allowMcp =
      parsed.allowMcp === undefined || parsed.allowMcp === null ? true : Boolean(parsed.allowMcp);

    const description =
      typeof parsed.description === 'string' ? parsed.description.trim() || null : null;

    try {
      const existing = ctx.agentStore.getByName(name);
      if (existing) {
        json(res, 409, { error: `Agent with name "${name}" already exists` });
        return true;
      }
      const created = ctx.agentStore.create({
        name,
        description,
        tool,
        model,
        systemInstruction,
        enabledSkills: enabledSkills.skillRefs,
        enabledMcpServerIds,
        allowMcp,
      });
      json(res, 201, { ok: true, data: created });
    } catch (err) {
      logger.warn('agent_create_failed', { error: errorMessage(err) });
      json(res, 500, { error: 'Internal error' });
    }
    return true;
  }

  // Parse agent ID from path: /api/agents/:id[/subResource]
  const segments = pathname.split('/');
  const agentId = segments[3];
  if (!agentId) return false;

  const subResource = segments[4];

  // GET /api/agents/:id/usage — list referencing nodes
  if (req.method === 'GET' && subResource === 'usage') {
    const usage = ctx.agentStore.getUsage(agentId);
    json(res, 200, { ok: true, data: usage });
    return true;
  }

  // GET /api/agents/:id — get agent detail
  if (req.method === 'GET' && !subResource) {
    const agent = ctx.agentStore.getById(agentId);
    if (!agent) {
      json(res, 404, { error: 'Agent not found' });
      return true;
    }
    json(res, 200, { ok: true, data: agent });
    return true;
  }

  // PATCH /api/agents/:id — update agent
  if (req.method === 'PATCH' && !subResource) {
    const body = await readBody(req);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }

    const patch: Record<string, unknown> = {};

    if ('name' in parsed) {
      const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
      if (!name) {
        json(res, 400, { error: 'name cannot be empty' });
        return true;
      }
      if (name.length > AGENT_NAME_MAX) {
        json(res, 400, { error: `name must be <= ${AGENT_NAME_MAX} chars` });
        return true;
      }
      // Check uniqueness if name changes
      const existing = ctx.agentStore.getByName(name);
      if (existing && existing.id !== agentId) {
        json(res, 409, { error: `Agent with name "${name}" already exists` });
        return true;
      }
      patch.name = name;
    }

    if ('tool' in parsed) {
      const tool = typeof parsed.tool === 'string' ? parsed.tool : '';
      if (!isToolName(tool)) {
        json(res, 400, { error: 'tool must be claude, codex, or gemini' });
        return true;
      }
      patch.tool = tool;
    }

    if ('model' in parsed) {
      try {
        patch.model = normalizeModel(parsed.model);
      } catch (e) {
        json(res, 400, { error: (e as Error).message });
        return true;
      }
    }

    if ('description' in parsed) {
      patch.description =
        typeof parsed.description === 'string' ? parsed.description.trim() || null : null;
    }

    if ('systemInstruction' in parsed) {
      const val =
        typeof parsed.systemInstruction === 'string'
          ? parsed.systemInstruction.trim() || null
          : null;
      if (val && val.length > SYSTEM_INSTRUCTION_MAX) {
        json(res, 400, { error: `systemInstruction must be <= ${SYSTEM_INSTRUCTION_MAX} chars` });
        return true;
      }
      patch.systemInstruction = val;
    }

    if ('enabledSkills' in parsed) {
      const existingAgent = ctx.agentStore.getById(agentId);
      const effectiveTool = (patch.tool ?? existingAgent?.tool ?? null) as ToolName | null;
      const skillCatalog = effectiveTool
        ? discoverCatalogForSkillValidation(ctx.config, effectiveTool)
        : [];
      const skills = validateRequestedSkillRefs(
        parsed.enabledSkills,
        skillCatalog,
        'enabledSkills',
      );
      if (skills.error) {
        json(res, 400, { error: skills.error });
        return true;
      }
      patch.enabledSkills = skills.skillRefs;
    }

    if ('enabledMcpServerIds' in parsed) {
      // Use the patched tool, falling back to the existing agent's tool
      const existingAgent = ctx.agentStore.getById(agentId);
      const effectiveTool = (patch.tool ?? existingAgent?.tool ?? null) as ToolName | null;
      const mcpIds = validateMcpServerIds(parsed.enabledMcpServerIds, ctx, effectiveTool);
      if (mcpIds === false) {
        json(res, 400, { error: 'enabledMcpServerIds contains invalid server IDs' });
        return true;
      }
      patch.enabledMcpServerIds = mcpIds;
    }

    if ('allowMcp' in parsed) {
      patch.allowMcp = Boolean(parsed.allowMcp);
    }

    const expectedUpdatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined;

    try {
      const updated = ctx.agentStore.update(agentId, patch, expectedUpdatedAt);
      if (!updated) {
        json(res, 404, { error: 'Agent not found' });
        return true;
      }
      json(res, 200, { ok: true, data: updated });
    } catch (err) {
      if (err instanceof StaleUpdateError) {
        json(res, 409, { error: err.message });
      } else {
        logger.warn('agent_update_failed', { error: errorMessage(err) });
        json(res, 500, { error: 'Internal error' });
      }
    }
    return true;
  }

  // DELETE /api/agents/:id — delete agent
  if (req.method === 'DELETE' && !subResource) {
    const deleted = ctx.agentStore.delete(agentId);
    if (!deleted) {
      json(res, 404, { error: 'Agent not found' });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

function validateMcpServerIds(
  raw: unknown,
  ctx: AppContext,
  tool: ToolName | null,
): string[] | null | false {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return false;
  if (raw.length === 0) return null;
  // Validate each ID exists in the MCP server store
  for (const entry of raw) {
    if (typeof entry !== 'string') return false;
    const server = ctx.mcpServerStore.getById(entry);
    if (!server) return false;
    // If tool is specified, ensure the server matches the tool
    if (tool && server.tool !== tool) return false;
  }
  return raw as string[];
}
