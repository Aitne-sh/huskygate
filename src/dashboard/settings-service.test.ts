import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConfigStore } from '../store/config-store.js';
import { ConfigStore as SqliteConfigStore } from '../store/config-store.js';
import { ensureSchema } from '../store/database.js';
import {
  type KeychainProvider,
  resetKeychainProvider,
  setKeychainProvider,
} from '../utils/keychain.js';
import { applySettingsPatches } from './settings-service.js';

function createConfigStore(): { db: Database.Database; configStore: ConfigStore } {
  const db = new Database(':memory:');
  ensureSchema(db);
  return {
    db,
    configStore: new SqliteConfigStore(db),
  };
}

function createKeychainProvider(
  values = new Map<string, string>(),
  overrides: Partial<KeychainProvider> = {},
): KeychainProvider {
  return {
    platform: 'test',
    isAvailable: async () => true,
    getPassword: async (key) => values.get(key) ?? null,
    setPassword: async (key, value) => {
      values.set(key, value);
    },
    deletePassword: async (key) => values.delete(key),
    listKeys: async () => [...values.keys()],
    ...overrides,
  };
}

afterEach(() => {
  resetKeychainProvider();
});

describe('applySettingsPatches', () => {
  it('does not leave partial DB or keychain updates behind when a later secure write fails', async () => {
    const { db, configStore } = createConfigStore();
    const keychainValues = new Map<string, string>([['OPENAI_API_KEY', 'original-openai']]);
    setKeychainProvider(
      createKeychainProvider(keychainValues, {
        setPassword: async (key, value) => {
          if (key === 'SLACK_BOT_TOKEN') {
            throw new Error('simulated keychain failure');
          }
          keychainValues.set(key, value);
        },
      }),
    );

    await expect(
      applySettingsPatches(configStore, [
        { key: 'MAX_CONCURRENCY', op: 'set', value: '4' },
        { key: 'OPENAI_API_KEY', op: 'set', value: 'new-openai' },
        { key: 'SLACK_BOT_TOKEN', op: 'set', value: 'new-slack' },
      ]),
    ).rejects.toThrow('simulated keychain failure');

    expect(configStore.get('MAX_CONCURRENCY')).toBeNull();
    expect(configStore.get('OPENAI_API_KEY')).toBeNull();
    expect(configStore.get('SLACK_BOT_TOKEN')).toBeNull();
    expect(keychainValues.get('OPENAI_API_KEY')).toBe('original-openai');
    expect(keychainValues.get('SLACK_BOT_TOKEN')).toBeUndefined();

    db.close();
  });

  it('only forwards truly hot-reloadable keys into runtimeValues', async () => {
    const { db, configStore } = createConfigStore();
    setKeychainProvider(createKeychainProvider());

    const result = await applySettingsPatches(configStore, [
      { key: 'LOG_LEVEL', op: 'set', value: 'debug' },
      { key: 'PERPLEXITY_API_KEY', op: 'set', value: 'pplx-test-key' },
      { key: 'HUSKYGATE_OAUTH_TRUSTED_HOSTS', op: 'set', value: 'accounts.google.com' },
      { key: 'SCHEDULE_ENABLED', op: 'set', value: 'false' },
    ]);

    expect(result.runtimeValues).toEqual({
      LOG_LEVEL: 'debug',
      PERPLEXITY_API_KEY: 'pplx-test-key',
      HUSKYGATE_OAUTH_TRUSTED_HOSTS: 'accounts.google.com',
    });
    expect(result.requiresRestart).toContain('SCHEDULE_ENABLED');
    expect(result.requiresRestart).not.toContain('HUSKYGATE_OAUTH_TRUSTED_HOSTS');

    db.close();
  });
});
