import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { assertBrandOwnership } from '../../../services/ownership.js';
import { getMaxQueueDepthForTier } from '../../../constants/subscription.js';
import { validateQueueableContent } from '../../../services/publishing-queue/queue-content-validation.js';
import { publishingQueueScheduler } from '../../../services/publishing-queue/queue-scheduler.js';
import { ensureMultiDestinationEnabled, prisma, type AuthenticatedRequest } from './shared.js';

type QueueGroupRoute = {
  Params: { contentGroupId: string };
};

type QueueGroup = NonNullable<Awaited<ReturnType<typeof loadGroupForQueue>>>;

type QueueDestination = {
  contentId: string;
  contentType: string;
  targetSocialAccountId: string;
};

type EnqueuedItem = {
  contentId: string;
  socialAccountId: string;
  queueId: string;
  itemId: string;
};

const GROUP_FOR_QUEUE_INCLUDE = {
  brand: {
    select: {
      id: true,
      userId: true,
      user: { select: { subscriptionTier: true } },
    },
  },
  contents: {
    select: {
      id: true,
      status: true,
      contentType: true,
      targetSocialAccountId: true,
    },
  },
} as const;

function parseContentGroupId(
  request: FastifyRequest<QueueGroupRoute>,
  reply: FastifyReply
): string | null {
  const { contentGroupId } = request.params;
  if (!contentGroupId || typeof contentGroupId !== 'string') {
    void reply.code(400).send({ success: false, error: 'invalid_content_group_id' });
    return null;
  }
  return contentGroupId;
}

async function loadGroupForQueue(contentGroupId: string) {
  return prisma.contentGroup.findUnique({
    where: { id: contentGroupId },
    include: GROUP_FOR_QUEUE_INCLUDE,
  });
}

function toQueueDestinations(group: QueueGroup): QueueDestination[] | null {
  const destinations = group.contents
    .map((entry) => ({
      contentId: entry.id,
      contentType: entry.contentType,
      targetSocialAccountId: entry.targetSocialAccountId,
    }))
    .filter(
      (entry): entry is { contentId: string; contentType: string; targetSocialAccountId: string } =>
        Boolean(entry.targetSocialAccountId?.trim())
    )
    .map((entry) => ({
      ...entry,
      targetSocialAccountId: entry.targetSocialAccountId.trim(),
    }));

  if (destinations.length !== group.contents.length) {
    return null;
  }
  return destinations;
}

async function validateQueueReadiness(group: QueueGroup, destinations: QueueDestination[]) {
  for (const destination of destinations) {
    const readiness = await validateQueueableContent({
      contentId: destination.contentId,
      brandId: group.brandId,
      socialAccountId: destination.targetSocialAccountId,
    });
    if (!readiness.ok) {
      return {
        ok: false as const,
        payload: {
          success: false,
          error: readiness.code,
          message: readiness.message,
          details: {
            contentId: destination.contentId,
            socialAccountId: destination.targetSocialAccountId,
            readinessDetails: readiness.details,
          },
        },
      };
    }
  }

  return { ok: true as const };
}

function normalizeLaneKey(raw: unknown): 'post' | 'reel' | 'story' {
  if (raw === 'reel' || raw === 'story') {
    return raw;
  }
  return 'post';
}

