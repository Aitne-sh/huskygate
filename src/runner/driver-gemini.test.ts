import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../session/types.js';
import { logger } from '../utils/logger.js';
import { GeminiDriver } from './driver-gemini.js';
import type { DriverBuildOptions } from './types.js';

const OFF: DriverBuildOptions = { autoApproveEnabled: false, skillsEnabled: false };

function createSession(toolState: Record<string, unknown>): Session {
  return {
    sessionKey: 'C1:123.456',
    tool: 'gemini',
    mode: 'readonly',
    modeExpiresAt: null,
    toolState,
    workdir: '/tmp/workdir',
    runningJobId: null,
    updatedAt: new Date().toISOString(),
    devAlias: null,
  };
}

const originalReadonlyMode = process.env.GEMINI_READONLY_APPROVAL_MODE;
const originalGeminiCommand = process.env.GEMINI_COMMAND;
const originalGeminiBin = process.env.GEMINI_BIN;
const originalGeminiModel = process.env.GEMINI_MODEL;

afterEach(() => {
  if (originalReadonlyMode === undefined) {
    delete process.env.GEMINI_READONLY_APPROVAL_MODE;
  } else {
    process.env.GEMINI_READONLY_APPROVAL_MODE = originalReadonlyMode;
  }
  process.env.GEMINI_COMMAND = originalGeminiCommand;
  process.env.GEMINI_BIN = originalGeminiBin;
  if (originalGeminiModel === undefined) {
    delete process.env.GEMINI_MODEL;
  } else {
    process.env.GEMINI_MODEL = originalGeminiModel;
  }
});

