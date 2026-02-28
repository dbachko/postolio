import type { FastifyInstance } from 'fastify';

import { ErrorResponses, successResponse } from '../../utils/api-response.js';

import { loadAuthorizedPost, prisma, validatePostParams, type PostDetailParams } from './shared.js';

type PostMetrics = {
  impressions: number;
  reach: number;
  engagement: number;
  saves: number;
  shares: number;
  comments_count: number;
  likes_count: number;
};

function getDefaultMetrics(): PostMetrics {
  return {
    impressions: 0,
    reach: 0,
    engagement: 0,
    saves: 0,
    shares: 0,
    comments_count: 0,
    likes_count: 0,
  };
}

async function loadPublishedMetrics(postId: string, request: any) {
  const pub = await prisma.contentPublication.findFirst({
    where: { contentId: postId },
    orderBy: { publishedAt: 'desc' },
    select: { id: true },
  });
  if (!pub) {
    return getDefaultMetrics();
  }

  try {
    const latest = await prisma.publicationMetricsLatest.findUnique({
      where: { publicationId: pub.id },
    });
    if (!latest) {
      return getDefaultMetrics();
    }

    return {
      impressions: latest.impressions || 0,
      reach: latest.reach || 0,
      engagement: latest.engagement || 0,
      saves: latest.saves || 0,
      shares: latest.shares || 0,
      comments_count: latest.comments || 0,
      likes_count: latest.likes || 0,
    };
  } catch (error: unknown) {
    request.log.warn({ err: error }, 'Failed to load v2 metrics');
    return getDefaultMetrics();
  }
}

function createPostInsightsHandler(app: FastifyInstance) {
  return async (request: any, reply: any) => {
    const paramsValidation = validatePostParams(request.params);
    if (!paramsValidation.success) {
      return reply
        .code(400)
        .send(ErrorResponses.badRequest('Invalid request parameters', paramsValidation.errors));
    }

    const { postId } = paramsValidation.data as PostDetailParams;
    const userId = request.user!.id;

    try {
      const post = await loadAuthorizedPost({ postId, userId, reply });
      if (!post) {
        return;
      }

      const metrics =
        post.status === 'published'
          ? await loadPublishedMetrics(postId, request)
          : getDefaultMetrics();
      return reply.send(
        successResponse({ postId, metrics, lastUpdated: new Date().toISOString() })
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      app.log.error({ message }, 'Error fetching post insights');
      return reply.code(500).send(ErrorResponses.internalError('Failed to fetch post insights'));
    }
  };
}

export function registerPostInsightsRoute(app: FastifyInstance) {
  app.get<{ Params: PostDetailParams }>(
    '/api/posts/:postId/insights',
    createPostInsightsHandler(app)
  );
}
