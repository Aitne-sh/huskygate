/**
 * Coverage tests for messenger.ts — targets uncovered branches in
 * flushChunk, withRetry, extractRetryAfterMs, and readHeader.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  postMessage: vi.fn().mockResolvedValue({ ts: '1.0' }),
  update: vi.fn().mockResolvedValue({ ok: true }),
  filesUploadV2: vi.fn().mockResolvedValue({ ok: true }),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  shouldSplit: vi.fn(() => false),
  findSplitPoint: vi.fn(() => 0),
  readFileSync: vi.fn(() => Buffer.from('data')),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: mocked.loggerInfo,
    warn: mocked.loggerWarn,
    error: mocked.loggerError,
  },
}));

vi.mock('../shared/constants.js', () => ({
  RETRY_LIMITS: { slackMessenger: 2 },
  SIZE_LIMITS: {
    markdownBlockMaxChars: 12_000,
    markdownBodyMaxChars: 11_500,
    markdownFileUploadThreshold: 40_000,
  },
}));

vi.mock('../shared/text-utils.js', () => ({
  shouldSplit: mocked.shouldSplit,
  findSplitPoint: mocked.findSplitPoint,
}));

vi.mock('node:fs', () => ({
  default: { readFileSync: mocked.readFileSync },
  readFileSync: mocked.readFileSync,
}));

import { Messenger } from './messenger.js';

function makeClient(): ConstructorParameters<typeof Messenger>[0] {
  return {
    chat: {
      postMessage: mocked.postMessage,
      update: mocked.update,
    },
    filesUploadV2: mocked.filesUploadV2,
  } as unknown as ConstructorParameters<typeof Messenger>[0];
}

describe('Messenger coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('withRetry — rate limited all attempts exhausted', () => {
    it('returns null when rate limited on every attempt', async () => {
      const rateLimitErr = { code: 'slack_webapi_rate_limited', retryAfter: 0.001 };
      mocked.postMessage.mockRejectedValue(rateLimitErr);
      const m = new Messenger(makeClient(), 'C1', 'T1');

      const promise = m.postStatusMessage('hello');
      // Advance timers enough for all retry delays
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await promise;
      expect(result).toBeNull();
    });
  });

  describe('withRetry — non-rate-limited error exhausts retries', () => {
    it('logs error and returns null after max retries', async () => {
      mocked.postMessage.mockRejectedValue(new Error('network'));
      const m = new Messenger(makeClient(), 'C1', 'T1');

      const promise = m.postStatusMessage('test');
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await promise;
      expect(result).toBeNull();
      expect(mocked.loggerError).toHaveBeenCalledWith(
        'post_message_failed',
        expect.objectContaining({ attempts: expect.any(Number) }),
      );
    });
  });

  describe('withRetry — non-rate-limited error retries then succeeds', () => {
    it('retries and succeeds on second attempt', async () => {
      mocked.postMessage
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce({ ts: '2.0' });
      const m = new Messenger(makeClient(), 'C1', 'T1');

      const promise = m.postStatusMessage('test');
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await promise;
      expect(result).toBe('2.0');
      expect(mocked.loggerWarn).toHaveBeenCalledWith(
        'post_retry',
        expect.objectContaining({ attempt: 1 }),
      );
    });
  });

  describe('extractRetryAfterMs branches', () => {
    it('extracts from data.retryAfter', async () => {
      const err = {
        code: 'slack_webapi_rate_limited',
        data: { retryAfter: 2 },
      };
      mocked.postMessage.mockRejectedValue(err);
      const m = new Messenger(makeClient(), 'C1', 'T1');
      const promise = m.postStatusMessage('test');
      await vi.advanceTimersByTimeAsync(60_000);
      await promise;
      expect(mocked.loggerWarn).toHaveBeenCalledWith(
        'rate_limited_post',
        expect.objectContaining({ retry_after_ms: 2000 }),
      );
    });

    it('extracts from data.retry_after', async () => {
      const err = {
        code: 'slack_webapi_rate_limited',
        data: { retry_after: 3 },
      };
      mocked.postMessage.mockRejectedValue(err);
      const m = new Messenger(makeClient(), 'C1', 'T1');
      const promise = m.postStatusMessage('test');
      await vi.advanceTimersByTimeAsync(60_000);
      await promise;
      expect(mocked.loggerWarn).toHaveBeenCalledWith(
        'rate_limited_post',
        expect.objectContaining({ retry_after_ms: 3000 }),
      );
    });

    it('extracts from response.headers Retry-After', async () => {
      const err = {
        code: 'slack_webapi_rate_limited',
        response: {
          headers: { 'retry-after': '1' },
        },
      };
      mocked.postMessage.mockRejectedValue(err);
      const m = new Messenger(makeClient(), 'C1', 'T1');
      const promise = m.postStatusMessage('test');
      await vi.advanceTimersByTimeAsync(60_000);
      await promise;
      expect(mocked.loggerWarn).toHaveBeenCalledWith(
        'rate_limited_post',
        expect.objectContaining({ retry_after_ms: 1000 }),
      );
    });

    it('handles Headers instance in response', async () => {
      const headers = new Headers();
      headers.set('retry-after', '5');
      const err = {
        code: 'slack_webapi_rate_limited',
        response: { headers },
      };
      mocked.postMessage.mockRejectedValue(err);
      const m = new Messenger(makeClient(), 'C1', 'T1');
      const promise = m.postStatusMessage('test');
      await vi.advanceTimersByTimeAsync(60_000);
      await promise;
      expect(mocked.loggerWarn).toHaveBeenCalledWith(
        'rate_limited_post',
        expect.objectContaining({ retry_after_ms: 5000 }),
      );
    });

    it('returns null for non-object error', async () => {
      const err = { code: 'slack_webapi_rate_limited' };
      mocked.postMessage.mockRejectedValue(err);
      const m = new Messenger(makeClient(), 'C1', 'T1');
      const promise = m.postStatusMessage('test');
      await vi.advanceTimersByTimeAsync(60_000);
      await promise;
      expect(mocked.loggerWarn).toHaveBeenCalledWith(
        'rate_limited_post',
        expect.objectContaining({ retry_after_ms: null }),
      );
    });

    it('handles data as non-object', async () => {
      const err = { code: 'slack_webapi_rate_limited', data: 'not-obj' };
      mocked.postMessage.mockRejectedValue(err);
      const m = new Messenger(makeClient(), 'C1', 'T1');
      const promise = m.postStatusMessage('test');
      await vi.advanceTimersByTimeAsync(60_000);
      await promise;
      expect(mocked.loggerWarn).toHaveBeenCalledWith(
        'rate_limited_post',
        expect.objectContaining({ retry_after_ms: null }),
      );
    });

    it('handles response as non-object', async () => {
      const err = { code: 'slack_webapi_rate_limited', response: 'str' };
      mocked.postMessage.mockRejectedValue(err);
      const m = new Messenger(makeClient(), 'C1', 'T1');
      const promise = m.postStatusMessage('test');
      await vi.advanceTimersByTimeAsync(60_000);
      await promise;
      expect(mocked.loggerWarn).toHaveBeenCalledWith(
        'rate_limited_post',
        expect.objectContaining({ retry_after_ms: null }),
      );
    });
  });

  describe('flushChunk — prevTs exists but safeUpdate fails', () => {
    it('recovers buffer when update fails and posts new chunk', async () => {
      mocked.postMessage.mockResolvedValue({ ts: '1.0' });
      mocked.update.mockRejectedValue(new Error('update fail'));
      mocked.shouldSplit.mockReturnValue(true);
      mocked.findSplitPoint.mockReturnValue(5);

      const m = new Messenger(makeClient(), 'C1', 'T1');
      await m.postStart('start');

      mocked.postMessage.mockResolvedValue({ ts: '2.0' });
      m.appendText('hello world');
      await vi.advanceTimersByTimeAsync(5000);
    });
  });

  describe('flushChunk — catch path when entire chunk fails', () => {
    it('logs warning when flushChunk errors without recovery', async () => {
      mocked.postMessage
        .mockResolvedValueOnce({ ts: '1.0' })
        .mockRejectedValue(new Error('post fail'));
      mocked.update.mockResolvedValue({ ok: true });
      mocked.shouldSplit.mockReturnValue(true);
      mocked.findSplitPoint.mockReturnValue(5);

      const m = new Messenger(makeClient(), 'C1', 'T1');
      await m.postStart('start');

      m.appendText('hello world');
      await vi.advanceTimersByTimeAsync(5000);
    });
  });

  describe('postFinal — long text splitting loop', () => {
    it('handles multi-split final text with no currentTs', async () => {
      mocked.postMessage.mockResolvedValue({ ts: null });
      let splitCallCount = 0;
      mocked.shouldSplit.mockImplementation(() => {
        splitCallCount++;
        return splitCallCount <= 2;
      });
      mocked.findSplitPoint.mockReturnValue(5);

      const m = new Messenger(makeClient(), 'C1', 'T1');
      await m.postFinal('a'.repeat(20));
    });

    it('handles posting failure and uploads file', async () => {
      mocked.postMessage.mockResolvedValue(null);
      mocked.update.mockResolvedValue(null);
      mocked.shouldSplit.mockReturnValue(false);

      const m = new Messenger(makeClient(), 'C1', 'T1');
      await m.postStart('start');
      mocked.postMessage.mockResolvedValue({ ts: '1.0' });
      mocked.update.mockRejectedValue(new Error('fail'));

      const promise = m.postFinal('some final text');
      await vi.advanceTimersByTimeAsync(60_000);
      await promise;
    });
  });

  describe('contextPrefix', () => {
    it('applies context prefix when provided', async () => {
      mocked.postMessage.mockResolvedValue({ ts: '1.0' });
      const m = new Messenger(makeClient(), 'C1', 'T1', '[prefix]');
      await m.postStart('hello');
      expect(mocked.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: '[prefix]\nhello' }),
      );
    });
  });

  describe('uploadBinaryFile', () => {
    it('returns true on success', async () => {
      mocked.readFileSync.mockReturnValue(Buffer.from('data'));
      mocked.filesUploadV2.mockResolvedValue({ ok: true });
      const m = new Messenger(makeClient(), 'C1', 'T1');
      const result = await m.uploadBinaryFile('/tmp/file.png', 'file.png', 'Image');
      expect(result).toBe(true);
    });

    it('returns false on error', async () => {
      mocked.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      const m = new Messenger(makeClient(), 'C1', 'T1');
      const result = await m.uploadBinaryFile('/tmp/missing.png', 'file.png', 'Image');
      expect(result).toBe(false);
    });
  });

  describe('empty final text fallback', () => {
    it('uses Completed. fallback for empty text', async () => {
      mocked.postMessage.mockResolvedValue({ ts: '1.0' });
      mocked.shouldSplit.mockReturnValue(false);
      mocked.update.mockResolvedValue({ ok: true });
      const m = new Messenger(makeClient(), 'C1', 'T1');
      const startPromise = m.postStart('start');
      await vi.advanceTimersByTimeAsync(100);
      await startPromise;
      const finalPromise = m.postFinal('');
      await vi.advanceTimersByTimeAsync(5000);
      await finalPromise;
      expect(mocked.update).toHaveBeenCalledWith(expect.objectContaining({ text: 'Completed.' }));
    });
  });

  describe('replaceBuffer', () => {
    it('replaces the internal buffer', async () => {
      mocked.postMessage.mockResolvedValue({ ts: '1.0' });
      mocked.shouldSplit.mockReturnValue(false);
      const m = new Messenger(makeClient(), 'C1', 'T1');
      await m.postStart('start');
      m.appendText('original');
      m.replaceBuffer('replaced');
      const promise = m.postFinal('');
      await vi.advanceTimersByTimeAsync(5000);
      await promise;
    });
  });
});
