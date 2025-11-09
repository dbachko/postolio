import { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../config/database.js';
import { instagramService } from '../services/instagram.js';
import {
  PostDetailParamsSchema,
  PaginationSchema,
  validateRequest,
} from '../schemas/api-validation.js';
import { successResponse, ErrorResponses, paginatedResponse } from '../utils/api-response.js';

const prisma = getDatabaseClient();

interface PostDetailParams {
  postId: string;
}

const postDetailRoutes: FastifyPluginAsync = async (app) => {
  // Add authentication middleware to all routes
  app.addHook('preHandler', app.authenticate);

  // Get comprehensive post detail (RESTful)
  app.get<{ Params: PostDetailParams }>('/api/posts/:postId', async (request, reply) => {
    // Validate params
    const paramsValidation = validateRequest(PostDetailParamsSchema, request.params);
    if (!paramsValidation.success) {
      return reply
        .code(400)
        .send(ErrorResponses.badRequest('Invalid request parameters', paramsValidation.errors));
    }

    const { postId } = paramsValidation.data;
    const userId = request.user!.id; // User is guaranteed by middleware

    try {
      // Fetch post with all relations
      const post = await prisma.content.findUnique({
        where: { id: postId },
        select: {
          id: true,
          caption: true,
          hashtags: true,
          primaryAssetCdnUrl: true,
          status: true,
          scheduledAt: true,
          postedAt: true,
          generationParams: true,
          createdAt: true,
          updatedAt: true,
          brandId: true,
          campaignId: true,
          schedulingError: true,
          brand: {
            select: {
              id: true,
              name: true,
            },
          },
          campaign: {
            select: {
              id: true,
              name: true,
              status: true,
            },
          },
          publications: { select: { platform: true, permalink: true, id: true } },
        },
      });

      if (!post) {
        return reply.code(404).send(ErrorResponses.notFound('Post'));
      }

      // Check user has access to this post
      const hasAccess = await prisma.brand.findFirst({
        where: {
          id: post.brandId,
          userId: userId,
        },
      });

      if (!hasAccess) {
        return reply.code(403).send(ErrorResponses.forbidden('Access denied to this post'));
      }

      // Build CDN URL and map to public response format
      const postWithUrl = {
        id: post.id,
        caption: post.caption,
        hashtags: post.hashtags,
        imageUrl: post.primaryAssetCdnUrl,
        status: post.status,
        brandId: post.brandId,
        scheduledAt: post.scheduledAt,
        postedAt: post.postedAt,
        // Deprecated fields removed; fallback permalink for UI convenience
        instagramPostId: undefined,
        instagramPermalink:
          (post.publications || []).find((p) => p.platform === 'instagram')?.permalink ||
          (post.publications || [])[0]?.permalink ||
          undefined,
        analytics: undefined,
        generationParams: post.generationParams,
        schedulingError: post.schedulingError,
        brand: post.brand,
        campaign: post.campaign,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
      };

      return reply.send(successResponse(postWithUrl));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      app.log.error({ message }, 'Error fetching post detail:');
      return reply.code(500).send(ErrorResponses.internalError('Failed to fetch post detail'));
    }
  });

  // Get insights (v2-backed) for a post
  app.get<{ Params: PostDetailParams }>('/api/posts/:postId/insights', async (request, reply) => {
    // Validate params
    const paramsValidation = validateRequest(PostDetailParamsSchema, request.params);
    if (!paramsValidation.success) {
      return reply
        .code(400)
        .send(ErrorResponses.badRequest('Invalid request parameters', paramsValidation.errors));
    }

    const { postId } = paramsValidation.data;
    const userId = request.user!.id; // User is guaranteed by middleware

    try {
      // Fetch post to check access
      const post = await prisma.content.findUnique({
        where: { id: postId },
        include: {
          brand: true,
        },
      });

      if (!post) {
        return reply.code(404).send(ErrorResponses.notFound('Post'));
      }

      // Check user has access
      if (post.brand.userId !== userId) {
        return reply.code(403).send(ErrorResponses.forbidden('Access denied to this post'));
      }

      // Initialize default metrics
      let metrics = {
        impressions: 0,
        reach: 0,
        engagement: 0,
        saves: 0,
        shares: 0,
        comments_count: 0,
        likes_count: 0,
      };

      // If post is published, return persisted v2 latest if available
      if (post.status === 'published') {
        try {
          const pub = await prisma.contentPublication.findFirst({
            where: { contentId: postId },
            orderBy: { publishedAt: 'desc' },
            select: { id: true, platform: true },
          });
          if (pub) {
            const latest = await prisma.publicationMetricsLatest.findUnique({
              where: { publicationId: pub.id },
            });
            if (latest) {
              metrics = {
                impressions: latest.impressions || 0,
                reach: latest.reach || 0,
                engagement: latest.engagement || 0,
                saves: latest.saves || 0,
                shares: latest.shares || 0,
                comments_count: latest.comments || 0,
                likes_count: latest.likes || 0,
              };
            }
          }
        } catch (e) {
          request.log.warn({ err: e }, 'Failed to load v2 metrics');
        }
      }

      return reply.send(
        successResponse({
          postId,
          metrics,
          lastUpdated: new Date().toISOString(),
        })
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      app.log.error({ message }, 'Error fetching post insights:');
      return reply.code(500).send(ErrorResponses.internalError('Failed to fetch post insights'));
    }
  });

  // Get comments for a post (Instagram via v2 publications)
  app.get<{ Params: PostDetailParams }>('/api/posts/:postId/comments', async (request, reply) => {
    // Validate params
    const paramsValidation = validateRequest(PostDetailParamsSchema, request.params);
    if (!paramsValidation.success) {
      return reply
        .code(400)
        .send(ErrorResponses.badRequest('Invalid request parameters', paramsValidation.errors));
    }

    // Validate pagination
    const paginationResult = PaginationSchema.safeParse(request.query);
    if (!paginationResult.success) {
      const errors = paginationResult.error.issues.map((issue) => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      });
      return reply
        .code(400)
        .send(ErrorResponses.badRequest('Invalid pagination parameters', errors));
    }

    const { postId } = paramsValidation.data;
    const { page, limit } = paginationResult.data;
    const userId = request.user!.id; // User is guaranteed by middleware

    try {
      // Fetch post to check access
      const post = await prisma.content.findUnique({
        where: { id: postId },
        include: {
          brand: true,
        },
      });

      if (!post) {
        return reply.code(404).send(ErrorResponses.notFound('Post'));
      }

      // Check user has access
      if (post.brand.userId !== userId) {
        return reply.code(403).send(ErrorResponses.forbidden('Access denied to this post'));
      }

      // Initialize default values
      interface InstagramComment {
        id?: string;
        text?: string;
        username?: string;
        timestamp?: string;
      }
      let comments: InstagramComment[] = [];
      let total = 0;

      // If post is published and has an Instagram publication, fetch real comments
      if (post.status === 'published' && post.brand) {
        try {
          const pub = await prisma.contentPublication.findFirst({
            where: { contentId: postId, platform: 'instagram' },
            select: { id: true, platform: true, socialAccountId: true, externalPostId: true },
          });
          if (pub && typeof pub.externalPostId === 'string') {
            const res = await instagramService.getPostComments(
              post.brand,
              pub.externalPostId,
              Number(limit)
            );
            comments = res.data;
            total = res.total;
          }
        } catch (error) {
          console.error('Failed to fetch Instagram comments:', error);
          // Return empty comments on error
        }
      }

      return reply.send(paginatedResponse(comments, Number(page), Number(limit), total));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      app.log.error({ message }, 'Error fetching post comments:');
      return reply.code(500).send(ErrorResponses.internalError('Failed to fetch post comments'));
    }
  });
};

export default postDetailRoutes;
