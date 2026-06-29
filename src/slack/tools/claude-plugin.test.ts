import { describe, expect, it } from 'vitest';
import claudePlugin from './claude-plugin.js';

describe('claude plugin', () => {
  it('returns claude auth server from config', () => {
    const config = { claudeMcpAuthServer: 'aws-api' };
    expect(claudePlugin.getMcpAuthServer(config as never)).toBe('aws-api');
  });

  it('clears verified MCP auth marker', () => {
    const next = claudePlugin.clearMcpAuthState({
      claude_mcp_auth_verified_server: 'aws-api',
      other: 'keep',
    });
    expect(next).toEqual({ other: 'keep' });
  });

  it('blocks tool use not in allowlist', () => {
    const gate = claudePlugin.createApprovalGate({
      claude_runtime_allowed_tools: ['read_file'],
    });
    const evaluated = claudePlugin.evaluateToolUse(gate, {
      type: 'tool_use',
      content: 'Using tool: mcp__aws-api__aws_execute',
    });

    expect(evaluated.shouldBlock).toBe(true);
    const summary = claudePlugin.buildPermissionDeniedSummary(evaluated.gate);
    expect(summary?.deniedTools).toEqual(['mcp__aws-api__aws_execute']);
  });

  it('detects claude voluntary stop text unless permission denied was already detected', () => {
    const events = [
      {
        type: 'text',
        content:
          '[MCP_TOOL_REQUEST]\ntool: mcp__aws-api__aws_execute\narguments:\n```json\n{"cmd":"aws sts get-caller-identity"}\n```\n[/MCP_TOOL_REQUEST]',
      },
    ];

    const detected = claudePlugin.detectVoluntaryStop(events as never, '', false, false);
    expect(detected?.request.toolName).toBe('mcp__aws-api__aws_execute');
    expect(claudePlugin.detectVoluntaryStop(events as never, '', true, false)).toBeNull();
  });

  it('prioritizes text-based permission denial detection', () => {
    const events = [
      {
        type: 'text',
        content:
          "Claude requested permissions to use mcp__aws-api__aws_execute, but you haven't granted it yet.",
      },
    ];

    const detected = claudePlugin.detectVoluntaryStop(events as never, '', false, false);
    expect(detected?.request.toolName).toBe('mcp__aws-api__aws_execute');
  });
});
