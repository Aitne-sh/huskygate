/** @module http — Dashboard HTTP helpers, structured logging, and log file reader/tailer */
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { INTERVALS, SIZE_LIMITS } from '../shared/constants.js';
import { writeStructuredLog } from '../utils/logger.js';

// Re-export shared HTTP helpers so existing dashboard consumers don't need path changes
export { json, parseUrl, readBody } from '../shared/http.js';
export { parseJson } from '../shared/mappers/helpers.js';

const MAX_LOG_BYTES = SIZE_LIMITS.maxLogBytes;

export interface LogLine {
  ts: string;
  level: string;
  msg: string;
  source?: 'server' | 'dashboard';
  data?: Record<string, unknown>;
}

/* ── dashboard structured logger (→ stdout → dashboard.log) ── */

export function dashLog(level: string, msg: string, data?: Record<string, unknown>): void {
  writeStructuredLog(level, msg, { ...data, source: 'dashboard' });
}

/* ── request body helpers (dashboard-specific) ── */

export function readBinaryBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error('File too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ── log reader ── */

/** Parse a single JSON log line into a LogLine, or return null on failure. */
function parseOneLogLine(raw: string, source?: 'server' | 'dashboard'): LogLine | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const line: LogLine = {
      ts: String(obj.ts ?? ''),
      level: String(obj.level ?? 'info'),
      msg: String(obj.msg ?? ''),
    };
    if (source) line.source = source;
    const extra: Record<string, unknown> = {};
    let hasExtra = false;
    for (const k of Object.keys(obj)) {
      if (k === 'ts' || k === 'level' || k === 'msg') continue;
      extra[k] = obj[k];
      hasExtra = true;
    }
    if (hasExtra) line.data = extra;
    return line;
  } catch {
    return null;
  }
}

/** Read a single log file and return raw tail content. */
function readLogFileRaw(logPath: string): string {
  if (!existsSync(logPath)) return '';
  try {
    const stat = statSync(logPath);
    if (stat.size > MAX_LOG_BYTES) {
      // Read only the last MAX_LOG_BYTES instead of loading the entire file
      const fd = openSync(logPath, 'r');
      try {
        const readStart = stat.size - MAX_LOG_BYTES;
        const buf = Buffer.alloc(MAX_LOG_BYTES);
        const bytesRead = readSync(fd, buf, 0, MAX_LOG_BYTES, readStart);
        let raw = buf.subarray(0, bytesRead).toString('utf-8');
        // drop first (likely partial) line
        const nl = raw.indexOf('\n');
        if (nl !== -1) raw = raw.slice(nl + 1);
        return raw;
      } finally {
        closeSync(fd);
      }
    }
    return readFileSync(logPath, 'utf-8');
  } catch {
    return '';
  }
}

/** Parse raw log text into LogLine[], newest-first. */
function parseLogRaw(
  raw: string,
  source: 'server' | 'dashboard' | undefined,
  levelFilter?: string,
): LogLine[] {
  if (!raw) return [];
  const rawLines = raw.trim().split('\n').filter(Boolean);
  const parsed: LogLine[] = [];
  for (let i = rawLines.length - 1; i >= 0; i--) {
    const line = parseOneLogLine(rawLines[i] as string, source);
    if (!line) continue;
    if (levelFilter && line.level !== levelFilter) continue;
    parsed.push(line);
  }
  return parsed;
}

/** Merge two descending-sorted LogLine arrays into one descending-sorted array. */
function mergeDescending(a: LogLine[], b: LogLine[]): LogLine[] {
  const result: LogLine[] = new Array(a.length + b.length);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < a.length && j < b.length) {
    // descending: pick the one with larger (newer) timestamp
    result[k++] =
      (a[i] as LogLine).ts >= (b[j] as LogLine).ts ? (a[i++] as LogLine) : (b[j++] as LogLine);
  }
  while (i < a.length) result[k++] = a[i++] as LogLine;
  while (j < b.length) result[k++] = b[j++] as LogLine;
  return result;
}

