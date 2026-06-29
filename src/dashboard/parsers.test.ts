import { describe, expect, it } from 'vitest';
import { parseToml, serializeTomlSection, updateTomlFile } from '../shared/toml.js';
import { parseYamlFrontmatter, serializeYamlFrontmatter } from '../shared/yaml.js';

/* ═══════════════════════════════════════════════
   TOML Parser
   ═══════════════════════════════════════════════ */

describe('parseToml', () => {
  it('parses simple key-value pairs', () => {
    const result = parseToml('name = "test"\ncount = 42\nenabled = true\n');
    expect(result).toEqual({ name: 'test', count: 42, enabled: true });
  });

  it('parses sections', () => {
    const input = `
[model_provider]
name = "openai"
key = "sk-xxx"

[history]
max_items = 100
`;
    const result = parseToml(input);
    expect(result).toEqual({
      model_provider: { name: 'openai', key: 'sk-xxx' },
      history: { max_items: 100 },
    });
  });

  it('parses dotted sections (mcp_servers.name)', () => {
    const input = `
[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
env = { GITHUB_TOKEN = "ghp_xxx" }
enabled = true
`;
    const result = parseToml(input);
    expect(result).toEqual({
      mcp_servers: {
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN: 'ghp_xxx' },
          enabled: true,
        },
      },
    });
  });

  it('parses multiple MCP servers', () => {
    const input = `
[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]

[mcp_servers.slack]
command = "npx"
args = ["-y", "@anthropic/mcp-slack"]
`;
    const result = parseToml(input);
    const servers = result.mcp_servers as Record<string, Record<string, unknown>>;
    expect(Object.keys(servers)).toEqual(['github', 'slack']);
    expect(servers.github?.command).toBe('npx');
    expect(servers.slack?.command).toBe('npx');
  });

  it('parses HTTP transport server', () => {
    const input = `
[mcp_servers.remote-api]
url = "https://api.example.com/mcp"
bearer_token = "sk-xxx"
http_headers = { "X-Custom" = "value" }
scopes = ["read", "write"]
enabled = true
startup_timeout_sec = 30
tool_timeout_sec = 120
`;
    const result = parseToml(input);
    const server = (result.mcp_servers as Record<string, Record<string, unknown>>)[
      'remote-api'
    ] as Record<string, unknown>;
    expect(server.url).toBe('https://api.example.com/mcp');
    expect(server.bearer_token).toBe('sk-xxx');
    expect(server.http_headers).toEqual({ 'X-Custom': 'value' });
    expect(server.scopes).toEqual(['read', 'write']);
    expect(server.startup_timeout_sec).toBe(30);
    expect(server.tool_timeout_sec).toBe(120);
  });

  it('skips comments and blank lines', () => {
    const input = `
# This is a comment
name = "test"

# Another comment
count = 5
`;
    const result = parseToml(input);
    expect(result).toEqual({ name: 'test', count: 5 });
  });

  it('handles empty input', () => {
    expect(parseToml('')).toEqual({});
  });

  it('parses single-quoted strings', () => {
    const result = parseToml("name = 'hello'\n");
    expect(result).toEqual({ name: 'hello' });
  });

  it('parses false boolean', () => {
    const result = parseToml('required = false\n');
    expect(result).toEqual({ required: false });
  });

  it('parses inline table with multiple keys', () => {
    const input = 'env = { KEY1 = "val1", KEY2 = "val2", KEY3 = "val3" }\n';
    const result = parseToml(input);
    expect(result).toEqual({ env: { KEY1: 'val1', KEY2: 'val2', KEY3: 'val3' } });
  });

  it('preserves non-mcp sections alongside mcp sections', () => {
    const input = `
[model_provider]
name = "anthropic"

[mcp_servers.github]
command = "npx"

[history]
enabled = true
`;
    const result = parseToml(input);
    expect(result.model_provider).toEqual({ name: 'anthropic' });
    expect(result.history).toEqual({ enabled: true });
    expect((result.mcp_servers as Record<string, unknown>).github).toEqual({ command: 'npx' });
  });
});

/* ═══════════════════════════════════════════════
   TOML Serializer
   ═══════════════════════════════════════════════ */

