import { test } from 'tap';
import { buildFastify } from '../src/server.js';

test('Analytics routes require authentication', async (t) => {
  const app = buildFastify();
  t.teardown(async () => {
    try {
      await app.close();
    } catch {}
  });

  const endpoints = [
    { method: 'GET', url: '/api/publications' },
    { method: 'GET', url: '/api/analytics/publications/some-id' },
    { method: 'POST', url: '/api/analytics/publications/some-id/refresh' },
    { method: 'GET', url: '/api/analytics/brands/brand-1/summary' },
    { method: 'GET', url: '/api/analytics/brands/brand-1/account/series' },
    { method: 'GET', url: '/api/analytics/brands/brand-1/top-publications' },
    { method: 'POST', url: '/api/analytics/brands/brand-1/account/refresh' },
  ];

  for (const ep of endpoints) {
    const res = await app.inject({ method: ep.method as any, url: ep.url });
    t.equal(res.statusCode, 401, `${ep.method} ${ep.url} should be unauthorized`);
  }
});
