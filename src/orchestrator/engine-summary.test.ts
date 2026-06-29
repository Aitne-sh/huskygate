import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '../queue/types.js';
import {
  type SummaryJobParams,
  buildRunReport,
  buildSummaryInstruction,
  extractSummaryContent,
  startSummaryJob,
} from './engine-summary.js';
import type { EngineContext } from './engine.js';
import type { OrchestrationNodeRun, Orchestrator, OrchestratorNode } from './types.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-summary-'));
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

describe('engine-summary', () => {
  it('builds a readable run report', () => {
    const report = buildRunReport(makeParams());

    expect(report).toContain('# Orchestration Run Report');
    expect(report).toContain('Daily Review');
    expect(report).toContain('Fetch Data');
    expect(report).toContain('full output');
  });

  it('truncates oversized node output', () => {
    const longOutput = 'x'.repeat(9_000);
    const report = buildRunReport(
      makeParams({
        nodeRuns: [makeNodeRun({ outputFull: longOutput })],
      }),
    );

    expect(report).toContain('truncated at 8000 chars');
    expect(report.length).toBeLessThan(longOutput.length);
  });

  it('truncates oversized reports across many nodes', () => {
    const nodes = Array.from({ length: 20 }, (_, index) =>
      makeNode({
        id: `node-${index + 1}`,
        label: `Task ${index + 1}`,
      }),
    );
    const nodeRuns = Array.from({ length: 20 }, (_, index) =>
      makeNodeRun({
        id: `node-run-${index + 1}`,
        nodeId: `node-${index + 1}`,
        outputFull: 'x'.repeat(7_000),
      }),
    );
    const report = buildRunReport(
      makeParams({
        nodes,
        nodeRuns,
        nodeOrder: nodes.map((node) => node.id),
      }),
    );

    expect(report).toContain('overall run report truncated at 80000 chars');
    expect(report.length).toBeLessThanOrEqual(80_050);
  });

  it('creates a readonly summary job with MCP disabled and <summary> tag prompt', () => {
    const enqueueJob = vi.fn((_job: Job) => ({ position: 1 }));
    const summaryWorkdir = makeTempDir();
    const ctx = {
      orchestratorStore: {} as EngineContext['orchestratorStore'],
      createSession: vi.fn(() => ({ sessionKey: 'summary-sess', workdir: summaryWorkdir })),
      prepareWorkdir: vi.fn(),
      enqueueJob,
      cleanupSession: vi.fn(),
      postNotification: vi.fn(async () => null),
    } satisfies EngineContext;
    const params = makeParams();

    const started = startSummaryJob(ctx, params);
    expect(started).toBe(true);
    expect(ctx.createSession).toHaveBeenCalledWith('claude', 'user-1', 'readonly');

    const [firstCall] = enqueueJob.mock.calls;
    expect(firstCall).toBeDefined();
    if (!firstCall) throw new Error('Expected enqueueJob to be called');
    const [enqueuedJob] = firstCall;
    expect(enqueuedJob).toEqual(
      expect.objectContaining({
        mode: 'readonly',
        workdir: summaryWorkdir,
        source: 'orchestrator-summary',
        executionPolicy: { allowMcp: false, enabledSkills: [] },
        instructionOverride: buildSummaryInstruction(),
        toolStateOverrides: { claude_setting_sources: 'user' },
        summaryNotifyChannel: 'C123',
        summaryNotifyThreadTs: '123.456',
      }),
    );
    // Prompt embeds the run report directly (no tool use needed)
    const prompt = enqueuedJob.prompt as string;
    expect(prompt).toContain('Orchestration Run Report');
    expect(prompt).toContain('Daily Review');
    // Instruction forbids tool use and requires <summary> tags
    const instruction = enqueuedJob.instructionOverride as string;
    expect(instruction).toContain('<summary>');
    expect(instruction).toContain('</summary>');
    expect(instruction).toContain('Do not use any tools');
    expect(instruction).toContain('Markdown');
  });

  it('adds codex summary overrides needed for standalone readonly execution', () => {
    const enqueueJob = vi.fn((_job: Job) => ({ position: 1 }));
    const ctx = {
      orchestratorStore: {} as EngineContext['orchestratorStore'],
      createSession: vi.fn(() => ({ sessionKey: 'summary-sess', workdir: makeTempDir() })),
      prepareWorkdir: vi.fn(),
      enqueueJob,
      cleanupSession: vi.fn(),
      postNotification: vi.fn(async () => null),
    } satisfies EngineContext;

    const started = startSummaryJob(
      ctx,
      makeParams({
        orchestrator: makeOrchestrator({ summaryTool: 'codex' }),
      }),
    );

    expect(started).toBe(true);
    const [firstCall] = enqueueJob.mock.calls;
    expect(firstCall).toBeDefined();
    if (!firstCall) throw new Error('Expected enqueueJob to be called');
    const [enqueuedJob] = firstCall;
    expect(enqueuedJob.toolStateOverrides).toEqual({ codex_skip_git_repo_check: true });
  });

  it('returns undefined tool state overrides for gemini summary tool', () => {
    const enqueueJob = vi.fn((_job: Job) => ({ position: 1 }));
    const ctx = {
      orchestratorStore: {} as EngineContext['orchestratorStore'],
      createSession: vi.fn(() => ({ sessionKey: 'summary-sess', workdir: makeTempDir() })),
      prepareWorkdir: vi.fn(),
      enqueueJob,
      cleanupSession: vi.fn(),
      postNotification: vi.fn(async () => null),
    } satisfies EngineContext;

    const started = startSummaryJob(
      ctx,
      makeParams({
        orchestrator: makeOrchestrator({ summaryTool: 'gemini' }),
      }),
    );

    expect(started).toBe(true);
    const [firstCall] = enqueueJob.mock.calls;
    expect(firstCall).toBeDefined();
    if (!firstCall) throw new Error('Expected enqueueJob to be called');
    const [enqueuedJob] = firstCall;
    expect(enqueuedJob.toolStateOverrides).toBeUndefined();
  });

  it('includes errorMessage in run report when node has an error', () => {
    const report = buildRunReport(
      makeParams({
        nodeRuns: [
          makeNodeRun({
            status: 'failed',
            errorMessage: 'Connection timed out',
            exitCode: 1,
          }),
        ],
      }),
    );

    expect(report).toContain('- Error: Connection timed out');
  });

  it('uses outputSummary when outputFull is not available', () => {
    const report = buildRunReport(
      makeParams({
        nodeRuns: [
          makeNodeRun({
            outputFull: null,
            outputSummary: 'summary-only content',
          }),
        ],
      }),
    );

    expect(report).toContain('summary-only content');
    expect(report).not.toContain('full output');
  });

  it('includes gate results section when DAG has gate nodes', () => {
    const gateNode = makeNode({
      id: 'gate-1',
      label: 'Quality Gate',
      nodeType: 'gate',
      tool: null,
      prompt: null,
      gateCondition: { mode: 'and', matchValue: 'success' },
    });
    const taskNode = makeNode({ id: 'node-1', label: 'Fetch Data' });
    const gateRun = makeNodeRun({
      id: 'gate-run-1',
      nodeId: 'gate-1',
      returnValue: 'pass',
      gateEvaluation: 'all sources matched',
    });
    const taskRun = makeNodeRun({ id: 'node-run-1', nodeId: 'node-1' });

    const report = buildRunReport(
      makeParams({
        nodes: [taskNode, gateNode],
        nodeRuns: [taskRun, gateRun],
        nodeOrder: ['node-1', 'gate-1'],
      }),
    );

    expect(report).toContain('## Gate Results');
    expect(report).toContain('Quality Gate: pass (all sources matched)');
  });

  it('posts a failure notice when creating the summary session fails', async () => {
    const postNotification = vi.fn(async () => null);
    const ctx = {
      orchestratorStore: {} as EngineContext['orchestratorStore'],
      createSession: vi.fn(() => {
        throw new Error('session unavailable');
      }),
      prepareWorkdir: vi.fn(),
      enqueueJob: vi.fn(() => ({ position: 1 })),
      cleanupSession: vi.fn(),
      postNotification,
    } satisfies EngineContext;

    const started = startSummaryJob(ctx, makeParams());
    await Promise.resolve();

    expect(started).toBe(false);
    expect(postNotification).toHaveBeenCalledWith(
      'C123',
      ':warning: Execution summary could not start: session unavailable',
      '123.456',
    );
  });
});

