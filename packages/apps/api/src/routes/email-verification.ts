import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { EmailVerificationService } from '../services/email-verification.js';
import { enhancedRateLimiters } from '../services/enhanced-rate-limiter.js';

interface VerifyEmailBody {
  token: string;
}

const emailVerificationRoutes: FastifyPluginAsync = async (fastify) => {
  // Send verification email (authenticated route with rate limiting)
  fastify.post(
    '/email/send-verification',
    {
      async preHandler(request: FastifyRequest, reply) {
        // Run authentication first
        try {
          if (fastify.authenticate) {
            await fastify.authenticate(request, reply);
            // If authenticate sent a response, don't continue
            if (reply.sent) {
              return;
            }
          } else {
            return reply.code(401).send({ error: 'Authentication required' });
          }
          // Then apply rate limiting
          await enhancedRateLimiters.emailVerification()(request, reply);
        } catch {
          // Authentication failed, response already sent
          return;
        }
      },
    },
    async (request: FastifyRequest, reply) => {
      // Authentication is guaranteed by preHandler, user will always be valid here
      const userId = request.user!.id;

      const result = await EmailVerificationService.sendVerificationEmail(userId);

      if (!result.success) {
        return reply.code(400).send({ error: result.message });
      }

      return reply.send({
        success: true,
        message: result.message,
      });
    }
  );

  // Verify email with token (public route)
  fastify.post<{ Body: VerifyEmailBody }>('/email/verify', async (request, reply) => {
    const { token } = request.body;

    if (!token) {
      return reply.code(400).send({ error: 'Verification token is required' });
    }

    const result = await EmailVerificationService.verifyEmail(token);

    if (!result.success) {
      return reply.code(400).send({ error: result.message });
    }

    return reply.send({
      success: true,
      message: result.message,
      userId: result.userId,
    });
  });

  // Get verification status (authenticated route)
  fastify.get(
    '/email/verification-status',
    {
      async preHandler(request: FastifyRequest, reply) {
        // Run authentication
        try {
          if (fastify.authenticate) {
            await fastify.authenticate(request, reply);
            // If authenticate sent a response, don't continue
            if (reply.sent) {
              return;
            }
          } else {
            return reply.code(401).send({ error: 'Authentication required' });
          }
        } catch {
          // Authentication failed, response already sent
          return;
        }
      },
    },
    async (request: FastifyRequest, reply) => {
      // Authentication is guaranteed by preHandler, user will always be valid here
      const userId = request.user!.id;

      const status = await EmailVerificationService.getVerificationStatus(userId);

      return reply.send(status);
    }
  );

  // Check if email verification is configured
  fastify.get('/email/verification-config', async (request, reply) => {
    return reply.send({
      configured: EmailVerificationService.isConfigured(),
      message: EmailVerificationService.isConfigured()
        ? 'Email verification is available'
        : 'Email verification requires SMTP configuration',
    });
  });
};

export default emailVerificationRoutes;
