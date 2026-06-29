import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/types.ts',
        'src/slack/app-types.ts',
        'src/index.ts',
        'src/cli.ts',
        'src/cli/banner.ts',
      ],
      reporter: ['text', 'json-summary', 'json'],
    },
  },
});
