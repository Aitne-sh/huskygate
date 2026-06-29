/** Coverage tests for store/mcp-server: uncovered lines 413-415 (exhaustive check for unsupported tool).
 * Lines 413-415 are an unreachable exhaustive never check in normalizeMcpServerDefinition.
 * We test all reachable branches to ensure the function works for all tool types. */
import { describe, expect, it } from 'vitest';
import { normalizeMcpServerDefinition } from './mcp-server.js';

describe('mcp-server coverage', () => {
  describe('normalizeMcpServerDefinition — all tool branches', () => {
    it('normalizes definition for claude tool', () => {
      const result = normalizeMcpServerDefinition('claude', {
        command: 'node',
        args: ['server.js'],
      });
      expect(result).toBeDefined();
      expect(result.transport).toBeDefined();
      expect(result.definition).toBeDefined();
    });

    it('normalizes definition for gemini tool', () => {
      const result = normalizeMcpServerDefinition('gemini', {
        command: 'node',
        args: ['server.js'],
      });
      expect(result).toBeDefined();
      expect(result.transport).toBeDefined();
    });

    it('normalizes definition for codex tool', () => {
      const result = normalizeMcpServerDefinition('codex', {
        command: 'node',
        args: ['server.js'],
      });
      expect(result).toBeDefined();
      expect(result.transport).toBeDefined();
    });

    it('throws for non-object definition', () => {
      expect(() => normalizeMcpServerDefinition('claude', 'not-an-object')).toThrow(
        'definition must be an object',
      );
    });
  });
});
