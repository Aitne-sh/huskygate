import { describe, expect, it } from 'vitest';
import {
  matchArtifactFile,
  matchArtifacts,
  matchChatMessages,
  matchChatMessagesNew,
  matchChatSend,
  matchChatStatus,
  matchChatStop,
  matchChatUpload,
  matchDevAliasAudit,
  matchDevAliasName,
  matchJobStop,
  matchJobStream,
  matchOndemandTaskExecute,
  matchOndemandTaskId,
  matchOndemandTaskRuns,
  matchOrchestratorCancel,
  matchOrchestratorEdgeId,
  matchOrchestratorEdges,
  matchOrchestratorExecute,
  matchOrchestratorId,
  matchOrchestratorNodeId,
  matchOrchestratorNodes,
  matchOrchestratorRerun,
  matchOrchestratorRevertSnapshot,
  matchOrchestratorRunId,
  matchOrchestratorRunStream,
  matchOrchestratorRuns,
  matchOrchestratorRunsOverview,
  matchOrchestratorValidate,
  matchScheduleTaskId,
  matchScheduleTaskRunDetail,
  matchScheduleTaskRuns,
  matchSessionAudit,
  matchSessionAuditJobMessages,
  matchSessionId,
  matchSessionMcpServerId,
  matchSessionMcpServers,
  matchSessionTrace,
  matchToolApproval,
} from './route-matchers.js';

describe('chat route matchers', () => {
  it('matches chat session id routes', () => {
    expect(matchChatSend('/api/chat/a1b2c3d4/send')).toBe('a1b2c3d4');
    expect(matchChatStop('/api/chat/a1b2c3d4/stop')).toBe('a1b2c3d4');
    expect(matchChatStatus('/api/chat/a1b2c3d4/status')).toBe('a1b2c3d4');
    expect(matchChatMessages('/api/chat/a1b2c3d4/messages')).toBe('a1b2c3d4');
    expect(matchChatMessagesNew('/api/chat/a1b2c3d4/messages/new')).toBe('a1b2c3d4');
    expect(matchChatUpload('/api/chat/a1b2c3d4/upload')).toBe('a1b2c3d4');
    expect(matchToolApproval('/api/chat/a1b2c3d4/tool-approval')).toBe('a1b2c3d4');
    expect(matchArtifacts('/api/chat/a1b2c3d4/artifacts')).toBe('a1b2c3d4');
  });

  it('returns null for non-matching chat session routes', () => {
    expect(matchChatSend('/api/chat/nothex/send')).toBeNull();
    expect(matchChatStop('/api/chat/a1b2c3d4/suspend')).toBeNull();
    expect(matchChatStatus('/api/chat/a1b2c3d4')).toBeNull();
    expect(matchChatMessages('/api/chat/a1b2c3d4/messages/new')).toBeNull();
    expect(matchChatMessagesNew('/api/chat/a1b2c3d4/messages')).toBeNull();
    expect(matchChatUpload('/api/chat/a1b2c3d4/file')).toBeNull();
    expect(matchToolApproval('/api/chat/a1b2c3d4/approval')).toBeNull();
    expect(matchArtifacts('/api/chat/a1b2c3d4/files')).toBeNull();
  });

  it('matches job-stream route', () => {
    expect(matchJobStream('/api/chat/a1b2c3d4/job-stream/deadbeef-1234')).toEqual({
      sessionId: 'a1b2c3d4',
      jobId: 'deadbeef-1234',
    });
  });

  it('returns null for non-matching job-stream route', () => {
    expect(matchJobStream('/api/chat/a1b2c3d4/job-stream/')).toBeNull();
    expect(matchJobStream('/api/chat/a1b2c3d4/job')).toBeNull();
  });

  it('decodes valid artifact filenames', () => {
    expect(matchArtifactFile('/api/chat/a1b2c3d4/artifacts/deadbeef/report%20final.txt')).toEqual({
      sessionId: 'a1b2c3d4',
      jobId: 'deadbeef',
      filename: 'report final.txt',
    });
  });

  it('returns null for malformed or non-matching artifact files', () => {
    expect(matchArtifactFile('/api/chat/a1b2c3d4/artifacts/deadbeef/%E0%A4%A')).toBeNull();
    expect(matchArtifactFile('/api/chat/a1b2c3d4/artifacts')).toBeNull();
  });
});

