/**
 * Additional coverage tests for dashboard utility modules.
 * Covers remaining uncovered lines in: toml.ts, yaml.ts, http.ts, skills.ts
 */
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readBinaryBody, readLogLines, readMergedLogLines } from './http.js';
import { listSkills, resolveSkillsDir } from './skills.js';
import { parseToml, serializeTomlSection, updateTomlFile } from '../shared/toml.js';
import { parseYamlFrontmatter, serializeYamlFrontmatter } from '../shared/yaml.js';

describe('toml.ts — additional coverage', () => {
  it('parseToml handles inline tables', () => {
    const result = parseToml('[section]\nkey = { a = 1, b = "hello" }');
    expect(result.section).toEqual({ key: { a: 1, b: 'hello' } });
  });

  it('parseToml handles empty inline table', () => {
    const result = parseToml('[s]\nkey = {}');
    expect(result.s).toEqual({ key: {} });
  });

  it('parseToml handles arrays', () => {
    const result = parseToml('[s]\nkey = [1, 2, 3]');
    expect(result.s).toEqual({ key: [1, 2, 3] });
  });

  it('parseToml handles boolean and string values', () => {
    const result = parseToml('a = true\nb = false\nc = "hello"\nd = 42');
    expect(result).toEqual({ a: true, b: false, c: 'hello', d: 42 });
  });

  it('parseToml handles single-quoted strings', () => {
    const result = parseToml("key = 'value'");
    expect(result.key).toBe('value');
  });

  it('parseToml handles comments and empty lines', () => {
    const result = parseToml('# comment\n\nkey = 1');
    expect(result.key).toBe(1);
  });

  it('parseToml handles nested sections', () => {
    const result = parseToml('[a.b]\nkey = "val"');
    expect(result.a).toEqual({ b: { key: 'val' } });
  });

  it('parseToml handles lines without = sign', () => {
    const result = parseToml('no-equals-line\nkey = 1');
    expect(result.key).toBe(1);
  });

  it('parseToml handles empty arrays', () => {
    const result = parseToml('key = []');
    expect(result.key).toEqual([]);
  });

  it('parseToml handles bare string values', () => {
    const result = parseToml('key = bare_string');
    expect(result.key).toBe('bare_string');
  });

  it('parseToml handles empty string number edge case', () => {
    // non-numeric string should be returned as-is
    const result = parseToml('key = not_a_number');
    expect(result.key).toBe('not_a_number');
  });

  it('serializeTomlSection handles multiple servers', () => {
    const result = serializeTomlSection({
      srv1: { command: 'echo', args: ['a', 'b'] },
      srv2: { url: 'http://localhost', transport: 'sse' },
    });
    expect(result).toContain('[mcp_servers.srv1]');
    expect(result).toContain('[mcp_servers.srv2]');
    // transport is skipped
    expect(result).not.toContain('transport');
  });

  it('serializeTomlSection skips null/undefined values', () => {
    const result = serializeTomlSection({
      srv: { command: 'echo', nullField: null, undefinedField: undefined },
    });
    expect(result).not.toContain('nullField');
    expect(result).not.toContain('undefinedField');
  });

  it('serializeTomlSection applies camelToSnake mapping', () => {
    const result = serializeTomlSection({
      srv: { bearerToken: 'secret', httpHeaders: { a: 'b' } },
    });
    expect(result).toContain('bearer_token');
    expect(result).toContain('http_headers');
  });

  it('updateTomlFile replaces mcp_servers sections', () => {
    const original = `# Config
[settings]
key = "val"

[mcp_servers.old]
command = "old"

[other]
key2 = "val2"
`;
    const result = updateTomlFile(original, {
      new_srv: { command: 'new' },
    });
    expect(result).toContain('[mcp_servers.new_srv]');
    expect(result).not.toContain('[mcp_servers.old]');
    expect(result).toContain('[settings]');
    expect(result).toContain('[other]');
  });

  it('updateTomlFile handles file with no mcp_servers section', () => {
    const result = updateTomlFile('[settings]\nkey = 1\n', {});
    expect(result).toContain('[settings]');
  });
});

