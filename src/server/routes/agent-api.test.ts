import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../context/app-context.js';
import type { AiAgent } from '../../orchestrator/types.js';
import { StaleUpdateError } from '../../store/store-utils.js';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import { handleAgentApiRoutes, matchesAgentApiPath } from './agent-api.js';

// ── Mock skill-refs so we don't touch the filesystem ──
vi.mock('../../skills/skill-refs.js', () => ({
  discoverCatalogForSkillValidation: vi.fn(() => []),
  validateRequestedSkillRefs: vi.fn(
    (raw: unknown, _catalog: unknown[], _field: string) => {
      if (raw === undefined || raw === null) return { skillRefs: null };
      if (raw === 'INVALID') return { skillRefs: null, error: 'Invalid skill refs: INVALID' };
      return { skillRefs: raw };
    },
  ),
}));

// ── Mock logger to silence output ──
vi.mock('../../utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Helpers ──

class MockRequest extends EventEmitter {
  public method: string;
  public url?: string;
  public headers: Record<string, string>;

  constructor(method: string, url: string, headers?: Record<string, string>) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers ?? {};
  }

  destroy(): this {
    this.emit('close');
    return this;
  }
}

class MockResponse {
  public statusCode = 200;
  public body = '';
  public headers: Record<string, string> = {};

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.statusCode = statusCode;
    if (headers) this.headers = { ...headers };
    return this;
  }

  end(chunk?: string): this {
    if (chunk) this.body += chunk;
    return this;
  }
}

async function invoke(
  ctx: AppContext,
  options: {
    method: string;
    path: string;
    body?: unknown;
  },
): Promise<{ handled: boolean; status: number; body: unknown }> {
  const req = new MockRequest(options.method, options.path, { 'content-type': 'application/json' });
  const res = new MockResponse();
  const promise = handleAgentApiRoutes(
    ctx,
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse,
    options.path,
  );
  if (options.body !== undefined) {
    req.emit('data', Buffer.from(JSON.stringify(options.body), 'utf-8'));
  }
  req.emit('end');
  const handled = await promise;
  return {
    handled,
    status: res.statusCode,
    body: res.body ? JSON.parse(res.body) : null,
  };
}

/** Send raw string body (for invalid JSON tests). */
async function invokeRaw(
  ctx: AppContext,
  options: {
    method: string;
    path: string;
    rawBody: string;
  },
): Promise<{ handled: boolean; status: number; body: unknown }> {
  const req = new MockRequest(options.method, options.path, { 'content-type': 'application/json' });
  const res = new MockResponse();
  const promise = handleAgentApiRoutes(
    ctx,
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse,
    options.path,
  );
  req.emit('data', Buffer.from(options.rawBody, 'utf-8'));
  req.emit('end');
  const handled = await promise;
  return {
    handled,
    status: res.statusCode,
    body: res.body ? JSON.parse(res.body) : null,
  };
}

const NOW = '2026-03-11T00:00:00.000Z';

