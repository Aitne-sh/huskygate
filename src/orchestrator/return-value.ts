/** @module return-value — Parser for agent return-value tags and template builder for branching instructions */
/**
 * Return Value Parser + Template Builder
 *
 * Parses <return:value> identifiers from AI agent output.
 * The system uses the LAST <return:~> tag in the output for branching decisions.
 *
 * Also provides buildReturnTemplateFromConditions() for auto-mode output control,
 * which generates return-tag instructions from user-configured condition→value mappings.
 */

import type { ReturnCondition } from './types.js';

/**
 * Case-insensitive regex matching `<return:value>`.
 * Captures the value portion (everything between `:` and `>`).
 */
const RETURN_VALUE_REGEX = /<return:([^>]+)>/gi;

/** Maximum length for a parsed return value (prevents abuse via extremely long tags). */
export const MAX_RETURN_VALUE_LENGTH = 500;

/**
 * Extract the return value from agent output text.
 * When multiple `<return:~>` tags are present, the last one is adopted.
 * Values longer than MAX_RETURN_VALUE_LENGTH are truncated.
 *
 * @returns The trimmed return value string, or null if no identifier found.
 */
export function parseReturnValue(output: string): string | null {
  const matches = [...output.matchAll(RETURN_VALUE_REGEX)];
  if (matches.length === 0) return null;
  const lastMatch = matches[matches.length - 1];
  const captured = lastMatch?.[1];
  if (!captured) return null;
  const trimmed = captured.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > MAX_RETURN_VALUE_LENGTH
    ? trimmed.slice(0, MAX_RETURN_VALUE_LENGTH)
    : trimmed;
}

/**
 * Sample template text shown in the node editor UI (copy-to-clipboard).
 * This is NOT auto-appended to prompts — users decide how to instruct their agents.
 */
export const RETURN_VALUE_SAMPLE_TEMPLATE = `IMPORTANT: When you finish, you MUST output a return value tag to indicate the result.
Format: <return:value>
Example: <return:success> or <return:needs_review> or <return:error>
This tag MUST appear in your final output. Output exactly ONE return value tag at the end.
The system uses the LAST <return:~> tag in your output for branching decisions.
If no matching return value is found, the system routes to the "other_return" branch.
If the CLI process itself fails (crash, timeout), the system routes to the "error_return" branch.`;

/**
 * Build a fallback return-tag instruction template from returnValues.
 * Used when outputMode is 'auto' but returnConditions is not configured.
 * Generates a simpler template than buildReturnTemplateFromConditions
 * since we don't have condition descriptions.
 *
 * @param returnValues - Array of return value identifiers (e.g. ['done']).
 * @returns Instruction text to append to the task prompt, or empty string if no values.
 */
export function buildFallbackReturnTemplate(returnValues: string[]): string {
  const filtered = returnValues.filter((v) => v !== 'other_return' && v !== 'error_return');
  if (filtered.length === 0) return '';
  const exampleValue = filtered[0] as string;

  const lines: string[] = [];
  lines.push('IMPORTANT: Follow these output rules exactly.');
  lines.push('Output:');
  lines.push('- Start your response with exactly one return tag in this format: <return:value>.');
  lines.push(`- Available return values: ${filtered.map((v) => `<return:${v}>`).join(', ')}`);
  lines.push('- Choose the value that best matches the outcome of your work.');
  lines.push('- After the opening tag, continue with the normal response content.');
  lines.push('- Do not include any additional <return:...> tags.');
  lines.push(
    `Example: <return:${exampleValue}> Completed the requested work and verified the result.`,
  );
  return lines.join('\n');
}

/**
 * Build a return-tag instruction template from user-configured condition→value mappings.
 * Used by the engine (auto output mode) and mirrored by the client-side JS version.
 *
 * @param conditions - Array of { condition, value } pairs describing when to use each return value.
 * @returns Instruction text to append to the task prompt.
 */
export function buildReturnTemplateFromConditions(conditions: ReturnCondition[]): string {
  if (conditions.length === 0) return '';
  const exampleCondition = conditions[0] as ReturnCondition;

  const lines: string[] = [];
  lines.push('IMPORTANT: Follow these output rules exactly.');
  lines.push('Output:');
  lines.push('- Start your response with exactly one return tag in this format: <return:value>.');
  for (const c of conditions) {
    lines.push(`- Use <return:${c.value}> when: ${c.condition}`);
  }
  lines.push('- After the opening tag, continue with the normal response content.');
  lines.push('- Do not include any additional <return:...> tags.');
  lines.push(
    `Example: <return:${exampleCondition.value}> Completed the requested work and verified the result.`,
  );
  return lines.join('\n');
}
