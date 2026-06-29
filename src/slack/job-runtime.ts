/** @module job-runtime — Orchestrates the full job execution lifecycle: preparation, driver run, event streaming, and post-run */
import crypto from 'node:crypto';
import type { AppContext } from '../context/app-context.js';
import { prepareCodexRuntimeHome } from '../runner/codex-runtime-home.js';
import { type DriverEvent, isAggregateTextEvent } from '../runner/types.js';
import { RETRY_LIMITS, SIZE_LIMITS } from '../shared/constants.js';
import { formatToolInputSummary } from '../shared/text-utils.js';
import {
  TOOL_APPROVAL_RERUN_KEY,
  detectPermissionDenied,
  isPermissionDeniedError,
} from '../shared/tool-approval.js';
import { errorMessage } from '../utils/error.js';
import { wrapForMrkdwn } from '../utils/sanitize.js';
import {
  CLAUDE_MCP_AUTH_AUTO_RERUN_KEY,
  CODEX_MCP_AUTH_AUTO_RERUN_KEY,
  MCP_CONN_RETRY_COUNT_KEY,
  detectMcpAuthRequiredResourceFromEvents,
  extractAnswerText,
  hasGeminiResumeStateError,
} from './app-helpers.js';
import { handlePostRunActions } from './job-post-run.js';
import {
  type JobRunOutcome,
  type PreparedJobExecution,
  createInitialJobRunOutcome,
  driverEventToChatEvent,
} from './job-runtime-types.js';
import {
  detectMcpAuthRequiredResourceUrl,
  detectMcpAuthRequiredServer,
  detectToolNotFound,
  evaluateGeminiMcpAuthPreflight,
  isMcpConnectionFailure,
  isMcpRuntimeWarning,
  isMcpTokenRefreshFailure,
} from './mcp-auth.js';
import { maybeRunJobPreflight, prepareGeminiJobRuntime } from './mcp-preflight.js';
import { getToolPlugin } from './tool-plugin.js';
import { evaluateClaudeMcpAuthPreflight } from './tools/claude.js';
import { consumeCodexOutputLastMessage } from './tools/codex.js';
import { GEMINI_MCP_AUTH_APPROVAL_RERUN_KEY } from './tools/gemini.js';

const MAX_MCP_CONN_RETRIES = RETRY_LIMITS.mcpConn;

function buildPreflightAbortOutcome(preflightResult: {
  abortResult?: {
    exitCode: number;
    errorKind: string;
    outputSummary: string;
    outputRaw: string;
  };
}): JobRunOutcome {
  const outcome = createInitialJobRunOutcome();
  const abortResult = preflightResult.abortResult ?? {
    exitCode: 1,
    errorKind: 'mcp_preflight_aborted',
    outputRaw: 'MCP preflight aborted before runner execution.',
    outputSummary: 'MCP preflight aborted before runner execution.',
  };
  outcome.jobFailed = true;
  outcome.taskExitCode = abortResult.exitCode;
  outcome.taskErrorKind = abortResult.errorKind;
  outcome.taskOutputRaw = abortResult.outputRaw;
  outcome.taskOutputSummary = abortResult.outputSummary;
  return outcome;
}

