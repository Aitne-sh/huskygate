import { describe, expect, it } from 'vitest';
import { createDriver, getDriverEnv } from './driver-factory.js';

describe('driver-factory', () => {
  describe('createDriver', () => {
    it.each(['claude', 'codex', 'gemini'] as const)('returns a %s driver', (tool) => {
      const driver = createDriver(tool);
      expect(driver.name).toBe(tool);
      expect(typeof driver.buildCommand).toBe('function');
      expect(typeof driver.buildArgs).toBe('function');
      expect(typeof driver.buildEnv).toBe('function');
    });
  });

  describe('getDriverEnv', () => {
    it.each(['claude', 'codex', 'gemini'] as const)(
      'returns a non-empty env record for %s',
      (tool) => {
        const env = getDriverEnv(tool);
        expect(env).toBeTypeOf('object');
        expect(Object.keys(env).length).toBeGreaterThan(0);
      },
    );

    it('returns a fresh object each call (mutation-safe)', () => {
      const a = getDriverEnv('claude');
      const b = getDriverEnv('claude');
      expect(a).not.toBe(b);
      (a as Record<string, unknown>).__test = 'polluted';
      expect((b as Record<string, unknown>).__test).toBeUndefined();
    });
  });
});
