import type { SlackClientSurface } from '../context/slack-client-surface.js';
/** @module job-runtime-types — Type definitions and helpers for job execution context, event streaming, and outcomes */
import type { Job } from '../queue/types.js';
import type { Runner } from '../runner/runner.js';
import { type Driver, type DriverEvent, isAggregateTextEvent } from '../runner/types.js';
import type { Session, ToolState } from '../session/types.js';
import type { ArchivedFile } from '../shared/file-attachment.js';
import { formatToolInputSummary } from '../shared/text-utils.js';
import type { McpServerRecord } from '../store/mcp-server.js';
import type { Logger } from '../utils/logger.js';
import { Messenger } from './messenger.js';

export interface JobSourceFlags {
  isDashboard: boolean;
  isSchedule: boolean;
  isAssistant: boolean;
  isOndemandTask: boolean;
  isTriggeredTask: boolean;
  isOrchestrator: boolean;
  isOrchestratorSummary: boolean;
}

export interface JobEventStream {
  onEvent: (event: { type: string; content: string }) => void;
  onDone: (result: { exitCode: number | null; sessionState: Record<string, unknown> }) => void;
}

export interface PreparedJobExecution {
  job: Job;
  flags: JobSourceFlags;
  jobStream: JobEventStream | null;
  threadKey: string;
  messenger: Messenger;
  jlog: Logger;
  driver: Driver;
  session: Session;
  effectiveToolState: ToolState;
  allowMcp: boolean;
  selectedMcpServers: McpServerRecord[];
  autoApproveEnabled: boolean;
  runner: Runner;
  args: string[];
  env: Record<string, string>;
  mcpConfigPath: string | null;
  claudeSessionIdPreStored: boolean;
  codexOutputLastMessagePath: string | null;
}

export interface JobRunOutcome {
  jobFailed: boolean;
  taskOutputSummary: string;
  taskOutputRaw: string;
  taskExitCode: number | null;
  taskErrorKind: string | null;
  archivedFiles: ArchivedFile[];
}

export function driverEventToChatEvent(
  event: DriverEvent,
): { type: string; content: string } | null {
  switch (event.type) {
    case 'text': {
      if (isAggregateTextEvent(event)) return null;
      return { type: 'text', content: event.content };
    }
    case 'tool_use': {
      const inputSummary = formatToolInputSummary(event.toolInput);
      const content = inputSummary ? `${event.content} — ${inputSummary}` : event.content;
      return { type: 'tool_use', content };
    }
    case 'tool_result':
      return { type: 'tool_result', content: event.content };
    case 'error':
      return { type: 'error', content: event.content };
    default:
      return null;
  }
}

export class NullMessenger extends Messenger {
  constructor() {
    super(null as unknown as SlackClientSurface, '', '', null);
  }

  override async postStart(_text: string): Promise<void> {}
  override replaceBuffer(_text: string): void {}
  override appendText(_text: string): void {}
  override async postFinal(_text: string): Promise<void> {}
  override async uploadFile(_content: string, _filename: string, _title: string): Promise<void> {}
  override async uploadBinaryFile(
    _filePath: string,
    _filename: string,
    _title: string,
  ): Promise<boolean> {
    return false;
  }
  override async postStatusMessage(_text: string): Promise<string | null> {
    return null;
  }
}

export function getJobSourceFlags(job: Job): JobSourceFlags {
  return {
    isDashboard: job.source === 'dashboard',
    isSchedule: job.source === 'schedule',
    isAssistant: job.source === 'assistant',
    isOndemandTask: job.source === 'ondemand-task',
    isTriggeredTask: job.source === 'triggered-task',
    isOrchestrator: job.source === 'orchestrator',
    isOrchestratorSummary: job.source === 'orchestrator-summary',
  };
}

export function createInitialJobRunOutcome(): JobRunOutcome {
  return {
    jobFailed: false,
    taskOutputSummary: '',
    taskOutputRaw: '',
    taskExitCode: null,
    taskErrorKind: null,
    archivedFiles: [],
  };
}