async function resolveDefaultQueueId(tx: any, socialAccountId: string): Promise<string> {
  const existingDefault = await tx.publishingQueue.findFirst({
    where: { socialAccountId, isDefault: true },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (existingDefault) {
    return existingDefault.id;
  }

  const byName = await tx.publishingQueue.findFirst({
    where: { socialAccountId, name: 'Default' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (byName) {
    await tx.publishingQueue.update({
      where: { id: byName.id },
      data: { isDefault: true },
    });
    return byName.id;
  }

  const created = await tx.publishingQueue.create({
    data: {
      socialAccountId,
      name: 'Default',
      isDefault: true,
    },
    select: { id: true },
  });
  return created.id;
}

async function resolveCurrentDepthByAccount(params: {
  tx: any;
  socialAccountIds: string[];
  maxDepth: number;
}) {
  const currentDepthByAccount = new Map<string, number>();
  if (!Number.isFinite(params.maxDepth)) {
    return currentDepthByAccount;
  }

  for (const socialAccountId of params.socialAccountIds) {
    const count = await params.tx.publishingQueueItem.count({
      where: { queue: { socialAccountId } },
    });
    currentDepthByAccount.set(socialAccountId, count);
  }
  return currentDepthByAccount;
}

async function resolveQueueIdsByAccount(params: { tx: any; socialAccountIds: string[] }) {
  const queueIdByAccount = new Map<string, string>();
  for (const socialAccountId of params.socialAccountIds) {
    queueIdByAccount.set(socialAccountId, await resolveDefaultQueueId(params.tx, socialAccountId));
  }
  return queueIdByAccount;
}

async function resolvePosition(params: {
  tx: any;
  queueId: string;
  laneKey: string;
  nextPositionByQueueLane: Map<string, number>;
}) {
  const mapKey = `${params.queueId}:${params.laneKey}`;
  const existing = params.nextPositionByQueueLane.get(mapKey);
  if (typeof existing === 'number') {
    params.nextPositionByQueueLane.set(mapKey, existing + 1);
    return existing;
  }

  const maxRow = await params.tx.publishingQueueItem.findFirst({
    where: { queueId: params.queueId, laneKey: params.laneKey },
    select: { position: true },
    orderBy: { position: 'desc' },
  });
  const start = (maxRow?.position ?? 0) + 1;
  params.nextPositionByQueueLane.set(mapKey, start + 1);
  return start;
}

function assertQueueDepthCapacity(params: {
  maxDepth: number;
  socialAccountId: string;
  currentDepthByAccount: Map<string, number>;
}) {
  if (!Number.isFinite(params.maxDepth)) {
    return;
  }

  const current = params.currentDepthByAccount.get(params.socialAccountId) ?? 0;
  if (current + 1 > params.maxDepth) {
    throw new Error('queue_depth_limit');
  }
  params.currentDepthByAccount.set(params.socialAccountId, current + 1);
}

async function enqueueDestinations(params: { destinations: QueueDestination[]; maxDepth: number }) {
  const enqueued: EnqueuedItem[] = [];

  await prisma.$transaction(async (tx) => {
    const socialAccountIds = Array.from(
      new Set(params.destinations.map((entry) => entry.targetSocialAccountId))
    );
    const currentDepthByAccount = await resolveCurrentDepthByAccount({
      tx,
      socialAccountIds,
      maxDepth: params.maxDepth,
    });
    const queueIdByAccount = await resolveQueueIdsByAccount({ tx, socialAccountIds });
    const nextPositionByQueueLane = new Map<string, number>();

    for (const destination of params.destinations) {
      const socialAccountId = destination.targetSocialAccountId;
      const queueId = queueIdByAccount.get(socialAccountId)!;
      const laneKey = normalizeLaneKey(destination.contentType);

      const existingItem = await tx.publishingQueueItem.findUnique({
        where: { contentId: destination.contentId },
        select: { id: true },
      });
      if (!existingItem) {
        assertQueueDepthCapacity({
          maxDepth: params.maxDepth,
          socialAccountId,
          currentDepthByAccount,
        });
      }

      const position = await resolvePosition({
        tx,
        queueId,
        laneKey,
        nextPositionByQueueLane,
      });
      const item = await tx.publishingQueueItem.upsert({
        where: { contentId: destination.contentId },
        create: {
          queueId,
          contentId: destination.contentId,
          laneKey,
          position,
        },
        update: {
          queueId,
          laneKey,
          position,
        },
        select: { id: true, queueId: true, contentId: true },
      });

      enqueued.push({
        contentId: item.contentId,
        socialAccountId,
        queueId: item.queueId,
        itemId: item.id,
      });
    }
  });

  return enqueued;
}

async function handleGroupQueue(request: FastifyRequest<QueueGroupRoute>, reply: FastifyReply) {
  if (!ensureMultiDestinationEnabled(request as AuthenticatedRequest, reply)) {
    return;
  }

  const contentGroupId = parseContentGroupId(request, reply);
  if (!contentGroupId) {
    return;
  }

  const group = await loadGroupForQueue(contentGroupId);
  if (!group?.brand) {
    return reply.code(404).send({ success: false, error: 'content_group_not_found' });
  }
  if (group.brand.userId !== request.user!.id) {
    return reply.code(404).send({ success: false, error: 'content_group_not_found' });
  }

  await assertBrandOwnership(request.user!.id, group.brandId);
  if (group.contents.some((entry) => entry.status === 'published')) {
    return reply.code(400).send({
      success: false,
      error: 'content_group_immutable',
      message: 'This content group contains published posts and cannot be enqueued',
    });
  }

  const destinations = toQueueDestinations(group);
  if (!destinations) {
    return reply.code(400).send({
      success: false,
      error: 'invalid_target_social_account',
      message: 'One or more destination social accounts are missing from this group',
    });
  }

  const readiness = await validateQueueReadiness(group, destinations);
  if (!readiness.ok) {
    return reply.code(400).send(readiness.payload);
  }

  const tier = group.brand.user?.subscriptionTier || 'free';
  const maxDepth = getMaxQueueDepthForTier(tier);

  let enqueued: EnqueuedItem[];
  try {
    enqueued = await enqueueDestinations({
      destinations,
      maxDepth,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'queue_depth_limit') {
      return reply.code(402).send({
        success: false,
        error: 'queue_depth_limit',
        maxAllowed: maxDepth,
      });
    }

    request.log.error({ err: error }, 'Failed to enqueue content group');
    return reply.code(500).send({ success: false, error: 'failed_to_enqueue_group' });
  }

  const recompute = await publishingQueueScheduler.recomputeBrandWindow(group.brandId);
  return reply.send({
    success: true,
    data: {
      contentGroupId,
      enqueued,
      recompute,
    },
  });
}

export function registerGroupQueueRoute(fastify: FastifyInstance) {
  fastify.post<QueueGroupRoute>(
    '/groups/:contentGroupId/queue',
    { preHandler: fastify.authenticate },
    handleGroupQueue
  );
}
