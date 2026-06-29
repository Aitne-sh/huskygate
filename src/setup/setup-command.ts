/** @module setup-command — CLI setup flow orchestration: manifest → tokens → persist. */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigStore } from '../store/config-store.js';
import { errorMessage } from '../utils/error.js';
import { type SetupStrings, getStrings } from './i18n.js';
import { SetupCancelledError, type SetupPrompter, createSetupPrompter } from './interactive.js';
import { generateManifestJson, generateManifestUrl } from './manifest.js';
import {
  validateAppTokenFormat,
  validateAppTokenLive,
  validateBotTokenFormat,
  validateBotTokenLive,
  validateUserIdFormat,
} from './token-validator.js';

export interface SetupCommandOptions {
  open?: boolean;
  manifestOnly?: boolean;
  status?: boolean;
  reset?: boolean;
}

const TOTAL_STEPS = 4;
const MAX_RETRIES = 3;

const SETUP_CONFIG_KEYS = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'ALLOWED_USER_IDS'] as const;

/** Metadata key used by welcome.ts to track first-run DM. Cleared on reset. */
export const WELCOME_DM_SENT_KEY = 'WELCOME_DM_SENT';

// ── DB helper ──

/**
 * Open the config DB readonly, run a query, and close.
 * Returns `null` if the DB file does not exist.
 * Avoids polluting the module-level singleton in database.ts.
 */
