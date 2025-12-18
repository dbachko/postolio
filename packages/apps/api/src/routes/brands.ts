import { FastifyPluginAsync } from 'fastify';
import { computePlaceholders } from '../services/placeholderService.js';
import { instagramService } from '../services/instagram.js';
import { getRedisClient } from '../services/redis.js';
import { ingestBrandComments } from '../services/inbox-comments-ingestor.js';
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

        // Get existing content for the month with campaign info for color coding
        let content: Array<any> = [];
        let hasPublications = true;
        try {
          content = await prisma.content.findMany({
            where: {
              brandId,
              OR: [
                { scheduledAt: { gte: monthStart, lte: monthEnd } },
                { postedAt: { gte: monthStart, lte: monthEnd } },
              ],
            },
            include: {
              campaign: { select: { id: true, name: true, color: true } },
              publications: { select: { platform: true, permalink: true } },
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
              where: {
                brandId,
                OR: [
                  { scheduledAt: { gte: monthStart, lte: monthEnd } },
                  { postedAt: { gte: monthStart, lte: monthEnd } },
                ],
              },
              include: {
                campaign: { select: { id: true, name: true, color: true } },
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
            postedAt: item.postedAt,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            brandId: item.brandId,
            contentGroupId: (item as any).contentGroupId ?? null,
            targetSocialAccountId: (item as any).targetSocialAccountId ?? null,
            contentType: item.contentType,
            shareToFeed: (item as any).shareToFeed ?? null,
            schedulingError: (item as any).schedulingError ?? null,
            primaryAssetId,
            mediaAssets: normalizedMediaAssets,
            mediaAssetCount: (item as any)?._count?.mediaAssets ?? null,
            campaignId: item.campaignId,
            campaignName: item.campaign?.name,
            campaignColor: item.campaign?.color,
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

  // Inbox: Comments overview with unread counts per post
  fastify.get<{ Params: { id: string } }>(
    '/:id/inbox/comments',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id: brandId } = request.params;

        // Verify ownership
        await assertBrandOwnership(userId, brandId);

        // Get Instagram SocialAccount for API calls
        const instagramAccount = await prisma.socialAccount.findFirst({
          where: {
            brandId,
            platform: 'instagram',
          },
        });

        // Prefer unresolved comment counts per publication for "new" activity.
        const pubs = await prisma.contentPublication.findMany({
          where: {
            platform: 'instagram',
            socialAccount: { brandId, platform: 'instagram' },
          },
          orderBy: { publishedAt: 'desc' },
          take: 200,
          select: {
            id: true,
            externalPostId: true,
            permalink: true,
            publishedAt: true,
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

        let items = await Promise.all(
          pubs.map(async (pub) => {
            // Local workflow counts
            const [unresolvedCount, resolvedCount] = await Promise.all([
              prisma.publicationComment.count({
                where: { publicationId: pub.id, status: { not: 'resolved' } },
              }),
              prisma.publicationComment.count({
                where: { publicationId: pub.id, status: 'resolved' },
              }),
            ]);

            let totalComments = unresolvedCount + resolvedCount;
            let newCount = unresolvedCount;

            // If no local comment records, try a lightweight Graph lookup for counts
            if (totalComments === 0 && pub.externalPostId && instagramAccount) {
              try {
                const redis = getRedisClient();
                const cacheKey = `ig:comments_count:${pub.externalPostId}`;
                const cached = redis ? await redis.get(cacheKey) : null;
                if (cached !== null) {
                  totalComments = Number(cached) || 0;
                } else {
                  const res = await instagramService.getPostComments(
                    {
                      id: brandId,
                      instagramAccountId: instagramAccount.externalAccountId,
                      instagramPageId: instagramAccount.externalPageId,
                    } as any,
                    String(pub.externalPostId),
                    1 // minimal page to fetch accurate comments_count
                  );
                  totalComments = Number(res.total || 0);
                  if (redis) await redis.setex(cacheKey, 300, String(totalComments));
                }
                newCount = Math.max(0, totalComments - resolvedCount);
              } catch (e) {
                request.log.warn({ err: e, pubId: pub.id }, 'Graph comments count fallback failed');
              }
            }

            return {
              postId: pub.content?.id || '',
              caption: pub.content?.caption || null,
              primaryAssetId: pub.content?.mediaAssets?.[0]?.assetId ?? null,
              permalink: pub.permalink || null,
              postedAt: pub.content?.postedAt || pub.publishedAt || null,
              totalComments,
              resolvedCount,
              newCount,
            };
          })
        );

        // Keep only those with new activity
        items = items.filter((r) => r.postId && r.newCount > 0);

        // Sort and trim
        items = items
          .sort((a, b) => {
            const ta = a.postedAt ? new Date(a.postedAt).getTime() : 0;
            const tb = b.postedAt ? new Date(b.postedAt).getTime() : 0;
            return tb - ta;
          })
          .slice(0, 50);

        return reply.send({ items });
      } catch (error) {
        request.log.error({ err: error }, 'Inbox comments overview error');
        return reply.code(500).send({ error: 'Failed to retrieve inbox comments' });
      }
    }
  );

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
        setImmediate(async () => {
          try {
            await ingestBrandComments(brandId, 50, 100);
          } catch (e) {
            request.log.warn({ err: e }, 'Background comments ingestion failed');
          }
        });

        nextAllowed = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        return reply.send({ success: true, enqueued: true, nextAllowed });
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

  // ==========================
  // Saved Replies (brand-level)
  // ==========================
  fastify.get<{ Params: { id: string } }>(
    '/:id/replies',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: brandId } = request.params;
      const userId = request.user!.id;
      await assertBrandOwnership(userId, brandId);
      const rows = await prisma.savedReply.findMany({
        where: { brandId },
        orderBy: { updatedAt: 'desc' },
      });
      return reply.send({ replies: rows });
    }
  );

  fastify.post<{
    Params: { id: string };
    Body: { title: string; body: string; isDefault?: boolean };
  }>('/:id/replies', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { id: brandId } = request.params;
    const userId = request.user!.id;
    await assertBrandOwnership(userId, brandId);
    const { title, body, isDefault } = request.body || ({} as any);
    if (!title?.trim() || !body?.trim())
      return reply.code(400).send({ error: 'Title and body are required' });
    const row = await prisma.savedReply.create({
      data: { brandId, userId, title: title.trim(), body, isDefault: !!isDefault },
    });
    return reply.code(201).send({ reply: row });
  });

  fastify.put<{
    Params: { id: string; replyId: string };
    Body: { title?: string; body?: string; isDefault?: boolean };
  }>('/:id/replies/:replyId', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { id: brandId, replyId } = request.params;
    const userId = request.user!.id;
    await assertBrandOwnership(userId, brandId);
    const data: any = {};
    if (request.body?.title !== undefined) data.title = request.body.title;
    if (request.body?.body !== undefined) data.body = request.body.body;
    if (request.body?.isDefault !== undefined) data.isDefault = request.body.isDefault;
    const row = await prisma.savedReply.update({ where: { id: replyId }, data });
    return reply.send({ reply: row });
  });

  fastify.delete<{ Params: { id: string; replyId: string } }>(
    '/:id/replies/:replyId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: brandId, replyId } = request.params;
      const userId = request.user!.id;
      await assertBrandOwnership(userId, brandId);
      await prisma.savedReply.delete({ where: { id: replyId } });
      return reply.send({ success: true });
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
