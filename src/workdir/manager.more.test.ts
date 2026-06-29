import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config, ToolName } from '../config.js';
import { type SkillRef, buildSkillRef } from '../skills/catalog.js';

const mocked = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerDebug: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: mocked.loggerInfo,
    warn: mocked.loggerWarn,
    debug: mocked.loggerDebug,
    error: vi.fn(),
  },
}));

vi.mock('node:child_process', () => ({
  execFileSync: mocked.execFileSync,
}));

import { WorkdirManager } from './manager.js';

function createConfig(workdirRoot: string): Config {
  return {
    slack: {
      botToken: 'xoxb-test',
      appToken: 'xapp-test',
    },
    allowedUserIds: ['U_TEST'],
    allowedTeamId: null,
    defaultTool: 'claude',
    maxConcurrency: 2,
    maxRuntimeSec: 900,
    noOutputTimeoutSec: 90,
    claudeModel: null,
    codexModel: null,
    geminiModel: null,
    claudeMcpAuthServer: null,
    geminiMcpAuthServer: null,
    codexMcpAuthServer: null,
    workdirRoot,
    allowedWorkdirRoots: [workdirRoot],
    serverApiPort: 3738,
    serverApiSecret: 'test-api-secret',
    dashboardSecret: 'test-dashboard-secret',
    sessionIdleTimeoutSec: 86400,
    sessionCleanupEnabled: true,
    scheduleEnabled: false,
    schedulePollIntervalSec: 30,
    scheduleMaxConcurrent: 1,
    scheduleDefaultNotifyChannel: null,
    logLevel: 'info',
    toolAutoApproveMode: false,
    codexDefaultSandboxMode: 'write' as const,
    claudeDefaultMode: 'write' as const,
    geminiDefaultMode: 'write' as const,
    cloudflareTunnelEnabled: false,
    cloudflareTunnelToken: null,
    githubWebhookIpAllowlist: true,
    dashboardCookieSecure: true,
    logStacks: false,
    skillTemplateDir: null,
  };
}

function builtinSkillDeps(...dirNames: string[]) {
  const enabledRefs = new Set<SkillRef>(
    dirNames.map((dirName) => buildSkillRef('builtin', dirName)),
  );
  return {
    skillEnablementStore: {
      getEnabled: (skillRef: SkillRef, tool: ToolName) =>
        tool === 'claude' && enabledRefs.has(skillRef) ? true : null,
    },
  };
}

