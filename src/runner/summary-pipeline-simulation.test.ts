import { describe, expect, it } from 'vitest';
import { extractSummaryContent } from '../orchestrator/engine-summary.js';
import { extractAnswerText } from '../slack/app-helpers.js';
import { ClaudeDriver } from './driver-claude.js';
import { GeminiDriver } from './driver-gemini.js';
import { type DriverEvent, isAggregateTextEvent } from './types.js';

describe('summary pipeline simulation', () => {
  it('processes Gemini sandbox output end-to-end', () => {
    const lines = [
      'MCP issues detected. Run /mcp list for status.{"type":"init","timestamp":"2026-03-08T22:48:30.478Z","session_id":"242ee007","model":"auto-gemini-3"}',
      '{"type":"message","timestamp":"2026-03-08T22:48:38.644Z","role":"assistant","content":"<summary>\\n## Overview\\nCompleted successfully.\\n</summary>","delta":true}',
      '{"type":"result","timestamp":"2026-03-08T22:48:38.742Z","status":"success","stats":{}}',
    ];

    const driver = new GeminiDriver();
    const allEvents: DriverEvent[] = [];
    let textBuffer = '';

    for (const line of lines) {
      const event = driver.parseEvent(line);
      if (event) {
        allEvents.push(event);
        if (event.type === 'text' && !isAggregateTextEvent(event)) {
          textBuffer += event.content;
        }
      }
    }

    // Verify events parsed correctly
    const eventTypes = allEvents.map((e) => e.type);
    expect(eventTypes).toContain('text');
    expect(eventTypes).not.toContain('tool_use');
    expect(eventTypes).not.toContain('tool_result');

    // Verify extractAnswerText returns post-tool text (summary)
    const answerText = extractAnswerText(allEvents);
    expect(answerText).toContain('<summary>');
    expect(answerText).toContain('</summary>');

    // Verify extractSummaryContent works
    const taskOutputRaw = answerText || textBuffer;
    const summaryBody = extractSummaryContent(taskOutputRaw);
    expect(summaryBody).toContain('Overview');
    expect(summaryBody).toContain('Completed successfully');
  });

  it('processes Claude new-format output end-to-end', () => {
    // Simulates the actual Claude CLI stream-json output from a summary job.
    // The new format uses "assistant" and "result" events and the summary
    // arrives without any tool calls because the report is embedded directly
    // into the prompt.
    const lines = [
      '{"type":"system","subtype":"hook_started","hook_id":"h1","hook_name":"SessionStart:startup"}',
      '{"type":"system","subtype":"hook_response","hook_id":"h1","output":"{\\"hookSpecificOutput\\":{\\"additionalContext\\":\\"some context\\"}}"}',
      '{"type":"system","subtype":"init","cwd":"/tmp/summary","session_id":"s1","tools":["Read","Glob","Task"]}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"I should summarize the embedded report"}]}}',
      '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"<summary>\\n## Overview\\nAll tasks completed successfully.\\n</summary>"}]}}',
      '{"type":"result","subtype":"success","result":"<summary>\\n## Overview\\nAll tasks completed successfully.\\n</summary>","session_id":"s1"}',
    ];

    const driver = new ClaudeDriver();
    const allEvents: DriverEvent[] = [];
    let textBuffer = '';

    for (const line of lines) {
      const event = driver.parseEvent(line);
      if (event) {
        allEvents.push(event);
        if (event.type === 'text' && !isAggregateTextEvent(event)) {
          textBuffer += event.content;
        }
      }
    }

    // System, rate_limit, and thinking events should be filtered.
    const eventTypes = allEvents.map((e) => e.type);
    expect(eventTypes).not.toContain('status'); // system events filtered
    expect(eventTypes).not.toContain('tool_use');
    expect(eventTypes).not.toContain('tool_result');
    expect(allEvents.length).toBe(2); // assistant text + result text

    // extractAnswerText Tier 1: post-tool text after tool_result
    const answerText = extractAnswerText(allEvents);
    expect(answerText).toContain('<summary>');
    expect(answerText).toContain('</summary>');

    // extractSummaryContent extracts the summary body
    const taskOutputRaw = answerText || textBuffer;
    const summaryBody = extractSummaryContent(taskOutputRaw);
    expect(summaryBody).toContain('Overview');
    expect(summaryBody).toContain('All tasks completed successfully');
  });
});
