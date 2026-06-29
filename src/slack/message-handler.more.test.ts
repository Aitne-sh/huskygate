/**
 * Additional coverage tests for src/slack/message-handler.ts
 * Covers lines 54-63 (assistant thread routing)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

type MessageHandler = (...args: unknown[]) => Promise<void>;

beforeEach(() => {
  vi.clearAllMocks();
  evictUserRateLimiter();
  mocked.isAuthorized.mockReturnValue(true);
  mocked.isAssistantThread.mockReturnValue(false);
});

function setupHandler() {
  let handler: MessageHandler | null = null;
  const app = {
    event: vi.fn((_name: string, cb: MessageHandler) => {
      handler = cb;
    }),
  };
  const ctx = {
    dedupeStore: {
      isDuplicateAndRegister: vi.fn().mockReturnValue(false),
    },
    sessionManager: {
      touchThreadActivity: vi.fn(),
    },
    config: {},
  };

  registerMessageHandler(ctx as never, app as never);
  expect(handler).toBeDefined();
  return { handler: handler as unknown as MessageHandler, ctx };
}

describe('message-handler assistant thread routing', () => {
  it('routes to handleAssistantMessage when isAssistantThread returns true', async () => {
    mocked.isAssistantThread.mockReturnValue(true);
    const { handler } = setupHandler();

    await handler({
      event: {
        channel: 'C_ASST',
        channel_type: 'im',
        ts: '1.5',
        thread_ts: '1.0',
        user: 'U1',
        text: 'hello assistant',
      },
      body: { event_id: 'evt-asst', team_id: 'T1' },
      client: { chat: {} },
    });

    expect(mocked.handleAssistantMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        channel: 'C_ASST',
        threadTs: '1.0',
        ts: '1.5',
        userId: 'U1',
        text: 'hello assistant',
        teamId: 'T1',
      }),
    );
    // Should not reach command dispatch
    expect(mocked.dispatchCommand).not.toHaveBeenCalled();
  });
});
