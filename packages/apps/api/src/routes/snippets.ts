/**
 * Snippets API Routes
 * CRUD operations for managing reusable text snippets for social media captions
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../config/database.js';
import { logger as baseLogger } from '@postolio/logger';
import { isSnippetsEnabledForUser } from '../utils/feature-flags.js';
import {
  buildSnippetUpdateData,
  buildSnippetWhereFilter,
  ensureSnippetTitleIsUniqueForUpdate,
  normalizeTags,
  type SnippetQueryParams,
  trimNullableCategory,
  type UpdateSnippetBody,
  validateSnippetUpdateContent,
  verifyBrandOwnership,
  verifySnippetOwnership,
} from './snippets.helpers.js';

const logger = baseLogger.child({ module: 'snippets-routes' });

type AuthenticatedRequest = FastifyRequest & {
  user?: {
    id?: string;
    email?: string | null;
  };
};

async function requireSnippetsFeature(request: AuthenticatedRequest, reply: FastifyReply) {
  const userId = request.user?.id ?? null;
  const email = request.user?.email ?? null;
  if (!isSnippetsEnabledForUser({ userId, email })) {
    return reply.code(403).send({
      error: 'feature_disabled',
      code: 'SNIPPETS_DISABLED',
      message: 'Snippets are not enabled for this account',
    });
  }
}

interface CreateSnippetBody {
  title: string;
  content: string;
  tags?: string[];
  category?: string;
  isFavorite?: boolean;
}

interface BrandRouteParams {
  brandId: string;
}

interface SnippetRouteParams extends BrandRouteParams {
  snippetId: string;
}

function registerListSnippetsRoute(fastify: FastifyInstance) {
  fastify.get<{
    Params: BrandRouteParams;
    Querystring: SnippetQueryParams;
  }>(
    '/brands/:brandId/snippets',
    { preHandler: [fastify.authenticate, requireSnippetsFeature] },
    async (request, reply) => {
      const { brandId } = request.params;
      const { limit = 100, offset = 0, search, tags, category } = request.query;
      const userId = request.user!.id;

      try {
        const isOwned = await verifyBrandOwnership(brandId, userId, reply);
        if (!isOwned) {
          return;
        }

        const where = buildSnippetWhereFilter(brandId, request.query);
        const [snippets, total] = await Promise.all([
          prisma.snippet.findMany({
            where,
            orderBy: [{ isFavorite: 'desc' }, { lastUsedAt: 'desc' }, { createdAt: 'desc' }],
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

        return reply.send({ snippets, total, limit, offset });
      } catch (error) {
        logger.error('Error fetching snippets', {
          brandId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to fetch snippets' });
      }
    }
  );
}

function registerCreateSnippetRoute(fastify: FastifyInstance) {
  fastify.post<{
    Params: BrandRouteParams;
    Body: CreateSnippetBody;
  }>(
    '/brands/:brandId/snippets',
    { preHandler: [fastify.authenticate, requireSnippetsFeature] },
    async (request, reply) => {
      const { brandId } = request.params;
      const { title, content, tags = [], category, isFavorite = false } = request.body;
      const userId = request.user!.id;

      try {
        const isOwned = await verifyBrandOwnership(brandId, userId, reply);
        if (!isOwned) {
          return;
        }

        if (!title?.trim()) {
          return reply.code(400).send({ error: 'Title is required' });
        }
        if (!content?.trim()) {
          return reply.code(400).send({ error: 'Content is required' });
        }
        if (content.length > 2000) {
          return reply.code(400).send({ error: 'Content must be 2000 characters or less' });
        }

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

        const snippet = await prisma.snippet.create({
          data: {
            brandId,
            userId,
            title: title.trim(),
            content: content.trim(),
            tags: normalizeTags(tags),
            category: trimNullableCategory(category),
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
    }
  );
}

function registerUpdateSnippetRoute(fastify: FastifyInstance) {
  fastify.put<{
    Params: SnippetRouteParams;
    Body: UpdateSnippetBody;
  }>(
    '/brands/:brandId/snippets/:snippetId',
    { preHandler: [fastify.authenticate, requireSnippetsFeature] },
    async (request, reply) => {
      const { brandId, snippetId } = request.params;
      const { title, content, tags, category, isFavorite, isArchived } = request.body;
      const userId = request.user!.id;

      try {
        const snippet = await verifySnippetOwnership(brandId, snippetId, userId, reply);
        if (!snippet) {
          return;
        }

        const canProceedWithContent = validateSnippetUpdateContent(content, reply);
        if (!canProceedWithContent) {
          return;
        }

        const hasUniqueTitle = await ensureSnippetTitleIsUniqueForUpdate({
          brandId,
          snippetId,
          currentTitle: snippet.title,
          incomingTitle: title,
          reply,
        });
        if (!hasUniqueTitle) {
          return;
        }

        const updated = await prisma.snippet.update({
          where: { id: snippetId },
          data: buildSnippetUpdateData({ title, content, tags, category, isFavorite, isArchived }),
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
}

function registerTrackSnippetUsageRoute(fastify: FastifyInstance) {
  fastify.post<{
    Params: SnippetRouteParams;
  }>(
    '/brands/:brandId/snippets/:snippetId/usage',
    { preHandler: [fastify.authenticate, requireSnippetsFeature] },
    async (request, reply) => {
      const { brandId, snippetId } = request.params;
      const userId = request.user!.id;

      try {
        const snippet = await verifySnippetOwnership(brandId, snippetId, userId, reply);
        if (!snippet) {
          return;
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
}

function registerDeleteSnippetRoute(fastify: FastifyInstance) {
  fastify.delete<{
    Params: SnippetRouteParams;
  }>(
    '/brands/:brandId/snippets/:snippetId',
    { preHandler: [fastify.authenticate, requireSnippetsFeature] },
    async (request, reply) => {
      const { brandId, snippetId } = request.params;
      const userId = request.user!.id;

      try {
        const snippet = await verifySnippetOwnership(brandId, snippetId, userId, reply);
        if (!snippet) {
          return;
        }

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
}

function registerSnippetRoutes(fastify: FastifyInstance) {
  registerListSnippetsRoute(fastify);
  registerCreateSnippetRoute(fastify);
  registerUpdateSnippetRoute(fastify);
  registerTrackSnippetUsageRoute(fastify);
  registerDeleteSnippetRoute(fastify);
}

const snippetsRoutes: FastifyPluginAsync = async (fastify) => {
  registerSnippetRoutes(fastify);
};

export default snippetsRoutes;
