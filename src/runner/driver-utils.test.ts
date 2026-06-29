import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from '../session/types.js';
import {
  COLLECT_MAX_DEPTH,
  TOOL_CALL_TYPES,
  asRecord,
  buildDriverEnv,
  buildSafeSystemEnv,
  collectAssistantText,
  collectCloudProviderEnv,
  collectDriverSpecificEnv,
  collectSkillEnv,
  createDriverCommandResolver,
  extractAssistantText,
  extractToolUseInfo,
  isNonFatalStderr,
  normalizeCommand,
  pushIfNonEmpty,
  resolveModel,
  stripErrorPrefix,
  tryParseStderrAsEvent,
} from './driver-utils.js';

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

describe('stripErrorPrefix', () => {
  it('removes "Error: " prefix case-insensitively', () => {
    expect(stripErrorPrefix('Error: MCP server disconnected')).toBe('MCP server disconnected');
    expect(stripErrorPrefix('error: something')).toBe('something');
    expect(stripErrorPrefix('  Error:  spaces  ')).toBe('spaces');
  });

  it('returns trimmed input when no prefix', () => {
    expect(stripErrorPrefix('MCP server disconnected')).toBe('MCP server disconnected');
    expect(stripErrorPrefix('  plain  ')).toBe('plain');
  });
});

describe('normalizeCommand', () => {
  it('returns null for non-string input', () => {
    expect(normalizeCommand(undefined)).toBeNull();
  });

  it('rejects sentinel values', () => {
    expect(normalizeCommand('undefined')).toBeNull();
    expect(normalizeCommand('null')).toBeNull();
  });

  it('rejects empty/whitespace-only strings', () => {
    expect(normalizeCommand('')).toBeNull();
    expect(normalizeCommand('   ')).toBeNull();
  });

  it('trims and returns valid command strings', () => {
    expect(normalizeCommand('  claude  ')).toBe('claude');
    expect(normalizeCommand('/usr/bin/claude')).toBe('/usr/bin/claude');
  });
});

describe('createDriverCommandResolver', () => {
  const envKey = 'TEST_DRIVER_UTILS_COMMAND';
  const originalEnvValue = process.env[envKey];

  afterEach(() => {
    if (originalEnvValue === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = originalEnvValue;
    }
  });

  it('uses platformFallback result and caches it', () => {
    delete process.env[envKey];
    let fallbackCalls = 0;
    const resolve = createDriverCommandResolver({
      envKeys: [envKey],
      binaryName: '__hg_missing_binary__',
      platformFallback: () => {
        fallbackCalls += 1;
        return '/tmp/custom-cli';
      },
    });

    expect(resolve()).toBe('/tmp/custom-cli');
    expect(resolve()).toBe('/tmp/custom-cli');
    expect(fallbackCalls).toBe(1);
  });

  it('continues to normal resolution when platformFallback returns null', () => {
    delete process.env[envKey];
    const missingBinary = '__hg_really_missing_binary_for_test__';
    const resolve = createDriverCommandResolver({
      envKeys: [envKey],
      binaryName: missingBinary,
      platformFallback: () => null,
    });

    expect(resolve()).toBe(missingBinary);
  });
});

const originalTestEnvModel = process.env.TEST_DRIVER_UTILS_MODEL;
afterEach(() => {
  if (originalTestEnvModel === undefined) {
    delete process.env.TEST_DRIVER_UTILS_MODEL;
  } else {
    process.env.TEST_DRIVER_UTILS_MODEL = originalTestEnvModel;
  }
});

describe('resolveModel', () => {
  it('prefers session model over env', () => {
    process.env.TEST_DRIVER_UTILS_MODEL = 'env-model';
    const result = resolveModel(
      createSession({ model: 'session-model' }),
      'TEST_DRIVER_UTILS_MODEL',
    );
    expect(result).toBe('session-model');
  });

  it('falls back to env when session model is not set', () => {
    process.env.TEST_DRIVER_UTILS_MODEL = 'env-model';
    const result = resolveModel(createSession({}), 'TEST_DRIVER_UTILS_MODEL');
    expect(result).toBe('env-model');
  });

  it('returns null when both session and env are default', () => {
    process.env.TEST_DRIVER_UTILS_MODEL = 'default';
    const result = resolveModel(createSession({ model: 'default' }), 'TEST_DRIVER_UTILS_MODEL');
    expect(result).toBeNull();
  });

  it('returns null when no model is configured', () => {
    delete process.env.TEST_DRIVER_UTILS_MODEL;
    const result = resolveModel(createSession({}), 'TEST_DRIVER_UTILS_MODEL');
    expect(result).toBeNull();
  });

  it('trims session model whitespace', () => {
    const result = resolveModel(createSession({ model: '  trimmed  ' }), 'TEST_DRIVER_UTILS_MODEL');
    expect(result).toBe('trimmed');
  });
});

