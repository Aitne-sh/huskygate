/**
 * Coverage tests for settings-api — covers all uncovered branches.
 * Targets: keychain-status GET, settings apply with various key types,
 * SKILL_ENABLED env keys, rejected keys, HOT_PROCESS_ENV_KEYS, etc.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  getKeychainProvider: vi.fn(() => ({
    isAvailable: vi.fn(async () => true),
    platform: 'test',
  })),
}));

vi.mock('../../utils/keychain.js', () => ({
  getKeychainProvider: mocked.getKeychainProvider,
}));

import type { AppContext } from '../../context/app-context.js';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import { createInvoker } from './_test-utils.js';
import { handleSettingsApiRoutes, matchesSettingsApiPath } from './settings-api.js';

const invoke = createInvoker(handleSettingsApiRoutes as Parameters<typeof createInvoker>[0]);

function ctx(): AppContext {
  return makeTestAppContext();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('settings-api coverage', () => {
  it('matchesSettingsApiPath', () => {
    expect(matchesSettingsApiPath('/api/settings/keychain-status')).toBe(true);
    expect(matchesSettingsApiPath('/api/settings/apply')).toBe(true);
    expect(matchesSettingsApiPath('/api/other')).toBe(false);
  });

  // ── GET /api/settings/keychain-status ──
  it('GET keychain-status', async () => {
    const r = await invoke(ctx(), {
      method: 'GET',
      path: '/api/settings/keychain-status',
    });
    expect(r.status).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(body.available).toBe(true);
    expect(body.platform).toBe('test');
  });

  // ── POST /api/settings/apply — invalid JSON ──
  it('POST apply 400 invalid JSON', async () => {
    const r = await invoke(ctx(), {
      method: 'POST',
      path: '/api/settings/apply',
    });
    expect(r.status).toBe(400);
  });

  // ── POST /api/settings/apply — missing values ──
  it('POST apply 400 missing values', async () => {
    const r = await invoke(ctx(), {
      method: 'POST',
      path: '/api/settings/apply',
      body: {},
    });
    expect(r.status).toBe(400);
    expect((r.body as Record<string, string>).error).toBe('values object required');
  });

  // ── POST /api/settings/apply — values is not object ──
  it('POST apply 400 values not object', async () => {
    const r = await invoke(ctx(), {
      method: 'POST',
      path: '/api/settings/apply',
      body: { values: 'string' },
    });
    expect(r.status).toBe(400);
  });

  // ── POST /api/settings/apply — LOG_LEVEL valid ──
  it('POST apply LOG_LEVEL valid', async () => {
    const r = await invoke(ctx(), {
      method: 'POST',
      path: '/api/settings/apply',
      body: { values: { LOG_LEVEL: 'debug' } },
    });
    expect(r.status).toBe(200);
    const body = r.body as Record<string, string[]>;
    expect(body.applied).toContain('LOG_LEVEL');
  });

  // ── POST /api/settings/apply — LOG_LEVEL invalid ──
  it('POST apply LOG_LEVEL invalid', async () => {
    const r = await invoke(ctx(), {
      method: 'POST',
      path: '/api/settings/apply',
      body: { values: { LOG_LEVEL: 'bad' } },
    });
    expect(r.status).toBe(200);
    const body = r.body as Record<string, string[]>;
    expect(body.rejected).toContain('LOG_LEVEL');
  });

  // ── POST /api/settings/apply — MAX_CONCURRENCY valid ──
  it('POST apply MAX_CONCURRENCY valid', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'POST',
      path: '/api/settings/apply',
      body: { values: { MAX_CONCURRENCY: '5' } },
    });
    expect(r.status).toBe(200);
    expect((r.body as Record<string, string[]>).applied).toContain('MAX_CONCURRENCY');
    expect(c.config.maxConcurrency).toBe(5);
  });

  // ── POST /api/settings/apply — MAX_CONCURRENCY invalid ──
  it('POST apply MAX_CONCURRENCY invalid', async () => {
    const r = await invoke(ctx(), {
      method: 'POST',
      path: '/api/settings/apply',
      body: { values: { MAX_CONCURRENCY: 'abc' } },
    });
    expect((r.body as Record<string, string[]>).rejected).toContain('MAX_CONCURRENCY');
  });

  // ── POST /api/settings/apply — MAX_RUNTIME_SEC ──
  it('POST apply MAX_RUNTIME_SEC valid', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'POST',
      path: '/api/settings/apply',
      body: { values: { MAX_RUNTIME_SEC: '1800' } },
    });
    expect((r.body as Record<string, string[]>).applied).toContain('MAX_RUNTIME_SEC');
    expect(c.config.maxRuntimeSec).toBe(1800);
  });

  it('POST apply MAX_RUNTIME_SEC invalid', async () => {
    const r = await invoke(ctx(), {
      method: 'POST',
      path: '/api/settings/apply',
      body: { values: { MAX_RUNTIME_SEC: '0' } },
    });
    expect((r.body as Record<string, string[]>).rejected).toContain('MAX_RUNTIME_SEC');
  });

  // ── POST /api/settings/apply — NO_OUTPUT_TIMEOUT_SEC ──
  it('POST apply NO_OUTPUT_TIMEOUT_SEC valid', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'POST',
      path: '/api/settings/apply',
      body: { values: { NO_OUTPUT_TIMEOUT_SEC: '120' } },
    });
    expect((r.body as Record<string, string[]>).applied).toContain('NO_OUTPUT_TIMEOUT_SEC');
    expect(c.config.noOutputTimeoutSec).toBe(120);
  });

  it('POST apply NO_OUTPUT_TIMEOUT_SEC invalid', async () => {
    const r = await invoke(ctx(), {
      method: 'POST',
      path: '/api/settings/apply',
      body: { values: { NO_OUTPUT_TIMEOUT_SEC: '-1' } },
    });
    expect((r.body as Record<string, string[]>).rejected).toContain('NO_OUTPUT_TIMEOUT_SEC');
  });

  // ── POST /api/settings/apply — TOOL_AUTO_APPROVE_MODE ──
  it('POST apply TOOL_AUTO_APPROVE_MODE', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'POST',
      path: '/api/settings/apply',
      body: { values: { TOOL_AUTO_APPROVE_MODE: 'true' } },
    });
    expect((r.body as Record<string, string[]>).applied).toContain('TOOL_AUTO_APPROVE_MODE');
    expect(c.config.toolAutoApproveMode).toBe(true);
  });

  // ── POST /api/settings/apply — HUSKYGATE_LOG_STACKS ──
  it('POST apply HUSKYGATE_LOG_STACKS', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'POST',
      path: '/api/settings/apply',
      body: { values: { HUSKYGATE_LOG_STACKS: 'true' } },
    });
    expect((r.body as Record<string, string[]>).applied).toContain('HUSKYGATE_LOG_STACKS');
    expect(c.config.logStacks).toBe(true);
  });

  // ── POST /api/settings/apply — unknown key rejected ──
  it('POST apply unknown key rejected', async () => {
    const r = await invoke(ctx(), {
      method: 'POST',
      path: '/api/settings/apply',
      body: { values: { UNKNOWN_KEY: 'value' } },
    });
    expect((r.body as Record<string, string[]>).rejected).toContain('UNKNOWN_KEY');
  });

  // ── POST /api/settings/apply — non-string value rejected ──
  it('POST apply non-string value rejected', async () => {
    const r = await invoke(ctx(), {
      method: 'POST',
      path: '/api/settings/apply',
      body: { values: { LOG_LEVEL: 123 } },
    });
    expect((r.body as Record<string, string[]>).rejected).toContain('LOG_LEVEL');
  });

  // ── POST /api/settings/apply — HOT_PROCESS_ENV_KEYS (skill env vars) ──
  it('POST apply PERPLEXITY_API_KEY sets process.env', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'POST',
      path: '/api/settings/apply',
      body: { values: { PERPLEXITY_API_KEY: 'pplx-test' } },
    });
    expect((r.body as Record<string, string[]>).applied).toContain('PERPLEXITY_API_KEY');
    expect(process.env.PERPLEXITY_API_KEY).toBe('pplx-test');
    delete process.env.PERPLEXITY_API_KEY;
  });

  // ── POST /api/settings/apply — HOT_PROCESS_ENV_KEYS with empty value deletes env ──
  it('POST apply env key with empty value deletes from env', async () => {
    process.env.PERPLEXITY_API_KEY = 'pplx-test';
    const c = ctx();
    const r = await invoke(c, {
      method: 'POST',
      path: '/api/settings/apply',
      body: { values: { PERPLEXITY_API_KEY: '' } },
    });
    expect((r.body as Record<string, string[]>).applied).toContain('PERPLEXITY_API_KEY');
    expect(process.env.PERPLEXITY_API_KEY).toBeUndefined();
  });

  // ── POST /api/settings/apply — another HOT_PROCESS_ENV_KEYS skill key ──
  it('POST apply another hot skill env key', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'POST',
      path: '/api/settings/apply',
      body: { values: { AWS_DEFAULT_REGION: 'us-west-2' } },
    });
    expect((r.body as Record<string, string[]>).applied).toContain('AWS_DEFAULT_REGION');
    expect(process.env.AWS_DEFAULT_REGION).toBe('us-west-2');
    delete process.env.AWS_DEFAULT_REGION;
  });

  // ── unmatched path returns false ──
  it('unmatched path returns false', async () => {
    const r = await invoke(ctx(), {
      method: 'GET',
      path: '/api/other',
    });
    expect(r.handled).toBe(false);
  });
});
