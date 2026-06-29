/** @module shared/task-agent-resolver.test — 100 % line-coverage tests for resolveTaskAgent. */

import { describe, expect, it } from 'vitest';
import type { ToolName } from '../config.js';
import type { AiAgent } from '../orchestrator/types.js';
import type { AgentStore } from '../store/agent-store.js';
import { resolveTaskAgent } from './task-agent-resolver.js';

// ── Helpers ────────────────────────────────────────────────────

function makeTaskDefaults(overrides: Partial<Parameters<typeof resolveTaskAgent>[2]> = {}) {
  return {
    tool: 'claude' as ToolName,
    model: null as string | null,
    allowMcp: false,
    enabledSkills: null,
    instructionFile: null as string | null,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AiAgent> = {}): AiAgent {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    description: null,
    tool: 'gemini' as ToolName,
    model: 'gemini-2.5-pro',
    systemInstruction: null,
    enabledSkills: null,
    enabledMcpServerIds: null,
    allowMcp: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Minimal stub that satisfies the subset of AgentStore used by resolveTaskAgent. */
function fakeAgentStore(agents: AiAgent[]): AgentStore {
  return {
    getById(id: string): AiAgent | null {
      return agents.find((a) => a.id === id) ?? null;
    },
  } as unknown as AgentStore;
}

// ── Tests ──────────────────────────────────────────────────────

describe('resolveTaskAgent', () => {
  // ── Fallback paths (agentId / agentStore missing) ──────────

  it('returns taskDefaults when agentId is null', () => {
    const defaults = makeTaskDefaults({ tool: 'codex', model: 'o3' });
    const result = resolveTaskAgent(fakeAgentStore([]), null, defaults);
    expect(result).toEqual({ ...defaults, enabledMcpServerIds: null });
  });

  it('returns taskDefaults when agentStore is undefined', () => {
    const defaults = makeTaskDefaults();
    const result = resolveTaskAgent(undefined, 'agent-1', defaults);
    expect(result).toEqual({ ...defaults, enabledMcpServerIds: null });
  });

  it('returns taskDefaults when agentId is empty string (falsy)', () => {
    const defaults = makeTaskDefaults();
    const result = resolveTaskAgent(fakeAgentStore([]), '', defaults);
    expect(result).toEqual({ ...defaults, enabledMcpServerIds: null });
  });

  it('returns taskDefaults when agent not found (deleted)', () => {
    const defaults = makeTaskDefaults({ model: 'o3' });
    const store = fakeAgentStore([makeAgent({ id: 'other' })]);
    const result = resolveTaskAgent(store, 'missing-id', defaults);
    expect(result).toEqual({ ...defaults, enabledMcpServerIds: null });
  });

  // ── Agent-found path (lines 46-53) ────────────────────────

  it('returns agent config when agent exists — task model takes priority', () => {
    const agent = makeAgent({
      id: 'a1',
      tool: 'gemini',
      model: 'gemini-2.5-pro',
      allowMcp: true,
      enabledSkills: ['builtin:playwright-runner'],
      enabledMcpServerIds: ['mcp-server-1'],
      systemInstruction: 'Be concise.',
    });
    const defaults = makeTaskDefaults({
      tool: 'claude',
      model: 'sonnet',
      instructionFile: 'task.md',
    });
    const store = fakeAgentStore([agent]);
    const result = resolveTaskAgent(store, 'a1', defaults);

    expect(result).toEqual({
      tool: 'gemini',
      model: 'sonnet', // task model wins over agent model
      allowMcp: true,
      enabledSkills: ['builtin:playwright-runner'],
      enabledMcpServerIds: ['mcp-server-1'],
      instructionFile: 'Be concise.\n\ntask.md',
    });
  });

  it('falls back to agent model when task model is null', () => {
    const agent = makeAgent({ id: 'a2', model: 'gemini-2.5-pro' });
    const defaults = makeTaskDefaults({ model: null });
    const store = fakeAgentStore([agent]);
    const result = resolveTaskAgent(store, 'a2', defaults);

    expect(result.model).toBe('gemini-2.5-pro');
  });

  it('returns null model when both task and agent model are null', () => {
    const agent = makeAgent({ id: 'a3', model: null });
    const defaults = makeTaskDefaults({ model: null });
    const store = fakeAgentStore([agent]);
    const result = resolveTaskAgent(store, 'a3', defaults);

    expect(result.model).toBeNull();
  });

  // ── mergeInstruction branches (lines 57-65) ───────────────

  it('mergeInstruction: returns null when both instructions are null', () => {
    const agent = makeAgent({ id: 'a4', systemInstruction: null });
    const defaults = makeTaskDefaults({ instructionFile: null });
    const store = fakeAgentStore([agent]);
    const result = resolveTaskAgent(store, 'a4', defaults);

    expect(result.instructionFile).toBeNull();
  });

  it('mergeInstruction: returns task instruction when agent instruction is null', () => {
    const agent = makeAgent({ id: 'a5', systemInstruction: null });
    const defaults = makeTaskDefaults({ instructionFile: 'task-only.md' });
    const store = fakeAgentStore([agent]);
    const result = resolveTaskAgent(store, 'a5', defaults);

    expect(result.instructionFile).toBe('task-only.md');
  });

  it('mergeInstruction: returns agent instruction when task instruction is null', () => {
    const agent = makeAgent({ id: 'a6', systemInstruction: 'Agent system prompt' });
    const defaults = makeTaskDefaults({ instructionFile: null });
    const store = fakeAgentStore([agent]);
    const result = resolveTaskAgent(store, 'a6', defaults);

    expect(result.instructionFile).toBe('Agent system prompt');
  });

  it('mergeInstruction: concatenates both instructions with blank line', () => {
    const agent = makeAgent({ id: 'a7', systemInstruction: 'Agent prompt' });
    const defaults = makeTaskDefaults({ instructionFile: 'task.md' });
    const store = fakeAgentStore([agent]);
    const result = resolveTaskAgent(store, 'a7', defaults);

    expect(result.instructionFile).toBe('Agent prompt\n\ntask.md');
  });
});
