import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { getDatabaseClient } from '../config/database.js';
import { RefreshTokenService } from './refresh-token.js';
import type { RegisterInput, LoginInput } from '../schemas/auth.js';
import { APIError } from '@postolio/errors';
import { logger as baseLogger } from '@postolio/logger';
import { AuditLogger, AuditEventType } from './audit-logger.js';
import { TimezoneService } from './timezone.js';
import { revokeSameDeviceSessions } from '../utils/session-dedup.js';

const prisma = getDatabaseClient();
const logger = baseLogger.child({ module: 'auth-service' });

interface RegisterContext {
  fastify: FastifyInstance;
  input: RegisterInput;
  ipAddress: string;
  userAgent: string | undefined;
  deviceFingerprint?: string | null;
  deviceName?: string;
}

interface RegisterResult {
  user: {
    id: string;
    email: string;
    name: string | null;
    timezone: string | null;
    timezoneAutoDetected: boolean;
    createdAt: Date;
  };
  accessToken: string;
  refreshToken: string;
}

interface LoginContext {
  fastify: FastifyInstance;
  request: FastifyRequest;
  redis: Redis;
  input: LoginInput;
  ipAddress: string;
  userAgent: string | undefined;
  stableFingerprint?: string | null;
  deviceName?: string;
}

type LoginResult =
  | { outcome: 'locked'; message: string }
  | { outcome: 'invalid_credentials'; message: string }
  | {
      outcome: '2fa_required';
      method: string | null;
      message: string;
    }
  | {
      outcome: 'authenticated';
      user: {
        id: string;
        email: string;
        name: string | null;
        subscriptionTier: string | null;
      };
      accessToken: string;
      refreshToken: string;
    };

