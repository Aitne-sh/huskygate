/** @module slack/job-executor — Prepares and executes queued jobs via the Runner pipeline. */
import { writeFileSync } from 'node:fs';
import type { AppContext } from '../context/app-context.js';
import { type InstructionSource, resolveInstruction } from '../instructions/builder.js';
import { getInstructionFilePath } from '../orchestrator/engine-utils.js';
import type { Job } from '../queue/types.js';
import { createDriver } from '../runner/driver-factory.js';
import {
  CLOUD_SKILL_IDS,
  collectCloudProviderEnv,
  collectSkillEnv,
} from '../runner/driver-utils.js';
import { Runner } from '../runner/runner.js';
import type { ToolState } from '../session/types.js';
import { errorMessage } from '../utils/error.js';
import { createScopedLogger, logger } from '../utils/logger.js';
import {
  removeClaudeGeneratedMcpConfig,
  writeClaudeMcpConfigToWorkdir,
} from '../workdir/mcp-writer.js';
import { buildSlackContextPrefix, resolveContext, toThreadKey } from './app-helpers.js';
import { resolveAutoApprove } from './auto-approve.js';
import { finishJobExecution } from './job-finishers.js';
import {
  type JobRunOutcome,
  NullMessenger,
  type PreparedJobExecution,
  createInitialJobRunOutcome,
  getJobSourceFlags,
} from './job-runtime-types.js';
import { runJobRuntime } from './job-runtime.js';
import { resolveJobMcpSelection } from './mcp-selection.js';
import { Messenger } from './messenger.js';
import {
  cleanupStandaloneSessionResources,
  requiresStandaloneSessionCleanup,
} from './task-run-completion.js';
import { prepareCodexOutputLastMessageCapture } from './tools/codex.js';

function usesNullMessenger(flags: ReturnType<typeof getJobSourceFlags>): boolean {
  return (
    flags.isDashboard ||
    flags.isSchedule ||
    flags.isAssistant ||
    flags.isOndemandTask ||
    flags.isTriggeredTask ||
    flags.isOrchestrator ||
    flags.isOrchestratorSummary
  );
}

function resolveInstructionSource(job: Job): InstructionSource {
  if (job.source === 'schedule') return 'schedule';
  if (job.source === 'ondemand-task' || job.source === 'triggered-task') return 'standalone-task';
  if (job.source === 'orchestrator' || job.source === 'orchestrator-summary') return 'orchestrator';
  return 'chat';
}

