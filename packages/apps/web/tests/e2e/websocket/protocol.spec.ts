import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';

const user = {
  id: 'user-test',
  email: 'user@example.test',
  name: 'Test User',
  theme: 'light',
  weekStart: 'monday',
};
const brand = {
  id: 'brand-test',
  userId: user.id,
  name: 'Test Brand',
  timezone: 'UTC',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
async function prepare(page: Page) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const json =
      path === '/api/auth/me'
        ? { user }
        : path === '/api/csrf-token'
          ? { token: 'test-csrf', expiresInMs: 3600000 }
          : path === '/api/brands'
            ? { brands: [brand] }
            : path === `/api/brands/${brand.id}`
              ? { brand }
              : { items: [], data: [], content: [], unreadCount: 0, accounts: [] };
    return route.fulfill({ json });
  });
  await page.addInitScript((selectedBrand) => {
    localStorage.setItem('brand-storage', JSON.stringify({ state: { selectedBrand }, version: 0 }));
  }, brand);
}

test('subscribes after cookie authentication, acknowledges heartbeats, and reconnects', async ({
  page,
}) => {
  await prepare(page);
  const received: Array<Record<string, unknown>> = [];
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket('**/ws', (socket) => {
    sockets.push(socket);
    socket.onMessage((data) => received.push(JSON.parse(data.toString())));
    socket.send(JSON.stringify({ type: 'authenticated', userId: user.id }));
  });
  await page.goto('/dashboard');
  await expect
    .poll(() => received.find((message) => message.type === 'subscribe'))
    .toEqual({ type: 'subscribe', rooms: [`brand:${brand.id}`, `user:${user.id}`] });
  expect(received.some((message) => message.type === 'auth')).toBe(false);
  sockets.at(-1)!.send(JSON.stringify({ type: 'heartbeat' }));
  await expect.poll(() => received.some((message) => message.type === 'heartbeat_ack')).toBe(true);
  const initialConnections = sockets.length;
  sockets.at(-1)!.close({ code: 1012, reason: 'Service restart' });
  await expect.poll(() => sockets.length, { timeout: 15000 }).toBeGreaterThan(initialConnections);
  await expect
    .poll(() => received.filter((message) => message.type === 'subscribe').length)
    .toBeGreaterThan(1);
});

test('does not connect or subscribe when the user is unauthenticated', async ({ page }) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 401, json: { error: 'Unauthorized' } })
  );
  let connections = 0;
  await page.routeWebSocket('**/ws', () => {
    connections++;
  });
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
  expect(connections).toBe(0);
});
