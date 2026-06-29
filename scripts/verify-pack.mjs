/**
 * Verify that the npm package installs and runs correctly.
 *
 * Usage: node scripts/verify-pack.mjs
 *
 * Steps:
 *   1. npm pack → produces .tgz
 *   2. Install .tgz in an isolated temp directory
 *   3. Run `huskygate --version` and verify output
 *   4. Check that skills/ directory is present in the installed package
 *   5. Clean up
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
}

function fail(msg) {
  console.error(`\u2718 ${msg}`);
  process.exit(1);
}

function pass(msg) {
  console.log(`\u2714 ${msg}`);
}

// 1. Pack
console.log('\n--- npm pack ---');
const tgzName = run('npm pack', { cwd: ROOT });
const tgzPath = path.join(ROOT, tgzName);
if (!fs.existsSync(tgzPath)) fail(`Pack failed: ${tgzPath} not found`);
const tgzSize = fs.statSync(tgzPath).size;
pass(`Packed ${tgzName} (${(tgzSize / 1024).toFixed(0)} KB)`);

// 2. Install in temp dir
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-verify-'));
console.log(`\n--- Installing in ${tmpDir} ---`);
try {
  run(`npm init -y`, { cwd: tmpDir });
  run(`npm install "${tgzPath}"`, { cwd: tmpDir, timeout: 120_000 });
  pass('npm install succeeded');

  // 3. Run --version
  const binPath = path.join(tmpDir, 'node_modules', '.bin', 'huskygate');
  const version = run(`"${binPath}" --version`);
  if (version !== pkg.version) {
    fail(`Version mismatch: expected ${pkg.version}, got ${version}`);
  }
  pass(`huskygate --version → ${version}`);

  // 4. Verify skills directory
  const skillsDir = path.join(tmpDir, 'node_modules', 'huskygate', 'skills');
  if (!fs.existsSync(skillsDir)) fail('skills/ directory missing from installed package');
  const skills = fs.readdirSync(skillsDir);
  if (skills.length === 0) fail('skills/ directory is empty');
  pass(`skills/ present with ${skills.length} entries: ${skills.join(', ')}`);

  // 5. Verify dist directory
  const distDir = path.join(tmpDir, 'node_modules', 'huskygate', 'dist');
  if (!fs.existsSync(distDir)) fail('dist/ directory missing from installed package');
  const cliJs = path.join(distDir, 'cli.js');
  const shebang = fs.readFileSync(cliJs, 'utf8').slice(0, 30);
  if (!shebang.startsWith('#!/usr/bin/env node')) fail('cli.js missing shebang');
  pass('dist/cli.js has shebang');

  console.log('\n\u2714 All checks passed!\n');
} finally {
  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(tgzPath, { force: true });
}