describe('serializeTomlSection', () => {
  it('serializes a single stdio server', () => {
    const result = serializeTomlSection({
      github: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: 'ghp_xxx' },
        enabled: true,
      },
    });
    expect(result).toContain('[mcp_servers.github]');
    expect(result).toContain('command = "npx"');
    expect(result).toContain('args = ["-y", "@modelcontextprotocol/server-github"]');
    expect(result).toContain('env = { GITHUB_TOKEN = "ghp_xxx" }');
    expect(result).toContain('enabled = true');
  });

  it('serializes multiple servers', () => {
    const result = serializeTomlSection({
      github: { command: 'npx' },
      slack: { command: 'uvx' },
    });
    expect(result).toContain('[mcp_servers.github]');
    expect(result).toContain('[mcp_servers.slack]');
  });

  it('converts camelCase to snake_case for known keys', () => {
    const result = serializeTomlSection({
      api: {
        bearerToken: 'sk-xxx',
        bearerTokenEnvVar: 'MY_TOKEN',
        httpHeaders: { 'X-Key': 'val' },
        includeTools: ['tool1'],
        excludeTools: ['tool2'],
        toolTimeout: 120,
        timeout: 30,
      },
    });
    expect(result).toContain('bearer_token = "sk-xxx"');
    expect(result).toContain('bearer_token_env_var = "MY_TOKEN"');
    expect(result).toContain('http_headers = { X-Key = "val" }');
    expect(result).toContain('enabled_tools = ["tool1"]');
    expect(result).toContain('disabled_tools = ["tool2"]');
    expect(result).toContain('tool_timeout_sec = 120');
    expect(result).toContain('startup_timeout_sec = 30');
  });

  it('skips transport field', () => {
    const result = serializeTomlSection({
      test: { transport: 'stdio', command: 'npx' },
    });
    expect(result).not.toContain('transport');
    expect(result).toContain('command = "npx"');
  });

  it('skips null/undefined values', () => {
    const result = serializeTomlSection({
      test: {
        command: 'npx',
        cwd: undefined as unknown as string,
        args: null as unknown as string[],
      },
    });
    expect(result).toContain('command = "npx"');
    expect(result).not.toContain('cwd');
    expect(result).not.toContain('args');
  });

  it('returns empty string for empty servers', () => {
    expect(serializeTomlSection({})).toBe('');
  });
});

/* ═══════════════════════════════════════════════
   TOML File Updater
   ═══════════════════════════════════════════════ */

describe('updateTomlFile', () => {
  it('replaces mcp_servers section while preserving others', () => {
    const original = `[model_provider]
name = "anthropic"

[mcp_servers.old]
command = "old-cmd"

[history]
enabled = true
`;
    const result = updateTomlFile(original, {
      new_server: { command: 'new-cmd', enabled: true },
    });
    expect(result).toContain('[model_provider]');
    expect(result).toContain('name = "anthropic"');
    expect(result).toContain('[mcp_servers.new_server]');
    expect(result).toContain('command = "new-cmd"');
    expect(result).toContain('[history]');
    expect(result).toContain('enabled = true');
    expect(result).not.toContain('old-cmd');
  });

  it('adds mcp_servers when none exist', () => {
    const original = `[model_provider]
name = "anthropic"
`;
    const result = updateTomlFile(original, {
      github: { command: 'npx' },
    });
    expect(result).toContain('[model_provider]');
    expect(result).toContain('[mcp_servers.github]');
    expect(result).toContain('command = "npx"');
  });

  it('removes all mcp_servers when given empty object', () => {
    const original = `[mcp_servers.github]
command = "npx"

[mcp_servers.slack]
command = "uvx"
`;
    const result = updateTomlFile(original, {});
    expect(result).not.toContain('[mcp_servers');
    expect(result).not.toContain('command');
  });

  it('handles file with only mcp_servers', () => {
    const original = `[mcp_servers.github]
command = "npx"
`;
    const result = updateTomlFile(original, {
      slack: { command: 'uvx' },
    });
    expect(result).toContain('[mcp_servers.slack]');
    expect(result).toContain('command = "uvx"');
    expect(result).not.toContain('github');
  });
});

/* ═══════════════════════════════════════════════
   YAML Frontmatter Parser
   ═══════════════════════════════════════════════ */

