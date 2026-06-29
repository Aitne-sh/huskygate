/** @module shared/schemas/common — Reusable Zod schemas for API boundary validation. */
import { z } from 'zod';

// ── Enum schemas ────────────────────────────────────────────────────────────────

export const ToolNameSchema = z.enum(['claude', 'codex', 'gemini']);

export const OutputModeSchema = z.enum(['auto', 'manual']);

export const ErrorPolicySchema = z.enum(['fail_fast', 'continue']);

export const ScheduleTypeSchema = z.enum(['once', 'recurring']);

export const TriggerModeSchema = z.enum(['ondemand', 'webhook']);

export const NodeTypeSchema = z.enum(['task', 'triggered', 'gate', 'end']);

export const GateModeSchema = z.enum(['and', 'or']);

export const ConditionOperatorSchema = z.enum(['eq', 'neq', 'in', 'regex']);

export const PublisherPresetSchema = z.enum(['generic', 'github', 'slack', 'jira']);

export const VerificationTypeSchema = z.enum([
  'none',
  'hmac-sha256',
  'hmac-sha1',
  'bearer',
  'slack-v0',
]);

// ── Primitive schemas ───────────────────────────────────────────────────────────

/** Nullable string — normalizes empty/whitespace-only strings to null. Rejects non-string input. */
export const NullableString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((val): string | null => (typeof val === 'string' && val.trim() ? val.trim() : null));

/** Non-negative integer. */
export const NonNegativeInt = z.number().int().min(0);
