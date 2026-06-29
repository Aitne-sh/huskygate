/** Coverage tests for workdir/manager: uncovered lines for validateCustomWorkdir,
 * cleanupUnusedSessionWorkdirs, archiveLegacyDefaultWorkdirIfUnused, seedSkill, ensureSkillVenv,
 * copyFileWithMode, seedDevInstructionFile */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config.js';
import { WorkdirManager } from './manager.js';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../instructions/builder.js', () => ({
  buildInstruction: vi.fn(() => '# Test instruction'),
}));

vi.mock('../orchestrator/engine-utils.js', () => ({
  getInstructionFilePath: vi.fn((workdir: string, tool: string) => {
    const map: Record<string, string> = {
      claude: 'CLAUDE.md',
      codex: 'AGENTS.md',
      gemini: 'GEMINI.md',
    };
    return path.join(workdir, map[tool] ?? 'CLAUDE.md');
  }),
}));

function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    slack: { botToken: 'xoxb-test', appToken: 'xapp-test' },
    allowedUserIds: ['U1'],
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
    workdirRoot: '/tmp/test-workdir-coverage',
    allowedWorkdirRoots: ['/tmp/test-workdir-coverage'],
    serverApiPort: 3738,
    serverApiHost: '127.0.0.1',
    serverApiSecret: 'test-api-secret',
    dashboardSecret: 'test-dashboard-secret',
    sessionCleanupEnabled: true,
    scheduleEnabled: false,
    schedulePollIntervalSec: 30,
    scheduleMaxConcurrent: 1,
    scheduleDefaultNotifyChannel: null,
    logLevel: 'info',
    toolAutoApproveMode: false,
    claudeDefaultMode: 'write',
    codexDefaultSandboxMode: 'write',
    geminiDefaultMode: 'write',
    webhookPublicBaseUrl: null,
    cloudflareTunnelEnabled: false,
    cloudflareTunnelToken: null,
    githubWebhookIpAllowlist: true,
    dashboardCookieSecure: true,
    logStacks: false,
    skillTemplateDir: null,
    ...overrides,
  } as Config;
}

let tmpDir: string;

