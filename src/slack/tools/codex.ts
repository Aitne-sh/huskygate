/** @module tools/codex — Codex driver helpers: tool-use extraction, MCP auth preflight, and approval state management */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CodexDriver } from '../../runner/driver-codex.js';
import type { Runner } from '../../runner/runner.js';
import type { DriverEvent } from '../../runner/types.js';
import type { ToolState } from '../../session/types.js';
import {
  extractCodexApprovedToolCalls,
  normalizeCodexApprovalArgs,
} from '../../shared/codex-tool-approval.js';
export {
  appendCodexApprovedToolCall,
  buildCodexApprovalToolStateOverridesForCalls,
  CODEX_ALLOW_TOOL_ONCE_LIST_KEY,
  extractCodexApprovedToolCalls,
} from '../../shared/codex-tool-approval.js';
export { CODEX_STICKY_TOOL_STATE_KEYS } from '../../shared/sticky-tool-state.js';
import { evaluateCodexMcpAuthLogin } from '../mcp-auth.js';
import {
  formatMcpAuthGenericFailure,
  isMcpPreflightMarker,
  setMcpPreflightMarker,
} from './tool-state-utils.js';

export const CODEX_MCP_AUTH_VERIFIED_SERVER_KEY = 'codex_mcp_auth_verified_server';

function extractToolUseNameFromContent(content: string): string | null {
  const usingTool = content.match(/^Using tool:\s*(.+)$/i)?.[1]?.trim();
  if (usingTool) return usingTool;
  const callingTool = content.match(/^Calling:\s*(.+)$/i)?.[1]?.trim();
  if (callingTool) return callingTool;
  return null;
}

export interface CodexToolUseRequest {
  toolName: string | null;
  args: unknown | null;
}

function extractCodexToolUseRequest(event: DriverEvent): CodexToolUseRequest | null {
  if (event.type !== 'tool_use') return null;

  let toolName = extractToolUseNameFromContent(event.content);
  let args: unknown | null = null;

  const raw = event.raw;
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    if (typeof record.tool_name === 'string') {
      toolName = record.tool_name;
    }
    if (record.parameters !== undefined) {
      args = record.parameters;
    } else if (record.args !== undefined) {
      args = record.args;
    }

    const item =
      record.item && typeof record.item === 'object'
        ? (record.item as Record<string, unknown>)
        : null;
    if (item) {
      if (typeof item.name === 'string') {
        toolName = item.name;
      }
      if (item.arguments !== undefined) {
        args = item.arguments;
      } else if (item.args !== undefined) {
        args = item.args;
      } else if (item.input !== undefined) {
        args = item.input;
      }
    }

    const contentBlock =
      record.content_block && typeof record.content_block === 'object'
        ? (record.content_block as Record<string, unknown>)
        : null;
    if (contentBlock) {
      if (typeof contentBlock.name === 'string') {
        toolName = contentBlock.name;
      }
      if (contentBlock.input !== undefined) {
        args = contentBlock.input;
      } else if (contentBlock.arguments !== undefined) {
        args = contentBlock.arguments;
      } else if (contentBlock.partial_json !== undefined) {
        args = contentBlock.partial_json;
      }
    }
  }

  if (!toolName && args === null) return null;
  return { toolName, args };
}

export interface CodexToolApprovalGate {
  approvedToolCallsRemaining: Array<{
    toolName: string;
    argsNormalized: string | null;
  }>;
  proactiveApprovalRequest: CodexToolUseRequest | null;
}

export interface CodexToolApprovalEvaluation {
  shouldBlock: boolean;
  gate: CodexToolApprovalGate;
}

export function createCodexToolApprovalGate(toolState: ToolState): CodexToolApprovalGate {
  const approvedToolCalls = extractCodexApprovedToolCalls(toolState).map((call) => ({
    toolName: call.toolName,
    argsNormalized: normalizeCodexApprovalArgs(call.args),
  }));
  return {
    approvedToolCallsRemaining: approvedToolCalls,
    proactiveApprovalRequest: null,
  };
}

