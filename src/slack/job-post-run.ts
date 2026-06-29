/** @module job-post-run — Handles post-run actions including tool approval prompts, MCP auth, and output archival */
import crypto from 'node:crypto';
import type { AppContext } from '../context/app-context.js';
import type { DriverEvent, RunResult } from '../runner/types.js';
import type { ToolState } from '../session/types.js';
import { formatToolApprovalPrompt } from '../shared/approval.js';
import {
  type ArchivedFile,
  archiveOutputFiles,
  formatFileSize,
} from '../shared/file-attachment.js';
import { type PermissionDeniedSummary, TOOL_APPROVAL_RERUN_KEY } from '../shared/tool-approval.js';
import { errorMessage } from '../utils/error.js';
import {
  MAX_CHARS_FOR_LOG,
  TOOL_APPROVAL_TIMEOUT_MS,
  postMessageWithBlocks,
  postMessageWithContext,
  scheduleExpiry,
} from './app-helpers.js';
import { buildToolApprovalBlocks } from './block-kit.js';
import type { JobRunOutcome, JobSourceFlags, PreparedJobExecution } from './job-runtime-types.js';
import {
  handleClaudePostRunMcpAuth,
  handleCodexPostRunMcpAuth,
  handleGeminiPostRunMcpAuth,
} from './mcp-preflight.js';
import { extractCodexApprovedToolCalls } from './tools/codex.js';
import { formatGeminiMissingToolMessage } from './tools/gemini.js';

export interface PostRunContext {
  allEvents: DriverEvent[];
  textBuffer: string;
  result: RunResult;
  getAnswerText: () => string;
  effectiveToolState: ToolState;
  seenToolUse: boolean;
  permissionDenied: PermissionDeniedSummary | null;
  hasMcpAuthRequired: boolean;
  mcpAuthRequiredServer: string | null;
  mcpAuthRequiredResourceUrl: string | null;
  missingMcpToolName: string | null;
  mcpRuntimeWarningFromEvents: boolean;
  stoppedForMcpBlocked: boolean;
  isClaudeMcpAutoAuthRerun: boolean;
  isGeminiMcpApprovalRerun: boolean;
  isCodexMcpAutoAuthRerun: boolean;
  codexOutputLastMessageUsed: boolean;
  claudeNoOutput: boolean;
  suppressedFailureInfo: boolean;
}

export async function handlePostRunActions(
  ctx: AppContext,
  prepared: PreparedJobExecution,
  outcome: JobRunOutcome,
  postRun: PostRunContext,
): Promise<void> {
  const { job, flags, jobStream, messenger, jlog } = prepared;

  if (shouldSendAnswer(job.tool, postRun)) {
    const answerText = postRun.getAnswerText();
    if (answerText.trim()) {
      messenger.appendText(answerText);
    }
  }

  if (postRun.permissionDenied && job.tool !== 'claude') {
    messenger.replaceBuffer(`Running \`${job.tool}\`...`);
  }

  await messenger.postFinal(buildFinalInfoParts(job.tool, postRun).join(''));

  if (
    shouldPersistAssistantReply(flags) &&
    !postRun.permissionDenied &&
    !postRun.stoppedForMcpBlocked
  ) {
    const answerForStore = postRun.getAnswerText() || postRun.textBuffer;
    if (answerForStore.trim()) {
      ctx.conversationStore.saveMessage(job.sessionKey, 'assistant', answerForStore, job.id);
    }
  }

  if (shouldCaptureTaskOutput(flags)) {
    const raw = postRun.getAnswerText() || postRun.textBuffer;
    outcome.taskOutputRaw = raw;
    outcome.taskOutputSummary = raw.length > 4000 ? `${raw.slice(0, 4000)}… (truncated)` : raw;
  }

  if (flags.isOrchestratorSummary) {
    logOrchestratorSummaryDebug(prepared, outcome, postRun);
  }

  outcome.archivedFiles = archiveArtifacts(prepared);

  if (flags.isDashboard && outcome.archivedFiles.length > 0) {
    const files = toArtifactEntries(outcome.archivedFiles);
    const artifactPayload = JSON.stringify({
      jobId: job.id,
      files,
    });
    if (jobStream) {
      jobStream.onEvent({ type: 'artifacts', content: artifactPayload });
    }
    ctx.conversationStore.saveMessage(
      job.sessionKey,
      'system',
      JSON.stringify({
        type: 'artifacts',
        jobId: job.id,
        files,
      }),
      job.id,
    );
  }

  if (
    flags.isSchedule &&
    outcome.archivedFiles.length > 0 &&
    job.scheduleRunId &&
    ctx.scheduleStore
  ) {
    try {
      ctx.scheduleStore.updateRun(job.scheduleRunId, {
        artifacts: JSON.stringify(toArtifactEntries(outcome.archivedFiles)),
      });
    } catch (err) {
      jlog.warn('schedule_artifact_update_failed', { error: errorMessage(err) });
    }
  }

  if (shouldUseThreadSideEffects(flags)) {
    await handleThreadSideEffects(ctx, prepared, outcome.archivedFiles, postRun);
  }

  if (postRun.permissionDenied && !postRun.hasMcpAuthRequired && !postRun.missingMcpToolName) {
    await handleToolApproval(ctx, prepared, postRun);
  }
}

