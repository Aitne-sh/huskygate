import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../utils/logger.js';

const mocked = vi.hoisted(() => ({
  handleMcpAuthBypassApproval: vi.fn().mockResolvedValue(false),
  handleToolApproval: vi.fn().mockResolvedValue(false),
  isAuthorized: vi.fn().mockReturnValue(true),
  parseApprovalDecision: vi.fn().mockReturnValue(null),
  parseCommand: vi.fn().mockReturnValue(null),
  dispatchCommand: vi.fn().mockResolvedValue(undefined),
  postMessageWithContext: vi.fn().mockResolvedValue(undefined),
  logSlackCommandError: vi.fn(),
  scheduleInactivityAutoExit: vi.fn(),
  extractSlackFiles: vi.fn().mockReturnValue([]),
  isAssistantThread: vi.fn().mockReturnValue(false),
  handleAssistantMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./approval-handler.js', () => ({
  handleMcpAuthBypassApproval: mocked.handleMcpAuthBypassApproval,
  handleToolApproval: mocked.handleToolApproval,
}));

vi.mock('./auth.js', () => ({
  isAuthorized: mocked.isAuthorized,
}));

vi.mock('./approval.js', () => ({
  parseApprovalDecision: mocked.parseApprovalDecision,
}));

vi.mock('./parser.js', () => ({
  parseCommand: mocked.parseCommand,
}));

vi.mock('./commands/dispatch.js', () => ({
  dispatchCommand: mocked.dispatchCommand,
}));

vi.mock('../shared/file-attachment.js', () => ({
  extractSlackFiles: mocked.extractSlackFiles,
}));

vi.mock('./assistant.js', () => ({
  isAssistantThread: mocked.isAssistantThread,
  handleAssistantMessage: mocked.handleAssistantMessage,
}));

vi.mock('./app-helpers.js', () => ({
  logSlackCommandError: mocked.logSlackCommandError,
  postMessageWithContext: mocked.postMessageWithContext,
  scheduleInactivityAutoExit: mocked.scheduleInactivityAutoExit,
  toThreadKey: (channelId: string, threadTs: string) => `${channelId}:${threadTs}`,
}));

import { evictUserRateLimiter, registerMessageHandler } from './message-handler.js';

type MessageHandler = Parameters<ReturnType<typeof vi.fn>>[0];

function createMessageEventHandler(overrides?: {
  isDuplicate?: boolean;
  event?: Record<string, unknown>;
  body?: Record<string, unknown>;
}) {
  let handler: MessageHandler | null = null;
  const app = {
    event: vi.fn((_name: string, cb: MessageHandler) => {
      handler = cb;
    }),
  };

  const ctx = {
    dedupeStore: {
      isDuplicateAndRegister: vi.fn().mockReturnValue(overrides?.isDuplicate ?? false),
    },
    sessionManager: {
      touchThreadActivity: vi.fn(),
    },
    config: {},
  };

  registerMessageHandler(ctx as never, app as never);
  if (!handler) throw new Error('handler not registered');

  const event = {
    channel: 'C1',
    channel_type: 'im',
    ts: '1.1',
    user: 'U1',
    text: 'hello',
    ...(overrides?.event ?? {}),
  };
  const body = {
    event_id: 'evt-1',
    team_id: 'T1',
    ...(overrides?.body ?? {}),
  };

  return { handler, ctx, event, body };
}

