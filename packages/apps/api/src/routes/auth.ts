import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
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
import { TimezoneService } from '../services/timezone.js';
import Redis from 'ioredis';
import { getRedisUrl } from '../utils/redis-url.js';
import { isProductionEnv } from '../utils/env-mode.js';
import { getClientIp, getUserAgent, parseDeviceName } from '../utils/request-info.js';

const prisma = getDatabaseClient();
const redis = new Redis(getRedisUrl());

/**
 * Add a random delay to help mitigate timing attacks
 * Delays between 10-50ms to normalize response times
 */
async function addTimingJitter(): Promise<void> {
  const delayMs = Math.floor(Math.random() * 40) + 10; // 10-50ms random delay
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // User registration with rate limiting and validation
  fastify.post<{ Body: RegisterInput }>(
    '/register',
    {
      preHandler: [validateAndSanitize(registerSchema), enhancedRateLimiters.register()],
    },
    async (request, reply) => {
      const { email, password, name, timezone, deviceFingerprint, deviceName } = request.body;

      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        return reply.code(409).send({ error: 'User already exists' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user with auto-detected timezone
      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          name: name || null,
          timezone: timezone || 'UTC', // Use detected timezone or UTC fallback
          timezoneAutoDetected: true, // Mark as auto-detected during registration
        },
        select: {
          id: true,
          email: true,
          name: true,
          timezone: true,
          timezoneAutoDetected: true,
          createdAt: true,
        },
      });

      // Generate tokens with refresh token rotation and session tracking
      const ipAddress = getClientIp(request);
      const userAgent = getUserAgent(request);
      const humanDeviceName = deviceName || parseDeviceName(userAgent);
      const { refreshToken, accessToken } = await RefreshTokenService.generateRefreshToken(
        fastify,
        user.id,
        ipAddress,
        userAgent,
        {
          deviceFingerprint,
          deviceName: humanDeviceName,
          ipAddress,
          userAgent,
        }
      );

      // Set access token in HTTP-only cookie
      reply.setCookie('auth_token', accessToken, {
        httpOnly: true,
        secure: isProductionEnv(),
        sameSite: 'strict',
        path: '/',
        maxAge: 15 * 60, // 15 minutes for access token
      });

      // Set refresh token in separate HTTP-only cookie (scoped to /api/auth so logout can read it)
      reply.setCookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: isProductionEnv(),
        sameSite: 'strict',
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
            console.error('Failed to send welcome email:', error);
          });

          // Send verification email
          EmailVerificationService.sendVerificationEmail(user.id).catch((error) => {
            console.error('Failed to send verification email:', error);
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
      const { email, password, rememberMe, deviceFingerprint, deviceName } = request.body;

      // Check if account is locked before proceeding
      const isLocked = await AuditLogger.isAccountLocked(email);
      if (isLocked) {
        return reply.code(423).send({
          error:
            'Account temporarily locked due to multiple failed login attempts. Please try again later.',
          code: 'ACCOUNT_LOCKED',
        });
      }

      // Find user with password for verification
      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          name: true,
          password: true,
          subscriptionTier: true,
        },
      });

      // Always perform password comparison to prevent timing attacks
      // Use a dummy hash if user doesn't exist
      const dummyHash = '$2b$10$dqyYw5XovLjpmkYNiRDEWuwKaRAvLaG45fnXE5b3KTccKZcRPka2m'; // Hash of 'dummy'
      const passwordToCheck = user?.password || dummyHash;
      const validPassword = await bcrypt.compare(password, passwordToCheck);

      // Add random timing jitter to mitigate timing-based user enumeration
      // This helps normalize response times regardless of user existence
      await addTimingJitter();

      // Check both user existence and password validity
      if (!user || !validPassword) {
        // Log failed login attempt
        await AuditLogger.logAuthFailure(
          AuditEventType.USER_LOGIN_FAILED,
          email,
          request,
          !user ? 'User not found' : 'Invalid password'
        );

        // Check for account lockout
        const shouldLock = await AuditLogger.checkAccountLockout(email);
        if (shouldLock) {
          return reply.code(423).send({
            error:
              'Account temporarily locked due to multiple failed login attempts. Please try again later.',
          });
        }

        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      // Auto-detect and save timezone if user doesn't have one set
      const userTimezone = await prisma.user.findUnique({
        where: { id: user.id },
        select: { timezone: true, timezoneAutoDetected: true },
      });

      if (
        !userTimezone?.timezone ||
        userTimezone.timezone === 'UTC' ||
        userTimezone.timezoneAutoDetected
      ) {
        const detectedTimezone = await TimezoneService.detectTimezone(request, user.id);
        if (detectedTimezone !== 'UTC') {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              timezone: detectedTimezone,
              timezoneAutoDetected: true,
            },
          });
          console.log(
            `Auto-detected and saved timezone ${detectedTimezone} for user ${user.id} during login`
          );
        }
      }

      // Check if two-factor authentication is enabled
      const userWithTwoFactor = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          twoFactorEnabled: true,
          twoFactorMethod: true,
        },
      });

      if (userWithTwoFactor?.twoFactorEnabled) {
        // Check for trusted device token
        const trustedDeviceToken = request.cookies?.trusted_device;
        if (trustedDeviceToken) {
          const { TwoFactorService } = await import('../services/two-factor.js');
          const trustedUserId = await TwoFactorService.isTrustedDevice(trustedDeviceToken);

          if (trustedUserId === user.id) {
            // Trusted device, proceed with login
          } else {
            // Need 2FA verification
            // Store pending authentication in Redis temporarily
            const pendingKey = `2fa-pending:${email}`;
            await redis.setex(pendingKey, 300, user.id); // 5 minutes to complete 2FA

            // Send 2FA code if using email method
            if (userWithTwoFactor.twoFactorMethod === 'email') {
              const { TwoFactorService } = await import('../services/two-factor.js');
              await TwoFactorService.sendEmailCode(user.id);
            }

            return reply.code(200).send({
              requiresTwoFactor: true,
              method: userWithTwoFactor.twoFactorMethod,
              message: 'Two-factor authentication required',
            });
          }
        } else {
          // Need 2FA verification
          const pendingKey = `2fa-pending:${email}`;
          await redis.setex(pendingKey, 300, user.id); // 5 minutes to complete 2FA

          // Send 2FA code if using email method
          if (userWithTwoFactor.twoFactorMethod === 'email') {
            const { TwoFactorService } = await import('../services/two-factor.js');
            await TwoFactorService.sendEmailCode(user.id);
          }

          return reply.code(200).send({
            requiresTwoFactor: true,
            method: userWithTwoFactor.twoFactorMethod,
            message: 'Two-factor authentication required',
          });
        }
      }

      // Generate tokens with refresh token rotation and session tracking
      const ipAddress = getClientIp(request);
      const userAgent = getUserAgent(request);
      const humanDeviceName = deviceName || parseDeviceName(userAgent);
      const { refreshToken, accessToken } = await RefreshTokenService.generateRefreshToken(
        fastify,
        user.id,
        ipAddress,
        userAgent,
        {
          deviceFingerprint,
          deviceName: humanDeviceName,
          ipAddress,
          userAgent,
        }
      );

      // Set access token in HTTP-only cookie
      reply.setCookie('auth_token', accessToken, {
        httpOnly: true,
        secure: isProductionEnv(),
        sameSite: 'strict',
        path: '/',
        maxAge: 15 * 60, // 15 minutes for access token
      });

      // Set refresh token in separate HTTP-only cookie
      reply.setCookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: isProductionEnv(),
        sameSite: 'strict',
        path: '/api/auth', // Sent to all /api/auth endpoints
        maxAge: rememberMe
          ? 30 * 24 * 60 * 60 // 30 days if remember me
          : 7 * 24 * 60 * 60, // 7 days otherwise
      });

      // Log successful login and reset failed attempts
      await AuditLogger.logAuth(AuditEventType.USER_LOGIN, user.id, user.email, request);
      await AuditLogger.resetFailedLoginAttempts(user.email);

      // Return user without password
      const { password: _password, ...userWithoutPassword } = user;
      void _password;

      return reply.send({
        user: userWithoutPassword,
        message: 'Login successful',
      });
    }
  );

  // Refresh token endpoint with rotation
  fastify.post('/refresh', async (request, reply) => {
    const refreshToken = request.cookies?.refresh_token;

    if (!refreshToken) {
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
      reply.clearCookie('refresh_token', { path: '/api/auth/refresh' });
      reply.clearCookie('auth_token', { path: '/' });
      return reply.code(401).send({ error: 'Invalid or expired refresh token' });
    }

    // Set new access token
    reply.setCookie('auth_token', result.accessToken, {
      httpOnly: true,
      secure: isProductionEnv(),
      sameSite: 'strict',
      path: '/',
      maxAge: 15 * 60, // 15 minutes
    });

    // Set new refresh token (keep path at /api/auth so logout can invalidate it)
    reply.setCookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: isProductionEnv(),
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    return reply.send({
      message: 'Token refreshed successfully',
    });
  });

  // Logout endpoint
  fastify.post('/logout', async (request, reply) => {
    // Try to get user info for audit log
    let userId: string | undefined;
    let email: string | undefined;
    const ipAddress = getClientIp(request);
    const userAgent = getUserAgent(request);

    try {
      const token = request.cookies?.auth_token || request.headers.authorization?.substring(7);
      if (token) {
        try {
          const decoded = fastify.jwt.verify(token) as { id: string; email: string };
          userId = decoded.id;
          email = decoded.email;
        } catch {
          // Invalid token, still allow logout
        }
      }
    } catch {
      // User might have invalid token, still allow logout
    }

    // Invalidate refresh token if present
    const refreshToken = request.cookies?.refresh_token;
    if (refreshToken) {
      await RefreshTokenService.invalidateRefreshToken(refreshToken);
    } else if (userId) {
      // Fallback: try to find the most likely current session by matching IP and User-Agent
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

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          instagramUsername: true,
          subscriptionTier: true,
          timezone: true,
          timezoneAutoDetected: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      return { user };
    } catch (err) {
      // Log the specific error for debugging
      if (err instanceof Error) {
        console.error('Auth verification failed:', err.message);
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
