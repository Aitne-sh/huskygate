/** @module orchestrator-limits — Validation constraints and defaults for orchestrator parallelism and node count */

/** Default values for orchestrator-level fields. All fallback defaults across the codebase should reference this. */
export const ORCHESTRATOR_DEFAULTS = {
  maxParallelism: 3,
  maxTotalNodes: 50,
  maxRunWorkdirs: 20,
  errorPolicy: 'continue' as const,
} as const;

export const ORCHESTRATOR_LIMIT_RANGES = {
  maxParallelism: { min: 1, max: 20 },
  maxTotalNodes: { min: 1, max: 200 },
  timeoutSec: { min: 1, max: 86_400, nullable: true },
} as const;

export type OrchestratorLimitField = keyof typeof ORCHESTRATOR_LIMIT_RANGES;

export function validateOrchestratorLimits(
  input: Partial<Record<OrchestratorLimitField, unknown>>,
): string | null {
  for (const [field, range] of Object.entries(ORCHESTRATOR_LIMIT_RANGES) as Array<
    [OrchestratorLimitField, (typeof ORCHESTRATOR_LIMIT_RANGES)[OrchestratorLimitField]]
  >) {
    const value = input[field];
    if (value === undefined) continue;
    if ('nullable' in range && range.nullable && value === null) continue;
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return `${field} must be an integer between ${range.min} and ${range.max}`;
    }
    if (value < range.min || value > range.max) {
      return `${field} must be between ${range.min} and ${range.max}`;
    }
  }

  return null;
}

export function assertValidOrchestratorLimits(
  input: Partial<Record<OrchestratorLimitField, unknown>>,
): void {
  const error = validateOrchestratorLimits(input);
  if (error) throw new Error(error);
}

export const ORCHESTRATOR_NODE_LIMIT_RANGES = {
  maxRetries: { min: 0, max: 10 },
  timeoutSec: { min: 1, max: 21_600, nullable: true },
  waitTimeoutSec: { min: 1, max: 86_400, nullable: true },
} as const;

export type OrchestratorNodeLimitField = keyof typeof ORCHESTRATOR_NODE_LIMIT_RANGES;

export function validateOrchestratorNodeLimits(
  input: Partial<Record<OrchestratorNodeLimitField, unknown>>,
): string | null {
  for (const [field, range] of Object.entries(ORCHESTRATOR_NODE_LIMIT_RANGES) as Array<
    [
      OrchestratorNodeLimitField,
      (typeof ORCHESTRATOR_NODE_LIMIT_RANGES)[OrchestratorNodeLimitField],
    ]
  >) {
    const value = input[field];
    if (value === undefined) continue;
    if ('nullable' in range && range.nullable && value === null) continue;
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return `${field} must be an integer between ${range.min} and ${range.max}`;
    }
    if (value < range.min || value > range.max) {
      return `${field} must be between ${range.min} and ${range.max}`;
    }
  }

  return null;
}

export function assertValidOrchestratorNodeLimits(
  input: Partial<Record<OrchestratorNodeLimitField, unknown>>,
): void {
  const error = validateOrchestratorNodeLimits(input);
  if (error) throw new Error(error);
}
