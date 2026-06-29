/** @module driver-factory — Factory for creating AI driver instances (Claude, Codex, Gemini) by tool name */
import type { ToolName } from '../config.js';
import { ClaudeDriver } from './driver-claude.js';
import { CodexDriver } from './driver-codex.js';
import { GeminiDriver } from './driver-gemini.js';
import type { Driver } from './types.js';

const driverCtors: Record<ToolName, new () => Driver> = {
  claude: ClaudeDriver,
  codex: CodexDriver,
  gemini: GeminiDriver,
};

/** Create a Driver instance for the given tool. */
export function createDriver(tool: ToolName): Driver {
  return new driverCtors[tool]();
}

/** Shorthand: get driver-specific environment variables. */
export function getDriverEnv(tool: ToolName): Record<string, string> {
  return createDriver(tool).buildEnv();
}
