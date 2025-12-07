import { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../config/database.js';
import { enhancedRateLimiters } from '../services/enhanced-rate-limiter.js';
import { validateAndSanitize } from '../middleware/validation.js';
import {
  registerSchema,
  loginSchema,
  type RegisterInput,
  type LoginInput,
} from '../schemas/auth.js';
import { AuditLogger, AuditEventType } from '../services/audit-logger.js';
import { RefreshTokenService } from '../services/refresh-token.js';
import { isProductionEnv } from '../utils/env-mode.js';
import { getClientIp, getUserAgent, parseDeviceName } from '../utils/request-info.js';
import { ensureDeviceId } from '../utils/device-id.js';
import { signupsAllowedForEmail } from '../utils/access-control.js';
import { createRedisClient } from '../services/redis.js';
import { AuthService } from '../services/auth.js';

const prisma = getDatabaseClient();
const redis = createRedisClient();

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // User registration with rate limiting and validation
  fastify.post<{ Body: RegisterInput }>(
    '/register',
    {
      preHandler: [validateAndSanitize(registerSchema), enhancedRateLimiters.register()],
    },
    async (request, reply) => {
      const { email, deviceFingerprint, deviceName } = request.body;

      // Enforce signup mode restrictions before proceeding
      const gate = signupsAllowedForEmail(email);
      if (!gate.allowed) {
        return reply
          .code(403)
          .send({ error: gate.message, code: gate.code, waitlistUrl: gate.waitlistUrl });
      }

      // Resolve stable device identifier and set cookie if needed
      const stableFingerprint = ensureDeviceId(request, reply, deviceFingerprint);

      // Generate tokens with refresh token rotation and session tracking
      const ipAddress = getClientIp(request);
      const userAgent = getUserAgent(request);
      const humanDeviceName = deviceName || parseDeviceName(userAgent);
      const { user, refreshToken, accessToken } = await AuthService.register({
        fastify,
        input: {
          ...request.body,
          // Ensure email is non-optional for the service layer
          email: request.body.email,
        },
        ipAddress,
        userAgent,
        deviceFingerprint: stableFingerprint,
        deviceName: humanDeviceName,
      });

      // Set access token in HTTP-only cookie
      reply.setCookie('auth_token', accessToken, {
        httpOnly: true,
        secure: isProductionEnv(),
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60, // 1 hour access token
      });

      // Set refresh token in separate HTTP-only cookie (scoped to /api/auth so logout can read it)
      reply.setCookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: isProductionEnv(),
        sameSite: 'lax',
        path: '/api/auth',
        maxAge: 7 * 24 * 60 * 60, // 7 days for new users
      });

      // Log successful registration
      await AuditLogger.logAuth(AuditEventType.USER_REGISTER, user.id, user.email, request, {
        name: user.name,
      });

      // Send welcome and verification emails (non-blocking)
      if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        Promise.all([
          import('../services/email.js'),
          import('../services/email-verification.js'),
        ]).then(([{ EmailService }, { EmailVerificationService }]) => {
          // Send welcome email
          EmailService.sendWelcomeEmail(user.email, user.name || undefined).catch((error) => {
            fastify.log.error(
              { err: error, userId: user.id },
              'Failed to send welcome email after registration'
            );
          });

          // Send verification email
          EmailVerificationService.sendVerificationEmail(user.id).catch((error) => {
            fastify.log.error(
              { err: error, userId: user.id },
              'Failed to send verification email after registration'
            );
          });
        });
      }

      return reply.code(201).send({
        user,
        message: 'Registration successful',
      });
    }
  );

  // User login with rate limiting and validation
  fastify.post<{ Body: LoginInput }>(
    '/login',
    {
      preHandler: [validateAndSanitize(loginSchema), enhancedRateLimiters.login()],
    },
    async (request, reply) => {
      const { rememberMe, deviceFingerprint, deviceName } = request.body;

      // Resolve stable device identifier and set cookie if needed
      const stableFingerprint = ensureDeviceId(request, reply, deviceFingerprint);

      const ipAddress = getClientIp(request);
      const userAgent = getUserAgent(request);

      const result = await AuthService.login({
        fastify,
        request,
        redis,
        input: request.body,
        ipAddress,
        userAgent,
        stableFingerprint,
        deviceName,
      });

      if (result.outcome === 'locked') {
        return reply.code(423).send({
          error: result.message,
          code: 'ACCOUNT_LOCKED',
        });
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

      // Authenticated
      const { user, accessToken, refreshToken } = result;

      // Set access token in HTTP-only cookie
      reply.setCookie('auth_token', accessToken, {
        httpOnly: true,
        secure: isProductionEnv(),
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60, // 1 hour access token
      });

      // Set refresh token in separate HTTP-only cookie
      reply.setCookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: isProductionEnv(),
        sameSite: 'lax',
        path: '/api/auth', // Sent to all /api/auth endpoints
        maxAge: rememberMe
          ? 30 * 24 * 60 * 60 // 30 days if remember me
          : 7 * 24 * 60 * 60, // 7 days otherwise
      });

      return reply.send({
        user,
        message: 'Login successful',
      });
    }
  );

  // Refresh token endpoint with rotation
  fastify.post('/refresh', async (request, reply) => {
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

    // Rotate refresh token
    const result = await RefreshTokenService.rotateRefreshToken(
      fastify,
      refreshToken,
      getClientIp(request),
      getUserAgent(request)
    );

    if (!result) {
      // Invalid or expired refresh token
      // Clear refresh token on the same path it was originally set
      reply.clearCookie('refresh_token', { path: '/api/auth' });
      reply.clearCookie('auth_token', { path: '/' });
      return reply.code(401).send({ error: 'Invalid or expired refresh token' });
    }

    // Set new access token
    reply.setCookie('auth_token', result.accessToken, {
      httpOnly: true,
      secure: isProductionEnv(),
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60, // 1 hour
    });

    // Set new refresh token (keep path at /api/auth so logout can invalidate it)
    reply.setCookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: isProductionEnv(),
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    return reply.send({
      message: 'Token refreshed successfully',
    });
  });

  // Logout endpoint
  fastify.post('/logout', async (request, reply) => {
    // Try to get user info and session ID for audit log and session revocation
    let userId: string | undefined;
    let email: string | undefined;
    let sessionId: string | undefined;
    const ipAddress = getClientIp(request);
    const userAgent = getUserAgent(request);

    try {
      const token = request.cookies?.auth_token || request.headers.authorization?.substring(7);
      if (token) {
        try {
          const decoded = fastify.jwt.verify(token) as {
            id: string;
            email: string;
            sid?: string;
          };
          userId = decoded.id;
          email = decoded.email;
          sessionId = decoded.sid;
        } catch {
          // Invalid token, still allow logout
        }
      }
    } catch {
      // User might have invalid token, still allow logout
    }

    // Invalidate refresh token if present
    const refreshToken = request.cookies?.refresh_token;
    let sessionRevoked = false;

    if (refreshToken) {
      const invalidated = await RefreshTokenService.invalidateRefreshToken(refreshToken);
      // Check if session was actually revoked by checking if it still exists
      if (invalidated && sessionId && userId) {
        const { SessionService } = await import('../services/session.service.js');
        const session = await SessionService.getSessionById(sessionId, userId);
        sessionRevoked = !session || session.revokedAt !== null;
      }
    }

    // If refresh token method didn't revoke the session, try using session ID from JWT
    if (!sessionRevoked && sessionId) {
      try {
        const { SessionService } = await import('../services/session.service.js');
        await SessionService.revokeSession(sessionId, 'user_logout');
        sessionRevoked = true;
      } catch (e) {
        request.log.error(e, 'Failed to revoke session via session ID');
      }
    }

    // Final fallback: try to find the most likely current session by matching IP and User-Agent
    if (!sessionRevoked && userId) {
      try {
        const { SessionService } = await import('../services/session.service.js');
        const sessions = await SessionService.getUserSessions(userId);
        const match = sessions
          .filter(
            (s) =>
              (userAgent ? s.userAgent === userAgent : true) &&
              (ipAddress ? s.ipAddress === ipAddress : true)
          )
          .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())[0];
        if (match) {
          await SessionService.revokeSession(match.id, 'user_logout');
        }
      } catch (e) {
        request.log.error(e, 'Failed to revoke session via logout fallback');
      }
    }

    // Clear both cookies
    reply.clearCookie('auth_token', {
      path: '/',
      httpOnly: true,
      secure: isProductionEnv(),
      sameSite: 'strict',
    });

    // Clear refresh cookies for both possible paths
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

    // Log logout event if we have user info
    if (userId && email) {
      await AuditLogger.logAuth(AuditEventType.USER_LOGOUT, userId, email, request);
    }

    return reply.send({ success: true, message: 'Logged out successfully' });
  });

  // Get current user profile - using authentication decorator
  fastify.get('/me', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      // User is already authenticated via preHandler
      const userId = request.user!.id;

      const dbUser = await prisma.user.findUnique({
        where: { id: userId },
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

      const user = {
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
      };
      return { user };
    } catch (err) {
      // Log the specific error for debugging
      if (err instanceof Error) {
        request.log.error(
          {
            err,
            message: err.message,
          },
          'Auth verification failed in /me'
        );
        if (err.name === 'TokenExpiredError') {
          return reply.code(401).send({ error: 'Token expired' });
        } else if (err.name === 'JsonWebTokenError') {
          return reply.code(401).send({ error: 'Invalid token' });
        }
      }
      return reply.code(401).send({ error: 'Authentication required' });
    }
  });
};

export default authRoutes;
