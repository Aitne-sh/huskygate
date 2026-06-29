/** @module server/routes/tunnel-api — API routes for Cloudflare Tunnel lifecycle management. */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../../context/app-context.js';
import { json, readBody } from '../../shared/http.js';
import { errorMessage } from '../../utils/error.js';
import { logger } from '../../utils/logger.js';
import { resolveCommand } from '../../utils/platform.js';
import { CloudflareTunnel } from '../tunnel.js';

export function matchesTunnelApiPath(pathname: string): boolean {
  return pathname === '/api/tunnel' || pathname.startsWith('/api/tunnel/');
}

export async function handleTunnelApiRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (req.method === 'GET' && pathname === '/api/tunnel/status') {
    const tunnel = ctx.tunnel;
    const cloudflaredInstalled = resolveCommand('cloudflared') !== null;
    json(res, 200, {
      ok: true,
      data: {
        active: tunnel !== null,
        url: tunnel?.getPublicUrl() ?? null,
        cloudflaredInstalled,
        publicBaseUrl: ctx.config.webhookPublicBaseUrl ?? null,
        localPort: ctx.config.serverApiPort,
      },
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/tunnel/start') {
    if (ctx.tunnel) {
      json(res, 200, {
        ok: true,
        data: {
          active: true,
          url: ctx.tunnel.getPublicUrl(),
          publicBaseUrl: ctx.config.webhookPublicBaseUrl ?? null,
        },
      });
      return true;
    }

    const cloudflaredPath = resolveCommand('cloudflared');
    if (!cloudflaredPath) {
      json(res, 400, {
        error:
          'cloudflared is not installed. Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
      });
      return true;
    }

    // Read optional token from request body.
    let token: string | null = null;
    try {
      const body = await readBody(req);
      if (body) {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        if (typeof parsed.token === 'string' && parsed.token.trim()) {
          token = parsed.token.trim();
        }
      }
    } catch {
      // No body or invalid JSON — use quick tunnel.
    }

    const tunnel = new CloudflareTunnel({
      localPort: ctx.config.serverApiPort,
      localHost: ctx.config.serverApiHost,
      token: token ?? ctx.config.cloudflareTunnelToken,
    });

    try {
      const tunnelUrl = await tunnel.start();
      ctx.tunnel = tunnel;
      ctx.tunnelEnabled = true;

      if (tunnelUrl && !ctx.config.webhookPublicBaseUrl) {
        ctx.config.webhookPublicBaseUrl = tunnelUrl;
      }

      json(res, 200, {
        ok: true,
        data: {
          active: true,
          url: tunnelUrl,
          publicBaseUrl: ctx.config.webhookPublicBaseUrl ?? null,
        },
      });
    } catch (err) {
      tunnel.stop();
      logger.error('tunnel_api_start_failed', { error: errorMessage(err) });
      json(res, 500, { error: `Failed to start tunnel: ${errorMessage(err)}` });
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/tunnel/stop') {
    if (ctx.tunnel) {
      const wasQuickTunnel = ctx.tunnel.getPublicUrl() !== null;
      ctx.tunnel.stop();
      ctx.tunnel = null;
      ctx.tunnelEnabled = false;

      // Clear the auto-set public URL if it was from a quick tunnel.
      if (wasQuickTunnel) {
        ctx.config.webhookPublicBaseUrl = null;
      }

      logger.info('tunnel_api_stopped');
    }
    json(res, 200, { ok: true, data: { active: false, url: null } });
    return true;
  }

  return false;
}
