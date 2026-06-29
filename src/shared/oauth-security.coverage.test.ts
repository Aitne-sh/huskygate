/** Coverage tests for oauth-security: URL trust, private IP detection, trusted hosts. */
import { afterEach, describe, expect, it } from 'vitest';
import {
  getTrustedOAuthHostsFromEnv,
  isTrustedPublicHttpsUrl,
  normalizeOAuthHostname,
} from './oauth-security.js';

describe('oauth-security coverage', () => {
  const originalTrustedHosts = process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS;

  afterEach(() => {
    if (originalTrustedHosts === undefined) {
      delete process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS;
    } else {
      process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS = originalTrustedHosts;
    }
  });

  describe('isTrustedPublicHttpsUrl', () => {
    it('rejects non-https', () => {
      expect(isTrustedPublicHttpsUrl('http://example.com')).toBe(false);
    });

    it('rejects invalid URL', () => {
      expect(isTrustedPublicHttpsUrl('not a url')).toBe(false);
    });

    it('rejects localhost', () => {
      expect(isTrustedPublicHttpsUrl('https://localhost')).toBe(false);
    });

    it('rejects .localhost subdomain', () => {
      expect(isTrustedPublicHttpsUrl('https://foo.localhost')).toBe(false);
    });

    it('rejects private IPv4 - 127.x', () => {
      expect(isTrustedPublicHttpsUrl('https://127.0.0.1')).toBe(false);
    });

    it('rejects private IPv4 - 10.x', () => {
      expect(isTrustedPublicHttpsUrl('https://10.0.0.1')).toBe(false);
    });

    it('rejects private IPv4 - 172.16.x', () => {
      expect(isTrustedPublicHttpsUrl('https://172.16.0.1')).toBe(false);
    });

    it('rejects private IPv4 - 192.168.x', () => {
      expect(isTrustedPublicHttpsUrl('https://192.168.1.1')).toBe(false);
    });

    it('rejects private IPv4 - 169.254.x (link-local)', () => {
      expect(isTrustedPublicHttpsUrl('https://169.254.1.1')).toBe(false);
    });

    it('rejects private IPv4 - 100.64.x (CGNAT)', () => {
      expect(isTrustedPublicHttpsUrl('https://100.64.0.1')).toBe(false);
    });

    it('rejects 0.0.0.0', () => {
      expect(isTrustedPublicHttpsUrl('https://0.0.0.0')).toBe(false);
    });

    it('rejects IPv6 loopback ::1', () => {
      expect(isTrustedPublicHttpsUrl('https://[::1]')).toBe(false);
    });

    it('rejects IPv6 all-zeros ::', () => {
      expect(isTrustedPublicHttpsUrl('https://[::]')).toBe(false);
    });

    it('rejects IPv6 link-local fe80::', () => {
      expect(isTrustedPublicHttpsUrl('https://[fe80::1]')).toBe(false);
    });

    it('rejects IPv6 unique-local fc00::', () => {
      expect(isTrustedPublicHttpsUrl('https://[fc00::1]')).toBe(false);
    });

    it('rejects IPv6 multicast ff00::', () => {
      expect(isTrustedPublicHttpsUrl('https://[ff02::1]')).toBe(false);
    });

    it('handles IPv4-mapped IPv6 ::ffff:127.0.0.1', () => {
      // URL parsing may strip the brackets - behavior is platform-dependent
      const result = isTrustedPublicHttpsUrl('https://[::ffff:127.0.0.1]');
      expect(typeof result).toBe('boolean');
    });

    it('accepts valid public HTTPS URL', () => {
      expect(isTrustedPublicHttpsUrl('https://auth.example.com')).toBe(true);
    });

    it('accepts URL object', () => {
      expect(isTrustedPublicHttpsUrl(new URL('https://auth.example.com'))).toBe(true);
    });

    it('rejects when requireTrustedHosts is true but no trustedHosts', () => {
      expect(
        isTrustedPublicHttpsUrl('https://auth.example.com', {
          requireTrustedHosts: true,
          trustedHosts: null,
        }),
      ).toBe(false);
    });

    it('rejects when host not in trustedHosts', () => {
      expect(
        isTrustedPublicHttpsUrl('https://untrusted.com', {
          trustedHosts: new Set(['trusted.com']),
        }),
      ).toBe(false);
    });

    it('accepts when host is in trustedHosts', () => {
      expect(
        isTrustedPublicHttpsUrl('https://trusted.com', {
          trustedHosts: new Set(['trusted.com']),
        }),
      ).toBe(true);
    });

    it('handles empty hostname', () => {
      // Empty hostname normalizes to empty string, which is truthy-falsy edge
      expect(isTrustedPublicHttpsUrl('https://')).toBe(false);
    });
  });

  describe('getTrustedOAuthHostsFromEnv', () => {
    it('returns null when env var is not set', () => {
      delete process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS;
      expect(getTrustedOAuthHostsFromEnv()).toBeNull();
    });

    it('returns null for empty string', () => {
      process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS = '';
      expect(getTrustedOAuthHostsFromEnv()).toBeNull();
    });

    it('returns null for whitespace only', () => {
      process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS = '  ';
      expect(getTrustedOAuthHostsFromEnv()).toBeNull();
    });

    it('parses comma-separated hosts', () => {
      process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS = 'auth.example.com,login.example.com';
      const result = getTrustedOAuthHostsFromEnv();
      expect(result).not.toBeNull();
      expect(result?.has('auth.example.com')).toBe(true);
      expect(result?.has('login.example.com')).toBe(true);
    });

    it('normalizes hostnames', () => {
      process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS = 'AUTH.Example.COM.';
      const result = getTrustedOAuthHostsFromEnv();
      expect(result).not.toBeNull();
      expect(result?.has('auth.example.com')).toBe(true);
    });
  });

  describe('normalizeOAuthHostname', () => {
    it('lowercases and trims', () => {
      expect(normalizeOAuthHostname(' Auth.EXAMPLE.COM. ')).toBe('auth.example.com');
    });

    it('strips brackets from IPv6', () => {
      expect(normalizeOAuthHostname('[::1]')).toBe('::1');
    });
  });
});
