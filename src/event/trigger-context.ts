/** @module event/trigger-context — Trigger context serialization and prompt injection helpers. */
import { SIZE_LIMITS } from '../shared/constants.js';

const MAX_TRIGGER_CONTEXT_BYTES = SIZE_LIMITS.maxTriggerContext;

export { MAX_TRIGGER_CONTEXT_BYTES };

/**
 * Serialize a trigger context object to JSON, enforcing the 8KB size limit.
 * Returns null if the context is null/undefined.
 * Throws if the serialized JSON exceeds MAX_TRIGGER_CONTEXT_BYTES.
 */
export function serializeTriggerContext(
  triggerContext: Record<string, unknown> | null | undefined,
): string | null {
  if (!triggerContext) return null;
  const json = JSON.stringify(triggerContext);
  if (Buffer.byteLength(json, 'utf-8') > MAX_TRIGGER_CONTEXT_BYTES) {
    throw new Error(`Trigger context exceeds ${MAX_TRIGGER_CONTEXT_BYTES} bytes`);
  }
  return json;
}

/**
 * Parse a stored trigger context JSON string back into an object.
 * Returns null if the input is null/undefined or not a valid JSON object.
 */
export function parseTriggerContext(
  json: string | null | undefined,
): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Append a trigger/event context block to a prompt string.
 * Used for both start-node Trigger Event Context and triggered-node Triggered Event Context.
 */
export function appendTriggerContext(
  prompt: string,
  title: string,
  context: Record<string, unknown> | null,
): string {
  if (!context) return prompt;
  return `${prompt}\n\n--- ${title} ---\nUse this only if relevant.\n${JSON.stringify(context, null, 2)}`;
}
