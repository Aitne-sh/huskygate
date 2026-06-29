import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from '../session/types.js';
import { ClaudeDriver } from './driver-claude.js';
import type { DriverBuildOptions } from './types.js';

const OFF: DriverBuildOptions = { autoApproveEnabled: false, skillsEnabled: false };

function createSession(toolState: Record<string, unknown>): Session {
  return {
    sessionKey: 'C1:123.456',
    tool: 'claude',
    mode: 'readonly',
    modeExpiresAt: null,
    toolState,
    workdir: '/tmp/workdir',
    runningJobId: null,
    updatedAt: new Date().toISOString(),
    devAlias: null,
  };
}

const originalClaudeCommand = process.env.CLAUDE_COMMAND;
const originalClaudeBin = process.env.CLAUDE_BIN;
const originalReadonlyPermissionMode = process.env.CLAUDE_READONLY_PERMISSION_MODE;
const originalClaudeModel = process.env.CLAUDE_MODEL;

afterEach(() => {
  if (originalClaudeCommand === undefined) {
    delete process.env.CLAUDE_COMMAND;
  } else {
    process.env.CLAUDE_COMMAND = originalClaudeCommand;
  }
  if (originalClaudeBin === undefined) {
    delete process.env.CLAUDE_BIN;
  } else {
    process.env.CLAUDE_BIN = originalClaudeBin;
  }
  if (originalReadonlyPermissionMode === undefined) {
    delete process.env.CLAUDE_READONLY_PERMISSION_MODE;
  } else {
    process.env.CLAUDE_READONLY_PERMISSION_MODE = originalReadonlyPermissionMode;
  }
  if (originalClaudeModel === undefined) {
    delete process.env.CLAUDE_MODEL;
  } else {
    process.env.CLAUDE_MODEL = originalClaudeModel;
  }
});

