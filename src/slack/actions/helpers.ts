/** @module slack/actions/helpers — Shared utilities for Block Kit action handlers. */

export interface ParsedThreadContext {
  threadKey: string;
  channelId: string;
  threadTs: string;
}

export function parseThreadKey(threadKey: string): ParsedThreadContext | null {
  const sepIdx = threadKey.indexOf(':');
  if (sepIdx === -1) return null;
  return {
    threadKey,
    channelId: threadKey.slice(0, sepIdx),
    threadTs: threadKey.slice(sepIdx + 1),
  };
}

/** Extract channel ID and message timestamp from block_actions body (for chat.update). */
export function extractOriginalMessage(
  body: unknown,
): { channelId: string; messageTs: string } | null {
  const b = body as { channel?: { id?: string }; message?: { ts?: string } };
  if (!b.channel?.id || !b.message?.ts) return null;
  return { channelId: b.channel.id, messageTs: b.message.ts };
}

/** Validate and parse a JSON-encoded menu button value with thread key. */
export function parseMenuPayload<T extends Record<string, unknown>>(
  raw: string | undefined,
): (T & { tk: string }) | null {
  try {
    const parsed = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    if (typeof parsed.tk !== 'string' || !parsed.tk) return null;
    return parsed as T & { tk: string };
  } catch {
    return null;
  }
}

export const VALID_TOOLS = new Set<string>(['gemini', 'claude', 'codex']);