async function prepareJobExecution(ctx: AppContext, job: Job): Promise<PreparedJobExecution> {
  const flags = getJobSourceFlags(job);
  const jobStream = flags.isDashboard || flags.isAssistant ? ctx.jobEventStreams.get(job.id) : null;
  const threadKey = toThreadKey(job.channelId, job.threadTs);
  const jobContext = resolveContext(ctx, threadKey, {
    sessionKey: job.sessionKey,
    tool: job.tool,
  });

  const messenger = usesNullMessenger(flags)
    ? new NullMessenger()
    : new Messenger(
        ctx.webClient,
        job.channelId,
        job.threadTs,
        buildSlackContextPrefix(jobContext.tool, jobContext.sessionId),
        { useMarkdownBlocks: true },
      );

  const jlog = createScopedLogger({ job_id: job.id, session_key: job.sessionKey });
  await messenger.postStart(`Running \`${job.tool}\`...`);

  const driver = createDriver(job.tool);
  const session = ctx.sessionManager.get(job.sessionKey);
  if (!session) {
    throw new Error(`Missing session for queued job: ${job.sessionKey}`);
  }
  let effectiveToolState: ToolState = {
    ...session.toolState,
    ...(job.toolStateOverrides ?? {}),
  };

  const allowMcp = job.executionPolicy?.allowMcp ?? true;
  const mcpSelection = resolveJobMcpSelection(ctx, job);
  const selectedMcpServers = allowMcp ? mcpSelection.enabledServers : [];
  const enabledSkills = job.executionPolicy?.enabledSkills ?? null;
  const seedableSkillEntries = ctx.workdirManager.listSeedableSkillEntries(job.tool, enabledSkills);
  const seedableSkillRefs = new Set(seedableSkillEntries.map((entry) => entry.skillRef));
  if (
    job.tool === 'claude' &&
    ctx.config.claudeMcpAuthServer &&
    job.mode !== 'readonly' &&
    allowMcp &&
    mcpSelection.enabledServerNames.has(ctx.config.claudeMcpAuthServer)
  ) {
    const existing = Array.isArray(effectiveToolState.claude_runtime_allowed_tools)
      ? [...effectiveToolState.claude_runtime_allowed_tools]
      : [];
    const mcpGlob = `mcp__${ctx.config.claudeMcpAuthServer}__*`;
    if (!existing.includes(mcpGlob)) {
      effectiveToolState = {
        ...effectiveToolState,
        claude_runtime_allowed_tools: [...existing, mcpGlob],
      };
    }
  }

  const autoApproveEnabled = resolveAutoApprove(
    ctx.config,
    job.mode,
    job.autoApprove,
    effectiveToolState,
  );
  const skillsEnabled = ctx.workdirManager.willSeedSkills(job.tool, enabledSkills);

  if (session.devAlias) {
    ctx.workdirManager.prepareDevWorkdir(job.workdir);
  } else {
    if (!job.skipInstructionFile) {
      const instruction =
        job.instructionOverride ??
        resolveInstruction(
          {
            tool: job.tool,
            source: resolveInstructionSource(job),
            autoApprove: autoApproveEnabled,
            allowMcp,
          },
          job.instructionFile,
          ctx.defaultInstructionStore.getWithEnabled(job.tool),
        );
      writeFileSync(getInstructionFilePath(job.workdir, job.tool), instruction, 'utf-8');
    }
    ctx.workdirManager.prepareWorkdirSkillsOnly(job.workdir, job.tool, enabledSkills);
  }

  // Inject denial context for previously denied tools.
  // When a user rejects a tool approval, the denied tool name is stored in
  // session state.  On the next user message we append a denial note to the
  // prompt so the AI does not retry the same tool.  For tools with a proactive
  // gate (Claude, Gemini), we also add the denied tools to the runtime
  // allowlist to prevent an immediate re-gate if the AI ignores the note.
  let prompt = job.prompt;
  if (Array.isArray(effectiveToolState.denied_tools)) {
    const deniedTools = effectiveToolState.denied_tools;
    if (deniedTools.length > 0) {
      // '_previous_request_' is a sentinel for denials where the specific
      // tool name could not be resolved.  Use a generic message in that case.
      const SENTINEL = '_previous_request_';
      const namedTools = deniedTools.filter((t) => t !== SENTINEL);
      const hasGenericDenial = deniedTools.length !== namedTools.length;

      if (namedTools.length > 0) {
        const toolList = namedTools.join(', ');
        prompt += `\n\nNote: The user previously denied the following tool(s): ${toolList}. Do not use these tools. Respond to the user's message directly.`;
      } else if (hasGenericDenial) {
        prompt +=
          "\n\nNote: The user denied the previous tool execution request. Do not retry any tools. Respond to the user's message directly.";
      }

      // Add denied tools to the per-tool runtime allowlist to prevent re-gating
      const allowlistKey =
        job.tool === 'gemini'
          ? 'gemini_runtime_allowed_tools'
          : job.tool === 'claude'
            ? 'claude_runtime_allowed_tools'
            : null;
      if (allowlistKey && namedTools.length > 0) {
        const existingAllowed = Array.isArray(effectiveToolState[allowlistKey])
          ? [...(effectiveToolState[allowlistKey] as string[])]
          : [];
        const merged = new Set(existingAllowed);
        for (const t of namedTools) {
          merged.add(t);
        }
        effectiveToolState = {
          ...effectiveToolState,
          [allowlistKey]: [...merged],
          denied_tools: undefined,
        };
      } else {
        effectiveToolState = {
          ...effectiveToolState,
          denied_tools: undefined,
        };
      }

      ctx.sessionManager.mergeToolState(job.sessionKey, { denied_tools: undefined });
      jlog.info('denied_tools_injected', { tool: job.tool, denied: deniedTools });
    }
  }

  let mcpConfigPath: string | null = null;
  let setupComplete = false;
  try {
    const effectiveSession = {
      ...session,
      toolState: effectiveToolState,
    };
    mcpConfigPath =
      job.tool === 'claude' ? writeClaudeMcpConfigToWorkdir(job.workdir, selectedMcpServers) : null;
    jlog.info('job_mode_resolved', {
      tool: job.tool,
      mode: job.mode,
      session_mode: session.mode,
    });
    let args = driver.buildArgs(prompt, effectiveSession, job.mode, {
      autoApproveEnabled,
      skillsEnabled,
      allowMcp,
      mcpConfigPath,
    });
    const env = driver.buildEnv();

    const needsCloudEnv =
      enabledSkills === null ||
      allowMcp ||
      [...seedableSkillRefs].some((skill) => CLOUD_SKILL_IDS.has(skill));
    if (needsCloudEnv) {
      Object.assign(env, collectCloudProviderEnv());
    }
    Object.assign(env, collectSkillEnv(seedableSkillEntries));

    let claudeSessionIdPreStored = false;
    if (job.tool === 'claude') {
      const resumeIdx = args.indexOf('--resume');
      const sessionIdIdx = args.indexOf('--session-id');
      jlog.info('claude_session_args', {
        has_session_id_in_state: 'session_id' in effectiveToolState,
        session_id_value: effectiveToolState.session_id ?? null,
        resume_arg: resumeIdx !== -1 ? args[resumeIdx + 1] : null,
        session_id_arg: sessionIdIdx !== -1 ? args[sessionIdIdx + 1] : null,
      });

      if (sessionIdIdx !== -1) {
        const newCliSessionId = args[sessionIdIdx + 1];
        if (newCliSessionId) {
          const currentSession = ctx.sessionManager.get(job.sessionKey);
          if (currentSession && !currentSession.toolState.session_id) {
            ctx.sessionManager.mergeToolState(job.sessionKey, {
              session_id: newCliSessionId,
            });
            session.toolState = { ...session.toolState, session_id: newCliSessionId };
            effectiveToolState = { ...effectiveToolState, session_id: newCliSessionId };
            claudeSessionIdPreStored = true;
          }
        }
      }
    }

    let codexOutputLastMessagePath: string | null = null;
    if (job.tool === 'codex') {
      try {
        const prepared = await prepareCodexOutputLastMessageCapture(args, job.workdir, job.id);
        args = prepared.args;
        codexOutputLastMessagePath = prepared.outputLastMessagePath;
      } catch (err) {
        jlog.warn('codex_output_last_message_dir_prepare_failed', {
          workdir: job.workdir,
          error: errorMessage(err),
        });
      }
    }

    const preventSleep =
      flags.isSchedule ||
      flags.isOndemandTask ||
      flags.isTriggeredTask ||
      flags.isOrchestrator ||
      flags.isOrchestratorSummary;
    const runnerConfig =
      job.timeoutSec != null && job.timeoutSec > 0
        ? { ...ctx.config, maxRuntimeSec: job.timeoutSec, preventSleep }
        : { ...ctx.config, preventSleep };

    setupComplete = true;
    return {
      job,
      flags,
      jobStream: jobStream ?? null,
      threadKey,
      messenger,
      jlog,
      driver,
      session,
      effectiveToolState,
      allowMcp,
      selectedMcpServers,
      autoApproveEnabled,
      runner: new Runner(runnerConfig),
      args,
      env,
      mcpConfigPath,
      claudeSessionIdPreStored,
      codexOutputLastMessagePath,
    };
  } finally {
    if (!setupComplete && mcpConfigPath) {
      try {
        removeClaudeGeneratedMcpConfig(mcpConfigPath);
      } catch (cleanupErr) {
        jlog.warn('claude_generated_mcp_cleanup_failed_during_setup', {
          workdir: job.workdir,
          path: mcpConfigPath,
          error: errorMessage(cleanupErr),
        });
      }
    }
  }
}

