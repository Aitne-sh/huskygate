/** Coverage tests for token-validator: uncovered lines 124-128 (timeout branch in validateAppTokenLive). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('token-validator coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('validateAppTokenLive', () => {
    it('returns format-passed on DOMException TimeoutError (lines 124-128)', async () => {
      const timeoutError = new DOMException(
        'The operation was aborted due to timeout',
        'TimeoutError',
      );
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError));

      const { validateAppTokenLive } = await import('./token-validator.js');
      const result = await validateAppTokenLive(
        'xapp-test-token-valid-length-is-at-least-40-chars',
      );
      expect(result.valid).toBe(true);
      expect(result.detail).toContain('timeout');
    });

    it('returns format-passed on network error (lines 129-132)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

      const { validateAppTokenLive } = await import('./token-validator.js');
      const result = await validateAppTokenLive(
        'xapp-test-token-valid-length-is-at-least-40-chars',
      );
      expect(result.valid).toBe(true);
      expect(result.detail).toContain('Network unavailable');
    });

    it('returns valid with detail on successful API call', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: async () => ({ ok: true }),
        }),
      );

      const { validateAppTokenLive } = await import('./token-validator.js');
      const result = await validateAppTokenLive(
        'xapp-test-token-valid-length-is-at-least-40-chars',
      );
      expect(result.valid).toBe(true);
      expect(result.detail).toContain('Socket Mode');
    });

    it('returns invalid when API rejects', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: async () => ({ ok: false, error: 'invalid_auth' }),
        }),
      );

      const { validateAppTokenLive } = await import('./token-validator.js');
      const result = await validateAppTokenLive(
        'xapp-test-token-valid-length-is-at-least-40-chars',
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid_auth');
    });
  });

  describe('validateBotTokenLive', () => {
    it('returns format-passed on DOMException TimeoutError', async () => {
      const timeoutError = new DOMException('timeout', 'TimeoutError');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError));

      const { validateBotTokenLive } = await import('./token-validator.js');
      const result = await validateBotTokenLive('xoxb-test-token-at-least-30-chars');
      expect(result.valid).toBe(true);
      expect(result.detail).toContain('timeout');
    });
  });
});