export async function runJobRuntime(
  ctx: AppContext,
  prepared: PreparedJobExecution,
): Promise<JobRunOutcome> {
  const { job, flags, jobStream, threadKey, messenger, jlog, driver, session, runner } = prepared;
  const selectedMcpServerNames = new Set(prepared.selectedMcpServers.map((server) => server.name));
  let env = prepared.env;
  let effectiveToolState = prepared.effectiveToolState;
  let codexOutputLastMessageUsed = false;
  const outcome = createInitialJobRunOutcome();

  const isToolApprovalRerun = job.toolStateOverrides?.[TOOL_APPROVAL_RERUN_KEY] === true;
  if (
    !flags.isDashboard &&
    !flags.isSchedule &&
    !flags.isAssistant &&
    !flags.isOndemandTask &&
    !flags.isTriggeredTask &&
    !flags.isOrchestratorSummary &&
    !isToolApprovalRerun
  ) {
    ctx.conversationStore.saveMessage(job.sessionKey, 'user', job.prompt, job.id);
  }

  const isClaudeMcpAutoAuthRerun =
    job.tool === 'claude' && job.toolStateOverrides?.[CLAUDE_MCP_AUTH_AUTO_RERUN_KEY] === true;
  const isGeminiMcpApprovalRerun =
    job.tool === 'gemini' && job.toolStateOverrides?.[GEMINI_MCP_AUTH_APPROVAL_RERUN_KEY] === true;
  const isCodexMcpAutoAuthRerun =
    job.tool === 'codex' && job.toolStateOverrides?.[CODEX_MCP_AUTH_AUTO_RERUN_KEY] === true;

  if (job.tool === 'gemini') {
    env = await prepareGeminiJobRuntime(
      ctx,
      job,
      env,
      prepared.selectedMcpServers,
      selectedMcpServerNames.has(ctx.config.geminiMcpAuthServer ?? '')
        ? ctx.config.geminiMcpAuthServer
        : null,
    );
  }

  if (job.tool === 'codex') {
    try {
      const runtimeHome = await prepareCodexRuntimeHome(job.workdir, prepared.selectedMcpServers);
      env = { ...env, CODEX_HOME: runtimeHome.homeDir };
      jlog.info('codex_runtime_home_prepared', {
        workdir: job.workdir,
        runtimeHome: runtimeHome.homeDir,
        seededFiles: runtimeHome.seededFiles,
      });
    } catch (err) {
      jlog.warn('codex_runtime_home_prepare_failed', {
        workdir: job.workdir,
        error: errorMessage(err),
      });
    }
  }

  const switchBarrier = ctx.switchPreflightBarriers.get(job.sessionKey);
  if (switchBarrier) {
    jlog.info('awaiting_switch_preflight', { session_key: job.sessionKey });
  }

  const preflightResult = await maybeRunJobPreflight(ctx, {
    job,
    messenger,
    runner,
    env,
    session,
    effectiveToolState,
    claudeSessionIdPreStored: prepared.claudeSessionIdPreStored,
    selectedMcpServers: prepared.selectedMcpServers,
    threadKey,
    allowMcp: prepared.allowMcp,
  });
  env = preflightResult.env;
  session.toolState = preflightResult.sessionToolState;
  effectiveToolState = preflightResult.effectiveToolState;
  if (preflightResult.shouldReturn) {
    return buildPreflightAbortOutcome(preflightResult);
  }

  const MAX_JOB_EVENTS = SIZE_LIMITS.maxEventsPerRun;
  const allEvents: DriverEvent[] = [];
  let textBuffer = '';
  let dashboardTextEmitted = false;
  let seenToolUse = false;
  let stoppedForPermissionDenied = false;
  let stoppedForMcpAuthRequired = false;
  let stoppedForMcpToolUnavailable = false;
  let stoppedForMcpBlocked = false;
  let requiredMcpAuthServer: string | null = null;
  let requiredMcpAuthResourceUrl: string | null = null;
  let missingMcpToolName: string | null = null;
  let mcpRuntimeWarningSeen = false;
  let stoppedForMcpConnectionFailure = false;
  let mcpConnFailureSeen = false;
  const mcpConnRetryCount =
    typeof effectiveToolState[MCP_CONN_RETRY_COUNT_KEY] === 'number'
      ? (effectiveToolState[MCP_CONN_RETRY_COUNT_KEY] as number)
      : 0;
  const toolPlugin = getToolPlugin(job.tool);
  let approvalGate = toolPlugin.createApprovalGate(effectiveToolState);

  const result = await runner.run(prepared.driver, prepared.args, env, job.workdir, (event) => {
    if (allEvents.length < MAX_JOB_EVENTS) {
      allEvents.push(event);
    }

    if (jobStream) {
      try {
        const chatEvent = driverEventToChatEvent(event);
        if (chatEvent) {
          jobStream.onEvent(chatEvent);
          if (chatEvent.type === 'text') dashboardTextEmitted = true;
        }
      } catch (streamErr) {
        jlog.error('job_stream_event_failed', { error: errorMessage(streamErr) });
      }
    }

    if (
      stoppedForPermissionDenied ||
      stoppedForMcpAuthRequired ||
      stoppedForMcpToolUnavailable ||
      stoppedForMcpBlocked ||
      stoppedForMcpConnectionFailure
    ) {
      return;
    }

    if (!prepared.allowMcp && event.type === 'tool_use') {
      const raw = event.raw as Record<string, unknown> | undefined;
      const toolName =
        (raw?.tool_name as string | undefined) ??
        event.content.replace(/^(?:Using tool|Calling):\s*/i, '');
      if (toolName.startsWith('mcp__') || toolName.startsWith('mcp_')) {
        stoppedForMcpBlocked = true;
        jlog.warn('mcp_tool_blocked_by_policy', {
          tool: toolName,
          allowMcp: false,
          source: job.source,
        });
        runner.kill('mcp_blocked_by_policy');
        return;
      }
    }

    if (
      (job.tool === 'claude' || job.tool === 'gemini' || job.tool === 'codex') &&
      (event.type === 'status' || event.type === 'error' || event.type === 'text')
    ) {
      if (!mcpRuntimeWarningSeen) {
        mcpRuntimeWarningSeen = isMcpRuntimeWarning(event.content);
      }
      const authServer = detectMcpAuthRequiredServer(event.content);
      const authResourceUrl = detectMcpAuthRequiredResourceUrl(event.content);
      const codexTokenRefreshFailure =
        job.tool === 'codex' && isMcpTokenRefreshFailure(event.content);
      const claudeTokenRefreshFailure =
        job.tool === 'claude' && isMcpTokenRefreshFailure(event.content);
      if (
        authServer ||
        (job.tool === 'codex' && authResourceUrl) ||
        codexTokenRefreshFailure ||
        claudeTokenRefreshFailure
      ) {
        requiredMcpAuthServer = authServer ?? toolPlugin.getMcpAuthServer(ctx.config);
        if (!requiredMcpAuthServer || !selectedMcpServerNames.has(requiredMcpAuthServer)) {
          requiredMcpAuthServer = null;
        }
        requiredMcpAuthResourceUrl = authResourceUrl;
        if (requiredMcpAuthServer || authResourceUrl) {
          stoppedForMcpAuthRequired = true;
          runner.kill('mcp_auth_required');
          return;
        }
      }

      if (job.tool === 'gemini' && event.type === 'error') {
        const toolNotFound = detectToolNotFound(event.content);
        if (
          toolNotFound &&
          (mcpRuntimeWarningSeen || toolNotFound.missingTool.startsWith('aws_'))
        ) {
          missingMcpToolName = toolNotFound.missingTool;
          stoppedForMcpToolUnavailable = true;
          runner.kill('mcp_tool_unavailable');
          return;
        }
      }

      // Track MCP connection failures passively — do NOT kill the process.
      // Gemini CLI has its own internal retry mechanism that handles transient
      // failures (e.g. -32000: Connection closed during MCP discovery).
      // Killing prematurely prevents recovery and causes persistent failures
      // that don't occur when running gemini CLI directly.
      if (
        job.tool === 'gemini' &&
        (event.type === 'status' || event.type === 'error') &&
        !mcpConnFailureSeen &&
        isMcpConnectionFailure(event.content)
      ) {
        mcpConnFailureSeen = true;
        jlog.warn('mcp_connection_failure_detected', {
          content: event.content.slice(0, 200),
          retry_count: mcpConnRetryCount,
        });
      }
    }

    if (!prepared.autoApproveEnabled) {
      if (
        (event.type === 'error' || event.type === 'status') &&
        isPermissionDeniedError(job.tool, event.content)
      ) {
        stoppedForPermissionDenied = true;
        runner.kill('permission_approval_needed');
        return;
      }

      if (job.mode !== 'readonly' && event.type === 'tool_use') {
        const approvalEval = toolPlugin.evaluateToolUse(approvalGate, event);
        approvalGate = approvalEval.gate;
        if (approvalEval.shouldBlock) {
          stoppedForPermissionDenied = true;
          runner.kill('permission_approval_needed');
          return;
        }
      }
    }

    // Reset MCP connection failure tracking on forward-progress
    if (
      mcpConnFailureSeen &&
      (event.type === 'text' || event.type === 'tool_use' || event.type === 'tool_result')
    ) {
      mcpConnFailureSeen = false;
      jlog.info('mcp_connection_failure_recovered', { event_type: event.type });
    }

    if (event.type === 'text') {
      if (!isAggregateTextEvent(event)) {
        textBuffer += event.content;
        if (job.tool !== 'claude' && job.tool !== 'gemini' && !seenToolUse) {
          messenger.appendText(event.content);
        }
      }
    } else if (event.type === 'tool_use') {
      seenToolUse = true;
      // Forward tool-use announcements to Slack so users can see execution progress.
      // Only forward events with a recognizable announcement prefix (not streaming deltas).
      // Exclude "unknown" placeholder names — these provide no value to users.
      // Skip announcements in auto-approve mode to avoid flooding Slack with tool logs.
      if (!prepared.autoApproveEnabled) {
        const isAnnouncement = /^(?:Using tool|Calling):\s+(?!unknown\s*$)/.test(event.content);
        if (isAnnouncement) {
          const inputDisplay = formatToolInputSummary(event.toolInput);
          // Use bold (*) not italic (_) — tool names with underscores (e.g. mcp__server__tool)
          // break Slack's italic mrkdwn parsing.
          const line = inputDisplay
            ? `\n*${event.content}* ${wrapForMrkdwn(inputDisplay)}\n`
            : `\n*${event.content}*\n`;
          messenger.appendText(line);
        }
      }
    } else if (event.type === 'error') {
      // For LLM-backed drivers (claude/gemini/codex), only forward structured errors
      // (with raw JSON from stdout). Unstructured stderr noise (no raw) causes "..."
      // placeholder flooding in Slack via flushChunk when the buffer exceeds the
      // 4000-char split threshold.
      const isStderrNoise =
        (job.tool === 'claude' || job.tool === 'gemini' || job.tool === 'codex') && !event.raw;
      if (!isStderrNoise) {
        messenger.appendText(`\n*Error:* ${wrapForMrkdwn(event.content)}\n`);
      }
    }
  });

  if (result.eventsDropped) {
    jlog.warn('events_dropped', {
      events_count: allEvents.length,
      message: 'Event buffer exceeded 50,000 — some events were not recorded',
    });
    messenger.appendText(
      '\n_Warning: output exceeded buffer limit; some output may be missing._\n',
    );
  }

  // Auto-retry on MCP connection failure (early return before heavy post-run processing).
  // Triggered when Gemini exits naturally with errors after MCP connection failures were
  // detected — NOT from a forced kill, so Gemini CLI's internal retry has already been
  // exhausted.
  if (mcpConnFailureSeen && result.exitCode !== 0 && mcpConnRetryCount < MAX_MCP_CONN_RETRIES) {
    stoppedForMcpConnectionFailure = true;
    const nextRetryCount = mcpConnRetryCount + 1;
    jlog.warn('mcp_connection_retry_enqueued', {
      attempt: nextRetryCount,
      max: MAX_MCP_CONN_RETRIES,
    });

    // Preserve session state before retry
    const retryToolState = driver.extractSessionState(allEvents);
    const retrySession = ctx.sessionManager.get(job.sessionKey);
    if (retrySession) {
      ctx.sessionManager.updateToolState(job.sessionKey, {
        ...retrySession.toolState,
        ...retryToolState,
      });
    }
    ctx.auditStore.logJobComplete(job.id, result.exitCode, result.errorKind);

    await messenger.postStatusMessage(
      `_MCP connection failed, retrying\u2026 (${nextRetryCount}/${MAX_MCP_CONN_RETRIES})_`,
    );

    ctx.jobQueue.enqueue({
      ...job,
      id: crypto.randomUUID(),
      toolStateOverrides: {
        ...(job.toolStateOverrides ?? {}),
        [MCP_CONN_RETRY_COUNT_KEY]: nextRetryCount,
      },
    });

    outcome.jobFailed = true;
    outcome.taskExitCode = result.exitCode;
    outcome.taskErrorKind = 'mcp_connection_retry_pending';
    jlog.info('job_completed', {
      exit_code: result.exitCode,
      error_kind: result.errorKind,
      events_count: allEvents.length,
    });
    return outcome;
  }

  let cachedAnswerText: string | undefined;
  const getAnswerText = (): string => {
    if (cachedAnswerText === undefined) {
      cachedAnswerText = extractAnswerText(allEvents);
    }
    return cachedAnswerText;
  };

  if (
    jobStream &&
    !dashboardTextEmitted &&
    !stoppedForPermissionDenied &&
    !stoppedForMcpAuthRequired &&
    !stoppedForMcpToolUnavailable &&
    !stoppedForMcpBlocked &&
    !stoppedForMcpConnectionFailure
  ) {
    const fallbackText = getAnswerText();
    if (fallbackText.trim()) {
      try {
        jobStream.onEvent({ type: 'text', content: fallbackText });
      } catch (err) {
        jlog.warn('job_stream_fallback_event_failed', { error: errorMessage(err) });
      }
    }
  }

  if (
    job.tool === 'codex' &&
    !textBuffer.trim() &&
    prepared.codexOutputLastMessagePath &&
    !stoppedForPermissionDenied &&
    !stoppedForMcpAuthRequired &&
    !stoppedForMcpToolUnavailable &&
    !stoppedForMcpBlocked &&
    result.errorKind !== 'permission_approval_needed' &&
    result.errorKind !== 'mcp_auth_required' &&
    result.errorKind !== 'mcp_tool_unavailable' &&
    result.errorKind !== 'mcp_blocked_by_policy'
  ) {
    const lastMessage = await consumeCodexOutputLastMessage(prepared.codexOutputLastMessagePath);
    if (lastMessage) {
      messenger.appendText(lastMessage);
      textBuffer += lastMessage;
      codexOutputLastMessageUsed = true;
      jlog.info('codex_output_last_message_used', { path: prepared.codexOutputLastMessagePath });
    } else {
      jlog.warn('codex_output_last_message_missing', {
        path: prepared.codexOutputLastMessagePath,
        events_count: allEvents.length,
      });
    }
  }

  const detectedPermissionDenied = detectPermissionDenied(job.tool, allEvents);
  const proactivePermissionDenied = toolPlugin.buildPermissionDeniedSummary(approvalGate);
  const voluntaryStop = toolPlugin.detectVoluntaryStop(
    allEvents,
    textBuffer,
    detectedPermissionDenied !== null,
    proactivePermissionDenied !== null,
  );
  const permissionDenied = detectedPermissionDenied ?? proactivePermissionDenied ?? voluntaryStop;
  const mcpEval = job.tool === 'gemini' ? evaluateGeminiMcpAuthPreflight(allEvents) : null;
  const claudeMcpEval = job.tool === 'claude' ? evaluateClaudeMcpAuthPreflight(allEvents) : null;
  const mcpAuthServerFromEvents = mcpEval?.requiredServer ?? claudeMcpEval?.requiredServer ?? null;
  const mcpRuntimeWarningFromEvents =
    mcpEval !== null ? mcpRuntimeWarningSeen || mcpEval.oauthFlowStarted : false;
  const mcpAuthRequiredServer = requiredMcpAuthServer ?? mcpAuthServerFromEvents;
  const mcpAuthRequiredResourceUrl =
    requiredMcpAuthResourceUrl ?? detectMcpAuthRequiredResourceFromEvents(allEvents);
  const hasMcpAuthRequired =
    stoppedForMcpAuthRequired ||
    mcpAuthRequiredServer !== null ||
    mcpAuthRequiredResourceUrl !== null;
  const geminiResumeStateError = job.tool === 'gemini' && hasGeminiResumeStateError(allEvents);
  if (!missingMcpToolName && job.tool === 'gemini') {
    for (const event of allEvents) {
      if (event.type !== 'error') continue;
      const detected = detectToolNotFound(event.content);
      if (!detected) continue;
      if (mcpRuntimeWarningFromEvents || detected.missingTool.startsWith('aws_')) {
        missingMcpToolName = detected.missingTool;
        break;
      }
    }
  }

  const newToolState = driver.extractSessionState(allEvents);
  const currentSession = ctx.sessionManager.get(job.sessionKey);
  if (currentSession) {
    let merged = { ...currentSession.toolState, ...newToolState };
    if (hasMcpAuthRequired || missingMcpToolName !== null) {
      merged = toolPlugin.clearMcpAuthState(merged);
    }
    if (job.tool === 'gemini' && geminiResumeStateError) {
      merged.session_index = undefined;
      merged.gemini_resume_ready = undefined;
    }
    ctx.sessionManager.updateToolState(job.sessionKey, merged);
  }

  ctx.auditStore.logJobComplete(job.id, result.exitCode, result.errorKind);
  outcome.jobFailed = result.exitCode !== 0;
  if (
    flags.isSchedule ||
    flags.isOndemandTask ||
    flags.isTriggeredTask ||
    flags.isOrchestrator ||
    flags.isOrchestratorSummary
  ) {
    outcome.taskExitCode = result.exitCode;
    outcome.taskErrorKind = result.errorKind ?? null;
  }

  const suppressedFailureInfo =
    permissionDenied !== null ||
    (hasMcpAuthRequired && result.errorKind === 'mcp_auth_required') ||
    (missingMcpToolName !== null && result.errorKind === 'mcp_tool_unavailable') ||
    (stoppedForMcpBlocked && result.errorKind === 'mcp_blocked_by_policy');
  const claudeNoOutput =
    job.tool === 'claude' &&
    result.exitCode === 0 &&
    allEvents.length === 0 &&
    !stoppedForPermissionDenied &&
    !hasMcpAuthRequired &&
    !missingMcpToolName &&
    !stoppedForMcpBlocked;
  await handlePostRunActions(ctx, prepared, outcome, {
    allEvents,
    textBuffer,
    result,
    getAnswerText,
    effectiveToolState,
    seenToolUse,
    permissionDenied,
    hasMcpAuthRequired,
    mcpAuthRequiredServer,
    mcpAuthRequiredResourceUrl,
    missingMcpToolName,
    mcpRuntimeWarningFromEvents,
    stoppedForMcpBlocked,
    isClaudeMcpAutoAuthRerun,
    isGeminiMcpApprovalRerun,
    isCodexMcpAutoAuthRerun,
    codexOutputLastMessageUsed,
    claudeNoOutput,
    suppressedFailureInfo,
  });

  jlog.info('job_completed', {
    exit_code: result.exitCode,
    error_kind: result.errorKind,
    events_count: allEvents.length,
  });

  return outcome;
}