export function evaluateCodexToolUseForApproval(
  gate: CodexToolApprovalGate,
  event: DriverEvent,
): CodexToolApprovalEvaluation {
  const request = extractCodexToolUseRequest(event);
  if (!request) return { shouldBlock: false, gate };

  const requestedArgsNormalized = normalizeCodexApprovalArgs(request.args);
  const approvedIndex = gate.approvedToolCallsRemaining.findIndex(
    (approved) =>
      request.toolName === approved.toolName &&
      (approved.argsNormalized === null || requestedArgsNormalized === approved.argsNormalized),
  );
  if (approvedIndex >= 0) {
    const nextRemaining = [...gate.approvedToolCallsRemaining];
    nextRemaining.splice(approvedIndex, 1);
    return {
      shouldBlock: false,
      gate: {
        ...gate,
        approvedToolCallsRemaining: nextRemaining,
      },
    };
  }

  return {
    shouldBlock: true,
    gate: {
      ...gate,
      proactiveApprovalRequest: request,
    },
  };
}

export interface CodexPermissionDeniedSummary {
  deniedTools: string[];
  request: {
    toolName: string | null;
    args: unknown | null;
  };
}

export function buildCodexPermissionDeniedSummary(
  gate: CodexToolApprovalGate,
): CodexPermissionDeniedSummary | null {
  const request = gate.proactiveApprovalRequest;
  if (!request) return null;
  return {
    deniedTools: request.toolName ? [request.toolName] : [],
    request: {
      toolName: request.toolName,
      args: request.args,
    },
  };
}

export interface CodexOutputLastMessageCapture {
  args: string[];
  outputLastMessagePath: string;
}

export async function prepareCodexOutputLastMessageCapture(
  args: string[],
  workdir: string,
  jobId: string,
): Promise<CodexOutputLastMessageCapture> {
  const codexOutDir = path.join(workdir, '.orchestrator');
  await fs.mkdir(codexOutDir, { recursive: true });

  const outputLastMessagePath = path.join(codexOutDir, `codex_last_${jobId}.txt`);
  // `--output-last-message` must be passed as an `exec` option.
  // Insert it immediately after `exec` so top-level codex options (`-s`, `-a`, etc.) stay outside.
  const nextArgs = [...args];
  const execIndex = nextArgs.indexOf('exec');
  if (execIndex < 0) {
    return {
      args: nextArgs,
      outputLastMessagePath,
    };
  }
  nextArgs.splice(execIndex + 1, 0, '--output-last-message', outputLastMessagePath);
  return {
    args: nextArgs,
    outputLastMessagePath,
  };
}

export async function consumeCodexOutputLastMessage(filePath: string): Promise<string | null> {
  let content: string | null = null;
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const trimmed = raw.trim();
    content = trimmed.length > 0 ? trimmed : null;
  } catch {
    content = null;
  }

  try {
    await fs.unlink(filePath);
  } catch {
    // ignore
  }

  return content;
}

export interface CodexMcpAuthPreflightResult {
  ok: boolean;
  events: DriverEvent[];
  exitCode: number | null;
  errorKind: string | null;
  requiredServer: string | null;
  requiredResourceUrl: string | null;
}

export interface CodexMcpListResult {
  events: DriverEvent[];
  exitCode: number | null;
  errorKind: string | null;
  servers: CodexMcpServerInfo[];
  serverNames: string[];
}

export interface CodexMcpServerInfo {
  name: string;
  url: string | null;
  status: string | null;
  auth: string | null;
}

function parseCodexMcpServerLine(line: string): CodexMcpServerInfo | null {
  const columns = line
    .split(/\s{2,}/)
    .map((column) => column.trim())
    .filter((column) => column.length > 0);
  if (columns.length < 2) return null;

  const name = columns[0] as string;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(name)) return null;
  if (name.toLowerCase() === 'name') return null;

  const status = columns[columns.length - 2] as string;
  const auth = columns[columns.length - 1] as string;
  const url = columns[1] as string;

  if (status?.toLowerCase() === 'status' && auth?.toLowerCase() === 'auth') return null;

  return {
    name,
    url,
    status,
    auth,
  };
}