function shouldPersistAssistantReply(flags: JobSourceFlags): boolean {
  return (
    !flags.isDashboard &&
    !flags.isSchedule &&
    !flags.isAssistant &&
    !flags.isOndemandTask &&
    !flags.isTriggeredTask &&
    !flags.isOrchestratorSummary
  );
}

function shouldCaptureTaskOutput(flags: JobSourceFlags): boolean {
  return (
    flags.isSchedule ||
    flags.isOndemandTask ||
    flags.isTriggeredTask ||
    flags.isOrchestrator ||
    flags.isOrchestratorSummary
  );
}

function shouldUseThreadSideEffects(flags: JobSourceFlags): boolean {
  return (
    !flags.isDashboard &&
    !flags.isSchedule &&
    !flags.isAssistant &&
    !flags.isOndemandTask &&
    !flags.isTriggeredTask
  );
}

function shouldSendAnswer(tool: string, postRun: PostRunContext): boolean {
  if (postRun.permissionDenied || postRun.stoppedForMcpBlocked) {
    return false;
  }

  if (tool === 'claude' || tool === 'gemini') {
    return !postRun.claudeNoOutput;
  }

  return postRun.seenToolUse && !postRun.codexOutputLastMessageUsed;
}

function buildFinalInfoParts(tool: string, postRun: PostRunContext): string[] {
  const parts: string[] = [];

  if (postRun.hasMcpAuthRequired && tool === 'claude') {
    parts.push('\n*Error:* Claude MCP authentication is required.');
  } else if (postRun.hasMcpAuthRequired && tool === 'gemini') {
    parts.push('\n*Error:* Gemini MCP authentication is required.');
  } else if (postRun.missingMcpToolName) {
    parts.push(`\n*Error:* Gemini MCP tool \`${postRun.missingMcpToolName}\` is unavailable.`);
  } else if (postRun.stoppedForMcpBlocked) {
    parts.push('\n*Error:* MCP tools are not allowed for this task (allowMcp=false).');
  } else if (postRun.claudeNoOutput) {
    parts.push(
      '\n*Error:* Claude returned no output. This often happens when a tool call payload is not emitted in the expected stream format. Please retry.',
    );
  }

  if (
    !postRun.suppressedFailureInfo &&
    postRun.result.exitCode !== null &&
    postRun.result.exitCode !== 0
  ) {
    parts.push(`\n_Exit code: ${postRun.result.exitCode}_`);
  }
  if (!postRun.suppressedFailureInfo && postRun.result.errorKind) {
    parts.push(`\n_Error: ${postRun.result.errorKind}_`);
  }

  return parts;
}

function logOrchestratorSummaryDebug(
  prepared: PreparedJobExecution,
  outcome: JobRunOutcome,
  postRun: PostRunContext,
): void {
  const eventCounts: Record<string, number> = {};
  for (const event of postRun.allEvents) {
    eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
  }

  const lastEvents = postRun.allEvents.slice(-5).map((event) => ({
    type: event.type,
    contentLen: event.content.length,
    rawType: (event.raw as Record<string, unknown> | undefined)?.type ?? null,
  }));

  prepared.jlog.info('summary_output_debug', {
    totalEvents: postRun.allEvents.length,
    eventCounts,
    lastEvents,
    textBufferLen: postRun.textBuffer.length,
    answerTextLen: postRun.getAnswerText().length,
    taskOutputRawLen: outcome.taskOutputRaw.length,
    exitCode: postRun.result.exitCode,
    errorKind: postRun.result.errorKind,
    hasToolUse: postRun.allEvents.some((event) => event.type === 'tool_use'),
    hasToolResult: postRun.allEvents.some((event) => event.type === 'tool_result'),
    textBufferPreview: postRun.textBuffer.slice(0, 200),
    answerTextPreview: postRun.getAnswerText().slice(0, 200),
  });
}

