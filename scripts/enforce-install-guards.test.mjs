import { describe, expect, it } from 'vitest';
import {
  BETTER_SQLITE3_SOURCE_BUILD_VALUE,
  validateInstallGuards,
} from './enforce-install-guards.mjs';

describe('validateInstallGuards', () => {
  it('accepts better-sqlite3 package-specific source build config', () => {
    expect(
      validateInstallGuards({
        npm_config_build_from_source: BETTER_SQLITE3_SOURCE_BUILD_VALUE,
      }),
    ).toEqual({ ok: true });
  });

  it('accepts global build-from-source config', () => {
    expect(
      validateInstallGuards({
        npm_config_build_from_source: 'true',
      }),
    ).toEqual({ ok: true });
  });

  it('rejects installs that do not force source builds', () => {
    const result = validateInstallGuards({
      npm_config_build_from_source: '',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('npm run deps:install');
    expect(result.error).toContain('better-sqlite3');
  });
});
