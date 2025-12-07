/**
 * Saved Replies API Routes
 * CRUD operations for managing quick response templates
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { logger as baseLogger } from '@postolio/logger';

const logger = baseLogger.child({ module: 'saved-replies-routes' });

const savedRepliesRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/brands/:brandId/saved-replies
   * List all saved replies for a brand
   */
  fastify.get<{ Params: { brandId: string } }>(
    '/brands/:brandId/saved-replies',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const userId = request.user!.id;

      try {
        // Verify brand belongs to user
        const brand = await prisma.brand.findFirst({
          where: { id: brandId, userId },
        });

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        const savedReplies = await prisma.savedReply.findMany({
          where: { brandId },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        });

        logger.info('Fetched saved replies', {
          brandId,
          userId,
          count: savedReplies.length,
        });

        return reply.send({ savedReplies });
      } catch (error) {
        logger.error('Error fetching saved replies', {
          brandId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to fetch saved replies' });
      }
    }
  );

  /**
   * POST /api/brands/:brandId/saved-replies
   * Create a new saved reply
   */
  fastify.post<{
    Params: { brandId: string };
    Body: { title: string; body: string; isDefault?: boolean };
  }>(
    '/brands/:brandId/saved-replies',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId } = request.params;
      const { title, body, isDefault = false } = request.body;
      const userId = request.user!.id;

      try {
        // Verify brand belongs to user
        const brand = await prisma.brand.findFirst({
          where: { id: brandId, userId },
        });

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        // Validate input
        if (!title || !title.trim()) {
          return reply.code(400).send({ error: 'Title is required' });
        }

        if (!body || !body.trim()) {
          return reply.code(400).send({ error: 'Message body is required' });
        }

        // Check for duplicate title
        const existing = await prisma.savedReply.findUnique({
          where: {
            brandId_title: {
              brandId,
              title: title.trim(),
            },
          },
        });

        if (existing) {
          return reply.code(409).send({ error: 'A saved reply with this title already exists' });
        }

        const savedReply = await prisma.savedReply.create({
          data: {
            brandId,
            userId,
            title: title.trim(),
            body: body.trim(),
            isDefault,
          },
        });

        logger.info('Created saved reply', {
          brandId,
          userId,
          savedReplyId: savedReply.id,
          title: savedReply.title,
        });

        return reply.code(201).send({ savedReply });
      } catch (error) {
        logger.error('Error creating saved reply', {
          brandId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to create saved reply' });
      }
    }
  );

  /**
   * PUT /api/brands/:brandId/saved-replies/:replyId
   * Update a saved reply
   */
  fastify.put<{
    Params: { brandId: string; replyId: string };
    Body: { title?: string; body?: string; isDefault?: boolean };
  }>(
    '/brands/:brandId/saved-replies/:replyId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId, replyId } = request.params;
      const { title, body, isDefault } = request.body;
      const userId = request.user!.id;

      try {
        // Verify saved reply belongs to user's brand
        const savedReply = await prisma.savedReply.findFirst({
          where: {
            id: replyId,
            brandId,
            brand: { userId },
          },
        });

        if (!savedReply) {
          return reply.code(404).send({ error: 'Saved reply not found' });
        }

        // If title is being updated, check for duplicates
        if (title && title.trim() !== savedReply.title) {
          const existing = await prisma.savedReply.findUnique({
            where: {
              brandId_title: {
                brandId,
                title: title.trim(),
              },
            },
          });

          if (existing && existing.id !== replyId) {
            return reply.code(409).send({ error: 'A saved reply with this title already exists' });
          }
        }

        // Update the saved reply
        const updated = await prisma.savedReply.update({
          where: { id: replyId },
          data: {
            ...(title && { title: title.trim() }),
            ...(body && { body: body.trim() }),
            ...(isDefault !== undefined && { isDefault }),
          },
        });

        logger.info('Updated saved reply', {
          brandId,
          userId,
          savedReplyId: replyId,
        });

        return reply.send({ savedReply: updated });
      } catch (error) {
        logger.error('Error updating saved reply', {
          brandId,
          replyId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to update saved reply' });
      }
    }
  );

  /**
   * DELETE /api/brands/:brandId/saved-replies/:replyId
   * Delete a saved reply
   */
  fastify.delete<{ Params: { brandId: string; replyId: string } }>(
    '/brands/:brandId/saved-replies/:replyId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId, replyId } = request.params;
      const userId = request.user!.id;

      try {
        // Verify saved reply belongs to user's brand
        const savedReply = await prisma.savedReply.findFirst({
          where: {
            id: replyId,
            brandId,
            brand: { userId },
          },
        });

        if (!savedReply) {
          return reply.code(404).send({ error: 'Saved reply not found' });
        }

        await prisma.savedReply.delete({
          where: { id: replyId },
        });

        logger.info('Deleted saved reply', {
          brandId,
          userId,
          savedReplyId: replyId,
        });

        return reply.code(204).send();
      } catch (error) {
        logger.error('Error deleting saved reply', {
          brandId,
          replyId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to delete saved reply' });
      }
    }
  );
};

export default savedRepliesRoutes;
