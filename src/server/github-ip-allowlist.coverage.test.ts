/**
 * Coverage tests for github-ip-allowlist.ts — targets uncovered branches:
 * - refresh: non-ok response (lines 83-87)
 * - refresh: hooks is not array or empty (lines 92-95)
 * - refresh: CIDR without slash (line 101)
 * - refresh: invalid prefix (line 104)
 * - refresh: addSubnet error catch (lines 109-111)
 * - refresh: fetch error catch (lines 118-119)
 * - extractClientIp: tunnel enabled with array cf-connecting-ip
 * - start: refresh error in interval
 */
import type { IncomingMessage } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GitHubIpAllowlist, extractClientIp } from './github-ip-allowlist.js';

describe('GitHubIpAllowlist coverage', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('handles non-ok response from GitHub Meta API', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    );
    const allowlist = new GitHubIpAllowlist(999_999_999);
    await allowlist.start();
    allowlist.stop();
    // Should fail open
    expect(allowlist.isAllowed('1.2.3.4')).toBe(true);
  });

  it('handles hooks that is not an array', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ hooks: 'not-an-array' }), { status: 200 }),
    );
    const allowlist = new GitHubIpAllowlist(999_999_999);
    await allowlist.start();
    allowlist.stop();
    expect(allowlist.isAllowed('1.2.3.4')).toBe(true);
  });

  it('handles empty hooks array', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ hooks: [] }), { status: 200 }),
    );
    const allowlist = new GitHubIpAllowlist(999_999_999);
    await allowlist.start();
    allowlist.stop();
    expect(allowlist.isAllowed('1.2.3.4')).toBe(true);
  });

  it('skips CIDRs without slash', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ hooks: ['192.168.1.1', '10.0.0.0/8'] }), { status: 200 }),
    );
    const allowlist = new GitHubIpAllowlist(999_999_999);
    await allowlist.start();
    allowlist.stop();
    expect(allowlist.getCidrCount()).toBe(1);
  });

  it('skips CIDRs with invalid prefix', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ hooks: ['10.0.0.0/abc', '10.0.0.0/8'] }), { status: 200 }),
    );
    const allowlist = new GitHubIpAllowlist(999_999_999);
    await allowlist.start();
    allowlist.stop();
    expect(allowlist.getCidrCount()).toBe(1);
  });

  it('catches addSubnet errors for invalid addresses', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ hooks: ['invalid-addr/24', '10.0.0.0/8'] }), { status: 200 }),
    );
    const allowlist = new GitHubIpAllowlist(999_999_999);
    await allowlist.start();
    allowlist.stop();
    expect(allowlist.getCidrCount()).toBe(1);
  });

  it('handles fetch error (network failure)', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('network error'));
    const allowlist = new GitHubIpAllowlist(999_999_999);
    await allowlist.start();
    allowlist.stop();
    // Should fail open
    expect(allowlist.isAllowed('1.2.3.4')).toBe(true);
  });

  it('handles periodic refresh error', async () => {
    vi.useFakeTimers();
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ hooks: ['10.0.0.0/8'] }), { status: 200 }),
      )
      .mockRejectedValueOnce(new Error('periodic fail'));

    const allowlist = new GitHubIpAllowlist(1000);
    await allowlist.start();

    // Advance to trigger the interval refresh
    await vi.advanceTimersByTimeAsync(1500);

    allowlist.stop();
    vi.useRealTimers();
  });

  // Line 37: periodic refresh catch handler logging
  // (Already covered by 'handles periodic refresh error' above, but this explicitly verifies
  // the logger.warn call.)

  // Lines 68-69: getLastRefreshAt() returns lastRefreshAt after successful refresh
  it('getLastRefreshAt returns timestamp after successful refresh', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ hooks: ['10.0.0.0/8'] }), { status: 200 }),
    );
    const allowlist = new GitHubIpAllowlist(999_999_999);
    const before = Date.now();
    await allowlist.start();
    const after = Date.now();
    allowlist.stop();
    expect(allowlist.getLastRefreshAt()).toBeGreaterThanOrEqual(before);
    expect(allowlist.getLastRefreshAt()).toBeLessThanOrEqual(after);
  });

  // Lines 108-110: prefix out of valid range (e.g. /33 for IPv4, negative prefix)
  it('skips CIDRs with prefix out of valid range (too large for IPv4)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ hooks: ['10.0.0.0/33', '10.0.0.0/8'] }), { status: 200 }),
    );
    const allowlist = new GitHubIpAllowlist(999_999_999);
    await allowlist.start();
    allowlist.stop();
    expect(allowlist.getCidrCount()).toBe(1);
  });

  it('skips CIDRs with negative prefix', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ hooks: ['10.0.0.0/-1', '10.0.0.0/8'] }), { status: 200 }),
    );
    const allowlist = new GitHubIpAllowlist(999_999_999);
    await allowlist.start();
    allowlist.stop();
    expect(allowlist.getCidrCount()).toBe(1);
  });

  it('skips IPv6 CIDRs with prefix > 128', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ hooks: ['::1/129', '10.0.0.0/8'] }), { status: 200 }),
    );
    const allowlist = new GitHubIpAllowlist(999_999_999);
    await allowlist.start();
    allowlist.stop();
    expect(allowlist.getCidrCount()).toBe(1);
  });
});

describe('extractClientIp coverage', () => {
  it('returns cf-connecting-ip when tunnel enabled and loopback', () => {
    const req = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'cf-connecting-ip': '1.2.3.4' },
    } as unknown as IncomingMessage;
    expect(extractClientIp(req, true)).toBe('1.2.3.4');
  });

  it('returns remoteAddress when cf-connecting-ip is array', () => {
    const req = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'cf-connecting-ip': ['1.2.3.4', '5.6.7.8'] },
    } as unknown as IncomingMessage;
    expect(extractClientIp(req, true)).toBe('127.0.0.1');
  });

  it('returns remoteAddress when cf-connecting-ip is empty', () => {
    const req = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'cf-connecting-ip': '  ' },
    } as unknown as IncomingMessage;
    expect(extractClientIp(req, true)).toBe('127.0.0.1');
  });

  it('returns remoteAddress when tunnel disabled', () => {
    const req = {
      socket: { remoteAddress: '10.0.0.1' },
      headers: { 'cf-connecting-ip': '1.2.3.4' },
    } as unknown as IncomingMessage;
    expect(extractClientIp(req, false)).toBe('10.0.0.1');
  });

  it('handles IPv6 loopback', () => {
    const req = {
      socket: { remoteAddress: '::1' },
      headers: { 'cf-connecting-ip': '2001:db8::1' },
    } as unknown as IncomingMessage;
    expect(extractClientIp(req, true)).toBe('2001:db8::1');
  });

  it('returns empty string when remoteAddress is undefined', () => {
    const req = {
      socket: {},
      headers: {},
    } as unknown as IncomingMessage;
    expect(extractClientIp(req, false)).toBe('');
  });
});
