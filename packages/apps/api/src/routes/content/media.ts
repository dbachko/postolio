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

const contentResponseSelect = {
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
    orderBy: { displayOrder: 'asc' as const },
  },
};

async function ensureEditableContent(params: { userId: string; contentId: string; reply: any }) {
  const authResult = await verifyContentEditable(params.userId, params.contentId);
  if (!authResult.authorized) {
    params.reply.code(authResult.error?.includes('immutable') ? 400 : 404).send({
      error: authResult.error,
    });
    return null;
  }

  const content = await prisma.content.findFirst({
    where: { id: params.contentId },
    include: {
      brand: { select: { id: true } },
      publishingQueueItem: { select: { id: true } },
    },
  });
  if (!content?.brand) {
    params.reply.code(404).send({ error: 'Content not found' });
    return null;
  }

  return content;
}

async function loadUpdatedContent(contentId: string) {
  return prisma.content.findUnique({
    where: { id: contentId },
    select: contentResponseSelect,
  });
}

function mapContentResponse(updatedContent: any) {
  return buildContentResponse({
    ...updatedContent,
    generatedByRecipe: updatedContent?.recipeRun?.recipeTemplate ?? null,
  });
}

async function syncScheduledContentIfNeeded(params: {
  updatedContent: any;
  contentId: string;
  request: any;
  action: 'asset' | 'media';
}) {
  if (!(params.updatedContent?.status === 'scheduled' && params.updatedContent?.scheduledAt)) {
    return;
  }

  try {
    const syncResult = await schedulerService.updateScheduledContent(params.contentId);
    if (!syncResult.success) {
      params.request.log.warn(
        { contentId: params.contentId, error: syncResult.error },
        `Failed to sync schedule payload after ${params.action} update`
      );
    }
  } catch (error: unknown) {
    params.request.log.warn(
      { contentId: params.contentId, err: error },
      `Error syncing schedule payload after ${params.action} update`
    );
  }
}

function findMissingAssetIds(assetIds: string[], assets: Array<AssetRecord | null>) {
  return assets
    .map((asset, index) => (!asset ? assetIds[index] : null))
    .filter((id): id is string => Boolean(id));
}

function findBrandMismatchedAssets(validAssets: AssetRecord[], expectedBrandId: string) {
  return validAssets.filter((asset) => asset.brandId !== expectedBrandId);
}

async function fetchAssetsBatch(assetIds: string[]) {
  const assetsClient = getAssetsClient();
  return assetsClient.getBatchAssets(assetIds);
}

async function replaceContentMedia(contentId: string, validAssets: AssetRecord[]) {
  await prisma.$transaction(async (tx) => {
    await tx.contentMediaAsset.deleteMany({ where: { contentId } });
    await tx.contentMediaAsset.createMany({
      data: validAssets.map((asset, index) => ({
        contentId,
        assetId: asset.id,
        displayOrder: index,
      })),
    });
  });
}

async function clearContentMedia(contentId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.contentMediaAsset.deleteMany({ where: { contentId } });
  });
}

async function createAttachAssetHandler(request: any, reply: any) {
  const userId = request.user!.id;
  const { contentId } = request.params as { contentId: string };
  const { assetId } = request.body as { assetId?: string };
  if (!assetId) {
    return reply.code(400).send({ error: 'assetId is required' });
  }

  try {
    const content = await ensureEditableContent({ userId, contentId, reply });
    if (!content) {
      return;
    }

    const asset = await verifyAssetOwnership(assetId, content.brand.id);
    await attachAssetToContent({ contentId, asset, displayOrder: 0 });
    const updatedContent = await loadUpdatedContent(contentId);
    if (!updatedContent) {
      return reply.code(404).send({ error: 'Content not found after attaching asset' });
    }
    await syncScheduledContentIfNeeded({ updatedContent, contentId, request, action: 'asset' });
    return reply.send({ content: mapContentResponse(updatedContent) });
  } catch (error: unknown) {
    request.log.error({ err: error, contentId, assetId }, 'Failed to attach asset to content');
    return reply.code(500).send({ error: 'Failed to attach asset to content' });
  }
}

async function createReplaceMediaHandler(request: any, reply: any) {
  const userId = request.user!.id;
  const { contentId } = request.params as { contentId: string };
  const { assetIds } = request.body as { assetIds?: string[] };
  if (!Array.isArray(assetIds)) {
    return reply.code(400).send({ error: 'assetIds must be an array' });
  }

  try {
    const content = await ensureEditableContent({ userId, contentId, reply });
    if (!content) {
      return;
    }

    if (assetIds.length === 0) {
      await clearContentMedia(contentId);
    } else {
      let assets: Array<AssetRecord | null>;
      try {
        assets = await fetchAssetsBatch(assetIds);
      } catch (error: unknown) {
        request.log.error(
          { err: error, assetIds },
          'Failed to fetch media assets for content update'
        );
        return reply.code(400).send({ error: 'Failed to fetch media assets. Please try again.' });
      }

      const missingAssets = findMissingAssetIds(assetIds, assets);
      if (missingAssets.length > 0) {
        return reply.code(404).send({ error: `Assets not found: ${missingAssets.join(', ')}` });
      }

      const validAssets = assets.filter(Boolean) as AssetRecord[];
      const invalidAssets = findBrandMismatchedAssets(validAssets, content.brand.id);
      if (invalidAssets.length > 0) {
        return reply
          .code(400)
          .send({ error: 'All media assets must belong to the same brand as the content' });
      }

      const requiresUniformAspectRatio =
        content.status === 'scheduled' || Boolean(content.publishingQueueItem);
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

      await replaceContentMedia(contentId, validAssets);
    }

    const updatedContent = await loadUpdatedContent(contentId);
    if (!updatedContent) {
      return reply.code(404).send({ error: 'Content not found after media update' });
    }
    await syncScheduledContentIfNeeded({ updatedContent, contentId, request, action: 'media' });
    return reply.send({ content: mapContentResponse(updatedContent) });
  } catch (error: unknown) {
    request.log.error({ err: error, contentId, assetIds }, 'Failed to update content media');
    return reply.code(500).send({ error: 'Failed to update content media' });
  }
}

const mediaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Params: { contentId: string };
    Body: { assetId: string };
  }>('/:contentId/asset', { preHandler: fastify.authenticate }, createAttachAssetHandler);

  fastify.put<{
    Params: { contentId: string };
    Body: { assetIds: string[] };
  }>('/:contentId/media', { preHandler: fastify.authenticate }, createReplaceMediaHandler);
};

export default mediaRoutes;
