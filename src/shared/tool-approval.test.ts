import { describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from '../runner/types.js';
import type { ToolState } from '../session/types.js';
import {
  buildAllowlistPermissionDeniedSummary,
  createAllowlistToolApprovalGate,
  detectClaudeMcpVoluntaryStop,
  detectClaudeTextPermissionDenied,
  detectMcpVoluntaryStopFromText,
  detectPermissionDenied,
  evaluateAllowlistToolUseForApproval,
  extractMcpShortToolName,
  extractToolUseSnapshot,
  isPermissionDeniedError,
  mergeApprovedAllowlistTools,
  parseClaudeMcpToolRequest,
} from './tool-approval.js';

describe('mergeApprovedAllowlistTools (gemini normalization)', () => {
  it('normalizes, deduplicates, and merges approved tools', () => {
    const merged = mergeApprovedAllowlistTools(
      'gemini',
      { session_index: 'latest', gemini_runtime_allowed_tools: ['aws_search_operations'] },
      ['aws_execute', 'aws_search_operations'],
    );

    expect(merged).toEqual({
      session_index: 'latest',
      gemini_runtime_allowed_tools: ['aws_search_operations', 'aws_execute'],
    });
  });

  it('returns original state for non-allowlist tools', () => {
    const state = { some: 'value' };
    expect(mergeApprovedAllowlistTools('codex', state, ['tool1'])).toBe(state);
  });

  it('filters non-string, invalid, and duplicate tools during gate creation', () => {
    // Intentionally pass invalid data (number in string[]) to test runtime validation
    const gate = createAllowlistToolApprovalGate('gemini', {
      gemini_runtime_allowed_tools: [123, '', 'aws execute', 'aws_execute', 'aws_execute'],
    } as unknown as ToolState);

    expect(gate.allowedTools).toEqual(['aws_execute']);
  });
});

describe('detectPermissionDenied (gemini denied tools)', () => {
  it('extracts denied tool names from error events', () => {
    const events: DriverEvent[] = [
      { type: 'status', content: 'Loaded cached credentials.' },
      {
        type: 'error',
        content: 'Error executing tool aws_search_operations: Tool execution denied by policy.',
      },
      {
        type: 'error',
        content: 'Error: Error executing tool aws_execute: Tool execution denied by policy.',
      },
      {
        type: 'error',
        content: 'Error executing tool aws_execute: Tool execution denied by policy.',
      },
    ];

    const result = detectPermissionDenied('gemini', events);
    expect(result?.deniedTools).toEqual(['aws_search_operations', 'aws_execute']);
  });

  it('ignores non-denial errors', () => {
    const events: DriverEvent[] = [
      {
        type: 'error',
        content: 'Error executing tool run_shell_command: Tool "run_shell_command" not found.',
      },
      { type: 'error', content: 'strict mode: use allowUnionTypes to allow union type keyword' },
    ];

    expect(detectPermissionDenied('gemini', events)).toBeNull();
  });
});

describe('detectPermissionDenied', () => {
  it('detects Claude permission denial and infers tool from prior tool_use', () => {
    const events: DriverEvent[] = [
      { type: 'tool_use', content: 'Using tool: Bash(git:*)' },
      { type: 'error', content: 'Permission denied. Approval required before tool execution.' },
    ];

    expect(detectPermissionDenied('claude', events)).toEqual({
      deniedTools: ['Bash(git:*)'],
      request: {
        toolName: 'Bash(git:*)',
        args: null,
      },
    });
  });

  it('detects Codex approval-required errors', () => {
    const events: DriverEvent[] = [
      {
        type: 'error',
        content: 'Command requires approval. Re-run with ask-for-approval setting.',
      },
    ];

    expect(detectPermissionDenied('codex', events)).toEqual({
      deniedTools: [],
      request: {
        toolName: null,
        args: null,
      },
    });
  });

  it('extracts requested args from tool_use raw event', () => {
    const events: DriverEvent[] = [
      {
        type: 'tool_use',
        content: 'Using tool: aws_search_operations',
        raw: {
          type: 'tool_use',
          tool_name: 'aws_search_operations',
          parameters: { query: 'list s3 buckets' },
        },
      },
      {
        type: 'error',
        content: 'Error executing tool aws_search_operations: Tool execution denied by policy.',
      },
    ];

    expect(detectPermissionDenied('gemini', events)).toEqual({
      deniedTools: ['aws_search_operations'],
      request: {
        toolName: 'aws_search_operations',
        args: { query: 'list s3 buckets' },
      },
    });
  });

  it('detects Gemini permission denial from status lines', () => {
    const events: DriverEvent[] = [
      {
        type: 'tool_use',
        content: 'Using tool: aws_execute',
        raw: {
          type: 'tool_use',
          tool_name: 'aws_execute',
          parameters: { service: 's3', operation: 'ListBuckets', payload: {} },
        },
      },
      {
        type: 'status',
        content: 'Error executing tool aws_execute: Tool execution denied by policy.',
      },
    ];

    expect(detectPermissionDenied('gemini', events)).toEqual({
      deniedTools: ['aws_execute'],
      request: {
        toolName: 'aws_execute',
        args: { service: 's3', operation: 'ListBuckets', payload: {} },
      },
    });
  });
});

describe('extractToolUseSnapshot', () => {
  it('extracts args from Claude input_json_delta payload', () => {
    const snapshot = extractToolUseSnapshot({
      type: 'tool_use',
      content: '{"service":"s3","operation":"ListBuckets"}',
      raw: {
        type: 'content_block_delta',
        delta: {
          type: 'input_json_delta',
          partial_json: '{"service":"s3","operation":"ListBuckets"}',
        },
      },
    });

    expect(snapshot).toEqual({
      toolName: null,
      args: { service: 's3', operation: 'ListBuckets' },
    });
  });

  it('extracts name and args from content_block payload', () => {
    const snapshot = extractToolUseSnapshot({
      type: 'tool_use',
      content: 'Calling: fallback_name',
      raw: {
        content_block: {
          name: 'aws_execute',
          partial_json: '{"service":"ec2"}',
        },
      },
    });

    expect(snapshot).toEqual({
      toolName: 'aws_execute',
      args: { service: 'ec2' },
    });
  });

  it('extracts args from item.args and item.input variants', () => {
    const fromArgs = extractToolUseSnapshot({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      raw: {
        item: {
          name: 'aws_execute',
          args: '{"action":"args-branch"}',
        },
      },
    });
    expect(fromArgs).toEqual({
      toolName: 'aws_execute',
      args: { action: 'args-branch' },
    });

    const fromInput = extractToolUseSnapshot({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      raw: {
        item: {
          name: 'aws_execute',
          input: '{"action":"input-branch"}',
        },
      },
    });
    expect(fromInput).toEqual({
      toolName: 'aws_execute',
      args: { action: 'input-branch' },
    });
  });

  it('extracts args from record/delta/content_block/item argument variants', () => {
    const fromRecordArguments = extractToolUseSnapshot({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      raw: {
        arguments: '{"source":"record.arguments"}',
      },
    });
    expect(fromRecordArguments).toEqual({
      toolName: 'aws_execute',
      args: { source: 'record.arguments' },
    });

    const fromRecordInput = extractToolUseSnapshot({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      raw: {
        input: '{"source":"record.input"}',
      },
    });
    expect(fromRecordInput).toEqual({
      toolName: 'aws_execute',
      args: { source: 'record.input' },
    });

    const fromRecordArgs = extractToolUseSnapshot({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      raw: {
        args: '{"source":"record.args"}',
      },
    });
    expect(fromRecordArgs).toEqual({
      toolName: 'aws_execute',
      args: { source: 'record.args' },
    });

    const fromDeltaArguments = extractToolUseSnapshot({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      raw: {
        tool_name: 'aws_execute',
        delta: {
          arguments: '{"source":"delta.arguments"}',
        },
      },
    });
    expect(fromDeltaArguments).toEqual({
      toolName: 'aws_execute',
      args: { source: 'delta.arguments' },
    });

    const fromDeltaInput = extractToolUseSnapshot({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      raw: {
        tool_name: 'aws_execute',
        delta: {
          input: '{"source":"delta.input"}',
        },
      },
    });
    expect(fromDeltaInput).toEqual({
      toolName: 'aws_execute',
      args: { source: 'delta.input' },
    });

    const fromDeltaArgs = extractToolUseSnapshot({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      raw: {
        tool_name: 'aws_execute',
        delta: {
          args: '{"source":"delta.args"}',
        },
      },
    });
    expect(fromDeltaArgs).toEqual({
      toolName: 'aws_execute',
      args: { source: 'delta.args' },
    });

    const fromContentBlockInput = extractToolUseSnapshot({
      type: 'tool_use',
      content: 'Calling: aws_execute',
      raw: {
        content_block: {
          name: 'aws_execute',
          input: '{"source":"content_block.input"}',
        },
      },
    });
    expect(fromContentBlockInput).toEqual({
      toolName: 'aws_execute',
      args: { source: 'content_block.input' },
    });

    const fromContentBlockArguments = extractToolUseSnapshot({
      type: 'tool_use',
      content: 'Calling: aws_execute',
      raw: {
        content_block: {
          name: 'aws_execute',
          arguments: '{"source":"content_block.arguments"}',
        },
      },
    });
    expect(fromContentBlockArguments).toEqual({
      toolName: 'aws_execute',
      args: { source: 'content_block.arguments' },
    });

    const fromItemArguments = extractToolUseSnapshot({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      raw: {
        item: {
          name: 'aws_execute',
          arguments: '{"source":"item.arguments"}',
        },
      },
    });
    expect(fromItemArguments).toEqual({
      toolName: 'aws_execute',
      args: { source: 'item.arguments' },
    });
  });

  it('returns trimmed string args when args JSON is invalid', () => {
    const snapshot = extractToolUseSnapshot({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      raw: {
        args: '  not-json  ',
      },
    });

    expect(snapshot).toEqual({
      toolName: 'aws_execute',
      args: 'not-json',
    });
  });

  it('returns null when tool_use has neither toolName nor args', () => {
    const snapshot = extractToolUseSnapshot({
      type: 'tool_use',
      content: 'stream chunk without tool marker',
      raw: {
        args: '   ',
      },
    });
    expect(snapshot).toBeNull();
  });

  it('normalizes null args candidates to null', () => {
    const snapshot = extractToolUseSnapshot({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      raw: {
        parameters: null,
      },
    });
    expect(snapshot).toEqual({
      toolName: 'aws_execute',
      args: null,
    });
  });
});

describe('allowlist proactive approval gate', () => {
  it('allows core tools even when runtime allowlist has no overlap', () => {
    // Simulates the approval-rerun scenario: claude_runtime_allowed_tools
    // contains only the previously-approved MCP tool, but core tools (Glob,
    // Bash, Agent, etc.) must still pass through the gate.
    const coreTools = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Agent'];
    const gate = createAllowlistToolApprovalGate(
      'claude',
      { claude_runtime_allowed_tools: ['mcp__aws-api__aws_execute'] },
      coreTools,
    );

    for (const tool of coreTools) {
      const evalResult = evaluateAllowlistToolUseForApproval(gate, {
        type: 'tool_use',
        content: `Using tool: ${tool}`,
        raw: { type: 'tool_use', tool_name: tool },
      });
      expect(evalResult.shouldBlock).toBe(false);
    }
  });

  it('blocks unapproved Claude tool_use with args', () => {
    const gate = createAllowlistToolApprovalGate('claude', {
      claude_runtime_allowed_tools: ['Read'],
    });
    const evalResult = evaluateAllowlistToolUseForApproval(gate, {
      type: 'tool_use',
      content: 'Using tool: aws_list_buckets',
      raw: {
        type: 'tool_use',
        tool_name: 'aws_list_buckets',
        parameters: { region: 'ap-northeast-1' },
      },
    });

    expect(evalResult.shouldBlock).toBe(true);
    expect(buildAllowlistPermissionDeniedSummary(evalResult.gate)).toEqual({
      deniedTools: ['aws_list_buckets'],
      request: {
        toolName: 'aws_list_buckets',
        args: { region: 'ap-northeast-1' },
      },
    });
  });

  it('passes approved Claude tool_use', () => {
    const gate = createAllowlistToolApprovalGate('claude', {
      claude_runtime_allowed_tools: ['aws_list_buckets'],
    });
    const evalResult = evaluateAllowlistToolUseForApproval(gate, {
      type: 'tool_use',
      content: 'Using tool: aws_list_buckets',
      raw: {
        type: 'tool_use',
        tool_name: 'aws_list_buckets',
      },
    });

    expect(evalResult.shouldBlock).toBe(false);
    expect(buildAllowlistPermissionDeniedSummary(evalResult.gate)).toBeNull();
  });

  it('allows MCP tools matching glob pattern in gate', () => {
    // MCP glob patterns (e.g., mcp__aws-api__*) are injected by the proxy
    // for configured MCP servers. The gate should allow tools matching the glob.
    const gate = createAllowlistToolApprovalGate('claude', {
      claude_runtime_allowed_tools: ['mcp__aws-api__*', 'Read'],
    });

    // Gate keeps both exact tools and globs
    expect(gate.allowedTools).toEqual(['mcp__aws-api__*', 'Read']);

    // MCP tool call should pass via glob matching
    const evalResult = evaluateAllowlistToolUseForApproval(gate, {
      type: 'tool_use',
      content: 'Using tool: mcp__aws-api__aws_execute',
      raw: {
        type: 'tool_use',
        tool_name: 'mcp__aws-api__aws_execute',
        parameters: { service: 's3', operation: 'ListBuckets' },
      },
    });

    expect(evalResult.shouldBlock).toBe(false);
    expect(buildAllowlistPermissionDeniedSummary(evalResult.gate)).toBeNull();
  });

  it('blocks tools that do NOT match any glob or exact name', () => {
    const gate = createAllowlistToolApprovalGate('claude', {
      claude_runtime_allowed_tools: ['mcp__aws-api__*', 'Read'],
    });

    // A tool from a different MCP server should still be blocked
    const evalResult = evaluateAllowlistToolUseForApproval(gate, {
      type: 'tool_use',
      content: 'Using tool: mcp__other-server__do_something',
      raw: {
        type: 'tool_use',
        tool_name: 'mcp__other-server__do_something',
      },
    });

    expect(evalResult.shouldBlock).toBe(true);
    expect(buildAllowlistPermissionDeniedSummary(evalResult.gate)).toEqual({
      deniedTools: ['mcp__other-server__do_something'],
      request: {
        toolName: 'mcp__other-server__do_something',
        args: null,
      },
    });
  });

  it('passes MCP tool via both exact name and glob', () => {
    // When both exact and glob are present, tool should pass
    const gate = createAllowlistToolApprovalGate('claude', {
      claude_runtime_allowed_tools: ['mcp__aws-api__aws_execute', 'mcp__aws-api__*'],
    });

    expect(gate.allowedTools).toEqual(['mcp__aws-api__aws_execute', 'mcp__aws-api__*']);

    const evalResult = evaluateAllowlistToolUseForApproval(gate, {
      type: 'tool_use',
      content: 'Using tool: mcp__aws-api__aws_execute',
      raw: {
        type: 'tool_use',
        tool_name: 'mcp__aws-api__aws_execute',
      },
    });

    expect(evalResult.shouldBlock).toBe(false);
  });

  it('does not block non tool_use events', () => {
    const gate = createAllowlistToolApprovalGate('claude', {
      claude_runtime_allowed_tools: ['Read'],
    });
    const evalResult = evaluateAllowlistToolUseForApproval(gate, {
      type: 'status',
      content: 'thinking',
    });

    expect(evalResult.shouldBlock).toBe(false);
    expect(buildAllowlistPermissionDeniedSummary(evalResult.gate)).toBeNull();
  });

  it('builds denied summary with empty deniedTools when toolName is null', () => {
    const summary = buildAllowlistPermissionDeniedSummary({
      allowedTools: [],
      proactiveApprovalRequest: {
        toolName: null,
        args: { x: 1 },
      },
    });
    expect(summary).toEqual({
      deniedTools: [],
      request: {
        toolName: null,
        args: { x: 1 },
      },
    });
  });
});

describe('mergeApprovedAllowlistTools', () => {
  it('merges Claude allowed tools under claude_runtime_allowed_tools key', () => {
    const merged = mergeApprovedAllowlistTools(
      'claude',
      { claude_runtime_allowed_tools: ['Read'] },
      ['Bash(git:*)', 'Read'],
    );

    expect(merged).toEqual({
      claude_runtime_allowed_tools: ['Read', 'Bash(git:*)'],
    });
  });

  it('drops a bare wildcard when merging allowlist tools', () => {
    const merged = mergeApprovedAllowlistTools(
      'claude',
      { claude_runtime_allowed_tools: ['Read'] },
      ['*', 'mcp__aws-api__*'],
    );
    expect(merged).toEqual({
      claude_runtime_allowed_tools: ['Read', 'mcp__aws-api__*'],
    });
  });

  it('does not modify tool state for codex', () => {
    const toolState = { thread_id: 'thr_123' };
    expect(mergeApprovedAllowlistTools('codex', toolState, ['anything'])).toEqual(toolState);
  });
});

describe('isPermissionDeniedError', () => {
  it('returns true for tool-policy denial lines', () => {
    expect(
      isPermissionDeniedError(
        'gemini',
        'Error executing tool aws_execute: Tool execution denied by policy.',
      ),
    ).toBe(true);
    expect(
      isPermissionDeniedError(
        'claude',
        'Permission denied. Approval required before tool execution.',
      ),
    ).toBe(true);
    expect(
      isPermissionDeniedError('codex', 'Command requires approval. Re-run with ask-for-approval.'),
    ).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(
      isPermissionDeniedError(
        'gemini',
        'strict mode: use allowUnionTypes to allow union type keyword',
      ),
    ).toBe(false);
    expect(isPermissionDeniedError('gemini', '   ')).toBe(false);
  });
});

describe('detectPermissionDenied fallbacks', () => {
  it('keeps request toolName null when no tool can be inferred', () => {
    const events: DriverEvent[] = [
      {
        type: 'error',
        content: 'approval required before execution',
      },
    ];

    expect(detectPermissionDenied('codex', events)).toEqual({
      deniedTools: [],
      request: {
        toolName: null,
        args: null,
      },
    });
  });
});

describe('detectClaudeTextPermissionDenied', () => {
  it('detects text-based MCP permission denial from Claude', () => {
    const events: DriverEvent[] = [
      { type: 'text', content: "I'll help you list S3 buckets.\n" },
      {
        type: 'text',
        content:
          "Claude requested permissions to use mcp__aws-api__aws_execute, but you haven't granted it yet.",
      },
    ];

    expect(detectClaudeTextPermissionDenied(events)).toEqual({
      deniedTools: ['mcp__aws-api__aws_execute'],
      request: {
        toolName: 'mcp__aws-api__aws_execute',
        args: null,
      },
    });
  });

  it('detects singular "permission" variant', () => {
    const events: DriverEvent[] = [
      {
        type: 'text',
        content:
          "Claude requested permission to use mcp__aws-api__aws_execute, but you haven't granted it yet.",
      },
    ];

    expect(detectClaudeTextPermissionDenied(events)).toEqual({
      deniedTools: ['mcp__aws-api__aws_execute'],
      request: {
        toolName: 'mcp__aws-api__aws_execute',
        args: null,
      },
    });
  });

  it('returns null when no permission denial in text', () => {
    const events: DriverEvent[] = [
      { type: 'text', content: 'Here are your S3 buckets:\n- my-bucket\n- other-bucket' },
      { type: 'status', content: 'Done.' },
    ];

    expect(detectClaudeTextPermissionDenied(events)).toBeNull();
  });

  it('ignores non-text events', () => {
    const events: DriverEvent[] = [
      {
        type: 'error',
        content:
          "Claude requested permissions to use mcp__aws-api__aws_execute, but you haven't granted it yet.",
      },
    ];

    expect(detectClaudeTextPermissionDenied(events)).toBeNull();
  });

  it('extracts args from [MCP_TOOL_REQUEST] block when present', () => {
    const events: DriverEvent[] = [
      {
        type: 'text',
        content: `I'll help you list S3 buckets.

[MCP_TOOL_REQUEST]
tool: mcp__aws-api__aws_execute
arguments:
\`\`\`json
{"service":"s3","operation":"ListBuckets","payload":{}}
\`\`\`
[/MCP_TOOL_REQUEST]`,
      },
      {
        type: 'text',
        content:
          "Claude requested permissions to use mcp__aws-api__aws_execute, but you haven't granted it yet.",
      },
    ];

    const result = detectClaudeTextPermissionDenied(events);
    expect(result).toEqual({
      deniedTools: ['mcp__aws-api__aws_execute'],
      request: {
        toolName: 'mcp__aws-api__aws_execute',
        args: { service: 's3', operation: 'ListBuckets', payload: {} },
      },
    });
  });

  it('returns null args when [MCP_TOOL_REQUEST] block is missing', () => {
    const events: DriverEvent[] = [
      {
        type: 'text',
        content:
          "Claude requested permissions to use mcp__aws-api__aws_execute, but you haven't granted it yet.",
      },
    ];

    const result = detectClaudeTextPermissionDenied(events);
    expect(result).toEqual({
      deniedTools: ['mcp__aws-api__aws_execute'],
      request: {
        toolName: 'mcp__aws-api__aws_execute',
        args: null,
      },
    });
  });

  it('handles denial regex matches with missing capture groups', () => {
    const originalMatch = String.prototype.match;
    const matchSpy = vi.spyOn(String.prototype, 'match').mockImplementation(function (
      this: string,
      pattern: unknown,
    ) {
      if (pattern instanceof RegExp && pattern.source.includes('requested permissions? to use')) {
        return ['Claude requested permissions to use'] as unknown as RegExpMatchArray;
      }
      return originalMatch.call(this, pattern as never);
    });

    try {
      const events: DriverEvent[] = [
        {
          type: 'text',
          content: 'Claude requested permissions to use tool, but output is malformed.',
        },
      ];
      expect(detectClaudeTextPermissionDenied(events)).toEqual({
        deniedTools: [''],
        request: {
          toolName: '',
          args: null,
        },
      });
    } finally {
      matchSpy.mockRestore();
    }
  });
});

describe('parseClaudeMcpToolRequest', () => {
  it('parses tool name and JSON args from well-formed block', () => {
    const text = `Some thinking text.

[MCP_TOOL_REQUEST]
tool: mcp__aws-api__aws_execute
arguments:
\`\`\`json
{"service":"s3","operation":"ListBuckets","payload":{}}
\`\`\`
[/MCP_TOOL_REQUEST]

Some more text.`;

    expect(parseClaudeMcpToolRequest(text)).toEqual({
      toolName: 'mcp__aws-api__aws_execute',
      args: { service: 's3', operation: 'ListBuckets', payload: {} },
    });
  });

  it('returns null when block is missing', () => {
    expect(parseClaudeMcpToolRequest('No block here')).toBeNull();
  });

  it('handles invalid JSON gracefully by returning raw string', () => {
    const text = `[MCP_TOOL_REQUEST]
tool: mcp__test__tool
arguments:
\`\`\`json
not valid json
\`\`\`
[/MCP_TOOL_REQUEST]`;

    const result = parseClaudeMcpToolRequest(text);
    expect(result).toEqual({
      toolName: 'mcp__test__tool',
      args: 'not valid json',
    });
  });

  it('handles code block without json language tag', () => {
    const text = `[MCP_TOOL_REQUEST]
tool: mcp__test__tool
arguments:
\`\`\`
{"key":"value"}
\`\`\`
[/MCP_TOOL_REQUEST]`;

    expect(parseClaudeMcpToolRequest(text)).toEqual({
      toolName: 'mcp__test__tool',
      args: { key: 'value' },
    });
  });

  it('parses plain format with inline arguments (Gemini style)', () => {
    const text = `I'll check your Google Calendar to see your schedule for this week.
[MCP_TOOL_REQUEST]
tool: mcp_google-workspace_gcal_calendar_list_list
arguments: {}
[/MCP_TOOL_REQUEST]`;

    expect(parseClaudeMcpToolRequest(text)).toEqual({
      toolName: 'mcp_google-workspace_gcal_calendar_list_list',
      args: {},
    });
  });

  it('parses plain format with multi-line JSON arguments', () => {
    const text = `[MCP_TOOL_REQUEST]
tool: mcp__aws-api__aws_s3_ListBuckets
arguments:
{
  "service": "s3",
  "operation": "ListBuckets"
}
[/MCP_TOOL_REQUEST]`;

    expect(parseClaudeMcpToolRequest(text)).toEqual({
      toolName: 'mcp__aws-api__aws_s3_ListBuckets',
      args: { service: 's3', operation: 'ListBuckets' },
    });
  });

  it('parses plain format with empty arguments', () => {
    const text = `[MCP_TOOL_REQUEST]
tool: mcp__test__tool
arguments:
[/MCP_TOOL_REQUEST]`;

    expect(parseClaudeMcpToolRequest(text)).toEqual({
      toolName: 'mcp__test__tool',
      args: null,
    });
  });

  it('handles malformed regex match arrays with missing capture groups', () => {
    const originalMatch = String.prototype.match;
    const matchSpy = vi.spyOn(String.prototype, 'match').mockImplementation(function (
      this: string,
      pattern: unknown,
    ) {
      if (pattern instanceof RegExp && pattern.source.includes('\\[MCP_TOOL_REQUEST\\]')) {
        return ['[MCP_TOOL_REQUEST]'] as unknown as RegExpMatchArray;
      }
      return originalMatch.call(this, pattern as never);
    });

    try {
      expect(parseClaudeMcpToolRequest('irrelevant text')).toEqual({
        toolName: '',
        args: null,
      });
    } finally {
      matchSpy.mockRestore();
    }
  });
});

describe('detectClaudeMcpVoluntaryStop', () => {
  it('detects [MCP_TOOL_REQUEST] block when Claude stops voluntarily', () => {
    const events: DriverEvent[] = [
      {
        type: 'text',
        content: `I'll list your S3 buckets.

[MCP_TOOL_REQUEST]
tool: mcp__aws-api__aws_execute
arguments:
\`\`\`json
{"service":"s3","operation":"ListBuckets","payload":{}}
\`\`\`
[/MCP_TOOL_REQUEST]`,
      },
    ];

    expect(detectClaudeMcpVoluntaryStop(events)).toEqual({
      deniedTools: ['mcp__aws-api__aws_execute'],
      request: {
        toolName: 'mcp__aws-api__aws_execute',
        args: { service: 's3', operation: 'ListBuckets', payload: {} },
      },
    });
  });

  it('returns null when CLI denial text is present', () => {
    const events: DriverEvent[] = [
      {
        type: 'text',
        content: `[MCP_TOOL_REQUEST]
tool: mcp__aws-api__aws_execute
arguments:
\`\`\`json
{"service":"s3"}
\`\`\`
[/MCP_TOOL_REQUEST]`,
      },
      {
        type: 'text',
        content:
          "Claude requested permissions to use mcp__aws-api__aws_execute, but you haven't granted it yet.",
      },
    ];

    // Should return null — detectClaudeTextPermissionDenied handles this case
    expect(detectClaudeMcpVoluntaryStop(events)).toBeNull();
  });

  it('returns null when no [MCP_TOOL_REQUEST] block', () => {
    const events: DriverEvent[] = [
      { type: 'text', content: 'Here are your S3 buckets:\n- my-bucket' },
    ];

    expect(detectClaudeMcpVoluntaryStop(events)).toBeNull();
  });

  it('extracts both tool name and args', () => {
    const events: DriverEvent[] = [
      {
        type: 'text',
        content: `[MCP_TOOL_REQUEST]
tool: mcp__aws-api__aws_search_operations
arguments:
\`\`\`json
{"query":"list ec2 instances"}
\`\`\`
[/MCP_TOOL_REQUEST]`,
      },
    ];

    const result = detectClaudeMcpVoluntaryStop(events);
    expect(result).toEqual({
      deniedTools: ['mcp__aws-api__aws_search_operations'],
      request: {
        toolName: 'mcp__aws-api__aws_search_operations',
        args: { query: 'list ec2 instances' },
      },
    });
  });
});

describe('detectMcpVoluntaryStopFromText', () => {
  it('detects [MCP_TOOL_REQUEST] block from assembled text', () => {
    const text = `Retrieving the S3 bucket list.

[MCP_TOOL_REQUEST]
tool: mcp__aws-api__aws_s3_ListBuckets
arguments:
\`\`\`json
{}
\`\`\`
[/MCP_TOOL_REQUEST]`;

    expect(detectMcpVoluntaryStopFromText(text)).toEqual({
      deniedTools: ['mcp__aws-api__aws_s3_ListBuckets'],
      request: {
        toolName: 'mcp__aws-api__aws_s3_ListBuckets',
        args: {},
      },
    });
  });

  it('returns null when no [MCP_TOOL_REQUEST] block', () => {
    expect(detectMcpVoluntaryStopFromText('Here are your S3 buckets:\n- my-bucket')).toBeNull();
    expect(detectMcpVoluntaryStopFromText('')).toBeNull();
  });

  it('extracts both tool name and args', () => {
    const text = `[MCP_TOOL_REQUEST]
tool: mcp__aws-api__aws_execute
arguments:
\`\`\`json
{"service":"s3","operation":"ListBuckets","payload":{}}
\`\`\`
[/MCP_TOOL_REQUEST]`;

    expect(detectMcpVoluntaryStopFromText(text)).toEqual({
      deniedTools: ['mcp__aws-api__aws_execute'],
      request: {
        toolName: 'mcp__aws-api__aws_execute',
        args: { service: 's3', operation: 'ListBuckets', payload: {} },
      },
    });
  });

  it('works with text from Codex --output-last-message (no streaming events)', () => {
    // Simulates the case where Codex outputs text only via --output-last-message file,
    // which goes into textBuffer but not into allEvents.
    const textFromFile = `Checking the number of AWS S3 buckets.

[MCP_TOOL_REQUEST]
tool: mcp__aws-api__aws_execute
arguments:
\`\`\`json
{"action":"invoke","service":"s3","operation":"ListBuckets","payload":{}}
\`\`\`
[/MCP_TOOL_REQUEST]`;

    expect(detectMcpVoluntaryStopFromText(textFromFile)).toEqual({
      deniedTools: ['mcp__aws-api__aws_execute'],
      request: {
        toolName: 'mcp__aws-api__aws_execute',
        args: { action: 'invoke', service: 's3', operation: 'ListBuckets', payload: {} },
      },
    });
  });

  it('handles invalid JSON args gracefully', () => {
    const text = `[MCP_TOOL_REQUEST]
tool: mcp__test__tool
arguments:
\`\`\`json
not valid json
\`\`\`
[/MCP_TOOL_REQUEST]`;

    const result = detectMcpVoluntaryStopFromText(text);
    expect(result).toEqual({
      deniedTools: ['mcp__test__tool'],
      request: {
        toolName: 'mcp__test__tool',
        args: 'not valid json',
      },
    });
  });
});

describe('extractMcpShortToolName', () => {
  it('extracts short name from mcp__server__tool format', () => {
    expect(extractMcpShortToolName('mcp__aws-api__aws_execute')).toBe('aws_execute');
    expect(extractMcpShortToolName('mcp__aws-api__aws_s3_ListBuckets')).toBe('aws_s3_ListBuckets');
    expect(extractMcpShortToolName('mcp__my-server__my_tool')).toBe('my_tool');
  });

  it('returns null for non-MCP tool names', () => {
    expect(extractMcpShortToolName('aws_execute')).toBeNull();
    expect(extractMcpShortToolName('Bash(git:*)')).toBeNull();
    expect(extractMcpShortToolName('Read')).toBeNull();
  });

  it('handles tool names with double underscores', () => {
    // Tool name itself contains __ (unlikely but handled)
    expect(extractMcpShortToolName('mcp__server__tool__with__underscores')).toBe(
      'tool__with__underscores',
    );
  });

  it('returns null for malformed mcp prefixes', () => {
    expect(extractMcpShortToolName('mcp__')).toBeNull();
    expect(extractMcpShortToolName('mcp__server')).toBeNull();
    expect(extractMcpShortToolName('')).toBeNull();
  });

  it('returns null for wildcard MCP tool globs', () => {
    expect(extractMcpShortToolName('mcp__server__*')).toBeNull();
  });
});
