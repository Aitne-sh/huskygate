import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupStandaloneSessionResources } from './standalone-session-cleanup.js';

vi.mock('../utils/workdir.js', () => ({
  cleanupWorkdir: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logger } from '../utils/logger.js';
import { cleanupWorkdir } from '../utils/workdir.js';

const mockedCleanupWorkdir = vi.mocked(cleanupWorkdir);
const mockedLoggerWarn = vi.mocked(logger.warn);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeCtx(overrides?: {
  getReturn?: { workdir: string | null } | null;
  deleteThrows?: Error;
}) {
  const get = vi.fn().mockReturnValue(overrides?.getReturn ?? null);
  const deleteSessionByKeyWithCleanup = overrides?.deleteThrows
    ? vi.fn().mockImplementation(() => {
        throw overrides.deleteThrows;
      })
    : vi.fn().mockReturnValue({ threadKey: 'thread-1' });

  return {
    ctx: {
      config: { workdirRoot: '/tmp/workdirs' },
      sessionManager: { get, deleteSessionByKeyWithCleanup },
    },
    mocks: { get, deleteSessionByKeyWithCleanup },
  };
}

describe('cleanupStandaloneSessionResources', () => {
  it('cleans up session and both workdirs when both are provided', () => {
    const { ctx } = makeCtx();

    cleanupStandaloneSessionResources(ctx, {
      sessionKey: 'sess-1',
      sessionWorkdir: '/tmp/workdirs/session-wd',
      jobWorkdir: '/tmp/workdirs/job-wd',
    });

    expect(ctx.sessionManager.deleteSessionByKeyWithCleanup).toHaveBeenCalledWith('sess-1');
    expect(mockedCleanupWorkdir).toHaveBeenCalledTimes(2);
    expect(mockedCleanupWorkdir).toHaveBeenCalledWith('/tmp/workdirs', '/tmp/workdirs/session-wd');
    expect(mockedCleanupWorkdir).toHaveBeenCalledWith('/tmp/workdirs', '/tmp/workdirs/job-wd');
  });

  it('falls back to session.workdir when sessionWorkdir is not provided', () => {
    const { ctx } = makeCtx({ getReturn: { workdir: '/tmp/workdirs/from-session' } });

    cleanupStandaloneSessionResources(ctx, {
      sessionKey: 'sess-2',
      jobWorkdir: '/tmp/workdirs/job-wd',
    });

    expect(ctx.sessionManager.get).toHaveBeenCalledWith('sess-2');
    expect(mockedCleanupWorkdir).toHaveBeenCalledWith(
      '/tmp/workdirs',
      '/tmp/workdirs/from-session',
    );
    expect(mockedCleanupWorkdir).toHaveBeenCalledWith('/tmp/workdirs', '/tmp/workdirs/job-wd');
  });

  it('deduplicates when sessionWorkdir === jobWorkdir', () => {
    const { ctx } = makeCtx();

    cleanupStandaloneSessionResources(ctx, {
      sessionKey: 'sess-3',
      sessionWorkdir: '/tmp/workdirs/same-wd',
      jobWorkdir: '/tmp/workdirs/same-wd',
    });

    expect(mockedCleanupWorkdir).toHaveBeenCalledTimes(1);
    expect(mockedCleanupWorkdir).toHaveBeenCalledWith('/tmp/workdirs', '/tmp/workdirs/same-wd');
  });

  it('handles null jobWorkdir', () => {
    const { ctx } = makeCtx();

    cleanupStandaloneSessionResources(ctx, {
      sessionKey: 'sess-4',
      sessionWorkdir: '/tmp/workdirs/session-wd',
      jobWorkdir: null,
    });

    expect(mockedCleanupWorkdir).toHaveBeenCalledTimes(1);
    expect(mockedCleanupWorkdir).toHaveBeenCalledWith('/tmp/workdirs', '/tmp/workdirs/session-wd');
  });

  it('handles undefined jobWorkdir', () => {
    const { ctx } = makeCtx();

    cleanupStandaloneSessionResources(ctx, {
      sessionKey: 'sess-5',
      sessionWorkdir: '/tmp/workdirs/session-wd',
    });

    expect(mockedCleanupWorkdir).toHaveBeenCalledTimes(1);
    expect(mockedCleanupWorkdir).toHaveBeenCalledWith('/tmp/workdirs', '/tmp/workdirs/session-wd');
  });

  it('catches and logs session delete failures', () => {
    const deleteError = new Error('session delete boom');
    const { ctx } = makeCtx({ deleteThrows: deleteError });

    cleanupStandaloneSessionResources(ctx, {
      sessionKey: 'sess-fail',
      sessionWorkdir: '/tmp/workdirs/session-wd',
    });

    expect(mockedLoggerWarn).toHaveBeenCalledWith('standalone_session_delete_failed', {
      sessionKey: 'sess-fail',
      error: 'session delete boom',
    });
    // Workdir cleanup should still proceed
    expect(mockedCleanupWorkdir).toHaveBeenCalledWith('/tmp/workdirs', '/tmp/workdirs/session-wd');
  });

  it('catches and logs workdir cleanup failures', () => {
    const { ctx } = makeCtx();
    mockedCleanupWorkdir.mockImplementation(() => {
      throw new Error('rm failed');
    });

    cleanupStandaloneSessionResources(ctx, {
      sessionKey: 'sess-wdfail',
      sessionWorkdir: '/tmp/workdirs/session-wd',
      jobWorkdir: '/tmp/workdirs/job-wd',
    });

    expect(mockedLoggerWarn).toHaveBeenCalledWith(
      'standalone_workdir_cleanup_failed',
      expect.objectContaining({
        sessionKey: 'sess-wdfail',
        error: 'rm failed',
      }),
    );
    // Both workdirs should be attempted even if one fails
    expect(mockedCleanupWorkdir).toHaveBeenCalledTimes(2);
  });

  it('skips workdir cleanup when no workdirs are available', () => {
    const { ctx } = makeCtx();

    cleanupStandaloneSessionResources(ctx, {
      sessionKey: 'sess-no-wd',
    });

    expect(ctx.sessionManager.deleteSessionByKeyWithCleanup).toHaveBeenCalledWith('sess-no-wd');
    expect(mockedCleanupWorkdir).not.toHaveBeenCalled();
  });
});
