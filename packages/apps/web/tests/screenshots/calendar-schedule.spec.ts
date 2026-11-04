import { test, expect } from '@playwright/test';

const user = { id: 'user_qa', email: 'qa@postolio.example', theme: 'light', weekStart: 'monday' };
const brand = {
  id: 'brand_qa',
  name: 'QA Brand',
  description: 'For UI tests',
  userId: user.id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const now = new Date('2026-11-15T12:00:00');
const today10 = new Date(
  now.getFullYear(),
  now.getMonth(),
  now.getDate(),
  10,
  0,
  0,
  0
).toISOString();
const yesterday10 = new Date(
  now.getFullYear(),
  now.getMonth(),
  now.getDate() - 1,
  10,
  0,
  0,
  0
).toISOString();
const tomorrow10 = new Date(
  now.getFullYear(),
  now.getMonth(),
  now.getDate() + 1,
  10,
  0,
  0,
  0
).toISOString();

const content = [
  {
    id: 'past1',
    brandId: brand.id,
    caption: 'PastOne',
    status: 'published',
    scheduledAt: yesterday10,
    postedAt: yesterday10,
  },
  {
    id: 'today1',
    brandId: brand.id,
    caption: 'TodayOne',
    status: 'scheduled',
    scheduledAt: today10,
  },
  {
    id: 'future1',
    brandId: brand.id,
    caption: 'FutureOne',
    status: 'scheduled',
    scheduledAt: tomorrow10,
  },
];

async function stubApi(page: import('@playwright/test').Page) {
  await page.route('**/api/onboarding/status', (route) =>
    route.fulfill({ json: { status: 'complete' } })
  );
  await page.route('**/api/auth/refresh', (route) => route.fulfill({ json: { user } }));
  await page.routeWebSocket('**/ws', () => {});
  await page.route('**/api/csrf-token', (route) =>
    route.fulfill({ json: { token: 'dev', expiresInMs: 3600_000 } })
  );
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user } }));
  await page.route('**/api/brands**', (route) => route.fulfill({ json: { brands: [brand] } }));
  await page.route('**/api/brands/*/content/calendar**', (route) =>
    route.fulfill({ json: { data: { content, placeholders: [] } } })
  );
  await page.route('**/api/brands/*/calendar/**', (route) =>
    route.fulfill({ json: { data: { content, placeholders: [] } } })
  );
}

test('retired schedule view falls back to the month view with visible content', async ({
  page,
  baseURL,
}, testInfo) => {
  await page.clock.setFixedTime(now);
  await stubApi(page);
  await page.addInitScript((b) => {
    localStorage.removeItem('calendar-filters');
    localStorage.setItem('brand-storage', JSON.stringify({ state: { selectedBrand: b } }));
  }, brand);
  await page.goto(baseURL! + '/content?view=schedule');
  await page.waitForLoadState('networkidle');

  await expect(page.locator('.pc-week-row').first()).toBeVisible();
  await expect(page.getByText('PastOne', { exact: true })).toBeVisible();
  await expect(page.getByText('TodayOne', { exact: true })).toBeVisible();
  await expect(page.getByText('FutureOne', { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('calendar-month-fallback.png'),
    fullPage: true,
  });
});
