/**
 * Coverage tests for dashboard/yaml.ts
 * Targets uncovered branches: block scalars, edge cases in parsing and serializing
 */
import { describe, expect, it } from 'vitest';
import { parseYamlFrontmatter, serializeYamlFrontmatter } from '../shared/yaml.js';

describe('parseYamlFrontmatter', () => {
  it('returns raw content when no frontmatter delimiter', () => {
    const result = parseYamlFrontmatter('Just some text');
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe('Just some text');
  });

  it('returns raw content when closing --- is missing', () => {
    const result = parseYamlFrontmatter('---\nkey: value\nno closing');
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe('---\nkey: value\nno closing');
  });

  it('parses basic key-value pairs', () => {
    const result = parseYamlFrontmatter('---\nname: test\ndescription: a skill\n---\nbody content');
    expect(result.frontmatter.name).toBe('test');
    expect(result.frontmatter.description).toBe('a skill');
    expect(result.body).toBe('body content');
  });

  it('parses boolean values', () => {
    const result = parseYamlFrontmatter('---\nenabled: true\ndisabled: false\n---\n');
    expect(result.frontmatter.enabled).toBe(true);
    expect(result.frontmatter.disabled).toBe(false);
  });

  it('parses null values (null, ~, empty)', () => {
    const result = parseYamlFrontmatter('---\na: null\nb: ~\nc:\n---\n');
    expect(result.frontmatter.a).toBeNull();
    expect(result.frontmatter.b).toBeNull();
    // c has empty value → key with no indented children → stays undefined via no assignment
  });

  it('parses quoted strings', () => {
    const result = parseYamlFrontmatter('---\na: "hello"\nb: \'world\'\n---\n');
    expect(result.frontmatter.a).toBe('hello');
    expect(result.frontmatter.b).toBe('world');
  });

  it('parses flow-style arrays', () => {
    const result = parseYamlFrontmatter('---\ntags: [a, b, c]\n---\n');
    expect(result.frontmatter.tags).toEqual(['a', 'b', 'c']);
  });

  it('parses empty flow-style arrays', () => {
    const result = parseYamlFrontmatter('---\ntags: []\n---\n');
    expect(result.frontmatter.tags).toEqual([]);
  });

  it('parses flow-style arrays with simple items', () => {
    const result = parseYamlFrontmatter('---\ntags: [hello, foo]\n---\n');
    expect(result.frontmatter.tags).toEqual(['hello', 'foo']);
  });

  it('parses numbers', () => {
    const result = parseYamlFrontmatter('---\nport: 8080\npi: 3.14\n---\n');
    expect(result.frontmatter.port).toBe(8080);
    expect(result.frontmatter.pi).toBe(3.14);
  });

  it('parses block-style arrays (- items)', () => {
    const result = parseYamlFrontmatter('---\nitems:\n  - alpha\n  - beta\n  - 42\n---\n');
    expect(result.frontmatter.items).toEqual(['alpha', 'beta', 42]);
  });

  it('parses nested objects', () => {
    const result = parseYamlFrontmatter('---\nconfig:\n  host: localhost\n  port: 3000\n---\n');
    expect(result.frontmatter.config).toEqual({ host: 'localhost', port: 3000 });
  });

  it('parses nested object with null sub-value', () => {
    const result = parseYamlFrontmatter('---\nconfig:\n  host:\n---\n');
    expect(result.frontmatter.config).toEqual({ host: null });
  });

  it('skips comments in frontmatter', () => {
    const result = parseYamlFrontmatter('---\n# comment\nname: test\n---\n');
    expect(result.frontmatter.name).toBe('test');
  });

  it('skips blank lines in frontmatter', () => {
    const result = parseYamlFrontmatter('---\nname: test\n\ndesc: ok\n---\n');
    expect(result.frontmatter.name).toBe('test');
    expect(result.frontmatter.desc).toBe('ok');
  });

  it('parses folded block scalar (>)', () => {
    const result = parseYamlFrontmatter('---\nsummary: >\n  line one\n  line two\n---\nbody');
    expect(result.frontmatter.summary).toBe('line one line two');
    expect(result.body).toBe('body');
  });

  it('parses literal block scalar (|)', () => {
    const result = parseYamlFrontmatter('---\nsummary: |\n  line one\n  line two\n---\nbody');
    expect(result.frontmatter.summary).toBe('line one\nline two');
    expect(result.body).toBe('body');
  });

  it('parses folded block scalar with strip indicator (>-)', () => {
    const result = parseYamlFrontmatter('---\ndesc: >-\n  hello\n  world\n---\n');
    expect(result.frontmatter.desc).toBe('hello world');
  });

  it('parses literal block scalar with keep indicator (|+)', () => {
    const result = parseYamlFrontmatter('---\ndesc: |+\n  keep\n  newlines\n---\n');
    expect(result.frontmatter.desc).toBe('keep\nnewlines');
  });

  it('flushes block scalar at end of frontmatter', () => {
    const result = parseYamlFrontmatter('---\ndesc: >\n  last line\n---\nbody');
    expect(result.frontmatter.desc).toBe('last line');
  });

  it('handles block scalar followed by another key', () => {
    const result = parseYamlFrontmatter('---\ndesc: >\n  folded text\nname: test\n---\n');
    expect(result.frontmatter.desc).toBe('folded text');
    expect(result.frontmatter.name).toBe('test');
  });

  it('handles value that looks like array but brackets unbalanced', () => {
    // e.g. "[not closed"
    const result = parseYamlFrontmatter('---\nval: [not closed\n---\n');
    // The flow array detection should not match since ] is missing
    expect(result.frontmatter.val).toBe('[not closed');
  });

  it('handles negative numbers', () => {
    const result = parseYamlFrontmatter('---\noffset: -5\n---\n');
    expect(result.frontmatter.offset).toBe(-5);
  });

  it('treats non-numeric strings as bare strings', () => {
    const result = parseYamlFrontmatter('---\nhash: abc123\n---\n');
    expect(result.frontmatter.hash).toBe('abc123');
  });

  it('skips lines without colon at top level', () => {
    const result = parseYamlFrontmatter('---\nno-colon-line\nname: test\n---\n');
    expect(result.frontmatter.name).toBe('test');
  });
});

