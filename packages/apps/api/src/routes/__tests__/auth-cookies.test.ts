import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import authRoutes from '../auth.js';
const fixture = vi.hoisted(() => ({
  user: { id: 'test-user', email: 'user@example.test', name: 'Test User' },
  accessToken: 'test-only-access-token',
  refreshToken: 'test-only-refresh-token',
}));
vi.mock('../../config/database.js', () => ({ getDatabaseClient: () => ({}) }));
vi.mock('../../services/redis.js', () => ({ createRedisClient: () => null }));
vi.mock('../../services/auth.js', () => ({
  AuthService: {
    register: vi.fn(async () => fixture),
    login: vi.fn(async () => ({ ...fixture, outcome: 'success' })),
  },
}));
vi.mock('../../services/refresh-token.js', () => ({
  RefreshTokenService: { rotateRefreshToken: vi.fn(async () => fixture) },
}));
vi.mock('../../services/audit-logger.js', () => ({
  AuditLogger: { logAuth: vi.fn() },
  AuditEventType: { USER_REGISTER: 'register' },
}));
vi.mock('../../services/enhanced-rate-limiter.js', () => ({
  enhancedRateLimiters: { register: () => async () => {}, login: () => async () => {} },
}));
let app: FastifyInstance;
beforeEach(async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('SMTP_HOST', '');
  vi.stubEnv('AUTH_SIGNUPS_MODE', 'open');
  app = Fastify();
  await app.register(cookie);
  app.decorate('authenticate', async () => {});
  await app.register(authRoutes, { prefix: '/api/auth' });
});
afterEach(async () => {
  await app.close();
  vi.unstubAllEnvs();
});
it.each(['register', 'login', 'refresh'])(
  'keeps %s credentials in secure HttpOnly cookies and out of JSON',
  async (action) => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/auth/${action}`,
      payload:
        action === 'refresh'
          ? {}
          : { email: fixture.user.email, password: 'ValidLongPassword123!', name: 'Test User' },
      cookies: { refresh_token: fixture.refreshToken },
    });
    expect(response.statusCode).toBe(action === 'register' ? 201 : 200);
    expect(response.body).not.toContain(fixture.accessToken);
    expect(response.body).not.toContain(fixture.refreshToken);
    expect(response.json()).not.toHaveProperty('token');
    const access = response.cookies.find((value) => value.name === 'auth_token');
    const refresh = response.cookies.find((value) => value.name === 'refresh_token' && value.value);
    expect(access).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 3600,
    });
    expect(refresh).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/api/auth',
    });
  }
);
