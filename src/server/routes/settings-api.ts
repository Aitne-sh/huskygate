/** @module server/routes/settings-api — Server API routes for hot-reloading settings at runtime. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HOT_PROCESS_ENV_KEYS, type LogLevel, RUNTIME_MUTABLE_KEYS } from '../../config.js';
import type { AppContext } from '../../context/app-context.js';
import { json, readBody } from '../../shared/http.js';
import { logger, setLogLevel, setShowStacks } from '../../utils/logger.js';

const VALID_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

export function matchesSettingsApiPath(pathname: string): boolean {
  return pathname === '/api/settings/keychain-status' || pathname === '/api/settings/apply';
}

export async function handleSettingsApiRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  // GET /api/settings/keychain-status — check keychain availability
  if (req.method === 'GET' && pathname === '/api/settings/keychain-status') {
    const { getKeychainProvider } = await import('../../utils/keychain.js');
    const kc = getKeychainProvider();
    const available = await kc.isAvailable();
    json(res, 200, { available, platform: kc.platform });
    return true;
  }

  // POST /api/settings/apply — hot-reload runtime-mutable settings
  if (req.method === 'POST' && pathname === '/api/settings/apply') {
    const body = await readBody(req);
    let parsed: { values?: Record<string, string> };
    try {
      parsed = JSON.parse(body) as { values?: Record<string, string> };
    } catch {
      logger.debug('api_invalid_json', { endpoint: '/api/settings/apply' });
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    if (!parsed.values || typeof parsed.values !== 'object') {
      json(res, 400, { error: 'values object required' });
      return true;
    }
    const applied: string[] = [];
    const rejected: string[] = [];
    for (const [key, value] of Object.entries(parsed.values)) {
      if (typeof value !== 'string') {
        rejected.push(key);
        continue;
      }
      if (HOT_PROCESS_ENV_KEYS.has(key)) {
        if (value) {
          process.env[key] = value;
        } else {
          delete process.env[key];
        }
        applied.push(key);
        continue;
      }
      if (!RUNTIME_MUTABLE_KEYS.has(key)) {
        rejected.push(key);
        continue;
      }
      switch (key) {
        case 'LOG_LEVEL':
          if (VALID_LOG_LEVELS.has(value)) {
            setLogLevel(value as LogLevel);
            applied.push(key);
          } else {
            rejected.push(key);
          }
          break;
        case 'MAX_CONCURRENCY': {
          const n = Number.parseInt(value, 10);
          if (!Number.isNaN(n) && n > 0) {
            ctx.config.maxConcurrency = n;
            applied.push(key);
          } else {
            rejected.push(key);
          }
          break;
        }
        case 'MAX_RUNTIME_SEC': {
          const n = Number.parseInt(value, 10);
          if (!Number.isNaN(n) && n > 0) {
            ctx.config.maxRuntimeSec = n;
            applied.push(key);
          } else {
            rejected.push(key);
          }
          break;
        }
        case 'NO_OUTPUT_TIMEOUT_SEC': {
          const n = Number.parseInt(value, 10);
          if (!Number.isNaN(n) && n > 0) {
            ctx.config.noOutputTimeoutSec = n;
            applied.push(key);
          } else {
            rejected.push(key);
          }
          break;
        }
        case 'TOOL_AUTO_APPROVE_MODE':
          ctx.config.toolAutoApproveMode = value.toLowerCase() === 'true';
          applied.push(key);
          break;
        case 'HUSKYGATE_LOG_STACKS': {
          const enabled = value.toLowerCase() === 'true';
          ctx.config.logStacks = enabled;
          setShowStacks(enabled);
          applied.push(key);
          break;
        }
      }
    }
    logger.info('settings_hot_reload', { applied, rejected });
    json(res, 200, { applied, rejected });
    return true;
  }

  return false;
}
