/** @module oauth-security — Shared OAuth URL / host trust validation helpers. */
import net from 'node:net';

function normalizeHostname(hostname: string): string {
  return hostname.trim().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '').toLowerCase();
}

function isPrivateIpv4(hostname: string): boolean {
  if (hostname === '0.0.0.0' || hostname.startsWith('127.')) return true;
  if (hostname.startsWith('10.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (hostname.startsWith('192.168.')) return true;
  if (hostname.startsWith('169.254.')) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname)) return true;
  return false;
}

function isPrivateIpv6(hostname: string): boolean {
  if (hostname === '::' || hostname === '::1') return true;
  if (hostname.startsWith('::ffff:')) {
    return isPrivateOrLoopbackHostname(hostname.slice('::ffff:'.length));
  }
  if (/^fe[89ab]/.test(hostname)) return true;
  if (/^f[cd]/.test(hostname)) return true;
  if (/^ff/.test(hostname)) return true;
  return false;
}

function isPrivateOrLoopbackHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return true;
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) return isPrivateIpv4(normalized);
  if (ipVersion === 6) return isPrivateIpv6(normalized);
  return false;
}

function parseTrustedOAuthHosts(raw: string | null | undefined): ReadonlySet<string> | null {
  if (!raw || !raw.trim()) return null;
  const hosts = raw
    .split(',')
    .map((host) => normalizeHostname(host))
    .filter((host) => host.length > 0);
  return hosts.length > 0 ? new Set(hosts) : null;
}

/**
 * Read trusted OAuth hosts from process.env.
 *
 * HUSKYGATE_OAUTH_TRUSTED_HOSTS is registered in ENV_REGISTRY (config-db, scope: driver)
 * and synced to process.env via syncProcessEnvFromResolver. Reading from process.env
 * here returns the cascade-resolved value (DB > keychain > env > default).
 */
export function getTrustedOAuthHostsFromEnv(): ReadonlySet<string> | null {
  return parseTrustedOAuthHosts(process.env.HUSKYGATE_OAUTH_TRUSTED_HOSTS);
}

export interface OAuthUrlTrustOptions {
  trustedHosts?: ReadonlySet<string> | null;
  requireTrustedHosts?: boolean;
}

export function isTrustedPublicHttpsUrl(
  candidate: string | URL,
  options?: OAuthUrlTrustOptions,
): boolean {
  let url: URL;
  try {
    url = candidate instanceof URL ? candidate : new URL(candidate);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const hostname = normalizeHostname(url.hostname);
  if (isPrivateOrLoopbackHostname(hostname)) return false;

  const trustedHosts = options?.trustedHosts ?? null;
  if (options?.requireTrustedHosts && !trustedHosts) return false;
  if (trustedHosts && !trustedHosts.has(hostname)) return false;
  return true;
}

export function normalizeOAuthHostname(hostname: string): string {
  return normalizeHostname(hostname);
}
