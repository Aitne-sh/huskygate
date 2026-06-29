import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

export default defineConfig({
  entry: { cli: 'src/cli.ts', index: 'src/index.ts' },
  format: ['esm'],
  clean: true,
  dts: { entry: { index: 'src/index.ts' } },
  minify: true,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  async onSuccess() {
    // Prepend shebang only to the CLI entry point (not index.js or chunks)
    const cliPath = 'dist/cli.js';
    const content = readFileSync(cliPath, 'utf8');
    writeFileSync(cliPath, `#!/usr/bin/env node\n${content}`);
    chmodSync(cliPath, '755'); // <-- Add executable permission
  },
});
