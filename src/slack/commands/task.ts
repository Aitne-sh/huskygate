/** @module commands/task — On-demand task and orchestrator handlers */
import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { AppContext } from '../../context/app-context.js';
import type { Job } from '../../queue/types.js';
import { cleanupStandaloneSessionResources } from '../../shared/standalone-session-cleanup.js';
import { errorMessage } from '../../utils/error.js';
import { logger } from '../../utils/logger.js';
import { postMessageWithContext } from '../app-helpers.js';
import type { HandlerContext } from '../handler-context.js';
import type { CommandType } from '../parser.js';

export async function handleTask(
  hctx: HandlerContext,
  command: Extract<CommandType, { kind: 'task' }>,
): Promise<void> {
  const { ctx } = hctx;
  const { nameOrAlias } = command;

  const task = ctx.ondemandTaskStore.findByKey(nameOrAlias);
  if (!task) {
    await postMessageWithContext(
      ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `On-demand task \`${nameOrAlias}\` not found.`,
    );
    return;
  }

  let standaloneSession: ReturnType<
    AppContext['sessionManager']['createStandaloneSession']
  > | null = null;
  let effectiveWorkdir: string | null = null;
  let jobEnqueued = false;
  try {
    // Create standalone session
    const session = ctx.sessionManager.createStandaloneSession(task.tool, task.userId);
    standaloneSession = session;
    effectiveWorkdir = task.workdir || session.workdir;
    mkdirSync(effectiveWorkdir, { recursive: true });
    // Instruction file is written by job-executor using job.instructionFile
    ctx.workdirManager.prepareWorkdirSkillsOnly(effectiveWorkdir, task.tool, task.enabledSkills);
    // Tasks always run in write mode (P3: non-interactive jobs are write-fixed)
    ctx.sessionManager.updateMode(session.sessionKey, 'write', null);

    // Record run
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    ctx.ondemandTaskStore.recordRun({
      id: runId,
      taskId: task.id,
      sessionKey: session.sessionKey,
      status: 'running',
      startedAt,
      source: 'slack',
    });

    // Enqueue job
    const job: Job = {
      id: runId,
      sessionKey: session.sessionKey,
      channelId: task.notifyChannel || hctx.channelId,
      threadTs: '',
      userId: hctx.userId,
      tool: task.tool,
      mode: 'write',
      prompt: task.prompt,
      workdir: effectiveWorkdir,
      toolState: {},
      createdAt: Date.now(),
      source: 'ondemand-task',
      ondemandTaskId: task.id,
      ondemandTaskRunId: runId,
      autoApprove: true,
      executionPolicy: { allowMcp: task.allowMcp, enabledSkills: task.enabledSkills },
      instructionFile: task.instructionFile,
    };

    const enqResult = ctx.jobQueue.enqueue(job);
    if ('error' in enqResult) {
      ctx.ondemandTaskStore.updateRun(runId, {
        status: 'failed',
        errorMessage: `Enqueue failed: ${enqResult.error}`,
        endedAt: new Date().toISOString(),
      });
      cleanupStandaloneSessionResources(ctx, {
        sessionKey: session.sessionKey,
        sessionWorkdir: session.workdir,
        jobWorkdir: effectiveWorkdir,
      });
      await postMessageWithContext(
        ctx,
        hctx.client,
        hctx.channelId,
        hctx.threadTs,
        `Failed to start on-demand task \`${task.name}\`: ${enqResult.error}`,
      );
      return;
    }
    jobEnqueued = true;

    await postMessageWithContext(
      ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `On-demand task \`${task.name}\` started (run: \`${runId.slice(0, 8)}\`)`,
    );
  } catch (err) {
    logger.error('task_command_failed', {
      nameOrAlias,
      error: errorMessage(err),
    });
    if (standaloneSession && !jobEnqueued) {
      cleanupStandaloneSessionResources(ctx, {
        sessionKey: standaloneSession.sessionKey,
        sessionWorkdir: standaloneSession.workdir,
        jobWorkdir: effectiveWorkdir,
      });
    }
    await postMessageWithContext(
      ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Error executing on-demand task: ${errorMessage(err)}`,
    );
  }
}

export async function handleOrch(
  hctx: HandlerContext,
  command: Extract<CommandType, { kind: 'orch' }>,
): Promise<void> {
  const { ctx } = hctx;
  const { nameOrAlias } = command;

  // Look up by alias first, then by ID
  const orch =
    ctx.orchestratorStore.findByAlias(nameOrAlias) ?? ctx.orchestratorStore.getById(nameOrAlias);

  if (!orch || orch.status === 'deleted') {
    await postMessageWithContext(
      ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Orchestrator \`${nameOrAlias}\` not found.`,
    );
    return;
  }

  if (orch.triggerMode === 'webhook') {
    await postMessageWithContext(
      ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Orchestrator \`${orch.name}\` is webhook-triggered and cannot be started manually.`,
    );
    return;
  }

  try {
    const runId = await ctx.orchestratorEngine.startRun(orch.id, 'slack', hctx.userId);
    await postMessageWithContext(
      ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Orchestrator \`${orch.name}\` started (run: \`${runId.slice(0, 8)}\`)`,
    );
  } catch (err) {
    logger.error('orch_command_start_failed', { nameOrAlias, error: errorMessage(err) });
    await postMessageWithContext(
      ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Failed to start orchestrator: ${errorMessage(err)}`,
    );
  }
}

export async function handleOrchList(hctx: HandlerContext): Promise<void> {
  const { ctx } = hctx;
  const orchs = ctx.orchestratorStore.list({ status: 'active' });

  if (orchs.length === 0) {
    await postMessageWithContext(
      ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      'No active orchestrators found.',
    );
    return;
  }

  const lines = orchs.map((o) => {
    const alias = o.alias ? ` (\`${o.alias}\`)` : '';
    const sched = o.scheduleType
      ? o.scheduleType === 'recurring'
        ? ` | cron: \`${o.cronExpr}\``
        : ' | once'
      : '';
    return `• *${o.name}*${alias}${sched} — ${o.runCount} runs`;
  });

  await postMessageWithContext(
    ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    `*Orchestrators (${orchs.length})*\n${lines.join('\n')}`,
  );
}

export async function handleOrchStatus(
  hctx: HandlerContext,
  command: Extract<CommandType, { kind: 'orch_status' }>,
): Promise<void> {
  const { ctx } = hctx;
  const { target } = command;

  const orch = ctx.orchestratorStore.findByAlias(target) ?? ctx.orchestratorStore.getById(target);

  if (!orch || orch.status === 'deleted') {
    await postMessageWithContext(
      ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Orchestrator \`${target}\` not found.`,
    );
    return;
  }

  // Get latest runs
  const runs = ctx.orchestratorStore.getRunsByOrchestrator(orch.id, 5);
  if (runs.length === 0) {
    await postMessageWithContext(
      ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `*${orch.name}* — No runs yet.`,
    );
    return;
  }

  const lines = runs.map((r) => {
    const dur =
      r.startedAt && r.endedAt
        ? `${Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)}s`
        : r.status === 'running'
          ? 'in progress'
          : '-';
    return `\`${r.id.slice(0, 8)}\` ${r.status} (${r.triggeredBy}) ${dur}`;
  });

  await postMessageWithContext(
    ctx,
    hctx.client,
    hctx.channelId,
    hctx.threadTs,
    `*${orch.name}* — Recent runs:\n${lines.join('\n')}`,
  );
}

export async function handleOrchCancel(
  hctx: HandlerContext,
  command: Extract<CommandType, { kind: 'orch_cancel' }>,
): Promise<void> {
  const { ctx } = hctx;
  const { runId } = command;

  try {
    await ctx.orchestratorEngine.cancelRun(runId);
    await postMessageWithContext(
      ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Orchestration run \`${runId.slice(0, 8)}\` cancelled.`,
    );
  } catch (err) {
    logger.error('orch_cancel_failed', { runId, error: errorMessage(err) });
    await postMessageWithContext(
      ctx,
      hctx.client,
      hctx.channelId,
      hctx.threadTs,
      `Failed to cancel run: ${errorMessage(err)}`,
    );
  }
}