describe('session/job/dev-alias route matchers', () => {
  it('matches session routes', () => {
    expect(matchSessionId('/api/sessions/a1b2c3d4')).toBe('a1b2c3d4');
    expect(matchSessionAudit('/api/sessions/a1b2c3d4/audit')).toBe('a1b2c3d4');
    expect(matchSessionTrace('/api/sessions/a1b2c3d4/trace')).toBe('a1b2c3d4');
    expect(matchSessionMcpServers('/api/sessions/a1b2c3d4/mcp-servers')).toBe('a1b2c3d4');
    expect(
      matchSessionMcpServerId(
        '/api/sessions/a1b2c3d4/mcp-servers/123e4567-e89b-12d3-a456-426614174000',
      ),
    ).toEqual({
      sessionId: 'a1b2c3d4',
      serverId: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(
      matchSessionAuditJobMessages(
        '/api/sessions/a1b2c3d4/audit/123e4567-e89b-12d3-a456-426614174000/messages',
      ),
    ).toEqual({
      sessionId: 'a1b2c3d4',
      jobId: '123e4567-e89b-12d3-a456-426614174000',
    });
  });

  it('returns null for non-matching session routes', () => {
    expect(matchSessionId('/api/sessions/XYZ')).toBeNull();
    expect(matchSessionAudit('/api/sessions/a1b2c3d4/audit/x')).toBeNull();
    expect(matchSessionTrace('/api/sessions/a1b2c3d4/traces')).toBeNull();
    expect(matchSessionMcpServers('/api/sessions/a1b2c3d4/mcp')).toBeNull();
    expect(matchSessionMcpServerId('/api/sessions/a1b2c3d4/mcp-servers/not-a-uuid')).toBeNull();
    expect(
      matchSessionAuditJobMessages('/api/sessions/a1b2c3d4/audit/deadbeef/messages'),
    ).toBeNull();
  });

  it('matches job stop and dev-alias routes', () => {
    expect(matchJobStop('/api/jobs/sess_deadbeef/stop')).toBe('sess_deadbeef');
    expect(matchDevAliasName('/api/dev-aliases/dev_user-1')).toBe('dev_user-1');
    expect(matchDevAliasAudit('/api/dev-aliases/dev_user-1/audit')).toBe('dev_user-1');
  });

  it('returns null for non-matching job stop and dev-alias routes', () => {
    expect(matchJobStop('/api/jobs/sess_INVALID/stop')).toBeNull();
    expect(matchDevAliasName('/api/dev-aliases/invalid.dot')).toBeNull();
    expect(matchDevAliasAudit('/api/dev-aliases/dev-user/audits')).toBeNull();
  });
});

describe('schedule route matchers', () => {
  it('matches schedule routes', () => {
    const taskId = '123e4567-e89b-12d3-a456-426614174000';
    const runId = '123e4567-e89b-12d3-a456-426614174001';
    expect(matchScheduleTaskId(`/api/schedules/${taskId}`)).toBe(taskId);
    expect(matchScheduleTaskRuns(`/api/schedules/${taskId}/runs`)).toBe(taskId);
    expect(matchScheduleTaskRunDetail(`/api/schedules/${taskId}/runs/${runId}`)).toEqual({
      taskId,
      runId,
    });
  });

  it('returns null for non-matching schedule routes', () => {
    expect(matchScheduleTaskId('/api/schedules/not-uuid')).toBeNull();
    expect(matchScheduleTaskRuns('/api/schedules/not-uuid/runs')).toBeNull();
    expect(matchScheduleTaskRunDetail('/api/schedules/not-uuid/runs/not-uuid')).toBeNull();
  });
});

describe('on-demand task route matchers', () => {
  const taskId = '123e4567-e89b-12d3-a456-426614174000';

  it('matches on-demand task routes', () => {
    expect(matchOndemandTaskId(`/api/ondemand-tasks/${taskId}`)).toBe(taskId);
    expect(matchOndemandTaskRuns(`/api/ondemand-tasks/${taskId}/runs`)).toBe(taskId);
    expect(matchOndemandTaskExecute(`/api/ondemand-tasks/${taskId}/execute`)).toBe(taskId);
  });

  it('returns null for non-matching on-demand task routes', () => {
    expect(matchOndemandTaskId('/api/ondemand-tasks/not-uuid')).toBeNull();
    expect(matchOndemandTaskId('/api/ondemand-tasks/')).toBeNull();
    expect(matchOndemandTaskRuns('/api/ondemand-tasks/not-uuid/runs')).toBeNull();
    expect(matchOndemandTaskExecute('/api/ondemand-tasks/not-uuid/execute')).toBeNull();
    // Trailing segments should not match the base route
    expect(matchOndemandTaskId(`/api/ondemand-tasks/${taskId}/runs`)).toBeNull();
    expect(matchOndemandTaskId(`/api/ondemand-tasks/${taskId}/execute`)).toBeNull();
  });
});

describe('orchestrator route matchers', () => {
  const orchestratorId = '123e4567-e89b-12d3-a456-426614174000';
  const nodeId = '123e4567-e89b-12d3-a456-426614174001';
  const edgeId = '123e4567-e89b-12d3-a456-426614174002';
  const runId = '123e4567-e89b-12d3-a456-426614174003';

  it('matches orchestrator routes', () => {
    expect(matchOrchestratorId(`/api/orchestrators/${orchestratorId}`)).toBe(orchestratorId);
    expect(matchOrchestratorNodes(`/api/orchestrators/${orchestratorId}/nodes`)).toBe(
      orchestratorId,
    );
    expect(matchOrchestratorNodeId(`/api/orchestrators/${orchestratorId}/nodes/${nodeId}`)).toEqual(
      { orchestratorId, nodeId },
    );
    expect(matchOrchestratorEdges(`/api/orchestrators/${orchestratorId}/edges`)).toBe(
      orchestratorId,
    );
    expect(matchOrchestratorEdgeId(`/api/orchestrators/${orchestratorId}/edges/${edgeId}`)).toEqual(
      { orchestratorId, edgeId },
    );
    expect(matchOrchestratorValidate(`/api/orchestrators/${orchestratorId}/validate`)).toBe(
      orchestratorId,
    );
    expect(matchOrchestratorRevertSnapshot(`/api/orchestrators/${orchestratorId}/revert`)).toBe(
      orchestratorId,
    );
    expect(matchOrchestratorExecute(`/api/orchestrators/${orchestratorId}/execute`)).toBe(
      orchestratorId,
    );
    expect(
      matchOrchestratorRunsOverview(`/api/orchestrators/${orchestratorId}/runs-overview`),
    ).toBe(orchestratorId);
    expect(matchOrchestratorRuns(`/api/orchestrators/${orchestratorId}/runs`)).toBe(orchestratorId);
    expect(matchOrchestratorRunId(`/api/orchestrators/${orchestratorId}/runs/${runId}`)).toEqual({
      orchestratorId,
      runId,
    });
    expect(matchOrchestratorRerun(`/api/orchestrators/${orchestratorId}/rerun/${runId}`)).toEqual({
      orchestratorId,
      runId,
    });
    expect(matchOrchestratorCancel(`/api/orchestrators/${orchestratorId}/cancel/${runId}`)).toEqual(
      { orchestratorId, runId },
    );
    expect(
      matchOrchestratorRunStream(`/api/orchestrators/${orchestratorId}/runs/${runId}/stream`),
    ).toEqual({ orchestratorId, runId });
  });

  it('returns null for non-matching orchestrator routes', () => {
    expect(matchOrchestratorId('/api/orchestrators/not-uuid')).toBeNull();
    expect(matchOrchestratorNodes(`/api/orchestrators/${orchestratorId}/node`)).toBeNull();
    expect(
      matchOrchestratorNodeId(`/api/orchestrators/${orchestratorId}/nodes/not-uuid`),
    ).toBeNull();
    expect(matchOrchestratorEdges(`/api/orchestrators/${orchestratorId}/edge`)).toBeNull();
    expect(
      matchOrchestratorEdgeId(`/api/orchestrators/${orchestratorId}/edges/not-uuid`),
    ).toBeNull();
    expect(
      matchOrchestratorValidate(`/api/orchestrators/${orchestratorId}/validations`),
    ).toBeNull();
    expect(
      matchOrchestratorRevertSnapshot(`/api/orchestrators/${orchestratorId}/reverted`),
    ).toBeNull();
    expect(matchOrchestratorExecute(`/api/orchestrators/${orchestratorId}/executions`)).toBeNull();
    expect(
      matchOrchestratorRunsOverview(`/api/orchestrators/${orchestratorId}/runs-overviews`),
    ).toBeNull();
    expect(matchOrchestratorRuns(`/api/orchestrators/${orchestratorId}/run`)).toBeNull();
    expect(matchOrchestratorRunId(`/api/orchestrators/${orchestratorId}/runs/not-uuid`)).toBeNull();
    expect(
      matchOrchestratorRerun(`/api/orchestrators/${orchestratorId}/rerun/not-uuid`),
    ).toBeNull();
    expect(
      matchOrchestratorCancel(`/api/orchestrators/${orchestratorId}/cancel/not-uuid`),
    ).toBeNull();
    expect(
      matchOrchestratorRunStream(`/api/orchestrators/${orchestratorId}/runs/${runId}/streams`),
    ).toBeNull();
  });
});