describe('pushIfNonEmpty', () => {
  it('pushes non-empty strings', () => {
    const buf: string[] = [];
    pushIfNonEmpty(buf, 'hello');
    expect(buf).toEqual(['hello']);
  });

  it('ignores empty strings, non-strings, and falsy values', () => {
    const buf: string[] = [];
    pushIfNonEmpty(buf, '');
    pushIfNonEmpty(buf, null);
    pushIfNonEmpty(buf, undefined);
    pushIfNonEmpty(buf, 42);
    expect(buf).toEqual([]);
  });
});

describe('collectAssistantText / extractAssistantText', () => {
  it('extracts text from simple string', () => {
    expect(extractAssistantText('hello')).toBe('hello');
  });

  it('extracts from text block', () => {
    expect(extractAssistantText({ type: 'text', text: 'hi' })).toBe('hi');
  });

  it('extracts from output_text block', () => {
    expect(extractAssistantText({ type: 'output_text', text: 'out' })).toBe('out');
  });

  it('extracts from text_delta block', () => {
    expect(extractAssistantText({ type: 'text_delta', text: 'delta' })).toBe('delta');
  });

  it('extracts from output_text_delta block', () => {
    expect(extractAssistantText({ type: 'output_text_delta', delta: 'od' })).toBe('od');
  });

  it('extracts from result block', () => {
    expect(extractAssistantText({ type: 'result', result: 'res' })).toBe('res');
  });

  it('skips thinking, tool_use, and tool_result blocks', () => {
    expect(extractAssistantText({ type: 'thinking', text: 'hidden' })).toBeNull();
    expect(extractAssistantText({ type: 'tool_use', text: 'hidden' })).toBeNull();
    expect(extractAssistantText({ type: 'tool_result', text: 'hidden' })).toBeNull();
  });

  it('extracts from assistant role with string content', () => {
    expect(extractAssistantText({ role: 'assistant', content: 'msg' })).toBe('msg');
  });

  it('extracts from assistant role with nested content', () => {
    expect(
      extractAssistantText({
        role: 'assistant',
        content: [{ type: 'text', text: 'nested' }],
      }),
    ).toBe('nested');
  });

  it('traverses item, message, turn, output, response, parts', () => {
    expect(extractAssistantText({ item: { type: 'text', text: 'a' } })).toBe('a');
    expect(extractAssistantText({ message: 'b' })).toBe('b');
    expect(extractAssistantText({ turn: 'c' })).toBe('c');
    expect(extractAssistantText({ output: 'd' })).toBe('d');
    expect(extractAssistantText({ response: 'e' })).toBe('e');
    expect(extractAssistantText({ parts: ['f'] })).toBe('f');
  });

  it('returns null for empty/falsy input', () => {
    expect(extractAssistantText(null)).toBeNull();
    expect(extractAssistantText(undefined)).toBeNull();
    expect(extractAssistantText(0)).toBeNull();
    expect(extractAssistantText({})).toBeNull();
  });

  it('joins multiple text parts with newline', () => {
    const result = extractAssistantText([
      { type: 'text', text: 'line1' },
      { type: 'text', text: 'line2' },
    ]);
    expect(result).toBe('line1\nline2');
  });

  it('respects max depth limit', () => {
    const buf: string[] = [];
    collectAssistantText('hello', buf, COLLECT_MAX_DEPTH + 1);
    expect(buf).toEqual([]);
  });
});

