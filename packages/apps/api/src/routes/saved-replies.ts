/**
 * Saved Replies API Routes
 * CRUD operations for managing quick response templates
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { logger as baseLogger } from '@postolio/logger';

import { prisma } from '../config/database.js';
import { isInboxEnabledForUser } from '../utils/feature-flags.js';

const logger = baseLogger.child({ module: 'saved-replies-routes' });

type AuthenticatedRequest = FastifyRequest & {
  user?: {
    id?: string;
    email?: string | null;
  };
};

async function requireInboxFeature(request: AuthenticatedRequest, reply: FastifyReply) {
  const userId = request.user?.id ?? null;
  const email = request.user?.email ?? null;
  if (!isInboxEnabledForUser({ userId, email })) {
    return reply.code(403).send({
      error: 'feature_disabled',
      code: 'INBOX_DISABLED',
      message: 'Inbox is not enabled for this account',
    });
  }
}

async function assertBrandExistsForUser(brandId: string, userId: string) {
  return prisma.brand.findFirst({ where: { id: brandId, userId } });
}

function registerListSavedRepliesRoute(fastify: FastifyInstance): void {
  fastify.get<{ Params: { brandId: string } }>(
    '/brands/:brandId/saved-replies',
    { preHandler: [fastify.authenticate, requireInboxFeature] },
    async (request, reply) => {
      const { brandId } = request.params;
      const userId = request.user!.id;

      try {
        const brand = await assertBrandExistsForUser(brandId, userId);
        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        const savedReplies = await prisma.savedReply.findMany({
          where: { brandId },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        });

        logger.info('Fetched saved replies', { brandId, userId, count: savedReplies.length });
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
}

function registerCreateSavedReplyRoute(fastify: FastifyInstance): void {
  fastify.post<{
    Params: { brandId: string };
    Body: { title: string; body: string; isDefault?: boolean };
  }>(
    '/brands/:brandId/saved-replies',
    { preHandler: [fastify.authenticate, requireInboxFeature] },
    async (request, reply) => {
      const { brandId } = request.params;
      const { title, body, isDefault = false } = request.body;
      const userId = request.user!.id;

      try {
        const brand = await assertBrandExistsForUser(brandId, userId);
        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }
        if (!title?.trim()) {
          return reply.code(400).send({ error: 'Title is required' });
        }
        if (!body?.trim()) {
          return reply.code(400).send({ error: 'Message body is required' });
        }

        const existing = await prisma.savedReply.findUnique({
          where: { brandId_title: { brandId, title: title.trim() } },
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
}

function registerUpdateSavedReplyRoute(fastify: FastifyInstance): void {
  fastify.put<{
    Params: { brandId: string; replyId: string };
    Body: { title?: string; body?: string; isDefault?: boolean };
  }>(
    '/brands/:brandId/saved-replies/:replyId',
    { preHandler: [fastify.authenticate, requireInboxFeature] },
    async (request, reply) => {
      const { brandId, replyId } = request.params;
      const { title, body, isDefault } = request.body;
      const userId = request.user!.id;

      try {
        const savedReply = await prisma.savedReply.findFirst({
          where: { id: replyId, brandId, brand: { userId } },
        });
        if (!savedReply) {
          return reply.code(404).send({ error: 'Saved reply not found' });
        }

        if (title && title.trim() !== savedReply.title) {
          const existing = await prisma.savedReply.findUnique({
            where: { brandId_title: { brandId, title: title.trim() } },
          });
          if (existing && existing.id !== replyId) {
            return reply.code(409).send({ error: 'A saved reply with this title already exists' });
          }
        }

        const updated = await prisma.savedReply.update({
          where: { id: replyId },
          data: {
            ...(title && { title: title.trim() }),
            ...(body && { body: body.trim() }),
            ...(isDefault !== undefined && { isDefault }),
          },
        });

        logger.info('Updated saved reply', { brandId, userId, savedReplyId: replyId });
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
}

function registerDeleteSavedReplyRoute(fastify: FastifyInstance): void {
  fastify.delete<{ Params: { brandId: string; replyId: string } }>(
    '/brands/:brandId/saved-replies/:replyId',
    { preHandler: [fastify.authenticate, requireInboxFeature] },
    async (request, reply) => {
      const { brandId, replyId } = request.params;
      const userId = request.user!.id;

      try {
        const savedReply = await prisma.savedReply.findFirst({
          where: { id: replyId, brandId, brand: { userId } },
        });
        if (!savedReply) {
          return reply.code(404).send({ error: 'Saved reply not found' });
        }

        await prisma.savedReply.delete({ where: { id: replyId } });
        logger.info('Deleted saved reply', { brandId, userId, savedReplyId: replyId });
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
}

const savedRepliesRoutes: FastifyPluginAsync = async (fastify) => {
  registerListSavedRepliesRoute(fastify);
  registerCreateSavedReplyRoute(fastify);
  registerUpdateSavedReplyRoute(fastify);
  registerDeleteSavedReplyRoute(fastify);
};

export default savedRepliesRoutes;