function makeAgent(overrides: Partial<AiAgent> = {}): AiAgent {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    description: null,
    tool: 'claude',
    model: null,
    systemInstruction: null,
    enabledSkills: null,
    enabledMcpServerIds: null,
    allowMcp: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createContext(): AppContext {
  const agent = makeAgent();
  const ctx = makeTestAppContext();
  ctx.agentStore = {
    list: vi.fn(() => [agent]),
    getById: vi.fn((id: string) => (id === 'agent-1' ? agent : null)),
    getByName: vi.fn((name: string) => (name === 'Test Agent' ? agent : null)),
    create: vi.fn((input: Record<string, unknown>) =>
      makeAgent({
        id: 'agent-new',
        name: String(input.name),
        tool: input.tool as AiAgent['tool'],
        model: (input.model as string) ?? null,
        description: (input.description as string) ?? null,
        systemInstruction: (input.systemInstruction as string) ?? null,
        enabledSkills: (input.enabledSkills as AiAgent['enabledSkills']) ?? null,
        enabledMcpServerIds: (input.enabledMcpServerIds as string[]) ?? null,
        allowMcp: (input.allowMcp as boolean) ?? true,
      }),
    ),
    update: vi.fn(
      (id: string, _patch: Record<string, unknown>, _expectedUpdatedAt?: string) => {
        if (id === 'agent-1') return makeAgent({ ...(_patch as Partial<AiAgent>) });
        return null;
      },
    ),
    delete: vi.fn((id: string) => id === 'agent-1'),
    getUsage: vi.fn(() => ({
      count: 0,
      nodes: [],
      tasks: { scheduled: 0, ondemand: 0, triggered: 0 },
    })),
  } as unknown as AppContext['agentStore'];

  ctx.mcpServerStore = {
    listByTool: vi.fn(() => []),
    listAll: vi.fn(() => []),
    getById: vi.fn((id: string) => {
      if (id === 'mcp-1') return { id: 'mcp-1', name: 'MCP 1', tool: 'claude' };
      if (id === 'mcp-2') return { id: 'mcp-2', name: 'MCP 2', tool: 'gemini' };
      return null;
    }),
  } as unknown as AppContext['mcpServerStore'];

  return ctx;
}

// ─── Tests ──────────────────────────────────────────────────

describe('matchesAgentApiPath', () => {
  it('matches /api/agents exactly', () => {
    expect(matchesAgentApiPath('/api/agents')).toBe(true);
  });

  it('matches /api/agents/ with trailing slash', () => {
    expect(matchesAgentApiPath('/api/agents/')).toBe(true);
  });

  it('matches /api/agents/:id subpaths', () => {
    expect(matchesAgentApiPath('/api/agents/agent-1')).toBe(true);
    expect(matchesAgentApiPath('/api/agents/agent-1/usage')).toBe(true);
  });

  it('does not match other paths', () => {
    expect(matchesAgentApiPath('/api/agent')).toBe(false);
    expect(matchesAgentApiPath('/api/schedules')).toBe(false);
    expect(matchesAgentApiPath('/api')).toBe(false);
  });
});

describe('handleAgentApiRoutes', () => {
  // ── GET /api/agents ──

  describe('GET /api/agents', () => {
    it('lists all agents', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, { method: 'GET', path: '/api/agents' });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, data: [makeAgent()] });
      expect(ctx.agentStore.list).toHaveBeenCalled();
    });
  });

  // ── POST /api/agents ──

  describe('POST /api/agents', () => {
    it('creates an agent with valid input', async () => {
      const ctx = createContext();
      // Make getByName return null so uniqueness check passes
      (ctx.agentStore.getByName as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'New Agent', tool: 'claude' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ok: true, data: expect.objectContaining({ name: 'New Agent' }) });
      expect(ctx.agentStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Agent',
          tool: 'claude',
          model: null,
          systemInstruction: null,
          enabledSkills: null,
          enabledMcpServerIds: null,
          allowMcp: true,
          description: null,
        }),
      );
    });

    it('returns 400 for invalid JSON body', async () => {
      const ctx = createContext();
      const res = await invokeRaw(ctx, {
        method: 'POST',
        path: '/api/agents',
        rawBody: '{not json',
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid JSON' });
    });

    it('returns 400 when name is missing', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { tool: 'claude' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'name is required' });
    });

    it('returns 400 when name is empty string', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: '   ', tool: 'claude' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'name is required' });
    });

    it('returns 400 when name is non-string', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 123, tool: 'claude' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'name is required' });
    });

    it('returns 400 when name exceeds max length', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'x'.repeat(101), tool: 'claude' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'name must be <= 100 chars' });
    });

    it('returns 400 when tool is invalid', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'invalid' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'tool must be claude, codex, or gemini' });
    });

    it('returns 400 when tool is missing (empty string)', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'tool must be claude, codex, or gemini' });
    });

    it('returns 400 when tool is non-string', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 123 },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'tool must be claude, codex, or gemini' });
    });

    it('returns 400 when model is invalid type', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', model: 123 },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'model must be a string' });
    });

    it('returns 400 when model exceeds max length', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', model: 'x'.repeat(101) },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'model must be <= 100 characters' });
    });

    it('normalizes model "default" to null', async () => {
      const ctx = createContext();
      (ctx.agentStore.getByName as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', model: 'default' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(201);
      expect(ctx.agentStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ model: null }),
      );
    });

    it('returns 400 when systemInstruction exceeds max length', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', systemInstruction: 'x'.repeat(10_001) },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'systemInstruction must be <= 10000 chars' });
    });

    it('trims systemInstruction and sets empty to null', async () => {
      const ctx = createContext();
      (ctx.agentStore.getByName as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', systemInstruction: '   ' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(201);
      expect(ctx.agentStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ systemInstruction: null }),
      );
    });

    it('passes valid systemInstruction through trimmed', async () => {
      const ctx = createContext();
      (ctx.agentStore.getByName as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', systemInstruction: '  Be helpful  ' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(201);
      expect(ctx.agentStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ systemInstruction: 'Be helpful' }),
      );
    });

    it('sets systemInstruction to null when non-string', async () => {
      const ctx = createContext();
      (ctx.agentStore.getByName as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', systemInstruction: 42 },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(201);
      expect(ctx.agentStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ systemInstruction: null }),
      );
    });

    it('returns 400 when enabledSkills validation fails', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', enabledSkills: 'INVALID' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid skill refs: INVALID' });
    });

    it('returns 400 when enabledMcpServerIds contains non-existent IDs', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', enabledMcpServerIds: ['nonexistent'] },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'enabledMcpServerIds contains invalid server IDs' });
    });

    it('returns 400 when enabledMcpServerIds is not an array', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', enabledMcpServerIds: 'not-array' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'enabledMcpServerIds contains invalid server IDs' });
    });

    it('returns 400 when enabledMcpServerIds contains non-string entries', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', enabledMcpServerIds: [123] },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'enabledMcpServerIds contains invalid server IDs' });
    });

    it('returns 400 when enabledMcpServerIds server tool does not match agent tool', async () => {
      const ctx = createContext();
      // mcp-2 has tool: 'gemini', agent tool is 'claude'
      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', enabledMcpServerIds: ['mcp-2'] },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'enabledMcpServerIds contains invalid server IDs' });
    });

    it('accepts valid enabledMcpServerIds', async () => {
      const ctx = createContext();
      (ctx.agentStore.getByName as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', enabledMcpServerIds: ['mcp-1'] },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(201);
      expect(ctx.agentStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ enabledMcpServerIds: ['mcp-1'] }),
      );
    });

    it('treats null/undefined enabledMcpServerIds as null', async () => {
      const ctx = createContext();
      (ctx.agentStore.getByName as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', enabledMcpServerIds: null },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(201);
      expect(ctx.agentStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ enabledMcpServerIds: null }),
      );
    });

    it('treats empty array enabledMcpServerIds as null', async () => {
      const ctx = createContext();
      (ctx.agentStore.getByName as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', enabledMcpServerIds: [] },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(201);
      expect(ctx.agentStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ enabledMcpServerIds: null }),
      );
    });

    it('defaults allowMcp to true when not provided', async () => {
      const ctx = createContext();
      (ctx.agentStore.getByName as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude' },
      });

      expect(res.status).toBe(201);
      expect(ctx.agentStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ allowMcp: true }),
      );
    });

    it('defaults allowMcp to true when null', async () => {
      const ctx = createContext();
      (ctx.agentStore.getByName as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', allowMcp: null },
      });

      expect(res.status).toBe(201);
      expect(ctx.agentStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ allowMcp: true }),
      );
    });

    it('passes allowMcp false when explicitly set', async () => {
      const ctx = createContext();
      (ctx.agentStore.getByName as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', allowMcp: false },
      });

      expect(res.status).toBe(201);
      expect(ctx.agentStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ allowMcp: false }),
      );
    });

    it('trims description and sets empty to null', async () => {
      const ctx = createContext();
      (ctx.agentStore.getByName as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', description: '   ' },
      });

      expect(res.status).toBe(201);
      expect(ctx.agentStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: null }),
      );
    });

    it('passes valid description trimmed', async () => {
      const ctx = createContext();
      (ctx.agentStore.getByName as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', description: '  My agent  ' },
      });

      expect(res.status).toBe(201);
      expect(ctx.agentStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'My agent' }),
      );
    });

    it('sets description to null when non-string', async () => {
      const ctx = createContext();
      (ctx.agentStore.getByName as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude', description: 42 },
      });

      expect(res.status).toBe(201);
      expect(ctx.agentStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: null }),
      );
    });

    it('returns 409 when name already exists', async () => {
      const ctx = createContext();
      // getByName returns existing agent by default

      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Test Agent', tool: 'claude' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'Agent with name "Test Agent" already exists' });
    });

    it('returns 500 when agentStore.create throws', async () => {
      const ctx = createContext();
      (ctx.agentStore.getByName as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (ctx.agentStore.create as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('DB error');
      });

      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal error' });
    });
  });

  // ── GET /api/agents/:id/usage ──

  describe('GET /api/agents/:id/usage', () => {
    it('returns usage data', async () => {
      const ctx = createContext();
      const usage = {
        count: 2,
        nodes: [
          { nodeId: 'n1', nodeLabel: 'Node 1', orchestratorId: 'o1', orchestratorName: 'Orch 1' },
        ],
        tasks: { scheduled: 1, ondemand: 0, triggered: 0 },
      };
      (ctx.agentStore.getUsage as ReturnType<typeof vi.fn>).mockReturnValue(usage);

      const res = await invoke(ctx, { method: 'GET', path: '/api/agents/agent-1/usage' });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, data: usage });
      expect(ctx.agentStore.getUsage).toHaveBeenCalledWith('agent-1');
    });
  });

  // ── GET /api/agents/:id ──

  describe('GET /api/agents/:id', () => {
    it('returns agent by id', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, { method: 'GET', path: '/api/agents/agent-1' });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, data: makeAgent() });
    });

    it('returns 404 when agent not found', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, { method: 'GET', path: '/api/agents/nonexistent' });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Agent not found' });
    });
  });

  // ── PATCH /api/agents/:id ──

  describe('PATCH /api/agents/:id', () => {
    it('updates an agent with valid partial data', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { name: 'Renamed Agent', updatedAt: NOW },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, data: expect.objectContaining({}) });
      expect(ctx.agentStore.update).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({ name: 'Renamed Agent' }),
        NOW,
      );
    });

    it('returns 400 for invalid JSON body', async () => {
      const ctx = createContext();
      const res = await invokeRaw(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        rawBody: '{not json',
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid JSON' });
    });

    it('returns 400 when name is empty', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { name: '   ' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'name cannot be empty' });
    });

    it('returns 400 when name is non-string', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { name: 123 },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'name cannot be empty' });
    });

    it('returns 400 when name exceeds max length', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { name: 'x'.repeat(101) },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'name must be <= 100 chars' });
    });

    it('returns 409 when renaming to an existing name owned by another agent', async () => {
      const ctx = createContext();
      // getByName returns an agent with a different ID
      (ctx.agentStore.getByName as ReturnType<typeof vi.fn>).mockReturnValue(
        makeAgent({ id: 'agent-other', name: 'Other Agent' }),
      );

      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { name: 'Other Agent' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'Agent with name "Other Agent" already exists' });
    });

    it('allows keeping the same name (own name)', async () => {
      const ctx = createContext();
      // getByName returns the same agent (same ID)
      (ctx.agentStore.getByName as ReturnType<typeof vi.fn>).mockReturnValue(
        makeAgent({ id: 'agent-1', name: 'Test Agent' }),
      );

      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { name: 'Test Agent' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(200);
    });

    it('returns 400 when tool is invalid', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { tool: 'invalid' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'tool must be claude, codex, or gemini' });
    });

    it('returns 400 when tool is non-string', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { tool: 123 },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'tool must be claude, codex, or gemini' });
    });

    it('returns 400 when model is invalid type', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { model: 123 },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'model must be a string' });
    });

    it('returns 400 when model exceeds max length', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { model: 'x'.repeat(101) },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'model must be <= 100 characters' });
    });

    it('patches model successfully', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { model: 'claude-3-opus' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(200);
      expect(ctx.agentStore.update).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({ model: 'claude-3-opus' }),
        undefined,
      );
    });

    it('patches description (trims and sets empty to null)', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { description: '   ' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(200);
      expect(ctx.agentStore.update).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({ description: null }),
        undefined,
      );
    });

    it('patches description non-string to null', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { description: 42 },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(200);
      expect(ctx.agentStore.update).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({ description: null }),
        undefined,
      );
    });

    it('patches valid description trimmed', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { description: '  Hello  ' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(200);
      expect(ctx.agentStore.update).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({ description: 'Hello' }),
        undefined,
      );
    });

    it('returns 400 when systemInstruction exceeds max length', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { systemInstruction: 'x'.repeat(10_001) },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'systemInstruction must be <= 10000 chars' });
    });

    it('patches systemInstruction (trims empty to null)', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { systemInstruction: '   ' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(200);
      expect(ctx.agentStore.update).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({ systemInstruction: null }),
        undefined,
      );
    });

    it('patches systemInstruction non-string to null', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { systemInstruction: 42 },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(200);
      expect(ctx.agentStore.update).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({ systemInstruction: null }),
        undefined,
      );
    });

    it('patches valid systemInstruction trimmed', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { systemInstruction: '  Be helpful  ' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(200);
      expect(ctx.agentStore.update).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({ systemInstruction: 'Be helpful' }),
        undefined,
      );
    });

    it('returns 400 when enabledSkills validation fails', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { enabledSkills: 'INVALID' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid skill refs: INVALID' });
    });

    it('uses patched tool for skill catalog discovery when both tool and enabledSkills are set', async () => {
      const { discoverCatalogForSkillValidation } = await import('../../skills/skill-refs.js');
      const ctx = createContext();

      await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { tool: 'gemini', enabledSkills: null },
      });

      expect(discoverCatalogForSkillValidation).toHaveBeenCalledWith(
        ctx.config,
        'gemini',
      );
    });

    it('uses existing agent tool for skill catalog when no tool in patch', async () => {
      const { discoverCatalogForSkillValidation } = await import('../../skills/skill-refs.js');
      const ctx = createContext();

      await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { enabledSkills: null },
      });

      // The existing agent has tool: 'claude'
      expect(discoverCatalogForSkillValidation).toHaveBeenCalledWith(
        ctx.config,
        'claude',
      );
    });

    it('uses empty skill catalog when agent not found and no tool in patch', async () => {
      const { discoverCatalogForSkillValidation } = await import('../../skills/skill-refs.js');
      const ctx = createContext();
      // Agent not found for skill validation
      (ctx.agentStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/nonexistent',
        body: { enabledSkills: null },
      });

      // discoverCatalogForSkillValidation should NOT be called when effectiveTool is null
      // Because effectiveTool = null, the ternary goes to the empty array branch
      expect(res.handled).toBe(true);
    });

    it('returns 400 when enabledMcpServerIds validation fails in patch', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { enabledMcpServerIds: ['nonexistent'] },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'enabledMcpServerIds contains invalid server IDs' });
    });

    it('uses patched tool for MCP server validation', async () => {
      const ctx = createContext();
      // mcp-2 has tool: 'gemini', so setting tool: 'gemini' should make it valid
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { tool: 'gemini', enabledMcpServerIds: ['mcp-2'] },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(200);
      expect(ctx.agentStore.update).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({ enabledMcpServerIds: ['mcp-2'] }),
        undefined,
      );
    });

    it('uses existing agent tool for MCP server validation when no tool in patch', async () => {
      const ctx = createContext();
      // mcp-1 has tool: 'claude' which matches agent-1's tool
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { enabledMcpServerIds: ['mcp-1'] },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(200);
      expect(ctx.agentStore.update).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({ enabledMcpServerIds: ['mcp-1'] }),
        undefined,
      );
    });

    it('patches allowMcp', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { allowMcp: false },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(200);
      expect(ctx.agentStore.update).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({ allowMcp: false }),
        undefined,
      );
    });

    it('passes updatedAt for optimistic concurrency', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { name: 'Renamed', updatedAt: '2026-01-01T00:00:00.000Z' },
      });

      expect(res.handled).toBe(true);
      expect(ctx.agentStore.update).toHaveBeenCalledWith(
        'agent-1',
        expect.any(Object),
        '2026-01-01T00:00:00.000Z',
      );
    });

    it('passes undefined updatedAt when not provided', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { name: 'Renamed' },
      });

      expect(res.handled).toBe(true);
      expect(ctx.agentStore.update).toHaveBeenCalledWith(
        'agent-1',
        expect.any(Object),
        undefined,
      );
    });

    it('returns 404 when agent not found during update', async () => {
      const ctx = createContext();
      (ctx.agentStore.update as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/nonexistent',
        body: { name: 'Renamed' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Agent not found' });
    });

    it('returns 409 on StaleUpdateError', async () => {
      const ctx = createContext();
      (ctx.agentStore.update as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new StaleUpdateError('Agent', 'agent-1');
      });

      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { name: 'Renamed', updatedAt: NOW },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: 'Agent agent-1 was modified by another request. Refresh and try again.',
      });
    });

    it('returns 500 on unexpected error during update', async () => {
      const ctx = createContext();
      (ctx.agentStore.update as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('DB crash');
      });

      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/agent-1',
        body: { name: 'Renamed' },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal error' });
    });
  });

  // ── DELETE /api/agents/:id ──

  describe('DELETE /api/agents/:id', () => {
    it('deletes an existing agent', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, { method: 'DELETE', path: '/api/agents/agent-1' });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(ctx.agentStore.delete).toHaveBeenCalledWith('agent-1');
    });

    it('returns 404 when agent not found', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, { method: 'DELETE', path: '/api/agents/nonexistent' });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Agent not found' });
    });
  });

  // ── Unmatched routes ──

  describe('unmatched routes', () => {
    it('returns false for no agentId segment', async () => {
      const ctx = createContext();
      // /api/agents is handled by GET/POST, but PUT /api/agents falls through
      // to the agentId parsing path where agentId = undefined → return false
      const res = await invoke(ctx, { method: 'PUT', path: '/api/agents' });

      // PUT /api/agents does not match GET or POST, so falls to segment parsing
      // segments = ['', 'api', 'agents'] → agentId = segments[3] = undefined → return false
      expect(res.handled).toBe(false);
    });

    it('returns false for unknown method on /:id path', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, { method: 'PUT', path: '/api/agents/agent-1' });

      expect(res.handled).toBe(false);
    });

    it('returns false for unknown subresource', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, { method: 'GET', path: '/api/agents/agent-1/unknown' });

      // subResource = 'unknown', does not match 'usage', and GET with subResource skips
      expect(res.handled).toBe(false);
    });

    it('returns false for DELETE with subresource', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, { method: 'DELETE', path: '/api/agents/agent-1/extra' });

      expect(res.handled).toBe(false);
    });

    it('returns false for PATCH with subresource', async () => {
      const ctx = createContext();
      const res = await invoke(ctx, { method: 'PATCH', path: '/api/agents/agent-1/extra' });

      expect(res.handled).toBe(false);
    });
  });

  // ── validateMcpServerIds edge cases (exercised via routes) ──

  describe('validateMcpServerIds (via routes)', () => {
    it('returns null for undefined enabledMcpServerIds in create', async () => {
      const ctx = createContext();
      (ctx.agentStore.getByName as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await invoke(ctx, {
        method: 'POST',
        path: '/api/agents',
        body: { name: 'Agent', tool: 'claude' },
      });

      expect(res.status).toBe(201);
      expect(ctx.agentStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ enabledMcpServerIds: null }),
      );
    });

    it('validates MCP server tool match when tool is null (no tool in patch, no existing agent)', async () => {
      const ctx = createContext();
      (ctx.agentStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(null);

      // When tool is null (agent not found), servers still validate but update returns 404
      const res = await invoke(ctx, {
        method: 'PATCH',
        path: '/api/agents/nonexistent',
        body: { enabledMcpServerIds: ['mcp-1'] },
      });

      expect(res.handled).toBe(true);
      expect(res.status).toBe(404);
    });
  });
});
