import { describe, expect, it } from 'vitest';
import codexPlugin from './codex-plugin.js';

describe('codex plugin', () => {
  it('returns codex auth server from config', () => {
    const config = { codexMcpAuthServer: 'aws-api' };
    expect(codexPlugin.getMcpAuthServer(config as never)).toBe('aws-api');
  });

  it('clears codex MCP auth markers', () => {
    const next = codexPlugin.clearMcpAuthState({
      codex_mcp_auth_verified_server: 'aws-api',
      codex_mcp_auth_approval_rerun: true,
      keep: 'ok',
    });
    expect(next).toEqual({
      codex_mcp_auth_approval_rerun: true,
      keep: 'ok',
    });
  });

  it('clears thread_id on MCP auth failure so retry starts fresh', () => {
    const next = codexPlugin.clearMcpAuthState({
      codex_mcp_auth_verified_server: 'aws-api',
      thread_id: '019c6ac0-4aa9-73e2-a71c-5698baa8c4f3',
      keep: 'ok',
    });
    expect(next).toEqual({ keep: 'ok' });
    expect(next.thread_id).toBeUndefined();
  });

  it('allows pre-approved codex tool call once', () => {
    const gate = codexPlugin.createApprovalGate({
      codex_allow_tool_once_list: [{ toolName: 'aws_execute', args: { cmd: 'whoami' } }],
    });

    const first = codexPlugin.evaluateToolUse(gate, {
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      raw: { tool_name: 'aws_execute', parameters: { cmd: 'whoami' } },
    });
    expect(first.shouldBlock).toBe(false);

    const second = codexPlugin.evaluateToolUse(first.gate, {
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      raw: { tool_name: 'aws_execute', parameters: { cmd: 'whoami' } },
    });
    expect(second.shouldBlock).toBe(true);
    expect(codexPlugin.buildPermissionDeniedSummary(second.gate)?.request.toolName).toBe(
      'aws_execute',
    );
  });

  it('detects voluntary stop from text buffer', () => {
    const text =
      '[MCP_TOOL_REQUEST]\ntool: mcp__aws-api__aws_execute\narguments:\n```json\n{"cmd":"aws s3 ls"}\n```\n[/MCP_TOOL_REQUEST]';
    const detected = codexPlugin.detectVoluntaryStop([], text, false, false);
    expect(detected?.request.toolName).toBe('mcp__aws-api__aws_execute');
    expect(codexPlugin.detectVoluntaryStop([], text, true, false)).toBeNull();
  });
});
