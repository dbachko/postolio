import { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../config/database.js';
import { instagramService } from '../services/instagram.js';
import {
  PostDetailParamsSchema,
  PaginationSchema,
  validateRequest,
} from '../schemas/api-validation.js';
import { successResponse, ErrorResponses, paginatedResponse } from '../utils/api-response.js';
import { buildCdnUrl } from '../services/s3-image.js';

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
          s3ImageKey: true,
          status: true,
          scheduledAt: true,
          postedAt: true,
          instagramPostId: true,
          instagramPermalink: true,
          analytics: true,
          generationParams: true,
          createdAt: true,
          updatedAt: true,
          brandId: true,
          campaignId: true,
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
        imageUrl: buildCdnUrl(post.s3ImageKey),
        status: post.status,
        scheduledAt: post.scheduledAt,
        postedAt: post.postedAt,
        instagramPostId: post.instagramPostId,
        instagramPermalink: post.instagramPermalink,
        analytics: post.analytics,
        generationParams: post.generationParams,
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

  // Get Instagram insights for a post
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

      // If post is published and has Instagram ID, fetch real metrics
      if (post.status === 'published' && post.instagramPostId && post.brand) {
        try {
          const insightsResponse = (await instagramService.getMediaInsights(
            post.brand,
            post.instagramPostId
          )) as unknown;

          // Parse Instagram insights data
          if (
            insightsResponse &&
            typeof insightsResponse === 'object' &&
            'data' in (insightsResponse as Record<string, unknown>) &&
            Array.isArray((insightsResponse as Record<string, unknown>).data as unknown[])
          ) {
            interface InstagramInsightValue {
              value?: number;
              end_time?: string;
            }
            interface InstagramInsight {
              name?: string;
              values?: InstagramInsightValue[];
            }
            const dataArr = (insightsResponse as Record<string, unknown>).data as unknown[];
            const insights: InstagramInsight[] = dataArr
              .filter((d): d is InstagramInsight => !!d && typeof d === 'object' && 'name' in d)
              .map((d) => d as InstagramInsight);
            const getMetric = (name: string): number => {
              return insights.find((m) => m.name === name)?.values?.[0]?.value ?? 0;
            };
            metrics = {
              impressions: getMetric('impressions'),
              reach: getMetric('reach'),
              engagement: getMetric('engagement'),
              saves: getMetric('saves'),
              shares: getMetric('shares'),
              comments_count: getMetric('comments'),
              likes_count: getMetric('likes'),
            };
          }
        } catch (error) {
          console.error('Failed to fetch Instagram metrics:', error);
          // Return default metrics on error
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

  // Get comments for a post
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

      // If post is published and has Instagram ID, fetch real comments
      if (post.status === 'published' && post.instagramPostId && post.brand) {
        try {
          const commentsResponse = await instagramService.getPostComments(
            post.brand,
            post.instagramPostId,
            Number(limit)
          );
          comments = commentsResponse.data;
          total = commentsResponse.total;
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
