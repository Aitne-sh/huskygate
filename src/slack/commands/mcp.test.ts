import { describe, expect, it, vi } from 'vitest';
import type { McpServerRecord } from '../../store/mcp-server.js';

const mocked = vi.hoisted(() => ({
  postMessageWithContext: vi.fn().mockResolvedValue(undefined),
  getActiveSessionRef: vi.fn().mockReturnValue(null),
  resolveSessionMcpSelection: vi.fn(() => ({
    filterActive: false,
    allServers: [] as unknown[],
    enabledServerIds: new Set<string>(),
    enabledServers: [] as unknown[],
    enabledServerNames: new Set<string>(),
  })),
}));

vi.mock('../app-helpers.js', () => ({
  postMessageWithContext: mocked.postMessageWithContext,
}));

vi.mock('../handler-context.js', () => ({
  getActiveSessionRef: mocked.getActiveSessionRef,
}));

vi.mock('../mcp-selection.js', () => ({
  resolveSessionMcpSelection: mocked.resolveSessionMcpSelection,
}));

import { handleMcp, handleMcpReset, handleMcpToggle } from './mcp.js';

function makeHctx() {
  return {
    ctx: {
      sessionManager: {
        getSessionSummary: vi.fn().mockReturnValue({ sessionId: 'sid1' }),
      },
      sessionMcpServerStore: {
        setEnabled: vi.fn(),
        reset: vi.fn(),
      },
    },
    client: {},
    channelId: 'C1',
    threadTs: '1.1',
    userId: 'U1',
    threadKey: 'C1:1.1',
  };
}

describe('handleMcp', () => {
  it('posts no-session message when no active session', async () => {
    mocked.getActiveSessionRef.mockReturnValue(null);
    const hctx = makeHctx();
    await handleMcp(hctx as never, { kind: 'mcp' } as never);
    expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'C1',
      '1.1',
      expect.stringContaining('No active session'),
    );
  });

  it('posts MCP server list when active session exists', async () => {
    mocked.getActiveSessionRef.mockReturnValue({
      sessionKey: 'sess_1',
      session: { tool: 'claude', mode: 'write', toolState: {} },
    });
    mocked.resolveSessionMcpSelection.mockReturnValue({
      filterActive: false,
      allServers: [{ id: 'srv-1', name: 'aws-api', transport: 'sse' }] as McpServerRecord[],
      enabledServerIds: new Set(['srv-1']),
      enabledServers: [],
      enabledServerNames: new Set(['aws-api']),
    });
    const hctx = makeHctx();
    await handleMcp(hctx as never, { kind: 'mcp' } as never);
    expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'C1',
      '1.1',
      expect.stringContaining('MCP Servers'),
      expect.any(Object),
    );
  });

  it('shows "No MCP servers" when list is empty', async () => {
    mocked.getActiveSessionRef.mockReturnValue({
      sessionKey: 'sess_1',
      session: { tool: 'claude', mode: 'write', toolState: {} },
    });
    mocked.resolveSessionMcpSelection.mockReturnValue({
      filterActive: false,
      allServers: [] as McpServerRecord[],
      enabledServerIds: new Set(),
      enabledServers: [],
      enabledServerNames: new Set(),
    });
    const hctx = makeHctx();
    await handleMcp(hctx as never, { kind: 'mcp' } as never);
    expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'C1',
      '1.1',
      expect.stringContaining('No MCP servers'),
      expect.any(Object),
    );
  });
});

describe('handleMcpToggle', () => {
  it('posts no-session message when no active session', async () => {
    mocked.getActiveSessionRef.mockReturnValue(null);
    const hctx = makeHctx();
    await handleMcpToggle(
      hctx as never,
      { kind: 'mcp_toggle', serverName: 'aws-api', enabled: true } as never,
    );
    expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'C1',
      '1.1',
      expect.stringContaining('No active session'),
    );
  });

  it('posts not-found message when server name does not match', async () => {
    mocked.getActiveSessionRef.mockReturnValue({
      sessionKey: 'sess_1',
      session: { tool: 'claude', mode: 'write', toolState: {} },
    });
    mocked.resolveSessionMcpSelection.mockReturnValue({
      filterActive: false,
      allServers: [{ id: 'srv-1', name: 'aws-api', transport: 'sse' }] as McpServerRecord[],
      enabledServerIds: new Set(['srv-1']),
      enabledServers: [],
      enabledServerNames: new Set(),
    });
    const hctx = makeHctx();
    await handleMcpToggle(
      hctx as never,
      { kind: 'mcp_toggle', serverName: 'nonexistent', enabled: true } as never,
    );
    expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'C1',
      '1.1',
      expect.stringContaining('was not found'),
      expect.any(Object),
    );
  });

  it('posts not-found with "none" when allServers is empty', async () => {
    mocked.getActiveSessionRef.mockReturnValue({
      sessionKey: 'sess_1',
      session: { tool: 'claude', mode: 'write', toolState: {} },
    });
    mocked.resolveSessionMcpSelection.mockReturnValue({
      filterActive: false,
      allServers: [],
      enabledServerIds: new Set(),
      enabledServers: [],
      enabledServerNames: new Set(),
    });
    const hctx = makeHctx();
    await handleMcpToggle(
      hctx as never,
      { kind: 'mcp_toggle', serverName: 'any', enabled: true } as never,
    );
    expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'C1',
      '1.1',
      expect.stringContaining('Available: none'),
      expect.any(Object),
    );
  });

  it('toggles server and posts updated list', async () => {
    mocked.getActiveSessionRef.mockReturnValue({
      sessionKey: 'sess_1',
      session: { tool: 'claude', mode: 'write', toolState: {} },
    });
    mocked.resolveSessionMcpSelection.mockReturnValue({
      filterActive: true,
      allServers: [{ id: 'srv-1', name: 'aws-api', transport: 'sse' }] as McpServerRecord[],
      enabledServerIds: new Set(['srv-1']),
      enabledServers: [],
      enabledServerNames: new Set(),
    });
    const hctx = makeHctx();
    await handleMcpToggle(
      hctx as never,
      { kind: 'mcp_toggle', serverName: 'aws-api', enabled: false } as never,
    );
    expect(hctx.ctx.sessionMcpServerStore.setEnabled).toHaveBeenCalledWith(
      'sess_1',
      'srv-1',
      false,
      ['srv-1'],
    );
  });
});

describe('handleMcpReset', () => {
  it('posts no-session message when no active session', async () => {
    mocked.getActiveSessionRef.mockReturnValue(null);
    const hctx = makeHctx();
    await handleMcpReset(hctx as never, { kind: 'mcp_reset' } as never);
    expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'C1',
      '1.1',
      expect.stringContaining('No active session'),
    );
  });

  it('resets and posts updated list', async () => {
    mocked.getActiveSessionRef.mockReturnValue({
      sessionKey: 'sess_1',
      session: { tool: 'claude', mode: 'write', toolState: {} },
    });
    mocked.resolveSessionMcpSelection.mockReturnValue({
      filterActive: false,
      allServers: [],
      enabledServerIds: new Set(),
      enabledServers: [],
      enabledServerNames: new Set(),
    });
    const hctx = makeHctx();
    await handleMcpReset(hctx as never, { kind: 'mcp_reset' } as never);
    expect(hctx.ctx.sessionMcpServerStore.reset).toHaveBeenCalledWith('sess_1');
  });
});
