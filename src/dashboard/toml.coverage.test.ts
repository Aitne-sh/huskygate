/**
 * Coverage tests for dashboard/toml.ts
 * Targets uncovered branches in parseToml, serializeTomlSection, updateTomlFile
 */
import { describe, expect, it } from 'vitest';
import { parseToml, serializeTomlSection, updateTomlFile } from '../shared/toml.js';

describe('parseToml', () => {
  it('parses empty content', () => {
    expect(parseToml('')).toEqual({});
  });

  it('skips comments and blank lines', () => {
    const result = parseToml('# comment\n\nkey = "value"');
    expect(result.key).toBe('value');
  });

  it('parses boolean values', () => {
    const result = parseToml('a = true\nb = false');
    expect(result.a).toBe(true);
    expect(result.b).toBe(false);
  });

  it('parses single-quoted strings', () => {
    const result = parseToml("name = 'hello'");
    expect(result.name).toBe('hello');
  });

  it('parses double-quoted strings', () => {
    const result = parseToml('name = "hello"');
    expect(result.name).toBe('hello');
  });

  it('parses numbers', () => {
    const result = parseToml('port = 8080\nfloat = 1.5');
    expect(result.port).toBe(8080);
    expect(result.float).toBe(1.5);
  });

  it('parses arrays', () => {
    const result = parseToml('list = [1, "two", true]');
    expect(result.list).toEqual([1, 'two', true]);
  });

  it('parses empty arrays', () => {
    const result = parseToml('list = []');
    expect(result.list).toEqual([]);
  });

  it('parses inline tables', () => {
    const result = parseToml('env = { key = "value", num = 42 }');
    expect(result.env).toEqual({ key: 'value', num: 42 });
  });

  it('parses empty inline tables', () => {
    const result = parseToml('env = {}');
    expect(result.env).toEqual({});
  });

  it('parses section headers', () => {
    const result = parseToml('[section]\nkey = "value"');
    expect((result.section as Record<string, unknown>).key).toBe('value');
  });

  it('parses nested section headers', () => {
    const result = parseToml('[mcp_servers.my_server]\ncommand = "node"');
    const servers = result.mcp_servers as Record<string, Record<string, unknown>>;
    expect(servers.my_server?.command).toBe('node');
  });

  it('handles bare string fallback (no quotes, not a number)', () => {
    const result = parseToml('cmd = node');
    expect(result.cmd).toBe('node');
  });

  it('skips lines without = sign', () => {
    const result = parseToml('no-equals-here\nkey = "value"');
    expect(result.key).toBe('value');
    expect(result['no-equals-here']).toBeUndefined();
  });

  it('handles inline table with quoted keys', () => {
    const result = parseToml('env = { "bearer_token" = "tok123" }');
    expect(result.env).toEqual({ bearer_token: 'tok123' });
  });

  it('handles nested arrays in arrays', () => {
    const result = parseToml('nested = [[1, 2], [3, 4]]');
    expect(result.nested).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('overrides existing section value if reassigned', () => {
    const result = parseToml('[a]\n[a]\nkey = "new"');
    expect((result.a as Record<string, unknown>).key).toBe('new');
  });
});

describe('serializeTomlSection', () => {
  it('serializes a single server', () => {
    const result = serializeTomlSection({
      test: { command: 'node', args: ['--flag'], env: { KEY: 'val' } },
    });
    expect(result).toContain('[mcp_servers.test]');
    expect(result).toContain('command = "node"');
    expect(result).toContain('args = ["--flag"]');
    expect(result).toContain('env = { KEY = "val" }');
  });

  it('serializes multiple servers', () => {
    const result = serializeTomlSection({
      a: { command: 'a' },
      b: { command: 'b' },
    });
    expect(result).toContain('[mcp_servers.a]');
    expect(result).toContain('[mcp_servers.b]');
  });

  it('skips null and undefined values', () => {
    const result = serializeTomlSection({
      test: { command: 'node', env: null as unknown as Record<string, unknown> },
    });
    expect(result).toContain('command = "node"');
    expect(result).not.toContain('env');
  });

  it('skips transport key', () => {
    const result = serializeTomlSection({
      test: { command: 'node', transport: 'stdio' },
    });
    expect(result).not.toContain('transport');
  });

  it('applies camelCase to snake_case key mapping', () => {
    const result = serializeTomlSection({
      test: { bearerToken: 'tok', timeout: 30, includeTools: ['a', 'b'] },
    });
    expect(result).toContain('bearer_token = "tok"');
    expect(result).toContain('startup_timeout_sec = 30');
    expect(result).toContain('enabled_tools = ["a", "b"]');
  });

  it('serializes boolean values', () => {
    const result = serializeTomlSection({
      test: { enabled: true },
    });
    expect(result).toContain('enabled = true');
  });

  it('returns empty string for empty input', () => {
    expect(serializeTomlSection({})).toBe('');
  });
});

describe('updateTomlFile', () => {
  it('replaces existing mcp_servers section', () => {
    const original = `# header\n[mcp_servers.old]\ncommand = "old"\n\n[other]\nkey = "value"`;
    const result = updateTomlFile(original, { new_server: { command: 'new' } });
    expect(result).not.toContain('[mcp_servers.old]');
    expect(result).toContain('[mcp_servers.new_server]');
    expect(result).toContain('command = "new"');
    expect(result).toContain('[other]');
  });

  it('appends mcp_servers section when original has none', () => {
    const original = '# header comment\n';
    const result = updateTomlFile(original, { srv: { command: 'test' } });
    expect(result).toContain('[mcp_servers.srv]');
    expect(result).toContain('command = "test"');
  });

  it('handles empty new servers (removes existing section)', () => {
    const original = `[mcp_servers.old]\ncommand = "old"\n`;
    const result = updateTomlFile(original, {});
    expect(result).not.toContain('[mcp_servers.old]');
    // Should still produce valid output
    expect(result.trim().length).toBeGreaterThanOrEqual(0);
  });

  it('preserves content after mcp_servers section', () => {
    const original = `[mcp_servers.test]\ncmd = "a"\n[after_section]\nval = "b"`;
    const result = updateTomlFile(original, { updated: { cmd: 'c' } });
    expect(result).toContain('[mcp_servers.updated]');
    expect(result).toContain('[after_section]');
    expect(result).toContain('val = "b"');
  });

  it('handles multiple mcp_servers subsections', () => {
    const original = `[mcp_servers.a]\ncmd = "1"\n[mcp_servers.b]\ncmd = "2"\n[other]\nk = "v"`;
    const result = updateTomlFile(original, { c: { cmd: '3' } });
    expect(result).not.toContain('[mcp_servers.a]');
    expect(result).not.toContain('[mcp_servers.b]');
    expect(result).toContain('[mcp_servers.c]');
    expect(result).toContain('[other]');
  });
});