describe('extractSummaryContent', () => {
  it('extracts content between <summary> tags', () => {
    const raw = 'Thinking...\n<summary>\n## Overview\nAll tasks passed.\n</summary>';
    expect(extractSummaryContent(raw)).toBe('## Overview\nAll tasks passed.');
  });

  it('returns null when no tags are present', () => {
    expect(extractSummaryContent('Just some text without tags')).toBeNull();
  });

  it('returns null when only opening tag is present', () => {
    expect(extractSummaryContent('<summary>content without closing tag')).toBeNull();
  });

  it('returns null when close tag comes before open tag', () => {
    expect(extractSummaryContent('</summary>content<summary>')).toBeNull();
  });

  it('returns null when content between tags is empty', () => {
    expect(extractSummaryContent('<summary></summary>')).toBeNull();
    expect(extractSummaryContent('<summary>   \n  </summary>')).toBeNull();
  });

  it('uses the last tag pair when AI retries produce multiple blocks', () => {
    const raw = [
      '<summary>Partial attempt 1</summary>',
      'Let me try again...',
      '<summary>\n## Overview\nFinal summary.\n</summary>',
    ].join('\n');
    expect(extractSummaryContent(raw)).toBe('## Overview\nFinal summary.');
  });

  it('preserves markdown formatting inside tags', () => {
    const raw = [
      'Thinking...',
      '<summary>',
      '## Results',
      '- **Task A**: Completed (exit 0)',
      '- **Task B**: Failed — timeout',
      '',
      '## Metrics',
      '- Total: 2 nodes, 1 failed',
      '</summary>',
    ].join('\n');
    const result = extractSummaryContent(raw);
    expect(result).toContain('## Results');
    expect(result).toContain('**Task A**');
    expect(result).toContain('## Metrics');
  });
});
