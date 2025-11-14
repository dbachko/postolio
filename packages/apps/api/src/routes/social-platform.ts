import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PlatformName } from '@postolio/connectors';
import { prisma } from '../config/database.js';
import { ConnectorFactory } from '../services/connectors/index.js';
import { logger as baseLogger } from '@postolio/logger';
import { getRedisClient } from '../services/redis.js';
import { fetchTokensFromService } from '../utils/token-service-client.js';

const logger = baseLogger.child({ module: 'social-platform-routes' });

const PlatformParamSchema = z.object({
  platform: z.string(),
  brandId: z.string(),
});

const ContentIdSchema = z.object({
  platform: z.string(),
  contentId: z.string(),
});

function ensurePlatformSupported(platform: string) {
  if (!ConnectorFactory.supports(platform as PlatformName)) {
    return {
      statusCode: 400,
      body: {
        error: 'unsupported_platform',
        message: `Platform ${platform} is not yet supported`,
        supportedPlatforms: ConnectorFactory.supportedPlatforms(),
      },
    } as const;
  }
  return null;
}

/**
 * Generic social platform routes
 *
 * These routes work with ANY social platform through the Connector pattern.
 * No platform-specific logic in the routes - all handled by connectors.
 */
export async function socialPlatformRoutes(app: FastifyInstance) {
  /**
   * GET /api/social/health
   *
   * Health check endpoint for social platform connectors
   *
   * Returns availability and capabilities for all registered connectors.
   * Useful for monitoring and debugging platform integrations.
   */
  app.get('/api/social/health', async (req, reply) => {
    try {
      const results: Record<string, any> = {};
      const supportedPlatforms = ConnectorFactory.supportedPlatforms();

      for (const platform of supportedPlatforms) {
        try {
          const connector = ConnectorFactory.get(platform);
          results[platform] = {
            status: 'available',
            capabilities: connector.capabilities,
            rateLimits: connector.rateLimits,
          };
        } catch (error: any) {
          results[platform] = {
            status: 'unavailable',
            error: error.message,
          };
        }
      }

      return reply.send({
        success: true,
        connectors: results,
        totalAvailable: Object.values(results).filter((r: any) => r.status === 'available').length,
        totalRegistered: supportedPlatforms.length,
      });
    } catch (error: any) {
      logger.error('Health check failed', { error: error.message });
      return reply.code(500).send({
        success: false,
        error: 'Failed to check connector health',
      });
    }
  });

  /**
   * GET /api/social/:platform/status/:brandId
   *
   * Get connection status for a platform
   *
   * Returns whether the brand has connected this social platform,
   * along with account details if connected.
   *
   * @requires authentication
   * @requires brand ownership
   */
  app.get(
    '/api/social/:platform/status/:brandId',
    {
      preHandler: app.authenticate,
    },
    async (req, reply) => {
      try {
        const { platform, brandId } = PlatformParamSchema.parse(req.params);
        const userId = req.user!.id;

        const platformError = ensurePlatformSupported(platform);
        if (platformError) {
          return reply.code(platformError.statusCode).send(platformError.body);
        }

        // Verify user owns this brand
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId,
          },
        });

        if (!brand) {
          // Security audit: log unauthorized access attempt
          try {
            await prisma.auditLog.create({
              data: {
                userId,
                email: req.user!.email,
                eventType: 'social.unauthorized_access',
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
                metadata: {
                  brandId,
                  platform,
                  operation: 'status',
                },
                success: false,
              },
            });
          } catch (err: any) {
            logger.warn('Failed to create audit log', {
              error: err?.message ?? String(err),
            });
          }

          return reply.code(404).send({
            error: 'brand_not_found',
            message: 'Brand not found or access denied',
          });
        }

        // Check if social account exists
        const socialAccount = await prisma.socialAccount.findFirst({
          where: {
            brandId,
            platform: platform as any,
          },
        });

        if (!socialAccount) {
          return reply.send({
            connected: false,
            platform,
            account: null,
          });
        }

        // Return account info (user is authorized) + connector capabilities
        const connector = ConnectorFactory.get(platform as PlatformName);
        return reply.send({
          connected: true,
          platform,
          capabilities: connector.capabilities,
          account: {
            platform,
            id: socialAccount.id,
            username: socialAccount.username,
            displayName: socialAccount.displayName,
            externalAccountId: socialAccount.externalAccountId,
          },
        });
      } catch (error: any) {
        logger.error('Failed to get platform status', {
          error: error.message,
          params: req.params,
        });

        return reply.code(500).send({
          error: 'internal_error',
          message: 'Failed to check platform connection status',
        });
      }
    }
  );

  /**
   * POST /api/social/:platform/publish/:contentId
   *
   * Publish content to a specific platform
   *
   * This endpoint validates the content, gets the appropriate connector,
   * and publishes to the specified platform.
   *
   * @requires authentication
   */
  app.post(
    '/api/social/:platform/publish/:contentId',
    {
      preHandler: app.authenticate,
    },
    async (req, reply) => {
      try {
        const { platform, contentId } = ContentIdSchema.parse(req.params);
        const userId = req.user!.id;

        const platformError = ensurePlatformSupported(platform);
        if (platformError) {
          return reply.code(platformError.statusCode).send(platformError.body);
        }

        // Get content
        const content = await prisma.content.findUnique({
          where: { id: contentId },
          include: { brand: true },
        });

        if (!content) {
          return reply.code(404).send({
            error: 'content_not_found',
            message: `Content ${contentId} not found`,
          });
        }

        // Verify user owns the brand for this content
        if (content.brand.userId !== userId) {
          // Security audit: log unauthorized publish attempt
          try {
            await prisma.auditLog.create({
              data: {
                userId,
                email: req.user!.email,
                eventType: 'social.unauthorized_access',
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
                metadata: {
                  brandId: content.brandId,
                  platform,
                  operation: 'publish',
                  contentId,
                },
                success: false,
              },
            });
          } catch (err: any) {
            logger.warn('Failed to create audit log', {
              error: err?.message ?? String(err),
            });
          }

          return reply.code(403).send({
            error: 'forbidden',
            message: 'You do not have permission to publish this content',
          });
        }

        // Get social account for this platform
        const socialAccount = await prisma.socialAccount.findFirst({
          where: {
            brandId: content.brandId,
            platform: platform as any,
          },
        });

        if (!socialAccount) {
          return reply.code(400).send({
            error: 'Social account not connected',
            message: `Brand has not connected ${platform}`,
          });
        }

        // Get connector for platform
        const connector = ConnectorFactory.get(platform as PlatformName);

        // Get credentials from token service
        const tokens = await fetchTokensFromService(
          content.brand.userId,
          content.brandId,
          platform
        );

        if (!tokens || !tokens.accessToken) {
          return reply.code(401).send({
            error: 'invalid_credentials',
            message: `No valid credentials found for ${platform}`,
          });
        }

        // Validate content against platform limits
        const platformLimits: Record<
          string,
          { maxCaptionLength: number; maxHashtags: number | null }
        > = {
          instagram: { maxCaptionLength: 2200, maxHashtags: 30 },
          facebook: { maxCaptionLength: 63206, maxHashtags: null },
          linkedin: { maxCaptionLength: 3000, maxHashtags: null },
          x: { maxCaptionLength: 280, maxHashtags: null },
          youtube: { maxCaptionLength: 5000, maxHashtags: 15 },
          tiktok: { maxCaptionLength: 2200, maxHashtags: null },
        };

        const limits = platformLimits[platform];
        const caption = content.caption || '';
        const hashtags = content.hashtags || [];

        if (caption.length > limits.maxCaptionLength) {
          return reply.code(400).send({
            error: 'caption_too_long',
            message: `Caption exceeds ${platform} limit of ${limits.maxCaptionLength} characters`,
            maxLength: limits.maxCaptionLength,
            currentLength: caption.length,
          });
        }

        if (limits.maxHashtags && hashtags.length > limits.maxHashtags) {
          return reply.code(400).send({
            error: 'too_many_hashtags',
            message: `Too many hashtags for ${platform}. Maximum ${limits.maxHashtags} allowed`,
            maxHashtags: limits.maxHashtags,
            currentHashtags: hashtags.length,
          });
        }

        // Publish content using connector
        logger.info('Publishing content', {
          contentId,
          platform,
          brandId: content.brandId,
        });

        let publishResult;
        try {
          // Some connectors may not implement publishing; surface a clear error in that case.
          if (!connector.publish) {
            throw new Error(`Connector for ${platform} does not support publishing yet`);
          }

          publishResult = await connector.publish(
            {
              caption: content.caption || '',
              hashtags: content.hashtags || [],
              imageUrl: content.primaryAssetCdnUrl || undefined,
              mediaUrl: content.primaryAssetCdnUrl || undefined,
              mediaType: 'image', // TODO: Determine actual media type from asset
            },
            {
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken || undefined,
            },
            {
              platform: platform as PlatformName,
              externalAccountId: socialAccount.externalAccountId,
              externalPageId: socialAccount.externalPageId,
              username: socialAccount.username,
            }
          );
        } catch (publishError: any) {
          logger.error('Connector publish failed', {
            error: publishError.message,
            platform,
            contentId,
            code: publishError.code,
          });

          // Security audit: log failed publish attempt
          try {
            await prisma.auditLog.create({
              data: {
                userId: content.brand.userId,
                email: req.user!.email,
                eventType: 'social.content_publish_failed',
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
                metadata: {
                  brandId: content.brandId,
                  platform,
                  contentId,
                  errorCode: publishError.code,
                  errorMessage: publishError.message,
                },
                success: false,
              },
            });
          } catch (err: any) {
            logger.warn('Failed to create audit log', {
              error: err?.message ?? String(err),
            });
          }

          // Surface connector error message for observability in tests and logs
          return reply.code(500).send({
            error: publishError.message || 'publish_failed',
            message: `Failed to publish to ${platform}. Please try again.`,
          });
        }

        // Use transaction for database operations
        await prisma.$transaction(async (tx) => {
          // Create ContentPublication record
          await tx.contentPublication.create({
            data: {
              contentId,
              socialAccountId: socialAccount.id,
              platform: platform as any,
              externalPostId: publishResult.externalPostId,
              permalink: publishResult.permalink,
              publishedAt: new Date(publishResult.publishedAt),
              metadata: publishResult.metadata
                ? JSON.parse(JSON.stringify(publishResult.metadata))
                : undefined,
            },
          });

          // Update content status
          await tx.content.update({
            where: { id: contentId },
            data: {
              status: 'published',
              updatedAt: new Date(),
            },
          });
        });

        logger.info('Content published successfully', {
          contentId,
          platform,
          postId: publishResult.externalPostId,
        });

        // Security audit: log content publication
        try {
          await prisma.auditLog.create({
            data: {
              userId: content.brand.userId,
              email: req.user!.email,
              eventType: 'social.content_published',
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'],
              metadata: {
                brandId: content.brandId,
                platform,
                contentId,
                externalPostId: publishResult.externalPostId,
                permalink: publishResult.permalink,
              },
              success: true,
            },
          });
        } catch (err: any) {
          logger.warn('Failed to create audit log', {
            error: err?.message ?? String(err),
          });
        }

        return reply.send({
          success: true,
          platform,
          externalPostId: publishResult.externalPostId,
          permalink: publishResult.permalink,
          publication: {
            externalPostId: publishResult.externalPostId,
            permalink: publishResult.permalink,
            publishedAt: publishResult.publishedAt,
          },
        });
      } catch (error: any) {
        logger.error('Failed to publish content', {
          error: error.message,
          params: req.params,
        });

        return reply.code(500).send({
          error: 'publish_failed',
          message: error.message || 'Failed to publish content',
        });
      }
    }
  );

  /**
   * POST /api/social/:platform/sync/:brandId
   *
   * Sync recent posts from a platform
   *
   * Fetches recent posts from the platform and creates ContentPublication
   * records for any posts that don't already exist in the database.
   *
   * @requires authentication
   * @requires brand ownership
   */
  app.post(
    '/api/social/:platform/sync/:brandId',
    {
      preHandler: app.authenticate,
    },
    async (req, reply) => {
      try {
        const { platform, brandId } = PlatformParamSchema.parse(req.params);
        const userId = req.user!.id;

        const platformError = ensurePlatformSupported(platform);
        if (platformError) {
          return reply.code(platformError.statusCode).send(platformError.body);
        }

        // Verify user owns this brand
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId,
          },
        });

        if (!brand) {
          // Security audit: log unauthorized access attempt
          try {
            await prisma.auditLog.create({
              data: {
                userId,
                email: req.user!.email,
                eventType: 'social.unauthorized_access',
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
                metadata: {
                  brandId,
                  platform,
                  operation: 'sync',
                },
                success: false,
              },
            });
          } catch (err: any) {
            logger.warn('Failed to create audit log', {
              error: err?.message ?? String(err),
            });
          }

          return reply.code(404).send({
            error: 'brand_not_found',
            message: 'Brand not found or access denied',
          });
        }

        // Check rate limit cooldown
        const redis = getRedisClient();
        const SYNC_COOLDOWN_SECONDS = 300; // 5 minutes
        const cooldownKey = `sync:cooldown:${brandId}:${platform}`;

        if (redis) {
          const cooldownTtl = await redis.ttl(cooldownKey);
          if (cooldownTtl > 0) {
            // Security audit: log rate limit hit
            try {
              await prisma.auditLog.create({
                data: {
                  userId,
                  email: req.user!.email,
                  eventType: 'social.rate_limit_hit',
                  ipAddress: req.ip,
                  userAgent: req.headers['user-agent'],
                  metadata: {
                    brandId,
                    platform,
                    operation: 'sync',
                    retryAfter: cooldownTtl,
                  },
                  success: false,
                },
              });
            } catch (err: any) {
              logger.warn('Failed to create audit log', {
                error: err?.message ?? String(err),
              });
            }

            return reply.code(429).send({
              error: 'rate_limited',
              message: 'Sync cooldown active. Please wait before syncing again.',
              retryAfter: cooldownTtl,
              cooldownSeconds: SYNC_COOLDOWN_SECONDS,
            });
          }
        }

        // Get social account
        const socialAccount = await prisma.socialAccount.findFirst({
          where: {
            brandId,
            platform: platform as any,
          },
          include: { brand: true },
        });

        if (!socialAccount) {
          return reply.code(400).send({
            error: 'platform_not_connected',
            message: `Brand has not connected ${platform}`,
          });
        }

        // Get connector
        const connector = ConnectorFactory.get(platform as PlatformName);

        // Get credentials
        const tokens = await fetchTokensFromService(brand.userId, brandId, platform);

        if (!tokens || !tokens.accessToken) {
          return reply.code(401).send({
            error: 'invalid_credentials',
            message: `No valid credentials found for ${platform}`,
          });
        }

        // Fetch recent posts
        logger.info('Syncing posts from platform', {
          platform,
          brandId,
        });

        const result = await connector.listRecentPosts(
          {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
          },
          {
            platform: platform as PlatformName,
            externalAccountId: socialAccount.externalAccountId,
            externalPageId: socialAccount.externalPageId,
            username: socialAccount.username,
          },
          25 // Fetch 25 most recent posts
        );

        let syncedCount = 0;
        let skippedCount = 0;

        // Create ContentPublication records for new posts
        for (const post of result.data) {
          // Check if publication already exists
          const existing = await prisma.contentPublication.findFirst({
            where: {
              socialAccountId: socialAccount.id,
              externalPostId: post.id,
            },
          });

          if (existing) {
            skippedCount++;
            continue;
          }

          // Create content record (imported from platform)
          const content = await prisma.content.create({
            data: {
              brandId,
              caption: post.caption,
              hashtags: post.hashtags || [],
              primaryAssetCdnUrl: post.mediaUrl,
              status: 'published',
              createdAt: post.postedAt ? new Date(post.postedAt) : new Date(),
              updatedAt: new Date(),
            },
          });

          // Create publication record
          await prisma.contentPublication.create({
            data: {
              contentId: content.id,
              socialAccountId: socialAccount.id,
              platform: platform as any,
              externalPostId: post.id,
              permalink: post.permalink,
              publishedAt: post.postedAt ? new Date(post.postedAt) : new Date(),
              metadata: {
                imported: true,
                syncedAt: new Date().toISOString(),
              },
            },
          });

          syncedCount++;
        }

        logger.info('Posts synced successfully', {
          platform,
          brandId,
          syncedCount,
          skippedCount,
        });

        // Set cooldown to prevent abuse (not used in tests)
        if (redis) {
          await redis.setex(cooldownKey, SYNC_COOLDOWN_SECONDS, '1');
        }

        // Security audit: log sync operation
        try {
          await prisma.auditLog.create({
            data: {
              userId,
              email: req.user!.email,
              eventType: 'social.posts_synced',
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'],
              metadata: {
                brandId,
                platform,
                syncedCount,
                skippedCount,
                totalPosts: result.data.length,
              },
              success: true,
            },
          });
        } catch (err: any) {
          logger.warn('Failed to create audit log', {
            error: err?.message ?? String(err),
          });
        }

        return reply.send({
          success: true,
          platform,
          synced: syncedCount,
          skipped: skippedCount,
          total: result.data.length,
        });
      } catch (error: any) {
        logger.error('Failed to sync posts', {
          error: error.message,
          params: req.params,
        });

        return reply.code(500).send({
          error: 'sync_failed',
          message: error.message || 'Failed to sync posts from platform',
        });
      }
    }
  );

  /**
   * POST /api/social/:platform/disconnect/:brandId
   *
   * Disconnect a social platform from a brand
   *
   * Removes the SocialAccount and cleans up tokens.
   * ContentPublication records are kept for historical data.
   *
   * @requires authentication
   * @requires brand ownership
   */
  app.post(
    '/api/social/:platform/disconnect/:brandId',
    {
      preHandler: app.authenticate,
    },
    async (req, reply) => {
      try {
        const { platform, brandId } = PlatformParamSchema.parse(req.params);
        const userId = req.user!.id;

        const platformError = ensurePlatformSupported(platform);
        if (platformError) {
          return reply.code(platformError.statusCode).send(platformError.body);
        }

        // Verify user owns this brand
        const brand = await prisma.brand.findFirst({
          where: {
            id: brandId,
            userId,
          },
        });

        if (!brand) {
          // Security audit: log unauthorized access attempt
          try {
            await prisma.auditLog.create({
              data: {
                userId,
                email: req.user!.email,
                eventType: 'social.unauthorized_access',
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
                metadata: {
                  brandId,
                  platform,
                  operation: 'disconnect',
                },
                success: false,
              },
            });
          } catch (err: any) {
            logger.warn('Failed to create audit log', {
              error: err?.message ?? String(err),
            });
          }

          return reply.code(404).send({
            error: 'brand_not_found',
            message: 'Brand not found or access denied',
          });
        }

        // Get social account
        const socialAccount = await prisma.socialAccount.findFirst({
          where: {
            brandId,
            platform: platform as any,
          },
          include: { brand: true },
        });

        if (!socialAccount) {
          return reply.code(404).send({
            error: 'platform_not_connected',
            message: `Brand does not have ${platform} connected`,
          });
        }

        // Delete social account (cascade will handle relations)
        await prisma.socialAccount.delete({
          where: { id: socialAccount.id },
        });

        // TODO: Delete tokens from token-service
        // await deleteTokensFromService(socialAccount.brand.userId, platform, brandId);

        logger.info('Platform disconnected', {
          platform,
          brandId,
        });

        // Security audit: log platform disconnection
        try {
          await prisma.auditLog.create({
            data: {
              userId,
              email: req.user!.email,
              eventType: 'social.platform_disconnected',
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'],
              metadata: {
                brandId,
                platform,
                accountId: socialAccount.externalAccountId,
                username: socialAccount.username,
              },
              success: true,
            },
          });
        } catch (err: any) {
          logger.warn('Failed to create audit log', {
            error: err?.message ?? String(err),
          });
        }

        return reply.send({
          success: true,
          platform,
          message: `${platform} disconnected successfully`,
        });
      } catch (error: any) {
        logger.error('Failed to disconnect platform', {
          error: error.message,
          params: req.params,
        });

        return reply.code(500).send({
          error: 'disconnect_failed',
          message: error.message || 'Failed to disconnect platform',
        });
      }
    }
  );

  /**
   * GET /api/social/:platform/insights/:contentId
   *
   * Get insights/analytics for a published post
   *
   * Fetches metrics like impressions, reach, engagement, etc.
   * from the platform's API.
   *
   * @requires authentication
   */
  app.get(
    '/api/social/:platform/insights/:contentId',
    {
      preHandler: app.authenticate,
    },
    async (req, reply) => {
      try {
        const { platform, contentId } = ContentIdSchema.parse(req.params);

        // Validate platform support consistently
        const platformError = ensurePlatformSupported(platform);
        if (platformError) {
          return reply.code(platformError.statusCode).send(platformError.body);
        }

        // First, ensure content exists (for clearer 404 semantics)
        const content = await prisma.content.findUnique({
          where: { id: contentId },
          include: { brand: true },
        });

        if (!content) {
          return reply.code(404).send({
            error: 'content_not_found',
            message: `Content ${contentId} not found`,
          });
        }

        // Get publication(s) for this content/platform
        const publications = (await prisma.contentPublication.findMany({
          where: {
            contentId,
            platform: platform as any,
          },
          include: {
            socialAccount: {
              include: { brand: true },
            },
          },
        })) as any[];

        const publication = publications[0] as any;

        if (!publication) {
          return reply.code(404).send({
            error: 'content not published',
            message: `Content ${contentId} is not published on ${platform}`,
          });
        }

        // Get connector
        const connector = ConnectorFactory.get(platform as PlatformName);

        // Get credentials (use content.brand, tests do not populate brand on socialAccount)
        const tokens = await fetchTokensFromService(
          content.brand.userId,
          content.brandId,
          platform
        );

        if (!tokens || !tokens.accessToken) {
          return reply.code(401).send({
            error: 'invalid_credentials',
            message: `No valid credentials found for ${platform}`,
          });
        }

        // Fetch insights
        const rawInsights = await connector.getMediaInsights(
          {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
          },
          {
            platform: platform as PlatformName,
            externalAccountId: publication.socialAccount.externalAccountId,
            externalPageId: publication.socialAccount.externalPageId,
            username: publication.socialAccount.username,
          },
          publication.externalPostId
        );

        const insights = (rawInsights as any)?.metrics ?? rawInsights;

        return reply.send({
          success: true,
          platform,
          contentId,
          externalPostId: publication.externalPostId,
          insights,
          asOf: (rawInsights as any)?.asOf,
        });
      } catch (error: any) {
        logger.error('Failed to fetch insights', {
          error: error.message,
          params: req.params,
        });

        return reply.code(500).send({
          error: 'insights_failed',
          message: error.message || 'Failed to fetch insights',
        });
      }
    }
  );
}
