import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteContext } from '../route-context.js';

const { jsonMock, readBodyMock } = vi.hoisted(() => ({
  jsonMock: vi.fn(),
  readBodyMock: vi.fn(),
}));

vi.mock('../../shared/http.js', () => ({
  json: jsonMock,
  readBody: readBodyMock,
}));

const { renderSetupPageMock } = vi.hoisted(() => ({
  renderSetupPageMock: vi.fn().mockReturnValue('<html>setup</html>'),
}));

vi.mock('../scripts/setup.js', () => ({
  renderSetupPage: renderSetupPageMock,
}));

const { generateManifestUrlMock } = vi.hoisted(() => ({
  generateManifestUrlMock: vi.fn().mockReturnValue('https://api.slack.com/apps?manifest=...'),
}));

vi.mock('../../setup/manifest.js', () => ({
  generateManifestUrl: generateManifestUrlMock,
}));

const {
  validateBotTokenFormatMock,
  validateAppTokenFormatMock,
  validateUserIdFormatMock,
  validateBotTokenLiveMock,
  validateAppTokenLiveMock,
} = vi.hoisted(() => ({
  validateBotTokenFormatMock: vi.fn().mockReturnValue({ valid: true }),
  validateAppTokenFormatMock: vi.fn().mockReturnValue({ valid: true }),
  validateUserIdFormatMock: vi.fn().mockReturnValue({ valid: true }),
  validateBotTokenLiveMock: vi.fn().mockResolvedValue({ valid: true, detail: 'workspace: test' }),
  validateAppTokenLiveMock: vi
    .fn()
    .mockResolvedValue({ valid: true, detail: 'Socket Mode verified' }),
}));

vi.mock('../../setup/token-validator.js', () => ({
  validateBotTokenFormat: validateBotTokenFormatMock,
  validateAppTokenFormat: validateAppTokenFormatMock,
  validateUserIdFormat: validateUserIdFormatMock,
  validateBotTokenLive: validateBotTokenLiveMock,
  validateAppTokenLive: validateAppTokenLiveMock,
}));

const { createDashboardResolverMock } = vi.hoisted(() => ({
  createDashboardResolverMock: vi.fn(),
}));

vi.mock('../settings-service.js', () => ({
  createDashboardResolver: createDashboardResolverMock,
}));

const { getKeychainProviderMock } = vi.hoisted(() => ({
  getKeychainProviderMock: vi.fn(),
}));

vi.mock('../../utils/keychain.js', () => ({
  getKeychainProvider: getKeychainProviderMock,
}));

vi.mock('../http.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../http.js')>();
  return {
    ...orig,
    json: jsonMock,
    readBody: readBodyMock,
    dashLog: vi.fn(),
    parseJson: orig.parseJson,
  };
});

import { handleSetupRoutes } from './setup.js';

function makeReq(method: string, headers?: Record<string, string>): IncomingMessage {
  return { method, headers: headers ?? {} } as IncomingMessage;
}

