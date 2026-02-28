/**
 * Content Image Routes
 * Handles image upload for content
 */

import type { FastifyPluginAsync } from 'fastify';
import { buildContentResponse } from '../../services/content-response-builder.js';
import {
  verifyAssetOwnership,
  attachAssetToContent,
  importImageFromExternalUrl,
} from '../../services/assets-media.js';
import { verifyContentEditable } from '../../services/content-operations/authorization.js';
import { getDatabaseClient } from '../../config/database.js';

const prisma = getDatabaseClient();

async function loadContentForUpload(contentId: string) {
  return prisma.content.findFirst({
    where: { id: contentId },
    include: {
      brand: {
        select: { userId: true, id: true },
      },
    },
  });
}

async function resolveUploadAsset(params: {
  assetId?: string;
  externalUrl?: string;
  contentId: string;
  brandId: string;
}) {
  if (params.assetId) {
    return verifyAssetOwnership(params.assetId, params.brandId);
  }
  return importImageFromExternalUrl(params.externalUrl!, {
    contentId: params.contentId,
    brandId: params.brandId,
    originalPrompt: 'User uploaded image',
    source: 'user_upload',
  });
}

async function loadUpdatedContent(contentId: string) {
  return prisma.content.findUnique({
    where: { id: contentId },
    select: {
      id: true,
      caption: true,
      status: true,
      scheduledAt: true,
      createdAt: true,
      updatedAt: true,
      brandId: true,
      contentSeriesId: true,
      recipeRunId: true,
      recipeRun: {
        select: {
          recipeTemplate: { select: { id: true, slug: true, name: true } },
        },
      },
      schedulingError: true,
      hashtags: true,
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
}

function createUploadImageHandler() {
  return async (request: any, reply: any) => {
    try {
      const userId = request.user!.id;
      const { contentId, assetId, externalUrl } = request.body as {
        contentId: string;
        assetId?: string;
        externalUrl?: string;
      };
      if (!contentId || (!assetId && !externalUrl)) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      const authResult = await verifyContentEditable(userId, contentId);
      if (!authResult.authorized) {
        return reply.code(authResult.error?.includes('immutable') ? 400 : 404).send({
          error: authResult.error,
        });
      }

      const content = await loadContentForUpload(contentId);
      if (!content) {
        return reply.code(404).send({ error: 'Content not found' });
      }

      try {
        const asset = await resolveUploadAsset({
          assetId,
          externalUrl,
          contentId,
          brandId: content.brand.id,
        });
        await attachAssetToContent({ contentId, asset, displayOrder: 0 });
        const updatedContent = await loadUpdatedContent(contentId);
        if (!updatedContent) {
          return reply.code(404).send({ error: 'Content not found after linking asset' });
        }
        const contentWithUrl = buildContentResponse({
          ...(updatedContent as any),
          generatedByRecipe: (updatedContent as any).recipeRun?.recipeTemplate ?? null,
        });
        return reply.send({
          success: true,
          content: contentWithUrl,
          message: 'Image uploaded successfully',
        });
      } catch (uploadError: unknown) {
        request.log.error({ err: uploadError }, 'Image upload error');
        return reply.code(500).send({ error: 'Failed to upload image' });
      }
    } catch (error: unknown) {
      request.log.error({ err: error }, 'Upload image error');
      return reply.code(500).send({ error: 'Failed to process image upload' });
    }
  };
}

const imagesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Body: {
      contentId: string;
      assetId?: string;
      externalUrl?: string;
    };
  }>('/upload-image', { preHandler: fastify.authenticate }, createUploadImageHandler());
};

export default imagesRoutes;
