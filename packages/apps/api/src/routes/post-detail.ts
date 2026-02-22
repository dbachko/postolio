import type { FastifyPluginAsync } from 'fastify';
import { getDatabaseClient } from '../config/database.js';
import { instagramService } from '../services/instagram.js';
import { facebookService } from '../services/facebook.js';
import {
  PostDetailParamsSchema,
  PaginationSchema,
  validateRequest,
} from '../schemas/api-validation.js';
import { successResponse, ErrorResponses, paginatedResponse } from '../utils/api-response.js';
import crypto from 'crypto';
import { getRedisClient } from '../services/redis.js';
import { assertBrandOwnership } from '../services/ownership.js';

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
          contentType: true,
          shareToFeed: true,
          status: true,
          scheduledAt: true,
          postedAt: true,
          generationParams: true,
          createdAt: true,
          updatedAt: true,
          brandId: true,
          contentGroupId: true,
          contentSeriesId: true,
          recipeRunId: true,
          schedulingError: true,
          firstComment: true,
          firstCommentStatus: true,
          firstCommentPostedAt: true,
          firstCommentError: true,
          targetSocialAccountId: true,
          recipeRun: {
            select: {
              id: true,
              recipeTemplate: { select: { id: true, slug: true, name: true } },
            },
          },
          mediaAssets: {
            select: { assetId: true, displayOrder: true },
            orderBy: { displayOrder: 'asc' },
          },
          brand: {
            select: {
              id: true,
              name: true,
            },
          },
          publications: { select: { platform: true, permalink: true, id: true } },
        },
      });

      if (!post) {
        return reply.code(404).send(ErrorResponses.notFound('Post'));
      }

      // Check user has access to this post via brand ownership
      await assertBrandOwnership(userId, post.brandId);

      const postWithUrl = {
        id: post.id,
        caption: post.caption,
        hashtags: post.hashtags,
        contentType: post.contentType,
        shareToFeed: post.shareToFeed,
        status: post.status,
        brandId: post.brandId,
        contentGroupId: post.contentGroupId,
        contentSeriesId: (post as any).contentSeriesId ?? null,
        recipeRunId: (() => {
          const direct = (post as any).recipeRunId ?? null;
          if (typeof direct === 'string' && direct.trim()) {
            return direct.trim();
          }
          const gp = post.generationParams as any;
          const derived = typeof gp?.runId === 'string' ? gp.runId : null;
          return typeof derived === 'string' && derived.trim() ? derived.trim() : null;
        })(),
        generatedByRecipe: (post as any).recipeRun?.recipeTemplate ?? null,
        targetSocialAccountId: post.targetSocialAccountId,
        scheduledAt: post.scheduledAt,
        postedAt: post.postedAt,
        firstComment: post.firstComment,
        firstCommentStatus: post.firstCommentStatus,
        firstCommentPostedAt: post.firstCommentPostedAt,
        firstCommentError: post.firstCommentError,
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
        mediaAssets: post.mediaAssets ?? [],
        mediaAssetCount: post.mediaAssets?.length ?? 0,
        primaryAssetId: post.mediaAssets?.[0]?.assetId ?? null,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
      };

      return reply.send(successResponse(postWithUrl));
    } catch (error: unknown) {
      app.log.error({ err: error, postId }, 'Error fetching post detail');
      throw error;
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

  // Get comments for a post (via v2 publications)
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

      type PlatformComment = {
        id?: string;
        text?: string;
        username?: string;
        timestamp?: string;
        like_count?: number;
        workflow?: { status?: string } | null;
      };

      const pageNum = Number(page);
      const limitNum = Number(limit);
      const skip = Math.max(0, (pageNum - 1) * limitNum);
      const freshnessTtlMs = 60_000;
      const refreshRaw = String((request.query as any)?.refresh ?? '')
        .trim()
        .toLowerCase();
      const refresh = refreshRaw === 'true' || refreshRaw === '1';

      let comments: PlatformComment[] = [];
      let total = 0;

      // Only published posts are supported today
      if (post.status !== 'published') {
        return reply.send(paginatedResponse([], pageNum, limitNum, 0));
      }

      const supportedPlatforms = ['instagram', 'facebook'] as const;
      const publicationId =
        typeof (request.query as any)?.publicationId === 'string'
          ? String((request.query as any).publicationId)
          : null;

      const pub = publicationId
        ? await prisma.contentPublication.findFirst({
            where: {
              id: publicationId,
              contentId: postId,
              platform: { in: supportedPlatforms as any },
            },
            select: { id: true, platform: true, externalPostId: true, socialAccountId: true },
          })
        : await prisma.contentPublication.findFirst({
            where: {
              contentId: postId,
              platform: { in: supportedPlatforms as any },
              ...(post.targetSocialAccountId
                ? { socialAccountId: post.targetSocialAccountId }
                : {}),
            },
            orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
            select: { id: true, platform: true, externalPostId: true, socialAccountId: true },
          });

      if (!pub?.externalPostId) {
        if (publicationId) {
          return reply.code(404).send(ErrorResponses.notFound('Publication'));
        }
        return reply.send(paginatedResponse([], pageNum, limitNum, 0));
      }

      // DB-first read: if we've fetched this publication recently, return persisted comments
      const [latestFetch, localTotal, localRows] = await Promise.all([
        prisma.publicationComment.findFirst({
          where: { publicationId: pub.id },
          orderBy: { fetchedAt: 'desc' },
          select: { fetchedAt: true },
        }),
        prisma.publicationComment.count({ where: { publicationId: pub.id } }),
        prisma.publicationComment.findMany({
          where: { publicationId: pub.id },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limitNum,
          select: {
            externalCommentId: true,
            text: true,
            authorUsername: true,
            likeCount: true,
            createdAt: true,
            status: true,
          },
        }),
      ]);

      const isFresh =
        !!latestFetch?.fetchedAt && Date.now() - latestFetch.fetchedAt.getTime() < freshnessTtlMs;

      if (!refresh && isFresh && localRows.length > 0) {
        comments = localRows.map((r) => ({
          id: r.externalCommentId,
          text: r.text || undefined,
          username: r.authorUsername || undefined,
          timestamp: r.createdAt?.toISOString(),
          like_count: typeof r.likeCount === 'number' ? r.likeCount : undefined,
          workflow: { status: String(r.status) },
        }));
        total = localTotal;
        return reply.send(paginatedResponse(comments, pageNum, limitNum, total));
      }

      // Stale/missing: fetch from Graph using account-scoped credentials, then upsert to DB
      try {
        const externalPostId = String(pub.externalPostId);
        const res =
          pub.platform === 'instagram'
            ? await instagramService.getPostCommentsForSocialAccount(
                pub.socialAccountId,
                externalPostId,
                limitNum
              )
            : await facebookService.getPostCommentsForSocialAccount(
                pub.socialAccountId,
                externalPostId,
                limitNum
              );

        // Persist comment payload (best-effort, preserve workflow status)
        const now = new Date();
        for (const c of res.data) {
          const externalCommentId = String(c.id || '');
          if (!externalCommentId) {
            continue;
          }
          const createdAt = c.timestamp ? new Date(c.timestamp) : undefined;
          try {
            await prisma.publicationComment.upsert({
              where: {
                publicationId_externalCommentId: {
                  publicationId: pub.id,
                  externalCommentId,
                },
              } as any,
              update: {
                text: (c as any).text || null,
                authorUsername: (c as any).username || null,
                likeCount: typeof (c as any).like_count === 'number' ? (c as any).like_count : 0,
                fetchedAt: now,
              },
              create: {
                publicationId: pub.id,
                platform: pub.platform,
                externalCommentId,
                text: (c as any).text || null,
                authorUsername: (c as any).username || null,
                likeCount: typeof (c as any).like_count === 'number' ? (c as any).like_count : 0,
                status: 'open',
                createdAt,
                fetchedAt: now,
              },
            });
          } catch (e) {
            request.log.debug({ err: e }, 'Failed to upsert publicationComment');
          }
        }

        // Merge workflow statuses for fetched ids
        let byId = new Map<string, { status: string }>();
        try {
          const ids = res.data.map((c) => String(c.id || '')).filter(Boolean);
          if (ids.length) {
            const rows = await prisma.publicationComment.findMany({
              where: { publicationId: pub.id, externalCommentId: { in: ids } },
              select: { externalCommentId: true, status: true },
            });
            byId = new Map(rows.map((r) => [r.externalCommentId, { status: String(r.status) }]));
          }
        } catch (e) {
          request.log.warn({ err: e }, 'Failed to merge comment workflows');
        }

        comments = res.data.map((c) => ({
          id: c.id,
          text: c.text,
          username: c.username,
          timestamp: c.timestamp,
          like_count: (c as any).like_count,
          workflow: byId.get(String(c.id || '')) || null,
        }));
        total = res.total;
      } catch (error) {
        request.log.warn({ err: error }, 'Failed to fetch comments via Graph');
        // Last-resort: return whatever we have locally
        comments = localRows.map((r) => ({
          id: r.externalCommentId,
          text: r.text || undefined,
          username: r.authorUsername || undefined,
          timestamp: r.createdAt?.toISOString(),
          like_count: typeof r.likeCount === 'number' ? r.likeCount : undefined,
          workflow: { status: String(r.status) },
        }));
        total = localTotal;
      }

      return reply.send(paginatedResponse(comments, pageNum, limitNum, total));
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
      if (!message?.trim()) {
        return reply.code(400).send(ErrorResponses.badRequest('Message must not be empty'));
      }

      try {
        const userId = request.user!.id;
        const post = await prisma.content.findUnique({
          where: { id: postId },
          include: { brand: true },
        });
        if (!post) {
          return reply.code(404).send(ErrorResponses.notFound('Post'));
        }
        if (post.brand.userId !== userId) {
          return reply.code(403).send(ErrorResponses.forbidden('Access denied to this post'));
        }
        if (post.status !== 'published') {
          return reply.code(400).send(ErrorResponses.badRequest('Post is not published'));
        }

        const publicationId =
          typeof (request.query as any)?.publicationId === 'string'
            ? String((request.query as any).publicationId)
            : null;

        const supportedPlatforms = ['instagram', 'facebook'] as const;
        const pub = publicationId
          ? await prisma.contentPublication.findFirst({
              where: {
                id: publicationId,
                contentId: postId,
                platform: { in: supportedPlatforms as any },
              },
              select: { platform: true, externalPostId: true, socialAccountId: true },
            })
          : await prisma.contentPublication.findFirst({
              where: {
                contentId: postId,
                platform: { in: supportedPlatforms as any },
                ...(post.targetSocialAccountId
                  ? { socialAccountId: post.targetSocialAccountId }
                  : {}),
              },
              orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
              select: { platform: true, externalPostId: true, socialAccountId: true },
            });
        if (!pub?.externalPostId) {
          return reply.code(400).send(ErrorResponses.badRequest('Publication not found'));
        }
        // Idempotency: prevent duplicate replies within a short window
        const redis = getRedisClient();
        const msgHash = crypto.createHash('sha256').update(message.trim()).digest('hex');
        const idemKey = `idem:comment-reply:${String(pub.externalPostId)}:${commentId}:${msgHash}`;
        let locked = false;
        if (redis) {
          // Acquire a short-lived lock. If it already exists, treat as duplicate and return success.
          const ok = await redis.set(idemKey, '1', 'EX', 30, 'NX');
          if (!ok) {
            return reply.send(successResponse({ deduped: true }));
          }
          locked = true;
        }

        try {
          const res =
            pub.platform === 'instagram'
              ? await instagramService.replyToCommentForSocialAccount(
                  pub.socialAccountId,
                  String(pub.externalPostId),
                  commentId,
                  message
                )
              : await facebookService.replyToCommentForSocialAccount(
                  pub.socialAccountId,
                  commentId,
                  message
                );
          return reply.send(successResponse(res));
        } catch (innerErr) {
          // On failure, release the lock to allow immediate retry
          if (redis && locked) {
            try {
              await redis.del(idemKey);
            } catch {}
          }
          throw innerErr;
        }
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
      if (!post) {
        return reply.code(404).send(ErrorResponses.notFound('Post'));
      }
      if (post.brand.userId !== userId) {
        return reply.code(403).send(ErrorResponses.forbidden('Access denied to this post'));
      }
      const publicationId =
        typeof (request.query as any)?.publicationId === 'string'
          ? String((request.query as any).publicationId)
          : null;

      const supportedPlatforms = ['instagram', 'facebook'] as const;
      const pub = publicationId
        ? await prisma.contentPublication.findFirst({
            where: {
              id: publicationId,
              contentId: postId,
              platform: { in: supportedPlatforms as any },
            },
            select: { id: true, platform: true },
          })
        : await prisma.contentPublication.findFirst({
            where: {
              contentId: postId,
              platform: { in: supportedPlatforms as any },
              ...(post.targetSocialAccountId
                ? { socialAccountId: post.targetSocialAccountId }
                : {}),
            },
            orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
            select: { id: true, platform: true },
          });
      if (!pub) {
        return reply.code(400).send(ErrorResponses.badRequest('Publication not found'));
      }

      const data: any = {};
      if (status) {
        data.status = status;
      }

      const row = await prisma.publicationComment.upsert({
        where: {
          publicationId_externalCommentId: { publicationId: pub.id, externalCommentId: commentId },
        } as any,
        update: data,
        create: {
          publicationId: pub.id,
          platform: pub.platform,
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
        if (!post) {
          return reply.code(404).send(ErrorResponses.notFound('Post'));
        }
        if (post.brand.userId !== userId) {
          return reply.code(403).send(ErrorResponses.forbidden('Access denied to this post'));
        }
        const publicationId =
          typeof (request.query as any)?.publicationId === 'string'
            ? String((request.query as any).publicationId)
            : null;

        const supportedPlatforms = ['instagram', 'facebook'] as const;
        const pub = publicationId
          ? await prisma.contentPublication.findFirst({
              where: {
                id: publicationId,
                contentId: postId,
                platform: { in: supportedPlatforms as any },
              },
              select: { platform: true, socialAccountId: true },
            })
          : await prisma.contentPublication.findFirst({
              where: {
                contentId: postId,
                platform: { in: supportedPlatforms as any },
                ...(post.targetSocialAccountId
                  ? { socialAccountId: post.targetSocialAccountId }
                  : {}),
              },
              orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
              select: { platform: true, socialAccountId: true },
            });
        if (!pub) {
          return reply.code(400).send(ErrorResponses.badRequest('Publication not found'));
        }

        const res =
          pub.platform === 'instagram'
            ? await instagramService.likeCommentForSocialAccount(pub.socialAccountId, commentId)
            : await facebookService.likeCommentForSocialAccount(pub.socialAccountId, commentId);
        return reply.send(successResponse(res));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        // Surface a 400 when API indicates unsupported to avoid implying a server fault
        if (/not support|unsupported|not allowed/i.test(message)) {
          return reply.code(400).send(ErrorResponses.badRequest(message));
        }
        return reply
          .code(500)
          .send(ErrorResponses.internalError(`Failed to like comment: ${message}`));
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
        if (!post) {
          return reply.code(404).send(ErrorResponses.notFound('Post'));
        }
        if (post.brand.userId !== userId) {
          return reply.code(403).send(ErrorResponses.forbidden('Access denied to this post'));
        }
        if (post.status !== 'published') {
          return reply.code(400).send(ErrorResponses.badRequest('Post is not published'));
        }

        const publicationId =
          typeof (request.query as any)?.publicationId === 'string'
            ? String((request.query as any).publicationId)
            : null;

        const supportedPlatforms = ['instagram', 'facebook'] as const;
        const pub = publicationId
          ? await prisma.contentPublication.findFirst({
              where: {
                id: publicationId,
                contentId: postId,
                platform: { in: supportedPlatforms as any },
              },
              select: { id: true, platform: true },
            })
          : await prisma.contentPublication.findFirst({
              where: {
                contentId: postId,
                platform: { in: supportedPlatforms as any },
                ...(post.targetSocialAccountId
                  ? { socialAccountId: post.targetSocialAccountId }
                  : {}),
              },
              orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
              select: { id: true, platform: true },
            });
        if (!pub) {
          return reply.code(400).send(ErrorResponses.badRequest('Publication not found'));
        }

        let marked = 0;
        const ids = Array.isArray(commentIds)
          ? [...new Set(commentIds.map((cid) => String(cid || '')).filter(Boolean))]
          : [];

        if (ids.length > 0) {
          const existing = await prisma.publicationComment.findMany({
            where: { publicationId: pub.id, externalCommentId: { in: ids } },
            select: { externalCommentId: true, status: true },
          });

          const existingIds = new Set(existing.map((r) => r.externalCommentId));
          const idsToResolve = existing
            .filter((r) => r.status === 'open')
            .map((r) => r.externalCommentId);
          const idsToCreate = ids.filter((id) => !existingIds.has(id));

          if (idsToResolve.length) {
            const res = await prisma.publicationComment.updateMany({
              where: {
                publicationId: pub.id,
                externalCommentId: { in: idsToResolve },
                status: 'open',
              },
              data: { status: 'resolved' },
            });
            marked += res.count;
          }

          if (idsToCreate.length) {
            const res = await prisma.publicationComment.createMany({
              data: idsToCreate.map((id) => ({
                publicationId: pub.id,
                platform: pub.platform,
                externalCommentId: id,
                status: 'resolved',
              })),
              skipDuplicates: true,
            });
            marked += res.count;
          }
        } else {
          const res = await prisma.publicationComment.updateMany({
            where: { publicationId: pub.id, status: 'open' },
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
