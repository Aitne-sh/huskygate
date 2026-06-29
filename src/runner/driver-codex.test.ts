import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from '../session/types.js';
import { CodexDriver } from './driver-codex.js';
import type { DriverBuildOptions } from './types.js';

const OFF: DriverBuildOptions = { autoApproveEnabled: false, skillsEnabled: false };

function createSession(toolState: Record<string, unknown>): Session {
  return {
    sessionKey: 'C1:123.456',
    tool: 'codex',
    mode: 'readonly',
    modeExpiresAt: null,
    toolState,
    workdir: '/tmp/workdir',
    runningJobId: null,
    updatedAt: new Date().toISOString(),
    devAlias: null,
  };
}

const originalCodexCommand = process.env.CODEX_COMMAND;
const originalCodexBin = process.env.CODEX_BIN;
const originalCodexModel = process.env.CODEX_MODEL;

afterEach(() => {
  if (originalCodexCommand === undefined) {
    delete process.env.CODEX_COMMAND;
  } else {
    process.env.CODEX_COMMAND = originalCodexCommand;
  }

  if (originalCodexBin === undefined) {
    delete process.env.CODEX_BIN;
  } else {
    process.env.CODEX_BIN = originalCodexBin;
  }

  if (originalCodexModel === undefined) {
    delete process.env.CODEX_MODEL;
  } else {
    process.env.CODEX_MODEL = originalCodexModel;
  }
});

describe('CodexDriver.buildCommand', () => {
  it('uses CODEX_COMMAND override when provided', () => {
    process.env.CODEX_COMMAND = '/tmp/custom-codex';
    const driver = new CodexDriver();
    expect(driver.buildCommand()).toBe('/tmp/custom-codex');
  });
});

