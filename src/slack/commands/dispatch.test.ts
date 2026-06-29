import { describe, expect, it, vi } from 'vitest';

// Mock all command handler modules
const mocked = vi.hoisted(() => ({
  handleUnknownBang: vi.fn(),
  handleListCommands: vi.fn(),
  handleMenu: vi.fn(),
  handleSessions: vi.fn(),
  handleSessionClear: vi.fn(),
  handleSessionClearAll: vi.fn(),
  handleCurrentSession: vi.fn(),
  handleNewSession: vi.fn(),
  handleStartSession: vi.fn(),
  handleExit: vi.fn(),
  handleStop: vi.fn(),
  handleStatus: vi.fn(),
  handleReset: vi.fn(),
  handleToolSwitch: vi.fn(),
  handleModeChange: vi.fn(),
  handleModeNetDisabled: vi.fn(),
  handleConfirm: vi.fn(),
  handleModelQuery: vi.fn(),
  handleModelChange: vi.fn(),
  handleWorkdirQuery: vi.fn(),
  handleWorkdirReset: vi.fn(),
  handleWorkdirChange: vi.fn(),
  handleMcp: vi.fn(),
  handleMcpToggle: vi.fn(),
  handleMcpReset: vi.fn(),
  handleDevList: vi.fn(),
  handleDev: vi.fn(),
  handleDevNew: vi.fn(),
  handleAutorun: vi.fn(),
  handlePrompt: vi.fn(),
  handleTask: vi.fn(),
  handleOrch: vi.fn(),
  handleOrchList: vi.fn(),
  handleOrchStatus: vi.fn(),
  handleOrchCancel: vi.fn(),
}));

vi.mock('./dev.js', () => ({
  handleDev: mocked.handleDev,
  handleDevList: mocked.handleDevList,
  handleDevNew: mocked.handleDevNew,
}));
vi.mock('./execution.js', () => ({
  handleExit: mocked.handleExit,
  handleReset: mocked.handleReset,
  handleStatus: mocked.handleStatus,
  handleStop: mocked.handleStop,
}));
vi.mock('./mcp.js', () => ({
  handleMcp: mocked.handleMcp,
  handleMcpReset: mocked.handleMcpReset,
  handleMcpToggle: mocked.handleMcpToggle,
}));
vi.mock('./menu.js', () => ({
  handleListCommands: mocked.handleListCommands,
  handleMenu: mocked.handleMenu,
  handleUnknownBang: mocked.handleUnknownBang,
}));
vi.mock('./prompt.js', () => ({
  handleAutorun: mocked.handleAutorun,
  handlePrompt: mocked.handlePrompt,
}));
vi.mock('./session.js', () => ({
  handleCurrentSession: mocked.handleCurrentSession,
  handleNewSession: mocked.handleNewSession,
  handleSessionClear: mocked.handleSessionClear,
  handleSessionClearAll: mocked.handleSessionClearAll,
  handleSessions: mocked.handleSessions,
  handleStartSession: mocked.handleStartSession,
}));
vi.mock('./task.js', () => ({
  handleOrch: mocked.handleOrch,
  handleOrchCancel: mocked.handleOrchCancel,
  handleOrchList: mocked.handleOrchList,
  handleOrchStatus: mocked.handleOrchStatus,
  handleTask: mocked.handleTask,
}));
vi.mock('./tool-mode.js', () => ({
  handleConfirm: mocked.handleConfirm,
  handleModeChange: mocked.handleModeChange,
  handleModeNetDisabled: mocked.handleModeNetDisabled,
  handleModelChange: mocked.handleModelChange,
  handleModelQuery: mocked.handleModelQuery,
  handleToolSwitch: mocked.handleToolSwitch,
}));
vi.mock('./workdir.js', () => ({
  handleWorkdirChange: mocked.handleWorkdirChange,
  handleWorkdirQuery: mocked.handleWorkdirQuery,
  handleWorkdirReset: mocked.handleWorkdirReset,
}));

import { dispatchCommand } from './dispatch.js';

const hctx = {} as never;

describe('dispatchCommand', () => {
  // Cover the specific uncovered cases: model_query, model_change, orch_list, and default
  it('dispatches model_query', async () => {
    await dispatchCommand(hctx, { kind: 'model_query' } as never);
    expect(mocked.handleModelQuery).toHaveBeenCalledWith(hctx, { kind: 'model_query' });
  });

  it('dispatches model_change', async () => {
    await dispatchCommand(hctx, { kind: 'model_change', model: 'gpt-4' } as never);
    expect(mocked.handleModelChange).toHaveBeenCalledWith(hctx, {
      kind: 'model_change',
      model: 'gpt-4',
    });
  });

  it('dispatches orch_list', async () => {
    await dispatchCommand(hctx, { kind: 'orch_list' } as never);
    expect(mocked.handleOrchList).toHaveBeenCalledWith(hctx);
  });

  it('dispatches mcp_reset', async () => {
    await dispatchCommand(hctx, { kind: 'mcp_reset' } as never);
    expect(mocked.handleMcpReset).toHaveBeenCalledWith(hctx, { kind: 'mcp_reset' });
  });

  it('dispatches mcp_toggle', async () => {
    const cmd = { kind: 'mcp_toggle' as const, serverName: 'x', enabled: true };
    await dispatchCommand(hctx, cmd as never);
    expect(mocked.handleMcpToggle).toHaveBeenCalledWith(hctx, cmd);
  });
});
