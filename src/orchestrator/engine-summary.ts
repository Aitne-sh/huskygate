/** @module engine-summary — Post-run summary job: report generation, prompt building, and tag extraction. */

import crypto from 'node:crypto';
import type { Job } from '../queue/types.js';
import type { ToolState } from '../session/types.js';
import { SIZE_LIMITS, TIMEOUTS } from '../shared/constants.js';
import { logger } from '../utils/logger.js';
import { formatDuration } from './engine-utils.js';
import type { EngineContext } from './engine.js';
import type { OrchestrationNodeRun, Orchestrator, OrchestratorNode } from './types.js';

const MAX_OUTPUT_PER_NODE = SIZE_LIMITS.maxOutputPerNode;
const MAX_RUN_REPORT_CHARS = SIZE_LIMITS.maxRunReportChars;
const SUMMARY_TIMEOUT_SEC = TIMEOUTS.summaryGenerationSec;

/** Build the summary prompt with the report embedded directly (avoids tool calls in readonly mode). */
export function buildSummaryPrompt(report: string): string {
  return `Produce the execution summary inside <summary> tags as described in the instruction.\n\n---\n\n${report}`;
}

export interface SummaryJobParams {
  orchestrator: Orchestrator;
  runId: string;
  status: 'completed' | 'failed';
  startedAt: number;
  endedAt: string;
  nodeRuns: OrchestrationNodeRun[];
  nodes: OrchestratorNode[];
  nodeOrder: string[];
  notifyChannelId: string;
  notifyThreadTs: string;
}