describe('isNonFatalStderr', () => {
  const patterns: RegExp[] = [
    /^MCP server '.+' requires authentication/i,
    /^MCP connection error/i,
    /^token refresh failed/i,
  ];

  it('matches against provided patterns', () => {
    expect(isNonFatalStderr(patterns, "MCP server 'test' requires authentication")).toBe(true);
    expect(isNonFatalStderr(patterns, 'MCP connection error')).toBe(true);
    expect(isNonFatalStderr(patterns, 'token refresh failed')).toBe(true);
  });

  it('strips Error: prefix before matching', () => {
    expect(isNonFatalStderr(patterns, "Error: MCP server 'x' requires authentication")).toBe(true);
    expect(isNonFatalStderr(patterns, 'Error: token refresh failed')).toBe(true);
  });

  it('returns false for non-matching lines', () => {
    expect(isNonFatalStderr(patterns, 'fatal crash')).toBe(false);
    expect(isNonFatalStderr(patterns, 'something else entirely')).toBe(false);
  });

  it('returns false with empty patterns', () => {
    expect(isNonFatalStderr([], 'MCP connection error')).toBe(false);
  });
});

describe('collectCloudProviderEnv', () => {
  const CLOUD_KEYS = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_DEFAULT_REGION',
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET',
    'AZURE_TENANT_ID',
    'AZURE_SUBSCRIPTION_ID',
    'CLOUDSDK_CORE_PROJECT',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_CLOUD_QUOTA_PROJECT',
  ] as const;

  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of CLOUD_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('collects AWS_* prefixed vars', () => {
    for (const key of CLOUD_KEYS) saved[key] = process.env[key];
    process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
    process.env.AWS_DEFAULT_REGION = 'us-east-1';

    const env = collectCloudProviderEnv();
    expect(env.AWS_ACCESS_KEY_ID).toBe('AKIAIOSFODNN7EXAMPLE');
    expect(env.AWS_DEFAULT_REGION).toBe('us-east-1');
  });

  it('collects AZURE_* prefixed vars', () => {
    for (const key of CLOUD_KEYS) saved[key] = process.env[key];
    process.env.AZURE_CLIENT_ID = 'azure-id';
    process.env.AZURE_TENANT_ID = 'azure-tenant';
    process.env.AZURE_SUBSCRIPTION_ID = 'azure-sub';

    const env = collectCloudProviderEnv();
    expect(env.AZURE_CLIENT_ID).toBe('azure-id');
    expect(env.AZURE_TENANT_ID).toBe('azure-tenant');
    expect(env.AZURE_SUBSCRIPTION_ID).toBe('azure-sub');
  });

  it('collects CLOUDSDK_*, GOOGLE_CLOUD_*, and GOOGLE_APPLICATION_CREDENTIALS', () => {
    for (const key of CLOUD_KEYS) saved[key] = process.env[key];
    process.env.CLOUDSDK_CORE_PROJECT = 'my-project';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/key.json';
    process.env.GOOGLE_CLOUD_PROJECT = 'gcp-project-123';
    process.env.GOOGLE_CLOUD_QUOTA_PROJECT = 'gcp-quota-456';

    const env = collectCloudProviderEnv();
    expect(env.CLOUDSDK_CORE_PROJECT).toBe('my-project');
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBe('/tmp/key.json');
    expect(env.GOOGLE_CLOUD_PROJECT).toBe('gcp-project-123');
    expect(env.GOOGLE_CLOUD_QUOTA_PROJECT).toBe('gcp-quota-456');
  });

  it('skips empty or undefined values', () => {
    for (const key of CLOUD_KEYS) saved[key] = process.env[key];
    delete process.env.AWS_ACCESS_KEY_ID;
    process.env.AZURE_CLIENT_ID = '';

    const env = collectCloudProviderEnv();
    expect(env).not.toHaveProperty('AWS_ACCESS_KEY_ID');
    expect(env).not.toHaveProperty('AZURE_CLIENT_ID');
  });

  it('does not include non-cloud vars', () => {
    for (const key of CLOUD_KEYS) saved[key] = process.env[key];
    // Clean all cloud keys
    for (const key of CLOUD_KEYS) delete process.env[key];

    const env = collectCloudProviderEnv();
    // Should not have PATH, HOME, or other non-cloud keys
    expect(env).not.toHaveProperty('PATH');
    expect(env).not.toHaveProperty('HOME');
  });
});

// ---------------------------------------------------------------------------
// asRecord
// ---------------------------------------------------------------------------

