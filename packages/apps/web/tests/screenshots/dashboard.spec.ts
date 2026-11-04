import { test, expect } from '@playwright/test';

// Minimal stub data used by routes
const user = {
  id: 'user_1',
  email: 'qa@postolio.example',
  theme: 'light',
  weekStart: 'monday',
};

const brands = [
  {
    id: 'brand_1',
    name: 'Tech Startup',
    description: 'Innovative tech solutions',
    userId: user.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'brand_2',
    name: 'Lifestyle Brand',
    description: 'Modern lifestyle products',
    userId: user.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const content = [
  {
    id: 'content_1',
    brandId: 'brand_1',
    caption: 'Exciting product launch coming soon!',
    status: 'scheduled',
    scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'content_2',
    brandId: 'brand_1',
    caption: 'Check out our latest innovation',
    status: 'published',
    scheduledAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    postedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'content_3',
    brandId: 'brand_2',
    caption: 'Summer vibes are here',
    status: 'scheduled',
    scheduledAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'content_4',
    brandId: 'brand_2',
    caption: 'Get ready for summer',
    status: 'published',
    scheduledAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    postedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'content_5',
    brandId: 'brand_1',
    caption: 'Building our brand story',
    status: 'published',
    scheduledAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    postedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

async function stubApi(page: import('@playwright/test').Page) {
  await page.route('**/api/onboarding/status', (route) =>
    route.fulfill({ json: { status: 'complete' } })
  );
  await page.route('**/api/auth/refresh', (route) => route.fulfill({ json: { user } }));
  await page.routeWebSocket('**/ws', () => {});
  // CSRF token
  await page.route('**/api/csrf-token', async (route) => {
    await route.fulfill({ json: { token: 'devtoken', expiresInMs: 3600_000 } });
  });

  // Auth profile
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ json: { user } });
  });

  // Brands
  await page.route('**/api/brands**', async (route) => {
    await route.fulfill({ json: { brands } });
  });

  // Content history for brands
  await page.route('**/api/brands/*/content/history**', async (route) => {
    const url = route.request().url();
    const brandId = url.match(/brands\/([^\/]+)\/content/)?.[1];
    const brandContent = content.filter((c) => c.brandId === brandId);
    await route.fulfill({ json: { content: brandContent } });
  });

  // Content calendar
  await page.route('**/api/brands/*/content/calendar**', async (route) => {
    const url = route.request().url();
    const brandId = url.match(/brands\/([^\/]+)\/content/)?.[1];
    const brandContent = content.filter((c) => c.brandId === brandId);
    await route.fulfill({ json: { data: { content: brandContent, placeholders: [] } } });
  });
}

test('capture dashboard', async ({ page, baseURL }, testInfo) => {
  await stubApi(page);

  await page.goto(baseURL! + '/dashboard');
  await page.waitForLoadState('networkidle');

  // Wait for brands to load
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Account menu' }).hover();
  await expect(page.getByText('Tech Startup', { exact: true })).toBeVisible();

  // Ensure layout settled
  await page.waitForTimeout(500);

  await page.screenshot({
    path: testInfo.outputPath('dashboard.png'),
    fullPage: true,
  });
});
