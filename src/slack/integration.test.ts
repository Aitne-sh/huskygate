/**
 * Integration tests: Job enqueue → Runner spawn → Messenger output.
 *
 * Uses mock Runner and mock Slack client to test the full pipeline
 * through registerJobExecutor without spawning real child processes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config, ToolName } from '../config.js';
import { JobQueue } from '../queue/job-queue.js';
import type { Job } from '../queue/types.js';
import type { Driver, DriverEvent, RunResult } from '../runner/types.js';
import { makeTestAppContext, makeTestConfig } from '../test-helpers/app-context-builder.js';
import { registerToolPlugin } from './tool-plugin.js';
import claudePlugin from './tools/claude-plugin.js';
import codexPlugin from './tools/codex-plugin.js';
import geminiPlugin from './tools/gemini-plugin.js';

// ---------------------------------------------------------------------------
// Mock Runner module — intercept Runner constructor
// ---------------------------------------------------------------------------

let mockRunImpl: (
  driver: Driver,
  args: string[],
  env: Record<string, string>,
  cwd: string,
  onEvent: (event: DriverEvent) => void,
) => Promise<RunResult>;

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, writeFileSync: vi.fn() };
});

vi.mock('../workdir/mcp-writer.js', () => ({
  writeClaudeMcpConfigToWorkdir: vi.fn(
    () => '/tmp/test-workdir/default/.huskygate/claude.mcp.json',
  ),
  removeClaudeGeneratedMcpConfig: vi.fn(),
}));

vi.mock('../runner/runner.js', () => {
  return {
    Runner: class MockRunner {
      private running = false;
      isRunning() {
        return this.running;
      }
      kill() {
        this.running = false;
      }
      async run(
        driver: Driver,
        args: string[],
        env: Record<string, string>,
        cwd: string,
        onEvent: (event: DriverEvent) => void,
      ): Promise<RunResult> {
        this.running = true;
        try {
          return await mockRunImpl(driver, args, env, cwd, onEvent);
        } finally {
          this.running = false;
        }
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestConfig(overrides?: Partial<Config>): Config {
  return makeTestConfig(overrides);
}

function createMockJob(tool: ToolName, prompt: string): Job {
  return {
    id: `job_${Date.now()}`,
    sessionKey: `sess_test_${tool}`,
    channelId: 'C123',
    threadTs: '1.1',
    userId: 'U1',
    tool,
    mode: 'readonly',
    prompt,
    workdir: '/tmp/test-workdir/default',
    toolState: {},
    createdAt: Date.now(),
  };
}

function createMockAppContext(config: Config) {
  const postMessage = vi.fn().mockResolvedValue({ ok: true, ts: '1.2' });
  const chatUpdate = vi.fn().mockResolvedValue({ ok: true });
  const filesUploadV2 = vi.fn().mockResolvedValue({ ok: true });

  const slackClient = {
    chat: { postMessage, update: chatUpdate },
    filesUploadV2,
  };
  const base = makeTestAppContext({
    config,
    webClient: slackClient as never,
  });

  return {
    ...base,
    config,
    webClient: slackClient,
    sessionManager: {
      ...base.sessionManager,
      get: vi.fn().mockReturnValue({
        toolState: {},
        devAlias: null,
        tool: 'claude',
        mode: 'readonly',
        workdir: '/tmp/test-workdir/default',
      }),
      getActiveSessionKey: vi.fn().mockReturnValue(null),
      getSessionSummary: vi.fn().mockReturnValue({ tool: 'claude', sessionId: 'test-sid' }),
      updateToolState: vi.fn(),
      mergeToolState: vi.fn(),
      setRunningJob: vi.fn(),
      touchThreadActivity: vi.fn(),
    },
    jobQueue: null as unknown, // will be set below
    workdirManager: {
      ...base.workdirManager,
      prepareWorkdirSkillsOnly: vi.fn(),
    },
    auditStore: {
      ...base.auditStore,
      logJobStart: vi.fn(),
      logJobComplete: vi.fn(),
    },
    conversationStore: { ...base.conversationStore, saveMessage: vi.fn() },
    defaultInstructionStore: {
      ...base.defaultInstructionStore,
      getWithEnabled: vi.fn(() => ({ content: '', enabled: false })),
    },
    pendingToolApprovals: { set: vi.fn(), get: vi.fn(), delete: vi.fn() },
    pendingMcpAuthBypassApprovals: { set: vi.fn(), get: vi.fn(), delete: vi.fn() },
    mcpServerStore: {
      ...base.mcpServerStore,
      listByTool: vi.fn().mockReturnValue([]),
      listAll: vi.fn().mockReturnValue([]),
      getById: vi.fn().mockReturnValue(null),
    },
    sessionMcpServerStore: {
      ...base.sessionMcpServerStore,
      listBySession: vi.fn().mockReturnValue([]),
    },
    postMessage,
    chatUpdate,
  };
}

function getPostedTexts(postMessage: ReturnType<typeof vi.fn>): string[] {
  return postMessage.mock.calls.map((call: unknown[]) => {
    const arg = call[0] as { text?: string };
    return arg?.text ?? '';
  });
}

async function createDirectExecutorContext(configOverrides?: Partial<Config>) {
  const config = createTestConfig(configOverrides);
  const mockCtx = createMockAppContext(config);

  let executor: ((job: Job) => Promise<void>) | null = null;
  mockCtx.jobQueue = {
    setExecutor: vi.fn((fn: (job: Job) => Promise<void>) => {
      executor = fn;
    }),
    enqueue: vi.fn(() => ({ position: 0 })),
  };

  const { registerJobExecutor } = await import('./job-executor.js');
  registerJobExecutor(mockCtx as never);

  return { mockCtx, executor: executor as unknown as (job: Job) => Promise<void> };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration: Job pipeline', () => {
  beforeEach(() => {
    registerToolPlugin(claudePlugin);
    registerToolPlugin(geminiPlugin);
    registerToolPlugin(codexPlugin);
    // Prevent GeminiDriver from shelling out to resolve the command
    process.env.GEMINI_COMMAND = 'gemini';
  });

  it('claude job: text events are posted via messenger', async () => {
    mockRunImpl = async (_driver, _args, _env, _cwd, onEvent) => {
      onEvent({ type: 'text', content: 'Hello from Claude!' });
      return { exitCode: 0, events: [], errorKind: null };
    };

    const config = createTestConfig();
    const mockCtx = createMockAppContext(config);
    const jobQueue = new JobQueue(config);
    mockCtx.jobQueue = jobQueue;

    // Import and register executor
    const { registerJobExecutor } = await import('./job-executor.js');
    registerJobExecutor(mockCtx as never);

    // Enqueue and wait for completion
    const job = createMockJob('claude', 'say hello');
    const result = jobQueue.enqueue(job);
    expect('position' in result).toBe(true);

    // Wait for async job execution
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify messenger posted the text
    const texts = getPostedTexts(mockCtx.postMessage);
    // First post is "Running `claude`...", final update has the answer
    expect(texts.length).toBeGreaterThanOrEqual(1);
    expect(mockCtx.chatUpdate.mock.calls.length).toBeGreaterThanOrEqual(1);

    // The final update should contain "Hello from Claude!"
    const allUpdatedTexts = mockCtx.chatUpdate.mock.calls.map(
      (call: unknown[]) => (call[0] as { text?: string })?.text ?? '',
    );
    expect(allUpdatedTexts.some((t: string) => t.includes('Hello from Claude!'))).toBe(true);
  });

  it('claude job: tool_use triggers approval gate in write mode', async () => {
    mockRunImpl = async (_driver, _args, _env, _cwd, onEvent) => {
      onEvent({ type: 'text', content: 'Let me check...' });
      onEvent({ type: 'tool_use', content: 'Using tool: mcp__aws__execute' });
      // The approval gate should block since mcp__aws__execute is not in the allowlist
      return { exitCode: 0, events: [], errorKind: null };
    };

    const config = createTestConfig();
    const mockCtx = createMockAppContext(config);
    const jobQueue = new JobQueue(config);
    mockCtx.jobQueue = jobQueue;

    const { registerJobExecutor } = await import('./job-executor.js');
    registerJobExecutor(mockCtx as never);

    const job = createMockJob('claude', 'use aws');
    // Layer 4 approval gate only runs in write mode (readonly relies on CLI-level restrictions)
    job.mode = 'write';
    // Add claude_runtime_allowed_tools with a specific tool
    job.toolState = { claude_runtime_allowed_tools: ['read_file'] };
    jobQueue.enqueue(job);

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Should have a tool approval request posted
    const allTexts = [
      ...getPostedTexts(mockCtx.postMessage),
      ...mockCtx.chatUpdate.mock.calls.map(
        (call: unknown[]) => (call[0] as { text?: string })?.text ?? '',
      ),
    ];
    const combined = allTexts.join('\n');
    expect(combined).toContain('permission');
  });

  it('job failure: non-zero exit code is reported', async () => {
    mockRunImpl = async (_driver, _args, _env, _cwd, onEvent) => {
      onEvent({ type: 'error', content: 'Something went wrong' });
      return { exitCode: 1, events: [], errorKind: 'process_error' };
    };

    const config = createTestConfig();
    const mockCtx = createMockAppContext(config);
    const jobQueue = new JobQueue(config);
    mockCtx.jobQueue = jobQueue;

    const { registerJobExecutor } = await import('./job-executor.js');
    registerJobExecutor(mockCtx as never);

    const job = createMockJob('claude', 'will fail');
    jobQueue.enqueue(job);

    await new Promise((resolve) => setTimeout(resolve, 200));

    const allUpdatedTexts = mockCtx.chatUpdate.mock.calls.map(
      (call: unknown[]) => (call[0] as { text?: string })?.text ?? '',
    );
    const combined = allUpdatedTexts.join('\n');
    expect(combined).toContain('Exit code: 1');
  });

  it('activeRunners is cleaned up after job completes', async () => {
    mockRunImpl = async () => {
      return { exitCode: 0, events: [], errorKind: null };
    };

    const config = createTestConfig();
    const mockCtx = createMockAppContext(config);
    const jobQueue = new JobQueue(config);
    mockCtx.jobQueue = jobQueue;

    const { registerJobExecutor } = await import('./job-executor.js');
    registerJobExecutor(mockCtx as never);

    const job = createMockJob('claude', 'test cleanup');
    jobQueue.enqueue(job);

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(mockCtx.activeRunners.size).toBe(0);
    expect(mockCtx.sessionManager.setRunningJob).toHaveBeenLastCalledWith(job.sessionKey, null);
  });

  it('queue serializes jobs for the same session', async () => {
    const executionOrder: string[] = [];

    mockRunImpl = async (_driver, _args, _env, _cwd, _onEvent) => {
      const id = _args.join(' ');
      executionOrder.push(`start:${id}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      executionOrder.push(`end:${id}`);
      return { exitCode: 0, events: [], errorKind: null };
    };

    const config = createTestConfig();
    const mockCtx = createMockAppContext(config);
    const jobQueue = new JobQueue(config);
    mockCtx.jobQueue = jobQueue;

    const { registerJobExecutor } = await import('./job-executor.js');
    registerJobExecutor(mockCtx as never);

    const job1 = createMockJob('claude', 'first');
    const job2 = { ...createMockJob('claude', 'second'), id: 'job_2' };

    jobQueue.enqueue(job1);
    const result2 = jobQueue.enqueue(job2);

    // Second job should be queued (position > 0)
    expect('position' in result2 && (result2 as { position: number }).position).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify serial execution
    expect(executionOrder.length).toBe(4);
  });

  it('audit store records job lifecycle', async () => {
    mockRunImpl = async () => {
      return { exitCode: 0, events: [], errorKind: null };
    };

    const config = createTestConfig();
    const mockCtx = createMockAppContext(config);
    const jobQueue = new JobQueue(config);
    mockCtx.jobQueue = jobQueue;

    const { registerJobExecutor } = await import('./job-executor.js');
    registerJobExecutor(mockCtx as never);

    const job = createMockJob('claude', 'audit test');
    jobQueue.enqueue(job);

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(mockCtx.auditStore.logJobStart).toHaveBeenCalledTimes(1);
    expect(mockCtx.auditStore.logJobComplete).toHaveBeenCalledWith(job.id, 0, null);
  });

  it('covers Claude preflight guard branches (skip/bypass/verified)', async () => {
    mockRunImpl = async () => ({ exitCode: 0, events: [], errorKind: null });
    const { mockCtx, executor } = await createDirectExecutorContext({
      claudeMcpAuthServer: 'aws-api',
    });

    const skipJob = createMockJob('claude', 'skip-preflight branch') as Job & {
      toolStateOverrides: Record<string, unknown>;
    };
    skipJob.toolStateOverrides = { claude_skip_mcp_preflight_once: true };
    await executor(skipJob);

    (mockCtx.sessionManager.get as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    await expect(executor(createMockJob('claude', 'missing-session'))).rejects.toThrow(
      'Missing session for queued job: sess_test_claude',
    );

    (mockCtx.sessionManager.get as ReturnType<typeof vi.fn>).mockReturnValue({
      toolState: { claude_mcp_auth_bypass_server: 'aws-api' },
      devAlias: null,
      tool: 'claude',
      mode: 'readonly',
      workdir: '/tmp/test-workdir/default',
    });
    await executor(createMockJob('claude', 'bypass-marker'));

    (mockCtx.sessionManager.get as ReturnType<typeof vi.fn>).mockReturnValue({
      toolState: { claude_mcp_auth_verified_server: 'aws-api' },
      devAlias: null,
      tool: 'claude',
      mode: 'readonly',
      workdir: '/tmp/test-workdir/default',
    });
    await executor(createMockJob('claude', 'verified-marker'));

    expect(mockCtx.auditStore.logJobComplete).toHaveBeenCalledTimes(3);
  });

  it('covers Claude MCP post-run auth handler invocation with auto-rerun flag', async () => {
    mockRunImpl = async (_driver, _args, _env, _cwd, onEvent) => {
      onEvent({
        type: 'status',
        content: "MCP server 'aws-api' requires authentication using: /mcp auth aws-api",
      });
      return { exitCode: 1, events: [], errorKind: 'mcp_auth_required' };
    };

    const { mockCtx, executor } = await createDirectExecutorContext({
      claudeMcpAuthServer: 'aws-api',
    });
    const job = createMockJob('claude', 'mcp auth required rerun') as Job & {
      toolStateOverrides: Record<string, unknown>;
    };
    job.toolStateOverrides = {
      claude_mcp_auth_auto_rerun: true,
      claude_skip_mcp_preflight_once: true,
    };

    await executor(job);

    expect(mockCtx.auditStore.logJobComplete).toHaveBeenCalledWith(job.id, 1, 'mcp_auth_required');
  });

  it('covers Gemini runtime-warning path for non-aws missing tools', async () => {
    mockRunImpl = async (_driver, _args, _env, _cwd, onEvent) => {
      onEvent({
        type: 'error',
        content: 'Error executing tool custom_tool: Tool "custom_tool" not found',
      });
      onEvent({
        type: 'status',
        content: "Error during discovery for MCP server 'aws-api': auth failed",
      });
      return { exitCode: 1, events: [], errorKind: 'mcp_tool_unavailable' };
    };

    const { mockCtx, executor } = await createDirectExecutorContext();
    await executor(createMockJob('gemini', 'missing tool custom'));

    const posted = getPostedTexts(mockCtx.postMessage);
    expect(posted.some((text) => text.includes('custom_tool'))).toBe(true);
  });

  it('covers codex auth-resource fallback and dashboard onDone empty sessionState', async () => {
    mockRunImpl = async (_driver, _args, _env, _cwd, onEvent) => {
      onEvent({
        type: 'error',
        content: 'AuthRequired(AuthRequiredError { resource="https://auth.example/mcp" })',
      });
      return { exitCode: 1, events: [], errorKind: 'mcp_auth_required' };
    };

    const { mockCtx, executor } = await createDirectExecutorContext({
      codexMcpAuthServer: 'aws-api',
    });
    (mockCtx.sessionManager.get as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        toolState: {},
        devAlias: null,
        tool: 'codex',
        mode: 'readonly',
        workdir: '/tmp/test-workdir/default',
      })
      .mockReturnValueOnce(null);

    const job = {
      ...createMockJob('codex', 'codex resource auth'),
      source: 'dashboard' as const,
    };
    const onDone = vi.fn();
    mockCtx.jobEventStreams.set(job.id, {
      onEvent: vi.fn(),
      onDone,
    });

    await executor(job);

    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionState: {},
      }),
    );
  });
});