describe('GeminiDriver.buildArgs', () => {
  // Set GEMINI_COMMAND so npx prefix args are not prepended.
  beforeEach(() => {
    process.env.GEMINI_COMMAND = '/usr/bin/gemini';
  });

  it('uses compatible readonly args by default (no explicit approval mode)', () => {
    delete process.env.GEMINI_READONLY_APPROVAL_MODE;
    const driver = new GeminiDriver();
    const args = driver.buildArgs('hello', createSession({}), 'readonly', OFF);
    expect(args).toEqual(['-p', 'hello', '--output-format', 'stream-json', '--sandbox']);
  });

  it('supports opt-in readonly plan mode', () => {
    process.env.GEMINI_READONLY_APPROVAL_MODE = 'plan';
    const driver = new GeminiDriver();
    const args = driver.buildArgs(
      'follow up',
      createSession({ session_index: 'latest', gemini_resume_ready: true }),
      'readonly',
      OFF,
    );
    expect(args).toEqual([
      '-p',
      'follow up',
      '--output-format',
      'stream-json',
      '--sandbox',
      '--approval-mode',
      'plan',
      '--resume',
      'latest',
    ]);
  });

  it('falls back to default sandbox for unrecognized GEMINI_READONLY_APPROVAL_MODE', () => {
    process.env.GEMINI_READONLY_APPROVAL_MODE = 'invalid_value';
    const driver = new GeminiDriver();
    const args = driver.buildArgs('hello', createSession({}), 'readonly', OFF);
    // Should use sandbox without explicit approval mode (same as no env set)
    expect(args).toContain('--sandbox');
    expect(args).not.toContain('--approval-mode');
  });

  it('does not pass --resume when resume state is not ready', () => {
    process.env.GEMINI_READONLY_APPROVAL_MODE = 'plan';
    const driver = new GeminiDriver();
    const args = driver.buildArgs(
      'follow up',
      createSession({ session_index: 'latest' }),
      'readonly',
      OFF,
    );
    expect(args).toEqual([
      '-p',
      'follow up',
      '--output-format',
      'stream-json',
      '--sandbox',
      '--approval-mode',
      'plan',
    ]);
  });

  it('uses yolo in write mode without --sandbox', () => {
    delete process.env.GEMINI_READONLY_APPROVAL_MODE;
    const driver = new GeminiDriver();
    const args = driver.buildArgs('edit file', createSession({}), 'write', OFF);
    expect(args).toEqual([
      '-p',
      'edit file',
      '--output-format',
      'stream-json',
      '--approval-mode',
      'yolo',
    ]);
  });

  it('logs the allowMcp=false write-mode limitation', () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const driver = new GeminiDriver();

    const args = driver.buildArgs('edit file', createSession({}), 'write', {
      ...OFF,
      allowMcp: false,
    });

    expect(args).toContain('--approval-mode');
    expect(infoSpy).toHaveBeenCalledWith(
      'gemini_allowMcp_false_limitation',
      expect.objectContaining({
        note: expect.stringContaining('cannot restrict MCP tools'),
      }),
    );

    infoSpy.mockRestore();
  });

  it('does not include --model when no model is configured', () => {
    delete process.env.GEMINI_MODEL;
    const driver = new GeminiDriver();
    const args = driver.buildArgs('hello', createSession({}), 'readonly', OFF);
    expect(args).not.toContain('--model');
  });

  it('includes --model from toolState.model', () => {
    delete process.env.GEMINI_MODEL;
    const driver = new GeminiDriver();
    const args = driver.buildArgs(
      'hello',
      createSession({ model: 'gemini-2.5-pro' }),
      'write',
      OFF,
    );
    const idx = args.indexOf('--model');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('gemini-2.5-pro');
  });

  it('includes --model from GEMINI_MODEL env when toolState has no model', () => {
    process.env.GEMINI_MODEL = 'gemini-2.0-flash';
    const driver = new GeminiDriver();
    const args = driver.buildArgs('hello', createSession({}), 'write', OFF);
    const idx = args.indexOf('--model');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('gemini-2.0-flash');
  });

  it('toolState.model overrides GEMINI_MODEL env', () => {
    process.env.GEMINI_MODEL = 'gemini-2.0-flash';
    const driver = new GeminiDriver();
    const args = driver.buildArgs(
      'hello',
      createSession({ model: 'gemini-2.5-pro' }),
      'write',
      OFF,
    );
    const idx = args.indexOf('--model');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('gemini-2.5-pro');
  });

  it('does not include --model when toolState.model is "default"', () => {
    delete process.env.GEMINI_MODEL;
    const driver = new GeminiDriver();
    const args = driver.buildArgs('hello', createSession({ model: 'default' }), 'write', OFF);
    expect(args).not.toContain('--model');
  });

  it('does not include --model when GEMINI_MODEL env is "default"', () => {
    process.env.GEMINI_MODEL = 'default';
    const driver = new GeminiDriver();
    const args = driver.buildArgs('hello', createSession({}), 'write', OFF);
    expect(args).not.toContain('--model');
  });

  it('passes approved Gemini tools as allowed-tools flags', () => {
    const driver = new GeminiDriver();
    const args = driver.buildArgs(
      'list buckets',
      createSession({ gemini_runtime_allowed_tools: ['aws_search_operations', 'aws_execute'] }),
      'readonly',
      OFF,
    );
    expect(args).toEqual([
      '-p',
      'list buckets',
      '--output-format',
      'stream-json',
      '--sandbox',
      '--allowed-tools',
      'aws_search_operations',
      '--allowed-tools',
      'aws_execute',
    ]);
  });

  it('filters invalid allowed-tools values', () => {
    const driver = new GeminiDriver();
    const args = driver.buildArgs(
      'list buckets',
      createSession({
        gemini_runtime_allowed_tools: [
          '',
          '   ',
          'aws_execute',
          'aws execute',
          'mcp__aws-api__*',
          123,
        ],
      }),
      'readonly',
      OFF,
    );
    expect(args).toEqual([
      '-p',
      'list buckets',
      '--output-format',
      'stream-json',
      '--sandbox',
      '--allowed-tools',
      'aws_execute',
      // mcp__aws-api__* is stripped by readonly defense-in-depth
    ]);
  });

  it('does NOT add mcp_* glob in readonly mode even with autoApproveEnabled', () => {
    const driver = new GeminiDriver();
    const args = driver.buildArgs('hello', createSession({}), 'readonly', {
      autoApproveEnabled: true,
      skillsEnabled: false,
    });
    expect(args).not.toContain('mcp_*');
    expect(args).not.toContain('mcp__*');
  });

  it('skips --allowed-tools in write mode (yolo covers all tools)', () => {
    const driver = new GeminiDriver();
    const args = driver.buildArgs('hello', createSession({}), 'write', {
      autoApproveEnabled: true,
      skillsEnabled: false,
    });
    expect(args).not.toContain('--allowed-tools');
    expect(args).toContain('--approval-mode');
    expect(args).toContain('yolo');
  });

  it('skips --allowed-tools in write mode even with explicit allowed tools', () => {
    const driver = new GeminiDriver();
    const args = driver.buildArgs(
      'hello',
      createSession({ gemini_runtime_allowed_tools: ['aws_execute', 'mcp_*'] }),
      'write',
      { autoApproveEnabled: true, skillsEnabled: false },
    );
    expect(args).not.toContain('--allowed-tools');
  });

  it('strips MCP tools from readonly even if injected via gemini_runtime_allowed_tools', () => {
    const driver = new GeminiDriver();
    const args = driver.buildArgs(
      'hello',
      createSession({
        gemini_runtime_allowed_tools: ['mcp_my_server', 'mcp__aws__list', 'read_file'],
      }),
      'readonly',
      { autoApproveEnabled: false, skillsEnabled: false },
    );
    // Defense-in-depth: MCP tools stripped in readonly
    expect(args).not.toContain('mcp_my_server');
    expect(args).not.toContain('mcp__aws__list');
    // Non-MCP tools still present
    expect(args).toContain('read_file');
  });
});

