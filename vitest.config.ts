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
        // Pure type-only modules — zero executable code after compilation.
        'src/context/app-types.ts',
        'src/context/context-slices.ts',
        'src/context/slack-client-surface.ts',
        'src/event/types.ts',
        'src/orchestrator/types.ts',
        'src/orchestrator/types-db.ts',
        'src/orchestrator/types-patch.ts',
        'src/queue/queue-store.ts',
        'src/server/notification-service.ts',
        'src/slack/app-types.ts',
      ],
      reporter: ['text', 'json-summary'],
    },
  },
});
