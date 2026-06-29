/** @module event/webhook-secret-store — Keychain-backed storage for webhook endpoint secrets. */
import crypto from 'node:crypto';
import { type KeychainProvider, getKeychainProvider } from '../utils/keychain.js';

/** Manages HMAC/bearer secrets for webhook endpoints via the OS keychain. */
export class WebhookSecretStore {
  constructor(private readonly provider: KeychainProvider = getKeychainProvider()) {}

  buildSecretRef(endpointId: string): string {
    return `webhook-endpoint:${endpointId}`;
  }

  generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async isAvailable(): Promise<boolean> {
    return this.provider.isAvailable();
  }

  async getSecret(secretRef: string): Promise<string | null> {
    return this.provider.getPassword(secretRef);
  }

  async setSecret(secretRef: string, value: string): Promise<void> {
    await this.provider.setPassword(secretRef, value);
  }

  async deleteSecret(secretRef: string): Promise<boolean> {
    return this.provider.deletePassword(secretRef);
  }
}
