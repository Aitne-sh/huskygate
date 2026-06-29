/**
 * Coverage tests for commands/dispatch.ts — targets:
 * - Line 114: mcp case (re-export of handleMcp)
 * - Lines 144-146: default exhaustive check (handleUnknownBang fallback)
 */
import { describe, expect, it, vi } from 'vitest';

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

describe('dispatchCommand — coverage', () => {
  it('dispatches mcp command (line 114)', async () => {
    await dispatchCommand(hctx, { kind: 'mcp' } as never);
    expect(mocked.handleMcp).toHaveBeenCalledWith(hctx, { kind: 'mcp' });
  });

  it('dispatches prompt command', async () => {
    await dispatchCommand(hctx, { kind: 'prompt', text: 'hello' } as never);
    expect(mocked.handlePrompt).toHaveBeenCalledWith(hctx, { kind: 'prompt', text: 'hello' });
  });

  it('dispatches orch_status command', async () => {
    await dispatchCommand(hctx, { kind: 'orch_status', runId: 'r1' } as never);
    expect(mocked.handleOrchStatus).toHaveBeenCalledWith(hctx, {
      kind: 'orch_status',
      runId: 'r1',
    });
  });

  it('dispatches orch_cancel command', async () => {
    await dispatchCommand(hctx, { kind: 'orch_cancel', runId: 'r1' } as never);
    expect(mocked.handleOrchCancel).toHaveBeenCalledWith(hctx, {
      kind: 'orch_cancel',
      runId: 'r1',
    });
  });
});
