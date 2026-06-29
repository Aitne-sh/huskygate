/** @module proxy — Dashboard-to-server API proxy with SSE stream forwarding */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeSseHeaders } from '../shared/sse.js';
import { errorMessage } from '../utils/error.js';
import { dashLog, json } from './http.js';

/* ── Server API proxy helpers ── */

export function createProxyToServerApi(serverApiBase: string, apiSecret: string) {
  return async function proxyToServerApi(
    method: string,
    path: string,
    body?: string,
  ): Promise<{ status: number; data: unknown }> {
    try {
      const opts: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiSecret}`,
        },
      };
      if (body) opts.body = body;
      const upstream = await fetch(`${serverApiBase}${path}`, opts);
      const data = (await upstream.json()) as unknown;
      return { status: upstream.status, data };
    } catch (err) {
      dashLog('warn', 'proxy_server_unreachable', {
        method,
        path,
        error: errorMessage(err),
      });
      return { status: 503, data: { error: 'Server is not running' } };
    }
  };
}

function createSSEProxy(
  serverApiBase: string,
  apiSecret: string,
  options: { method: 'GET' | 'POST'; logPrefix: 'proxy_sse' | 'proxy_sse_get' },
) {
  return async function proxySSECommon(
    serverPath: string,
    req: IncomingMessage,
    res: ServerResponse,
    body?: string,
  ): Promise<void> {
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${apiSecret}` };
      if (options.method === 'POST') {
        headers['Content-Type'] = 'application/json';
      }
      const upstream = await fetch(`${serverApiBase}${serverPath}`, {
        method: options.method,
        headers,
        ...(options.method === 'POST' ? { body } : {}),
      });

      if (!upstream.ok || !upstream.body) {
        const errData = await upstream.text().catch(() => '');
        let errJson: unknown;
        try {
          errJson = JSON.parse(errData);
        } catch {
          errJson = { error: 'Server request failed' };
        }
        dashLog('warn', `${options.logPrefix}_upstream_error`, {
          path: serverPath,
          status: upstream.status,
        });
        json(res, upstream.status || 502, errJson);
        return;
      }

      writeSseHeaders(res);

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();

      req.on('close', () => {
        reader.cancel().catch((err) => {
          dashLog('debug', `${options.logPrefix}_reader_cancel_failed`, {
            error: errorMessage(err),
          });
        });
      });

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done || res.writableEnded) break;
          const ok = res.write(decoder.decode(value, { stream: true }));
          // Backpressure: wait for the downstream buffer to drain
          if (!ok && !res.writableEnded) {
            await new Promise<void>((resolve) => res.once('drain', resolve));
          }
        }
      } catch (err) {
        dashLog('debug', `${options.logPrefix}_stream_closed`, {
          path: serverPath,
          error: errorMessage(err),
        });
      }

      if (!res.writableEnded) {
        res.end();
      }
    } catch (err) {
      dashLog('warn', `${options.logPrefix}_connection_failed`, {
        path: serverPath,
        error: errorMessage(err),
      });
      if (!res.headersSent) {
        json(res, 503, { error: 'Server is not running' });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  };
}

export function createProxySSE(serverApiBase: string, apiSecret: string) {
  const proxy = createSSEProxy(serverApiBase, apiSecret, {
    method: 'POST',
    logPrefix: 'proxy_sse',
  });
  return async function proxySSE(
    serverPath: string,
    body: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    return proxy(serverPath, req, res, body);
  };
}

export function createProxySSEGet(serverApiBase: string, apiSecret: string) {
  return createSSEProxy(serverApiBase, apiSecret, {
    method: 'GET',
    logPrefix: 'proxy_sse_get',
  });
}
