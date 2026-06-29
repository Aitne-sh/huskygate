import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';

/**
 * Two-phase install strategy for npm 11+ compatibility:
 *
 * Phase 1: `npm ci --ignore-scripts` (or `npm install --ignore-scripts`)
 *   Installs ALL packages — including optionalDependencies like
 *   @img/sharp-darwin-arm64 — without running any lifecycle scripts.
 *   This avoids the dependency-ordering race where sharp's install/check.js
 *   runs before its platform-specific prebuilt binary is available.
 *
 * Phase 2: `npm rebuild better-sqlite3 --build-from-source`
 *   Explicitly builds better-sqlite3 from source (security policy).
 *   Then `npm rebuild` for the remaining packages (sharp, etc.) to
 *   execute their install scripts with all deps already in place.
 */

function npmCommand() {
  if (process.env.npm_execpath?.endsWith('.js')) {
    return { file: process.execPath, prefix: [process.env.npm_execpath] };
  }
  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return { file: cmd, prefix: [] };
}

function run(args, extraEnv = {}) {
  const { file, prefix } = npmCommand();
  const result = spawnSync(file, [...prefix, ...args], {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  return result.status ?? 1;
}

// Phase 1: install without scripts
const installCmd = process.argv.length > 2
  ? process.argv.slice(2)
  : [fs.existsSync('package-lock.json') ? 'ci' : 'install'];
const installStatus = run([...installCmd, '--ignore-scripts']);
if (installStatus !== 0) process.exit(installStatus);

// Phase 2: rebuild native addons (skip preinstall guard via env flag)
const guardBypass = { HUSKYGATE_SKIP_INSTALL_GUARD: '1' };

//   better-sqlite3: build from source (security policy — no prebuilt binaries)
const sqliteStatus = run(['rebuild', 'better-sqlite3', '--build-from-source'], guardBypass);
if (sqliteStatus !== 0) process.exit(sqliteStatus);

//   remaining packages (sharp, etc.): run their install scripts
const rebuildStatus = run(['rebuild'], guardBypass);
process.exit(rebuildStatus);
