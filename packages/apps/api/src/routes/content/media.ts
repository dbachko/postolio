/**
 * Content Media Routes
 * Asset-based media attachment (no raw URL writes)
 */

import { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../../config/database.js';
import { verifyContentEditable } from '../../services/content-operations/authorization.js';
import {
  verifyAssetOwnership,
  attachAssetToContent,
  getAssetsClient,
} from '../../services/assets-media.js';
import type { AssetRecord } from '@postolio/assets-client';
import { buildContentResponse } from '../../services/content-response-builder.js';

const prisma = getDatabaseClient();

const mediaRoutes: FastifyPluginAsync = async (fastify) => {
  // Attach or replace primary asset for content
  fastify.post<{
    Params: { contentId: string };
    Body: { assetId: string; usageContext?: string };
  }>('/:contentId/asset', { preHandler: fastify.authenticate }, async (request, reply) => {
    const userId = request.user!.id;
    const { contentId } = request.params;
    const { assetId, usageContext } = request.body;

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
        },
      });

      if (!content || !content.brand) {
        return reply.code(404).send({ error: 'Content not found' });
      }

      // Verify asset belongs to the same brand
      const asset = await verifyAssetOwnership(assetId, content.brand.id);

      // Attach asset to content (updates primaryAsset* and post_media_assets)
      await attachAssetToContent({
        contentId,
        asset,
        usageContext: usageContext || 'primary',
      });

      const updatedContent = await prisma.content.findUnique({
        where: { id: contentId },
        select: {
          id: true,
          caption: true,
          hashtags: true,
          primaryAssetCdnUrl: true,
          primaryAssetId: true,
          primaryAssetWidth: true,
          primaryAssetHeight: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          scheduledAt: true,
          postedAt: true,
          brandId: true,
          generationParams: true,
          mediaType: true,
          contentType: true,
          videoUrl: true,
        },
      });

      if (!updatedContent) {
        return reply.code(404).send({ error: 'Content not found after attaching asset' });
      }

      const response = buildContentResponse(updatedContent);
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
        },
      });

      if (!content || !content.brand) {
        return reply.code(404).send({ error: 'Content not found' });
      }

      // If no assets provided, clear media and primary asset
      if (assetIds.length === 0) {
        await prisma.$transaction(async (tx) => {
          await tx.postMediaAsset.deleteMany({ where: { contentId } });
          await tx.content.update({
            where: { id: contentId },
            data: {
              primaryAssetId: null,
              primaryAssetCdnUrl: null,
              primaryAssetWidth: null,
              primaryAssetHeight: null,
            },
          });
        });
      } else {
        // Fetch all assets in a single batch request
        const assetsClient = getAssetsClient();
        const assets = await assetsClient.getBatchAssets(assetIds);

        // Verify all assets exist
        const missingAssets = assets
          .map((asset, idx) => (!asset ? assetIds[idx] : null))
          .filter(Boolean);

        if (missingAssets.length > 0) {
          return reply.code(404).send({ error: `Assets not found: ${missingAssets.join(', ')}` });
        }

        const validAssets = assets as AssetRecord[];

        // Verify assets belong to the same brand as the content
        const firstAsset = validAssets[0];
        await verifyAssetOwnership(firstAsset.id, content.brand.id);
        const invalidAssets = validAssets.filter((asset) => asset.brandId !== firstAsset.brandId);
        if (invalidAssets.length > 0) {
          return reply
            .code(400)
            .send({ error: 'All media assets must belong to the same brand as the content' });
        }

        // Replace media set transactionally
        await prisma.$transaction(async (tx) => {
          // Clear existing join rows
          await tx.postMediaAsset.deleteMany({ where: { contentId } });

          // Primary asset (first in ordered list)
          const primary = validAssets[0];
          await attachAssetToContent({
            contentId,
            asset: primary,
            usageContext: 'primary',
            prisma: tx,
          });

          // Additional carousel assets, if any
          for (let i = 1; i < validAssets.length; i++) {
            const asset = validAssets[i];
            await tx.postMediaAsset.create({
              data: {
                contentId,
                assetId: asset.id,
                cdnUrl: asset.url,
                displayOrder: i,
                usageContext: `carousel_${i}`,
                width: asset.width ?? null,
                height: asset.height ?? null,
              },
            });
          }
        });
      }

      const updatedContent = await prisma.content.findUnique({
        where: { id: contentId },
        select: {
          id: true,
          caption: true,
          hashtags: true,
          primaryAssetCdnUrl: true,
          primaryAssetId: true,
          primaryAssetWidth: true,
          primaryAssetHeight: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          scheduledAt: true,
          postedAt: true,
          brandId: true,
          generationParams: true,
          mediaType: true,
          contentType: true,
          videoUrl: true,
        },
      });

      if (!updatedContent) {
        return reply.code(404).send({ error: 'Content not found after media update' });
      }

      const response = buildContentResponse(updatedContent);
      return reply.send({ content: response });
    } catch (error) {
      request.log.error({ err: error, contentId, assetIds }, 'Failed to update content media');
      return reply.code(500).send({ error: 'Failed to update content media' });
    }
  });
};

export default mediaRoutes;