describe('CodexDriver.buildArgs', () => {
  it('passes prompt on new session', () => {
    const driver = new CodexDriver();
    const args = driver.buildArgs('hello', createSession({}), 'readonly', OFF);
    expect(args).toEqual([
      '-s',
      'read-only',
      '-a',
      'on-request',
      '--disable',
      'responses_websockets',
      '--disable',
      'responses_websockets_v2',
      'exec',
      '--json',
      '--',
      'hello',
    ]);
  });

  it('passes resumed thread id with prompt using exec resume subcommand', () => {
    const driver = new CodexDriver();
    const args = driver.buildArgs(
      'follow up',
      createSession({ thread_id: 'thr_123' }),
      'readonly',
      OFF,
    );
    expect(args).toEqual([
      '-s',
      'read-only',
      '-a',
      'on-request',
      '--disable',
      'responses_websockets',
      '--disable',
      'responses_websockets_v2',
      'exec',
      'resume',
      '--json',
      'thr_123',
      '--',
      'follow up',
    ]);
  });

  it('adds --skip-git-repo-check when requested by tool state', () => {
    const driver = new CodexDriver();
    const args = driver.buildArgs(
      'hello',
      createSession({ codex_skip_git_repo_check: true }),
      'readonly',
      OFF,
    );
    expect(args).toEqual([
      '-s',
      'read-only',
      '-a',
      'on-request',
      '--disable',
      'responses_websockets',
      '--disable',
      'responses_websockets_v2',
      'exec',
      '--skip-git-repo-check',
      '--json',
      '--',
      'hello',
    ]);
  });

  it('adds --skip-git-repo-check before resume subcommand when requested', () => {
    const driver = new CodexDriver();
    const args = driver.buildArgs(
      'follow up',
      createSession({ thread_id: 'thr_123', codex_skip_git_repo_check: true }),
      'readonly',
      OFF,
    );
    expect(args).toEqual([
      '-s',
      'read-only',
      '-a',
      'on-request',
      '--disable',
      'responses_websockets',
      '--disable',
      'responses_websockets_v2',
      'exec',
      '--skip-git-repo-check',
      'resume',
      '--json',
      'thr_123',
      '--',
      'follow up',
    ]);
  });

  it('uses workspace-write sandbox with network access on write mode', () => {
    const driver = new CodexDriver();
    const args = driver.buildArgs('edit file', createSession({}), 'write', OFF);
    expect(args).toEqual([
      '-s',
      'workspace-write',
      '-a',
      'on-request',
      '-c',
      'sandbox_workspace_write.network_access=true',
      '--disable',
      'responses_websockets',
      '--disable',
      'responses_websockets_v2',
      'exec',
      '--json',
      '--',
      'edit file',
    ]);
  });

  it('write mode applies ask-for-approval override', () => {
    const driver = new CodexDriver();
    const args = driver.buildArgs(
      'edit file',
      createSession({ codex_ask_for_approval: 'never' }),
      'write',
      OFF,
    );
    expect(args).toEqual([
      '-s',
      'workspace-write',
      '-a',
      'never',
      '-c',
      'sandbox_workspace_write.network_access=true',
      '--disable',
      'responses_websockets',
      '--disable',
      'responses_websockets_v2',
      'exec',
      '--json',
      '--',
      'edit file',
    ]);
  });

  it('does not include -m when no model is configured', () => {
    delete process.env.CODEX_MODEL;
    const driver = new CodexDriver();
    const args = driver.buildArgs('hello', createSession({}), 'readonly', OFF);
    expect(args).not.toContain('-m');
  });

  it('includes -m from toolState.model before exec', () => {
    delete process.env.CODEX_MODEL;
    const driver = new CodexDriver();
    const args = driver.buildArgs('hello', createSession({ model: 'gpt-5' }), 'write', OFF);
    const mIdx = args.indexOf('-m');
    expect(mIdx).toBeGreaterThan(-1);
    expect(args[mIdx + 1]).toBe('gpt-5');
    // -m must appear before 'exec'
    expect(mIdx).toBeLessThan(args.indexOf('exec'));
  });

  it('includes -m from CODEX_MODEL env when toolState has no model', () => {
    process.env.CODEX_MODEL = 'o3-pro';
    const driver = new CodexDriver();
    const args = driver.buildArgs('hello', createSession({}), 'write', OFF);
    const mIdx = args.indexOf('-m');
    expect(mIdx).toBeGreaterThan(-1);
    expect(args[mIdx + 1]).toBe('o3-pro');
  });

  it('toolState.model overrides CODEX_MODEL env', () => {
    process.env.CODEX_MODEL = 'o3-pro';
    const driver = new CodexDriver();
    const args = driver.buildArgs('hello', createSession({ model: 'gpt-5' }), 'write', OFF);
    const mIdx = args.indexOf('-m');
    expect(mIdx).toBeGreaterThan(-1);
    expect(args[mIdx + 1]).toBe('gpt-5');
  });

  it('does not include -m when toolState.model is "default"', () => {
    delete process.env.CODEX_MODEL;
    const driver = new CodexDriver();
    const args = driver.buildArgs('hello', createSession({ model: 'default' }), 'write', OFF);
    expect(args).not.toContain('-m');
  });

  it('does not include -m when CODEX_MODEL env is "default"', () => {
    process.env.CODEX_MODEL = 'default';
    const driver = new CodexDriver();
    const args = driver.buildArgs('hello', createSession({}), 'write', OFF);
    expect(args).not.toContain('-m');
  });

  it('applies one-shot approval override on resume runs', () => {
    const driver = new CodexDriver();
    const args = driver.buildArgs(
      'retry',
      createSession({ thread_id: 'thr_123', codex_ask_for_approval: 'never' }),
      'readonly',
      OFF,
    );
    expect(args).toEqual([
      '-s',
      'read-only',
      '-a',
      'never',
      '--disable',
      'responses_websockets',
      '--disable',
      'responses_websockets_v2',
      'exec',
      'resume',
      '--json',
      'thr_123',
      '--',
      'retry',
    ]);
  });

  it('uses never approval policy on write mode when autoApproveEnabled is true', () => {
    const driver = new CodexDriver();
    const args = driver.buildArgs('hello', createSession({}), 'write', {
      autoApproveEnabled: true,
      skillsEnabled: false,
    });
    expect(args).toContain('-s');
    expect(args).toContain('workspace-write');
    expect(args).toContain('-a');
    expect(args[args.indexOf('-a') + 1]).toBe('never');
  });

  it('does NOT use never approval policy in readonly even with autoApproveEnabled', () => {
    const driver = new CodexDriver();
    const args = driver.buildArgs('hello', createSession({}), 'readonly', {
      autoApproveEnabled: true,
      skillsEnabled: false,
    });
    expect(args).toContain('-s');
    expect(args).toContain('read-only');
    expect(args).toContain('-a');
    expect(args[args.indexOf('-a') + 1]).toBe('on-request');
  });
});

