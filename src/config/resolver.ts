/** @module config/resolver — Configuration resolution, validation, and loading. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { ConfigStore } from '../store/config-store.js';
import {
  ensurePrivateDirectory,
  ensurePrivateFile,
  writePrivateFile,
} from '../utils/fs-security.js';
import {
  applySqliteConnectionPragmas,
  tightenSqliteRuntimeFilePermissions,
} from '../utils/sqlite.js';
import {
  ENV_REGISTRY,
  MANAGED_PERSISTED_KEYS,
  PROCESS_ENV_SYNC_KEYS,
  SETTINGS_EDITABLE_KEYS,
} from './env-registry.js';
import {
  type Config,
  type ConfigResolverOptions,
  type DashboardConfig,
  type DefaultMode,
  type EditableSettingEntry,
  type LogLevel,
  type ResolvedConfigStorage,
  type ResolvedConfigValue,
  SENSITIVE_VALUE_MASK,
  type SettingsSchemaEntry,
  type ToolName,
} from './types.js';

// ── Zod schemas for config validation ────────────────────────────────────────────

const DefaultModeSchema = z.preprocess(
  (val) => {
    const normalized = String(val ?? '')
      .trim()
      .toLowerCase();
    return normalized === 'read-only' ? 'readonly' : normalized;
  },
  z.enum(['write', 'readonly']),
);
const BooleanStringSchema = z.preprocess(
  (val) =>
    String(val ?? '')
      .trim()
      .toLowerCase(),
  z.enum(['true', 'false']),
);
const PositiveIntSchema = (max?: number) =>
  z.preprocess(
    (val) => (typeof val === 'string' ? Number.parseInt(val, 10) : val),
    max ? z.number().int().positive().max(max) : z.number().int().positive(),
  );

const GENERATED_SECRET_FILENAMES: Readonly<Record<string, string>> = {
  SERVER_API_SECRET: '.server-api-secret',
  DASHBOARD_SECRET: '.dashboard-secret',
};

interface ConfigStoreReader {
  get(key: string): { key: string; value: string | null; storage: ResolvedConfigStorage } | null;
}

interface LoadConfigOptions extends ConfigResolverOptions {
  resolver?: ConfigResolver;
}

function hasInvalidEnvKeyChars(key: string): boolean {
  return key.length === 0 || /[=\n\r\0]/.test(key);
}

function hasInvalidEnvValueChars(value: string): boolean {
  return /[\n\r\0]/.test(value);
}

function readProcessEnvValue(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key];
  return typeof value === 'string' ? value : null;
}

function getDefaultEnvValue(key: string): string | null {
  return ENV_REGISTRY[key]?.default ?? null;
}

function getRequiredDefaultEnvValue(key: string): string {
  const value = ENV_REGISTRY[key]?.default;
  if (typeof value !== 'string') {
    throw new Error(`Missing default value for ${key}`);
  }
  return value;
}

function getGeneratedSecretFilename(key: string): string {
  const filename = GENERATED_SECRET_FILENAMES[key];
  if (!filename) {
    throw new Error(`Missing generated-secret filename for ${key}`);
  }
  return filename;
}

export function loadCompatibilityEnvFile(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): ReadonlySet<string> {
  const envPath = path.resolve(cwd, '.env');
  if (!fs.existsSync(envPath)) {
    return new Set();
  }

  const parsed = parseEnv(fs.readFileSync(envPath, 'utf-8'));
  const loadedKeys = new Set<string>();

  for (const [key, value] of Object.entries(parsed)) {
    if (MANAGED_PERSISTED_KEYS.has(key)) {
      continue;
    }
    if (typeof env[key] === 'string') {
      continue;
    }
    env[key] = value;
    loadedKeys.add(key);
  }

  return loadedKeys;
}

/** Resolves config values with priority: DB > keychain > env > generated > defaults. */
export class ConfigResolver {
  private readonly env: NodeJS.ProcessEnv;
  private readonly secureStoreValues: ReadonlyMap<string, string>;
  private readonly dataDir: string;
  private readonly cache = new Map<string, ResolvedConfigValue>();

