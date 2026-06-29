/** @module shared/field-limits — Centralized API field validation constraints */

/**
 * Maximum lengths for user-facing input fields.
 * Consumed by API route validation to enforce consistent constraints.
 */
export const FIELD_LIMITS = {
  /** Task/schedule/orchestrator name */
  name: { max: 200 },
  /** Prompt text */
  prompt: { max: 50_000 },
  /** Description text */
  description: { max: 2_000 },
  /** Task alias */
  alias: { max: 100 },
  /** Instruction file content */
  instructionFile: { max: 50_000 },
  /** Return condition text (orchestrator) */
  returnConditionText: { max: 2_000 },
  /**
   * Return value identifier (API input validation).
   * Note: runtime parse truncation in return-value.ts uses a larger safety bound (500)
   * because agents may output unexpected long values; this limit governs user-configured identifiers.
   */
  returnValue: { max: 100 },
  /** Max return conditions per orchestrator */
  returnConditionsCount: { max: 20 },
  /** DAG regex pattern */
  regexPattern: { max: 200 },
} as const;

/** Validation pattern for return value identifiers (alphanumeric, underscore, hyphen). */
export const RETURN_VALUE_RE = /^[a-zA-Z0-9_-]+$/;

/** Validation pattern for Slack User IDs (U or W prefix + alphanumeric). */
export const SLACK_USER_ID_RE = /^[UW][A-Z0-9]{2,}$/i;
