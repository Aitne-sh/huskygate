/**
 * Additional coverage tests for auth.ts.
 * Covers isDashboardAuthed and parseCookie edge cases.
 */
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { isDashboardAuthed } from './auth.js';

function makeReq(cookie?: string): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.headers = cookie ? { cookie } : {};
  return req;
}

describe('isDashboardAuthed', () => {
  it('returns false when no cookie header', () => {
    expect(isDashboardAuthed(makeReq(), 'secret')).toBe(false);
  });

  it('returns false when cookie name not found', () => {
    expect(isDashboardAuthed(makeReq('other=value'), 'secret')).toBe(false);
  });

  it('returns false when cookie value does not match', () => {
    expect(isDashboardAuthed(makeReq('hg_session=wrong'), 'secret')).toBe(false);
  });

  it('returns true when cookie matches secret', () => {
    expect(isDashboardAuthed(makeReq('hg_session=secret'), 'secret')).toBe(true);
  });

  it('handles encoded cookie value', () => {
    const encoded = encodeURIComponent('my-secret');
    expect(isDashboardAuthed(makeReq(`hg_session=${encoded}`), 'my-secret')).toBe(true);
  });

  it('rejects malformed percent-encoding (returns null to prevent mismatch)', () => {
    // %ZZ is invalid percent encoding — decodeURIComponent will throw.
    // Returning null (auth failure) is safer than falling back to the raw
    // encoded string, which could mismatch with the stored secret.
    const req = makeReq('hg_session=%ZZ');
    expect(isDashboardAuthed(req, '%ZZ')).toBe(false);
  });

  it('handles cookie with multiple = signs', () => {
    expect(isDashboardAuthed(makeReq('hg_session=a=b=c'), 'a=b=c')).toBe(true);
  });

  it('handles multiple cookies', () => {
    expect(isDashboardAuthed(makeReq('other=x; hg_session=secret; another=y'), 'secret')).toBe(
      true,
    );
  });
});
