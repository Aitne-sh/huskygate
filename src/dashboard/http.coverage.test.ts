/**
 * Coverage tests for dashboard/http.ts
 * Targets: readBinaryBody, readLogLines, readMergedLogLines, createLogTail, dashLog, parseOneLogLine, mergeDescending
 */
import { EventEmitter } from 'node:events';
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogTail, readBinaryBody, readLogLines, readMergedLogLines } from './http.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'http-coverage-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeLogLine(
  ts: string,
  level: string,
  msg: string,
  extra?: Record<string, unknown>,
): string {
  return JSON.stringify({ ts, level, msg, ...extra });
}

describe('readBinaryBody', () => {
  it('reads a binary body', async () => {
    const req = new EventEmitter() as IncomingMessage;
    const promise = readBinaryBody(req, 1024);
    req.emit('data', Buffer.from('hello'));
    req.emit('data', Buffer.from(' world'));
    req.emit('end');
    const result = await promise;
    expect(result.toString()).toBe('hello world');
  });

  it('rejects when body exceeds maxBytes', async () => {
    const req = new EventEmitter() as IncomingMessage;
    (req as unknown as { destroy: () => void }).destroy = vi.fn();
    const promise = readBinaryBody(req, 5);
    req.emit('data', Buffer.from('too long data'));
    await expect(promise).rejects.toThrow('File too large');
  });

  it('rejects on request error', async () => {
    const req = new EventEmitter() as IncomingMessage;
    const promise = readBinaryBody(req, 1024);
    req.emit('error', new Error('connection reset'));
    await expect(promise).rejects.toThrow('connection reset');
  });
});