describe('parseYamlFrontmatter', () => {
  it('parses basic frontmatter with body', () => {
    const input = `---
name: deploy
description: Deploy to production
---
# Deploy Runbook

Steps to deploy...`;
    const result = parseYamlFrontmatter(input);
    expect(result.frontmatter).toEqual({
      name: 'deploy',
      description: 'Deploy to production',
    });
    expect(result.body).toContain('# Deploy Runbook');
    expect(result.body).toContain('Steps to deploy...');
  });

  it('parses boolean and number values', () => {
    const input = `---
user-invocable: true
disable-model-invocation: false
timeout: 30
---
body`;
    const result = parseYamlFrontmatter(input);
    expect(result.frontmatter['user-invocable']).toBe(true);
    expect(result.frontmatter['disable-model-invocation']).toBe(false);
    expect(result.frontmatter.timeout).toBe(30);
  });

  it('parses flow-style arrays', () => {
    const input = `---
allowed-tools: [Bash, Read, Grep]
compatibility: [gemini-2.5-pro, gemini-2.5-flash]
---
body`;
    const result = parseYamlFrontmatter(input);
    expect(result.frontmatter['allowed-tools']).toEqual(['Bash', 'Read', 'Grep']);
    expect(result.frontmatter.compatibility).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash']);
  });

  it('parses quoted strings in arrays', () => {
    const input = `---
allowed-tools: ["Bash(gh *)", "Read"]
---
body`;
    const result = parseYamlFrontmatter(input);
    expect(result.frontmatter['allowed-tools']).toEqual(['Bash(gh *)', 'Read']);
  });

  it('parses nested object (1-level)', () => {
    const input = `---
name: my-skill
metadata:
  tags: [devops, deploy]
  version: 1.0.0
  icon: rocket
---
body`;
    const result = parseYamlFrontmatter(input);
    expect(result.frontmatter.metadata).toEqual({
      tags: ['devops', 'deploy'],
      version: '1.0.0',
      icon: 'rocket',
    });
  });

  it('parses block-style array items', () => {
    const input = `---
name: test
allowed-tools:
  - Bash
  - Read
  - Grep
---
body`;
    const result = parseYamlFrontmatter(input);
    expect(result.frontmatter['allowed-tools']).toEqual(['Bash', 'Read', 'Grep']);
  });

  it('returns empty frontmatter when no --- markers', () => {
    const input = '# Just a markdown file\nwith content';
    const result = parseYamlFrontmatter(input);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(input);
  });

  it('returns empty frontmatter when closing --- is missing', () => {
    const input = '---\nname: test\nNo closing marker';
    const result = parseYamlFrontmatter(input);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(input);
  });

  it('handles null values', () => {
    const input = `---
name: test
description: null
extra: ~
---
body`;
    const result = parseYamlFrontmatter(input);
    expect(result.frontmatter.description).toBeNull();
    expect(result.frontmatter.extra).toBeNull();
  });

  it('handles empty frontmatter', () => {
    const input = `---
---
body content`;
    const result = parseYamlFrontmatter(input);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe('body content');
  });

  it('preserves quoted strings with colons', () => {
    const input = `---
description: "Deploy to env: production"
---
body`;
    const result = parseYamlFrontmatter(input);
    expect(result.frontmatter.description).toBe('Deploy to env: production');
  });

  it('skips comments within frontmatter', () => {
    const input = `---
name: test
# This is a comment
description: hello
---
body`;
    const result = parseYamlFrontmatter(input);
    expect(result.frontmatter).toEqual({ name: 'test', description: 'hello' });
  });

  it('handles Claude-specific fields', () => {
    const input = `---
name: deploy
description: Deploy script
argument-hint: [env] [optional: tag]
disable-model-invocation: true
user-invocable: true
context: fork
agent: general-purpose
model: claude-sonnet-4-5-20250514
allowed-tools: [Bash, Read]
---
# Deploy body`;
    const { frontmatter } = parseYamlFrontmatter(input);
    expect(frontmatter['argument-hint']).toBe('[env] [optional: tag]');
    expect(frontmatter.context).toBe('fork');
    expect(frontmatter.agent).toBe('general-purpose');
    expect(frontmatter.model).toBe('claude-sonnet-4-5-20250514');
  });

  it('handles Gemini Agent Skills Standard fields', () => {
    const input = `---
name: code-review
description: Review code changes
license: MIT
compatibility: [gemini-2.5-pro]
metadata:
  tags: [code, review]
  version: 1.0.0
---
body`;
    const { frontmatter } = parseYamlFrontmatter(input);
    expect(frontmatter.license).toBe('MIT');
    expect(frontmatter.compatibility).toEqual(['gemini-2.5-pro']);
    expect(frontmatter.metadata).toEqual({
      tags: ['code', 'review'],
      version: '1.0.0',
    });
  });

  it('parses folded block scalar >-', () => {
    const input = `---
name: playwright-runner
description: >-
  Automate browser interactions using Playwright.
  Use when the user asks to navigate websites,
  take screenshots, or fill forms.
allowed-tools: Bash(python *)
---
body content`;
    const { frontmatter, body } = parseYamlFrontmatter(input);
    expect(frontmatter.name).toBe('playwright-runner');
    expect(frontmatter.description).toBe(
      'Automate browser interactions using Playwright. Use when the user asks to navigate websites, take screenshots, or fill forms.',
    );
    expect(frontmatter['allowed-tools']).toBe('Bash(python *)');
    expect(body).toBe('body content');
  });

  it('parses literal block scalar |', () => {
    const input = `---
name: test
instructions: |
  Line one
  Line two
  Line three
---
body`;
    const { frontmatter } = parseYamlFrontmatter(input);
    expect(frontmatter.instructions).toBe('Line one\nLine two\nLine three');
  });

  it('parses folded block scalar > (without strip)', () => {
    const input = `---
description: >
  First part of description.
  Second part of description.
name: test
---
body`;
    const { frontmatter } = parseYamlFrontmatter(input);
    expect(frontmatter.description).toBe('First part of description. Second part of description.');
    expect(frontmatter.name).toBe('test');
  });

  it('parses block scalar at end of frontmatter', () => {
    const input = `---
name: test
description: >-
  This is the last field.
  It ends at the closing marker.
---
body`;
    const { frontmatter } = parseYamlFrontmatter(input);
    expect(frontmatter.description).toBe('This is the last field. It ends at the closing marker.');
  });
});

