import { test, expect } from '@playwright/test';

const cases = [
  { brandTz: 'America/New_York', iso: '2025-01-16T04:31:00Z', expected: '11:31 PM' },
  { brandTz: 'Pacific/Auckland', iso: '2025-01-15T12:00:00Z', expected: '1:00 AM' },
  { brandTz: 'America/New_York', iso: '2025-03-09T07:00:00Z', expected: '3:00 AM' },
  { brandTz: 'America/New_York', iso: '2025-03-09T06:00:00Z', expected: '1:00 AM' },
  { brandTz: 'America/New_York', iso: '2025-11-02T05:00:00Z', expected: '1:00 AM' },
  { brandTz: 'America/New_York', iso: '2025-11-02T06:00:00Z', expected: '1:00 AM' },
];
for (const browserTz of [
  'UTC',
  'America/Los_Angeles',
  'America/New_York',
  'Asia/Kolkata',
  'Pacific/Auckland',
]) {
  test(`renders brand time independently of browser timezone ${browserTz}`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ timezoneId: browserTz, baseURL });
    const page = await context.newPage();
    try {
      for (const c of cases) {
        await page.goto(
          `/__tz?iso=${encodeURIComponent(c.iso)}&tz=${encodeURIComponent(c.brandTz)}`
        );
        await expect(page.locator('[data-testid="tz-card"] span.font-medium')).toHaveText(
          c.expected
        );
      }
    } finally {
      await context.close();
    }
  });
}
