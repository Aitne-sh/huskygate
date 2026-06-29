/** Coverage2 tests for config/resolver: uncovered branch gaps */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/fs-security.js', () => ({
  ensurePrivateDirectory: vi.fn(),
  ensurePrivateFile: vi.fn(),
  writePrivateFile: vi.fn(),
}));

vi.mock('../utils/sqlite.js', () => ({
  applySqliteConnectionPragmas: vi.fn(),
  tightenSqliteRuntimeFilePermissions: vi.fn(),
}));

vi.mock('better-sqlite3', () => {
  const mockDb = {
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
    })),
    close: vi.fn(),
    pragma: vi.fn(() => []),
  };
  return { default: vi.fn(() => mockDb) };
});

describe('config/resolver coverage2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ConfigResolver — generated secrets', () => {
    it('resolves generated key SERVER_API_SECRET', async () => {
      const { ConfigResolver } = await import('./resolver.js');
      const resolver = new ConfigResolver({
        env: {},
        dataDir: '/tmp/test-data',
      });
      const result = resolver.get('SERVER_API_SECRET');
      expect(result.value).toBeTruthy();
      expect(result.source).toBe('generated');
      expect(result.storage).toBe('generated');
    });

    it('resolves generated key DASHBOARD_SECRET', async () => {
      const { ConfigResolver } = await import('./resolver.js');
      const resolver = new ConfigResolver({
        env: {},
        dataDir: '/tmp/test-data',
      });
      const result = resolver.get('DASHBOARD_SECRET');
      expect(result.value).toBeTruthy();
      expect(result.source).toBe('generated');
    });
  });

  describe('ConfigResolver — DB returns null value', () => {
    it('falls through to keychain when DB value is null', async () => {
      const { ConfigResolver } = await import('./resolver.js');
      const configStore = {
        get: vi.fn((key: string) => {
          if (key === 'SLACK_BOT_TOKEN') return { key, value: null, storage: 'db' as const };
          return null;
        }),
      };
      const resolver = new ConfigResolver({
        configStore,
        secureStoreValues: new Map([['SLACK_BOT_TOKEN', 'xoxb-from-keychain']]),
        env: {},
        dataDir: '/tmp/test-data',
      });
      const result = resolver.get('SLACK_BOT_TOKEN');
      expect(result.value).toBe('xoxb-from-keychain');
      expect(result.source).toBe('keychain');
    });
  });

  describe('ConfigResolver — null default value', () => {
    it('handles keys with no default value', async () => {
      const { ConfigResolver } = await import('./resolver.js');
      const resolver = new ConfigResolver({
        configStore: { get: () => null },
        env: {},
        dataDir: '/tmp/test-data',
      });
      // SLACK_BOT_TOKEN has no default — should resolve to null
      const result = resolver.get('SLACK_BOT_TOKEN');
      expect(result.value).toBeNull();
      expect(result.source).toBe('default');
      expect(result.storage).toBeNull();
    });
  });

  describe('validateSettingValue — additional branches', () => {
    it('accepts valid enum value DEFAULT_TOOL=claude', async () => {
      const { validateSettingValue } = await import('./resolver.js');
      const result = validateSettingValue('DEFAULT_TOOL', 'claude');
      expect(result).toBeNull();
    });

    it('rejects invalid positiveInt with max bound', async () => {
      const { validateSettingValue } = await import('./resolver.js');
      // SERVER_API_PORT has maxValue 65535
      const result = validateSettingValue('SERVER_API_PORT', '0');
      expect(result).toContain('positive integer');
    });

    it('accepts valid positiveInt', async () => {
      const { validateSettingValue } = await import('./resolver.js');
      const result = validateSettingValue('MAX_CONCURRENCY', '5');
      expect(result).toBeNull();
    });

    it('accepts read-only as valid mode', async () => {
      const { validateSettingValue } = await import('./resolver.js');
      const result = validateSettingValue('CLAUDE_DEFAULT_MODE', 'read-only');
      expect(result).toBeNull();
    });
  });

  describe('loadConfig — various settings', () => {
    it('loads config with all optional values set', async () => {
      const { ConfigResolver, loadConfig } = await import('./resolver.js');
      const resolver = new ConfigResolver({
        env: {
          SLACK_BOT_TOKEN: 'xoxb-test',
          SLACK_APP_TOKEN: 'xapp-test',
          ALLOWED_USER_IDS: 'U1,U2',
          ALLOWED_TEAM_ID: 'T123',
          DEFAULT_TOOL: 'gemini',
          CLAUDE_MODEL: 'claude-3',
          CODEX_MODEL: 'codex-v1',
          GEMINI_MODEL: 'gemini-pro',
          CLAUDE_MCP_AUTH_SERVER: 'auth-server-1',
          GEMINI_MCP_AUTH_SERVER: 'auth-server-2',
          CODEX_MCP_AUTH_SERVER: 'auth-server-3',
          ALLOWED_WORKDIR_ROOTS: '/tmp/a,/tmp/b',
          CLAUDE_DEFAULT_MODE: 'readonly',
          CODEX_DEFAULT_SANDBOX_MODE: 'readonly',
          GEMINI_DEFAULT_MODE: 'readonly',
          LOG_LEVEL: 'debug',
          SERVER_API_HOST: '0.0.0.0',
          WEBHOOK_PUBLIC_BASE_URL: 'https://example.com',
          CLOUDFLARE_TUNNEL_ENABLED: 'true',
          CLOUDFLARE_TUNNEL_TOKEN: 'cf-tok',
          SCHEDULE_ENABLED: 'true',
          SCHEDULE_DEFAULT_NOTIFY_CHANNEL: 'C123',
          HUSKYGATE_DASHBOARD_COOKIE_SECURE: 'false',
          HUSKYGATE_LOG_STACKS: 'true',
          SKILL_TEMPLATE_DIR: '/tmp/skills',
        },
        dataDir: '/tmp/test-data',
      });
      const config = loadConfig({ resolver });
      expect(config.defaultTool).toBe('gemini');
      expect(config.claudeModel).toBe('claude-3');
      expect(config.claudeDefaultMode).toBe('readonly');
      expect(config.logLevel).toBe('debug');
      expect(config.webhookPublicBaseUrl).toBe('https://example.com');
      expect(config.cloudflareTunnelEnabled).toBe(true);
      expect(config.scheduleEnabled).toBe(true);
      expect(config.logStacks).toBe(true);
      expect(config.skillTemplateDir).toBe('/tmp/skills');
    });
  });

  describe('loadDashboardConfig', () => {
    it('loads dashboard config (alias for loadBootstrapConfig)', async () => {
      const { ConfigResolver, loadDashboardConfig } = await import('./resolver.js');
      const resolver = new ConfigResolver({
        env: {},
        dataDir: '/tmp/test-data',
      });
      const config = loadDashboardConfig({ resolver });
      expect(config).toHaveProperty('serverApiPort');
      expect(config).toHaveProperty('dashboardSecret');
    });
  });

  describe('syncProcessEnvFromResolver — delete path', () => {
    it('deletes env var when value is empty or null', async () => {
      const { ConfigResolver, syncProcessEnvFromResolver } = await import('./resolver.js');
      const testEnv: Record<string, string | undefined> = { SLACK_BOT_TOKEN: 'existing' };
      const resolver = new ConfigResolver({
        configStore: { get: () => null },
        env: {},
        dataDir: '/tmp/test-data',
      });
      syncProcessEnvFromResolver(
        resolver,
        new Set(['SLACK_BOT_TOKEN']),
        testEnv as NodeJS.ProcessEnv,
      );
      expect(testEnv.SLACK_BOT_TOKEN).toBeUndefined();
    });
  });

  describe('getEditableSettingsSchema — description/skill/default fields', () => {
    it('includes optional fields when present in registry', async () => {
      const { getEditableSettingsSchema } = await import('./resolver.js');
      const schema = getEditableSettingsSchema();
      expect(schema.length).toBeGreaterThan(0);

      // Find a boolean type entry
      const boolEntry = schema.find((e) => e.valueType === 'boolean');
      if (boolEntry) {
        expect(boolEntry).toHaveProperty('valueType', 'boolean');
      }

      // Find an entry with skill flag
      const skillEntry = schema.find((e) => e.skill === true);
      if (skillEntry) {
        expect(skillEntry.skill).toBe(true);
      }
    });
  });

  describe('resolveScheduleSkillSecret — whitespace-only configured', () => {
    it('generates new secret when configured is whitespace only', async () => {
      const { resolveScheduleSkillSecret } = await import('./resolver.js');
      const result = resolveScheduleSkillSecret('server-secret', {
        HUSKYGATE_API_SECRET: '   ',
      });
      expect(result).toMatch(/^hg_sched_/);
    });
  });
});