function makeRes(): ServerResponse {
  const res = {
    writeHead: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse;
  return res;
}

function makeCtx(overrides?: Record<string, unknown>): RouteContext {
  const configStore = {
    transaction: vi.fn((fn: () => void) => fn()),
    setKeychainRef: vi.fn(),
    setDbValue: vi.fn(),
    delete: vi.fn(),
  };

  const db = { config: configStore };

  return {
    dataDir: '/tmp/test-data',
    getDb: vi.fn(() => db),
    ...overrides,
  } as unknown as RouteContext;
}

/** Mock resolver returning unconfigured state (no SLACK_BOT_TOKEN). */
function mockUnconfigured(): void {
  createDashboardResolverMock.mockResolvedValue({
    resolver: {
      get: (key: string) => ({
        key,
        value: null,
        source: 'default',
        storage: 'none',
      }),
    },
    keychainAvailable: true,
  });
}

/** Mock resolver returning configured state (SLACK_BOT_TOKEN + SLACK_APP_TOKEN present). */
function mockConfigured(): void {
  const configuredKeys: Record<string, string> = {
    SLACK_BOT_TOKEN: 'xoxb-existing-token',
    SLACK_APP_TOKEN: 'xapp-existing-token',
  };
  createDashboardResolverMock.mockResolvedValue({
    resolver: {
      get: (key: string) => ({
        key,
        value: configuredKeys[key] ?? null,
        source: key in configuredKeys ? 'keychain' : 'default',
        storage: key in configuredKeys ? 'keychain_ref' : 'none',
      }),
    },
    keychainAvailable: true,
  });
}

describe('handleSetupRoutes', () => {
  beforeEach(() => {
    jsonMock.mockReset();
    readBodyMock.mockReset();
    validateBotTokenFormatMock.mockReturnValue({ valid: true });
    validateAppTokenFormatMock.mockReturnValue({ valid: true });
    validateUserIdFormatMock.mockReturnValue({ valid: true });
    validateBotTokenLiveMock.mockResolvedValue({ valid: true, detail: 'workspace: test' });
    validateAppTokenLiveMock.mockResolvedValue({ valid: true, detail: 'Socket Mode verified' });
    getKeychainProviderMock.mockReturnValue({
      isAvailable: vi.fn().mockResolvedValue(true),
      setPassword: vi.fn().mockResolvedValue(undefined),
      deletePassword: vi.fn().mockResolvedValue(true),
      platform: 'macOS',
    });
    mockUnconfigured();
  });

  describe('GET /setup', () => {
    it('serves the setup wizard page', async () => {
      const res = makeRes();
      const handled = await handleSetupRoutes(
        makeCtx(),
        makeReq('GET'),
        res,
        '/setup',
        new URLSearchParams(),
      );

      expect(handled).toBe(true);
      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          'Content-Type': 'text/html; charset=utf-8',
        }),
      );
      expect(res.end).toHaveBeenCalledWith('<html>setup</html>');
      expect(renderSetupPageMock).toHaveBeenCalledWith({
        manifestUrl: expect.any(String),
      });
    });
  });

  describe('GET /api/setup/status', () => {
    it('returns complete: false when SLACK_BOT_TOKEN is not set', async () => {
      mockUnconfigured();

      const handled = await handleSetupRoutes(
        makeCtx(),
        makeReq('GET'),
        makeRes(),
        '/api/setup/status',
        new URLSearchParams(),
      );

      expect(handled).toBe(true);
      expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, { complete: false });
    });

    it('returns complete: true when SLACK_BOT_TOKEN is set', async () => {
      mockConfigured();

      const handled = await handleSetupRoutes(
        makeCtx(),
        makeReq('GET'),
        makeRes(),
        '/api/setup/status',
        new URLSearchParams(),
      );

      expect(handled).toBe(true);
      expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, { complete: true });
    });
  });

  describe('POST /api/setup/complete', () => {
    it('returns ok: true with valid tokens and persists to keychain', async () => {
      readBodyMock.mockResolvedValue(
        JSON.stringify({
          botToken: 'xoxb-valid-token-1234567890123456',
          appToken: 'xapp-valid-token-12345678901234567890123456789012',
          allowedUserIds: 'U01ABCDEF',
        }),
      );

      const ctx = makeCtx();
      const handled = await handleSetupRoutes(
        ctx,
        makeReq('POST'),
        makeRes(),
        '/api/setup/complete',
        new URLSearchParams(),
      );

      expect(handled).toBe(true);
      expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
        ok: true,
        storage: {
          botToken: 'keychain',
          appToken: 'keychain',
          allowedUserIds: 'db',
        },
      });

      // Verify keychain writes
      const keychain = getKeychainProviderMock();
      expect(keychain.setPassword).toHaveBeenCalledWith(
        'SLACK_BOT_TOKEN',
        'xoxb-valid-token-1234567890123456',
      );
      expect(keychain.setPassword).toHaveBeenCalledWith(
        'SLACK_APP_TOKEN',
        'xapp-valid-token-12345678901234567890123456789012',
      );

      // Verify DB writes
      const db = (ctx.getDb as ReturnType<typeof vi.fn>)();
      expect(db.config.setKeychainRef).toHaveBeenCalledWith('SLACK_BOT_TOKEN');
      expect(db.config.setKeychainRef).toHaveBeenCalledWith('SLACK_APP_TOKEN');
      expect(db.config.setDbValue).toHaveBeenCalledWith('ALLOWED_USER_IDS', 'U01ABCDEF');
    });

    it('falls back to DB storage when keychain unavailable', async () => {
      getKeychainProviderMock.mockReturnValue({
        isAvailable: vi.fn().mockResolvedValue(false),
        setPassword: vi.fn(),
        deletePassword: vi.fn(),
        platform: 'linux',
      });

      readBodyMock.mockResolvedValue(
        JSON.stringify({
          botToken: 'xoxb-valid-token-1234567890123456',
          appToken: 'xapp-valid-token-12345678901234567890123456789012',
          allowedUserIds: '',
        }),
      );

      const handled = await handleSetupRoutes(
        makeCtx(),
        makeReq('POST'),
        makeRes(),
        '/api/setup/complete',
        new URLSearchParams(),
      );

      expect(handled).toBe(true);
      expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
        ok: true,
        storage: {
          botToken: 'db',
          appToken: 'db',
          allowedUserIds: 'db',
        },
      });
    });

    it('returns errors for invalid token format', async () => {
      validateBotTokenFormatMock.mockReturnValue({
        valid: false,
        error: 'Token must start with xoxb-',
      });

      readBodyMock.mockResolvedValue(
        JSON.stringify({
          botToken: 'invalid-token',
          appToken: 'xapp-valid-token-12345678901234567890123456789012',
          allowedUserIds: '',
        }),
      );

      const handled = await handleSetupRoutes(
        makeCtx(),
        makeReq('POST'),
        makeRes(),
        '/api/setup/complete',
        new URLSearchParams(),
      );

      expect(handled).toBe(true);
      expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 400, {
        ok: false,
        errors: [{ field: 'botToken', message: 'Token must start with xoxb-' }],
      });
    });

    it('returns errors for Slack API rejection', async () => {
      validateBotTokenLiveMock.mockResolvedValue({
        valid: false,
        error: 'Slack API rejected the token: invalid_auth',
      });

      readBodyMock.mockResolvedValue(
        JSON.stringify({
          botToken: 'xoxb-valid-token-1234567890123456',
          appToken: 'xapp-valid-token-12345678901234567890123456789012',
          allowedUserIds: '',
        }),
      );

      const handled = await handleSetupRoutes(
        makeCtx(),
        makeReq('POST'),
        makeRes(),
        '/api/setup/complete',
        new URLSearchParams(),
      );

      expect(handled).toBe(true);
      expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 400, {
        ok: false,
        errors: [{ field: 'botToken', message: 'Slack API rejected the token: invalid_auth' }],
      });
    });

    it('returns error for invalid JSON body', async () => {
      readBodyMock.mockResolvedValue('not json');

      const handled = await handleSetupRoutes(
        makeCtx(),
        makeReq('POST'),
        makeRes(),
        '/api/setup/complete',
        new URLSearchParams(),
      );

      expect(handled).toBe(true);
      expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 400, {
        ok: false,
        errors: [{ field: '_', message: 'Invalid JSON' }],
      });
    });

    it('returns error for missing tokens', async () => {
      readBodyMock.mockResolvedValue(JSON.stringify({}));

      const handled = await handleSetupRoutes(
        makeCtx(),
        makeReq('POST'),
        makeRes(),
        '/api/setup/complete',
        new URLSearchParams(),
      );

      expect(handled).toBe(true);
      expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 400, {
        ok: false,
        errors: expect.arrayContaining([
          { field: 'botToken', message: 'Bot Token is required' },
          { field: 'appToken', message: 'App Token is required' },
        ]),
      });
    });

    it('validates user ID format', async () => {
      validateUserIdFormatMock.mockReturnValue({
        valid: false,
        error: 'User ID must start with U followed by uppercase alphanumeric characters',
      });

      readBodyMock.mockResolvedValue(
        JSON.stringify({
          botToken: 'xoxb-valid-token-1234567890123456',
          appToken: 'xapp-valid-token-12345678901234567890123456789012',
          allowedUserIds: 'invalid-id',
        }),
      );

      const handled = await handleSetupRoutes(
        makeCtx(),
        makeReq('POST'),
        makeRes(),
        '/api/setup/complete',
        new URLSearchParams(),
      );

      expect(handled).toBe(true);
      expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 400, {
        ok: false,
        errors: [expect.objectContaining({ field: 'allowedUserIds' })],
      });
    });

    it('rolls back keychain on DB transaction failure', async () => {
      const keychainMock = {
        isAvailable: vi.fn().mockResolvedValue(true),
        setPassword: vi.fn().mockResolvedValue(undefined),
        deletePassword: vi.fn().mockResolvedValue(true),
        platform: 'macOS',
      };
      getKeychainProviderMock.mockReturnValue(keychainMock);

      const configStore = {
        transaction: vi.fn(() => {
          throw new Error('DB write failed');
        }),
        setKeychainRef: vi.fn(),
        setDbValue: vi.fn(),
        delete: vi.fn(),
      };
      const ctx = makeCtx({ getDb: vi.fn(() => ({ config: configStore })) });

      readBodyMock.mockResolvedValue(
        JSON.stringify({
          botToken: 'xoxb-valid-token-1234567890123456',
          appToken: 'xapp-valid-token-12345678901234567890123456789012',
          allowedUserIds: '',
        }),
      );

      const handled = await handleSetupRoutes(
        ctx,
        makeReq('POST'),
        makeRes(),
        '/api/setup/complete',
        new URLSearchParams(),
      );

      expect(handled).toBe(true);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.anything(),
        500,
        expect.objectContaining({
          ok: false,
        }),
      );

      // Verify rollback
      expect(keychainMock.deletePassword).toHaveBeenCalledWith('SLACK_BOT_TOKEN');
      expect(keychainMock.deletePassword).toHaveBeenCalledWith('SLACK_APP_TOKEN');
    });

    it('returns 409 when already configured and force is not set', async () => {
      mockConfigured();

      readBodyMock.mockResolvedValue(
        JSON.stringify({
          botToken: 'xoxb-valid-token-1234567890123456',
          appToken: 'xapp-valid-token-12345678901234567890123456789012',
          allowedUserIds: '',
        }),
      );

      const handled = await handleSetupRoutes(
        makeCtx(),
        makeReq('POST'),
        makeRes(),
        '/api/setup/complete',
        new URLSearchParams(),
      );

      expect(handled).toBe(true);
      expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 409, {
        ok: false,
        errors: [expect.objectContaining({ field: '_' })],
      });
    });

    it('allows overwrite when force: true is set', async () => {
      mockConfigured();

      readBodyMock.mockResolvedValue(
        JSON.stringify({
          botToken: 'xoxb-valid-token-1234567890123456',
          appToken: 'xapp-valid-token-12345678901234567890123456789012',
          allowedUserIds: 'U01ABCDEF',
          force: true,
        }),
      );

      const handled = await handleSetupRoutes(
        makeCtx(),
        makeReq('POST'),
        makeRes(),
        '/api/setup/complete',
        new URLSearchParams(),
      );

      expect(handled).toBe(true);
      expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
        ok: true,
        storage: expect.objectContaining({ botToken: 'keychain' }),
      });
    });

    it('clears ALLOWED_USER_IDS when empty on re-setup', async () => {
      readBodyMock.mockResolvedValue(
        JSON.stringify({
          botToken: 'xoxb-valid-token-1234567890123456',
          appToken: 'xapp-valid-token-12345678901234567890123456789012',
          allowedUserIds: '',
        }),
      );

      const ctx = makeCtx();
      await handleSetupRoutes(
        ctx,
        makeReq('POST'),
        makeRes(),
        '/api/setup/complete',
        new URLSearchParams(),
      );

      const db = (ctx.getDb as ReturnType<typeof vi.fn>)();
      expect(db.config.delete).toHaveBeenCalledWith('ALLOWED_USER_IDS');
      expect(db.config.setDbValue).not.toHaveBeenCalledWith('ALLOWED_USER_IDS', expect.anything());
    });
  });

  describe('unmatched routes', () => {
    it('returns false for unrelated paths', async () => {
      const handled = await handleSetupRoutes(
        makeCtx(),
        makeReq('GET'),
        makeRes(),
        '/api/settings',
        new URLSearchParams(),
      );

      expect(handled).toBe(false);
    });
  });
});