async function withConfigDb<T>(
  dataDir: string,
  fn: (db: import('better-sqlite3').Database) => T,
): Promise<T | null> {
  const dbPath = resolve(dataDir, 'orchestrator.db');
  if (!existsSync(dbPath)) return null;
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath, { readonly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/**
 * Open the config DB read-write, run a mutation, and close.
 * Returns `null` if the DB file does not exist.
 */
async function withConfigDbWrite<T>(
  dataDir: string,
  fn: (db: import('better-sqlite3').Database) => T,
): Promise<T | null> {
  const dbPath = resolve(dataDir, 'orchestrator.db');
  if (!existsSync(dbPath)) return null;
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

// ── Setup status ──

/**
 * Check if setup has been completed.
 *
 * Uses DB as the authoritative source (not keychain independently).
 * This prevents false positives from ghost keychain values left by
 * a partial setup where keychain wrote but DB transaction failed.
 */
export async function isSetupComplete(dataDir: string): Promise<boolean> {
  const result = await withConfigDb(dataDir, (db) => {
    const row = db
      .prepare('SELECT value, storage FROM config WHERE key = ?')
      .get('SLACK_BOT_TOKEN') as { value: string | null; storage: string } | undefined;
    return (
      row != null && (row.storage === 'keychain_ref' || (row.value != null && row.value.length > 0))
    );
  });
  return result === true;
}

/** Main setup flow entry point. */
export async function runSetup(options?: SetupCommandOptions): Promise<void> {
  const dataDir = process.env.HUSKYGATE_DATA_DIR || resolve(process.cwd(), 'data');
  const s = getStrings();

  // ── --manifest-only: print and exit ──
  if (options?.manifestOnly) {
    console.log(generateManifestJson());
    return;
  }

  // ── --status: check and exit ──
  if (options?.status) {
    const complete = await isSetupComplete(dataDir);
    console.log(complete ? s.statusComplete : s.statusNotComplete);
    process.exitCode = complete ? 0 : 1;
    return;
  }

  // ── --reset: clear setup state ──
  if (options?.reset) {
    await resetSetup(dataDir);
    return;
  }

  // ── Full interactive setup ──
  const prompter = createSetupPrompter();

  try {
    await runInteractiveSetup(prompter, dataDir, options);
  } catch (err) {
    if (err instanceof SetupCancelledError) {
      prompter.printInfo(`\n  ${s.setupCancelled}`);
      return;
    }
    throw err;
  } finally {
    prompter.close();
  }
}

// ── Internal: interactive setup flow ──

async function runInteractiveSetup(
  prompter: SetupPrompter,
  dataDir: string,
  options?: SetupCommandOptions,
): Promise<void> {
  const shouldOpen = options?.open !== false;
  const s = getStrings();

  // Banner
  prompter.printInfo('');
  prompter.printInfo('+-------------------------------------+');
  prompter.printInfo(`|  ${s.bannerTitle}      |`);
  prompter.printInfo('+-------------------------------------+');
  prompter.printInfo('');
  for (const line of s.bannerSubtitle.split('\n')) {
    prompter.printInfo(line);
  }

  // Check existing setup
  const alreadyComplete = await isSetupComplete(dataDir);
  if (alreadyComplete) {
    const overwrite = await prompter.confirm(s.alreadyConfigured);
    if (!overwrite) {
      prompter.printInfo(s.setupCancelled);
      return;
    }
  }

  // ── Step 1: Create Slack App ──
  prompter.printStep(1, TOTAL_STEPS, s.step1Title);

  const manifestUrl = generateManifestUrl();
  prompter.printInfo(s.step1OpenBrowser);
  prompter.printInfo(s.step1Fallback);
  prompter.printInfo(manifestUrl);
  prompter.printInfo('');
  prompter.printInfo(s.step1Instruction1);
  prompter.printInfo(s.step1Instruction2);
  prompter.printInfo(s.step1Instruction3);

  if (shouldOpen) {
    try {
      const { openBrowser } = await import('../utils/platform.js');
      await openBrowser(manifestUrl);
    } catch {
      // Browser open failed — URL is already printed above
    }
  }

  await prompter.waitForEnter(s.step1WaitForEnter);

  // ── Step 2: Collect Bot Token ──
  prompter.printStep(2, TOTAL_STEPS, s.step2Title);

  prompter.printInfo(s.step2Instruction1);
  prompter.printInfo(s.step2Instruction2);
  prompter.printInfo(s.step2Instruction3);
  prompter.printInfo(s.step2Instruction4);
  prompter.printInfo(s.step2Instruction5);
  prompter.printInfo('');

  const botToken = await collectTokenWithRetry(
    prompter,
    s,
    s.step2PromptLabel,
    validateBotTokenFormat,
    validateBotTokenLive,
  );

  // ── Step 3: Collect App Token ──
  prompter.printStep(3, TOTAL_STEPS, s.step3Title);

  prompter.printInfo(s.step3Instruction1);
  prompter.printInfo(s.step3Instruction2);
  prompter.printInfo(s.step3Instruction3);
  prompter.printInfo(s.step3Instruction4);
  prompter.printInfo(s.step3Instruction5);
  prompter.printInfo(s.step3Instruction6);
  prompter.printInfo(s.step3Instruction7);
  prompter.printInfo(s.step3Instruction8);
  prompter.printInfo('');

  const appToken = await collectTokenWithRetry(
    prompter,
    s,
    s.step3PromptLabel,
    validateAppTokenFormat,
    validateAppTokenLive,
  );

  // ── Step 4: Collect Allowed User IDs ──
  prompter.printStep(4, TOTAL_STEPS, s.step4Title);

  prompter.printInfo(s.step4Question);
  prompter.printInfo(s.step4FindUserId1);
  prompter.printInfo(s.step4FindUserId2);
  prompter.printInfo('');

  const userIds = await collectUserIds(prompter, s);

  // ── Persist all values atomically ──
  prompter.printInfo('');
  await persistSetupValues(prompter, s, dataDir, botToken, appToken, userIds);
}

// ── Token collection with retry ──

async function collectTokenWithRetry(
  prompter: SetupPrompter,
  s: SetupStrings,
  label: string,
  formatValidator: (token: string) => { valid: boolean; error?: string },
  liveValidator: (token: string) => Promise<{ valid: boolean; error?: string; detail?: string }>,
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const token = await prompter.prompt({ message: label, mask: true });

    // Format check
    const formatResult = formatValidator(token);
    if (!formatResult.valid) {
      prompter.printError(formatResult.error ?? '');
      if (attempt < MAX_RETRIES) {
        prompter.printInfo(s.attemptCount(attempt, MAX_RETRIES));
        continue;
      }
      // Last attempt — offer to save anyway
      const saveAnyway = await prompter.confirm(s.saveWithoutValidation);
      if (saveAnyway) {
        prompter.printWarning(s.tokenSavedWithoutFormat);
        return token;
      }
      throw new Error(s.failedAfterRetries(MAX_RETRIES));
    }

    // Live validation
    const liveResult = await liveValidator(token);
    if (liveResult.valid) {
      if (liveResult.detail) {
        prompter.printSuccess(liveResult.detail);
      } else {
        prompter.printSuccess('Token validated');
      }
      return token;
    }

    prompter.printError(liveResult.error ?? '');
    if (attempt < MAX_RETRIES) {
      prompter.printInfo(s.attemptCount(attempt, MAX_RETRIES));
      continue;
    }

    const saveAnyway = await prompter.confirm(s.saveWithoutLiveValidation);
    if (saveAnyway) {
      prompter.printWarning(s.tokenSavedWithoutLive);
      return token;
    }
    throw new Error(s.failedAfterRetries(MAX_RETRIES));
  }

  // Unreachable, but TypeScript needs this
  throw new Error('Token collection failed.');
}

// ── User ID collection (with retry) ──

async function collectUserIds(prompter: SetupPrompter, s: SetupStrings): Promise<string[]> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const rawInput = await prompter.prompt({ message: s.step4PromptLabel });

    const ids = rawInput
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    if (ids.length === 0) {
      prompter.printError(s.userIdRequired);
      if (attempt < MAX_RETRIES) {
        prompter.printInfo(s.attemptCount(attempt, MAX_RETRIES));
        continue;
      }
      throw new Error(s.invalidUserIdsAfterRetries);
    }

    const invalid: string[] = [];
    for (const id of ids) {
      const result = validateUserIdFormat(id);
      if (!result.valid) {
        invalid.push(`${id}: ${result.error}`);
      }
    }
    if (invalid.length > 0) {
      for (const msg of invalid) {
        prompter.printError(msg);
      }
      if (attempt < MAX_RETRIES) {
        prompter.printInfo(s.attemptCount(attempt, MAX_RETRIES));
        continue;
      }
      throw new Error(s.invalidUserIdsAfterRetries);
    }

    prompter.printSuccess(s.userRegistered(ids.length));
    return ids;
  }

  // Unreachable
  throw new Error('User ID collection failed.');
}

