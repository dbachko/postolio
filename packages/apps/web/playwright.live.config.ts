import { defineConfig, devices } from '@playwright/test';

/**
 * Browser check against the already-running local stack (Vite on :5173,
 * API on :3000, assets API on :3002). Unlike playwright.config.ts, this
 * does not start `vite preview` and does not stub `/api`.
 */
export default defineConfig({
  testDir: './tests/live',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'line',
  timeout: 60_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
