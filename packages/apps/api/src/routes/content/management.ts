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
import {
  attachAssetToContent,
  verifyAssetOwnership,
  getAssetsClient,
} from '../../services/assets-media.js';
import { normalizeHashtags } from '../../utils/hashtag-normalizer.js';
import {
  verifyBrandOwnership,
  verifyContentOwnership,
  verifyContentDeletable,
  verifyCampaignAccess,
} from '../../services/content-operations/authorization.js';
import { getDatabaseClient } from '../../config/database.js';
import {
  validateContentPayload,
  type ContentType as ValidationContentType,
  type MediaType as ValidationMediaType,
} from '@postolio/content-validation';

const prisma = getDatabaseClient();

interface CreateManualContentBody {
  brandId: string;
  caption: string;
  hashtags: string[];
  assetId?: string;
  mediaType?: ValidationMediaType;
  contentType?: ValidationContentType;
  videoUrl?: string;
  carouselAssetIds?: string[]; // Asset IDs from Assets database
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
          carouselAssetIds,
          campaignId,
          scheduledAt,
        } = request.body;

        const normalizedContentType: ValidationContentType = contentType ?? 'post';
        const normalizedMediaType: ValidationMediaType = mediaType ?? 'image';

        const mediaKeys: string[] = [];
        if (carouselAssetIds && carouselAssetIds.length > 0) {
          mediaKeys.push(...carouselAssetIds);
        }
        if (assetId) {
          mediaKeys.push(assetId);
        }

        // Unified platform validation (Instagram defaults)
        const validation = validateContentPayload({
          platform: 'instagram',
          contentType: normalizedContentType,
          mediaType: normalizedMediaType,
          caption,
          hashtags,
          videoUrl,
          mediaKeys,
        });

        if (!validation.ok) {
          return reply.code(400).send({
            error: validation.errors[0]?.message || 'Invalid content',
            details: validation.errors,
          });
        }

        if (!Array.isArray(hashtags)) {
          return reply.code(400).send({ error: 'Hashtags must be an array' });
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

        // Fetch and verify carousel assets BEFORE starting transaction
        let resolvedCarouselAssets: Array<{
          id: string;
          url: string;
          brandId: string;
          width: number | null;
          height: number | null;
        }> | null = null;

        if (mediaType === 'image' && carouselAssetIds && carouselAssetIds.length > 0) {
          const assetsClient = getAssetsClient();

          try {
            const assets = await assetsClient.getBatchAssets(carouselAssetIds);

            // Verify all assets exist
            const missingAssets = assets
              .map((asset, idx) => (!asset ? carouselAssetIds[idx] : null))
              .filter(Boolean);

            if (missingAssets.length > 0) {
              return reply
                .code(404)
                .send({ error: `Assets not found: ${missingAssets.join(', ')}` });
            }

            // At this point, all assets are guaranteed to be non-null (verified above)
            const validAssets = assets.filter(Boolean) as NonNullable<(typeof assets)[number]>[];

            // Verify all assets belong to the same brand as the content
            const expectedBrandId = brandId;
            const invalidAssets = validAssets.filter((asset) => asset.brandId !== expectedBrandId);
            if (invalidAssets.length > 0) {
              return reply.code(400).send({
                error: 'All carousel assets must belong to the same brand as the content',
              });
            }

            resolvedCarouselAssets = validAssets.map((asset) => ({
              id: asset.id,
              url: asset.url,
              brandId: asset.brandId,
              width: asset.width ?? null,
              height: asset.height ?? null,
            }));
          } catch (error) {
            request.log.error(error);
            return reply
              .code(400)
              .send({ error: 'Failed to fetch carousel assets. Please try again.' });
          }
        }

        // Create content record (now transaction only contains DB operations)
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

          // Handle carousel images (using pre-fetched assets)
          if (resolvedCarouselAssets && resolvedCarouselAssets.length > 0) {
            const firstAsset = resolvedCarouselAssets[0];

            // Create PostMediaAsset records for each asset
            for (let i = 0; i < resolvedCarouselAssets.length; i++) {
              const asset = resolvedCarouselAssets[i];
              await tx.postMediaAsset.create({
                data: {
                  contentId: created.id,
                  assetId: asset.id,
                  cdnUrl: asset.url,
                  displayOrder: i,
                  usageContext: i === 0 ? 'primary' : `carousel_${i}`,
                },
              });
            }

            // Update Content record with primary asset reference
            await tx.content.update({
              where: { id: created.id },
              data: {
                primaryAssetId: firstAsset.id,
                primaryAssetCdnUrl: firstAsset.url,
                primaryAssetWidth: firstAsset.width,
                primaryAssetHeight: firstAsset.height,
              },
            });

            // Return with primary asset info
            return {
              ...created,
              primaryAssetId: firstAsset.id,
              primaryAssetCdnUrl: firstAsset.url,
              primaryAssetWidth: firstAsset.width,
              primaryAssetHeight: firstAsset.height,
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