  constructor(private readonly options: ConfigResolverOptions = {}) {
    this.env = options.env ?? process.env;
    this.secureStoreValues = options.secureStoreValues ?? new Map<string, string>();
    this.dataDir =
      options.dataDir ?? process.env.HUSKYGATE_DATA_DIR ?? path.resolve(process.cwd(), 'data');
  }

  get(key: string): ResolvedConfigValue {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const meta = ENV_REGISTRY[key];
    let resolved: ResolvedConfigValue;
    if (!meta) {
      const envValue = readProcessEnvValue(this.env, key);
      resolved = {
        key,
        value: envValue,
        source: envValue === null ? 'default' : 'env_fallback',
        storage: envValue === null ? null : 'env',
      };
    } else if (meta.persistence === 'generated') {
      resolved = {
        key,
        value: resolvePersistedSecret(key, getGeneratedSecretFilename(key), this.dataDir),
        source: 'generated',
        storage: 'generated',
      };
    } else if (meta.persistence === 'derived') {
      resolved = this.resolveDerived(key);
    } else {
      const record = this.options.configStore?.get(key) ?? null;
      if (record && record.value !== null) {
        resolved = {
          key,
          value: record.value,
          source: 'db',
          storage: record.storage,
        };
      } else {
        const secureValue = this.secureStoreValues.get(key);
        if (secureValue) {
          resolved = {
            key,
            value: secureValue,
            source: 'keychain',
            storage: 'keychain_ref',
          };
        } else {
          const envValue = readProcessEnvValue(this.env, key);
          if (envValue !== null) {
            resolved = {
              key,
              value: envValue,
              source: 'env_fallback',
              storage: 'env',
            };
          } else {
            const defaultValue = getDefaultEnvValue(key);
            resolved = {
              key,
              value: defaultValue,
              source: 'default',
              storage: defaultValue === null ? null : 'default',
            };
          }
        }
      }
    }

    this.cache.set(key, resolved);
    return resolved;
  }

  getEditableSettings(): EditableSettingEntry[] {
    return Object.keys(ENV_REGISTRY)
      .filter((key) => SETTINGS_EDITABLE_KEYS.has(key))
      .map((key) => {
        const meta = ENV_REGISTRY[key];
        if (!meta) {
          throw new Error(`Missing registry metadata for editable key: ${key}`);
        }
        const resolved = this.get(key);
        const hasValue = typeof resolved.value === 'string' && resolved.value.trim().length > 0;
        const masked = meta.sensitive && hasValue;
        return {
          ...resolved,
          value: masked ? SENSITIVE_VALUE_MASK : (resolved.value ?? ''),
          masked,
          hasValue,
          mutable: meta.mutable,
          sensitive: meta.sensitive,
        };
      });
  }

  private resolveDerived(key: string): ResolvedConfigValue {
    if (key === 'HUSKYGATE_API_BASE') {
      const port = parsePositiveIntValue(
        'SERVER_API_PORT',
        this.get('SERVER_API_PORT').value ?? getRequiredDefaultEnvValue('SERVER_API_PORT'),
        65535,
      );
      return {
        key,
        value: `http://127.0.0.1:${port}`,
        source: 'derived',
        storage: 'derived',
      };
    }
    if (key === 'HUSKYGATE_API_SECRET') {
      const serverApiSecret = this.get('SERVER_API_SECRET').value ?? '';
      return {
        key,
        value: resolveScheduleSkillSecret(serverApiSecret, this.env),
        source: 'derived',
        storage: 'derived',
      };
    }
    throw new Error(`Unsupported derived config key: ${key}`);
  }
}

/** Create a ConfigResolver with the given backing stores. */
export function createConfigResolver(options: ConfigResolverOptions = {}): ConfigResolver {
  return new ConfigResolver(options);
}

export function getEditableSettingsSchema(): SettingsSchemaEntry[] {
  return Object.entries(ENV_REGISTRY)
    .filter(([, meta]) => meta.editable)
    .map(([key, meta]) => {
      const entry: SettingsSchemaEntry = {
        key,
        cat: meta.cat,
        sub: meta.sub,
        mutable: meta.mutable,
        sensitive: meta.sensitive,
      };
      if (meta.skill) entry.skill = true;
      if (meta.description) entry.description = meta.description;
      if (meta.default !== undefined) entry.default = meta.default;
      if (meta.valueType) entry.valueType = meta.valueType;
      if (meta.enumValues) entry.enumValues = meta.enumValues;
      return entry;
    });
}

