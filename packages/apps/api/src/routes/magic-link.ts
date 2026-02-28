import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { AuditLogger, AuditEventType } from '../services/audit-logger.js';
import { enhancedRateLimiters } from '../services/enhanced-rate-limiter.js';
import { MagicLinkService } from '../services/magic-link.js';
import { RefreshTokenService } from '../services/refresh-token.js';
import { signupsAllowedForEmail } from '../utils/access-control.js';
import { ensureDeviceId } from '../utils/device-id.js';
import { isProductionEnv } from '../utils/env-mode.js';
import { getClientIp, getUserAgent, parseDeviceName } from '../utils/request-info.js';
import { revokeSameDeviceSessions } from '../utils/session-dedup.js';

interface SendMagicLinkBody {
  email: string;
  isSignUp?: boolean;
}

interface VerifyMagicLinkBody {
  token: string;
  deviceFingerprint?: string;
  deviceName?: string;
}

function allowMagicLinkLoggingFallback(): boolean {
  return process.env.AUTH_MAGIC_LINK_ENABLED === 'true';
}

function registerSendMagicLinkRoute(fastify: FastifyInstance): void {
  fastify.post<{ Body: SendMagicLinkBody }>(
    '/magic-link/send',
    { preHandler: enhancedRateLimiters.magicLink() },
    async (request, reply) => {
      const { email, isSignUp = false } = request.body;
      if (!email) {
        return reply.code(400).send({ error: 'Email is required' });
      }

      const allowFallback = allowMagicLinkLoggingFallback();
      const isDevMode = process.env.NODE_ENV === 'dev';
      if (!MagicLinkService.isConfigured() && !(isDevMode || allowFallback)) {
        return reply.code(503).send({
          error: 'Email service not configured',
          message: 'Magic link authentication is not available at this time',
        });
      }

      if (isSignUp) {
        const gate = signupsAllowedForEmail(email);
        if (!gate.allowed) {
          return reply
            .code(403)
            .send({ error: gate.message, code: gate.code, waitlistUrl: gate.waitlistUrl });
        }
      }

      const result = await MagicLinkService.sendMagicLink(email, isSignUp);
      if (!result.success) {
        return reply.code(400).send({ error: result.message });
      }

      return reply.send({ success: true, message: result.message });
    }
  );
}

async function createMagicLinkSession(
  fastify: FastifyInstance,
  request: FastifyRequest<{ Body: VerifyMagicLinkBody }>,
  reply: FastifyReply,
  user: { id: string; email: string }
): Promise<void> {
  const stableFingerprint = ensureDeviceId(request, reply, request.body.deviceFingerprint);

  if (stableFingerprint) {
    await revokeSameDeviceSessions(user.id, stableFingerprint, request);
  }

  const ipAddress = getClientIp(request);
  const userAgent = getUserAgent(request);
  const deviceName = request.body.deviceName || parseDeviceName(userAgent);

  const { refreshToken, accessToken } = await RefreshTokenService.generateRefreshToken(
    fastify,
    user.id,
    ipAddress,
    userAgent,
    {
      deviceFingerprint: stableFingerprint,
      deviceName,
      ipAddress,
      userAgent,
    }
  );

  reply.setCookie('auth_token', accessToken, {
    httpOnly: true,
    secure: isProductionEnv(),
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60,
  });

  reply.clearCookie('refresh_token', { path: '/' });
  reply.clearCookie('refresh_token', { path: '/api/auth/refresh' });
  reply.setCookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProductionEnv(),
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: 30 * 24 * 60 * 60,
  });
}

function registerVerifyMagicLinkRoute(fastify: FastifyInstance): void {
  fastify.post<{ Body: VerifyMagicLinkBody }>('/magic-link/verify', async (request, reply) => {
    const { token } = request.body;
    if (!token) {
      return reply.code(400).send({ error: 'Token is required' });
    }

    const result = await MagicLinkService.verifyMagicLink(fastify, token);
    if (!result.success || !result.user) {
      return reply.code(401).send({ error: result.message || 'Invalid or expired magic link' });
    }

    await createMagicLinkSession(fastify, request, reply, result.user);
    await AuditLogger.logAuth(
      AuditEventType.MAGIC_LINK_VERIFIED,
      result.user.id,
      result.user.email,
      request
    );

    return reply.send({
      success: true,
      user: result.user,
      message: 'Signed in with magic link',
    });
  });
}

function buildMagicLinkStatusMessage(configured: boolean): string {
  if (!configured) {
    return 'Magic link authentication requires email (SMTP/SES) configuration';
  }

  const allowFallback = allowMagicLinkLoggingFallback();
  const isFallbackMode =
    !MagicLinkService.isConfigured() && (process.env.NODE_ENV === 'dev' || allowFallback);
  if (isFallbackMode) {
    return 'Magic link available (logging fallback active: link is printed to API logs)';
  }

  return 'Magic link authentication is available';
}

function registerMagicLinkStatusRoute(fastify: FastifyInstance): void {
  fastify.get('/magic-link/status', async (_request, reply) => {
    const configured =
      MagicLinkService.isConfigured() ||
      process.env.NODE_ENV === 'dev' ||
      allowMagicLinkLoggingFallback();

    return reply.send({ configured, message: buildMagicLinkStatusMessage(configured) });
  });
}

const magicLinkRoutes: FastifyPluginAsync = async (fastify) => {
  registerSendMagicLinkRoute(fastify);
  registerVerifyMagicLinkRoute(fastify);
  registerMagicLinkStatusRoute(fastify);
};

export default magicLinkRoutes;
