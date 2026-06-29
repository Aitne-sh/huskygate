import { describe, expect, it, vi } from 'vitest';
import { buildSkillRef } from '../skills/catalog.js';
import { TriggeredTaskExecutor } from './triggered-task-executor.js';
import type { TriggeredTask } from './types.js';

function makeTask(overrides: Partial<TriggeredTask> = {}): TriggeredTask {
  return {
    id: 'task-1',
    name: 'Triggered Task',
    description: null,
    userId: 'U123',
    tool: 'claude',
    model: null,
    mode: 'write',
    prompt: 'Handle the event',
    workdir: '/tmp/triggered-task',
    maxRetries: 2,
    allowMcp: true,
    enabledSkills: [buildSkillRef('builtin', 'aws-cli')],
    instructionFile: '# task instructions',
    agentId: null,
    notifyChannel: null,
    notifyThread: null,
    enabled: true,
    runCount: 0,
    lastRunAt: null,
    concurrencyPolicy: 'skip_if_running',
    claimedAt: null,
    createdAt: '2026-03-08T00:00:00.000Z',
    updatedAt: '2026-03-08T00:00:00.000Z',
    ...overrides,
  };
}

function createExecutor(
  task: TriggeredTask | null,
  enqueueResult: { position: number } | { error: string } = { position: 0 },
) {
  const deps = {
    triggeredTaskStore: {
      getById: vi.fn(() => task),
      claimTask: vi.fn(() => (task ? { ...task, claimedAt: '2026-03-08T00:00:01.000Z' } : null)),
      releaseClaim: vi.fn(),
      recordRun: vi.fn(),
      updateRun: vi.fn(),
    },
    sessionManager: {
      createStandaloneSession: vi.fn(() => ({
        sessionKey: 'sess-1',
        workdir: '/tmp/session-default',
      })),
      deleteSessionByKeyWithCleanup: vi.fn(() => ({ threadKey: 'dashboard_1' })),
      updateMode: vi.fn(),
    },
    jobQueue: {
      enqueue: vi.fn(() => enqueueResult),
    },
    workdirManager: {
      prepareWorkdirSkillsOnly: vi.fn(),
    },
    workdirRoot: '/tmp/huskygate-workdirs',
  };
  return {
    executor: new TriggeredTaskExecutor(deps as never),
    deps,
  };
}

