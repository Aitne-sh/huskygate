import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerRecord } from '../store/mcp-server.js';
import type { SessionMcpServerRecord } from '../store/session-mcp-server.js';
import {
  resolveEffectiveMcpServerSelection,
  resolveSessionMcpServerSelection,
} from './mcp-server-selection.js';

const mocked = vi.hoisted(() => ({
  warn: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocked.warn,
    error: vi.fn(),
  },
}));

function makeServer(id: string, name: string): McpServerRecord {
  return {
    id,
    name,
    tool: 'claude',
    transport: 'stdio',
    definition: { command: 'echo' },
    createdAt: '2026-03-10T00:00:00.000Z',
    updatedAt: '2026-03-10T00:00:00.000Z',
  };
}

function makeSessionRow(serverId: string, enabled: boolean): SessionMcpServerRecord {
  return {
    sessionKey: 'sess-1',
    serverId,
    enabled,
  };
}

beforeEach(() => {
  mocked.warn.mockReset();
});

describe('resolveSessionMcpServerSelection', () => {
  const allServers = [makeServer('srv-1', 'aws'), makeServer('srv-2', 'github')];

  it('returns all servers when no session rows exist', () => {
    const selection = resolveSessionMcpServerSelection(allServers, []);

    expect(selection.filterActive).toBe(false);
    expect(selection.enabledServers.map((server) => server.id)).toEqual(['srv-1', 'srv-2']);
  });

  it('filters to enabled session rows when overrides exist', () => {
    const selection = resolveSessionMcpServerSelection(allServers, [
      makeSessionRow('srv-1', true),
      makeSessionRow('srv-2', false),
    ]);

    expect(selection.filterActive).toBe(true);
    expect(selection.enabledServers.map((server) => server.id)).toEqual(['srv-1']);
    expect([...selection.enabledServerNames]).toEqual(['aws']);
  });

  it('returns all servers when all session overrides are enabled', () => {
    const selection = resolveSessionMcpServerSelection(allServers, [
      makeSessionRow('srv-1', true),
      makeSessionRow('srv-2', true),
    ]);

    expect(selection.filterActive).toBe(true);
    expect(selection.enabledServers.map((server) => server.id)).toEqual(['srv-1', 'srv-2']);
  });

  it('ignores overrides for unknown server ids', () => {
    const selection = resolveSessionMcpServerSelection(allServers, [
      makeSessionRow('srv-missing', true),
    ]);

    expect(selection.filterActive).toBe(true);
    expect(selection.enabledServers).toEqual([]);
    expect(selection.enabledServerIds.size).toBe(0);
  });
});

describe('resolveEffectiveMcpServerSelection', () => {
  const allServers = [
    makeServer('srv-1', 'aws'),
    makeServer('srv-2', 'github'),
    makeServer('srv-3', 'linear'),
  ];
  const sessionRows = [
    makeSessionRow('srv-1', true),
    makeSessionRow('srv-2', false),
    makeSessionRow('srv-3', true),
  ];

  it('delegates to session selection when enabledMcpServerIds is null', () => {
    const selection = resolveEffectiveMcpServerSelection(allServers, sessionRows, null);

    expect(selection.enabledServers.map((server) => server.id)).toEqual(['srv-1', 'srv-3']);
  });

  it('intersects enabledMcpServerIds with the session-enabled set', () => {
    const selection = resolveEffectiveMcpServerSelection(allServers, sessionRows, [
      'srv-2',
      'srv-3',
    ]);

    expect(selection.enabledServers.map((server) => server.id)).toEqual(['srv-3']);
  });

  it('cannot widen beyond the session-enabled set', () => {
    const selection = resolveEffectiveMcpServerSelection(allServers, sessionRows, ['srv-2']);

    expect(selection.enabledServers).toEqual([]);
    expect(selection.enabledServerIds.size).toBe(0);
  });

  it('warns when enabledMcpServerIds contains unknown ids', () => {
    const selection = resolveEffectiveMcpServerSelection(allServers, sessionRows, [
      'srv-3',
      'srv-missing',
    ]);

    expect(selection.enabledServers.map((server) => server.id)).toEqual(['srv-3']);
    expect(mocked.warn).toHaveBeenCalledWith(
      'mcp_server_selection_invalid_id',
      expect.objectContaining({
        invalidServerId: 'srv-missing',
      }),
    );
  });
});