describe('WorkdirManager additional coverage', () => {
  const tempRoots: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('creates per-session workdir with hashed name', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-mode-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'sessions');

    const manager = new WorkdirManager(createConfig(workdirRoot));
    const sessionDir = manager.getSessionWorkdir('session-abc');
    expect(path.basename(sessionDir)).toMatch(/^sess_[a-f0-9]{12}$/);
    expect(existsSync(sessionDir)).toBe(true);

    // Same session key returns same path
    const sessionDir2 = manager.getSessionWorkdir('session-abc');
    expect(sessionDir2).toBe(sessionDir);
  });

  it('validates custom workdir paths with success and failure branches', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-validate-'));
    tempRoots.push(root);
    const allowedRoot = path.join(root, 'allowed');
    const disallowedRoot = path.join(root, 'other');
    mkdirSync(allowedRoot, { recursive: true });
    mkdirSync(disallowedRoot, { recursive: true });
    const disallowedSubdir = path.join(disallowedRoot, 'x');
    mkdirSync(disallowedSubdir, { recursive: true });
    const allowedSubdir = path.join(allowedRoot, 'project');
    mkdirSync(allowedSubdir, { recursive: true });
    const filePath = path.join(allowedRoot, 'not-dir.txt');
    writeFileSync(filePath, 'x', 'utf-8');

    const config = createConfig(allowedRoot);
    config.allowedWorkdirRoots = [allowedRoot, path.join(root, 'missing-root')];
    const manager = new WorkdirManager(config);

    expect(manager.validateCustomWorkdir(allowedSubdir)).toBe(fs.realpathSync(allowedSubdir));
    expect(() => manager.validateCustomWorkdir(path.join(root, 'does-not-exist'))).toThrow(
      'Path does not exist',
    );
    expect(() => manager.validateCustomWorkdir(disallowedSubdir)).toThrow(
      'Path not in allowed roots',
    );
    expect(() => manager.validateCustomWorkdir(filePath)).toThrow('Path is not a directory');
  });

  it('returns null/zero early when archive or cleanup targets are absent', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-empty-'));
    tempRoots.push(root);
    const manager = new WorkdirManager(createConfig(path.join(root, 'workdir')));
    expect(manager.archiveLegacyDefaultWorkdirIfUnused([])).toBeNull();
    expect(manager.cleanupUnusedSessionWorkdirs([])).toBe(0);
  });

  it('ignores non-directory entries and reserved directories during cleanup', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-clean-reserved-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    mkdirSync(path.join(workdirRoot, '_archive'), { recursive: true });
    mkdirSync(path.join(workdirRoot, 'default'), { recursive: true });
    mkdirSync(path.join(workdirRoot, 'deadbeef'), { recursive: true });
    writeFileSync(path.join(workdirRoot, 'cafebabe'), 'not-a-directory', 'utf-8');

    const manager = new WorkdirManager(createConfig(workdirRoot));
    const removed = manager.cleanupUnusedSessionWorkdirs([]);

    expect(removed).toBe(1);
    expect(existsSync(path.join(workdirRoot, '_archive'))).toBe(true);
    expect(existsSync(path.join(workdirRoot, 'default'))).toBe(true);
    expect(existsSync(path.join(workdirRoot, 'cafebabe'))).toBe(true);
    expect(existsSync(path.join(workdirRoot, 'deadbeef'))).toBe(false);
  });

  it('handles archive name collision and unresolved referenced paths', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-collision-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const defaultDir = path.join(workdirRoot, 'default');
    mkdirSync(defaultDir, { recursive: true });
    writeFileSync(path.join(defaultDir, 'CLAUDE.md'), '# legacy', 'utf-8');

    const timestamp = '2026-01-01T00-00-00-000Z';
    const archiveRoot = path.join(workdirRoot, '_archive');
    mkdirSync(path.join(archiveRoot, `default_${timestamp}`), { recursive: true });

    const manager = new WorkdirManager(createConfig(workdirRoot));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
      const archived = manager.archiveLegacyDefaultWorkdirIfUnused(['/path/does/not/exist']);
      expect(archived).toBe(path.join(archiveRoot, `default_${timestamp}_1`));
      expect(existsSync(path.join(archiveRoot, `default_${timestamp}_1`, 'CLAUDE.md'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ensures session workdirs by creating instruction files and seeding skills', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-ensure-'));
    tempRoots.push(root);
    const workdirBase = path.join(root, 'workdir');
    const manager = new WorkdirManager(createConfig(workdirBase));

    const dirA = path.join(root, 'a');
    const dirB = path.join(root, 'b');

    manager.ensureSessionWorkdirs([
      { workdir: dirA, tool: 'claude', mode: 'write' },
      { workdir: dirB, tool: 'codex', mode: 'write' },
    ]);

    // Instruction files should be created
    expect(existsSync(path.join(dirA, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(path.join(dirB, 'AGENTS.md'))).toBe(true);

    // Content should contain builder output (identity section)
    const claudeContent = readFileSync(path.join(dirA, 'CLAUDE.md'), 'utf-8');
    expect(claudeContent).toContain('Claude Code Workspace Agent');

    // With autoApprove=true
    const dirC = path.join(root, 'c');
    manager.ensureSessionWorkdirs([{ workdir: dirC, tool: 'gemini', mode: 'write' }], true);
    expect(existsSync(path.join(dirC, 'GEMINI.md'))).toBe(true);
    const geminiContent = readFileSync(path.join(dirC, 'GEMINI.md'), 'utf-8');
    expect(geminiContent).toContain('Auto-approve mode is active');
  });

  it('seeds dev instruction file with success/skip/failure branches', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-dev-seed-'));
    tempRoots.push(root);
    const workdir = path.join(root, 'workdir');
    mkdirSync(workdir, { recursive: true });
    const manager = new WorkdirManager(createConfig(root));

    const created = manager.seedDevInstructionFile(workdir, 'gemini', '# hello');
    expect(created).toBe(true);
    expect(mocked.loggerInfo).toHaveBeenCalledWith(
      'dev_instruction_seeded',
      expect.objectContaining({ tool: 'gemini' }),
    );

    const skipped = manager.seedDevInstructionFile(workdir, 'gemini', '# again');
    expect(skipped).toBe(false);

    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('write failed');
    });
    const failed = manager.seedDevInstructionFile(workdir, 'claude', '# nope');
    expect(failed).toBe(false);
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'dev_instruction_seed_failed',
      expect.objectContaining({ tool: 'claude' }),
    );
    writeSpy.mockRestore();
  });

  it('handles non-Error exceptions while seeding dev instruction file', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-dev-seed-string-'));
    tempRoots.push(root);
    const workdir = path.join(root, 'workdir');
    mkdirSync(workdir, { recursive: true });
    const manager = new WorkdirManager(createConfig(root));

    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw 'write failed by string';
    });
    const created = manager.seedDevInstructionFile(workdir, 'claude', '# fail');
    writeSpy.mockRestore();

    expect(created).toBe(false);
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'dev_instruction_seed_failed',
      expect.objectContaining({ error: 'write failed by string' }),
    );
  });

  it('prepares dev workdir by ensuring the directory exists', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-dev-prepare-'));
    tempRoots.push(root);
    const manager = new WorkdirManager(createConfig(root));
    const devDir = path.join(root, 'dev-session');
    manager.prepareDevWorkdir(devDir);
    expect(existsSync(devDir)).toBe(true);
  });

  it('cleans up stale session dirs only when old enough', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-stale-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    mkdirSync(workdirRoot, { recursive: true });

    const manager = new WorkdirManager(createConfig(workdirRoot));
    const oldDir = path.join(workdirRoot, 'sess_aabbccddeeff'); // legacy 12-hex format
    const recentDir = path.join(workdirRoot, 'a1b2c3d4'); // current 8-hex format
    const nonSessionDir = path.join(workdirRoot, 'custom');
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(recentDir, { recursive: true });
    mkdirSync(nonSessionDir, { recursive: true });

    const now = Date.now() / 1000;
    const eightDays = 8 * 24 * 60 * 60;
    utimesSync(oldDir, now - eightDays, now - eightDays);
    utimesSync(recentDir, now, now);

    const removed = manager.cleanupStaleSessions();
    expect(removed).toBe(1);
    expect(existsSync(oldDir)).toBe(false);
    expect(existsSync(recentDir)).toBe(true);
    expect(existsSync(nonSessionDir)).toBe(true);
    expect(mocked.loggerInfo).toHaveBeenCalledWith(
      'workdir_cleanup_complete',
      expect.objectContaining({ removed: 1 }),
    );
  });

  it('returns 0 for stale cleanup when workdir root does not exist', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-stale-missing-'));
    tempRoots.push(root);
    const manager = new WorkdirManager(createConfig(path.join(root, 'missing-workdir')));

    expect(manager.cleanupStaleSessions()).toBe(0);
  });

  it('seeds local custom skills from the unified catalog roots', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-local-custom-'));
    tempRoots.push(root);
    const fakeHome = path.join(root, 'home');
    const localSkillDir = path.join(fakeHome, '.huskygate', 'skills', 'local-helper');
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    mkdirSync(localSkillDir, { recursive: true });
    writeFileSync(
      path.join(localSkillDir, 'SKILL.claude.md'),
      '---\nname: Local Helper\ndescription: local skill\n---\n# Local Body\n',
      'utf-8',
    );

    const originalHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      const manager = new WorkdirManager(createConfig(workdirRoot));
      manager.prepareWorkdirSkillsOnly(workdir, 'claude');
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }

    const targetSkillMd = path.join(workdir, '.claude', 'skills', 'local-helper', 'SKILL.md');
    expect(readFileSync(targetSkillMd, 'utf-8')).toContain('Local Helper');
    expect(mocked.loggerInfo).toHaveBeenCalledWith(
      'custom_skill_seeded',
      expect.objectContaining({ skill: 'local-helper', sourceKind: 'local' }),
    );
  });

  it('seeds project custom skills from the unified catalog roots', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-project-custom-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const projectSkillDir = path.join(workdirRoot, '.huskygate', 'skills', 'project-helper');
    mkdirSync(projectSkillDir, { recursive: true });
    writeFileSync(
      path.join(projectSkillDir, 'SKILL.claude.md'),
      '---\nname: Project Helper\n---\n# Project Body\n',
      'utf-8',
    );

    const manager = new WorkdirManager(createConfig(workdirRoot));
    manager.prepareWorkdirSkillsOnly(workdir, 'claude');

    const targetSkillMd = path.join(workdir, '.claude', 'skills', 'project-helper', 'SKILL.md');
    expect(readFileSync(targetSkillMd, 'utf-8')).toContain('Project Helper');
    expect(mocked.loggerInfo).toHaveBeenCalledWith(
      'custom_skill_seeded',
      expect.objectContaining({ skill: 'project-helper', sourceKind: 'project' }),
    );
  });

  it('does not seed custom skills when enabledSkills is explicitly empty', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-project-custom-explicit-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const projectSkillDir = path.join(workdirRoot, '.huskygate', 'skills', 'project-helper');
    mkdirSync(projectSkillDir, { recursive: true });
    writeFileSync(path.join(projectSkillDir, 'SKILL.claude.md'), '# Project Body\n', 'utf-8');

    const manager = new WorkdirManager(createConfig(workdirRoot));
    manager.prepareWorkdirSkillsOnly(workdir, 'claude', []);

    expect(existsSync(path.join(workdir, '.claude', 'skills', 'project-helper', 'SKILL.md'))).toBe(
      false,
    );
  });

  it('seeds an explicitly selected custom skill ref', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-project-custom-selected-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const projectSkillDir = path.join(workdirRoot, '.huskygate', 'skills', 'project-helper');
    mkdirSync(projectSkillDir, { recursive: true });
    writeFileSync(path.join(projectSkillDir, 'SKILL.claude.md'), '# Project Body\n', 'utf-8');

    const manager = new WorkdirManager(createConfig(workdirRoot));
    manager.prepareWorkdirSkillsOnly(workdir, 'claude', [
      buildSkillRef('project', 'project-helper'),
    ]);

    expect(existsSync(path.join(workdir, '.claude', 'skills', 'project-helper', 'SKILL.md'))).toBe(
      true,
    );
  });

  it('skips duplicate dirName collisions across built-in and custom roots', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-duplicate-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const builtinSkillDir = path.join(skillsDir, 'playwright-runner');
    const projectSkillDir = path.join(workdirRoot, '.huskygate', 'skills', 'playwright-runner');
    mkdirSync(builtinSkillDir, { recursive: true });
    mkdirSync(projectSkillDir, { recursive: true });
    writeFileSync(path.join(builtinSkillDir, 'SKILL.claude.md'), '# builtin\n', 'utf-8');
    writeFileSync(path.join(projectSkillDir, 'SKILL.claude.md'), '# custom\n', 'utf-8');

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));
    manager.prepareWorkdirSkillsOnly(workdir, 'claude');

    expect(
      existsSync(path.join(workdir, '.claude', 'skills', 'playwright-runner', 'SKILL.md')),
    ).toBe(false);
  });

  it('seeds enabled builtin skill files and strips disable-model-invocation flag', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-seed-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    const scriptsDir = path.join(skillDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, 'SKILL.claude.md'),
      [
        '---',
        'name: playwright-runner',
        'disable-model-invocation: true',
        'description: test',
        '---',
        '',
        '# Body',
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(path.join(scriptsDir, 'run.py'), 'print("ok")\n', 'utf-8');
    writeFileSync(path.join(scriptsDir, 'run.sh'), '#!/bin/sh\necho ok\n', 'utf-8');
    writeFileSync(path.join(skillDir, 'requirements.txt'), 'playwright\n', 'utf-8');

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));
    manager.prepareWorkdirSkillsOnly(workdir, 'claude');

    const targetSkillDir = path.join(workdir, '.claude', 'skills', 'playwright-runner');
    const skillMd = readFileSync(path.join(targetSkillDir, 'SKILL.md'), 'utf-8');
    expect(skillMd).toContain('name: playwright-runner');
    expect(skillMd).not.toContain('disable-model-invocation: true');
    expect(existsSync(path.join(targetSkillDir, 'scripts', 'run.py'))).toBe(true);
    expect(existsSync(path.join(targetSkillDir, 'scripts', 'run.sh'))).toBe(true);
    expect(readFileSync(path.join(targetSkillDir, 'requirements.txt'), 'utf-8')).toBe(
      'playwright\n',
    );

    // Verify venv auto-setup was attempted (requirements.txt has real deps)
    expect(mocked.execFileSync.mock.calls).toContainEqual([
      'python3',
      ['-m', 'venv', expect.stringContaining(`${path.sep}.venv`)],
      expect.objectContaining({ timeout: 30_000 }),
    ]);
    expect(mocked.execFileSync.mock.calls).toContainEqual([
      expect.stringContaining(`${path.sep}.venv${path.sep}bin${path.sep}pip`),
      ['install', '-q', '-r', expect.stringContaining(`${path.sep}requirements.txt`)],
      expect.objectContaining({ timeout: 120_000 }),
    ]);
  });

  it('skips venv setup when requirements.txt has only comments', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-venv-skip-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    const scriptsDir = path.join(skillDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, 'SKILL.claude.md'),
      '---\nname: playwright-runner\n---\n# Body\n',
      'utf-8',
    );
    writeFileSync(path.join(scriptsDir, 'run.py'), 'print("ok")\n', 'utf-8');
    // Only comments — no real dependencies
    writeFileSync(path.join(skillDir, 'requirements.txt'), '# No deps needed\n', 'utf-8');

    mocked.execFileSync.mockClear();
    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));
    manager.prepareWorkdirSkillsOnly(workdir, 'claude');

    // execFileSync should NOT be called since requirements.txt has no real deps
    expect(mocked.execFileSync).not.toHaveBeenCalled();
  });

  it('logs warning and continues when venv setup fails', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-venv-fail-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    const scriptsDir = path.join(skillDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, 'SKILL.claude.md'),
      '---\nname: playwright-runner\n---\n# Body\n',
      'utf-8',
    );
    writeFileSync(path.join(scriptsDir, 'run.py'), 'print("ok")\n', 'utf-8');
    writeFileSync(path.join(skillDir, 'requirements.txt'), 'selenium>=4.0\n', 'utf-8');

    mocked.execFileSync.mockClear();
    mocked.execFileSync.mockImplementation(() => {
      throw new Error('python3 not found');
    });

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));
    // Should not throw
    manager.prepareWorkdirSkillsOnly(workdir, 'claude');

    // Skill files should still be seeded despite venv failure
    const targetSkillDir = path.join(workdir, '.claude', 'skills', 'playwright-runner');
    expect(existsSync(path.join(targetSkillDir, 'SKILL.md'))).toBe(true);
    // When all python candidates fail, resolvePython() returns null → logs skill_venv_no_python
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'skill_venv_no_python',
      expect.objectContaining({ skill: 'playwright-runner' }),
    );

    // Reset mock to default (no-op) for subsequent tests
    mocked.execFileSync.mockReset();
  });

  it('stringifies non-Error failures during venv setup', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-venv-string-fail-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    const scriptsDir = path.join(skillDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, 'SKILL.claude.md'),
      '---\nname: playwright-runner\n---\n# Body\n',
      'utf-8',
    );
    writeFileSync(path.join(scriptsDir, 'run.py'), 'print("ok")\n', 'utf-8');
    writeFileSync(path.join(skillDir, 'requirements.txt'), 'selenium>=4.0\n', 'utf-8');

    mocked.execFileSync.mockClear();
    mocked.execFileSync.mockImplementation(() => {
      throw 'venv string fail';
    });

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));
    manager.prepareWorkdirSkillsOnly(workdir, 'claude');

    // When all python candidates throw, resolvePython() returns null → logs skill_venv_no_python
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'skill_venv_no_python',
      expect.objectContaining({ skill: 'playwright-runner' }),
    );

    mocked.execFileSync.mockReset();
  });

  it('skips reseeding when existing skill has no disable-model-invocation marker', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-skip-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    mkdirSync(skillDir, { recursive: true });
    mkdirSync(path.join(workdir, '.claude', 'skills', 'playwright-runner'), { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.claude.md'), '# source\n', 'utf-8');
    writeFileSync(
      path.join(workdir, '.claude', 'skills', 'playwright-runner', 'SKILL.md'),
      '# existing\n',
      'utf-8',
    );

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));
    manager.prepareWorkdirSkillsOnly(workdir, 'claude');

    const existing = readFileSync(
      path.join(workdir, '.claude', 'skills', 'playwright-runner', 'SKILL.md'),
      'utf-8',
    );
    expect(existing).toBe('# existing\n');
  });

  it('syncs scripts for existing seeded skills when target is missing and source is newer', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-sync-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    const scriptsDir = path.join(skillDir, 'scripts');
    const sourceScript = path.join(scriptsDir, 'run.py');
    const targetScript = path.join(
      workdir,
      '.claude',
      'skills',
      'playwright-runner',
      'scripts',
      'run.py',
    );
    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(path.dirname(path.dirname(targetScript)), { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.claude.md'), '# source\n', 'utf-8');
    writeFileSync(
      path.join(path.dirname(path.dirname(targetScript)), 'SKILL.md'),
      '# existing\n',
      'utf-8',
    );
    writeFileSync(sourceScript, 'print("v1")\n', 'utf-8');

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));

    // First run: target scripts directory is missing.
    manager.prepareWorkdirSkillsOnly(workdir, 'claude');
    expect(readFileSync(targetScript, 'utf-8')).toContain('v1');
    expect(mocked.loggerInfo).toHaveBeenCalledWith(
      'skill_assets_synced',
      expect.objectContaining({ skill: 'playwright-runner', reason: 'missing_target' }),
    );

    // Second run: source becomes newer, so sync should update existing target file.
    writeFileSync(sourceScript, 'print("v2")\n', 'utf-8');
    const future = new Date(Date.now() + 2000);
    utimesSync(sourceScript, future, future);
    manager.prepareWorkdirSkillsOnly(workdir, 'claude');

    expect(readFileSync(targetScript, 'utf-8')).toContain('v2');
    expect(mocked.loggerInfo).toHaveBeenCalledWith(
      'skill_assets_synced',
      expect.objectContaining({ skill: 'playwright-runner', filesUpdated: 1 }),
    );
  });

  it('prunes stale destination scripts while syncing content', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-sync-prune-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    const scriptsDir = path.join(skillDir, 'scripts');
    const targetSkillDir = path.join(workdir, '.claude', 'skills', 'playwright-runner');
    const targetScriptsDir = path.join(targetSkillDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(targetScriptsDir, { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.claude.md'), '# source\n', 'utf-8');
    writeFileSync(path.join(targetSkillDir, 'SKILL.md'), '# existing\n', 'utf-8');
    writeFileSync(path.join(scriptsDir, 'run.py'), 'print("fresh")\n', 'utf-8');
    writeFileSync(path.join(targetScriptsDir, 'run.py'), 'print("stale")\n', 'utf-8');
    writeFileSync(path.join(targetScriptsDir, 'old.py'), 'print("legacy")\n', 'utf-8');

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));

    manager.prepareWorkdirSkillsOnly(workdir, 'claude');

    expect(readFileSync(path.join(targetScriptsDir, 'run.py'), 'utf-8')).toBe('print("fresh")\n');
    expect(existsSync(path.join(targetScriptsDir, 'old.py'))).toBe(false);
    expect(mocked.loggerInfo).toHaveBeenCalledWith(
      'skill_assets_synced',
      expect.objectContaining({ skill: 'playwright-runner', filesUpdated: 1, filesRemoved: 1 }),
    );
  });

  it('skips skill seeding when the destination skill path traverses a symlink', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-symlink-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    const outsideSkills = path.join(root, 'outside-skills');
    mkdirSync(path.join(workdir, '.claude'), { recursive: true });
    mkdirSync(skillDir, { recursive: true });
    mkdirSync(outsideSkills, { recursive: true });
    fs.symlinkSync(outsideSkills, path.join(workdir, '.claude', 'skills'));
    writeFileSync(path.join(skillDir, 'SKILL.claude.md'), '# source\n', 'utf-8');
    writeFileSync(path.join(skillDir, 'requirements.txt'), '# no deps\n', 'utf-8');

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));

    manager.prepareWorkdirSkillsOnly(workdir, 'claude');

    expect(existsSync(path.join(outsideSkills, 'playwright-runner', 'SKILL.md'))).toBe(false);
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'skill_seed_failed',
      expect.objectContaining({ skill: 'playwright-runner' }),
    );
  });

  it('skips skill seeding when requirements.txt is a symlinked leaf path', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-req-symlink-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    const targetSkillDir = path.join(workdir, '.claude', 'skills', 'playwright-runner');
    const outsideDir = path.join(root, 'outside');
    const outsideReq = path.join(outsideDir, 'requirements.txt');
    mkdirSync(skillDir, { recursive: true });
    mkdirSync(targetSkillDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(outsideReq, 'outside\n', 'utf-8');
    fs.symlinkSync(outsideReq, path.join(targetSkillDir, 'requirements.txt'));
    writeFileSync(path.join(skillDir, 'SKILL.claude.md'), '# source\n', 'utf-8');
    writeFileSync(path.join(skillDir, 'requirements.txt'), 'playwright\n', 'utf-8');

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));

    manager.prepareWorkdirSkillsOnly(workdir, 'claude');

    expect(existsSync(path.join(targetSkillDir, 'SKILL.md'))).toBe(false);
    expect(readFileSync(outsideReq, 'utf-8')).toBe('outside\n');
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'skill_seed_failed',
      expect.objectContaining({ skill: 'playwright-runner' }),
    );
  });

  it('logs warning when script sync fails for an already-seeded skill', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-sync-fail-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    const targetSkillDir = path.join(workdir, '.claude', 'skills', 'playwright-runner');
    mkdirSync(skillDir, { recursive: true });
    mkdirSync(targetSkillDir, { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.claude.md'), '# source\n', 'utf-8');
    writeFileSync(path.join(targetSkillDir, 'SKILL.md'), '# existing\n', 'utf-8');
    writeFileSync(path.join(skillDir, 'requirements.txt'), '# no deps\n', 'utf-8');
    writeFileSync(path.join(targetSkillDir, 'requirements.txt'), '# no deps\n', 'utf-8');

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));
    const managerAccess = manager as unknown as {
      syncSkillAssets: (sourceDir: string, targetDir: string, skillDirName: string) => void;
    };
    const syncSpy = vi.spyOn(managerAccess, 'syncSkillAssets').mockImplementation(() => {
      throw new Error('sync failed');
    });

    manager.prepareWorkdirSkillsOnly(workdir, 'claude');
    syncSpy.mockRestore();

    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'skill_assets_sync_failed',
      expect.objectContaining({ skill: 'playwright-runner', error: 'sync failed' }),
    );
  });

  it('stringifies non-Error failures when script sync throws', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-sync-fail-string-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    const targetSkillDir = path.join(workdir, '.claude', 'skills', 'playwright-runner');
    mkdirSync(skillDir, { recursive: true });
    mkdirSync(targetSkillDir, { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.claude.md'), '# source\n', 'utf-8');
    writeFileSync(path.join(targetSkillDir, 'SKILL.md'), '# existing\n', 'utf-8');
    writeFileSync(path.join(skillDir, 'requirements.txt'), '# no deps\n', 'utf-8');
    writeFileSync(path.join(targetSkillDir, 'requirements.txt'), '# no deps\n', 'utf-8');

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));
    const managerAccess = manager as unknown as {
      syncSkillAssets: (sourceDir: string, targetDir: string, skillDirName: string) => void;
    };
    const syncSpy = vi.spyOn(managerAccess, 'syncSkillAssets').mockImplementation(() => {
      throw 'sync string fail';
    });

    manager.prepareWorkdirSkillsOnly(workdir, 'claude');
    syncSpy.mockRestore();

    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'skill_assets_sync_failed',
      expect.objectContaining({ skill: 'playwright-runner', error: 'sync string fail' }),
    );
  });

  it('recursively syncs nested scripts and falls back to copy when stat comparison fails', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-sync-recursive-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    const scriptsSource = path.join(skillDir, 'scripts');
    const nestedSource = path.join(scriptsSource, 'nested');
    const targetSkillDir = path.join(workdir, '.claude', 'skills', 'playwright-runner');
    const targetScripts = path.join(targetSkillDir, 'scripts');
    const sourceRunPy = path.join(scriptsSource, 'run.py');
    const targetRunPy = path.join(targetScripts, 'run.py');
    mkdirSync(nestedSource, { recursive: true });
    mkdirSync(targetScripts, { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.claude.md'), '# source\n', 'utf-8');
    writeFileSync(path.join(targetSkillDir, 'SKILL.md'), '# existing\n', 'utf-8');
    writeFileSync(sourceRunPy, 'print("source")\n', 'utf-8');
    writeFileSync(path.join(nestedSource, 'inner.sh'), '#!/bin/sh\necho source\n', 'utf-8');
    writeFileSync(targetRunPy, 'print("target")\n', 'utf-8');
    writeFileSync(path.join(targetSkillDir, 'requirements.txt'), '# no deps\n', 'utf-8');

    const originalStatSync = fs.statSync.bind(fs);
    const statSpy = vi.spyOn(fs, 'statSync').mockImplementation(((p: fs.PathLike) => {
      if (String(p) === targetRunPy) {
        throw new Error('mtime read failed');
      }
      return originalStatSync(p);
    }) as never);

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));
    manager.prepareWorkdirSkillsOnly(workdir, 'claude');
    statSpy.mockRestore();

    expect(readFileSync(targetRunPy, 'utf-8')).toContain('source');
    expect(existsSync(path.join(targetScripts, 'nested', 'inner.sh'))).toBe(true);
    expect(mocked.loggerInfo).toHaveBeenCalledWith(
      'skill_assets_synced',
      expect.objectContaining({ skill: 'playwright-runner', filesUpdated: expect.any(Number) }),
    );
  });

  it('ensures venv for already-seeded skill with real dependencies', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-venv-existing-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    const targetSkillDir = path.join(workdir, '.claude', 'skills', 'playwright-runner');
    mkdirSync(skillDir, { recursive: true });
    mkdirSync(targetSkillDir, { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.claude.md'), '# source\n', 'utf-8');
    // Already-seeded SKILL.md (no disable-model-invocation)
    writeFileSync(path.join(targetSkillDir, 'SKILL.md'), '# existing skill\n', 'utf-8');
    // requirements.txt with real deps (simulates pre-fix session)
    writeFileSync(path.join(targetSkillDir, 'requirements.txt'), 'selenium>=4.0\n', 'utf-8');

    mocked.execFileSync.mockClear();
    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));
    manager.prepareWorkdirSkillsOnly(workdir, 'claude');

    // SKILL.md should NOT be overwritten
    expect(readFileSync(path.join(targetSkillDir, 'SKILL.md'), 'utf-8')).toBe('# existing skill\n');
    // But venv setup should have been attempted
    expect(mocked.execFileSync.mock.calls).toContainEqual([
      'python3',
      ['-m', 'venv', expect.stringContaining(`${path.sep}.venv`)],
      expect.objectContaining({ timeout: 30_000 }),
    ]);
  });

  it('skips venv setup when .venv python already exists', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-venv-present-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    const targetSkillDir = path.join(workdir, '.claude', 'skills', 'playwright-runner');
    const venvPython = path.join(targetSkillDir, '.venv', 'bin', 'python');
    mkdirSync(skillDir, { recursive: true });
    mkdirSync(path.dirname(venvPython), { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.claude.md'), '# source\n', 'utf-8');
    writeFileSync(path.join(targetSkillDir, 'SKILL.md'), '# existing skill\n', 'utf-8');
    writeFileSync(path.join(targetSkillDir, 'requirements.txt'), 'selenium>=4.0\n', 'utf-8');
    writeFileSync(venvPython, '#!/usr/bin/env python3\n', 'utf-8');

    mocked.execFileSync.mockClear();
    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));
    manager.prepareWorkdirSkillsOnly(workdir, 'claude');

    expect(mocked.execFileSync).not.toHaveBeenCalled();
  });

  it('handles missing/misconfigured builtin skill templates without throwing', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-missing-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = path.join(root, 'skills-not-found');
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));
    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      manager.prepareWorkdirSkillsOnly(workdir, 'claude', [
        buildSkillRef('builtin', 'playwright-runner'),
      ]);
    } finally {
      process.chdir(originalCwd);
    }
    expect(mocked.loggerDebug).toHaveBeenCalledWith(
      'skill_template_dir_not_found',
      expect.objectContaining({ skill: 'playwright-runner' }),
    );

    const skillDir = path.join(skillsDir, 'playwright-runner');
    mkdirSync(skillDir, { recursive: true });
    config.skillTemplateDir = skillsDir;
    manager.prepareWorkdirSkillsOnly(workdir, 'claude', [
      buildSkillRef('builtin', 'playwright-runner'),
    ]);
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'skill_md_missing',
      expect.objectContaining({ skill: 'playwright-runner', tool: 'claude' }),
    );
  });

  it('logs skill_source_missing when template root exists but skill directory is absent', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-source-missing-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    mkdirSync(skillsDir, { recursive: true });

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));
    manager.prepareWorkdirSkillsOnly(workdir, 'claude', [
      buildSkillRef('builtin', 'playwright-runner'),
    ]);

    expect(mocked.loggerDebug).toHaveBeenCalledWith(
      'skill_source_missing',
      expect.objectContaining({ skill: 'playwright-runner' }),
    );
  });

  it('returns early when existing SKILL.md cannot be read', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-read-fail-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    const targetSkillMd = path.join(workdir, '.claude', 'skills', 'playwright-runner', 'SKILL.md');
    mkdirSync(skillDir, { recursive: true });
    mkdirSync(path.dirname(targetSkillMd), { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.claude.md'), '# source\n', 'utf-8');
    writeFileSync(targetSkillMd, '# target\n', 'utf-8');

    const originalReadSync = fs.readFileSync.bind(fs);
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(((
      p: string,
      enc?: BufferEncoding,
    ) => {
      if (p === targetSkillMd) {
        throw new Error('read blocked');
      }
      return originalReadSync(p, enc ?? 'utf-8');
    }) as never);

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));
    manager.prepareWorkdirSkillsOnly(workdir, 'claude');
    readSpy.mockRestore();

    expect(readFileSync(targetSkillMd, 'utf-8')).toBe('# target\n');
  });

  it('logs skill_seed_failed when skill target directory creation fails', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-seed-failed-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.claude.md'), '# seed\n', 'utf-8');

    const originalMkdirSync = fs.mkdirSync.bind(fs);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(((
      p: string,
      opts?: fs.MakeDirectoryOptions,
    ) => {
      if (p.endsWith(path.join('.claude', 'skills', 'playwright-runner'))) {
        throw new Error('mkdir denied');
      }
      return originalMkdirSync(p, opts);
    }) as never);

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));
    manager.prepareWorkdirSkillsOnly(workdir, 'claude');
    mkdirSpy.mockRestore();

    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'skill_seed_failed',
      expect.objectContaining({ skill: 'playwright-runner', error: 'mkdir denied' }),
    );
  });

  it('stringifies non-Error failures while seeding builtin skills', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-seed-string-fail-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.claude.md'), '# seed\n', 'utf-8');

    const originalMkdirSync = fs.mkdirSync.bind(fs);
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(((
      p: string,
      opts?: fs.MakeDirectoryOptions,
    ) => {
      if (p.endsWith(path.join('.claude', 'skills', 'playwright-runner'))) {
        throw 'mkdir string failed';
      }
      return originalMkdirSync(p, opts);
    }) as never);

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));
    manager.prepareWorkdirSkillsOnly(workdir, 'claude');
    mkdirSpy.mockRestore();

    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'skill_seed_failed',
      expect.objectContaining({ skill: 'playwright-runner', error: 'mkdir string failed' }),
    );
  });

  it('copies nested script directories recursively for builtin skills', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-nested-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const nestedScripts = path.join(skillsDir, 'playwright-runner', 'scripts', 'nested');
    mkdirSync(nestedScripts, { recursive: true });
    writeFileSync(
      path.join(skillsDir, 'playwright-runner', 'SKILL.claude.md'),
      '# seed\n',
      'utf-8',
    );
    writeFileSync(path.join(nestedScripts, 'run.py'), 'print("nested")\n', 'utf-8');

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));
    manager.prepareWorkdirSkillsOnly(workdir, 'claude');

    expect(
      existsSync(
        path.join(workdir, '.claude', 'skills', 'playwright-runner', 'scripts', 'nested', 'run.py'),
      ),
    ).toBe(true);
  });

  it('continues when chmod fails while copying skill scripts', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-chmod-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    const scriptsDir = path.join(skillDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.claude.md'), '# seed\n', 'utf-8');
    writeFileSync(path.join(scriptsDir, 'run.py'), 'print("ok")\n', 'utf-8');

    const chmodSpy = vi.spyOn(fs, 'chmodSync').mockImplementation(() => {
      throw new Error('chmod failed');
    });

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));
    manager.prepareWorkdirSkillsOnly(workdir, 'claude');
    chmodSpy.mockRestore();

    expect(
      existsSync(path.join(workdir, '.claude', 'skills', 'playwright-runner', 'scripts', 'run.py')),
    ).toBe(true);
  });

  it('ignores non-directory entries during stale cleanup', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-stale-file-entry-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    mkdirSync(workdirRoot, { recursive: true });
    writeFileSync(path.join(workdirRoot, 'a1b2c3d4'), 'not-dir', 'utf-8');

    const manager = new WorkdirManager(createConfig(workdirRoot));
    expect(manager.cleanupStaleSessions()).toBe(0);
  });

  it('syncSkillAssets rejects symlinked file in target scripts directory', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-sync-symfile-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    const scriptsSource = path.join(skillDir, 'scripts');
    const targetSkillDir = path.join(workdir, '.claude', 'skills', 'playwright-runner');
    const targetScripts = path.join(targetSkillDir, 'scripts');
    const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'workdir-sync-outside-'));
    tempRoots.push(outsideDir);

    mkdirSync(scriptsSource, { recursive: true });
    mkdirSync(targetScripts, { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.claude.md'), '# source\n', 'utf-8');
    writeFileSync(path.join(targetSkillDir, 'SKILL.md'), '# existing\n', 'utf-8');
    writeFileSync(path.join(scriptsSource, 'run.py'), 'print("source")\n', 'utf-8');

    // Plant a symlink in the target scripts dir pointing outside
    const outsideFile = path.join(outsideDir, 'run.py');
    writeFileSync(outsideFile, 'print("outside")\n', 'utf-8');
    fs.symlinkSync(outsideFile, path.join(targetScripts, 'run.py'));

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));

    // syncSkillAssets should detect the symlink and propagate the error via warn
    manager.prepareWorkdirSkillsOnly(workdir, 'claude');

    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'skill_assets_sync_failed',
      expect.objectContaining({
        skill: 'playwright-runner',
        error: expect.stringContaining('Symlink'),
      }),
    );
    // Verify the symlink target was NOT overwritten
    expect(readFileSync(outsideFile, 'utf-8')).toBe('print("outside")\n');
  });

  it('syncSkillAssets rejects symlinked subdirectory in target scripts directory', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-sync-symdir-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'sess1');
    const skillsDir = path.join(root, 'skills');
    const skillDir = path.join(skillsDir, 'playwright-runner');
    const scriptsSource = path.join(skillDir, 'scripts');
    const nestedSource = path.join(scriptsSource, 'nested');
    const targetSkillDir = path.join(workdir, '.claude', 'skills', 'playwright-runner');
    const targetScripts = path.join(targetSkillDir, 'scripts');
    const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'workdir-sync-dirout-'));
    tempRoots.push(outsideDir);

    mkdirSync(nestedSource, { recursive: true });
    mkdirSync(targetScripts, { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.claude.md'), '# source\n', 'utf-8');
    writeFileSync(path.join(targetSkillDir, 'SKILL.md'), '# existing\n', 'utf-8');
    writeFileSync(path.join(nestedSource, 'helper.sh'), '#!/bin/sh\necho ok\n', 'utf-8');

    // Plant a symlink directory in target pointing outside
    fs.symlinkSync(outsideDir, path.join(targetScripts, 'nested'));

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = skillsDir;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));

    manager.prepareWorkdirSkillsOnly(workdir, 'claude');

    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'skill_assets_sync_failed',
      expect.objectContaining({
        skill: 'playwright-runner',
        error: expect.stringContaining('Symlink'),
      }),
    );
  });

  it('ignores explicit skillTemplateDir when stat fails and falls through', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-skill-stat-fail-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const workdir = path.join(workdirRoot, 'session1');
    const badSkillRoot = path.join(root, 'skills');
    mkdirSync(badSkillRoot, { recursive: true });

    const statSpy = vi.spyOn(fs, 'statSync').mockImplementation(((p: string) => {
      if (p.endsWith(`${path.sep}skills`)) {
        throw new Error('stat failed');
      }
      return fs.lstatSync(p) as fs.Stats;
    }) as never);

    const config = createConfig(workdirRoot);
    config.skillTemplateDir = badSkillRoot;
    const manager = new WorkdirManager(config, builtinSkillDeps('playwright-runner'));
    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      manager.prepareWorkdirSkillsOnly(workdir, 'claude', [
        buildSkillRef('builtin', 'playwright-runner'),
      ]);
    } finally {
      process.chdir(originalCwd);
    }
    statSpy.mockRestore();

    expect(mocked.loggerDebug).toHaveBeenCalledWith(
      'skill_source_missing',
      expect.objectContaining({ skill: 'playwright-runner' }),
    );
  });
});
