/** Coverage tests for setup-command: interactive flows, token collection, persistence, reset. */
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock: interactive prompter ──

function makeTestPrompter(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    prompt: vi.fn().mockResolvedValue(''),
    confirm: vi.fn().mockResolvedValue(false),
    waitForEnter: vi.fn().mockResolvedValue(undefined),
    printStep: vi.fn(),
    printSuccess: vi.fn(),
    printWarning: vi.fn(),
    printError: vi.fn(),
    printInfo: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

function createTestDb(tmpDir: string) {
  const dbPath = resolve(tmpDir, 'orchestrator.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE config (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      storage    TEXT NOT NULL CHECK (storage IN ('db', 'keychain_ref')),
      source     TEXT NOT NULL CHECK (source = 'user'),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (
        (storage = 'db' AND value IS NOT NULL) OR
        (storage = 'keychain_ref' AND value IS NULL)
      )
    );
    CREATE TABLE metadata (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare(
    "INSERT INTO config (key, value, storage, source) VALUES ('SLACK_BOT_TOKEN', 'xoxb-test', 'db', 'user')",
  ).run();
  db.prepare(
    "INSERT INTO config (key, value, storage, source) VALUES ('SLACK_APP_TOKEN', 'xapp-test', 'db', 'user')",
  ).run();
  db.prepare(
    "INSERT INTO config (key, value, storage, source) VALUES ('ALLOWED_USER_IDS', 'U12345', 'db', 'user')",
  ).run();
  db.close();
  return dbPath;
}

// Mock keychain + interactive + database + token validators

const mockKeychain = {
  platform: 'mock',
  isAvailable: vi.fn(async () => true),
  getPassword: vi.fn(async () => null),
  setPassword: vi.fn(async () => {}),
  deletePassword: vi.fn(async () => true),
  listKeys: vi.fn(async () => []),
};

vi.mock('../utils/keychain.js', () => ({
  getKeychainProvider: () => mockKeychain,
}));

vi.mock('./interactive.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./interactive.js')>();
  return {
    ...actual,
    createSetupPrompter: vi.fn(() => makeTestPrompter()),
  };
});

vi.mock('./token-validator.js', () => ({
  validateBotTokenFormat: vi.fn(() => ({ valid: true })),
  validateBotTokenLive: vi.fn(async () => ({ valid: true, detail: 'Bot OK' })),
  validateAppTokenFormat: vi.fn(() => ({ valid: true })),
  validateAppTokenLive: vi.fn(async () => ({ valid: true, detail: 'App OK' })),
  validateUserIdFormat: vi.fn(() => ({ valid: true })),
}));

vi.mock('../utils/platform.js', () => ({
  openBrowser: vi.fn(async () => {}),
  isWindows: false,
}));

