import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubIpAllowlist, extractClientIp } from './github-ip-allowlist.js';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const MOCK_META_RESPONSE = {
  hooks: ['192.30.252.0/22', '185.199.108.0/22', '140.82.112.0/20', '2a0a:a440::/29'],
};

describe('GitHubIpAllowlist', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('allows IPs in the GitHub hook ranges after refresh', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(MOCK_META_RESPONSE), { status: 200 }),
    );

    const allowlist = new GitHubIpAllowlist(999_999_999); // Long refresh interval
    await allowlist.start();

    expect(allowlist.isAllowed('192.30.252.1')).toBe(true);
    expect(allowlist.isAllowed('192.30.255.254')).toBe(true);
    expect(allowlist.isAllowed('185.199.108.100')).toBe(true);
    expect(allowlist.isAllowed('140.82.112.1')).toBe(true);
    expect(allowlist.getCidrCount()).toBe(4);

    allowlist.stop();
  });

  it('rejects IPs outside the GitHub hook ranges', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(MOCK_META_RESPONSE), { status: 200 }),
    );

    const allowlist = new GitHubIpAllowlist(999_999_999);
    await allowlist.start();

    expect(allowlist.isAllowed('1.2.3.4')).toBe(false);
    expect(allowlist.isAllowed('10.0.0.1')).toBe(false);
    expect(allowlist.isAllowed('192.30.248.1')).toBe(false); // Just outside /22

    allowlist.stop();
  });

  it('fails open when fetch fails', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Network error'));

    const allowlist = new GitHubIpAllowlist(999_999_999);
    await allowlist.start();

    // Fail-open: allow all IPs when allowlist hasn't loaded.
    expect(allowlist.isAllowed('1.2.3.4')).toBe(true);
    expect(allowlist.getCidrCount()).toBe(0);

    allowlist.stop();
  });

  it('fails open when API returns non-200', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response('Rate limited', { status: 403 }));

    const allowlist = new GitHubIpAllowlist(999_999_999);
    await allowlist.start();

    expect(allowlist.isAllowed('1.2.3.4')).toBe(true);

    allowlist.stop();
  });

  it('allows all IPs before start is called', () => {
    const allowlist = new GitHubIpAllowlist(999_999_999);
    expect(allowlist.isAllowed('1.2.3.4')).toBe(true);
  });

  it('handles IPv6 CIDRs', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(MOCK_META_RESPONSE), { status: 200 }),
    );

    const allowlist = new GitHubIpAllowlist(999_999_999);
    await allowlist.start();

    expect(allowlist.isAllowed('2a0a:a440::1')).toBe(true);
    expect(allowlist.isAllowed('2a0a:a441::1')).toBe(true);
    expect(allowlist.isAllowed('2a0b:b000::1')).toBe(false);

    allowlist.stop();
  });

  it('preserves previous allowlist when refresh fails', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(MOCK_META_RESPONSE), { status: 200 }),
    );

    const allowlist = new GitHubIpAllowlist(999_999_999);
    await allowlist.start();

    expect(allowlist.isAllowed('192.30.252.1')).toBe(true);
    expect(allowlist.isAllowed('1.2.3.4')).toBe(false);

    // Subsequent refresh fails — previous allowlist should remain.
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Network error'));
    // Trigger manual refresh by accessing private method via cast.
    await (allowlist as unknown as { refresh: () => Promise<void> }).refresh();

    // Still uses previous allowlist.
    expect(allowlist.isAllowed('192.30.252.1')).toBe(true);
    expect(allowlist.isAllowed('1.2.3.4')).toBe(false);

    allowlist.stop();
  });
});

describe('extractClientIp', () => {
  function makeRequest(
    remoteAddress: string,
    headers: Record<string, string> = {},
  ): IncomingMessage {
    return {
      socket: { remoteAddress } as Socket,
      headers,
    } as IncomingMessage;
  }

  it('returns remoteAddress when tunnel is disabled', () => {
    const req = makeRequest('1.2.3.4', { 'cf-connecting-ip': '5.6.7.8' });
    expect(extractClientIp(req, false)).toBe('1.2.3.4');
  });

  it('returns CF-Connecting-IP when tunnel enabled and connection is from loopback', () => {
    const req = makeRequest('127.0.0.1', { 'cf-connecting-ip': '192.30.252.1' });
    expect(extractClientIp(req, true)).toBe('192.30.252.1');
  });

  it('returns CF-Connecting-IP for IPv6 loopback', () => {
    const req = makeRequest('::1', { 'cf-connecting-ip': '10.0.0.1' });
    expect(extractClientIp(req, true)).toBe('10.0.0.1');
  });

  it('returns CF-Connecting-IP for IPv4-mapped IPv6 loopback', () => {
    const req = makeRequest('::ffff:127.0.0.1', { 'cf-connecting-ip': '10.0.0.2' });
    expect(extractClientIp(req, true)).toBe('10.0.0.2');
  });

  it('ignores CF-Connecting-IP when connection is NOT from loopback (anti-spoof)', () => {
    const req = makeRequest('203.0.113.50', { 'cf-connecting-ip': '192.30.252.1' });
    // Even with tunnel enabled, non-loopback connections cannot be trusted.
    expect(extractClientIp(req, true)).toBe('203.0.113.50');
  });

  it('falls back to remoteAddress when CF-Connecting-IP is missing', () => {
    const req = makeRequest('127.0.0.1', {});
    expect(extractClientIp(req, true)).toBe('127.0.0.1');
  });

  it('trims whitespace from CF-Connecting-IP', () => {
    const req = makeRequest('127.0.0.1', { 'cf-connecting-ip': '  10.0.0.3  ' });
    expect(extractClientIp(req, true)).toBe('10.0.0.3');
  });
});