describe('CodexDriver.parseStderr', () => {
  it('maps known Codex.app PATH warning to status', () => {
    const driver = new CodexDriver();
    expect(
      driver.parseStderr(
        'WARNING: proceeding, even though we could not update PATH: Operation not permitted (os error 1)',
      ),
    ).toEqual({
      type: 'status',
      content:
        'WARNING: proceeding, even though we could not update PATH: Operation not permitted (os error 1)',
    });
  });

  it('maps known codex rollout db noise to status', () => {
    const driver = new CodexDriver();
    expect(
      driver.parseStderr(
        '2026-02-14T00:30:51.295162Z ERROR codex_core::rollout::list: state db missing rollout path for thread 019c5976-a3f5-7732-98d7-fc4319ac4df6',
      ),
    ).toEqual({
      type: 'status',
      content:
        '2026-02-14T00:30:51.295162Z ERROR codex_core::rollout::list: state db missing rollout path for thread 019c5976-a3f5-7732-98d7-fc4319ac4df6',
    });
  });

  it('parses JSONL stderr events as normal driver events', () => {
    const driver = new CodexDriver();
    expect(
      driver.parseStderr(
        JSON.stringify({
          type: 'response.output_text.delta',
          delta: 'hello',
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'hello',
      raw: {
        type: 'response.output_text.delta',
        delta: 'hello',
      },
    });
  });

  it('extracts tool_use from plain-text stderr tool lines', () => {
    const driver = new CodexDriver();
    expect(driver.parseStderr('Using tool: aws_execute')).toEqual({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      raw: {
        tool_name: 'aws_execute',
      },
    });
  });

  it('maps shared MCP auth/discovery noise to status', () => {
    const driver = new CodexDriver();
    expect(
      driver.parseStderr("Error during discovery for MCP server 'aws-api': Connection closed"),
    ).toEqual({
      type: 'status',
      content: "Error during discovery for MCP server 'aws-api': Connection closed",
    });
    expect(
      driver.parseStderr("MCP server 'aws-api' requires authentication using: /mcp auth aws-api"),
    ).toEqual({
      type: 'status',
      content: "MCP server 'aws-api' requires authentication using: /mcp auth aws-api",
    });
    expect(driver.parseStderr('Refreshing expired token for MCP server aws-api')).toEqual({
      type: 'status',
      content: 'Refreshing expired token for MCP server aws-api',
    });
  });
});

describe('CodexDriver.parseEvent', () => {
  it('extracts text from response.output_text.delta events', () => {
    const driver = new CodexDriver();
    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'response.output_text.delta',
          delta: 'hello',
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'hello',
      raw: {
        type: 'response.output_text.delta',
        delta: 'hello',
      },
    });
  });

  it('extracts assistant text from response.output_item.done events', () => {
    const driver = new CodexDriver();
    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'response.output_item.done',
          item: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'S3 buckets are 7.' }],
          },
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'S3 buckets are 7.',
      raw: {
        type: 'response.output_item.done',
        item: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'S3 buckets are 7.' }],
        },
      },
    });
  });

  it('extracts tool_use from response.output_item.added function_call events', () => {
    const driver = new CodexDriver();
    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'response.output_item.added',
          item: {
            type: 'function_call',
            name: 'aws_execute',
            arguments: { service: 's3', operation: 'ListBuckets' },
          },
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      content: 'Calling: aws_execute',
      toolInput: { service: 's3', operation: 'ListBuckets' },
      raw: {
        type: 'response.output_item.added',
        tool_name: 'aws_execute',
        arguments: { service: 's3', operation: 'ListBuckets' },
        item: {
          type: 'function_call',
          name: 'aws_execute',
          arguments: { service: 's3', operation: 'ListBuckets' },
        },
      },
    });
  });

  it('extracts tool_use from response.output_item.added tool_call events', () => {
    const driver = new CodexDriver();
    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'response.output_item.added',
          item: {
            type: 'tool_call',
            tool_name: 'aws_execute',
            input: { service: 's3', operation: 'ListBuckets' },
          },
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      content: 'Calling: aws_execute',
      toolInput: { service: 's3', operation: 'ListBuckets' },
      raw: {
        type: 'response.output_item.added',
        item: {
          type: 'tool_call',
          tool_name: 'aws_execute',
          input: { service: 's3', operation: 'ListBuckets' },
        },
        tool_name: 'aws_execute',
        arguments: { service: 's3', operation: 'ListBuckets' },
      },
    });
  });

  it('extracts tool_use from item.started mcp_tool_call events with tool field', () => {
    const driver = new CodexDriver();
    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'item.started',
          item: {
            id: 'item_2',
            type: 'mcp_tool_call',
            server: 'aws-api',
            tool: 'aws_execute',
            arguments: { action: 'invoke', service: 's3', operation: 'ListBuckets' },
            status: 'in_progress',
          },
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      content: 'Calling: aws_execute',
      toolInput: { action: 'invoke', service: 's3', operation: 'ListBuckets' },
      raw: {
        type: 'item.started',
        item: {
          id: 'item_2',
          type: 'mcp_tool_call',
          server: 'aws-api',
          tool: 'aws_execute',
          arguments: { action: 'invoke', service: 's3', operation: 'ListBuckets' },
          status: 'in_progress',
        },
        tool_name: 'aws_execute',
        arguments: { action: 'invoke', service: 's3', operation: 'ListBuckets' },
      },
    });
  });

  it('extracts tool_result from item.completed mcp_tool_call events', () => {
    const driver = new CodexDriver();
    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_2',
            type: 'mcp_tool_call',
            server: 'aws-api',
            tool: 'aws_execute',
            arguments: { action: 'invoke', service: 's3', operation: 'ListBuckets' },
            result: { ok: true },
            status: 'completed',
          },
        }),
      ),
    ).toEqual({
      type: 'tool_result',
      content: '{"ok":true}',
      raw: {
        type: 'item.completed',
        item: {
          id: 'item_2',
          type: 'mcp_tool_call',
          server: 'aws-api',
          tool: 'aws_execute',
          arguments: { action: 'invoke', service: 's3', operation: 'ListBuckets' },
          result: { ok: true },
          status: 'completed',
        },
        tool_name: 'aws_execute',
        arguments: { action: 'invoke', service: 's3', operation: 'ListBuckets' },
      },
    });
  });

  it('extracts tool_use from plain-text lines', () => {
    const driver = new CodexDriver();
    expect(driver.parseEvent('Using tool: aws_execute')).toEqual({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      raw: {
        tool_name: 'aws_execute',
      },
    });
  });

  it('extracts tool_result from response.output_item.added function_call_output events', () => {
    const driver = new CodexDriver();
    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'response.output_item.added',
          item: {
            type: 'function_call_output',
            output: { ok: true },
          },
        }),
      ),
    ).toEqual({
      type: 'tool_result',
      content: '{"ok":true}',
      raw: {
        type: 'response.output_item.added',
        item: {
          type: 'function_call_output',
          output: { ok: true },
        },
      },
    });
  });

  it('extracts nested assistant text from turn.completed payloads', () => {
    const driver = new CodexDriver();
    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'turn.completed',
          turn: {
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'text', text: 'Done.' }],
              },
            ],
          },
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'Done.',
      raw: {
        type: 'turn.completed',
        turn: {
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: 'Done.' }],
            },
          ],
        },
      },
    });
  });

  it('handles additional event branches and fallbacks', () => {
    const driver = new CodexDriver();

    expect(driver.parseEvent('')).toBeNull();
    expect(driver.parseEvent('   ')).toBeNull();

    // Non-JSON lines are discarded in --json mode (CLI noise).
    expect(driver.parseEvent('not json line')).toBeNull();

    expect(driver.parseEvent(JSON.stringify({ type: 'thread.started' }))).toBeNull();
    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'thread.started',
          thread_id: 'thr_abc',
        }),
      ),
    ).toEqual({
      type: 'status',
      content: 'thread:thr_abc',
      raw: {
        type: 'thread.started',
        thread_id: 'thr_abc',
      },
    });
    expect(driver.parseEvent(JSON.stringify({ type: 'response.output_text.delta' }))).toBeNull();
    expect(driver.parseEvent(JSON.stringify({ type: 'response.output_text.done' }))).toBeNull();

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'response.output_text.done',
          text: 'final text',
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'final text',
      raw: {
        type: 'response.output_text.done',
        text: 'final text',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'turn.completed',
          output: 'output text',
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'output text',
      raw: {
        type: 'turn.completed',
        output: 'output text',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'response.output_item.added',
          item: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'assistant line' }],
          },
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'assistant line',
      raw: {
        type: 'response.output_item.added',
        item: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'assistant line' }],
        },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'response.completed',
          response: {
            output: [{ type: 'output_text', text: 'done nested' }],
          },
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'done nested',
      raw: {
        type: 'response.completed',
        response: {
          output: [{ type: 'output_text', text: 'done nested' }],
        },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'event',
          response: 'direct string',
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'direct string',
      raw: {
        type: 'event',
        response: 'direct string',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'event',
          output: [{ type: 'output_text_delta', delta: 'delta nested' }],
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'delta nested',
      raw: {
        type: 'event',
        output: [{ type: 'output_text_delta', delta: 'delta nested' }],
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'event',
          message: {
            role: 'assistant',
            content: 'assistant content',
          },
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'assistant content',
      raw: {
        type: 'event',
        message: {
          role: 'assistant',
          content: 'assistant content',
        },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'item.started',
          item: {
            type: 'agent_message',
            text: 'agent text',
          },
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'agent text',
      raw: {
        type: 'item.started',
        item: {
          type: 'agent_message',
          text: 'agent text',
        },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'item.started',
          item: {
            type: 'reasoning',
            text: 'hidden',
          },
        }),
      ),
    ).toBeNull();

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'unknown_event',
          item: {
            type: 'tool_call',
            function: { name: 'aws_execute', input: { action: 'invoke' } },
          },
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      toolInput: { action: 'invoke' },
      raw: {
        type: 'unknown_event',
        item: {
          type: 'tool_call',
          function: { name: 'aws_execute', input: { action: 'invoke' } },
        },
        tool_name: 'aws_execute',
        arguments: { action: 'invoke' },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'event',
          response: {
            output: [{ type: 'text', text: 'Calling: aws_execute' }],
          },
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      raw: {
        type: 'event',
        response: {
          output: [{ type: 'text', text: 'Calling: aws_execute' }],
        },
        tool_name: 'aws_execute',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'error',
        }),
      ),
    ).toEqual({
      type: 'error',
      content: 'Unknown error',
      raw: { type: 'error' },
    });

    expect(driver.parseEvent(JSON.stringify({ type: 'noop' }))).toBeNull();
  });

  it('parses tool result fallback values', () => {
    const driver = new CodexDriver();

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'item.completed',
          item: {
            type: 'function_call',
            function: { name: 'aws_execute' },
            error: { message: 'failed' },
            status: 'completed',
          },
        }),
      ),
    ).toEqual({
      type: 'tool_result',
      content: '{"message":"failed"}',
      raw: {
        type: 'item.completed',
        item: {
          type: 'function_call',
          function: { name: 'aws_execute' },
          error: { message: 'failed' },
          status: 'completed',
        },
        tool_name: 'aws_execute',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'item.completed',
          item: {
            type: 'function_call',
            function: { name: 'aws_execute' },
            status: 'completed',
          },
        }),
      ),
    ).toEqual({
      type: 'tool_result',
      content: '',
      raw: {
        type: 'item.completed',
        item: {
          type: 'function_call',
          function: { name: 'aws_execute' },
          status: 'completed',
        },
        tool_name: 'aws_execute',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'response.output_item.added',
          item: {
            type: 'function_call_output',
          },
        }),
      ),
    ).toEqual({
      type: 'tool_result',
      content: '',
      raw: {
        type: 'response.output_item.added',
        item: {
          type: 'function_call_output',
        },
      },
    });
  });

  it('covers additional parser branches for nested extraction and generic tool detection', () => {
    const driver = new CodexDriver();

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'response.output_item.added',
        }),
      ),
    ).toBeNull();

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'response.output_item.added',
          item: {
            type: 'function_call',
          },
        }),
      ),
    ).toBeNull();

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'event',
          item: { type: 'tool_call' },
          content_block: {
            type: 'tool_call',
            function: { name: 'aws_execute' },
          },
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      raw: {
        type: 'event',
        item: { type: 'tool_call' },
        content_block: {
          type: 'tool_call',
          function: { name: 'aws_execute' },
        },
        tool_name: 'aws_execute',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'item.completed',
          item: {
            type: 'function_call',
            name: 'aws_execute',
            result: 'ok',
            status: 'completed',
          },
        }),
      ),
    ).toEqual({
      type: 'tool_result',
      content: 'ok',
      raw: {
        type: 'item.completed',
        item: {
          type: 'function_call',
          name: 'aws_execute',
          result: 'ok',
          status: 'completed',
        },
        tool_name: 'aws_execute',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'item.started',
          item: {
            type: 'event',
            role: 'user',
            content: [
              { type: 'output_text', text: 1 },
              { type: 'output_text', text: '' },
              { type: 'output_text_delta', delta: '' },
              { type: 'output_text_delta', delta: 'delta' },
            ],
            turn: { type: 'text', text: 'turn-text' },
            parts: [{ type: 'text', text: 'part-text' }],
          },
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'turn-text\ndelta\npart-text',
      raw: {
        type: 'item.started',
        item: {
          type: 'event',
          role: 'user',
          content: [
            { type: 'output_text', text: 1 },
            { type: 'output_text', text: '' },
            { type: 'output_text_delta', delta: '' },
            { type: 'output_text_delta', delta: 'delta' },
          ],
          turn: { type: 'text', text: 'turn-text' },
          parts: [{ type: 'text', text: 'part-text' }],
        },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'turn.completed',
          response: { output: [{ type: 'text', text: 'fallback-turn' }] },
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'fallback-turn',
      raw: {
        type: 'turn.completed',
        response: { output: [{ type: 'text', text: 'fallback-turn' }] },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'event',
          item: {
            function: {
              name: 'aws_execute',
              input: { mode: 'fallback-name-only' },
            },
          },
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      toolInput: { mode: 'fallback-name-only' },
      raw: {
        type: 'event',
        item: {
          function: {
            name: 'aws_execute',
            input: { mode: 'fallback-name-only' },
          },
        },
        tool_name: 'aws_execute',
        arguments: { mode: 'fallback-name-only' },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'event',
          content: [42, { type: 'text', text: 'content-from-mixed-array' }],
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'content-from-mixed-array',
      raw: {
        type: 'event',
        content: [42, { type: 'text', text: 'content-from-mixed-array' }],
      },
    });

    let deep: Record<string, unknown> = { type: 'text', text: 'too-deep' };
    for (let i = 0; i < 25; i++) {
      deep = { content: [deep] };
    }
    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'response.completed',
          response: deep,
        }),
      ),
    ).toBeNull();
  });

  it('discards all non-JSON stdout lines (Codex uses --json mode)', () => {
    const driver = new CodexDriver();
    // Codex CLI is always invoked with --json, so legitimate content
    // arrives as JSONL.  Any non-JSON stdout line is CLI noise
    // (reconnection, fallback, warnings) and must be discarded.
    expect(
      driver.parseEvent(
        'Reconnecting... 3/5 (stream disconnected before completion: failed to send websocket request)',
      ),
    ).toBeNull();
    expect(
      driver.parseEvent(
        'Falling back from WebSockets to HTTPS transport. stream disconnected before completion: connection closed',
      ),
    ).toBeNull();
    expect(driver.parseEvent('Falling back from WebSockets to HTTPS transport')).toBeNull();
    // Even arbitrary non-JSON text is discarded in --json mode.
    expect(driver.parseEvent('some plain output')).toBeNull();
  });
});

