import type { ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import {
  VALID_ERROR_POLICIES,
  VALID_OUTPUT_MODES,
  VALID_SCHEDULE_TYPES,
  normalizeSummaryEnabled,
  orchMaxRunWorkdirs,
  parseSummaryTool,
  sseRetry,
  sseWrite,
  startHeartbeat,
  validateEnabledMcpServerIds,
  validateNodeInstructionFile,
  validateNodeWorkdir,
  validateReturnConditions,
  validateTriggeredConfig,
} from './orchestrator-shared.js';

describe('orchestrator-shared', () => {
  describe('constants', () => {
    it('exports valid output modes', () => {
      expect(VALID_OUTPUT_MODES.has('auto')).toBe(true);
      expect(VALID_OUTPUT_MODES.has('manual')).toBe(true);
    });

    it('exports valid schedule types', () => {
      expect(VALID_SCHEDULE_TYPES.has('once')).toBe(true);
      expect(VALID_SCHEDULE_TYPES.has('recurring')).toBe(true);
    });

    it('exports valid error policies', () => {
      expect(VALID_ERROR_POLICIES.has('fail_fast')).toBe(true);
      expect(VALID_ERROR_POLICIES.has('continue')).toBe(true);
    });
  });

  describe('orchMaxRunWorkdirs', () => {
    it('returns default for undefined/null', () => {
      expect(orchMaxRunWorkdirs(undefined).error).toBeUndefined();
      expect(orchMaxRunWorkdirs(null).error).toBeUndefined();
    });

    it('returns the value for valid input', () => {
      expect(orchMaxRunWorkdirs(5)).toEqual({ value: 5 });
    });

    it('returns error for invalid input', () => {
      expect(orchMaxRunWorkdirs(-1).error).toBe('maxRunWorkdirs must be a non-negative integer');
      expect(orchMaxRunWorkdirs('abc').error).toBe('maxRunWorkdirs must be a non-negative integer');
      expect(orchMaxRunWorkdirs(1.5).error).toBe('maxRunWorkdirs must be a non-negative integer');
    });
  });

  describe('normalizeSummaryEnabled', () => {
    it('returns true for true or 1', () => {
      expect(normalizeSummaryEnabled(true)).toBe(true);
      expect(normalizeSummaryEnabled(1)).toBe(true);
    });

    it('returns false for other values', () => {
      expect(normalizeSummaryEnabled(false)).toBe(false);
      expect(normalizeSummaryEnabled(0)).toBe(false);
      expect(normalizeSummaryEnabled(null)).toBe(false);
      expect(normalizeSummaryEnabled('true')).toBe(false);
    });
  });

  describe('parseSummaryTool', () => {
    it('returns null for undefined', () => {
      expect(parseSummaryTool(undefined)).toEqual({ value: null });
    });

    it('accepts valid tool names', () => {
      expect(parseSummaryTool('claude')).toEqual({ value: 'claude' });
      expect(parseSummaryTool('codex')).toEqual({ value: 'codex' });
      expect(parseSummaryTool('gemini')).toEqual({ value: 'gemini' });
    });

    it('accepts null', () => {
      expect(parseSummaryTool(null)).toEqual({ value: null });
    });

    it('returns error for invalid tool', () => {
      const r = parseSummaryTool('invalid');
      expect(r.error).toContain('Invalid summaryTool');
    });
  });

  describe('validateNodeInstructionFile', () => {
    it('returns undefined for undefined input', () => {
      expect(validateNodeInstructionFile(undefined)).toEqual({ value: undefined });
    });

    it('returns null for null or empty string', () => {
      expect(validateNodeInstructionFile(null)).toEqual({ value: null });
      expect(validateNodeInstructionFile('')).toEqual({ value: null });
    });

    it('accepts valid instruction file string', () => {
      const result = validateNodeInstructionFile('some/path.md');
      expect(result.error).toBeUndefined();
    });

    it('returns error for too long string', () => {
      const result = validateNodeInstructionFile('x'.repeat(100000));
      expect(result.error).toBeDefined();
    });
  });

  describe('validateNodeWorkdir', () => {
    it('returns undefined for undefined', () => {
      const ctx = makeTestAppContext();
      expect(validateNodeWorkdir(ctx, undefined)).toEqual({ value: undefined });
    });

    it('returns null for null', () => {
      const ctx = makeTestAppContext();
      expect(validateNodeWorkdir(ctx, null)).toEqual({ value: null });
    });

    it('returns null for empty string', () => {
      const ctx = makeTestAppContext();
      expect(validateNodeWorkdir(ctx, '')).toEqual({ value: null });
      expect(validateNodeWorkdir(ctx, '   ')).toEqual({ value: null });
    });

    it('returns error for non-string value', () => {
      const ctx = makeTestAppContext();
      const result = validateNodeWorkdir(ctx, 123);
      expect(result.error).toBe('workdir must be a string or null');
    });

    it('delegates to workdirManager', () => {
      const ctx = makeTestAppContext();
      const result = validateNodeWorkdir(ctx, '/tmp/valid');
      expect(result.value).toBe('/tmp/valid');
    });

    it('returns error when workdirManager throws', () => {
      const ctx = makeTestAppContext();
      (ctx.workdirManager.validateCustomWorkdir as ReturnType<typeof vi.fn>).mockImplementation(
        () => {
          throw new Error('invalid path');
        },
      );
      const result = validateNodeWorkdir(ctx, '/bad/path');
      expect(result.error).toBe('invalid path');
    });
  });

  describe('validateEnabledMcpServerIds', () => {
    it('returns undefined for undefined', () => {
      const ctx = makeTestAppContext();
      expect(validateEnabledMcpServerIds(ctx, 'claude', undefined)).toEqual({ value: undefined });
    });

    it('returns null for null', () => {
      const ctx = makeTestAppContext();
      expect(validateEnabledMcpServerIds(ctx, 'claude', null)).toEqual({ value: null });
    });

    it('returns error for non-array', () => {
      const ctx = makeTestAppContext();
      const r = validateEnabledMcpServerIds(ctx, 'claude', 'not-array');
      expect(r.error).toContain('must be an array');
    });

    it('returns error when tool is null', () => {
      const ctx = makeTestAppContext();
      const r = validateEnabledMcpServerIds(ctx, null, ['server1']);
      expect(r.error).toContain('tool is required');
    });

    it('returns error for non-string entries', () => {
      const ctx = makeTestAppContext();
      (ctx.mcpServerStore.listByTool as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'server1' },
      ]);
      const r = validateEnabledMcpServerIds(ctx, 'claude', [123]);
      expect(r.error).toContain('non-empty strings');
    });

    it('returns error for unknown server ID', () => {
      const ctx = makeTestAppContext();
      (ctx.mcpServerStore.listByTool as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'known' },
      ]);
      const r = validateEnabledMcpServerIds(ctx, 'claude', ['unknown']);
      expect(r.error).toContain('Unknown MCP server ID');
    });

    it('returns deduplicated IDs', () => {
      const ctx = makeTestAppContext();
      (ctx.mcpServerStore.listByTool as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'server1' },
      ]);
      const r = validateEnabledMcpServerIds(ctx, 'claude', ['server1', 'server1']);
      expect(r.value).toEqual(['server1']);
    });

    it('returns null for empty deduped result', () => {
      const ctx = makeTestAppContext();
      (ctx.mcpServerStore.listByTool as ReturnType<typeof vi.fn>).mockReturnValue([
        { id: 'server1' },
      ]);
      const r = validateEnabledMcpServerIds(ctx, 'claude', []);
      expect(r.value).toBeNull();
    });
  });

  describe('validateTriggeredConfig', () => {
    it('returns undefined for undefined', () => {
      expect(validateTriggeredConfig(undefined)).toEqual({ value: undefined });
    });

    it('returns null for null', () => {
      expect(validateTriggeredConfig(null)).toEqual({ value: null });
    });

    it('returns error for invalid data', () => {
      const r = validateTriggeredConfig({ waitTimeoutSec: 'bad' });
      expect(r.error).toBeDefined();
    });

    it('accepts valid triggered config', () => {
      const r = validateTriggeredConfig({ waitTimeoutSec: 60, onTimeout: 'fail' });
      expect(r.error).toBeUndefined();
      expect(r.value).toBeDefined();
    });
  });

  describe('validateReturnConditions', () => {
    it('returns null for undefined/null', () => {
      expect(validateReturnConditions(undefined)).toEqual({ conditions: null });
      expect(validateReturnConditions(null)).toEqual({ conditions: null });
    });

    it('returns null for non-array', () => {
      expect(validateReturnConditions('not-array')).toEqual({ conditions: null });
    });

    it('accepts valid return conditions', () => {
      const r = validateReturnConditions([{ condition: 'done', value: 'ok' }]);
      expect(r.error).toBeUndefined();
    });

    it('returns error for invalid items', () => {
      const r = validateReturnConditions([{ text: 123 }]);
      expect(r.error).toBeDefined();
    });
  });

  describe('sseWrite', () => {
    it('writes SSE data to response', () => {
      const chunks: string[] = [];
      const res = {
        writableEnded: false,
        write: vi.fn((d: string) => {
          chunks.push(d);
          return true;
        }),
      };
      const result = sseWrite(res as unknown as ServerResponse, { type: 'test' });
      expect(result).toBe(true);
      expect(chunks[0]).toContain('data: ');
    });

    it('returns false when response is ended', () => {
      const res = { writableEnded: true, write: vi.fn() };
      const result = sseWrite(res as unknown as ServerResponse, { type: 'test' });
      expect(result).toBe(false);
      expect(res.write).not.toHaveBeenCalled();
    });

    it('handles write errors gracefully', () => {
      const res = {
        writableEnded: false,
        write: vi.fn(() => {
          throw new Error('closed');
        }),
      };
      const result = sseWrite(res as unknown as ServerResponse, { type: 'test' });
      expect(result).toBe(false);
    });

    it('writes string data directly', () => {
      const chunks: string[] = [];
      const res = {
        writableEnded: false,
        write: vi.fn((d: string) => {
          chunks.push(d);
          return true;
        }),
      };
      sseWrite(res as unknown as ServerResponse, 'raw-string');
      expect(chunks[0]).toContain('data: raw-string');
    });
  });

  describe('sseRetry', () => {
    it('writes retry header', () => {
      const res = { writableEnded: false, write: vi.fn() };
      sseRetry(res as unknown as ServerResponse, 3000);
      expect(res.write).toHaveBeenCalledWith('retry: 3000\n\n');
    });

    it('skips when ended', () => {
      const res = { writableEnded: true, write: vi.fn() };
      sseRetry(res as unknown as ServerResponse, 3000);
      expect(res.write).not.toHaveBeenCalled();
    });

    it('ignores write errors', () => {
      const res = {
        writableEnded: false,
        write: vi.fn(() => {
          throw new Error('closed');
        }),
      };
      expect(() => sseRetry(res as unknown as ServerResponse, 3000)).not.toThrow();
    });
  });

  describe('startHeartbeat', () => {
    it('returns an interval timer', () => {
      const res = { writableEnded: false, write: vi.fn() };
      const timer = startHeartbeat(res as unknown as ServerResponse);
      expect(timer).toBeDefined();
      clearInterval(timer);
    });
  });
});
