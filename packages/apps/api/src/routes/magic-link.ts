import { FastifyPluginAsync } from 'fastify';
import { MagicLinkService } from '../services/magic-link.js';
import { isProductionEnv } from '../utils/env-mode.js';
import { enhancedRateLimiters } from '../services/enhanced-rate-limiter.js';
import { getClientIp, getUserAgent, parseDeviceName } from '../utils/request-info.js';
import { RefreshTokenService } from '../services/refresh-token.js';
import { AuditLogger, AuditEventType } from '../services/audit-logger.js';
import { ensureDeviceId } from '../utils/device-id.js';
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

const magicLinkRoutes: FastifyPluginAsync = async (fastify) => {
  // Send magic link with rate limiting
  fastify.post<{ Body: SendMagicLinkBody }>(
    '/magic-link/send',
    {
      preHandler: enhancedRateLimiters.magicLink(),
    },
    async (request, reply) => {
      const { email, isSignUp = false } = request.body;

      if (!email) {
        return reply.code(400).send({ error: 'Email is required' });
      }

      // Check if email service is configured (allow fallback via unified flag or dev)
      const allowLoggingFallback = process.env.AUTH_MAGIC_LINK_ENABLED === 'true';
      if (
        !MagicLinkService.isConfigured() &&
        !(process.env.NODE_ENV === 'dev' || allowLoggingFallback)
      ) {
        return reply.code(503).send({
          error: 'Email service not configured',
          message: 'Magic link authentication is not available at this time',
        });
      }

      const result = await MagicLinkService.sendMagicLink(email, isSignUp);

      if (!result.success) {
        return reply.code(400).send({ error: result.message });
      }

      return reply.send({
        success: true,
        message: result.message,
      });
    }
  );

  // Verify magic link token
  fastify.post<{ Body: VerifyMagicLinkBody }>('/magic-link/verify', async (request, reply) => {
    const { token } = request.body;

    if (!token) {
      return reply.code(400).send({ error: 'Token is required' });
    }

    const result = await MagicLinkService.verifyMagicLink(fastify, token);

    if (!result.success || !result.user) {
      return reply.code(401).send({ error: result.message || 'Invalid or expired magic link' });
    }

    const user = result.user;

    // Resolve stable device identifier and set cookie if needed
    const stableFingerprint = ensureDeviceId(request, reply, request.body.deviceFingerprint);

    // Revoke any existing active session for this device to avoid duplicates
    if (stableFingerprint) {
      await revokeSameDeviceSessions(user.id, stableFingerprint, request);
    }

    // Create a standard session with refresh token + access token
    const ipAddress = getClientIp(request);
    const userAgent = getUserAgent(request);
    const humanDeviceName = request.body.deviceName || parseDeviceName(userAgent);

    const { refreshToken, accessToken } = await RefreshTokenService.generateRefreshToken(
      fastify,
      user.id,
      ipAddress,
      userAgent,
      {
        deviceFingerprint: stableFingerprint,
        deviceName: humanDeviceName,
        ipAddress,
        userAgent,
      }
    );

    // Set access token (short-lived)
    reply.setCookie('auth_token', accessToken, {
      httpOnly: true,
      secure: isProductionEnv(),
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60, // 1 hour
    });

    // Set refresh token (scoped so logout/refresh can read it)
    reply.setCookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: isProductionEnv(),
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    // Log magic link verified + login
    await AuditLogger.logAuth(AuditEventType.MAGIC_LINK_VERIFIED, user.id, user.email, request);

    return reply.send({
      success: true,
      user,
      message: 'Signed in with magic link',
    });
  });

  // Check if magic link is configured
  fastify.get('/magic-link/status', async (request, reply) => {
    const allowLoggingFallback = process.env.AUTH_MAGIC_LINK_ENABLED === 'true';
    const configured =
      MagicLinkService.isConfigured() || process.env.NODE_ENV === 'dev' || allowLoggingFallback;
    return reply.send({
      configured,
      message: configured
        ? !MagicLinkService.isConfigured() &&
          (process.env.NODE_ENV === 'dev' || allowLoggingFallback)
          ? 'Magic link available (logging fallback active: link is printed to API logs)'
          : 'Magic link authentication is available'
        : 'Magic link authentication requires email (SMTP/SES) configuration',
    });
  });
};

export default magicLinkRoutes;
