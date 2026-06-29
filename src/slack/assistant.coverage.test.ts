/**
 * Coverage tests for assistant.ts — targets:
 * - Lines 216-229: file upload for large responses (exceedsFileUploadThreshold)
 * - Lines 293, 295: rate-limited retry delay in postInThread
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestAppContext, makeTestSession } from '../test-helpers/app-context-builder.js';
import { handleAssistantMessage } from './assistant.js';

function createMockContext() {
  const webClient = {
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ok: true }),
      update: vi.fn().mockResolvedValue({ ok: true }),
    },
    users: {},
    conversations: {},
    assistant: {
      threads: {
        setSuggestedPrompts: vi.fn().mockResolvedValue({ ok: true }),
        setStatus: vi.fn().mockResolvedValue({ ok: true }),
      },
    },
    filesUploadV2: vi.fn().mockResolvedValue({ ok: true }),
  } as unknown as ReturnType<typeof makeTestAppContext>['webClient'];
  const ctx = makeTestAppContext({
    config: {
      allowedUserIds: ['U123'],
    },
    webClient: webClient as never,
  });
  ctx.webClient = webClient;
  ctx.sessionManager.createSessionForThread = vi.fn(() =>
    makeTestSession({
      sessionKey: 'test-session',
      tool: 'claude',
      mode: 'write',
      workdir: '/tmp/test-workdir/session-1',
    }),
  ) as typeof ctx.sessionManager.createSessionForThread;
  ctx.sessionManager.getActiveSession = vi.fn(
    () => null,
  ) as typeof ctx.sessionManager.getActiveSession;
  ctx.jobQueue.enqueue = vi.fn(() => ({ position: 0 })) as typeof ctx.jobQueue.enqueue;
  ctx.workdirManager.prepareWorkdirSkillsOnly =
    vi.fn() as typeof ctx.workdirManager.prepareWorkdirSkillsOnly;
  ctx.conversationStore.saveMessage = vi.fn() as typeof ctx.conversationStore.saveMessage;
  return ctx;
}

describe('assistant coverage', () => {
  let ctx: ReturnType<typeof createMockContext>;
  let client: ReturnType<typeof createMockContext>['webClient'];

  beforeEach(() => {
    ctx = createMockContext();
    client = ctx.webClient;
  });

  describe('file upload for large responses (lines 216-229)', () => {
    it('uploads output as file when response exceeds file upload threshold', async () => {
      ctx.sessionManager.getActiveSession = vi.fn(() => ({
        sessionKey: 'test-session',
        tool: 'claude' as const,
        mode: 'code' as const,
        workdir: '/tmp/test-workdir/session-1',
        toolState: {},
      })) as unknown as typeof ctx.sessionManager.getActiveSession;

      await handleAssistantMessage(ctx, client as never, {
        channel: 'C456',
        threadTs: '1234567890.123456',
        ts: '1234567891.123456',
        userId: 'U123',
        text: 'Generate large output',
      });

      const entry = [...ctx.jobEventStreams.entries()][0];
      if (!entry) throw new Error('job event stream not registered');
      const [, stream] = entry;

      // Simulate a very large text response (>40000 chars to trigger file upload)
      const largeText = 'x'.repeat(45000);
      stream.onEvent({ type: 'text', content: largeText });
      await stream.onDone({ exitCode: 0, sessionState: {} });

      // Should have uploaded the file
      expect(client.filesUploadV2).toHaveBeenCalledWith(
        expect.objectContaining({
          channel_id: 'C456',
          thread_ts: '1234567890.123456',
          filename: 'output.md',
          title: 'Full output',
        }),
      );
    });

    it('warns when file upload fails (line 224-228)', async () => {
      ctx.sessionManager.getActiveSession = vi.fn(() => ({
        sessionKey: 'test-session',
        tool: 'claude' as const,
        mode: 'code' as const,
        workdir: '/tmp/test-workdir/session-1',
        toolState: {},
      })) as unknown as typeof ctx.sessionManager.getActiveSession;
      client.filesUploadV2 = vi.fn().mockRejectedValue(new Error('upload failed')) as never;

      await handleAssistantMessage(ctx, client as never, {
        channel: 'C456',
        threadTs: '1234567890.123456',
        ts: '1234567891.123456',
        userId: 'U123',
        text: 'Generate large output',
      });

      const entry = [...ctx.jobEventStreams.entries()][0];
      if (!entry) throw new Error('job event stream not registered');
      const [, stream] = entry;

      const largeText = 'x'.repeat(45000);
      stream.onEvent({ type: 'text', content: largeText });
      await stream.onDone({ exitCode: 0, sessionState: {} });

      // Should have attempted the upload but caught the error
      expect(client.filesUploadV2).toHaveBeenCalled();
      // The postMessage for markdown blocks should still succeed
      expect(client.chat.postMessage).toHaveBeenCalled();
    });
  });

  describe('rate-limited retry in postInThread (lines 293, 295)', () => {
    it('applies rate-limit backoff delay when Slack returns rate_limited error', async () => {
      vi.useFakeTimers();
      try {
        ctx.sessionManager.getActiveSession = vi.fn(() => ({
          sessionKey: 'test-session',
          tool: 'claude' as const,
          mode: 'code' as const,
          workdir: '/tmp/test-workdir/session-1',
          toolState: {},
        })) as unknown as typeof ctx.sessionManager.getActiveSession;

        // First call for setStatus — succeeds
        // Then for posting markdown blocks: first two fail with rate_limited, third succeeds
        const rateLimitError = Object.assign(new Error('rate limited'), {
          code: 'slack_webapi_rate_limited',
        });
        client.chat.postMessage = vi
          .fn()
          .mockRejectedValueOnce(rateLimitError)
          .mockRejectedValueOnce(rateLimitError)
          .mockResolvedValueOnce({ ok: true }) as never;

        await handleAssistantMessage(ctx, client as never, {
          channel: 'C456',
          threadTs: '1234567890.123456',
          ts: '1234567891.123456',
          userId: 'U123',
          text: 'Rate limit test',
        });

        const entry = [...ctx.jobEventStreams.entries()][0];
        if (!entry) throw new Error('job event stream not registered');
        const [, stream] = entry;

        stream.onEvent({ type: 'text', content: 'hello' });
        const donePromise = stream.onDone({ exitCode: 0, sessionState: {} });
        await vi.runAllTimersAsync();
        await donePromise;

        // The post should have eventually succeeded after retries
        const calls = (client.chat.postMessage as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls.length).toBeGreaterThanOrEqual(3);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
