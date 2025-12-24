/**
 * Snippets API Routes
 * CRUD operations for managing reusable text snippets for social media captions
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { logger as baseLogger } from '@postolio/logger';

const logger = baseLogger.child({ module: 'snippets-routes' });

interface SnippetQueryParams {
  search?: string;
  tags?: string; // Comma-separated
  category?: string;
  limit?: number;
  offset?: number;
}

interface CreateSnippetBody {
  title: string;
  content: string;
  tags?: string[];
  category?: string;
  isFavorite?: boolean;
}

interface UpdateSnippetBody {
  title?: string;
  content?: string;
  tags?: string[];
  category?: string;
  isFavorite?: boolean;
  isArchived?: boolean;
}

const snippetsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/brands/:brandId/snippets
   * List all snippets for a brand with optional filtering
   */
  fastify.get<{
    Params: { brandId: string };
    Querystring: SnippetQueryParams;
  }>('/brands/:brandId/snippets', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { brandId } = request.params;
    const { search, tags, category, limit = 100, offset = 0 } = request.query;
    const userId = request.user!.id;

    try {
      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: { id: brandId, userId },
      });

      if (!brand) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      // Build filter conditions
      const where: any = {
        brandId,
        isArchived: false,
      };

      // Search in title and content
      if (search) {
        where.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { content: { contains: search, mode: 'insensitive' } },
        ];
      }

      // Filter by tags (must include all specified tags)
      if (tags) {
        const tagArray = tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        if (tagArray.length > 0) {
          where.tags = { hasEvery: tagArray };
        }
      }

      // Filter by category
      if (category) {
        where.category = category;
      }

      const [snippets, total] = await Promise.all([
        prisma.snippet.findMany({
          where,
          orderBy: [
            { isFavorite: 'desc' }, // Favorites first
            { lastUsedAt: 'desc' }, // Recently used
            { createdAt: 'desc' }, // Then newest
          ],
          take: limit,
          skip: offset,
        }),
        prisma.snippet.count({ where }),
      ]);

      logger.info('Fetched snippets', {
        brandId,
        userId,
        count: snippets.length,
        total,
        filters: { search, tags, category },
      });

      return reply.send({
        snippets,
        total,
        limit,
        offset,
      });
    } catch (error) {
      logger.error('Error fetching snippets', {
        brandId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return reply.code(500).send({ error: 'Failed to fetch snippets' });
    }
  });

  /**
   * POST /api/brands/:brandId/snippets
   * Create a new snippet
   */
  fastify.post<{
    Params: { brandId: string };
    Body: CreateSnippetBody;
  }>('/brands/:brandId/snippets', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { brandId } = request.params;
    const { title, content, tags = [], category, isFavorite = false } = request.body;
    const userId = request.user!.id;

    try {
      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: { id: brandId, userId },
      });

      if (!brand) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      // Validation
      if (!title?.trim()) {
        return reply.code(400).send({ error: 'Title is required' });
      }

      if (!content?.trim()) {
        return reply.code(400).send({ error: 'Content is required' });
      }

      if (content.length > 2000) {
        return reply.code(400).send({ error: 'Content must be 2000 characters or less' });
      }

      // Check for duplicate title
      const existing = await prisma.snippet.findFirst({
        where: {
          brandId,
          title: title.trim(),
          isArchived: false,
        },
      });

      if (existing) {
        return reply.code(409).send({ error: 'A snippet with this title already exists' });
      }

      // Normalize tags to lowercase
      const normalizedTags = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);

      const snippet = await prisma.snippet.create({
        data: {
          brandId,
          userId,
          title: title.trim(),
          content: content.trim(),
          tags: normalizedTags,
          category: category?.trim() || null,
          isFavorite,
        },
      });

      logger.info('Created snippet', {
        brandId,
        userId,
        snippetId: snippet.id,
        title: snippet.title,
      });

      return reply.code(201).send({ snippet });
    } catch (error) {
      logger.error('Error creating snippet', {
        brandId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return reply.code(500).send({ error: 'Failed to create snippet' });
    }
  });

  /**
   * PUT /api/brands/:brandId/snippets/:snippetId
   * Update an existing snippet
   */
  fastify.put<{
    Params: { brandId: string; snippetId: string };
    Body: UpdateSnippetBody;
  }>(
    '/brands/:brandId/snippets/:snippetId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId, snippetId } = request.params;
      const { title, content, tags, category, isFavorite, isArchived } = request.body;
      const userId = request.user!.id;

      try {
        // Verify snippet ownership
        const snippet = await prisma.snippet.findFirst({
          where: {
            id: snippetId,
            brandId,
            brand: { userId },
          },
        });

        if (!snippet) {
          return reply.code(404).send({ error: 'Snippet not found' });
        }

        // Validation
        if (content && content.length > 2000) {
          return reply.code(400).send({ error: 'Content must be 2000 characters or less' });
        }

        // Check for duplicate title if title is being updated
        if (title && title.trim() !== snippet.title) {
          const existing = await prisma.snippet.findFirst({
            where: {
              brandId,
              title: title.trim(),
              isArchived: false,
              id: { not: snippetId },
            },
          });

          if (existing) {
            return reply.code(409).send({ error: 'A snippet with this title already exists' });
          }
        }

        // Normalize tags to lowercase if provided
        const normalizedTags = tags
          ? tags.map((t) => t.trim().toLowerCase()).filter(Boolean)
          : undefined;

        const updated = await prisma.snippet.update({
          where: { id: snippetId },
          data: {
            ...(title && { title: title.trim() }),
            ...(content && { content: content.trim() }),
            ...(normalizedTags !== undefined && { tags: normalizedTags }),
            ...(category !== undefined && { category: category?.trim() || null }),
            ...(isFavorite !== undefined && { isFavorite }),
            ...(isArchived !== undefined && { isArchived }),
          },
        });

        logger.info('Updated snippet', {
          brandId,
          userId,
          snippetId,
        });

        return reply.send({ snippet: updated });
      } catch (error) {
        logger.error('Error updating snippet', {
          brandId,
          snippetId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to update snippet' });
      }
    }
  );

  /**
   * POST /api/brands/:brandId/snippets/:snippetId/usage
   * Track snippet usage (increment count, update last used)
   */
  fastify.post<{
    Params: { brandId: string; snippetId: string };
  }>(
    '/brands/:brandId/snippets/:snippetId/usage',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId, snippetId } = request.params;
      const userId = request.user!.id;

      try {
        // Verify snippet ownership
        const snippet = await prisma.snippet.findFirst({
          where: {
            id: snippetId,
            brandId,
            brand: { userId },
          },
        });

        if (!snippet) {
          return reply.code(404).send({ error: 'Snippet not found' });
        }

        const updated = await prisma.snippet.update({
          where: { id: snippetId },
          data: {
            usageCount: { increment: 1 },
            lastUsedAt: new Date(),
          },
        });

        logger.info('Tracked snippet usage', {
          brandId,
          userId,
          snippetId,
          usageCount: updated.usageCount,
        });

        return reply.send({ snippet: updated });
      } catch (error) {
        logger.error('Error tracking snippet usage', {
          brandId,
          snippetId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to track snippet usage' });
      }
    }
  );

  /**
   * DELETE /api/brands/:brandId/snippets/:snippetId
   * Delete (archive) a snippet
   */
  fastify.delete<{
    Params: { brandId: string; snippetId: string };
  }>(
    '/brands/:brandId/snippets/:snippetId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { brandId, snippetId } = request.params;
      const userId = request.user!.id;

      try {
        // Verify snippet ownership
        const snippet = await prisma.snippet.findFirst({
          where: {
            id: snippetId,
            brandId,
            brand: { userId },
          },
        });

        if (!snippet) {
          return reply.code(404).send({ error: 'Snippet not found' });
        }

        // Soft delete (archive)
        await prisma.snippet.update({
          where: { id: snippetId },
          data: { isArchived: true },
        });

        logger.info('Deleted (archived) snippet', {
          brandId,
          userId,
          snippetId,
        });

        return reply.code(204).send();
      } catch (error) {
        logger.error('Error deleting snippet', {
          brandId,
          snippetId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to delete snippet' });
      }
    }
  );
};

export default snippetsRoutes;
