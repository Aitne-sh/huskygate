/** @module sse — Server-Sent Events response headers and writer for streaming endpoints */
import type { ServerResponse } from 'node:http';

/** Standard SSE response headers.
 *  Disables buffering on Nginx (`X-Accel-Buffering`) and intermediate caches (`no-transform`). */
const SSE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Content-Type-Options': 'nosniff',
  'X-Accel-Buffering': 'no',
};

/** Write standard SSE response headers. */
export function writeSseHeaders(res: ServerResponse): void {
  res.writeHead(200, SSE_HEADERS);
}
