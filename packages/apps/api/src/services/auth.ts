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

    // Check if account is locked before proceeding
    const isLocked = await AuditLogger.isAccountLocked(email);
    if (isLocked) {
      return {
        outcome: 'locked',
        message:
          'Account temporarily locked due to multiple failed login attempts. Please try again later.',
      };
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
        return {
          outcome: 'locked',
          message:
            'Account temporarily locked due to multiple failed login attempts. Please try again later.',
        };
      }

      return {
        outcome: 'invalid_credentials',
        message: 'Invalid credentials',
      };
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
        request.log.info(
          {
            userId: user.id,
            timezone: detectedTimezone,
          },
          'Auto-detected and saved timezone during login'
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
      const pendingKey = `2fa-pending:${email}`;
      const method = userWithTwoFactor.twoFactorMethod || null;

      const { TwoFactorService } = await import('./two-factor.js');
      const trustedDeviceToken = request.cookies?.trusted_device;

      if (trustedDeviceToken) {
        const trustedUserId = await TwoFactorService.isTrustedDevice(trustedDeviceToken);
        if (trustedUserId !== user.id) {
          // Need 2FA verification
          await redis.setex(pendingKey, 300, user.id); // 5 minutes to complete 2FA

          if (method === 'email') {
            await TwoFactorService.sendEmailCode(user.id);
          }

          return {
            outcome: '2fa_required',
            method,
            message: 'Two-factor authentication required',
          };
        }
        // Trusted device case: fall through and treat as authenticated below.
      } else {
        // No trusted device token; require 2FA
        await redis.setex(pendingKey, 300, user.id); // 5 minutes to complete 2FA

        if (method === 'email') {
          await TwoFactorService.sendEmailCode(user.id);
        }

        return {
          outcome: '2fa_required',
          method,
          message: 'Two-factor authentication required',
        };
      }
    }

    // Resolve stable device identifier has already been done in route; here we only use it
    if (stableFingerprint) {
      await revokeSameDeviceSessions(user.id, stableFingerprint, request);
    }

    // Generate tokens with refresh token rotation and session tracking
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

    // Log successful login and reset failed attempts
    await AuditLogger.logAuth(AuditEventType.USER_LOGIN, user.id, user.email, request);
    await AuditLogger.resetFailedLoginAttempts(user.email);

    const { password: _password, ...userWithoutPassword } = user;
    void _password;

    return {
      outcome: 'authenticated',
      user: {
        id: userWithoutPassword.id,
        email: userWithoutPassword.email,
        name: userWithoutPassword.name,
        subscriptionTier: userWithoutPassword.subscriptionTier ?? null,
      },
      accessToken,
      refreshToken,
    };
  }
}
