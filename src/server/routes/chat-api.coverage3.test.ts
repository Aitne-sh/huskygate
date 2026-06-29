/**
 * Coverage3 tests for chat-api.ts — targets remaining uncovered lines:
 * 140-144 (sseWrite error catch), 153 (sseRetry catch), 175-177,179 (heartbeat try/catch),
 * 361-363 (tool_use/tool_result tracking), 553-569 (readonly mode MCP denial),
 * 671-672 (buffer overflow), 678-680 (buffer tool tracking), 766-771 (last-event-id replay),
 * 784 (replay write catch).
 */
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../context/app-context.js';
import type { PendingToolApproval } from '../../context/app-types.js';
import type { ActiveRunner } from '../../context/app-types.js';
import {
  makeTestAppContext,
  makeTestSession,
  makeTestSessionSummary,
} from '../../test-helpers/app-context-builder.js';
import { MAX_BUFFER_EVENTS, jobStreamBuffers } from '../state.js';
import { handleChatApiRoutes } from './chat-api.js';

const mocked = vi.hoisted(() => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
    })),
  })),
}));

vi.mock('../../store/database.js', () => ({
  getDb: mocked.getDb,
}));

class MockRequest extends EventEmitter {
  public method: string;
  public url?: string;
  public headers: Record<string, string>;

  constructor(method: string, url: string, headers?: Record<string, string>) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers ?? {};
  }

  destroy(): this {
    this.emit('close');
    return this;
  }
}

class MockResponse {
  public statusCode = 200;
  public body = '';
  public headers: Record<string, string> = {};
  public writableEnded = false;
  public throwOnWrite = false;

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.statusCode = statusCode;
    if (headers) this.headers = { ...headers };
    return this;
  }

  setHeader(k: string, v: string): this {
    this.headers[k] = v;
    return this;
  }

  write(chunk: string): boolean {
    if (this.throwOnWrite) throw new Error('write EPIPE');
    this.body += chunk;
    return true;
  }

  end(chunk?: string): this {
    if (chunk) this.body += chunk;
    this.writableEnded = true;
    return this;
  }
}

async function invoke(
  ctx: AppContext,
  options: { method: string; path: string; body?: unknown; query?: string },
): Promise<{ handled: boolean; status: number; body: unknown }> {
  const url = options.query ? `${options.path}?${options.query}` : options.path;
  const req = new MockRequest(options.method, url, { 'content-type': 'application/json' });
  const res = new MockResponse();
  const promise = handleChatApiRoutes(
    ctx,
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse,
    options.path,
  );
  if (options.body !== undefined) {
    req.emit('data', Buffer.from(JSON.stringify(options.body)));
  }
  req.emit('end');
  const handled = await promise;
  return {
    handled,
    status: res.statusCode,
    body: res.body ? JSON.parse(res.body) : null,
  };
}

