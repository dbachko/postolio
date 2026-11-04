import { expect, test, type Page } from '@playwright/test';

const email = process.env.DEV_SEED_EMAIL || 'dev@postolio.test';
const password = process.env.DEV_SEED_PASSWORD || 'Test123!@#';

const ERROR_BOUNDARY_TEXT = /something went wrong/i;

const ROUTES = [
  '/dashboard',
  '/content',
  '/drafts',
  '/posts/create',
  '/assets',
  '/series',
  '/recipes',
  '/runs',
  '/skills',
  '/analytics',
  '/brands',
  '/notifications',
  '/limits',
  '/social-accounts/publishing-schedule',
  '/settings/account',
  '/settings/appearance',
  '/settings/billing',
  '/settings/notifications',
  '/settings/security',
];

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/?$/);
}

test('main routes render without uncaught errors or server failures', async ({ page }) => {
  test.setTimeout(180_000);
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 500) {
      problems.push(`${response.status()} ${response.url()}`);
    }
  });

  await signIn(page);
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    if (!new URL(page.url()).pathname.startsWith(route)) {
      problems.push(`${route} redirected to ${new URL(page.url()).pathname}`);
    }
    if (ERROR_BOUNDARY_TEXT.test(await page.locator('body').innerText())) {
      problems.push(`${route} rendered an error boundary`);
    }
  }

  expect(problems).toEqual([]);
});
