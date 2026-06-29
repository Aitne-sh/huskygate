/**
 * Coverage tests for src/slack/commands/prompt.ts
 * Targets: branch at line 115 (e.userReason ?? e.reason ternary in file error mapping)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  postMessageWithContext: vi.fn().mockResolvedValue(undefined),
  postMessageWithBlocks: vi.fn().mockResolvedValue(undefined),
  getActiveSessionRef: vi.fn().mockReturnValue(null),
  downloadFiles: vi.fn().mockResolvedValue({ downloaded: [], errors: [] }),
  buildFileReferenceBlock: vi.fn().mockReturnValue(''),
  resolveInstruction: vi.fn().mockReturnValue(''),
  getInstructionFilePath: vi.fn().mockReturnValue('/tmp/inst'),
  sanitizeStickyApprovalState: vi.fn().mockReturnValue({ changed: false, toolState: {} }),
  buildMenuNoSessionBlocks: vi.fn().mockReturnValue([]),
}));

vi.mock('../app-helpers.js', () => ({
  postMessageWithContext: mocked.postMessageWithContext,
  postMessageWithBlocks: mocked.postMessageWithBlocks,
}));

vi.mock('../handler-context.js', () => ({
  getActiveSessionRef: mocked.getActiveSessionRef,
}));

vi.mock('../block-kit.js', () => ({
  buildMenuNoSessionBlocks: mocked.buildMenuNoSessionBlocks,
}));

vi.mock('../../shared/file-attachment.js', () => ({
  downloadFiles: mocked.downloadFiles,
  buildFileReferenceBlock: mocked.buildFileReferenceBlock,
}));

vi.mock('../../shared/approval.js', () => ({
  sanitizeStickyApprovalState: mocked.sanitizeStickyApprovalState,
}));

vi.mock('../../instructions/builder.js', () => ({
  resolveInstruction: mocked.resolveInstruction,
}));

vi.mock('../../orchestrator/engine-utils.js', () => ({
  getInstructionFilePath: mocked.getInstructionFilePath,
}));

vi.mock('../../utils/error.js', () => ({
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('node:crypto', () => ({
  default: { randomUUID: () => 'test-uuid-1234' },
}));

vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
}));

import { handlePrompt } from './prompt.js';

function makeHctx(overrides: Record<string, unknown> = {}): Parameters<typeof handlePrompt>[0] {
  return {
    ctx: {
      sessionManager: {
        listSessionsForThreadOwned: vi.fn().mockReturnValue([]),
        findLatestSessionByToolOwned: vi.fn().mockReturnValue(null),
        createSessionForThread: vi.fn().mockReturnValue({
          sessionKey: 'sess-1',
          tool: 'claude',
          mode: 'write',
          toolState: {},
          workdir: '/tmp/wd',
        }),
        updateToolState: vi.fn(),
        setActiveSessionKey: vi.fn(),
      },
      workdirManager: {
        prepareWorkdirSkillsOnly: vi.fn(),
        prepareDevWorkdir: vi.fn(),
      },
      jobQueue: {
        enqueue: vi.fn().mockReturnValue({ position: 0 }),
      },
      config: { slack: { botToken: 'xoxb-test' } },
      conversationStore: { saveMessage: vi.fn() },
      devAliasStore: { list: vi.fn().mockReturnValue([]) },
    },
    client: {},
    channelId: 'C1',
    threadTs: '1.1',
    userId: 'U1',
    threadKey: 'C1:1.1',
    slackFiles: undefined as unknown as unknown[],
    ...overrides,
  } as unknown as Parameters<typeof handlePrompt>[0];
}

describe('prompt: file error userReason fallback (line 115)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses e.userReason when available', async () => {
    const session = {
      sessionKey: 'sess-1',
      session: {
        tool: 'claude',
        mode: 'write',
        toolState: {},
        workdir: '/tmp/wd',
        devAlias: null,
      },
    };
    mocked.getActiveSessionRef.mockReturnValue(session);

    mocked.downloadFiles.mockResolvedValue({
      downloaded: [],
      errors: [
        { fileName: 'big.zip', reason: 'file_too_large', userReason: 'File exceeds 10MB limit' },
      ],
    });

    const hctx = makeHctx({
      slackFiles: [{ name: 'big.zip', url_private: 'https://files.slack.com/big.zip' }],
    });

    await handlePrompt(hctx, { kind: 'prompt', prompt: 'test', tool: undefined });

    expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'C1',
      '1.1',
      expect.stringContaining('File exceeds 10MB limit'),
      expect.anything(),
    );
  });

  it('falls back to e.reason when e.userReason is undefined', async () => {
    const session = {
      sessionKey: 'sess-1',
      session: {
        tool: 'claude',
        mode: 'write',
        toolState: {},
        workdir: '/tmp/wd',
        devAlias: null,
      },
    };
    mocked.getActiveSessionRef.mockReturnValue(session);

    mocked.downloadFiles.mockResolvedValue({
      downloaded: [],
      errors: [{ fileName: 'bad.txt', reason: 'download_failed', userReason: undefined }],
    });

    const hctx = makeHctx({
      slackFiles: [{ name: 'bad.txt', url_private: 'https://files.slack.com/bad.txt' }],
    });

    await handlePrompt(hctx, { kind: 'prompt', prompt: 'test', tool: undefined });

    expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'C1',
      '1.1',
      expect.stringContaining('download_failed'),
      expect.anything(),
    );
  });
});
