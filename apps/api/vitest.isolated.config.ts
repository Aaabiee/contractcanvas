import { defineConfig } from 'vitest/config';

/**
 * Isolated test config for tests that manipulate process.env or use
 * vi.resetModules(). These are incompatible with the main config's
 * singleFork pool because env changes leak across files.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.isolated.test.ts'],
    testTimeout: 30_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: false } },
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      all: false,
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/server.ts'],
    },
  },
});
