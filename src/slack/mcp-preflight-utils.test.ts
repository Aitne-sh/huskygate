import { describe, expect, test, vi } from 'vitest';
import type { PendingMcpAuthBypassApproval } from '../context/app-types.js';
import type { Job } from '../queue/types.js';
import type { ToolState } from '../session/types.js';
import { makeTestAppContext } from '../test-helpers/app-context-builder.js';
import { ExpiringMap } from '../utils/expiring-map.js';
import {
  type ApprovalFlowConfig,
  buildPreflightAbortResult,
  createRetryJob,
  diffToolStatePatch,
  handleApprovalFlow,
  mergePreflightToolState,
  noAuthServerResult,
  registerMcpAuthApproval,
} from './mcp-preflight-utils.js';
import type { JobPreflightContext } from './mcp-preflight.js';

vi.mock('./app-helpers.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    postMessageWithContext: vi.fn().mockResolvedValue(undefined),
    postMessageWithBlocks: vi.fn().mockResolvedValue(undefined),
    scheduleExpiry: vi.fn(),
  };
});

vi.mock('./block-kit.js', () => ({
  buildMcpAuthApprovalBlocks: vi
    .fn()
    .mockReturnValue([{ type: 'section', text: { type: 'mrkdwn', text: 'mock' } }]),
}));

/* ── Test helpers ── */

function makeJpc(overrides?: Partial<JobPreflightContext>): JobPreflightContext {
  return {
    job: { id: 'j1', sessionKey: 'sk1' } as Job,
    messenger: {} as unknown as JobPreflightContext['messenger'],
    runner: {} as unknown as JobPreflightContext['runner'],
    env: { FOO: 'bar' },
    session: { toolState: { existing: 'state' } as ToolState },
    effectiveToolState: { effective: true } as unknown as ToolState,
    claudeSessionIdPreStored: false,
    ...overrides,
  };
}

function makeJob(overrides?: Partial<Job>): Job {
  return {
    id: 'job-1',
    sessionKey: 'sk-1',
    channelId: 'C123',
    threadTs: '1234.5678',
    userId: 'U123',
    tool: 'claude',
    mode: 'write',
    prompt: 'test prompt',
    workdir: '/tmp/test',
    createdAt: Date.now(),
    ...overrides,
  } as Job;
}

function makeCtx(mapOverride?: ExpiringMap<string, PendingMcpAuthBypassApproval>) {
  return makeTestAppContext({
    pendingMcpAuthBypassApprovals:
      mapOverride ?? new ExpiringMap<string, PendingMcpAuthBypassApproval>(),
  });
}

const MOCK_CONFIG: ApprovalFlowConfig = {
  tool: 'claude',
  action: 'retry_with_preauth',
  formatLoopMessage: (server) => `loop: ${server}`,
  formatApprovalText: (pending, sec) => `approve: ${pending.server} ${sec}s`,
  formatFallbackText: (server, sec) => `fallback: ${server} ${sec}s`,
};

/* ── noAuthServerResult ── */

describe('noAuthServerResult', () => {
  test('returns shouldReturn=false with original state', () => {
    const jpc = makeJpc();
    const result = noAuthServerResult(jpc);
    expect(result.shouldReturn).toBe(false);
    expect(result.env).toEqual({ FOO: 'bar' });
    expect(result.sessionToolState).toEqual({ existing: 'state' });
    expect(result.effectiveToolState).toEqual({ effective: true });
  });
});

describe('buildPreflightAbortResult', () => {
  test('normalizes null exit codes to 1 and truncates long output', () => {
    const longMessage = 'x'.repeat(4105);
    const result = buildPreflightAbortResult(null, 'mcp_auth_required', longMessage);
    expect(result.exitCode).toBe(1);
    expect(result.errorKind).toBe('mcp_auth_required');
    expect(result.outputRaw).toBe(longMessage);
    expect(result.outputSummary).toContain('… (truncated)');
    expect(result.outputSummary.length).toBeLessThan(longMessage.length);
  });
});

/* ── mergePreflightToolState ── */

