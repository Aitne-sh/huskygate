/** @module dashboard/settings-service — Transactional settings mutation with keychain and DB persistence. */
import {
  type ConfigResolver,
  HOT_RELOADABLE_KEYS,
  PERSISTED_CONFIG_KEYS,
  SECURE_STORE_KEYS,
  SENSITIVE_VALUE_MASK,
  SETTINGS_EDITABLE_KEYS,
  createConfigResolver,
  validateSettingValue,
} from '../config.js';
import type { ConfigStore } from '../store/config-store.js';
import { getKeychainProvider } from '../utils/keychain.js';

export type SettingPatch =
  | { key: string; op: 'set'; value: string }
  | { key: string; op: 'clear' }
  | { key: string; op: 'noop' };

export interface DashboardResolverContext {
  resolver: ConfigResolver;
  keychainAvailable: boolean;
}

export interface ApplySettingsPatchResult {
  changedKeys: string[];
  runtimeValues: Record<string, string>;
  requiresRestart: string[];
}

type PersistedSettingMutation =
  | { key: string; storage: 'db'; op: 'set'; value: string }
  | { key: string; storage: 'db'; op: 'clear' }
  | { key: string; storage: 'keychain'; op: 'set'; value: string }
  | { key: string; storage: 'keychain'; op: 'clear' };

export async function createDashboardResolver(
  configStore: ConfigStore,
  dataDir: string,
  keys: readonly string[] = [...SECURE_STORE_KEYS],
): Promise<DashboardResolverContext> {
  const keychain = getKeychainProvider();
  const secureValues = new Map<string, string>();
  const keychainAvailable = await keychain.isAvailable();
  if (keychainAvailable) {
    for (const key of keys) {
      try {
        const value = await keychain.getPassword(key);
        if (value !== null) {
          secureValues.set(key, value);
        }
      } catch {
        // fall through to env fallback
      }
    }
  }

  return {
    resolver: createConfigResolver({
      configStore,
      dataDir,
      secureStoreValues: secureValues,
    }),
    keychainAvailable,
  };
}

export async function applySettingsPatches(
  configStore: ConfigStore,
  patches: SettingPatch[],
): Promise<ApplySettingsPatchResult> {
  const keychain = getKeychainProvider();
  const plannedMutations: PersistedSettingMutation[] = [];
  const changedKeys: string[] = [];
  const runtimeValues: Record<string, string> = {};
  const requiresRestart: string[] = [];

  for (const patch of patches) {
    if (!SETTINGS_EDITABLE_KEYS.has(patch.key)) {
      throw new Error(`Key '${patch.key}' is not editable`);
    }

    const normalizedPatch: SettingPatch =
      patch.op === 'set' && patch.value.length === 0 ? { key: patch.key, op: 'clear' } : patch;
    if (normalizedPatch.op === 'noop') {
      continue;
    }

    if (normalizedPatch.op === 'set') {
      if (normalizedPatch.value === SENSITIVE_VALUE_MASK) {
        throw new Error(`Masked placeholder is not allowed for '${normalizedPatch.key}'`);
      }
      const validationError = validateSettingValue(normalizedPatch.key, normalizedPatch.value);
      if (validationError) {
        throw new Error(validationError);
      }
      if (PERSISTED_CONFIG_KEYS.has(normalizedPatch.key)) {
        plannedMutations.push({
          key: normalizedPatch.key,
          storage: 'db',
          op: 'set',
          value: normalizedPatch.value,
        });
      } else if (SECURE_STORE_KEYS.has(normalizedPatch.key)) {
        plannedMutations.push({
          key: normalizedPatch.key,
          storage: 'keychain',
          op: 'set',
          value: normalizedPatch.value,
        });
      }
      if (!changedKeys.includes(normalizedPatch.key)) {
        changedKeys.push(normalizedPatch.key);
      }
      if (HOT_RELOADABLE_KEYS.has(normalizedPatch.key)) {
        runtimeValues[normalizedPatch.key] = normalizedPatch.value;
      } else {
        requiresRestart.push(normalizedPatch.key);
      }
      continue;
    }

    plannedMutations.push({
      key: normalizedPatch.key,
      storage: SECURE_STORE_KEYS.has(normalizedPatch.key) ? 'keychain' : 'db',
      op: 'clear',
    });
    if (!changedKeys.includes(normalizedPatch.key)) {
      changedKeys.push(normalizedPatch.key);
    }
    if (HOT_RELOADABLE_KEYS.has(normalizedPatch.key)) {
      runtimeValues[normalizedPatch.key] = '';
    } else {
      requiresRestart.push(normalizedPatch.key);
    }
  }

  const secureKeys = [
    ...new Set(plannedMutations.filter((m) => m.storage === 'keychain').map((m) => m.key)),
  ];
  if (secureKeys.length > 0) {
    const available = await keychain.isAvailable();
    if (!available) {
      throw new Error('Secure store is not available on this platform.');
    }
  }

  const secureSnapshots = new Map<string, string | null>();
  for (const key of secureKeys) {
    secureSnapshots.set(key, await keychain.getPassword(key));
  }

  const touchedSecureKeys = new Set<string>();
  try {
    for (const mutation of plannedMutations) {
      if (mutation.storage !== 'keychain') {
        continue;
      }
      if (mutation.op === 'set') {
        await keychain.setPassword(mutation.key, mutation.value);
      } else {
        await keychain.deletePassword(mutation.key);
      }
      touchedSecureKeys.add(mutation.key);
    }

    configStore.transaction(() => {
      for (const mutation of plannedMutations) {
        if (mutation.storage === 'db') {
          if (mutation.op === 'set') {
            configStore.setDbValue(mutation.key, mutation.value);
          } else {
            configStore.delete(mutation.key);
          }
          continue;
        }

        if (mutation.op === 'set') {
          configStore.setKeychainRef(mutation.key);
        } else {
          configStore.delete(mutation.key);
        }
      }
    });
  } catch (error) {
    for (const key of touchedSecureKeys) {
      const previousValue = secureSnapshots.get(key) ?? null;
      try {
        if (previousValue === null) {
          await keychain.deletePassword(key);
        } else {
          await keychain.setPassword(key, previousValue);
        }
      } catch {
        // Best-effort rollback. Preserve the original failure.
      }
    }
    throw error;
  }

  return {
    changedKeys,
    runtimeValues,
    requiresRestart: [...new Set(requiresRestart)],
  };
}

export function isSettingPatch(value: unknown): value is SettingPatch {
  if (!value || typeof value !== 'object') return false;
  const patch = value as Partial<SettingPatch>;
  if (typeof patch.key !== 'string' || typeof patch.op !== 'string') return false;
  if (patch.op === 'set') return typeof (patch as { value?: unknown }).value === 'string';
  return patch.op === 'clear' || patch.op === 'noop';
}
