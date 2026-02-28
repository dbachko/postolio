import type { FastifyInstance } from 'fastify';

import { getMaxQueueDepthForTier } from '../../constants/subscription.js';
import { assertPublishingQueueAccess } from '../../services/ownership.js';
import { validateQueueableContent } from '../../services/publishing-queue/queue-content-validation.js';
import { publishingQueueScheduler } from '../../services/publishing-queue/queue-scheduler.js';
import { normalizeContentLaneKey } from '../publishing-queue-utils.js';
import { broadcastQueueItemStatusChange, prisma } from './shared.js';

function parseContentId(rawContentId: unknown): string | null {
  return typeof rawContentId === 'string' && rawContentId.trim() ? rawContentId.trim() : null;
}

async function ensureQueueDepthWithinPlan(options: {
  userId: string;
  socialAccountId: string;
  existingItem: { id: string; queueId: string } | null;
}): Promise<{ maxDepth: number | null }> {
  const tier = await prisma.user
    .findUnique({ where: { id: options.userId }, select: { subscriptionTier: true } })
    .then((user) => user?.subscriptionTier || 'free');

  const maxDepthRaw = getMaxQueueDepthForTier(tier);
  if (options.existingItem || !Number.isFinite(maxDepthRaw)) {
    return { maxDepth: Number.isFinite(maxDepthRaw) ? Number(maxDepthRaw) : null };
  }

  const currentDepth = await prisma.publishingQueueItem.count({
    where: {
      queue: { socialAccountId: options.socialAccountId },
      content: { status: { notIn: ['published', 'unavailable'] } },
    },
  });

  if (currentDepth + 1 > Number(maxDepthRaw)) {
    throw Object.assign(new Error('queue_depth_limit'), { maxAllowed: Number(maxDepthRaw) });
  }

  return { maxDepth: Number(maxDepthRaw) };
}

function isQueueDepthLimitError(error: unknown): error is { maxAllowed: number } {
  return error instanceof Error && error.message === 'queue_depth_limit';
}

type QueueAccess = Awaited<ReturnType<typeof assertPublishingQueueAccess>>;

async function resolveQueueAndContent(options: {
  userId: string;
  queueId: string;
  contentId: string;
}) {
  const queue = await assertPublishingQueueAccess(options.userId, options.queueId);
  const content = await prisma.content.findFirst({
    where: { id: options.contentId, brandId: queue.socialAccount.brandId },
    select: { id: true, contentType: true, targetSocialAccountId: true, status: true },
  });

  return { queue, content };
}

async function validateQueueReadiness(queue: QueueAccess, contentId: string) {
  return validateQueueableContent({
    contentId,
    brandId: queue.socialAccount.brandId,
    socialAccountId: queue.socialAccountId,
  });
}

async function upsertQueueItem(
  queue: QueueAccess,
  content: { id: string; contentType: string | null }
) {
  const laneKey = normalizeContentLaneKey(content.contentType) || 'post';
  const maxPosition = await prisma.publishingQueueItem.findFirst({
    where: { queueId: queue.id, laneKey },
    select: { position: true },
    orderBy: { position: 'desc' },
  });

  return prisma.publishingQueueItem.upsert({
    where: { contentId: content.id },
    create: {
      queueId: queue.id,
      contentId: content.id,
      laneKey,
      position: (maxPosition?.position ?? 0) + 1,
    },
    update: {
      queueId: queue.id,
      laneKey,
      position: (maxPosition?.position ?? 0) + 1,
    },
    select: {
      id: true,
      queueId: true,
      contentId: true,
      laneKey: true,
      position: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export function registerCreateQueueItemRoute(fastify: FastifyInstance): void {
  fastify.post<{ Params: { queueId: string }; Body: { contentId?: unknown } }>(
    '/queues/:queueId/items',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { queueId } = request.params;
      const contentId = parseContentId(request.body?.contentId);
      if (!contentId) {
        return reply.code(400).send({ success: false, error: 'invalid_content_id' });
      }

      const { queue, content } = await resolveQueueAndContent({ userId, queueId, contentId });
      if (!content) {
        return reply.code(404).send({ success: false, error: 'content_not_found' });
      }
      if (content.targetSocialAccountId !== queue.socialAccountId) {
        return reply.code(400).send({ success: false, error: 'content_wrong_destination' });
      }

      const readiness = await validateQueueReadiness(queue, content.id);
      if (!readiness.ok) {
        return reply.code(400).send({
          success: false,
          error: readiness.code,
          message: readiness.message,
          details: readiness.details,
        });
      }

      const existingItem = await prisma.publishingQueueItem.findUnique({
        where: { contentId: content.id },
        select: { id: true, queueId: true },
      });

      try {
        await ensureQueueDepthWithinPlan({
          userId,
          socialAccountId: queue.socialAccountId,
          existingItem,
        });
      } catch (error) {
        if (isQueueDepthLimitError(error)) {
          return reply.code(402).send({
            success: false,
            error: 'queue_depth_limit',
            maxAllowed: error.maxAllowed,
          });
        }
        throw error;
      }

      const item = await upsertQueueItem(queue, content);
      const recompute = await publishingQueueScheduler.recomputeBrandWindow(
        queue.socialAccount.brandId
      );
      void broadcastQueueItemStatusChange({
        contentId: content.id,
        brandId: queue.socialAccount.brandId,
        status: content.status,
        action: existingItem ? 'moved' : 'enqueued',
        queueId: queue.id,
      });

      return reply.send({ success: true, data: { item, recompute } });
    }
  );
}
