/** Coverage2 tests for oauth-security: uncovered lines 15-16, 26-27 (isPrivateIpv4 CGNat range, isPrivateIpv6 branches). */
import { describe, expect, it } from 'vitest';
import { isTrustedPublicHttpsUrl } from './oauth-security.js';

describe('oauth-security coverage2', () => {
  describe('isPrivateIpv4 — CGNAT range edge cases (lines 15-16)', () => {
    it('rejects 100.64.x.x (CGNAT start)', () => {
      expect(isTrustedPublicHttpsUrl('https://100.64.0.1')).toBe(false);
    });

    it('rejects 100.100.0.1 (mid CGNAT range)', () => {
      expect(isTrustedPublicHttpsUrl('https://100.100.0.1')).toBe(false);
    });

    it('rejects 100.127.255.255 (CGNAT end)', () => {
      expect(isTrustedPublicHttpsUrl('https://100.127.255.255')).toBe(false);
    });

    it('accepts 100.128.0.1 (outside CGNAT)', () => {
      expect(isTrustedPublicHttpsUrl('https://100.128.0.1')).toBe(true);
    });

    it('accepts 100.63.255.255 (below CGNAT range)', () => {
      expect(isTrustedPublicHttpsUrl('https://100.63.255.255')).toBe(true);
    });
  });

  describe('isPrivateIpv6 — unique local and multicast (lines 26-27)', () => {
    it('rejects fc00::1 (unique local)', () => {
      expect(isTrustedPublicHttpsUrl('https://[fc00::1]')).toBe(false);
    });

    it('rejects fd00::1 (unique local fd range)', () => {
      expect(isTrustedPublicHttpsUrl('https://[fd00::1]')).toBe(false);
    });

    it('rejects ff02::1 (multicast)', () => {
      expect(isTrustedPublicHttpsUrl('https://[ff02::1]')).toBe(false);
    });

    it('rejects fe80::1 (link-local)', () => {
      expect(isTrustedPublicHttpsUrl('https://[fe80::1]')).toBe(false);
    });

    it('rejects fea0::1 (link-local fea range)', () => {
      expect(isTrustedPublicHttpsUrl('https://[fea0::1]')).toBe(false);
    });

    it('rejects feb0::1 (link-local feb range)', () => {
      expect(isTrustedPublicHttpsUrl('https://[feb0::1]')).toBe(false);
    });
  });

  describe('172.x private range edge coverage', () => {
    it('rejects 172.16.0.1', () => {
      expect(isTrustedPublicHttpsUrl('https://172.16.0.1')).toBe(false);
    });

    it('rejects 172.31.255.255', () => {
      expect(isTrustedPublicHttpsUrl('https://172.31.255.255')).toBe(false);
    });

    it('accepts 172.15.255.255 (below private range)', () => {
      expect(isTrustedPublicHttpsUrl('https://172.15.255.255')).toBe(true);
    });

    it('accepts 172.32.0.1 (above private range)', () => {
      expect(isTrustedPublicHttpsUrl('https://172.32.0.1')).toBe(true);
    });
  });
});
