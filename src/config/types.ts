/** @module config/types — Configuration type definitions. */

export type ToolName = 'claude' | 'codex' | 'gemini';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type DefaultMode = 'write' | 'readonly';

/** Fully resolved runtime configuration consumed by the daemon. */
export interface Config {
  slack: {
    botToken: string;
    appToken: string;
  };
  allowedUserIds: string[];
  allowedTeamId: string | null;
  defaultTool: ToolName;
  maxConcurrency: number;
  maxRuntimeSec: number;
  noOutputTimeoutSec: number;
  claudeModel: string | null;
  codexModel: string | null;
  geminiModel: string | null;
  claudeMcpAuthServer: string | null;
  geminiMcpAuthServer: string | null;
  codexMcpAuthServer: string | null;
  workdirRoot: string;
  allowedWorkdirRoots: string[];
  sessionIdleTimeoutSec: number;
  sessionCleanupEnabled: boolean;
  scheduleEnabled: boolean;
  schedulePollIntervalSec: number;
  scheduleMaxConcurrent: number;
  scheduleDefaultNotifyChannel: string | null;
  claudeDefaultMode: DefaultMode;
  codexDefaultSandboxMode: DefaultMode;
  geminiDefaultMode: DefaultMode;
  toolAutoApproveMode: boolean;
  logLevel: LogLevel;
  serverApiPort: number;
  serverApiHost?: string;
  serverApiSecret: string;
  dashboardSecret: string;
  webhookPublicBaseUrl?: string | null;
  cloudflareTunnelEnabled: boolean;
  cloudflareTunnelToken: string | null;
  githubWebhookIpAllowlist: boolean;
  dashboardCookieSecure: boolean;
  logStacks: boolean;
  skillTemplateDir: string | null;
}

export type EnvCategory = 'mode' | 'messaging' | 'apps' | 'environment' | 'internal';
export type EnvScope = 'daemon' | 'driver' | 'skill' | 'system';
export type EnvPersistence = 'config-db' | 'secure-store' | 'generated' | 'derived' | 'env-only';

export type EnvValueType = 'string' | 'boolean' | 'positiveInt' | 'enum' | 'mode';

export interface EnvKeyMeta {
  cat: EnvCategory;
  sub: string | null;
  mutable: boolean;
  sensitive: boolean;
  skill: boolean;
  editable: boolean;
  persistence: EnvPersistence;
  scope?: EnvScope;
  /** Human-readable description shown in the dashboard settings UI. */
  description?: string;
  /** Default value used when no persisted/env value exists. */
  default?: string;
  /** Value type for validation. Defaults to 'string' if omitted. */
  valueType?: EnvValueType;
  /** Valid values when valueType is 'enum'. */
  enumValues?: readonly string[];
  /** Upper bound when valueType is 'positiveInt' (e.g. port max 65535). */
  maxValue?: number;
}

export const SENSITIVE_VALUE_MASK = '***';

export interface DashboardConfig {
  serverApiPort: number;
  serverApiSecret: string;
  dashboardSecret: string;
  workdirRoot: string;
  dashboardCookieSecure: boolean;
}

export type ResolvedConfigSource =
  | 'db'
  | 'keychain'
  | 'env_fallback'
  | 'default'
  | 'generated'
  | 'derived';

export type ResolvedConfigStorage =
  | 'db'
  | 'keychain_ref'
  | 'env'
  | 'generated'
  | 'derived'
  | 'default'
  | null;

export interface ResolvedConfigValue {
  key: string;
  value: string | null;
  source: ResolvedConfigSource;
  storage: ResolvedConfigStorage;
}

export interface EditableSettingEntry extends ResolvedConfigValue {
  masked: boolean;
  hasValue: boolean;
  mutable: boolean;
  sensitive: boolean;
}

export interface SettingsSchemaEntry {
  key: string;
  cat: EnvCategory;
  sub: string | null;
  mutable: boolean;
  sensitive: boolean;
  skill?: boolean;
  description?: string;
  default?: string;
  valueType?: EnvValueType;
  enumValues?: readonly string[];
}

export interface ConfigResolverOptions {
  configStore?: {
    get(key: string): { key: string; value: string | null; storage: ResolvedConfigStorage } | null;
  } | null;
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  secureStoreValues?: ReadonlyMap<string, string>;
}
