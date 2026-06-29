/** @module state — Server-side SSE job stream buffer management and lifecycle cleanup */
import type { Server, ServerResponse } from 'node:http';
import { INTERVALS, SIZE_LIMITS, TTLS } from '../shared/constants.js';

/** Maximum buffered events per job stream — prevents unbounded memory growth. */
export const MAX_BUFFER_EVENTS = SIZE_LIMITS.maxBufferEvents;

/** Interval (ms) for sweeping orphaned / completed job stream buffers. */
const BUFFER_CLEANUP_INTERVAL_MS = INTERVALS.bufferCleanup;

/** Completed buffers are kept for this duration to allow late SSE reconnects. */
const BUFFER_RETAIN_AFTER_DONE_MS = TTLS.bufferRetainAfterDone;

/** Buffered event stream for post-approval dashboard retry jobs. */
export interface JobStreamBuffer {
  events: Array<{ type: string; content: string; eventId: number }>;
  sseRes: ServerResponse | null;
  done: boolean;
  /** Timestamp (ms) when the job completed — used for deferred cleanup. */
  doneAt: number;
  assistantChunks: string[];
  toolApprovalReceived: boolean;
  /** Char offset at which the last tool_use/tool_result event was seen. */
  lastToolCharOffset: number;
  /** Running total of text chars accumulated so far. */
  currentCharOffset: number;
  /** Whether any tool event was observed. */
  sawToolEvent: boolean;
}

export const jobStreamBuffers = new Map<string, JobStreamBuffer>();

export function startJobStreamBufferCleanup(server: Server): void {
  const bufferCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, buffer] of jobStreamBuffers) {
      if (buffer.done && now - buffer.doneAt >= BUFFER_RETAIN_AFTER_DONE_MS) {
        jobStreamBuffers.delete(id);
      }
    }
  }, BUFFER_CLEANUP_INTERVAL_MS);
  bufferCleanupInterval.unref();

  server.on('close', () => clearInterval(bufferCleanupInterval));
}
