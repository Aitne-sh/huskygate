/** @module token-validator — Slack token format + live validation for setup wizard. */

export interface ValidationResult {
  valid: boolean;
  error?: string;
  detail?: string;
}

// ── Format patterns ──

const BOT_TOKEN_PREFIX = 'xoxb-';
const APP_TOKEN_PREFIX = 'xapp-';
const BOT_TOKEN_MIN_LENGTH = 30;
const APP_TOKEN_MIN_LENGTH = 40;
const USER_ID_PATTERN = /^U[A-Z0-9]{8,}$/;
const LIVE_VALIDATION_TIMEOUT_MS = 10_000;

// ── Format validators ──

export function validateBotTokenFormat(token: string): ValidationResult {
  if (!token) {
    return { valid: false, error: 'Token is empty' };
  }
  if (!token.startsWith(BOT_TOKEN_PREFIX)) {
    return { valid: false, error: `Token must start with ${BOT_TOKEN_PREFIX}` };
  }
  if (token.length < BOT_TOKEN_MIN_LENGTH) {
    return {
      valid: false,
      error: `Token is too short (minimum ${BOT_TOKEN_MIN_LENGTH} characters)`,
    };
  }
  return { valid: true };
}

export function validateAppTokenFormat(token: string): ValidationResult {
  if (!token) {
    return { valid: false, error: 'Token is empty' };
  }
  if (!token.startsWith(APP_TOKEN_PREFIX)) {
    return { valid: false, error: `Token must start with ${APP_TOKEN_PREFIX}` };
  }
  if (token.length < APP_TOKEN_MIN_LENGTH) {
    return {
      valid: false,
      error: `Token is too short (minimum ${APP_TOKEN_MIN_LENGTH} characters)`,
    };
  }
  return { valid: true };
}

export function validateUserIdFormat(id: string): ValidationResult {
  if (!id) {
    return { valid: false, error: 'User ID is empty' };
  }
  if (!USER_ID_PATTERN.test(id)) {
    return {
      valid: false,
      error:
        'User ID must start with U followed by uppercase alphanumeric characters (e.g., U01ABCDEF)',
    };
  }
  return { valid: true };
}

// ── Live validators ──

/**
 * Validate a Bot Token by calling Slack's `auth.test` API.
 * Returns workspace name on success; gracefully degrades on network failure.
 */
export async function validateBotTokenLive(token: string): Promise<ValidationResult> {
  try {
    const resp = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      signal: AbortSignal.timeout(LIVE_VALIDATION_TIMEOUT_MS),
    });
    const data = (await resp.json()) as { ok: boolean; team?: string; error?: string };
    if (data.ok) {
      return { valid: true, detail: `Connected to workspace: ${data.team}` };
    }
    return { valid: false, error: `Slack API rejected the token: ${data.error}` };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return {
        valid: true,
        detail: 'Network timeout — format check passed, live verification skipped',
      };
    }
    return {
      valid: true,
      detail: 'Network unavailable — format check passed, live verification skipped',
    };
  }
}

/**
 * Validate an App Token by calling Slack's `apps.connections.open` API.
 *
 * Note: This call consumes a connection slot that auto-releases after ~30s idle.
 * The retry limit (3 per the setup flow) prevents slot exhaustion.
 */
export async function validateAppTokenLive(token: string): Promise<ValidationResult> {
  try {
    const resp = await fetch('https://slack.com/api/apps.connections.open', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      signal: AbortSignal.timeout(LIVE_VALIDATION_TIMEOUT_MS),
    });
    const data = (await resp.json()) as { ok: boolean; error?: string };
    if (data.ok) {
      return { valid: true, detail: 'Socket Mode connection verified' };
    }
    return { valid: false, error: `Slack API rejected the token: ${data.error}` };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return {
        valid: true,
        detail: 'Network timeout — format check passed, live verification skipped',
      };
    }
    return {
      valid: true,
      detail: 'Network unavailable — format check passed, live verification skipped',
    };
  }
}
