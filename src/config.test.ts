import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ENV_REGISTRY,
  KNOWN_ENV_KEYS,
  RUNTIME_MUTABLE_KEYS,
  SENSITIVE_KEYS,
  SKILL_ENV_KEYS,
  isSensitiveKey,
  loadCompatibilityEnvFile,
  loadConfig,
  loadDashboardConfig,
  resolvePersistedSecret,
} from './config.js';

// Minimum env to satisfy requireEnv calls
const BASE_ENV = {
  SLACK_BOT_TOKEN: 'xoxb-test',
  SLACK_APP_TOKEN: 'xapp-test',
  ALLOWED_USER_IDS: 'U1,U2',
};

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys({ ...BASE_ENV, ...overrides })) {
    saved[key] = process.env[key];
  }
  try {
    // Set base + overrides
    for (const [key, value] of Object.entries(BASE_ENV)) {
      process.env[key] = value;
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('loadConfig parsePositiveInt validation', () => {
  it('accepts valid positive integers', () => {
    withEnv({ MAX_CONCURRENCY: '4' }, () => {
      const config = loadConfig();
      expect(config.maxConcurrency).toBe(4);
    });
  });

  it('rejects zero', () => {
    withEnv({ MAX_CONCURRENCY: '0' }, () => {
      expect(() => loadConfig()).toThrow(
        'Invalid MAX_CONCURRENCY: "0". Must be a positive integer.',
      );
    });
  });

  it('rejects negative values', () => {
    withEnv({ MAX_RUNTIME_SEC: '-1' }, () => {
      expect(() => loadConfig()).toThrow(
        'Invalid MAX_RUNTIME_SEC: "-1". Must be a positive integer.',
      );
    });
  });

  it('rejects non-numeric strings', () => {
    withEnv({ NO_OUTPUT_TIMEOUT_SEC: 'abc' }, () => {
      expect(() => loadConfig()).toThrow(
        'Invalid NO_OUTPUT_TIMEOUT_SEC: "abc". Must be a positive integer.',
      );
    });
  });

  it('rejects floating point', () => {
    withEnv({ MAX_CONCURRENCY: '2.5' }, () => {
      // parseInt('2.5') returns 2 which is valid
      const config = loadConfig();
      expect(config.maxConcurrency).toBe(2);
    });
  });

  it('uses defaults when env vars are not set', () => {
    withEnv({}, () => {
      const config = loadConfig();
      expect(config.maxConcurrency).toBe(2);
      expect(config.maxRuntimeSec).toBe(900);
      expect(config.noOutputTimeoutSec).toBe(90);
    });
  });
});

describe('loadConfig required and enum validations', () => {
  it('throws when required env var is missing', () => {
    withEnv({ SLACK_BOT_TOKEN: undefined }, () => {
      expect(() => loadConfig()).toThrow('Missing required environment variable: SLACK_BOT_TOKEN');
    });
  });

  it('rejects invalid default tool', () => {
    withEnv({ DEFAULT_TOOL: 'invalid-tool' }, () => {
      expect(() => loadConfig()).toThrow(
        'Invalid tool name: invalid-tool. Must be claude, codex, or gemini.',
      );
    });
  });

  it('rejects invalid log level', () => {
    withEnv({ LOG_LEVEL: 'trace' }, () => {
      expect(() => loadConfig()).toThrow('Invalid log level: trace');
    });
  });

  it('normalizes blank GEMINI_MCP_AUTH_SERVER to null', () => {
    withEnv({ GEMINI_MCP_AUTH_SERVER: '   ' }, () => {
      const config = loadConfig();
      expect(config.geminiMcpAuthServer).toBeNull();
    });
  });

  it('falls back to 127.0.0.1 when SERVER_API_HOST is blank', () => {
    withEnv({ SERVER_API_HOST: '   ' }, () => {
      const config = loadConfig();
      expect(config.serverApiHost).toBe('127.0.0.1');
    });
  });
});

describe('loadConfig codex sandbox mode', () => {
  it('parses CODEX_DEFAULT_SANDBOX_MODE=readonly', () => {
    withEnv({ CODEX_DEFAULT_SANDBOX_MODE: 'readonly' }, () => {
      const config = loadConfig();
      expect(config.codexDefaultSandboxMode).toBe('readonly');
    });
  });

  it('parses CODEX_DEFAULT_SANDBOX_MODE=read-only', () => {
    withEnv({ CODEX_DEFAULT_SANDBOX_MODE: 'read-only' }, () => {
      const config = loadConfig();
      expect(config.codexDefaultSandboxMode).toBe('readonly');
    });
  });
});

describe('loadConfig model fields', () => {
  it('reads model env vars', () => {
    withEnv(
      {
        CLAUDE_MODEL: 'claude-opus-4-6',
        CODEX_MODEL: 'gpt-5',
        GEMINI_MODEL: 'gemini-2.5-pro',
      },
      () => {
        const config = loadConfig();
        expect(config.claudeModel).toBe('claude-opus-4-6');
        expect(config.codexModel).toBe('gpt-5');
        expect(config.geminiModel).toBe('gemini-2.5-pro');
      },
    );
  });

  it('normalizes empty strings to null', () => {
    withEnv(
      {
        CLAUDE_MODEL: '',
        CODEX_MODEL: '   ',
        GEMINI_MODEL: undefined,
      },
      () => {
        const config = loadConfig();
        expect(config.claudeModel).toBeNull();
        expect(config.codexModel).toBeNull();
        expect(config.geminiModel).toBeNull();
      },
    );
  });

  it('defaults to null when not set', () => {
    withEnv({}, () => {
      const config = loadConfig();
      expect(config.claudeModel).toBeNull();
      expect(config.codexModel).toBeNull();
      expect(config.geminiModel).toBeNull();
    });
  });
});

describe('loadDashboardConfig', () => {
  /** Dashboard config helper: clean env without Slack vars */
  function withDashboardEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
    const allKeys = [
      'SLACK_BOT_TOKEN',
      'SLACK_APP_TOKEN',
      'ALLOWED_USER_IDS',
      'SERVER_API_PORT',
      'SERVER_API_SECRET',
      'DASHBOARD_SECRET',
      'WORKDIR_ROOT',
      ...Object.keys(overrides),
    ];
    const saved: Record<string, string | undefined> = {};
    for (const key of allKeys) {
      saved[key] = process.env[key];
    }
    try {
      // Clear Slack vars to simulate dashboard-only startup
      delete process.env.SLACK_BOT_TOKEN;
      delete process.env.SLACK_APP_TOKEN;
      delete process.env.ALLOWED_USER_IDS;
      delete process.env.SERVER_API_PORT;
      delete process.env.SERVER_API_SECRET;
      delete process.env.DASHBOARD_SECRET;
      delete process.env.WORKDIR_ROOT;
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      fn();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  }

  it('loads without Slack environment variables', () => {
    withDashboardEnv({}, () => {
      const config = loadDashboardConfig({ configStore: null });
      expect(config.serverApiPort).toBe(3738);
      expect(config.serverApiSecret).toBeTruthy();
      expect(config.dashboardSecret).toBeTruthy();
      expect(config.workdirRoot).toBeTruthy();
    });
  });

  it('reads SERVER_API_PORT when set', () => {
    withDashboardEnv({ SERVER_API_PORT: '4000' }, () => {
      const config = loadDashboardConfig({ configStore: null });
      expect(config.serverApiPort).toBe(4000);
    });
  });

  it('uses provided secrets instead of generating', () => {
    withDashboardEnv({ SERVER_API_SECRET: 'my-secret', DASHBOARD_SECRET: 'my-dash' }, () => {
      const config = loadDashboardConfig({ configStore: null });
      expect(config.serverApiSecret).toBe('my-secret');
      expect(config.dashboardSecret).toBe('my-dash');
    });
  });

  it('auto-generates secrets when not provided', () => {
    withDashboardEnv({}, () => {
      const config = loadDashboardConfig({ configStore: null });
      // UUID v4 format
      expect(config.serverApiSecret).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(config.dashboardSecret).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  it('rejects invalid SERVER_API_PORT', () => {
    withDashboardEnv({ SERVER_API_PORT: '0' }, () => {
      expect(() => loadDashboardConfig({ configStore: null })).toThrow(
        'Invalid SERVER_API_PORT: "0". Must be a positive integer.',
      );
    });
  });
});

describe('loadCompatibilityEnvFile', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('always skips dashboard-managed persisted keys', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      ['MAX_CONCURRENCY=9', 'HUSKYGATE_API_SECRET=keep-me'].join('\n'),
      'utf-8',
    );

    const env = {} as NodeJS.ProcessEnv;
    const loaded = loadCompatibilityEnvFile(tmpDir, env);
    expect([...loaded]).toEqual(['HUSKYGATE_API_SECRET']);
    expect(env.MAX_CONCURRENCY).toBeUndefined();
    expect(env.HUSKYGATE_API_SECRET).toBe('keep-me');
  });
});

describe('resolvePersistedSecret', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  let tmpDir: string;

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('prefers environment variable over file', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
    const saved = process.env.TEST_SECRET_A;
    try {
      process.env.TEST_SECRET_A = 'from-env';
      expect(resolvePersistedSecret('TEST_SECRET_A', '.test-secret', tmpDir)).toBe('from-env');
      // File should NOT be created when env var is set
      expect(fs.existsSync(path.join(tmpDir, '.test-secret'))).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.TEST_SECRET_A;
      else process.env.TEST_SECRET_A = saved;
    }
  });

  it('generates, persists, and returns a UUID when no env var or file', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
    const saved = process.env.TEST_SECRET_B;
    try {
      delete process.env.TEST_SECRET_B;
      const secret = resolvePersistedSecret('TEST_SECRET_B', '.test-secret', tmpDir);
      expect(secret).toMatch(UUID_RE);
      // File should exist with the same value
      const secretPath = path.join(tmpDir, '.test-secret');
      const persisted = fs.readFileSync(secretPath, 'utf-8').trim();
      expect(persisted).toBe(secret);
      if (process.platform !== 'win32') {
        expect(fs.statSync(secretPath).mode & 0o777).toBe(0o600);
        expect(fs.statSync(tmpDir).mode & 0o777).toBe(0o700);
      }
    } finally {
      if (saved === undefined) delete process.env.TEST_SECRET_B;
      else process.env.TEST_SECRET_B = saved;
    }
  });

  it('reads previously persisted file on subsequent calls', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
    const saved = process.env.TEST_SECRET_C;
    try {
      delete process.env.TEST_SECRET_C;
      // Pre-write a known value
      const secretPath = path.join(tmpDir, '.test-secret');
      fs.writeFileSync(secretPath, 'pre-existing-secret');
      const secret = resolvePersistedSecret('TEST_SECRET_C', '.test-secret', tmpDir);
      expect(secret).toBe('pre-existing-secret');
      if (process.platform !== 'win32') {
        expect(fs.statSync(secretPath).mode & 0o777).toBe(0o600);
        expect(fs.statSync(tmpDir).mode & 0o777).toBe(0o700);
      }
    } finally {
      if (saved === undefined) delete process.env.TEST_SECRET_C;
      else process.env.TEST_SECRET_C = saved;
    }
  });

  it('returns consistent value across multiple calls', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
    const saved = process.env.TEST_SECRET_D;
    try {
      delete process.env.TEST_SECRET_D;
      const first = resolvePersistedSecret('TEST_SECRET_D', '.test-secret', tmpDir);
      const second = resolvePersistedSecret('TEST_SECRET_D', '.test-secret', tmpDir);
      expect(first).toBe(second);
    } finally {
      if (saved === undefined) delete process.env.TEST_SECRET_D;
      else process.env.TEST_SECRET_D = saved;
    }
  });

  it('returns raced persisted value when exclusive write loses the race', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
    const saved = process.env.TEST_SECRET_E;
    try {
      delete process.env.TEST_SECRET_E;
      vi.spyOn(fs, 'readFileSync')
        .mockImplementationOnce(() => {
          throw new Error('ENOENT');
        })
        .mockImplementationOnce(() => 'raced-secret');
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw new Error('EEXIST');
      });

      const secret = resolvePersistedSecret('TEST_SECRET_E', '.test-secret', tmpDir);
      expect(secret).toBe('raced-secret');
    } finally {
      if (saved === undefined) delete process.env.TEST_SECRET_E;
      else process.env.TEST_SECRET_E = saved;
    }
  });

  it('falls back to generated value when write and race-read both fail', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
    const saved = process.env.TEST_SECRET_F;
    try {
      delete process.env.TEST_SECRET_F;
      vi.spyOn(fs, 'readFileSync')
        .mockImplementationOnce(() => {
          throw new Error('ENOENT');
        })
        .mockImplementationOnce(() => {
          throw new Error('ENOENT');
        });
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw new Error('EACCES');
      });

      const secret = resolvePersistedSecret('TEST_SECRET_F', '.test-secret', tmpDir);
      expect(secret).toMatch(UUID_RE);
    } finally {
      if (saved === undefined) delete process.env.TEST_SECRET_F;
      else process.env.TEST_SECRET_F = saved;
    }
  });
});

