/**
 * Tests for agent resolution helpers: composeInstructions, intersectSkills, narrowMcpChain.
 */
import { describe, expect, it } from 'vitest';
import { buildSkillRef } from '../skills/catalog.js';
import { composeInstructions, intersectSkills, narrowMcpChain } from './engine-executor.js';

describe('composeInstructions', () => {
  it('returns null when both are null', () => {
    expect(composeInstructions(null, null)).toBeNull();
  });

  it('returns node instruction when agent is null', () => {
    expect(composeInstructions(null, 'do X')).toBe('do X');
  });

  it('returns agent instruction when node is null', () => {
    expect(composeInstructions('be Y', null)).toBe('be Y');
  });

  it('composes both with separator', () => {
    const result = composeInstructions('agent role', 'node task');
    expect(result).toBe('agent role\n\n---\n\nnode task');
  });

  it('returns node instruction when agent is empty string (falsy)', () => {
    expect(composeInstructions('', 'do X')).toBe('do X');
  });

  it('returns agent instruction when node is empty string (falsy)', () => {
    expect(composeInstructions('be Y', '')).toBe('be Y');
  });

  it('returns null when both are empty string', () => {
    expect(composeInstructions('', '')).toBeNull();
  });
});

describe('intersectSkills', () => {
  it('returns agent skills when orch is null (orch allows all)', () => {
    const agent = [
      buildSkillRef('builtin', 'playwright-runner'),
      buildSkillRef('builtin', 'aws-cli'),
    ];
    expect(intersectSkills(null, agent)).toEqual(agent);
  });

  it('returns orch skills when agent is null (agent inherits all)', () => {
    const orch = [buildSkillRef('builtin', 'playwright-runner')];
    expect(intersectSkills(orch, null)).toEqual(orch);
  });

  it('returns null when both are null', () => {
    expect(intersectSkills(null, null)).toBeNull();
  });

  it('returns intersection of both', () => {
    const orch = [
      buildSkillRef('builtin', 'playwright-runner'),
      buildSkillRef('builtin', 'aws-cli'),
      buildSkillRef('builtin', 'gcp-cli'),
    ];
    const agent = [
      buildSkillRef('builtin', 'playwright-runner'),
      buildSkillRef('builtin', 'gcp-cli'),
      buildSkillRef('builtin', 'perplexity-research'),
    ];
    const result = intersectSkills(orch, agent);
    expect(result).toEqual([
      buildSkillRef('builtin', 'playwright-runner'),
      buildSkillRef('builtin', 'gcp-cli'),
    ]);
  });

  it('returns empty array when no overlap', () => {
    const orch = [buildSkillRef('builtin', 'aws-cli')];
    const agent = [buildSkillRef('builtin', 'gcp-cli')];
    expect(intersectSkills(orch, agent)).toEqual([]);
  });
});

describe('narrowMcpChain', () => {
  it('returns node IDs when agent is null (agent inherits all)', () => {
    expect(narrowMcpChain(null, ['n1', 'n2'])).toEqual(['n1', 'n2']);
  });

  it('returns agent IDs when node is null (node inherits agent)', () => {
    expect(narrowMcpChain(['a1', 'a2'], null)).toEqual(['a1', 'a2']);
  });

  it('returns null when both are null', () => {
    expect(narrowMcpChain(null, null)).toBeNull();
  });

  it('returns intersection (narrowing)', () => {
    const result = narrowMcpChain(['a1', 'a2', 'a3'], ['a2', 'a3', 'n4']);
    expect(result).toEqual(['a2', 'a3']);
  });

  it('returns empty array when no overlap', () => {
    expect(narrowMcpChain(['a1'], ['n1'])).toEqual([]);
  });
});
