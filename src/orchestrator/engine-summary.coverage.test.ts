/**
 * Coverage tests for engine-summary — covers uncovered branches: enqueue failure, cleanup failure paths.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Job type import removed — unused in this file
import {
  type SummaryJobParams,
  buildRunReport,
  buildSummaryPrompt,
  startSummaryJob,
} from './engine-summary.js';
import type { EngineContext } from './engine.js';
import type { OrchestrationNodeRun, Orchestrator, OrchestratorNode } from './types.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-summary-cov-'));
  tempDirs.push(dir);
  return dir;
}

function makeOrchestrator(overrides: Partial<Orchestrator> = {}): Orchestrator {
  return {
    id: 'orch-1',
    name: 'Daily Review',
    alias: null,
    description: null,
    userId: 'user-1',
    workdir: makeTempDir(),
    startNodeId: 'node-1',
    triggerMode: 'ondemand',
    scheduleType: null,
    runAt: null,
    cronExpr: null,
    timezone: 'UTC',
    notifyChannel: 'C123',
    maxParallelism: 3,
    maxTotalNodes: 50,
    errorPolicy: 'continue',
    timeoutSec: null,
    instructionFile: null,
    enabledSkills: null,
    summaryEnabled: true,
    summaryTool: 'claude',
    maxRunWorkdirs: 20,
    status: 'active',
    dagValidated: true,
    lastRunAt: null,
    runCount: 0,
    nextRunAt: null,
    claimedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeNode(overrides: Partial<OrchestratorNode> = {}): OrchestratorNode {
  return {
    id: 'node-1',
    orchestratorId: 'orch-1',
    label: 'Fetch Data',
    nodeType: 'task',
    tool: 'claude',
    mode: 'write',
    prompt: 'Fetch data',
    maxRetries: 0,
    timeoutSec: null,
    allowMcp: true,
    workdir: null,
    writeInstructionFile: true,
    instructionFile: null,
    outputMode: 'auto',
    returnConditions: null,
    returnValues: null,
    gateCondition: null,
    notifyEnabled: false,
    notifyChannel: null,
    notifyOnError: false,
    positionX: 0,
    positionY: 0,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as OrchestratorNode;
}

function makeNodeRun(overrides: Partial<OrchestrationNodeRun> = {}): OrchestrationNodeRun {
  return {
    id: 'node-run-1',
    orchestrationRunId: 'run-1',
    nodeId: 'node-1',
    jobId: 'job-1',
    sessionKey: 'sess-1',
    status: 'completed',
    prompt: null,
    returnValue: 'success',
    exitCode: 0,
    outputSummary: 'summary output',
    outputFull: 'full output',
    errorMessage: null,
    gateEvaluation: null,
    retryCount: 0,
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: '2026-01-01T00:00:05Z',
    ...overrides,
  };
}

function makeParams(overrides: Partial<SummaryJobParams> = {}): SummaryJobParams {
  return {
    orchestrator: makeOrchestrator(),
    runId: 'run-1',
    status: 'completed',
    startedAt: Date.parse('2026-01-01T00:00:00Z'),
    endedAt: '2026-01-01T00:00:30Z',
    nodeRuns: [makeNodeRun()],
    nodes: [makeNode()],
    nodeOrder: ['node-1'],
    notifyChannelId: 'C123',
    notifyThreadTs: '123.456',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('startSummaryJob — uncovered branches', () => {
  it('returns false when summaryTool is not set', () => {
    const ctx = {
      orchestratorStore: {} as EngineContext['orchestratorStore'],
      createSession: vi.fn(),
      prepareWorkdir: vi.fn(),
      enqueueJob: vi.fn(),
      cleanupSession: vi.fn(),
      postNotification: vi.fn(async () => null),
    } satisfies EngineContext;

    const result = startSummaryJob(
      ctx,
      makeParams({
        orchestrator: makeOrchestrator({ summaryTool: null }),
      }),
    );
    expect(result).toBe(false);
    expect(ctx.createSession).not.toHaveBeenCalled();
  });

  it('returns false and notifies when enqueueJob throws', async () => {
    const postNotification = vi.fn(async () => null);
    const cleanupSession = vi.fn();
    const ctx = {
      orchestratorStore: {} as EngineContext['orchestratorStore'],
      createSession: vi.fn(() => ({ sessionKey: 'summary-sess', workdir: makeTempDir() })),
      prepareWorkdir: vi.fn(),
      enqueueJob: vi.fn(() => {
        throw new Error('queue full');
      }),
      cleanupSession,
      postNotification,
    } satisfies EngineContext;

    const result = startSummaryJob(ctx, makeParams());
    await Promise.resolve();

    expect(result).toBe(false);
    expect(cleanupSession).toHaveBeenCalledWith('summary-sess');
    expect(postNotification).toHaveBeenCalledWith(
      'C123',
      expect.stringContaining('queue full'),
      '123.456',
    );
  });

  it('returns false and notifies when enqueueJob returns error', async () => {
    const postNotification = vi.fn(async () => null);
    const cleanupSession = vi.fn();
    const ctx = {
      orchestratorStore: {} as EngineContext['orchestratorStore'],
      createSession: vi.fn(() => ({ sessionKey: 'summary-sess', workdir: makeTempDir() })),
      prepareWorkdir: vi.fn(),
      enqueueJob: vi.fn(() => ({ error: 'Queue shutting down' })),
      cleanupSession,
      postNotification,
    } satisfies EngineContext;

    const result = startSummaryJob(ctx, makeParams());
    await Promise.resolve();

    expect(result).toBe(false);
    expect(cleanupSession).toHaveBeenCalled();
  });

  it('handles cleanup failure during enqueue throw gracefully', async () => {
    const postNotification = vi.fn(async () => null);
    const ctx = {
      orchestratorStore: {} as EngineContext['orchestratorStore'],
      createSession: vi.fn(() => ({ sessionKey: 'summary-sess', workdir: makeTempDir() })),
      prepareWorkdir: vi.fn(),
      enqueueJob: vi.fn(() => {
        throw new Error('queue full');
      }),
      cleanupSession: vi.fn(() => {
        throw new Error('cleanup also failed');
      }),
      postNotification,
    } satisfies EngineContext;

    const result = startSummaryJob(ctx, makeParams());
    expect(result).toBe(false);
  });

  it('handles cleanup failure during enqueue error gracefully', async () => {
    const postNotification = vi.fn(async () => null);
    const ctx = {
      orchestratorStore: {} as EngineContext['orchestratorStore'],
      createSession: vi.fn(() => ({ sessionKey: 'summary-sess', workdir: makeTempDir() })),
      prepareWorkdir: vi.fn(),
      enqueueJob: vi.fn(() => ({ error: 'Queue shutting down' })),
      cleanupSession: vi.fn(() => {
        throw new Error('cleanup failed');
      }),
      postNotification,
    } satisfies EngineContext;

    const result = startSummaryJob(ctx, makeParams());
    expect(result).toBe(false);
  });

  it('notifySummaryFailure does nothing when postNotification is not set', () => {
    const ctx = {
      orchestratorStore: {} as EngineContext['orchestratorStore'],
      createSession: vi.fn(() => {
        throw new Error('session unavailable');
      }),
      prepareWorkdir: vi.fn(),
      enqueueJob: vi.fn(),
      cleanupSession: vi.fn(),
      // No postNotification
    } satisfies EngineContext;

    const result = startSummaryJob(ctx, makeParams());
    expect(result).toBe(false);
  });

  it('handles postNotification rejection in notifySummaryFailure', async () => {
    const postNotification = vi.fn(async () => {
      throw new Error('Slack API down');
    }) as EngineContext['postNotification'];
    const ctx = {
      orchestratorStore: {} as EngineContext['orchestratorStore'],
      createSession: vi.fn(() => {
        throw new Error('session unavailable');
      }),
      prepareWorkdir: vi.fn(),
      enqueueJob: vi.fn(),
      cleanupSession: vi.fn(),
      postNotification,
    } satisfies EngineContext;

    const result = startSummaryJob(ctx, makeParams());
    // Wait for the void promise to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(result).toBe(false);
  });
});

describe('buildRunReport — edge cases', () => {
  it('skips nodes not in nodeOrder', () => {
    const report = buildRunReport(
      makeParams({
        nodeOrder: [],
      }),
    );
    expect(report).not.toContain('Fetch Data');
  });

  it('handles no output for a node', () => {
    const report = buildRunReport(
      makeParams({
        nodeRuns: [makeNodeRun({ outputFull: null, outputSummary: null })],
      }),
    );
    expect(report).not.toContain('```text');
  });

  it('handles gate node without gateEvaluation', () => {
    const gateNode = makeNode({
      id: 'gate-1',
      label: 'Quality Gate',
      nodeType: 'gate',
      tool: null,
      prompt: null,
    });
    const gateRun = makeNodeRun({
      id: 'gate-run-1',
      nodeId: 'gate-1',
      returnValue: 'pass',
      gateEvaluation: null,
    });

    const report = buildRunReport(
      makeParams({
        nodes: [makeNode(), gateNode],
        nodeRuns: [makeNodeRun(), gateRun],
        nodeOrder: ['node-1', 'gate-1'],
      }),
    );
    expect(report).toContain('Quality Gate: pass');
  });

  it('skips non-matching nodes in gate report', () => {
    const report = buildRunReport(
      makeParams({
        nodes: [makeNode()],
        nodeRuns: [makeNodeRun()],
        nodeOrder: ['node-1'],
      }),
    );
    // task node should not appear in Gate Results section
    expect(report).not.toContain('## Gate Results');
  });
});

describe('buildSummaryPrompt', () => {
  it('embeds the report in the prompt', () => {
    const report = '# Test Report\nSome data';
    const prompt = buildSummaryPrompt(report);
    expect(prompt).toContain(report);
    expect(prompt).toContain('Produce the execution summary');
  });
});
