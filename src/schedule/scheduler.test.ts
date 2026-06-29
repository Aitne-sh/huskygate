import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config.js';
import type { OrchestratorEngine } from '../orchestrator/engine.js';
import type { JobQueue } from '../queue/job-queue.js';
import type { SessionManager } from '../session/manager.js';
import type { OrchestratorStore } from '../store/orchestrator.js';
import type { ScheduleStore, ScheduledTask } from '../store/schedule.js';
import type { TriggeredTaskStore } from '../store/triggered-task.js';
import type { WorkdirManager } from '../workdir/manager.js';
import { Scheduler } from './scheduler.js';

function createTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    name: 'daily report',
    description: null,
    userId: 'U1',
    tool: 'claude',
    model: null,
    mode: 'readonly',
    prompt: 'summarize latest incidents',
    workdir: null,
    scheduleType: 'once',
    runAt: null,
    cronExpr: null,
    timezone: 'UTC',
    notifyChannel: null,
    notifyThread: null,
    status: 'active',
    lastRunAt: null,
    nextRunAt: '2026-01-01T00:00:00.000Z',
    runCount: 0,
    maxRuns: null,
    maxRetries: 0,
    allowMcp: true,
    enabledSkills: null,
    instructionFile: null,
    agentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface MockDeps {
  scheduleStore: {
    getDueTasks: ReturnType<typeof vi.fn>;
    claimTask: ReturnType<typeof vi.fn>;
    releaseClaim: ReturnType<typeof vi.fn>;
    recoverStaleClaims: ReturnType<typeof vi.fn>;
    recordRun: ReturnType<typeof vi.fn>;
    updateRun: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  sessionManager: {
    createStandaloneSession: ReturnType<typeof vi.fn>;
    updateMode: ReturnType<typeof vi.fn>;
  };
  jobQueue: {
    enqueue: ReturnType<typeof vi.fn>;
  };
  workdirManager: {
    prepareWorkdirForToolWithPolicy: ReturnType<typeof vi.fn>;
    prepareWorkdirSkillsOnly: ReturnType<typeof vi.fn>;
  };
  config: Config;
}

interface MockOrchDeps {
  orchestratorStore: {
    recoverStaleClaims: ReturnType<typeof vi.fn>;
    getDueOrchestrators: ReturnType<typeof vi.fn>;
    claimOrchestrator: ReturnType<typeof vi.fn>;
    releaseClaim: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  orchestratorEngine: {
    startRun: ReturnType<typeof vi.fn>;
  };
}

function createMockDeps(maxConcurrent = 2): MockDeps {
  return {
    scheduleStore: {
      getDueTasks: vi.fn(() => []),
      claimTask: vi.fn((id: string) => {
        // Default: return the task (claim succeeds)
        return createTask({ id });
      }),
      releaseClaim: vi.fn(),
      recoverStaleClaims: vi.fn(() => 0),
      recordRun: vi.fn(),
      updateRun: vi.fn(),
      update: vi.fn(),
    },
    sessionManager: {
      createStandaloneSession: vi.fn(() => ({
        sessionKey: 'sess-1',
        workdir: '/tmp/huskygate-scheduler-test/sess-1',
      })),
      updateMode: vi.fn(),
    },
    jobQueue: {
      enqueue: vi.fn(() => ({ position: 0 })),
    },
    workdirManager: {
      prepareWorkdirForToolWithPolicy: vi.fn(),
      prepareWorkdirSkillsOnly: vi.fn(),
    },
    config: { scheduleMaxConcurrent: maxConcurrent } as Config,
  };
}

describe('Scheduler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enqueues a due once task without setting status (deferred to job-executor)', async () => {
    const task = createTask({ mode: 'write' });
    const deps = createMockDeps(2);
    deps.scheduleStore.getDueTasks.mockReturnValue([task]);
    deps.scheduleStore.claimTask.mockReturnValue(task);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-1111-1111-111111111111');

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
    });

    await scheduler.tick();

    expect(deps.sessionManager.createStandaloneSession).toHaveBeenCalledWith(
      task.tool,
      task.userId,
    );
    expect(deps.workdirManager.prepareWorkdirSkillsOnly).toHaveBeenCalledWith(
      '/tmp/huskygate-scheduler-test/sess-1',
      task.tool,
      task.enabledSkills,
    );
    expect(deps.sessionManager.updateMode).toHaveBeenCalledWith('sess-1', 'write', null);
    expect(deps.scheduleStore.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '11111111-1111-1111-1111-111111111111',
        taskId: task.id,
        sessionKey: 'sess-1',
        status: 'running',
      }),
    );
    expect(deps.jobQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '11111111-1111-1111-1111-111111111111',
        sessionKey: 'sess-1',
        source: 'schedule',
        scheduleTaskId: task.id,
        scheduleRunId: '11111111-1111-1111-1111-111111111111',
        autoApprove: true,
      }),
    );
    // Status should NOT be set at enqueue time — deferred to job-executor
    const updateCall = deps.scheduleStore.update.mock.calls[0];
    expect(updateCall).toBeDefined();
    expect(updateCall?.[0]).toBe(task.id);
    expect(updateCall?.[1]).toEqual(expect.objectContaining({ nextRunAt: null, runCount: 1 }));
    expect(updateCall?.[1]).not.toHaveProperty('status');
  });

  it('injects task model into toolStateOverrides when model is set', async () => {
    const task = createTask({ model: 'claude-opus-4-6' });
    const deps = createMockDeps(2);
    deps.scheduleStore.getDueTasks.mockReturnValue([task]);
    deps.scheduleStore.claimTask.mockReturnValue(task);

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
    });

    await scheduler.tick();

    expect(deps.jobQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        toolStateOverrides: { model: 'claude-opus-4-6' },
      }),
    );
  });

  it('does not include toolStateOverrides when task model is null', async () => {
    const task = createTask({ model: null });
    const deps = createMockDeps(2);
    deps.scheduleStore.getDueTasks.mockReturnValue([task]);
    deps.scheduleStore.claimTask.mockReturnValue(task);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('model-null-test-uuid-0000-000000000000' as `${string}-${string}-${string}-${string}-${string}`);

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
    });

    await scheduler.tick();

    const jobArg = deps.jobQueue.enqueue.mock.calls[0]?.[0];
    expect(jobArg).toBeDefined();
    expect(jobArg.toolStateOverrides).toBeUndefined();
  });

  it('marks run as failed when enqueue fails', async () => {
    const task = createTask();
    const deps = createMockDeps(2);
    deps.scheduleStore.getDueTasks.mockReturnValue([task]);
    deps.scheduleStore.claimTask.mockReturnValue(task);
    deps.jobQueue.enqueue.mockReturnValue({ error: 'Queue full' });
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('22222222-2222-2222-2222-222222222222');

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
    });

    await scheduler.tick();

    expect(deps.scheduleStore.updateRun).toHaveBeenCalledWith(
      '22222222-2222-2222-2222-222222222222',
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'Enqueue failed: Queue full',
      }),
    );
    expect(deps.scheduleStore.update).not.toHaveBeenCalled();
    // Claim should be released on enqueue failure so the task can retry
    expect(deps.scheduleStore.releaseClaim).toHaveBeenCalledWith(task.id);
  });

  it('respects scheduleMaxConcurrent per tick', async () => {
    const task1 = createTask({ id: 'task-1' });
    const task2 = createTask({ id: 'task-2' });
    const deps = createMockDeps(1);
    deps.scheduleStore.getDueTasks.mockReturnValue([task1, task2]);
    deps.scheduleStore.claimTask.mockImplementation(
      (id: string) => [task1, task2].find((task) => task.id === id) ?? null,
    );
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('33333333-3333-3333-3333-333333333333');

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
    });

    await scheduler.tick();

    expect(deps.jobQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(deps.scheduleStore.recordRun).toHaveBeenCalledTimes(1);
  });

  it('sets nextRunAt=null for recurring tasks with no future runs (status deferred)', async () => {
    const recurring = createTask({
      id: 'task-recurring',
      scheduleType: 'recurring',
      cronExpr: 'bad cron',
      runCount: 2,
    });
    const deps = createMockDeps(2);
    deps.scheduleStore.getDueTasks.mockReturnValue([recurring]);
    deps.scheduleStore.claimTask.mockReturnValue(recurring);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('44444444-4444-4444-4444-444444444444');

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
    });

    await scheduler.tick();

    const updateCall = deps.scheduleStore.update.mock.calls[0];
    expect(updateCall).toBeDefined();
    expect(updateCall?.[0]).toBe(recurring.id);
    expect(updateCall?.[1]).toEqual(expect.objectContaining({ nextRunAt: null, runCount: 3 }));
    // Status should NOT be set — deferred to job-executor
    expect(updateCall?.[1]).not.toHaveProperty('status');
    // Claim should be kept for terminal recurring (same as once-tasks)
    expect(deps.scheduleStore.releaseClaim).not.toHaveBeenCalled();
  });

  it('skips tasks that are already claimed by another process', async () => {
    const task = createTask();
    const deps = createMockDeps(2);
    deps.scheduleStore.getDueTasks.mockReturnValue([task]);
    // claimTask returns null → task already claimed by another process
    deps.scheduleStore.claimTask.mockReturnValue(null);

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
    });

    await scheduler.tick();

    expect(deps.sessionManager.createStandaloneSession).not.toHaveBeenCalled();
    expect(deps.jobQueue.enqueue).not.toHaveBeenCalled();
    expect(deps.scheduleStore.recordRun).not.toHaveBeenCalled();
  });

  it('releases claim when enqueue fails', async () => {
    const task = createTask();
    const deps = createMockDeps(2);
    deps.scheduleStore.getDueTasks.mockReturnValue([task]);
    deps.scheduleStore.claimTask.mockReturnValue(task);
    deps.jobQueue.enqueue.mockReturnValue({ error: 'Queue full' });
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('55555555-5555-5555-5555-555555555555');

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
    });

    await scheduler.tick();

    expect(deps.scheduleStore.releaseClaim).toHaveBeenCalledWith(task.id);
  });

  it('releases claim for recurring tasks that remain active', async () => {
    const recurring = createTask({
      id: 'task-recurring',
      scheduleType: 'recurring',
      cronExpr: '0 9 * * *',
      runCount: 0,
      maxRuns: 10,
    });
    const deps = createMockDeps(2);
    deps.scheduleStore.getDueTasks.mockReturnValue([recurring]);
    deps.scheduleStore.claimTask.mockReturnValue(recurring);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('66666666-6666-6666-6666-666666666666');

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
    });

    await scheduler.tick();

    expect(deps.scheduleStore.releaseClaim).toHaveBeenCalledWith(recurring.id);
  });

  it('does not release claim for once tasks (status deferred to job-executor)', async () => {
    const task = createTask({ scheduleType: 'once' });
    const deps = createMockDeps(2);
    deps.scheduleStore.getDueTasks.mockReturnValue([task]);
    deps.scheduleStore.claimTask.mockReturnValue(task);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('77777777-7777-7777-7777-777777777777');

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
    });

    await scheduler.tick();

    expect(deps.scheduleStore.releaseClaim).not.toHaveBeenCalled();
  });

  it('recovers stale claims at the start of each tick', async () => {
    const deps = createMockDeps(2);
    deps.scheduleStore.getDueTasks.mockReturnValue([]);

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
    });

    await scheduler.tick();

    expect(deps.scheduleStore.recoverStaleClaims).toHaveBeenCalledWith(30);
  });

  it('releases claim when session creation throws', async () => {
    const task = createTask();
    const deps = createMockDeps(2);
    deps.scheduleStore.getDueTasks.mockReturnValue([task]);
    deps.scheduleStore.claimTask.mockReturnValue(task);
    deps.sessionManager.createStandaloneSession.mockImplementation(() => {
      throw new Error('Allocation exhausted');
    });

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
    });

    await scheduler.tick();

    expect(deps.scheduleStore.releaseClaim).toHaveBeenCalledWith(task.id);
    expect(deps.jobQueue.enqueue).not.toHaveBeenCalled();
    expect(deps.scheduleStore.recordRun).not.toHaveBeenCalled();
  });

  it('releases claim when workdir preparation throws', async () => {
    const task = createTask();
    const deps = createMockDeps(2);
    deps.scheduleStore.getDueTasks.mockReturnValue([task]);
    deps.scheduleStore.claimTask.mockReturnValue(task);
    deps.workdirManager.prepareWorkdirSkillsOnly.mockImplementation(() => {
      throw new Error('EACCES');
    });

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
    });

    await scheduler.tick();

    expect(deps.scheduleStore.releaseClaim).toHaveBeenCalledWith(task.id);
    expect(deps.jobQueue.enqueue).not.toHaveBeenCalled();
  });

  it('does not set status for recurring task at maxRuns (deferred to job-executor)', async () => {
    const recurring = createTask({
      id: 'task-maxruns',
      scheduleType: 'recurring',
      cronExpr: '0 9 * * *',
      runCount: 4,
      maxRuns: 5,
    });
    const deps = createMockDeps(2);
    deps.scheduleStore.getDueTasks.mockReturnValue([recurring]);
    deps.scheduleStore.claimTask.mockReturnValue(recurring);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('88888888-8888-8888-8888-888888888888');

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
    });

    await scheduler.tick();

    const updateCall = deps.scheduleStore.update.mock.calls[0];
    expect(updateCall).toBeDefined();
    expect(updateCall?.[0]).toBe(recurring.id);
    expect(updateCall?.[1]).toEqual(expect.objectContaining({ nextRunAt: null, runCount: 5 }));
    expect(updateCall?.[1]).not.toHaveProperty('status');
    // Claim kept for terminal recurring
    expect(deps.scheduleStore.releaseClaim).not.toHaveBeenCalled();
  });
});

