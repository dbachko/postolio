import { expect, test as base, type Browser, type Page } from '@playwright/test';

const email = process.env.DEV_SEED_EMAIL || 'dev@postolio.test';
const password = process.env.DEV_SEED_PASSWORD || 'Test123!@#';
// A real 64x64 PNG; the only stubbed dependency below is S3 itself.
const pngFile = {
  name: 'e2e.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PMQEAAAgDIN8/tEPsUAwAiUgFFRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT8FAw7Af4BU+oFcgAAAABJRU5ErkJggg==',
    'base64'
  ),
};

type StorageState = Awaited<ReturnType<ReturnType<Page['context']>['storageState']>>;

// The login limit is 10 per 15 minutes in production, so signed-in tests share one session.
let session: StorageState;
const test = base.extend({
  page: async ({ browser, baseURL, page }, use, testInfo) => {
    if (!testInfo.titlePath.includes('signed in')) {
      return use(page);
    }
    const context = await browser.newContext({ baseURL, storageState: session });
    await use(await context.newPage());
    await context.close();
  },
});

async function createSession(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await signIn(page);
  await page.waitForLoadState('networkidle');
  session = await context.storageState();
  await context.close();
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/?$/);
}

test.describe('signed out', () => {
  for (const path of [
    '/register',
    '/password/reset',
    '/pricing',
    '/privacy-policy',
    '/terms-of-service',
    '/auth/magic-link',
    '/auth/verify-email',
    '/account/recover',
    '/legal/data-deletion',
  ]) {
    test(`can stay on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    });
  }

  for (const path of ['/dashboard', '/posts/create', '/settings/account']) {
    test(`is sent to login from ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    });
  }

  test('can sign up leaving the optional name blank', async ({ page }) => {
    await page.goto('/register');
    await page
      .getByRole('textbox', { name: /Email address/ })
      .fill(`e2e-${Date.now()}@example.test`);
    await page.getByRole('textbox', { name: /^Password/ }).fill('Correct-Horse-9-Battery!');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).not.toHaveURL(/\/register$/);
    await expect(page.locator('body')).not.toContainText('Validation failed');
  });

  test('sees an error for a wrong password', async ({ page }) => {
    await page.goto('/login');
    // Unique: repeated failures lock an email, and the seeded account must stay usable.
    await page.getByLabel('Email address').fill(`nobody-${Date.now()}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Invalid credentials')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('signed in', () => {
  test.beforeAll(async ({ browser, baseURL }) => {
    await createSession(browser, baseURL);
  });

  test('connects the realtime WebSocket', async ({ page }) => {
    const opened = page.waitForEvent('websocket', (socket) => socket.url().endsWith('/ws'));
    await page.goto('/dashboard');
    const socket = await opened;
    await expect.poll(() => socket.isClosed(), { timeout: 3000, intervals: [500] }).toBe(false);
    await socket.waitForEvent('framereceived');
  });

  test('can reload directly on /assets', async ({ page }) => {
    await page.goto('/assets');
    await expect(page.getByRole('button', { name: 'Upload', exact: true })).toBeVisible();
  });

  test('a fresh session can deep link to the editor', async ({ page }) => {
    await page.goto('/privacy-policy');
    await page.evaluate(() => localStorage.removeItem('brand-storage'));
    await page.goto('/posts/create');
    await expect(page.getByRole('textbox', { name: /Caption/ })).toBeVisible();
  });

  test('uploads an asset through the presigned URL', async ({ page }) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'PUT',
      'access-control-expose-headers': 'ETag',
    };
    const puts: Array<{ signed: boolean; type?: string; size: number }> = [];
    await page.route(/amazonaws\.com/, async (route) => {
      const request = route.request();
      if (request.method() === 'PUT') {
        puts.push({
          signed: new URL(request.url()).searchParams.has('X-Amz-Signature'),
          type: request.headers()['content-type'],
          size: request.postDataBuffer()?.length ?? 0,
        });
        return route.fulfill({ status: 200, headers: { ...cors, ETag: '"e2e"' } });
      }
      return route.fulfill({ status: request.method() === 'OPTIONS' ? 200 : 404, headers: cors });
    });

    await page.goto('/assets');
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByText('click to browse').click(),
    ]);
    await chooser.setFiles(pngFile);
    await expect(page.locator('.uppy-Dashboard-Item')).toHaveCount(1);
    await page.locator('.uppy-StatusBar-actionBtn--upload').click();

    await expect(page.getByText('Assets uploaded')).toBeVisible();
    expect(puts).toEqual([{ signed: true, type: 'image/png', size: pngFile.buffer.length }]);
    await page.goto('/assets');
    await expect(page.getByText('e2e.png').first()).toBeVisible();
  });

  test('opens the emoji picker and keeps the caption', async ({ page }) => {
    await page.goto('/posts/create');
    const caption = page.getByRole('textbox', { name: /Caption/ });
    await caption.fill('E2E caption');
    await page.getByRole('button', { name: 'Insert emoji' }).click();
    await expect(page.locator('[class*=EmojiPicker]').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(caption).toHaveValue(/E2E caption/);
  });

  test('saves a theme across reloads', async ({ page }) => {
    await page.goto('/settings/appearance');
    await page.getByRole('radio', { name: 'Dark' }).click();
    await page.getByRole('button', { name: 'Save Theme' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('button', { name: 'Reset to System' }).click();
    await page.waitForLoadState('networkidle');
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(page.getByRole('radio', { name: 'System' })).toBeChecked();
  });

  test('the upload panel follows the app theme, not the OS', async ({ page }) => {
    await page.goto('/settings/appearance');
    await page.getByRole('radio', { name: 'Dark' }).click();
    await page.getByRole('button', { name: 'Save Theme' }).click();
    await expect(page.getByText('Theme preference saved')).toBeVisible();
    await page.goto('/assets');
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(page.locator('[data-uppy-theme=dark]').first()).toBeVisible();
    await page.screenshot({ path: 'test-results/upload-panel-dark.png' });
    await page.goto('/settings/appearance');
    await page.getByRole('button', { name: 'Reset to System' }).click();
    await page.waitForLoadState('networkidle');
  });

  test('logs out', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });
});