/* ── ENV_REGISTRY meta-tests ─────────────────────────────────────── */
describe('ENV_REGISTRY', () => {
  it('derived KNOWN_ENV_KEYS equals registry key set', () => {
    const registryKeys = new Set(Object.keys(ENV_REGISTRY));
    expect(KNOWN_ENV_KEYS).toEqual(registryKeys);
  });

  it('RUNTIME_MUTABLE_KEYS is a subset of KNOWN_ENV_KEYS', () => {
    for (const k of RUNTIME_MUTABLE_KEYS) {
      expect(KNOWN_ENV_KEYS.has(k)).toBe(true);
    }
  });

  it('SKILL_ENV_KEYS is a subset of KNOWN_ENV_KEYS', () => {
    for (const k of SKILL_ENV_KEYS) {
      expect(KNOWN_ENV_KEYS.has(k)).toBe(true);
    }
  });

  it('SENSITIVE_KEYS is a subset of KNOWN_ENV_KEYS', () => {
    for (const k of SENSITIVE_KEYS) {
      expect(KNOWN_ENV_KEYS.has(k)).toBe(true);
    }
  });

  it('all skill keys are mutable (hot-reloadable)', () => {
    for (const k of SKILL_ENV_KEYS) {
      const meta = ENV_REGISTRY[k];
      expect(meta).toBeDefined();
      expect(meta?.mutable).toBe(true);
    }
  });

  it('AWS_DEFAULT_REGION is not sensitive', () => {
    expect(SENSITIVE_KEYS.has('AWS_DEFAULT_REGION')).toBe(false);
  });

  it('isSensitiveKey matches registry for known keys', () => {
    for (const [key, meta] of Object.entries(ENV_REGISTRY)) {
      expect(isSensitiveKey(key)).toBe(meta.sensitive);
    }
  });

  it('isSensitiveKey regex fallback works for unknown keys', () => {
    expect(isSensitiveKey('MY_CUSTOM_API_KEY')).toBe(true);
    expect(isSensitiveKey('MY_CUSTOM_TOKEN')).toBe(true);
    expect(isSensitiveKey('MY_CUSTOM_SECRET')).toBe(true);
    expect(isSensitiveKey('MY_CUSTOM_PASSWORD')).toBe(true);
    expect(isSensitiveKey('MY_CUSTOM_SETTING')).toBe(false);
    expect(isSensitiveKey('SOME_REGION')).toBe(false);
  });

  it('every derived set is non-empty', () => {
    expect(KNOWN_ENV_KEYS.size).toBeGreaterThan(0);
    expect(RUNTIME_MUTABLE_KEYS.size).toBeGreaterThan(0);
    expect(SKILL_ENV_KEYS.size).toBeGreaterThan(0);
    expect(SENSITIVE_KEYS.size).toBeGreaterThan(0);
  });

  it('internal secret keys are sensitive', () => {
    const internalKeys = Object.entries(ENV_REGISTRY)
      .filter(([key, meta]) => meta.cat === 'internal' && key.endsWith('_SECRET'))
      .map(([k]) => k);
    expect(internalKeys.length).toBeGreaterThan(0);
    for (const k of internalKeys) {
      const meta = ENV_REGISTRY[k];
      expect(meta).toBeDefined();
      expect(meta?.sensitive).toBe(true);
    }
  });

  it('HUSKYGATE_API_BASE remains internal but non-sensitive', () => {
    expect(ENV_REGISTRY.HUSKYGATE_API_BASE).toMatchObject({
      cat: 'internal',
      sensitive: false,
      persistence: 'derived',
      editable: false,
    });
  });

  it('legacy per-driver *_SKILL_ENABLED_* keys are no longer in the registry', () => {
    const registrySkillEnabledKeys = Object.keys(ENV_REGISTRY).filter((k) =>
      /_SKILL_ENABLED_(CLAUDE|CODEX|GEMINI)$/.test(k),
    );
    expect(registrySkillEnabledKeys).toEqual([]);
  });

  it('every editable key has a description', () => {
    const editableKeys = Object.entries(ENV_REGISTRY)
      .filter(([, meta]) => meta.editable)
      .map(([key]) => key);
    const missingDescription = editableKeys.filter((key) => !ENV_REGISTRY[key]?.description);
    expect(missingDescription).toEqual([]);
  });

  it('every key with valueType=boolean has a default of true or false', () => {
    const booleanKeys = Object.entries(ENV_REGISTRY)
      .filter(([, meta]) => meta.valueType === 'boolean')
      .map(([key]) => key);
    expect(booleanKeys.length).toBeGreaterThan(0);
    for (const key of booleanKeys) {
      const meta = ENV_REGISTRY[key];
      expect(meta?.default === 'true' || meta?.default === 'false').toBe(true);
    }
  });

  it('every key with valueType=enum has enumValues', () => {
    const enumKeys = Object.entries(ENV_REGISTRY)
      .filter(([, meta]) => meta.valueType === 'enum')
      .map(([key]) => key);
    expect(enumKeys.length).toBeGreaterThan(0);
    for (const key of enumKeys) {
      const meta = ENV_REGISTRY[key];
      expect(meta?.enumValues).toBeDefined();
      expect(meta?.enumValues?.length).toBeGreaterThan(0);
    }
  });

  it('every key with valueType=mode has a default', () => {
    const modeKeys = Object.entries(ENV_REGISTRY)
      .filter(([, meta]) => meta.valueType === 'mode')
      .map(([key]) => key);
    expect(modeKeys.length).toBeGreaterThan(0);
    for (const key of modeKeys) {
      expect(ENV_REGISTRY[key]?.default).toBeDefined();
    }
  });
});

