import { test } from 'tap';
import { build } from './helper.js';

test('Phase 1: Security Fixes - Remove Token from Response Body', async (t) => {
  const app = await build(t);

  await t.test('register should NOT return access token in body', async (t) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `test-${Date.now()}@example.com`,
        password: 'ValidPass123!',
        name: 'Test User',
      },
    });

    t.equal(response.statusCode, 201, 'Registration should succeed');
    const body = JSON.parse(response.body);

    t.notOk(body.token, 'Response should NOT contain token field');
    t.ok(body.user, 'Response should contain user');
    t.ok(body.user.email, 'User should have email');
    t.ok(body.message, 'Response should have success message');
  });

  await t.test('login should NOT return access token in body', async (t) => {
    // First register a user
    const email = `test-${Date.now()}@example.com`;
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email,
        password: 'ValidPass123!',
        name: 'Test User',
      },
    });

    // Then login
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email,
        password: 'ValidPass123!',
      },
    });

    t.equal(response.statusCode, 200, 'Login should succeed');
    const body = JSON.parse(response.body);

    t.notOk(body.token, 'Response should NOT contain token field');
    t.ok(body.user, 'Response should contain user');
    t.ok(body.message, 'Response should have success message');
  });

  await t.test('refresh should NOT return access token in body', async (t) => {
    // Register and get refresh token
    const email = `test-${Date.now()}@example.com`;
    const registerResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email,
        password: 'ValidPass123!',
      },
    });

    const cookies = registerResponse.cookies;
    const refreshCookie = cookies.find((c) => c.name === 'refresh_token');

    // Refresh token
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: {
        refresh_token: refreshCookie!.value,
      },
    });

    t.equal(response.statusCode, 200, 'Refresh should succeed');
    const body = JSON.parse(response.body);

    t.notOk(body.token, 'Response should NOT contain token field');
    t.ok(body.message, 'Response should have success message');
  });
});

test('Phase 1: Security Fixes - HttpOnly Cookies', async (t) => {
  const app = await build(t);

  await t.test('access token should be in HttpOnly cookie', async (t) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `test-${Date.now()}@example.com`,
        password: 'ValidPass123!',
      },
    });

    const cookies = response.cookies;
    const authCookie = cookies.find((c) => c.name === 'auth_token');

    t.ok(authCookie, 'auth_token cookie should exist');
    t.equal(authCookie!.httpOnly, true, 'Cookie should be HttpOnly');
    t.equal(authCookie!.sameSite, 'Strict', 'Cookie should be SameSite=Strict');
    t.equal(authCookie!.maxAge, 15 * 60, 'Cookie should expire in 15 minutes');
  });

  await t.test('refresh token should be in separate HttpOnly cookie', async (t) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `test-${Date.now()}@example.com`,
        password: 'ValidPass123!',
      },
    });

    const cookies = response.cookies;
    const refreshCookie = cookies.find((c) => c.name === 'refresh_token');

    t.ok(refreshCookie, 'refresh_token cookie should exist');
    t.equal(refreshCookie!.httpOnly, true, 'Cookie should be HttpOnly');
    t.equal(refreshCookie!.sameSite, 'Strict', 'Cookie should be SameSite=Strict');
    t.equal(
      refreshCookie!.path,
      '/api/auth/refresh',
      'Cookie should be scoped to refresh endpoint'
    );
  });
});
