import { describe, expect, it } from 'vitest';
import geminiPlugin from './gemini-plugin.js';

describe('gemini plugin', () => {
  it('returns gemini auth server from config', () => {
    const config = { geminiMcpAuthServer: 'aws-api' };
    expect(geminiPlugin.getMcpAuthServer(config as never)).toBe('aws-api');
  });

  it('clears gemini MCP auth markers', () => {
    const next = geminiPlugin.clearMcpAuthState({
      gemini_mcp_auth_initialized_server: 'aws-api',
      gemini_mcp_auth_verified_server: 'aws-api',
      keep: 'ok',
    });
    expect(next).toEqual({ keep: 'ok' });
  });

  it('blocks non-allowlisted gemini tool usage', () => {
    const gate = geminiPlugin.createApprovalGate({
      gemini_runtime_allowed_tools: ['read_file'],
    });
    const evaluated = geminiPlugin.evaluateToolUse(gate, {
      type: 'tool_use',
      content: 'Using tool: aws_execute',
    });
    expect(evaluated.shouldBlock).toBe(true);
    expect(geminiPlugin.buildPermissionDeniedSummary(evaluated.gate)?.request.toolName).toBe(
      'aws_execute',
    );
  });

  it('detects voluntary stop from text buffer', () => {
    const text =
      '[MCP_TOOL_REQUEST]\ntool: mcp__aws-api__aws_execute\narguments:\n```json\n{"cmd":"aws sts get-caller-identity"}\n```\n[/MCP_TOOL_REQUEST]';
    const detected = geminiPlugin.detectVoluntaryStop([], text, false, false);
    expect(detected?.request.toolName).toBe('mcp__aws-api__aws_execute');
    expect(geminiPlugin.detectVoluntaryStop([], text, false, true)).toBeNull();
  });
});