describe('asRecord', () => {
  it('returns the value for plain objects', () => {
    const obj = { a: 1 };
    expect(asRecord(obj)).toBe(obj);
  });

  it('returns null for arrays', () => {
    expect(asRecord([1, 2])).toBeNull();
  });

  it('returns null for primitives and falsy values', () => {
    expect(asRecord(null)).toBeNull();
    expect(asRecord(undefined)).toBeNull();
    expect(asRecord(0)).toBeNull();
    expect(asRecord('')).toBeNull();
    expect(asRecord(false)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TOOL_CALL_TYPES
// ---------------------------------------------------------------------------

describe('TOOL_CALL_TYPES', () => {
  it('contains Claude types', () => {
    expect(TOOL_CALL_TYPES.has('tool_use')).toBe(true);
    expect(TOOL_CALL_TYPES.has('input_json_delta')).toBe(true);
  });

  it('contains Codex types', () => {
    expect(TOOL_CALL_TYPES.has('function_call')).toBe(true);
    expect(TOOL_CALL_TYPES.has('tool_call')).toBe(true);
    expect(TOOL_CALL_TYPES.has('mcp_tool_call')).toBe(true);
    expect(TOOL_CALL_TYPES.has('custom_tool_call')).toBe(true);
    expect(TOOL_CALL_TYPES.has('call_tool')).toBe(true);
  });

  it('does not contain arbitrary types', () => {
    expect(TOOL_CALL_TYPES.has('text')).toBe(false);
    expect(TOOL_CALL_TYPES.has('message')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractToolUseInfo
// ---------------------------------------------------------------------------

describe('extractToolUseInfo', () => {
  describe('Claude mode (requireToolName: false)', () => {
    it('extracts tool_use from root', () => {
      const result = extractToolUseInfo({
        type: 'tool_use',
        name: 'Read',
        input: { file: 'a.ts' },
      });
      expect(result).toEqual({ toolName: 'Read', args: { file: 'a.ts' } });
    });

    it('extracts from content_block sub-object', () => {
      const result = extractToolUseInfo({
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Write', input: 'data' },
      });
      expect(result).toEqual({ toolName: 'Write', args: 'data' });
    });

    it('extracts from delta with input_json_delta', () => {
      const result = extractToolUseInfo({
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{"x":1}' },
      });
      expect(result).toEqual({ toolName: null, args: '{"x":1}' });
    });

    it('extracts from tool_use sub-object', () => {
      const result = extractToolUseInfo({
        tool_use: { type: 'tool_use', name: 'Bash', arguments: '--help' },
      });
      expect(result).toEqual({ toolName: 'Bash', args: '--help' });
    });

    it('returns args-only result when toolName is missing', () => {
      const result = extractToolUseInfo({
        type: 'input_json_delta',
        partial_json: '{}',
      });
      expect(result).toEqual({ toolName: null, args: '{}' });
    });

    it('returns null for non-tool payloads', () => {
      expect(extractToolUseInfo({ type: 'text', text: 'hello' })).toBeNull();
      expect(extractToolUseInfo({})).toBeNull();
    });

    it('reads toolName from function sub-object', () => {
      const result = extractToolUseInfo({
        type: 'function_call',
        function: { name: 'myTool', arguments: '{}' },
      });
      expect(result).toEqual({ toolName: 'myTool', args: '{}' });
    });

    it('detects tool call by call_id presence', () => {
      const result = extractToolUseInfo({
        call_id: 'abc123',
        name: 'Read',
        arguments: '{}',
      });
      expect(result).toEqual({ toolName: 'Read', args: '{}' });
    });

    it('detects tool call by tool_name presence', () => {
      const result = extractToolUseInfo({
        tool_name: 'Edit',
        args: { path: 'x' },
      });
      expect(result).toEqual({ toolName: 'Edit', args: { path: 'x' } });
    });
  });

  describe('Codex mode (requireToolName: true)', () => {
    it('extracts tool use with required name', () => {
      const result = extractToolUseInfo(
        { type: 'function_call', name: 'shell', arguments: 'ls' },
        { requireToolName: true },
      );
      expect(result).toEqual({ toolName: 'shell', args: 'ls' });
    });

    it('skips candidates without toolName', () => {
      const result = extractToolUseInfo(
        { type: 'input_json_delta', partial_json: '{}' },
        { requireToolName: true },
      );
      expect(result).toBeNull();
    });

    it('extracts from item sub-object with function info', () => {
      const result = extractToolUseInfo(
        {
          type: 'item.created',
          item: {
            type: 'function_call',
            function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
          },
        },
        { requireToolName: true },
      );
      expect(result).toEqual({
        toolName: 'read_file',
        args: '{"path":"a.ts"}',
      });
    });

    it('returns null for non-tool payloads', () => {
      const result = extractToolUseInfo({ type: 'text', text: 'hello' }, { requireToolName: true });
      expect(result).toBeNull();
    });
  });

  describe('args priority', () => {
    it('prefers arguments over args', () => {
      const result = extractToolUseInfo({
        type: 'tool_use',
        name: 'X',
        arguments: 'first',
        args: 'second',
      });
      expect(result?.args).toBe('first');
    });

    it('prefers args over input', () => {
      const result = extractToolUseInfo({
        type: 'tool_use',
        name: 'X',
        args: 'first',
        input: 'second',
      });
      expect(result?.args).toBe('first');
    });

    it('falls through to payload', () => {
      const result = extractToolUseInfo({
        type: 'tool_use',
        name: 'X',
        payload: 'last',
      });
      expect(result?.args).toBe('last');
    });
  });
});

// ---------------------------------------------------------------------------
// tryParseStderrAsEvent
// ---------------------------------------------------------------------------

describe('tryParseStderrAsEvent', () => {
  it('delegates valid JSON to parseEvent', () => {
    const result = tryParseStderrAsEvent('{"type":"text","content":"hello"}', (line) => {
      const parsed = JSON.parse(line);
      return { type: 'text' as const, content: parsed.content as string };
    });
    expect(result).toEqual({ type: 'text', content: 'hello' });
  });

  it('returns null for non-JSON lines', () => {
    const result = tryParseStderrAsEvent('plain text', () => ({
      type: 'text',
      content: 'should not reach',
    }));
    expect(result).toBeNull();
  });

  it('returns null when parseEvent returns null', () => {
    const result = tryParseStderrAsEvent('{"type":"unknown"}', () => null);
    expect(result).toBeNull();
  });

  it('returns null when JSON.parse throws', () => {
    const result = tryParseStderrAsEvent('{bad json', () => ({
      type: 'text',
      content: 'x',
    }));
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildSafeSystemEnv
// ---------------------------------------------------------------------------

describe('buildSafeSystemEnv', () => {
  it('includes standard system keys', () => {
    const env = buildSafeSystemEnv();
    // PATH and HOME are almost always set in the test environment
    if (process.env.PATH) expect(env.PATH).toBe(process.env.PATH);
    if (process.env.HOME) expect(env.HOME).toBe(process.env.HOME);
  });

  it('includes proxy/TLS keys when set', () => {
    const origHttpProxy = process.env.HTTP_PROXY;
    const origNodeExtra = process.env.NODE_EXTRA_CA_CERTS;
    process.env.HTTP_PROXY = 'http://proxy.example.com';
    process.env.NODE_EXTRA_CA_CERTS = '/tmp/ca.pem';
    try {
      const env = buildSafeSystemEnv();
      expect(env.HTTP_PROXY).toBe('http://proxy.example.com');
      expect(env.NODE_EXTRA_CA_CERTS).toBe('/tmp/ca.pem');
    } finally {
      if (origHttpProxy === undefined) delete process.env.HTTP_PROXY;
      else process.env.HTTP_PROXY = origHttpProxy;
      if (origNodeExtra === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
      else process.env.NODE_EXTRA_CA_CERTS = origNodeExtra;
    }
  });

  it('includes LC_* prefixed vars', () => {
    const origLcMessages = process.env.LC_MESSAGES;
    process.env.LC_MESSAGES = 'en_US.UTF-8';
    try {
      const env = buildSafeSystemEnv();
      expect(env.LC_MESSAGES).toBe('en_US.UTF-8');
    } finally {
      if (origLcMessages === undefined) delete process.env.LC_MESSAGES;
      else process.env.LC_MESSAGES = origLcMessages;
    }
  });

  it('skips entries whose value is undefined', () => {
    const originalEnv = process.env;
    (process as { env: NodeJS.ProcessEnv }).env = {
      PATH: '/tmp/custom-path',
      HG_UNDEFINED: undefined,
      LC_MESSAGES: undefined,
    } as NodeJS.ProcessEnv;
    try {
      const env = buildSafeSystemEnv();
      expect(env.PATH).toBe('/tmp/custom-path');
      expect(env).not.toHaveProperty('HG_UNDEFINED');
      expect(env).not.toHaveProperty('LC_MESSAGES');
    } finally {
      (process as { env: NodeJS.ProcessEnv }).env = originalEnv;
    }
  });

  it('does NOT include daemon secrets', () => {
    const origSlack = process.env.SLACK_BOT_TOKEN;
    const origApi = process.env.SERVER_API_SECRET;
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    process.env.SERVER_API_SECRET = 'secret-123';
    try {
      const env = buildSafeSystemEnv();
      expect(env).not.toHaveProperty('SLACK_BOT_TOKEN');
      expect(env).not.toHaveProperty('SERVER_API_SECRET');
    } finally {
      if (origSlack === undefined) delete process.env.SLACK_BOT_TOKEN;
      else process.env.SLACK_BOT_TOKEN = origSlack;
      if (origApi === undefined) delete process.env.SERVER_API_SECRET;
      else process.env.SERVER_API_SECRET = origApi;
    }
  });

  it('does NOT include AI driver API keys or auth tokens', () => {
    const origAnthropic = process.env.ANTHROPIC_API_KEY;
    const origAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
    const origGemini = process.env.GEMINI_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.ANTHROPIC_AUTH_TOKEN = 'auth-token-test';
    process.env.GEMINI_API_KEY = 'gem-test';
    try {
      const env = buildSafeSystemEnv();
      expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
      expect(env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
      expect(env).not.toHaveProperty('GEMINI_API_KEY');
    } finally {
      if (origAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = origAnthropic;
      if (origAuthToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = origAuthToken;
      if (origGemini === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = origGemini;
    }
  });
});

describe('collectDriverSpecificEnv', () => {
  it('collects tool-specific auth/config env vars', () => {
    const saved = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
      CLAUDE_MCP_CONFIG_PATH: process.env.CLAUDE_MCP_CONFIG_PATH,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      CODEX_HOME: process.env.CODEX_HOME,
      CODEX_MCP_CONFIG_PATH: process.env.CODEX_MCP_CONFIG_PATH,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GEMINI_CLI_HOME: process.env.GEMINI_CLI_HOME,
      GEMINI_MCP_CONFIG_PATH: process.env.GEMINI_MCP_CONFIG_PATH,
    };

    process.env.ANTHROPIC_API_KEY = 'anthropic-test';
    process.env.CLAUDE_CONFIG_DIR = '/tmp/claude-config';
    process.env.CLAUDE_MCP_CONFIG_PATH = '/tmp/claude-mcp.json';
    process.env.OPENAI_API_KEY = 'openai-test';
    process.env.CODEX_HOME = '/tmp/codex-home';
    process.env.CODEX_MCP_CONFIG_PATH = '/tmp/codex-mcp.toml';
    process.env.GEMINI_API_KEY = 'gemini-test';
    process.env.GEMINI_CLI_HOME = '/tmp/gemini-home';
    process.env.GEMINI_MCP_CONFIG_PATH = '/tmp/gemini-settings.json';

    try {
      expect(collectDriverSpecificEnv('claude')).toEqual({
        ANTHROPIC_API_KEY: 'anthropic-test',
        CLAUDE_CONFIG_DIR: '/tmp/claude-config',
      });
      expect(collectDriverSpecificEnv('codex')).toEqual({
        OPENAI_API_KEY: 'openai-test',
        CODEX_HOME: '/tmp/codex-home',
      });
      expect(collectDriverSpecificEnv('gemini')).toEqual({
        GEMINI_API_KEY: 'gemini-test',
        GEMINI_CLI_HOME: '/tmp/gemini-home',
      });
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe('buildDriverEnv', () => {
  const saved: Record<string, string | undefined> = {};
  const TEST_KEYS = [
    'PATH',
    'HOME',
    'AWS_ACCESS_KEY_ID',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'CLAUDE_CONFIG_DIR',
    'GEMINI_API_KEY',
    'UNRELATED_SECRET',
  ] as const;

  afterEach(() => {
    for (const key of TEST_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('composes safe system and driver-specific env (no cloud env)', () => {
    for (const key of TEST_KEYS) saved[key] = process.env[key];

    process.env.PATH = '/usr/bin';
    process.env.HOME = '/tmp/home';
    process.env.AWS_ACCESS_KEY_ID = 'AKIAEXAMPLE';
    process.env.OPENAI_API_KEY = 'openai-test';
    process.env.ANTHROPIC_API_KEY = 'anthropic-test';
    process.env.CLAUDE_CONFIG_DIR = '/tmp/claude-config';
    process.env.GEMINI_API_KEY = 'gemini-test';
    process.env.UNRELATED_SECRET = 'should-not-leak';

    const codexEnv = buildDriverEnv('codex');
    expect(codexEnv.PATH).toBe('/usr/bin');
    expect(codexEnv.HOME).toBe('/tmp/home');
    // Cloud env vars are NOT included — forwarded by job-executor based on policy
    expect(codexEnv).not.toHaveProperty('AWS_ACCESS_KEY_ID');
    expect(codexEnv.OPENAI_API_KEY).toBe('openai-test');
    expect(codexEnv).not.toHaveProperty('CODEX_MCP_CONFIG_PATH');
    expect(codexEnv).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(codexEnv).not.toHaveProperty('GEMINI_API_KEY');
    expect(codexEnv).not.toHaveProperty('UNRELATED_SECRET');

    const claudeEnv = buildDriverEnv('claude');
    expect(claudeEnv.CLAUDE_CONFIG_DIR).toBe('/tmp/claude-config');
    expect(claudeEnv.ANTHROPIC_API_KEY).toBe('anthropic-test');
    expect(claudeEnv).not.toHaveProperty('AWS_ACCESS_KEY_ID');
    expect(claudeEnv).not.toHaveProperty('OPENAI_API_KEY');
    expect(claudeEnv).not.toHaveProperty('GEMINI_API_KEY');
    expect(claudeEnv).not.toHaveProperty('UNRELATED_SECRET');
  });
});

// ---------------------------------------------------------------------------
// collectSkillEnv
// ---------------------------------------------------------------------------

describe('collectSkillEnv', () => {
  const SKILL_KEYS = ['PERPLEXITY_API_KEY', 'HUSKYGATE_API_BASE', 'HUSKYGATE_API_SECRET'] as const;
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of SKILL_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('collects skill env vars when set', () => {
    for (const key of SKILL_KEYS) saved[key] = process.env[key];
    process.env.PERPLEXITY_API_KEY = 'pplx-test';
    process.env.HUSKYGATE_API_BASE = 'http://localhost:3738';
    process.env.HUSKYGATE_API_SECRET = 'secret-456';

    const env = collectSkillEnv([
      {
        manifest: { schemaVersion: 1, excludeDirs: [], envVars: ['PERPLEXITY_API_KEY'] },
      },
      {
        manifest: {
          schemaVersion: 1,
          excludeDirs: [],
          envVars: ['HUSKYGATE_API_BASE', 'HUSKYGATE_API_SECRET'],
        },
      },
    ] as const);
    expect(env.PERPLEXITY_API_KEY).toBe('pplx-test');
    expect(env.HUSKYGATE_API_BASE).toBe('http://localhost:3738');
    expect(env.HUSKYGATE_API_SECRET).toBe('secret-456');
  });

  it('skips missing env vars', () => {
    for (const key of SKILL_KEYS) saved[key] = process.env[key];
    for (const key of SKILL_KEYS) delete process.env[key];

    const env = collectSkillEnv([
      {
        manifest: { schemaVersion: 1, excludeDirs: [], envVars: ['PERPLEXITY_API_KEY'] },
      },
    ] as const);
    expect(Object.keys(env)).toHaveLength(0);
  });

  it('deduplicates repeated manifest env keys across skills', () => {
    for (const key of SKILL_KEYS) saved[key] = process.env[key];
    process.env.PERPLEXITY_API_KEY = 'pplx-test';
    process.env.HUSKYGATE_API_BASE = 'http://localhost:3738';
    process.env.HUSKYGATE_API_SECRET = 'secret-456';

    const env = collectSkillEnv([
      {
        manifest: {
          schemaVersion: 1,
          excludeDirs: [],
          envVars: ['HUSKYGATE_API_BASE', 'HUSKYGATE_API_SECRET'],
        },
      },
      {
        manifest: { schemaVersion: 1, excludeDirs: [], envVars: ['HUSKYGATE_API_SECRET'] },
      },
    ] as const);

    expect(env).toEqual({
      HUSKYGATE_API_BASE: 'http://localhost:3738',
      HUSKYGATE_API_SECRET: 'secret-456',
    });
  });
});