// ── Persistence ──

async function persistSetupValues(
  prompter: SetupPrompter,
  s: SetupStrings,
  dataDir: string,
  botToken: string,
  appToken: string,
  userIds: string[],
): Promise<void> {
  // Initialize DB
  const { initDatabase, getDb, closeDatabase } = await import('../store/database.js');
  try {
    initDatabase(dataDir);
  } catch (err) {
    throw new Error(s.dbInitFailed(dataDir, errorMessage(err)));
  }

  // Guard: close DB on SIGINT during the persistence window
  const sigintHandler = (): void => {
    closeDatabase();
    process.exit(130);
  };
  process.once('SIGINT', sigintHandler);

  try {
    const db = getDb();
    const configStore = new ConfigStore(db);

    // Check keychain availability
    const { getKeychainProvider } = await import('../utils/keychain.js');
    const keychain = getKeychainProvider();
    const keychainAvailable = await keychain.isAvailable();

    let keychainUsed = false;
    const savedKeychainKeys: string[] = [];

    try {
      if (keychainAvailable) {
        // Order: keychain first, then DB.
        // Rationale: If DB transaction fails after keychain writes, the ghost
        // keychain values are harmless — loadConfig() won't find them because
        // no keychain_ref exists in DB. The reverse (DB first, keychain fails)
        // would leave dangling keychain_ref entries that cause loadConfig() to
        // resolve null and throw at runtime.
        await keychain.setPassword('SLACK_BOT_TOKEN', botToken);
        savedKeychainKeys.push('SLACK_BOT_TOKEN');

        await keychain.setPassword('SLACK_APP_TOKEN', appToken);
        savedKeychainKeys.push('SLACK_APP_TOKEN');

        configStore.transaction(() => {
          configStore.setKeychainRef('SLACK_BOT_TOKEN');
          configStore.setKeychainRef('SLACK_APP_TOKEN');
          configStore.setDbValue('ALLOWED_USER_IDS', userIds.join(','));
        });

        keychainUsed = true;
      } else {
        // Fallback: store tokens in DB (less secure)
        prompter.printWarning(s.keychainUnavailableWarning);
        prompter.printWarning(s.keychainInstallHint);
        prompter.printWarning(s.keychainRerunHint);

        configStore.transaction(() => {
          configStore.setDbValue('SLACK_BOT_TOKEN', botToken);
          configStore.setDbValue('SLACK_APP_TOKEN', appToken);
          configStore.setDbValue('ALLOWED_USER_IDS', userIds.join(','));
        });
      }

      // Clear welcome DM flag so the next `huskygate start` sends the welcome message
      configStore.deleteMetadata(WELCOME_DM_SENT_KEY);
    } catch (err) {
      // Rollback: remove any keychain entries that were written
      for (const key of savedKeychainKeys) {
        try {
          await keychain.deletePassword(key);
        } catch {
          // Best effort cleanup
        }
      }
      throw new Error(s.saveFailed(errorMessage(err)));
    }

    // ── Completion summary ──
    prompter.printInfo('');
    prompter.printInfo(s.completeTitle);
    prompter.printInfo('');

    const storageLabel = keychainUsed ? `${keychain.platform} Keychain` : 'config database';
    prompter.printSuccess(s.botTokenSaved(storageLabel));
    prompter.printSuccess(s.appTokenSaved(storageLabel));
    prompter.printSuccess(s.allowedUsersSaved);
    prompter.printInfo('');
    prompter.printInfo(s.nextStepStart);
    prompter.printInfo('');
    prompter.printInfo('  huskygate start');
    prompter.printInfo('');
    prompter.printInfo(s.nextStepDashboard);
    prompter.printInfo('');
    prompter.printInfo('  huskygate dashboard start');
  } finally {
    process.removeListener('SIGINT', sigintHandler);
    closeDatabase();
  }
}

