/** @module logger — Structured JSON logging with level filtering and sanitization. */
import type { LogLevel } from '../config.js';
import { sanitize } from './sanitize.js';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';
let showStacks = false;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/** Enable or disable stack trace inclusion in log output. */
export function setShowStacks(enabled: boolean): void {
  showStacks = enabled;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function shouldIncludeStack(): boolean {
  return currentLevel === 'debug' || showStacks;
}

function filterLogData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined;
  if (shouldIncludeStack() || !('stack' in data)) return data;
  const { stack: _stack, ...rest } = data;
  return rest;
}

function serializeStructuredLog(
  level: string,
  msg: string,
  data?: Record<string, unknown>,
): string {
  const ts = new Date().toISOString();
  try {
    return sanitize(
      JSON.stringify({
        ...filterLogData(data),
        level,
        ts,
        msg,
      }),
    );
  } catch {
    return sanitize(
      JSON.stringify({
        level,
        ts,
        msg,
        error: 'log_serialization_failed',
      }),
    );
  }
}

export function writeStructuredLog(
  level: string,
  msg: string,
  data?: Record<string, unknown>,
): void {
  const output = serializeStructuredLog(level, msg, data);
  if (level === 'error') {
    process.stderr.write(`${output}\n`);
  } else {
    process.stdout.write(`${output}\n`);
  }
}

function emit(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  writeStructuredLog(level, msg, data);
}

/** Default application logger emitting sanitized JSON to stdout/stderr. */
export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => emit('debug', msg, data),
  info: (msg: string, data?: Record<string, unknown>) => emit('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => emit('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => emit('error', msg, data),
};

export type Logger = typeof logger;

/** Create a logger that merges static context fields into every log entry. */
export function createScopedLogger(context: Record<string, unknown>): Logger {
  return {
    debug: (msg, data) => emit('debug', msg, { ...context, ...data }),
    info: (msg, data) => emit('info', msg, { ...context, ...data }),
    warn: (msg, data) => emit('warn', msg, { ...context, ...data }),
    error: (msg, data) => emit('error', msg, { ...context, ...data }),
  };
}
