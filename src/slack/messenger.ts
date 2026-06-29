/** @module messenger — Streams incremental text updates to a Slack thread with rate-limiting and chunked splitting */
import fs from 'node:fs';
import type { SlackClientSurface } from '../context/slack-client-surface.js';
import { RETRY_LIMITS } from '../shared/constants.js';
import { findSplitPoint, shouldSplit } from '../shared/text-utils.js';
import { errorMessage } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import {
  type SlackBlockMessage,
  buildMarkdownMessage,
  exceedsFileUploadThreshold,
} from './markdown-blocks.js';

const UPDATE_INTERVAL_MIN = 800;
const UPDATE_INTERVAL_MAX = 1200;
const EMPTY_FINAL_FALLBACK = 'Completed.';
const MAX_RETRIES = RETRY_LIMITS.slackMessenger;
const RETRY_BASE_MS = 500;

function parseRetryAfterMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) return parsed * 1000;
  }
  return null;
}

function readHeader(headers: unknown, key: string): unknown {
  if (!headers || typeof headers !== 'object') return undefined;
  if (headers instanceof Headers) return headers.get(key);
  const record = headers as Record<string, unknown>;
  return record[key] ?? record[key.toLowerCase()] ?? record[key.toUpperCase()];
}

function randomInterval(): number {
  return UPDATE_INTERVAL_MIN + Math.random() * (UPDATE_INTERVAL_MAX - UPDATE_INTERVAL_MIN);
}

export interface MessengerOptions {
  /** When true, postFinal() uses Slack `markdown` blocks for rich formatting. Default: false. */
  useMarkdownBlocks?: boolean;
}

export class Messenger {
  private currentTs: string | null = null;
  private buffer = '';
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  private updatePending = false;
  private rateLimitBackoff = 1;
  private pendingOp: Promise<void> = Promise.resolve();
  private finalizing = false;

  constructor(
    private readonly client: SlackClientSurface,
    private readonly channelId: string,
    private readonly threadTs: string,
    private readonly contextPrefix: string | null = null,
    private readonly messengerOptions: MessengerOptions = {},
  ) {}

