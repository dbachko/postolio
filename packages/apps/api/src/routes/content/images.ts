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

const imagesRoutes: FastifyPluginAsync = async (fastify) => {
  // Upload image for content
  fastify.post<{
    Body: {
      contentId: string;
      assetId?: string;
      externalUrl?: string;
    };
  }>('/upload-image', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;

      const { contentId, assetId, externalUrl } = request.body;

      if (!contentId || (!assetId && !externalUrl)) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      // Verify user owns the content and it's editable (not published)
      const authResult = await verifyContentEditable(userId, contentId);
      if (!authResult.authorized) {
        return reply.code(authResult.error?.includes('immutable') ? 400 : 404).send({
          error: authResult.error,
        });
      }

      // Get content with brand info
      const content = await prisma.content.findFirst({
        where: { id: contentId },
        include: {
          brand: {
            select: { userId: true, id: true },
          },
        },
      });

      if (!content) {
        return reply.code(404).send({ error: 'Content not found' });
      }

      try {
        let asset;
        if (assetId) {
          asset = await verifyAssetOwnership(assetId, content.brand.id);
        } else {
          asset = await importImageFromExternalUrl(externalUrl!, {
            contentId,
            brandId: content.brand.id,
            originalPrompt: 'User uploaded image',
            source: 'user_upload',
          });
        }
        await attachAssetToContent({ contentId, asset, displayOrder: 0 });

        const updatedContent = await prisma.content.findUnique({
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
      } catch (uploadError) {
        console.error('Image upload error:', uploadError);
        return reply.code(500).send({ error: 'Failed to upload image' });
      }
    } catch (error) {
      console.error('Upload image error:', error);
      return reply.code(500).send({ error: 'Failed to process image upload' });
    }
  });
};

export default imagesRoutes;
