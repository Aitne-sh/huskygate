/**
 * Additional coverage tests for src/slack/commands/task.ts
 * Covers lines 117-122 (cleanup on exception when job not enqueued)
 */
import { describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  postMessageWithContext: vi.fn().mockResolvedValue(undefined),
  cleanupStandaloneSessionResources: vi.fn(),
  loggerError: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('../app-helpers.js', () => ({
  postMessageWithContext: mocked.postMessageWithContext,
}));

vi.mock('../../shared/standalone-session-cleanup.js', () => ({
  cleanupStandaloneSessionResources: mocked.cleanupStandaloneSessionResources,
}));

vi.mock('../../utils/error.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: mocked.loggerError, info: vi.fn(), warn: vi.fn() },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, mkdirSync: mocked.mkdirSync };
});

vi.mock('node:crypto', () => ({
  default: { randomUUID: vi.fn(() => 'uuid-test') },
}));

import { handleTask } from './task.js';

function makeHctx(ctx: Record<string, unknown>) {
  return {
    ctx,
    client: {},
    channelId: 'C1',
    threadTs: '1.1',
    userId: 'U1',
    threadKey: 'C1:1.1',
  };
}

describe('handleTask - error cleanup branch', () => {
  it('cleans up standalone session on unexpected error before enqueue', async () => {
    const ctx = {
      ondemandTaskStore: {
        findByKey: vi.fn().mockReturnValue({
          id: 'task-1',
          name: 'Test Task',
          tool: 'claude',
          userId: 'U1',
          workdir: null,
          instructionFile: null,
          enabledSkills: null,
          allowMcp: true,
          notifyChannel: null,
          notifyThread: null,
          prompt: 'test',
          maxRetries: 0,
        }),
        recordRun: vi.fn(),
        updateRun: vi.fn(),
      },
      sessionManager: {
        createStandaloneSession: vi.fn(() => ({
          sessionKey: 'standalone-sess',
          workdir: '/tmp/standalone-work',
        })),
        updateMode: vi.fn(),
      },
      workdirManager: {
        prepareWorkdirSkillsOnly: vi.fn(() => {
          throw new Error('workdir prep failed');
        }),
      },
      jobQueue: {
        enqueue: vi.fn().mockReturnValue({ position: 0 }),
      },
    };

    const hctx = makeHctx(ctx);
    await handleTask(hctx as never, { kind: 'task', nameOrAlias: 'test' } as never);

    // Should cleanup the standalone session since job was not enqueued
    expect(mocked.cleanupStandaloneSessionResources).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        sessionKey: 'standalone-sess',
      }),
    );
    expect(mocked.postMessageWithContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'C1',
      '1.1',
      expect.stringContaining('Error executing on-demand task'),
    );
    expect(mocked.loggerError).toHaveBeenCalledWith('task_command_failed', expect.any(Object));
  });
});