describe('setup-command coverage', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = resolve(tmpdir(), `hg-setup-cov-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('runSetup --reset with complete state', () => {
    it('resets keychain + DB entries when user confirms', async () => {
      createTestDb(tmpDir);
      const prompter = makeTestPrompter({
        confirm: vi.fn().mockResolvedValue(true),
      });
      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(resolve(tmpDir, '..'));
      // point dataDir to tmpDir
      // We need to set cwd so that resolve(cwd, 'data') points to tmpDir parent
      // Actually, runSetup uses resolve(process.cwd(), 'data') for dataDir
      // We need to trick it: set cwd to the parent of tmpDir, and rename tmpDir to 'data'
      const parentDir = resolve(tmpDir, '..');
      const dataDir = resolve(parentDir, 'data');
      rmSync(tmpDir, { recursive: true, force: true });
      mkdirSync(dataDir, { recursive: true });
      createTestDb(dataDir);
      cwdSpy.mockReturnValue(parentDir);

      mockKeychain.isAvailable.mockResolvedValue(true);

      const { runSetup } = await import('./setup-command.js');
      await runSetup({ reset: true });

      expect(prompter.confirm).toHaveBeenCalled();
      expect(mockKeychain.deletePassword).toHaveBeenCalledWith('SLACK_BOT_TOKEN');
      expect(mockKeychain.deletePassword).toHaveBeenCalledWith('SLACK_APP_TOKEN');
      expect(prompter.printSuccess).toHaveBeenCalled();

      cwdSpy.mockRestore();
      rmSync(dataDir, { recursive: true, force: true });
    });

    it('does nothing when user declines reset', async () => {
      const dataDir = resolve(tmpDir, 'data');
      mkdirSync(dataDir, { recursive: true });
      createTestDb(dataDir);
      const prompter = makeTestPrompter({
        confirm: vi.fn().mockResolvedValue(false),
      });
      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await runSetup({ reset: true });

      expect(mockKeychain.deletePassword).not.toHaveBeenCalled();
      expect(prompter.printInfo).toHaveBeenCalled();

      cwdSpy.mockRestore();
    });

    it('handles reset when keychain errors occur (partial reset)', async () => {
      const dataDir = resolve(tmpDir, 'data');
      mkdirSync(dataDir, { recursive: true });
      createTestDb(dataDir);

      const prompter = makeTestPrompter({
        confirm: vi.fn().mockResolvedValue(true),
      });
      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      mockKeychain.isAvailable.mockResolvedValue(true);
      mockKeychain.deletePassword.mockRejectedValue(new Error('keychain error'));

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await runSetup({ reset: true });

      expect(prompter.printWarning).toHaveBeenCalled();

      cwdSpy.mockRestore();
    });

    it('handles SetupCancelledError during reset', async () => {
      const dataDir = resolve(tmpDir, 'data');
      mkdirSync(dataDir, { recursive: true });
      createTestDb(dataDir);

      const { SetupCancelledError } = await import('./interactive.js');
      const prompter = makeTestPrompter({
        confirm: vi.fn().mockRejectedValue(new SetupCancelledError()),
      });
      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await runSetup({ reset: true });

      // Should not throw, just print info
      expect(prompter.close).toHaveBeenCalled();

      cwdSpy.mockRestore();
    });
  });

  describe('runSetup interactive flow', () => {
    it('handles SetupCancelledError during interactive setup', async () => {
      const { SetupCancelledError } = await import('./interactive.js');
      const prompter = makeTestPrompter({
        waitForEnter: vi.fn().mockRejectedValue(new SetupCancelledError()),
      });
      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await runSetup(); // no options = full interactive

      expect(prompter.printInfo).toHaveBeenCalled();
      expect(prompter.close).toHaveBeenCalled();

      cwdSpy.mockRestore();
    });

    it('re-throws non-cancel errors during interactive setup', async () => {
      const prompter = makeTestPrompter({
        waitForEnter: vi.fn().mockRejectedValue(new Error('unexpected')),
      });
      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await expect(runSetup()).rejects.toThrow('unexpected');
      expect(prompter.close).toHaveBeenCalled();

      cwdSpy.mockRestore();
    });

    it('skips browser open when open=false', async () => {
      const { openBrowser } = await import('../utils/platform.js');
      const prompter = makeTestPrompter({
        waitForEnter: vi
          .fn()
          .mockRejectedValue(new (await import('./interactive.js')).SetupCancelledError()),
      });
      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await runSetup({ open: false });

      expect(openBrowser).not.toHaveBeenCalled();

      cwdSpy.mockRestore();
    });

    it('runs full interactive setup with keychain available', async () => {
      const dataDir = resolve(tmpDir, 'data');
      mkdirSync(dataDir, { recursive: true });

      const prompter = makeTestPrompter({
        prompt: vi
          .fn()
          .mockResolvedValueOnce('xoxb-bot-token-here') // bot token
          .mockResolvedValueOnce('xapp-app-token-here') // app token
          .mockResolvedValueOnce('U12345678'), // user IDs
        waitForEnter: vi.fn().mockResolvedValue(undefined),
        confirm: vi.fn().mockResolvedValue(false), // not already configured
      });
      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      mockKeychain.isAvailable.mockResolvedValue(true);
      mockKeychain.setPassword.mockResolvedValue(undefined);

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await runSetup({ open: false });

      expect(prompter.printStep).toHaveBeenCalled();
      expect(mockKeychain.setPassword).toHaveBeenCalledWith(
        'SLACK_BOT_TOKEN',
        'xoxb-bot-token-here',
      );
      expect(mockKeychain.setPassword).toHaveBeenCalledWith(
        'SLACK_APP_TOKEN',
        'xapp-app-token-here',
      );
      expect(prompter.printSuccess).toHaveBeenCalled();

      cwdSpy.mockRestore();
    });

    it('runs full interactive setup with keychain unavailable (DB fallback)', async () => {
      const dataDir = resolve(tmpDir, 'data');
      mkdirSync(dataDir, { recursive: true });

      const prompter = makeTestPrompter({
        prompt: vi
          .fn()
          .mockResolvedValueOnce('xoxb-bot-token')
          .mockResolvedValueOnce('xapp-app-token')
          .mockResolvedValueOnce('U12345678'),
        waitForEnter: vi.fn().mockResolvedValue(undefined),
        confirm: vi.fn().mockResolvedValue(false),
      });
      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      mockKeychain.isAvailable.mockResolvedValue(false);

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await runSetup({ open: false });

      expect(prompter.printWarning).toHaveBeenCalled(); // keychain unavailable warning
      expect(prompter.printSuccess).toHaveBeenCalled();

      cwdSpy.mockRestore();
    });

    it('handles already-configured: user declines overwrite', async () => {
      const dataDir = resolve(tmpDir, 'data');
      mkdirSync(dataDir, { recursive: true });
      createTestDb(dataDir);

      const prompter = makeTestPrompter({
        confirm: vi.fn().mockResolvedValue(false), // decline overwrite
        waitForEnter: vi.fn().mockResolvedValue(undefined),
      });
      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await runSetup({ open: false });

      // Should stop after the confirm
      expect(prompter.printInfo).toHaveBeenCalled();

      cwdSpy.mockRestore();
    });

    it('handles token format validation failure — user declines save-anyway throws', async () => {
      const { validateBotTokenFormat } = await import('./token-validator.js');
      (validateBotTokenFormat as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ valid: false, error: 'bad format' })
        .mockReturnValueOnce({ valid: false, error: 'bad format' })
        .mockReturnValueOnce({ valid: false, error: 'bad format' });

      // No DB = isSetupComplete is false = no "already configured" confirm
      // 3 format failures, then confirm("save without validation") = false => throw
      const prompter = makeTestPrompter({
        prompt: vi
          .fn()
          .mockResolvedValueOnce('bad') // attempt 1
          .mockResolvedValueOnce('bad') // attempt 2
          .mockResolvedValueOnce('bad'), // attempt 3
        waitForEnter: vi.fn().mockResolvedValue(undefined),
        confirm: vi.fn().mockResolvedValue(false), // decline save-anyway
      });

      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await expect(runSetup({ open: false })).rejects.toThrow('3 attempts');

      expect(prompter.printError).toHaveBeenCalled();

      cwdSpy.mockRestore();
    });

    it('handles token format validation failure — user accepts save-anyway', async () => {
      const {
        validateBotTokenFormat,
        validateAppTokenFormat,
        validateAppTokenLive,
        validateUserIdFormat,
      } = await import('./token-validator.js');
      (validateBotTokenFormat as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ valid: false, error: 'bad format' })
        .mockReturnValueOnce({ valid: false, error: 'bad format' })
        .mockReturnValueOnce({ valid: false, error: 'bad format' });
      (validateAppTokenFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });
      (validateAppTokenLive as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: true });
      (validateUserIdFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });

      const dataDir = resolve(tmpDir, 'data');
      mkdirSync(dataDir, { recursive: true });

      // 3 format failures, then confirm("save without validation") = true => saves anyway
      const prompter = makeTestPrompter({
        prompt: vi
          .fn()
          .mockResolvedValueOnce('bad') // bot attempt 1
          .mockResolvedValueOnce('bad') // bot attempt 2
          .mockResolvedValueOnce('bad') // bot attempt 3
          .mockResolvedValueOnce('xapp-ok') // app token
          .mockResolvedValueOnce('U12345678'), // user IDs
        waitForEnter: vi.fn().mockResolvedValue(undefined),
        confirm: vi.fn().mockResolvedValue(true), // accept save-anyway
      });

      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      mockKeychain.isAvailable.mockResolvedValue(false);

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await runSetup({ open: false });

      expect(prompter.printWarning).toHaveBeenCalled(); // tokenSavedWithoutFormat
      expect(prompter.printSuccess).toHaveBeenCalled();

      cwdSpy.mockRestore();
    });

    it('handles live validation failure with retry', async () => {
      const { validateBotTokenFormat, validateBotTokenLive } = await import('./token-validator.js');
      (validateBotTokenFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });
      (validateBotTokenLive as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ valid: false, error: 'auth failed' })
        .mockResolvedValueOnce({ valid: true, detail: 'Bot verified' });

      const { SetupCancelledError } = await import('./interactive.js');
      let callCount = 0;
      const prompter = makeTestPrompter({
        prompt: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount <= 2) return 'xoxb-token';
          throw new SetupCancelledError();
        }),
        waitForEnter: vi.fn().mockResolvedValue(undefined),
        confirm: vi.fn().mockResolvedValue(false),
      });

      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      const dataDir = resolve(tmpDir, 'data');
      mkdirSync(dataDir, { recursive: true });
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await runSetup({ open: false });

      expect(prompter.printError).toHaveBeenCalled();

      cwdSpy.mockRestore();
    });

    it('handles user ID validation failures', async () => {
      const { validateUserIdFormat } = await import('./token-validator.js');
      (validateUserIdFormat as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ valid: false, error: 'bad ID format' })
        .mockReturnValue({ valid: true });

      const {
        validateBotTokenFormat,
        validateBotTokenLive,
        validateAppTokenFormat,
        validateAppTokenLive,
      } = await import('./token-validator.js');
      (validateBotTokenFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });
      (validateBotTokenLive as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: true });
      (validateAppTokenFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });
      (validateAppTokenLive as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: true });

      const prompter = makeTestPrompter({
        prompt: vi
          .fn()
          .mockResolvedValueOnce('xoxb-bot') // bot token
          .mockResolvedValueOnce('xapp-app') // app token
          .mockResolvedValueOnce('BADID') // user IDs attempt 1 (invalid)
          .mockResolvedValueOnce('U12345678'), // user IDs attempt 2 (valid)
        waitForEnter: vi.fn().mockResolvedValue(undefined),
        confirm: vi.fn().mockResolvedValue(false),
      });

      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      mockKeychain.isAvailable.mockResolvedValue(false);

      const dataDir = resolve(tmpDir, 'data');
      mkdirSync(dataDir, { recursive: true });
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await runSetup({ open: false });

      expect(prompter.printError).toHaveBeenCalled();
      expect(prompter.printSuccess).toHaveBeenCalled();

      cwdSpy.mockRestore();
    });

    it('handles empty user IDs input', async () => {
      const {
        validateBotTokenFormat,
        validateBotTokenLive,
        validateAppTokenFormat,
        validateAppTokenLive,
      } = await import('./token-validator.js');
      (validateBotTokenFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });
      (validateBotTokenLive as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: true });
      (validateAppTokenFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });
      (validateAppTokenLive as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: true });
      const { validateUserIdFormat } = await import('./token-validator.js');
      (validateUserIdFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });

      const prompter = makeTestPrompter({
        prompt: vi
          .fn()
          .mockResolvedValueOnce('xoxb-bot')
          .mockResolvedValueOnce('xapp-app')
          .mockResolvedValueOnce('') // empty
          .mockResolvedValueOnce('  ,  ') // whitespace only
          .mockResolvedValueOnce('   '), // all whitespace
        waitForEnter: vi.fn().mockResolvedValue(undefined),
        confirm: vi.fn().mockResolvedValue(false),
      });

      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      mockKeychain.isAvailable.mockResolvedValue(false);

      const dataDir = resolve(tmpDir, 'data');
      mkdirSync(dataDir, { recursive: true });
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await expect(runSetup({ open: false })).rejects.toThrow();

      cwdSpy.mockRestore();
    });

    it('handles keychain write failure with rollback', async () => {
      const {
        validateBotTokenFormat,
        validateBotTokenLive,
        validateAppTokenFormat,
        validateAppTokenLive,
        validateUserIdFormat,
      } = await import('./token-validator.js');
      (validateBotTokenFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });
      (validateBotTokenLive as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: true });
      (validateAppTokenFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });
      (validateAppTokenLive as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: true });
      (validateUserIdFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });

      mockKeychain.isAvailable.mockResolvedValue(true);
      mockKeychain.setPassword.mockResolvedValueOnce(undefined); // bot token succeeds
      mockKeychain.setPassword.mockRejectedValueOnce(new Error('keychain write failed')); // app token fails

      const prompter = makeTestPrompter({
        prompt: vi
          .fn()
          .mockResolvedValueOnce('xoxb-bot')
          .mockResolvedValueOnce('xapp-app')
          .mockResolvedValueOnce('U12345678'),
        waitForEnter: vi.fn().mockResolvedValue(undefined),
        confirm: vi.fn().mockResolvedValue(false),
      });

      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      const dataDir = resolve(tmpDir, 'data');
      mkdirSync(dataDir, { recursive: true });
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await expect(runSetup({ open: false })).rejects.toThrow();

      // Rollback should have attempted to delete the successfully written key
      expect(mockKeychain.deletePassword).toHaveBeenCalledWith('SLACK_BOT_TOKEN');

      cwdSpy.mockRestore();
    });
  });

  describe('WELCOME_DM_SENT_KEY', () => {
    it('is exported', async () => {
      const { WELCOME_DM_SENT_KEY } = await import('./setup-command.js');
      expect(WELCOME_DM_SENT_KEY).toBe('WELCOME_DM_SENT');
    });
  });

  describe('browser open failure (line 184)', () => {
    it('silently catches browser open failure', async () => {
      const { openBrowser } = await import('../utils/platform.js');
      (openBrowser as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('no browser'),
      );

      const { SetupCancelledError } = await import('./interactive.js');
      const prompter = makeTestPrompter({
        waitForEnter: vi
          .fn()
          .mockRejectedValue(new SetupCancelledError()),
      });
      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      // open=true (default) triggers the browser open path
      await runSetup({ open: true });

      // Browser was called and threw, but setup continued to waitForEnter
      expect(openBrowser).toHaveBeenCalled();
      expect(prompter.waitForEnter).toHaveBeenCalled();

      cwdSpy.mockRestore();
    });
  });

  describe('live validation failure — save anyway on last attempt (lines 289-295)', () => {
    it('accepts token when user confirms save without live validation', async () => {
      const {
        validateBotTokenFormat,
        validateBotTokenLive,
        validateAppTokenFormat,
        validateAppTokenLive,
        validateUserIdFormat,
      } = await import('./token-validator.js');
      (validateBotTokenFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });
      // All 3 live validations fail
      (validateBotTokenLive as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ valid: false, error: 'auth failed' })
        .mockResolvedValueOnce({ valid: false, error: 'auth failed' })
        .mockResolvedValueOnce({ valid: false, error: 'auth failed' });
      (validateAppTokenFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });
      (validateAppTokenLive as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: true });
      (validateUserIdFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });

      const dataDir = resolve(tmpDir, 'data');
      mkdirSync(dataDir, { recursive: true });

      const prompter = makeTestPrompter({
        prompt: vi
          .fn()
          .mockResolvedValueOnce('xoxb-token1') // bot attempt 1
          .mockResolvedValueOnce('xoxb-token2') // bot attempt 2
          .mockResolvedValueOnce('xoxb-token3') // bot attempt 3
          .mockResolvedValueOnce('xapp-ok')     // app token
          .mockResolvedValueOnce('U12345678'),  // user IDs
        waitForEnter: vi.fn().mockResolvedValue(undefined),
        confirm: vi.fn().mockResolvedValue(true), // accept save-anyway
      });

      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      mockKeychain.isAvailable.mockResolvedValue(false);

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await runSetup({ open: false });

      // tokenSavedWithoutLive warning should have been printed
      expect(prompter.printWarning).toHaveBeenCalled();
      expect(prompter.printSuccess).toHaveBeenCalled();

      cwdSpy.mockRestore();
    });

    it('throws when user declines save without live validation (line 294)', async () => {
      const {
        validateBotTokenFormat,
        validateBotTokenLive,
      } = await import('./token-validator.js');
      (validateBotTokenFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });
      // All 3 live validations fail
      (validateBotTokenLive as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ valid: false, error: 'auth failed' })
        .mockResolvedValueOnce({ valid: false, error: 'auth failed' })
        .mockResolvedValueOnce({ valid: false, error: 'auth failed' });

      const prompter = makeTestPrompter({
        prompt: vi
          .fn()
          .mockResolvedValueOnce('xoxb-token1')
          .mockResolvedValueOnce('xoxb-token2')
          .mockResolvedValueOnce('xoxb-token3'),
        waitForEnter: vi.fn().mockResolvedValue(undefined),
        confirm: vi.fn().mockResolvedValue(false), // decline save-anyway
      });

      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await expect(runSetup({ open: false })).rejects.toThrow('3 attempts');

      cwdSpy.mockRestore();
    });
  });

  describe('user ID validation failure after max retries (lines 336-337)', () => {
    it('throws when all user ID attempts have invalid format', async () => {
      const {
        validateBotTokenFormat,
        validateBotTokenLive,
        validateAppTokenFormat,
        validateAppTokenLive,
        validateUserIdFormat,
      } = await import('./token-validator.js');
      (validateBotTokenFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });
      (validateBotTokenLive as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: true });
      (validateAppTokenFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });
      (validateAppTokenLive as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: true });
      // All 3 user ID format validations fail
      (validateUserIdFormat as ReturnType<typeof vi.fn>).mockReturnValue({
        valid: false,
        error: 'bad format',
      });

      const prompter = makeTestPrompter({
        prompt: vi
          .fn()
          .mockResolvedValueOnce('xoxb-bot')    // bot token
          .mockResolvedValueOnce('xapp-app')    // app token
          .mockResolvedValueOnce('BADID1')      // user IDs attempt 1
          .mockResolvedValueOnce('BADID2')      // user IDs attempt 2
          .mockResolvedValueOnce('BADID3'),     // user IDs attempt 3
        waitForEnter: vi.fn().mockResolvedValue(undefined),
        confirm: vi.fn().mockResolvedValue(false),
      });

      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      const dataDir = resolve(tmpDir, 'data');
      mkdirSync(dataDir, { recursive: true });
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await expect(runSetup({ open: false })).rejects.toThrow();

      cwdSpy.mockRestore();
    });
  });

  describe('DB init failure during persistence (lines 362-363)', () => {
    it('throws when initDatabase fails', async () => {
      const {
        validateBotTokenFormat,
        validateBotTokenLive,
        validateAppTokenFormat,
        validateAppTokenLive,
        validateUserIdFormat,
      } = await import('./token-validator.js');
      (validateBotTokenFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });
      (validateBotTokenLive as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: true });
      (validateAppTokenFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });
      (validateAppTokenLive as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: true });
      (validateUserIdFormat as ReturnType<typeof vi.fn>).mockReturnValue({ valid: true });

      const prompter = makeTestPrompter({
        prompt: vi
          .fn()
          .mockResolvedValueOnce('xoxb-bot')
          .mockResolvedValueOnce('xapp-app')
          .mockResolvedValueOnce('U12345678'),
        waitForEnter: vi.fn().mockResolvedValue(undefined),
        confirm: vi.fn().mockResolvedValue(false),
      });

      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      // Point dataDir to a path that will cause initDatabase to fail
      // Use /dev/null/impossible which can't be a directory
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/dev/null');

      const { runSetup } = await import('./setup-command.js');
      await expect(runSetup({ open: false })).rejects.toThrow();

      cwdSpy.mockRestore();
    });
  });

  describe('DB errors during reset (lines 496-497, 504-505)', () => {
    it('reports DB errors as partial reset', async () => {
      // Create a data dir with a valid but corrupted DB (missing tables)
      const dataDir = resolve(tmpDir, 'data');
      mkdirSync(dataDir, { recursive: true });
      // Create a valid DB with config table but no metadata table
      const Database = (await import('better-sqlite3')).default;
      const dbPath = resolve(dataDir, 'orchestrator.db');
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE config (
          key        TEXT PRIMARY KEY,
          value      TEXT,
          storage    TEXT NOT NULL CHECK (storage IN ('db', 'keychain_ref')),
          source     TEXT NOT NULL CHECK (source = 'user'),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          CHECK (
            (storage = 'db' AND value IS NOT NULL) OR
            (storage = 'keychain_ref' AND value IS NULL)
          )
        );
      `);
      db.prepare(
        "INSERT INTO config (key, value, storage, source) VALUES ('SLACK_BOT_TOKEN', 'xoxb-test', 'db', 'user')",
      ).run();
      // No metadata table - DELETE FROM metadata will fail
      db.close();

      const prompter = makeTestPrompter({
        confirm: vi.fn().mockResolvedValue(true),
      });
      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      mockKeychain.isAvailable.mockResolvedValue(true);
      mockKeychain.deletePassword.mockResolvedValue(true);

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await runSetup({ reset: true });

      // Should report DB error via printWarning (line 504)
      const warningCalls = (prompter.printWarning as ReturnType<typeof vi.fn>).mock.calls
        .map((c: unknown[]) => String(c[0]));
      expect(warningCalls.some((msg: string) => msg.length > 0)).toBe(true);

      cwdSpy.mockRestore();
    });
  });

  describe('non-cancel error re-thrown during reset (line 518)', () => {
    it('re-throws unexpected errors during reset', async () => {
      const dataDir = resolve(tmpDir, 'data');
      mkdirSync(dataDir, { recursive: true });
      createTestDb(dataDir);

      const prompter = makeTestPrompter({
        confirm: vi.fn().mockRejectedValue(new Error('unexpected reset error')),
      });
      const { createSetupPrompter } = await import('./interactive.js');
      (createSetupPrompter as ReturnType<typeof vi.fn>).mockReturnValue(prompter);

      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

      const { runSetup } = await import('./setup-command.js');
      await expect(runSetup({ reset: true })).rejects.toThrow('unexpected reset error');

      cwdSpy.mockRestore();
    });
  });
});