export function isSensitiveKey(key: string): boolean {
  const meta = ENV_REGISTRY[key];
  if (meta !== undefined) return meta.sensitive;
  return /TOKEN|KEY|SECRET|PASSWORD/i.test(key);
}

function requireResolvedValue(resolver: ConfigResolver, key: string): string {
  const value = resolver.get(key).value;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function isToolName(value: string): value is ToolName {
  return value === 'claude' || value === 'codex' || value === 'gemini';
}

function parseToolName(value: string): ToolName {
  if (isToolName(value)) return value;
  throw new Error(`Invalid tool name: ${value}. Must be claude, codex, or gemini.`);
}

function parsePositiveIntValue(key: string, raw: string, max?: number): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${key}: "${raw}". Must be a positive integer.`);
  }
  if (max !== undefined && value > max) {
    throw new Error(`Invalid ${key}: "${raw}". Must be <= ${max}.`);
  }
  return value;
}

function parsePositiveIntSetting(
  resolver: ConfigResolver,
  key: string,
  fallback: string,
  max?: number,
): number {
  return parsePositiveIntValue(key, resolver.get(key).value ?? fallback, max);
}

function parseDefaultModeValue(raw: string): DefaultMode {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'readonly' || normalized === 'read-only') return 'readonly';
  return 'write';
}

function parseDefaultMode(resolver: ConfigResolver, envKey: string): DefaultMode {
  return parseDefaultModeValue(resolver.get(envKey).value ?? '');
}

function parseLogLevel(value: string): LogLevel {
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    return value;
  }
  throw new Error(`Invalid log level: ${value}`);
}

function parseBooleanValue(value: string): boolean {
  return value.trim().toLowerCase() === 'true';
}

function parseOptionalValue(resolver: ConfigResolver, key: string): string | null {
  const raw = resolver.get(key).value ?? '';
  const trimmed = raw.trim();
  return trimmed || null;
}

function createResolverForLoad(options?: LoadConfigOptions): ConfigResolver {
  if (options?.resolver) return options.resolver;
  return createConfigResolver(options);
}

function listBootstrapTables(database: Database.Database): Set<string> {
  const rows = database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function openBootstrapConfigStore(dataDir: string): {
  configStore: ConfigStoreReader | null;
  close: () => void;
} {
  const dbPath = path.join(dataDir, 'orchestrator.db');
  if (!fs.existsSync(dbPath)) {
    return { configStore: null, close: () => undefined };
  }

  const database = new Database(dbPath);
  applySqliteConnectionPragmas(database, { enableWal: false });
  tightenSqliteRuntimeFilePermissions(dbPath);
  const tables = listBootstrapTables(database);
  if (!tables.has('config')) {
    database.close();
    return { configStore: null, close: () => undefined };
  }

  const configStore = new ConfigStore(database);
  return {
    configStore,
    close: () => database.close(),
  };
}

/** Keys that must be resolved (non-empty) for the full daemon to start. */
const DAEMON_REQUIRED_KEYS = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'ALLOWED_USER_IDS'] as const;

/**
 * Check whether all required daemon config values are resolvable.
 * Uses the same resolution cascade (DB → keychain → env → default) as loadConfig.
 * Returns missing key names so the caller can show actionable guidance.
 */
export function checkDaemonReadiness(options?: {
  dataDir?: string;
  secureStoreValues?: ReadonlyMap<string, string>;
}): { ready: true } | { ready: false; missingKeys: string[] } {
  const dataDir =
    options?.dataDir ?? process.env.HUSKYGATE_DATA_DIR ?? path.resolve(process.cwd(), 'data');
  const storeHandle = openBootstrapConfigStore(dataDir);
  try {
    const resolver = createConfigResolver({
      dataDir,
      configStore: storeHandle.configStore ?? undefined,
      secureStoreValues: options?.secureStoreValues,
    });
    const missing: string[] = [];
    for (const key of DAEMON_REQUIRED_KEYS) {
      const value = resolver.get(key).value;
      if (!value || value.trim().length === 0) {
        missing.push(key);
      }
    }
    return missing.length === 0 ? { ready: true } : { ready: false, missingKeys: missing };
  } finally {
    storeHandle.close();
  }
}

export function validateSettingValue(key: string, value: string): string | null {
  if (!SETTINGS_EDITABLE_KEYS.has(key)) {
    return `Key '${key}' is not editable`;
  }
  if (typeof value !== 'string') {
    return `Value for '${key}' must be a string`;
  }
  if (hasInvalidEnvKeyChars(key)) {
    return `Invalid env key: ${key}`;
  }
  if (hasInvalidEnvValueChars(value)) {
    return `Invalid value for env key: ${key}`;
  }
  if (value === SENSITIVE_VALUE_MASK) {
    return `Masked placeholder is not allowed for '${key}'`;
  }
  if (value.length === 0) {
    return null;
  }
  const meta = ENV_REGISTRY[key];
  if (!meta) return null;

  switch (meta.valueType) {
    case 'boolean': {
      const result = BooleanStringSchema.safeParse(value);
      if (!result.success) {
        return `Invalid ${key}: "${value}". Must be true or false.`;
      }
      return null;
    }
    case 'positiveInt': {
      const result = PositiveIntSchema(meta.maxValue).safeParse(value);
      if (!result.success) {
        if (meta.maxValue) {
          return `Invalid ${key}: "${value}". Must be a positive integer. Must be <= ${meta.maxValue}.`;
        }
        return `Invalid ${key}: "${value}". Must be a positive integer.`;
      }
      return null;
    }
    case 'enum': {
      if (meta.enumValues && !meta.enumValues.includes(value.trim().toLowerCase())) {
        return `Invalid ${key}: "${value}". Must be one of: ${meta.enumValues.join(', ')}.`;
      }
      return null;
    }
    case 'mode': {
      const result = DefaultModeSchema.safeParse(value);
      if (!result.success) {
        return `Invalid ${key}: "${value}". Must be write or readonly.`;
      }
      return null;
    }
    default:
      break;
  }
  if (key === 'ALLOWED_USER_IDS' && value.trim().length === 0) {
    return 'ALLOWED_USER_IDS must not be empty.';
  }
  return null;
}

export function resolvePersistedSecret(
  envKey: string,
  filename: string,
  dataDir = process.env.HUSKYGATE_DATA_DIR ?? path.resolve(process.cwd(), 'data'),
): string {
  const envVal = process.env[envKey];
  if (envVal) return envVal;

  const secretPath = path.join(dataDir, filename);
  ensurePrivateDirectory(dataDir);
  try {
    const persisted = fs.readFileSync(secretPath, 'utf-8').trim();
    if (persisted) {
      ensurePrivateFile(secretPath);
      return persisted;
    }
  } catch {
    // fall through
  }

  const secret = crypto.randomUUID();
  try {
    writePrivateFile(secretPath, secret, { flag: 'wx' });
  } catch {
    try {
      const raced = fs.readFileSync(secretPath, 'utf-8').trim();
      if (raced) {
        ensurePrivateFile(secretPath);
        return raced;
      }
    } catch {
      // fall through to ephemeral secret
    }
  }
  return secret;
}

export function resolveScheduleSkillSecret(
  serverApiSecret: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.HUSKYGATE_API_SECRET?.trim();
  if (configured && configured !== serverApiSecret) {
    return configured;
  }
  return `hg_sched_${crypto.randomBytes(24).toString('hex')}`;
}

export function syncProcessEnvFromResolver(
  resolver: ConfigResolver,
  keys: ReadonlySet<string> = PROCESS_ENV_SYNC_KEYS,
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const key of keys) {
    const value = resolver.get(key).value;
    if (typeof value === 'string' && value.length > 0) {
      env[key] = value;
    } else {
      delete env[key];
    }
  }
}

/** Load minimal config needed by the CLI before the full daemon starts (ports, secrets, workdir). */
export function loadBootstrapConfig(options?: LoadConfigOptions): DashboardConfig {
  const dataDir =
    options?.dataDir ?? process.env.HUSKYGATE_DATA_DIR ?? path.resolve(process.cwd(), 'data');
  const hasExplicitStore = options !== undefined && 'configStore' in options;
  const storeHandle = hasExplicitStore ? null : openBootstrapConfigStore(dataDir);
  const resolver = createResolverForLoad({
    ...options,
    dataDir,
    configStore: hasExplicitStore
      ? (options?.configStore ?? undefined)
      : (storeHandle?.configStore ?? undefined),
  });
  try {
    const workdirRoot = path.resolve(
      resolver.get('WORKDIR_ROOT').value ?? getRequiredDefaultEnvValue('WORKDIR_ROOT'),
    );
    return {
      serverApiPort: parsePositiveIntSetting(
        resolver,
        'SERVER_API_PORT',
        getRequiredDefaultEnvValue('SERVER_API_PORT'),
        65535,
      ),
      serverApiSecret:
        resolver.get('SERVER_API_SECRET').value ??
        resolvePersistedSecret('SERVER_API_SECRET', '.server-api-secret', dataDir),
      dashboardSecret:
        resolver.get('DASHBOARD_SECRET').value ??
        resolvePersistedSecret('DASHBOARD_SECRET', '.dashboard-secret', dataDir),
      workdirRoot,
      dashboardCookieSecure: parseBooleanValue(
        resolver.get('HUSKYGATE_DASHBOARD_COOKIE_SECURE').value ??
          getRequiredDefaultEnvValue('HUSKYGATE_DASHBOARD_COOKIE_SECURE'),
      ),
    };
  } finally {
    storeHandle?.close();
  }
}

/** Load config for the dashboard process (alias for loadBootstrapConfig). */
export function loadDashboardConfig(options?: LoadConfigOptions): DashboardConfig {
  return loadBootstrapConfig(options);
}

/** Load the full daemon Config by resolving all env keys through the cascade. */
export function loadConfig(options?: LoadConfigOptions): Config {
  const resolver = createResolverForLoad(options);
  const workdirRootRaw =
    resolver.get('WORKDIR_ROOT').value ?? getRequiredDefaultEnvValue('WORKDIR_ROOT');
  const workdirRoot = path.resolve(workdirRootRaw);
  const allowedRootsRaw = resolver.get('ALLOWED_WORKDIR_ROOTS').value ?? workdirRootRaw;

  return {
    slack: {
      botToken: requireResolvedValue(resolver, 'SLACK_BOT_TOKEN'),
      appToken: requireResolvedValue(resolver, 'SLACK_APP_TOKEN'),
    },
    allowedUserIds: requireResolvedValue(resolver, 'ALLOWED_USER_IDS')
      .split(',')
      .map((segment) => segment.trim())
      .filter(Boolean),
    allowedTeamId: parseOptionalValue(resolver, 'ALLOWED_TEAM_ID'),
    defaultTool: parseToolName(
      resolver.get('DEFAULT_TOOL').value ?? getRequiredDefaultEnvValue('DEFAULT_TOOL'),
    ),
    maxConcurrency: parsePositiveIntSetting(
      resolver,
      'MAX_CONCURRENCY',
      getRequiredDefaultEnvValue('MAX_CONCURRENCY'),
    ),
    maxRuntimeSec: parsePositiveIntSetting(
      resolver,
      'MAX_RUNTIME_SEC',
      getRequiredDefaultEnvValue('MAX_RUNTIME_SEC'),
    ),
    noOutputTimeoutSec: parsePositiveIntSetting(
      resolver,
      'NO_OUTPUT_TIMEOUT_SEC',
      getRequiredDefaultEnvValue('NO_OUTPUT_TIMEOUT_SEC'),
    ),
    claudeModel: parseOptionalValue(resolver, 'CLAUDE_MODEL'),
    codexModel: parseOptionalValue(resolver, 'CODEX_MODEL'),
    geminiModel: parseOptionalValue(resolver, 'GEMINI_MODEL'),
    claudeMcpAuthServer: parseOptionalValue(resolver, 'CLAUDE_MCP_AUTH_SERVER'),
    geminiMcpAuthServer: parseOptionalValue(resolver, 'GEMINI_MCP_AUTH_SERVER'),
    codexMcpAuthServer: parseOptionalValue(resolver, 'CODEX_MCP_AUTH_SERVER'),
    workdirRoot,
    allowedWorkdirRoots: allowedRootsRaw.split(',').map((segment) => path.resolve(segment.trim())),
    sessionIdleTimeoutSec: parsePositiveIntSetting(
      resolver,
      'SESSION_IDLE_TIMEOUT_SEC',
      getRequiredDefaultEnvValue('SESSION_IDLE_TIMEOUT_SEC'),
    ),
    sessionCleanupEnabled: parseBooleanValue(
      resolver.get('SESSION_CLEANUP_ENABLED').value ??
        getRequiredDefaultEnvValue('SESSION_CLEANUP_ENABLED'),
    ),
    scheduleEnabled: parseBooleanValue(
      resolver.get('SCHEDULE_ENABLED').value ?? getRequiredDefaultEnvValue('SCHEDULE_ENABLED'),
    ),
    schedulePollIntervalSec: parsePositiveIntSetting(
      resolver,
      'SCHEDULE_POLL_INTERVAL_SEC',
      getRequiredDefaultEnvValue('SCHEDULE_POLL_INTERVAL_SEC'),
    ),
    scheduleMaxConcurrent: parsePositiveIntSetting(
      resolver,
      'SCHEDULE_MAX_CONCURRENT',
      getRequiredDefaultEnvValue('SCHEDULE_MAX_CONCURRENT'),
    ),
    scheduleDefaultNotifyChannel: parseOptionalValue(resolver, 'SCHEDULE_DEFAULT_NOTIFY_CHANNEL'),
    claudeDefaultMode: parseDefaultMode(resolver, 'CLAUDE_DEFAULT_MODE'),
    codexDefaultSandboxMode: parseDefaultMode(resolver, 'CODEX_DEFAULT_SANDBOX_MODE'),
    geminiDefaultMode: parseDefaultMode(resolver, 'GEMINI_DEFAULT_MODE'),
    toolAutoApproveMode: parseBooleanValue(
      resolver.get('TOOL_AUTO_APPROVE_MODE').value ??
        getRequiredDefaultEnvValue('TOOL_AUTO_APPROVE_MODE'),
    ),
    logLevel: parseLogLevel(
      resolver.get('LOG_LEVEL').value ?? getRequiredDefaultEnvValue('LOG_LEVEL'),
    ),
    serverApiPort: parsePositiveIntSetting(
      resolver,
      'SERVER_API_PORT',
      getRequiredDefaultEnvValue('SERVER_API_PORT'),
      65535,
    ),
    serverApiHost:
      parseOptionalValue(resolver, 'SERVER_API_HOST') ??
      getRequiredDefaultEnvValue('SERVER_API_HOST'),
    serverApiSecret:
      resolver.get('SERVER_API_SECRET').value ??
      resolvePersistedSecret('SERVER_API_SECRET', '.server-api-secret'),
    dashboardSecret:
      resolver.get('DASHBOARD_SECRET').value ??
      resolvePersistedSecret('DASHBOARD_SECRET', '.dashboard-secret'),
    webhookPublicBaseUrl: parseOptionalValue(resolver, 'WEBHOOK_PUBLIC_BASE_URL'),
    cloudflareTunnelEnabled: parseBooleanValue(
      resolver.get('CLOUDFLARE_TUNNEL_ENABLED').value ??
        getRequiredDefaultEnvValue('CLOUDFLARE_TUNNEL_ENABLED'),
    ),
    cloudflareTunnelToken: parseOptionalValue(resolver, 'CLOUDFLARE_TUNNEL_TOKEN'),
    githubWebhookIpAllowlist: parseBooleanValue(
      resolver.get('GITHUB_WEBHOOK_IP_ALLOWLIST').value ??
        getRequiredDefaultEnvValue('GITHUB_WEBHOOK_IP_ALLOWLIST'),
    ),
    dashboardCookieSecure: parseBooleanValue(
      resolver.get('HUSKYGATE_DASHBOARD_COOKIE_SECURE').value ??
        getRequiredDefaultEnvValue('HUSKYGATE_DASHBOARD_COOKIE_SECURE'),
    ),
    logStacks: parseBooleanValue(
      resolver.get('HUSKYGATE_LOG_STACKS').value ??
        getRequiredDefaultEnvValue('HUSKYGATE_LOG_STACKS'),
    ),
    skillTemplateDir: parseOptionalValue(resolver, 'SKILL_TEMPLATE_DIR'),
  };
}
