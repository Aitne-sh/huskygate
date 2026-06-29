import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverSkillCatalog } from './catalog.js';

let tmpRoot: string;
let builtinDir: string;
let localDir: string;
let projectDir: string;

function writeSkill(
  rootDir: string,
  dirName: string,
  options: {
    manifest?: string;
    claude?: string;
    codex?: string;
    gemini?: string;
    supportFiles?: Record<string, string>;
  } = {},
): void {
  const skillDir = join(rootDir, dirName);
  mkdirSync(skillDir, { recursive: true });
  if (options.manifest !== undefined) {
    writeFileSync(join(skillDir, 'skill.json'), options.manifest, 'utf-8');
  }
  if (options.claude) {
    writeFileSync(join(skillDir, 'SKILL.claude.md'), options.claude, 'utf-8');
  }
  if (options.codex) {
    writeFileSync(join(skillDir, 'SKILL.codex.md'), options.codex, 'utf-8');
  }
  if (options.gemini) {
    writeFileSync(join(skillDir, 'SKILL.gemini.md'), options.gemini, 'utf-8');
  }
  for (const [filename, content] of Object.entries(options.supportFiles ?? {})) {
    const fullPath = join(skillDir, filename);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
  }
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-catalog-'));
  builtinDir = join(tmpRoot, 'builtin');
  localDir = join(tmpRoot, 'local');
  projectDir = join(tmpRoot, 'project');
  mkdirSync(builtinDir, { recursive: true });
  mkdirSync(localDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('discoverSkillCatalog', () => {
  it('discovers built-in, local, and project skills with derived metadata', () => {
    writeSkill(builtinDir, 'playwright-runner', {
      manifest: JSON.stringify({
        schemaVersion: 1,
        excludeDirs: ['.venv', '__pycache__', '.git', 'node_modules'],
        envVars: [],
      }),
      claude: '---\nname: Playwright Runner\ndescription: Browser automation\n---\nbody',
      codex: '---\nname: Playwright Runner\n---\nbody',
      supportFiles: { 'scripts/run.sh': '#!/bin/bash' },
    });
    writeSkill(localDir, 'local-helper', {
      manifest: JSON.stringify({
        schemaVersion: 1,
        excludeDirs: ['.venv', '__pycache__', '.git', 'node_modules'],
        envVars: [],
      }),
      claude: '---\nname: Local Helper\n---\nbody',
    });
    writeSkill(projectDir, 'project-helper', {
      manifest: JSON.stringify({
        schemaVersion: 1,
        excludeDirs: ['.venv', '__pycache__', '.git', 'node_modules'],
        envVars: [],
      }),
      gemini: '---\nname: Project Helper\n---\nbody',
    });

    const catalog = discoverSkillCatalog({
      builtinDir,
      localSkillsDir: localDir,
      projectSkillsDir: projectDir,
    });

    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillRef: 'builtin:playwright-runner',
          sourceKind: 'builtin',
          editable: false,
          toolVariants: ['claude', 'codex'],
          supportFiles: ['scripts/run.sh'],
        }),
        expect.objectContaining({
          skillRef: 'local:local-helper',
          sourceKind: 'local',
          editable: true,
          toolVariants: ['claude'],
        }),
        expect.objectContaining({
          skillRef: 'project:project-helper',
          sourceKind: 'project',
          editable: true,
          toolVariants: ['gemini'],
        }),
      ]),
    );
  });

  it('falls back to the default manifest when skill.json is missing', () => {
    writeSkill(localDir, 'missing-manifest', {
      codex: '---\nname: Missing Manifest\n---\nbody',
      supportFiles: { 'scripts/helper.sh': '#!/bin/bash' },
    });

    const catalog = discoverSkillCatalog({
      localSkillsDir: localDir,
      sourceKinds: ['local'],
    });

    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toEqual(
      expect.objectContaining({
        dirName: 'missing-manifest',
        manifestStatus: 'missing',
        hasErrors: false,
        supportFiles: ['scripts/helper.sh'],
      }),
    );
    expect(catalog[0]?.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'manifest-missing' })]),
    );
    expect(catalog[0]?.manifest.envVars).toEqual([]);
  });

  it('marks invalid manifests as errors and falls back to defaults', () => {
    writeSkill(projectDir, 'broken-manifest', {
      manifest: '{not valid json',
      claude: '---\nname: Broken Manifest\n---\nbody',
    });

    const catalog = discoverSkillCatalog({
      projectSkillsDir: projectDir,
      sourceKinds: ['project'],
    });

    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.manifestStatus).toBe('invalid');
    expect(catalog[0]?.hasErrors).toBe(true);
    expect(catalog[0]?.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'manifest-invalid' })]),
    );
    expect(catalog[0]?.manifest.excludeDirs).toEqual([
      '.venv',
      '__pycache__',
      '.git',
      'node_modules',
    ]);
  });

  it('ignores envVars declared by custom skills and marks the manifest invalid', () => {
    writeSkill(projectDir, 'project-helper', {
      manifest: JSON.stringify({
        schemaVersion: 1,
        excludeDirs: ['.venv', '__pycache__', '.git', 'node_modules'],
        envVars: ['PERPLEXITY_API_KEY'],
      }),
      claude: '---\nname: Project Helper\n---\nbody',
    });

    const catalog = discoverSkillCatalog({
      projectSkillsDir: projectDir,
      sourceKinds: ['project'],
    });

    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.manifest.envVars).toEqual([]);
    expect(catalog[0]?.manifestStatus).toBe('invalid');
    expect(catalog[0]?.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'manifest-invalid-env-vars' })]),
    );
  });

  it('detects duplicate dir names across source roots', () => {
    const manifest = JSON.stringify({
      schemaVersion: 1,
      excludeDirs: ['.venv', '__pycache__', '.git', 'node_modules'],
      envVars: [],
    });
    writeSkill(builtinDir, 'shared-skill', { manifest, claude: '---\n---\nbody' });
    writeSkill(projectDir, 'shared-skill', { manifest, codex: '---\n---\nbody' });

    const catalog = discoverSkillCatalog({
      builtinDir,
      projectSkillsDir: projectDir,
      sourceKinds: ['builtin', 'project'],
    });

    expect(catalog).toHaveLength(2);
    expect(catalog.every((entry) => entry.hasErrors)).toBe(true);
    expect(catalog[0]?.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'duplicate-dir-name' })]),
    );
    expect(catalog[1]?.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'duplicate-dir-name' })]),
    );
  });

  it('keeps missing-variant directories in the catalog with an error issue', () => {
    writeSkill(projectDir, 'variantless-skill', {
      manifest: JSON.stringify({
        schemaVersion: 1,
        excludeDirs: ['.venv', '__pycache__', '.git', 'node_modules'],
        envVars: [],
      }),
    });

    const catalog = discoverSkillCatalog({
      projectSkillsDir: projectDir,
      sourceKinds: ['project'],
    });

    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.toolVariants).toEqual([]);
    expect(catalog[0]?.hasErrors).toBe(true);
    expect(catalog[0]?.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'missing-variants' })]),
    );
  });
});