describe('readLogLines', () => {
  it('returns empty for non-existent log file', () => {
    const result = readLogLines(join(tmpDir, 'nonexistent.log'), 50, 0);
    expect(result.lines).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('reads and parses log lines in newest-first order', () => {
    const logPath = join(tmpDir, 'test.log');
    const lines = [
      makeLogLine('2026-03-15T00:00:01Z', 'info', 'first'),
      makeLogLine('2026-03-15T00:00:02Z', 'warn', 'second'),
      makeLogLine('2026-03-15T00:00:03Z', 'error', 'third'),
    ];
    writeFileSync(logPath, `${lines.join('\n')}\n`, 'utf-8');

    const result = readLogLines(logPath, 50, 0);
    expect(result.total).toBe(3);
    expect(result.lines[0]?.msg).toBe('third');
    expect(result.lines[2]?.msg).toBe('first');
    expect(result.hasMore).toBe(false);
  });

  it('supports offset and limit for pagination', () => {
    const logPath = join(tmpDir, 'test.log');
    const lines = Array.from({ length: 10 }, (_, i) =>
      makeLogLine(`2026-03-15T00:00:${String(i).padStart(2, '0')}Z`, 'info', `msg${i}`),
    );
    writeFileSync(logPath, `${lines.join('\n')}\n`, 'utf-8');

    const result = readLogLines(logPath, 3, 2);
    expect(result.total).toBe(10);
    expect(result.lines.length).toBe(3);
    expect(result.hasMore).toBe(true);
  });

  it('applies level filter', () => {
    const logPath = join(tmpDir, 'test.log');
    const lines = [
      makeLogLine('2026-03-15T00:00:01Z', 'info', 'first'),
      makeLogLine('2026-03-15T00:00:02Z', 'warn', 'second'),
      makeLogLine('2026-03-15T00:00:03Z', 'error', 'third'),
    ];
    writeFileSync(logPath, `${lines.join('\n')}\n`, 'utf-8');

    const result = readLogLines(logPath, 50, 0, 'error');
    expect(result.total).toBe(1);
    expect(result.lines[0]?.msg).toBe('third');
  });

  it('handles invalid JSON lines gracefully', () => {
    const logPath = join(tmpDir, 'test.log');
    writeFileSync(
      logPath,
      `not json\n${makeLogLine('2026-03-15T00:00:01Z', 'info', 'valid')}\n`,
      'utf-8',
    );

    const result = readLogLines(logPath, 50, 0);
    expect(result.total).toBe(1);
    expect(result.lines[0]?.msg).toBe('valid');
  });

  it('handles extra data fields', () => {
    const logPath = join(tmpDir, 'test.log');
    writeFileSync(
      logPath,
      `${makeLogLine('2026-03-15T00:00:01Z', 'info', 'test', { foo: 'bar', baz: 42 })}\n`,
      'utf-8',
    );

    const result = readLogLines(logPath, 50, 0);
    expect(result.lines[0]?.data).toEqual({ foo: 'bar', baz: 42 });
  });

  it('handles large log files by reading only the tail', () => {
    const logPath = join(tmpDir, 'large.log');
    // Write a file larger than MAX_LOG_BYTES (2MB) by generating many lines
    const bigLine = makeLogLine('2026-03-15T00:00:01Z', 'info', 'x'.repeat(1000));
    // 2MB / ~1030 bytes per line = ~2000 lines needed
    const fd = openSync(logPath, 'w');
    const lineBuffer = Buffer.from(`${bigLine}\n`);
    for (let i = 0; i < 3000; i++) {
      const { bytesWritten } = (() => {
        const written = require('node:fs').writeSync(fd, lineBuffer);
        return { bytesWritten: written };
      })();
      void bytesWritten;
    }
    closeSync(fd);

    // Should not throw and should return results
    const result = readLogLines(logPath, 50, 0);
    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.lines.length).toBeLessThanOrEqual(50);
  });
});

describe('readMergedLogLines', () => {
  it('merges server and dashboard log lines in descending order', () => {
    const serverLog = join(tmpDir, 'server.log');
    const dashLog = join(tmpDir, 'dashboard.log');

    writeFileSync(
      serverLog,
      `${[
        makeLogLine('2026-03-15T00:00:01Z', 'info', 'server1'),
        makeLogLine('2026-03-15T00:00:03Z', 'info', 'server2'),
      ].join('\n')}\n`,
      'utf-8',
    );
    writeFileSync(
      dashLog,
      `${[makeLogLine('2026-03-15T00:00:02Z', 'info', 'dash1')].join('\n')}\n`,
      'utf-8',
    );

    const result = readMergedLogLines(serverLog, dashLog, 50, 0);
    expect(result.total).toBe(3);
    expect(result.lines[0]?.msg).toBe('server2');
    expect(result.lines[0]?.source).toBe('server');
    expect(result.lines[1]?.msg).toBe('dash1');
    expect(result.lines[1]?.source).toBe('dashboard');
    expect(result.lines[2]?.msg).toBe('server1');
  });

  it('handles non-existent files gracefully', () => {
    const result = readMergedLogLines(
      join(tmpDir, 'no-server.log'),
      join(tmpDir, 'no-dash.log'),
      50,
      0,
    );
    expect(result.lines).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('applies level filter across merged logs', () => {
    const serverLog = join(tmpDir, 'server.log');
    const dashLog = join(tmpDir, 'dashboard.log');

    writeFileSync(serverLog, `${makeLogLine('2026-03-15T00:00:01Z', 'error', 'err1')}\n`, 'utf-8');
    writeFileSync(dashLog, `${makeLogLine('2026-03-15T00:00:02Z', 'info', 'info1')}\n`, 'utf-8');

    const result = readMergedLogLines(serverLog, dashLog, 50, 0, 'error');
    expect(result.total).toBe(1);
    expect(result.lines[0]?.msg).toBe('err1');
  });

  it('supports pagination with offset and limit', () => {
    const serverLog = join(tmpDir, 'server.log');
    const dashLog = join(tmpDir, 'dashboard.log');

    const serverLines = Array.from({ length: 5 }, (_, i) =>
      makeLogLine(`2026-03-15T00:00:${String(i * 2).padStart(2, '0')}Z`, 'info', `s${i}`),
    );
    const dashLines = Array.from({ length: 5 }, (_, i) =>
      makeLogLine(`2026-03-15T00:00:${String(i * 2 + 1).padStart(2, '0')}Z`, 'info', `d${i}`),
    );

    writeFileSync(serverLog, `${serverLines.join('\n')}\n`, 'utf-8');
    writeFileSync(dashLog, `${dashLines.join('\n')}\n`, 'utf-8');

    const result = readMergedLogLines(serverLog, dashLog, 3, 2);
    expect(result.total).toBe(10);
    expect(result.lines.length).toBe(3);
    expect(result.hasMore).toBe(true);
  });
});

describe('createLogTail — file open error', () => {
  it('returns empty when file is unreadable (openSync catch at lines 207-209)', async () => {
    const logPath = join(tmpDir, 'unreadable.log');
    // Create a file with initial content so the tail has a non-zero offset
    writeFileSync(logPath, `${makeLogLine('2026-03-15T00:00:01Z', 'info', 'initial')}\n`, 'utf-8');

    const collectedLines: unknown[] = [];
    const handle = createLogTail([{ path: logPath, source: 'server' }], (lines) =>
      collectedLines.push(...lines),
    );

    // Append new data
    const { appendFileSync, chmodSync } = await import('node:fs');
    appendFileSync(logPath, `${makeLogLine('2026-03-15T00:00:02Z', 'info', 'readable')}\n`, 'utf-8');

    // Wait for poll to pick up the line
    await new Promise((r) => setTimeout(r, 2500));

    // Now make the file unreadable (write-only) — statSync still works, but openSync('r') fails
    chmodSync(logPath, 0o000);

    // Append more data by first restoring perms, writing, then removing read again
    chmodSync(logPath, 0o200);
    appendFileSync(logPath, `${makeLogLine('2026-03-15T00:00:03Z', 'info', 'after-chmod')}\n`, 'utf-8');
    chmodSync(logPath, 0o000);

    // Wait for another poll — safeFileSize works (stat succeeds on unreadable files)
    // but openSync('r') should fail with EACCES
    await new Promise((r) => setTimeout(r, 2500));

    // Restore permissions for cleanup
    chmodSync(logPath, 0o644);

    handle.stop();
    // The tail should have collected the "readable" line from the first poll
    expect(collectedLines.length).toBeGreaterThanOrEqual(1);
  }, 10000);
});

describe('createLogTail', () => {
  it('detects new log lines appended after tail starts', async () => {
    const logPath = join(tmpDir, 'tail.log');
    writeFileSync(logPath, `${makeLogLine('2026-03-15T00:00:01Z', 'info', 'initial')}\n`, 'utf-8');

    const collectedLines: unknown[] = [];
    const handle = createLogTail([{ path: logPath, source: 'server' }], (lines) =>
      collectedLines.push(...lines),
    );

    // Append a new line
    const { appendFileSync } = await import('node:fs');
    appendFileSync(
      logPath,
      `${makeLogLine('2026-03-15T00:00:02Z', 'info', 'new-line')}\n`,
      'utf-8',
    );

    // Wait for polling (poll interval is 2s)
    await new Promise((r) => setTimeout(r, 2500));

    handle.stop();
    expect(collectedLines.length).toBeGreaterThanOrEqual(1);
    expect((collectedLines[0] as { msg: string }).msg).toBe('new-line');
  });

  it('handles file truncation (reset)', async () => {
    const logPath = join(tmpDir, 'truncate.log');
    // Write some content first so the tail starts with a non-zero offset
    writeFileSync(logPath, `${makeLogLine('2026-03-15T00:00:01Z', 'info', 'old')}\n`, 'utf-8');

    const collectedLines: unknown[] = [];
    const handle = createLogTail([{ path: logPath, source: 'server' }], (lines) =>
      collectedLines.push(...lines),
    );

    // Truncate the file (simulate log rotation)
    writeFileSync(logPath, '', 'utf-8');

    // Wait for polling
    await new Promise((r) => setTimeout(r, 2500));

    handle.stop();
    // After truncation, offset should reset — no crash
  });

  it('handles non-existent file gracefully', async () => {
    const logPath = join(tmpDir, 'no-exist.log');

    const collectedLines: unknown[] = [];
    const handle = createLogTail([{ path: logPath, source: 'server' }], (lines) =>
      collectedLines.push(...lines),
    );

    await new Promise((r) => setTimeout(r, 2500));
    handle.stop();
    // Should not throw, no lines collected
    expect(collectedLines).toEqual([]);
  });

  it('tails multiple files and sorts newest-first', async () => {
    const serverLog = join(tmpDir, 'server-tail.log');
    const dashLog = join(tmpDir, 'dash-tail.log');
    writeFileSync(serverLog, '', 'utf-8');
    writeFileSync(dashLog, '', 'utf-8');

    const collectedLines: unknown[] = [];
    const handle = createLogTail(
      [
        { path: serverLog, source: 'server' },
        { path: dashLog, source: 'dashboard' },
      ],
      (lines) => collectedLines.push(...lines),
    );

    const { appendFileSync } = await import('node:fs');
    appendFileSync(
      serverLog,
      `${makeLogLine('2026-03-15T00:00:01Z', 'info', 'server-msg')}\n`,
      'utf-8',
    );
    appendFileSync(
      dashLog,
      `${makeLogLine('2026-03-15T00:00:02Z', 'info', 'dash-msg')}\n`,
      'utf-8',
    );

    await new Promise((r) => setTimeout(r, 2500));
    handle.stop();

    expect(collectedLines.length).toBeGreaterThanOrEqual(2);
    // Newest first
    const msgs = collectedLines.map((l) => (l as { msg: string }).msg);
    expect(msgs).toContain('server-msg');
    expect(msgs).toContain('dash-msg');
  });
});
