import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { TwoFactorService, type TwoFactorMethod } from '../services/two-factor.js';
import { validateAndSanitize } from '../middleware/validation.js';
import { twoFactorSetupSchema, twoFactorVerifySchema } from '../schemas/auth.js';
import { enhancedRateLimiters } from '../services/enhanced-rate-limiter.js';
import { isProductionEnv } from '../utils/env-mode.js';

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

interface TwoFactorSetupBody {
  type: 'totp' | 'sms' | 'email';
  phoneNumber?: string;
}

type TwoFactorVerifyBody = { code: string; trustDevice: boolean };

interface PasswordBody {
  password: string;
}

function ensureAuth(request: FastifyRequest, reply: FastifyReply): request is AuthedRequest {
  if (!('user' in request) || !request.user) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function registerSetupRoute(fastify: FastifyInstance) {
  fastify.post<{ Body: TwoFactorSetupBody }>(
    '/2fa/setup',
    {
      preHandler: [fastify.authenticate, validateAndSanitize(twoFactorSetupSchema)],
    },
    async (request, reply) => {
      if (!ensureAuth(request, reply)) {
        return;
      }

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
}

function registerVerifySetupRoute(fastify: FastifyInstance) {
  fastify.post<{ Body: TwoFactorVerifyBody }>(
    '/2fa/verify-setup',
    {
      preHandler: [fastify.authenticate, validateAndSanitize(twoFactorVerifySchema)],
    },
    async (request, reply) => {
      if (!ensureAuth(request, reply)) {
        return;
      }

      const { code } = request.body;
      const userId = request.user.id;
      const result = await TwoFactorService.verifySetup(userId, code, request.ip);

      if (!result.success) {
        return reply.code(400).send({ error: result.message });
      }

      return reply.send({ success: true, message: result.message });
    }
  );
}

function completeLoginSession(request: SessionRequest, userId: string) {
  const session = request.session;
  if (!session) {
    return;
  }

  delete session.pendingUserId;
  session.userId = userId;
  session.authenticated = true;
}

function setTrustedDeviceCookie(reply: FastifyReply, trustedToken: string | undefined) {
  if (!trustedToken) {
    return;
  }

  reply.setCookie('trusted_device', trustedToken, {
    httpOnly: true,
    secure: isProductionEnv(),
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
}

function registerVerifyLoginRoute(fastify: FastifyInstance) {
  fastify.post<{ Body: TwoFactorVerifyBody }>(
    '/2fa/verify',
    {
      preHandler: [validateAndSanitize(twoFactorVerifySchema), enhancedRateLimiters.strict()],
    },
    async (request, reply) => {
      const sessionRequest = request as SessionRequest;
      const { code, trustDevice } = request.body;
      const userId = sessionRequest.session?.pendingUserId;

      if (!userId) {
        return reply.code(401).send({ error: 'No pending authentication' });
      }

      const result = await TwoFactorService.verifyCode(userId, code, trustDevice, request.ip);
      if (!result.success) {
        return reply.code(401).send({ error: result.message });
      }

      completeLoginSession(sessionRequest, userId);
      setTrustedDeviceCookie(reply, result.trustedToken);

      return reply.send({
        success: true,
        message: 'Authentication complete',
      });
    }
  );
}

function registerSendCodeRoute(fastify: FastifyInstance) {
  fastify.post(
    '/2fa/send-code',
    {
      preHandler: [fastify.authenticate, enhancedRateLimiters.emailVerification()],
    },
    async (request, reply) => {
      if (!ensureAuth(request, reply)) {
        return;
      }

      const result = await TwoFactorService.sendEmailCode(request.user.id);
      if (!result.success) {
        return reply.code(400).send({ error: result.message });
      }

      return reply.send({ success: true, message: result.message });
    }
  );
}

function registerDisableRoute(fastify: FastifyInstance) {
  fastify.post<{ Body: PasswordBody }>(
    '/2fa/disable',
    {
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      if (!ensureAuth(request, reply)) {
        return;
      }

      const { password } = request.body;
      if (!password) {
        return reply.code(400).send({ error: 'Password is required' });
      }

      const result = await TwoFactorService.disableTwoFactor(request.user.id, password, request.ip);
      if (!result.success) {
        return reply.code(400).send({ error: result.message });
      }

      return reply.send({ success: true, message: result.message });
    }
  );
}

function registerRegenerateBackupCodesRoute(fastify: FastifyInstance) {
  fastify.post<{ Body: PasswordBody }>(
    '/2fa/regenerate-backup-codes',
    {
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      if (!ensureAuth(request, reply)) {
        return;
      }

      const { password } = request.body;
      if (!password) {
        return reply.code(400).send({ error: 'Password is required' });
      }

      const result = await TwoFactorService.regenerateBackupCodes(request.user.id, password);
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
}

async function loadTwoFactorStatus(userId: string) {
  const { getDatabaseClient } = await import('../config/database.js');
  const prisma = getDatabaseClient();

  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      twoFactorEnabled: true,
      twoFactorMethod: true,
      twoFactorPhoneNumber: true,
    },
  });
}

function registerStatusRoute(fastify: FastifyInstance) {
  fastify.get(
    '/2fa/status',
    {
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      if (!ensureAuth(request, reply)) {
        return;
      }

      const user = await loadTwoFactorStatus(request.user.id);
      return reply.send({
        enabled: user?.twoFactorEnabled || false,
        method: user?.twoFactorMethod || null,
        phoneNumber: user?.twoFactorPhoneNumber
          ? `***${user.twoFactorPhoneNumber.slice(-4)}`
          : null,
      });
    }
  );
}

function registerTwoFactorRoutes(fastify: FastifyInstance) {
  registerSetupRoute(fastify);
  registerVerifySetupRoute(fastify);
  registerVerifyLoginRoute(fastify);
  registerSendCodeRoute(fastify);
  registerDisableRoute(fastify);
  registerRegenerateBackupCodesRoute(fastify);
  registerStatusRoute(fastify);
}

const twoFactorRoutes: FastifyPluginAsync = async (fastify) => {
  registerTwoFactorRoutes(fastify);
};

export default twoFactorRoutes;
