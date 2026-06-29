/** @module server/github-ip-allowlist — GitHub webhook source IP validation using the Meta API. */

import type { IncomingMessage } from 'node:http';
import { BlockList } from 'node:net';
import { INTERVALS, TIMEOUTS } from '../shared/constants.js';
import { logger } from '../utils/logger.js';

/** Default refresh interval: 6 hours. */
const DEFAULT_REFRESH_INTERVAL_MS = INTERVALS.githubIpRefresh;

/** GitHub Meta API endpoint. */
const GITHUB_META_URL = 'https://api.github.com/meta';

/** Request timeout for the GitHub Meta API. */
const FETCH_TIMEOUT_MS = TIMEOUTS.githubIpFetch;

/**
 * Validates webhook source IPs against GitHub's published hook IP ranges.
 *
 * Uses `node:net.BlockList` for efficient CIDR matching.
 * Fails open: if the Meta API is unreachable, all IPs are allowed
 * (HMAC signature verification is the primary security gate).
 */
export class GitHubIpAllowlist {
  private allowlist: BlockList | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastRefreshAt = 0;
  private cidrCount = 0;

  constructor(private readonly refreshIntervalMs: number = DEFAULT_REFRESH_INTERVAL_MS) {}

  /** Start periodic refresh. First refresh is awaited; failures are non-fatal. */
  async start(): Promise<void> {
    await this.refresh();
    this.refreshTimer = setInterval(() => {
      this.refresh().catch((err) => {
        logger.warn('github_ip_allowlist_refresh_failed', { error: String(err) });
      });
    }, this.refreshIntervalMs);
    this.refreshTimer.unref();
  }

  /** Stop periodic refresh. */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Check if an IP address is allowed (present in GitHub's hook ranges).
   * Returns true if the allowlist hasn't loaded yet (fail-open).
   */
  isAllowed(ip: string): boolean {
    if (!this.allowlist) return true;
    const family = ip.includes(':') ? 'ipv6' : 'ipv4';
    return this.allowlist.check(ip, family);
  }

  /** Number of loaded CIDR ranges. */
  getCidrCount(): number {
    return this.cidrCount;
  }

  /** Timestamp of last successful refresh. */
  getLastRefreshAt(): number {
    return this.lastRefreshAt;
  }

  /** Fetch the GitHub Meta API and rebuild the allowlist. */
  private async refresh(): Promise<void> {
    try {
      const response = await fetch(GITHUB_META_URL, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'HuskyGate/1.0',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        logger.warn('github_meta_api_error', {
          status: response.status,
          statusText: response.statusText,
        });
        return;
      }

      const data = (await response.json()) as { hooks?: string[] };
      const hooks = data.hooks;
      if (!Array.isArray(hooks) || hooks.length === 0) {
        logger.warn('github_meta_api_no_hooks', { data: JSON.stringify(data).slice(0, 200) });
        return;
      }

      const list = new BlockList();
      let count = 0;
      for (const cidr of hooks) {
        const slashIdx = cidr.indexOf('/');
        if (slashIdx === -1) continue;
        const addr = cidr.slice(0, slashIdx);
        const prefix = Number.parseInt(cidr.slice(slashIdx + 1), 10);
        if (!Number.isFinite(prefix)) continue;
        const family = addr.includes(':') ? 'ipv6' : 'ipv4';
        const maxPrefix = family === 'ipv4' ? 32 : 128;
        if (prefix < 0 || prefix > maxPrefix) {
          logger.warn('github_ip_allowlist_invalid_prefix', { cidr, prefix, maxPrefix });
          continue;
        }
        try {
          list.addSubnet(addr, prefix, family);
          count++;
        } catch {
          logger.warn('github_ip_allowlist_invalid_cidr', { cidr });
        }
      }

      this.allowlist = list;
      this.cidrCount = count;
      this.lastRefreshAt = Date.now();
      logger.info('github_ip_allowlist_refreshed', { cidrCount: count });
    } catch (err) {
      logger.warn('github_ip_allowlist_refresh_error', { error: String(err) });
      // Keep the previous allowlist (or null → fail-open).
    }
  }
}

// ── Client IP extraction ──

const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Only allow characters valid in IPv4/IPv6 addresses. */
const IP_PATTERN = /^[\da-f.:]+$/i;

/**
 * Extract the real client IP from an incoming request.
 *
 * Security: CF-Connecting-IP is only trusted when the direct connection
 * originates from loopback (i.e., cloudflared forwarding). This prevents
 * header spoofing from direct external connections.
 */
export function extractClientIp(req: IncomingMessage, tunnelEnabled: boolean): string {
  const remoteAddress = req.socket.remoteAddress ?? '';

  if (tunnelEnabled && LOOPBACK_ADDRS.has(remoteAddress)) {
    const cfIp = req.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string' && cfIp.trim() && IP_PATTERN.test(cfIp.trim())) {
      return cfIp.trim();
    }
  }

  return remoteAddress;
}
