import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Preinstall guard: blocks bare `npm install` / `npm ci` so that users
 * always go through `npm run deps:install`, which handles the two-phase
 * install (--ignore-scripts, then explicit rebuild with --build-from-source
 * for better-sqlite3).
 *
 * The guard is skipped when:
 *  - `--ignore-scripts` is active (Phase 1 of deps:install)
 *  - `HUSKYGATE_SKIP_INSTALL_GUARD=1` is set (CI or advanced use)
 *  - The legacy `npm_config_build_from_source` env var includes better-sqlite3
 */
export function validateInstallGuards(env = process.env) {
  // Phase 1 of deps:install passes --ignore-scripts; npm sets this env var.
  if (env.npm_config_ignore_scripts === 'true') {
    return { ok: true };
  }
  // Explicit opt-out for CI or custom workflows.
  if (env.HUSKYGATE_SKIP_INSTALL_GUARD === '1') {
    return { ok: true };
  }
  // Legacy compat: still accept the old env var.
  const raw = env.npm_config_build_from_source;
  if (raw === 'true' || (typeof raw === 'string' && raw.includes('better-sqlite3'))) {
    return { ok: true };
  }
  return {
    ok: false,
    error: [
      'HuskyGate requires source builds for better-sqlite3 to avoid trusting prebuilt native binaries fetched outside package-lock integrity.',
      'Re-run dependency installation with one of the following commands:',
      '  npm run deps:install',
    ].join('\n'),
  };
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
  const result = validateInstallGuards(process.env);
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
}
