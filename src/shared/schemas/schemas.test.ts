/** @module shared/schemas/schemas.test — Tests for Zod API boundary schemas. */
import { describe, expect, it } from 'vitest';
import { NonNegativeInt, NullableString, ToolNameSchema } from './common.js';
import {
  CreateEdgeSchema,
  InstructionFileSchema,
  PatchEdgeSchema,
  ReturnConditionsSchema,
  SummaryToolSchema,
  TriggeredConfigSchema,
} from './orchestrator.js';
import { formatZodError } from './validation.js';

// ── Common schemas ────────────────────────────────────────────────────────────

describe('ToolNameSchema', () => {
  it('accepts valid tool names', () => {
    expect(ToolNameSchema.safeParse('claude').success).toBe(true);
    expect(ToolNameSchema.safeParse('codex').success).toBe(true);
    expect(ToolNameSchema.safeParse('gemini').success).toBe(true);
  });

  it('rejects invalid tool names', () => {
    expect(ToolNameSchema.safeParse('invalid').success).toBe(false);
    expect(ToolNameSchema.safeParse(123).success).toBe(false);
  });
});

describe('NonNegativeInt', () => {
  it('accepts non-negative integers', () => {
    expect(NonNegativeInt.safeParse(0).data).toBe(0);
    expect(NonNegativeInt.safeParse(5).data).toBe(5);
  });

  it('rejects negative numbers and non-integers', () => {
    expect(NonNegativeInt.safeParse(-1).success).toBe(false);
    expect(NonNegativeInt.safeParse(1.5).success).toBe(false);
  });
});

describe('NullableString', () => {
  it('trims and normalizes strings', () => {
    expect(NullableString.parse('hello')).toBe('hello');
    expect(NullableString.parse('  hello  ')).toBe('hello');
  });

  it('normalizes empty/whitespace to null', () => {
    expect(NullableString.parse('')).toBeNull();
    expect(NullableString.parse('  ')).toBeNull();
    expect(NullableString.parse(null)).toBeNull();
    expect(NullableString.parse(undefined)).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(NullableString.safeParse(123).success).toBe(false);
    expect(NullableString.safeParse({ key: 'val' }).success).toBe(false);
    expect(NullableString.safeParse([1, 2]).success).toBe(false);
  });
});

// ── Orchestrator schemas ──────────────────────────────────────────────────────

describe('CreateEdgeSchema', () => {
  it('accepts valid edge input', () => {
    const result = CreateEdgeSchema.safeParse({
      fromNodeId: 'node-1',
      toNodeId: 'node-2',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.conditionOperator).toBe('eq');
      expect(result.data.sortOrder).toBe(0);
    }
  });

  it('rejects self-loop', () => {
    const result = CreateEdgeSchema.safeParse({
      fromNodeId: 'node-1',
      toNodeId: 'node-1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty node IDs', () => {
    const result = CreateEdgeSchema.safeParse({
      fromNodeId: '',
      toNodeId: 'node-2',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid condition operators', () => {
    for (const op of ['eq', 'neq', 'in', 'regex'] as const) {
      const result = CreateEdgeSchema.safeParse({
        fromNodeId: 'a',
        toNodeId: 'b',
        conditionOperator: op,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid condition operator', () => {
    const result = CreateEdgeSchema.safeParse({
      fromNodeId: 'a',
      toNodeId: 'b',
      conditionOperator: 'between',
    });
    expect(result.success).toBe(false);
  });
});

describe('PatchEdgeSchema', () => {
  it('accepts partial edge updates', () => {
    expect(PatchEdgeSchema.safeParse({ sortOrder: 5 }).success).toBe(true);
    expect(PatchEdgeSchema.safeParse({ conditionValue: null }).success).toBe(true);
    expect(PatchEdgeSchema.safeParse({ conditionOperator: 'neq' }).success).toBe(true);
  });

  it('accepts empty object', () => {
    expect(PatchEdgeSchema.safeParse({}).success).toBe(true);
  });
});

describe('TriggeredConfigSchema', () => {
  it('accepts valid triggered config', () => {
    const result = TriggeredConfigSchema.safeParse({
      waitTimeoutSec: 300,
      onTimeout: 'fail',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ waitTimeoutSec: 300, onTimeout: 'fail' });
    }
  });

  it('accepts null', () => {
    expect(TriggeredConfigSchema.safeParse(null).data).toBeNull();
  });

  it('rejects zero waitTimeoutSec', () => {
    const result = TriggeredConfigSchema.safeParse({
      waitTimeoutSec: 0,
      onTimeout: 'skip',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatZodError(result.error)).toContain('triggeredConfig.waitTimeoutSec must be > 0');
    }
  });

  it('rejects out-of-range waitTimeoutSec', () => {
    const result = TriggeredConfigSchema.safeParse({
      waitTimeoutSec: 86_401,
      onTimeout: 'fail',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatZodError(result.error)).toBe('waitTimeoutSec must be between 1 and 86400');
    }
  });

  it('rejects invalid onTimeout', () => {
    const result = TriggeredConfigSchema.safeParse({
      waitTimeoutSec: 300,
      onTimeout: 'invalid',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatZodError(result.error)).toBe('triggeredConfig.onTimeout must be fail or skip');
    }
  });
});

describe('ReturnConditionsSchema', () => {
  it('accepts valid return conditions', () => {
    const result = ReturnConditionsSchema.safeParse([{ condition: 'test', value: 'success' }]);
    expect(result.success).toBe(true);
  });

  it('accepts null', () => {
    expect(ReturnConditionsSchema.safeParse(null).data).toBeNull();
  });

  it('rejects value with invalid characters', () => {
    // ReturnConditionSchema is internal, test through ReturnConditionsSchema
    const result = ReturnConditionsSchema.safeParse([{ condition: 'test', value: 'has spaces' }]);
    expect(result.success).toBe(false);
  });

  it('rejects too many conditions', () => {
    const conditions = Array.from({ length: 21 }, (_, i) => ({
      condition: `cond${i}`,
      value: `val${i}`,
    }));
    const result = ReturnConditionsSchema.safeParse(conditions);
    expect(result.success).toBe(false);
  });
});

describe('SummaryToolSchema', () => {
  it('accepts valid tool names', () => {
    expect(SummaryToolSchema.parse('claude')).toBe('claude');
  });

  it('normalizes empty string to null', () => {
    expect(SummaryToolSchema.parse('')).toBeNull();
  });

  it('accepts null', () => {
    expect(SummaryToolSchema.parse(null)).toBeNull();
  });
});

describe('InstructionFileSchema', () => {
  it('accepts valid instruction files', () => {
    expect(InstructionFileSchema.parse('some content')).toBe('some content');
  });

  it('accepts null', () => {
    expect(InstructionFileSchema.parse(null)).toBeNull();
  });

  it('rejects overly long content', () => {
    const result = InstructionFileSchema.safeParse('x'.repeat(50_001));
    expect(result.success).toBe(false);
  });
});

// ── formatZodError ────────────────────────────────────────────────────────────

describe('formatZodError', () => {
  it('formats single validation error', () => {
    const result = CreateEdgeSchema.safeParse({ fromNodeId: 'a', toNodeId: 'a' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatZodError(result.error)).toBe(
        'Self-loop: fromNodeId and toNodeId cannot be the same node',
      );
    }
  });

  it('formats multiple validation errors', () => {
    const result = CreateEdgeSchema.safeParse({ fromNodeId: '', toNodeId: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = formatZodError(result.error);
      expect(message).toContain('fromNodeId and toNodeId are required');
      expect(message).toContain('; ');
    }
  });
});
