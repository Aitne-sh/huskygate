/** @module app-types — Shared type definitions for pending confirmations, tool approvals, and active runners */
import type { ToolName } from '../config.js';
import type { Job } from '../queue/types.js';
import type { Runner } from '../runner/runner.js';
import type { Mode } from '../session/types.js';
import type { CodexApprovedToolCall } from '../shared/codex-tool-approval.js';

export interface PendingModeConfirmation {
  kind: 'mode';
  mode: Mode;
  code: string;
  expiresAt: number;
  sessionKey: string;
}

export interface PendingWorkdirConfirmation {
  kind: 'workdir';
  workdir: string;
  code: string;
  expiresAt: number;
  sessionKey: string;
}

export type PendingConfirmation = PendingModeConfirmation | PendingWorkdirConfirmation;

export interface PendingToolApproval {
  sessionKey: string;
  tool: ToolName;
  deniedTools: string[];
  requestedToolName: string | null;
  requestedToolArgs: unknown | null;
  approvedCodexToolCalls: CodexApprovedToolCall[];
  skipGeminiMcpPreflightOnce: boolean;
  prompt: string;
  userId: string;
  requestId: string;
  expiresAt: number;
}

export interface PendingMcpAuthBypassApproval {
  sessionKey: string;
  tool: Extract<ToolName, 'claude' | 'gemini'>;
  server: string;
  action: 'skip_preflight_once' | 'retry_with_preauth';
  prompt: string | null;
  userId: string;
  requestId: string;
  expiresAt: number;
}

export interface ActiveRunner {
  runner: Runner;
  job: Job;
}