export function readLogLines(
  logPath: string,
  limit: number,
  offset: number,
  levelFilter?: string,
): { lines: LogLine[]; total: number; hasMore: boolean } {
  const raw = readLogFileRaw(logPath);
  const parsed = parseLogRaw(raw, undefined, levelFilter);
  const total = parsed.length;
  const sliced = parsed.slice(offset, offset + limit);
  return { lines: sliced, total, hasMore: offset + limit < total };
}

/** Read and merge server + dashboard logs, sorted by timestamp (newest first). */
export function readMergedLogLines(
  serverLogPath: string,
  dashboardLogPath: string,
  limit: number,
  offset: number,
  levelFilter?: string,
): { lines: LogLine[]; total: number; hasMore: boolean } {
  const serverLines = parseLogRaw(readLogFileRaw(serverLogPath), 'server', levelFilter);
  const dashLines = parseLogRaw(readLogFileRaw(dashboardLogPath), 'dashboard', levelFilter);
  const merged = mergeDescending(serverLines, dashLines);
  const total = merged.length;
  const sliced = merged.slice(offset, offset + limit);
  return { lines: sliced, total, hasMore: offset + limit < total };
}

/* ── log tail watcher (for SSE streaming) ── */

const LOG_TAIL_POLL_MS = INTERVALS.logTailPoll;
const LOG_TAIL_HEARTBEAT_MS = INTERVALS.logTailHeartbeat;
const LOG_TAIL_READ_CHUNK = SIZE_LIMITS.logTailReadChunk;

interface WatchedFile {
  path: string;
  source: 'server' | 'dashboard';
  offset: number;
  partial: string; // leftover bytes (incomplete line from previous read)
}

/** Get current file size, returning 0 if file doesn't exist or can't be stat'd. */
function safeFileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** Read new bytes from a watched file and return parsed LogLines. */
function readNewLines(wf: WatchedFile): LogLine[] {
  const size = safeFileSize(wf.path);
  if (size <= wf.offset) {
    // File truncated or unchanged — reset if truncated
    if (size < wf.offset) {
      wf.offset = 0;
      wf.partial = '';
    }
    return [];
  }

  const bytesToRead = Math.min(size - wf.offset, LOG_TAIL_READ_CHUNK);
  const buf = Buffer.alloc(bytesToRead);
  let bytesRead = 0;
  try {
    const fd = openSync(wf.path, 'r');
    try {
      bytesRead = readSync(fd, buf, 0, bytesToRead, wf.offset);
    } finally {
      closeSync(fd);
    }
  } catch {
    return [];
  }

  if (bytesRead === 0) return [];
  wf.offset += bytesRead;

  const chunk = wf.partial + buf.subarray(0, bytesRead).toString('utf-8');
  const lines = chunk.split('\n');
  // Last element is either empty (line ended with \n) or a partial line
  wf.partial = lines.pop() ?? '';

  const result: LogLine[] = [];
  for (const raw of lines) {
    if (!raw) continue;
    const line = parseOneLogLine(raw, wf.source);
    if (line) result.push(line);
  }
  return result;
}

export interface LogTailHandle {
  stop: () => void;
}

/**
 * Start tailing one or more log files, calling `onLines` whenever new lines appear.
 * Returns a handle to stop watching. Caller is responsible for calling stop() on disconnect.
 */
export function createLogTail(
  files: { path: string; source: 'server' | 'dashboard' }[],
  onLines: (lines: LogLine[]) => void,
): LogTailHandle {
  const watched: WatchedFile[] = files.map((f) => ({
    path: f.path,
    source: f.source,
    offset: safeFileSize(f.path), // start from current end
    partial: '',
  }));

  const poll = setInterval(() => {
    const allNew: LogLine[] = [];
    for (const wf of watched) {
      const lines = readNewLines(wf);
      if (lines.length > 0) allNew.push(...lines);
    }
    if (allNew.length > 0) {
      // Sort newest-first for consistency with the rest of the UI
      allNew.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
      onLines(allNew);
    }
  }, LOG_TAIL_POLL_MS);

  return {
    stop() {
      clearInterval(poll);
    },
  };
}

export { LOG_TAIL_HEARTBEAT_MS };