/* ═══════════════════════════════════════════════
   YAML Frontmatter Serializer
   ═══════════════════════════════════════════════ */

describe('serializeYamlFrontmatter', () => {
  it('serializes basic key-value pairs', () => {
    const result = serializeYamlFrontmatter({
      name: 'deploy',
      description: 'Deploy to production',
    });
    expect(result).toBe('---\nname: deploy\ndescription: Deploy to production\n---');
  });

  it('serializes booleans and numbers', () => {
    const result = serializeYamlFrontmatter({
      'user-invocable': true,
      'disable-model-invocation': false,
      timeout: 30,
    });
    expect(result).toContain('user-invocable: true');
    expect(result).toContain('disable-model-invocation: false');
    expect(result).toContain('timeout: 30');
  });

  it('serializes arrays in flow style', () => {
    const result = serializeYamlFrontmatter({
      'allowed-tools': ['Bash', 'Read', 'Grep'],
    });
    expect(result).toContain('allowed-tools: [Bash, Read, Grep]');
  });

  it('quotes strings containing special chars', () => {
    const result = serializeYamlFrontmatter({
      description: 'Deploy to env: production',
    });
    expect(result).toContain('description: "Deploy to env: production"');
  });

  it('serializes nested objects', () => {
    const result = serializeYamlFrontmatter({
      metadata: { tags: ['devops'], version: '1.0.0' },
    });
    expect(result).toContain('metadata:');
    expect(result).toContain('  tags: [devops]');
    expect(result).toContain('  version: 1.0.0');
  });

  it('skips null and undefined values', () => {
    const result = serializeYamlFrontmatter({
      name: 'test',
      description: null,
      extra: undefined,
    });
    expect(result).toContain('name: test');
    expect(result).not.toContain('description');
    expect(result).not.toContain('extra');
  });

  it('has --- delimiters', () => {
    const result = serializeYamlFrontmatter({ name: 'test' });
    expect(result.startsWith('---\n')).toBe(true);
    expect(result.endsWith('\n---')).toBe(true);
  });

  it('roundtrips with parser', () => {
    const original = {
      name: 'deploy',
      description: 'Deploy to prod',
      'user-invocable': true,
      'allowed-tools': ['Bash', 'Read'],
      timeout: 30,
    };
    const serialized = serializeYamlFrontmatter(original);
    const { frontmatter } = parseYamlFrontmatter(`${serialized}\nbody content`);
    expect(frontmatter.name).toBe('deploy');
    expect(frontmatter.description).toBe('Deploy to prod');
    expect(frontmatter['user-invocable']).toBe(true);
    expect(frontmatter['allowed-tools']).toEqual(['Bash', 'Read']);
    expect(frontmatter.timeout).toBe(30);
  });
});
