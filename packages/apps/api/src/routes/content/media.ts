/**
 * Content Media Routes
 * Asset-based media attachment (no raw URL writes)
 */

import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../../config/database.js';
import { verifyContentEditable } from '../../services/content-operations/authorization.js';
import {
  verifyAssetOwnership,
  attachAssetToContent,
  getAssetsClient,
} from '../../services/assets-media.js';
import { schedulerService } from '../../services/scheduler.js';
import type { AssetRecord } from '@postolio/assets-client';
import { buildContentResponse } from '../../services/content-response-builder.js';
import { haveUniformAspectRatio } from '../../utils/aspect-ratio.js';

const prisma = getDatabaseClient();

const mediaRoutes: FastifyPluginAsync = async (fastify) => {
  // Attach or replace primary asset for content
  fastify.post<{
    Params: { contentId: string };
    Body: { assetId: string };
  }>('/:contentId/asset', { preHandler: fastify.authenticate }, async (request, reply) => {
    const userId = request.user!.id;
    const { contentId } = request.params;
    const { assetId } = request.body;

    if (!assetId) {
      return reply.code(400).send({ error: 'assetId is required' });
    }

    try {
      // Verify user can edit this content
      const authResult = await verifyContentEditable(userId, contentId);
      if (!authResult.authorized) {
        return reply.code(authResult.error?.includes('immutable') ? 400 : 404).send({
          error: authResult.error,
        });
      }

      const content = await prisma.content.findFirst({
        where: { id: contentId },
        include: {
          brand: { select: { id: true } },
          publishingQueueItem: { select: { id: true } },
        },
      });

      if (!content?.brand) {
        return reply.code(404).send({ error: 'Content not found' });
      }

      // Verify asset belongs to the same brand
      const asset = await verifyAssetOwnership(assetId, content.brand.id);

      // Attach asset to content (displayOrder 0)
      await attachAssetToContent({
        contentId,
        asset,
        displayOrder: 0,
      });

      const updatedContent = await prisma.content.findUnique({
        where: { id: contentId },
        select: {
          id: true,
          caption: true,
          hashtags: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          scheduledAt: true,
          postedAt: true,
          brandId: true,
          contentGroupId: true,
          contentSeriesId: true,
          targetSocialAccountId: true,
          recipeRunId: true,
          recipeRun: {
            select: {
              recipeTemplate: { select: { id: true, slug: true, name: true } },
            },
          },
          schedulingError: true,
          generationParams: true,
          contentType: true,
          shareToFeed: true,
          firstComment: true,
          firstCommentStatus: true,
          firstCommentPostedAt: true,
          firstCommentError: true,
          mediaAssets: {
            select: { assetId: true, displayOrder: true },
            orderBy: { displayOrder: 'asc' },
          },
        },
      });

      if (!updatedContent) {
        return reply.code(404).send({ error: 'Content not found after attaching asset' });
      }

      if (updatedContent.status === 'scheduled' && updatedContent.scheduledAt) {
        try {
          const syncResult = await schedulerService.updateScheduledContent(contentId);
          if (!syncResult.success) {
            request.log.warn(
              { contentId, error: syncResult.error },
              'Failed to sync schedule payload after asset update'
            );
          }
        } catch (syncError) {
          request.log.warn(
            { contentId, err: syncError },
            'Error syncing schedule payload after asset update'
          );
        }
      }

      const response = buildContentResponse({
        ...(updatedContent as any),
        generatedByRecipe: (updatedContent as any).recipeRun?.recipeTemplate ?? null,
      });
      return reply.send({ content: response });
    } catch (error) {
      request.log.error({ err: error, contentId, assetId }, 'Failed to attach asset to content');
      return reply.code(500).send({ error: 'Failed to attach asset to content' });
    }
  });

  // Replace full media set (primary + carousel) for content
  fastify.put<{
    Params: { contentId: string };
    Body: { assetIds: string[] };
  }>('/:contentId/media', { preHandler: fastify.authenticate }, async (request, reply) => {
    const userId = request.user!.id;
    const { contentId } = request.params;
    const { assetIds } = request.body;

    if (!Array.isArray(assetIds)) {
      return reply.code(400).send({ error: 'assetIds must be an array' });
    }

    try {
      // Verify user can edit this content
      const authResult = await verifyContentEditable(userId, contentId);
      if (!authResult.authorized) {
        return reply.code(authResult.error?.includes('immutable') ? 400 : 404).send({
          error: authResult.error,
        });
      }

      const content = await prisma.content.findFirst({
        where: { id: contentId },
        include: {
          brand: { select: { id: true } },
          publishingQueueItem: { select: { id: true } },
        },
      });

      if (!content?.brand) {
        return reply.code(404).send({ error: 'Content not found' });
      }

      // If no assets provided, clear media and primary asset
      if (assetIds.length === 0) {
        await prisma.$transaction(async (tx) => {
          await tx.contentMediaAsset.deleteMany({ where: { contentId } });
        });
      } else {
        // Fetch all assets in a single batch request
        const assetsClient = getAssetsClient();
        let assets: Array<AssetRecord | null>;

        try {
          assets = await assetsClient.getBatchAssets(assetIds);
        } catch (error) {
          request.log.error(
            { err: error, assetIds },
            'Failed to fetch media assets for content update'
          );
          return reply.code(400).send({ error: 'Failed to fetch media assets. Please try again.' });
        }

        // Verify all assets exist
        const missingAssets = assets
          .map((asset, idx) => (!asset ? assetIds[idx] : null))
          .filter(Boolean);

        if (missingAssets.length > 0) {
          return reply.code(404).send({ error: `Assets not found: ${missingAssets.join(', ')}` });
        }

        const validAssets = assets.filter(Boolean) as AssetRecord[];

        // Verify assets belong to the same brand as the content
        const expectedBrandId = content.brand.id;
        const invalidAssets = validAssets.filter((asset) => asset.brandId !== expectedBrandId);
        if (invalidAssets.length > 0) {
          return reply
            .code(400)
            .send({ error: 'All media assets must belong to the same brand as the content' });
        }

        const requiresUniformAspectRatio =
          content.status === 'scheduled' || Boolean(content.publishingQueueItem);

        // When updating scheduled or queued carousels, require a consistent aspect ratio.
        if (
          requiresUniformAspectRatio &&
          assetIds.length > 1 &&
          !haveUniformAspectRatio(validAssets)
        ) {
          return reply.code(400).send({
            error:
              'All carousel items must have the same aspect ratio. Please crop or resize your media so they match.',
          });
        }

        // Replace media set transactionally
        await prisma.$transaction(async (tx) => {
          // Clear existing join rows
          await tx.contentMediaAsset.deleteMany({ where: { contentId } });
          await tx.contentMediaAsset.createMany({
            data: validAssets.map((asset, idx) => ({
              contentId,
              assetId: asset.id,
              displayOrder: idx,
            })),
          });
        });
      }

      const updatedContent = await prisma.content.findUnique({
        where: { id: contentId },
        select: {
          id: true,
          caption: true,
          hashtags: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          scheduledAt: true,
          postedAt: true,
          brandId: true,
          contentGroupId: true,
          contentSeriesId: true,
          targetSocialAccountId: true,
          recipeRunId: true,
          recipeRun: {
            select: {
              recipeTemplate: { select: { id: true, slug: true, name: true } },
            },
          },
          schedulingError: true,
          generationParams: true,
          contentType: true,
          shareToFeed: true,
          firstComment: true,
          firstCommentStatus: true,
          firstCommentPostedAt: true,
          firstCommentError: true,
          mediaAssets: {
            select: { assetId: true, displayOrder: true },
            orderBy: { displayOrder: 'asc' },
          },
        },
      });

      if (!updatedContent) {
        return reply.code(404).send({ error: 'Content not found after media update' });
      }

      if (updatedContent.status === 'scheduled' && updatedContent.scheduledAt) {
        try {
          const syncResult = await schedulerService.updateScheduledContent(contentId);
          if (!syncResult.success) {
            request.log.warn(
              { contentId, error: syncResult.error },
              'Failed to sync schedule payload after media update'
            );
          }
        } catch (syncError) {
          request.log.warn(
            { contentId, err: syncError },
            'Error syncing schedule payload after media update'
          );
        }
      }

      const response = buildContentResponse({
        ...(updatedContent as any),
        generatedByRecipe: (updatedContent as any).recipeRun?.recipeTemplate ?? null,
      });
      return reply.send({ content: response });
    } catch (error) {
      request.log.error({ err: error, contentId, assetIds }, 'Failed to update content media');
      return reply.code(500).send({ error: 'Failed to update content media' });
    }
  });
};

export default mediaRoutes;
