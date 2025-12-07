import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PlatformName } from '@postolio/connectors';
import { prisma } from '../config/database.js';
import { ConnectorFactory } from '../services/connectors/index.js';
import { logger as baseLogger } from '@postolio/logger';
import { getRedisClient } from '../services/redis.js';
import { fetchTokensFromService } from '../utils/token-service-client.js';
import { extractHashtagsFromCaption } from '../utils/hashtag-extractor.js';
import { assertBrandOwnership } from '../services/ownership.js';
import { APIError } from '@postolio/errors';

const logger = baseLogger.child({ module: 'social-platform-routes' });

const PlatformParamSchema = z.object({
  platform: z.string(),
  brandId: z.string(),
});

const ContentIdSchema = z.object({
  platform: z.string(),
  contentId: z.string(),
});

type BrandOwnershipOperation = 'status' | 'sync' | 'disconnect';

async function assertBrandOwnershipWithAudit(opts: {
  req: any;
  userId: string;
  brandId: string;
  platform: string;
  operation: BrandOwnershipOperation;
}) {
  const { req, userId, brandId, platform, operation } = opts;

  try {
    return await assertBrandOwnership(userId, brandId);
  } catch (error: any) {
    if (error && (error as any).code === 'BRAND_NOT_FOUND') {
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
              operation,
            },
            success: false,
          },
        });
      } catch (err: any) {
        logger.warn('Failed to create audit log', {
          error: err?.message ?? String(err),
        });
      }
    }

    throw error;
  }
}

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

        await assertBrandOwnershipWithAudit({
          req,
          userId,
          brandId,
          platform,
          operation: 'status',
        });

        // Check if social account exists (and is not soft-disconnected)
        const socialAccount = await prisma.socialAccount.findFirst({
          where: {
            brandId,
            platform: platform as any,
          },
        });

        const isDisconnected =
          socialAccount && (socialAccount.metadata as any)?.disconnected === true;

        if (!socialAccount || isDisconnected) {
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

        throw error;
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

        // Get content with brand and campaign
        const content = await prisma.content.findUnique({
          where: { id: contentId },
          include: { brand: true, campaign: true },
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

        // Enforce campaign status: do not publish content from non-active campaigns
        if (content.campaignId && content.campaign && content.campaign.status !== 'active') {
          const status = String(content.campaign.status || '').toLowerCase() || 'unknown';
          return reply.code(400).send({
            error: 'campaign_not_active',
            message: `Cannot publish content for a ${status} campaign`,
          });
        }

        // Get social account for this platform (must be connected)
        const socialAccount = await prisma.socialAccount.findFirst({
          where: {
            brandId: content.brandId,
            platform: platform as any,
          },
        });

        const isDisconnectedForPublish =
          socialAccount && (socialAccount.metadata as any)?.disconnected === true;

        if (!socialAccount || isDisconnectedForPublish) {
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

        // Validate content against platform caption limits
        const platformLimits: Record<string, { maxCaptionLength: number }> = {
          instagram: { maxCaptionLength: 2200 },
          facebook: { maxCaptionLength: 63206 },
          linkedin: { maxCaptionLength: 3000 },
          x: { maxCaptionLength: 280 },
          youtube: { maxCaptionLength: 5000 },
          tiktok: { maxCaptionLength: 2200 },
        };

        const limits = platformLimits[platform];
        const caption = content.caption || '';

        if (caption.length > limits.maxCaptionLength) {
          return reply.code(400).send({
            error: 'caption_too_long',
            message: `Caption exceeds ${platform} limit of ${limits.maxCaptionLength} characters`,
            maxLength: limits.maxCaptionLength,
            currentLength: caption.length,
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

          // Convert content/media type to Instagram's uppercase format.
          // Internally, carousels are modeled as image posts with multiple assets.
          // Reels are identified purely via contentType === 'reel' (mediaType remains 'video').
          const isReel = content.contentType === 'reel';
          const instagramMediaType = isReel
            ? ('REELS' as const)
            : content.mediaType === 'video'
              ? ('VIDEO' as const)
              : ('IMAGE' as const);
          const shareToFeed =
            isReel && typeof (content as any).shareToFeed === 'boolean'
              ? Boolean((content as any).shareToFeed)
              : undefined;

          publishResult = await connector.publish(
            {
              caption: content.caption || '',
              imageUrl: content.primaryAssetCdnUrl || undefined,
              mediaUrl: content.videoUrl || content.primaryAssetCdnUrl || undefined,
              mediaType: instagramMediaType,
              ...(shareToFeed !== undefined ? { shareToFeed } : {}),
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

        await assertBrandOwnershipWithAudit({
          req,
          userId,
          brandId,
          platform,
          operation: 'sync',
        });

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

        // Get social account (must be connected)
        const socialAccount = await prisma.socialAccount.findFirst({
          where: {
            brandId,
            platform: platform as any,
          },
          include: { brand: true },
        });

        const isDisconnectedForSync =
          socialAccount && (socialAccount.metadata as any)?.disconnected === true;

        if (!socialAccount || isDisconnectedForSync) {
          return reply.code(400).send({
            error: 'platform_not_connected',
            message: `Brand has not connected ${platform}`,
          });
        }

        // Get connector
        const connector = ConnectorFactory.get(platform as PlatformName);

        // Get credentials
        const tokens = await fetchTokensFromService(userId, brandId, platform);

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
        let failedCount = 0;
        const errors: string[] = [];

        // Create ContentPublication records for new posts
        for (const post of result.data) {
          const externalPostId = post.id;
          if (!externalPostId) {
            failedCount++;
            errors.push('Post missing external ID; cannot sync');
            continue;
          }

          // Primary deduplication: external post ID at brand+platform level
          const existingByBrand = await prisma.contentPublication.findFirst({
            where: {
              platform: platform as any,
              externalPostId,
              content: {
                brandId,
              },
            },
          });

          if (existingByBrand) {
            skippedCount++;
            continue;
          }

          // Legacy/defensive check: same social account + externalPostId
          const existingByAccount = await prisma.contentPublication.findFirst({
            where: {
              socialAccountId: socialAccount.id,
              externalPostId,
            },
          });

          if (existingByAccount) {
            skippedCount++;
            continue;
          }

          // Create content record (imported from platform)
          let content;
          try {
            content = await prisma.content.create({
              data: {
                brandId,
                caption: post.caption,
                hashtags: extractHashtagsFromCaption(post.caption),
                primaryAssetCdnUrl: post.mediaUrl,
                status: 'published',
                createdAt: post.postedAt ? new Date(post.postedAt) : new Date(),
                updatedAt: new Date(),
              },
            });
          } catch (err: any) {
            failedCount++;
            errors.push(
              `Post ${externalPostId}: failed to create content - ${err?.message || String(err)}`
            );
            continue;
          }

          try {
            // Create publication record
            await prisma.contentPublication.create({
              data: {
                contentId: content.id,
                socialAccountId: socialAccount.id,
                platform: platform as any,
                externalPostId,
                permalink: post.permalink,
                publishedAt: post.postedAt ? new Date(post.postedAt) : new Date(),
                metadata: {
                  imported: true,
                  syncedAt: new Date().toISOString(),
                },
              },
            });
            syncedCount++;
          } catch (err: any) {
            const code = err?.code;

            if (code === 'P2002') {
              // Unique constraint violation: another sync created the publication first.
              // Clean up the just-created content to avoid duplicates and treat as skipped.
              try {
                await prisma.content.delete({ where: { id: content.id } });
              } catch {
                // Best-effort cleanup; ignore errors here.
              }
              skippedCount++;
              continue;
            }

            failedCount++;
            errors.push(
              `Post ${externalPostId}: failed to create publication - ${err?.message || String(err)}`
            );
            // Best-effort cleanup of orphaned content
            try {
              await prisma.content.delete({ where: { id: content.id } });
            } catch {
              // Ignore cleanup errors
            }
          }
        }

        logger.info('Posts synced successfully', {
          platform,
          brandId,
          syncedCount,
          skippedCount,
          failedCount,
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
          failed: failedCount,
          total: result.data.length,
          results: {
            synced: syncedCount,
            skipped: skippedCount,
            failed: failedCount,
            errors,
          },
        });
      } catch (error: any) {
        logger.error('Failed to sync posts', {
          error: error.message,
          params: req.params,
        });
        if (error instanceof APIError) {
          throw error;
        }

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
        const body = (req.body || {}) as { removeImportedPosts?: boolean };
        const removeImportedPosts = body?.removeImportedPosts === true;
        const userId = req.user!.id;

        const platformError = ensurePlatformSupported(platform);
        if (platformError) {
          return reply.code(platformError.statusCode).send(platformError.body);
        }

        await assertBrandOwnershipWithAudit({
          req,
          userId,
          brandId,
          platform,
          operation: 'disconnect',
        });

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

        // Soft-disconnect: preserve SocialAccount and publications for historical data
        const existingMetadata = (socialAccount.metadata || {}) as Record<string, unknown>;
        await prisma.socialAccount.update({
          where: { id: socialAccount.id },
          data: {
            metadata: {
              ...existingMetadata,
              disconnected: true,
              disconnectedAt: new Date().toISOString(),
            },
          },
        });

        // Optional: remove posts imported from this social account
        if (removeImportedPosts) {
          try {
            // For Instagram, imported posts are tagged with generationParams.source = 'instagram_import'
            const importedContent = await prisma.content.findMany({
              where: {
                brandId,
                generationParams: {
                  path: ['source'],
                  equals: platform === 'instagram' ? 'instagram_import' : `${platform}_import`,
                },
                publications: {
                  some: {
                    socialAccountId: socialAccount.id,
                    platform: platform as any,
                  },
                },
              },
              select: { id: true },
            });

            const importedIds = importedContent.map((c) => c.id);
            if (importedIds.length > 0) {
              await prisma.content.deleteMany({
                where: { id: { in: importedIds } },
              });
              logger.info('Removed imported posts for disconnected social account', {
                platform,
                brandId,
                socialAccountId: socialAccount.id,
                removedCount: importedIds.length,
              });
            }
          } catch (cleanupErr: any) {
            logger.warn('Failed to remove imported posts on social disconnect', {
              error: cleanupErr?.message ?? String(cleanupErr),
              platform,
              brandId,
            });
          }
        }

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

        throw error;
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

        // Get publication(s) for this content/platform, including latest metrics
        const publications = (await prisma.contentPublication.findMany({
          where: {
            contentId,
            platform: platform as any,
          },
          include: {
            metricsLatest: true,
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

        const latest = (publication as any).metricsLatest as
          | {
              impressions?: number | null;
              reach?: number | null;
              engagement?: number | null;
              likes?: number | null;
              comments?: number | null;
              saves?: number | null;
              shares?: number | null;
              videoViews?: number | null;
              lastUpdated?: Date | null;
              engagementRate?: unknown;
            }
          | null
          | undefined;

        if (latest) {
          const insights = {
            impressions: latest.impressions || 0,
            reach: latest.reach || 0,
            engagement: latest.engagement || 0,
            likes: latest.likes || 0,
            comments: latest.comments || 0,
            saves: latest.saves || 0,
            shares: latest.shares || 0,
            videoViews: latest.videoViews || 0,
            engagementRate:
              latest.engagementRate != null ? Number(latest.engagementRate) : undefined,
          };

          return reply.send({
            success: true,
            platform,
            contentId,
            externalPostId: publication.externalPostId,
            insights,
            asOf: latest.lastUpdated ?? null,
          });
        }

        // Fallback: live fetch via connector when no ingested metrics exist yet.
        const connector = ConnectorFactory.get(platform as PlatformName);

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