describe('ClaudeDriver.buildArgs', () => {
  it('uses default permission mode in readonly by default', () => {
    delete process.env.CLAUDE_READONLY_PERMISSION_MODE;
    const driver = new ClaudeDriver();
    const args = driver.buildArgs(
      'hello',
      createSession({ session_id: 'sess_123' }),
      'readonly',
      OFF,
    );
    const modeIdx = args.indexOf('--permission-mode');
    expect(modeIdx).toBeGreaterThan(-1);
    expect(args[modeIdx + 1]).toBe('default');
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe('sess_123');
  });

  it('supports readonly plan mode via CLAUDE_READONLY_PERMISSION_MODE', () => {
    process.env.CLAUDE_READONLY_PERMISSION_MODE = 'plan';
    const driver = new ClaudeDriver();
    const args = driver.buildArgs(
      'hello',
      createSession({ session_id: 'sess_123' }),
      'readonly',
      OFF,
    );
    const modeIdx = args.indexOf('--permission-mode');
    expect(modeIdx).toBeGreaterThan(-1);
    expect(args[modeIdx + 1]).toBe('plan');
  });

  it('passes through validated --setting-sources overrides', () => {
    const driver = new ClaudeDriver();
    const args = driver.buildArgs(
      'hello',
      createSession({ session_id: 'sess_123', claude_setting_sources: ' user , local , user ' }),
      'readonly',
      OFF,
    );
    const idx = args.indexOf('--setting-sources');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('user,local');
  });

  it('falls back to project for invalid --setting-sources overrides', () => {
    const driver = new ClaudeDriver();
    const args = driver.buildArgs(
      'hello',
      createSession({ session_id: 'sess_123', claude_setting_sources: 'user,bad-source' }),
      'readonly',
      OFF,
    );
    const idx = args.indexOf('--setting-sources');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('project');
  });

  it('falls back to project for empty --setting-sources overrides after trimming', () => {
    const driver = new ClaudeDriver();
    const args = driver.buildArgs(
      'hello',
      createSession({ session_id: 'sess_123', claude_setting_sources: ' ,  , ' }),
      'readonly',
      OFF,
    );
    const idx = args.indexOf('--setting-sources');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('project');
  });

  it('passes generated MCP config via strict CLI flags when provided', () => {
    const driver = new ClaudeDriver();
    const args = driver.buildArgs('hello', createSession({ session_id: 'sess_123' }), 'write', {
      ...OFF,
      mcpConfigPath: '/tmp/work/.huskygate/claude.mcp.json',
    });
    expect(args.slice(0, 3)).toEqual([
      '--mcp-config',
      '/tmp/work/.huskygate/claude.mcp.json',
      '--strict-mcp-config',
    ]);
  });

  it('always includes default tools and merges user tools with deduplication', () => {
    const driver = new ClaudeDriver();
    const args = driver.buildArgs(
      'run',
      createSession({ claude_runtime_allowed_tools: ['Bash(git:*)', 'Edit', 'Edit'] }),
      'write',
      OFF,
    );
    const toolFlags: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--allowed-tools') {
        const next = args[i + 1];
        if (next !== undefined) {
          toolFlags.push(next);
          i++;
        }
      }
    }
    expect(toolFlags).toContain('Write');
    expect(toolFlags).toContain('Edit');
    expect(toolFlags).toContain('Bash');
    expect(toolFlags).toContain('Read');
    expect(toolFlags).toContain('Bash(git:*)');
    // Deduplication: Edit appears only once despite being in both default and user lists
    expect(toolFlags.filter((t) => t === 'Edit')).toHaveLength(1);
  });

  it('restricts to readonly tools in readonly mode (no Write/Edit/Bash/NotebookEdit)', () => {
    const driver = new ClaudeDriver();
    const args = driver.buildArgs('run', createSession({}), 'readonly', OFF);
    const toolFlags: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--allowed-tools') {
        const next = args[i + 1];
        if (next !== undefined) {
          toolFlags.push(next);
          i++;
        }
      }
    }
    // Readonly mode: only read-safe tools pre-approved
    expect(toolFlags).toContain('Read');
    expect(toolFlags).toContain('Glob');
    expect(toolFlags).toContain('Grep');
    expect(toolFlags).toContain('WebFetch');
    expect(toolFlags).toContain('WebSearch');
    expect(toolFlags).toContain('Task');
    // Mutation tools must NOT be included
    expect(toolFlags).not.toContain('Write');
    expect(toolFlags).not.toContain('Edit');
    expect(toolFlags).not.toContain('Bash');
    expect(toolFlags).not.toContain('NotebookEdit');
  });

  it('includes all tools (including Write/Edit/Bash/NotebookEdit) in write mode', () => {
    const driver = new ClaudeDriver();
    const args = driver.buildArgs('run', createSession({}), 'write', OFF);
    const toolFlags: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--allowed-tools') {
        const next = args[i + 1];
        if (next !== undefined) {
          toolFlags.push(next);
          i++;
        }
      }
    }
    expect(toolFlags).toContain('Read');
    expect(toolFlags).toContain('Write');
    expect(toolFlags).toContain('Edit');
    expect(toolFlags).toContain('Bash');
    expect(toolFlags).toContain('Glob');
    expect(toolFlags).toContain('Grep');
    expect(toolFlags).toContain('WebFetch');
    expect(toolFlags).toContain('WebSearch');
    expect(toolFlags).toContain('Task');
    expect(toolFlags).toContain('NotebookEdit');
    expect(toolFlags).toContain('Agent');
  });

  it('strips write tools and MCP tools from readonly even if injected via runtime_allowed_tools', () => {
    const driver = new ClaudeDriver();
    const args = driver.buildArgs(
      'run',
      createSession({
        claude_runtime_allowed_tools: ['Bash', 'mcp__aws-api__list_buckets', 'Skill'],
      }),
      'readonly',
      OFF,
    );
    const toolFlags: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--allowed-tools') {
        const next = args[i + 1];
        if (next !== undefined) {
          toolFlags.push(next);
          i++;
        }
      }
    }
    // Defense-in-depth: all dangerous tools stripped in readonly
    expect(toolFlags).not.toContain('Bash');
    expect(toolFlags).not.toContain('Write');
    expect(toolFlags).not.toContain('Edit');
    expect(toolFlags).not.toContain('NotebookEdit');
    expect(toolFlags).not.toContain('mcp__aws-api__list_buckets');
    expect(toolFlags).not.toContain('Skill');
    // Read tools still present
    expect(toolFlags).toContain('Read');
    expect(toolFlags).toContain('Glob');
    expect(toolFlags).toContain('Grep');
  });

  it('falls back to default for unrecognized CLAUDE_READONLY_PERMISSION_MODE values', () => {
    process.env.CLAUDE_READONLY_PERMISSION_MODE = 'invalid_value';
    const driver = new ClaudeDriver();
    const args = driver.buildArgs(
      'hello',
      createSession({ session_id: 'sess_123' }),
      'readonly',
      OFF,
    );
    const modeIdx = args.indexOf('--permission-mode');
    expect(modeIdx).toBeGreaterThan(-1);
    expect(args[modeIdx + 1]).toBe('default');
  });

  it('creates a new session id when state has none', () => {
    const driver = new ClaudeDriver();
    const args = driver.buildArgs('hello', createSession({}), 'write', OFF);
    expect(args).toContain('--session-id');
    expect(args).not.toContain('--resume');
    const permissionIdx = args.indexOf('--permission-mode');
    expect(args[permissionIdx + 1]).toBe('default');
  });

  it('does not include --model when no model is configured', () => {
    delete process.env.CLAUDE_MODEL;
    const driver = new ClaudeDriver();
    const args = driver.buildArgs('hello', createSession({}), 'write', OFF);
    expect(args).not.toContain('--model');
  });

  it('includes --model from toolState.model', () => {
    delete process.env.CLAUDE_MODEL;
    const driver = new ClaudeDriver();
    const args = driver.buildArgs(
      'hello',
      createSession({ model: 'claude-opus-4-6' }),
      'write',
      OFF,
    );
    const idx = args.indexOf('--model');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('claude-opus-4-6');
  });

  it('includes --model from CLAUDE_MODEL env when toolState has no model', () => {
    process.env.CLAUDE_MODEL = 'claude-sonnet-4-6';
    const driver = new ClaudeDriver();
    const args = driver.buildArgs('hello', createSession({}), 'write', OFF);
    const idx = args.indexOf('--model');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('claude-sonnet-4-6');
  });

  it('toolState.model overrides CLAUDE_MODEL env', () => {
    process.env.CLAUDE_MODEL = 'claude-sonnet-4-6';
    const driver = new ClaudeDriver();
    const args = driver.buildArgs('hello', createSession({ model: 'opus' }), 'write', OFF);
    const idx = args.indexOf('--model');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('opus');
  });

  it('does not include --model when toolState.model is "default"', () => {
    delete process.env.CLAUDE_MODEL;
    const driver = new ClaudeDriver();
    const args = driver.buildArgs('hello', createSession({ model: 'default' }), 'write', OFF);
    expect(args).not.toContain('--model');
  });

  it('does not include --model when CLAUDE_MODEL env is "default"', () => {
    process.env.CLAUDE_MODEL = 'default';
    const driver = new ClaudeDriver();
    const args = driver.buildArgs('hello', createSession({}), 'write', OFF);
    expect(args).not.toContain('--model');
  });

  it('filters invalid custom allowed tools in write mode', () => {
    const driver = new ClaudeDriver();
    const args = driver.buildArgs(
      'run',
      createSession({
        claude_runtime_allowed_tools: ['   ', 'Bash(git:*)', 'bad tool name', 'Read', 123],
      }),
      'write',
      OFF,
    );
    const toolFlags: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--allowed-tools') {
        const next = args[i + 1];
        if (next) {
          toolFlags.push(next);
          i++;
        }
      }
    }
    expect(toolFlags).toContain('Bash(git:*)');
    expect(toolFlags).not.toContain('bad tool name');
  });

  it('strips non-readonly tools from custom allowed tools in readonly mode', () => {
    const driver = new ClaudeDriver();
    const args = driver.buildArgs(
      'run',
      createSession({
        claude_runtime_allowed_tools: ['Bash(git:*)', 'Read', 'mcp__myserver__tool'],
      }),
      'readonly',
      OFF,
    );
    const toolFlags: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--allowed-tools') {
        const next = args[i + 1];
        if (next) {
          toolFlags.push(next);
          i++;
        }
      }
    }
    expect(toolFlags).toContain('Read');
    expect(toolFlags).not.toContain('Bash(git:*)');
    expect(toolFlags).not.toContain('mcp__myserver__tool');
  });

  it('adds mcp__* glob when autoApproveEnabled is true in write mode', () => {
    const driver = new ClaudeDriver();
    const args = driver.buildArgs('hello', createSession({}), 'write', {
      autoApproveEnabled: true,
      skillsEnabled: false,
    });
    expect(args).toContain('--allowed-tools');
    expect(args).toContain('mcp__*');
  });

  it('does NOT add mcp__* glob when allowMcp is false even with autoApproveEnabled', () => {
    const driver = new ClaudeDriver();
    const args = driver.buildArgs('hello', createSession({}), 'write', {
      autoApproveEnabled: true,
      skillsEnabled: false,
      allowMcp: false,
    });
    expect(args).not.toContain('mcp__*');
  });

  it('adds mcp__* glob when allowMcp is undefined (backward compat)', () => {
    const driver = new ClaudeDriver();
    const args = driver.buildArgs('hello', createSession({}), 'write', {
      autoApproveEnabled: true,
      skillsEnabled: false,
    });
    expect(args).toContain('mcp__*');
  });

  it('does NOT add mcp__* glob in readonly mode even with autoApproveEnabled', () => {
    const driver = new ClaudeDriver();
    const args = driver.buildArgs('hello', createSession({}), 'readonly', {
      autoApproveEnabled: true,
      skillsEnabled: false,
    });
    expect(args).not.toContain('mcp__*');
  });

  it('adds Skill to allowed tools when skillsEnabled is true', () => {
    const driver = new ClaudeDriver();
    const args = driver.buildArgs('hello', createSession({}), 'write', {
      autoApproveEnabled: false,
      skillsEnabled: true,
    });
    const toolFlags: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--allowed-tools') {
        const next = args[i + 1];
        if (next !== undefined) {
          toolFlags.push(next);
          i++;
        }
      }
    }
    expect(toolFlags).toContain('Skill');
    expect(toolFlags).not.toContain('mcp__*');
  });

  it('does not add Skill when skillsEnabled is false', () => {
    const driver = new ClaudeDriver();
    const args = driver.buildArgs('hello', createSession({}), 'write', OFF);
    const toolFlags: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--allowed-tools') {
        const next = args[i + 1];
        if (next !== undefined) {
          toolFlags.push(next);
          i++;
        }
      }
    }
    expect(toolFlags).not.toContain('Skill');
  });

  it('does not add Skill in readonly even when skillsEnabled is true', () => {
    const driver = new ClaudeDriver();
    const args = driver.buildArgs('hello', createSession({}), 'readonly', {
      autoApproveEnabled: false,
      skillsEnabled: true,
    });
    expect(args).not.toContain('Skill');
  });
});

