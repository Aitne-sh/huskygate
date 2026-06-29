import { describe, expect, it, vi } from 'vitest';
import type { Job } from '../queue/types.js';
import { makeTestAppContext } from '../test-helpers/app-context-builder.js';
import { resolveJobMcpSelection, resolveSessionMcpSelection } from './mcp-selection.js';

function createCtx() {
  const ctx = makeTestAppContext();
  ctx.mcpServerStore = {
    ...ctx.mcpServerStore,
    listByTool: vi.fn(),
  } as unknown as typeof ctx.mcpServerStore;
  ctx.sessionMcpServerStore = {
    ...ctx.sessionMcpServerStore,
    listBySession: vi.fn(),
  } as unknown as typeof ctx.sessionMcpServerStore;
  return ctx;
}

function createJob(
  overrides?: Partial<Pick<Job, 'executionPolicy' | 'sessionKey' | 'tool'>>,
): Pick<Job, 'executionPolicy' | 'sessionKey' | 'tool'> {
  return {
    tool: 'claude',
    sessionKey: 'sess-1',
    executionPolicy: undefined,
    ...overrides,
  };
}

describe('resolveSessionMcpSelection', () => {
  it('returns all servers and session filtering metadata from stores', () => {
    const ctx = createCtx();
    ctx.mcpServerStore.listByTool = vi.fn().mockReturnValue([
      {
        id: 'srv-1',
        name: 'aws',
        tool: 'claude',
        transport: 'stdio',
        definition: { command: 'echo' },
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
      },
      {
        id: 'srv-2',
        name: 'github',
        tool: 'claude',
        transport: 'stdio',
        definition: { command: 'echo' },
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
      },
    ]);
    ctx.sessionMcpServerStore.listBySession = vi.fn().mockReturnValue([
      {
        sessionKey: 'sess-1',
        serverId: 'srv-1',
        enabled: true,
      },
      {
        sessionKey: 'sess-1',
        serverId: 'srv-2',
        enabled: false,
      },
    ]);

    const selection = resolveSessionMcpSelection(ctx, 'sess-1', 'claude');

    expect(selection.allServers).toHaveLength(2);
    expect(selection.enabledServers.map((server) => server.id)).toEqual(['srv-1']);
  });
});

describe('resolveJobMcpSelection', () => {
  it('returns an empty selection when allowMcp is false', () => {
    const ctx = createCtx();

    const selection = resolveJobMcpSelection(
      ctx,
      createJob({
        executionPolicy: { allowMcp: false, enabledSkills: null },
      }),
    );

    expect(selection.allServers).toEqual([]);
    expect(selection.enabledServers).toEqual([]);
    expect(selection.filterActive).toBe(false);
  });

  it('narrows enabled servers with enabledMcpServerIds', () => {
    const ctx = createCtx();
    ctx.mcpServerStore.listByTool = vi.fn().mockReturnValue([
      {
        id: 'srv-1',
        name: 'aws',
        tool: 'claude',
        transport: 'stdio',
        definition: { command: 'echo' },
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
      },
      {
        id: 'srv-2',
        name: 'github',
        tool: 'claude',
        transport: 'stdio',
        definition: { command: 'echo' },
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
      },
    ]);
    ctx.sessionMcpServerStore.listBySession = vi.fn().mockReturnValue([
      {
        sessionKey: 'sess-1',
        serverId: 'srv-1',
        enabled: true,
      },
      {
        sessionKey: 'sess-1',
        serverId: 'srv-2',
        enabled: true,
      },
    ]);

    const selection = resolveJobMcpSelection(
      ctx,
      createJob({
        executionPolicy: {
          allowMcp: true,
          enabledSkills: null,
          enabledMcpServerIds: ['srv-2'],
        },
      }),
    );

    expect(selection.enabledServers.map((server) => server.id)).toEqual(['srv-2']);
  });
});