describe('yaml.ts — additional coverage', () => {
  it('parseYamlFrontmatter handles block scalar literal (|)', () => {
    const content = `---
desc: |
  line1
  line2
---
body content`;
    const { frontmatter, body } = parseYamlFrontmatter(content);
    expect(frontmatter.desc).toBe('line1\nline2');
    expect(body).toContain('body content');
  });

  it('parseYamlFrontmatter handles block scalar at end without closing line', () => {
    const content = `---
desc: |
  only-line
---`;
    const { frontmatter } = parseYamlFrontmatter(content);
    expect(frontmatter.desc).toBe('only-line');
  });

  it('parseYamlFrontmatter handles folded block scalar (>)', () => {
    const content = `---
desc: >
  line1
  line2
---
body`;
    const { frontmatter } = parseYamlFrontmatter(content);
    expect(frontmatter.desc).toBe('line1 line2');
  });

  it('parseYamlFrontmatter handles block scalar indicators >- and |+', () => {
    const content = `---
a: >-
  folded
b: |+
  literal
---`;
    const { frontmatter } = parseYamlFrontmatter(content);
    expect(frontmatter.a).toBe('folded');
    expect(frontmatter.b).toBe('literal');
  });

  it('serializeYamlFrontmatter handles nested objects with arrays', () => {
    const result = serializeYamlFrontmatter({
      meta: { tags: ['a', 'b'] },
    });
    expect(result).toContain('meta:');
    expect(result).toContain('tags: [a, b]');
  });

  it('serializeYamlFrontmatter handles null/undefined values', () => {
    const result = serializeYamlFrontmatter({
      a: null,
      b: undefined,
      c: 'kept',
    });
    expect(result).not.toContain('a:');
    expect(result).not.toContain('b:');
    expect(result).toContain('c: kept');
  });
});

describe('http.ts — additional coverage', () => {
  it('readBinaryBody resolves with buffer on success', async () => {
    const req = new EventEmitter() as IncomingMessage;
    const promise = readBinaryBody(req, 1024);
    req.emit('data', Buffer.from('hello'));
    req.emit('end');
    const result = await promise;
    expect(result.toString()).toBe('hello');
  });

  it('readBinaryBody rejects when body exceeds max', async () => {
    const req = new EventEmitter() as IncomingMessage;
    req.destroy = vi.fn();
    const promise = readBinaryBody(req, 5);
    req.emit('data', Buffer.from('toolarge'));
    await expect(promise).rejects.toThrow('File too large');
  });

  it('readBinaryBody rejects on error event', async () => {
    const req = new EventEmitter() as IncomingMessage;
    const promise = readBinaryBody(req, 1024);
    req.emit('error', new Error('stream error'));
    await expect(promise).rejects.toThrow('stream error');
  });

  it('readLogLines returns empty for non-existent file', () => {
    const result = readLogLines('/tmp/nonexistent-file-xyz.log', 100, 0);
    expect(result.lines).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('readMergedLogLines merges two empty files', () => {
    const result = readMergedLogLines('/tmp/nonexistent1.log', '/tmp/nonexistent2.log', 100, 0);
    expect(result.lines).toEqual([]);
  });
});

describe('skills.ts — additional coverage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'skills-cov-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolveSkillsDir returns project scope paths', () => {
    const claudeDir = resolveSkillsDir('claude', 'project', tmpDir);
    expect(claudeDir).toContain('.huskygate');

    const geminiDir = resolveSkillsDir('gemini', 'project', tmpDir);
    expect(geminiDir).toContain('.huskygate');

    const codexDir = resolveSkillsDir('codex', 'project', tmpDir);
    expect(codexDir).toContain('.huskygate');
  });

  it('listSkills returns empty when dir does not exist', () => {
    const skills = listSkills('claude', 'project', '/tmp/nonexistent-dir-xyz');
    expect(skills).toEqual([]);
  });

  it('listSkills returns skills from directory', () => {
    const skillsDir = resolveSkillsDir('claude', 'project', tmpDir);
    const skillDir = join(skillsDir, 'test-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.claude.md'),
      '---\ndescription: test skill\n---\nbody',
      'utf-8',
    );

    const skills = listSkills('claude', 'project', tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe('test-skill');
    expect(skills[0]?.description).toBe('test skill');
  });

  it('listSkills skips directories without SKILL.<tool>.md', () => {
    const skillsDir = resolveSkillsDir('claude', 'project', tmpDir);
    mkdirSync(join(skillsDir, 'empty-dir'), { recursive: true });

    const skills = listSkills('claude', 'project', tmpDir);
    expect(skills).toEqual([]);
  });
});
