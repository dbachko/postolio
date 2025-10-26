import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // Stub auth and related API calls
  await page.route('**/api/auth/me', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'user_123',
          email: 'user@example.com',
          name: 'Test User',
          instagramUsername: null,
          subscriptionTier: 'free',
          timezone: 'UTC',
          timezoneAutoDetected: true,
          theme: 'system',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
    });
  });
  await page.route('**/api/users/theme', (route) => route.fulfill({ status: 200, body: JSON.stringify({ success: true }) }));
  await page.route('**/api/users/timezone', (route) => route.fulfill({ status: 200, body: JSON.stringify({ success: true }) }));
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, body: JSON.stringify({}) }));

  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle' });

  // Open Appearance tab
  await page.getByRole('tab', { name: 'Appearance' }).click({ trial: false }).catch(async () => {
    await page.getByText('Appearance', { exact: true }).click();
  });
  await page.waitForTimeout(400);

  // Ensure output directory
  fs.mkdirSync('docs/screenshots', { recursive: true });

  // System
  await page.screenshot({ path: 'docs/screenshots/appearance-system.png', fullPage: true });

  // Light
  await page.locator('#appearance-light').click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'docs/screenshots/appearance-light.png', fullPage: true });

  // Dark
  await page.locator('#appearance-dark').click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'docs/screenshots/appearance-dark.png', fullPage: true });

  await browser.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