  private applyContextPrefix(text: string): string {
    if (!this.contextPrefix) return text;
    return `${this.contextPrefix}\n${text}`;
  }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    const run = async () => {
      await fn();
    };
    const op = this.pendingOp.then(run, run);
    this.pendingOp = op.catch(() => undefined);
    return op;
  }

  private queue(label: string, fn: () => Promise<void>): void {
    void this.enqueue(fn).catch((err) => {
      logger.warn(label, {
        error: errorMessage(err),
      });
    });
  }

  async postStart(text: string): Promise<void> {
    await this.enqueue(async () => {
      const result = await this.safePost(text);
      if (result?.ts) {
        this.currentTs = result.ts as string;
      }
    });
  }

  /**
   * Replace the internal buffer content.
   * Used to strip [MCP_TOOL_REQUEST] blocks from already-buffered text
   * before postFinal updates the Slack message.
   */
  replaceBuffer(text: string): void {
    this.queue('replace_buffer_failed', async () => {
      this.buffer = text;
    });
  }

  appendText(text: string): void {
    this.queue('append_text_failed', async () => {
      this.buffer += text;

      if (shouldSplit(this.buffer)) {
        const splitAt = findSplitPoint(this.buffer);
        const chunk = this.buffer.slice(0, splitAt);
        this.buffer = this.buffer.slice(splitAt);

        try {
          await this.flushChunk(chunk);
        } catch (err) {
          logger.warn('flush_chunk_fire_and_forget_failed', {
            error: errorMessage(err),
          });
        }
      }

      this.scheduleUpdate();
    });
  }

  private scheduleUpdate(): void {
    if (this.finalizing || this.updateTimer) return;
    this.updatePending = true;

    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      if (!this.updatePending || this.finalizing) return;
      this.updatePending = false;
      this.queue('flush_update_failed', async () => {
        await this.flushUpdate();
      });
    }, randomInterval() * this.rateLimitBackoff);
  }

  private async flushUpdate(): Promise<void> {
    if (!this.currentTs || !this.buffer) return;
    await this.safeUpdate(this.buffer);
  }

  private async flushChunk(text: string): Promise<void> {
    const prevTs = this.currentTs;
    let recovered = false;
    try {
      let chunkPosted = false;
      if (prevTs) {
        try {
          this.currentTs = prevTs;
          chunkPosted = await this.safeUpdate(text);
        } finally {
          this.currentTs = null;
        }
      }
      if (!chunkPosted) {
        this.buffer = text + this.buffer;
        recovered = true;
      }
      const result = await this.safePost('...');
      if (result?.ts) {
        this.currentTs = result.ts as string;
      }
    } catch (err) {
      if (!recovered) {
        this.buffer = text + this.buffer;
      }
      logger.warn('flush_chunk_failed', {
        error: errorMessage(err),
      });
    }
  }

  async postFinal(text: string): Promise<void> {
    this.finalizing = true;
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
    this.updatePending = false;

    try {
      await this.enqueue(async () => {
        const fullText = this.buffer + text;
        this.buffer = '';
        const finalText = fullText.trim() ? fullText : EMPTY_FINAL_FALLBACK;

        if (this.messengerOptions.useMarkdownBlocks) {
          await this.postFinalWithMarkdown(finalText);
        } else {
          await this.postFinalPlainText(finalText);
        }
      });
    } finally {
      this.finalizing = false;
    }
  }

  /**
   * Plain-text final posting (original behavior).
   * Splits by char/byte thresholds and posts/updates incrementally.
   */
  private async postFinalPlainText(finalText: string): Promise<void> {
    let postingFailed = false;

    if (this.currentTs && !shouldSplit(finalText)) {
      if (!(await this.safeUpdate(finalText))) {
        postingFailed = true;
      }
    } else {
      let remaining = finalText;
      while (remaining) {
        if (!shouldSplit(remaining)) {
          if (this.currentTs) {
            if (!(await this.safeUpdate(remaining))) postingFailed = true;
          } else {
            if (!(await this.safePost(remaining))) postingFailed = true;
          }
          break;
        }
        const splitAt = findSplitPoint(remaining);
        const chunk = remaining.slice(0, splitAt);
        remaining = remaining.slice(splitAt);

        if (this.currentTs) {
          if (!(await this.safeUpdate(chunk))) postingFailed = true;
          this.currentTs = null;
        } else {
          if (!(await this.safePost(chunk))) postingFailed = true;
        }
      }
    }

    if (postingFailed && finalText !== EMPTY_FINAL_FALLBACK) {
      await this.uploadFile(finalText, 'output.txt', 'Full output');
    }
  }

  /**
   * Block Kit final posting using `markdown` blocks for rich LLM output.
   * Transitions from streaming plain-text to Block Kit for the final message.
   */
  private async postFinalWithMarkdown(finalText: string): Promise<void> {
    const messages = buildMarkdownMessage({ body: finalText });
    const needsFileUpload = exceedsFileUploadThreshold(finalText);
    let anyPostFailed = false;

    for (const [index, msg] of messages.entries()) {
      let posted = false;

      if (index === 0 && this.currentTs) {
        // Transition: update the streaming plain-text message with Block Kit
        const staleTs = this.currentTs;
        posted = await this.safeUpdateWithBlocks(msg);
        if (!posted) {
          // Fallback: post as new message if update fails
          const result = await this.safePostWithBlocks(msg);
          posted = result != null;
          // Clean up the stale streaming message to avoid duplicate display
          if (posted) {
            await this.safeDelete(staleTs);
          }
        }
      } else {
        const result = await this.safePostWithBlocks(msg);
        posted = result != null;
      }

      if (!posted) anyPostFailed = true;
    }

    if (needsFileUpload) {
      await this.uploadFile(finalText, 'output.md', 'Full output');
    }

    if (anyPostFailed && !needsFileUpload && finalText !== EMPTY_FINAL_FALLBACK) {
      await this.uploadFile(finalText, 'output.md', 'Full output');
    }
  }

  async uploadFile(content: string, filename: string, title: string): Promise<void> {
    try {
      await this.client.filesUploadV2({
        channel_id: this.channelId,
        thread_ts: this.threadTs,
        content,
        filename,
        title,
      });
    } catch (err) {
      logger.error('file_upload_failed', {
        error: errorMessage(err),
      });
    }
  }

  async postStatusMessage(text: string): Promise<string | null> {
    const result = await this.safePost(text);
    return (result?.ts as string) ?? null;
  }

  async uploadBinaryFile(filePath: string, filename: string, title: string): Promise<boolean> {
    try {
      const data = fs.readFileSync(filePath);
      logger.info('binary_file_upload_start', {
        filename,
        size: data.length,
        channel: this.channelId,
        thread: this.threadTs,
      });
      await this.client.filesUploadV2({
        channel_id: this.channelId,
        thread_ts: this.threadTs,
        file: data,
        filename,
        title,
      });
      logger.info('binary_file_upload_ok', { filename });
      return true;
    } catch (err) {
      logger.error('binary_file_upload_failed', {
        filename,
        filePath,
        error: errorMessage(err),
      });
      return false;
    }
  }

  private async safePost(text: string): Promise<{ ts?: string } | null> {
    const safeText = text.trim() ? text : EMPTY_FINAL_FALLBACK;
    return this.withRetry('post', async () => {
      const result = await this.client.chat.postMessage({
        channel: this.channelId,
        thread_ts: this.threadTs,
        text: this.applyContextPrefix(safeText),
      });
      return result as { ts?: string };
    });
  }

  private async safeUpdate(text: string): Promise<boolean> {
    const ts = this.currentTs;
    if (!ts) return false;
    const safeText = text.trim() ? text : EMPTY_FINAL_FALLBACK;
    const result = await this.withRetry('update', async () => {
      await this.client.chat.update({
        channel: this.channelId,
        ts,
        text: this.applyContextPrefix(safeText),
      });
      return true;
    });
    return result ?? false;
  }

  private async safePostWithBlocks(msg: SlackBlockMessage): Promise<{ ts?: string } | null> {
    const fallbackText = this.applyContextPrefix(msg.text || EMPTY_FINAL_FALLBACK);
    return this.withRetry('post_blocks', async () => {
      const result = await this.client.chat.postMessage({
        channel: this.channelId,
        thread_ts: this.threadTs,
        blocks: msg.blocks,
        text: fallbackText,
      });
      return result as { ts?: string };
    });
  }

  private async safeDelete(ts: string): Promise<void> {
    try {
      await this.client.chat.delete({ channel: this.channelId, ts });
    } catch (err) {
      logger.debug('stale_message_delete_failed', { error: errorMessage(err) });
    }
  }

  private async safeUpdateWithBlocks(msg: SlackBlockMessage): Promise<boolean> {
    const ts = this.currentTs;
    if (!ts) return false;
    const fallbackText = this.applyContextPrefix(msg.text || EMPTY_FINAL_FALLBACK);
    const result = await this.withRetry('update_blocks', async () => {
      await this.client.chat.update({
        channel: this.channelId,
        ts,
        blocks: msg.blocks,
        text: fallbackText,
      });
      return true;
    });
    return result ?? false;
  }

  /**
   * Execute a Slack API call with exponential backoff retry for transient errors.
   * Rate-limit errors are retried with increasing backoff delays.
   */
  private async withRetry<T>(op: string, fn: () => Promise<T>): Promise<T | null> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await fn();
        this.rateLimitBackoff = 1;
        return result;
      } catch (err) {
        if (this.isRateLimited(err)) {
          this.rateLimitBackoff = Math.min(this.rateLimitBackoff * 2, 8);
          const localDelay = RETRY_BASE_MS * this.rateLimitBackoff;
          const retryAfterMs = this.extractRetryAfterMs(err);
          const delay = Math.max(localDelay, retryAfterMs ?? 0);
          logger.warn(`rate_limited_${op}`, {
            backoff: this.rateLimitBackoff,
            delay_ms: delay,
            retry_after_ms: retryAfterMs ?? null,
          });
          if (attempt < MAX_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          return null;
        }
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_MS * 2 ** attempt;
          logger.warn(`${op}_retry`, { attempt: attempt + 1, delay_ms: delay });
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          logger.error(`${op}_message_failed`, {
            error: errorMessage(err),
            attempts: attempt + 1,
          });
        }
      }
    }
    return null;
  }

  private isRateLimited(err: unknown): boolean {
    if (err && typeof err === 'object' && 'code' in err) {
      return (err as { code: string }).code === 'slack_webapi_rate_limited';
    }
    return false;
  }

  private extractRetryAfterMs(err: unknown): number | null {
    if (!err || typeof err !== 'object') return null;
    const record = err as Record<string, unknown>;
    return (
      parseRetryAfterMs(record.retryAfter) ??
      parseRetryAfterMs(record.retry_after) ??
      parseRetryAfterMs(readHeader(record.headers, 'retry-after')) ??
      parseRetryAfterMs(
        record.data && typeof record.data === 'object'
          ? (record.data as Record<string, unknown>).retryAfter
          : undefined,
      ) ??
      parseRetryAfterMs(
        record.data && typeof record.data === 'object'
          ? (record.data as Record<string, unknown>).retry_after
          : undefined,
      ) ??
      parseRetryAfterMs(
        record.response && typeof record.response === 'object'
          ? readHeader((record.response as Record<string, unknown>).headers, 'retry-after')
          : undefined,
      ) ??
      null
    );
  }
}
