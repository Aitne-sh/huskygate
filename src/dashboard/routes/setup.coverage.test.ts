/**
 * Additional coverage for dashboard/routes/setup.ts
 * Targets: appToken format validation, DB fallback with empty userIds, rollback with partial keychain writes
 */
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

vi.mock('../scripts/setup.js', () => ({
  renderSetupPage: vi.fn().mockReturnValue('<html>setup</html>'),
}));

vi.mock('../../setup/manifest.js', () => ({
  generateManifestUrl: vi.fn().mockReturnValue('https://api.slack.com/apps?manifest=test'),
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
  validateBotTokenLiveMock: vi.fn().mockResolvedValue({ valid: true }),
  validateAppTokenLiveMock: vi.fn().mockResolvedValue({ valid: true }),
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

function makeReq(method: string): IncomingMessage {
  return { method, headers: {} } as IncomingMessage;
}

function makeRes(): ServerResponse {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse;
}

function makeCtx(): RouteContext {
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
  } as unknown as RouteContext;
}

function mockUnconfigured(): void {
  createDashboardResolverMock.mockResolvedValue({
    resolver: {
      get: (_key: string) => ({ value: null, source: 'default', storage: 'none' }),
    },
    keychainAvailable: true,
  });
}

beforeEach(() => {
  jsonMock.mockReset();
  readBodyMock.mockReset();
  validateBotTokenFormatMock.mockReturnValue({ valid: true });
  validateAppTokenFormatMock.mockReturnValue({ valid: true });
  validateUserIdFormatMock.mockReturnValue({ valid: true });
  validateBotTokenLiveMock.mockResolvedValue({ valid: true });
  validateAppTokenLiveMock.mockResolvedValue({ valid: true });
  getKeychainProviderMock.mockReturnValue({
    isAvailable: vi.fn().mockResolvedValue(true),
    setPassword: vi.fn().mockResolvedValue(undefined),
    deletePassword: vi.fn().mockResolvedValue(true),
    platform: 'macOS',
  });
  mockUnconfigured();
});

describe('handleSetupRoutes — additional coverage', () => {
  it('returns errors for invalid appToken format', async () => {
    validateAppTokenFormatMock.mockReturnValue({
      valid: false,
      error: 'Token must start with xapp-',
    });

    readBodyMock.mockResolvedValue(
      JSON.stringify({
        botToken: 'xoxb-valid-token',
        appToken: 'invalid-app-token',
      }),
    );

    await handleSetupRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/setup/complete',
      new URLSearchParams(),
    );
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 400, {
      ok: false,
      errors: expect.arrayContaining([
        { field: 'appToken', message: 'Token must start with xapp-' },
      ]),
    });
  });

  it('returns errors for appToken live validation failure', async () => {
    validateAppTokenLiveMock.mockResolvedValue({
      valid: false,
      error: 'Socket Mode connection failed',
    });

    readBodyMock.mockResolvedValue(
      JSON.stringify({
        botToken: 'xoxb-valid-token',
        appToken: 'xapp-valid-token',
      }),
    );

    await handleSetupRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/setup/complete',
      new URLSearchParams(),
    );
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 400, {
      ok: false,
      errors: expect.arrayContaining([
        { field: 'appToken', message: 'Socket Mode connection failed' },
      ]),
    });
  });

  it('handles DB fallback persistence with empty user IDs (deletes ALLOWED_USER_IDS)', async () => {
    getKeychainProviderMock.mockReturnValue({
      isAvailable: vi.fn().mockResolvedValue(false),
      setPassword: vi.fn(),
      deletePassword: vi.fn(),
      platform: 'linux',
    });

    readBodyMock.mockResolvedValue(
      JSON.stringify({
        botToken: 'xoxb-valid',
        appToken: 'xapp-valid',
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
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      ok: true,
      storage: { botToken: 'db', appToken: 'db', allowedUserIds: 'db' },
    });
  });

  it('rolls back only saved keychain keys on failure (partial write)', async () => {
    const keychainMock = {
      isAvailable: vi.fn().mockResolvedValue(true),
      setPassword: vi
        .fn()
        .mockResolvedValueOnce(undefined) // SLACK_BOT_TOKEN succeeds
        .mockRejectedValueOnce(new Error('keychain write failed')), // SLACK_APP_TOKEN fails
      deletePassword: vi.fn().mockResolvedValue(true),
      platform: 'macOS',
    };
    getKeychainProviderMock.mockReturnValue(keychainMock);

    readBodyMock.mockResolvedValue(
      JSON.stringify({
        botToken: 'xoxb-valid',
        appToken: 'xapp-valid',
      }),
    );

    await handleSetupRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/setup/complete',
      new URLSearchParams(),
    );
    expect(jsonMock).toHaveBeenCalledWith(
      expect.anything(),
      500,
      expect.objectContaining({ ok: false }),
    );
    // Only SLACK_BOT_TOKEN should be rolled back (it was saved before the failure)
    expect(keychainMock.deletePassword).toHaveBeenCalledWith('SLACK_BOT_TOKEN');
    expect(keychainMock.deletePassword).not.toHaveBeenCalledWith('SLACK_APP_TOKEN');
  });

  it('handles rollback error gracefully (best-effort cleanup)', async () => {
    const keychainMock = {
      isAvailable: vi.fn().mockResolvedValue(true),
      setPassword: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined),
      deletePassword: vi.fn().mockRejectedValue(new Error('rollback failed')),
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
    const ctx = {
      dataDir: '/tmp/test',
      getDb: vi.fn(() => ({ config: configStore })),
    } as unknown as RouteContext;

    readBodyMock.mockResolvedValue(
      JSON.stringify({
        botToken: 'xoxb-valid',
        appToken: 'xapp-valid',
      }),
    );

    await handleSetupRoutes(
      ctx,
      makeReq('POST'),
      makeRes(),
      '/api/setup/complete',
      new URLSearchParams(),
    );
    // Should not throw despite rollback errors
    expect(jsonMock).toHaveBeenCalledWith(
      expect.anything(),
      500,
      expect.objectContaining({ ok: false }),
    );
  });

  it('persists multiple user IDs to DB', async () => {
    readBodyMock.mockResolvedValue(
      JSON.stringify({
        botToken: 'xoxb-valid',
        appToken: 'xapp-valid',
        allowedUserIds: 'U01ABCDEF, U02GHIJKL',
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
    expect(db.config.setDbValue).toHaveBeenCalledWith('ALLOWED_USER_IDS', 'U01ABCDEF,U02GHIJKL');
  });

  it('DB fallback stores ALLOWED_USER_IDS when non-empty (line 234)', async () => {
    getKeychainProviderMock.mockReturnValue({
      isAvailable: vi.fn().mockResolvedValue(false),
      setPassword: vi.fn(),
      deletePassword: vi.fn(),
      platform: 'linux',
    });

    readBodyMock.mockResolvedValue(
      JSON.stringify({
        botToken: 'xoxb-valid',
        appToken: 'xapp-valid',
        allowedUserIds: 'U01ABCDEF',
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
    expect(db.config.setDbValue).toHaveBeenCalledWith('ALLOWED_USER_IDS', 'U01ABCDEF');
    expect(db.config.delete).not.toHaveBeenCalledWith('ALLOWED_USER_IDS');
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      ok: true,
      storage: { botToken: 'db', appToken: 'db', allowedUserIds: 'db' },
    });
  });
});