describe('ClaudeDriver.buildCommand', () => {
  it('uses CLAUDE_COMMAND when provided', () => {
    process.env.CLAUDE_COMMAND = '/opt/homebrew/bin/claude';
    delete process.env.CLAUDE_BIN;
    const driver = new ClaudeDriver();
    expect(driver.buildCommand()).toBe('/opt/homebrew/bin/claude');
  });

  it('uses CLAUDE_BIN when CLAUDE_COMMAND is not set', () => {
    delete process.env.CLAUDE_COMMAND;
    process.env.CLAUDE_BIN = '/Users/shuto/.local/bin/claude';
    const driver = new ClaudeDriver();
    expect(driver.buildCommand()).toBe('/Users/shuto/.local/bin/claude');
  });

  it('treats literal "undefined" and "null" as unset overrides', () => {
    process.env.CLAUDE_COMMAND = 'undefined';
    process.env.CLAUDE_BIN = '/tmp/bin/claude';
    const driverFromUndefined = new ClaudeDriver();
    expect(driverFromUndefined.buildCommand()).toBe('/tmp/bin/claude');

    process.env.CLAUDE_COMMAND = 'null';
    process.env.CLAUDE_BIN = '/tmp/bin/claude-null';
    const driverFromNull = new ClaudeDriver();
    expect(driverFromNull.buildCommand()).toBe('/tmp/bin/claude-null');
  });
});