export function startSummaryJob(ctx: EngineContext, params: SummaryJobParams): boolean {
  const tool = params.orchestrator.summaryTool;
  if (!tool) return false;
  const report = buildRunReport(params);

  let session: ReturnType<EngineContext['createSession']>;
  try {
    session = ctx.createSession(tool, params.orchestrator.userId, 'readonly');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('summary_session_create_failed', {
      runId: params.runId,
      error: message,
    });
    notifySummaryFailure(ctx, params, `Execution summary could not start: ${message}`);
    return false;
  }

  const summaryWorkdir = session.workdir;
  const toolStateOverrides = buildSummaryToolStateOverrides(tool);

  const job: Job = {
    id: crypto.randomUUID(),
    sessionKey: session.sessionKey,
    channelId: '',
    threadTs: '',
    userId: params.orchestrator.userId,
    tool,
    mode: 'readonly',
    prompt: buildSummaryPrompt(report),
    workdir: summaryWorkdir,
    toolState: {},
    toolStateOverrides,
    createdAt: Date.now(),
    source: 'orchestrator-summary',
    orchestrationRunId: params.runId,
    autoApprove: false,
    timeoutSec: SUMMARY_TIMEOUT_SEC,
    executionPolicy: { allowMcp: false, enabledSkills: [] },
    instructionOverride: buildSummaryInstruction(),
    summaryNotifyChannel: params.notifyChannelId,
    summaryNotifyThreadTs: params.notifyThreadTs,
  };

  let result: ReturnType<EngineContext['enqueueJob']>;
  try {
    result = ctx.enqueueJob(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('summary_job_enqueue_threw', {
      runId: params.runId,
      error: message,
    });
    try {
      ctx.cleanupSession(session.sessionKey);
    } catch (cleanupErr) {
      logger.warn('summary_session_cleanup_failed', {
        runId: params.runId,
        sessionKey: session.sessionKey,
        error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
      });
    }
    notifySummaryFailure(ctx, params, `Execution summary could not start: ${message}`);
    return false;
  }
  if ('error' in result && result.error) {
    logger.error('summary_job_enqueue_failed', {
      runId: params.runId,
      error: result.error,
    });
    try {
      ctx.cleanupSession(session.sessionKey);
    } catch (cleanupErr) {
      logger.warn('summary_session_cleanup_failed', {
        runId: params.runId,
        sessionKey: session.sessionKey,
        error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
      });
    }
    notifySummaryFailure(ctx, params, `Execution summary could not start: ${result.error}`);
    return false;
  }

  logger.info('summary_job_started', {
    runId: params.runId,
    jobId: job.id,
    tool,
    workdir: summaryWorkdir,
  });
  return true;
}

function buildSummaryToolStateOverrides(
  tool: NonNullable<Orchestrator['summaryTool']>,
): ToolState | undefined {
  if (tool === 'claude') {
    // Summary jobs run under repo-local workdirs; ignore project/local Claude
    // settings so repository-scoped config cannot alter or block the run.
    return { claude_setting_sources: 'user' };
  }
  if (tool === 'codex') {
    // Summary jobs may run under non-repo workdir roots, so bypass Codex's
    // repo trust check only for this standalone readonly summary execution.
    return { codex_skip_git_repo_check: true };
  }
  return undefined;
}

export function buildRunReport(params: SummaryJobParams): string {
  const nodeMap = new Map(params.nodes.map((node) => [node.id, node]));
  const nodeRunsByNodeId = new Map(params.nodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun]));
  const duration = formatDuration(Math.max(0, Date.parse(params.endedAt) - params.startedAt));
  const completed = params.nodeRuns.filter((run) => run.status === 'completed').length;
  const failed = params.nodeRuns.filter((run) => run.status === 'failed').length;
  const skipped = params.nodeRuns.filter(
    (run) => run.status === 'skipped' || run.status === 'cancelled',
  ).length;

  const lines: string[] = [
    '# Orchestration Run Report',
    '',
    '## Overview',
    '',
    '| Item | Value |',
    '|------|-------|',
    `| Orchestrator | ${params.orchestrator.name} |`,
    `| Run ID | ${params.runId} |`,
    `| Status | ${params.status} |`,
    `| Duration | ${duration} |`,
    `| Nodes | ${completed} completed, ${failed} failed, ${skipped} skipped |`,
    `| Started at | ${new Date(params.startedAt).toISOString()} |`,
    `| Ended at | ${params.endedAt} |`,
    '',
    '## Node Results',
    '',
  ];

  let nodeIndex = 0;
  for (const nodeId of params.nodeOrder) {
    const node = nodeMap.get(nodeId);
    const nodeRun = nodeRunsByNodeId.get(nodeId);
    if (!node || node.nodeType !== 'task' || !nodeRun) continue;

    nodeIndex += 1;
    lines.push(`### ${nodeIndex}. ${node.label} (${node.tool ?? 'unknown'})`);
    lines.push('');
    lines.push(`- Status: ${nodeRun.status}`);
    lines.push(`- Exit Code: ${nodeRun.exitCode ?? 'N/A'}`);
    lines.push(`- Duration: ${formatNodeDuration(nodeRun)}`);
    lines.push(`- Return Value: ${nodeRun.returnValue ?? '(none)'}`);
    if (nodeRun.errorMessage) {
      lines.push(`- Error: ${nodeRun.errorMessage}`);
    }

    const output = nodeRun.outputFull ?? nodeRun.outputSummary;
    if (output) {
      lines.push('');
      lines.push('```text');
      lines.push(truncateOutput(output));
      lines.push('```');
    }
    lines.push('');
  }

  const gateLines = params.nodeOrder
    .map((nodeId) => {
      const node = nodeMap.get(nodeId);
      const nodeRun = nodeRunsByNodeId.get(nodeId);
      if (!node || node.nodeType !== 'gate' || !nodeRun) return null;
      return `- ${node.label}: ${nodeRun.returnValue ?? 'N/A'}${nodeRun.gateEvaluation ? ` (${nodeRun.gateEvaluation})` : ''}`;
    })
    .filter((line): line is string => line !== null);
  if (gateLines.length > 0) {
    lines.push('## Gate Results');
    lines.push('');
    lines.push(...gateLines);
    lines.push('');
  }

  return truncateRunReport(lines.join('\n'));
}