describe('CodexDriver.other branches', () => {
  it('handles buildCommand/buildArgs/buildEnv/extractSessionState fallbacks', () => {
    const driver = new CodexDriver();
    process.env.CODEX_COMMAND = '   ';
    process.env.CODEX_BIN = '/usr/local/bin/codex-bin';
    expect(driver.buildCommand()).toBe('/usr/local/bin/codex-bin');

    const args = driver.buildArgs(
      'hello',
      createSession({ codex_ask_for_approval: 'invalid-value' }),
      'readonly',
      OFF,
    );
    expect(args).toContain('on-request');

    const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
    const originalCodexHome = process.env.CODEX_HOME;
    const originalCodexMcpConfigPath = process.env.CODEX_MCP_CONFIG_PATH;
    const originalAwsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;

    try {
      process.env.OPENAI_API_KEY = 'k';
      process.env.CODEX_HOME = '/tmp/codex-home';
      process.env.CODEX_MCP_CONFIG_PATH = '/tmp/codex-config.toml';
      process.env.AWS_ACCESS_KEY_ID = 'AKIA...';
      const env = driver.buildEnv();
      expect(env.OPENAI_API_KEY).toBe('k');
      expect(env.CODEX_HOME).toBe('/tmp/codex-home');
      expect(env.CODEX_MCP_CONFIG_PATH).toBeUndefined();
      // Cloud env vars are NOT included in buildEnv — forwarded by job-executor based on policy
      expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
    } finally {
      if (originalOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalOpenAiApiKey;
      if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = originalCodexHome;
      if (originalCodexMcpConfigPath === undefined) delete process.env.CODEX_MCP_CONFIG_PATH;
      else process.env.CODEX_MCP_CONFIG_PATH = originalCodexMcpConfigPath;
      if (originalAwsAccessKeyId === undefined) delete process.env.AWS_ACCESS_KEY_ID;
      else process.env.AWS_ACCESS_KEY_ID = originalAwsAccessKeyId;
    }

    expect(driver.extractSessionState([])).toEqual({});
    expect(
      driver.extractSessionState([
        { type: 'status', content: 'thread:thr_123' },
        { type: 'text', content: 'hello' },
      ]),
    ).toEqual({ thread_id: 'thr_123' });
  });

  it('excludes daemon-only keys from buildEnv', () => {
    const origSlack = process.env.SLACK_BOT_TOKEN;
    const origApi = process.env.SERVER_API_SECRET;
    const origDash = process.env.DASHBOARD_SECRET;
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    process.env.SERVER_API_SECRET = 'secret-test';
    process.env.DASHBOARD_SECRET = 'dash-test';
    try {
      const driver = new CodexDriver();
      const env = driver.buildEnv();
      expect(env).not.toHaveProperty('SLACK_BOT_TOKEN');
      expect(env).not.toHaveProperty('SERVER_API_SECRET');
      expect(env).not.toHaveProperty('DASHBOARD_SECRET');
    } finally {
      if (origSlack === undefined) delete process.env.SLACK_BOT_TOKEN;
      else process.env.SLACK_BOT_TOKEN = origSlack;
      if (origApi === undefined) delete process.env.SERVER_API_SECRET;
      else process.env.SERVER_API_SECRET = origApi;
      if (origDash === undefined) delete process.env.DASHBOARD_SECRET;
      else process.env.DASHBOARD_SECRET = origDash;
    }
  });

  it('does not forward unrelated or other-driver env vars in buildEnv', () => {
    const origAnthropic = process.env.ANTHROPIC_API_KEY;
    const origGemini = process.env.GEMINI_API_KEY;
    const origGoogle = process.env.GOOGLE_API_KEY;
    const origUnrelated = process.env.UNRELATED_SECRET;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.GEMINI_API_KEY = 'gem-test';
    process.env.GOOGLE_API_KEY = 'goog-test';
    process.env.UNRELATED_SECRET = 'should-not-leak';
    try {
      const driver = new CodexDriver();
      const env = driver.buildEnv();
      expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
      expect(env).not.toHaveProperty('GEMINI_API_KEY');
      expect(env).not.toHaveProperty('GOOGLE_API_KEY');
      expect(env).not.toHaveProperty('UNRELATED_SECRET');
    } finally {
      if (origAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = origAnthropic;
      if (origGemini === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = origGemini;
      if (origGoogle === undefined) delete process.env.GOOGLE_API_KEY;
      else process.env.GOOGLE_API_KEY = origGoogle;
      if (origUnrelated === undefined) delete process.env.UNRELATED_SECRET;
      else process.env.UNRELATED_SECRET = origUnrelated;
    }
  });

  it('passes through codex auth/config env vars in buildEnv', () => {
    const origOpenai = process.env.OPENAI_API_KEY;
    const origCodexMcpConfigPath = process.env.CODEX_MCP_CONFIG_PATH;
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    process.env.CODEX_MCP_CONFIG_PATH = '/tmp/codex-mcp.toml';
    try {
      const driver = new CodexDriver();
      const env = driver.buildEnv();
      expect(env.OPENAI_API_KEY).toBe('sk-openai-test');
      expect(env.CODEX_MCP_CONFIG_PATH).toBeUndefined();
    } finally {
      if (origOpenai === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = origOpenai;
      if (origCodexMcpConfigPath === undefined) delete process.env.CODEX_MCP_CONFIG_PATH;
      else process.env.CODEX_MCP_CONFIG_PATH = origCodexMcpConfigPath;
    }
  });

  it('handles parseStderr branches', () => {
    const driver = new CodexDriver();
    expect(driver.parseStderr('')).toBeNull();
    expect(driver.parseStderr('stream disconnected before completion')).toEqual({
      type: 'status',
      content: 'stream disconnected before completion',
    });
    expect(driver.parseStderr('{"type":"noop"}')).toEqual({
      type: 'error',
      content: '{"type":"noop"}',
    });
    expect(driver.parseStderr('plain stderr')).toEqual({
      type: 'error',
      content: 'plain stderr',
    });
  });
});