describe('GeminiDriver.extractSessionState', () => {
  it('extracts session UUID from init event', () => {
    const driver = new GeminiDriver();
    const events = [
      {
        type: 'status' as const,
        content: 'Session: abc-123',
        raw: { type: 'init', session_id: 'abc-123', model: 'gemini-2.0-flash' },
      },
      { type: 'text' as const, content: 'hello' },
    ];
    expect(driver.extractSessionState(events)).toEqual({
      session_index: 'abc-123',
      gemini_resume_ready: true,
    });
  });

  it('extracts session UUID even when process was killed (no done event)', () => {
    const driver = new GeminiDriver();
    const events = [
      {
        type: 'status' as const,
        content: 'Session: uuid-456',
        raw: { type: 'init', session_id: 'uuid-456', model: 'gemini-2.0-flash' },
      },
      { type: 'tool_use' as const, content: 'Using tool: read_file' },
      // No done event — process was killed
    ];
    expect(driver.extractSessionState(events)).toEqual({
      session_index: 'uuid-456',
      gemini_resume_ready: true,
    });
  });

  it('falls back to latest when done event exists but no init event (legacy CLI)', () => {
    const driver = new GeminiDriver();
    expect(driver.extractSessionState([{ type: 'done', content: '' }])).toEqual({
      session_index: 'latest',
      gemini_resume_ready: true,
    });
  });

  it('returns empty state when no init and no done events', () => {
    const driver = new GeminiDriver();
    expect(driver.extractSessionState([{ type: 'status', content: 'working' }])).toEqual({});
  });
});

