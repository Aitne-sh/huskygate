import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestAppContext, makeTestSession } from '../test-helpers/app-context-builder.js';
import {
  handleAssistantMessage,
  isAssistantThread,
  registerAssistantHandlers,
} from './assistant.js';

type AssistantTestContext = Parameters<typeof registerAssistantHandlers>[0];

function createMockContext(): AssistantTestContext {
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
  } as unknown as AssistantTestContext['webClient'];
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

describe('assistant', () => {
  describe('isAssistantThread', () => {
    it('returns true for tracked threads', () => {
      const ctx = createMockContext();
      ctx.assistantThreads.set('C123:1234567890.123456', true);
      expect(isAssistantThread(ctx, 'C123', '1234567890.123456')).toBe(true);
    });

    it('returns false for untracked threads', () => {
      const ctx = createMockContext();
      expect(isAssistantThread(ctx, 'C123', '1234567890.123456')).toBe(false);
    });

    it('returns false for expired threads', () => {
      const ctx = createMockContext();
      ctx.assistantThreads.set('C123:1234567890.123456', true, 1); // 1ms TTL
      // Wait for expiry
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(isAssistantThread(ctx, 'C123', '1234567890.123456')).toBe(false);
          resolve();
        }, 5);
      });
    });
  });

  describe('registerAssistantHandlers', () => {
    it('registers event handlers on the app', () => {
      const ctx = createMockContext();
      const mockApp = { event: vi.fn() } as unknown as Parameters<
        typeof registerAssistantHandlers
      >[1];

      registerAssistantHandlers(ctx, mockApp);

      expect(mockApp.event).toHaveBeenCalledWith('assistant_thread_started', expect.any(Function));
      expect(mockApp.event).toHaveBeenCalledWith(
        'assistant_thread_context_changed',
        expect.any(Function),
      );
    });

    it('threadStarted handler tracks thread, greets user, creates session', async () => {
      const ctx = createMockContext();
      const handlers = new Map<string, (...args: unknown[]) => Promise<void>>();
      const mockApp = {
        event: vi.fn((name: string, handler: (...args: unknown[]) => Promise<void>) => {
          handlers.set(name, handler);
        }),
      } as unknown as Parameters<typeof registerAssistantHandlers>[1];

      registerAssistantHandlers(ctx, mockApp);

      const handler = handlers.get('assistant_thread_started');
      if (!handler) {
        throw new Error('assistant_thread_started handler not registered');
      }
      const client = ctx.webClient;

      await handler({
        event: {
          assistant_thread: {
            user_id: 'U123',
            channel_id: 'C456',
            thread_ts: '1234567890.123456',
          },
        },
        client,
      });

      // Thread should be tracked (ExpiringMap.has returns boolean via lazy eviction)
      expect(ctx.assistantThreads.has('C456:1234567890.123456')).toBe(true);

      // Greeting posted
      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C456',
          thread_ts: '1234567890.123456',
          text: expect.stringContaining('How can I help'),
        }),
      );

      // Suggested prompts set
      expect(client.assistant.threads.setSuggestedPrompts).toHaveBeenCalledWith(
        expect.objectContaining({
          channel_id: 'C456',
          thread_ts: '1234567890.123456',
        }),
      );

      // Session created with namespaced key
      expect(ctx.sessionManager.createSessionForThread).toHaveBeenCalledWith(
        'assistant:C456:1234567890.123456',
        'U123',
        'claude',
      );
    });

    it('threadStarted continues when prompt setup or greeting fails', async () => {
      const ctx = createMockContext();
      const handlers = new Map<string, (...args: unknown[]) => Promise<void>>();
      const mockApp = {
        event: vi.fn((name: string, handler: (...args: unknown[]) => Promise<void>) => {
          handlers.set(name, handler);
        }),
      } as unknown as Parameters<typeof registerAssistantHandlers>[1];

      const client = ctx.webClient;
      client.assistant.threads.setSuggestedPrompts = vi
        .fn()
        .mockRejectedValue(new Error('prompt failed')) as never;
      client.chat.postMessage = vi.fn().mockRejectedValue(new Error('post failed')) as never;

      registerAssistantHandlers(ctx, mockApp);

      const handler = handlers.get('assistant_thread_started');
      if (!handler) throw new Error('assistant_thread_started handler not registered');

      await handler({
        event: {
          assistant_thread: {
            user_id: 'U123',
            channel_id: 'C999',
            thread_ts: '9999999999.999999',
          },
        },
        client,
      });

      expect(ctx.assistantThreads.has('C999:9999999999.999999')).toBe(true);
      expect(ctx.sessionManager.createSessionForThread).toHaveBeenCalledWith(
        'assistant:C999:9999999999.999999',
        'U123',
        'claude',
      );
    });

    it('threadStarted also tolerates non-Error prompt/greeting failures', async () => {
      const ctx = createMockContext();
      const handlers = new Map<string, (...args: unknown[]) => Promise<void>>();
      const mockApp = {
        event: vi.fn((name: string, handler: (...args: unknown[]) => Promise<void>) => {
          handlers.set(name, handler);
        }),
      } as unknown as Parameters<typeof registerAssistantHandlers>[1];

      const client = ctx.webClient;
      client.assistant.threads.setSuggestedPrompts = vi
        .fn()
        .mockRejectedValue('prompt failed') as never;
      client.chat.postMessage = vi.fn().mockRejectedValue('post failed') as never;

      registerAssistantHandlers(ctx, mockApp);

      const handler = handlers.get('assistant_thread_started');
      if (!handler) throw new Error('assistant_thread_started handler not registered');

      await expect(
        handler({
          event: {
            assistant_thread: {
              user_id: 'U123',
              channel_id: 'C100',
              thread_ts: '1000000000.000001',
            },
          },
          client,
        }),
      ).resolves.toBeUndefined();
    });

    it('context changed handler can be invoked safely', async () => {
      const ctx = createMockContext();
      const handlers = new Map<string, (...args: unknown[]) => Promise<void>>();
      const mockApp = {
        event: vi.fn((name: string, handler: (...args: unknown[]) => Promise<void>) => {
          handlers.set(name, handler);
        }),
      } as unknown as Parameters<typeof registerAssistantHandlers>[1];

      registerAssistantHandlers(ctx, mockApp);

      const handler = handlers.get('assistant_thread_context_changed');
      if (!handler) throw new Error('assistant_thread_context_changed handler not registered');

      await expect(
        handler({
          event: {
            assistant_thread: {
              channel_id: 'C456',
            },
          },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('handleAssistantMessage', () => {
    let ctx: ReturnType<typeof createMockContext>;
    let client: ReturnType<typeof createMockContext>['webClient'];

    beforeEach(() => {
      ctx = createMockContext();
      client = ctx.webClient;
    });

    it('enqueues job for authorized user', async () => {
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
        text: 'Hello assistant',
      });

      expect(client.assistant.threads.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Processing...' }),
      );
      expect(ctx.conversationStore.saveMessage).toHaveBeenCalledWith(
        'test-session',
        'user',
        'Hello assistant',
        expect.any(String),
      );
      expect(ctx.jobQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'assistant',
          tool: 'claude',
          prompt: 'Hello assistant',
        }),
      );
    });

    it('creates a new session when active session does not exist', async () => {
      ctx.sessionManager.getActiveSession = vi.fn(
        () => null,
      ) as unknown as typeof ctx.sessionManager.getActiveSession;

      await handleAssistantMessage(ctx, client as never, {
        channel: 'C456',
        threadTs: '1234567890.123456',
        ts: '1234567891.123456',
        userId: 'U123',
        text: 'create session path',
      });

      expect(ctx.sessionManager.createSessionForThread).toHaveBeenCalledWith(
        'assistant:C456:1234567890.123456',
        'U123',
        'claude',
      );
    });

    it('rejects unauthorized user', async () => {
      await handleAssistantMessage(ctx, client as never, {
        channel: 'C456',
        threadTs: '1234567890.123456',
        ts: '1234567891.123456',
        userId: 'UNAUTHORIZED_USER',
        text: 'Hello',
      });

      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Sorry, you are not authorized to use this assistant.',
        }),
      );
      expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
    });

    it('handles enqueue failure', async () => {
      ctx.sessionManager.getActiveSession = vi.fn(() => ({
        sessionKey: 'test-session',
        tool: 'claude' as const,
        mode: 'code' as const,
        workdir: '/tmp/test-workdir/session-1',
        toolState: {},
      })) as unknown as typeof ctx.sessionManager.getActiveSession;

      ctx.jobQueue.enqueue = vi.fn(() => ({
        error: 'Queue full',
      })) as unknown as typeof ctx.jobQueue.enqueue;

      await handleAssistantMessage(ctx, client as never, {
        channel: 'C456',
        threadTs: '1234567890.123456',
        ts: '1234567891.123456',
        userId: 'U123',
        text: 'Hello',
      });

      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Failed to start task: Queue full',
        }),
      );
    });

    it('registers job event stream and calls onDone with markdown blocks', async () => {
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
        text: 'Hello',
      });

      // A job event stream should have been registered
      expect(ctx.jobEventStreams.size).toBe(1);
      const entry = [...ctx.jobEventStreams.entries()][0];
      if (!entry) {
        throw new Error('job event stream not registered');
      }
      const [, stream] = entry;

      // Simulate text events
      stream.onEvent({ type: 'text', content: 'Hello ' });
      stream.onEvent({ type: 'text', content: 'world' });

      // Simulate done
      await stream.onDone({ exitCode: 0, sessionState: {} });

      // Should have posted the collected response with markdown blocks
      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'C456',
          thread_ts: '1234567890.123456',
          blocks: expect.arrayContaining([expect.objectContaining({ type: 'markdown' })]),
          text: expect.any(String),
        }),
      );
      expect(ctx.conversationStore.saveMessage).toHaveBeenCalledWith(
        'test-session',
        'assistant',
        'Hello world',
        expect.any(String),
      );

      // Stream should be cleaned up
      expect(ctx.jobEventStreams.size).toBe(0);
    });

    it('continues when setStatus fails and posts fallback text on empty output', async () => {
      ctx.sessionManager.getActiveSession = vi.fn(() => ({
        sessionKey: 'test-session',
        tool: 'claude' as const,
        mode: 'code' as const,
        workdir: '/tmp/test-workdir/session-1',
        toolState: {},
      })) as unknown as typeof ctx.sessionManager.getActiveSession;
      client.assistant.threads.setStatus = vi
        .fn()
        .mockRejectedValue(new Error('status failed')) as never;

      await handleAssistantMessage(ctx, client as never, {
        channel: 'C456',
        threadTs: '1234567890.123456',
        ts: '1234567891.123456',
        userId: 'U123',
        text: 'No output please',
      });

      const entry = [...ctx.jobEventStreams.entries()][0];
      if (!entry) throw new Error('job event stream not registered');
      const [, stream] = entry;
      await stream.onDone({ exitCode: 0, sessionState: {} });

      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Task completed with no text output.',
        }),
      );
      expect(ctx.conversationStore.saveMessage).not.toHaveBeenCalledWith(
        'test-session',
        'assistant',
        '',
      );
    });

    it('continues when setStatus rejects with a non-Error value', async () => {
      ctx.sessionManager.getActiveSession = vi.fn(() => ({
        sessionKey: 'test-session',
        tool: 'claude' as const,
        mode: 'code' as const,
        workdir: '/tmp/test-workdir/session-1',
        toolState: {},
      })) as unknown as typeof ctx.sessionManager.getActiveSession;
      client.assistant.threads.setStatus = vi.fn().mockRejectedValue('status failed') as never;

      await handleAssistantMessage(ctx, client as never, {
        channel: 'C456',
        threadTs: '1234567890.123456',
        ts: '1234567891.123456',
        userId: 'U123',
        text: 'status failed string',
      });

      expect(ctx.jobQueue.enqueue).toHaveBeenCalledTimes(1);
    });

    it('posts fallback error when reply send fails after retries', async () => {
      vi.useFakeTimers();
      try {
        ctx.sessionManager.getActiveSession = vi.fn(() => ({
          sessionKey: 'test-session',
          tool: 'claude' as const,
          mode: 'code' as const,
          workdir: '/tmp/test-workdir/session-1',
          toolState: {},
        })) as unknown as typeof ctx.sessionManager.getActiveSession;

        client.chat.postMessage = vi
          .fn()
          .mockRejectedValueOnce(new Error('post failed'))
          .mockRejectedValueOnce(new Error('post failed'))
          .mockRejectedValueOnce(new Error('post failed'))
          .mockResolvedValueOnce({ ok: true }) as never;

        await handleAssistantMessage(ctx, client as never, {
          channel: 'C456',
          threadTs: '1234567890.123456',
          ts: '1234567891.123456',
          userId: 'U123',
          text: 'cause post error',
        });

        const entry = [...ctx.jobEventStreams.entries()][0];
        if (!entry) throw new Error('job event stream not registered');
        const [, stream] = entry;
        stream.onEvent({ type: 'text', content: 'hello' });
        const donePromise = stream.onDone({ exitCode: 0, sessionState: {} });
        await vi.runAllTimersAsync();
        await donePromise;

        // Main blocks post fails after 3 attempts, plain-text error fallback succeeds
        const calls = (client.chat.postMessage as ReturnType<typeof vi.fn>).mock.calls;
        const fallbackCall = calls.find(
          (call: unknown[]) =>
            (call[0] as { text: string }).text === 'An error occurred while sending the response.',
        );
        expect(fallbackCall).toBeDefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('posts fallback error when reply send rejects with a non-Error value', async () => {
      vi.useFakeTimers();
      try {
        ctx.sessionManager.getActiveSession = vi.fn(() => ({
          sessionKey: 'test-session',
          tool: 'claude' as const,
          mode: 'code' as const,
          workdir: '/tmp/test-workdir/session-1',
          toolState: {},
        })) as unknown as typeof ctx.sessionManager.getActiveSession;

        client.chat.postMessage = vi
          .fn()
          .mockRejectedValueOnce('post failed')
          .mockRejectedValueOnce('post failed')
          .mockRejectedValueOnce('post failed')
          .mockResolvedValueOnce({ ok: true }) as never;

        await handleAssistantMessage(ctx, client as never, {
          channel: 'C456',
          threadTs: '1234567890.123456',
          ts: '1234567891.123456',
          userId: 'U123',
          text: 'cause non-error post failure',
        });

        const entry = [...ctx.jobEventStreams.entries()][0];
        if (!entry) throw new Error('job event stream not registered');
        const [, stream] = entry;
        stream.onEvent({ type: 'text', content: 'hello' });
        const donePromise = stream.onDone({ exitCode: 0, sessionState: {} });
        await vi.runAllTimersAsync();
        await donePromise;

        // Main blocks post fails after retries, plain-text error fallback succeeds
        const calls = (client.chat.postMessage as ReturnType<typeof vi.fn>).mock.calls;
        const fallbackCall = calls.find(
          (call: unknown[]) =>
            (call[0] as { text: string }).text === 'An error occurred while sending the response.',
        );
        expect(fallbackCall).toBeDefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('swallows secondary reply failure after initial send error with retries', async () => {
      vi.useFakeTimers();
      try {
        ctx.sessionManager.getActiveSession = vi.fn(() => ({
          sessionKey: 'test-session',
          tool: 'claude' as const,
          mode: 'code' as const,
          workdir: '/tmp/test-workdir/session-1',
          toolState: {},
        })) as unknown as typeof ctx.sessionManager.getActiveSession;

        client.chat.postMessage = vi
          .fn()
          .mockRejectedValueOnce(new Error('first failed'))
          .mockRejectedValueOnce(new Error('first failed'))
          .mockRejectedValueOnce(new Error('first failed'))
          .mockRejectedValueOnce(new Error('second failed'))
          .mockRejectedValueOnce(new Error('second failed'))
          .mockRejectedValueOnce(new Error('second failed')) as never;

        await handleAssistantMessage(ctx, client as never, {
          channel: 'C456',
          threadTs: '1234567890.123456',
          ts: '1234567891.123456',
          userId: 'U123',
          text: 'double fail',
        });

        const entry = [...ctx.jobEventStreams.entries()][0];
        if (!entry) throw new Error('job event stream not registered');
        const [, stream] = entry;
        stream.onEvent({ type: 'text', content: 'hello' });

        const donePromise = stream.onDone({ exitCode: 0, sessionState: {} });
        await vi.runAllTimersAsync();
        await expect(donePromise).resolves.toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('skips empty text messages', async () => {
      await handleAssistantMessage(ctx, client as never, {
        channel: 'C456',
        threadTs: '1234567890.123456',
        ts: '1234567891.123456',
        userId: 'U123',
        text: '',
      });

      expect(ctx.jobQueue.enqueue).not.toHaveBeenCalled();
      expect(client.chat.postMessage).not.toHaveBeenCalled();
    });
  });
});
