import { test, expect } from '@playwright/test';

// Minimal stub data used by routes
const user = {
  id: 'user_1',
  email: 'qa@postolio.example',
  theme: 'light',
  weekStart: 'monday',
};

const defaults = [
  { category: 'publishing', type: 'publishing.post_failed', channel: 'in_app', enabled: true },
  { category: 'publishing', type: 'publishing.post_failed', channel: 'email', enabled: true },
  { category: 'accounts', type: 'accounts.account_disconnected', channel: 'email', enabled: true },
  { category: 'accounts', type: 'accounts.token_expiring', channel: 'email', enabled: true },
  { category: 'billing', type: 'billing.payment_failed', channel: 'email', enabled: true },
  { category: 'system', type: 'system.test_notification', channel: 'in_app', enabled: true },
];

const notifications = [
  {
    id: 'n1',
    type: 'system.test_notification',
    category: 'system',
    severity: 'info',
    title: 'Test notification from Postolio',
    body: 'This is a test to confirm notifications are working.',
    linkUrl: 'https://postolio.example/notifications',
    resourceType: null,
    resourceId: null,
    createdAt: new Date().toISOString(),
    readAt: null,
  },
  {
    id: 'n2',
    type: 'accounts.account_disconnected',
    category: 'accounts',
    severity: 'warning',
    title: 'Account disconnected',
    body: 'Your Instagram account needs reconnection.',
    linkUrl: null,
    resourceType: null,
    resourceId: null,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    readAt: null,
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

  // Preferences
  await page.route('**/api/notifications/preferences**', async (route) => {
    await route.fulfill({ json: { items: [], defaults } });
  });

  // Update preferences
  await page.route('**/api/notifications/preferences', async (route) => {
    await route.fulfill({ json: { success: true } });
  });

  // Notifications list
  await page.route('**/api/notifications**', async (route) => {
    await route.fulfill({ json: { items: notifications, nextCursor: null, unreadCount: 2 } });
  });

  // Test notification
  await page.route('**/api/notifications/test', async (route) => {
    await route.fulfill({ json: { success: true, id: 'n3' } });
  });
}

test('capture settings notifications grouped view', async ({ page, baseURL }, testInfo) => {
  await stubApi(page);

  await page.goto(baseURL! + '/settings/notifications');
  await page.getByText('Notification types').waitFor();

  // Ensure layout settled
  await page.waitForLoadState('networkidle');

  await page.screenshot({
    path: testInfo.outputPath('settings-notifications.png'),
    fullPage: true,
  });
});

test('capture bell dropdown with notifications', async ({ page, baseURL }, testInfo) => {
  await stubApi(page);

  await page.goto(baseURL! + '/settings');
  // Open bell
  await page.getByRole('button', { name: 'Open notifications' }).click();
  await page.getByText('Notifications').first().waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: testInfo.outputPath('notifications-bell.png'),
    fullPage: true,
  });
});