function buildExecutorRuntimeFailureOutcome(err: unknown): JobRunOutcome {
  const message = err instanceof Error ? err.message : String(err);
  const raw = `Executor runtime failed: ${message}`;
  return {
    jobFailed: true,
    taskOutputSummary: raw.length > 4000 ? `${raw.slice(0, 4000)}… (truncated)` : raw,
    taskOutputRaw: raw,
    taskExitCode: 1,
    taskErrorKind: 'executor_runtime_error',
    archivedFiles: [],
  };
}

function finalizeUnfinishedJobStream(
  ctx: AppContext,
  job: Job,
  jobStream: PreparedJobExecution['jobStream'],
): void {
  if (!jobStream) return;
  try {
    const finalSession = ctx.sessionManager.get(job.sessionKey);
    jobStream.onDone({
      exitCode: 1,
      sessionState: finalSession?.toolState ?? {},
    });
  } catch (streamErr) {
    logger.warn('job_stream_done_failed_after_executor_throw', {
      jobId: job.id,
      sessionKey: job.sessionKey,
      error: errorMessage(streamErr),
    });
  }
  ctx.jobEventStreams.delete(job.id);
}

/** Wire the job queue executor that prepares workdirs, spawns runners, and handles completion. */
export function registerJobExecutor(ctx: AppContext): void {
  ctx.jobQueue.setExecutor(async (job: Job) => {
    let orchestratorCallbackDone = false;
    const flags = getJobSourceFlags(job);
    const unresolvedJobStream =
      flags.isDashboard || flags.isAssistant ? (ctx.jobEventStreams.get(job.id) ?? null) : null;
    const standaloneSessionCleanupRequired = requiresStandaloneSessionCleanup(job.source);
    let standaloneSessionCleanupDone = false;
    let finishExecution = false;
    let finishStarted = false;
    let prepared: PreparedJobExecution | null = null;
    const cleanupStandaloneSessionResourcesOnce = (): void => {
      if (!standaloneSessionCleanupRequired || standaloneSessionCleanupDone) return;
      cleanupStandaloneSessionResources(ctx, {
        sessionKey: job.sessionKey,
        jobWorkdir: job.workdir,
      });
      standaloneSessionCleanupDone = true;
    };

    try {
      prepared = await prepareJobExecution(ctx, job);
      const jobStartedAt = Date.now();
      let outcome = createInitialJobRunOutcome();

      ctx.auditStore.logJobStart({
        jobId: job.id,
        sessionKey: job.sessionKey,
        userId: job.userId,
        tool: job.tool,
        mode: job.mode,
        workdir: job.workdir,
        prompt: job.prompt,
        source: job.source ?? undefined,
        autoApprove: prepared.autoApproveEnabled || undefined,
      });

      ctx.activeRunners.set(job.sessionKey, { runner: prepared.runner, job });
      ctx.sessionManager.setRunningJob(job.sessionKey, job.id);
      finishExecution = true;
      const executeFinish = async (): Promise<void> => {
        if (!finishExecution || finishStarted || !prepared) return;
        finishStarted = true;
        const finishResult = await finishJobExecution({
          ctx,
          prepared,
          outcome,
          jobStartedAt,
          cleanupStandaloneSessionResourcesOnce,
        });
        orchestratorCallbackDone = finishResult.orchestratorCallbackDone;
      };

      try {
        outcome = await runJobRuntime(ctx, prepared);
      } catch (runtimeErr) {
        outcome = buildExecutorRuntimeFailureOutcome(runtimeErr);
        throw runtimeErr;
      } finally {
        await executeFinish();
      }
    } catch (fatalErr) {
      const hasPendingJobStream =
        (prepared?.jobStream != null || unresolvedJobStream != null) &&
        ctx.jobEventStreams.has(job.id);
      if (hasPendingJobStream) {
        finalizeUnfinishedJobStream(ctx, job, prepared?.jobStream ?? unresolvedJobStream);
      }

      if (
        !orchestratorCallbackDone &&
        job.source === 'orchestrator' &&
        job.orchestrationRunId &&
        job.orchestrationNodeId &&
        ctx.orchestratorEngine
      ) {
        try {
          await ctx.orchestratorEngine.onNodeJobComplete(
            job.id,
            {
              exitCode: 1,
              events: [],
              errorKind: 'executor_setup_error',
            },
            '',
            `Executor setup failed: ${fatalErr instanceof Error ? fatalErr.message : String(fatalErr)}`,
          );
        } catch {
          logger.error('orchestrator_safety_net_callback_failed', {
            jobId: job.id,
            runId: job.orchestrationRunId,
          });
        }
      }

      if (standaloneSessionCleanupRequired && !standaloneSessionCleanupDone) {
        try {
          cleanupStandaloneSessionResourcesOnce();
        } catch (cleanupErr) {
          logger.warn('standalone_session_cleanup_failed_after_executor_throw', {
            source: job.source ?? null,
            sessionKey: job.sessionKey,
            error: errorMessage(cleanupErr),
          });
        }
      }

      throw fatalErr;
    } finally {
      if (prepared?.mcpConfigPath) {
        try {
          removeClaudeGeneratedMcpConfig(prepared.mcpConfigPath);
        } catch (cleanupErr) {
          logger.warn('claude_generated_mcp_cleanup_failed', {
            jobId: job.id,
            sessionKey: job.sessionKey,
            workdir: job.workdir,
            path: prepared.mcpConfigPath,
            error: errorMessage(cleanupErr),
          });
        }
      }
    }
  });
}
