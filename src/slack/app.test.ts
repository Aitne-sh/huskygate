import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../context/app-context.js';
import { makeTestAppContext } from '../test-helpers/app-context-builder.js';

const mocked = vi.hoisted(() => ({
  registerActionHandlers: vi.fn(),
  registerAssistantHandlers: vi.fn(),
  registerJobExecutor: vi.fn(),
  registerMessageHandler: vi.fn(),
  registerToolPlugin: vi.fn(),
  evictUserRateLimiter: vi.fn(),
  postMessageWithContext: vi.fn().mockResolvedValue(undefined),
  loggerError: vi.fn(),
}));

vi.mock('./actions/register.js', () => ({
  registerActionHandlers: mocked.registerActionHandlers,
}));

vi.mock('./assistant.js', () => ({
  registerAssistantHandlers: mocked.registerAssistantHandlers,
}));

vi.mock('./job-executor.js', () => ({
  registerJobExecutor: mocked.registerJobExecutor,
}));

vi.mock('./message-handler.js', () => ({
  registerMessageHandler: mocked.registerMessageHandler,
  evictUserRateLimiter: mocked.evictUserRateLimiter,
}));

vi.mock('./tool-plugin.js', () => ({
  registerToolPlugin: mocked.registerToolPlugin,
}));

vi.mock('./app-helpers.js', () => ({
  postMessageWithContext: mocked.postMessageWithContext,
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: mocked.loggerError,
  },
}));

vi.mock('./tools/claude-plugin.js', () => ({ default: { name: 'claude' } }));
vi.mock('./tools/gemini-plugin.js', () => ({ default: { name: 'gemini' } }));
vi.mock('./tools/codex-plugin.js', () => ({ default: { name: 'codex' } }));

function createContext(): AppContext {
  const app = {
    client: {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ok: true }),
      },
    },
    event: vi.fn(),
    action: vi.fn(),
  };

  return makeTestAppContext({
    webClient: app.client as unknown as Partial<AppContext['webClient']>,
  });
}

describe('createApp', () => {
  it('wires handlers/plugins against the provided app context', async () => {
    const { createApp } = await import('./app.js');
    const ctx = createContext();
    const app = {
      client: ctx.webClient,
      event: vi.fn(),
      action: vi.fn(),
    } as never;

    const runtime = createApp(ctx, app);

    expect(mocked.registerToolPlugin).toHaveBeenCalledTimes(3);
    expect(mocked.registerJobExecutor).toHaveBeenCalledWith(ctx);
    expect(mocked.registerMessageHandler).toHaveBeenCalledWith(ctx, app);
    expect(mocked.registerActionHandlers).toHaveBeenCalledWith(ctx, app);
    expect(mocked.registerAssistantHandlers).toHaveBeenCalledWith(ctx, app);
    expect(runtime.app).toBe(app);
    expect(runtime.ctx).toBe(ctx);
  });

  it('shuts down running jobs and notifies slack threads', async () => {
    const { createApp } = await import('./app.js');
    const ctx = createContext();
    const runtime = createApp(ctx, {
      client: ctx.webClient,
      event: vi.fn(),
      action: vi.fn(),
    } as never);

    const runner = { kill: vi.fn() };
    const inactivityTimer = setTimeout(() => undefined, 1000);
    ctx.inactivityTimers.set('C1:1.1', inactivityTimer);
    ctx.activeRunners.set('sess-1', {
      runner,
      job: {
        id: 'job-1',
        sessionKey: 'sess-1',
        channelId: 'C1',
        threadTs: '1.1',
        tool: 'claude',
      },
    } as never);

    const interrupted = await runtime.shutdownRunningJobs();

    expect(interrupted).toBe(1);
    expect(runner.kill).toHaveBeenCalledWith('orchestrator_shutdown');
    expect(ctx.jobQueue.cancelSession).toHaveBeenCalledWith('sess-1');
    expect(mocked.postMessageWithContext).toHaveBeenCalled();
  });

  it('runs eviction interval and logs shutdown notification errors', async () => {
    vi.useFakeTimers();
    mocked.postMessageWithContext.mockRejectedValueOnce(new Error('slack down'));

    const { createApp } = await import('./app.js');
    const ctx = createContext();
    const runtime = createApp(ctx, {
      client: ctx.webClient,
      event: vi.fn(),
      action: vi.fn(),
    } as never);

    vi.advanceTimersByTime(60_000);
    expect(mocked.evictUserRateLimiter).toHaveBeenCalled();

    const runner = { kill: vi.fn() };
    ctx.activeRunners.set('sess-1', {
      runner,
      job: {
        id: 'job-1',
        sessionKey: 'sess-1',
        channelId: 'C1',
        threadTs: '1.1',
        tool: 'claude',
      },
    } as never);

    await runtime.shutdownRunningJobs();
    expect(mocked.loggerError).toHaveBeenCalledWith(
      'shutdown_notification_failed',
      expect.objectContaining({ job_id: 'job-1', error: 'slack down' }),
    );
    vi.useRealTimers();
  });

  it('skips shutdown notification for dashboard-sourced jobs', async () => {
    mocked.postMessageWithContext.mockClear();

    const { createApp } = await import('./app.js');
    const ctx = createContext();
    const runtime = createApp(ctx, {
      client: ctx.webClient,
      event: vi.fn(),
      action: vi.fn(),
    } as never);

    const runner = { kill: vi.fn() };
    ctx.activeRunners.set('sess-dashboard', {
      runner,
      job: {
        id: 'job-dashboard',
        sessionKey: 'sess-dashboard',
        channelId: 'C1',
        threadTs: '1.3',
        tool: 'claude',
        source: 'dashboard',
      },
    } as never);

    const interrupted = await runtime.shutdownRunningJobs();
    expect(interrupted).toBe(1);
    expect(runner.kill).toHaveBeenCalledWith('orchestrator_shutdown');
    expect(ctx.jobQueue.cancelSession).toHaveBeenCalledWith('sess-dashboard');
    expect(mocked.postMessageWithContext).not.toHaveBeenCalled();
  });
});
