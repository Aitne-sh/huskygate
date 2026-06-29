/** @module auth — Dashboard cookie authentication */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { TTLS } from '../shared/constants.js';
import { timingSafeEqualString } from '../shared/security.js';

const DASHBOARD_COOKIE_NAME = 'hg_session';
const DASHBOARD_COOKIE_MAX_AGE_SEC = TTLS.dashboardCookieSec;

function parseCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) {
      const raw = rest.join('=');
      try {
        return decodeURIComponent(raw);
      } catch {
        // Malformed encoding — reject rather than compare mismatched values
        return null;
      }
    }
  }
  return null;
}

export function isDashboardAuthed(req: IncomingMessage, secret: string): boolean {
  const cookie = parseCookie(req, DASHBOARD_COOKIE_NAME);
  if (!cookie) return false;
  return timingSafeEqualString(cookie, secret);
}

export function setDashboardCookie(
  res: ServerResponse,
  secret: string,
  options?: { allowInsecureCookie?: boolean },
): void {
  const secureAttr = options?.allowInsecureCookie ? '' : '; Secure';
  res.setHeader(
    'Set-Cookie',
    `${DASHBOARD_COOKIE_NAME}=${encodeURIComponent(secret)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${DASHBOARD_COOKIE_MAX_AGE_SEC}${secureAttr}`,
  );
}

/** Clear the dashboard session cookie (logout). */
export function clearDashboardCookie(
  res: ServerResponse,
  options?: { allowInsecureCookie?: boolean },
): void {
  const secureAttr = options?.allowInsecureCookie ? '' : '; Secure';
  res.setHeader(
    'Set-Cookie',
    `${DASHBOARD_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureAttr}`,
  );
}
