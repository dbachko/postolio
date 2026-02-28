import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { getDatabaseClient } from '../config/database.js';
import { validateAndSanitize } from '../middleware/validation.js';
import {
  loginSchema,
  registerSchema,
  type LoginInput,
  type RegisterInput,
} from '../schemas/auth.js';
import { AuthService } from '../services/auth.js';
import { AuditEventType, AuditLogger } from '../services/audit-logger.js';
import { enhancedRateLimiters } from '../services/enhanced-rate-limiter.js';
import { RefreshTokenService } from '../services/refresh-token.js';
import { createRedisClient } from '../services/redis.js';
import { ensureDeviceId } from '../utils/device-id.js';
import { isProductionEnv } from '../utils/env-mode.js';
import { getUserFeatureFlags } from '../utils/feature-flags.js';
import { getClientIp, getUserAgent, parseDeviceName } from '../utils/request-info.js';
import { signupsAllowedForEmail } from '../utils/access-control.js';

const prisma = getDatabaseClient();
const redis = createRedisClient();

function setAccessTokenCookie(reply: any, accessToken: string) {
  reply.setCookie('auth_token', accessToken, {
    httpOnly: true,
    secure: isProductionEnv(),
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60,
  });
}

function clearLegacyRefreshCookies(reply: any) {
  reply.clearCookie('refresh_token', { path: '/' });
  reply.clearCookie('refresh_token', { path: '/api/auth/refresh' });
}

function setRefreshTokenCookie(reply: any, refreshToken: string, maxAge: number) {
  clearLegacyRefreshCookies(reply);
  reply.setCookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProductionEnv(),
    sameSite: 'lax',
    path: '/api/auth',
    maxAge,
  });
}

async function sendPostRegistrationEmails(params: {
  fastify: FastifyInstance;
  userId: string;
  email: string;
  name?: string | null;
}) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return;
  }
  const [{ EmailService }, { EmailVerificationService }] = await Promise.all([
    import('../services/email.js'),
    import('../services/email-verification.js'),
  ]);

  EmailService.sendWelcomeEmail(params.email, params.name || undefined).catch((error) => {
    params.fastify.log.error({ err: error, userId: params.userId }, 'Failed to send welcome email');
  });
  EmailVerificationService.sendVerificationEmail(params.userId).catch((error) => {
    params.fastify.log.error(
      { err: error, userId: params.userId },
      'Failed to send verification email'
    );
  });
}

