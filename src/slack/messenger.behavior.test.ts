import { describe, expect, it, vi } from 'vitest';
import { splitTextToChunks } from '../shared/text-utils.js';
import { Messenger } from './messenger.js';

describe('Messenger behavior', () => {
  it('falls back to non-empty final text when result is empty', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '123.456' });
    const update = vi.fn().mockResolvedValue({});
    const filesUploadV2 = vi.fn().mockResolvedValue({});

    const client = {
      chat: {
        postMessage,
        update,
      },
      filesUploadV2,
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    await messenger.postStart('Running `gemini`...');
    await messenger.postFinal('');

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith({
      channel: 'C123',
      ts: '123.456',
      text: 'Completed.',
    });
  });

  it('adds context prefix to post/update messages when configured', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '123.456' });
    const update = vi.fn().mockResolvedValue({});
    const filesUploadV2 = vi.fn().mockResolvedValue({});

    const client = {
      chat: {
        postMessage,
        update,
      },
      filesUploadV2,
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
      '[app:gemini/session-id:abcd1234]',
    );

    await messenger.postStart('Running `gemini`...');
    await messenger.postFinal('done');

    expect(postMessage).toHaveBeenLastCalledWith({
      channel: 'C123',
      thread_ts: '1700000000.000001',
      text: '[app:gemini/session-id:abcd1234]\nRunning `gemini`...',
    });
    expect(update).toHaveBeenLastCalledWith({
      channel: 'C123',
      ts: '123.456',
      text: '[app:gemini/session-id:abcd1234]\ndone',
    });
  });

  it('uploadBinaryFile reads file and calls filesUploadV2 with Buffer', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '123.456' });
    const update = vi.fn().mockResolvedValue({});
    const filesUploadV2 = vi.fn().mockResolvedValue({});

    const client = {
      chat: { postMessage, update },
      filesUploadV2,
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    // Create a temp file to upload
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messenger-upload-test-'));
    const filePath = path.join(tmpDir, 'result.svg');
    fs.writeFileSync(filePath, '<svg></svg>');

    const result = await messenger.uploadBinaryFile(filePath, 'result.svg', 'result.svg');

    expect(result).toBe(true);
    expect(filesUploadV2).toHaveBeenCalledTimes(1);
    expect(filesUploadV2).toHaveBeenCalledWith({
      channel_id: 'C123',
      thread_ts: '1700000000.000001',
      file: expect.any(Buffer),
      filename: 'result.svg',
      title: 'result.svg',
    });

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('uploadBinaryFile returns false on error without throwing', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '123.456' });
    const update = vi.fn().mockResolvedValue({});
    const filesUploadV2 = vi.fn().mockRejectedValue(new Error('upload failed'));

    const client = {
      chat: { postMessage, update },
      filesUploadV2,
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    // Create a temp file to upload
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messenger-upload-test-'));
    const filePath = path.join(tmpDir, 'bad.pdf');
    fs.writeFileSync(filePath, 'dummy content');

    const result = await messenger.uploadBinaryFile(filePath, 'bad.pdf', 'bad.pdf');
    expect(result).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('uploadBinaryFile returns false when file does not exist', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '123.456' });
    const update = vi.fn().mockResolvedValue({});
    const filesUploadV2 = vi.fn().mockResolvedValue({});

    const client = {
      chat: { postMessage, update },
      filesUploadV2,
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    const result = await messenger.uploadBinaryFile(
      '/nonexistent/file.svg',
      'file.svg',
      'file.svg',
    );
    expect(result).toBe(false);
    expect(filesUploadV2).not.toHaveBeenCalled();
  });

  it('postFinal waits for pending flushChunk before updating', async () => {
    let msgCounter = 0;
    const postMessage = vi.fn().mockImplementation(() => {
      msgCounter++;
      return Promise.resolve({ ts: `msg_${msgCounter}` });
    });
    const updateCalls: Array<{ ts: string; text: string }> = [];
    const update = vi.fn().mockImplementation((args: { ts: string; text: string }) => {
      updateCalls.push({ ts: args.ts, text: args.text });
      return Promise.resolve({});
    });

    const client = {
      chat: { postMessage, update },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    await messenger.postStart('start');
    // msg_1 is the start message

    // Append enough text to trigger flushChunk (> 4000 chars)
    messenger.appendText('a'.repeat(4500));

    // Immediately call postFinal — should wait for flushChunk to complete
    await messenger.postFinal('final');

    // flushChunk should have: updated msg_1 with chunk, posted "..." as msg_2
    // postFinal should have: updated msg_2 (the "..." message) with remaining + "final"
    const lastUpdate = updateCalls.at(-1);
    expect(lastUpdate?.ts).toBe('msg_2');
    expect(lastUpdate?.text).toContain('final');

    // msg_1 should have been updated with the chunk content (not "Completed.")
    const firstUpdate = updateCalls.find((c) => c.ts === 'msg_1');
    expect(firstUpdate).toBeDefined();
    expect(firstUpdate?.text).not.toBe('Completed.');
    expect(firstUpdate?.text.length).toBeGreaterThan(100);
  });

  it('retries on transient error then succeeds', async () => {
    let callCount = 0;
    const postMessage = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error('network error'));
      }
      return Promise.resolve({ ts: '123.456' });
    });
    const update = vi.fn().mockResolvedValue({});

    const client = {
      chat: { postMessage, update },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    await messenger.postStart('hello');
    // First call fails, retries, second succeeds
    expect(postMessage).toHaveBeenCalledTimes(2);
  });

  it('retries on rate limit with backoff before giving up', async () => {
    vi.useFakeTimers();
    try {
      const rateLimitError = Object.assign(new Error('rate_limited'), {
        code: 'slack_webapi_rate_limited',
      });
      const postMessage = vi.fn().mockRejectedValue(rateLimitError);
      const update = vi.fn().mockResolvedValue({});

      const client = {
        chat: { postMessage, update },
        filesUploadV2: vi.fn().mockResolvedValue({}),
      };

      const messenger = new Messenger(
        client as unknown as ConstructorParameters<typeof Messenger>[0],
        'C123',
        '1700000000.000001',
      );

      const pending = messenger.postStart('hello');
      await vi.runAllTimersAsync();
      await pending;
      // Rate limit should be retried up to MAX_RETRIES (3 attempts total)
      expect(postMessage).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors retryAfter hints on rate limit errors', async () => {
    vi.useFakeTimers();
    try {
      const rateLimitError = Object.assign(new Error('rate_limited'), {
        code: 'slack_webapi_rate_limited',
        retryAfter: 2,
      });
      const postMessage = vi
        .fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({ ts: '123.456' });
      const update = vi.fn().mockResolvedValue({});

      const client = {
        chat: { postMessage, update },
        filesUploadV2: vi.fn().mockResolvedValue({}),
      };

      const messenger = new Messenger(
        client as unknown as ConstructorParameters<typeof Messenger>[0],
        'C123',
        '1700000000.000001',
      );

      const pending = messenger.postStart('hello');
      await vi.advanceTimersByTimeAsync(1_999);
      expect(postMessage).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(postMessage).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('postStatusMessage returns ts from the posted message', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '999.111' });
    const update = vi.fn().mockResolvedValue({});

    const client = {
      chat: { postMessage, update },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    const ts = await messenger.postStatusMessage('Processing...');
    expect(ts).toBe('999.111');
    expect(postMessage).toHaveBeenCalledWith({
      channel: 'C123',
      thread_ts: '1700000000.000001',
      text: 'Processing...',
    });
  });

  it('uploadFile calls filesUploadV2 with string content', async () => {
    const filesUploadV2 = vi.fn().mockResolvedValue({});

    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
      filesUploadV2,
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    await messenger.uploadFile('file content', 'output.txt', 'Output');
    expect(filesUploadV2).toHaveBeenCalledWith({
      channel_id: 'C123',
      thread_ts: '1700000000.000001',
      content: 'file content',
      filename: 'output.txt',
      title: 'Output',
    });
  });

  it('uploadFile catches error without throwing', async () => {
    const filesUploadV2 = vi.fn().mockRejectedValue(new Error('upload error'));

    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
      filesUploadV2,
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    // Should not throw
    await messenger.uploadFile('content', 'f.txt', 'F');
  });

  it('replaceBuffer changes text used by postFinal', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '123.456' });
    const update = vi.fn().mockResolvedValue({});

    const client = {
      chat: { postMessage, update },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    await messenger.postStart('start');
    messenger.appendText('original [MCP_TOOL_REQUEST] data');
    messenger.replaceBuffer('original  data');
    await messenger.postFinal(' end');

    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'original  data end' }),
    );
  });

  it('serializes concurrent appendText calls before postFinal', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '123.456' });
    const update = vi.fn().mockResolvedValue({});

    const client = {
      chat: { postMessage, update },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    await messenger.postStart('start');
    messenger.appendText('first');
    messenger.appendText('second');
    await messenger.postFinal('done');

    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'firstseconddone' }));
  });

  it('postFinal without postStart posts a new message', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '100.200' });
    const update = vi.fn().mockResolvedValue({});

    const client = {
      chat: { postMessage, update },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    // No postStart — currentTs is null
    await messenger.postFinal('result');

    // Should post a new message instead of updating
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'result' }));
    expect(update).not.toHaveBeenCalled();
  });

  it('handles rejected flushChunk in pending flush chain', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '123.456' });
    const update = vi.fn().mockResolvedValue({});

    const client = {
      chat: { postMessage, update },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    await messenger.postStart('start');

    (messenger as unknown as { flushChunk: (text: string) => Promise<void> }).flushChunk = vi
      .fn()
      .mockRejectedValue(new Error('flush failed'));

    messenger.appendText('x'.repeat(4500));
    await messenger.postFinal('done');

    expect(update).toHaveBeenCalled();
  });

  it('swallows flushUpdate errors when scheduled timer fires', async () => {
    vi.useFakeTimers();
    try {
      const postMessage = vi.fn().mockResolvedValue({ ts: '123.456' });
      const update = vi.fn().mockResolvedValue({});

      const client = {
        chat: { postMessage, update },
        filesUploadV2: vi.fn().mockResolvedValue({}),
      };

      const messenger = new Messenger(
        client as unknown as ConstructorParameters<typeof Messenger>[0],
        'C123',
        '1700000000.000001',
      );

      (messenger as unknown as { safeUpdate: (text: string) => Promise<void> }).safeUpdate = vi
        .fn()
        .mockRejectedValue(new Error('update failed'));

      await messenger.postStart('start');
      messenger.appendText('queued');
      await vi.runAllTimersAsync();
      await Promise.resolve();

      expect(
        (messenger as unknown as { safeUpdate: ReturnType<typeof vi.fn> }).safeUpdate,
      ).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('splits multibyte content by byte length and finalizes remaining text', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '123.456' });
    const update = vi.fn().mockResolvedValue({});

    const client = {
      chat: { postMessage, update },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    await messenger.postStart('start');
    messenger.appendText('☃'.repeat(4500));
    await messenger.postFinal(' final');

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(update.mock.calls.length).toBeGreaterThan(0);
  });

  it('shrinks split point when UTF-8 byte size exceeds byte limit', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '123.456' });
    const update = vi.fn().mockResolvedValue({});
    const client = {
      chat: { postMessage, update },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    };
    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    await messenger.postStart('start');
    messenger.appendText('😀'.repeat(4500));
    await messenger.postFinal('done');

    expect(update).toHaveBeenCalled();
  });

  it('updates first split chunk when current message ts exists', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '123.456' });
    const update = vi.fn().mockResolvedValue({});
    const client = {
      chat: { postMessage, update },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    };
    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    await messenger.postStart('start');
    await messenger.postFinal('z'.repeat(5000));

    expect(update).toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalled();
  });

  it('handles flushChunk update failure without throwing', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '123.456' });
    const update = vi.fn().mockRejectedValue(new Error('cannot update'));

    const client = {
      chat: { postMessage, update },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    await messenger.postStart('start');
    messenger.appendText('b'.repeat(4500));
    await messenger.postFinal('done');

    expect(update).toHaveBeenCalled();
  });

  it('uploads full output when final update fails without splitting', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '123.456' });
    const update = vi.fn().mockResolvedValue({});
    const client = {
      chat: { postMessage, update },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    await messenger.postStart('start');
    const safeUpdate = vi.fn().mockResolvedValue(false);
    (messenger as unknown as { safeUpdate: (text: string) => Promise<boolean> }).safeUpdate =
      safeUpdate;
    const uploadSpy = vi.spyOn(messenger, 'uploadFile').mockResolvedValue(undefined);

    await messenger.postFinal('done');

    expect(safeUpdate).toHaveBeenCalledWith('done');
    expect(uploadSpy).toHaveBeenCalledWith('done', 'output.txt', 'Full output');
  });

  it('flags split posting failures when safePost returns false', async () => {
    const client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: '123.456' }),
        update: vi.fn().mockResolvedValue({}),
      },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    };
    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    const longText = 'x'.repeat(5000);
    const safePost = vi.fn().mockResolvedValue(false);
    (messenger as unknown as { safePost: (text: string) => Promise<false> }).safePost = safePost;
    const uploadSpy = vi.spyOn(messenger, 'uploadFile').mockResolvedValue(undefined);

    await messenger.postFinal(longText);

    expect(safePost).toHaveBeenCalled();
    expect(uploadSpy).toHaveBeenCalledWith(longText, 'output.txt', 'Full output');
  });

  it('covers postFinal split loop branches with manual safePost state updates', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: 'posted' });
    const update = vi.fn().mockResolvedValue({});

    const client = {
      chat: { postMessage, update },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    let postCount = 0;
    (messenger as unknown as { safePost: (text: string) => Promise<{ ts?: string }> }).safePost = vi
      .fn()
      .mockImplementation(async () => {
        postCount++;
        if (postCount === 1) {
          (messenger as unknown as { currentTs: string | null }).currentTs = 'forced-ts';
        }
        return { ts: `post-${postCount}` };
      });
    (messenger as unknown as { safeUpdate: (text: string) => Promise<void> }).safeUpdate = vi
      .fn()
      .mockResolvedValue(undefined);

    await messenger.postFinal('x'.repeat(5000));

    expect(
      (messenger as unknown as { safePost: ReturnType<typeof vi.fn> }).safePost,
    ).toHaveBeenCalled();
    expect(
      (messenger as unknown as { safeUpdate: ReturnType<typeof vi.fn> }).safeUpdate,
    ).toHaveBeenCalled();
  });

  it('returns null after max retries when posting repeatedly fails', async () => {
    vi.useFakeTimers();
    try {
      const postMessage = vi.fn().mockRejectedValue(new Error('network down'));
      const update = vi.fn().mockResolvedValue({});

      const client = {
        chat: { postMessage, update },
        filesUploadV2: vi.fn().mockResolvedValue({}),
      };

      const messenger = new Messenger(
        client as unknown as ConstructorParameters<typeof Messenger>[0],
        'C123',
        '1700000000.000001',
      );

      const pending = messenger.postStatusMessage('status');
      await vi.runAllTimersAsync();
      const ts = await pending;
      expect(ts).toBeNull();
      expect(postMessage).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles flushChunk internal exception path', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '123.456' });
    const update = vi.fn().mockResolvedValue({});
    const client = {
      chat: { postMessage, update },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    await messenger.postStart('start');
    (messenger as unknown as { safeUpdate: (text: string) => Promise<void> }).safeUpdate = vi
      .fn()
      .mockRejectedValue(new Error('forced fail'));

    await (messenger as unknown as { flushChunk: (text: string) => Promise<void> }).flushChunk(
      'chunk',
    );
    expect(postMessage).toHaveBeenCalled();
  });

  it('splits when byte limit is exceeded even if char length is below MAX_CHARS', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '123.456' });
    const update = vi.fn().mockResolvedValue({});
    const client = {
      chat: { postMessage, update },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    const byteLengthSpy = vi.spyOn(Buffer, 'byteLength').mockReturnValue(13_000);
    try {
      await messenger.postStart('start');
      messenger.appendText('short-text');
      await messenger.postFinal('done');

      expect(update).toHaveBeenCalled();
      expect(postMessage).toHaveBeenCalled();
    } finally {
      byteLengthSpy.mockRestore();
    }
  });

  it('prefers newline split points in live messenger splitting', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '123.456' });
    const update = vi.fn().mockResolvedValue({});
    const client = {
      chat: { postMessage, update },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    };

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    await messenger.postStart('start');
    messenger.appendText(`${'a'.repeat(2500)}\n${'b'.repeat(2000)}`);
    await messenger.postFinal('done');

    const firstUpdateText = String(update.mock.calls[0]?.[0]?.text ?? '');
    expect(firstUpdateText.endsWith('\n')).toBe(true);
  });

  it('does not schedule multiple update timers while one is already pending', async () => {
    vi.useFakeTimers();
    let setTimeoutSpy: { mockRestore(): void } | null = null;
    try {
      setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      const client = {
        chat: {
          postMessage: vi.fn().mockResolvedValue({ ts: '1.1' }),
          update: vi.fn().mockResolvedValue({}),
        },
        filesUploadV2: vi.fn().mockResolvedValue({}),
      };
      const messenger = new Messenger(
        client as unknown as ConstructorParameters<typeof Messenger>[0],
        'C123',
        '1700000000.000001',
      );

      messenger.appendText('first');
      messenger.appendText('second');
      await Promise.resolve();

      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    } finally {
      setTimeoutSpy?.mockRestore();
      vi.useRealTimers();
    }
  });

  it('returns early from flushUpdate when currentTs or buffer is missing', () => {
    const safeUpdate = vi.fn().mockResolvedValue(undefined);
    const messenger = new Messenger(
      {
        chat: {
          postMessage: vi.fn().mockResolvedValue({ ts: '1.1' }),
          update: vi.fn().mockResolvedValue({}),
        },
        filesUploadV2: vi.fn().mockResolvedValue({}),
      } as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );
    (
      messenger as unknown as {
        safeUpdate: (text: string) => Promise<void>;
        flushUpdate: () => void;
        currentTs: string | null;
        buffer: string;
      }
    ).safeUpdate = safeUpdate;

    (messenger as unknown as { flushUpdate: () => void }).flushUpdate();
    (messenger as unknown as { currentTs: string | null; flushUpdate: () => void }).currentTs =
      '1.1';
    (messenger as unknown as { buffer: string; flushUpdate: () => void }).buffer = '';
    (messenger as unknown as { flushUpdate: () => void }).flushUpdate();

    expect(safeUpdate).not.toHaveBeenCalled();
  });

  it('uses Completed. fallback for empty post/update payloads and skips update without ts', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ts: '111.222' });
    const update = vi.fn().mockResolvedValue({});
    const messenger = new Messenger(
      {
        chat: { postMessage, update },
        filesUploadV2: vi.fn().mockResolvedValue({}),
      } as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    const ts = await messenger.postStatusMessage('   ');
    expect(ts).toBe('111.222');
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Completed.',
      }),
    );

    (messenger as unknown as { currentTs: string | null }).currentTs = null;
    await (messenger as unknown as { safeUpdate: (text: string) => Promise<void> }).safeUpdate(
      '   ',
    );
    expect(update).not.toHaveBeenCalled();

    (messenger as unknown as { currentTs: string | null }).currentTs = '111.222';
    await (messenger as unknown as { safeUpdate: (text: string) => Promise<boolean> }).safeUpdate(
      '   ',
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Completed.',
      }),
    );
  });

  it('postFinal uploads file as fallback when all posting fails', async () => {
    vi.useFakeTimers();
    try {
      const postMessage = vi.fn().mockRejectedValue(new Error('network down'));
      const update = vi.fn().mockRejectedValue(new Error('network down'));
      const filesUploadV2 = vi.fn().mockResolvedValue({});

      const client = {
        chat: { postMessage, update },
        filesUploadV2,
      };

      const messenger = new Messenger(
        client as unknown as ConstructorParameters<typeof Messenger>[0],
        'C123',
        '1700000000.000001',
      );

      // No postStart succeeds — currentTs stays null
      const startPending = messenger.postStart('start');
      await vi.runAllTimersAsync();
      await startPending;

      const pending = messenger.postFinal('important output');
      await vi.runAllTimersAsync();
      await pending;

      // safePost failed, so file upload fallback should be triggered
      expect(filesUploadV2).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'important output',
          filename: 'output.txt',
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushChunk pushes text back to buffer when safeUpdate fails', async () => {
    vi.useFakeTimers();
    try {
      const postMessage = vi.fn().mockResolvedValue({ ts: '123.456' });
      const update = vi.fn().mockRejectedValue(new Error('update failed'));

      const client = {
        chat: { postMessage, update },
        filesUploadV2: vi.fn().mockResolvedValue({}),
      };

      const messenger = new Messenger(
        client as unknown as ConstructorParameters<typeof Messenger>[0],
        'C123',
        '1700000000.000001',
      );

      await messenger.postStart('start');

      // Append text that triggers flushChunk (> 4000 chars)
      messenger.appendText('a'.repeat(4500));
      const pending = messenger.postFinal('done');
      await vi.runAllTimersAsync();
      await pending;

      // The failed chunk should have been recovered — postMessage called for new messages
      // postStart (1) + flushChunk safePost '...' (1) + postFinal posting attempts
      expect(postMessage.mock.calls.length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears stale currentTs when safeUpdate throws during flushChunk', async () => {
    const postMessage = vi
      .fn()
      .mockResolvedValueOnce({ ts: 'start-ts' })
      .mockResolvedValueOnce({ ts: 'next-ts' });
    const update = vi.fn().mockRejectedValue(new Error('update failed'));

    const messenger = new Messenger(
      {
        chat: { postMessage, update },
        filesUploadV2: vi.fn().mockResolvedValue({}),
      } as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    await messenger.postStart('start');
    await (messenger as unknown as { flushChunk: (text: string) => Promise<void> }).flushChunk(
      'chunk',
    );

    expect((messenger as unknown as { currentTs: string | null }).currentTs).toBe('next-ts');
  });
});

describe('Messenger markdown blocks (Phase 4)', () => {
  function createMarkdownClient() {
    return {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: '123.456' }),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
      filesUploadV2: vi.fn().mockResolvedValue({}),
    };
  }

  it('postFinal with useMarkdownBlocks posts blocks instead of plain text', async () => {
    const client = createMarkdownClient();
    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
      null,
      { useMarkdownBlocks: true },
    );

    await messenger.postStart('Running...');
    await messenger.postFinal('## Hello\nWorld');

    // Should have called update (transition from streaming to blocks)
    const updateCalls = client.chat.update.mock.calls;
    const lastUpdate = updateCalls.at(-1)?.[0];
    expect(lastUpdate).toBeDefined();
    expect(lastUpdate.blocks).toBeDefined();
    expect(lastUpdate.blocks.some((b: { type: string }) => b.type === 'markdown')).toBe(true);
    expect(lastUpdate.text).toBeTruthy();
  });

  it('postFinal without useMarkdownBlocks uses plain text (backward compat)', async () => {
    const client = createMarkdownClient();
    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
    );

    await messenger.postStart('Running...');
    await messenger.postFinal('plain text result');

    const updateCalls = client.chat.update.mock.calls;
    const lastUpdate = updateCalls.at(-1)?.[0];
    expect(lastUpdate).toBeDefined();
    expect(lastUpdate.blocks).toBeUndefined();
    expect(lastUpdate.text).toBe('plain text result');
  });

  it('falls back to safePostWithBlocks when update fails and deletes stale message', async () => {
    const client = createMarkdownClient();
    client.chat.update = vi.fn().mockRejectedValue(new Error('update failed'));
    client.chat.postMessage = vi
      .fn()
      .mockResolvedValueOnce({ ts: 'start-ts' }) // postStart
      .mockResolvedValueOnce({ ts: 'blocks-ts' }); // postWithBlocks fallback

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
      null,
      { useMarkdownBlocks: true },
    );

    await messenger.postStart('Running...');
    await messenger.postFinal('result text');

    // postMessage should have been called for the blocks fallback
    const postCalls = client.chat.postMessage.mock.calls;
    const blockPost = postCalls.find((call: unknown[]) => {
      const arg = call[0] as { blocks?: unknown };
      return arg.blocks != null;
    });
    expect(blockPost).toBeDefined();

    // Stale streaming message should have been deleted
    expect(client.chat.delete).toHaveBeenCalledWith({
      channel: 'C123',
      ts: 'start-ts',
    });
  });

  it('does not throw when deleting stale message fails during block fallback', async () => {
    const client = createMarkdownClient();
    client.chat.update = vi.fn().mockRejectedValue(new Error('update failed'));
    client.chat.delete = vi.fn().mockRejectedValue(new Error('delete failed'));
    client.chat.postMessage = vi
      .fn()
      .mockResolvedValueOnce({ ts: 'start-ts' })
      .mockResolvedValueOnce({ ts: 'blocks-ts' });

    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
      null,
      { useMarkdownBlocks: true },
    );

    await messenger.postStart('Running...');
    // Should not throw even when delete fails
    await messenger.postFinal('result text');

    const postCalls = client.chat.postMessage.mock.calls;
    const blockPost = postCalls.find((call: unknown[]) => {
      const arg = call[0] as { blocks?: unknown };
      return arg.blocks != null;
    });
    expect(blockPost).toBeDefined();
    expect(client.chat.delete).toHaveBeenCalled();
  });

  it('postFinal with markdown blocks without postStart posts new message', async () => {
    const client = createMarkdownClient();
    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
      null,
      { useMarkdownBlocks: true },
    );

    // No postStart — currentTs is null
    await messenger.postFinal('## Result');

    const postCalls = client.chat.postMessage.mock.calls;
    const blockPost = postCalls.find((call: unknown[]) => {
      const arg = call[0] as { blocks?: unknown };
      return arg.blocks != null;
    });
    expect(blockPost).toBeDefined();
    expect(client.chat.update).not.toHaveBeenCalled();
  });

  it('uploads .md file when output exceeds 40K threshold', async () => {
    const client = createMarkdownClient();
    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
      null,
      { useMarkdownBlocks: true },
    );

    const largeOutput = 'x'.repeat(41_000);
    await messenger.postFinal(largeOutput);

    expect(client.filesUploadV2).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'output.md',
        title: 'Full output',
      }),
    );
  });

  it('uploads .md file as fallback when all block posting fails', async () => {
    vi.useFakeTimers();
    try {
      const client = createMarkdownClient();
      client.chat.postMessage = vi.fn().mockRejectedValue(new Error('network down'));
      client.chat.update = vi.fn().mockRejectedValue(new Error('network down'));

      const messenger = new Messenger(
        client as unknown as ConstructorParameters<typeof Messenger>[0],
        'C123',
        '1700000000.000001',
        null,
        { useMarkdownBlocks: true },
      );

      const pending = messenger.postFinal('important output');
      await vi.runAllTimersAsync();
      await pending;

      expect(client.filesUploadV2).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: 'output.md',
          content: 'important output',
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies context prefix to block text fallback', async () => {
    const client = createMarkdownClient();
    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
      '[app:claude/sid:test]',
      { useMarkdownBlocks: true },
    );

    await messenger.postFinal('result');

    const postCall = client.chat.postMessage.mock.calls[0]?.[0];
    expect(postCall?.text).toContain('[app:claude/sid:test]');
  });

  it('uses "Completed." for empty body with markdown blocks', async () => {
    const client = createMarkdownClient();
    const messenger = new Messenger(
      client as unknown as ConstructorParameters<typeof Messenger>[0],
      'C123',
      '1700000000.000001',
      null,
      { useMarkdownBlocks: true },
    );

    await messenger.postFinal('');

    const postCall = client.chat.postMessage.mock.calls[0]?.[0];
    expect(postCall?.blocks).toBeDefined();
    const mdBlock = postCall?.blocks?.find((b: { type: string }) => b.type === 'markdown');
    expect(mdBlock).toBeDefined();
    expect((mdBlock as { text: string }).text).toBe('Completed.');
  });
});