describe('serializeYamlFrontmatter', () => {
  it('serializes basic types', () => {
    const result = serializeYamlFrontmatter({
      name: 'test',
      enabled: true,
      count: 42,
    });
    expect(result).toContain('name: test');
    expect(result).toContain('enabled: true');
    expect(result).toContain('count: 42');
    expect(result).toMatch(/^---\n/);
    expect(result).toMatch(/\n---$/);
  });

  it('skips null and undefined values', () => {
    const result = serializeYamlFrontmatter({
      a: null,
      b: undefined,
      c: 'kept',
    });
    expect(result).not.toContain('a:');
    expect(result).not.toContain('b:');
    expect(result).toContain('c: kept');
  });

  it('quotes strings with special characters', () => {
    const result = serializeYamlFrontmatter({
      a: 'has:colon',
      b: 'has#hash',
      c: 'has"double',
      d: "has'single",
    });
    expect(result).toContain('a: "has:colon"');
    expect(result).toContain('b: "has#hash"');
    expect(result).toContain('c: "has\\"double"');
    expect(result).toContain('d: "has\'single"');
  });

  it('serializes arrays', () => {
    const result = serializeYamlFrontmatter({ tags: ['a', 'b', 'c'] });
    expect(result).toContain('tags: [a, b, c]');
  });

  it('quotes array items with commas or quotes', () => {
    const result = serializeYamlFrontmatter({ tags: ['a,b', 'c"d'] });
    expect(result).toContain('"a,b"');
    expect(result).toContain('"c\\"d"');
  });

  it('serializes nested objects', () => {
    const result = serializeYamlFrontmatter({
      config: { host: 'localhost', port: 3000 },
    });
    expect(result).toContain('config:');
    expect(result).toContain('  host: localhost');
    expect(result).toContain('  port: 3000');
  });

  it('skips null/undefined in nested objects', () => {
    const result = serializeYamlFrontmatter({
      config: { a: null, b: undefined, c: 'ok' },
    });
    expect(result).not.toContain('  a:');
    expect(result).not.toContain('  b:');
    expect(result).toContain('  c: ok');
  });

  it('serializes nested arrays in objects', () => {
    const result = serializeYamlFrontmatter({
      config: { items: [1, 2, 3] },
    });
    expect(result).toContain('  items: [1, 2, 3]');
  });

  it('serializes arrays with non-string items as strings', () => {
    const result = serializeYamlFrontmatter({ tags: [1, true, null] });
    expect(result).toContain('tags: [1, true, null]');
  });

  it('returns just delimiters for empty object', () => {
    const result = serializeYamlFrontmatter({});
    expect(result).toBe('---\n---');
  });
});
