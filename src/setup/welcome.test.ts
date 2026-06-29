import type { WebClient } from '@slack/web-api';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigStore } from '../store/config-store.js';

describe('sendWelcomeDmIfFirstRun', () => {
  let db: Database.Database;
  let configStore: ConfigStore;

  beforeEach(() => {
    vi.resetModules();
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
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    configStore = new ConfigStore(db);
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  function markSetupComplete(): void {
    configStore.setDbValue('SLACK_BOT_TOKEN', 'xoxb-test-token');
    configStore.setDbValue('SLACK_APP_TOKEN', 'xapp-test-token');
  }

  it('sends DMs to all allowed users on first run', async () => {
    markSetupComplete();
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    const mockClient = { chat: { postMessage } } as unknown;

    const { sendWelcomeDmIfFirstRun } = await import('./welcome.js');
    await sendWelcomeDmIfFirstRun(mockClient as WebClient, configStore, ['U01ABC', 'U02DEF']);

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ channel: 'U01ABC' }));
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ channel: 'U02DEF' }));

    // Metadata should be set
    expect(configStore.getMetadata('WELCOME_DM_SENT')).not.toBeNull();
  });

  it('does not send DMs when already sent', async () => {
    markSetupComplete();
    configStore.setMetadata('WELCOME_DM_SENT', '2026-03-14T00:00:00Z');

    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    const mockClient = { chat: { postMessage } } as unknown;

    const { sendWelcomeDmIfFirstRun } = await import('./welcome.js');
    await sendWelcomeDmIfFirstRun(mockClient as WebClient, configStore, ['U01ABC']);

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('does not fire when setup is not complete', async () => {
    // No SLACK_BOT_TOKEN in DB → setup not complete
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    const mockClient = { chat: { postMessage } } as unknown;

    const { sendWelcomeDmIfFirstRun } = await import('./welcome.js');
    await sendWelcomeDmIfFirstRun(mockClient as WebClient, configStore, ['U01ABC']);

    expect(postMessage).not.toHaveBeenCalled();
    // Crucially: metadata should NOT be set
    expect(configStore.getMetadata('WELCOME_DM_SENT')).toBeNull();
  });

  it('sets metadata even when no users are configured', async () => {
    markSetupComplete();
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    const mockClient = { chat: { postMessage } } as unknown;

    const { sendWelcomeDmIfFirstRun } = await import('./welcome.js');
    await sendWelcomeDmIfFirstRun(mockClient as WebClient, configStore, []);

    expect(postMessage).not.toHaveBeenCalled();
    expect(configStore.getMetadata('WELCOME_DM_SENT')).not.toBeNull();
  });

  it('marks as sent even when some DMs fail', async () => {
    markSetupComplete();
    const postMessage = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('user_not_found'));
    const mockClient = { chat: { postMessage } } as unknown;

    const { sendWelcomeDmIfFirstRun } = await import('./welcome.js');
    await sendWelcomeDmIfFirstRun(mockClient as WebClient, configStore, ['U01ABC', 'U02DEF']);

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(configStore.getMetadata('WELCOME_DM_SENT')).not.toBeNull();
  });

  it('sends message containing welcome text', async () => {
    markSetupComplete();
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    const mockClient = { chat: { postMessage } } as unknown;

    const { sendWelcomeDmIfFirstRun } = await import('./welcome.js');
    await sendWelcomeDmIfFirstRun(mockClient as WebClient, configStore, ['U01ABC']);

    const sentText = postMessage.mock.calls[0]?.[0].text;
    expect(sentText).toContain('Welcome to HuskyGate');
    expect(sentText).toContain('!help');
  });
});
