/**
 * Content Generation Routes
 * Handles AI-powered content generation for brands
 */

import { FastifyPluginAsync } from 'fastify';

import {
  generateInstagramContent,
  type ContentGenerationRequest,
} from '../../services/content-generator.js';
import { buildSimpleContentListResponse } from '../../services/content-response-builder.js';
import { importImageFromExternalUrl, attachAssetToContent } from '../../services/assets-media.js';
import { verifyBrandOwnership } from '../../services/content-operations/authorization.js';
import { getDatabaseClient } from '../../config/database.js';
import { assertBrandOwnership } from '../../services/ownership.js';

const prisma = getDatabaseClient();

type GenerateContentBody = ContentGenerationRequest;

const generationRoutes: FastifyPluginAsync = async (fastify) => {
  // Generate content for a brand
  fastify.post<{ Body: GenerateContentBody }>(
    '/generate',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { brandId, count, theme, style } = request.body;

        // Verify user owns the brand
        const authResult = await verifyBrandOwnership(userId, brandId);
        if (!authResult.authorized) {
          return reply.code(404).send({ error: authResult.error });
        }

        const brand = await assertBrandOwnership(userId, brandId);

        // Brand analysis profile is now read from the projection table by the generator

        // Generate content using AI (brand profile projection)
        const generatedContent = await generateInstagramContent(brand.name, {
          brandId,
          count,
          theme: theme || undefined,
          style: style || undefined,
        });

        // Save generated content to database and synchronously attach assets
        const contentRecords = await Promise.all(
          generatedContent.map(async (content) => {
            // Validate content before saving
            if (!content.caption || content.caption.trim().length === 0) {
              console.error('Generated content has empty caption:', content);
              throw new Error('Generated content has empty caption');
            }
            const created = await prisma.content.create({
              data: {
                caption: content.caption,
                status: 'draft',
                brandId,

                campaignId: null,
                generationParams: JSON.parse(
                  JSON.stringify({
                    theme,
                    style,
                    imagePrompt: content.imagePrompt,
                    generatedAt: new Date().toISOString(),
                  })
                ),
              },
              select: {
                id: true,
                caption: true,
                status: true,
                createdAt: true,
              },
            });

            // Synchronous asset import via assets service to ensure media is attached
            if (content.imageUrl && content.imageMetadata) {
              const contentId = created.id;
              const { imageUrl, imageMetadata } = content;

              try {
                const asset = await importImageFromExternalUrl(imageUrl, {
                  contentId,
                  brandId,
                  source: imageMetadata.source,
                  originalPrompt: imageMetadata.originalPrompt,
                });
                await attachAssetToContent({ contentId, asset });
                console.log(`[ContentGen] Asset imported for content ${contentId}`, {
                  brandId,
                  assetId: asset.id,
                });
              } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                console.error(
                  `[ContentGen] Failed to import asset for content ${contentId}; leaving post without media`,
                  {
                    brandId,
                    error: { name: err.name, message: err.message },
                  }
                );
              }
            }

            return {
              id: created.id,
              caption: created.caption,
              primaryAssetCdnUrl: null, // Will be populated after async import
              status: created.status,
              createdAt: created.createdAt,
            };
          })
        );

        // Build CDN URLs from S3 keys and map to public response format
        const contentWithUrls = buildSimpleContentListResponse(contentRecords);

        return reply.code(201).send({
          content: contentWithUrls,
          metadata: {
            brandId,
            count: contentRecords.length,
            theme,
            style,
          },
        });
      } catch (error) {
        request.log.error({ err: error }, 'Content generation error');

        // Handle specific OpenAI errors with appropriate status codes
        if (error instanceof Error) {
          if (error.message.includes('OpenAI API key configuration error')) {
            return reply.code(503).send({
              error: 'AI service configuration error. Please contact support.',
            });
          }
          if (error.message.includes('OpenAI API quota exceeded')) {
            return reply.code(503).send({
              error: 'AI service quota exceeded. Please try again later.',
            });
          }
          if (error.message.includes('OpenAI API rate limit exceeded')) {
            return reply.code(429).send({
              error: 'AI service rate limit exceeded. Please try again in a moment.',
            });
          }
        }

        return reply.code(500).send({ error: 'Failed to generate content. Please try again.' });
      }
    }
  );
};

export default generationRoutes;
