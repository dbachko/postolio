import type { FastifyInstance } from 'fastify';
import { Prisma } from '@postolio/database';

import { getMaxQueueDepthForTier } from '../../constants/subscription.js';
import { assertSocialAccountAccess } from '../../services/ownership.js';
import { ensureDefaultQueueWithStarterSchedule } from '../../services/publishing-queue/default-schedule.js';
import { prisma } from './shared.js';

const QUEUE_LIST_SELECT: Prisma.PublishingQueueSelect = {
  id: true,
  socialAccountId: true,
  name: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: { slots: true, items: true },
  },
};

const QUEUE_LIST_ORDER_BY: Prisma.PublishingQueueOrderByWithRelationInput[] = [
  { isDefault: 'desc' },
  { createdAt: 'asc' },
];

async function resolveSubscriptionTier(user: unknown, userId: string): Promise<string> {
  const tier = (user as any)?.subscriptionTier;
  if (typeof tier === 'string') {
    return String(tier);
  }

  try {
    const resolved = await (prisma as any)?.user?.findUnique?.({
      where: { id: userId },
      select: { subscriptionTier: true },
    });
    return resolved?.subscriptionTier || 'free';
  } catch {
    return 'free';
  }
}

async function findQueuesWithDefaultProvisioning(socialAccountId: string): Promise<
  Array<{
    id: string;
    socialAccountId: string;
    name: string;
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
    _count: { slots: number; items: number };
  }>
> {
  const findQueues = () =>
    prisma.publishingQueue.findMany({
      where: { socialAccountId },
      select: QUEUE_LIST_SELECT,
      orderBy: QUEUE_LIST_ORDER_BY,
    });

  let queues = await findQueues();
  if (queues.length > 0) {
    return queues;
  }

  try {
    await ensureDefaultQueueWithStarterSchedule(prisma, socialAccountId);
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
      throw error;
    }
  }

  queues = await findQueues();
  return queues;
}

export function registerListQueuesRoute(fastify: FastifyInstance): void {
  fastify.get<{ Params: { socialAccountId: string } }>(
    '/social-accounts/:socialAccountId/queues',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { socialAccountId } = request.params;

      await assertSocialAccountAccess(userId, socialAccountId);

      const tier = await resolveSubscriptionTier(request.user, userId);
      const maxDepthRaw = getMaxQueueDepthForTier(tier);
      const queueDepthMax = Number.isFinite(maxDepthRaw) ? maxDepthRaw : null;
      const queueDepthCurrent = await prisma.publishingQueueItem.count({
        where: {
          queue: { socialAccountId },
          content: { status: { notIn: ['published', 'unavailable'] } },
        },
      });

      const queues = await findQueuesWithDefaultProvisioning(socialAccountId);
      return reply.send({
        success: true,
        data: {
          socialAccountId,
          queueDepthCurrent,
          queueDepthMax,
          queues: queues.map((queue) => ({
            id: queue.id,
            name: queue.name,
            isDefault: queue.isDefault,
            slotCount: queue._count.slots,
            itemCount: queue._count.items,
            createdAt: queue.createdAt,
            updatedAt: queue.updatedAt,
          })),
        },
      });
    }
  );
}
