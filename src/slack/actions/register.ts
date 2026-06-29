/** @module slack/actions/register — Facade that binds all Block Kit interactive action handlers. */
import type { App } from '@slack/bolt';
import type { AppContext } from '../../context/app-context.js';
import { logger } from '../../utils/logger.js';
import {
  ACTION_MCP_AUTH_APPROVE,
  ACTION_MCP_AUTH_REJECT,
  ACTION_MENU_DEV_SELECT,
  ACTION_MENU_EXIT,
  ACTION_MENU_NEW_SESSION,
  ACTION_MENU_RESET,
  ACTION_MENU_SESSION_CLEAR,
  ACTION_MENU_SESSION_CLEAR_ALL,
  ACTION_MENU_SESSION_DELETE,
  ACTION_MENU_SESSION_LIST,
  ACTION_MENU_STOP,
  ACTION_MENU_TOOL_SELECT,
  ACTION_MODE_SELECT,
  ACTION_SESSION_RESUME,
  ACTION_TOOL_APPROVE,
  ACTION_TOOL_REJECT,
} from '../block-kit.js';
import { registerApprovalActions } from './approval.js';
import { registerDashboardMenuActions } from './dashboard-menu.js';
import { registerDevSelectionActions } from './dev-selection.js';
import { registerSessionActions } from './session.js';

/** Bind all Block Kit interactive action handlers to the Bolt app. */
export function registerActionHandlers(ctx: AppContext, app: App): void {
  registerApprovalActions(ctx, app);
  registerSessionActions(ctx, app);
  registerDashboardMenuActions(ctx, app);
  registerDevSelectionActions(ctx, app);

  logger.info('block_kit_action_handlers_registered', {
    actions: [
      ACTION_TOOL_APPROVE,
      ACTION_TOOL_REJECT,
      ACTION_MCP_AUTH_APPROVE,
      ACTION_MCP_AUTH_REJECT,
      ACTION_SESSION_RESUME,
      ACTION_MODE_SELECT,
      ACTION_MENU_TOOL_SELECT,
      ACTION_MENU_EXIT,
      ACTION_MENU_STOP,
      ACTION_MENU_NEW_SESSION,
      ACTION_MENU_RESET,
      ACTION_MENU_DEV_SELECT,
      ACTION_MENU_SESSION_LIST,
      ACTION_MENU_SESSION_CLEAR,
      ACTION_MENU_SESSION_DELETE,
      ACTION_MENU_SESSION_CLEAR_ALL,
    ],
  });
}
