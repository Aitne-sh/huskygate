/** @module http — Shared HTTP helpers (JSON response, body reading, URL parsing) for Server API and Dashboard */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SIZE_LIMITS } from './constants.js';

export const MAX_BODY = SIZE_LIMITS.maxHttpBody;

export function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}

export function readBody(req: IncomingMessage): Promise<string> {
  return readBodyBuffer(req, MAX_BODY).then((buffer) => buffer.toString('utf-8'));
}

export function readBodyBuffer(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Check that the request Content-Type is JSON-compatible.
 * Returns true if valid or absent, false only when an incompatible type is explicitly set.
 * This prevents binary or form-encoded payloads from being silently JSON-parsed.
 */
export function isJsonContentType(req: IncomingMessage): boolean {
  const ct = req.headers['content-type'];
  // No Content-Type header — allow (many clients omit it for JSON bodies)
  if (!ct) return true;
  // Accept application/json and variants (e.g. application/json; charset=utf-8)
  return ct.startsWith('application/json');
}

export function parseUrl(raw: string | undefined): { pathname: string; query: URLSearchParams } {
  const url = new URL(raw ?? '/', 'http://localhost');
  return { pathname: url.pathname, query: url.searchParams };
}
