import { describe, expect, it } from 'vitest';
import { maskTokens, sanitize, stripAnsi, stripControlChars, wrapForMrkdwn } from './sanitize.js';

describe('stripAnsi', () => {
  it('removes ANSI color codes', () => {
    expect(stripAnsi('\x1B[31mred text\x1B[0m')).toBe('red text');
  });

  it('removes cursor movement codes', () => {
    expect(stripAnsi('\x1B[2Jhello\x1B[H')).toBe('hello');
  });

  it('passes through plain text', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });
});

describe('maskTokens', () => {
  it('masks Slack bot tokens', () => {
    expect(maskTokens('token: xoxb-123-456-abcdef')).toBe('token: [REDACTED]');
  });

  it('masks Slack app tokens', () => {
    expect(maskTokens('xapp-1-A123-456-abcdef')).toBe('[REDACTED]');
  });

  it('masks OpenAI API keys', () => {
    expect(maskTokens('sk-abcdefghijklmnopqrstuvwxyz1234567890')).toBe('[REDACTED]');
  });

  it('masks Google API keys', () => {
    expect(maskTokens('AIzaSyAbcdefghijklmnopqrstuvwxyz1234567')).toBe('[REDACTED]');
  });

  it('does not modify regular text', () => {
    expect(maskTokens('hello world')).toBe('hello world');
  });

  it('masks registry-backed secret keys in env-style output', () => {
    expect(maskTokens('AWS_SECRET_ACCESS_KEY=abcd1234')).toBe('AWS_SECRET_ACCESS_KEY=[REDACTED]');
  });

  it('masks registry-backed secret keys in JSON-style output', () => {
    expect(maskTokens('{"AZURE_CLIENT_SECRET":"secret-value"}')).toBe(
      '{"AZURE_CLIENT_SECRET":"[REDACTED]"}',
    );
  });
});

describe('stripControlChars', () => {
  it('strips null bytes', () => {
    expect(stripControlChars('hello\x00world')).toBe('helloworld');
  });

  it('strips BEL and other C0 control chars', () => {
    expect(stripControlChars('a\x07b\x01c\x7Fd')).toBe('abcd');
  });

  it('preserves tab, newline, carriage return', () => {
    expect(stripControlChars('line1\nline2\ttab\r')).toBe('line1\nline2\ttab\r');
  });

  it('passes through normal text unchanged', () => {
    expect(stripControlChars('hello world')).toBe('hello world');
  });
});

describe('wrapForMrkdwn', () => {
  it('wraps single-line text in inline code', () => {
    expect(wrapForMrkdwn('file not found')).toBe('`file not found`');
  });

  it('wraps multi-line text in code block', () => {
    expect(wrapForMrkdwn('line1\nline2')).toBe('```\nline1\nline2\n```');
  });

  it('replaces backticks with fullwidth variant in single-line', () => {
    expect(wrapForMrkdwn('unexpected token `')).toBe('`unexpected token \uFF40`');
  });

  it('replaces triple backticks in multi-line to prevent breakout', () => {
    const input = 'code:\n```\nfoo\n```';
    const result = wrapForMrkdwn(input);
    expect(result).toBe("```\ncode:\n'''\nfoo\n'''\n```");
  });

  it('handles mrkdwn special chars safely in single-line', () => {
    // *bold*, _italic_, ~strike~ should be neutralized inside inline code
    expect(wrapForMrkdwn('*bold* and _italic_')).toBe('`*bold* and _italic_`');
  });

  it('returns placeholder for empty string', () => {
    expect(wrapForMrkdwn('')).toBe('`(empty)`');
  });
});

describe('sanitize', () => {
  it('strips ANSI and masks tokens', () => {
    const input = '\x1B[32mkey: xoxb-123-456-abcdef\x1B[0m';
    expect(sanitize(input)).toBe('key: [REDACTED]');
  });

  it('strips control characters as part of full pipeline', () => {
    const input = '\x1B[31mhello\x00\x07world\x1B[0m';
    expect(sanitize(input)).toBe('helloworld');
  });
});