describe('GeminiDriver.parseStderr', () => {
  it('maps known MCP/auth discovery noise to status', () => {
    const driver = new GeminiDriver();
    expect(
      driver.parseStderr("MCP server 'aws-api' requires authentication using: /mcp auth aws-api"),
    ).toEqual({
      type: 'status',
      content: "MCP server 'aws-api' requires authentication using: /mcp auth aws-api",
    });
  });

  it('maps warning lines to status with or without Error prefix', () => {
    const driver = new GeminiDriver();
    expect(driver.parseStderr('Error: Loaded cached credentials.')).toEqual({
      type: 'status',
      content: 'Error: Loaded cached credentials.',
    });
    expect(driver.parseStderr('Loading extension: Stitch')).toEqual({
      type: 'status',
      content: 'Loading extension: Stitch',
    });
    expect(driver.parseStderr("Error: Found stored OAuth token for server 'aws-api'")).toEqual({
      type: 'status',
      content: "Error: Found stored OAuth token for server 'aws-api'",
    });
    expect(
      driver.parseStderr(
        'Error: Attempt 1 failed: You have exhausted your capacity on this model. Your quota will reset after 0s.. Retrying after 396.79654ms...',
      ),
    ).toEqual({
      type: 'status',
      content:
        'Error: Attempt 1 failed: You have exhausted your capacity on this model. Your quota will reset after 0s.. Retrying after 396.79654ms...',
    });
    expect(
      driver.parseStderr(
        'Error: Error executing tool aws_execute: Tool execution denied by policy.',
      ),
    ).toEqual({
      type: 'status',
      content: 'Error: Error executing tool aws_execute: Tool execution denied by policy.',
    });
    expect(
      driver.parseStderr(
        'Dynamic client registration is supported at: http://localhost:8000/register',
      ),
    ).toEqual({
      type: 'status',
      content: 'Dynamic client registration is supported at: http://localhost:8000/register',
    });
  });

  it('maps combined MCP discovery warning chunks to status', () => {
    const driver = new GeminiDriver();
    expect(
      driver.parseStderr(
        "Error during discovery for MCP server 'blender': MCP error -32000: Connection closed🔍 Attempting OAuth discovery for 'aws-api'...",
      ),
    ).toEqual({
      type: 'status',
      content:
        "Error during discovery for MCP server 'blender': MCP error -32000: Connection closed🔍 Attempting OAuth discovery for 'aws-api'...",
    });
  });

  it('maps strict allowUnionTypes warnings to status', () => {
    const driver = new GeminiDriver();
    expect(
      driver.parseStderr(
        'strict mode: use allowUnionTypes to allow union type keyword at "#/properties/payload" (strictTypes)',
      ),
    ).toEqual({
      type: 'status',
      content:
        'strict mode: use allowUnionTypes to allow union type keyword at "#/properties/payload" (strictTypes)',
    });
  });

  it('maps --allowed-tools deprecation warning to status', () => {
    const driver = new GeminiDriver();
    expect(
      driver.parseStderr(
        'Warning: --allowed-tools cli argument and tools.allowed in settings.json are deprecated and will be removed in 1.0: Migrate to Policy Engine: https://geminicli.com/docs/core/policy-engine/',
      ),
    ).toEqual({
      type: 'status',
      content:
        'Warning: --allowed-tools cli argument and tools.allowed in settings.json are deprecated and will be removed in 1.0: Migrate to Policy Engine: https://geminicli.com/docs/core/policy-engine/',
    });
  });

  it('maps [MCP error] prefixed discovery errors to status', () => {
    const driver = new GeminiDriver();
    expect(
      driver.parseStderr(
        "Error: [MCP error] Error during discovery for MCP server 'awsapi': MCP error -32000: Connection closed",
      ),
    ).toEqual({
      type: 'status',
      content:
        "Error: [MCP error] Error during discovery for MCP server 'awsapi': MCP error -32000: Connection closed",
    });
  });

  it('maps MCP error stack trace lines to status', () => {
    const driver = new GeminiDriver();
    const stackLines = [
      'Error: at McpError.fromError (file:///opt/homebrew/lib/node_modules/@google/gemini-cli/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js:2035:16)',
      'Error: at Client._onclose (file:///opt/homebrew/lib/node_modules/@google/gemini-cli/node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js:259:32)',
      'Error: at ChildProcess.emit (node:events:508:28)',
    ];
    for (const line of stackLines) {
      expect(driver.parseStderr(line)).toEqual({
        type: 'status',
        content: line,
      });
    }
  });

  it('maps McpError class and error object fragments to status', () => {
    const driver = new GeminiDriver();
    expect(driver.parseStderr('Error: McpError: MCP error -32000: Connection closed')).toEqual({
      type: 'status',
      content: 'Error: McpError: MCP error -32000: Connection closed',
    });
    expect(driver.parseStderr('Error: code: -32000,')).toEqual({
      type: 'status',
      content: 'Error: code: -32000,',
    });
    expect(driver.parseStderr('Error: data: undefined')).toEqual({
      type: 'status',
      content: 'Error: data: undefined',
    });
    expect(driver.parseStderr('Error: }')).toEqual({
      type: 'status',
      content: 'Error: }',
    });
  });

  it('does not suppress lines that merely start with "at " without stack trace format', () => {
    const driver = new GeminiDriver();
    expect(driver.parseStderr('Error: at least one argument is required')).toEqual({
      type: 'error',
      content: 'Error: at least one argument is required',
    });
  });

  it('does not suppress data lines with actual values', () => {
    const driver = new GeminiDriver();
    expect(driver.parseStderr('Error: data: {"error":"rate_limited"}')).toEqual({
      type: 'error',
      content: 'Error: data: {"error":"rate_limited"}',
    });
  });

  it('keeps fatal authentication failures as error', () => {
    const driver = new GeminiDriver();
    expect(driver.parseStderr('Error authenticating: FatalAuthenticationError')).toEqual({
      type: 'error',
      content: 'Error authenticating: FatalAuthenticationError',
    });
  });

  it('handles empty and JSON stderr branches', () => {
    const driver = new GeminiDriver();
    expect(driver.parseStderr('')).toBeNull();
    expect(
      driver.parseStderr(
        JSON.stringify({
          type: 'result',
          status: 'success',
        }),
      ),
    ).toEqual({
      type: 'done',
      content: '',
      raw: {
        type: 'result',
        status: 'success',
      },
    });
    expect(driver.parseStderr('{"type":"unknown"}')).toEqual({
      type: 'error',
      content: '{"type":"unknown"}',
    });
  });
});

