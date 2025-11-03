/**
 * Content Image Routes
 * Handles image upload for content
 */

import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@postolio/database';

import { uploadImageBufferToS3, type ImageMetadata } from '../../services/s3-image.js';
import { buildContentResponse } from '../../services/content-response-builder.js';
import { validateAndConvertImage, validateMimeType } from '../../services/image-validator.js';
import { verifyContentEditable } from '../../services/content-operations/authorization.js';
import { getDatabaseClient } from '../../config/database.js';

const prisma = getDatabaseClient();

const imagesRoutes: FastifyPluginAsync = async (fastify) => {
  // Upload image for content
  fastify.post<{
    Body: {
      contentId: string;
      imageData: string; // Base64 encoded image data
      mimeType: string;
    };
  }>('/upload-image', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;

      const { contentId, imageData, mimeType } = request.body;

      // Validate input
      if (!contentId || !imageData || !mimeType) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      // Validate mime type
      const mimeValidation = validateMimeType(mimeType);
      if (!mimeValidation.valid) {
        return reply.code(400).send({ error: mimeValidation.error });
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
        // Validate and convert image data using validator service
        const validationResult = validateAndConvertImage(imageData, mimeType);

        if (!validationResult.valid) {
          return reply.code(400).send({ error: validationResult.error });
        }

        const buffer = validationResult.data!.buffer;

        // Upload to S3
        let uploadResult = null;

        try {
          const metadata: ImageMetadata = {
            contentId: content.id,
            brandId: content.brand.id,
            campaignId: content.campaignId || undefined,
            generatedAt: new Date(),
            source: 'dalle3', // Mark as user upload (we use dalle3 as default)
            originalPrompt: 'User uploaded image',
          };

          console.log('Uploading user image to S3 for content:', contentId);
          console.log('Image buffer size:', buffer.length, 'bytes');
          console.log('MIME type:', mimeType);

          uploadResult = await uploadImageBufferToS3(buffer, metadata);

          console.log('Upload successful! S3 key:', uploadResult.s3Key);
        } catch (s3Error) {
          console.error('S3 upload failed:', s3Error);
          // Fail gracefully instead of storing large base64 data URLs
          return reply.code(500).send({
            error: 'Failed to upload image to storage. Please try again.',
          });
        }

        // Update content with S3 data
        const updateData: Record<string, unknown> = {
          s3ImageKey: uploadResult.s3Key,
          imageRegion: uploadResult.region,
          retentionExpiresAt: uploadResult.retentionExpiresAt,
        };

        const updatedContent = await prisma.content.update({
          where: { id: contentId },
          data: updateData as unknown as Prisma.ContentUpdateInput,
          select: {
            id: true,
            caption: true,
            hashtags: true,
            s3ImageKey: true,
            status: true,
            scheduledAt: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        // Build CDN URL from S3 key and map to public response format
        const contentWithUrl = buildContentResponse(updatedContent);

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