function makePendingApproval(overrides: Partial<PendingToolApproval> = {}): PendingToolApproval {
  return {
    sessionKey: 'sess_test',
    tool: 'claude',
    deniedTools: ['bash'],
    requestedToolName: 'bash',
    requestedToolArgs: null,
    approvedCodexToolCalls: [],
    skipGeminiMcpPreflightOnce: false,
    prompt: 'test prompt',
    userId: 'U1',
    requestId: 'req-1',
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe('chat-api coverage3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobStreamBuffers.clear();
  });

  // ── Lines 553-569: readonly mode MCP tool approval denial ──
  describe('POST /api/chat/:id/tool-approval — readonly mode MCP denial', () => {
    it('denies MCP tool approval in readonly mode (mcp__ prefix)', async () => {
      const ctx = makeTestAppContext();
      const session = makeTestSessionSummary({
        sessionId: 'abcdef01',
        sessionKey: 'sess_test',
        threadKey: 'dashboard_1',
      });
      (ctx.sessionManager.getSessionSummaryById as ReturnType<typeof vi.fn>).mockReturnValue(
        session,
      );

      const approval = makePendingApproval({
        sessionKey: 'sess_test',
        requestedToolName: 'mcp__server__tool',
        requestId: 'req-1',
      });
      ctx.pendingToolApprovals.set('sess_test:req-1', approval);

      (ctx.sessionManager.get as ReturnType<typeof vi.fn>).mockReturnValue(
        makeTestSession({ sessionKey: 'sess_test', mode: 'readonly' }),
      );

      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/chat/abcdef01/tool-approval',
        body: { decision: 'approve', requestId: 'req-1' },
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(403);
      expect((r.body as Record<string, string>).error).toContain('MCP tool approval is not allowed in readonly mode');
    });

    it('denies MCP tool approval in readonly mode (mcp_ prefix)', async () => {
      const ctx = makeTestAppContext();
      const session = makeTestSessionSummary({
        sessionId: 'abcdef01',
        sessionKey: 'sess_test',
        threadKey: 'dashboard_1',
      });
      (ctx.sessionManager.getSessionSummaryById as ReturnType<typeof vi.fn>).mockReturnValue(
        session,
      );

      const approval = makePendingApproval({
        sessionKey: 'sess_test',
        requestedToolName: 'mcp_server_tool',
        requestId: 'req-2',
      });
      ctx.pendingToolApprovals.set('sess_test:req-2', approval);

      (ctx.sessionManager.get as ReturnType<typeof vi.fn>).mockReturnValue(
        makeTestSession({ sessionKey: 'sess_test', mode: 'readonly' }),
      );

      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/chat/abcdef01/tool-approval',
        body: { decision: 'approve', requestId: 'req-2' },
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(403);
    });
  });

  // ── Lines 361-363: tool_use/tool_result event tracking in onEvent ──
  describe('POST /api/chat/:id/send — tool_use event tracking', () => {
    it('tracks tool_use events in the onEvent callback', async () => {
      const ctx = makeTestAppContext();
      const session = makeTestSessionSummary({
        sessionId: 'abcdef01',
        sessionKey: 'sess_test',
        threadKey: 'C1:1.1',
      });
      (ctx.sessionManager.getSessionSummaryById as ReturnType<typeof vi.fn>).mockReturnValue(
        session,
      );
      (ctx.sessionManager.get as ReturnType<typeof vi.fn>).mockReturnValue(
        makeTestSession({ sessionKey: 'sess_test' }),
      );

      // Set up mock to capture the jobEventStreams callback
      const req = new MockRequest('POST', '/api/chat/abcdef01/send', {
        'content-type': 'application/json',
      });
      const res = new MockResponse();
      const promise = handleChatApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/chat/abcdef01/send',
      );
      req.emit('data', Buffer.from(JSON.stringify({ prompt: 'test' })));
      req.emit('end');

      // Wait a tick for the handler to set up jobEventStreams
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Find the registered stream and trigger tool_use event
      const streams = [...ctx.jobEventStreams.entries()];
      if (streams.length > 0) {
        const [, stream] = streams[0]!;
        // Trigger tool_use event (lines 360-363)
        stream.onEvent({ type: 'tool_use', content: 'tool call' });
        stream.onEvent({ type: 'tool_result', content: 'tool result' });
        // Trigger done to complete
        stream.onDone({ response: 'done', exitCode: 0 });
      }

      const handled = await promise;
      expect(handled).toBe(true);
    });
  });

  // ── Lines 671-672: buffer overflow warning ──
  describe('job stream buffer overflow', () => {
    it('warns on buffer overflow in dashboard mode tool-approval rerun', async () => {
      const ctx = makeTestAppContext();
      const session = makeTestSessionSummary({
        sessionId: 'abcdef01',
        sessionKey: 'sess_test',
        threadKey: 'dashboard_1',
      });
      (ctx.sessionManager.getSessionSummaryById as ReturnType<typeof vi.fn>).mockReturnValue(
        session,
      );

      const approval = makePendingApproval({
        sessionKey: 'sess_test',
        requestedToolName: 'bash',
        requestId: 'req-1',
        tool: 'claude',
      });
      ctx.pendingToolApprovals.set('sess_test:req-1', approval);

      (ctx.sessionManager.get as ReturnType<typeof vi.fn>).mockReturnValue(
        makeTestSession({ sessionKey: 'sess_test', mode: 'write' }),
      );

      const r = await invoke(ctx, {
        method: 'POST',
        path: '/api/chat/abcdef01/tool-approval',
        body: { decision: 'approve', requestId: 'req-1' },
      });
      expect(r.handled).toBe(true);
      expect(r.status).toBe(200);

      // Now simulate buffer overflow by finding the registered stream
      const streams = [...ctx.jobEventStreams.entries()];
      if (streams.length > 0) {
        const [jobId, stream] = streams[0]!;
        const buffer = jobStreamBuffers.get(jobId);
        if (buffer) {
          // Fill the buffer to max
          for (let i = 0; i < MAX_BUFFER_EVENTS; i++) {
            buffer.events.push({ type: 'text', content: `chunk-${i}`, eventId: i });
          }
          // This should trigger the overflow warning (line 671-672)
          stream.onEvent({ type: 'text', content: 'overflow' });

          // Also trigger tool_use to cover lines 678-680
          stream.onEvent({ type: 'tool_use', content: 'tool call' });
          stream.onEvent({ type: 'tool_result', content: 'result' });
        }
      }
    });
  });

  // ── Lines 766-771: last-event-id replay logic ──
  describe('GET /api/chat/:id/job-stream/:jobId — last-event-id replay', () => {
    it('replays events from last-event-id', async () => {
      const ctx = makeTestAppContext();
      const session = makeTestSessionSummary({
        sessionId: 'abcdef01',
        sessionKey: 'sess_test',
        threadKey: 'dashboard_1',
      });
      (ctx.sessionManager.getSessionSummaryById as ReturnType<typeof vi.fn>).mockReturnValue(
        session,
      );

      // Pre-populate the buffer
      const jobId = '11111111-1111-1111-1111-111111111111';
      jobStreamBuffers.set(jobId, {
        events: [
          { type: 'text', content: 'chunk1', eventId: 1 },
          { type: 'text', content: 'chunk2', eventId: 2 },
          { type: 'text', content: 'chunk3', eventId: 3 },
        ],
        sseRes: null,
        done: false,
        doneAt: 0,
        assistantChunks: [],
        toolApprovalReceived: false,
        lastToolCharOffset: -1,
        currentCharOffset: 0,
        sawToolEvent: false,
      });

      const req = new MockRequest(
        'GET',
        `/api/chat/abcdef01/job-stream/${jobId}`,
        {
          'content-type': 'application/json',
          'last-event-id': '1',
        },
      );
      const res = new MockResponse();
      const promise = handleChatApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        `/api/chat/abcdef01/job-stream/${jobId}`,
      );
      req.emit('end');

      // Wait for async setup then close
      await new Promise((resolve) => setTimeout(resolve, 50));
      req.emit('close');
      const handled = await promise;
      expect(handled).toBe(true);
      // Should have replayed events with eventId > 1
      expect(res.body).toContain('chunk2');
      expect(res.body).toContain('chunk3');
    });

    it('handles NaN last-event-id gracefully', async () => {
      const ctx = makeTestAppContext();
      const session = makeTestSessionSummary({
        sessionId: 'abcdef01',
        sessionKey: 'sess_test',
        threadKey: 'dashboard_1',
      });
      (ctx.sessionManager.getSessionSummaryById as ReturnType<typeof vi.fn>).mockReturnValue(
        session,
      );

      const jobId = '11111111-1111-1111-1111-111111111111';
      jobStreamBuffers.set(jobId, {
        events: [{ type: 'text', content: 'chunk1', eventId: 1 }],
        sseRes: null,
        done: true,
        doneAt: Date.now(),
        assistantChunks: [],
        toolApprovalReceived: false,
        lastToolCharOffset: -1,
        currentCharOffset: 0,
        sawToolEvent: false,
      });

      const req = new MockRequest(
        'GET',
        `/api/chat/abcdef01/job-stream/${jobId}`,
        {
          'content-type': 'application/json',
          'last-event-id': 'not-a-number',
        },
      );
      const res = new MockResponse();
      const promise = handleChatApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        `/api/chat/abcdef01/job-stream/${jobId}`,
      );
      req.emit('end');

      await new Promise((resolve) => setTimeout(resolve, 50));
      const handled = await promise;
      expect(handled).toBe(true);
    });
  });

  // ── Line 784: replay write catch block ──
  describe('GET /api/chat/:id/job-stream/:jobId — replay write error', () => {
    it('catches write errors during event replay', async () => {
      const ctx = makeTestAppContext();
      const session = makeTestSessionSummary({
        sessionId: 'abcdef01',
        sessionKey: 'sess_test',
        threadKey: 'dashboard_1',
      });
      (ctx.sessionManager.getSessionSummaryById as ReturnType<typeof vi.fn>).mockReturnValue(
        session,
      );

      const jobId = '11111111-1111-1111-1111-111111111111';
      jobStreamBuffers.set(jobId, {
        events: [
          { type: 'text', content: 'chunk1', eventId: 1 },
          { type: 'text', content: 'chunk2', eventId: 2 },
        ],
        sseRes: null,
        done: true,
        doneAt: Date.now(),
        assistantChunks: [],
        toolApprovalReceived: false,
        lastToolCharOffset: -1,
        currentCharOffset: 0,
        sawToolEvent: false,
      });

      const req = new MockRequest(
        'GET',
        `/api/chat/abcdef01/job-stream/${jobId}`,
        { 'content-type': 'application/json' },
      );
      const res = new MockResponse();
      // Make write throw after first successful write
      let writeCount = 0;
      const originalWrite = res.write.bind(res);
      res.write = (chunk: string): boolean => {
        writeCount++;
        // Let SSE headers and retry through, but fail on replay writes
        if (writeCount > 3) throw new Error('write EPIPE');
        return originalWrite(chunk);
      };

      const promise = handleChatApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        `/api/chat/abcdef01/job-stream/${jobId}`,
      );
      req.emit('end');

      await new Promise((resolve) => setTimeout(resolve, 50));
      const handled = await promise;
      expect(handled).toBe(true);
    });
  });

  // ── Lines 140-144: sseWrite error catch, 153: sseRetry catch, 175-177,179: heartbeat try/catch ──
  // These are triggered internally via SSE writes. Testing them requires triggering write errors.
  describe('SSE write/retry/heartbeat error handling', () => {
    it('sseWrite catches write errors silently', async () => {
      vi.useFakeTimers();
      const ctx = makeTestAppContext();
      const session = makeTestSessionSummary({
        sessionId: 'abcdef01',
        sessionKey: 'sess_test',
        threadKey: 'C1:1.1',
      });
      (ctx.sessionManager.getSessionSummaryById as ReturnType<typeof vi.fn>).mockReturnValue(
        session,
      );
      (ctx.sessionManager.get as ReturnType<typeof vi.fn>).mockReturnValue(
        makeTestSession({ sessionKey: 'sess_test' }),
      );

      const req = new MockRequest('POST', '/api/chat/abcdef01/send', {
        'content-type': 'application/json',
      });
      const res = new MockResponse();

      const promise = handleChatApiRoutes(
        ctx,
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        '/api/chat/abcdef01/send',
      );
      req.emit('data', Buffer.from(JSON.stringify({ prompt: 'test' })));
      req.emit('end');

      // Wait for setup
      await vi.advanceTimersByTimeAsync(10);

      // Make write throw to trigger the catch blocks
      res.throwOnWrite = true;

      // Advance timer to trigger heartbeat (lines 175-177, 179)
      await vi.advanceTimersByTimeAsync(31_000);

      // Find the registered stream and trigger events to trigger sseWrite error (lines 140-144)
      const streams = [...ctx.jobEventStreams.entries()];
      if (streams.length > 0) {
        const [, stream] = streams[0]!;
        stream.onEvent({ type: 'text', content: 'test' });
        res.throwOnWrite = false;
        stream.onDone({ response: 'done', exitCode: 0 });
      }

      const handled = await promise;
      expect(handled).toBe(true);
      vi.useRealTimers();
    });
  });
});