describe('TriggeredTaskExecutor', () => {
  it('returns task_not_found when the task is missing', async () => {
    const { executor, deps } = createExecutor(null);

    const result = await executor.execute('missing', 'webhook', null);

    expect(result).toEqual({
      dispatched: false,
      reason: 'task_not_found',
    });
    expect(deps.sessionManager.createStandaloneSession).not.toHaveBeenCalled();
  });

  it('returns task_disabled when the task is disabled', async () => {
    const task = makeTask({ enabled: false });
    const { executor, deps } = createExecutor(task);

    const result = await executor.execute(task.id, 'webhook', null);

    expect(result).toEqual({
      dispatched: false,
      reason: 'task_disabled',
    });
    expect(deps.triggeredTaskStore.claimTask).not.toHaveBeenCalled();
  });

  it('claims skip-if-running tasks and enqueues a triggered-task job with context', async () => {
    const task = makeTask();
    const { executor, deps } = createExecutor(task);

    const result = await executor.execute(task.id, 'webhook', {
      repo: 'org/repo',
    });

    expect(result.dispatched).toBe(true);
    expect(deps.triggeredTaskStore.claimTask).toHaveBeenCalledWith(task.id, expect.any(String));
    expect(deps.sessionManager.updateMode).toHaveBeenCalledWith('sess-1', 'write', null);
    expect(deps.workdirManager.prepareWorkdirSkillsOnly).toHaveBeenCalledWith(
      '/tmp/triggered-task',
      'claude',
      [buildSkillRef('builtin', 'aws-cli')],
    );
    expect(deps.jobQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'triggered-task',
        triggeredTaskId: 'task-1',
        prompt: expect.stringContaining('--- Trigger Event Context ---'),
        executionPolicy: {
          allowMcp: true,
          enabledSkills: [buildSkillRef('builtin', 'aws-cli')],
          enabledMcpServerIds: null,
        },
      }),
    );
    expect(deps.triggeredTaskStore.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        triggeredTaskId: 'task-1',
        triggeredBy: 'webhook',
        triggerContextJson: '{"repo":"org/repo"}',
      }),
    );
  });

  it('skips dispatch when a skip-if-running task is already claimed', async () => {
    const task = makeTask();
    const { executor, deps } = createExecutor(task);
    deps.triggeredTaskStore.claimTask.mockReturnValue(null);

    const result = await executor.execute(task.id, 'webhook', {
      repo: 'org/repo',
    });

    expect(result).toEqual({
      dispatched: false,
      reason: 'task_already_running',
    });
    expect(deps.jobQueue.enqueue).not.toHaveBeenCalled();
  });

  it('skips claiming when the task allows parallel runs', async () => {
    const task = makeTask({ concurrencyPolicy: 'allow', workdir: null });
    const { executor, deps } = createExecutor(task);

    const result = await executor.execute(task.id, 'webhook', null);

    expect(result.dispatched).toBe(true);
    expect(deps.triggeredTaskStore.claimTask).not.toHaveBeenCalled();
    expect(deps.jobQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        workdir: '/tmp/session-default',
      }),
    );
  });

  it('marks the run as failed and releases the claim when enqueue fails', async () => {
    const task = makeTask();
    const { executor, deps } = createExecutor(task, { error: 'queue-full' });

    const result = await executor.execute(task.id, 'webhook', {
      repo: 'org/repo',
    });

    expect(result).toEqual({
      dispatched: false,
      reason: 'enqueue_failed',
    });
    expect(deps.triggeredTaskStore.updateRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'Enqueue failed: queue-full',
      }),
    );
    expect(deps.triggeredTaskStore.releaseClaim).toHaveBeenCalledWith('task-1');
    expect(deps.sessionManager.deleteSessionByKeyWithCleanup).toHaveBeenCalledWith('sess-1');
  });

  it('injects task model into toolStateOverrides when model is set', async () => {
    const task = makeTask({ model: 'claude-opus-4-6' });
    const { executor, deps } = createExecutor(task);

    await executor.execute(task.id, 'webhook', null);

    expect(deps.jobQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        toolStateOverrides: { model: 'claude-opus-4-6' },
      }),
    );
  });

  it('does not include toolStateOverrides when task model is null', async () => {
    const task = makeTask({ model: null });
    const { executor, deps } = createExecutor(task);

    await executor.execute(task.id, 'webhook', null);

    expect(deps.jobQueue.enqueue).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jobArg = (deps.jobQueue.enqueue as any).mock.calls[0][0];
    expect(jobArg.toolStateOverrides).toBeUndefined();
  });

  it('cleans up the standalone session when setup fails after session creation', async () => {
    const task = makeTask();
    const { executor, deps } = createExecutor(task);
    deps.workdirManager.prepareWorkdirSkillsOnly.mockImplementation(() => {
      throw new Error('prepare failed');
    });

    const result = await executor.execute(task.id, 'webhook', {
      repo: 'org/repo',
    });

    expect(result).toEqual({
      dispatched: false,
      reason: 'setup_failed',
    });
    expect(deps.sessionManager.deleteSessionByKeyWithCleanup).toHaveBeenCalledWith('sess-1');
  });

  it('logs and tolerates failed run recording during setup cleanup', async () => {
    const task = makeTask({ workdir: null });
    const { executor, deps } = createExecutor(task);
    deps.workdirManager.prepareWorkdirSkillsOnly.mockImplementation(() => {
      throw new Error('prepare failed');
    });
    deps.triggeredTaskStore.recordRun.mockImplementation(() => {
      throw new Error('record failed');
    });

    const result = await executor.execute(task.id, 'webhook', {
      repo: 'org/repo',
    });

    expect(result).toEqual({
      dispatched: false,
      reason: 'setup_failed',
    });
    expect(deps.triggeredTaskStore.releaseClaim).toHaveBeenCalledWith(task.id);
    expect(deps.sessionManager.deleteSessionByKeyWithCleanup).toHaveBeenCalledWith('sess-1');
  });
});
