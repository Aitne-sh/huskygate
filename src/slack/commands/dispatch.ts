/** @module commands/dispatch — Central dispatch + re-exports of all command handlers */
import type { HandlerContext } from '../handler-context.js';
import type { CommandType } from '../parser.js';

// Domain handlers
import { handleDev, handleDevList, handleDevNew } from './dev.js';
import { handleExit, handleReset, handleStatus, handleStop } from './execution.js';
import { handleMcp, handleMcpReset, handleMcpToggle } from './mcp.js';
import { handleListCommands, handleMenu, handleUnknownBang } from './menu.js';
import { handleAutorun, handlePrompt } from './prompt.js';
import {
  handleCurrentSession,
  handleNewSession,
  handleSessionClear,
  handleSessionClearAll,
  handleSessions,
  handleStartSession,
} from './session.js';
import {
  handleOrch,
  handleOrchCancel,
  handleOrchList,
  handleOrchStatus,
  handleTask,
} from './task.js';
import {
  handleConfirm,
  handleModeChange,
  handleModeNetDisabled,
  handleModelChange,
  handleModelQuery,
  handleToolSwitch,
} from './tool-mode.js';
import { handleWorkdirChange, handleWorkdirQuery, handleWorkdirReset } from './workdir.js';

// Re-export all handlers for consumers
export { handleUnknownBang, handleListCommands, handleMenu } from './menu.js';
export {
  handleSessions,
  handleSessionClear,
  handleSessionClearAll,
  handleCurrentSession,
  handleStartSession,
  handleNewSession,
} from './session.js';
export { handleExit, handleStop, handleStatus, handleReset } from './execution.js';
export {
  handleToolSwitch,
  handleModelQuery,
  handleModelChange,
  handleModeNetDisabled,
  handleModeChange,
  handleConfirm,
} from './tool-mode.js';
export { handleWorkdirQuery, handleWorkdirReset, handleWorkdirChange } from './workdir.js';
export { handleMcp, handleMcpToggle, handleMcpReset } from './mcp.js';
export { handleDevList, handleDev, handleDevNew } from './dev.js';
export { handlePrompt, handleAutorun } from './prompt.js';
export {
  handleTask,
  handleOrch,
  handleOrchList,
  handleOrchStatus,
  handleOrchCancel,
} from './task.js';

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function dispatchCommand(hctx: HandlerContext, command: CommandType): Promise<void> {
  switch (command.kind) {
    case 'unknown_bang':
      return handleUnknownBang(hctx, command);
    case 'list_commands':
      return handleListCommands(hctx, command);
    case 'menu':
      return handleMenu(hctx, command);
    case 'sessions':
      return handleSessions(hctx, command);
    case 'session_clear':
      return handleSessionClear(hctx, command);
    case 'session_clear_all':
      return handleSessionClearAll(hctx, command);
    case 'current_session':
      return handleCurrentSession(hctx, command);
    case 'exit':
      return handleExit(hctx, command);
    case 'start_session':
      return handleStartSession(hctx, command);
    case 'tool_switch':
      return handleToolSwitch(hctx, command);
    case 'new_session':
      return handleNewSession(hctx, command);
    case 'stop':
      return handleStop(hctx, command);
    case 'status':
      return handleStatus(hctx, command);
    case 'reset':
      return handleReset(hctx, command);
    case 'mode_net_disabled':
      return handleModeNetDisabled(hctx, command);
    case 'mode_change':
      return handleModeChange(hctx, command);
    case 'confirm':
      return handleConfirm(hctx, command);
    case 'workdir_query':
      return handleWorkdirQuery(hctx, command);
    case 'workdir_reset':
      return handleWorkdirReset(hctx, command);
    case 'workdir_change':
      return handleWorkdirChange(hctx, command);
    case 'mcp':
      return handleMcp(hctx, command);
    case 'mcp_toggle':
      return handleMcpToggle(hctx, command);
    case 'mcp_reset':
      return handleMcpReset(hctx, command);
    case 'model_query':
      return handleModelQuery(hctx, command);
    case 'model_change':
      return handleModelChange(hctx, command);
    case 'dev_list':
      return handleDevList(hctx, command);
    case 'dev':
      return handleDev(hctx, command);
    case 'dev_new':
      return handleDevNew(hctx, command);
    case 'autorun':
      return handleAutorun(hctx, command);
    case 'task':
      return handleTask(hctx, command);
    case 'orch':
      return handleOrch(hctx, command);
    case 'orch_list':
      return handleOrchList(hctx);
    case 'orch_status':
      return handleOrchStatus(hctx, command);
    case 'orch_cancel':
      return handleOrchCancel(hctx, command);
    case 'prompt':
      return handlePrompt(hctx, command);
    default: {
      const _exhaustive: never = command;
      return handleUnknownBang(hctx, _exhaustive as Extract<CommandType, { kind: 'unknown_bang' }>);
    }
  }
}