describe('ClaudeDriver.buildEnv', () => {
  it('passes through macOS auth/session env needed by claude', () => {
    const originalSecuritySessionId = process.env.SECURITYSESSIONID;
    const originalSshAuthSock = process.env.SSH_AUTH_SOCK;
    const originalSshAgentPid = process.env.SSH_AGENT_PID;
    const originalTermProgram = process.env.TERM_PROGRAM;

    process.env.SECURITYSESSIONID = 'test-session';
    process.env.SSH_AUTH_SOCK = '/tmp/test.sock';
    process.env.SSH_AGENT_PID = '12345';
    process.env.TERM_PROGRAM = 'Apple_Terminal';

    try {
      const driver = new ClaudeDriver();
      const env = driver.buildEnv();
      expect(env.SECURITYSESSIONID).toBe('test-session');
      expect(env.SSH_AUTH_SOCK).toBe('/tmp/test.sock');
      expect(env.SSH_AGENT_PID).toBe('12345');
      expect(env.TERM_PROGRAM).toBe('Apple_Terminal');
    } finally {
      if (originalSecuritySessionId === undefined) {
        delete process.env.SECURITYSESSIONID;
      } else {
        process.env.SECURITYSESSIONID = originalSecuritySessionId;
      }
      if (originalSshAuthSock === undefined) {
        delete process.env.SSH_AUTH_SOCK;
      } else {
        process.env.SSH_AUTH_SOCK = originalSshAuthSock;
      }
      if (originalSshAgentPid === undefined) {
        delete process.env.SSH_AGENT_PID;
      } else {
        process.env.SSH_AGENT_PID = originalSshAgentPid;
      }
      if (originalTermProgram === undefined) {
        delete process.env.TERM_PROGRAM;
      } else {
        process.env.TERM_PROGRAM = originalTermProgram;
      }
    }
  });

  it('includes anthropic and runtime flags when set', () => {
    const originalAnthropic = process.env.ANTHROPIC_API_KEY;
    const originalAnthropicAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
    const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    const originalBedrock = process.env.CLAUDE_CODE_USE_BEDROCK;
    const originalVertex = process.env.CLAUDE_CODE_USE_VERTEX;
    const originalClaudeMcpConfigPath = process.env.CLAUDE_MCP_CONFIG_PATH;

    process.env.ANTHROPIC_API_KEY = 'anthropic-key';
    process.env.ANTHROPIC_AUTH_TOKEN = 'anthropic-auth-token';
    process.env.CLAUDE_CONFIG_DIR = '/tmp/claude-config';
    process.env.CLAUDE_CODE_USE_BEDROCK = '1';
    process.env.CLAUDE_CODE_USE_VERTEX = '1';
    process.env.CLAUDE_MCP_CONFIG_PATH = '/tmp/claude-mcp.json';

    try {
      const driver = new ClaudeDriver();
      const env = driver.buildEnv();
      expect(env.ANTHROPIC_API_KEY).toBe('anthropic-key');
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('anthropic-auth-token');
      expect(env.CLAUDE_CONFIG_DIR).toBe('/tmp/claude-config');
      expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1');
      expect(env.CLAUDE_CODE_USE_VERTEX).toBe('1');
      expect(env.CLAUDE_MCP_CONFIG_PATH).toBeUndefined();
    } finally {
      if (originalAnthropic === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = originalAnthropic;
      }
      if (originalAnthropicAuthToken === undefined) {
        delete process.env.ANTHROPIC_AUTH_TOKEN;
      } else {
        process.env.ANTHROPIC_AUTH_TOKEN = originalAnthropicAuthToken;
      }
      if (originalClaudeConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
      }
      if (originalBedrock === undefined) {
        delete process.env.CLAUDE_CODE_USE_BEDROCK;
      } else {
        process.env.CLAUDE_CODE_USE_BEDROCK = originalBedrock;
      }
      if (originalVertex === undefined) {
        delete process.env.CLAUDE_CODE_USE_VERTEX;
      } else {
        process.env.CLAUDE_CODE_USE_VERTEX = originalVertex;
      }
      if (originalClaudeMcpConfigPath === undefined) {
        delete process.env.CLAUDE_MCP_CONFIG_PATH;
      } else {
        process.env.CLAUDE_MCP_CONFIG_PATH = originalClaudeMcpConfigPath;
      }
    }
  });

  it('does NOT include cloud provider env vars (forwarded by job-executor based on policy)', () => {
    const origAzure = process.env.AZURE_CLIENT_ID;
    const origAws = process.env.AWS_ACCESS_KEY_ID;
    const origGcp = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    process.env.AZURE_CLIENT_ID = 'azure-test-id';
    process.env.AWS_ACCESS_KEY_ID = 'AKIAEXAMPLE';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/gcp-key.json';

    try {
      const driver = new ClaudeDriver();
      const env = driver.buildEnv();
      expect(env.AZURE_CLIENT_ID).toBeUndefined();
      expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
      expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
    } finally {
      if (origAzure === undefined) delete process.env.AZURE_CLIENT_ID;
      else process.env.AZURE_CLIENT_ID = origAzure;
      if (origAws === undefined) delete process.env.AWS_ACCESS_KEY_ID;
      else process.env.AWS_ACCESS_KEY_ID = origAws;
      if (origGcp === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      else process.env.GOOGLE_APPLICATION_CREDENTIALS = origGcp;
    }
  });
});

describe('ClaudeDriver.parseEvent', () => {
  it('maps error events to Driver error', () => {
    const driver = new ClaudeDriver();
    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'error',
          message: 'Permission denied for tool Bash',
        }),
      ),
    ).toEqual({
      type: 'error',
      content: 'Permission denied for tool Bash',
      raw: {
        type: 'error',
        message: 'Permission denied for tool Bash',
      },
    });
  });

  it('extracts tool_use from unknown JSON schema', () => {
    const driver = new ClaudeDriver();
    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'event',
          item: {
            type: 'tool_use',
            name: 'aws_list_buckets',
            input: { region: 'ap-northeast-1' },
          },
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      content: 'Using tool: aws_list_buckets',
      toolInput: { region: 'ap-northeast-1' },
      raw: {
        type: 'event',
        item: {
          type: 'tool_use',
          name: 'aws_list_buckets',
          input: { region: 'ap-northeast-1' },
        },
      },
    });
  });

  it('falls back to assistant text when event type is unknown', () => {
    const driver = new ClaudeDriver();
    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'event',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Checking the number of buckets.' }],
          },
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'Checking the number of buckets.',
      raw: {
        type: 'event',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Checking the number of buckets.' }],
        },
      },
    });
  });

  it('handles additional stream-json and fallback branches', () => {
    const driver = new ClaudeDriver();

    expect(driver.parseEvent('')).toBeNull();
    expect(driver.parseEvent('plain line')).toEqual({ type: 'text', content: 'plain line' });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '{"x":1}' },
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      content: '{"x":1}',
      raw: {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{"x":1}' },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'content_block_start',
          content_block: { type: 'tool_use', name: 'aws_execute' },
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      raw: {
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'aws_execute' },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'result',
          result: 'final answer',
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'final answer',
      raw: {
        type: 'result',
        result: 'final answer',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'result',
          result: { response: { output: [{ type: 'text', text: 'nested final' }] } },
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'nested final',
      raw: {
        type: 'result',
        result: { response: { output: [{ type: 'text', text: 'nested final' }] } },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'result',
          subtype: 'error_max_turns',
        }),
      ),
    ).toEqual({
      type: 'error',
      content: 'Max turns reached',
      raw: {
        type: 'result',
        subtype: 'error_max_turns',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'tool_use',
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      content: '{"type":"tool_use"}',
      raw: { type: 'tool_use' },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'tool_result',
          output: 'ok',
        }),
      ),
    ).toEqual({
      type: 'tool_result',
      content: 'ok',
      raw: {
        type: 'tool_result',
        output: 'ok',
      },
    });

    expect(driver.parseEvent(JSON.stringify({ type: 'message_start' }))).toBeNull();

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'message_stop',
        }),
      ),
    ).toEqual({
      type: 'done',
      content: '',
      raw: {
        type: 'message_stop',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'delta text' },
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'delta text',
      raw: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'delta text' },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'message_start',
          session_id: 'sess_abc',
        }),
      ),
    ).toEqual({
      type: 'status',
      content: 'session:sess_abc',
      raw: {
        type: 'message_start',
        session_id: 'sess_abc',
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

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'event',
          message: {
            role: 'assistant',
            content: 'assistant plain text',
          },
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'assistant plain text',
      raw: {
        type: 'event',
        message: {
          role: 'assistant',
          content: 'assistant plain text',
        },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'event',
          message: 'direct string',
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'direct string',
      raw: {
        type: 'event',
        message: 'direct string',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'event',
          response: ['line1', 'line2'],
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'line1\nline2',
      raw: {
        type: 'event',
        response: ['line1', 'line2'],
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
          item: {
            type: 'result',
            result: 'nested result',
          },
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'nested result',
      raw: {
        type: 'event',
        item: {
          type: 'result',
          result: 'nested result',
        },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'event',
          delta: {
            type: 'input_json_delta',
            function: { name: 'aws_execute' },
            input: { action: 'invoke' },
          },
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      toolInput: { action: 'invoke' },
      raw: {
        type: 'event',
        delta: {
          type: 'input_json_delta',
          function: { name: 'aws_execute' },
          input: { action: 'invoke' },
        },
      },
    });

    expect(driver.parseEvent(JSON.stringify({ type: 'event' }))).toBeNull();
  });

  it('covers remaining tool extraction and fallback parser branches', () => {
    const driver = new ClaudeDriver();

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'tool_use',
          tool_name: 'aws_execute',
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      raw: {
        type: 'tool_use',
        tool_name: 'aws_execute',
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'tool_result',
          result: 'from-result',
        }),
      ),
    ).toEqual({
      type: 'tool_result',
      content: 'from-result',
      raw: {
        type: 'tool_result',
        result: 'from-result',
      },
    });

    expect(driver.parseEvent(JSON.stringify({ type: 'tool_result' }))).toEqual({
      type: 'tool_result',
      content: '',
      raw: { type: 'tool_result' },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'event',
          item: {
            function: {
              type: 'tool_use',
              name: 'aws_execute',
              arguments: { mode: 'arguments' },
            },
          },
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      toolInput: { mode: 'arguments' },
      raw: {
        type: 'event',
        item: {
          function: {
            type: 'tool_use',
            name: 'aws_execute',
            arguments: { mode: 'arguments' },
          },
        },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'event',
          delta: {
            function: {
              type: 'tool_use',
              name: 'aws_execute',
              args: { mode: 'args' },
            },
          },
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      toolInput: { mode: 'args' },
      raw: {
        type: 'event',
        delta: {
          function: {
            type: 'tool_use',
            name: 'aws_execute',
            args: { mode: 'args' },
          },
        },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'event',
          tool_use: {
            function: {
              type: 'tool_use',
              name: 'aws_execute',
              input: { mode: 'input' },
            },
          },
        }),
      ),
    ).toEqual({
      type: 'tool_use',
      content: 'Using tool: aws_execute',
      toolInput: { mode: 'input' },
      raw: {
        type: 'event',
        tool_use: {
          function: {
            type: 'tool_use',
            name: 'aws_execute',
            input: { mode: 'input' },
          },
        },
      },
    });

    const argsOnlyLine = JSON.stringify({
      type: 'event',
      item: {
        type: 'input_json_delta',
        partial_json: '{"x":1}',
      },
    });
    expect(driver.parseEvent(argsOnlyLine)).toEqual({
      type: 'tool_use',
      content: argsOnlyLine,
      toolInput: '{"x":1}',
      raw: {
        type: 'event',
        item: {
          type: 'input_json_delta',
          partial_json: '{"x":1}',
        },
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'event',
          turn: { type: 'text', text: 'turn-text' },
          response: {
            output: [
              { type: 'thinking', text: 'hidden' },
              { type: 'tool_use', text: 'hidden' },
              { type: 'tool_result', text: 'hidden' },
              { type: 'output_text', text: 1 },
              { type: 'output_text', text: '' },
              { type: 'output_text_delta', delta: '' },
              { type: 'text', text: 'visible' },
            ],
          },
          content: [0, { type: 'text', text: 'content-text' }],
          parts: [{ type: 'text', text: 'part-text' }],
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'turn-text\nvisible\ncontent-text\npart-text',
      raw: {
        type: 'event',
        turn: { type: 'text', text: 'turn-text' },
        response: {
          output: [
            { type: 'thinking', text: 'hidden' },
            { type: 'tool_use', text: 'hidden' },
            { type: 'tool_result', text: 'hidden' },
            { type: 'output_text', text: 1 },
            { type: 'output_text', text: '' },
            { type: 'output_text_delta', delta: '' },
            { type: 'text', text: 'visible' },
          ],
        },
        content: [0, { type: 'text', text: 'content-text' }],
        parts: [{ type: 'text', text: 'part-text' }],
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
      },
    });

    expect(
      driver.parseEvent(
        JSON.stringify({
          type: 'event',
          content: [42, { type: 'text', text: 'from-number-mixed-content' }],
        }),
      ),
    ).toEqual({
      type: 'text',
      content: 'from-number-mixed-content',
      raw: {
        type: 'event',
        content: [42, { type: 'text', text: 'from-number-mixed-content' }],
      },
    });
  });

  it('filters system events (hooks, init) to prevent hook output leaking as text', () => {
    const driver = new ClaudeDriver();
    const hookEvent = JSON.stringify({
      type: 'system',
      subtype: 'hook_response',
      output: '{"hookSpecificOutput":{"additionalContext":"some hook text"}}',
      exit_code: 0,
    });
    expect(driver.parseEvent(hookEvent)).toBeNull();

    const initEvent = JSON.stringify({
      type: 'system',
      subtype: 'init',
      cwd: '/some/path',
      tools: ['Read', 'Glob'],
    });
    expect(driver.parseEvent(initEvent)).toBeNull();
  });

  it('filters rate_limit_event to prevent noise in text stream', () => {
    const driver = new ClaudeDriver();
    const rateLimitEvent = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed' },
    });
    expect(driver.parseEvent(rateLimitEvent)).toBeNull();
  });

  it('extracts text from assistant message events (new CLI format)', () => {
    const driver = new ClaudeDriver();
    const assistantEvent = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: '<summary>\n## Overview\nAll tasks completed.\n</summary>' },
        ],
      },
    });
    const result = driver.parseEvent(assistantEvent);
    expect(result).toEqual({
      type: 'text',
      content: '<summary>\n## Overview\nAll tasks completed.\n</summary>',
      raw: expect.objectContaining({ type: 'assistant' }),
    });
  });

  it('extracts tool_use from assistant message events (new CLI format)', () => {
    const driver = new ClaudeDriver();
    const event = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'report.md' } },
        ],
      },
    });
    const result = driver.parseEvent(event);
    expect(result).toEqual({
      type: 'tool_use',
      content: 'Using tool: Read',
      toolInput: { file_path: 'report.md' },
      raw: expect.objectContaining({ type: 'assistant' }),
    });
  });

  it('prioritises tool_use over text in combined assistant message (new CLI format)', () => {
    const driver = new ClaudeDriver();
    const event = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will read the file.' },
          { type: 'tool_use', id: 'toolu_2', name: 'Glob', input: { pattern: '*.md' } },
        ],
      },
    });
    const result = driver.parseEvent(event);
    expect(result).toEqual({
      type: 'tool_use',
      content: 'Using tool: Glob',
      toolInput: { pattern: '*.md' },
      raw: expect.objectContaining({ type: 'assistant' }),
    });
  });

  it('extracts tool_result from user message events (new CLI format)', () => {
    const driver = new ClaudeDriver();
    const event = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { tool_use_id: 'toolu_1', type: 'tool_result', content: '# Report\nAll passed.' },
        ],
      },
    });
    const result = driver.parseEvent(event);
    expect(result).toEqual({
      type: 'tool_result',
      content: '# Report\nAll passed.',
      raw: expect.objectContaining({ type: 'user' }),
    });
  });

  it('falls back to raw JSON when tool_use has no string name', () => {
    const driver = new ClaudeDriver();
    const event = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_3', input: { pattern: '*.md' } }],
      },
    });

    expect(driver.parseEvent(event)).toEqual({
      type: 'tool_use',
      content: event,
      toolInput: { pattern: '*.md' },
      raw: expect.objectContaining({ type: 'assistant' }),
    });
  });

  it('returns an empty tool_result payload when the content is not a string', () => {
    const driver = new ClaudeDriver();
    const event = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content: { ok: true } }],
      },
    });

    expect(driver.parseEvent(event)).toEqual({
      type: 'tool_result',
      content: '',
      raw: expect.objectContaining({ type: 'user' }),
    });
  });

  it('filters user events without tool_result (new CLI format)', () => {
    const driver = new ClaudeDriver();
    const event = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'some user text' }],
      },
    });
    expect(driver.parseEvent(event)).toBeNull();
  });

  it('filters thinking-only assistant messages (new CLI format)', () => {
    const driver = new ClaudeDriver();
    const event = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'I need to read the file' }],
      },
    });
    expect(driver.parseEvent(event)).toBeNull();
  });
});

