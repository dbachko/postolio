import { FastifyPluginAsync } from 'fastify';
import { MagicLinkService } from '../services/magic-link.js';
import { enhancedRateLimiters } from '../services/enhanced-rate-limiter.js';

interface SendMagicLinkBody {
  email: string;
  isSignUp?: boolean;
}

interface VerifyMagicLinkBody {
  token: string;
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

      // Check if email service is configured
      if (!MagicLinkService.isConfigured()) {
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

    if (!result.success) {
      return reply.code(401).send({ error: result.message });
    }

    // Set HTTP-only cookie for enhanced security
    reply.setCookie('auth_token', result.token!, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return reply.send({
      success: true,
      token: result.token,
      user: result.user,
    });
  });

  // Check if magic link is configured
  fastify.get('/magic-link/status', async (request, reply) => {
    return reply.send({
      configured: MagicLinkService.isConfigured(),
      message: MagicLinkService.isConfigured()
        ? 'Magic link authentication is available'
        : 'Magic link authentication requires SMTP configuration',
    });
  });
};

export default magicLinkRoutes;
