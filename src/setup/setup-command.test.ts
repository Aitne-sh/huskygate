import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigStore } from '../store/config-store.js';
import { generateManifestJson } from './manifest.js';

// We test individual pieces and subcommand modes rather than the full
// interactive flow (which requires a real TTY).

// ── Helper: mock keychain so tests don't touch the real OS keychain ──

function mockKeychainUnavailable(): void {
  vi.doMock('../utils/keychain.js', () => ({
    getKeychainProvider: () => ({
      platform: 'mock',
      isAvailable: async () => false,
      getPassword: async () => null,
      setPassword: async () => {},
      deletePassword: async () => false,
      listKeys: async () => [],
    }),
  }));
}

describe('isSetupComplete', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.resetModules();
    tmpDir = resolve(tmpdir(), `hg-test-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
    mockKeychainUnavailable();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.doUnmock('../utils/keychain.js');
    vi.restoreAllMocks();
  });

  it('returns false when DB does not exist', async () => {
    const { isSetupComplete } = await import('./setup-command.js');
    const result = await isSetupComplete(tmpDir);
    expect(result).toBe(false);
  });

  it('returns true when SLACK_BOT_TOKEN exists in DB', async () => {
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
    `);
    db.prepare(
      "INSERT INTO config (key, value, storage, source) VALUES ('SLACK_BOT_TOKEN', 'xoxb-test', 'db', 'user')",
    ).run();
    db.close();

    const { isSetupComplete } = await import('./setup-command.js');
    const result = await isSetupComplete(tmpDir);
    expect(result).toBe(true);
  });

  it('returns true when SLACK_BOT_TOKEN exists as keychain_ref', async () => {
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
    `);
    db.prepare(
      "INSERT INTO config (key, value, storage, source) VALUES ('SLACK_BOT_TOKEN', NULL, 'keychain_ref', 'user')",
    ).run();
    db.close();

    const { isSetupComplete } = await import('./setup-command.js');
    const result = await isSetupComplete(tmpDir);
    expect(result).toBe(true);
  });
});

describe('runSetup --manifest-only', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints valid JSON to stdout', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { runSetup } = await import('./setup-command.js');
    await runSetup({ manifestOnly: true });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = consoleSpy.mock.calls[0]?.[0] as string;
    expect(() => JSON.parse(output)).not.toThrow();

    const parsed = JSON.parse(output);
    const expected = JSON.parse(generateManifestJson());
    expect(parsed).toEqual(expected);
  });
});

describe('runSetup --status', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.resetModules();
    tmpDir = resolve(tmpdir(), `hg-test-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
    mockKeychainUnavailable();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.doUnmock('../utils/keychain.js');
    vi.restoreAllMocks();
  });

  it('reports not complete when no config exists', async () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runSetup } = await import('./setup-command.js');
    await runSetup({ status: true });

    expect(consoleSpy).toHaveBeenCalledWith('Setup not complete.');
    expect(process.exitCode).toBe(1);

    cwdSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('reports complete when SLACK_BOT_TOKEN exists in DB', async () => {
    // Create DB with a token entry
    const dbPath = resolve(tmpDir, 'data', 'orchestrator.db');
    mkdirSync(resolve(tmpDir, 'data'), { recursive: true });
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
    db.close();

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { runSetup } = await import('./setup-command.js');
    await runSetup({ status: true });

    expect(consoleSpy).toHaveBeenCalledWith('Setup complete.');
    expect(process.exitCode).toBe(0);

    cwdSpy.mockRestore();
    process.exitCode = undefined;
  });
});

describe('runSetup --reset', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.resetModules();
    tmpDir = resolve(tmpdir(), `hg-test-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
    mockKeychainUnavailable();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.doUnmock('../utils/keychain.js');
    vi.restoreAllMocks();
  });

  it('reports nothing to reset when no setup state exists', async () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

    // Mock stdin as a TTY so the prompter doesn't throw
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    const { runSetup } = await import('./setup-command.js');
    await runSetup({ reset: true });

    // Should not throw; the function prints "No setup state found."
    cwdSpy.mockRestore();
    Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
  });
});

describe('ConfigStore integration for setup persistence', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
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
  });

  afterEach(() => {
    db.close();
  });

  it('saves keychain ref + allowed user IDs atomically via transaction', () => {
    const store = new ConfigStore(db);

    store.transaction(() => {
      store.setKeychainRef('SLACK_BOT_TOKEN');
      store.setKeychainRef('SLACK_APP_TOKEN');
      store.setDbValue('ALLOWED_USER_IDS', 'U01ABCDEF,U02GHIJKL');
    });

    const botToken = store.get('SLACK_BOT_TOKEN');
    expect(botToken).not.toBeNull();
    expect(botToken?.storage).toBe('keychain_ref');
    expect(botToken?.value).toBeNull();

    const appToken = store.get('SLACK_APP_TOKEN');
    expect(appToken).not.toBeNull();
    expect(appToken?.storage).toBe('keychain_ref');

    const userIds = store.get('ALLOWED_USER_IDS');
    expect(userIds).not.toBeNull();
    expect(userIds?.value).toBe('U01ABCDEF,U02GHIJKL');
    expect(userIds?.storage).toBe('db');
  });

  it('saves tokens as db values when keychain is unavailable', () => {
    const store = new ConfigStore(db);

    store.transaction(() => {
      store.setDbValue('SLACK_BOT_TOKEN', 'xoxb-test-token');
      store.setDbValue('SLACK_APP_TOKEN', 'xapp-test-token');
      store.setDbValue('ALLOWED_USER_IDS', 'U01ABCDEF');
    });

    const botToken = store.get('SLACK_BOT_TOKEN');
    expect(botToken?.value).toBe('xoxb-test-token');
    expect(botToken?.storage).toBe('db');
  });

  it('overwrites existing values on re-run', () => {
    const store = new ConfigStore(db);

    store.setDbValue('SLACK_BOT_TOKEN', 'old-token');
    store.setDbValue('SLACK_BOT_TOKEN', 'new-token');

    const record = store.get('SLACK_BOT_TOKEN');
    expect(record?.value).toBe('new-token');
  });
});
