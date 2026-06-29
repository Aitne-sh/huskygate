/**
 * Coverage tests for dashboard/skills.ts
 * Targets exported helpers that remain after the unified skills cleanup.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listSkills,
  matchSkillCreate,
  matchSkillDetail,
  matchSkillFile,
  resolveSkillsDir,
} from './skills.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'skills-cov-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveSkillsDir', () => {
  it('resolves local skills into the unified huskygate root', () => {
    const claudeDir = resolveSkillsDir('claude', 'local', tmpDir);
    const geminiDir = resolveSkillsDir('gemini', 'local', tmpDir);
    const codexDir = resolveSkillsDir('codex', 'local', tmpDir);
    expect(claudeDir).toContain('.huskygate');
    expect(geminiDir).toContain('.huskygate');
    expect(codexDir).toContain('.huskygate');
    expect(claudeDir).toContain('skills');
  });

  it('resolves project skills into <workdir>/.huskygate/skills', () => {
    expect(resolveSkillsDir('claude', 'project', tmpDir)).toBe(
      join(tmpDir, '.huskygate', 'skills'),
    );
    expect(resolveSkillsDir('gemini', 'project', tmpDir)).toBe(
      join(tmpDir, '.huskygate', 'skills'),
    );
    expect(resolveSkillsDir('codex', 'project', tmpDir)).toBe(join(tmpDir, '.huskygate', 'skills'));
  });
});

describe('listSkills', () => {
  it('returns empty array when the skills dir does not exist', () => {
    expect(listSkills('claude', 'project', join(tmpDir, 'missing'))).toEqual([]);
  });

  it('skips entries with invalid names or missing variants', () => {
    const skillsBase = resolveSkillsDir('claude', 'project', tmpDir);
    mkdirSync(skillsBase, { recursive: true });
    mkdirSync(join(skillsBase, 'INVALID_NAME'), { recursive: true });
    mkdirSync(join(skillsBase, 'missing-variant'), { recursive: true });
    writeFileSync(join(skillsBase, 'missing-variant', 'README.md'), 'not a skill', 'utf-8');

    expect(listSkills('claude', 'project', tmpDir)).toEqual([]);
  });

  it('lists valid skills with metadata and support files', () => {
    const skillsBase = resolveSkillsDir('claude', 'project', tmpDir);
    const skillDir = join(skillsBase, 'test-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.claude.md'),
      '---\nname: Test Skill\ndescription: A test\n---\nSome body content',
      'utf-8',
    );
    writeFileSync(join(skillDir, 'helper.sh'), '#!/bin/bash', 'utf-8');

    const result = listSkills('claude', 'project', tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      dirName: 'test-skill',
      name: 'Test Skill',
      description: 'A test',
      hasErrors: false,
    });
    expect(result[0]?.supportFiles).toContain('helper.sh');
  });

  it('falls back to dirName and marks unreadable variants as errors', () => {
    const skillsBase = resolveSkillsDir('claude', 'project', tmpDir);
    const skillDir = join(skillsBase, 'broken-skill');
    mkdirSync(skillDir, { recursive: true });
    mkdirSync(join(skillDir, 'SKILL.claude.md'), { recursive: true });

    const result = listSkills('claude', 'project', tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('broken-skill');
    expect(result[0]?.hasErrors).toBe(true);
  });
});

describe('matchSkillDetail', () => {
  it('matches valid skill detail paths', () => {
    expect(matchSkillDetail('/api/skills/claude/local/my-skill')).toEqual({
      tool: 'claude',
      scope: 'local',
      name: 'my-skill',
    });
  });

  it('rejects invalid detail paths', () => {
    expect(matchSkillDetail('/api/skills/invalid/local/my-skill')).toBeNull();
    expect(matchSkillDetail('/api/skills/claude/global/my-skill')).toBeNull();
    expect(matchSkillDetail('/api/skills/claude/local/INVALID')).toBeNull();
  });
});

describe('matchSkillCreate', () => {
  it('matches valid create paths', () => {
    expect(matchSkillCreate('/api/skills/claude/project')).toEqual({
      tool: 'claude',
      scope: 'project',
    });
  });

  it('rejects invalid create paths', () => {
    expect(matchSkillCreate('/api/skills/invalid/project')).toBeNull();
  });
});

describe('matchSkillFile', () => {
  it('matches and decodes valid file paths', () => {
    expect(matchSkillFile('/api/skills/claude/local/my-skill/files/script.sh')).toEqual({
      tool: 'claude',
      scope: 'local',
      name: 'my-skill',
      filename: 'script.sh',
    });
    expect(matchSkillFile('/api/skills/claude/local/my-skill/files/my%20file.txt')?.filename).toBe(
      'my file.txt',
    );
  });

  it('rejects invalid encoded file paths', () => {
    expect(matchSkillFile('/api/skills/claude/local/my-skill/files/%ZZ')).toBeNull();
  });
});
