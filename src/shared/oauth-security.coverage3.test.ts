/** Coverage3 tests for oauth-security: uncovered lines 26-27 (isPrivateIpv6 returns false for public IPv6) */
import { describe, expect, it } from 'vitest';
import { isTrustedPublicHttpsUrl } from './oauth-security.js';

describe('oauth-security coverage3', () => {
  describe('isPrivateIpv6 — false return for public IPv6 (lines 26-27)', () => {
    it('accepts public IPv6 address (2001:db8::1)', () => {
      // 2001:db8:: is documentation prefix, but NOT private/loopback/link-local/multicast
      // The function should return false for it (not private)
      expect(isTrustedPublicHttpsUrl('https://[2001:db8::1]')).toBe(true);
    });

    it('accepts public IPv6 address (2607:f8b0::1)', () => {
      expect(isTrustedPublicHttpsUrl('https://[2607:f8b0::1]')).toBe(true);
    });
  });
});
