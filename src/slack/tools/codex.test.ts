import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { DriverEvent } from '../../runner/types.js';
import {
  CODEX_ALLOW_TOOL_ONCE_LIST_KEY,
  appendCodexApprovedToolCall,
  buildCodexApprovalToolStateOverridesForCalls,
  buildCodexPermissionDeniedSummary,
  consumeCodexOutputLastMessage,
  createCodexToolApprovalGate,
  evaluateCodexToolUseForApproval,
  extractCodexApprovedToolCalls,
  formatCodexMcpAuthGenericFailureMessage,
  formatCodexMcpAuthRequiredMessage,
  isCodexMcpPreflightVerified,
  isCodexMcpServerAuthUnsupported,
  markCodexMcpPreflightVerified,
  prepareCodexOutputLastMessageCapture,
  runCodexMcpAuthPreflight,
  runCodexMcpList,
  selectCodexMcpAuthServer,
} from './codex.js';

describe('Codex tool approval gate', () => {
  it('blocks tool_use when no one-shot approval exists', () => {
    const gate = createCodexToolApprovalGate({});
    const event: DriverEvent = {
      type: 'tool_use',
      content: 'Calling: aws_execute',
      raw: { item: { type: 'function_call', name: 'aws_execute', arguments: { a: 1 } } },
    };

    const result = evaluateCodexToolUseForApproval(gate, event);
    expect(result.shouldBlock).toBe(true);
    expect(buildCodexPermissionDeniedSummary(result.gate)).toEqual({
      deniedTools: ['aws_execute'],
      request: {
        toolName: 'aws_execute',
        args: { a: 1 },
      },
    });
  });

  it('extracts tool name from plain-text tool_use events', () => {
    const gate = createCodexToolApprovalGate({});
    const event: DriverEvent = {
      type: 'tool_use',
      content: 'Using tool: aws_search_operations',
    };

    const result = evaluateCodexToolUseForApproval(gate, event);
    expect(result.shouldBlock).toBe(true);
    expect(buildCodexPermissionDeniedSummary(result.gate)).toEqual({
      deniedTools: ['aws_search_operations'],
      request: {
        toolName: 'aws_search_operations',
        args: null,
      },
    });
  });

  it('extracts tool name/args from mcp_tool_call payloads', () => {
    const gate = createCodexToolApprovalGate({});
    const event: DriverEvent = {
      type: 'tool_use',
      content: 'Calling: aws_execute',
      raw: {
        type: 'item.started',
        item: {
          type: 'mcp_tool_call',
          server: 'aws-api',
          tool: 'aws_execute',
          arguments: { action: 'invoke', service: 's3', operation: 'ListBuckets' },
          status: 'in_progress',
        },
      },
    };

    const result = evaluateCodexToolUseForApproval(gate, event);
    expect(result.shouldBlock).toBe(true);
    expect(buildCodexPermissionDeniedSummary(result.gate)).toEqual({
      deniedTools: ['aws_execute'],
      request: {
        toolName: 'aws_execute',
        args: { action: 'invoke', service: 's3', operation: 'ListBuckets' },
      },
    });
  });

  it('allows one matching approved tool call once', () => {
    const gate = createCodexToolApprovalGate({
      [CODEX_ALLOW_TOOL_ONCE_LIST_KEY]: [
        { toolName: 'aws_execute', args: { service: 's3', operation: 'ListBuckets' } },
      ],
    });
    const allowedEvent: DriverEvent = {
      type: 'tool_use',
      content: 'Calling: aws_execute',
      raw: {
        item: {
          type: 'function_call',
          name: 'aws_execute',
          arguments: { service: 's3', operation: 'ListBuckets' },
        },
      },
    };

    const first = evaluateCodexToolUseForApproval(gate, allowedEvent);
    expect(first.shouldBlock).toBe(false);

    const second = evaluateCodexToolUseForApproval(first.gate, allowedEvent);
    expect(second.shouldBlock).toBe(true);
  });

  it('allows approved call when JSON argument key order differs', () => {
    const gate = createCodexToolApprovalGate({
      [CODEX_ALLOW_TOOL_ONCE_LIST_KEY]: [
        {
          toolName: 'aws_execute',
          args: {
            service: 's3',
            operation: 'ListBuckets',
            action: 'invoke',
            payload: {},
          },
        },
      ],
    });
    const allowedEvent: DriverEvent = {
      type: 'tool_use',
      content: 'Calling: aws_execute',
      raw: {
        item: {
          type: 'mcp_tool_call',
          tool: 'aws_execute',
          arguments: {
            action: 'invoke',
            payload: {},
            operation: 'ListBuckets',
            service: 's3',
          },
          status: 'in_progress',
        },
      },
    };

    const result = evaluateCodexToolUseForApproval(gate, allowedEvent);
    expect(result.shouldBlock).toBe(false);
  });

  it('allows approved call when request arguments arrive as equivalent JSON text', () => {
    const gate = createCodexToolApprovalGate({
      [CODEX_ALLOW_TOOL_ONCE_LIST_KEY]: [
        {
          toolName: 'aws_execute',
          args: {
            service: 's3',
            operation: 'ListBuckets',
            action: 'invoke',
          },
        },
      ],
    });
    const allowedEvent: DriverEvent = {
      type: 'tool_use',
      content: 'Calling: aws_execute',
      raw: {
        item: {
          type: 'mcp_tool_call',
          tool: 'aws_execute',
          arguments: '{"operation":"ListBuckets","action":"invoke","service":"s3"}',
          status: 'in_progress',
        },
      },
    };

    const result = evaluateCodexToolUseForApproval(gate, allowedEvent);
    expect(result.shouldBlock).toBe(false);
  });

  it('deduplicates equivalent approved calls across object and JSON-string arguments', () => {
    const deduped = appendCodexApprovedToolCall(
      [{ toolName: 'aws_execute', args: { action: 'invoke', service: 's3' } }],
      'aws_execute',
      '{"service":"s3","action":"invoke"}',
    );

    expect(deduped).toEqual([
      { toolName: 'aws_execute', args: { action: 'invoke', service: 's3' } },
    ]);
  });

  it('allows multiple pre-approved codex calls in one rerun', () => {
    const gate = createCodexToolApprovalGate({
      [CODEX_ALLOW_TOOL_ONCE_LIST_KEY]: [
        { toolName: 'aws_execute', args: { action: 'validate', service: 's3' } },
        { toolName: 'aws_execute', args: { action: 'invoke', service: 's3' } },
      ],
    });
    const validateEvent: DriverEvent = {
      type: 'tool_use',
      content: 'Calling: aws_execute',
      raw: {
        item: {
          type: 'mcp_tool_call',
          tool: 'aws_execute',
          arguments: { service: 's3', action: 'validate' },
          status: 'in_progress',
        },
      },
    };
    const invokeEvent: DriverEvent = {
      type: 'tool_use',
      content: 'Calling: aws_execute',
      raw: {
        item: {
          type: 'mcp_tool_call',
          tool: 'aws_execute',
          arguments: { action: 'invoke', service: 's3' },
          status: 'in_progress',
        },
      },
    };

    const first = evaluateCodexToolUseForApproval(gate, validateEvent);
    expect(first.shouldBlock).toBe(false);
    const second = evaluateCodexToolUseForApproval(first.gate, invokeEvent);
    expect(second.shouldBlock).toBe(false);
    const third = evaluateCodexToolUseForApproval(second.gate, invokeEvent);
    expect(third.shouldBlock).toBe(true);
  });

  it('does not block on tool_result after approved one-shot tool_use', () => {
    const gate = createCodexToolApprovalGate({
      [CODEX_ALLOW_TOOL_ONCE_LIST_KEY]: [
        { toolName: 'aws_execute', args: { service: 's3', operation: 'ListBuckets' } },
      ],
    });
    const allowedEvent: DriverEvent = {
      type: 'tool_use',
      content: 'Calling: aws_execute',
      raw: {
        item: {
          type: 'mcp_tool_call',
          tool: 'aws_execute',
          arguments: { service: 's3', operation: 'ListBuckets' },
          status: 'in_progress',
        },
      },
    };
    const resultEvent: DriverEvent = {
      type: 'tool_result',
      content: '{"ok":true}',
      raw: {
        item: {
          type: 'mcp_tool_call',
          tool: 'aws_execute',
          arguments: { service: 's3', operation: 'ListBuckets' },
          result: { ok: true },
          status: 'completed',
        },
      },
    };

    const first = evaluateCodexToolUseForApproval(gate, allowedEvent);
    expect(first.shouldBlock).toBe(false);
    const second = evaluateCodexToolUseForApproval(first.gate, resultEvent);
    expect(second.shouldBlock).toBe(false);
  });

  it('blocks when args differ from approved one-shot args', () => {
    const gate = createCodexToolApprovalGate({
      [CODEX_ALLOW_TOOL_ONCE_LIST_KEY]: [
        { toolName: 'aws_execute', args: { service: 's3', operation: 'ListBuckets' } },
      ],
    });
    const event: DriverEvent = {
      type: 'tool_use',
      content: 'Calling: aws_execute',
      raw: {
        item: {
          type: 'function_call',
          name: 'aws_execute',
          arguments: { service: 's3', operation: 'ListObjectsV2' },
        },
      },
    };

    const result = evaluateCodexToolUseForApproval(gate, event);
    expect(result.shouldBlock).toBe(true);
  });

  it('builds codex overrides for multiple approved calls', () => {
    expect(
      buildCodexApprovalToolStateOverridesForCalls([
        { toolName: 'aws_execute', args: { action: 'validate' } },
        { toolName: 'aws_execute', args: { action: 'invoke' } },
      ]),
    ).toEqual({
      codex_ask_for_approval: 'never',
      [CODEX_ALLOW_TOOL_ONCE_LIST_KEY]: [
        { toolName: 'aws_execute', args: { action: 'validate' } },
        { toolName: 'aws_execute', args: { action: 'invoke' } },
      ],
    });
  });

  it('extracts and deduplicates approved codex tool calls from tool state', () => {
    expect(
      extractCodexApprovedToolCalls({
        [CODEX_ALLOW_TOOL_ONCE_LIST_KEY]: [
          { toolName: 'aws_execute', args: { b: 2, a: 1 } },
          { toolName: 'aws_execute', args: { a: 1, b: 2 } },
          { name: 'aws_get_operation_schema', arguments: { x: 1 } },
        ],
      }),
    ).toEqual([
      { toolName: 'aws_execute', args: { b: 2, a: 1 } },
      { toolName: 'aws_get_operation_schema', args: { x: 1 } },
    ]);
  });

  it('appends approved codex tool calls without duplicates', () => {
    expect(
      appendCodexApprovedToolCall(
        [{ toolName: 'aws_execute', args: { a: 1, b: 2 } }],
        'aws_execute',
        { b: 2, a: 1 },
      ),
    ).toEqual([{ toolName: 'aws_execute', args: { a: 1, b: 2 } }]);
  });

  it('drops calls with blank approved tool names during dedupe', () => {
    expect(
      appendCodexApprovedToolCall([{ toolName: '   ', args: { ignored: true } }], 'aws_execute', {
        action: 'invoke',
      }),
    ).toEqual([{ toolName: 'aws_execute', args: { action: 'invoke' } }]);
  });

  it('prepares output-last-message argument for codex exec resume', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-output-'));
    const args = [
      '-s',
      'read-only',
      '-a',
      'on-request',
      'exec',
      'resume',
      '--json',
      'thr_123',
      '--',
      'hello',
    ];

    const prepared = await prepareCodexOutputLastMessageCapture(args, tempRoot, 'job1');

    expect(prepared.args).toEqual([
      '-s',
      'read-only',
      '-a',
      'on-request',
      'exec',
      '--output-last-message',
      prepared.outputLastMessagePath,
      'resume',
      '--json',
      'thr_123',
      '--',
      'hello',
    ]);
    expect(args).toEqual([
      '-s',
      'read-only',
      '-a',
      'on-request',
      'exec',
      'resume',
      '--json',
      'thr_123',
      '--',
      'hello',
    ]);
  });

  it('consumes captured output text and removes the file', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-output-'));
    const filePath = path.join(tempRoot, 'last.txt');
    await writeFile(filePath, '  done  \n', 'utf8');

    const consumed = await consumeCodexOutputLastMessage(filePath);
    const consumedAgain = await consumeCodexOutputLastMessage(filePath);

    expect(consumed).toBe('done');
    expect(consumedAgain).toBeNull();
  });

  it('selects auth server from preferred or unique mcp-list result', () => {
    expect(
      selectCodexMcpAuthServer(
        {
          events: [],
          exitCode: 0,
          errorKind: null,
          servers: [
            { name: 'aws-api', url: 'http://localhost:8000/mcp', status: 'enabled', auth: 'OAuth' },
            { name: 'blender', url: 'http://localhost:9000/mcp', status: 'enabled', auth: 'OAuth' },
          ],
          serverNames: ['aws-api', 'blender'],
        },
        'aws-api',
      ),
    ).toBe('aws-api');

    expect(
      selectCodexMcpAuthServer(
        {
          events: [],
          exitCode: 0,
          errorKind: null,
          servers: [
            { name: 'aws-api', url: 'http://localhost:8000/mcp', status: 'enabled', auth: 'OAuth' },
          ],
          serverNames: ['aws-api'],
        },
        null,
      ),
    ).toBe('aws-api');

    expect(
      selectCodexMcpAuthServer(
        {
          events: [],
          exitCode: 0,
          errorKind: null,
          servers: [
            { name: 'aws-api', url: 'http://localhost:8000/mcp', status: 'enabled', auth: 'OAuth' },
            { name: 'blender', url: 'http://localhost:9000/mcp', status: 'enabled', auth: 'OAuth' },
          ],
          serverNames: ['aws-api', 'blender'],
        },
        null,
      ),
    ).toBeNull();
  });

  it('detects unsupported auth in mcp list rows', () => {
    expect(
      isCodexMcpServerAuthUnsupported(
        {
          events: [],
          exitCode: 0,
          errorKind: null,
          servers: [
            {
              name: 'aws-api',
              url: 'http://localhost:8000/mcp',
              status: 'enabled',
              auth: 'Unsupported',
            },
          ],
          serverNames: ['aws-api'],
        },
        'aws-api',
      ),
    ).toBe(true);
  });

  it('handles approval gate and state helper edge cases', () => {
    const gate = createCodexToolApprovalGate({});
    expect(buildCodexPermissionDeniedSummary(gate)).toBeNull();

    const nonToolEvent: DriverEvent = { type: 'text', content: 'hello' };
    const evaluated = evaluateCodexToolUseForApproval(gate, nonToolEvent);
    expect(evaluated).toEqual({ shouldBlock: false, gate });

    expect(
      appendCodexApprovedToolCall([{ toolName: 'aws_execute', args: { a: 1 } }], '   ', {
        x: 1,
      }),
    ).toEqual([{ toolName: 'aws_execute', args: { a: 1 } }]);

    const bigintGate = createCodexToolApprovalGate({
      [CODEX_ALLOW_TOOL_ONCE_LIST_KEY]: [{ toolName: 'aws_execute', args: { n: BigInt(1) } }],
    });
    const bigintEvent: DriverEvent = {
      type: 'tool_use',
      content: 'Calling: aws_execute',
      raw: { args: { n: BigInt(1) } },
    };
    expect(evaluateCodexToolUseForApproval(bigintGate, bigintEvent).shouldBlock).toBe(false);
  });

  it('handles codex output capture path when args do not contain exec', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-output-'));
    const args = ['-s', 'read-only', '--', 'hello'];
    const prepared = await prepareCodexOutputLastMessageCapture(args, tempRoot, 'job2');
    expect(prepared.args).toEqual(args);
    expect(prepared.outputLastMessagePath).toContain(
      path.join('.orchestrator', 'codex_last_job2.txt'),
    );
  });

  it('handles codex output consume with missing file', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-output-'));
    const missing = path.join(tempRoot, 'missing.txt');
    await expect(consumeCodexOutputLastMessage(missing)).resolves.toBeNull();
  });

  it('formats and tracks codex MCP preflight state helpers', () => {
    expect(isCodexMcpPreflightVerified({}, 'aws-api')).toBe(false);
    expect(
      isCodexMcpPreflightVerified({ codex_mcp_auth_verified_server: 'aws-api' }, 'aws-api'),
    ).toBe(true);
    expect(markCodexMcpPreflightVerified({}, 'aws-api')).toEqual({
      codex_mcp_auth_verified_server: 'aws-api',
    });

    expect(formatCodexMcpAuthRequiredMessage(null, null)).toContain(
      'CODEX_MCP_AUTH_SERVER` is not configured',
    );
    expect(formatCodexMcpAuthRequiredMessage('aws-api', 'https://example.com')).toContain(
      'Resource: `https://example.com`',
    );

    expect(formatCodexMcpAuthGenericFailureMessage('aws-api', null, null)).toContain(
      'pre-auth check for `aws-api` failed',
    );
    expect(formatCodexMcpAuthGenericFailureMessage('aws-api', 1, 'exit_1')).toContain(
      '(error=exit_1, exit=1)',
    );
  });

  it('selects preferred server fallback and unsupported auth false branch', () => {
    const empty = {
      events: [],
      exitCode: 0,
      errorKind: null,
      servers: [],
      serverNames: [],
    };
    expect(selectCodexMcpAuthServer(empty, 'aws-api')).toBe('aws-api');
    expect(isCodexMcpServerAuthUnsupported(empty, 'aws-api')).toBe(false);
  });

  it('runs codex MCP auth preflight and list parsing flows', async () => {
    const run = vi
      .fn()
      .mockImplementationOnce(
        async (
          _driver: unknown,
          _args: string[],
          _env: Record<string, string>,
          _cwd: string,
          onEvent: (event: DriverEvent) => void,
        ) => {
          onEvent({ type: 'status', content: 'Authentication complete' });
          return { exitCode: 0, errorKind: null, events: [] };
        },
      )
      .mockImplementationOnce(
        async (
          _driver: unknown,
          _args: string[],
          _env: Record<string, string>,
          _cwd: string,
          onEvent: (event: DriverEvent) => void,
        ) => {
          onEvent({
            type: 'text',
            content: [
              'Name                URL                                Status     Auth',
              'aws-api             http://localhost:8000/mcp          enabled    OAuth',
              'separator-----------',
              'blender             http://localhost:9000/mcp          enabled    Unsupported',
            ].join('\n'),
          });
          return { exitCode: 0, errorKind: null, events: [] };
        },
      )
      .mockImplementationOnce(
        async (
          _driver: unknown,
          _args: string[],
          _env: Record<string, string>,
          _cwd: string,
          onEvent: (event: DriverEvent) => void,
        ) => {
          onEvent({
            type: 'error',
            content: "MCP server 'aws-api' requires authentication using: /mcp auth aws-api",
          });
          return { exitCode: 1, errorKind: 'exit_1', events: [] };
        },
      );

    const fakeRunner = { run } as never;

    const ok = await runCodexMcpAuthPreflight(fakeRunner, {}, '/tmp', 'aws-api');
    expect(ok.ok).toBe(true);
    expect(ok.requiredServer).toBeNull();

    const list = await runCodexMcpList(fakeRunner, {}, '/tmp');
    expect(list.serverNames).toEqual(['aws-api', 'blender']);
    expect(list.servers.find((s) => s.name === 'blender')?.auth).toBe('Unsupported');

    const failed = await runCodexMcpAuthPreflight(fakeRunner, {}, '/tmp', 'aws-api');
    expect(failed.ok).toBe(false);
    expect(failed.requiredServer).toBe('aws-api');
    expect(failed.errorKind).toBe('exit_1');
  });

  it('extracts codex tool request variants from raw args/item/content_block', () => {
    const gate = createCodexToolApprovalGate({});

    const fromRawArgs = evaluateCodexToolUseForApproval(gate, {
      type: 'tool_use',
      content: 'noise',
      raw: { tool_name: 'aws_execute', args: { action: 'invoke' } },
    });
    expect(buildCodexPermissionDeniedSummary(fromRawArgs.gate)).toEqual({
      deniedTools: ['aws_execute'],
      request: {
        toolName: 'aws_execute',
        args: { action: 'invoke' },
      },
    });

    const fromItemInput = evaluateCodexToolUseForApproval(gate, {
      type: 'tool_use',
      content: 'noise',
      raw: { item: { name: 'aws_execute', input: { operation: 'ListBuckets' } } },
    });
    expect(buildCodexPermissionDeniedSummary(fromItemInput.gate)).toEqual({
      deniedTools: ['aws_execute'],
      request: {
        toolName: 'aws_execute',
        args: { operation: 'ListBuckets' },
      },
    });

    const fromContentBlock = evaluateCodexToolUseForApproval(gate, {
      type: 'tool_use',
      content: 'noise',
      raw: { content_block: { name: 'aws_execute', partial_json: '{"x":1}' } },
    });
    expect(buildCodexPermissionDeniedSummary(fromContentBlock.gate)).toEqual({
      deniedTools: ['aws_execute'],
      request: {
        toolName: 'aws_execute',
        args: '{"x":1}',
      },
    });
  });

  it('normalizes approved tool entries from tool_name field', () => {
    expect(
      extractCodexApprovedToolCalls({
        [CODEX_ALLOW_TOOL_ONCE_LIST_KEY]: [
          { tool_name: 'aws_execute', input: { service: 's3' } },
          { toolName: 'aws_execute', args: { service: 's3' } },
        ],
      }),
    ).toEqual([{ toolName: 'aws_execute', args: { service: 's3' } }]);
  });

  it('canonicalizes array args for deduplication', () => {
    expect(
      extractCodexApprovedToolCalls({
        [CODEX_ALLOW_TOOL_ONCE_LIST_KEY]: [
          {
            toolName: 'aws_execute',
            args: [{ b: 2, a: 1 }],
          },
          {
            toolName: 'aws_execute',
            args: [{ a: 1, b: 2 }],
          },
        ],
      }),
    ).toEqual([
      {
        toolName: 'aws_execute',
        args: [{ b: 2, a: 1 }],
      },
    ]);
  });

  it('extracts parameters/args/input/arguments variants from tool_use payloads', () => {
    const gate = createCodexToolApprovalGate({});

    const fromParameters = evaluateCodexToolUseForApproval(gate, {
      type: 'tool_use',
      content: 'noise',
      raw: { tool_name: 'aws_execute', parameters: { mode: 'params' } },
    });
    expect(buildCodexPermissionDeniedSummary(fromParameters.gate)?.request.args).toEqual({
      mode: 'params',
    });

    const fromItemArgs = evaluateCodexToolUseForApproval(gate, {
      type: 'tool_use',
      content: 'noise',
      raw: { item: { name: 'aws_execute', args: { mode: 'item-args' } } },
    });
    expect(buildCodexPermissionDeniedSummary(fromItemArgs.gate)?.request.args).toEqual({
      mode: 'item-args',
    });

    const fromContentInput = evaluateCodexToolUseForApproval(gate, {
      type: 'tool_use',
      content: 'noise',
      raw: { content_block: { name: 'aws_execute', input: { mode: 'cb-input' } } },
    });
    expect(buildCodexPermissionDeniedSummary(fromContentInput.gate)?.request.args).toEqual({
      mode: 'cb-input',
    });

    const fromContentArguments = evaluateCodexToolUseForApproval(gate, {
      type: 'tool_use',
      content: 'noise',
      raw: { content_block: { name: 'aws_execute', arguments: { mode: 'cb-arguments' } } },
    });
    expect(buildCodexPermissionDeniedSummary(fromContentArguments.gate)?.request.args).toEqual({
      mode: 'cb-arguments',
    });
  });

  it('covers approval-state edge branches with empty/invalid values', () => {
    expect(
      extractCodexApprovedToolCalls({
        [CODEX_ALLOW_TOOL_ONCE_LIST_KEY]: [
          null,
          1,
          { toolName: '   ' },
          { toolName: 'aws_execute' },
        ],
      }),
    ).toEqual([{ toolName: 'aws_execute', args: null }]);

    expect(appendCodexApprovedToolCall([], 'aws_execute', undefined)).toEqual([
      { toolName: 'aws_execute', args: null },
    ]);

    expect(
      appendCodexApprovedToolCall([{ toolName: 'aws_execute', args: '   ' }], 'aws_execute', ''),
    ).toEqual([{ toolName: 'aws_execute', args: '   ' }]);

    expect(buildCodexApprovalToolStateOverridesForCalls([])).toEqual({
      codex_ask_for_approval: 'never',
      [CODEX_ALLOW_TOOL_ONCE_LIST_KEY]: [],
    });

    expect(
      buildCodexApprovalToolStateOverridesForCalls([{ toolName: 'aws_execute', args: null }]),
    ).toEqual({
      codex_ask_for_approval: 'never',
      [CODEX_ALLOW_TOOL_ONCE_LIST_KEY]: [{ toolName: 'aws_execute', args: null }],
    });
  });

  it('handles null tool name tool_use requests and empty tool-state strings', () => {
    expect(isCodexMcpPreflightVerified({ codex_mcp_auth_verified_server: '   ' }, 'aws-api')).toBe(
      false,
    );

    const gate = createCodexToolApprovalGate({});
    const ignored = evaluateCodexToolUseForApproval(gate, {
      type: 'tool_use',
      content: 'noise',
      raw: {},
    });
    expect(ignored).toEqual({ shouldBlock: false, gate });

    const argsOnly = evaluateCodexToolUseForApproval(gate, {
      type: 'tool_use',
      content: 'noise',
      raw: { args: { action: 'invoke' } },
    });
    expect(argsOnly.shouldBlock).toBe(true);
    expect(buildCodexPermissionDeniedSummary(argsOnly.gate)).toEqual({
      deniedTools: [],
      request: {
        toolName: null,
        args: { action: 'invoke' },
      },
    });
  });

  it('parses mcp list while skipping invalid/header/separator/non-text entries', async () => {
    const run = vi
      .fn()
      .mockImplementation(
        async (
          _driver: unknown,
          _args: string[],
          _env: Record<string, string>,
          _cwd: string,
          onEvent: (event: DriverEvent) => void,
        ) => {
          onEvent({ type: 'tool_use', content: 'ignored tool event' });
          onEvent({
            type: 'text',
            content: [
              '',
              '------',
              'a  http://localhost:8000/mcp  enabled  OAuth',
              'Name  URL  Status  Auth',
              'aws-api  http://localhost:8000/mcp  status  auth',
              'aws_api  http://localhost:8000/mcp  enabled  OAuth',
            ].join('\n'),
          });
          return { exitCode: 0, errorKind: null, events: [] };
        },
      );

    const fakeRunner = { run } as never;
    const list = await runCodexMcpList(fakeRunner, {}, '/tmp');
    expect(list.serverNames).toEqual(['aws_api']);
    expect(list.servers[0]).toEqual({
      name: 'aws_api',
      url: 'http://localhost:8000/mcp',
      status: 'enabled',
      auth: 'OAuth',
    });
  });

  it('returns null for whitespace-only captured output', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-output-'));
    const filePath = path.join(tempRoot, 'empty.txt');
    await writeFile(filePath, ' \n\t ', 'utf8');
    await expect(consumeCodexOutputLastMessage(filePath)).resolves.toBeNull();
  });
});
