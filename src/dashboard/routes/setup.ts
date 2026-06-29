/** @module dashboard/routes/setup — Dashboard setup wizard route + API endpoints. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { generateManifestUrl } from '../../setup/manifest.js';
import {
  validateAppTokenFormat,
  validateAppTokenLive,
  validateBotTokenFormat,
  validateBotTokenLive,
  validateUserIdFormat,
} from '../../setup/token-validator.js';
import type { ConfigStore } from '../../store/config-store.js';
import { errorMessage } from '../../utils/error.js';
import { getKeychainProvider } from '../../utils/keychain.js';
import { dashLog, json, parseJson, readBody } from '../http.js';
import type { RouteContext } from '../route-context.js';
import { renderSetupPage } from '../scripts/setup.js';
import { createDashboardResolver } from '../settings-service.js';

// ── Setup status detection ──

/** All keys that must be resolved for setup to be considered complete. */
const SETUP_REQUIRED_KEYS = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'] as const;

export async function isSetupComplete(configStore: ConfigStore, dataDir: string): Promise<boolean> {
  const { resolver } = await createDashboardResolver(configStore, dataDir);
  return SETUP_REQUIRED_KEYS.every((key) => {
    const value = resolver.get(key).value;
    return value !== null && value.trim().length > 0;
  });
}

// ── Request/Response types ──

interface SetupCompleteBody {
  botToken?: string;
  appToken?: string;
  allowedUserIds?: string;
  force?: boolean;
}

interface SetupError {
  field: string;
  message: string;
}

// ── Route handler ──

export async function handleSetupRoutes(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  _query: URLSearchParams,
): Promise<boolean> {
  // GET /setup — serve the setup wizard HTML page
  if (req.method === 'GET' && pathname === '/setup') {
    const manifestUrl = generateManifestUrl();
    const html = renderSetupPage({ manifestUrl });
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(html);
    return true;
  }

  // GET /api/setup/status — check if setup is complete
  if (req.method === 'GET' && pathname === '/api/setup/status') {
    const configStore = ctx.getDb().config;
    const complete = await isSetupComplete(configStore, ctx.dataDir);
    json(res, 200, { complete });
    return true;
  }

  // POST /api/setup/complete — validate tokens and persist
  if (req.method === 'POST' && pathname === '/api/setup/complete') {
    const body = await readBody(req);
    const parsed = parseJson<SetupCompleteBody>(body);
    if (!parsed) {
      json(res, 400, { ok: false, errors: [{ field: '_', message: 'Invalid JSON' }] });
      return true;
    }

    const { botToken, appToken, allowedUserIds, force } = parsed;

    // ── Overwrite guard: require force: true when already configured ──
    const configStore = ctx.getDb().config;
    const alreadyComplete = await isSetupComplete(configStore, ctx.dataDir);
    if (alreadyComplete && force !== true) {
      json(res, 409, {
        ok: false,
        errors: [
          {
            field: '_',
            message:
              'Setup is already complete. Send force: true to overwrite existing configuration.',
          },
        ],
      });
      return true;
    }

    const errors: SetupError[] = [];

    // ── Format validation ──
    if (typeof botToken !== 'string' || !botToken) {
      errors.push({ field: 'botToken', message: 'Bot Token is required' });
    } else {
      const fmt = validateBotTokenFormat(botToken);
      if (!fmt.valid) {
        errors.push({ field: 'botToken', message: fmt.error ?? '' });
      }
    }

    if (typeof appToken !== 'string' || !appToken) {
      errors.push({ field: 'appToken', message: 'App Token is required' });
    } else {
      const fmt = validateAppTokenFormat(appToken);
      if (!fmt.valid) {
        errors.push({ field: 'appToken', message: fmt.error ?? '' });
      }
    }

    // Allowed User IDs: optional but validated if provided
    let parsedUserIds: string[] = [];
    if (typeof allowedUserIds === 'string' && allowedUserIds.trim().length > 0) {
      parsedUserIds = allowedUserIds
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);

      for (const id of parsedUserIds) {
        const result = validateUserIdFormat(id);
        if (!result.valid) {
          errors.push({ field: 'allowedUserIds', message: `${id}: ${result.error}` });
        }
      }
    }

    if (errors.length > 0) {
      json(res, 400, { ok: false, errors });
      return true;
    }

    // ── Live validation ──
    const liveErrors: SetupError[] = [];

    const validBotToken = botToken as string;
    const validAppToken = appToken as string;

    const botLive = await validateBotTokenLive(validBotToken);
    if (!botLive.valid) {
      liveErrors.push({ field: 'botToken', message: botLive.error ?? '' });
    }

    const appLive = await validateAppTokenLive(validAppToken);
    if (!appLive.valid) {
      liveErrors.push({ field: 'appToken', message: appLive.error ?? '' });
    }

    if (liveErrors.length > 0) {
      json(res, 400, { ok: false, errors: liveErrors });
      return true;
    }

    // ── Persist ──
    try {
      const storage = await persistSetupTokens(ctx, validBotToken, validAppToken, parsedUserIds);

      dashLog('info', 'setup_complete', {
        botTokenStorage: storage.botToken,
        appTokenStorage: storage.appToken,
      });

      json(res, 200, { ok: true, storage });
    } catch (err) {
      dashLog('error', 'setup_persist_error', { error: errorMessage(err) });
      json(res, 500, {
        ok: false,
        errors: [{ field: '_', message: `Failed to save configuration: ${errorMessage(err)}` }],
      });
    }
    return true;
  }

  return false;
}

// ── Persistence (reuses settings-service patterns) ──

async function persistSetupTokens(
  ctx: RouteContext,
  botToken: string,
  appToken: string,
  userIds: string[],
): Promise<{ botToken: string; appToken: string; allowedUserIds: string }> {
  const configStore = ctx.getDb().config;
  const keychain = getKeychainProvider();
  const keychainAvailable = await keychain.isAvailable();

  const savedKeychainKeys: string[] = [];

  try {
    if (keychainAvailable) {
      // Keychain-first: write secrets to keychain, then refs to DB
      await keychain.setPassword('SLACK_BOT_TOKEN', botToken);
      savedKeychainKeys.push('SLACK_BOT_TOKEN');

      await keychain.setPassword('SLACK_APP_TOKEN', appToken);
      savedKeychainKeys.push('SLACK_APP_TOKEN');

      configStore.transaction(() => {
        configStore.setKeychainRef('SLACK_BOT_TOKEN');
        configStore.setKeychainRef('SLACK_APP_TOKEN');
        if (userIds.length > 0) {
          configStore.setDbValue('ALLOWED_USER_IDS', userIds.join(','));
        } else {
          configStore.delete('ALLOWED_USER_IDS');
        }
      });

      return {
        botToken: 'keychain',
        appToken: 'keychain',
        allowedUserIds: 'db',
      };
    }

    // Fallback: store in DB
    configStore.transaction(() => {
      configStore.setDbValue('SLACK_BOT_TOKEN', botToken);
      configStore.setDbValue('SLACK_APP_TOKEN', appToken);
      if (userIds.length > 0) {
        configStore.setDbValue('ALLOWED_USER_IDS', userIds.join(','));
      } else {
        configStore.delete('ALLOWED_USER_IDS');
      }
    });

    return {
      botToken: 'db',
      appToken: 'db',
      allowedUserIds: 'db',
    };
  } catch (err) {
    // Rollback keychain entries on failure
    for (const key of savedKeychainKeys) {
      try {
        await keychain.deletePassword(key);
      } catch {
        // Best-effort cleanup
      }
    }
    throw err;
  }
}