describe('WorkdirManager coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdm-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('validateCustomWorkdir', () => {
    it('throws when path does not exist (line 87)', () => {
      const mgr = new WorkdirManager(
        createConfig({ workdirRoot: tmpDir, allowedWorkdirRoots: [tmpDir] }),
      );
      expect(() => mgr.validateCustomWorkdir('/nonexistent/path')).toThrow('Path does not exist');
    });

    it('throws when path is not in allowed roots (line 101-103)', () => {
      const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdm-other-'));
      try {
        const mgr = new WorkdirManager(
          createConfig({ workdirRoot: tmpDir, allowedWorkdirRoots: [tmpDir] }),
        );
        expect(() => mgr.validateCustomWorkdir(otherDir)).toThrow('not in allowed roots');
      } finally {
        fs.rmSync(otherDir, { recursive: true, force: true });
      }
    });

    it('throws when path is not a directory (line 108)', () => {
      const filePath = path.join(tmpDir, 'file.txt');
      fs.writeFileSync(filePath, 'content');
      const mgr = new WorkdirManager(
        createConfig({ workdirRoot: tmpDir, allowedWorkdirRoots: [tmpDir] }),
      );
      expect(() => mgr.validateCustomWorkdir(filePath)).toThrow('not a directory');
    });

    it('returns resolved path for valid directory', () => {
      const subDir = path.join(tmpDir, 'subdir');
      fs.mkdirSync(subDir);
      const mgr = new WorkdirManager(
        createConfig({ workdirRoot: tmpDir, allowedWorkdirRoots: [tmpDir] }),
      );
      const result = mgr.validateCustomWorkdir(subDir);
      expect(result).toBe(fs.realpathSync(subDir));
    });
  });

  describe('cleanupUnusedSessionWorkdirs', () => {
    it('returns 0 when workdirRoot does not exist (line 165)', () => {
      const mgr = new WorkdirManager(createConfig({ workdirRoot: '/nonexistent' }));
      expect(mgr.cleanupUnusedSessionWorkdirs([])).toBe(0);
    });

    it('removes unused session dirs matching patterns (lines 171-187)', () => {
      // Create dirs matching session ID pattern (8 hex chars)
      const sessionDir = path.join(tmpDir, 'abcdef01');
      fs.mkdirSync(sessionDir, { recursive: true });
      // Create a dir that doesn't match the pattern
      const otherDir = path.join(tmpDir, 'non-session');
      fs.mkdirSync(otherDir, { recursive: true });
      // Create _archive (should be skipped)
      fs.mkdirSync(path.join(tmpDir, '_archive'), { recursive: true });

      const mgr = new WorkdirManager(createConfig({ workdirRoot: tmpDir }));
      const removed = mgr.cleanupUnusedSessionWorkdirs([]);
      expect(removed).toBe(1);
      expect(fs.existsSync(sessionDir)).toBe(false);
      expect(fs.existsSync(otherDir)).toBe(true);
    });

    it('keeps referenced workdirs (line 180-182)', () => {
      const sessionDir = path.join(tmpDir, 'abcdef01');
      fs.mkdirSync(sessionDir, { recursive: true });

      const mgr = new WorkdirManager(createConfig({ workdirRoot: tmpDir }));
      const removed = mgr.cleanupUnusedSessionWorkdirs([sessionDir]);
      expect(removed).toBe(0);
      expect(fs.existsSync(sessionDir)).toBe(true);
    });
  });

  describe('archiveLegacyDefaultWorkdirIfUnused', () => {
    it('returns null when default dir does not exist (line 150)', () => {
      const mgr = new WorkdirManager(createConfig({ workdirRoot: tmpDir }));
      expect(mgr.archiveLegacyDefaultWorkdirIfUnused([])).toBeNull();
    });

    it('returns null when default dir is referenced (line 154-155)', () => {
      const defaultDir = path.join(tmpDir, 'default');
      fs.mkdirSync(defaultDir, { recursive: true });

      const mgr = new WorkdirManager(createConfig({ workdirRoot: tmpDir }));
      const result = mgr.archiveLegacyDefaultWorkdirIfUnused([defaultDir]);
      expect(result).toBeNull();
    });

    it('archives unreferenced default dir (lines 158-161)', () => {
      const defaultDir = path.join(tmpDir, 'default');
      fs.mkdirSync(defaultDir, { recursive: true });
      fs.writeFileSync(path.join(defaultDir, 'test.txt'), 'data');

      const mgr = new WorkdirManager(createConfig({ workdirRoot: tmpDir }));
      const result = mgr.archiveLegacyDefaultWorkdirIfUnused([]);
      expect(result).not.toBeNull();
      expect(result).toContain('_archive');
      expect(fs.existsSync(defaultDir)).toBe(false);
    });
  });

  describe('seedDevInstructionFile', () => {
    it('skips if file already exists (line 608-609)', () => {
      const workdir = path.join(tmpDir, 'dev-workdir');
      fs.mkdirSync(workdir, { recursive: true });
      fs.writeFileSync(path.join(workdir, 'CLAUDE.md'), 'existing');

      const mgr = new WorkdirManager(createConfig({ workdirRoot: tmpDir }));
      const result = mgr.seedDevInstructionFile(workdir, 'claude', 'new content');
      expect(result).toBe(false);
      expect(fs.readFileSync(path.join(workdir, 'CLAUDE.md'), 'utf-8')).toBe('existing');
    });

    it('creates instruction file when not present (lines 611-614)', () => {
      const workdir = path.join(tmpDir, 'dev-workdir2');
      fs.mkdirSync(workdir, { recursive: true });

      const mgr = new WorkdirManager(createConfig({ workdirRoot: tmpDir }));
      const result = mgr.seedDevInstructionFile(workdir, 'claude', 'new content');
      expect(result).toBe(true);
      expect(fs.readFileSync(path.join(workdir, 'CLAUDE.md'), 'utf-8')).toBe('new content');
    });
  });

  describe('cleanupStaleSessions', () => {
    it('returns 0 when workdirRoot does not exist', () => {
      const mgr = new WorkdirManager(createConfig({ workdirRoot: '/nonexistent' }));
      expect(mgr.cleanupStaleSessions()).toBe(0);
    });
  });

  describe('prepareWorkdirSkillsOnly', () => {
    it('creates workdir and seeds skills', () => {
      const workdir = path.join(tmpDir, 'skills-only');
      const mgr = new WorkdirManager(createConfig({ workdirRoot: tmpDir }));
      mgr.prepareWorkdirSkillsOnly(workdir, 'claude');
      expect(fs.existsSync(workdir)).toBe(true);
    });

    it('seeds a built-in skill when the store enables it even if legacy config is false', () => {
      const builtinDir = path.join(tmpDir, 'builtin-skills');
      const skillDir = path.join(builtinDir, 'playwright-runner');
      const workdir = path.join(tmpDir, 'skills-only-store');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.claude.md'), '---\n---\nbody\n');

      const mgr = new WorkdirManager(
        createConfig({ workdirRoot: tmpDir, skillTemplateDir: builtinDir }),
        {
          skillEnablementStore: {
            getEnabled: vi.fn((skillRef: string, tool: string) =>
              skillRef === 'builtin:playwright-runner' && tool === 'claude' ? true : null,
            ),
          },
        },
      );

      mgr.prepareWorkdirSkillsOnly(workdir, 'claude');

      expect(
        fs.existsSync(path.join(workdir, '.claude', 'skills', 'playwright-runner', 'SKILL.md')),
      ).toBe(true);
    });
  });

  describe('willSeedSkills', () => {
    it('returns true when a custom catalog skill will be seeded', () => {
      const projectSkillDir = path.join(tmpDir, '.huskygate', 'skills', 'project-helper');
      fs.mkdirSync(projectSkillDir, { recursive: true });
      fs.writeFileSync(path.join(projectSkillDir, 'SKILL.claude.md'), '# helper\n');

      const originalHome = process.env.HOME;
      process.env.HOME = path.join(tmpDir, 'home');
      try {
        const mgr = new WorkdirManager(createConfig({ workdirRoot: tmpDir }));
        expect(mgr.willSeedSkills('claude', null)).toBe(true);
      } finally {
        if (originalHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = originalHome;
        }
      }
    });

    it('returns false when neither built-in nor custom skills are seedable', () => {
      const originalHome = process.env.HOME;
      process.env.HOME = path.join(tmpDir, 'home-empty');
      try {
        const mgr = new WorkdirManager(createConfig({ workdirRoot: tmpDir }));
        expect(mgr.willSeedSkills('claude', [])).toBe(false);
      } finally {
        if (originalHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = originalHome;
        }
      }
    });

    it('returns false for custom skills when enabledSkills is explicitly empty', () => {
      const projectSkillDir = path.join(tmpDir, '.huskygate', 'skills', 'project-helper');
      fs.mkdirSync(projectSkillDir, { recursive: true });
      fs.writeFileSync(path.join(projectSkillDir, 'SKILL.claude.md'), '# helper\n');

      const originalHome = process.env.HOME;
      process.env.HOME = path.join(tmpDir, 'home-explicit-empty');
      try {
        const mgr = new WorkdirManager(createConfig({ workdirRoot: tmpDir }));
        expect(mgr.willSeedSkills('claude', [])).toBe(false);
      } finally {
        if (originalHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = originalHome;
        }
      }
    });

    it('returns false when a custom skill is disabled in the new store', () => {
      const projectSkillDir = path.join(tmpDir, '.huskygate', 'skills', 'project-helper');
      fs.mkdirSync(projectSkillDir, { recursive: true });
      fs.writeFileSync(path.join(projectSkillDir, 'SKILL.claude.md'), '# helper\n');

      const originalHome = process.env.HOME;
      process.env.HOME = path.join(tmpDir, 'home-disabled');
      try {
        const mgr = new WorkdirManager(createConfig({ workdirRoot: tmpDir }), {
          skillEnablementStore: {
            getEnabled: vi.fn((skillRef: string) =>
              skillRef === 'project:project-helper' ? false : null,
            ),
          },
        });
        expect(mgr.willSeedSkills('claude', null)).toBe(false);
      } finally {
        if (originalHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = originalHome;
        }
      }
    });
  });

  describe('prepareDevWorkdir', () => {
    it('creates workdir', () => {
      const workdir = path.join(tmpDir, 'dev-wd');
      const mgr = new WorkdirManager(createConfig({ workdirRoot: tmpDir }));
      mgr.prepareDevWorkdir(workdir);
      expect(fs.existsSync(workdir)).toBe(true);
    });
  });

  describe('getSessionWorkdir', () => {
    it('returns a hash-based path under workdirRoot', () => {
      const mgr = new WorkdirManager(createConfig({ workdirRoot: tmpDir }));
      const wd = mgr.getSessionWorkdir('sess_abc');
      expect(wd).toContain(tmpDir);
      expect(wd).toMatch(/sess_[a-f0-9]{12}/);
      expect(fs.existsSync(wd)).toBe(true);
    });
  });
});
