import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  validateAppTokenFormat,
  validateAppTokenLive,
  validateBotTokenFormat,
  validateBotTokenLive,
  validateUserIdFormat,
} from './token-validator.js';

describe('validateBotTokenFormat', () => {
  it('accepts a valid xoxb- token', () => {
    const result = validateBotTokenFormat('xoxb-1234567890-1234567890-AbCdEfGhIj');
    expect(result.valid).toBe(true);
  });

  it('rejects empty string', () => {
    const result = validateBotTokenFormat('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('rejects wrong prefix', () => {
    const result = validateBotTokenFormat('xoxp-1234567890-1234567890-AbCdEfGhIj');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('xoxb-');
  });

  it('rejects too-short token', () => {
    const result = validateBotTokenFormat('xoxb-123');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('short');
  });
});

describe('validateAppTokenFormat', () => {
  it('accepts a valid xapp- token', () => {
    const result = validateAppTokenFormat(
      'xapp-1-A1234567890-1234567890123-abcdef0123456789abcdef0123456789abcdef01',
    );
    expect(result.valid).toBe(true);
  });

  it('rejects empty string', () => {
    const result = validateAppTokenFormat('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('rejects wrong prefix', () => {
    const result = validateAppTokenFormat('xoxb-1234567890-1234567890-AbCdEfGhIj');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('xapp-');
  });

  it('rejects too-short token', () => {
    const result = validateAppTokenFormat('xapp-short');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('short');
  });
});

describe('validateUserIdFormat', () => {
  it('accepts valid user ID', () => {
    expect(validateUserIdFormat('U01ABCDEF').valid).toBe(true);
  });

  it('accepts long user ID', () => {
    expect(validateUserIdFormat('U01ABCDEFGH').valid).toBe(true);
  });

  it('rejects empty string', () => {
    const result = validateUserIdFormat('');
    expect(result.valid).toBe(false);
  });

  it('rejects lowercase letters', () => {
    const result = validateUserIdFormat('U01abcdef');
    expect(result.valid).toBe(false);
  });

  it('rejects wrong prefix', () => {
    const result = validateUserIdFormat('W01ABCDEF');
    expect(result.valid).toBe(false);
  });

  it('rejects too-short ID', () => {
    const result = validateUserIdFormat('U01ABC');
    expect(result.valid).toBe(false);
  });
});

describe('validateBotTokenLive', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns valid with workspace name on successful auth.test', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, team: 'My Workspace' })),
    );
    const result = await validateBotTokenLive('xoxb-test-token');
    expect(result.valid).toBe(true);
    expect(result.detail).toContain('My Workspace');
  });

  it('returns invalid with error on auth.test failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'invalid_auth' })),
    );
    const result = await validateBotTokenLive('xoxb-bad-token');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('invalid_auth');
  });

  it('returns valid with warning on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const result = await validateBotTokenLive('xoxb-test-token');
    expect(result.valid).toBe(true);
    expect(result.detail).toContain('Network unavailable');
  });

  it('returns valid with warning on timeout', async () => {
    const timeoutError = new DOMException('signal timed out', 'TimeoutError');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(timeoutError);
    const result = await validateBotTokenLive('xoxb-test-token');
    expect(result.valid).toBe(true);
    expect(result.detail).toContain('timeout');
  });
});

describe('validateAppTokenLive', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns valid on successful connections.open', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, url: 'wss://example.com' })),
    );
    const result = await validateAppTokenLive('xapp-test-token');
    expect(result.valid).toBe(true);
    expect(result.detail).toContain('Socket Mode');
  });

  it('returns invalid with scope error on missing_scope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'missing_scope' })),
    );
    const result = await validateAppTokenLive('xapp-test-token');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('missing_scope');
  });

  it('returns valid with warning on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const result = await validateAppTokenLive('xapp-test-token');
    expect(result.valid).toBe(true);
    expect(result.detail).toContain('Network unavailable');
  });
});
