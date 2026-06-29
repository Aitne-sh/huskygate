/**
 * Coverage tests for engine-summary — targets uncovered ?? branch fallbacks:
 * nodeRun.outputFull ?? outputSummary, nodeRun.exitCode ?? 'N/A', formatNodeDuration edge cases,
 * truncateOutput, truncateRunReport, extractSummaryContent edge cases, buildSummaryToolStateOverrides.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-summary-cov2-'));
  tempDirs.push(dir);
  return dir;
}

function makeOrchestrator(overrides: Partial<Orchestrator> = {}): Orchestrator {
  return {
    id: 'orch-1',
    name: 'Review',
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

describe('engine-summary branch coverage', () => {
  // ── buildRunReport: node with null exitCode, null returnValue, errorMessage ──
  it('buildRunReport handles null exitCode and returnValue', () => {
    const report = buildRunReport(
      makeParams({
        nodeRuns: [
          makeNodeRun({
            exitCode: null,
            returnValue: null,
            errorMessage: 'Some error',
          }),
        ],
      }),
    );
    expect(report).toContain('Exit Code: N/A');
    expect(report).toContain('Return Value: (none)');
    expect(report).toContain('Error: Some error');
  });

  // ── buildRunReport: node with null outputFull falls back to outputSummary ──
  it('buildRunReport uses outputSummary when outputFull is null', () => {
    const report = buildRunReport(
      makeParams({
        nodeRuns: [makeNodeRun({ outputFull: null, outputSummary: 'summary only' })],
      }),
    );
    expect(report).toContain('summary only');
  });

  // ── buildRunReport: nodeRun with null startedAt or endedAt ──
  it('buildRunReport handles null startedAt/endedAt for duration', () => {
    const report = buildRunReport(
      makeParams({
        nodeRuns: [makeNodeRun({ startedAt: null, endedAt: null })],
      }),
    );
    expect(report).toContain('Duration: N/A');
  });

  // ── buildRunReport: very long output gets truncated ──
  it('buildRunReport truncates long output', () => {
    const longOutput = 'x'.repeat(50000);
    const report = buildRunReport(
      makeParams({
        nodeRuns: [makeNodeRun({ outputFull: longOutput })],
      }),
    );
    expect(report).toContain('truncated');
  });

  // ── buildRunReport: very long total report gets truncated ──
  it('buildRunReport truncates entire report if too long', () => {
    // Create many nodes to make the report very long
    const nodes: OrchestratorNode[] = [];
    const nodeRuns: OrchestrationNodeRun[] = [];
    const nodeOrder: string[] = [];
    for (let i = 0; i < 200; i++) {
      const nodeId = `node-${i}`;
      nodes.push(makeNode({ id: nodeId, label: `Task ${i}` }));
      nodeRuns.push(
        makeNodeRun({
          id: `nr-${i}`,
          nodeId,
          outputFull: 'x'.repeat(2000),
        }),
      );
      nodeOrder.push(nodeId);
    }
    const report = buildRunReport(makeParams({ nodes, nodeRuns, nodeOrder }));
    expect(report).toContain('overall run report truncated');
  });

  // ── buildRunReport: failed and skipped node counts ──
  it('buildRunReport counts failed and skipped nodes', () => {
    const report = buildRunReport(
      makeParams({
        nodeRuns: [
          makeNodeRun({ status: 'failed' }),
          makeNodeRun({ id: 'nr-2', nodeId: 'node-2', status: 'skipped' }),
          makeNodeRun({ id: 'nr-3', nodeId: 'node-3', status: 'cancelled' }),
        ],
        nodes: [makeNode(), makeNode({ id: 'node-2' }), makeNode({ id: 'node-3' })],
        nodeOrder: ['node-1', 'node-2', 'node-3'],
      }),
    );
    expect(report).toContain('1 failed');
    expect(report).toContain('2 skipped');
  });

  // ── buildRunReport: gate node with gateEvaluation present ──
  it('buildRunReport includes gateEvaluation in gate section', () => {
    const gateNode = makeNode({
      id: 'gate-1',
      label: 'Gate',
      nodeType: 'gate',
      tool: null,
      prompt: null,
    });
    const gateRun = makeNodeRun({
      id: 'gate-run-1',
      nodeId: 'gate-1',
      returnValue: 'true',
      gateEvaluation: '{"mode":"all_match","result":"true"}',
    });
    const report = buildRunReport(
      makeParams({
        nodes: [makeNode(), gateNode],
        nodeRuns: [makeNodeRun(), gateRun],
        nodeOrder: ['node-1', 'gate-1'],
      }),
    );
    expect(report).toContain('## Gate Results');
    expect(report).toContain('Gate: true');
    expect(report).toContain('all_match');
  });

  // ── buildRunReport: node.tool null shows 'unknown' ──
  it('buildRunReport shows unknown for null tool', () => {
    const report = buildRunReport(
      makeParams({
        nodes: [makeNode({ tool: null })],
      }),
    );
    expect(report).toContain('(unknown)');
  });

  // ── extractSummaryContent: no open tag ──
  it('extractSummaryContent returns null when no tags', () => {
    expect(extractSummaryContent('no tags here')).toBeNull();
  });

  // ── extractSummaryContent: open but no close ──
  it('extractSummaryContent returns null with only open tag', () => {
    expect(extractSummaryContent('<summary>content')).toBeNull();
  });

  // ── extractSummaryContent: empty content ──
  it('extractSummaryContent returns null for empty content between tags', () => {
    expect(extractSummaryContent('<summary></summary>')).toBeNull();
  });

  // ── extractSummaryContent: whitespace-only content ──
  it('extractSummaryContent returns null for whitespace between tags', () => {
    expect(extractSummaryContent('<summary>   </summary>')).toBeNull();
  });

  // ── extractSummaryContent: valid content ──
  it('extractSummaryContent extracts trimmed content', () => {
    const result = extractSummaryContent('<summary>\n## Overview\nAll good\n</summary>');
    expect(result).toBe('## Overview\nAll good');
  });

  // ── extractSummaryContent: multiple pairs uses last ──
  it('extractSummaryContent uses last pair of tags', () => {
    const result = extractSummaryContent(
      '<summary>first</summary> ignore <summary>second</summary>',
    );
    expect(result).toBe('second');
  });

  // ── buildSummaryInstruction contains expected structure ──
  it('buildSummaryInstruction returns structured instruction', () => {
    const instruction = buildSummaryInstruction();
    expect(instruction).toContain('Task Summary Agent');
    expect(instruction).toContain('<summary>');
    expect(instruction).toContain('Constraints');
  });

  // ── startSummaryJob with codex tool: toolStateOverrides ──
  it('startSummaryJob uses codex tool state overrides', () => {
    const enqueueJob = vi.fn(() => ({ position: 1 }));
    const ctx = {
      orchestratorStore: {} as EngineContext['orchestratorStore'],
      createSession: vi.fn(() => ({
        sessionKey: 'summary-sess',
        workdir: makeTempDir(),
      })),
      prepareWorkdir: vi.fn(),
      enqueueJob,
      cleanupSession: vi.fn(),
      postNotification: vi.fn(async () => null),
    } satisfies EngineContext;

    const result = startSummaryJob(
      ctx,
      makeParams({
        orchestrator: makeOrchestrator({ summaryTool: 'codex' }),
      }),
    );
    expect(result).toBe(true);
    const job = (enqueueJob.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
    expect(job.toolStateOverrides).toEqual({ codex_skip_git_repo_check: true });
  });

  // ── startSummaryJob with gemini tool: no toolStateOverrides ──
  it('startSummaryJob with gemini has no toolStateOverrides', () => {
    const enqueueJob = vi.fn(() => ({ position: 1 }));
    const ctx = {
      orchestratorStore: {} as EngineContext['orchestratorStore'],
      createSession: vi.fn(() => ({
        sessionKey: 'summary-sess',
        workdir: makeTempDir(),
      })),
      prepareWorkdir: vi.fn(),
      enqueueJob,
      cleanupSession: vi.fn(),
      postNotification: vi.fn(async () => null),
    } satisfies EngineContext;

    const result = startSummaryJob(
      ctx,
      makeParams({
        orchestrator: makeOrchestrator({ summaryTool: 'gemini' }),
      }),
    );
    expect(result).toBe(true);
    const job = (enqueueJob.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
    expect(job.toolStateOverrides).toBeUndefined();
  });

  // ── startSummaryJob with claude tool: claude_setting_sources override ──
  it('startSummaryJob with claude sets claude_setting_sources', () => {
    const enqueueJob = vi.fn(() => ({ position: 1 }));
    const ctx = {
      orchestratorStore: {} as EngineContext['orchestratorStore'],
      createSession: vi.fn(() => ({
        sessionKey: 'summary-sess',
        workdir: makeTempDir(),
      })),
      prepareWorkdir: vi.fn(),
      enqueueJob,
      cleanupSession: vi.fn(),
      postNotification: vi.fn(async () => null),
    } satisfies EngineContext;

    const result = startSummaryJob(
      ctx,
      makeParams({
        orchestrator: makeOrchestrator({ summaryTool: 'claude' }),
      }),
    );
    expect(result).toBe(true);
    const job = (enqueueJob.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
    expect(job.toolStateOverrides).toEqual({ claude_setting_sources: 'user' });
  });
});