describe('ClaudeDriver.parseStderr', () => {
  it('classifies MCP auth-related stderr as non-fatal status', () => {
    const driver = new ClaudeDriver();
    const cases = [
      "MCP server 'aws-api' requires authentication",
      'Error during discovery for MCP server aws-api',
      'Refreshing expired token for MCP server: aws-api',
      'Failed to refresh auth token',
      'requires authentication using: /mcp auth aws-api',
      'token refresh failed',
      'MCP connection error for server aws-api',
    ];
    for (const line of cases) {
      const event = driver.parseStderr(line);
      expect(event, `Expected status for: "${line}"`).toEqual({
        type: 'status',
        content: line,
      });
    }
  });

  it('classifies unknown stderr as error', () => {
    const driver = new ClaudeDriver();
    const event = driver.parseStderr('Some unknown error occurred');
    expect(event).toEqual({ type: 'error', content: 'Some unknown error occurred' });
  });

  it('returns null for empty lines', () => {
    const driver = new ClaudeDriver();
    expect(driver.parseStderr('')).toBeNull();
    expect(driver.parseStderr('   ')).toBeNull();
  });
});

describe('ClaudeDriver.extractSessionState', () => {
  it('extracts session id from status event and falls back to empty state', () => {
    const driver = new ClaudeDriver();
    expect(driver.extractSessionState([{ type: 'status', content: 'session:s_123' }])).toEqual({
      session_id: 's_123',
    });
    expect(driver.extractSessionState([{ type: 'status', content: 'other' }])).toEqual({});
  });
});