function extractCodexMcpServers(events: DriverEvent[]): CodexMcpServerInfo[] {
  const serverByName = new Map<string, CodexMcpServerInfo>();
  for (const event of events) {
    if (event.type !== 'text' && event.type !== 'status' && event.type !== 'error') continue;
    const lines = event.content.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || /^[-=+|]+$/.test(line)) continue;
      const parsed = parseCodexMcpServerLine(line);
      if (!parsed) continue;
      serverByName.set(parsed.name, parsed);
    }
  }
  return [...serverByName.values()];
}

export function selectCodexMcpAuthServer(
  listResult: CodexMcpListResult,
  preferredServer: string | null,
): string | null {
  if (preferredServer) {
    const found = listResult.servers.find((server) => server.name === preferredServer);
    if (found) return found.name;
    if (listResult.servers.length === 0) return preferredServer;
  }
  if (listResult.servers.length === 1) {
    const onlyServer = listResult.servers[0];
    if (onlyServer) return onlyServer.name;
  }
  return null;
}

export function isCodexMcpServerAuthUnsupported(
  listResult: CodexMcpListResult,
  serverName: string,
): boolean {
  const server = listResult.servers.find((candidate) => candidate.name === serverName);
  if (!server?.auth) return false;
  return server.auth.trim().toLowerCase() === 'unsupported';
}

export function isCodexMcpPreflightVerified(toolState: ToolState, server: string): boolean {
  return isMcpPreflightMarker(toolState, CODEX_MCP_AUTH_VERIFIED_SERVER_KEY, server);
}

export function markCodexMcpPreflightVerified(toolState: ToolState, server: string): ToolState {
  return setMcpPreflightMarker(toolState, CODEX_MCP_AUTH_VERIFIED_SERVER_KEY, server);
}

export function formatCodexMcpAuthRequiredMessage(
  server: string | null,
  resourceUrl: string | null,
): string {
  const serverHint = server ? `server \`${server}\`` : 'the configured MCP server';
  const resourceHint = resourceUrl ? `\nResource: \`${resourceUrl}\`` : '';
  const preflightHint = server
    ? ''
    : '\n`CODEX_MCP_AUTH_SERVER` is not configured, so automatic preflight is disabled. Set it (for example `aws-api`) to validate auth before Codex jobs run.';
  return `Codex MCP authentication is required for ${serverHint}.${resourceHint}\nRun \`codex mcp list\` to check the server name and auth state, then run \`codex mcp login ${server ?? '<server-name>'}\` in a local interactive terminal and retry.${preflightHint}\nIf \`codex mcp list\` shows Auth as \`Unsupported\`, Codex cannot complete OAuth for that server in this configuration; use a bearer token (\`bearer_token_env_var\`) or run the request with another tool.`;
}

export function formatCodexMcpAuthGenericFailureMessage(
  server: string,
  exitCode: number | null,
  errorKind: string | null,
): string {
  return formatMcpAuthGenericFailure('Codex', server, exitCode, errorKind);
}

export async function runCodexMcpAuthPreflight(
  runner: Runner,
  env: Record<string, string>,
  cwd: string,
  server: string,
): Promise<CodexMcpAuthPreflightResult> {
  const driver = new CodexDriver();
  const args = ['mcp', 'login', server];
  const events: DriverEvent[] = [];

  const result = await runner.run(driver, args, env, cwd, (event) => {
    events.push(event);
  });

  const evaluated = evaluateCodexMcpAuthLogin(events);
  const ok =
    result.exitCode === 0 &&
    result.errorKind === null &&
    evaluated.requiredServer === null &&
    evaluated.requiredResourceUrl === null &&
    !evaluated.tokenRefreshFailed;

  return {
    ok,
    events,
    exitCode: result.exitCode,
    errorKind: result.errorKind,
    requiredServer: evaluated.requiredServer,
    requiredResourceUrl: evaluated.requiredResourceUrl,
  };
}

export async function runCodexMcpList(
  runner: Runner,
  env: Record<string, string>,
  cwd: string,
): Promise<CodexMcpListResult> {
  const driver = new CodexDriver();
  const args = ['mcp', 'list'];
  const events: DriverEvent[] = [];

  const result = await runner.run(driver, args, env, cwd, (event) => {
    events.push(event);
  });
  const servers = extractCodexMcpServers(events);

  return {
    events,
    exitCode: result.exitCode,
    errorKind: result.errorKind,
    servers,
    serverNames: servers.map((server) => server.name),
  };
}