describe('registerMessageHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evictUserRateLimiter();
    mocked.isAuthorized.mockReturnValue(true);
    mocked.parseApprovalDecision.mockReturnValue(null);
    mocked.parseCommand.mockReturnValue(null);
    mocked.dispatchCommand.mockResolvedValue(undefined);
  });

  it('ignores bot messages and message edits', async () => {
    const { handler, ctx, body } = createMessageEventHandler({
      event: { bot_id: 'B1' },
    });

    await handler({
      event: { bot_id: 'B1', channel: 'C1', channel_type: 'im', ts: '1.1' },
      body,
      client: { chat: {} },
    });
    expect(ctx.dedupeStore.isDuplicateAndRegister).not.toHaveBeenCalled();

    const edited = createMessageEventHandler({
      event: { subtype: 'message_changed' },
    });
    await edited.handler({
      event: {
        subtype: 'message_changed',
        channel: 'C1',
        channel_type: 'im',
        ts: '1.2',
      },
      body: edited.body,
      client: { chat: {} },
    });
    expect(edited.ctx.dedupeStore.isDuplicateAndRegister).not.toHaveBeenCalled();
  });

  it('returns early when event is duplicate or unauthorized', async () => {
    const dup = createMessageEventHandler({ isDuplicate: true });
    await dup.handler({ event: dup.event, body: dup.body, client: { chat: {} } });
    expect(dup.ctx.dedupeStore.isDuplicateAndRegister).toHaveBeenCalledWith('evt-1');

    mocked.isAuthorized.mockReturnValue(false);
    const unauthorized = createMessageEventHandler();
    await unauthorized.handler({
      event: unauthorized.event,
      body: unauthorized.body,
      client: { chat: {} },
    });
    expect(mocked.scheduleInactivityAutoExit).not.toHaveBeenCalled();
  });

  it('responds for bare approval decision with no pending request', async () => {
    mocked.parseApprovalDecision.mockReturnValue('approve');
    const { handler, event, body } = createMessageEventHandler();

    await handler({ event, body, client: { chat: {} } });

    expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'C1',
      '1.1',
      'No pending approval request.',
    );
  });

  it('dispatches parsed command and logs command errors', async () => {
    mocked.parseCommand.mockReturnValue({ kind: 'status' });
    mocked.dispatchCommand.mockRejectedValue(new Error('boom'));

    const { handler, event, body } = createMessageEventHandler();
    await handler({ event, body, client: { chat: {} } });

    expect(mocked.dispatchCommand).toHaveBeenCalled();
    expect(mocked.logSlackCommandError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ command: 'status', sessionKey: 'C1:1.1' }),
    );
  });

  it('dispatches parsed command successfully with thread_ts and missing text/user fields', async () => {
    mocked.parseCommand.mockReturnValue({ kind: 'status' });
    const { handler, body } = createMessageEventHandler({
      event: { thread_ts: '9.9' },
    });

    await handler({
      event: {
        channel: 'C1',
        channel_type: 'im',
        ts: '1.1',
        thread_ts: '9.9',
      },
      body,
      client: { chat: {} },
    });

    expect(mocked.dispatchCommand).toHaveBeenCalled();
    expect(mocked.logSlackCommandError).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ command: 'status' }),
    );
  });

  it('returns early when MCP bypass approval handler consumes the message', async () => {
    mocked.handleMcpAuthBypassApproval.mockResolvedValueOnce(true);
    mocked.parseCommand.mockReturnValue({ kind: 'status' });
    const { handler, event, body } = createMessageEventHandler();

    await handler({ event, body, client: { chat: {} } });

    expect(mocked.handleMcpAuthBypassApproval).toHaveBeenCalled();
    expect(mocked.handleToolApproval).not.toHaveBeenCalled();
    expect(mocked.dispatchCommand).not.toHaveBeenCalled();
  });

  it('returns early when tool approval handler consumes the message', async () => {
    mocked.handleToolApproval.mockResolvedValueOnce(true);
    mocked.parseCommand.mockReturnValue({ kind: 'status' });
    const { handler, event, body } = createMessageEventHandler();

    await handler({ event, body, client: { chat: {} } });

    expect(mocked.handleToolApproval).toHaveBeenCalled();
    expect(mocked.dispatchCommand).not.toHaveBeenCalled();
  });

  it('rate-limits burst messages from the same user', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { handler, event, body } = createMessageEventHandler();

    for (let i = 0; i < 6; i++) {
      await handler({
        event: { ...event, ts: `1.${i + 1}`, text: `msg-${i + 1}` },
        body: { ...body, event_id: `evt-${i + 1}` },
        client: { chat: {} },
      });
    }

    expect(warnSpy).toHaveBeenCalledWith('user_rate_limited', { user_id: 'U1' });
    warnSpy.mockRestore();
  });

  it('logs message_handler context on unexpected top-level errors', async () => {
    const { handler, event, body, ctx } = createMessageEventHandler({
      event: { user: 'U_ERR' },
    });
    ctx.sessionManager.touchThreadActivity.mockImplementation(() => {
      throw new Error('touch failed');
    });

    await handler({ event, body, client: { chat: {} } });

    expect(mocked.logSlackCommandError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ command: 'message_handler', sessionKey: 'C1:1.1' }),
    );
  });

  it('allows file_share subtype messages through', async () => {
    mocked.parseCommand.mockReturnValue({ kind: 'prompt', prompt: 'hello' });
    const { handler, body } = createMessageEventHandler({
      event: { user: 'U_FILE1' },
    });

    await handler({
      event: {
        subtype: 'file_share',
        channel: 'C1',
        channel_type: 'im',
        ts: '1.1',
        user: 'U_FILE1',
        text: 'hello',
        files: [],
      },
      body,
      client: { chat: {} },
    });

    expect(mocked.dispatchCommand).toHaveBeenCalled();
  });

  it('dispatches file-only messages (no text) as prompt when files are present', async () => {
    mocked.parseCommand.mockReturnValue(null);
    mocked.extractSlackFiles.mockReturnValue([
      {
        id: 'F1',
        name: 'test.png',
        mimetype: 'image/png',
        size: 100,
        urlPrivateDownload: 'https://x',
      },
    ]);
    const { handler, body } = createMessageEventHandler({
      event: { user: 'U_FILE2' },
    });

    await handler({
      event: {
        subtype: 'file_share',
        channel: 'C1',
        channel_type: 'im',
        ts: '1.1',
        user: 'U_FILE2',
        text: '',
        files: [
          {
            id: 'F1',
            name: 'test.png',
            mimetype: 'image/png',
            size: 100,
            url_private_download: 'https://x',
          },
        ],
      },
      body,
      client: { chat: {} },
    });

    expect(mocked.dispatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({ slackFiles: expect.any(Array) }),
      expect.objectContaining({ kind: 'prompt', prompt: 'See attached files.' }),
    );
  });

  it('does not dispatch when no text and no files', async () => {
    mocked.parseCommand.mockReturnValue(null);
    mocked.extractSlackFiles.mockReturnValue([]);
    const { handler, body } = createMessageEventHandler({
      event: { user: 'U_FILE3' },
    });

    await handler({
      event: {
        channel: 'C1',
        channel_type: 'im',
        ts: '1.1',
        user: 'U_FILE3',
        text: '',
      },
      body,
      client: { chat: {} },
    });

    expect(mocked.dispatchCommand).not.toHaveBeenCalled();
  });
});
