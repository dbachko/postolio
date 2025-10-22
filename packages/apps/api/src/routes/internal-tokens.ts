import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { getTokenService } from '../services/service-clients.js';

// Token encryption configuration
const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('TOKEN_ENCRYPTION_KEY environment variable is required for token encryption');
}

// Validate encryption key format (256 bits = 64 hex characters for AES-256)
if (!/^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY)) {
  throw new Error(
    'TOKEN_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (256 bits). ' +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  );
}

// Request schema
const GetTokenSchema = z.object({
  brandId: z.string().min(1),
  platform: z.enum(['instagram', 'facebook', 'linkedin']),
  requesterId: z.string().min(1), // User ID making the request
});

// Response schema
const TokenResponseSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.string().optional(),
  accountId: z.string().optional(),
  pageId: z.string().optional(),
});

const internalTokenRoutes: FastifyPluginAsync = async (fastify) => {
  // Internal token retrieval endpoint (for service-to-service communication)
  fastify.post(
    '/api/internal/tokens/get',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        // Parse and validate request
        const { brandId, platform, requesterId } = GetTokenSchema.parse(request.body);

        // Log token access for audit
        fastify.log.info({
          action: 'token.access.requested',
          brandId,
          platform,
          requesterId,
          source: request.headers['user-agent'] || 'unknown',
          ip: request.ip,
        });

        // Verify the requester owns this brand
        const brand = await prisma.brand.findUnique({
          where: { id: brandId },
          include: {
            user: {
              select: { id: true, email: true },
            },
          },
        });

        if (!brand || brand.userId !== requesterId) {
          fastify.log.warn({
            action: 'token.access.denied',
            reason: !brand ? 'brand_not_found' : 'unauthorized',
            brandId,
            requesterId,
            actualOwnerId: brand?.userId,
          });
          return reply.code(404).send({
            error: 'Brand not found',
          });
        }

        // Get the token from Token Service
        const tokenServiceClient = await getTokenService();
        const token = await tokenServiceClient.getToken(brand.user.id, brand.id, platform);

        if (!token) {
          return reply.code(404).send({
            error: `No ${platform} token found for brand`,
          });
        }

        interface TokenDataBase {
          accessToken: string;
          accountId?: string | null;
          pageId?: string | null;
          expiresAt?: string;
        }
        let tokenData: TokenDataBase | undefined;

        switch (platform) {
          case 'instagram': {
            tokenData = {
              accessToken: token.accessToken,
              accountId: token.metadata?.accountId || brand.instagramAccountId,
              pageId: token.metadata?.pageId || brand.instagramPageId,
            };

            // Token Service handles refresh automatically
            const preferences =
              typeof brand.preferences === 'object' &&
              brand.preferences &&
              !Array.isArray(brand.preferences)
                ? (brand.preferences as Record<string, unknown>)
                : undefined;
            const tokenExpiresAt =
              preferences && typeof preferences.tokenExpiresAt === 'string'
                ? preferences.tokenExpiresAt
                : undefined;
            if (tokenExpiresAt) {
              const expiryDate = new Date(tokenExpiresAt);
              const daysUntilExpiry = Math.floor(
                (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
              );

              // Refresh if expiring in less than 7 days
              if (daysUntilExpiry < 7) {
                fastify.log.info({
                  action: 'token.refresh.needed',
                  brandId,
                  platform,
                  daysUntilExpiry,
                });

                // TODO: Implement token refresh logic
                // For now, just log a warning
                fastify.log.warn(
                  `Instagram token for brand ${brandId} expires in ${daysUntilExpiry} days`
                );
              }

              tokenData.expiresAt = tokenExpiresAt;
            }
            break;
          }

          case 'facebook':
            // TODO: Implement Facebook token retrieval
            return reply.code(501).send({
              error: 'Facebook platform not yet implemented',
            });

          case 'linkedin':
            // TODO: Implement LinkedIn token retrieval
            return reply.code(501).send({
              error: 'LinkedIn platform not yet implemented',
            });

          default:
            return reply.code(400).send({
              error: `Unsupported platform: ${platform}`,
            });
        }

        // Log successful token access
        fastify.log.info({
          action: 'token.access.granted',
          brandId,
          platform,
          requesterId,
        });

        // Return token data
        return reply.send(
          TokenResponseSchema.parse(tokenData || { accessToken: token.accessToken })
        );
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'Invalid request',
            details: error.errors,
          });
        }

        fastify.log.error({
          action: 'token.access.error',
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        });

        return reply.code(500).send({
          error: 'Internal server error',
        });
      }
    }
  );

  // Token encryption endpoint removed - tokens are now stored in Token Service
};

export default internalTokenRoutes;
