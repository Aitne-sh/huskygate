/** @module server/routes/orchestrator-shared — Shared constants, validators, and SSE helpers for orchestrator API routes. */
import type { ServerResponse } from 'node:http';
import type { ToolName } from '../../config.js';
import type { AppContext } from '../../context/app-context.js';
import { ORCHESTRATOR_DEFAULTS } from '../../orchestrator/orchestrator-limits.js';
import type { ReturnCondition, TriggeredNodeConfig } from '../../orchestrator/types.js';
import { INTERVALS } from '../../shared/constants.js';
import { FIELD_LIMITS } from '../../shared/field-limits.js';
import {
  ErrorPolicySchema,
  NonNegativeInt,
  OutputModeSchema,
  ScheduleTypeSchema,
} from '../../shared/schemas/common.js';
import {
  InstructionFileSchema,
  ReturnConditionsSchema,
  SummaryToolSchema,
  TriggeredConfigSchema,
} from '../../shared/schemas/orchestrator.js';
import { formatZodError } from '../../shared/schemas/validation.js';
import { errorMessage } from '../../utils/error.js';

// ─── Constants (derived from Zod schemas — single source of truth) ───
export const VALID_OUTPUT_MODES: ReadonlySet<string> = new Set(OutputModeSchema.options);
export const VALID_SCHEDULE_TYPES: ReadonlySet<string> = new Set(ScheduleTypeSchema.options);
export const VALID_ERROR_POLICIES: ReadonlySet<string> = new Set(ErrorPolicySchema.options);
export const MAX_RETURN_VALUE_LENGTH = FIELD_LIMITS.returnValue.max;

// ─── Validation functions (Zod-backed) ─────────────────────

/** Parse and validate maxRunWorkdirs for POST. Returns default when absent; rejects invalid values. */
export function orchMaxRunWorkdirs(raw: unknown): { value: number; error?: string } {
  if (raw === undefined || raw === null) return { value: ORCHESTRATOR_DEFAULTS.maxRunWorkdirs };
  const result = NonNegativeInt.safeParse(raw);
  if (!result.success) {
    return { value: 0, error: 'maxRunWorkdirs must be a non-negative integer' };
  }
  return { value: result.data };
}

export function normalizeSummaryEnabled(raw: unknown): boolean {
  return raw === true || raw === 1;
}

export function parseSummaryTool(raw: unknown): {
  value: ToolName | null;
  error?: string;
} {
  if (raw === undefined) return { value: null };
  const result = SummaryToolSchema.safeParse(raw);
  if (!result.success) {
    return {
      value: null,
      error: `Invalid summaryTool: ${String(raw)}. Must be one of: claude, codex, gemini`,
    };
  }
  return { value: result.data ?? null };
}

export function validateNodeInstructionFile(raw: unknown): {
  value: string | null | undefined;
  error?: string;
} {
  if (raw === undefined) return { value: undefined };
  if (raw === null || raw === '') return { value: null };
  const result = InstructionFileSchema.safeParse(raw);
  if (!result.success) {
    return { value: undefined, error: formatZodError(result.error) };
  }
  return { value: result.data ?? undefined };
}

/** Context-dependent: requires AppContext for workdir validation. */
export function validateNodeWorkdir(
  ctx: AppContext,
  raw: unknown,
): { value: string | null | undefined; error?: string } {
  if (raw === undefined) return { value: undefined };
  if (raw === null) return { value: null };
  if (typeof raw !== 'string') {
    return { value: undefined, error: 'workdir must be a string or null' };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { value: null };
  try {
    return { value: ctx.workdirManager.validateCustomWorkdir(trimmed) };
  } catch (err) {
    return { value: undefined, error: errorMessage(err) };
  }
}

/** Context-dependent: requires AppContext for MCP server ID validation. */
export function validateEnabledMcpServerIds(
  ctx: AppContext,
  tool: ToolName | null,
  raw: unknown,
): { value: string[] | null | undefined; error?: string } {
  if (raw === undefined) return { value: undefined };
  if (raw === null) return { value: null };
  if (!Array.isArray(raw)) {
    return {
      value: undefined,
      error: 'enabledMcpServerIds must be an array of server IDs or null',
    };
  }
  if (!tool) {
    return { value: undefined, error: 'tool is required when enabledMcpServerIds is provided' };
  }

  const allowedIds = new Set(ctx.mcpServerStore.listByTool(tool).map((server) => server.id));
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string' || !entry.trim()) {
      return { value: undefined, error: 'enabledMcpServerIds must contain non-empty strings' };
    }
    if (!allowedIds.has(entry)) {
      return {
        value: undefined,
        error: `Unknown MCP server ID for tool ${tool}: ${entry}`,
      };
    }
    if (!seen.has(entry)) {
      seen.add(entry);
      deduped.push(entry);
    }
  }
  return { value: deduped.length > 0 ? deduped : null };
}

export function validateTriggeredConfig(raw: unknown): {
  value: TriggeredNodeConfig | null | undefined;
  error?: string;
} {
  if (raw === undefined) return { value: undefined };
  if (raw === null) return { value: null };
  const result = TriggeredConfigSchema.safeParse(raw);
  if (!result.success) {
    return { value: undefined, error: formatZodError(result.error) };
  }
  if (!result.data) return { value: null };
  return { value: result.data };
}

/**
 * Validate a returnConditions array from request body (Zod-backed).
 * Returns { conditions, error } — if error is set, respond 400 and return early.
 */
export function validateReturnConditions(raw: unknown): {
  conditions: ReturnCondition[] | null;
  error?: string;
} {
  if (raw === undefined || raw === null) return { conditions: null };
  if (!Array.isArray(raw)) return { conditions: null }; // silently ignore non-array

  const result = ReturnConditionsSchema.safeParse(raw);
  if (!result.success) {
    return { conditions: null, error: formatZodError(result.error) };
  }
  return { conditions: (result.data as ReturnCondition[] | null) ?? null };
}

// ─── SSE helpers (thin wrappers to avoid re-exporting internal api.ts state) ──

/** Monotonic event ID counter for orchestrator SSE streams. */
export let sseEventIdCounter = 0;

export function sseWrite(res: ServerResponse, data: unknown): boolean {
  if (res.writableEnded) return false;
  try {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    const id = ++sseEventIdCounter;
    return res.write(`id: ${id}\ndata: ${payload}\n\n`);
  } catch {
    return false;
  }
}

export function sseRetry(res: ServerResponse, ms: number): void {
  if (res.writableEnded) return;
  try {
    res.write(`retry: ${ms}\n\n`);
  } catch {
    /* ignore — connection may already be closed */
  }
}

export const HEARTBEAT_INTERVAL_MS = INTERVALS.sseHeartbeat;

export function startHeartbeat(res: ServerResponse): ReturnType<typeof setInterval> {
  return setInterval(() => {
    if (res.writableEnded) return;
    try {
      res.write(': heartbeat\n\n');
    } catch {
      /* ignore — connection may already be closed */
    }
  }, HEARTBEAT_INTERVAL_MS);
}
