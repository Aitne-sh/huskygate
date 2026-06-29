import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatDuration,
  getInstructionFilePath,
  listCustomWorkdirs,
  resolveNodeInstructionFile,
  resolveNodeWorkdir,
  resolveWorkdir,
  sanitizeForPath,
} from './engine-utils.js';
import type { Orchestrator, OrchestratorNode } from './types.js';

function makeOrchestrator(overrides?: Partial<Orchestrator>): Orchestrator {
  return {
    id: 'orch-1',
    name: 'Pipeline',
    alias: null,
    description: null,
    userId: 'user-1',
    workdir: '/tmp/huskygate-orch',
    startNodeId: 'node-1',
    triggerMode: 'ondemand',
    scheduleType: null,
    runAt: null,
    cronExpr: null,
    timezone: 'UTC',
    notifyChannel: null,
    maxParallelism: 3,
    maxTotalNodes: 50,
    errorPolicy: 'continue',
    timeoutSec: null,
    instructionFile: null,
    enabledSkills: null,
    summaryEnabled: false,
    summaryTool: null,
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

function makeNode(overrides?: Partial<OrchestratorNode>): OrchestratorNode {
  return {
    id: 'node-1',
    orchestratorId: 'orch-1',
    label: 'Task One',
    nodeType: 'task',
    tool: 'claude',
    mode: 'write',
    prompt: 'Run',
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
    notifyOnError: true,
    positionX: 0,
    positionY: 0,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as OrchestratorNode;
}

describe('engine-utils', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the orchestrator workdir when present and falls back to cwd otherwise', () => {
    const result = resolveWorkdir(
      makeOrchestrator({ workdir: '/tmp/custom-workdir' }),
      'run-12345678',
    );
    expect(result).toBe('/tmp/custom-workdir');

    // Fallback uses cwd-based path with run ID prefix
    expect(resolveWorkdir(makeOrchestrator({ workdir: null }), 'run-12345678')).toContain(
      `${path.sep}workdir${path.sep}orch_run-1234`,
    );
  });

  it('prefers node-level workdir over orchestrator-level workdir', () => {
    expect(
      resolveNodeWorkdir(
        makeOrchestrator({ workdir: '/tmp/orchestrator-workdir' }),
        makeNode({ workdir: '/tmp/node-workdir' }),
        'run-12345678',
      ),
    ).toBe('/tmp/node-workdir');
    expect(
      resolveNodeWorkdir(
        makeOrchestrator({ workdir: '/tmp/orchestrator-workdir' }),
        makeNode({ workdir: null }),
        'run-12345678',
      ),
    ).toBe('/tmp/orchestrator-workdir');
  });

  it('resolves instruction file settings with skip and fallback semantics', () => {
    expect(
      resolveNodeInstructionFile(
        makeOrchestrator({ instructionFile: '# orch' }),
        makeNode({ writeInstructionFile: false, instructionFile: '# node' }),
      ),
    ).toEqual({ skip: true, content: null });
    expect(
      resolveNodeInstructionFile(
        makeOrchestrator({ instructionFile: '# orch' }),
        makeNode({ instructionFile: '# node' }),
      ),
    ).toEqual({ skip: false, content: '# node' });
    expect(
      resolveNodeInstructionFile(
        makeOrchestrator({ instructionFile: '# orch' }),
        makeNode({ instructionFile: null }),
      ),
    ).toEqual({ skip: false, content: '# orch' });
  });

  it('lists custom workdirs for orchestrators and task nodes only', () => {
    expect(
      listCustomWorkdirs(makeOrchestrator({ workdir: '/tmp/orchestrator-workdir' }), [
        makeNode({ label: 'Task One', workdir: '/tmp/task-one' }),
        makeNode({
          id: 'node-2',
          label: 'Gate',
          nodeType: 'gate',
          tool: null,
          prompt: null,
          workdir: '/tmp/ignored',
        }),
      ]),
    ).toEqual([
      { scope: 'orchestrator', workdir: '/tmp/orchestrator-workdir' },
      { scope: 'node', nodeLabel: 'Task One', workdir: '/tmp/task-one' },
    ]);
  });

  it('returns the correct instruction file path for each tool', () => {
    expect(getInstructionFilePath('/tmp/workdir', 'codex')).toBe('/tmp/workdir/AGENTS.md');
    expect(getInstructionFilePath('/tmp/workdir', 'gemini')).toBe('/tmp/workdir/GEMINI.md');
    expect(getInstructionFilePath('/tmp/workdir', 'claude')).toBe('/tmp/workdir/CLAUDE.md');
  });

  it('formats durations across seconds, minutes, and hours', () => {
    expect(formatDuration(59_000)).toBe('59s');
    expect(formatDuration(61_000)).toBe('1m 1s');
    expect(formatDuration(3_660_000)).toBe('1h 1m');
  });
});

describe('sanitizeForPath', () => {
  it('replaces unsafe characters with underscores', () => {
    expect(sanitizeForPath('../../etc/passwd')).toBe('______etc_passwd');
  });

  it('keeps alphanumeric, hyphen, and underscore', () => {
    expect(sanitizeForPath('my-task_01')).toBe('my-task_01');
  });

  it('truncates to 100 characters', () => {
    const longName = 'a'.repeat(150);
    expect(sanitizeForPath(longName).length).toBe(100);
  });

  it('returns underscore for empty input', () => {
    expect(sanitizeForPath('')).toBe('_');
  });

  it('replaces spaces with underscores', () => {
    expect(sanitizeForPath('Deploy to Staging')).toBe('Deploy_to_Staging');
  });
});
