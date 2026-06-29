/** @module engine-utils — Pure helpers (workdir resolution, path sanitization, formatting) with no engine state. */

import path from 'node:path';
import type { ToolName } from '../config.js';
import type { Orchestrator, OrchestratorNode } from './types.js';

/** Engine-level catch-all return value for unmatched/missing return tags when returnValues is defined. */
export const OTHER_RETURN = 'other_return';

/** Engine-level return value for CLI process failures (spawn error, timeout, non-zero exit) after retries exhausted. */
export const ERROR_RETURN = 'error_return';

/** Sanitize a string for use as a directory name: strip unsafe chars, limit length. */
export function sanitizeForPath(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 100) || '_';
}

export function resolveWorkdir(orchestrator: Orchestrator, runId: string): string {
  if (orchestrator.workdir) {
    return orchestrator.workdir;
  }
  return path.join(process.cwd(), 'workdir', `orch_${runId.slice(0, 8)}`);
}

export function resolveNodeWorkdir(
  orchestrator: Orchestrator,
  node: OrchestratorNode,
  runId: string,
): string {
  return node.workdir ?? resolveWorkdir(orchestrator, runId);
}

export function resolveNodeInstructionFile(
  orchestrator: Orchestrator,
  node: OrchestratorNode,
): { skip: boolean; content: string | null } {
  if (!node.writeInstructionFile) {
    return { skip: true, content: null };
  }
  return {
    skip: false,
    content: node.instructionFile ?? orchestrator.instructionFile,
  };
}

export function listCustomWorkdirs(
  orchestrator: Orchestrator,
  nodes: OrchestratorNode[],
): Array<
  { scope: 'orchestrator'; workdir: string } | { scope: 'node'; nodeLabel: string; workdir: string }
> {
  const customWorkdirs: Array<
    | { scope: 'orchestrator'; workdir: string }
    | { scope: 'node'; nodeLabel: string; workdir: string }
  > = [];
  if (orchestrator.workdir) {
    customWorkdirs.push({ scope: 'orchestrator', workdir: orchestrator.workdir });
  }

  for (const node of nodes) {
    if (node.nodeType !== 'task' || !node.workdir) continue;
    customWorkdirs.push({ scope: 'node', nodeLabel: node.label, workdir: node.workdir });
  }

  return customWorkdirs;
}

export function getInstructionFilePath(workdir: string, tool: ToolName): string {
  switch (tool) {
    case 'codex':
      return path.join(workdir, 'AGENTS.md');
    case 'gemini':
      return path.join(workdir, 'GEMINI.md');
    default:
      return path.join(workdir, 'CLAUDE.md');
  }
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
