import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:4200';
const API_URL  = process.env.API_URL  || 'http://localhost:3333';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run start --prefix apps/api',
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npx ng serve --port 4200',
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      cwd: 'apps/web',
    },
  ],
});
