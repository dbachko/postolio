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

            // Merge persisted workflow (resolved/snoozed)
            try {
              const ids = comments.map((c) => String(c.id || ''));
              const rows = await prisma.publicationComment.findMany({
                where: { publicationId: pub.id, externalCommentId: { in: ids } },
                select: { externalCommentId: true, status: true },
              });
              const byId = new Map(rows.map((r) => [r.externalCommentId, r]));
              comments = comments.map((c) => ({
                ...c,
                workflow: byId.get(String(c.id || '')) || null,
              })) as any;
            } catch (e) {
              request.log.warn({ err: e }, 'Failed to merge comment workflows');
            }

            // Fallback: if Graph API returned no comments, surface locally-seeded comments
            if ((!comments || comments.length === 0) && pub?.id) {
              const localRows = await prisma.publicationComment.findMany({
                where: { publicationId: pub.id },
                orderBy: { createdAt: 'asc' },
                select: {
                  externalCommentId: true,
                  text: true,
                  authorUsername: true,
                  createdAt: true,
                  status: true,
                },
              });
              comments = localRows.map((r) => ({
                id: r.externalCommentId,
                text: r.text || undefined,
                username: r.authorUsername || undefined,
                timestamp: r.createdAt?.toISOString(),
                workflow: { status: r.status },
              })) as any;
              total = comments.length;
            }
          }
        } catch (error) {
          request.log.warn(
            { err: error },
            'Failed to fetch Instagram comments via Graph; falling back to local'
          );
          // Fallback: if Graph call failed, try locally persisted comments (from seeds/ingestion)
          try {
            const pub = await prisma.contentPublication.findFirst({
              where: { contentId: postId, platform: 'instagram' },
              select: { id: true },
            });
            if (pub?.id) {
              const localRows = await prisma.publicationComment.findMany({
                where: { publicationId: pub.id },
                orderBy: { createdAt: 'asc' },
                select: {
                  externalCommentId: true,
                  text: true,
                  authorUsername: true,
                  createdAt: true,
                  status: true,
                },
              });
              comments = localRows.map((r) => ({
                id: r.externalCommentId,
                text: r.text || undefined,
                username: r.authorUsername || undefined,
                timestamp: r.createdAt?.toISOString(),
                workflow: { status: r.status },
              })) as any;
              total = comments.length;
            }
          } catch (fallbackErr) {
            request.log.warn({ err: fallbackErr }, 'Local comments fallback failed');
          }
        }
      }

      return reply.send(paginatedResponse(comments, Number(page), Number(limit), total));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      app.log.error({ message }, 'Error fetching post comments:');
      return reply.code(500).send(ErrorResponses.internalError('Failed to fetch post comments'));
    }
  });

  // Reply to a specific comment
  app.post<{ Params: PostDetailParams & { commentId: string }; Body: { message: string } }>(
    '/api/posts/:postId/comments/:commentId/reply',
    async (request, reply) => {
      const paramsValidation = validateRequest(PostDetailParamsSchema, request.params);
      if (!paramsValidation.success) {
        return reply
          .code(400)
          .send(ErrorResponses.badRequest('Invalid request parameters', paramsValidation.errors));
      }
      const { postId } = paramsValidation.data;
      const { commentId } = request.params as { postId: string; commentId: string };
      const { message } = (request.body || {}) as { message?: string };
      if (!message || !message.trim()) {
        return reply.code(400).send(ErrorResponses.badRequest('Message must not be empty'));
      }

      try {
        const userId = request.user!.id;
        const post = await prisma.content.findUnique({
          where: { id: postId },
          include: { brand: true },
        });
        if (!post) return reply.code(404).send(ErrorResponses.notFound('Post'));
        if (post.brand.userId !== userId)
          return reply.code(403).send(ErrorResponses.forbidden('Access denied to this post'));
        if (post.status !== 'published')
          return reply.code(400).send(ErrorResponses.badRequest('Post is not published'));

        const pub = await prisma.contentPublication.findFirst({
          where: { contentId: postId, platform: 'instagram' },
          select: { externalPostId: true },
        });
        if (!pub?.externalPostId) {
          return reply.code(400).send(ErrorResponses.badRequest('Instagram publication not found'));
        }
        const res = await instagramService.replyToComment(
          post.brand,
          String(pub.externalPostId),
          commentId,
          message
        );
        return reply.send(successResponse(res));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return reply.code(500).send(ErrorResponses.internalError(`Failed to reply: ${message}`));
      }
    }
  );

  // Update comment workflow (open/resolved/archived)
  app.post<{
    Params: PostDetailParams & { commentId: string };
    Body: { status?: 'open' | 'resolved' | 'archived' };
  }>('/api/posts/:postId/comments/:commentId/workflow', async (request, reply) => {
    const paramsValidation = validateRequest(PostDetailParamsSchema, request.params);
    if (!paramsValidation.success) {
      return reply
        .code(400)
        .send(ErrorResponses.badRequest('Invalid request parameters', paramsValidation.errors));
    }
    const { postId } = paramsValidation.data;
    const { commentId } = request.params as { postId: string; commentId: string };
    const userId = request.user!.id;
    const { status } = (request.body || {}) as any;

    try {
      const post = await prisma.content.findUnique({
        where: { id: postId },
        include: { brand: true },
      });
      if (!post) return reply.code(404).send(ErrorResponses.notFound('Post'));
      if (post.brand.userId !== userId)
        return reply.code(403).send(ErrorResponses.forbidden('Access denied to this post'));
      const pub = await prisma.contentPublication.findFirst({
        where: { contentId: postId, platform: 'instagram' },
        select: { id: true },
      });
      if (!pub)
        return reply.code(400).send(ErrorResponses.badRequest('Instagram publication not found'));

      const data: any = {};
      if (status) data.status = status;

      const row = await prisma.publicationComment.upsert({
        where: {
          publicationId_externalCommentId: { publicationId: pub.id, externalCommentId: commentId },
        } as any,
        update: data,
        create: {
          publicationId: pub.id,
          platform: 'instagram',
          externalCommentId: commentId,
          text: null,
          status: (status as any) || 'open',
        },
      });
      return reply.send(
        successResponse({
          externalCommentId: row.externalCommentId,
          status: row.status,
        })
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply
        .code(500)
        .send(ErrorResponses.internalError(`Failed to update workflow: ${message}`));
    }
  });

  // Note: hide/delete endpoints removed. Archiving is handled via workflow status 'archived'.

  // Like a comment (best-effort; may not be supported by IG Graph for all accounts)
  app.post<{ Params: PostDetailParams & { commentId: string } }>(
    '/api/posts/:postId/comments/:commentId/like',
    async (request, reply) => {
      const paramsValidation = validateRequest(PostDetailParamsSchema, request.params);
      if (!paramsValidation.success) {
        return reply
          .code(400)
          .send(ErrorResponses.badRequest('Invalid request parameters', paramsValidation.errors));
      }
      const { postId } = paramsValidation.data;
      const { commentId } = request.params as { postId: string; commentId: string };
      try {
        const userId = request.user!.id;
        const post = await prisma.content.findUnique({
          where: { id: postId },
          include: { brand: true },
        });
        if (!post) return reply.code(404).send(ErrorResponses.notFound('Post'));
        if (post.brand.userId !== userId)
          return reply.code(403).send(ErrorResponses.forbidden('Access denied to this post'));
        const res = await instagramService.likeComment(post.brand, commentId);
        return reply.send(successResponse(res));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        // Surface a 400 when API indicates unsupported to avoid implying a server fault
        const status = /not support|unsupported|not allowed/i.test(message) ? 400 : 500;
        return reply.code(status).send(ErrorResponses.badRequest(message));
      }
    }
  );

  // Bulk mark comments as read (resolve workflow) for a post
  app.post<{ Params: PostDetailParams; Body: { commentIds?: string[] } }>(
    '/api/posts/:postId/comments/mark-all-read',
    async (request, reply) => {
      const paramsValidation = validateRequest(PostDetailParamsSchema, request.params);
      if (!paramsValidation.success) {
        return reply
          .code(400)
          .send(ErrorResponses.badRequest('Invalid request parameters', paramsValidation.errors));
      }
      const { postId } = paramsValidation.data;
      const userId = request.user!.id;
      const { commentIds } = (request.body || {}) as { commentIds?: unknown } as {
        commentIds?: string[];
      };
      try {
        const post = await prisma.content.findUnique({
          where: { id: postId },
          include: { brand: true },
        });
        if (!post) return reply.code(404).send(ErrorResponses.notFound('Post'));
        if (post.brand.userId !== userId)
          return reply.code(403).send(ErrorResponses.forbidden('Access denied to this post'));
        if (post.status !== 'published')
          return reply.code(400).send(ErrorResponses.badRequest('Post is not published'));

        const pub = await prisma.contentPublication.findFirst({
          where: { contentId: postId, platform: 'instagram' },
          select: { id: true },
        });
        if (!pub)
          return reply.code(400).send(ErrorResponses.badRequest('Instagram publication not found'));

        let marked = 0;
        // If a set of comment IDs is provided, upsert them to resolved in a batch-y loop
        if (Array.isArray(commentIds) && commentIds.length > 0) {
          for (const cid of commentIds) {
            const id = String(cid || '');
            if (!id) continue;
            const row = await prisma.publicationComment.upsert({
              where: {
                publicationId_externalCommentId: {
                  publicationId: pub.id,
                  externalCommentId: id,
                },
              } as any,
              update: { status: 'resolved' },
              create: {
                publicationId: pub.id,
                platform: 'instagram',
                externalCommentId: id,
                status: 'resolved',
              },
            });
            if (row) marked++;
          }
        } else {
          // Fallback: mark any existing persisted comments as resolved
          const res = await prisma.publicationComment.updateMany({
            where: { publicationId: pub.id, status: { not: 'resolved' } },
            data: { status: 'resolved' },
          });
          marked = res.count;
        }

        return reply.send(successResponse({ success: true, marked }));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return reply
          .code(500)
          .send(ErrorResponses.internalError(`Failed to mark all read: ${message}`));
      }
    }
  );
};

export default postDetailRoutes;
