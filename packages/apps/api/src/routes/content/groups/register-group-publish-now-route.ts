import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { assertBrandOwnership } from '../../../services/ownership.js';
import {
  buildForwardAuthHeaders,
  ensureMultiDestinationEnabled,
  prisma,
  type AuthenticatedRequest,
} from './shared.js';

type GroupPublishNowRoute = {
  Params: { contentGroupId: string };
};

type PublishResult = {
  contentId: string;
  ok: boolean;
  statusCode: number;
  error?: unknown;
};

const GROUP_FOR_PUBLISH_NOW_INCLUDE = {
  brand: { select: { id: true, userId: true } },
  contents: {
    select: {
      id: true,
      status: true,
    },
  },
} as const;

function parseContentGroupId(
  request: FastifyRequest<GroupPublishNowRoute>,
  reply: FastifyReply
): string | null {
  const { contentGroupId } = request.params;
  if (!contentGroupId || typeof contentGroupId !== 'string') {
    void reply.code(400).send({ error: 'invalid_content_group_id' });
    return null;
  }
  return contentGroupId;
}

async function loadGroupForPublishNow(contentGroupId: string) {
  return prisma.contentGroup.findUnique({
    where: { id: contentGroupId },
    include: GROUP_FOR_PUBLISH_NOW_INCLUDE,
  });
}

async function publishContentIds(params: {
  fastify: FastifyInstance;
  contentIds: string[];
  headers: Record<string, string>;
}) {
  const results: PublishResult[] = [];
  for (const contentId of params.contentIds) {
    const response = await params.fastify.inject({
      method: 'POST',
      url: `/api/content/${encodeURIComponent(contentId)}/publish-now`,
      headers: params.headers,
    });

    if (response.statusCode >= 200 && response.statusCode < 300) {
      results.push({ contentId, ok: true, statusCode: response.statusCode });
      continue;
    }

    let errorPayload: unknown = null;
    try {
      errorPayload = response.json();
    } catch {
      errorPayload = response.payload || null;
    }
    results.push({
      contentId,
      ok: false,
      statusCode: response.statusCode,
      error: errorPayload,
    });
  }
  return results;
}

async function handleGroupPublishNow(
  fastify: FastifyInstance,
  request: FastifyRequest<GroupPublishNowRoute>,
  reply: FastifyReply
) {
  if (!ensureMultiDestinationEnabled(request as AuthenticatedRequest, reply)) {
    return;
  }

  const contentGroupId = parseContentGroupId(request, reply);
  if (!contentGroupId) {
    return;
  }

  const group = await loadGroupForPublishNow(contentGroupId);
  if (!group || group.brand.userId !== request.user!.id) {
    return reply.code(404).send({ error: 'content_group_not_found' });
  }

  await assertBrandOwnership(request.user!.id, group.brandId);
  const publishable = group.contents.filter((entry) => entry.status !== 'published');
  if (publishable.length === 0) {
    return reply.code(400).send({
      error: 'content_group_already_published',
      message: 'All destinations in this group are already published',
    });
  }

  const results = await publishContentIds({
    fastify,
    contentIds: publishable.map((entry) => entry.id),
    headers: buildForwardAuthHeaders(request.headers),
  });

  const failed = results.filter((entry) => !entry.ok);
  if (failed.length > 0) {
    return reply.code(502).send({
      success: false,
      error: 'Failed to publish one or more destination posts',
      results,
    });
  }

  return reply.send({ success: true, results });
}

export function registerGroupPublishNowRoute(fastify: FastifyInstance) {
  fastify.post<GroupPublishNowRoute>(
    '/groups/:contentGroupId/publish-now',
    { preHandler: fastify.authenticate },
    async (request, reply) => handleGroupPublishNow(fastify, request, reply)
  );
}