describe('splitTextToChunks', () => {
  it('returns single chunk for short text', () => {
    const chunks = splitTextToChunks('hello');
    expect(chunks).toEqual(['hello']);
  });

  it('splits long text into multiple chunks', () => {
    const text = 'a'.repeat(10000);
    const chunks = splitTextToChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
  });

  it('preserves newline boundaries when splitting', () => {
    const text = `${'a'.repeat(2500)}\n${'b'.repeat(2000)}\n${'c'.repeat(2000)}`;
    const chunks = splitTextToChunks(text);
    // 6503 chars total → splits at newlines respecting 4000-char limit
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]?.endsWith('\n')).toBe(true);
    expect(chunks.join('')).toBe(text);
  });

  it('returns empty array for empty string', () => {
    // Empty string is falsy, so the while loop does not execute
    const chunks = splitTextToChunks('');
    expect(chunks).toEqual([]);
  });

  it('uses byte-aware binary search for multibyte strings', () => {
    const text = '😀'.repeat(4500);
    const chunks = splitTextToChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(Buffer.byteLength(chunks[0] ?? '', 'utf-8')).toBeLessThanOrEqual(12_288);
    expect(chunks.join('')).toBe(text);
  });

  it('covers binary-search branch when byte limit check shrinks splitAt', () => {
    const originalByteLength = Buffer.byteLength;
    const byteLengthSpy = vi.spyOn(Buffer, 'byteLength').mockImplementation((value, encoding) => {
      if (typeof value === 'string') return value.length * 4;
      return originalByteLength(value, encoding);
    });
    try {
      const text = 'a'.repeat(5000);
      const chunks = splitTextToChunks(text);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join('')).toBe(text);
    } finally {
      byteLengthSpy.mockRestore();
    }
  });
});