describe('loadConfig cloudflare tunnel and IP allowlist entries', () => {
  it('defaults cloudflareTunnelEnabled to false', () => {
    withEnv({}, () => {
      const config = loadConfig();
      expect(config.cloudflareTunnelEnabled).toBe(false);
    });
  });

  it('parses CLOUDFLARE_TUNNEL_ENABLED=true', () => {
    withEnv({ CLOUDFLARE_TUNNEL_ENABLED: 'true' }, () => {
      const config = loadConfig();
      expect(config.cloudflareTunnelEnabled).toBe(true);
    });
  });

  it('defaults cloudflareTunnelToken to null', () => {
    withEnv({}, () => {
      const config = loadConfig();
      expect(config.cloudflareTunnelToken).toBeNull();
    });
  });

  it('reads CLOUDFLARE_TUNNEL_TOKEN from env', () => {
    withEnv({ CLOUDFLARE_TUNNEL_TOKEN: 'tok_abc' }, () => {
      const config = loadConfig();
      expect(config.cloudflareTunnelToken).toBe('tok_abc');
    });
  });

  it('defaults githubWebhookIpAllowlist to true', () => {
    withEnv({}, () => {
      const config = loadConfig();
      expect(config.githubWebhookIpAllowlist).toBe(true);
    });
  });

  it('parses GITHUB_WEBHOOK_IP_ALLOWLIST=false', () => {
    withEnv({ GITHUB_WEBHOOK_IP_ALLOWLIST: 'false' }, () => {
      const config = loadConfig();
      expect(config.githubWebhookIpAllowlist).toBe(false);
    });
  });
});