describe('mergePreflightToolState', () => {
  const baseSession: ToolState = { old: 'value' } as unknown as ToolState;
  const baseEffective: ToolState = { eff: 'val' } as unknown as ToolState;

  test('success sets verified key and onSuccess keys', () => {
    const { sessionToolState, effectiveToolState } = mergePreflightToolState(
      baseSession,
      baseEffective,
      true,
      'my-server',
      {
        verified: 'verified_key',
        onSuccess: { bypass_key: undefined, init_key: 'my-server' },
      },
    );
    expect(sessionToolState.verified_key).toBe('my-server');
    expect(sessionToolState.init_key).toBe('my-server');
    expect(sessionToolState.bypass_key).toBeUndefined();
    expect(effectiveToolState.verified_key).toBe('my-server');
  });

  test('failure clears verified and clearOnFailure keys', () => {
    const { sessionToolState, effectiveToolState } = mergePreflightToolState(
      { ...baseSession, verified_key: 'old-server' } as unknown as ToolState,
      baseEffective,
      false,
      'my-server',
      {
        verified: 'verified_key',
        clearOnFailure: ['init_key', 'extra_key'],
      },
    );
    expect(sessionToolState.verified_key).toBeUndefined();
    expect(sessionToolState.init_key).toBeUndefined();
    expect(sessionToolState.extra_key).toBeUndefined();
    expect(effectiveToolState.verified_key).toBeUndefined();
  });

  test('preserves existing keys not in config', () => {
    const { sessionToolState } = mergePreflightToolState(baseSession, baseEffective, true, 'srv', {
      verified: 'v',
    });
    expect(sessionToolState.old).toBe('value');
  });
});

describe('diffToolStatePatch', () => {
  test('creates a minimal patch including deletions', () => {
    const patch = diffToolStatePatch(
      {
        keep: 'same',
        remove_me: 'old',
        change_me: 'before',
      } as ToolState,
      {
        keep: 'same',
        change_me: 'after',
        add_me: true,
      } as ToolState,
    );

    expect(patch).toEqual({
      remove_me: undefined,
      change_me: 'after',
      add_me: true,
    });
  });
});

/* ── createRetryJob ── */

describe('createRetryJob', () => {
  test('preserves original job fields', () => {
    const job = makeJob();
    const retry = createRetryJob(job, { auto_rerun: true });
    expect(retry.sessionKey).toBe(job.sessionKey);
    expect(retry.channelId).toBe(job.channelId);
    expect(retry.threadTs).toBe(job.threadTs);
    expect(retry.userId).toBe(job.userId);
    expect(retry.tool).toBe(job.tool);
    expect(retry.mode).toBe(job.mode);
    expect(retry.prompt).toBe(job.prompt);
    expect(retry.workdir).toBe(job.workdir);
  });

  test('generates new id', () => {
    const job = makeJob();
    const retry = createRetryJob(job, {});
    expect(retry.id).not.toBe(job.id);
  });

  test('merges toolStateOverrides', () => {
    const job = makeJob({ toolStateOverrides: { existing: 'yes' } });
    const retry = createRetryJob(job, { new_key: true });
    expect(retry.toolStateOverrides).toEqual({ existing: 'yes', new_key: true });
  });

  test('handles missing toolStateOverrides on original', () => {
    const job = makeJob() as Job & { toolStateOverrides?: Record<string, unknown> };
    delete job.toolStateOverrides;
    const retry = createRetryJob(job, { key: 'val' });
    expect(retry.toolStateOverrides).toEqual({ key: 'val' });
  });
});

/* ── registerMcpAuthApproval ── */

