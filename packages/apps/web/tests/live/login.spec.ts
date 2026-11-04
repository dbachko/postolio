import { expect, test } from '@playwright/test';

const email = process.env.DEV_SEED_EMAIL || 'dev@postolio.test';
const password = process.env.DEV_SEED_PASSWORD || 'Test123!@#';

test.beforeAll(async ({ request }) => {
  const api = await request.get('http://127.0.0.1:3000/api/health');
  expect(api.ok(), 'API health').toBeTruthy();

  const assets = await request.get('http://127.0.0.1:3002/health');
  expect(assets.ok(), 'assets API health').toBeTruthy();
  const body = (await assets.json()) as { database?: string };
  expect(body.database).toBe('connected');
});

test('seeded user signs in and sees the dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard\/?$/);
  await expect(page.getByRole('button', { name: 'Account menu' })).toContainText('Dev Brand');
  await expect(page.getByText('Needs Attention', { exact: true })).toBeVisible();
});