function archiveArtifacts(prepared: PreparedJobExecution): ArchivedFile[] {
  const { job, jlog } = prepared;

  try {
    const archivedFiles = archiveOutputFiles(job.workdir, job.id);
    if (archivedFiles.length > 0) {
      jlog.info('output_files_archived', {
        workdir: job.workdir,
        jobId: job.id,
        count: archivedFiles.length,
        files: archivedFiles.map((file) => ({ name: file.filename, size: file.size })),
      });
    }
    return archivedFiles;
  } catch (err) {
    jlog.warn('output_files_archive_failed', { error: errorMessage(err) });
    return [];
  }
}

function toArtifactEntries(files: ArchivedFile[]): Array<{
  filename: string;
  size: number;
  mimeType: string;
}> {
  return files.map((file) => ({
    filename: file.filename,
    size: file.size,
    mimeType: file.mimeType,
  }));
}

async function handleThreadSideEffects(
  ctx: AppContext,
  prepared: PreparedJobExecution,
  archivedFiles: ArchivedFile[],
  postRun: PostRunContext,
): Promise<void> {
  const { job, messenger, jlog, threadKey } = prepared;

  if (archivedFiles.length > 0) {
    let uploaded = 0;
    let uploadedSize = 0;
    const failed: string[] = [];

    for (const file of archivedFiles) {
      const ok = await messenger.uploadBinaryFile(file.localPath, file.filename, file.filename);
      if (ok) {
        uploaded++;
        uploadedSize += file.size;
      } else {
        failed.push(file.filename);
      }
    }

    const parts: string[] = [];
    if (uploaded > 0) {
      parts.push(`Sent ${uploaded} file(s) (${formatFileSize(uploadedSize)}).`);
      if (uploadedSize > 1024 * 1024) {
        parts.push('Large files may take a moment to appear in the thread.');
      }
    }
    if (failed.length > 0) {
      parts.push(`Failed to upload: ${failed.join(', ')}`);
    }
    if (parts.length > 0) {
      await messenger.postStatusMessage(parts.join(' '));
    }
    if (failed.length > 0) {
      jlog.warn('output_files_partial_failure', { uploaded, failed });
    }
  }

  if (postRun.hasMcpAuthRequired) {
    try {
      if (job.tool === 'claude') {
        await handleClaudePostRunMcpAuth(
          ctx,
          {
            job,
            threadKey,
            mcpAuthRequiredServer: postRun.mcpAuthRequiredServer,
            mcpAuthRequiredResourceUrl: postRun.mcpAuthRequiredResourceUrl,
            selectedMcpServers: prepared.selectedMcpServers,
          },
          postRun.isClaudeMcpAutoAuthRerun,
        );
      } else if (job.tool === 'gemini') {
        await handleGeminiPostRunMcpAuth(
          ctx,
          {
            job,
            threadKey,
            mcpAuthRequiredServer: postRun.mcpAuthRequiredServer,
            mcpAuthRequiredResourceUrl: postRun.mcpAuthRequiredResourceUrl,
            selectedMcpServers: prepared.selectedMcpServers,
          },
          postRun.isGeminiMcpApprovalRerun,
        );
      } else if (job.tool === 'codex') {
        await handleCodexPostRunMcpAuth(
          ctx,
          {
            job,
            threadKey,
            mcpAuthRequiredServer: postRun.mcpAuthRequiredServer,
            mcpAuthRequiredResourceUrl: postRun.mcpAuthRequiredResourceUrl,
            selectedMcpServers: prepared.selectedMcpServers,
          },
          postRun.isCodexMcpAutoAuthRerun,
        );
      }
    } catch (err) {
      jlog.error('mcp_auth_request_failed', {
        tool: job.tool,
        error: errorMessage(err),
      });
    }
  }

  if (postRun.missingMcpToolName && !postRun.hasMcpAuthRequired) {
    try {
      await postMessageWithContext(
        ctx,
        ctx.webClient,
        job.channelId,
        job.threadTs,
        formatGeminiMissingToolMessage(
          postRun.missingMcpToolName,
          ctx.config.geminiMcpAuthServer,
          postRun.mcpRuntimeWarningFromEvents,
        ),
        { sessionKey: job.sessionKey, tool: job.tool },
      );
    } catch (err) {
      jlog.error('mcp_tool_unavailable_notification_failed', {
        tool: job.tool,
        missing_tool: postRun.missingMcpToolName,
        error: errorMessage(err),
      });
    }
  }

  if (postRun.textBuffer.length > MAX_CHARS_FOR_LOG) {
    await messenger.uploadFile(postRun.textBuffer, `job_${job.id}.log`, `Full log: ${job.id}`);
  }
}

