import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/integration/**/*.integration.test.ts'],
    globalSetup: ['src/__tests__/integration/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/routes/**/*.ts', 'src/middleware/**/*.ts', 'src/services/**/*.ts', 'src/lib/audit.ts', 'src/lib/sanitize.ts', 'src/lib/session.ts', 'src/lib/notify.ts'],
      exclude: ['src/**/__tests__/**', 'src/server.ts', 'src/routes/index.ts'],
    },
  },
});
