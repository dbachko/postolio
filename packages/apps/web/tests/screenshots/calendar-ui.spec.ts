import { test, expect } from '@playwright/test';

const user = {
  id: 'user_qa',
  email: 'qa@postolio.example',
  theme: 'light',
  weekStart: 'monday',
};

const brands = [
  {
    id: 'brand_qa',
    name: 'QA Brand',
    description: 'For UI tests',
    userId: user.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const now = new Date();
const addDays = (d: number) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, 10, 0, 0, 0).toISOString();
const content = [
  {
    id: 'c1',
    brandId: 'brand_qa',
    caption: 'Future post',
    status: 'scheduled',
    scheduledAt: addDays(2),
  },
  {
    id: 'c2',
    brandId: 'brand_qa',
    caption: 'Past post',
    status: 'published',
    scheduledAt: addDays(-1),
    postedAt: addDays(-1),
  },
];

async function stubApi(page: import('@playwright/test').Page) {
  await page.route('**/api/onboarding/status', (route) =>
    route.fulfill({ json: { status: 'complete' } })
  );
  await page.route('**/api/auth/refresh', (route) => route.fulfill({ json: { user } }));
  await page.routeWebSocket('**/ws', () => {});
  await page.route('**/api/csrf-token', async (route) =>
    route.fulfill({ json: { token: 'dev', expiresInMs: 3600_000 } })
  );
  await page.route('**/api/auth/me', async (route) => route.fulfill({ json: { user } }));
  await page.route('**/api/brands**', async (route) => route.fulfill({ json: { brands } }));
  await page.route('**/api/brands/*/content/calendar**', async (route) => {
    await route.fulfill({ json: { data: { content, placeholders: [] } } });
  });
  await page.route('**/api/brands/*/calendar/**', async (route) => {
    await route.fulfill({ json: { data: { content, placeholders: [] } } });
  });
}

test('calendar renders borders, past shading, and hover create button', async ({
  page,
  baseURL,
}) => {
  await stubApi(page);

  // Preselect brand via store persistence
  await page.addInitScript((brand) => {
    localStorage.setItem('brand-storage', JSON.stringify({ state: { selectedBrand: brand } }));
  }, brands[0]);

  await page.goto(baseURL! + '/content?view=month');
  await page.waitForLoadState('networkidle');

  // Month grid renders with week rows and day cells
  await expect(page.locator('.pc-week-row').first()).toBeVisible();
  // Pick a non-first cell to avoid :first-child border override
  const day = page.locator('.pc-week-row >> .pc-day').nth(1);
  await expect(day).toBeVisible();

  // Borders: at least week row shows a horizontal border
  const row = page.locator('.pc-week-row').nth(1);
  const rowBorderTop = await row.evaluate((el) => getComputedStyle(el).borderTopWidth);
  expect(parseInt(rowBorderTop || '0')).toBeGreaterThan(0);

  // Past-day shading exists
  const hasPast = await page.locator('.pc-day.pc-day--past').count();
  expect(hasPast).toBeGreaterThan(0);

  // Hover create CTA appears on a future day
  const futureDay = page.locator('.pc-day:not(.pc-day--past)').first();
  const box = await futureDay.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await futureDay.hover();
  }
  const cta = futureDay.locator('.pc-create-cta');
  await expect(cta).toBeVisible();
  // Optional: a screenshot can be captured here when running locally
});
