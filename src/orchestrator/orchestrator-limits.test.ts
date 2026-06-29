/**
 * Tests for orchestrator-limits — validation constraints for orchestrator and node limits.
 */
import { describe, expect, it } from 'vitest';
import {
  ORCHESTRATOR_DEFAULTS,
  assertValidOrchestratorLimits,
  assertValidOrchestratorNodeLimits,
  validateOrchestratorLimits,
  validateOrchestratorNodeLimits,
} from './orchestrator-limits.js';

describe('ORCHESTRATOR_DEFAULTS', () => {
  it('exports expected default values', () => {
    expect(ORCHESTRATOR_DEFAULTS.maxParallelism).toBe(3);
    expect(ORCHESTRATOR_DEFAULTS.maxTotalNodes).toBe(50);
    expect(ORCHESTRATOR_DEFAULTS.maxRunWorkdirs).toBe(20);
    expect(ORCHESTRATOR_DEFAULTS.errorPolicy).toBe('continue');
  });
});

describe('validateOrchestratorLimits', () => {
  it('returns null for valid values', () => {
    expect(validateOrchestratorLimits({ maxParallelism: 5, maxTotalNodes: 10 })).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(validateOrchestratorLimits({})).toBeNull();
  });

  it('returns null for undefined values', () => {
    expect(validateOrchestratorLimits({ maxParallelism: undefined })).toBeNull();
  });

  it('allows null for nullable timeoutSec', () => {
    expect(validateOrchestratorLimits({ timeoutSec: null })).toBeNull();
  });

  it('returns error for non-integer maxParallelism', () => {
    const result = validateOrchestratorLimits({ maxParallelism: 1.5 });
    expect(result).toContain('maxParallelism');
    expect(result).toContain('integer');
  });

  it('returns error for string maxParallelism', () => {
    const result = validateOrchestratorLimits({ maxParallelism: 'abc' as unknown });
    expect(result).toContain('maxParallelism');
  });

  it('returns error for maxParallelism below min', () => {
    const result = validateOrchestratorLimits({ maxParallelism: 0 });
    expect(result).toContain('maxParallelism');
    expect(result).toContain('between');
  });

  it('returns error for maxParallelism above max', () => {
    const result = validateOrchestratorLimits({ maxParallelism: 100 });
    expect(result).toContain('maxParallelism');
  });

  it('returns error for maxTotalNodes below min', () => {
    const result = validateOrchestratorLimits({ maxTotalNodes: 0 });
    expect(result).toContain('maxTotalNodes');
  });

  it('returns error for maxTotalNodes above max', () => {
    const result = validateOrchestratorLimits({ maxTotalNodes: 999 });
    expect(result).toContain('maxTotalNodes');
  });

  it('returns error for timeoutSec below min', () => {
    const result = validateOrchestratorLimits({ timeoutSec: 0 });
    expect(result).toContain('timeoutSec');
  });

  it('returns error for timeoutSec above max', () => {
    const result = validateOrchestratorLimits({ timeoutSec: 100_000 });
    expect(result).toContain('timeoutSec');
  });

  it('accepts valid timeoutSec', () => {
    expect(validateOrchestratorLimits({ timeoutSec: 3600 })).toBeNull();
  });
});

describe('assertValidOrchestratorLimits', () => {
  it('does not throw for valid values', () => {
    expect(() => assertValidOrchestratorLimits({ maxParallelism: 5 })).not.toThrow();
  });

  it('throws for invalid values', () => {
    expect(() => assertValidOrchestratorLimits({ maxParallelism: 0 })).toThrow();
  });
});

describe('validateOrchestratorNodeLimits', () => {
  it('returns null for valid values', () => {
    expect(validateOrchestratorNodeLimits({ maxRetries: 3, timeoutSec: 600 })).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(validateOrchestratorNodeLimits({})).toBeNull();
  });

  it('allows null for nullable timeoutSec', () => {
    expect(validateOrchestratorNodeLimits({ timeoutSec: null })).toBeNull();
  });

  it('allows null for nullable waitTimeoutSec', () => {
    expect(validateOrchestratorNodeLimits({ waitTimeoutSec: null })).toBeNull();
  });

  it('returns error for maxRetries below min', () => {
    const result = validateOrchestratorNodeLimits({ maxRetries: -1 });
    expect(result).toContain('maxRetries');
  });

  it('returns error for maxRetries above max', () => {
    const result = validateOrchestratorNodeLimits({ maxRetries: 99 });
    expect(result).toContain('maxRetries');
  });

  it('returns error for non-integer maxRetries', () => {
    const result = validateOrchestratorNodeLimits({ maxRetries: 1.5 });
    expect(result).toContain('maxRetries');
  });

  it('returns error for timeoutSec below min', () => {
    const result = validateOrchestratorNodeLimits({ timeoutSec: 0 });
    expect(result).toContain('timeoutSec');
  });

  it('returns error for timeoutSec above max', () => {
    const result = validateOrchestratorNodeLimits({ timeoutSec: 100_000 });
    expect(result).toContain('timeoutSec');
  });

  it('returns error for waitTimeoutSec below min', () => {
    const result = validateOrchestratorNodeLimits({ waitTimeoutSec: 0 });
    expect(result).toContain('waitTimeoutSec');
  });

  it('returns error for waitTimeoutSec above max', () => {
    const result = validateOrchestratorNodeLimits({ waitTimeoutSec: 100_000 });
    expect(result).toContain('waitTimeoutSec');
  });
});

describe('assertValidOrchestratorNodeLimits', () => {
  it('does not throw for valid values', () => {
    expect(() => assertValidOrchestratorNodeLimits({ maxRetries: 3 })).not.toThrow();
  });

  it('throws for invalid values', () => {
    expect(() => assertValidOrchestratorNodeLimits({ maxRetries: -1 })).toThrow();
  });
});