/** Return the summary agent system instruction (embedded as template literal for bundler compat). */
export function buildSummaryInstruction(): string {
  return `\
# Task Summary Agent

You are a task summary reporter. The orchestration run report is provided directly in the prompt. Produce a concise execution summary based strictly on the data present in the report.

## Output Format

- Wrap your **entire** final summary inside \`<summary>\` and \`</summary>\` tags.
- Use Markdown formatting inside the tags (headings, bullet lists, **bold**, \`code\`).
- Everything outside the \`<summary>\` tags is discarded — do not put any part of the summary outside them.

## Structure

1. **Overview** — 2-3 sentence executive summary: overall status, duration, and outcome.
2. **Results** — Bullet list of each task node with its status.
3. **Metrics** — Include counts, durations, or other numbers when present.
4. **Follow-up** — Only when the report contains explicit error messages or failure details, state the cause and recommended actions.

Omit sections that have no relevant content (e.g. skip Follow-up if everything succeeded).

## Constraints

- Output **only** the \`<summary>\` block.
- **Do not use any tools.** The report is already in the prompt — do not call Read, Glob, Bash, or any other tool.
- **Summarize only what is in the report.** Do not speculate, add warnings about absent data, or comment on the report structure. If the report lists one task node, summarize that one node.
- Do not repeat long raw logs verbatim; summarize them.
- Match the language used in the run report (e.g. if the report is in Japanese, write the summary in Japanese).
- Do not create, edit, or delete any files.

## Example

<summary>

## Overview
The orchestration **completed successfully** in 2m 30s. All 3 task nodes finished without errors.

## Results
- **Fetch Data** (claude): Completed (exit 0) — 45s
- **Transform** (gemini): Completed (exit 0) — 1m 10s
- **Upload** (claude): Completed (exit 0) — 35s

## Metrics
- Total nodes: 3 completed, 0 failed, 0 skipped

</summary>
`;
}

const SUMMARY_OPEN_TAG = '<summary>';
const SUMMARY_CLOSE_TAG = '</summary>';

/** Extract content from the last `<summary>...</summary>` pair, or null if absent. */
export function extractSummaryContent(raw: string): string | null {
  const open = raw.lastIndexOf(SUMMARY_OPEN_TAG);
  const close = raw.lastIndexOf(SUMMARY_CLOSE_TAG);
  if (open < 0 || close <= open) return null;
  const content = raw.slice(open + SUMMARY_OPEN_TAG.length, close).trim();
  return content || null;
}

function truncateOutput(output: string): string {
  return output.length > MAX_OUTPUT_PER_NODE
    ? `${output.slice(0, MAX_OUTPUT_PER_NODE)}\n\n... (truncated at ${MAX_OUTPUT_PER_NODE} chars)`
    : output;
}

function truncateRunReport(report: string): string {
  if (report.length <= MAX_RUN_REPORT_CHARS) return report;

  const suffix = `\n\n... (overall run report truncated at ${MAX_RUN_REPORT_CHARS} chars)`;
  const truncated = report.slice(0, Math.max(0, MAX_RUN_REPORT_CHARS - suffix.length));
  const fenceCount = (truncated.match(/```/g) ?? []).length;
  const closedFence = fenceCount % 2 === 1 ? `${truncated}\n\`\`\`` : truncated;
  return `${closedFence}${suffix}`;
}

function formatNodeDuration(nodeRun: OrchestrationNodeRun): string {
  if (!nodeRun.startedAt || !nodeRun.endedAt) return 'N/A';
  return formatDuration(Math.max(0, Date.parse(nodeRun.endedAt) - Date.parse(nodeRun.startedAt)));
}

function notifySummaryFailure(
  ctx: EngineContext,
  params: Pick<SummaryJobParams, 'notifyChannelId' | 'notifyThreadTs' | 'runId'>,
  message: string,
): void {
  if (!ctx.postNotification) return;
  void ctx
    .postNotification(params.notifyChannelId, `:warning: ${message}`, params.notifyThreadTs)
    .catch((err) => {
      logger.warn('summary_failure_notification_failed', {
        runId: params.runId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}