async function addTimingJitter(): Promise<void> {
  const delayMs = Math.floor(Math.random() * 40) + 10; // 10-50ms random delay
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export class AuthService {
  private static lockedResult(): LoginResult {
    return {
      outcome: 'locked',
      message:
        'Account temporarily locked due to multiple failed login attempts. Please try again later.',
    };
  }

  private static async authenticateCredentials(
    email: string,
    password: string,
    request: FastifyRequest
  ): Promise<
    | { outcome: 'locked' | 'invalid_credentials'; result: LoginResult }
    | {
        outcome: 'authenticated_user';
        user: {
          id: string;
          email: string;
          name: string | null;
          password: string | null;
          subscriptionTier: string | null;
        };
      }
  > {
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

    const dummyHash = '$2b$10$dqyYw5XovLjpmkYNiRDEWuwKaRAvLaG45fnXE5b3KTccKZcRPka2m';
    const passwordToCheck = user?.password || dummyHash;
    const validPassword = await bcrypt.compare(password, passwordToCheck);
    await addTimingJitter();

    if (user && validPassword) {
      return { outcome: 'authenticated_user', user };
    }

    await AuditLogger.logAuthFailure(
      AuditEventType.USER_LOGIN_FAILED,
      email,
      request,
      !user ? 'User not found' : 'Invalid password'
    );

    const shouldLock = await AuditLogger.checkAccountLockout(email);
    if (shouldLock) {
      return { outcome: 'locked', result: this.lockedResult() };
    }
    return {
      outcome: 'invalid_credentials',
      result: {
        outcome: 'invalid_credentials',
        message: 'Invalid credentials',
      },
    };
  }

  private static async syncUserTimezoneOnLogin(request: FastifyRequest, userId: string) {
    const userTimezone = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true, timezoneAutoDetected: true },
    });

    if (
      !userTimezone?.timezone ||
      userTimezone.timezone === 'UTC' ||
      userTimezone.timezoneAutoDetected
    ) {
      const detectedTimezone = await TimezoneService.detectTimezone(request, userId);
      if (detectedTimezone !== 'UTC') {
        await prisma.user.update({
          where: { id: userId },
          data: {
            timezone: detectedTimezone,
            timezoneAutoDetected: true,
          },
        });
        request.log.info(
          {
            userId,
            timezone: detectedTimezone,
          },
          'Auto-detected and saved timezone during login'
        );
      }
    }
  }

  private static async requireTwoFactorIfNeeded(params: {
    userId: string;
    email: string;
    request: FastifyRequest;
    redis: Redis;
  }): Promise<LoginResult | null> {
    const { userId, email, request, redis } = params;
    const userWithTwoFactor = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        twoFactorEnabled: true,
        twoFactorMethod: true,
      },
    });
    if (!userWithTwoFactor?.twoFactorEnabled) {
      return null;
    }

    const pendingKey = `2fa-pending:${email}`;
    const method = userWithTwoFactor.twoFactorMethod || null;
    const { TwoFactorService } = await import('./two-factor.js');
    const trustedDeviceToken = request.cookies?.trusted_device;

    if (trustedDeviceToken) {
      const trustedUserId = await TwoFactorService.isTrustedDevice(trustedDeviceToken);
      if (trustedUserId === userId) {
        return null;
      }
    }

    await redis.setex(pendingKey, 300, userId);
    if (method === 'email') {
      await TwoFactorService.sendEmailCode(userId);
    }
    return {
      outcome: '2fa_required',
      method,
      message: 'Two-factor authentication required',
    };
  }

  private static async buildAuthenticatedLoginResult(params: {
    fastify: FastifyInstance;
    request: FastifyRequest;
    user: {
      id: string;
      email: string;
      name: string | null;
      password: string | null;
      subscriptionTier: string | null;
    };
    ipAddress: string;
    userAgent: string | undefined;
    stableFingerprint?: string | null;
    deviceName?: string;
  }): Promise<LoginResult> {
    const { fastify, request, user, ipAddress, userAgent, stableFingerprint, deviceName } = params;

    if (stableFingerprint) {
      await revokeSameDeviceSessions(user.id, stableFingerprint, request);
    }

    const { refreshToken, accessToken } = await RefreshTokenService.generateRefreshToken(
      fastify,
      user.id,
      ipAddress,
      userAgent,
      {
        deviceFingerprint: stableFingerprint || undefined,
        deviceName,
        ipAddress,
        userAgent,
      }
    );

    await AuditLogger.logAuth(AuditEventType.USER_LOGIN, user.id, user.email, request);
    await AuditLogger.resetFailedLoginAttempts(user.email);

    return {
      outcome: 'authenticated',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        subscriptionTier: user.subscriptionTier ?? null,
      },
      accessToken,
      refreshToken,
    };
  }

  /**
   * Register a new user and issue tokens.
   * Assumes signup gating has already been performed at the route level.
   */
  static async register(context: RegisterContext): Promise<RegisterResult> {
    const { fastify, input, ipAddress, userAgent, deviceFingerprint, deviceName } = context;
    const { email, password, name, timezone } = input;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new APIError('User already exists', 'USER_ALREADY_EXISTS', 409, { email });
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
    const { refreshToken, accessToken } = await RefreshTokenService.generateRefreshToken(
      fastify,
      user.id,
      ipAddress,
      userAgent,
      {
        deviceFingerprint: deviceFingerprint || undefined,
        deviceName,
        ipAddress,
        userAgent,
      }
    );

    logger.info('User registered successfully', {
      userId: user.id,
    });

    return {
      user,
      accessToken,
      refreshToken,
    };
  }

  /**
   * Core login flow including lockout and 2FA pre-steps.
   */
  static async login(context: LoginContext): Promise<LoginResult> {
    const { fastify, request, redis, input, ipAddress, userAgent, stableFingerprint, deviceName } =
      context;
    const { email, password } = input;

    const isLocked = await AuditLogger.isAccountLocked(email);
    if (isLocked) {
      return this.lockedResult();
    }

    const authResult = await this.authenticateCredentials(email, password, request);
    if (authResult.outcome !== 'authenticated_user') {
      return authResult.result;
    }
    const user = authResult.user;
    await this.syncUserTimezoneOnLogin(request, user.id);

    const twoFactorResult = await this.requireTwoFactorIfNeeded({
      userId: user.id,
      email,
      request,
      redis,
    });
    if (twoFactorResult) {
      return twoFactorResult;
    }

    return this.buildAuthenticatedLoginResult({
      fastify,
      request,
      user,
      ipAddress,
      userAgent,
      stableFingerprint,
      deviceName,
    });
  }
}
