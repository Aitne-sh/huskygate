import { describe, expect, it, vi } from 'vitest';
import type { KeychainProvider } from '../utils/keychain.js';
import { WebhookSecretStore } from './webhook-secret-store.js';

describe('WebhookSecretStore', () => {
  it('builds stable secret refs and generates 32-byte hex secrets', () => {
    const store = new WebhookSecretStore({
      platform: 'test',
      isAvailable: vi.fn(async () => true),
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true),
      listKeys: vi.fn(async () => []),
    } satisfies KeychainProvider);

    expect(store.buildSecretRef('endpoint-1')).toBe('webhook-endpoint:endpoint-1');
    expect(store.generateSecret()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('delegates provider operations', async () => {
    const provider = {
      platform: 'test',
      isAvailable: vi.fn(async () => false),
      getPassword: vi.fn(async () => 'secret-value'),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => true),
      listKeys: vi.fn(async () => ['ref-1']),
    } satisfies KeychainProvider;
    const store = new WebhookSecretStore(provider);

    await expect(store.isAvailable()).resolves.toBe(false);
    await expect(store.getSecret('ref-1')).resolves.toBe('secret-value');
    await store.setSecret('ref-1', 'updated');
    await expect(store.deleteSecret('ref-1')).resolves.toBe(true);

    expect(provider.isAvailable).toHaveBeenCalledOnce();
    expect(provider.getPassword).toHaveBeenCalledWith('ref-1');
    expect(provider.setPassword).toHaveBeenCalledWith('ref-1', 'updated');
    expect(provider.deletePassword).toHaveBeenCalledWith('ref-1');
  });
});
