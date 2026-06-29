/**
 * Additional coverage tests for settings-service.
 */
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigStore as SqliteConfigStore } from '../store/config-store.js';
import { ensureSchema } from '../store/database.js';
import {
  type KeychainProvider,
  resetKeychainProvider,
  setKeychainProvider,
} from '../utils/keychain.js';
import {
  applySettingsPatches,
  createDashboardResolver,
  isSettingPatch,
} from './settings-service.js';

function createConfigStore() {
  const db = new Database(':memory:');
  ensureSchema(db);
  return { db, configStore: new SqliteConfigStore(db) };
}

function createKeychain(
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

describe('isSettingPatch', () => {
  it('returns false for null/undefined', () => {
    expect(isSettingPatch(null)).toBe(false);
    expect(isSettingPatch(undefined)).toBe(false);
    expect(isSettingPatch(42)).toBe(false);
  });

  it('returns false for missing key/op', () => {
    expect(isSettingPatch({})).toBe(false);
    expect(isSettingPatch({ key: 'x' })).toBe(false);
    expect(isSettingPatch({ op: 'set' })).toBe(false);
  });

  it('validates set patch requires value', () => {
    expect(isSettingPatch({ key: 'x', op: 'set', value: 'v' })).toBe(true);
    expect(isSettingPatch({ key: 'x', op: 'set' })).toBe(false);
    expect(isSettingPatch({ key: 'x', op: 'set', value: 42 })).toBe(false);
  });

  it('validates clear and noop', () => {
    expect(isSettingPatch({ key: 'x', op: 'clear' })).toBe(true);
    expect(isSettingPatch({ key: 'x', op: 'noop' })).toBe(true);
    expect(isSettingPatch({ key: 'x', op: 'unknown' })).toBe(false);
  });
});

describe('createDashboardResolver', () => {
  it('works with keychain unavailable', async () => {
    setKeychainProvider(createKeychain(new Map(), { isAvailable: async () => false }));
    const { db, configStore } = createConfigStore();
    const result = await createDashboardResolver(configStore, '/tmp/data');
    expect(result.keychainAvailable).toBe(false);
    expect(result.resolver).toBeDefined();
    db.close();
  });

  it('handles keychain getPassword errors gracefully', async () => {
    setKeychainProvider(
      createKeychain(new Map(), {
        getPassword: async () => {
          throw new Error('keychain error');
        },
      }),
    );
    const { db, configStore } = createConfigStore();
    const result = await createDashboardResolver(configStore, '/tmp/data');
    expect(result.keychainAvailable).toBe(true);
    db.close();
  });

  it('loads secure values from keychain', async () => {
    const values = new Map([['OPENAI_API_KEY', 'sk-test']]);
    setKeychainProvider(createKeychain(values));
    const { db, configStore } = createConfigStore();
    const result = await createDashboardResolver(configStore, '/tmp/data', ['OPENAI_API_KEY']);
    expect(result.keychainAvailable).toBe(true);
    db.close();
  });
});

describe('applySettingsPatches — edge cases', () => {
  it('noop patches are skipped', async () => {
    setKeychainProvider(createKeychain());
    const { db, configStore } = createConfigStore();
    const result = await applySettingsPatches(configStore, [{ key: 'LOG_LEVEL', op: 'noop' }]);
    expect(result.changedKeys).toEqual([]);
    db.close();
  });

  it('empty value treated as clear', async () => {
    setKeychainProvider(createKeychain());
    const { db, configStore } = createConfigStore();
    const result = await applySettingsPatches(configStore, [
      { key: 'LOG_LEVEL', op: 'set', value: '' },
    ]);
    expect(result.changedKeys).toContain('LOG_LEVEL');
    db.close();
  });

  it('rejects non-editable key', async () => {
    setKeychainProvider(createKeychain());
    const { db, configStore } = createConfigStore();
    await expect(
      applySettingsPatches(configStore, [{ key: 'NOT_AN_EDITABLE_KEY', op: 'set', value: 'x' }]),
    ).rejects.toThrow('not editable');
    db.close();
  });

  it('rejects SENSITIVE_VALUE_MASK as value', async () => {
    setKeychainProvider(createKeychain());
    const { db, configStore } = createConfigStore();
    await expect(
      applySettingsPatches(configStore, [{ key: 'OPENAI_API_KEY', op: 'set', value: '***' }]),
    ).rejects.toThrow('Masked placeholder');
    db.close();
  });

  it('throws when secure store unavailable for secure keys', async () => {
    setKeychainProvider(createKeychain(new Map(), { isAvailable: async () => false }));
    const { db, configStore } = createConfigStore();
    await expect(
      applySettingsPatches(configStore, [{ key: 'OPENAI_API_KEY', op: 'set', value: 'sk-new' }]),
    ).rejects.toThrow('Secure store is not available');
    db.close();
  });

  it('clear on secure key deletes from keychain', async () => {
    const values = new Map([['OPENAI_API_KEY', 'old-value']]);
    setKeychainProvider(createKeychain(values));
    const { db, configStore } = createConfigStore();
    const result = await applySettingsPatches(configStore, [
      { key: 'OPENAI_API_KEY', op: 'clear' },
    ]);
    expect(result.changedKeys).toContain('OPENAI_API_KEY');
    db.close();
  });

  it('clear on persisted key deletes from db', async () => {
    setKeychainProvider(createKeychain());
    const { db, configStore } = createConfigStore();
    configStore.setDbValue('LOG_LEVEL', 'debug');
    const result = await applySettingsPatches(configStore, [{ key: 'LOG_LEVEL', op: 'clear' }]);
    expect(result.changedKeys).toContain('LOG_LEVEL');
    expect(result.runtimeValues).toHaveProperty('LOG_LEVEL', '');
    db.close();
  });

  it('rollback restores keychain values on db error', async () => {
    const values = new Map<string, string>();
    const kc = createKeychain(values, {
      setPassword: async (key, value) => {
        values.set(key, value);
      },
    });
    setKeychainProvider(kc);
    const { db, configStore } = createConfigStore();

    // Cause transaction to fail by closing db
    void configStore.transaction.bind(configStore);
    vi.spyOn(configStore, 'transaction').mockImplementation(() => {
      throw new Error('DB write failed');
    });

    await expect(
      applySettingsPatches(configStore, [{ key: 'OPENAI_API_KEY', op: 'set', value: 'new-key' }]),
    ).rejects.toThrow('DB write failed');

    // Keychain should be rolled back (key deleted since it didn't exist before)
    expect(values.has('OPENAI_API_KEY')).toBe(false);
    db.close();
  });

  it('non-hot-reloadable key is added to requiresRestart (lines 134-135)', async () => {
    setKeychainProvider(createKeychain());
    const { db, configStore } = createConfigStore();
    // SLACK_BOT_TOKEN is a secure key that is NOT hot-reloadable
    const result = await applySettingsPatches(configStore, [
      { key: 'SLACK_BOT_TOKEN', op: 'clear' },
    ]);
    expect(result.requiresRestart).toContain('SLACK_BOT_TOKEN');
    db.close();
  });

  it('rollback catch is silent on rollback failure (line 194-196)', async () => {
    const values = new Map<string, string>([['OPENAI_API_KEY', 'old-value']]);
    let setCallCount = 0;
    const kc = createKeychain(values, {
      setPassword: async (key, value) => {
        setCallCount++;
        if (setCallCount > 1) {
          // Second setPassword call is the rollback — make it fail
          throw new Error('rollback setPassword failed');
        }
        values.set(key, value);
      },
    });
    setKeychainProvider(kc);
    const { db, configStore } = createConfigStore();

    vi.spyOn(configStore, 'transaction').mockImplementation(() => {
      throw new Error('DB write failed');
    });

    // Should throw the original error, not the rollback error
    await expect(
      applySettingsPatches(configStore, [{ key: 'OPENAI_API_KEY', op: 'set', value: 'new-key' }]),
    ).rejects.toThrow('DB write failed');

    db.close();
  });
});