describe('registerMcpAuthApproval', () => {
  test('stores approval entry and returns it', () => {
    const ctx = makeCtx();
    const result = registerMcpAuthApproval(ctx, 'thread-1', {
      sessionKey: 'sk-1',
      tool: 'claude',
      server: 'my-server',
      action: 'retry_with_preauth',
      prompt: 'test prompt',
      userId: 'U123',
    });
    expect(result).not.toBeNull();
    expect(result?.tool).toBe('claude');
    expect(result?.server).toBe('my-server');
    expect(result?.action).toBe('retry_with_preauth');
    expect(result?.prompt).toBe('test prompt');
    expect(result?.userId).toBe('U123');
    expect(result?.requestId).toHaveLength(8);
    expect(result?.expiresAt).toBeGreaterThan(Date.now() - 5000);
    expect(ctx.pendingMcpAuthBypassApprovals.size).toBe(1);
  });

  test('generates unique requestId per call', () => {
    const ctx = makeCtx();
    const params = {
      sessionKey: 'sk-1',
      tool: 'claude' as const,
      server: 'srv',
      action: 'retry_with_preauth' as const,
      prompt: null,
      userId: 'U1',
    };
    const r1 = registerMcpAuthApproval(ctx, 'thread-a', params);
    const r2 = registerMcpAuthApproval(ctx, 'thread-b', params);
    expect(r1?.requestId).not.toBe(r2?.requestId);
  });

  test('returns null when map get fails', () => {
    const fakeMap = {
      set: vi.fn(),
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as ExpiringMap<string, PendingMcpAuthBypassApproval>;
    const ctx = makeCtx(fakeMap);
    const result = registerMcpAuthApproval(ctx, 'thread-1', {
      sessionKey: 'sk-1',
      tool: 'claude',
      server: 'srv',
      action: 'retry_with_preauth',
      prompt: null,
      userId: 'U1',
    });
    expect(result).toBeNull();
  });
});

/* ── handleApprovalFlow ── */

describe('handleApprovalFlow', () => {
  test('posts loop prevention message when isApprovalRerun=true', async () => {
    const { postMessageWithContext } = await import('./app-helpers.js');
    const mockPost = vi.mocked(postMessageWithContext);
    mockPost.mockClear();

    const ctx = makeCtx();
    const job = makeJob();
    await handleApprovalFlow(ctx, job, 'tk-1', 'my-server', true, MOCK_CONFIG);

    expect(mockPost).toHaveBeenCalledOnce();
    expect(mockPost.mock.calls[0]?.[4]).toBe('loop: my-server');
  });

  test('registers approval and posts blocks when isApprovalRerun=false', async () => {
    const { postMessageWithBlocks } = await import('./app-helpers.js');
    const mockBlocks = vi.mocked(postMessageWithBlocks);
    mockBlocks.mockClear();

    const ctx = makeCtx();
    const job = makeJob();
    await handleApprovalFlow(ctx, job, 'tk-1', 'my-server', false, MOCK_CONFIG);

    expect(ctx.pendingMcpAuthBypassApprovals.size).toBe(1);
    expect(mockBlocks).toHaveBeenCalledOnce();
    // approval text should include server and timeout
    const fallbackText = mockBlocks.mock.calls[0]?.[5] as string;
    expect(fallbackText).toContain('my-server');
  });

  test('posts fallback text when pending lookup returns null', async () => {
    const { postMessageWithContext } = await import('./app-helpers.js');
    const mockPost = vi.mocked(postMessageWithContext);
    mockPost.mockClear();

    // Use a fake map that stores but always returns undefined on get()
    const fakeMap = {
      set: vi.fn(),
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as ExpiringMap<string, PendingMcpAuthBypassApproval>;
    const ctx = makeCtx(fakeMap);
    const job = makeJob();
    await handleApprovalFlow(ctx, job, 'tk-1', 'srv', false, MOCK_CONFIG);

    // Should post fallback text (not blocks)
    const lastCall = mockPost.mock.calls.at(-1);
    expect(lastCall?.[4]).toContain('fallback: srv');
  });

  test('catches and logs errors without throwing', async () => {
    const { postMessageWithContext } = await import('./app-helpers.js');
    const mockPost = vi.mocked(postMessageWithContext);
    mockPost.mockClear().mockRejectedValueOnce(new Error('slack down'));

    const ctx = makeCtx();
    const job = makeJob();
    // Should not throw
    await expect(
      handleApprovalFlow(ctx, job, 'tk-1', 'srv', true, MOCK_CONFIG),
    ).resolves.toBeUndefined();
  });
});
