/**
 * Content Publishing Routes
 * Handles publishing content to social media platforms (currently Instagram)
 */

import { FastifyPluginAsync } from 'fastify';

import { verifyContentOwnership } from '../../services/content-operations/authorization.js';
import { publishContentToInstagram } from '../../services/content-operations/publishing.js';
import { getDatabaseClient } from '../../config/database.js';

const prisma = getDatabaseClient();

const publishingRoutes: FastifyPluginAsync = async (fastify) => {
  // Publish content (RESTful: POST /:contentId/publish)
  fastify.post<{ Params: { contentId: string } }>(
    '/:contentId/publish',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { contentId } = request.params;

        // Verify user owns the content
        const authResult = await verifyContentOwnership(userId, contentId);
        if (!authResult.authorized) {
          return reply.code(404).send({ error: authResult.error });
        }

        // Get brand for publishing (content already verified in authResult)
        const brand = await prisma.brand.findUnique({
          where: { id: authResult.data!.brandId },
        });

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        // Publish using the publishing service
        const publishResult = await publishContentToInstagram(contentId, brand);

        if (!publishResult.success) {
          return reply.status(publishResult.retryable ? 500 : 400).send({
            error: publishResult.error,
            retryable: publishResult.retryable,
            timestamp: new Date().toISOString(),
            details: 'Check Instagram connection and try again',
          });
        }

        // Get updated content
        const updatedContent = await prisma.content.findUnique({
          where: { id: contentId },
        });

        return reply.send({
          success: true,
          content: updatedContent,
          instagram: {
            id: publishResult.data!.instagramPostId,
            permalink: publishResult.data!.instagramPermalink,
          },
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to publish to Instagram';
        return reply.status(500).send({
          error: errorMessage,
          retryable: true,
          timestamp: new Date().toISOString(),
          details: 'Check Instagram connection and try again',
        });
      }
    }
  );
};

export default publishingRoutes;
