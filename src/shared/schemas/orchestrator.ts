/** @module shared/schemas/orchestrator — Zod schemas for orchestrator API routes. */
import { z } from 'zod';
import { ORCHESTRATOR_NODE_LIMIT_RANGES } from '../../orchestrator/orchestrator-limits.js';
import { FIELD_LIMITS, RETURN_VALUE_RE } from '../field-limits.js';
import { ConditionOperatorSchema, ToolNameSchema } from './common.js';

// ── Field-level schemas ─────────────────────────────────────────────────────────

const MaxInstructionFileLength = FIELD_LIMITS.instructionFile.max;

export const InstructionFileSchema = z
  .string()
  .max(MaxInstructionFileLength, {
    message: `instructionFile must be <= ${MaxInstructionFileLength} characters`,
  })
  .nullable()
  .optional();

const ReturnConditionSchema = z.object({
  condition: z.string().max(FIELD_LIMITS.returnConditionText.max, {
    message: `returnConditions condition text exceeds maximum of ${FIELD_LIMITS.returnConditionText.max} characters`,
  }),
  value: z
    .string()
    .min(1, {
      message: `returnConditions value must be 1-${FIELD_LIMITS.returnValue.max} characters`,
    })
    .max(FIELD_LIMITS.returnValue.max, {
      message: `returnConditions value must be 1-${FIELD_LIMITS.returnValue.max} characters`,
    })
    .refine((val) => RETURN_VALUE_RE.test(val), {
      message:
        'returnConditions value contains invalid characters. Only alphanumeric, underscore, and hyphen are allowed.',
    }),
});

export const ReturnConditionsSchema = z
  .array(ReturnConditionSchema)
  .max(FIELD_LIMITS.returnConditionsCount.max, {
    message: `returnConditions exceeds maximum of ${FIELD_LIMITS.returnConditionsCount.max} entries`,
  })
  .nullable()
  .optional();

const waitTimeoutRange = ORCHESTRATOR_NODE_LIMIT_RANGES.waitTimeoutSec;
const waitTimeoutRangeMsg = `waitTimeoutSec must be between ${waitTimeoutRange.min} and ${waitTimeoutRange.max}`;

export const TriggeredConfigSchema = z
  .object({
    waitTimeoutSec: z
      .number({ message: 'triggeredConfig.waitTimeoutSec must be > 0' })
      .finite({ message: 'triggeredConfig.waitTimeoutSec must be > 0' })
      .positive({ message: 'triggeredConfig.waitTimeoutSec must be > 0' })
      .int({ message: waitTimeoutRangeMsg })
      .min(waitTimeoutRange.min, { message: waitTimeoutRangeMsg })
      .max(waitTimeoutRange.max, { message: waitTimeoutRangeMsg }),
    onTimeout: z.enum(['fail', 'skip'], {
      message: 'triggeredConfig.onTimeout must be fail or skip',
    }),
  })
  .nullable()
  .optional();

export const SummaryToolSchema = z.preprocess(
  (val) => (val === '' ? null : val),
  ToolNameSchema.nullable().optional(),
);

// ── Composite schemas ───────────────────────────────────────────────────────────

/** Schema for POST /api/orchestrators/:id/edges — create edge. */
export const CreateEdgeSchema = z
  .object({
    fromNodeId: z.string().min(1, { message: 'fromNodeId and toNodeId are required' }),
    toNodeId: z.string().min(1, { message: 'fromNodeId and toNodeId are required' }),
    conditionValue: z.string().nullable().optional(),
    conditionOperator: ConditionOperatorSchema.default('eq'),
    sortOrder: z.number().default(0),
  })
  .refine((data) => data.fromNodeId !== data.toNodeId, {
    message: 'Self-loop: fromNodeId and toNodeId cannot be the same node',
  });

export type CreateEdgeInput = z.infer<typeof CreateEdgeSchema>;

/** Schema for PATCH /api/orchestrators/:oid/edges/:eid — update edge. */
export const PatchEdgeSchema = z.object({
  conditionValue: z.union([z.string(), z.null()]).optional(),
  conditionOperator: ConditionOperatorSchema.optional(),
  sortOrder: z.number().optional(),
});

export type PatchEdgeInput = z.infer<typeof PatchEdgeSchema>;