describe('GeminiDriver.buildCommand', () => {
  it('uses GEMINI_COMMAND override when provided', () => {
    process.env.GEMINI_COMMAND = '/opt/custom/gemini';
    const driver = new GeminiDriver();
    expect(driver.buildCommand()).toBe('/opt/custom/gemini');
    expect(driver.getCommandPrefixArgs()).toEqual([]);
  });

  it('uses GEMINI_BIN when GEMINI_COMMAND is not set', () => {
    delete process.env.GEMINI_COMMAND;
    process.env.GEMINI_BIN = '/usr/local/bin/gemini';
    const driver = new GeminiDriver();
    expect(driver.buildCommand()).toBe('/usr/local/bin/gemini');
    expect(driver.getCommandPrefixArgs()).toEqual([]);
  });

  it('prefers GEMINI_COMMAND over GEMINI_BIN', () => {
    process.env.GEMINI_COMMAND = '/opt/custom/gemini';
    process.env.GEMINI_BIN = '/usr/local/bin/gemini';
    const driver = new GeminiDriver();
    expect(driver.buildCommand()).toBe('/opt/custom/gemini');
    expect(driver.getCommandPrefixArgs()).toEqual([]);
  });

  it('treats literal "undefined" and "null" as unset overrides', () => {
    process.env.GEMINI_COMMAND = 'undefined';
    process.env.GEMINI_BIN = '/tmp/bin/gemini';
    const driverFromUndefined = new GeminiDriver();
    expect(driverFromUndefined.buildCommand()).toBe('/tmp/bin/gemini');
    expect(driverFromUndefined.getCommandPrefixArgs()).toEqual([]);

    process.env.GEMINI_COMMAND = 'null';
    process.env.GEMINI_BIN = '/tmp/bin/gemini-null';
    const driverFromNull = new GeminiDriver();
    expect(driverFromNull.buildCommand()).toBe('/tmp/bin/gemini-null');
    expect(driverFromNull.getCommandPrefixArgs()).toEqual([]);
  });
});

