import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:process';

const require = createRequire(import.meta.url);

const PLATFORM_BIN = {
  darwin: {
    x64: '@biomejs/cli-darwin-x64/biome',
    arm64: '@biomejs/cli-darwin-arm64/biome',
  },
  linux: {
    x64: '@biomejs/cli-linux-x64/biome',
    arm64: '@biomejs/cli-linux-arm64/biome',
  },
  win32: {
    x64: '@biomejs/cli-win32-x64/biome.exe',
    arm64: '@biomejs/cli-win32-arm64/biome.exe',
  },
};

const packagePath = PLATFORM_BIN[platform]?.[arch];

if (!packagePath) {
  console.error(`Unsupported platform for Biome: ${platform}/${arch}`);
  process.exit(1);
}

let binaryPath;
try {
  binaryPath = require.resolve(packagePath);
} catch {
  const packageName = packagePath.split('/').slice(0, 2).join('/');
  console.error(`Missing Biome binary package for ${platform}/${arch}: ${packageName}`);
  console.error(`Install with: npm install -D ${packageName}@1.9.4`);
  process.exit(1);
}

const result = spawnSync(binaryPath, process.argv.slice(2), {
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Failed to run Biome: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
