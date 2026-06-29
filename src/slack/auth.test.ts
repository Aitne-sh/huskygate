import { beforeAll, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { setLogLevel } from '../utils/logger.js';
import { isAuthorized } from './auth.js';

function createConfig(overrides?: Partial<Config>): Config {
  return {
    slack: { botToken: 'xoxb-test', appToken: 'xapp-test' },
    allowedUserIds: ['U_ALLOWED'],
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
    codexMcpAuthServer: 'aws-api',
    workdirRoot: '/tmp/workdir',
    allowedWorkdirRoots: ['/tmp/workdir'],
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
    ...overrides,
  };
}

describe('isAuthorized', () => {
  beforeAll(() => {
    setLogLevel('error');
  });

  it('allows DM from allowlisted user', () => {
    const config = createConfig();
    const result = isAuthorized(
      {
        userId: 'U_ALLOWED',
        channelId: 'D123',
        channelType: 'im',
      },
      config,
    );
    expect(result).toBe(true);
  });

  it('rejects non-DM channels', () => {
    const config = createConfig();
    const result = isAuthorized(
      {
        userId: 'U_ALLOWED',
        channelId: 'C123',
        channelType: 'channel',
      },
      config,
    );
    expect(result).toBe(false);
  });

  it('rejects users not in allowlist', () => {
    const config = createConfig();
    const result = isAuthorized(
      {
        userId: 'U_BLOCKED',
        channelId: 'D123',
        channelType: 'im',
      },
      config,
    );
    expect(result).toBe(false);
  });

  it('rejects when team id is required but missing', () => {
    const config = createConfig({ allowedTeamId: 'T_ALLOWED' });
    const result = isAuthorized(
      {
        userId: 'U_ALLOWED',
        channelId: 'D123',
        channelType: 'im',
      },
      config,
    );
    expect(result).toBe(false);
  });

  it('rejects when team id does not match', () => {
    const config = createConfig({ allowedTeamId: 'T_ALLOWED' });
    const result = isAuthorized(
      {
        userId: 'U_ALLOWED',
        channelId: 'D123',
        channelType: 'im',
        teamId: 'T_OTHER',
      },
      config,
    );
    expect(result).toBe(false);
  });

  it('allows when team id matches configured team', () => {
    const config = createConfig({ allowedTeamId: 'T_ALLOWED' });
    const result = isAuthorized(
      {
        userId: 'U_ALLOWED',
        channelId: 'D123',
        channelType: 'im',
        teamId: 'T_ALLOWED',
      },
      config,
    );
    expect(result).toBe(true);
  });
});