// ── Orchestrator Scheduling ──────────────────────────────────

function createMockOrchDeps(): MockOrchDeps {
  return {
    orchestratorStore: {
      recoverStaleClaims: vi.fn(() => 0),
      getDueOrchestrators: vi.fn(() => []),
      claimOrchestrator: vi.fn(),
      releaseClaim: vi.fn(),
      update: vi.fn(),
    },
    orchestratorEngine: {
      startRun: vi.fn().mockResolvedValue('run-1'),
    },
  };
}

function createOrch(overrides: Record<string, unknown> = {}) {
  return {
    id: 'orch-1',
    name: 'Test Pipeline',
    alias: 'test',
    scheduleType: 'once' as const,
    cronExpr: null,
    timezone: 'UTC',
    status: 'active',
    runCount: 0,
    ...overrides,
  };
}

describe('Scheduler — orchestrator polling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('polls and executes due orchestrators', async () => {
    const orch = createOrch();
    const deps = createMockDeps(2);
    const orchDeps = createMockOrchDeps();
    orchDeps.orchestratorStore.getDueOrchestrators.mockReturnValue([orch]);
    orchDeps.orchestratorStore.claimOrchestrator.mockReturnValue(orch);

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
      orchestratorStore: orchDeps.orchestratorStore as unknown as OrchestratorStore,
      orchestratorEngine: orchDeps.orchestratorEngine as unknown as OrchestratorEngine,
    });

    await scheduler.tick();

    expect(orchDeps.orchestratorStore.recoverStaleClaims).toHaveBeenCalledWith(30);
    expect(orchDeps.orchestratorEngine.startRun).toHaveBeenCalledWith('orch-1', 'schedule');
    expect(orchDeps.orchestratorStore.update).toHaveBeenCalledWith(
      'orch-1',
      expect.objectContaining({ runCount: 1, nextRunAt: null }),
    );
  });

  it('skips already-claimed orchestrators', async () => {
    const orch = createOrch();
    const deps = createMockDeps(2);
    const orchDeps = createMockOrchDeps();
    orchDeps.orchestratorStore.getDueOrchestrators.mockReturnValue([orch]);
    orchDeps.orchestratorStore.claimOrchestrator.mockReturnValue(null);

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
      orchestratorStore: orchDeps.orchestratorStore as unknown as OrchestratorStore,
      orchestratorEngine: orchDeps.orchestratorEngine as unknown as OrchestratorEngine,
    });

    await scheduler.tick();

    expect(orchDeps.orchestratorEngine.startRun).not.toHaveBeenCalled();
  });

  it('releases claim for recurring orchestrators with future runs', async () => {
    const orch = createOrch({
      scheduleType: 'recurring',
      cronExpr: '0 9 * * *',
    });
    const deps = createMockDeps(2);
    const orchDeps = createMockOrchDeps();
    orchDeps.orchestratorStore.getDueOrchestrators.mockReturnValue([orch]);
    orchDeps.orchestratorStore.claimOrchestrator.mockReturnValue(orch);

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
      orchestratorStore: orchDeps.orchestratorStore as unknown as OrchestratorStore,
      orchestratorEngine: orchDeps.orchestratorEngine as unknown as OrchestratorEngine,
    });

    await scheduler.tick();

    expect(orchDeps.orchestratorStore.releaseClaim).toHaveBeenCalledWith('orch-1');
    expect(orchDeps.orchestratorStore.update).toHaveBeenCalledWith(
      'orch-1',
      expect.objectContaining({ runCount: 1 }),
    );
    // nextRunAt should be a string (computed from cron), not null
    const updateCall = orchDeps.orchestratorStore.update.mock.calls[0];
    expect(updateCall?.[1].nextRunAt).toBeTruthy();
  });

  it('releases claim on engine error', async () => {
    const orch = createOrch();
    const deps = createMockDeps(2);
    const orchDeps = createMockOrchDeps();
    orchDeps.orchestratorStore.getDueOrchestrators.mockReturnValue([orch]);
    orchDeps.orchestratorStore.claimOrchestrator.mockReturnValue(orch);
    orchDeps.orchestratorEngine.startRun.mockRejectedValue(new Error('DAG invalid'));

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
      orchestratorStore: orchDeps.orchestratorStore as unknown as OrchestratorStore,
      orchestratorEngine: orchDeps.orchestratorEngine as unknown as OrchestratorEngine,
    });

    await scheduler.tick();

    expect(orchDeps.orchestratorStore.releaseClaim).toHaveBeenCalledWith('orch-1');
    expect(orchDeps.orchestratorStore.update).not.toHaveBeenCalled();
  });

  it('does not crash when orchestrator deps are not provided', async () => {
    const deps = createMockDeps(2);
    deps.scheduleStore.getDueTasks.mockReturnValue([]);

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
      // No orchestratorStore/Engine
    });

    await scheduler.tick();
    // Should complete without errors
    expect(deps.scheduleStore.recoverStaleClaims).toHaveBeenCalledWith(30);
  });

  it('recovers stale triggered task claims during tick', async () => {
    const deps = createMockDeps(2);
    deps.scheduleStore.getDueTasks.mockReturnValue([]);
    const triggeredTaskStore = {
      recoverStaleClaims: vi.fn(() => 2),
    };

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
      triggeredTaskStore: triggeredTaskStore as unknown as TriggeredTaskStore,
    });

    await scheduler.tick();

    expect(triggeredTaskStore.recoverStaleClaims).toHaveBeenCalledWith(30);
  });

  it('does not crash when triggeredTaskStore is not provided', async () => {
    const deps = createMockDeps(2);
    deps.scheduleStore.getDueTasks.mockReturnValue([]);

    const scheduler = new Scheduler({
      scheduleStore: deps.scheduleStore as unknown as ScheduleStore,
      sessionManager: deps.sessionManager as unknown as SessionManager,
      jobQueue: deps.jobQueue as unknown as JobQueue,
      workdirManager: deps.workdirManager as unknown as WorkdirManager,
      config: deps.config,
    });

    await scheduler.tick();
    // Should complete without errors
    expect(deps.scheduleStore.recoverStaleClaims).toHaveBeenCalledWith(30);
  });
});
