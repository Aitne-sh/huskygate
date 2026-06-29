import { describe, expect, it } from 'vitest';
import { setDashboardCookie } from './auth.js';

class MockResponse {
  headers: Record<string, string | string[]> = {};

  setHeader(name: string, value: string | string[]): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }
}

describe('setDashboardCookie', () => {
  it('uses Secure cookies by default', () => {
    const res = new MockResponse();

    setDashboardCookie(res as never, 'dashboard-secret');

    expect(String(res.headers['set-cookie'])).toContain('; Secure');
  });

  it('uses Secure cookies when allowInsecureCookie is false', () => {
    const res = new MockResponse();

    setDashboardCookie(res as never, 'dashboard-secret', { allowInsecureCookie: false });

    expect(String(res.headers['set-cookie'])).toContain('; Secure');
  });

  it('omits Secure attribute when allowInsecureCookie is true', () => {
    const res = new MockResponse();

    setDashboardCookie(res as never, 'dashboard-secret', { allowInsecureCookie: true });

    expect(String(res.headers['set-cookie'])).not.toContain('; Secure');
  });
});
