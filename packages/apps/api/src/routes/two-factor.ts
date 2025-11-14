import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { TwoFactorService, TwoFactorMethod } from '../services/two-factor.js';
import { validateAndSanitize } from '../middleware/validation.js';
import { twoFactorSetupSchema, twoFactorVerifySchema } from '../schemas/auth.js';
import { enhancedRateLimiters } from '../services/enhanced-rate-limiter.js';
import { isProductionEnv } from '../utils/env-mode.js';

const twoFactorRoutes: FastifyPluginAsync = async (fastify) => {
  // Narrowed request types used in handlers
  interface SessionData {
    pendingUserId?: string;
    userId?: string;
    authenticated?: boolean;
  }
  interface AuthedRequest extends FastifyRequest {
    user: { id: string; email: string };
    session?: SessionData;
  }
  interface SessionRequest extends FastifyRequest {
    session?: SessionData;
  }

  function ensureAuth(request: FastifyRequest, reply: FastifyReply): request is AuthedRequest {
    if (!('user' in request) || !request.user) {
      reply.code(401).send({ error: 'Unauthorized' });
      return false;
    }
    return true;
  }

  // Setup two-factor authentication
  // Schema likely validates a field named 'method' or 'type'; support both with union and normalize.
  interface TwoFactorSetupBody {
    type: 'totp' | 'sms' | 'email';
    phoneNumber?: string;
  }
  fastify.post<{ Body: TwoFactorSetupBody }>(
    '/2fa/setup',
    {
      preHandler: [fastify.authenticate, validateAndSanitize(twoFactorSetupSchema)],
    },
    async (request, reply) => {
      if (!ensureAuth(request, reply)) return;
      const { type, phoneNumber } = request.body;
      const userId = request.user.id;

      const result = await TwoFactorService.setupTwoFactor(
        userId,
        type as TwoFactorMethod,
        phoneNumber
      );

      if (!result.success) {
        return reply.code(400).send({ error: result.message });
      }

      return reply.send({
        success: true,
        qrCode: result.qrCode,
        secret: result.secret,
        backupCodes: result.backupCodes,
        message: result.message,
      });
    }
  );

  // Verify two-factor setup
  // Shared verification body matches sanitized schema (trustDevice defaults to false and is always boolean)
  type TwoFactorVerifyBody = { code: string; trustDevice: boolean };
  fastify.post<{ Body: TwoFactorVerifyBody }>(
    '/2fa/verify-setup',
    {
      preHandler: [fastify.authenticate, validateAndSanitize(twoFactorVerifySchema)],
    },
    async (request, reply) => {
      if (!ensureAuth(request, reply)) return;
      const { code } = request.body; // trustDevice ignored for setup verification
      const userId = request.user.id;
      const ipAddress = request.ip;

      const result = await TwoFactorService.verifySetup(userId, code, ipAddress);

      if (!result.success) {
        return reply.code(400).send({ error: result.message });
      }

      return reply.send({
        success: true,
        message: result.message,
      });
    }
  );

  // Verify two-factor code during login
  fastify.post<{ Body: TwoFactorVerifyBody }>(
    '/2fa/verify',
    {
      preHandler: [validateAndSanitize(twoFactorVerifySchema), enhancedRateLimiters.strict()],
    },
    async (request, reply) => {
      const { code, trustDevice } = request.body;
      const userId = (request as SessionRequest).session?.pendingUserId; // Set during login when 2FA is required
      const ipAddress = request.ip;

      if (!userId) {
        return reply.code(401).send({ error: 'No pending authentication' });
      }

      const result = await TwoFactorService.verifyCode(userId, code, trustDevice, ipAddress);

      if (!result.success) {
        return reply.code(401).send({ error: result.message });
      }

      // Complete login
      const session = (request as SessionRequest).session;
      if (session) {
        delete session.pendingUserId;
        session.userId = userId;
        session.authenticated = true;
      }

      // Set trusted device cookie if requested
      if (result.trustedToken) {
        reply.setCookie('trusted_device', result.trustedToken, {
          httpOnly: true,
          secure: isProductionEnv(),
          sameSite: 'lax',
          path: '/',
          maxAge: 30 * 24 * 60 * 60, // 30 days
        });
      }

      return reply.send({
        success: true,
        message: 'Authentication complete',
      });
    }
  );

  // Send email code for email-based 2FA
  fastify.post(
    '/2fa/send-code',
    {
      preHandler: [fastify.authenticate, enhancedRateLimiters.emailVerification()],
    },
    async (request, reply) => {
      if (!ensureAuth(request, reply)) return;
      const userId = request.user.id;

      const result = await TwoFactorService.sendEmailCode(userId);

      if (!result.success) {
        return reply.code(400).send({ error: result.message });
      }

      return reply.send({
        success: true,
        message: result.message,
      });
    }
  );

  // Disable two-factor authentication
  interface PasswordBody {
    password: string;
  }
  fastify.post<{ Body: PasswordBody }>(
    '/2fa/disable',
    {
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      if (!ensureAuth(request, reply)) return;
      const { password } = request.body;
      const userId = request.user.id;
      const ipAddress = request.ip;

      if (!password) {
        return reply.code(400).send({ error: 'Password is required' });
      }

      const result = await TwoFactorService.disableTwoFactor(userId, password, ipAddress);

      if (!result.success) {
        return reply.code(400).send({ error: result.message });
      }

      return reply.send({
        success: true,
        message: result.message,
      });
    }
  );

  // Regenerate backup codes
  fastify.post<{ Body: PasswordBody }>(
    '/2fa/regenerate-backup-codes',
    {
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      if (!ensureAuth(request, reply)) return;
      const { password } = request.body;
      const userId = request.user.id;

      if (!password) {
        return reply.code(400).send({ error: 'Password is required' });
      }

      const result = await TwoFactorService.regenerateBackupCodes(userId, password);

      if (!result.success) {
        return reply.code(400).send({ error: result.message });
      }

      return reply.send({
        success: true,
        backupCodes: result.backupCodes,
        message: result.message,
      });
    }
  );

  // Get two-factor status
  fastify.get(
    '/2fa/status',
    {
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      if (!ensureAuth(request, reply)) return;
      const userId = request.user.id;

      const { getDatabaseClient } = await import('../config/database.js');
      const prisma = getDatabaseClient();

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          twoFactorEnabled: true,
          twoFactorMethod: true,
          twoFactorPhoneNumber: true,
        },
      });

      return reply.send({
        enabled: user?.twoFactorEnabled || false,
        method: user?.twoFactorMethod || null,
        phoneNumber: user?.twoFactorPhoneNumber
          ? `***${user.twoFactorPhoneNumber.slice(-4)}`
          : null,
      });
    }
  );
};

export default twoFactorRoutes;
