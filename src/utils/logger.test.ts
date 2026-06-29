import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScopedLogger, logger, setLogLevel, setShowStacks } from './logger.js';

const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

afterEach(() => {
  stdoutWrite.mockClear();
  stderrWrite.mockClear();
  setLogLevel('info');
  setShowStacks(false);
});

describe('logger', () => {
  it('writes info logs to stdout by default', () => {
    logger.info('hello', { a: 1 });

    expect(stdoutWrite).toHaveBeenCalledTimes(1);
    expect(stderrWrite).not.toHaveBeenCalled();
    const payload = String(stdoutWrite.mock.calls[0]?.[0]).trim();
    const parsed = JSON.parse(payload) as { level: string; msg: string; a: number };
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello');
    expect(parsed.a).toBe(1);
  });

  it('suppresses debug logs when level is info', () => {
    logger.debug('hidden');
    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it('writes debug logs when level is set to debug', () => {
    setLogLevel('debug');
    logger.debug('visible');
    expect(stdoutWrite).toHaveBeenCalledTimes(1);
  });

  it('writes error logs to stderr', () => {
    logger.error('boom', { reason: 'test' });
    expect(stderrWrite).toHaveBeenCalledTimes(1);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('sanitizes secret values before writing', () => {
    logger.info('secret', { AWS_SECRET_ACCESS_KEY: 'abcd1234' });

    const payload = String(stdoutWrite.mock.calls[0]?.[0]).trim();
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    expect(parsed.AWS_SECRET_ACCESS_KEY).toBe('[REDACTED]');
  });

  it('omits stack traces by default', () => {
    logger.error('boom', { stack: 'Error: sk-abcdefghijklmnopqrstuvwxyz1234567890' });

    const payload = String(stderrWrite.mock.calls[0]?.[0]).trim();
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    expect(parsed.stack).toBeUndefined();
  });

  it('includes sanitized stack traces in debug mode', () => {
    setLogLevel('debug');
    logger.error('boom', { stack: 'Error: sk-abcdefghijklmnopqrstuvwxyz1234567890' });

    const payload = String(stderrWrite.mock.calls[0]?.[0]).trim();
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    expect(parsed.stack).toBe('Error: [REDACTED]');
  });

  it('includes stack traces when setShowStacks is enabled', () => {
    setShowStacks(true);
    logger.error('boom', { stack: 'Error: something' });

    const payload = String(stderrWrite.mock.calls[0]?.[0]).trim();
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    expect(parsed.stack).toBeDefined();
  });

  it('scoped logger merges context with payload', () => {
    setLogLevel('debug');
    const scoped = createScopedLogger({ session: 'S1', tool: 'claude' });
    scoped.info('run', { step: 'init' });

    const payload = String(stdoutWrite.mock.calls[0]?.[0]).trim();
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    expect(parsed.msg).toBe('run');
    expect(parsed.session).toBe('S1');
    expect(parsed.tool).toBe('claude');
    expect(parsed.step).toBe('init');
  });

  it('scoped logger emits debug/warn/error paths', () => {
    setLogLevel('debug');
    const scoped = createScopedLogger({ session: 'S2' });

    scoped.debug('dbg');
    scoped.warn('warn');
    scoped.error('err');

    expect(stdoutWrite).toHaveBeenCalledTimes(2);
    expect(stderrWrite).toHaveBeenCalledTimes(1);
  });

  it('falls back when JSON serialization fails', () => {
    setLogLevel('debug');
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    logger.info('serialize-fail', circular);

    expect(stdoutWrite).toHaveBeenCalledTimes(1);
    const payload = String(stdoutWrite.mock.calls[0]?.[0]).trim();
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('serialize-fail');
    expect(parsed.error).toBe('log_serialization_failed');
  });
});
