/** @module engine-notify — Slack notifications for node completions, run summaries, and artifact uploads. */

import { MAX_FILE_UPLOADS, listAllArtifacts } from '../shared/file-attachment.js';
import { formatMention, splitTextToChunks } from '../shared/text-utils.js';
import { logger } from '../utils/logger.js';
import { formatDuration, resolveNodeWorkdir } from './engine-utils.js';
import type { EngineContext } from './engine.js';
import type { ActiveOrchestrationRun, OrchestrationNodeRun, OrchestratorNode } from './types.js';

export async function sendNodeNotification(
  ctx: EngineContext,
  active: ActiveOrchestrationRun,
  nodeRun: OrchestrationNodeRun,
  node: OrchestratorNode,
): Promise<void> {
  if (!ctx.postNotification) return;

  const shouldNotify =
    (node.notifyEnabled && nodeRun.status === 'completed') ||
    (node.notifyOnError && nodeRun.status === 'failed');

  if (!shouldNotify) return;

  const channel =
    node.notifyChannel ?? active.orchestrator.notifyChannel ?? ctx.defaultNotifyChannel;

  if (!channel) return;

  const duration =
    nodeRun.startedAt && nodeRun.endedAt
      ? formatDuration(new Date(nodeRun.endedAt).getTime() - new Date(nodeRun.startedAt).getTime())
      : 'N/A';

  const emoji = nodeRun.status === 'completed' ? '✅' : '❌';
  let text = `${emoji} *[Orchestrator: ${active.orchestrator.name}]*\n`;
  text += `Node "${node.label}" ${nodeRun.status}\n`;
  text += `Return: ${nodeRun.returnValue ?? '(none)'} | Exit: ${nodeRun.exitCode ?? 'N/A'} | Duration: ${duration}`;

  if (nodeRun.status === 'failed' && nodeRun.retryCount < node.maxRetries) {
    text += `\nRetry: ${nodeRun.retryCount + 1}/${node.maxRetries}`;
  }

  if (nodeRun.status === 'failed' && nodeRun.errorMessage) {
    const truncatedError =
      nodeRun.errorMessage.length > 1000
        ? `${nodeRun.errorMessage.slice(0, 1000)}…`
        : nodeRun.errorMessage;
    text += `\n\nError:\n\`\`\`${truncatedError}\`\`\``;
  }

  try {
    await ctx.postNotification(channel, text);
  } catch (err) {
    logger.error('orchestrator_node_notification_failed', {
      runId: active.runId,
      nodeId: node.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function sendCompletionNotification(
  ctx: EngineContext,
  active: ActiveOrchestrationRun,
  status: 'completed' | 'failed' | 'cancelled',
): Promise<{ channelId: string; ts: string } | null> {
  if (!ctx.postNotification) return null;

  const channel = active.orchestrator.notifyChannel ?? ctx.defaultNotifyChannel;

  if (!channel) return null;

  const duration = formatDuration(Date.now() - active.startedAt);
  const totalNodes = active.dag.topologicalOrder.length;
  const completedNodes = [...active.nodeRuns.values()].filter(
    (r) => r.status === 'completed',
  ).length;

  const emoji = status === 'completed' ? '🏁' : status === 'failed' ? '💥' : '⛔';
  const mention = formatMention(active.orchestrator.userId);
  let text = mention ? `${mention}\n` : '';
  text += `${emoji} *Orchestrator "${active.orchestrator.name}" ${status}*\n`;
  text += `Status: ${status} | Nodes: ${completedNodes}/${totalNodes} | Duration: ${duration}\n`;

  for (const nodeId of active.dag.topologicalOrder) {
    const node = active.dag.nodes.get(nodeId);
    const nodeRun = active.nodeRuns.get(nodeId);
    if (!node) continue;

    const nodeEmoji =
      nodeRun?.status === 'completed'
        ? '✅'
        : nodeRun?.status === 'failed'
          ? '❌'
          : nodeRun?.status === 'skipped'
            ? '⏭️'
            : nodeRun?.status === 'cancelled'
              ? '⛔'
              : '⬜';

    const nodeDuration =
      nodeRun?.startedAt && nodeRun?.endedAt
        ? formatDuration(
            new Date(nodeRun.endedAt).getTime() - new Date(nodeRun.startedAt).getTime(),
          )
        : '';

    const returnInfo = nodeRun?.returnValue ? `${nodeRun.returnValue}` : '';
    const parts = [returnInfo, nodeDuration].filter(Boolean).join(', ');

    text += `├─ ${nodeEmoji} ${node.label}${parts ? ` (${parts})` : ''}\n`;
  }

  let posted: { channelId: string; ts: string } | null = null;
  try {
    posted = await ctx.postNotification(channel, text);
  } catch (err) {
    logger.error('orchestrator_completion_notification_failed', {
      runId: active.runId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (posted) {
    try {
      await postNodeOutputs(ctx, active, posted.channelId, posted.ts);
    } catch (err) {
      logger.error('orchestrator_output_post_error', {
        runId: active.runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (ctx.uploadFile) {
      try {
        await uploadRunArtifacts(ctx, active, posted.channelId, posted.ts);
      } catch (err) {
        logger.error('orchestrator_artifact_upload_error', {
          runId: active.runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return posted;
}

/** Post per-node full output as threaded code blocks. */
async function postNodeOutputs(
  ctx: EngineContext,
  active: ActiveOrchestrationRun,
  channel: string,
  threadTs: string,
): Promise<void> {
  if (!ctx.postNotification) return;
  for (const nodeId of active.dag.topologicalOrder) {
    const node = active.dag.nodes.get(nodeId);
    const nodeRun = active.nodeRuns.get(nodeId);
    if (!node || !nodeRun?.outputFull?.trim()) continue;

    const chunks = splitTextToChunks(nodeRun.outputFull);
    for (const chunk of chunks) {
      try {
        await ctx.postNotification(channel, `*${node.label}:*\n\`\`\`${chunk}\`\`\``, threadTs);
      } catch (err) {
        logger.warn('orchestrator_output_chunk_post_failed', {
          runId: active.runId,
          nodeId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

/** Upload run artifacts to Slack as file attachments in the notification thread. */
export async function uploadRunArtifacts(
  ctx: EngineContext,
  active: ActiveOrchestrationRun,
  channel: string,
  threadTs: string,
): Promise<void> {
  const uploadFile = ctx.uploadFile;
  if (!uploadFile) return;
  const currentJobIds = new Set(
    [...active.nodeRuns.values()]
      .map((nodeRun) => nodeRun.jobId)
      .filter((jobId): jobId is string => typeof jobId === 'string' && jobId.length > 0),
  );
  if (currentJobIds.size === 0) return;

  const workdirs = new Set<string>();
  for (const nodeId of active.dag.topologicalOrder) {
    const node = active.dag.nodes.get(nodeId);
    if (!node || node.nodeType !== 'task') continue;
    workdirs.add(resolveNodeWorkdir(active.orchestrator, node, active.runId));
  }
  if (workdirs.size === 0) return;

  let uploaded = 0;
  let attempted = 0;

  for (const workdir of workdirs) {
    const artifacts = listAllArtifacts(workdir).filter((entry) => currentJobIds.has(entry.jobId));
    for (const { files } of artifacts) {
      for (const file of files) {
        if (attempted >= MAX_FILE_UPLOADS) break;
        attempted++;
        try {
          await uploadFile(channel, file.localPath, file.filename, threadTs);
          uploaded++;
        } catch (err) {
          const slackData =
            typeof err === 'object' && err !== null
              ? (
                  err as {
                    data?: {
                      error?: string;
                      response_metadata?: { messages?: string[] | null } | null;
                    };
                  }
                ).data
              : undefined;
          logger.error('orchestrator_artifact_upload_failed', {
            runId: active.runId,
            channel,
            threadTs,
            file: file.filename,
            filePath: file.localPath,
            fileSize: file.size,
            error: err instanceof Error ? err.message : String(err),
            slackError: slackData?.error ?? null,
            slackDetail: slackData?.response_metadata?.messages ?? null,
          });
        }
      }
      if (attempted >= MAX_FILE_UPLOADS) break;
    }
    if (attempted >= MAX_FILE_UPLOADS) break;
  }

  if (uploaded > 0) {
    logger.info('orchestrator_artifacts_uploaded', { runId: active.runId, count: uploaded });
  }
}