// ── Reset ──

async function resetSetup(dataDir: string): Promise<void> {
  const s = getStrings();
  const prompter = createSetupPrompter();
  try {
    const complete = await isSetupComplete(dataDir);
    if (!complete) {
      prompter.printInfo(s.resetNoState);
      return;
    }

    const confirmed = await prompter.confirm(s.resetConfirm);
    if (!confirmed) {
      prompter.printInfo(s.resetCancelled);
      return;
    }

    // Remove from keychain (best effort)
    const keychainErrors: string[] = [];
    try {
      const { getKeychainProvider } = await import('../utils/keychain.js');
      const keychain = getKeychainProvider();
      if (await keychain.isAvailable()) {
        await keychain.deletePassword('SLACK_BOT_TOKEN');
        await keychain.deletePassword('SLACK_APP_TOKEN');
      }
    } catch (err) {
      keychainErrors.push(errorMessage(err));
    }

    // Remove from DB (config entries + welcome DM metadata)
    const dbErrors: string[] = [];
    try {
      await withConfigDbWrite(dataDir, (db) => {
        db.prepare(
          `DELETE FROM config WHERE key IN (${SETUP_CONFIG_KEYS.map(() => '?').join(',')})`,
        ).run(...SETUP_CONFIG_KEYS);
        db.prepare('DELETE FROM metadata WHERE key = ?').run(WELCOME_DM_SENT_KEY);
      });
    } catch (err) {
      dbErrors.push(errorMessage(err));
    }

    // Report partial failures
    if (keychainErrors.length > 0) {
      prompter.printWarning(s.resetKeychainFailed(keychainErrors.join('; ')));
    }
    if (dbErrors.length > 0) {
      prompter.printWarning(s.resetDbFailed(dbErrors.join('; ')));
    }

    if (keychainErrors.length === 0 && dbErrors.length === 0) {
      prompter.printSuccess(s.resetSuccess);
    } else {
      prompter.printWarning(s.resetPartial);
    }
    prompter.printInfo(s.resetRerunHint);
  } catch (err) {
    if (err instanceof SetupCancelledError) {
      prompter.printInfo(`\n  ${s.resetCancelled}`);
      return;
    }
    throw err;
  } finally {
    prompter.close();
  }
}
