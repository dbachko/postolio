import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for WebSocket and E2E testing
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // WebSocket tests should run sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1, // Single worker for WebSocket tests
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true, // For local self-signed certificates

    // Extended timeout for WebSocket operations
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    // Mobile testing for WebSocket behavior
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  webServer: process.env.CI
    ? {
        // In CI, run both services from root using pnpm workspace commands
        command: 'cd ../../../ && pnpm dev --filter=api --filter=@postolio/web',
        port: 5173,
        reuseExistingServer: false,
        timeout: 120 * 1000,
        env: {
          ...process.env,
          CI: 'true',
          NODE_ENV: 'dev',
        },
      }
    : {
        // Local: build then serve static dist via http-server for stability
        command: 'npm run build && npx --yes http-server ./dist -p 5173 -a 127.0.0.1 -c-1',
        port: 5173,
        reuseExistingServer: true,
        timeout: 180 * 1000,
        env: {
          ...process.env,
          E2E: '1',
          CI: 'true',
        },
      },
});
