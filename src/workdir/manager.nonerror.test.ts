import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config.js';
import { logger } from '../utils/logger.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => {
    throw 'venv setup failed';
  }),
}));

vi.mock('../utils/platform.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/platform.js')>();
  return {
    ...actual,
    resolvePython: vi.fn(() => ({ command: 'python3', args: [] })),
  };
});

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

describe('WorkdirManager ensureSkillVenv non-Error failure branch', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('stringifies non-Error failures during venv setup', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'workdir-venv-fail-string-'));
    tempRoots.push(root);
    const skillDir = path.join(root, 'skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, 'requirements.txt'), 'requests==2.31.0\n', 'utf8');

    const manager = new WorkdirManager(createConfig(path.join(root, 'workdir')));
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    (
      manager as unknown as {
        ensureSkillVenv: (targetSkillDir: string, skillDirName: string) => void;
      }
    ).ensureSkillVenv(skillDir, 'test-skill-string');

    expect(warnSpy).toHaveBeenCalledWith(
      'skill_venv_setup_failed',
      expect.objectContaining({
        skill: 'test-skill-string',
        error: 'venv setup failed',
      }),
    );
  });
});