describe('GeminiDriver.parseEvent', () => {
  it('extracts assistant text from stream-json message events', () => {
    const driver = new GeminiDriver();
    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'message',
          timestamp: '2026-02-13T18:20:00.000Z',
          role: 'assistant',
          content: 'what can i help you?',
          delta: true,
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'what can i help you?',
      raw: {
        type: 'message',
        timestamp: '2026-02-13T18:20:00.000Z',
        role: 'assistant',
        content: 'what can i help you?',
        delta: true,
      },
    });
  });

  it('maps stream-json result success to done', () => {
    const driver = new GeminiDriver();
    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'result',
          timestamp: '2026-02-13T18:20:00.000Z',
          status: 'success',
        }),
      ),
    ).toEqual({
      type: 'done',
      content: '',
      raw: {
        type: 'result',
        timestamp: '2026-02-13T18:20:00.000Z',
        status: 'success',
      },
    });
  });

  it('extracts response text from result event (flat content string)', () => {
    const driver = new GeminiDriver();
    const result = driver.parseEvent(
      JSON.stringify({
        type: 'result',
        status: 'success',
        content: '<summary>\n## Overview\nAll tasks completed.\n</summary>',
      }),
    );
    expect(result).toEqual({
      type: 'text',
      content: '<summary>\n## Overview\nAll tasks completed.\n</summary>',
      raw: expect.objectContaining({ type: 'result', status: 'success' }),
    });
  });

  it('extracts response text from result event (nested response.content)', () => {
    const driver = new GeminiDriver();
    const result = driver.parseEvent(
      JSON.stringify({
        type: 'result',
        status: 'success',
        response: { content: 'Final answer text' },
      }),
    );
    expect(result).toEqual({
      type: 'text',
      content: 'Final answer text',
      raw: expect.objectContaining({ type: 'result', status: 'success' }),
    });
  });

  it('maps stream-json warning error to status', () => {
    const driver = new GeminiDriver();
    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'error',
          timestamp: '2026-02-13T18:20:00.000Z',
          severity: 'warning',
          message: 'Loop detected, stopping execution',
        }),
      ),
    ).toEqual({
      type: 'status',
      content: 'Loop detected, stopping execution',
      raw: {
        type: 'error',
        timestamp: '2026-02-13T18:20:00.000Z',
        severity: 'warning',
        message: 'Loop detected, stopping execution',
      },
    });
  });

  it('maps init event to status with session_id in raw', () => {
    const driver = new GeminiDriver();
    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'init',
          timestamp: '2026-02-13T18:20:00.000Z',
          session_id: '118cea8e-191d-4238-96cd-43980cf13a9d',
          model: 'gemini-2.0-flash-exp',
        }),
      ),
    ).toEqual({
      type: 'status',
      content: 'Session: 118cea8e-191d-4238-96cd-43980cf13a9d',
      raw: {
        type: 'init',
        timestamp: '2026-02-13T18:20:00.000Z',
        session_id: '118cea8e-191d-4238-96cd-43980cf13a9d',
        model: 'gemini-2.0-flash-exp',
      },
    });
  });

  it('handles init event without session_id', () => {
    const driver = new GeminiDriver();
    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'init',
          timestamp: '2026-02-13T18:20:00.000Z',
          model: 'gemini-2.0-flash-exp',
        }),
      ),
    ).toEqual({
      type: 'status',
      content: 'Session: unknown',
      raw: {
        type: 'init',
        timestamp: '2026-02-13T18:20:00.000Z',
        model: 'gemini-2.0-flash-exp',
      },
    });
  });

  it('handles additional parseEvent branches', () => {
    const driver = new GeminiDriver();
    expect(driver.parseEvent('')).toBeNull();
    // Non-JSON stdout is CLI noise in stream-json mode — discarded
    expect(driver.parseEvent('not json')).toBeNull();

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'message',
          role: 'user',
          content: 'ignored',
        }),
      ),
    ).toBeNull();

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'tool_use',
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      content: 'Using tool: unknown',
      raw: {
        type: 'tool_use',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'tool_result',
          error: { message: 'tool failed' },
        }),
      ),
    ).toEqual({
      type: 'tool_result',
      content: 'tool failed',
      raw: {
        type: 'tool_result',
        error: { message: 'tool failed' },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'result',
          status: 'error',
        }),
      ),
    ).toEqual({
      type: 'error',
      content: 'Unknown error',
      raw: {
        type: 'result',
        status: 'error',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'error',
          message: 'fatal',
        }),
      ),
    ).toEqual({
      type: 'error',
      content: 'fatal',
      raw: {
        type: 'error',
        message: 'fatal',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'partialResponse',
          text: 'partial',
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'partial',
      raw: {
        type: 'partialResponse',
        text: 'partial',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'toolCall',
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      content: 'Using tool: unknown',
      raw: {
        type: 'toolCall',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'toolResult',
        }),
      ),
    ).toEqual({
      type: 'tool_result',
      content: '',
      raw: {
        type: 'toolResult',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'end',
        }),
      ),
    ).toEqual({
      type: 'done',
      content: '',
      raw: {
        type: 'end',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'misc',
          parts: [{ text: 'a' }, { text: 'b' }],
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'a\nb',
      raw: {
        type: 'misc',
        parts: [{ text: 'a' }, { text: 'b' }],
      },
    });

    expect(driver.parseEvent(JSON.stringify({ type: 'misc' }))).toBeNull();
  });

  it('covers remaining parseEvent nullish branches', () => {
    const driver = new GeminiDriver();

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'tool_result',
          output: 'ok',
          error: { message: 'ignored' },
        }),
      ),
    ).toEqual({
      type: 'tool_result',
      content: 'ok',
      raw: {
        type: 'tool_result',
        output: 'ok',
        error: { message: 'ignored' },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'tool_result',
        }),
      ),
    ).toEqual({
      type: 'tool_result',
      content: '',
      raw: {
        type: 'tool_result',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'result',
          status: 'error',
          error: { message: 'boom' },
        }),
      ),
    ).toEqual({
      type: 'error',
      content: 'boom',
      raw: {
        type: 'result',
        status: 'error',
        error: { message: 'boom' },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'error',
          severity: 'warning',
        }),
      ),
    ).toEqual({
      type: 'status',
      content: '',
      raw: {
        type: 'error',
        severity: 'warning',
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
      raw: {
        type: 'error',
      },
    });
  });

  it('discards non-JSON CLI noise from stdout', () => {
    const driver = new GeminiDriver();
    expect(driver.parseEvent('MCP issues detected. Run /mcp list for status.')).toBeNull();
    expect(driver.parseEvent('Loading extension: @anthropic/extension')).toBeNull();
    expect(driver.parseEvent('some random startup message')).toBeNull();
  });

  it('extracts embedded JSON from lines with noise prefix', () => {
    const driver = new GeminiDriver();
    const initJson = JSON.stringify({
      type: 'init',
      timestamp: '2026-03-08T19:09:47.038Z',
      session_id: '6a06aa5b-e532-4572-84c5-86b39a525d7e',
      model: 'auto-gemini-3',
    });
    const noisyLine = `MCP issues detected. Run /mcp list for status.${initJson}`;
    const result = driver.parseEvent(noisyLine);
    expect(result).toEqual({
      type: 'status',
      content: 'Session: 6a06aa5b-e532-4572-84c5-86b39a525d7e',
      raw: {
        type: 'init',
        timestamp: '2026-03-08T19:09:47.038Z',
        session_id: '6a06aa5b-e532-4572-84c5-86b39a525d7e',
        model: 'auto-gemini-3',
      },
    });
  });

  it('discards noise prefix with invalid embedded JSON', () => {
    const driver = new GeminiDriver();
    expect(driver.parseEvent('noise prefix {invalid json}')).toBeNull();
  });

  it('extracts embedded JSON even when noise prefix contains braces', () => {
    const driver = new GeminiDriver();
    const initJson = JSON.stringify({
      type: 'init',
      timestamp: '2026-03-08T19:09:47.038Z',
      session_id: 'session-xyz',
      model: 'auto-gemini-3',
    });
    // Noise prefix contains '{' that is not the start of valid JSON
    const noisyLine = `Error in {module}: connection failed${initJson}`;
    const result = driver.parseEvent(noisyLine);
    expect(result).toEqual({
      type: 'status',
      content: 'Session: session-xyz',
      raw: {
        type: 'init',
        timestamp: '2026-03-08T19:09:47.038Z',
        session_id: 'session-xyz',
        model: 'auto-gemini-3',
      },
    });
  });
});

