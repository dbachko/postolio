import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { assertBrandOwnership } from '../../../services/ownership.js';
import { schedulerService } from '../../../services/scheduler.js';
import { ensureMultiDestinationEnabled, prisma, type AuthenticatedRequest } from './shared.js';

type DeleteGroupRoute = {
  Params: { contentGroupId: string };
};

type GroupForDelete = NonNullable<Awaited<ReturnType<typeof loadGroupForDelete>>>;

const GROUP_FOR_DELETE_INCLUDE = {
  brand: { select: { id: true, userId: true } },
  contents: {
    select: {
      id: true,
      status: true,
    },
  },
} as const;

function parseContentGroupId(
  request: FastifyRequest<DeleteGroupRoute>,
  reply: FastifyReply
): string | null {
  const { contentGroupId } = request.params;
  if (!contentGroupId || typeof contentGroupId !== 'string') {
    void reply.code(400).send({ error: 'invalid_content_group_id' });
    return null;
  }
  return contentGroupId;
}

async function loadGroupForDelete(contentGroupId: string) {
  return prisma.contentGroup.findUnique({
    where: { id: contentGroupId },
    include: GROUP_FOR_DELETE_INCLUDE,
  });
}

async function cancelScheduledDestinations(params: {
  request: FastifyRequest<DeleteGroupRoute>;
  group: GroupForDelete;
}) {
  for (const content of params.group.contents) {
    if (content.status !== 'scheduled') {
      continue;
    }

    try {
      await schedulerService.cancelScheduledPost(content.id);
    } catch (error) {
      params.request.log.warn(
        { err: error, contentId: content.id },
        'Failed to cancel schedule during group delete'
      );
    }
  }
}

async function handleDeleteGroup(request: FastifyRequest<DeleteGroupRoute>, reply: FastifyReply) {
  if (!ensureMultiDestinationEnabled(request as AuthenticatedRequest, reply)) {
    return;
  }

  const contentGroupId = parseContentGroupId(request, reply);
  if (!contentGroupId) {
    return;
  }

  const group = await loadGroupForDelete(contentGroupId);
  if (!group || group.brand.userId !== request.user!.id) {
    return reply.code(404).send({ error: 'content_group_not_found' });
  }

  await assertBrandOwnership(request.user!.id, group.brandId);
  if (group.contents.some((entry) => entry.status === 'published')) {
    return reply.code(400).send({
      error: 'content_group_not_deletable',
      message: 'This content group contains published posts and cannot be deleted',
    });
  }

  const contentIds = group.contents.map((entry) => entry.id);
  await cancelScheduledDestinations({ request, group });

  await prisma.$transaction(async (tx) => {
    await tx.content.deleteMany({ where: { id: { in: contentIds } } });
    await tx.contentGroup.delete({ where: { id: contentGroupId } });
  });

  return reply.send({
    success: true,
    deleted: {
      contentGroupId,
      contentIds,
    },
  });
}

export function registerDeleteGroupRoute(fastify: FastifyInstance) {
  fastify.delete<DeleteGroupRoute>(
    '/groups/:contentGroupId',
    { preHandler: fastify.authenticate },
    handleDeleteGroup
  );
}
