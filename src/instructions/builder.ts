/** @module instructions/builder — Assembles tool-specific instruction files from code-managed sections. */

import type { ToolName } from '../config.js';
import {
  CONSTRAINTS_SHARED,
  CONSTRAINT_GEMINI_HEREDOC,
  CORE_PRINCIPLES,
  ENVIRONMENT_AUTORUN_DIRECTIVES,
  ENVIRONMENT_SHARED,
  ENVIRONMENT_STANDARD_DIRECTIVES,
  MCP_APPROVAL,
  MCP_AUTORUN,
  MCP_DISABLED,
  OUTPUT_FILES,
  RESPONSE_FORMAT_CHAT,
  ROLE,
  TOOL_IDENTITY,
} from './sections.js';

/** Execution source — determines which sections are included. */
export type InstructionSource = 'chat' | 'orchestrator' | 'schedule' | 'standalone-task';

/** Full context required to build an instruction file. */
export interface InstructionContext {
  /** Target tool (claude / codex / gemini). */
  tool: ToolName;
  /** Where this instruction will be used. */
  source: InstructionSource;
  /** Whether auto-approve mode is active. */
  autoApprove: boolean;
  /** Whether MCP tools are permitted for this execution. */
  allowMcp: boolean;
  /** Optional user-defined content appended as "Additional Instructions". */
  customContent?: string | null;
}

/**
 * Build a complete instruction file from structured sections + optional custom content.
 *
 * Section order matches the original templates to minimize behavioral drift:
 * Identity -> Core Principles -> Environment -> Constraints -> Output Files ->
 * MCP Policy -> Response Format -> Additional Instructions
 */
export function buildInstruction(ctx: InstructionContext): string {
  const sections: string[] = [];

  // 1. Identity
  sections.push(buildIdentity(ctx.tool));

  // 2. Core Principles
  sections.push(`## Core Principles\n\n${CORE_PRINCIPLES}`);

  // 3. Environment
  sections.push(buildEnvironment(ctx.autoApprove));

  // 4. Constraints
  sections.push(buildConstraints(ctx.tool));

  // 5. Output Files
  sections.push(`## Output Files\n\n${OUTPUT_FILES}`);

  // 6. MCP Policy
  sections.push(buildMcpPolicy(ctx.allowMcp, ctx.autoApprove));

  // 7. Response Format (chat only)
  const responseFormat = buildResponseFormat(ctx.source);
  if (responseFormat) {
    sections.push(responseFormat);
  }

  // 8. Custom content (user-defined, from DB)
  const trimmed = ctx.customContent?.trim();
  if (trimmed) {
    sections.push(`## Additional Instructions\n\n${trimmed}`);
  }

  return `${sections.join('\n\n')}\n`;
}

/* ── Section builders ── */

function buildIdentity(tool: ToolName): string {
  const identity = TOOL_IDENTITY[tool];
  return `# ${identity.name}\n\n**Role:** ${ROLE}`;
}

function buildEnvironment(autoApprove: boolean): string {
  const directives = autoApprove ? ENVIRONMENT_AUTORUN_DIRECTIVES : ENVIRONMENT_STANDARD_DIRECTIVES;
  if (directives) {
    return `## Environment\n\n${ENVIRONMENT_SHARED}\n${directives}`;
  }
  return `## Environment\n\n${ENVIRONMENT_SHARED}`;
}

function buildConstraints(tool: ToolName): string {
  const parts = [CONSTRAINTS_SHARED];
  if (tool === 'gemini') {
    parts.push(CONSTRAINT_GEMINI_HEREDOC);
  }
  return `## Constraints\n\n${parts.join('\n')}`;
}

function buildMcpPolicy(allowMcp: boolean, autoApprove: boolean): string {
  if (!allowMcp) {
    return `## MCP Tool Policy\n\n${MCP_DISABLED}`;
  }
  if (autoApprove) {
    return `## Tool Execution\n\n${MCP_AUTORUN}`;
  }
  return `## MCP Tool Policy\n\n${MCP_APPROVAL}`;
}

function buildResponseFormat(source: InstructionSource): string | null {
  if (source === 'chat') {
    return `## Response Format\n\n${RESPONSE_FORMAT_CHAT}`;
  }
  // Orchestrator / schedule / standalone-task: no <!-- answer --> marker needed
  return null;
}

/* ── Resolve instruction with full-replace support ── */

/**
 * Resolve the final instruction content, honouring the full-replace mode.
 *
 * Priority chain:
 * 1. `instructionOverride` — orchestrator-injected full content (highest)
 * 2. Default Custom Instructions with `enabled: true` — full replace
 * 3. Normal `buildInstruction()` + optional append (task-specific or default content)
 */
export function resolveInstruction(
  ctx: Omit<InstructionContext, 'customContent'>,
  taskInstructionFile: string | null | undefined,
  defaultInstr: { content: string; enabled: boolean },
): string {
  // Task-specific instructions always append to base prompt
  if (taskInstructionFile) {
    return buildInstruction({ ...ctx, customContent: taskInstructionFile });
  }
  // Full-replace: custom instructions become the entire instruction file
  if (defaultInstr.enabled && defaultInstr.content.trim()) {
    return defaultInstr.content;
  }
  // Normal: base prompt + optional default content as "Additional Instructions"
  return buildInstruction({ ...ctx, customContent: defaultInstr.content || null });
}