describe('GeminiDriver.buildEnv', () => {
  it('passes through runtime env vars', () => {
    const originalPath = process.env.PATH;
    const originalHome = process.env.HOME;
    const originalGeminiApiKey = process.env.GEMINI_API_KEY;
    const originalGoogleApiKey = process.env.GOOGLE_API_KEY;
    const originalGeminiCliHome = process.env.GEMINI_CLI_HOME;
    const originalGeminiMcpConfigPath = process.env.GEMINI_MCP_CONFIG_PATH;

    process.env.PATH = '/usr/bin';
    process.env.HOME = '/tmp/home';
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.GOOGLE_API_KEY = 'google-key';
    process.env.GEMINI_CLI_HOME = '/tmp/gemini-home';
    process.env.GEMINI_MCP_CONFIG_PATH = '/tmp/gemini-settings.json';

    try {
      const driver = new GeminiDriver();
      const env = driver.buildEnv();
      expect(env.PATH).toBe('/usr/bin');
      expect(env.HOME).toBe('/tmp/home');
      expect(env.GEMINI_API_KEY).toBe('gemini-key');
      expect(env.GOOGLE_API_KEY).toBe('google-key');
      expect(env.GEMINI_CLI_HOME).toBe('/tmp/gemini-home');
      expect(env.GEMINI_MCP_CONFIG_PATH).toBeUndefined();
    } finally {
      process.env.PATH = originalPath;
      process.env.HOME = originalHome;
      if (originalGeminiApiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = originalGeminiApiKey;
      if (originalGoogleApiKey === undefined) delete process.env.GOOGLE_API_KEY;
      else process.env.GOOGLE_API_KEY = originalGoogleApiKey;
      if (originalGeminiCliHome === undefined) delete process.env.GEMINI_CLI_HOME;
      else process.env.GEMINI_CLI_HOME = originalGeminiCliHome;
      if (originalGeminiMcpConfigPath === undefined) delete process.env.GEMINI_MCP_CONFIG_PATH;
      else process.env.GEMINI_MCP_CONFIG_PATH = originalGeminiMcpConfigPath;
    }
  });

  it('does NOT include cloud provider env vars (forwarded by job-executor based on policy)', () => {
    const origAzure = process.env.AZURE_TENANT_ID;
    process.env.AZURE_TENANT_ID = 'test-tenant';
    try {
      const driver = new GeminiDriver();
      const env = driver.buildEnv();
      expect(env.AZURE_TENANT_ID).toBeUndefined();
    } finally {
      if (origAzure === undefined) delete process.env.AZURE_TENANT_ID;
      else process.env.AZURE_TENANT_ID = origAzure;
    }
  });
});