function createRegisterHandler(fastify: FastifyInstance) {
  return async (request: any, reply: any) => {
    const { email, deviceFingerprint, deviceName } = request.body as RegisterInput;
    const gate = signupsAllowedForEmail(email);
    if (!gate.allowed) {
      return reply
        .code(403)
        .send({ error: gate.message, code: gate.code, waitlistUrl: gate.waitlistUrl });
    }

    const stableFingerprint = ensureDeviceId(request, reply, deviceFingerprint);
    const ipAddress = getClientIp(request);
    const userAgent = getUserAgent(request);
    const humanDeviceName = deviceName || parseDeviceName(userAgent);
    const { user, refreshToken, accessToken } = await AuthService.register({
      fastify,
      input: { ...request.body, email: request.body.email },
      ipAddress,
      userAgent,
      deviceFingerprint: stableFingerprint,
      deviceName: humanDeviceName,
    });

    setAccessTokenCookie(reply, accessToken);
    setRefreshTokenCookie(reply, refreshToken, 7 * 24 * 60 * 60);
    await AuditLogger.logAuth(AuditEventType.USER_REGISTER, user.id, user.email, request, {
      name: user.name,
    });
    void sendPostRegistrationEmails({
      fastify,
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    return reply.code(201).send({
      user: { ...user, featureFlags: getUserFeatureFlags({ userId: user.id, email: user.email }) },
      message: 'Registration successful',
    });
  };
}

function createLoginHandler(fastify: FastifyInstance) {
  return async (request: any, reply: any) => {
    const { rememberMe, deviceFingerprint, deviceName } = request.body as LoginInput;
    const stableFingerprint = ensureDeviceId(request, reply, deviceFingerprint);

    const result = await AuthService.login({
      fastify,
      request,
      redis,
      input: request.body,
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
      stableFingerprint,
      deviceName,
    });

    if (result.outcome === 'locked') {
      return reply.code(423).send({ error: result.message, code: 'ACCOUNT_LOCKED' });
    }
    if (result.outcome === 'invalid_credentials') {
      return reply.code(401).send({ error: result.message });
    }
    if (result.outcome === '2fa_required') {
      return reply.code(200).send({
        requiresTwoFactor: true,
        method: result.method,
        message: result.message,
      });
    }

    setAccessTokenCookie(reply, result.accessToken);
    setRefreshTokenCookie(
      reply,
      result.refreshToken,
      rememberMe ? 30 * 24 * 60 * 60 : 7 * 24 * 60 * 60
    );
    return reply.send({
      user: {
        ...result.user,
        featureFlags: getUserFeatureFlags({ userId: result.user.id, email: result.user.email }),
      },
      message: 'Login successful',
    });
  };
}

async function buildRefreshAuthContext(fastify: FastifyInstance, request: any) {
  const authContext: Record<string, unknown> = {
    refreshTokenCookieCount: request.headers.cookie?.includes('refresh_token=')
      ? request.headers.cookie.split('refresh_token=').length - 1
      : 0,
    hasAuthTokenCookie: Boolean(request.cookies?.auth_token),
  };

  const authToken = request.cookies?.auth_token;
  if (!authToken) {
    return authContext;
  }

  try {
    const decoded = fastify.jwt.verify(authToken) as { id: string; sid?: string };
    authContext.authUserId = decoded.id;
    authContext.authSessionId = decoded.sid;
  } catch (error: unknown) {
    authContext.authTokenError = error instanceof Error ? error.name : String(error);
  }
  return authContext;
}

function createRefreshHandler(fastify: FastifyInstance) {
  return async (request: any, reply: any) => {
    const refreshToken = request.cookies?.refresh_token;
    if (!refreshToken) {
      request.log.warn(
        {
          type: 'refresh_missing_cookie',
          ip: getClientIp(request),
          userAgent: getUserAgent(request),
          cookiesPresent: Object.keys(request.cookies || {}),
          referer: request.headers.referer,
          origin: request.headers.origin,
        },
        'Refresh attempt without refresh_token cookie'
      );
      return reply.code(401).send({ error: 'Refresh token required' });
    }

    const result = await RefreshTokenService.rotateRefreshToken(
      fastify,
      refreshToken,
      getClientIp(request),
      getUserAgent(request)
    );
    if (!result) {
      const authContext = await buildRefreshAuthContext(fastify, request);
      request.log.warn(
        {
          type: 'refresh_invalid_or_expired',
          ip: getClientIp(request),
          userAgent: getUserAgent(request),
          referer: request.headers.referer,
          origin: request.headers.origin,
          ...authContext,
        },
        'Refresh token rotation failed (invalid/expired/reused/session-mismatch)'
      );
      reply.clearCookie('refresh_token', { path: '/api/auth' });
      reply.clearCookie('refresh_token', { path: '/api/auth/refresh' });
      reply.clearCookie('refresh_token', { path: '/' });
      return reply.code(401).send({ error: 'Invalid or expired refresh token' });
    }

    setAccessTokenCookie(reply, result.accessToken);
    setRefreshTokenCookie(reply, result.refreshToken, 30 * 24 * 60 * 60);
    return reply.send({ message: 'Token refreshed successfully' });
  };
}

type LogoutContext = { userId?: string; email?: string; sessionId?: string };

function parseLogoutContext(fastify: FastifyInstance, request: any): LogoutContext {
  const token = request.cookies?.auth_token || request.headers.authorization?.substring(7);
  if (!token) {
    return {};
  }
  try {
    const decoded = fastify.jwt.verify(token) as { id: string; email: string; sid?: string };
    return { userId: decoded.id, email: decoded.email, sessionId: decoded.sid };
  } catch {
    return {};
  }
}

async function revokeSessionByRefreshToken(
  refreshToken: string,
  userId?: string,
  sessionId?: string
) {
  const invalidated = await RefreshTokenService.invalidateRefreshToken(refreshToken);
  if (!invalidated || !sessionId || !userId) {
    return false;
  }

  const { SessionService } = await import('../services/session.service.js');
  const session = await SessionService.getSessionById(sessionId, userId);
  return Boolean(session?.revokedAt);
}

async function revokeSessionBySessionId(request: any, sessionId?: string) {
  if (!sessionId) {
    return false;
  }
  try {
    const { SessionService } = await import('../services/session.service.js');
    await SessionService.revokeSession(sessionId, 'user_logout');
    return true;
  } catch (error: unknown) {
    request.log.error(error, 'Failed to revoke session via session ID');
    return false;
  }
}

async function revokeSessionByFallback(request: any, userId?: string) {
  if (!userId) {
    return;
  }
  try {
    const { SessionService } = await import('../services/session.service.js');
    const sessions = await SessionService.getUserSessions(userId);
    const ipAddress = getClientIp(request);
    const userAgent = getUserAgent(request);
    const match = sessions
      .filter((session) => (userAgent ? session.userAgent === userAgent : true))
      .filter((session) => (ipAddress ? session.ipAddress === ipAddress : true))
      .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())[0];
    if (match) {
      await SessionService.revokeSession(match.id, 'user_logout');
    }
  } catch (error: unknown) {
    request.log.error(error, 'Failed to revoke session via logout fallback');
  }
}

function clearAuthCookies(reply: any) {
  reply.clearCookie('auth_token', {
    path: '/',
    httpOnly: true,
    secure: isProductionEnv(),
    sameSite: 'strict',
  });
  reply.clearCookie('refresh_token', {
    path: '/api/auth',
    httpOnly: true,
    secure: isProductionEnv(),
    sameSite: 'strict',
  });
  reply.clearCookie('refresh_token', {
    path: '/api/auth/refresh',
    httpOnly: true,
    secure: isProductionEnv(),
    sameSite: 'strict',
  });
  reply.clearCookie('refresh_token', {
    path: '/',
    httpOnly: true,
    secure: isProductionEnv(),
    sameSite: 'strict',
  });
}

function createLogoutHandler(fastify: FastifyInstance) {
  return async (request: any, reply: any) => {
    const context = parseLogoutContext(fastify, request);
    const refreshToken = request.cookies?.refresh_token;
    let revoked = false;

    if (refreshToken) {
      revoked = await revokeSessionByRefreshToken(refreshToken, context.userId, context.sessionId);
    }
    if (!revoked) {
      revoked = await revokeSessionBySessionId(request, context.sessionId);
    }
    if (!revoked) {
      await revokeSessionByFallback(request, context.userId);
    }

    clearAuthCookies(reply);
    if (context.userId && context.email) {
      await AuditLogger.logAuth(AuditEventType.USER_LOGOUT, context.userId, context.email, request);
    }
    return reply.send({ success: true, message: 'Logged out successfully' });
  };
}

function createCurrentUserHandler() {
  return async (request: any, reply: any) => {
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: request.user!.id },
        select: {
          id: true,
          email: true,
          name: true,
          subscriptionTier: true,
          timezone: true,
          timezoneAutoDetected: true,
          themePreference: true,
          weekStartPreference: true,
          uiPreferences: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!dbUser) {
        return reply.code(404).send({ error: 'User not found' });
      }
      return {
        user: {
          id: dbUser.id,
          email: dbUser.email,
          name: dbUser.name,
          subscriptionTier: dbUser.subscriptionTier,
          timezone: dbUser.timezone,
          timezoneAutoDetected: dbUser.timezoneAutoDetected,
          theme: dbUser.themePreference,
          weekStart: dbUser.weekStartPreference,
          uiPreferences: dbUser.uiPreferences,
          createdAt: dbUser.createdAt,
          updatedAt: dbUser.updatedAt,
          featureFlags: getUserFeatureFlags({ userId: dbUser.id, email: dbUser.email }),
        },
      };
    } catch (error: unknown) {
      if (error instanceof Error) {
        request.log.error(
          { err: error, message: error.message },
          'Auth verification failed in /me'
        );
        if (error.name === 'TokenExpiredError') {
          return reply.code(401).send({ error: 'Token expired' });
        }
        if (error.name === 'JsonWebTokenError') {
          return reply.code(401).send({ error: 'Invalid token' });
        }
      }
      return reply.code(401).send({ error: 'Authentication required' });
    }
  };
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: RegisterInput }>(
    '/register',
    { preHandler: [validateAndSanitize(registerSchema), enhancedRateLimiters.register()] },
    createRegisterHandler(fastify)
  );

  fastify.post<{ Body: LoginInput }>(
    '/login',
    { preHandler: [validateAndSanitize(loginSchema), enhancedRateLimiters.login()] },
    createLoginHandler(fastify)
  );

  fastify.post('/refresh', createRefreshHandler(fastify));
  fastify.post('/logout', createLogoutHandler(fastify));
  fastify.get('/me', { preHandler: fastify.authenticate }, createCurrentUserHandler());
};

export default authRoutes;
