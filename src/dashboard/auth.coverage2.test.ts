/**
 * Additional coverage for auth.ts — setDashboardCookie and clearDashboardCookie branches.
 */
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { clearDashboardCookie, setDashboardCookie } from './auth.js';

function makeRes(): ServerResponse {
  const res = new EventEmitter() as unknown as ServerResponse;
  (res as unknown as { setHeader: ReturnType<typeof vi.fn> }).setHeader = vi.fn();
  return res;
}

describe('setDashboardCookie', () => {
  it('includes Secure attribute by default', () => {
    const res = makeRes();
    setDashboardCookie(res, 'test-secret');
    const setCookieCall = (res.setHeader as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(setCookieCall?.[0]).toBe('Set-Cookie');
    const cookieValue = setCookieCall?.[1] as string;
    expect(cookieValue).toContain('; Secure');
    expect(cookieValue).toContain('hg_session=');
    expect(cookieValue).toContain(encodeURIComponent('test-secret'));
    expect(cookieValue).toContain('HttpOnly');
    expect(cookieValue).toContain('SameSite=Strict');
    expect(cookieValue).toContain('Max-Age=');
    expect(cookieValue).toContain('Path=/');
  });

  it('omits Secure attribute when allowInsecureCookie is true', () => {
    const res = makeRes();
    setDashboardCookie(res, 'test-secret', { allowInsecureCookie: true });
    const cookieValue = (res.setHeader as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(cookieValue).not.toContain('; Secure');
  });

  it('includes Secure attribute when allowInsecureCookie is false', () => {
    const res = makeRes();
    setDashboardCookie(res, 'test-secret', { allowInsecureCookie: false });
    const cookieValue = (res.setHeader as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(cookieValue).toContain('; Secure');
  });
});

describe('clearDashboardCookie', () => {
  it('clears cookie with Secure attribute by default', () => {
    const res = makeRes();
    clearDashboardCookie(res);
    const setCookieCall = (res.setHeader as ReturnType<typeof vi.fn>).mock.calls[0];
    const cookieValue = setCookieCall?.[1] as string;
    expect(cookieValue).toContain('hg_session=');
    expect(cookieValue).toContain('Max-Age=0');
    expect(cookieValue).toContain('; Secure');
    expect(cookieValue).toContain('HttpOnly');
    expect(cookieValue).toContain('SameSite=Strict');
    expect(cookieValue).toContain('Path=/');
  });

  it('omits Secure attribute when allowInsecureCookie is true', () => {
    const res = makeRes();
    clearDashboardCookie(res, { allowInsecureCookie: true });
    const cookieValue = (res.setHeader as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(cookieValue).not.toContain('; Secure');
    expect(cookieValue).toContain('Max-Age=0');
  });

  it('includes Secure attribute when allowInsecureCookie is false', () => {
    const res = makeRes();
    clearDashboardCookie(res, { allowInsecureCookie: false });
    const cookieValue = (res.setHeader as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(cookieValue).toContain('; Secure');
  });
});
