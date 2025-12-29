import { FastifyPluginAsync } from 'fastify';
import { computePlaceholders } from '../services/placeholderService.js';
import { getRedisClient } from '../services/redis.js';
import { backgroundJobs, JobType } from '../services/background-jobs.js';
import { getDatabaseClient } from '../config/database.js';
import { assertBrandOwnership } from '../services/ownership.js';
import {
  BrandNotFoundError,
  BrandValidationError,
  createBrand,
  deleteBrand,
  getBrandDetails,
  listUserBrands,
  updateBrand,
  type CreateBrandBody,
  type UpdateBrandBody,
} from '../services/brand.js';

const prisma = getDatabaseClient();

const brandsRoutes: FastifyPluginAsync = async (fastify) => {
  // Create a new brand (RESTful: POST /)
  fastify.post<{ Body: CreateBrandBody }>(
    '/',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const brand = await createBrand(userId, request.body);

        // Note: do not auto-start brand analysis on creation.
        // Analysis runs only on IG connect, brand updates, or manual trigger.
        return reply.code(201).send({ brand });
      } catch (error) {
        request.log.error({ err: error }, 'Brand creation error');

        if (error instanceof BrandValidationError) {
          return reply.code(400).send({ error: error.message });
        }

        // Unique constraint + other domain errors should be mapped by the global error handler
        throw error;
      }
    }
  );

  // Get user's brands (RESTful: GET /)
  fastify.get('/', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;

      const brands = await listUserBrands(userId);

      return { brands };
    } catch (error) {
      request.log.error({ err: error }, 'Brands list error');
      return reply.code(500).send({ error: 'Failed to retrieve brands' });
    }
  });

  // Get specific brand details (RESTful: GET /:id)
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { id } = request.params;

        const brand = await getBrandDetails(userId, id);

        return { brand };
      } catch (error) {
        request.log.error({ err: error }, 'Brand details error');
        if (error instanceof BrandNotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        return reply.code(500).send({ error: 'Failed to retrieve brand details' });
      }
    }
  );

  // Update a brand (RESTful: PUT /:id)
  fastify.put<{ Params: { id: string }; Body: UpdateBrandBody }>(
    '/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { id } = request.params;
        const updatedBrand = await updateBrand(userId, id, request.body);

        return reply.code(200).send({
          message: 'Brand updated successfully',
          brand: updatedBrand,
        });
      } catch (error) {
        request.log.error({ err: error }, 'Brand update error');

        if (error instanceof BrandValidationError) {
          return reply.code(400).send({ error: error.message });
        }
        if (error instanceof BrandNotFoundError) {
          return reply.code(404).send({ error: error.message });
        }

        throw error;
      }
    }
  );

  // Delete a brand (RESTful: DELETE /:id)
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { id } = request.params;

        const brand = await deleteBrand(userId, id);

        return reply.code(200).send({
          message: 'Brand deleted successfully',
          deletedBrand: {
            id: brand.id,
            name: brand.name,
            contentCount: brand._count.content,
          },
        });
      } catch (error) {
        request.log.error({ err: error }, 'Brand deletion error');
        if (error instanceof BrandNotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        return reply.code(500).send({ error: 'Failed to delete brand' });
      }
    }
  );

  // Brand calendar (moved from content.ts)
  fastify.get<{ Params: { id: string; month: string } }>(
    '/:id/calendar/:month',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id: brandId, month } = request.params;

        // Verify brand ownership
        await assertBrandOwnership(userId, brandId);

        // Parse month string (format: YYYY-MM)
        const parts = month.split('-');
        if (parts.length !== 2)
          return reply.code(400).send({ error: 'Invalid month format. Use YYYY-MM' });
        const [yearStr, monthStr] = parts;
        if (!yearStr || !monthStr)
          return reply.code(400).send({ error: 'Invalid month format. Use YYYY-MM' });
        const year = parseInt(yearStr, 10);
        const monthNum = parseInt(monthStr, 10);
        if (isNaN(year) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
          return reply.code(400).send({ error: 'Invalid month format. Use YYYY-MM' });
        }

        // CRITICAL: Create month boundaries in the brand's timezone, not server's timezone
        const { TimezoneService } = await import('../services/timezone.js');
        const brandTimezone = await TimezoneService.getBrandTimezone(brandId);

        // Create month start (first day of month at 00:00:00 in brand's timezone)
        const monthStartStr = `${year}-${String(monthNum).padStart(2, '0')}-01`;
        const monthStart = TimezoneService.createDateInBrandTimezone(
          monthStartStr,
          '00:00',
          brandTimezone
        );

        // Create month end (last day of month at 23:59:59 in brand's timezone)
        const lastDay = new Date(year, monthNum, 0).getDate(); // Get last day of month
        const monthEndStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        const monthEnd = TimezoneService.createDateInBrandTimezone(
          monthEndStr,
          '23:59',
          brandTimezone
        );

        const whereWithoutPublications = {
          brandId,
          OR: [
            { scheduledAt: { gte: monthStart, lte: monthEnd } },
            { postedAt: { gte: monthStart, lte: monthEnd } },
          ],
        };

        const whereWithPublications = {
          ...whereWithoutPublications,
          OR: [
            ...whereWithoutPublications.OR,
            {
              publications: {
                some: { publishedAt: { gte: monthStart, lte: monthEnd } },
              },
            },
          ],
        };

        // Get existing content for the month with campaign info for color coding
        let content: Array<any> = [];
        let hasPublications = true;
        try {
          content = await prisma.content.findMany({
            where: whereWithPublications,
            include: {
              campaign: { select: { id: true, name: true, color: true, status: true } },
              publications: { select: { platform: true, permalink: true, publishedAt: true } },
              publishingQueueItem: { select: { id: true } },
              mediaAssets: {
                select: { assetId: true, displayOrder: true },
                orderBy: { displayOrder: 'asc' },
              },
              _count: { select: { mediaAssets: true } },
            },
            orderBy: { scheduledAt: 'asc' },
          });
        } catch (e: any) {
          // If publications table missing (pre-migration), retry without publications include
          const code = e?.code || e?.meta?.code;
          if (code === 'P2021' || /content_publications/.test(String(e?.message || ''))) {
            hasPublications = false;
            content = await prisma.content.findMany({
              where: whereWithoutPublications,
              include: {
                campaign: { select: { id: true, name: true, color: true, status: true } },
                publishingQueueItem: { select: { id: true } },
                mediaAssets: {
                  select: { assetId: true, displayOrder: true },
                  orderBy: { displayOrder: 'asc' },
                },
                _count: { select: { mediaAssets: true } },
              },
              orderBy: { scheduledAt: 'asc' },
            });
            request.log.warn(
              { err: e },
              'Publications table missing; calendar will omit permalinks until migrations are applied'
            );
          } else {
            throw e;
          }
        }

        // Get active campaigns
        const campaigns = await prisma.campaign.findMany({
          where: { brandId, status: { in: ['active', 'preview'] } },
        });

        // Compute placeholders (timezone-aware). If it fails, degrade gracefully to empty.
        let placeholders: any[] = [];
        try {
          placeholders = await computePlaceholders(campaigns, content, monthStart, monthEnd);
        } catch (e) {
          request.log.warn({ err: e }, 'Placeholder computation failed; returning content only');
          placeholders = [];
        }

        // Map to response format with CDN URLs and campaign colors
        const contentWithUrls = content.map((item) => {
          const pubs = hasPublications ? item.publications || [] : [];
          const ig = hasPublications ? pubs.find((p: any) => p.platform === 'instagram') : null;
          const primaryPermalink = hasPublications
            ? ig?.permalink || pubs[0]?.permalink || null
            : null;
          const derivedPostedAt = hasPublications
            ? (item.postedAt ?? ig?.publishedAt ?? pubs[0]?.publishedAt ?? null)
            : (item.postedAt ?? null);
          const normalizedMediaAssets = Array.isArray((item as any).mediaAssets)
            ? ((item as any).mediaAssets as Array<{ assetId: string; displayOrder: number }>)
            : [];
          const primaryAssetId = normalizedMediaAssets[0]?.assetId ?? null;

          return {
            id: item.id,
            caption: item.caption,
            hashtags: item.hashtags,
            status: item.status,
            scheduledAt: item.scheduledAt,
            postedAt: derivedPostedAt,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            brandId: item.brandId,
            contentGroupId: (item as any).contentGroupId ?? null,
            targetSocialAccountId: (item as any).targetSocialAccountId ?? null,
            contentType: item.contentType,
            shareToFeed: (item as any).shareToFeed ?? null,
            schedulingError: (item as any).schedulingError ?? null,
            publishingQueueItemId: item.publishingQueueItem?.id ?? null,
            primaryAssetId,
            mediaAssets: normalizedMediaAssets,
            mediaAssetCount: (item as any)?._count?.mediaAssets ?? null,
            campaignId: item.campaignId,
            campaignName: item.campaign?.name,
            campaignColor: item.campaign?.color,
            campaignStatus: item.campaign?.status ?? null,
            permalink: primaryPermalink,
            firstComment: (item as any).firstComment ?? null,
            firstCommentStatus: (item as any).firstCommentStatus ?? null,
            firstCommentPostedAt: (item as any).firstCommentPostedAt ?? null,
            firstCommentError: (item as any).firstCommentError ?? null,
          };
        });

        return { success: true, data: { content: contentWithUrls, placeholders } };
      } catch (error) {
        request.log.error({ err: error }, 'Calendar content error');
        return reply.code(500).send({ error: 'Failed to retrieve calendar content' });
      }
    }
  );

  // Inbox: Unified items (comments + DMs) for multi-channel Inbox UI
  fastify.get<{
    Params: { id: string };
    Querystring: {
      socialAccountId?: string | string[];
      channel?: string | string[];
      platform?: string | string[];
      view?: 'to_review' | 'all';
      limit?: string;
    };
  }>('/:id/inbox/items', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { id: brandId } = request.params;

      // Verify ownership
      await assertBrandOwnership(userId, brandId);

      const parseList = (value: string | string[] | undefined | null): string[] => {
        if (!value) return [];
        const parts = Array.isArray(value) ? value : String(value).split(',');
        return parts.map((v) => String(v || '').trim()).filter(Boolean);
      };

      const socialAccountIds = parseList(request.query.socialAccountId);
      const channelsRaw = parseList(request.query.channel);
      const platformsRaw = parseList(request.query.platform);
      const view = request.query.view === 'all' ? 'all' : 'to_review';
      const limit = Math.max(
        1,
        Math.min(100, Number.parseInt(String(request.query.limit || 50), 10) || 50)
      );

      const normalizePlatform = (value: string): string => {
        const v = String(value || '')
          .trim()
          .toLowerCase();
        if (v === 'ig') return 'instagram';
        if (v === 'fb') return 'facebook';
        return v;
      };
      const platformAllowList = new Set([
        'instagram',
        'facebook',
        'linkedin',
        'x',
        'youtube',
        'tiktok',
      ]);
      const platformsNormalized = platformsRaw
        .map(normalizePlatform)
        .filter((p) => platformAllowList.has(p));

      const channels = channelsRaw.length ? new Set(channelsRaw) : null;
      const platforms = platformsNormalized.length ? new Set(platformsNormalized) : null;

      const items: any[] = [];

      // -----------------------
      // Comments (publication-centric)
      // -----------------------
      const includeComments =
        (!channels && true) || (channels && (channels.has('comments') || channels.has('comment')));
      const supportedCommentPlatforms = ['instagram', 'facebook'] as const;
      const commentPlatforms = platforms
        ? supportedCommentPlatforms.filter((p) => platforms.has(p))
        : supportedCommentPlatforms;

      if (includeComments && commentPlatforms.length) {
        const pubs = await prisma.contentPublication.findMany({
          where: {
            platform: { in: commentPlatforms as any },
            socialAccount: { brandId, platform: { in: commentPlatforms as any } },
            ...(socialAccountIds.length ? { socialAccountId: { in: socialAccountIds } } : {}),
          },
          orderBy: { publishedAt: 'desc' },
          take: 200,
          select: {
            id: true,
            platform: true,
            socialAccountId: true,
            permalink: true,
            publishedAt: true,
            metricsLatest: { select: { comments: true } },
            content: {
              select: {
                id: true,
                caption: true,
                postedAt: true,
                mediaAssets: {
                  select: { assetId: true, displayOrder: true },
                  orderBy: { displayOrder: 'asc' },
                  take: 1,
                },
              },
            },
          },
        });

        const publicationIds = pubs.map((p) => p.id).filter(Boolean);
        const grouped = publicationIds.length
          ? await prisma.publicationComment.groupBy({
              by: ['publicationId', 'status'],
              where: { publicationId: { in: publicationIds } },
              _count: { _all: true },
            })
          : [];

        const countsByPublicationId = new Map<
          string,
          { open: number; resolved: number; archived: number }
        >();
        for (const row of grouped) {
          const entry = countsByPublicationId.get(row.publicationId) || {
            open: 0,
            resolved: 0,
            archived: 0,
          };
          const status = String(row.status);
          if (status === 'open') entry.open = row._count._all;
          if (status === 'resolved') entry.resolved = row._count._all;
          if (status === 'archived') entry.archived = row._count._all;
          countsByPublicationId.set(row.publicationId, entry);
        }

        const latestComments = publicationIds.length
          ? await prisma.publicationComment.findMany({
              where: {
                publicationId: { in: publicationIds },
                ...(view === 'to_review' ? { status: 'open' } : {}),
              },
              orderBy: [{ publicationId: 'asc' }, { createdAt: 'desc' }],
              distinct: ['publicationId'],
              select: {
                publicationId: true,
                text: true,
                authorUsername: true,
                createdAt: true,
              },
            })
          : [];

        const latestCommentByPublicationId = new Map(
          latestComments.map((c) => [
            c.publicationId,
            {
              text: c.text,
              authorUsername: c.authorUsername,
              createdAt: c.createdAt,
            },
          ])
        );

        for (const pub of pubs) {
          const counts = countsByPublicationId.get(pub.id) || {
            open: 0,
            resolved: 0,
            archived: 0,
          };
          const persistedTotal = counts.open + counts.resolved + counts.archived;
          const totalComments = pub.metricsLatest?.comments ?? persistedTotal;
          const newCount = persistedTotal > 0 ? counts.open : totalComments;

          if (view === 'to_review' && (!pub.content?.id || newCount <= 0)) continue;

          const latest = latestCommentByPublicationId.get(pub.id) || null;
          const lastActivityAt =
            latest?.createdAt || pub.content?.postedAt || pub.publishedAt || null;

          items.push({
            type: 'comment_thread',
            platform: pub.platform,
            socialAccountId: pub.socialAccountId,
            publicationId: pub.id,
            postId: pub.content?.id || '',
            caption: pub.content?.caption || null,
            primaryAssetId: pub.content?.mediaAssets?.[0]?.assetId ?? null,
            permalink: pub.permalink || null,
            postedAt: pub.content?.postedAt || pub.publishedAt || null,
            totalComments,
            resolvedCount: counts.resolved,
            newCount,
            lastActivityAt,
            previewText: latest?.text || null,
            previewAuthorUsername: latest?.authorUsername || null,
          });
        }
      }

      // -----------------------
      // DMs (conversation-centric)
      // -----------------------
      const includeDMs =
        (!channels && true) || (channels && (channels.has('dms') || channels.has('dm')));
      if (includeDMs) {
        const where: any = { brandId };
        if (socialAccountIds.length) where.socialAccountId = { in: socialAccountIds };
        if (view === 'to_review') where.state = 'active';
        if (platforms) where.platform = { in: Array.from(platforms) } as any;

        const conversations = await prisma.dMConversation.findMany({
          where,
          orderBy: { lastMessageAt: 'desc' },
          take: 200,
          include: {
            _count: { select: { messages: true } },
          },
        });

        const conversationIds = conversations.map((c) => c.id);
        const lastMessages = conversationIds.length
          ? await prisma.dMMessage.findMany({
              where: { conversationId: { in: conversationIds } },
              orderBy: [{ conversationId: 'asc' }, { createdAt: 'desc' }],
              distinct: ['conversationId'],
              select: {
                conversationId: true,
                messageText: true,
                direction: true,
                createdAt: true,
              },
            })
          : [];

        const lastMessageByConversationId = new Map(
          lastMessages.map((m) => [
            m.conversationId,
            {
              text: m.messageText,
              direction: m.direction,
              createdAt: m.createdAt,
            },
          ])
        );

        for (const conv of conversations) {
          const last = lastMessageByConversationId.get(conv.id) || null;
          if (view === 'to_review' && last?.direction !== 'inbound') continue;

          items.push({
            type: 'dm_conversation',
            platform: conv.platform,
            socialAccountId: conv.socialAccountId,
            conversationId: conv.id,
            state: conv.state,
            participantUsername: conv.participantUsername,
            lastMessageAt: conv.lastMessageAt,
            lastMessageText: last?.text || null,
            lastMessageDirection: last?.direction || null,
            messageCount: conv._count.messages,
          });
        }
      }

      items.sort((a, b) => {
        const ta = a.lastActivityAt
          ? new Date(a.lastActivityAt).getTime()
          : a.lastMessageAt
            ? new Date(a.lastMessageAt).getTime()
            : 0;
        const tb = b.lastActivityAt
          ? new Date(b.lastActivityAt).getTime()
          : b.lastMessageAt
            ? new Date(b.lastMessageAt).getTime()
            : 0;
        return tb - ta;
      });

      return reply.send({ items: items.slice(0, limit) });
    } catch (error) {
      request.log.error({ err: error }, 'Inbox items error');
      return reply.code(500).send({ error: 'Failed to retrieve inbox items' });
    }
  });

  // Enqueue/trigger background ingestion of comments for a brand
  fastify.post<{ Params: { id: string } }>(
    '/:id/inbox/comments/ingest',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id: brandId } = request.params;
        const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
        if (!brand) return reply.code(404).send({ error: 'Brand not found' });

        // Throttle via Redis to avoid overloading the Graph API
        const redis = getRedisClient();
        const throttleKey = `ingest:brand:comments:${brandId}`;
        let nextAllowed: string | null = null;
        if (redis) {
          const ttl = await redis.ttl(throttleKey);
          if (ttl > 0) {
            nextAllowed = new Date(Date.now() + ttl * 1000).toISOString();
            return reply.code(429).send({
              success: false,
              error: 'Ingestion recently requested',
              nextAllowed,
            });
          }
          await redis.setex(throttleKey, 5 * 60, '1'); // 5 minutes
        }

        // Run ingestion in the background (non-blocking)
        let jobId: string | number | null = null;
        try {
          const job = await backgroundJobs.scheduleJob(JobType.INBOX_COMMENTS_INGEST, {
            brandId,
            maxPosts: 50,
            perPostLimit: 100,
            triggeredBy: userId,
          });
          jobId = job.id;
        } catch (e) {
          // If we fail to enqueue the job, remove the throttle key so the user can retry immediately.
          if (redis) {
            try {
              await redis.del(throttleKey);
            } catch {}
          }
          throw e;
        }

        nextAllowed = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        return reply.send({ success: true, enqueued: true, jobId, nextAllowed });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to enqueue comments ingestion');
        return reply.code(500).send({ error: 'Failed to enqueue comments ingestion' });
      }
    }
  );

  // Brand content history (moved from content.ts)
  fastify.get<{ Params: { id: string } }>(
    '/:id/content/history',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id: brandId } = request.params;

        // Verify ownership
        const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
        if (!brand) return reply.code(404).send({ error: 'Brand not found' });

        const contentHistory = await prisma.content.findMany({
          where: {
            brandId,
            status: { in: ['draft', 'scheduled', 'published', 'failed', 'skipped'] },
          },
          select: {
            id: true,
            caption: true,
            hashtags: true,
            status: true,
            scheduledAt: true,
            postedAt: true,
            createdAt: true,
            updatedAt: true,
            shareToFeed: true,
            mediaAssets: {
              select: { assetId: true, displayOrder: true },
              orderBy: { displayOrder: 'asc' },
              take: 1,
            },
            publications: { select: { platform: true, permalink: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: 50,
        });

        const historyWithUrls = contentHistory.map((item) => {
          const pubs = (item as any).publications || [];
          const ig = pubs.find((p: any) => p.platform === 'instagram');
          const primaryPermalink = ig?.permalink || pubs[0]?.permalink || null;
          return {
            id: item.id,
            caption: item.caption,
            hashtags: item.hashtags,
            primaryAssetId: item.mediaAssets?.[0]?.assetId ?? null,
            status: item.status,
            scheduledAt: item.scheduledAt,
            postedAt: item.postedAt,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            permalink: primaryPermalink,
            shareToFeed: (item as any).shareToFeed,
          };
        });

        return { content: historyWithUrls };
      } catch (error) {
        request.log.error({ err: error }, 'Content history error');
        return reply.code(500).send({ error: 'Failed to retrieve content history' });
      }
    }
  );

  // Instagram authorize alias -> forwards to auth route
  fastify.get<{ Params: { id: string } }>(
    '/:id/instagram/authorize',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id } = request.params;
      const r = await fastify.inject({
        method: 'GET',
        url: `/api/auth/instagram/authorize?brandId=${encodeURIComponent(id)}`,
        headers: { cookie: request.headers.cookie as string },
      });
      return reply.code(r.statusCode).send(r.json());
    }
  );
};

export default brandsRoutes;
