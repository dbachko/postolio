/**
 * Content Management Routes
 * Handles content CRUD operations: create, read, approve, reject, delete
 */

import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@postolio/database';

import { schedulerService } from '../../services/scheduler.js';
import {
  buildContentResponse,
  buildContentListResponse,
} from '../../services/content-response-builder.js';
import { attachAssetToContent, verifyAssetOwnership } from '../../services/assets-media.js';
import { normalizeHashtags } from '../../utils/hashtag-normalizer.js';
import {
  verifyBrandOwnership,
  verifyContentOwnership,
  verifyContentDeletable,
  verifyCampaignAccess,
} from '../../services/content-operations/authorization.js';
import { getDatabaseClient } from '../../config/database.js';

const prisma = getDatabaseClient();

interface CreateManualContentBody {
  brandId: string;
  caption: string;
  hashtags: string[];
  assetId?: string;
  mediaType?: 'image' | 'video' | 'reel' | 'carousel';
  contentType?: 'post' | 'reel' | 'story';
  videoUrl?: string;
  carouselImageUrls?: string[];
  campaignId?: string;
  scheduledAt?: string;
}

interface ApproveContentBody {
  contentId: string;
  scheduledAt?: string;
}

const managementRoutes: FastifyPluginAsync = async (fastify) => {
  // Create manual content (user-generated, not AI) - RESTful: POST /
  fastify.post<{ Body: CreateManualContentBody }>(
    '/',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const {
          brandId,
          caption,
          hashtags,
          assetId,
          mediaType,
          contentType,
          videoUrl,
          carouselImageUrls,
          campaignId,
          scheduledAt,
        } = request.body;

        // Validate input
        if (!caption || caption.trim().length === 0) {
          return reply.code(400).send({ error: 'Caption is required' });
        }

        // Validate video-specific fields
        if ((mediaType === 'video' || mediaType === 'reel') && !videoUrl && !assetId) {
          return reply.code(400).send({
            error: 'Video URL or asset ID is required for video/reel content',
          });
        }

        // Validate image and carousel fields
        if (mediaType === 'image' && carouselImageUrls && carouselImageUrls.length > 1) {
          return reply.code(400).send({
            error: 'Single image posts can only have 1 image. Use carousel for multiple images.',
          });
        }

        if (mediaType === 'carousel') {
          if (!carouselImageUrls || carouselImageUrls.length < 2) {
            return reply.code(400).send({
              error: 'Carousel requires at least 2 images',
            });
          }
          if (carouselImageUrls.length > 10) {
            return reply.code(400).send({
              error: 'Maximum 10 images allowed for carousel',
            });
          }
        }

        if (caption.length > 2200) {
          return reply.code(400).send({
            error: 'Caption exceeds Instagram limit of 2200 characters',
          });
        }

        if (!Array.isArray(hashtags)) {
          return reply.code(400).send({ error: 'Hashtags must be an array' });
        }

        if (hashtags.length > 30) {
          return reply.code(400).send({ error: 'Maximum 30 hashtags allowed' });
        }

        // Normalize hashtags (strip # symbols for consistency)
        const normalizedHashtags = normalizeHashtags(hashtags);

        // Verify user owns the brand
        const authResult = await verifyBrandOwnership(userId, brandId);
        if (!authResult.authorized) {
          return reply.code(404).send({ error: authResult.error });
        }

        let resolvedAsset = null;
        if (assetId) {
          try {
            resolvedAsset = await verifyAssetOwnership(assetId, brandId);
          } catch (error) {
            request.log.error(error);
            return reply.code(400).send({ error: 'Invalid asset reference for this brand' });
          }
        }

        // Validate campaignId if provided
        if (campaignId) {
          const campaignAuthResult = await verifyCampaignAccess(userId, campaignId);
          if (!campaignAuthResult.authorized) {
            return reply.code(404).send({ error: campaignAuthResult.error });
          }
        }

        // Determine status based on scheduledAt
        const status = scheduledAt ? 'scheduled' : 'draft';

        const resolvedCampaignId = campaignId || null;

        // Create content record
        const content = await prisma.$transaction(async (tx) => {
          const created = await tx.content.create({
            data: {
              caption,
              hashtags: normalizedHashtags,
              status,
              brandId,
              campaignId: resolvedCampaignId,
              scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
              mediaType: mediaType || 'image', // Default to image if not specified
              contentType: contentType || 'post', // Default to post if not specified
              videoUrl: videoUrl || null,
              generationParams: Prisma.JsonNull, // null indicates manual creation
            },
            select: {
              id: true,
              caption: true,
              hashtags: true,
              primaryAssetCdnUrl: true,
              primaryAssetId: true,
              primaryAssetHeight: true,
              primaryAssetWidth: true,
              status: true,
              brandId: true,
              generationParams: true,
              createdAt: true,
              mediaType: true,
              contentType: true,
              videoUrl: true,
            },
          });

          if (resolvedAsset) {
            await attachAssetToContent({ contentId: created.id, asset: resolvedAsset, prisma: tx });
            return {
              ...created,
              primaryAssetId: resolvedAsset.id,
              primaryAssetCdnUrl: resolvedAsset.url,
              primaryAssetWidth: resolvedAsset.width ?? null,
              primaryAssetHeight: resolvedAsset.height ?? null,
            };
          }

          // Handle single image or carousel images from carouselImageUrls
          if (
            (mediaType === 'image' || mediaType === 'carousel') &&
            carouselImageUrls &&
            carouselImageUrls.length > 0
          ) {
            // Create PostMediaAsset records for each image
            for (let i = 0; i < carouselImageUrls.length; i++) {
              await tx.postMediaAsset.create({
                data: {
                  contentId: created.id,
                  assetId: `image_${created.id}_${i}`, // Placeholder ID since these are direct URLs
                  cdnUrl: carouselImageUrls[i],
                  displayOrder: i,
                  usageContext: i === 0 ? 'primary' : `carousel_${i}`,
                },
              });
            }

            // Set first image as primary
            return {
              ...created,
              primaryAssetCdnUrl: carouselImageUrls[0],
            };
          }

          return created;
        });

        if (!content) {
          return reply.code(500).send({ error: 'Failed to create content' });
        }

        // If scheduled time is provided, create AWS schedule
        let upsell: { upgradeRequired: boolean; message?: string } | null = null;
        if (scheduledAt) {
          try {
            const scheduleResult = await schedulerService.scheduleContent(content.id);

            if (!scheduleResult.success) {
              console.error('Failed to create AWS schedule:', scheduleResult.error);
              if (
                typeof scheduleResult.error === 'string' &&
                scheduleResult.error.toLowerCase().includes('upgrade required')
              ) {
                upsell = { upgradeRequired: true, message: scheduleResult.error };
              }
              // Note: We don't fail the request as the content is already created locally
            } else {
              console.log(`Content ${content.id} scheduled successfully in AWS`);
            }
          } catch (scheduleError) {
            console.error('Error calling scheduler service:', scheduleError);
            // Continue - content is created, scheduling failure is non-critical
          }
        }

        // Build CDN URL from S3 key and map to public response format
        const contentWithUrl = buildContentResponse(content);

        return reply.code(201).send({
          content: contentWithUrl,
          metadata: {
            brandId,
            source: 'manual',
          },
          ...(upsell ? { upsell } : {}),
        });
      } catch (error) {
        console.error('Manual content creation error:', error);
        return reply.code(500).send({ error: 'Failed to create content' });
      }
    }
  );

  // Get draft content for review
  fastify.get<{ Params: { brandId: string } }>(
    '/pending/:brandId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { brandId } = request.params;

        // Verify user owns the brand
        const authResult = await verifyBrandOwnership(userId, brandId);
        if (!authResult.authorized) {
          return reply.code(404).send({ error: authResult.error });
        }

        const draftContent = await prisma.content.findMany({
          where: {
            brandId,
            status: 'draft',
          },
          select: {
            id: true,
            caption: true,
            hashtags: true,
            primaryAssetCdnUrl: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            scheduledAt: true,
            brandId: true,
            generationParams: true,
          },
          // For draft review, default to last modified first
          orderBy: { updatedAt: 'desc' },
        });

        // Build CDN URLs from S3 keys and map to public response format
        const contentWithUrls = buildContentListResponse(draftContent);

        return { content: contentWithUrls };
      } catch (error) {
        console.error('Draft content error:', error);
        return reply.code(500).send({ error: 'Failed to retrieve draft content' });
      }
    }
  );

  // Approve content for posting
  fastify.post<{ Body: ApproveContentBody }>(
    '/approve',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { contentId, scheduledAt } = request.body;

        // Verify user owns the content through brand ownership
        const authResult = await verifyContentOwnership(userId, contentId);
        if (!authResult.authorized) {
          return reply.code(404).send({ error: authResult.error });
        }

        // Get content with campaign info
        const content = await prisma.content.findFirst({
          where: { id: contentId },
          include: {
            campaign: {
              select: { id: true, status: true },
            },
          },
        });

        if (!content) {
          return reply.code(404).send({ error: 'Content not found' });
        }

        if (content.status !== 'draft') {
          return reply.code(400).send({ error: 'Content is not in draft status' });
        }

        // Update content status - use 'scheduled' if scheduledAt provided
        const updatedContent = await prisma.content.update({
          where: { id: contentId },
          data: {
            status: scheduledAt ? 'scheduled' : 'draft',
            scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
          },
          select: {
            id: true,
            caption: true,
            hashtags: true,
            status: true,
            scheduledAt: true,
            updatedAt: true,
          },
        });

        // Check if content belongs to a campaign in preview (draft) state
        const isInDraftCampaign = content.campaign && content.campaign.status === 'preview';

        // If scheduledAt is provided, create a schedule in AWS (unless in draft campaign)
        if (scheduledAt) {
          if (isInDraftCampaign) {
            console.log(
              `Content ${contentId} belongs to campaign ${content.campaign?.id} in preview state - updating database only, not scheduling in AWS`
            );
          } else {
            try {
              // Don't pass customTime - let scheduler-adapter read scheduledAt from database
              // This avoids timezone conversion issues since DB stores UTC
              const scheduleResult = await schedulerService.scheduleContent(contentId);

              if (!scheduleResult.success) {
                console.error('Failed to create AWS schedule:', scheduleResult.error);
                // Note: We don't fail the request here as the content is already scheduled locally
                // The scheduler adapter has fallback logic
              } else {
                console.log(`Content ${contentId} scheduled successfully in AWS`);
              }
            } catch (scheduleError) {
              console.error('Error calling scheduler service:', scheduleError);
              // Continue with local scheduling
            }
          }
        }

        return { content: updatedContent };
      } catch (error) {
        console.error('Content approval error:', error);
        return reply.code(500).send({ error: 'Failed to approve content' });
      }
    }
  );

  // Reject content
  fastify.post<{ Params: { contentId: string } }>(
    '/reject/:contentId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { contentId } = request.params;

        // Verify user owns the content through brand ownership
        const authResult = await verifyContentOwnership(userId, contentId);
        if (!authResult.authorized) {
          return reply.code(404).send({ error: authResult.error });
        }

        // Update content status - reject means back to draft
        const updatedContent = await prisma.content.update({
          where: { id: contentId },
          data: {
            status: 'draft',
            scheduledAt: null, // Clear any scheduled time
          },
          select: {
            id: true,
            status: true,
            updatedAt: true,
          },
        });

        return { content: updatedContent };
      } catch (error) {
        console.error('Content rejection error:', error);
        return reply.code(500).send({ error: 'Failed to reject content' });
      }
    }
  );

  // Delete content (RESTful: DELETE /:contentId)
  fastify.delete<{ Params: { contentId: string } }>(
    '/:contentId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { contentId } = request.params;

      // Verify user owns the content and it's deletable (not published)
      const authResult = await verifyContentDeletable(userId, contentId);
      if (!authResult.authorized) {
        return reply
          .code(authResult.error?.includes('published') ? 400 : 404)
          .send({ error: authResult.error });
      }

      const item = await prisma.content.findFirst({
        where: { id: contentId },
        select: { status: true },
      });
      if (!item) return reply.code(404).send({ error: 'Content not found' });

      // Best-effort cancel schedule
      try {
        if (item.status === 'scheduled') {
          await schedulerService.cancelScheduledPost(contentId);
        }
      } catch (e) {
        request.log.warn({ err: e, contentId }, 'Failed to cancel schedule during delete');
      }

      await prisma.content.delete({ where: { id: contentId } });
      return reply.send({ success: true, deleted: { id: contentId } });
    }
  );
};

export default managementRoutes;
