import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config.js';
import { logger } from '../utils/logger.js';
import * as platform from '../utils/platform.js';
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
    geminiMcpAuthServer: 'aws-api',
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

describe('WorkdirManager cleanup and migration', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('archives legacy default workdir when no session references it', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-archive-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const defaultDir = path.join(workdirRoot, 'default');
    mkdirSync(defaultDir, { recursive: true });
    writeFileSync(path.join(defaultDir, 'GEMINI.md'), '# legacy\n', 'utf8');

    const manager = new WorkdirManager(createConfig(workdirRoot));
    const archived = manager.archiveLegacyDefaultWorkdirIfUnused([]);

    expect(archived).toBeTruthy();
    expect(existsSync(defaultDir)).toBe(false);
    expect(existsSync(path.join(archived ?? '', 'GEMINI.md'))).toBe(true);
  });

  it('keeps legacy default workdir when it is still referenced', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-archive-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const defaultDir = path.join(workdirRoot, 'default');
    mkdirSync(defaultDir, { recursive: true });
    writeFileSync(path.join(defaultDir, 'CLAUDE.md'), '# keep\n', 'utf8');

    const manager = new WorkdirManager(createConfig(workdirRoot));
    const archived = manager.archiveLegacyDefaultWorkdirIfUnused([defaultDir]);

    expect(archived).toBeNull();
    expect(existsSync(defaultDir)).toBe(true);
  });

  it('removes only unmanaged session workdirs not referenced by active sessions', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-clean-'));
    tempRoots.push(root);
    const workdirRoot = path.join(root, 'workdir');
    const keepDir = path.join(workdirRoot, 'a1b2c3d4');
    const removeSessionIdDir = path.join(workdirRoot, 'deadbeef');
    const removeLegacyDir = path.join(workdirRoot, 'sess_0123456789ab');
    const keepCustomDir = path.join(workdirRoot, 'custom_project_data');

    mkdirSync(keepDir, { recursive: true });
    mkdirSync(removeSessionIdDir, { recursive: true });
    mkdirSync(removeLegacyDir, { recursive: true });
    mkdirSync(keepCustomDir, { recursive: true });

    const manager = new WorkdirManager(createConfig(workdirRoot));
    const removed = manager.cleanupUnusedSessionWorkdirs([keepDir]);

    expect(removed).toBe(2);
    expect(existsSync(keepDir)).toBe(true);
    expect(existsSync(removeSessionIdDir)).toBe(false);
    expect(existsSync(removeLegacyDir)).toBe(false);
    expect(existsSync(keepCustomDir)).toBe(true);
  });
});

describe('WorkdirManager skill setup internals', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('logs warning when venv setup fails after python is resolved', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-venv-fail-'));
    tempRoots.push(root);
    const skillDir = path.join(root, 'skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, 'requirements.txt'), 'requests==2.31.0\n', 'utf8');

    const manager = new WorkdirManager(createConfig(path.join(root, 'workdir')));
    const resolvePythonSpy = vi
      .spyOn(platform, 'resolvePython')
      .mockReturnValue({ command: 'definitely-not-a-python-command', args: [] });
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    (
      manager as unknown as {
        ensureSkillVenv: (targetSkillDir: string, skillDirName: string) => void;
      }
    ).ensureSkillVenv(skillDir, 'test-skill');

    expect(warnSpy).toHaveBeenCalledWith(
      'skill_venv_setup_failed',
      expect.objectContaining({
        skill: 'test-skill',
        skillDir,
      }),
    );

    resolvePythonSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('copies non-script files without attempting executable mode changes', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-copy-mode-'));
    tempRoots.push(root);
    const srcPath = path.join(root, 'source.txt');
    const destPath = path.join(root, 'copied.txt');
    writeFileSync(srcPath, 'plain text file\n', 'utf8');

    const manager = new WorkdirManager(createConfig(path.join(root, 'workdir')));
    (
      manager as unknown as {
        copyFileWithMode: (src: string, dest: string) => void;
      }
    ).copyFileWithMode(srcPath, destPath);

    expect(readFileSync(destPath, 'utf8')).toBe('plain text file\n');
  });
});