async function handleToolApproval(
  ctx: AppContext,
  prepared: PreparedJobExecution,
  postRun: PostRunContext,
): Promise<void> {
  const { job, flags, jobStream, messenger, jlog, threadKey } = prepared;
  const permissionDenied = postRun.permissionDenied;
  if (!permissionDenied) return;

  if (prepared.autoApproveEnabled) {
    jlog.info('auto_approve_safety_net', {
      tool: job.tool,
      requestedToolName: permissionDenied.request.toolName,
      deniedTools: permissionDenied.deniedTools,
    });

    const approvedCodexToolCalls =
      job.tool === 'codex' ? extractCodexApprovedToolCalls(postRun.effectiveToolState) : [];
    const toolStateOverrides: ToolState = {
      [TOOL_APPROVAL_RERUN_KEY]: true,
      auto_approve: true,
    };
    for (const toolName of permissionDenied.deniedTools) {
      toolStateOverrides[`approved_tool:${toolName}`] = true;
    }
    if (job.tool === 'codex') {
      toolStateOverrides.codex_approved_tool_calls = [
        ...approvedCodexToolCalls.map((call) => call.toolName),
        ...(permissionDenied.request.toolName ? [permissionDenied.request.toolName] : []),
      ];
    }
    if (job.toolStateOverrides?.gemini_skip_mcp_preflight_once === true) {
      toolStateOverrides.gemini_skip_mcp_preflight_once = true;
    }

    ctx.jobQueue.enqueue({
      ...job,
      id: crypto.randomUUID(),
      toolStateOverrides,
    });

    if (shouldUseThreadSideEffects(flags)) {
      await messenger.postStatusMessage(
        `_Auto-approved tool: \`${permissionDenied.request.toolName}\`_`,
      );
    }
    return;
  }

  const requestId = crypto.randomUUID().slice(0, 8);
  const approvedCodexToolCalls =
    job.tool === 'codex' ? extractCodexApprovedToolCalls(postRun.effectiveToolState) : [];
  const pendingApproval = {
    sessionKey: job.sessionKey,
    tool: job.tool,
    deniedTools: permissionDenied.deniedTools,
    requestedToolName: permissionDenied.request.toolName,
    requestedToolArgs: permissionDenied.request.args,
    approvedCodexToolCalls,
    skipGeminiMcpPreflightOnce: job.toolStateOverrides?.gemini_skip_mcp_preflight_once === true,
    prompt: job.prompt,
    userId: job.userId,
    requestId,
    expiresAt: Date.now() + TOOL_APPROVAL_TIMEOUT_MS,
  };
  const approvalKey = flags.isDashboard || flags.isAssistant ? job.sessionKey : threadKey;
  ctx.pendingToolApprovals.set(approvalKey, pendingApproval, TOOL_APPROVAL_TIMEOUT_MS);
  scheduleExpiry(
    ctx.pendingToolApprovals,
    approvalKey,
    (pending) => pending.requestId === requestId,
    TOOL_APPROVAL_TIMEOUT_MS,
    'tool_approval',
  );

  const approvalPayload = JSON.stringify({
    type: 'tool_approval',
    requestId,
    tool: job.tool,
    requestedToolName: permissionDenied.request.toolName,
    requestedToolArgs: permissionDenied.request.args,
    expiresAt: pendingApproval.expiresAt,
  });
  ctx.conversationStore.saveMessage(job.sessionKey, 'system', approvalPayload, job.id);

  if (jobStream) {
    jobStream.onEvent({ type: 'tool_approval', content: approvalPayload });
  }

  if (!shouldUseThreadSideEffects(flags)) {
    return;
  }

  try {
    const approvalBlocks = buildToolApprovalBlocks(
      pendingApproval,
      threadKey,
      Math.round(TOOL_APPROVAL_TIMEOUT_MS / 1000),
    );
    await postMessageWithBlocks(
      ctx,
      ctx.webClient,
      job.channelId,
      job.threadTs,
      approvalBlocks,
      formatToolApprovalPrompt(pendingApproval, Math.round(TOOL_APPROVAL_TIMEOUT_MS / 1000)),
      { sessionKey: job.sessionKey, tool: job.tool },
    );
  } catch (err) {
    jlog.error('tool_approval_request_failed', {
      tool: job.tool,
      error: errorMessage(err),
    });
  }
}
