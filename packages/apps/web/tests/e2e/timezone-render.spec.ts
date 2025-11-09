import { test, expect, chromium, firefox, webkit, Browser, BrowserContext } from '@playwright/test';

// Cap test runtime to avoid long hangs in CI/local
test.setTimeout(45_000);

// Utility to open the test page with given browser timezone and assert the displayed time
async function assertTime(
  browser: Browser,
  opts: { browserTz: string; brandTz: string; iso: string; expected: string }
) {
  const context: BrowserContext = await browser.newContext({ timezoneId: opts.browserTz });
  const page = await context.newPage();

  // Prefer ai.localhost if available (vite dev default). Fallback to localhost.
  const url = `/__tz?iso=${encodeURIComponent(opts.iso)}&tz=${encodeURIComponent(opts.brandTz)}`;
  // Load the root to ensure SPA assets are ready under static server
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // Client-side navigate to test route to avoid server-side 404 on static servers
  await page.evaluate((u) => {
    window.history.pushState({}, '', u);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, url);

  // The PostPreviewCard renders the time in a span.font-medium inside the top row
  const timeEl = page.locator('div[data-testid="tz-card"] span.font-medium');
  await expect(timeEl).toHaveText(opts.expected);

  await context.close();
}

test.describe('PostPreviewCard timezone rendering', () => {
  const cases = [
    { brandTz: 'America/New_York', iso: '2025-01-16T04:31:00Z', expected: '11:31 PM' },
    { brandTz: 'Pacific/Auckland', iso: '2025-01-15T12:00:00Z', expected: '1:00 AM' },
  ] as const;

  for (const c of cases) {
    test(`shows ${c.expected} for brand ${c.brandTz} regardless of browser timezone (chromium)`, async () => {
      const browser = await chromium.launch();
      for (const browserTz of [
        'UTC',
        'America/Los_Angeles',
        'America/New_York',
        'Asia/Kolkata',
        'Pacific/Auckland',
      ]) {
        await assertTime(browser, {
          browserTz,
          brandTz: c.brandTz,
          iso: c.iso,
          expected: c.expected,
        });
      }
      await browser.close();
    });

    test(`shows ${c.expected} for brand ${c.brandTz} regardless of browser timezone (firefox)`, async () => {
      const browser = await firefox.launch();
      for (const browserTz of [
        'UTC',
        'America/Los_Angeles',
        'America/New_York',
        'Asia/Kolkata',
        'Pacific/Auckland',
      ]) {
        await assertTime(browser, {
          browserTz,
          brandTz: c.brandTz,
          iso: c.iso,
          expected: c.expected,
        });
      }
      await browser.close();
    });

    test(`shows ${c.expected} for brand ${c.brandTz} regardless of browser timezone (webkit)`, async () => {
      const browser = await webkit.launch();
      for (const browserTz of [
        'UTC',
        'America/Los_Angeles',
        'America/New_York',
        'Asia/Kolkata',
        'Pacific/Auckland',
      ]) {
        await assertTime(browser, {
          browserTz,
          brandTz: c.brandTz,
          iso: c.iso,
          expected: c.expected,
        });
      }
      await browser.close();
    });
  }

  test('handles DST transitions (America/New_York)', async () => {
    const browser = await chromium.launch();

    // Spring forward: 2am doesn't exist; 3am shows correctly
    await assertTime(browser, {
      browserTz: 'America/Los_Angeles',
      brandTz: 'America/New_York',
      iso: '2025-03-09T07:00:00Z',
      expected: '3:00 AM',
    });

    // Before DST change
    await assertTime(browser, {
      browserTz: 'UTC',
      brandTz: 'America/New_York',
      iso: '2025-03-09T06:00:00Z',
      expected: '1:00 AM',
    });

    // Fall back: both 1am occurrences display as 1:00 AM
    await assertTime(browser, {
      browserTz: 'Asia/Kolkata',
      brandTz: 'America/New_York',
      iso: '2025-11-02T05:00:00Z',
      expected: '1:00 AM',
    });

    await assertTime(browser, {
      browserTz: 'Pacific/Auckland',
      brandTz: 'America/New_York',
      iso: '2025-11-02T06:00:00Z',
      expected: '1:00 AM',
    });

    await browser.close();
  });
});
